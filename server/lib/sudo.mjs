// Per-turn approval broker. Only ciphertext passes through the HTTP bridge.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomBytes, createPublicKey, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { paths } from './config.mjs';

export async function createSudoSession({signal, timeoutMs = 120000} = {}) {
  const dir = fs.mkdtempSync(path.join(paths.tmp, 'sudo-'));
  fs.chmodSync(dir, 0o700);
  const socketPath = path.join(dir, 'ask.sock');
  const ticket = randomBytes(32).toString('hex');
  const pending = new Map();
  const sockets = new Set();
  const waiters = new Set();
  const notify = () => {
    if (pending.size) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  let closed = false;
  const finish = (id, result) => {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    notify();
    clearTimeout(entry.timer);
    // Let the encrypted reply flush even if the turn completes immediately.
    sockets.delete(entry.socket);
    entry.socket.end(JSON.stringify(result) + '\n');
    return true;
  };
  const server = net.createServer(socket => {
    sockets.add(socket);
    let buffer = '', id;
    socket.setTimeout(timeoutMs + 5000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
      if (id && pending.has(id)) { clearTimeout(pending.get(id).timer); pending.delete(id); notify(); }
    });
    socket.on('data', data => {
      buffer += data.toString();
      if (buffer.length > 20000 || id) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      try {
        const input = JSON.parse(buffer);
        buffer = '';
        const provided = Buffer.from(String(input.ticket || ''));
        const expected = Buffer.from(ticket);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected) || closed || pending.size >= 4) throw new Error();
        const key = createPublicKey(input.publicKey);
        if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength !== 3072) throw new Error();
        if (typeof input.command !== 'string' || input.command.length > 8000 || typeof input.cwd !== 'string' || input.cwd.length > 4096 || typeof input.prompt !== 'string' || input.prompt.length > 500) throw new Error();
        id = randomBytes(24).toString('hex');
        const expiresAt = Date.now() + timeoutMs;
        const timer = setTimeout(() => finish(id, {cancelled:true}), timeoutMs);
        pending.set(id, {id, command:input.command, cwd:input.cwd, prompt:input.prompt,
          publicKey:key.export({type:'spki', format:'pem'}).toString(), expiresAt, timer, socket});
      } catch { socket.end('{"cancelled":true}\n'); }
    });
  });
  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', close);
    for (const id of pending.keys()) finish(id, {cancelled:true});
    for (const socket of sockets) socket.destroy();
    server.close();
    fs.rmSync(dir, {recursive:true, force:true});
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    fs.chmodSync(socketPath, 0o600);
    const wrapper = path.join(dir, 'sudo');
    const helper = pathToFileURL(path.join(paths.root, 'sudo-command.mjs')).href;
    // The per-turn capability is kept in a private file, never in the model prompt.
    fs.writeFileSync(wrapper, `#!${process.execPath}\nimport { runSudo } from ${JSON.stringify(helper)};\nawait runSudo(${JSON.stringify({socketPath, ticket})}, process.argv.slice(2));\n`, {mode:0o700});
    signal?.addEventListener('abort', close, {once:true});
    if (signal?.aborted) close();
    return {
      env:{PATH:dir + path.delimiter + process.env.PATH},
      instruction:`For commands requiring sudo, use ${JSON.stringify(wrapper)} followed by the command and arguments. It opens a separate phone authorization dialog. Run it in the foreground and allow at least 120 seconds for the user to respond; do not give it a short tool timeout, detach it, or finish your turn while it is waiting. Never ask for a password in chat, read password files, or pass a password through a tool prompt. Do not use sudo -S or echo passwords. If authorization is cancelled, stop that operation.`,
      waitForPending:() => pending.size ? new Promise(resolve => waiters.add(resolve)) : Promise.resolve(),
      list:() => [...pending.values()].map(({id, command, cwd, prompt, publicKey, expiresAt}) => ({id, command, cwd, prompt, publicKey, expiresAt})),
      reply(input) {
        if (!input || typeof input.id !== 'string' || Object.keys(input).some(key => !['id','ciphertext','cancel'].includes(key))) return false;
        if (input.cancel === true) return finish(input.id, {cancelled:true});
        // RSA-3072 always yields exactly 384 bytes. No plaintext is accepted here.
        if (typeof input.ciphertext !== 'string' || !/^[A-Za-z0-9+/]{512}$/.test(input.ciphertext)) return false;
        return finish(input.id, {ciphertext:input.ciphertext});
      },
      close,
    };
  } catch (error) { close(); throw error; }
}
