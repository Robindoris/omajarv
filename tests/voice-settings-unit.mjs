import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-settings-unit-'));
const previousHome = process.env.HOME;
process.env.HOME = home;
try {
  const { defaults } = await import('../server/lib/config.mjs');
  const { updateVoiceSettings, voiceSettingsView } = await import('../server/lib/voice-settings.mjs');
  const config = structuredClone({ ...defaults, unrelated: { secret: 'PRIVATE_FIXTURE' } });
  let writes = 0;
  let invalidations = 0;
  const options = {
    persist(candidate) {
      writes++;
      assert.equal(candidate.unrelated.secret, 'PRIVATE_FIXTURE');
      assert.notEqual(candidate, config);
    },
    invalidateWhisper() { invalidations++; },
  };
  const ttsOnly = updateVoiceSettings(config, { tts: { speed: 1.5 } }, options);
  assert.equal(config.tts.speed, 1.5);
  assert.equal(ttsOnly.settings.tts.speed, 1.5);
  assert.equal(writes, 1);
  assert.equal(invalidations, 0, 'TTS-only updates do not invalidate Whisper');
  for (const patch of [{ language: 'sk' }, { model: 'small' }, { modelPath: '' }, { engine: 'cli' }, { serverPort: 9000 }]) {
    const changed = Object.entries(patch).some(([key, value]) => config.stt[key] !== value);
    const before = invalidations;
    updateVoiceSettings(config, { stt: patch }, options);
    assert.equal(invalidations, before + Number(changed));
  }
  const before = structuredClone(config);
  const beforeInvalidations = invalidations;
  assert.throws(() => updateVoiceSettings(config, { stt: { language: 'fr' }, tts: { speed: 2 }, maxRecordingSec: 60 }, {
    persist(candidate) {
      assert.deepEqual(config, before, 'runtime is unchanged while disk write occurs');
      assert.equal(candidate.stt.language, 'fr');
      throw new Error('PRIVATE_FILESYSTEM_DIAGNOSTIC');
    },
    invalidateWhisper: options.invalidateWhisper,
  }), e => e.status === 409 && !e.message.includes('PRIVATE_FILESYSTEM_DIAGNOSTIC'));
  assert.deepEqual(config, before);
  assert.equal(invalidations, beforeInvalidations, 'failed saves do not invalidate workers');
  const beforeWrites = writes;
  assert.throws(() => updateVoiceSettings(config, { maxRecordingSec: 90 }, { ...options, busy: true }), e => e.status === 409);
  assert.equal(writes, beforeWrites);
  assert.deepEqual(config, before);
  const whisper = path.join(home, 'custom model.bin'); fs.writeFileSync(whisper, 'fixture');
  updateVoiceSettings(config, { stt: { modelPath: whisper } }, options);
  assert.equal(config.stt.modelPath, whisper);
  assert.equal(invalidations, beforeInvalidations + 1);
  const voiceDir = path.join(home, '.local/share/omarchy-jarvis/models/piper');
  fs.mkdirSync(voiceDir, { recursive: true });
  const voice = path.join(voiceDir, config.tts.voice + '.onnx');
  fs.writeFileSync(voice, 'fixture');
  fs.writeFileSync(voice + '.json', '{}');
  assert.equal(voiceSettingsView(config).models.piper.find(model => model.path === voice)?.active, true, 'default-location voice is selected without an explicit path');
  const alternate = path.join(voiceDir, 'en_US-test-medium.onnx');
  fs.writeFileSync(alternate, 'fixture');
  assert.ok(!voiceSettingsView(config).models.piper.some(model => model.path === alternate), 'incomplete voices are not selectable');
  fs.writeFileSync(alternate + '.json', '{}');
  const selected = updateVoiceSettings(config, { tts: { voice: 'en_US-test-medium', modelPath: alternate } }, options);
  assert.equal(selected.models.piper.find(model => model.active)?.path, alternate);
  assert.equal(selected.settings.tts.modelPath, alternate);
  assert.equal(selected.models.piper.find(model => model.path === voice)?.active, false);
  console.log('PASS: voice settings persist-before-runtime transaction, write-failure rollback, busy conflicts and precise Whisper invalidation.');
} finally {
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
}
