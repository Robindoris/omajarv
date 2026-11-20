// Deliver shared calendar reminders through the desktop notification daemon.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const escape=value=>String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export async function deliverCalendarToasts(directory, items, send=async(title,body)=>{
 await execute('notify-send',['--app-name=Jarvis 2.0','--icon=appointment-soon','--urgency=normal','--expire-time=10000','--',title,body],{timeout:3000,maxBuffer:4096});
}) {
 const lock=path.join(directory,'calendar-toasts.lock'),file=path.join(directory,'calendar-toasts.json');
 try{fs.mkdirSync(lock,{mode:0o700});}catch(e){
  if(e.code!=='EEXIST')throw e;
  if(Date.now()-fs.statSync(lock).mtimeMs>60000)fs.rmdirSync(lock);
  return;
 }
 try {
  let sent=[];try{sent=JSON.parse(fs.readFileSync(file,'utf8')).sent;if(!Array.isArray(sent))throw new Error('Invalid delivery state');}catch(e){if(e.code!=='ENOENT')throw e;}
  let delivered=0;
  for(const item of items){
   const key=item.id+':'+(item.snoozedUntil||0);
   if(item.source!=='calendar'||item.read||sent.includes(key))continue;
   // One bounded batch prevents a reconnect from flooding the desktop.
   if(delivered>=5)break;
   await send(escape(item.title),escape(item.body));
   sent=[...sent,key].slice(-1000);
   const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({sent}),{mode:0o600});fs.renameSync(tmp,file);
   delivered++;
  }
  return delivered;
 }finally{fs.rmdirSync(lock);}
}
