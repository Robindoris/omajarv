// Fresh root-manifest marketplace layout; never use the real user service or packages.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omajarv-marketplace-'));
const mocks = path.join(home, 'mocks');
const source = path.join(home, '.config/omarchy/plugins/h3man.jarvis');
const calls = path.join(home, 'mock-calls');
fs.mkdirSync(mocks);
fs.mkdirSync(path.join(home, 'runtime'), {mode: 0o700});
const env = {...process.env, HOME: home, PATH: mocks + ':' + process.env.PATH,
  XDG_CONFIG_HOME: path.join(home, '.config'), XDG_STATE_HOME: path.join(home, '.local/state'),
  XDG_DATA_HOME: path.join(home, '.local/share'), XDG_RUNTIME_DIR: path.join(home, 'runtime'),
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + path.join(home, 'runtime/no-user-bus'),
  MOCK_CALLS: calls, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
function mock(name, body) {
  fs.writeFileSync(path.join(mocks, name), '#!/bin/bash\n' + body + '\n', {mode: 0o755});
}
// Log only fixed lifecycle commands; never record HTTP headers or credentials.
for (const name of ['systemctl', 'omarchy']) mock(name, `printf '%s %s\\n' '${name}' "$*" >> "$MOCK_CALLS"\nexit 0`);
mock('tailscale', "printf '{}\\n'");
mock('curl', 'exit 1'); // local status may fail while the mocked service is not running
for (const name of ['sudo', 'pacman', 'yay', 'git', 'cloudflared', 'codex', 'claude', 'opencode', 'hermes']) {
  mock(name, `printf '%s\\n' 'FORBIDDEN ${name}' >> "$MOCK_CALLS"\nexit 91`);
}
function run(command, args, options = {}) {
  return spawnSync(command, args, {env, encoding: 'utf8', timeout: 30000, ...options});
}
function success(result) { assert.equal(result.status, 0, result.stderr + result.stdout); }
try {
  fs.mkdirSync(source, {recursive: true});
  for (const name of ['install.sh', 'manifest.json', 'bin', 'server', 'scripts', 'skills', 'plugin']) {
    fs.cpSync(path.join(root, name), path.join(source, name), {recursive: true});
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  assert.equal(manifest.id, 'h3man.jarvis');
  assert.ok(fs.existsSync(path.join(source, manifest.entryPoints.barWidget)));
  const marker = path.join(source, 'checkout-marker');
  fs.writeFileSync(marker, 'marketplace source must survive onboarding');
  const installer = path.join(source, 'install.sh');
  const installArgs = [installer, '--no-plugin', '--no-packages', '--no-models'];
  const unapproved = run('bash', [installer, '--no-plugin'], {input: ''});
  assert.notEqual(unapproved.status, 0);
  assert.match(unapproved.stderr, /Package installation needs an interactive terminal/);
  assert.equal(fs.existsSync(path.join(home, '.local/bin/jarvis')), false);
  assert.equal(fs.existsSync(path.join(home, '.config/systemd/user/omarchy-jarvis.service')), false);
  assert.equal(fs.existsSync(path.join(home, '.config/omarchy-jarvis/config.json')), false);
  success(run('bash', installArgs));
  assert.equal(fs.readFileSync(marker, 'utf8'), 'marketplace source must survive onboarding');
  const launcher = path.join(home, '.local/bin/jarvis');
  assert.equal(fs.realpathSync(launcher), path.join(source, 'bin/jarvis'));
  const unit = path.join(home, '.config/systemd/user/omarchy-jarvis.service');
  assert.ok(fs.readFileSync(unit, 'utf8').includes('WorkingDirectory=' + source));
  success(run('systemd-analyze', ['--user', 'verify', unit]));
  const configFile = path.join(home, '.config/omarchy-jarvis/config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.tunnel.enabled, false);
  assert.equal(config.codexFullAccess, false);
  assert.equal(config.agentFullAccess, false);
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(home, '.agents')), false);
  assert.equal(fs.readdirSync(path.join(home, '.local/share/omarchy-jarvis/models/whisper')).length, 0);
  config.stt.modelPath = '/existing/user/model.bin';
  config.codexFullAccess = true;
  fs.writeFileSync(configFile, JSON.stringify(config));
  const before = fs.readFileSync(configFile, 'utf8');
  success(run('bash', installArgs));
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(home, '.local/state/omarchy-jarvis/plugin-backup')), false);

  // Execute the actual QML launch shell with controlled fixture paths. Existing
  // launchers from another checkout must not take precedence over this source.
  const panel = fs.readFileSync(path.join(root, 'plugin/h3man.jarvis/Panel.qml'), 'utf8');
  const shell = panel.match(/function launchSetup\(\)[\s\S]*?\n\s*'([^']+)'/)[1];
  const selection = path.join(home, 'selection');
  env.SETUP_SELECTION = selection;
  const fixtureInstaller = path.join(home, 'installer with spaces.sh');
  fs.writeFileSync(fixtureInstaller, '#!/bin/bash\nprintf "source:%s" "$*" > "$SETUP_SELECTION"\n');
  const stale = path.join(home, 'stale jarvis');
  fs.writeFileSync(stale, '#!/bin/bash\nprintf "legacy:%s" "$*" > "$SETUP_SELECTION"\n', {mode: 0o755});
  success(run('bash', ['-c', shell, 'jarvis-setup', stale, fixtureInstaller], {input: '\n'}));
  assert.equal(fs.readFileSync(selection, 'utf8'), 'source:--no-plugin');
  success(run('bash', ['-c', shell, 'jarvis-setup', stale, path.join(home, 'missing')], {input: '\n'}));
  assert.equal(fs.readFileSync(selection, 'utf8'), 'legacy:setup');
  const missing = run('bash', ['-c', shell, 'jarvis-setup', path.join(home, 'missing'), path.join(home, 'missing')], {input: '\n'});
  assert.notEqual(missing.status, 0);

  // Remove through the installed CLI, while its source lives inside PLUGIN_DIR.
  success(run('bash', [launcher, 'uninstall']));
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(unit), false);
  assert.equal(fs.readdirSync(path.dirname(launcher)).includes('jarvis'), false, 'No dangling launcher');
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
  assert.ok(fs.existsSync(path.join(home, '.local/share/omarchy-jarvis/models')));
  const lifecycle = fs.readFileSync(calls, 'utf8');
  assert.match(lifecycle, /systemctl --user enable --now omarchy-jarvis.service/);
  assert.match(lifecycle, /systemctl --user disable --now omarchy-jarvis.service/);
  assert.ok(!lifecycle.includes('FORBIDDEN'), lifecycle);
  assert.ok(!lifecycle.includes('omarchy restart shell'));
  console.log('PASS: marketplace source onboarding, checkout selection, private defaults, opt-in boundaries, rerun preservation and CLI uninstall without a dangling launcher; lifecycle tools mocked.');
} finally {
  fs.rmSync(home, {recursive: true, force: true});
}
