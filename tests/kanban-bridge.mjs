import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
const root=path.resolve(import.meta.dirname,'..');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-kanban-bridge-'));
const state=path.join(home,'.local/state/omarchy-jarvis');
let server;
try {
 fs.mkdirSync(path.join(home,'.config/omarchy-jarvis'),{recursive:true});fs.mkdirSync(path.join(home,'bin'));
 fs.writeFileSync(path.join(home,'.config/omarchy-jarvis/config.json'),JSON.stringify({host:'127.0.0.1',port:0,agent:'codex',workDir:home,tunnel:{enabled:false}}));
 fs.writeFileSync(path.join(home,'bin/tailscale'),'#!/bin/sh\nprintf \'{}\\n\'\n',{mode:0o755});
 fs.writeFileSync(path.join(home,'bin/codex'),`#!/usr/bin/env node
let prompt='';process.stdin.on('data',b=>prompt+=b);process.stdin.on('end',()=>{
 if(prompt.includes('QUEUE_FAIL_FIXTURE'))process.exit(1);
 if(prompt.includes('QUEUE_HOLD_FIXTURE')){console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}}));setInterval(()=>{},1000);return;}
 const {execFileSync}=require('node:child_process');
 const run=(...args)=>JSON.parse(execFileSync(process.execPath,[${JSON.stringify(path.join(root,'server/kanban-cli.mjs'))},...args],{encoding:'utf8'}));
 const board=run('add','Agent fixture task');const id=board.tasks.find(t=>t.title==='Agent fixture task').id;
 run('move',id,'doing');run('move',id,'done');
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Board updated by agent tool.'}}));
});`,{mode:0o755});
 const env={...process.env,HOME:home,PATH:path.join(home,'bin')+':'+process.env.PATH};
 server=spawn(process.execPath,[path.join(root,'server/jarvis-server.mjs'),'--http'],{env,stdio:['ignore','pipe','pipe']});
 let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 for(let i=0;i<100&&!logs.includes('listening on');i++)await new Promise(r=>setTimeout(r,50));assert.match(logs,/listening on/);
 const key=fs.readFileSync(path.join(state,'token'),'utf8').trim();
 function api(endpoint,body,auth=true){return new Promise((resolve,reject)=>{
  const req=http.request({socketPath:path.join(state,'serve.sock'),path:endpoint,method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(auth?{'x-jarvis-token':key}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });}
 const tool=(...args)=>{const r=spawnSync(process.execPath,[path.join(root,'server/kanban-cli.mjs'),...args],{env,encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 assert.equal(fs.existsSync(path.join(state,'cert.pem')),false,'explicit HTTP dev bridge has no TLS certificate');
 assert.equal((await api('/api/sudo/pending',undefined,false)).status,401);
 const sudoCapability=await api('/api/sudo/pending');assert.equal(sudoCapability.status,200);assert.deepEqual(JSON.parse(sudoCapability.text),{enabled:false,requests:[]});
 assert.equal((await api('/api/sudo/reply',{id:'fixture',cancel:true})).status,403);
 assert.equal((await api('/api/kanban',undefined,false)).status,401);
 assert.equal((await api('/api/calendar',undefined,false)).status,401);
 assert.equal((await api('/api/notifications',undefined,false)).status,401);
 const calendarInput={action:'create',revision:0,requestId:crypto.randomUUID(),title:'API calendar fixture',notes:'Synthetic description',startAt:new Date(Date.now()+3600000).toISOString(),endAt:new Date(Date.now()+7200000).toISOString(),timeZone:'Europe/Bratislava',reminderMinutes:120,recurrence:'none'};
 const calendarSaved=await api('/api/calendar',calendarInput);assert.equal(calendarSaved.status,200);assert.equal(JSON.parse(calendarSaved.text).events.length,1);
 assert.equal((await api('/api/calendar',{...calendarInput,requestId:crypto.randomUUID()})).status,409);
 assert.equal((await api('/api/calendar',{...calendarInput,revision:1,timeZone:'not/a-zone',requestId:crypto.randomUUID()})).status,400);
 assert.equal(JSON.parse((await api('/api/notifications')).text).items.length,1);
 const first=tool('add','Tool fixture task');const id=first.tasks[0].id;
 assert.equal(tool('move',id,'doing').tasks[0].status,'doing');
 assert.equal(tool('move',id,'done').tasks[0].status,'done');
 assert.equal(tool('delete',id).tasks.length,0);
 const profile=JSON.parse((await api('/api/personality')).text);
 assert.equal((await api('/api/personality',{...profile,assistantName:'Fixture',userName:'Tester',personality:'Be brief.'})).status,200);
 const reply=await api('/api/chat',{text:'Use the task board fixture.'});assert.match(reply.text,/Board updated by agent tool/);
 assert.equal(tool('list').tasks[0].status,'done','real adapter child can update the same board');

 const mutate=async input=>{const current=JSON.parse((await api('/api/kanban')).text);return api('/api/kanban',{revision:current.revision,requestId:crypto.randomUUID(),...input});};
 const waitState=async(id,state)=>{for(let i=0;i<100;i++){const task=JSON.parse((await api('/api/kanban')).text).tasks.find(t=>t.id===id);if(task.execution===state)return task;await new Promise(r=>setTimeout(r,50));}assert.fail('Timed out waiting for '+state);};
 const queued=JSON.parse((await mutate({action:'create',title:'Queued adapter fixture'})).text).tasks.at(-1);
 assert.equal((await mutate({action:'queue',id:queued.id})).status,200);
 const queuedDone=await waitState(queued.id,'completed');assert.equal(queuedDone.status,'done');assert.equal(queuedDone.attempts,1);
 assert.equal(JSON.parse((await api('/api/history')).text).activity.phase,'completed');
 const failing=JSON.parse((await mutate({action:'create',title:'QUEUE_FAIL_FIXTURE'})).text).tasks.at(-1);
 await mutate({action:'queue',id:failing.id});assert.equal((await waitState(failing.id,'failed')).attempts,1);
 const holding=JSON.parse((await mutate({action:'create',title:'QUEUE_HOLD_FIXTURE'})).text).tasks.at(-1);
 await mutate({action:'queue',id:holding.id});await waitState(holding.id,'running');
 for(let i=0;i<100;i++){if(JSON.parse((await api('/api/history')).text).activity?.phase==='working')break;await new Promise(r=>setTimeout(r,20));}
 const activity=JSON.parse((await api('/api/history')).text).activity;
 assert.equal(activity.source,'kanban');assert.equal(activity.phase,'working');assert.equal(activity.task.id,holding.id);
 assert.equal(JSON.parse((await api('/api/status')).text).activity.phase,'working');
 assert.equal((await mutate({action:'queue',id:holding.id})).status,409);
 assert.equal((await api('/api/chat',{text:'concurrent request'})).status,409,'board run uses shared chat lock');
 assert.equal((await api('/api/kanban/stop',{id:holding.id})).status,202);await waitState(holding.id,'interrupted');assert.equal(JSON.parse((await api('/api/history')).text).activity.phase,'interrupted');
 assert.equal((await api('/api/kanban/backup',undefined,false)).status,401);
 assert.equal((await api('/favicon.ico',undefined,false)).status,200);
 const manifest=JSON.parse((await api('/manifest.webmanifest')).text);for(const icon of manifest.icons){const response=await api(icon.src,undefined,false);assert.equal(response.status,200);assert.equal(response.headers['content-type'],'image/png');}
 assert.equal((await api('/api/voice-setup',undefined,false)).status,401);
 assert.equal((await api('/api/voice-setup',{consent:true},false)).status,401);
 const setup=await api('/api/voice-setup');assert.equal(JSON.parse(setup.text).job.state,'idle');
 assert.equal((await api('/api/voice-setup',{consent:false})).status,400);
 const voiceDir=path.join(home,'fixture-models');fs.mkdirSync(voiceDir);
 fs.writeFileSync(path.join(voiceDir,'model.bin'),'fixture');fs.writeFileSync(path.join(voiceDir,'voice.onnx'),'fixture');fs.writeFileSync(path.join(voiceDir,'voice.onnx.json'),'{}');
 assert.equal((await api('/api/voice-settings',{stt:{modelPath:path.join(voiceDir,'model.bin')},tts:{modelPath:path.join(voiceDir,'voice.onnx')}})).status,200);
 const reused=await api('/api/voice-setup',{consent:true});assert.equal(reused.status,202);assert.equal(JSON.parse(reused.text).job.state,'complete');

 assert.ok(!logs.includes(key));
 console.log('PASS: private socket CLI CRUD, no dev certificate needed, adapter board updates, authenticated setup and consent refusal.');
}finally{if(server&&server.exitCode===null){const done=once(server,'exit');server.kill('SIGTERM');await done;}fs.rmSync(home,{recursive:true,force:true});}
