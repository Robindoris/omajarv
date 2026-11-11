#!/usr/bin/env node
// Local agent tool: credentials stay in a header and never enter the prompt.
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import {paths,readToken} from './lib/config.mjs';

function request(body){return new Promise((resolve,reject)=>{
 const req=http.request({socketPath:paths.serveSocket,path:'/api/calendar',method:body?'POST':'GET',headers:{'X-Jarvis-Token':readToken(),'Content-Type':'application/json'}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{try{const data=JSON.parse(text);if(res.statusCode!==200)throw new Error(data.error||'Calendar unavailable');resolve(data);}catch(e){reject(e);}});});req.setTimeout(10000,()=>req.destroy(new Error('Calendar request timed out')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
try {
 const socket=fs.lstatSync(paths.serveSocket);
 if(!socket.isSocket()||socket.uid!==process.getuid()||(socket.mode & 0o077))throw new Error('Unsafe calendar socket. Restart JARVIS.');
 const [command='list',...args]=process.argv.slice(2);const board=await request();let action;
 if(command==='add')action={...JSON.parse(args.join(' ')),action:'create'};
 else if(command==='edit')action={...JSON.parse(args.slice(1).join(' ')),action:'edit',id:args[0]};
 else if(command==='delete')action={action:'delete',id:args[0]};
 else if(command!=='list')throw new Error('Usage: calendar list|add JSON|edit ID JSON|delete ID');
 console.log(JSON.stringify(action?await request({...action,revision:board.revision,requestId:crypto.randomUUID()}):board));
} catch(error){console.error(error.message);process.exitCode=1;}
