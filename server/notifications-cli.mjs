#!/usr/bin/env node
// Local native calendar transport. No TCP fallback; credentials stay in headers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {deliverCalendarToasts} from './lib/calendar-toasts.mjs';
import {createDesktopNotifications} from './lib/desktop-notifications.mjs';
let failed=false;
try {
 const args=process.argv.slice(2);
 const deliver=args.includes('--deliver');
 if(deliver)args.splice(args.indexOf('--deliver'),1);
 if(args.length && (args.length!==2 || args[0]!=='--state-dir' || !path.isAbsolute(args[1])))throw new Error('Invalid arguments');
 const directory=args[1]||path.join(os.homedir(),'.local/state/omarchy-jarvis');
 const socketPath=path.join(directory,'serve.sock');
 const socket=fs.lstatSync(socketPath);
 if(!socket.isSocket()||socket.uid!==process.getuid()||(socket.mode&0o077))throw new Error('Unsafe socket');
 const fd=fs.openSync(path.join(directory,'token'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let token;
 try {
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>4096)throw new Error('Unsafe token');
  token=fs.readFileSync(fd,'utf8').trim();
 }finally{fs.closeSync(fd);}
 const request=(endpoint,body)=>new Promise((resolve,reject)=>{
  if(!['calendar','notifications'].includes(endpoint))return reject(new Error('Invalid endpoint'));
  const req=http.request({socketPath,path:'/api/'+endpoint,method:body===undefined?'GET':'POST',headers:{'X-Jarvis-Token':token,'Content-Type':'application/json'}},res=>{
   let size=0;const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)req.destroy(new Error('Response too large'));else chunks.push(chunk);});
   res.on('error',reject);
   res.on('end',()=>res.statusCode===200?resolve(Buffer.concat(chunks)):reject(new Error('Unavailable')));
  });
  req.setTimeout(10000,()=>req.destroy(new Error('Timeout')));
  req.on('error',reject);req.end(body);
 });
 let command={action:'notifications'};
 if(!process.stdin.isTTY){
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw new Error('Input too large');}
  if(input.trim())command=JSON.parse(input);
 }
 let snapshot;const output=[];
 const native=createDesktopNotifications(request,(event,data)=>{
  if(event==='notifications')snapshot=data;
  if(event==='notificationError')failed=true;
  output.push({event,...data});
 });
 if(!native.handles(command.action))throw new Error('Unknown action');
 await native.dispatch(command);
 if(deliver && snapshot && !failed)await deliverCalendarToasts(directory,snapshot.items);
 for(const event of output)process.stdout.write(JSON.stringify(event)+'\n');
}catch{
 failed=true;process.stdout.write(JSON.stringify({event:'notificationError',error:'Calendar notifications unavailable. Refresh and try again.'})+'\n');
}
process.exitCode=failed?1:0;
