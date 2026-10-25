import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-privacy-'));
try {
  const script = `
    const {runAgent} = await import('./server/lib/agent.mjs');
    const {ensureWhisperServer} = await import('./server/lib/stt.mjs');
    const assert = (await import('node:assert/strict')).default;
    for (const agent of ['opencode','gemini','grok','cursor-agent','copilot','crush','omp','pi','muse','hermes','openclaw']) {
      assert.throws(() => runAgent({config:{agent,systemPrompt:'private'}, text:'secret request'}), /private stdin transport/);
    }
    assert.equal(await ensureWhisperServer({stt:{engine:'server',serverPort:8178}}), false);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {...process.env, HOME:home, XDG_CONFIG_HOME:path.join(home,'config'), XDG_STATE_HOME:path.join(home,'state')}, encoding:'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const cli = fs.readFileSync('bin/jarvis','utf8');
  assert.ok(!cli.includes('--output - "$link"'));
  const panel = fs.readFileSync('plugin/h3man.jarvis/Panel.qml','utf8');
  assert.doesNotMatch(panel, /copyProc.command[^\n]*root.link/);
  assert.match(panel, /copyProc.write\(root.link\)/);
  console.log('Local privacy regressions passed');
} finally { fs.rmSync(home,{recursive:true,force:true}); }
