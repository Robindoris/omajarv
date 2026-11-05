import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-personality-'));
process.env.HOME = home;
try {
  const {ensureDirs, defaults, writeDefaultConfig, paths} = await import('../server/lib/config.mjs');
  const {createPersonality} = await import('../server/lib/personality.mjs');
  ensureDirs();
  let profile = createPersonality(defaults);
  assert.equal(profile.view().personality, defaults.systemPrompt);
  assert.equal(profile.view().stage, 'pendingSetup');
  assert.deepEqual(profile.messages(), []);
  writeDefaultConfig();
  assert.equal(profile.view().stage, 'assistantName');
  assert.match(profile.messages()[0].text, /name your assistant/);
  assert.throws(() => profile.answer('Nova', 9), /changed on another device/);
  assert.throws(() => profile.answer('x'.repeat(81), 0), /1–80/);
  profile.answer('Nova', 0);
  // Restart midway: the next device must ask the next question, not begin again.
  profile = createPersonality(defaults);
  assert.equal(profile.view().stage, 'personality');
  assert.equal(profile.view().assistantName, 'Nova');
  profile.answer('Warm, curious and detailed.', 1);
  assert.equal(profile.view().stage, 'userName');
  profile.answer('Alex', 2);
  assert.equal(profile.view().stage, 'complete');
  assert.match(profile.prompt(), /Nova/);
  assert.match(profile.prompt(), /Alex/);
  assert.match(profile.prompt(), /Warm, curious and detailed/);
  const previous = profile.view();
  assert.throws(() => profile.update({...previous, userName:''}), /1–80/);
  assert.deepEqual(profile.view(), previous);
  profile.update({...previous, personality:'Respond in Spanish.'});
  profile = createPersonality(defaults);
  assert.match(profile.prompt(), /Respond in Spanish/);
  profile.resetTranscript();
  assert.deepEqual(profile.messages(), []);
  assert.equal(profile.answering(), false);
  assert.equal(fs.statSync(path.join(paths.stateDir, 'personality.json')).mode & 0o777, 0o600);
  console.log('PASS: setup gating, ordered onboarding, restart persistence, validation, revisions and reset preservation.');
} finally { fs.rmSync(home, {recursive:true, force:true}); }
