import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agents-'));
const oldHome = process.env.HOME;
const oldPath = process.env.PATH;
process.env.HOME = home;
process.env.PATH = path.join(home, 'bin') + ':' + oldPath;
process.env.JARVIS_AGENT_TEST_HOME = home;
try {
  fs.mkdirSync(path.join(home, 'bin'));
  const defaults = path.join(home, '.config/omarchy/defaults');
  fs.mkdirSync(defaults, {recursive: true});
  for (const id of ['opencode', 'hermes']) {
    fs.writeFileSync(path.join(home, 'bin', id), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const id = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const send = value => console.log(JSON.stringify(value));
if (id === 'hermes') {
  const log = [];
  let promptId;
  require('node:readline').createInterface({input:process.stdin}).on('line', line => {
    const msg = JSON.parse(line);
    log.push(msg);
    const reply = result => send({jsonrpc:'2.0', id:msg.id, result});
    const chunk = text => send({jsonrpc:'2.0', method:'session/update', params:{sessionId:'hermes-session', update:{sessionUpdate:'agent_message_chunk', content:{type:'text', text}}}});
    if (msg.method === 'initialize') reply({protocolVersion:1, agentCapabilities:{loadSession:true}});
    if (msg.method === 'session/new') reply({sessionId:'hermes-session'});
    if (msg.method === 'session/load') { chunk('old history'); reply({}); }
    if (msg.method === 'session/prompt') {
      const prompt = msg.params.prompt[0].text;
      fs.writeFileSync(path.join(process.env.JARVIS_AGENT_TEST_HOME, 'invocation'), JSON.stringify({args, prompt, cwd:process.cwd(), log}));
      if (prompt.includes('slow request')) { promptId = msg.id; return; }
      if (prompt.includes('failure request')) { send({id:msg.id, error:{message:'provider unavailable'}}); return; }
      if (prompt.includes('permission request')) {
        promptId = msg.id;
        send({id:'permission', method:'session/request_permission', params:{options:[{kind:'allow_once', optionId:'allow'}]}});
        return;
      }
      for (const text of ['ha','ha',' world']) chunk(text);
      reply({stopReason:'end_turn'});
    }
    if (msg.id === 'permission') {
      fs.writeFileSync(path.join(process.env.JARVIS_AGENT_TEST_HOME, 'permission'), JSON.stringify(msg.result));
      send({id:promptId, result:{stopReason:'end_turn'}});
    }
    if (msg.method === 'session/cancel') {
      fs.writeFileSync(path.join(process.env.JARVIS_AGENT_TEST_HOME, 'cancelled'), 'yes');
      send({id:promptId, result:{stopReason:'cancelled'}});
    }
  });
} else {
  let prompt = '';
  process.stdin.on('data', data => prompt += data);
  process.stdin.on('end', () => {
    fs.writeFileSync(path.join(process.env.JARVIS_AGENT_TEST_HOME, 'invocation'), JSON.stringify({args, prompt, cwd: process.cwd()}));
    if (prompt.includes('slow request')) { setTimeout(() => {}, 30000); return; }
    if (prompt.includes('failure request')) { send({type:'error', error:{message:'provider unavailable'}}); return; }
    send({type:'step_start', sessionID:'opencode-session'});
    send({type:'text', sessionID:'opencode-session', part:{id:'answer', text:'Hello'}});
    send({type:'text', sessionID:'opencode-session', part:{id:'answer', text:'Hello world'}});
    send({type:'tool_use', part:{text:'private tool output'}});
  });
}
`, {mode: 0o755});
  }
  const {agentStatus, runAgent} = await import('../server/lib/agent.mjs');
  for (const id of ['opencode', 'hermes']) {
    fs.writeFileSync(path.join(defaults, 'agent'), id);
    const config = {agent:'', workDir:home, systemPrompt:'private system instructions'};
    assert.deepEqual(agentStatus(config), {id, label:id === 'opencode' ? 'OpenCode' : 'Hermes', ready:true});
    const chunks = [];
    const text = 'private request "quotes" $(touch NEVER) `literal`\nsecond line';
    const result = await runAgent({config, text, onText:chunk => chunks.push(chunk)});
    assert.equal(result.text, id === 'opencode' ? 'Hello world' : 'haha world');
    assert.equal(chunks.join(''), result.text);
    assert.equal(result.session, `${id}-session`);
    let invocation = JSON.parse(fs.readFileSync(path.join(home, 'invocation')));
    assert.equal(invocation.prompt, config.systemPrompt + '\n\nSpoken user request: ' + text);
    assert.ok(!JSON.stringify(invocation.args).includes('private'));
    assert.equal(invocation.cwd, home);
    assert.ok(!invocation.args.includes('--auto') && !invocation.args.includes('--yolo'));
    if (id === 'opencode') assert.ok(invocation.args.includes('--standalone'));
    else assert.deepEqual(invocation.args, ['acp']);
    await runAgent({config:{...config, agentFullAccess:true}, text:'next', sessionId:result.session});
    invocation = JSON.parse(fs.readFileSync(path.join(home, 'invocation')));
    if (id === 'opencode') {
      assert.ok(invocation.args.includes(result.session));
      assert.ok(invocation.args.includes('--auto'));
    } else {
      assert.ok(invocation.log.some(msg => msg.method === 'session/load' && msg.params.sessionId === result.session));
      for (const full of [false, true]) {
        await runAgent({config:{...config, agentFullAccess:full}, text:'permission request'});
        const permission = JSON.parse(fs.readFileSync(path.join(home, 'permission')));
        assert.equal(permission.outcome.outcome, full ? 'selected' : 'cancelled');
      }
    }
    await assert.rejects(runAgent({config, text:'failure request'}), /provider unavailable/);
    const controller = new AbortController();
    const pending = runAgent({config, text:'slow request', signal:controller.signal});
    if (id === 'hermes') {
      // Wait until the fake gateway owns the turn before requesting cancellation.
      for (let i=0; i<100; i++) {
        const invocation = JSON.parse(fs.readFileSync(path.join(home, 'invocation')));
        if (invocation.prompt.includes('slow request')) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    controller.abort();
    await assert.rejects(pending, /Cancelled/);
    if (id === 'hermes') assert.ok(fs.existsSync(path.join(home, 'cancelled')));
    fs.unlinkSync(path.join(home, 'bin', id));
    process.env.PATH = path.join(home, 'bin');
    assert.equal(agentStatus(config).ready, false);
    process.env.PATH = path.join(home, 'bin') + ':' + oldPath;
  }
  console.log('PASS: Omarchy defaults, private stdin, streaming, sessions, opt-in access, errors and cancellation for OpenCode/Hermes.');
} finally {
  process.env.HOME = oldHome;
  process.env.PATH = oldPath;
  delete process.env.JARVIS_AGENT_TEST_HOME;
  fs.rmSync(home, {recursive:true, force:true});
}
