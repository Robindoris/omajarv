// Hermes ACP keeps prompts on stdin and explicitly cancels gateway-owned work.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { paths } from './config.mjs';
import { privateError } from './privacy.mjs';

export function runHermes({config, prompt, sessionId, signal, onText, env = {}}) {
  if (signal?.aborted) return Promise.reject(privateError('Cancelled'));
  return new Promise((resolve, reject) => {
    const child = spawn('hermes', ['acp'], {
      cwd: config.workDir || paths.root, detached: true,
      env: {...process.env, ...env, NO_COLOR:'1', FORCE_COLOR:'0', TERM:'dumb'},
      stdio:['pipe', 'pipe', 'pipe'],
    });
    let nextId = 0, session = sessionId || '', text = '', active = false;
    let settled = false, cancelling = false, cancelTimer, stderr = '';
    const pending = new Map();
    const send = value => child.stdin.write(JSON.stringify({jsonrpc:'2.0', ...value}) + '\n');
    const request = (method, params) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, {resolve, reject});
      send({id, method, params});
    });
    const kill = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
      }, 1000);
      timer.unref();
      child.once('close', () => clearTimeout(timer));
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(cancelTimer);
      signal?.removeEventListener('abort', abort);
      for (const waiter of pending.values()) waiter.reject(error || privateError('Hermes transport closed'));
      pending.clear();
      kill();
      if (error) reject(error);
      else resolve({text:text.trim(), session, agent:'hermes', label:'Hermes'});
    };
    const cancel = reason => {
      if (settled || cancelling) return;
      cancelling = reason;
      if (!active) { finish(privateError(reason)); return; }
      // Keep the transport alive until the prompt response acknowledges cancellation.
      send({method:'session/cancel', params:{sessionId:session}});
      cancelTimer = setTimeout(() => finish(privateError(`${reason}; Hermes cancellation was not confirmed`)), 5000);
    };
    const abort = () => cancel('Cancelled');
    const timeout = setTimeout(() => cancel('Hermes timed out'), 240000);
    signal?.addEventListener('abort', abort, {once:true});
    child.on('error', finish);
    child.stdin.on('error', finish);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('close', code => {
      if (!settled) finish(privateError(`Hermes ACP exited with code ${code}. Check its installation, provider and permissions.`));
    });
    readline.createInterface({input:child.stdout, crlfDelay:Infinity}).on('line', line => {
      if (settled) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method === 'session/update') {
        const update = message.params?.update;
        // Loading replays history; only emit chunks for this prompt.
        if (active && !cancelling && message.params.sessionId === session &&
            update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          text += update.content.text;
          onText?.(update.content.text);
        }
      } else if (message.method && message.id !== undefined) {
        if (message.method === 'session/request_permission') {
          const option = config.agentFullAccess === true
            ? message.params?.options?.find(option => option.kind === 'allow_once') : null;
          send({id:message.id, result:{outcome:option
            ? {outcome:'selected', optionId:option.optionId} : {outcome:'cancelled'}}});
        } else {
          send({id:message.id, error:{code:-32601, message:'Client capability unavailable'}});
        }
      } else if (pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(privateError('Hermes ACP request failed. Check its provider and permissions.'));
        else waiter.resolve(message.result);
      }
    });
    (async () => {
      const init = await request('initialize', {protocolVersion:1, clientCapabilities:{}, clientInfo:{name:'omajarv', version:'1.0.0'}});
      if (init.protocolVersion !== 1) throw privateError('Unsupported Hermes ACP protocol version');
      if (session && !init.agentCapabilities?.loadSession) throw privateError('Hermes does not support loading this session');
      const loaded = await request(session ? 'session/load' : 'session/new', {
        cwd:config.workDir || paths.root, mcpServers:[], ...(session ? {sessionId:session} : {}),
      });
      session = loaded?.sessionId || session;
      if (!session) throw privateError('Hermes returned no session ID');
      if (settled) return;
      active = true;
      const result = await request('session/prompt', {sessionId:session, prompt:[{type:'text', text:prompt}]});
      active = false;
      if (cancelling || result?.stopReason === 'cancelled') throw privateError(cancelling || 'Cancelled');
      finish();
    })().catch(finish);
  });
}
