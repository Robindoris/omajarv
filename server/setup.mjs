#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { ensureDirs, loadConfig, paths } from './lib/config.mjs';
import { discoverModels, whisperPath, piperPath, usable } from './lib/models.mjs';
import { findBin } from './lib/stt.mjs';

const whisperRev = '5359861c739e955e79d9a303bcbc70fb988958b1';
const piperRev = '5041a7a49ae5b3a0f30e6837769eb03fdbb231bd';
export const downloads = {
  whisper: [{ file: 'ggml-base.en.bin', bytes: 147964211, sha: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${whisperRev}/ggml-base.en.bin` }],
  piper: [
    {file:'en_US-ljspeech-medium.onnx',bytes:63531379,sha:'6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22'},
    {file:'en_US-ljspeech-medium.onnx.json',bytes:4972,sha:'141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860'},
    {file:'MODEL_CARD',bytes:517,sha:'fbee1529c89d36b3fe76d7e9f3f832dce17f44900a52d76a9bda735654766b4d'},
  ].map(item => ({...item, url:`https://huggingface.co/rhasspy/piper-voices/resolve/${piperRev}/en/en_US/ljspeech/medium/${item.file}`})),
};
export async function downloadVerified(item, destination, { fetcher = fetch } = {}) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (usable(destination)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
    if (hash === item.sha) return;
  }
  const temporary = destination + '.part';
  const response = await fetcher(item.url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const handle = fs.openSync(temporary, 'w', 0o600);
  const hash = crypto.createHash('sha256');
  let bytes = 0, lastProgress = -1;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > item.bytes) throw new Error('Download exceeded expected size');
      fs.writeSync(handle, chunk); hash.update(chunk);
      const progress = Math.floor(bytes / item.bytes * 10);
      if (progress !== lastProgress) { process.stdout.write(`\r  ${item.file}: ${Math.floor(bytes / item.bytes * 100)}%`); lastProgress = progress; }
    }
    if (bytes !== item.bytes || hash.digest('hex') !== item.sha) throw new Error('Model checksum or size mismatch');
    fs.closeSync(handle); fs.renameSync(temporary, destination); console.log(' · verified');
  } catch (error) { try { fs.closeSync(handle); } catch {} fs.rmSync(temporary, { force: true }); throw error; }
}
export function setupStatus(config = loadConfig()) {
  const found = discoverModels(config);
  const sttReady = usable(whisperPath(config)) && !!findBin('whisper-server', 'whisper-cli', 'whisper-cpp');
  const ttsReady = usable(piperPath(config)) && usable(piperPath(config) + '.json') && !!findBin('piper', 'piper-tts');
  return { configured: fs.existsSync(paths.configFile), sttReady, ttsReady, voiceReady: sttReady && ttsReady,
    discoveredWhisper: found.whisper.length, discoveredPiper: found.piper.length };
}
function save(config) { ensureDirs(); fs.writeFileSync(paths.configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }); fs.chmodSync(paths.configFile, 0o600); }
export async function configureModels(config, ask, { discover = discoverModels, download = downloadVerified } = {}) {
  const found = discover(config);
  for (const kind of ['whisper', 'piper']) {
    const label = kind === 'whisper' ? 'Speech recognition (Whisper base.en, 148 MB)' : 'Voice output (Piper LJ Speech medium, 64 MB)';
    console.log('\n' + label);
    found[kind].forEach((file, i) => console.log(`  ${i + 1}. Reuse ${file}`));
    console.log('  d. Download verified model from Hugging Face\n  s. Skip (text chat still works)');
    const defaultChoice = found[kind].length ? '1' : 's';
    let choice;
    do { choice = (await ask(`Choose model [${defaultChoice}]: `)).trim().toLowerCase() || defaultChoice; }
    while (choice !== 's' && choice !== 'd' && !(Number.isInteger(Number(choice)) && Number(choice) >= 1 && Number(choice) <= found[kind].length));
    if (choice === 's') continue;
    let selected;
    if (choice === 'd') {
      console.log('Downloads contact Hugging Face/CDN only. No audio, chat, or system files are uploaded.');
      console.log(kind === 'whisper' ? 'Whisper weights: upstream OpenAI MIT license. See docs/MODELS.md.' : 'LJ Speech model card identifies the training dataset as public domain. See docs/MODELS.md.');
      if (!/^y(es)?$/i.test((await ask('Download these model files now? [y/N]: ')).trim())) continue;
      const directory = kind === 'whisper' ? paths.whisperModels : paths.piperVoices;
      for (const item of downloads[kind]) await download(item, path.join(directory, item.file));
      selected = path.join(directory, downloads[kind][0].file);
    } else selected = found[kind][Number(choice) - 1];
    if (kind === 'whisper') { config.stt.model = path.basename(selected).replace(/^ggml-/, '').replace(/\.bin$/, ''); config.stt.modelPath = selected; }
    else { config.tts.voice = path.basename(selected, '.onnx'); config.tts.modelPath = selected; }
  }
  return config;
}
async function network(config, ask) {
  console.log('\nNetwork access:\n  1. Desktop / private Tailscale Serve (loopback only, recommended)\n  2. Home LAN (listen on local network)\n  3. Cloudflare public tunnel (Cloudflare relays requests and sees traffic)');
  console.log('The QR link is a password. Anyone holding it can talk to your agent.');
  const choice = (await ask('Network mode [1]: ')).trim() || '1';
  if (!['1','2','3'].includes(choice)) throw new Error('Invalid network mode; nothing changed');
  config.host = choice === '2' ? '0.0.0.0' : '127.0.0.1';
  config.tunnel.enabled = choice === '3'; config.qrTarget = choice === '3' ? 'tunnel' : 'lan';
  return config;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--check')) console.log(JSON.stringify(setupStatus()));
    else {
      if (!process.stdin.isTTY) throw new Error('Setup needs an interactive terminal. Use --check to inspect readiness; installer --no-models skips downloads.');
      ensureDirs(); const config = loadConfig();
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const ask = question => rl.question(question);
        if (process.argv.includes('--network')) await network(config, ask);
        else await configureModels(config, ask);
        save(config);
        console.log('\nSettings saved. Restart JARVIS to apply them. Text chat works without voice models.');
      } finally { rl.close(); }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
