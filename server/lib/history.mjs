// One bounded transcript per agent, shared by phone and desktop.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths } from './config.mjs';
import { writePrivateFile } from './privacy.mjs';
const file = path.join(paths.stateDir, 'history.json');
const archiveFile = path.join(paths.stateDir, 'conversations.json');
let archives;
try { archives = JSON.parse(fs.readFileSync(archiveFile,'utf8'));fs.chmodSync(archiveFile,0o600); }
catch(error) { if(error.code!=='ENOENT') throw error; archives=[]; }
let histories;
try { histories = JSON.parse(fs.readFileSync(file, 'utf8')); fs.chmodSync(file, 0o600); } catch { histories = {}; }
function save() {
  writePrivateFile(file, JSON.stringify(histories));
}
export function historyFor(agent) { return histories[agent] || []; }
export function appendHistory(agent, role, text) {
  const rows = historyFor(agent).concat({ role, text, at: Date.now() });
  histories[agent] = rows;
  save();
}
export function conversations() {
  return [...archives, ...Object.entries(histories).filter(([,rows])=>rows.length).map(([agent,messages])=>({id:'active:'+agent,agent,active:true,at:messages[0].at,messages}))].map(chat=>({...chat,title:chat.messages.find(row=>row.role==='user')?.text.slice(0,90)||'Conversation'})).sort((a,b)=>b.at-a.at);
}
export function clearHistory() {
  const next=[...archives,...Object.entries(histories).filter(([,rows])=>rows.length).map(([agent,messages])=>({id:randomUUID(),agent,at:messages[0].at,messages}))];
  writePrivateFile(archiveFile,JSON.stringify(next));archives=next;
  histories = {}; save();
}
