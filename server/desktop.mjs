#!/usr/bin/env node
// Private, line-delimited JSON bridge for the native QML panel.
// Credentials stay in this process; requests only go to loopback with pinned TLS.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadConfig, paths, readToken } from './lib/config.mjs';
const config = loadConfig();
const token = readToken();
const emit = (event, data = {}) => process.stdout.write(JSON.stringify({ event, ...data }) + '\n');
let operation = false, recording = null, playback = null, recordTimer = null, generation = 0;
let readAloud = false;
const requests = new Set();
const temp = fs.mkdtempSync(path.join(paths.tmp, 'desktop-'));
function request(endpoint, body, contentType = 'application/json', onEvent) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', servername: 'localhost', port: config.port,
      path: '/api/' + endpoint, method: body === undefined ? 'GET' : 'POST',
      ca: fs.readFileSync(paths.certFile), headers: { 'x-jarvis-token': token, 'content-type': contentType } }, res => {
      if (onEvent && res.statusCode === 200) {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const name = block.match(/^event: (.+)$/m)?.[1];
            const data = block.match(/^data: (.+)$/m)?.[1];
            if (name && data) { try { onEvent(name, JSON.parse(data)); } catch (error) { reject(error); req.destroy(); } }
          }
        });
        res.on('end', () => resolve());
      } else {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            let message = 'Bridge returned ' + res.statusCode;
            try { message = JSON.parse(data).error || message; } catch {}
            reject(new Error(message));
          } else resolve(data);
        });
      }
      res.on('error', reject);
    });
    requests.add(req);
    req.on('close', () => requests.delete(req));
    req.setTimeout(onEvent ? 260000 : 120000, () => req.destroy(new Error('Bridge timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
async function snapshot() {
  const data = JSON.parse(await request('history'));
  emit('history', data);
}
async function speak(text, run) {
  if (!readAloud || !text || run !== generation) return;
  emit('state', { state: 'Preparing voice' });
  const wav = await request('tts', JSON.stringify({ text }));
  if (run !== generation) return;
  const file = path.join(temp, 'reply.wav'); fs.writeFileSync(file, wav, { mode: 0o600 });
  emit('state', { state: 'Speaking' });
  playback = spawn('pw-play', [file], { stdio: 'ignore' });
  const child = playback;
  const [code] = await once(child, 'exit');
  if (playback === child) playback = null;
  if (code && run === generation) throw new Error('Audio playback failed');
}
async function chat(text, run) {
  text = String(text || '').trim(); if (!text) return;
  emit('state', { state: 'Thinking' });
  let reply = '', failure = '';
  await request('chat', JSON.stringify({ text }), 'application/json', (event, data) => {
    emit(event, data);
    if (event === 'token') reply += data.text || '';
    if (event === 'done') reply = data.text || reply;
    if (event === 'error') failure = data.error;
  });
  if (failure) throw new Error(failure);
  if (run === generation) { await snapshot(); await speak(reply, run); }
}
async function perform(fn) {
  if (operation || recording) return;
  operation = true; const run = ++generation;
  try { await fn(run); } catch (error) { if (run === generation) emit('error', { error: error.message }); }
  finally { if (run === generation) { operation = false; emit('state', { state: 'Ready' }); } }
}
async function finishRecording() {
  if (!recording) return;
  clearTimeout(recordTimer);
  const child = recording; recording = null;
  operation = true; const run = generation;
  try {
    const exited = once(child, 'exit'); child.kill('SIGINT'); await exited;
    emit('state', { state: 'Transcribing' });
    const data = JSON.parse(await request('stt', fs.readFileSync(path.join(temp, 'input.wav')), 'audio/wav'));
    if (run !== generation) return;
    if (!data.text) throw new Error(data.error || 'No speech detected');
    emit('heard', { text: data.text });
    await chat(data.text, run);
  } catch (error) { if (run === generation) emit('error', { error: error.message }); }
  finally { if (run === generation) { operation = false; emit('state', { state: 'Ready' }); } }
}
async function dispatch(data) {
  if (data.action === 'history') return snapshot();
  if (data.action === 'readAloud') { readAloud = data.enabled === true; if (!readAloud) playback?.kill('SIGTERM'); return; }
  if (data.action === 'stop') {
    ++generation; operation = false; clearTimeout(recordTimer);
    for (const req of requests) req.destroy(new Error('Stopped'));
    recording?.kill('SIGINT'); recording = null;
    playback?.kill('SIGTERM'); playback = null;
    await request('chat/stop', '{}');
    emit('state', { state: 'Ready' }); return;
  }
  if (data.action === 'reset') return perform(async () => { await request('session/reset', '{}'); await snapshot(); });
  if (data.action === 'send') return perform(run => chat(data.text, run));
  if (data.action === 'record') {
    if (recording) return finishRecording();
    if (operation) return;
    ++generation;
    const child = spawn('pw-record', ['--rate', '16000', '--channels', '1', '--format', 's16', path.join(temp, 'input.wav')], { stdio: 'ignore' });
    recording = child;
    child.on('error', error => { recording = null; emit('error', { error: error.message }); emit('state', { state: 'Ready' }); });
    child.on('exit', code => { if (recording === child) { recording = null; clearTimeout(recordTimer); emit('error', { error: 'Microphone recording failed (' + code + ')' }); emit('state', { state: 'Ready' }); } });
    emit('state', { state: 'Listening' });
    recordTimer = setTimeout(() => finishRecording(), config.maxRecordingSec * 1000);
  }
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  try { Promise.resolve(dispatch(JSON.parse(line))).catch(error => emit('error', { error: error.message })); }
  catch (error) { emit('error', { error: error.message }); }
}).on('close', () => process.exit());
process.on('exit', () => { recording?.kill('SIGINT'); playback?.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true }); });
process.on('SIGTERM', () => process.exit());
emit('ready');
