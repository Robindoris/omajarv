#!/usr/bin/env node
// Private, line-delimited JSON bridge for the native QML panel.
// Credentials stay in this process; requests only go to loopback with pinned TLS.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {StringDecoder} from 'node:string_decoder';
import { boundedExec, stopChildren, managedSpawn, killGroup } from './lib/bounded-process.mjs';
import { readClipboard } from './lib/clipboard.mjs';
import { MAX_FILE, MAX_FILES } from './lib/attachments.mjs';
import { once } from 'node:events';
import { loadConfig, paths, readToken } from './lib/config.mjs';
const config = loadConfig();
const token = readToken();
const emit = (event, data = {}) => {
  const line = JSON.stringify({event, ...data}) + '\n';
  if (Buffer.byteLength(line) > 2*1024*1024 || process.stdout.writableLength + Buffer.byteLength(line) > 2*1024*1024) process.exit(1);
  process.stdout.write(line);
};
process.stdout.on('error', () => process.exit(1));
let operation = false, recording = null, playback = null, recordTimer = null, generation = 0;
let readAloud = false;
let recordStarting = false;
let modelLookup = null;
let profileRevision;
let pendingAttachments = [];
const exec = boundedExec;
function emitAttachments() { emit('attachments', {files:pendingAttachments}); }
async function uploadAttachment(name, bytes) {
  if (pendingAttachments.length >= MAX_FILES) throw new Error('Attach at most four files.');
  if (!bytes.length || bytes.length > MAX_FILE) throw new Error('Files must be between 1 byte and 10 MB.');
  const file = JSON.parse(await request('attachments?name=' + encodeURIComponent(name), bytes, 'application/octet-stream'));
  pendingAttachments.push(file); emitAttachments();
}
async function chooseAttachments() {
  let result;
  try { result = await exec('zenity', ['--file-selection', '--multiple', '--separator=\n', '--title=Attach files to Omajarv'], {timeout:120000, maxBuffer:16384}); }
  catch (error) { if (error.code === 1) return; throw new Error('File picker unavailable. Install zenity or try again.'); }
  const files = result.stdout.trimEnd().split('\n').filter(Boolean);
  if (files.length + pendingAttachments.length > MAX_FILES) throw new Error('Attach at most four files.');
  for (const file of files) {
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || !stat.size || stat.size > MAX_FILE) throw new Error('Invalid size or file type.');
      // Read a bounded snapshot even if a file grows while being selected.
      const bytes = Buffer.alloc(MAX_FILE + 1);
      let size = 0, count;
      while (size < bytes.length && (count = fs.readSync(fd, bytes, size, bytes.length - size, null))) size += count;
      await uploadAttachment(path.basename(file), bytes.subarray(0,size));
    } catch { throw new Error('Could not attach file. Choose a regular file of at most 10 MB (no symbolic links).'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}
async function pasteClipboard(options) {
  try {
    const data = await readClipboard(exec, options);
    if (data.bytes) return uploadAttachment(data.name, data.bytes);
    emit('clipboardText', {text:data.text.slice(0,Math.max(config.maxTextChars, 8000))});
  } catch { throw new Error('Cannot paste clipboard: transfer failed, exceeded its size limit or timed out.'); }
}
const requests = new Set();
const temp = fs.mkdtempSync(path.join(paths.tmp, 'desktop-'));
function request(endpoint, body, contentType = 'application/json', onEvent) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', servername: 'localhost', port: config.port,
      path: '/api/' + endpoint, method: body === undefined ? 'GET' : 'POST',
      ca: fs.readFileSync(paths.certFile), headers: { 'x-jarvis-token': token, 'content-type': contentType } }, res => {
      if (onEvent && res.statusCode === 200) {
        let buffer = '', total = 0, events = 0;
        res.setEncoding('utf8');
        res.on('data', chunk => {
          total += Buffer.byteLength(chunk);
          if (total > 4*1024*1024 || Buffer.byteLength(buffer) + Buffer.byteLength(chunk) > 512*1024) return req.destroy(new Error('Bridge stream size limit exceeded'));
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            if (++events > 8192) return req.destroy(new Error('Bridge event limit exceeded'));
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const name = block.match(/^event: (.+)$/m)?.[1];
            const data = block.match(/^data: (.+)$/m)?.[1];
            if (name && data) { try { onEvent(name, JSON.parse(data)); } catch (error) { reject(error); req.destroy(); return; } }
          }
        });
        res.on('end', () => resolve());
      } else {
        const chunks = [];
        let bytes = 0;
        const limit = endpoint === 'tts' ? 16*1024*1024 : 2*1024*1024;
        res.on('data', chunk => { bytes += chunk.length; if (bytes > limit) req.destroy(new Error('Bridge response size limit exceeded')); else chunks.push(chunk); });
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
    const deadline = setTimeout(() => req.destroy(new Error('Bridge deadline exceeded')), onEvent ? 260000 : 120000);
    req.on('close', () => { clearTimeout(deadline); requests.delete(req); });
    req.setTimeout(onEvent ? 260000 : 120000, () => req.destroy(new Error('Bridge timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
async function snapshot() {
  const data = JSON.parse(await request('history'));
  profileRevision = data.profile?.revision;
  emit('history', data);
}
async function speak(text, run) {
  if (!readAloud || !text || run !== generation) return;
  emit('state', { state: 'Preparing voice' });
  const wav = await request('tts', JSON.stringify({ text }));
  if (run !== generation) return;
  const file = path.join(temp, 'reply.wav'); fs.writeFileSync(file, wav, { mode: 0o600 });
  emit('state', { state: 'Speaking' });
  playback = managedSpawn('pw-play', [file], { stdio: 'ignore', timeout:120000 });
  const child = playback;
  const [code] = await once(child, 'exit');
  if (playback === child) playback = null;
  if (code && run === generation) throw new Error('Audio playback failed');
}
async function chat(text, run) {
  text = String(text || '').trim(); if (!text && !pendingAttachments.length) return;
  const ids = pendingAttachments.map(f => f.id);
  emit('state', { state: 'Thinking' });
  let reply = '', failure = '';
  await request('chat', JSON.stringify({ text, profileRevision, attachments:ids }), 'application/json', (event, data) => {
    if (event === 'meta') { pendingAttachments = pendingAttachments.filter(f => !ids.includes(f.id)); emitAttachments(); }
    emit(event, data);
    if (event === 'token') { reply += data.text || ''; if (reply.length > 256*1024) throw new Error('Reply size limit exceeded'); }
    if (event === 'done') { reply = data.text || reply; if (reply.length > 256*1024) throw new Error('Reply size limit exceeded'); }
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
    const exited = once(child, 'exit');
    const force = setTimeout(() => killGroup(child), 1000);
    try { child.kill('SIGINT'); await exited; } finally { clearTimeout(force); }
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
  if (data.action === 'attachFiles') return perform(async () => { emit('state', {state:'Choosing files'}); await chooseAttachments(); });
  if (data.action === 'pasteClipboard') return perform(async () => { await pasteClipboard({imageOnly:data.imageOnly === true, textOnly:data.textOnly === true, primary:data.primary === true}); });
  if (data.action === 'removeAttachment') return perform(async () => {
    if (!pendingAttachments.some(f => f.id === data.id)) return;
    await request('attachments/remove', JSON.stringify({id:data.id}));
    pendingAttachments = pendingAttachments.filter(f => f.id !== data.id); emitAttachments();
  });
  if (data.action === 'personality') return emit('personality', {profile:JSON.parse(await request('personality'))});
  if (data.action === 'savePersonality') {
    if (operation || recording) throw new Error('Stop the current request before changing personality.');
    const profile = JSON.parse(await request('personality', JSON.stringify(data.profile)));
    emit('personality', {profile, saved:true});
    return snapshot();
  }
  if (data.action === 'models') {
    // Metadata must not take the chat/recording lock or change activity state.
    if (!modelLookup) modelLookup = request('models')
      .then(listing => emit('models', JSON.parse(listing)))
      .finally(() => { modelLookup = null; });
    return modelLookup;
  }
  if (data.action === 'setModel') {
    if (operation || recording) throw new Error('Stop the current request before changing the model.');
    return perform(async () => {
      const listing = JSON.parse(await request('agent/model', JSON.stringify({model: String(data.model || '')})));
      emit('models', listing);
    });
  }
  if (data.action === 'history') return snapshot();
  if (data.action === 'readAloud') { readAloud = data.enabled === true; if (!readAloud) killGroup(playback); return; }
  if (data.action === 'stop') {
    ++generation; operation = false; clearTimeout(recordTimer);
    stopChildren();
    for (const req of requests) req.destroy(new Error('Stopped'));
    killGroup(recording); recording = null;
    killGroup(playback); playback = null;
    await request('chat/stop', '{}');
    emit('state', { state: 'Ready' }); return;
  }
  if (data.action === 'reset') return perform(async () => { await request('session/reset', '{}'); pendingAttachments = []; emitAttachments(); await snapshot(); });
  if (data.action === 'send') return perform(run => chat(data.text, run));
  if (data.action === 'record') {
    if (recording) return finishRecording();
    if (operation || recordStarting) return;
    recordStarting = true;
    const startGeneration = generation;
    try {
      ++generation;
      const child = managedSpawn('prlimit', ['--fsize=16777216:16777216', '--', 'pw-record', '--rate', '16000', '--channels', '1', '--format', 's16', path.join(temp, 'input.wav')], { stdio: 'ignore', timeout:(config.maxRecordingSec + 5)*1000 });
      recording = child;
      child.on('error', error => { recording = null; emit('error', { error: error.message }); emit('state', { state: 'Ready' }); });
      child.on('exit', code => { if (recording === child) { recording = null; clearTimeout(recordTimer); emit('error', { error: 'Microphone recording failed (' + code + ')' }); emit('state', { state: 'Ready' }); } });
      emit('state', { state: 'Listening' });
      recordTimer = setTimeout(() => finishRecording(), config.maxRecordingSec * 1000);
    } finally { recordStarting = false; }
  }
}
// Bound unterminated input and in-flight dispatches; never queue arbitrary commands.
const decoder = new StringDecoder('utf8');
let inputBuffer = '', inFlight = 0;
process.stdin.on('data', chunk => {
  inputBuffer += decoder.write(chunk);
  let end;
  while ((end = inputBuffer.indexOf('\n')) >= 0) {
    const line = inputBuffer.slice(0, end); inputBuffer = inputBuffer.slice(end + 1);
    if (Buffer.byteLength(line) > 64*1024 || inFlight >= 8) return process.exit(1);
    ++inFlight;
    Promise.resolve().then(() => dispatch(JSON.parse(line)))
      .catch(error => emit('error', {error:error.message}))
      .finally(() => { --inFlight; });
  }
  if (Buffer.byteLength(inputBuffer) > 64*1024) process.exit(1);
});
process.stdin.on('end', () => process.exit());
process.on('exit', () => { stopChildren(); fs.rmSync(temp, { recursive: true, force: true }); });
process.on('SIGTERM', () => process.exit());
process.on('SIGINT', () => process.exit());
emit('ready');
