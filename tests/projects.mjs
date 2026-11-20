import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createProjects} from '../server/lib/projects.mjs';
const repo=path.resolve(import.meta.dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-projects-'));
let bridge;
try {
 const unit=path.join(temp,'unit');
 let projects=createProjects(unit,{validateRoot:id=>id==='approved'});
 assert.equal(projects.active(),null);
 assert.throws(()=>projects.update({revision:0,action:'create',name:'Rejected',rootIds:['unknown']}),e=>e.status===403);
 projects.update({revision:0,action:'create',name:'Alpha',rootIds:['approved']});
 const projectId=projects.view().projects[0].id;
 projects.update({revision:1,action:'select',id:projectId});
 projects.linkConversation('existing-chat');
 projects=createProjects(unit,{validateRoot:id=>id==='approved'});
 assert.equal(projects.active(),projectId);assert.equal(projects.association('existing-chat'),projectId);
 assert.equal(projects.association('legacy-chat'),null);
 assert.throws(()=>projects.checkContext(null),e=>e.status===409);
 assert.equal(fs.statSync(path.join(unit,'projects.json')).mode&0o777,0o600);
 const home=path.join(temp,'home'),work=path.join(temp,'work'),other=path.join(temp,'other'),bin=path.join(temp,'bin');
 for(const dir of [path.join(home,'.config/omarchy-jarvis'),work,other,bin])fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(home,'.config/omarchy-jarvis/config.json'),JSON.stringify({host:'127.0.0.1',port:0,agent:'codex',workDir:work,tunnel:{enabled:false}}));
 for(const tool of ['tailscale','systemctl'])fs.writeFileSync(path.join(bin,tool),"#!/bin/sh\nprintf '{}\\n'\n",{mode:0o755});
 fs.writeFileSync(path.join(bin,'codex'),`#!/usr/bin/env node
let text='';process.stdin.on('data',b=>text+=b);process.stdin.on('end',()=>{if(text.includes('HOLD_PROJECT_FIXTURE')){setInterval(()=>{},1000);return;}console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Project fixture response'}}));});`,{mode:0o755});
 const state=path.join(home,'.local/state/omarchy-jarvis');
 async function start(){
  bridge=spawn(process.execPath,[path.join(repo,'server/jarvis-server.mjs'),'--http'],{env:{...process.env,HOME:home,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  let logs='';bridge.stdout.on('data',b=>logs+=b);bridge.stderr.on('data',b=>logs+=b);
  for(let i=0;i<150&&!logs.includes('listening on');i++)await new Promise(r=>setTimeout(r,40));
  assert.match(logs,/listening on/,'fixture bridge starts');
 }
 async function stop(){const ended=once(bridge,'exit');bridge.kill('SIGTERM');await ended;bridge=null;}
 await start();
 const token=fs.readFileSync(path.join(state,'token'),'utf8').trim();
 function api(endpoint,body,auth=true){return new Promise((resolve,reject)=>{const req=http.request({socketPath:path.join(state,'serve.sock'),path:endpoint,method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(auth?{'x-jarvis-token':token}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{let data;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,data,text});});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}
 async function project(input){const current=(await api('/api/projects')).data;return api('/api/projects',{revision:current.revision,...input});}
 async function task(input){const current=(await api('/api/kanban')).data;return api('/api/kanban',{revision:current.revision,...input});}
 assert.equal((await api('/api/projects',undefined,false)).status,401);
 const profile=(await api('/api/personality')).data;assert.equal((await api('/api/personality',{...profile,assistantName:'Fixture',userName:'Tester',personality:'Be brief.'})).status,200);
 const root=(await api('/api/files',{action:'approve',confirm:true})).data.roots[0].id;
 const reviewed=(await api('/api/files',{action:'reviewRoot',path:other})).data;
 const roots=(await api('/api/files',{action:'approve',path:reviewed.path,identity:reviewed.identity,confirm:true})).data.roots;
 const otherRoot=roots.find(r=>r.id!==root).id;
 assert.equal((await project({action:'create',name:'Invalid',rootIds:['unknown']})).status,403);
 assert.equal((await task({action:'create',title:'Legacy task',notes:'Keep existing ungrouped data.'})).status,200);
 assert.equal((await api('/api/chat',{text:'Legacy conversation fixture'})).status,200);
 const legacyChat=(await api('/api/conversations')).data.conversations[0].id;
 const created=await project({action:'create',name:'Alpha',rootIds:[root]});assert.equal(created.status,200);
 const alpha=created.data.projects[0].id;
 assert.equal((await project({action:'select',id:alpha})).status,200);
 assert.deepEqual((await api('/api/kanban?scope=active')).data.tasks,[]);
 assert.deepEqual((await api('/api/history')).data.messages,[]);
 assert.equal((await api('/api/conversations?id='+legacyChat)).status,404);
 assert.equal((await api('/api/files',{action:'list',root:otherRoot})).status,403);
 assert.equal((await api('/api/files',{action:'reviewRoot',path:other})).status,200);
 assert.equal((await task({action:'create',title:'Stale task',projectContext:null})).status,409);
 const saved=await task({action:'create',title:'Alpha task',notes:'Verify project association.',projectContext:alpha});assert.equal(saved.status,200);assert.equal(saved.data.tasks[0].projectId,alpha);
 assert.equal((await api('/api/chat',{text:'Alpha conversation fixture',projectContext:alpha})).status,200);
 const alphaChat=(await api('/api/conversations?scope=active')).data.conversations[0];assert.equal(alphaChat.projectId,alpha);
 await stop();await start();assert.equal((await api('/api/projects')).data.activeId,alpha);
 assert.equal((await api('/api/conversations?scope=active')).data.conversations[0].id,alphaChat.id);
 const holding=api('/api/chat',{text:'HOLD_PROJECT_FIXTURE',projectContext:alpha});
 for(let i=0;i<100;i++){if((await api('/api/history')).data.busy)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal((await project({action:'select',id:null})).status,409);
 await api('/api/chat/stop',{});await holding;
 for(let i=0;i<100&&(await api('/api/history')).data.busy;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal((await project({action:'select',id:null})).status,200);
 assert.equal((await api('/api/kanban?scope=active')).data.tasks[0].title,'Legacy task');
 assert.ok((await api('/api/conversations?scope=active')).data.conversations.some(c=>c.id===legacyChat));
 assert.equal((await project({action:'associateConversation',id:legacyChat,projectId:alpha})).status,200);
 assert.equal((await project({action:'select',id:alpha})).status,200);
 assert.ok((await api('/api/conversations?scope=active')).data.conversations.some(c=>c.id===legacyChat));
 const runTask=(await task({action:'create',title:'HOLD_PROJECT_FIXTURE',notes:'Hold fixture execution for project switch conflict.'})).data.tasks.at(-1);
 assert.equal((await task({action:'queue',id:runTask.id})).status,200);
 assert.equal((await project({action:'select',id:null})).status,409);
 await api('/api/kanban/stop',{id:runTask.id});
 console.log('PASS projects: approved roots, auth, stale context, task/chat/file association, migration, restart persistence, active chat switching conflict, conversation reassignment.');
} finally {if(bridge&&bridge.exitCode===null&&bridge.signalCode===null){const ended=once(bridge,'exit');bridge.kill('SIGTERM');await ended;}fs.rmSync(temp,{recursive:true,force:true});}
