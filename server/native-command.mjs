#!/usr/bin/env node
// Finite native requests are collected outside the shared shell, then emitted
// only after successful completion within both byte and wall-clock limits.
import path from 'node:path';
import {boundedExec, stopChildren} from './lib/bounded-process.mjs';
const [action, ...args] = process.argv.slice(2);
const allowed = new Set(['setup-status', 'status', 'qr', 'start', 'stop', 'restart', 'tailscale-enable']);
process.on('exit', stopChildren);
process.on('SIGTERM', () => process.exit(1));
process.on('SIGINT', () => process.exit(1));
try {
  if (!allowed.has(action)) throw new Error('Unsupported native command');
  const {stdout, stderr} = await boundedExec(path.resolve(import.meta.dirname, '../bin/jarvis'), [action, ...args], {
    timeout:['start', 'stop', 'restart', 'tailscale-enable'].includes(action) ? 120000 : 15000, maxBuffer:2*1024*1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr.slice(0, 16384));
} catch {
  process.stderr.write('Native command failed, timed out or exceeded its output limit.\n');
  process.exitCode = 1;
}
