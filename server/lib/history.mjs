// One bounded transcript per agent, shared by phone and desktop.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.mjs';
const file = path.join(paths.stateDir, 'history.json');
let histories;
try { histories = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { histories = {}; }
function save() {
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(histories), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
export function historyFor(agent) { return histories[agent] || []; }
export function appendHistory(agent, role, text) {
  const rows = historyFor(agent).concat({ role, text, at: Date.now() }).slice(-100);
  histories[agent] = rows;
  save();
}
export function clearHistory() { histories = {}; save(); }
