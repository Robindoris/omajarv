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
// Pinned Whisper variants share the upstream MIT terms of the default model.
export const whisperChoices = {
  lightweight: {name:'Lightweight · Whisper tiny.en', description:'Fastest, lowest memory use; lower recognition accuracy.', files:[{file:'ggml-tiny.en.bin',bytes:77704715,sha:'921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',url:`https://huggingface.co/ggerganov/whisper.cpp/resolve/${whisperRev}/ggml-tiny.en.bin`}]},
  multilingualLight: {name:'Lightweight multilingual · Whisper tiny',description:'Fast multilingual recognition, including Slovak; lower accuracy.',files:[{file:'ggml-tiny.bin',bytes:77691713,sha:'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',url:`https://huggingface.co/ggerganov/whisper.cpp/resolve/${whisperRev}/ggml-tiny.bin`}]},
  multilingualHeavy: {name:'Heavy multilingual · Whisper small',description:'Multilingual recognition, including Slovak; higher memory use and processing time.',files:[{file:'ggml-small.bin',bytes:487601967,sha:'1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',url:`https://huggingface.co/ggerganov/whisper.cpp/resolve/${whisperRev}/ggml-small.bin`}]},
  balanced: {name:'Balanced · Whisper base.en',description:'A balance of speed and recognition accuracy.',files:downloads.whisper},
  heavy: {name:'Heavy · Whisper small.en',description:'Higher recognition accuracy; more memory and processing time.',files:[{file:'ggml-small.en.bin',bytes:487614201,sha:'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',url:`https://huggingface.co/ggerganov/whisper.cpp/resolve/${whisperRev}/ggml-small.en.bin`}]},
};
// Explicit dashboard choices; the CLI default remains LJ Speech.
export const piperChoices = {
 'ljspeech-medium': {name:'Piper LJ Speech · English (US) · medium',description:'US English voice · medium quality.',terms:'Model card: public-domain training dataset; upstream model/runtime terms apply',modelCard:`https://huggingface.co/rhasspy/piper-voices/blob/${piperRev}/en/en_US/ljspeech/medium/MODEL_CARD`,files:downloads.piper},
 ...{
  "cori-high": {
    "name": "Piper Cori \u00b7 English (UK) \u00b7 high",
    "description": "British English female voice \u00b7 high quality.",
    "terms": "Model card: public-domain LibriVox dataset; upstream model/runtime terms apply",
    "modelCard": "https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_GB/cori/high/MODEL_CARD",
    "files": [
      {
        "file": "en_GB-cori-high.onnx",
        "bytes": 114219352,
        "sha": "470b4dd634c98f8a4850d7626ffc3dfc90774628eeef6605a6dd8f88f30a5903",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_GB/cori/high/en_GB-cori-high.onnx"
      },
      {
        "file": "en_GB-cori-high.MODEL_CARD",
        "bytes": 468,
        "sha": "136e7bd168b6c35b4a5df01a0253297e5773b5775ceae0af5160f264aa58208f",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_GB/cori/high/MODEL_CARD"
      },
      {
        "file": "en_GB-cori-high.onnx.json",
        "bytes": 4963,
        "sha": "9e7fb5b5671612c22f3c81cbe46c1ae87b031a4632bcb509e499dad6f1e2adec",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_GB/cori/high/en_GB-cori-high.onnx.json"
      }
    ]
  },
  "ryan-high": {
    "name": "Piper Ryan \u00b7 English (US) \u00b7 high",
    "description": "US English voice \u00b7 high quality. Free for noncommercial use.",
    "terms": "CC BY-NC-SA 4.0 \u00b7 attribution, noncommercial, share-alike; upstream runtime terms apply",
    "modelCard": "https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ryan/high/MODEL_CARD",
    "files": [
      {
        "file": "en_US-ryan-high.onnx",
        "bytes": 120786792,
        "sha": "b3990d7606e183ec8dbfba70a4607074f162de1a0c412e0180d1ff60bb154eca",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ryan/high/en_US-ryan-high.onnx"
      },
      {
        "file": "en_US-ryan-high.MODEL_CARD",
        "bytes": 265,
        "sha": "7c3b337dd4e96c3f311f476118b15d93867aefa4bee54263e250c45f759fad0d",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ryan/high/MODEL_CARD"
      },
      {
        "file": "en_US-ryan-high.onnx.json",
        "bytes": 4166,
        "sha": "c6d3b98f08315cb4bebf0d49d50fc4ff491b503c64b940cd3d5ca28543b48011",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ryan/high/en_US-ryan-high.onnx.json"
      }
    ]
  },
  "lili-medium": {
    "name": "Piper Lili \u00b7 Slovak \u00b7 medium",
    "description": "Slovak voice \u00b7 medium quality.",
    "terms": "Model card: CC0 dataset; upstream model/runtime terms apply",
    "modelCard": "https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/sk/sk_SK/lili/medium/MODEL_CARD",
    "files": [
      {
        "file": "sk_SK-lili-medium.onnx",
        "bytes": 63201294,
        "sha": "d8e21603e0165252849efe0bcb3fbffd1b3193c36bd1f556e1106911e8015526",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/sk/sk_SK/lili/medium/sk_SK-lili-medium.onnx"
      },
      {
        "file": "sk_SK-lili-medium.MODEL_CARD",
        "bytes": 276,
        "sha": "d1df98a436e1b22f6bd1792a14fb3592dd816ee250ee3ff9ff3be62cd39c59b0",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/sk/sk_SK/lili/medium/MODEL_CARD"
      },
      {
        "file": "sk_SK-lili-medium.onnx.json",
        "bytes": 4963,
        "sha": "b7c474eba411913f9feb65b9da322463e8698e7b200d2b757f6e684802951333",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/sk/sk_SK/lili/medium/sk_SK-lili-medium.onnx.json"
      }
    ]
  },
  "jirka-medium": {
    "name": "Piper Jirka \u00b7 Czech \u00b7 medium",
    "description": "Czech voice \u00b7 medium quality.",
    "terms": "Model card: CC0 dataset; upstream model/runtime terms apply",
    "modelCard": "https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/cs/cs_CZ/jirka/medium/MODEL_CARD",
    "files": [
      {
        "file": "cs_CZ-jirka-medium.onnx",
        "bytes": 63201294,
        "sha": "cbd5c900acacc8e8cbecd64347abb8de39c00a9d3104bed06fee92e4f319efc8",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium.onnx"
      },
      {
        "file": "cs_CZ-jirka-medium.MODEL_CARD",
        "bytes": 282,
        "sha": "b8043c32e43496b109d49bbc28290e570c064a4ed949962a71a5ff6b2ad647e7",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/cs/cs_CZ/jirka/medium/MODEL_CARD"
      },
      {
        "file": "cs_CZ-jirka-medium.onnx.json",
        "bytes": 5025,
        "sha": "fb38b1799b7354808227c065efa97b1ffa2b0cde59505babb56a36d35af9c637",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium.onnx.json"
      }
    ]
  }
}
};
export async function downloadVerified(item, destination, { fetcher = fetch, onProgress, quiet = false } = {}) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (usable(destination)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
    if (hash === item.sha) { onProgress?.(item.bytes); return; }
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
      onProgress?.(bytes);
      const progress = Math.floor(bytes / item.bytes * 10);
      if (!quiet && progress !== lastProgress) { process.stdout.write(`\r  ${item.file}: ${Math.floor(bytes / item.bytes * 100)}%`); lastProgress = progress; }
    }
    if (bytes !== item.bytes || hash.digest('hex') !== item.sha) throw new Error('Model checksum or size mismatch');
    fs.closeSync(handle); fs.renameSync(temporary, destination); if (!quiet) console.log(' · verified');
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
