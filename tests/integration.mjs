import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
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
 if(prompt.includes('slow request')) { setTimeout(()=>process.exit(),30000); return; }
 console.log(JSON.stringify({type:'thread.started',thread_id:'integration-session'}));
 console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text:'Hello from the test agent.'}}));
});
`,{mode:0o755});
const env={...process.env,HOME:home,PATH:path.join(home,'bin')+':'+process.env.PATH};
let server=spawn(process.execPath,[path.join(root,'server/jarvis-server.mjs')],{env,stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
let helper;
function api(endpoint,body,auth=true){return new Promise((resolve,reject)=>{
const req=https.request({hostname:'127.0.0.1',servername:'localhost',port,path:endpoint,method:body===undefined?'GET':'POST',ca:fs.readFileSync(path.join(state,'cert.pem')),headers:auth?{'x-jarvis-token':fs.readFileSync(path.join(state,'token'),'utf8').trim(),'content-type':'application/json'}:{}},res=>{let text='';res.setEncoding('utf8');res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}
try {
for(let i=0;i<100&&!logs.includes('listening on');i++)await new Promise(r=>setTimeout(r,50));
assert.match(logs,/listening on/);
assert.equal((await api('/api/history',undefined,false)).status,401);
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
assert.deepEqual(JSON.parse((await api('/api/history')).text).messages,[]);
const reply=await api('/api/chat',{text:'hello'});
assert.match(reply.text,/Hello from the test agent/);
assert.equal(JSON.parse((await api('/api/history')).text).messages.length,2);
assert.equal(JSON.parse((await api('/api/status')).text).agent.access,'Full access');
const exit=once(server,'exit');server.kill('SIGTERM');await exit;
server=spawn(process.execPath,[path.join(root,'server/jarvis-server.mjs')],{env,stdio:['ignore','pipe','pipe']});logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
for(let i=0;i<100&&!logs.includes('listening on');i++)await new Promise(r=>setTimeout(r,50));
assert.equal(JSON.parse((await api('/api/history')).text).messages.length,2);
helper=spawn(process.execPath,[path.join(root,'server/desktop.mjs')],{env,stdio:['pipe','pipe','pipe']});
let output='';let errors='';helper.stdout.on('data',b=>output+=b);helper.stderr.on('data',b=>errors+=b);
helper.stdin.write(JSON.stringify({action:'send',text:'desktop hello'})+'\n');
for(let i=0;i<100&&!output.includes('"event":"done"');i++)await new Promise(r=>setTimeout(r,50));
assert.match(output,/"event":"done"/,errors+output);
assert.match(output,/Hello from the test agent/);
assert.equal(JSON.parse((await api('/api/history')).text).messages.length,4);
const pending = api('/api/chat', {text:'slow request'});
for(let i=0;i<100;i++){ if(JSON.parse((await api('/api/status')).text).chatBusy)break; await new Promise(r=>setTimeout(r,20)); }
assert.equal((await api('/api/session/reset',{})).status,409);
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
console.log('PASS: authentication, chat streaming, shared persistent history, desktop pinned TLS, reset, cross-device Stop, concurrent-request rejection, and full QR decode.');
} catch(error){console.error(logs);throw error;} finally {helper?.kill('SIGTERM');const stopped=server.exitCode===null?once(server,'exit'):Promise.resolve();server.kill('SIGTERM');await stopped;fs.rmSync(home,{recursive:true,force:true});}
