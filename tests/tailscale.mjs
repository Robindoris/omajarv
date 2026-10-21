import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tailscale-'));
const root = path.resolve(import.meta.dirname, '..');
try {
  fs.mkdirSync(path.join(home, 'bin'));
  fs.writeFileSync(path.join(home, 'bin/tailscale'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if(args[0] === 'status') console.log(JSON.stringify({BackendState: 'Running', Self: {DNSName: 'test.tail123.ts.net.', Online: true}}));
else if(args[1] === 'status') console.log(process.env.TEST_SERVE || '{}');
else {require('fs').writeFileSync(process.env.HOME + '/invoked', JSON.stringify(args)); console.log('Enabled');}
`, { mode: 0o755 });
  const env = {...process.env, HOME: home, PATH: path.join(home, 'bin') + ':' + process.env.PATH};
  const run = (action, serve = {}) => spawnSync(process.execPath, [path.join(root, 'server/lib/tailscale.mjs'), action], {encoding: 'utf8', env: {...env, TEST_SERVE: JSON.stringify(serve)}});
  const serve = {TCP: {'443': {HTTPS: true}}, Web: {'test.tail123.ts.net:443': {Handlers: {'/': {Proxy: 'https+insecure://localhost:4317'}}}}};
  assert.equal(JSON.parse(run('status').stdout).state, 'off');
  assert.equal(JSON.parse(run('status', serve).stdout).url, 'https://test.tail123.ts.net');
  assert.equal(run('enable', serve).status, 0);
  assert.equal(fs.existsSync(path.join(home, 'invoked')), false);
  const conflict = structuredClone(serve);
  conflict.Web['test.tail123.ts.net:443'].Handlers['/'].Proxy = 'http://localhost:9000';
  assert.equal(run('enable', conflict).status, 1);
  assert.equal(fs.existsSync(path.join(home, 'invoked')), false);
  const funnel = {...serve, AllowFunnel: {'test.tail123.ts.net:443': true}};
  assert.equal(JSON.parse(run('status', funnel).stdout).state, 'off');
  assert.equal(run('enable', funnel).status, 1);
  assert.equal(run('enable').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'invoked'))), ['serve', '--bg', '--https=443', 'https+insecure://localhost:4317']);
  console.log('PASS: stable URL, disabled Serve, idempotent enable, conflicting service protection, public Funnel rejection, persistent private Serve arguments.');
} finally { fs.rmSync(home, {recursive: true, force: true}); }
