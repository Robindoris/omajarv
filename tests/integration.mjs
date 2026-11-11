import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { publicEncrypt, constants } from 'node:crypto';
const root=path.resolve(import.meta.dirname, "..");
const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-integration-'));
const port=44319;
const state=path.join(home,'.local/state/omarchy-jarvis');
const cfg=path.join(home,'.config/omarchy-jarvis');
fs.mkdirSync(cfg,{recursive:true});
fs.mkdirSync(path.join(home,'bin'));
fs.writeFileSync(path.join(cfg,'config.json'),JSON.stringify({port,host:'127.0.0.1',agent:'codex',codexFullAccess:true,workDir:home,tunnel:{enabled:false},stt:{engine:'cli'}}));
fs.writeFileSync(path.join(home,'bin/codex'),`#!/usr/bin/env node
let prompt='';
process.stdin.on('data',chunk=>prompt+=chunk);
process.stdin.on('end',()=>{
 require('fs').writeFileSync(process.env.HOME + '/agent-prompt', prompt);
 require('fs').writeFileSync(process.env.HOME + '/agent-args', JSON.stringify(process.argv));
 if(prompt.includes('privacy failure request')) { console.error(prompt);process.exit(1); }
 if(prompt.includes('sudo fixture request') || prompt.includes('sudo finish early request')) {
  const fs=require('fs'),path=require('path');
  const wrapper=path.join(process.env.PATH.split(path.delimiter)[0],'sudo');
  const capability=JSON.parse(fs.readFileSync(wrapper,'utf8').match(/await runSudo\\((\\{.*\\}), process/)[1]);
  const child=require('child_process').spawn(process.execPath,[process.env.HOME+'/fake-sudo.cjs'],{env:{...process.env,JARVIS_SUDO_SOCKET:capability.socketPath,JARVIS_SUDO_TICKET:capability.ticket},stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();
  if(prompt.includes('sudo finish early request')) {
   setInterval(()=>{if(fs.existsSync(process.env.HOME+'/finish-agent')){
    console.log(JSON.stringify({type:'item.completed',item:{id:'early-reply',type:'agent_message',text:'Authorization pending.'}}));process.exit(0);
   }},10);return;
  }
  child.on('exit',code=>{
   if(code)process.exit(code);
   console.log(JSON.stringify({type:'item.completed',item:{id:'sudo-reply',type:'agent_message',text:'Privileged fixture completed.'}}));
  });return;
 }
 if(prompt.includes('slow request')) { setTimeout(()=>process.exit(),30000); return; }
 console.log(JSON.stringify({type:'thread.started',thread_id:'integration-session'}));
 console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text:'Hello from the test agent.'}}));
});
`,{mode:0o755});
fs.writeFileSync(path.join(home,'fake-sudo.cjs'),`
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,[${JSON.stringify(path.join(root,'server/sudo-askpass.mjs'))}],{env:{...process.env,JARVIS_SUDO_COMMAND:'sudo "fixture-command"',JARVIS_SUDO_CWD:process.env.HOME},stdio:['ignore','pipe','pipe']});
let password='';child.stdout.on('data',data=>password+=data);child.stderr.resume();
child.on('exit',code=>{const ok=code===0&&password==='integration-sudo-fixture\\n';password='';process.exit(ok?0:1);});
`);
fs.writeFileSync(path.join(home,'selected.txt'),'DESKTOP_FILE_FIXTURE');
fs.writeFileSync(path.join(home,'bin/zenity'),`#!/usr/bin/env node
console.log(process.env.HOME+'/selected.txt');
`,{mode:0o755});
fs.writeFileSync(path.join(home,'bin/wl-paste'),`#!/usr/bin/env node
if(process.argv.includes('--list-types')) console.log('image/png');
else process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
`,{mode:0o755});
fs.writeFileSync(path.join(home,'bin/tailscale'),'#!/bin/sh\nprintf \'{}\\n\'\n',{mode:0o755});
const env={...process.env,HOME:home,PATH:path.join(home,'bin')+':'+process.env.PATH};
let server=spawn(process.execPath,[path.join(root,'server/jarvis-server.mjs')],{env,stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
let helper;
function api(endpoint,body,auth=true){return new Promise((resolve,reject)=>{
const req=https.request({hostname:'127.0.0.1',servername:'localhost',port,path:endpoint,method:body===undefined?'GET':'POST',ca:fs.readFileSync(path.join(state,'cert.pem')),headers:auth?{'x-jarvis-token':fs.readFileSync(path.join(state,'token'),'utf8').trim(),'content-type':'application/json'}:{}},res=>{let text='';res.setEncoding('utf8');res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));});req.on('error',reject);req.end(body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body));});}
try {
for(let i=0;i<100&&!logs.includes('listening on');i++)await new Promise(r=>setTimeout(r,50));
assert.match(logs,/listening on/);
for(const endpoint of ['/api/kanban','/api/status','/api/theme','/api/health','/api/personality','/api/history','/api/sudo/pending','/api/models']){
 assert.equal((await api(endpoint,undefined,false)).status,401,endpoint);
}
for(const endpoint of ['/api/kanban','/api/attachments?name=test.txt','/api/attachments/remove','/api/chat','/api/chat/stop','/api/session/reset','/api/personality','/api/stt','/api/tts','/api/sudo/reply','/api/agent/model']){
 assert.equal((await api(endpoint,{},false)).status,401,endpoint);
}
const privateHeaders=(await api('/api/history')).headers;
assert.equal(privateHeaders['cache-control'],'no-store');
assert.equal(privateHeaders['referrer-policy'],'no-referrer');
assert.match(privateHeaders['content-security-policy'],/connect-src 'self'/);
assert.match(privateHeaders['content-security-policy'],/frame-ancestors 'none'/);
assert.equal((await api('/api/history',undefined,false)).status,401);
assert.equal((await api('/api/sudo/pending',undefined,false)).status,401);
const emptyBoard=JSON.parse((await api('/api/kanban')).text);
assert.equal(emptyBoard.tasks.length,0);
const tool=spawnSync(process.execPath,[path.join(root,'server/kanban-cli.mjs'),'list'],{env,encoding:'utf8',timeout:15000});
assert.equal(tool.status,0,tool.stderr);
assert.deepEqual(JSON.parse(tool.stdout),emptyBoard);
const createdTask=await api('/api/kanban',{action:'create',title:'Fixture task',revision:0});
assert.equal(createdTask.status,200);
assert.equal((await api('/api/kanban',{action:'create',title:'Stale task',revision:0})).status,409);
const taskBoard=JSON.parse(createdTask.text);
assert.equal((await api('/api/kanban',{action:'move',id:taskBoard.tasks[0].id,status:'doing',revision:1})).status,200);
assert.equal((await api('/api/sudo/reply',{id:'fake',ciphertext:'fake'},false)).status,401);
assert.equal((await api('/api/sudo/reply',{id:'fake',password:'never accepted'})).status,409);
assert.equal((await api('/',undefined,false)).status,401);
assert.equal((await api('/?k=incorrect',undefined,false)).status,401);
const privateToken=fs.readFileSync(path.join(state,'token'),'utf8').trim();
assert.ok(!(await api('/',undefined,false)).text.includes(privateToken));
assert.ok(!logs.includes(privateToken),'Access token must not be logged');
assert.equal(fs.statSync(path.join(state,'token')).mode & 0o777,0o600);
assert.equal(fs.statSync(state).mode & 0o777,0o700);
assert.match((await api('/?k='+privateToken)).text,/JARVIS|J\.A\.R\.V\.I\.S/);

assert.equal((await api('/api/theme',undefined,false)).status,401);
const themeDir=path.join(home,'.local/state/omarchy/current/theme');
fs.mkdirSync(themeDir,{recursive:true});
fs.writeFileSync(path.join(themeDir,'colors.toml'),'background = "#101315"\nforeground = "#cacccc"\naccent = "#6567EC"\n');
const themeA=JSON.parse((await api('/api/theme')).text);
assert.equal(themeA.palette.core,'#6567EC');
assert.match((await api('/theme.css',undefined,false)).text,/--core: #6567EC/);
fs.writeFileSync(path.join(themeDir,'colors.toml'),'mode = "light"\nbackground = "#fafafa"\nforeground = "#151515"\naccent = "#336688"\n');
const themeB=JSON.parse((await api('/api/theme')).text);
assert.equal(themeB.mode,'light');
assert.notEqual(themeA.revision,themeB.revision);

assert.equal((await api('/manifest.webmanifest',undefined,false)).status,401);
const manifestResponse = await api('/manifest.webmanifest');
assert.equal(manifestResponse.status,200);
const manifest = JSON.parse(manifestResponse.text);
assert.equal(manifest.id,'/');
assert.equal(manifest.display,'standalone');
assert.equal(new URL(manifest.start_url, 'https://jarvis.test').searchParams.get('k'),fs.readFileSync(path.join(state,'token'),'utf8').trim());
for(const icon of manifest.icons) assert.equal((await api(icon.src,undefined,false)).status,200);
assert.equal((await api('/sw.js',undefined,false)).status,200);
assert.equal((await api('/api/personality',undefined,false)).status,401);
assert.equal((await api('/api/personality',{},false)).status,401);
let profile=JSON.parse((await api('/api/personality')).text);
assert.equal(profile.stage,'assistantName');
assert.match(JSON.parse((await api('/api/history')).text).messages[0].text,/name your assistant/);
assert.equal((await api('/api/chat',{text:'stale answer',profileRevision:999})).status,409);
for (const [answer,nextStage] of [['Nova','personality'],['Be friendly, direct and answer in Slovak.','userName'],['Alex','complete']]) {
 const response=await api('/api/chat',{text:answer,profileRevision:profile.revision});
 assert.equal(response.status,200,response.text);
 assert.match(response.text,/event: done/);
 profile=JSON.parse((await api('/api/personality')).text);
 assert.equal(profile.stage,nextStage);
}
assert.equal(fs.existsSync(path.join(home,'agent-prompt')),false,'onboarding must not invoke the agent');
assert.equal(fs.statSync(path.join(state,'personality.json')).mode & 0o777,0o600);
assert.equal((await api('/api/personality',{...profile,personality:''})).status,400);
assert.equal((await api('/api/personality',{...profile,revision:0})).status,409);
await api('/api/session/reset',{});

assert.deepEqual(JSON.parse((await api('/api/history')).text).messages,[]);
const reply=await api('/api/chat',{text:'hello'});
assert.match(reply.text,/Hello from the test agent/);
assert.match(fs.readFileSync(path.join(home,'agent-prompt'),'utf8'),/Your name is Nova/);
assert.match(fs.readFileSync(path.join(home,'agent-prompt'),'utf8'),/Alex/);
assert.match(fs.readFileSync(path.join(home,'agent-prompt'),'utf8'),/answer in Slovak/);
assert.equal(JSON.parse((await api('/api/history')).text).messages.length,2);
assert.equal(JSON.parse((await api('/api/status')).text).agent.access,'Full access');
assert.equal(JSON.parse((await api('/api/status')).text).agent.modelSelectable,false);
const modelListing=JSON.parse((await api('/api/models')).text);
assert.equal(modelListing.listed,false);
assert.deepEqual(modelListing.models,[]);
assert.equal((await api('/api/agent/model',{model:'openai/never-model'})).status,400);
const clearedModel=JSON.parse((await api('/api/agent/model',{model:''})).text);
assert.equal(clearedModel.ok,true);
const exit=once(server,'exit');server.kill('SIGTERM');await exit;
server=spawn(process.execPath,[path.join(root,'server/jarvis-server.mjs')],{env,stdio:['ignore','pipe','pipe']});logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
for(let i=0;i<100&&!logs.includes('listening on');i++)await new Promise(r=>setTimeout(r,50));
assert.equal(JSON.parse((await api('/api/history')).text).messages.length,2);
helper=spawn(process.execPath,[path.join(root,'server/desktop.mjs')],{env,stdio:['pipe','pipe','pipe']});
let output='';let errors='';helper.stdout.on('data',b=>output+=b);helper.stderr.on('data',b=>errors+=b);
helper.stdin.write('{"action":"personality"}\n');
for(let i=0;i<100&&!output.includes('"event":"personality"');i++)await new Promise(r=>setTimeout(r,20));
assert.match(output,/Nova/);
profile=JSON.parse((await api('/api/personality')).text);
helper.stdin.write(JSON.stringify({action:'savePersonality',profile:{...profile,personality:'Be playful and brief.'}})+'\n');
for(let i=0;i<100&&!output.includes('"saved":true');i++)await new Promise(r=>setTimeout(r,20));
assert.match(output,/"saved":true/);
assert.equal(JSON.parse((await api('/api/personality')).text).personality,'Be playful and brief.');
helper.stdin.write(JSON.stringify({action:'send',text:'desktop hello'})+'\n');
for(let i=0;i<100&&!output.includes('"event":"done"');i++)await new Promise(r=>setTimeout(r,50));
assert.match(output,/"event":"done"/,errors+output);
assert.match(output,/Hello from the test agent/);
assert.equal(JSON.parse((await api('/api/history')).text).messages.length,4);
// Authenticated raw upload, opaque references, agent delivery, deletion and reset.
const upload=await api('/api/attachments?name=fixture.txt',Buffer.from('ATTACHMENT_PRIVATE_FIXTURE'));
assert.equal(upload.status,200,upload.text);
const uploaded=JSON.parse(upload.text);
assert.ok(uploaded.id); assert.equal(uploaded.path,undefined);
assert.equal((await api('/api/attachments?name=..%2Fevil',Buffer.from('x'))).status,400);
assert.equal((await api('/api/chat',{text:'inspect',attachments:['/etc/passwd']})).status,400);
assert.equal((await api('/api/chat',{text:'inspect',attachments:[uploaded.id,uploaded.id]})).status,400);
const attachmentReply=await api('/api/chat',{attachments:[uploaded.id]});
assert.match(attachmentReply.text,/event: done/);
const attachmentPrompt=fs.readFileSync(path.join(home,'agent-prompt'),'utf8');
assert.match(attachmentPrompt,/fixture.txt/);
assert.match(attachmentPrompt,/untrusted data/);
assert.ok(!attachmentPrompt.includes('ATTACHMENT_PRIVATE_FIXTURE'));
const metadata=JSON.parse(attachmentPrompt.split('JSON metadata):\n')[1].split('\n')[0]);
assert.equal(fs.readFileSync(metadata[0].path,'utf8'),'ATTACHMENT_PRIVATE_FIXTURE');
assert.equal((await api('/api/attachments/remove',{id:uploaded.id})).status,409);
assert.equal((await api('/'+uploaded.id)).status,404);
const disposable=JSON.parse((await api('/api/attachments?name=remove.txt',Buffer.from('x'))).text);
assert.equal((await api('/api/attachments/remove',{id:disposable.id})).status,200);
assert.equal((await api('/api/chat',{attachments:[disposable.id]})).status,400);
await api('/api/session/reset',{});
const savedChats=JSON.parse((await api('/api/conversations')).text).conversations;
assert.ok(savedChats.some(chat=>!chat.active),'Starting a new chat must preserve old conversations');
const oldChat=JSON.parse((await api('/api/conversations?id='+encodeURIComponent(savedChats.find(chat=>!chat.active).id))).text);
assert.ok(oldChat.messages.length>0);
if(!process.env.JARVIS_DATABASE_URL)assert.equal(fs.statSync(path.join(state,'conversations.json')).mode & 0o777,0o600);
else {
  assert.ok(oldChat.messages.every(message=>message.id),'PostgreSQL messages retain stable IDs');
  const snapshots=fs.readdirSync(path.join(state,'memory-backups'));
  assert.ok(snapshots.length>0);
  assert.equal(fs.statSync(path.join(state,'memory-backups',snapshots[0])).mode & 0o777,0o600);
}
assert.equal((await api('/api/conversations',undefined,false)).status,401);

assert.equal(fs.existsSync(metadata[0].path),false);
assert.equal((await api('/api/chat',{attachments:[uploaded.id]})).status,400);
async function desktopAction(action) {
 output=''; helper.stdin.write(JSON.stringify(action)+'\n');
 for(let i=0;i<100&&!output.includes('"state":"Ready"');i++) await new Promise(r=>setTimeout(r,25));
 assert.match(output, /"state":"Ready"/,output);
 assert.ok(!output.includes('"event":"error"'),output);
 return output.split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
let desktopEvents=await desktopAction({action:'attachFiles'});
assert.equal(desktopEvents.find(e=>e.event==='attachments').files[0].name,'selected.txt');
desktopEvents=await desktopAction({action:'pasteClipboard',imageOnly:true});
const desktopFiles=desktopEvents.find(e=>e.event==='attachments').files;
assert.equal(desktopFiles.length,2);
assert.equal(desktopFiles[1].type,'image');
await desktopAction({action:'send',text:'Inspect desktop files and image'});
assert.match(fs.readFileSync(path.join(home,'agent-prompt'),'utf8'),/selected.txt/);
assert.match(fs.readFileSync(path.join(home,'agent-args'),'utf8'),/--image/);
await desktopAction({action:'reset'});
const auditProfile=JSON.parse((await api('/api/personality')).text);
const promptMarker='PRIVATE_PERSONALITY_AUDIT_FIXTURE';
await api('/api/personality',{...auditProfile,personality:promptMarker});
assert.ok(!('personality' in JSON.parse((await api('/api/history')).text).profile),'Routine history polling must not resend the personality prompt');
const failure=await api('/api/chat',{text:'privacy failure request PRIVATE_REQUEST_AUDIT_FIXTURE'});
assert.match(failure.text,/Check its provider and permissions/);
assert.ok(!failure.text.includes(promptMarker));
assert.ok(!failure.text.includes('PRIVATE_REQUEST_AUDIT_FIXTURE'));
assert.ok(!logs.includes(promptMarker));
assert.ok(!logs.includes('PRIVATE_REQUEST_AUDIT_FIXTURE'));
const savedHistory=process.env.JARVIS_DATABASE_URL?JSON.parse((await api('/api/history')).text).messages:JSON.parse(fs.readFileSync(path.join(state,'history.json'),'utf8'));
assert.ok(!JSON.stringify(savedHistory).includes(promptMarker));
assert.ok(!('personality' in JSON.parse((await api('/api/history')).text).profile));
const nextProfile=JSON.parse((await api('/api/personality')).text);
await api('/api/personality',{...nextProfile,personality:auditProfile.personality});
await api('/api/session/reset',{});
const sudoTurn=api('/api/chat',{text:'sudo fixture request'});
let sudoRequest;
for(let i=0;i<200;i++){
 const requests=JSON.parse((await api('/api/sudo/pending')).text).requests;
 if(requests.length){sudoRequest=requests[0];break;}
 await new Promise(resolve=>setTimeout(resolve,20));
}
assert.ok(sudoRequest,'Fake sudo should wait for phone authorization');
assert.equal((await api('/api/sudo/reply',{id:sudoRequest.id,password:'never accepted'})).status,409);
const ciphertext=publicEncrypt({key:sudoRequest.publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from('integration-sudo-fixture')).toString('base64');
assert.equal((await api('/api/sudo/reply',{id:sudoRequest.id,ciphertext})).status,200);
assert.equal((await api('/api/sudo/reply',{id:sudoRequest.id,ciphertext})).status,409);
const sudoResult=await sudoTurn;
assert.match(sudoResult.text,/Privileged fixture completed/);
assert.ok(!sudoResult.text.includes('integration-sudo-fixture'));
assert.ok(!(await api('/api/history')).text.includes('integration-sudo-fixture'));
assert.ok(!logs.includes('integration-sudo-fixture'));
assert.ok(!fs.readFileSync(path.join(home,'agent-prompt'),'utf8').includes('integration-sudo-fixture'));
assert.deepEqual(JSON.parse((await api('/api/sudo/pending')).text).requests,[]);
let earlyFinished=false;
const earlyTurn=api('/api/chat',{text:'sudo finish early request'}).then(response=>{earlyFinished=true;return response;});
sudoRequest=null;
for(let i=0;i<200;i++){
 const requests=JSON.parse((await api('/api/sudo/pending')).text).requests;
 if(requests.length){sudoRequest=requests[0];break;}
 await new Promise(resolve=>setTimeout(resolve,20));
}
assert.ok(sudoRequest);
fs.writeFileSync(path.join(home,'finish-agent'),'yes');
await new Promise(resolve=>setTimeout(resolve,100));
assert.equal(earlyFinished,false,'Finishing the model reply must not close an outstanding approval');
assert.equal(JSON.parse((await api('/api/sudo/pending')).text).requests.length,1);
const earlyCiphertext=publicEncrypt({key:sudoRequest.publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from('integration-sudo-fixture')).toString('base64');
assert.equal((await api('/api/sudo/reply',{id:sudoRequest.id,ciphertext:earlyCiphertext})).status,200);
assert.match((await earlyTurn).text,/Authorization pending/);
const pending = api('/api/chat', {text:'slow request'});
for(let i=0;i<100;i++){ if(JSON.parse((await api('/api/status')).text).chatBusy)break; await new Promise(r=>setTimeout(r,20)); }
assert.equal((await api('/api/session/reset',{})).status,409);
assert.equal((await api('/api/personality',{...profile,revision:profile.revision+1})).status,409);
assert.equal((await api('/api/chat',{text:'second request'})).status,409);
assert.equal((await api('/api/chat/stop',{})).status,200);
assert.match((await pending).text,/Stopped/);
assert.equal(JSON.parse((await api('/api/status')).text).chatBusy,false);
helper.stdin.write('{"action":"reset"}\n');
for(let i=0;i<100;i++){if(JSON.parse((await api('/api/history')).text).messages.length===0)break;await new Promise(r=>setTimeout(r,20));}
assert.equal(JSON.parse((await api('/api/history')).text).messages.length,0);
// The QR encoder's raster must decode to its complete authenticated URL.
const qr=spawnSync('bash',[path.join(root,'bin/jarvis'),'qr','--json','--lan'],{env,encoding:'utf8'});
assert.equal(qr.status,0,qr.stderr);
const payload=JSON.parse(qr.stdout);
assert.equal(payload.matrix.length,payload.size);
assert.ok(payload.matrix.every(row=>row.length===payload.size));
fs.writeFileSync(path.join(home,'qr.png'),Buffer.from(payload.image.split(',')[1],'base64'));
const decoded=spawnSync('zbarimg',['--quiet','--raw',path.join(home,'qr.png')],{encoding:'utf8'});
assert.equal(decoded.stdout.trim(),payload.url);
console.log('PASS: authenticated attachments, desktop file picker/clipboard/image delivery, personality/onboarding, encrypted sudo API with no password in model/history/logs, streaming, pinned TLS, reset, Stop and QR decode.');
} catch(error){console.error(logs);throw error;} finally {helper?.kill('SIGTERM');const stopped=server.exitCode===null?once(server,'exit'):Promise.resolve();server.kill('SIGTERM');await stopped;fs.rmSync(home,{recursive:true,force:true});}
