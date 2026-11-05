import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-offline-status-'));
try {
  const jq = spawnSync('which', ['jq'], {encoding: 'utf8'}).stdout.trim();
  assert.ok(jq, 'jq is required');
  const bin = path.join(home, 'bin');
  const state = path.join(home, 'state/omarchy-jarvis');
  fs.mkdirSync(bin);
  fs.mkdirSync(state, {recursive: true});
  const token = 'offline-test-credential';
  fs.writeFileSync(path.join(state, 'token'), token);
  fs.writeFileSync(path.join(state, 'tunnel-url'), 'https://test.invalid');
  for (const name of ['curl', 'ip']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 1\n', {mode: 0o755});
  }
  fs.writeFileSync(path.join(bin, 'jq'), `#!${process.execPath}
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ARG_LOG, JSON.stringify(args) + '\\n');
const result = spawnSync(${JSON.stringify(jq)}, args, {stdio: 'inherit'});
process.exit(result.status ?? 1);
`, {mode: 0o755});
  const log = path.join(home, 'args');
  const result = spawnSync('bash', ['bin/jarvis', 'status', '--json'], {
    encoding: 'utf8',
    env: {...process.env, HOME: home, XDG_STATE_HOME: path.dirname(state),
      XDG_CONFIG_HOME: path.join(home, 'config'), PATH: bin + ':' + process.env.PATH, ARG_LOG: log},
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.running, false);
  assert.equal(status.url, `https://test.invalid/?k=${token}`);
  assert.ok(!fs.readFileSync(log, 'utf8').includes(token), 'credential leaked into jq arguments');
  console.log('PASS: offline status returns the credential without passing it in helper arguments.');
} finally {
  fs.rmSync(home, {recursive: true, force: true});
}
