import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(import.meta.dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-settings-'));
const configFile = path.join(home, '.config/omarchy-jarvis/config.json');
const state = path.join(home, '.local/state/omarchy-jarvis');
const whisperDir = path.join(home, '.local/share/omarchy-jarvis/models/whisper');
const piperDir = path.join(home, '.local/share/omarchy-jarvis/models/piper');
for (const dir of [path.dirname(configFile), whisperDir, piperDir, path.join(home, 'bin')]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(configFile, JSON.stringify({ host: '127.0.0.1', port: 0, workDir: home, agent: 'codex', tunnel: { enabled: false }, privateFixture: 'NOT_FOR_API', stt: { engine: 'cli', extra: 'preserve' }, tts: { extra: 'preserve' } }));
fs.writeFileSync(path.join(whisperDir, 'ggml-small.bin'), 'fixture');
fs.writeFileSync(path.join(piperDir, 'en_US-fixture-medium.onnx'), 'fixture');
fs.writeFileSync(path.join(piperDir, 'en_US-fixture-medium.onnx.json'), '{}');
fs.writeFileSync(path.join(piperDir, 'incomplete.onnx'), 'fixture');
fs.writeFileSync(path.join(home, 'bin/tailscale'), '#!/bin/sh\nprintf \'{}\\n\'\n', { mode: 0o755 });
fs.writeFileSync(path.join(home, 'bin/ffmpeg'), `#!/usr/bin/env node
process.stdin.resume(); process.stdin.on('end', () => require('fs').writeFileSync(process.argv.at(-1), Buffer.alloc(100)));
`, { mode: 0o755 });
fs.writeFileSync(path.join(home, 'bin/whisper-cli'), `#!/usr/bin/env node
require('fs').writeFileSync(process.env.HOME + '/whisper-args', JSON.stringify(process.argv.slice(2)));
console.log('Fixture transcription');
`, { mode: 0o755 });
fs.writeFileSync(path.join(home, 'bin/piper'), `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('--help')) { console.log('-f --length-scale'); process.exit(0); }
fs.writeFileSync(process.env.HOME + '/piper-args', JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.HOME + '/piper-active', 'yes');
process.stdin.resume(); process.stdin.on('end', () => {
 const timer = setInterval(() => {
  if (fs.existsSync(process.env.HOME + '/hold-piper')) return;
  clearInterval(timer); fs.writeFileSync(process.argv[process.argv.indexOf('-f') + 1], Buffer.alloc(100));
 }, 10);
});
`, { mode: 0o755 });
fs.writeFileSync(path.join(home, 'bin/codex'), `#!/usr/bin/env node
const fs = require('fs');
process.stdin.resume(); process.stdin.on('end', () => {
 fs.writeFileSync(process.env.HOME + '/agent-active', 'yes');
 const timer = setInterval(() => {
  if (fs.existsSync(process.env.HOME + '/hold-agent')) return;
  clearInterval(timer); console.log(JSON.stringify({type:'item.completed', item:{type:'agent_message', text:'Fixture reply'}}));
 }, 10);
});
`, { mode: 0o755 });
let server;
let logs = '';
let port;
async function start() {
  logs = '';
  server = spawn(process.execPath, [path.join(root, 'server/jarvis-server.mjs'), '--http'], { env: { ...process.env, HOME: home, PATH: path.join(home, 'bin') + ':' + process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => logs += b);
  server.stderr.on('data', b => logs += b);
  for (let i = 0; i < 100 && !logs.includes('listening on'); i++) await new Promise(r => setTimeout(r, 50));
  assert.match(logs, /listening on/);
}
function api(body, auth = true, endpoint = '/api/voice-settings', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: endpoint, method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { 'x-jarvis-token': fs.readFileSync(path.join(state, 'token'), 'utf8').trim() } : {}), 'content-type': 'application/json', ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8'); res.on('data', b => text += b);
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers, json: () => JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
async function stop() { if (server && server.exitCode === null) { const done = once(server, 'exit'); server.kill('SIGTERM'); await done; } }
try {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const initial = JSON.parse(fs.readFileSync(configFile)); initial.port = port; fs.writeFileSync(configFile, JSON.stringify(initial));
  await start();
  assert.equal((await api(undefined, false)).status, 401);
  assert.equal((await api({}, false)).status, 401);
  // Camera routes share the bridge authentication boundary and never echo URLs.
  for(const endpoint of ['/api/ip-camera','/api/ip-camera/audio','/api/ip-camera/video'])assert.equal((await api(undefined,false,endpoint)).status,401);
  assert.equal((await api({enabled:true},false,'/api/ip-camera')).status,401);
  assert.equal((await api({url:'file:///etc/passwd'},true,'/api/ip-camera')).status,400);
  assert.equal((await api({url:'rtsp://user:camera-fixture@192.168.1.40/live',enabled:true,source:'camera'},true,'/api/ip-camera')).status,200);
  const cameraView=await api(undefined,true,'/api/ip-camera');assert.equal(cameraView.json().source,'camera');assert.equal(cameraView.text.includes('camera-fixture'),false);
  assert.equal((await api({source:'device'},true,'/api/ip-camera',{'sec-fetch-site':'cross-site'})).status,400);
  assert.equal((await api({forget:true},true,'/api/ip-camera')).status,200);
  assert.equal((await api(undefined,true,'/api/ip-camera/audio')).status,409);
  const response = await api();
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const view = response.json();
  assert.deepEqual(Object.keys(view).sort(), ['models', 'settings', 'status']);
  assert.deepEqual(view.settings, { stt: { engine: 'cli', model: 'base.en', modelPath: '', language: 'en', serverPort: 8178 }, tts: { voice: 'en_US-ljspeech-medium', modelPath: '', speed: 1 }, maxRecordingSec: 120 });
  assert.ok(view.models.whisper.some(m => m.name === 'small' && m.path === path.join(whisperDir, 'ggml-small.bin')));
  assert.ok(view.models.piper.some(m => m.name === 'en_US-fixture-medium' && m.path === path.join(piperDir, 'en_US-fixture-medium.onnx')));
  assert.ok(!view.models.piper.some(m => m.name === 'incomplete'));
  assert.equal(typeof view.status.stt.ready, 'boolean');
  assert.equal(typeof view.status.tts.ready, 'boolean');
  assert.ok(!response.text.includes('NOT_FOR_API'));
  const selected = { stt: { engine: 'auto', model: 'small', modelPath: '~/'+path.relative(home, path.join(whisperDir, 'ggml-small.bin')), language: 'sk', serverPort: 8190 }, tts: { voice: 'en_US-fixture-medium', modelPath: path.join(piperDir, 'en_US-fixture-medium.onnx'), speed: 1.25 }, maxRecordingSec: 75 };
  const saved = await api({ settings: selected });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json().settings, selected);
  assert.deepEqual((await api()).json().settings, selected);
  const persisted = JSON.parse(fs.readFileSync(configFile));
  assert.equal(persisted.privateFixture, 'NOT_FOR_API');
  assert.equal(persisted.stt.extra, 'preserve');
  assert.equal(persisted.tts.extra, 'preserve');
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  await stop(); await start();
  assert.deepEqual((await api()).json().settings, selected);
  const invalid = [null, [], {}, { settings: null }, { settings: [] }, { settings: {}, extra: true }, { settings: { token: 'NOT_FOR_API' } }, { stt: [] }, { stt: null }, { stt: { extra: 'no' } }, { stt: { engine: 'remote' } }, { stt: { engine: 1 } }, { stt: { model: '../escape' } }, { stt: { model: '' } }, { stt: { model: 'a'.repeat(101) } }, { stt: { modelPath: 'relative.bin' } }, { stt: { modelPath: home } }, { stt: { modelPath: home + '/missing.bin' } }, { stt: { modelPath: '/bad\npath.bin' } }, { stt: { language: '--help' } }, { stt: { language: 'zz' } }, { stt: { serverPort: 0 } }, { stt: { serverPort: 65536 } }, { stt: { serverPort: 1.5 } }, { stt: { serverPort: '8178' } }, { tts: { voice: '../escape' } }, { tts: { voice: '-option' } }, { tts: { modelPath: path.join(piperDir, 'incomplete.onnx') } }, { tts: { speed: 0.49 } }, { tts: { speed: 2.01 } }, { tts: { speed: '1' } }, { maxRecordingSec: 0 }, { maxRecordingSec: 601 }, { maxRecordingSec: 1.5 }, { maxRecordingSec: '120' }];
  const beforeInvalid = fs.readFileSync(configFile, 'utf8');
  for (const payload of invalid) {
    const rejected = await api(payload);
    assert.equal(rejected.status, 400, JSON.stringify(payload) + ': ' + rejected.text);
    assert.deepEqual((await api()).json().settings, selected);
    assert.equal(fs.readFileSync(configFile, 'utf8'), beforeInvalid);
    assert.ok(!rejected.text.includes('NOT_FOR_API'));
  }
  assert.equal((await api('{broken')).status, 400);
  assert.equal((await api({ maxRecordingSec: 60 }, true, '/api/voice-settings', { 'content-type': 'text/plain' })).status, 400);
  assert.equal((await api({ maxRecordingSec: 60 }, true, '/api/voice-settings', { 'sec-fetch-site': 'cross-site' })).status, 400);
  // Partial direct updates are also accepted; blank model paths select conventional local paths.
  const cleared = await api({ stt: { engine: 'server', modelPath: '', language: 'auto', serverPort: 65535 }, tts: { modelPath: '', speed: 0.5 }, maxRecordingSec: 1 });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.json().settings.stt.modelPath, '');
  assert.notEqual(cleared.json().status.stt.engine, 'whisper-server', 'legacy engine selection must never enable an unauthenticated server');
  assert.equal(cleared.json().settings.tts.voice, selected.tts.voice);
  assert.equal((await api({ tts: { speed: 2 }, stt: { serverPort: 1 }, maxRecordingSec: 600 })).status, 200);
  assert.equal((await api({ settings: selected })).status, 200);
  const stt = await api('x'.repeat(1600), true, '/api/stt', { 'content-type': 'audio/wav' });
  assert.equal(stt.status, 200, stt.text);
  assert.equal(stt.json().text, 'Fixture transcription');
  const whisperArgs = JSON.parse(fs.readFileSync(path.join(home, 'whisper-args')));
  assert.equal(whisperArgs[whisperArgs.indexOf('-m') + 1], path.join(whisperDir, 'ggml-small.bin'));
  assert.equal(whisperArgs[whisperArgs.indexOf('-l') + 1], 'sk');
  fs.writeFileSync(path.join(home, 'hold-piper'), 'yes');
  const speaking = api({ text: 'Fixture speech' }, true, '/api/tts');
  for (let i = 0; i < 100 && !fs.existsSync(path.join(home, 'piper-active')); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(fs.existsSync(path.join(home, 'piper-active')), 'Piper fixture started');
  try { assert.equal((await api({ tts: { speed: 1.5 } })).status, 409, 'active synthesis blocks changes'); }
  finally { fs.rmSync(path.join(home, 'hold-piper'), { force: true }); await speaking; }
  const piperArgs = JSON.parse(fs.readFileSync(path.join(home, 'piper-args')));
  assert.equal(piperArgs[piperArgs.indexOf('-m') + 1], selected.tts.modelPath);
  assert.equal(piperArgs[piperArgs.indexOf('--length-scale') + 1], '0.80');
  assert.equal((await api({ tts: { speed: 1.5 } })).status, 200, 'synthesis completion releases lock');
  const uploading = http.request({ hostname: '127.0.0.1', port, path: '/api/stt', method: 'POST', headers: { 'x-jarvis-token': fs.readFileSync(path.join(state, 'token'), 'utf8').trim(), 'content-type': 'audio/wav' } });
  uploading.on('error', () => {}); uploading.write('x'.repeat(1500));
  await new Promise(r => setTimeout(r, 100));
  try { assert.equal((await api({ maxRecordingSec: 90 })).status, 409, 'in-flight recording upload blocks changes'); }
  finally { uploading.destroy(); }
  await new Promise(r => setTimeout(r, 100));
  assert.equal((await api({ maxRecordingSec: 90 })).status, 200, 'cancelled recording releases lock');
  assert.equal((await api()).json().settings.maxRecordingSec, 90);
  const beforeFailedWrite = (await api()).json().settings;
  fs.renameSync(configFile, configFile + '.save'); fs.mkdirSync(configFile);
  try {
    const failedWrite = await api({ maxRecordingSec: 91 });
    assert.equal(failedWrite.status, 409, failedWrite.text);
    assert.ok(!failedWrite.text.includes(home));
    assert.deepEqual((await api()).json().settings, beforeFailedWrite);
  } finally { fs.rmdirSync(configFile); fs.renameSync(configFile + '.save', configFile); }
  const profile = (await api(undefined, true, '/api/personality')).json();
  assert.equal((await api({ ...profile, assistantName: 'Fixture', userName: 'Tester', personality: 'Reply briefly.' }, true, '/api/personality')).status, 200);
  fs.writeFileSync(path.join(home, 'hold-agent'), 'yes');
  const chatting = api({ text: 'Fixture request' }, true, '/api/chat');
  for (let i = 0; i < 100 && !fs.existsSync(path.join(home, 'agent-active')); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(fs.existsSync(path.join(home, 'agent-active')), 'agent fixture started');
  try { assert.equal((await api({ maxRecordingSec: 91 })).status, 409, 'active chat blocks voice settings changes'); }
  finally { fs.rmSync(path.join(home, 'hold-agent'), { force: true }); await chatting; }
  assert.equal((await api({ maxRecordingSec: 91 })).status, 200, 'chat completion releases lock');
  assert.ok(!logs.includes(fs.readFileSync(path.join(state, 'token'), 'utf8').trim()));
  assert.ok(!logs.includes('Fixture transcription'));
  console.log('PASS: authenticated voice settings GET/POST, validation, discovery, persistence/restart, runtime model/language/speed application and speech concurrency.');
} finally {
  await stop();
  fs.rmSync(home, { recursive: true, force: true });
}
