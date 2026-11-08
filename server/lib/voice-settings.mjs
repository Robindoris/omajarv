// Authenticated voice configuration only: no credentials, downloads or broad scans.
import path from 'node:path';
import os from 'node:os';
import { discoverModels, usable } from './models.mjs';
import { writeConfig } from './config.mjs';
import { sttStatus, stopWhisperServer } from './stt.mjs';
import { ttsStatus } from './tts.mjs';

const STT_KEYS = ['engine', 'model', 'modelPath', 'language', 'serverPort'];
const TTS_KEYS = ['voice', 'modelPath', 'speed'];
const LANGUAGES = new Set(('auto en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue').split(' '));
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid voice settings fields.');
}
function name(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value) || value.includes('..')) fail(`Invalid ${label} name.`);
}
function number(value, min, max, integer, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`Invalid ${label}; expected ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
}
function modelPath(value, kind) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) fail('Invalid local model path.');
  if (value === '') return;
  if (!path.isAbsolute(value) && !value.startsWith('~/')) fail('Model paths must be absolute or start with ~/.');
  const file = value.replace(/^~(?=\/)/, os.homedir());
  if (!file.endsWith(kind === 'whisper' ? '.bin' : '.onnx') || !usable(file) || (kind === 'piper' && !usable(file + '.json'))) fail(kind === 'piper' ? 'Piper requires an installed .onnx model and matching .onnx.json file.' : 'Whisper requires an installed .bin model.');
}

export function voiceSettingsView(config) {
  const installed = discoverModels(config);
  return {
    settings: {
      stt: Object.fromEntries(STT_KEYS.map(key => [key, config.stt[key]])),
      tts: Object.fromEntries(TTS_KEYS.map(key => [key, config.tts[key]])),
      maxRecordingSec: config.maxRecordingSec,
    },
    models: {
      whisper: installed.whisper.map(file => ({ name: path.basename(file).replace(/^ggml-/, '').replace(/\.bin$/, ''), path: file })),
      piper: installed.piper.map(file => ({ name: path.basename(file, '.onnx'), path: file })),
    },
    status: { stt: sttStatus(config), tts: ttsStatus(config) },
  };
}

// Synchronous validation + persistence + commit: requests cannot interleave a save.
// Persist a candidate first so failed disk writes cannot change live settings.
export function updateVoiceSettings(config, payload, { busy = false, persist = writeConfig, invalidateWhisper = stopWhisperServer } = {}) {
  if (busy) throw Object.assign(new Error('Stop the current reply or speech request before changing voice settings.'), { status: 409 });
  if (object(payload) && Object.hasOwn(payload, 'settings')) {
    fields(payload, ['settings']);
    payload = payload.settings;
  }
  fields(payload, ['stt', 'tts', 'maxRecordingSec']);
  if (!Object.keys(payload).length) fail('Provide at least one voice setting.');
  if (Object.hasOwn(payload, 'stt')) {
    fields(payload.stt, STT_KEYS);
    for (const [key, value] of Object.entries(payload.stt)) {
      if (key === 'engine' && !['auto', 'cli', 'server'].includes(value)) fail('Invalid speech recognition engine.');
      if (key === 'model') name(value, 'Whisper model');
      if (key === 'modelPath') modelPath(value, 'whisper');
      if (key === 'language' && !LANGUAGES.has(value)) fail('Invalid Whisper language code.');
      if (key === 'serverPort') number(value, 1, 65535, true, 'Whisper server port');
    }
  }
  if (Object.hasOwn(payload, 'tts')) {
    fields(payload.tts, TTS_KEYS);
    for (const [key, value] of Object.entries(payload.tts)) {
      if (key === 'voice') name(value, 'Piper voice');
      if (key === 'modelPath') modelPath(value, 'piper');
      if (key === 'speed') number(value, 0.5, 2, false, 'speech speed');
    }
  }
  if (Object.hasOwn(payload, 'maxRecordingSec')) number(payload.maxRecordingSec, 1, 600, true, 'recording duration');
  const candidate = { ...config, stt: { ...config.stt, ...payload.stt }, tts: { ...config.tts, ...payload.tts }, maxRecordingSec: payload.maxRecordingSec ?? config.maxRecordingSec };
  const changedStt = STT_KEYS.some(key => candidate.stt[key] !== config.stt[key]);
  // Compute the public response before committing, too; its output is
  // intentionally constrained to voice fields, model discovery and statuses.
  const result = voiceSettingsView(candidate);
  try { persist(candidate); }
  catch { throw Object.assign(new Error('Unable to save voice settings. Runtime settings were not changed.'), { status: 409 }); }
  config.stt = candidate.stt;
  config.tts = candidate.tts;
  config.maxRecordingSec = candidate.maxRecordingSec;
  if (changedStt) invalidateWhisper();
  return result;
}
