import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-models-'));
const oldHome = process.env.HOME;
const oldPath = process.env.PATH;
process.env.HOME = home;
process.env.PATH = path.join(home, 'bin');
process.env.JARVIS_MODELS_TEST_HOME = home;
try {
  fs.mkdirSync(path.join(home, 'bin'), {recursive: true});
  fs.mkdirSync(path.join(home, '.config/omarchy/defaults'), {recursive: true});
  fs.writeFileSync(path.join(home, '.config/omarchy/defaults/agent'), 'opencode', {mode: 0o600});
  const {listModels, modelSelectable} = await import('../server/lib/agent-models.mjs');

  // No opencode binary on PATH: listing degrades to a note, never raw stderr.
  const broken = await listModels('opencode', {agent: 'opencode'});
  assert.equal(broken.ok, true);
  assert.equal(broken.listed, false);
  assert.equal(broken.models.length, 0);
  assert.ok(typeof broken.note === 'string' && broken.note);

  process.env.PATH = path.join(home, 'bin') + ':' + oldPath;
  fs.writeFileSync(path.join(home, 'bin', 'opencode'), `#!/usr/bin/env node
if (process.argv[2] === 'models') {
  process.stdout.write('openai/gpt-5.6-cyber\\nopencode/glm-5.3-flash-free\\n_noise line\\nopenai/aa-paid\\n');
  process.exit(0);
}
process.exit(1);
`, {mode: 0o755});

  assert.equal(modelSelectable('opencode'), true);
  assert.equal(modelSelectable('hermes'), true);
  assert.equal(modelSelectable('codex'), false);

  const config = {agent: 'opencode', agentModels: {opencode: 'openai/aa-paid'}};
  const listing = await listModels('opencode', config);
  assert.equal(listing.ok, true);
  assert.equal(listing.listed, true);
  assert.equal(listing.note, '');
  assert.deepEqual(listing.models.map(m => m.id),
    ['opencode/glm-5.3-flash-free', 'openai/aa-paid', 'openai/gpt-5.6-cyber']);
  assert.deepEqual(listing.models.map(m => m.free), [true, false, false]);
  assert.deepEqual(listing.models.filter(m => m.selected).map(m => m.id), ['openai/aa-paid']);

  const plain = await listModels('opencode', {agent: 'opencode'});
  assert.deepEqual(plain.models.filter(m => m.selected).map(m => m.id), []);

  const hermes = await listModels('hermes', config);
  assert.equal(hermes.listed, false);
  assert.equal(hermes.models.length, 0);
  assert.match(hermes.note, /hermes model/);

  const none = await listModels('codex', config);
  assert.equal(none.listed, false);
  assert.deepEqual(none.models, []);

  console.log('PASS: model listing is free-first, deduplicated, marks the selection and degrades safely when the CLI is missing.');
} finally {
  process.env.HOME = oldHome;
  process.env.PATH = oldPath;
  delete process.env.JARVIS_MODELS_TEST_HOME;
  fs.rmSync(home, {recursive: true, force: true});
}
