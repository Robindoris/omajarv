// Browser launchers expose argv. Keep the bearer URL in a private, short-lived file.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const link = new URL(input.trim());
if (!['http:', 'https:'].includes(link.protocol)) throw new Error('Invalid phone URL');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-open-'));
await fs.chmod(directory, 0o700);
try {
  const file = path.join(directory, 'open.html');
  const escaped = link.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  await fs.writeFile(file, `<!doctype html><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${escaped}">`, { mode: 0o600 });
  await new Promise((resolve, reject) => {
    const child = spawn('xdg-open', [file], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  // Some launchers return before the browser has read the file.
  await new Promise(resolve => setTimeout(resolve, 60000));
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
