// Bounded model discovery. Never scans the whole home directory or uploads paths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = os.homedir();
const expand = value => value?.replace(/^~(?=\/|$)/, home);
export function usable(file) { try { return fs.statSync(file).isFile() && fs.statSync(file).size > 0; } catch { return false; } }
export function whisperPath(config, modelDir = path.join(home, '.local/share/omarchy-jarvis/models/whisper')) {
  return expand(config.stt?.modelPath) || path.join(modelDir, `ggml-${config.stt?.model || 'base.en'}.bin`);
}
export function piperPath(config, modelDir = path.join(home, '.local/share/omarchy-jarvis/models/piper')) {
  return expand(config.tts?.modelPath) || path.join(modelDir, `${config.tts?.voice || 'en_US-ljspeech-medium'}.onnx`);
}
function filesIn(directory, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries.slice(0, 1000).flatMap(entry => entry.isFile() ? [path.join(directory, entry.name)] : entry.isDirectory() && depth < 2 ? filesIn(path.join(directory, entry.name), depth + 1) : []);
}
export function discoverModels(config, { whisperDirs, piperDirs } = {}) {
  whisperDirs ||= [path.join(home, '.local/share/omarchy-jarvis/models/whisper'), path.join(home, '.local/share/whisper-cpp/models'), path.join(home, '.local/share/whisper/models'), path.join(home, '.cache/whisper'), '/usr/share/whisper-cpp/models'];
  piperDirs ||= [path.join(home, '.local/share/omarchy-jarvis/models/piper'), path.join(home, '.local/share/piper/voices'), path.join(home, '.local/share/piper'), '/usr/share/piper-voices'];
  const unique = values => [...new Set(values)];
  const whisper = unique([whisperPath(config), ...whisperDirs.flatMap(dir => filesIn(dir))]).filter(file => (file === whisperPath(config) || /(?:^|\/)ggml-[^/]+\.bin$/.test(file)) && usable(file));
  const piper = unique([piperPath(config), ...piperDirs.flatMap(dir => filesIn(dir))]).filter(file => file.endsWith('.onnx') && usable(file) && usable(file + '.json'));
  return { whisper, piper };
}
