import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-serve-socket-'));
process.env.HOME = home;
let server;
try {
  const {ensureDirs, paths} = await import('../server/lib/config.mjs');
  const {listenServeSocket} = await import('../server/lib/serve-socket.mjs');
  ensureDirs();
  server = await listenServeSocket((_req, res) => res.end('private bridge'));
  assert.equal(fs.statSync(paths.stateDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(paths.serveSocket).mode & 0o777, 0o600);
  const body = await new Promise((resolve, reject) => {
    http.get({socketPath: paths.serveSocket, path: '/'}, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  assert.equal(body, 'private bridge');
  await assert.rejects(listenServeSocket(() => {}), /already in use/);
  await new Promise(resolve => server.close(resolve));
  server = null;
  fs.writeFileSync(paths.serveSocket, 'do not remove');
  await assert.rejects(listenServeSocket(() => {}), /Unsafe/);
  assert.equal(fs.readFileSync(paths.serveSocket, 'utf8'), 'do not remove');
  console.log('PASS: private Serve socket permissions, HTTP forwarding and listener/file protection.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(home, {recursive: true, force: true});
}
