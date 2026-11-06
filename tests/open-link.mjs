import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-open-test-'));
try {
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'xdg-open'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/argv"\n', {mode:0o700});
  const panel = fs.readFileSync('plugin/h3man.jarvis/Panel.qml', 'utf8');
  assert.doesNotMatch(panel, /Qt\.openUrlExternally\(root\.link\)/);
  assert.match(panel, /command: \[root.jarvisBin, "open", "--stdin"\]/);
  assert.match(panel, /openProc\.write\(root\.link\)/);
  assert.match(panel, /openProc\.closeWriteChannel\(\)/);
  for (const host of ['192.0.2.1:4317', 'fixture.trycloudflare.com', 'fixture.tailnet.ts.net']) {
    const link = `https://${host}/#token=fixture-private-bearer`;
    const child = spawn('bash', ['bin/jarvis', 'open', '--stdin'], {
      env: {...process.env, HOME:home, XDG_STATE_HOME:path.join(home,'state'), PATH:bin + ':' + process.env.PATH},
      stdio:['pipe','pipe','pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit');
    let directory;
    try {
      child.stdin.end(link);
      const argsFile = path.join(home, 'argv');
      for (let i = 0; i < 200 && !fs.existsSync(argsFile); i++) await delay(10);
      assert.ok(fs.existsSync(argsFile), stderr || 'Browser handoff timed out');
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      assert.equal(args.length, 1);
      assert.ok(!args[0].includes('fixture-private-bearer'));
      directory = path.dirname(args[0]);
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(args[0]).mode & 0o777, 0o600);
      assert.ok(fs.readFileSync(args[0], 'utf8').includes(link));
      fs.unlinkSync(argsFile);
    } finally {
      child.kill('SIGTERM');
      await exited;
      if (directory) fs.rmSync(directory, {recursive:true, force:true});
    }
  }
  console.log('PASS: native phone links use stdin and private browser handoff for all transports');
} finally { fs.rmSync(home, {recursive:true, force:true}); }
