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
if(args[0] === 'serve' && args[1] !== 'status' && process.env.TEST_DENY && !process.env.TEST_ELEVATED) {
 console.error(process.env.TEST_DENY === 'other' ? 'network unavailable' : "sending serve config: 401 Unauthorized: must be root, or be an operator and able to run 'sudo tailscale' to serve a path or Unix socket");
 process.exit(1);
}
if(args[0] === 'status') console.log(JSON.stringify({BackendState: 'Running', Self: {DNSName: 'test.tail123.ts.net.', Online: true}}));
else if(args[1] === 'status') console.log(require('fs').existsSync(process.env.HOME + '/removed') ? '{}' : process.env.TEST_SERVE || '{}');
else if(args.at(-1) === 'off') {require('fs').writeFileSync(process.env.HOME + '/removed', 'yes'); require('fs').appendFileSync(process.env.HOME + '/cleanup', JSON.stringify(args) + '\\n');}
else {require('fs').writeFileSync(process.env.HOME + '/invoked', JSON.stringify(args)); console.log('Enabled');}
`, { mode: 0o755 });
  for (const helper of ['sudo', 'pkexec']) fs.writeFileSync(path.join(home, 'bin', helper), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const helper = require('node:path').basename(process.argv[1]);
fs.appendFileSync(process.env.HOME + '/auth', JSON.stringify({helper,args}) + '\\n');
if(helper === 'sudo' && process.env.TEST_SUDO !== 'ok') process.exit(1);
if(helper === 'pkexec' && process.env.TEST_CANCEL) process.exit(126);
const start = args.indexOf('/usr/bin/tailscale');
if(start < 0) process.exit(99);
const result = require('node:child_process').spawnSync(process.execPath, [process.env.HOME + '/bin/tailscale', ...args.slice(start+1)], {stdio:'inherit', env:{...process.env,TEST_ELEVATED:'yes'}});
process.exit(result.status ?? 1);
`, {mode:0o755});
  const env = {...process.env, HOME: home, PATH: path.join(home, 'bin') + ':' + process.env.PATH};
  const run = (action, serve = {}, extra = {}) => spawnSync(process.execPath, [path.join(root, 'server/lib/tailscale.mjs'), action], {encoding: 'utf8', env: {...env, TEST_SERVE: JSON.stringify(serve), ...extra}});
  const serve = {TCP: {'443': {HTTPS: true}}, Web: {'test.tail123.ts.net:443': {Handlers: {'/': {Proxy: 'unix:' + path.join(home, '.local/state/omarchy-jarvis/serve.sock')}}}}};
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
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'invoked'))), ['serve', '--bg', '--https=443', 'unix:' + path.join(home, '.local/state/omarchy-jarvis/serve.sock')]);
  fs.unlinkSync(path.join(home, 'invoked'));
  const legacy = structuredClone(serve);
  legacy.Web['test.tail123.ts.net:443'].Handlers['/'].Proxy = 'https+insecure://localhost:4317';
  assert.equal(JSON.parse(run('status', legacy).stdout).state, 'off');
  assert.equal(run('enable', legacy).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'cleanup'), 'utf8').trim()), ['serve', '--https=443', '--set-path=/', 'off']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'invoked'))), ['serve', '--bg', '--https=443', 'unix:' + path.join(home, '.local/state/omarchy-jarvis/serve.sock')]);
  fs.unlinkSync(path.join(home, 'removed'));
  fs.unlinkSync(path.join(home, 'cleanup'));
  assert.equal(run('disable', conflict).status, 0);
  assert.equal(fs.existsSync(path.join(home, 'cleanup')), false);
  assert.equal(run('disable', serve).status, 0);
  assert.ok(fs.existsSync(path.join(home, 'cleanup')));
  fs.unlinkSync(path.join(home, 'removed'));
  fs.unlinkSync(path.join(home, 'invoked'));
  assert.equal(run('enable', {}, {TEST_DENY:'yes'}).status, 0);
  let auth = fs.readFileSync(path.join(home, 'auth'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(auth.map(item => item.helper), ['sudo', 'pkexec']);
  assert.deepEqual(auth[1].args, ['/usr/bin/tailscale', 'serve', '--bg', '--https=443', 'unix:' + path.join(home, '.local/state/omarchy-jarvis/serve.sock')]);
  fs.unlinkSync(path.join(home, 'auth'));
  assert.equal(run('enable', {}, {TEST_DENY:'yes',TEST_SUDO:'ok'}).status, 0);
  auth = fs.readFileSync(path.join(home, 'auth'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(auth.map(item => item.helper), ['sudo']);
  fs.unlinkSync(path.join(home, 'auth'));
  const cancelled = run('enable', {}, {TEST_DENY:'yes',TEST_CANCEL:'yes'});
  assert.equal(cancelled.status, 1);
  assert.match(cancelled.stderr, /authorization was cancelled/);
  fs.unlinkSync(path.join(home, 'auth'));
  assert.equal(run('enable', {}, {TEST_DENY:'other'}).status, 1);
  assert.equal(fs.existsSync(path.join(home, 'auth')), false, 'unrelated failures must not trigger elevation');
  assert.equal(run('disable', serve, {TEST_DENY:'yes'}).status, 1);
  auth = fs.readFileSync(path.join(home, 'auth'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(auth.map(item => item.helper), ['sudo'], 'background cleanup must not open authorization dialogs');
  console.log('PASS: stable URL, disabled Serve, idempotent enable, conflicting service protection, public Funnel rejection, persistent private Serve arguments.');
} finally { fs.rmSync(home, {recursive: true, force: true}); }
