import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tunnel-'));
const originalHome = process.env.HOME, originalPath = process.env.PATH;
let server, stopTunnel;
try {
  // Locate the optional real parser before installing the fake transport.
  process.env.HOME = home;
  const {findBin} = await import('../server/lib/stt.mjs');
  const realCloudflared = findBin('cloudflared');
  process.env.PATH = path.join(home, 'bin') + ':' + originalPath;
  const {ensureDirs, paths} = await import('../server/lib/config.mjs');
  const {listenServeSocket} = await import('../server/lib/serve-socket.mjs');
  const tunnel = await import('../server/lib/tunnel.mjs');
  stopTunnel = tunnel.stopTunnel;
  ensureDirs();
  fs.mkdirSync(path.join(home, 'bin'));
  server = await listenServeSocket((req, res) => {
    assert.equal(req.url, '/?token=fixture-link');
    assert.equal(req.headers['x-jarvis-token'], 'fixture-header');
    res.end('authenticated socket fixture');
  });
  fs.writeFileSync(path.join(home, 'bin/cloudflared'), `#!${process.execPath}
const fs = require('node:fs'), http = require('node:http');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.HOME + '/args.json', JSON.stringify(args));
const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
const service = config.ingress[0].service;
if (!service.startsWith('unix:')) process.exit(2);
http.get({socketPath: service.slice(5), path: '/?token=fixture-link',
  headers: {'x-jarvis-token': 'fixture-header'}}, res => {
  let body = ''; res.on('data', chunk => body += chunk);
  res.on('end', () => {
    fs.writeFileSync(process.env.HOME + '/response', body);
    console.log('https://fixture.trycloudflare.com');
  });
}).on('error', () => process.exit(3));
setInterval(() => {}, 1000);
`, {mode: 0o755});
  tunnel.startTunnel({port: 4317, tunnel: {enabled: true}});
  for (let i = 0; i < 100 && tunnel.tunnelStatus().state !== 'up'; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(tunnel.tunnelStatus().state, 'up');
  assert.equal(fs.readFileSync(path.join(home, 'response'), 'utf8'), 'authenticated socket fixture');
  const args = JSON.parse(fs.readFileSync(path.join(home, 'args.json'), 'utf8'));
  assert.ok(args.includes('--hello-world'), 'select Quick Tunnel mode without a TCP fallback');
  assert.ok(!args.includes('--url'));
  const configFile = args[args.indexOf('--config') + 1];
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.stateDir).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')),
    {ingress: [{service: `unix:${paths.serveSocket}`}]});
  if (realCloudflared) {
    for (const command of [['validate'], ['rule', 'https://fixture.trycloudflare.com/?token=fixture-link']]) {
      const result = spawnSync(realCloudflared, ['tunnel', '--config', configFile, 'ingress', ...command], {encoding: 'utf8'});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      if (command[0] === 'rule') assert.ok((result.stdout + result.stderr).includes(`unix:${paths.serveSocket}`));
    }
  } else console.log('SKIP: optional installed cloudflared ingress parser');
  console.log('PASS: Cloudflare private ingress, credential forwarding over Unix socket and private permissions.');
} finally {
  stopTunnel?.();
  if (server) await new Promise(resolve => server.close(resolve));
  process.env.HOME = originalHome;
  process.env.PATH = originalPath;
  fs.rmSync(home, {recursive: true, force: true});
}
