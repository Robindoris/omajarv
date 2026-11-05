// Called by the private per-turn sudo wrapper; no password enters this process.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runSudo({socketPath, ticket}, args, {spawnSudo = spawn} = {}) {
  if (!args.length || args.some(arg => ['-S','--stdin'].includes(arg))) {
    console.error('Use sudo with a command; passwords must be entered only in the phone authorization dialog.');
    process.exitCode = 1;
    return;
  }
  const command = 'sudo ' + args.map(arg => JSON.stringify(arg)).join(' ');
  const askpass = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sudo-askpass.mjs');
  const child = spawnSudo('/usr/bin/sudo', ['-A', '-k', ...args], {
    stdio:'inherit',
    env:{...process.env, SUDO_ASKPASS:askpass, JARVIS_SUDO_SOCKET:socketPath,
      JARVIS_SUDO_TICKET:ticket, JARVIS_SUDO_COMMAND:command, JARVIS_SUDO_CWD:process.cwd()},
  });
  process.exitCode = await new Promise(resolve => {
    child.once('error', () => { console.error('Unable to start system sudo.'); resolve(1); });
    child.once('exit', code => resolve(code ?? 1));
  });
}
