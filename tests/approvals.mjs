// Approval transport tests: broker lifecycle, Hermes ACP forwarding, bridge routes and inbox UI.
// Run browser stage: JARVIS_APPROVALS_BROWSER=1 node tests/approvals.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createApprovalBroker} from '../server/lib/approvals.mjs';
import {runHermes} from '../server/lib/hermes.mjs';
const repo=path.resolve(import.meta.dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// 1) Broker decisions stay distinguishable after the fact.
{
 const broker=createApprovalBroker({timeoutMs:80});
 const p=broker.request({source:'chat',toolCall:{title:'Edit report.txt',kind:'edit',rawInput:{command:'patch report.txt'},locations:[{path:'report.txt'}]},options:[{optionId:'a',kind:'allow_once',name:'Allow once'},{optionId:'r',kind:'reject_once',name:'Reject'}]});
 const listed=broker.list();assert.equal(listed.requests.length,1);assert.equal(listed.requests[0].summary,'Edit report.txt');
 assert.equal(listed.requests[0].deliveredAt!==null,true,'A read marks the prompt delivered');
 assert.deepEqual(broker.reply({id:'missing',decision:'approve'}),{ok:false,status:404,error:'Approval request not found.'});
 assert.equal(broker.reply({id:listed.requests[0].id,decision:'maybe'}).status,400);
 assert.equal(broker.reply({id:listed.requests[0].id,decision:'approve',optionId:'a'}).ok,true);
 assert.deepEqual(await p,{outcome:'selected',optionId:'a'});
 const dupe=broker.reply({id:listed.requests[0].id,decision:'reject'});
 assert.equal(dupe.status,409);assert.equal(dupe.outcome,'approved','Duplicate replies report the first decision');
 assert.equal(broker.list().history[0].outcome,'approved');

 const p2=broker.request({source:'kanban',task:{id:'t1',title:'Fix thing'},options:[{optionId:'a',kind:'allow_once'}],toolCall:{title:'Run command'}});
 broker.list();
 assert.equal(broker.reply({id:broker.list().requests[0].id,decision:'reject'}).ok,true);
 assert.deepEqual(await p2,{outcome:'cancelled'});
 assert.equal(broker.list().history[0].outcome,'rejected');

 const seen=broker.request({source:'chat',options:[{optionId:'a',kind:'allow_once'}]});
 broker.list();await sleep(140);assert.deepEqual(await seen,{outcome:'cancelled'});
 assert.equal(broker.list().history.find(h=>h.outcome==='expired')!==undefined,true,'Delivered prompts expire as timeout, never as rejection');
 const unseen=broker.request({source:'chat',options:[{optionId:'a',kind:'allow_once'}]});
 await sleep(140);assert.deepEqual(await unseen,{outcome:'cancelled'});
 assert.equal(broker.list().history[0].outcome,'expired-undelivered','Prompts that reached no device are distinguishable');

 const unsupported=broker.request({source:'chat',options:[]});
 assert.deepEqual(await unsupported,{outcome:'cancelled'});assert.equal(broker.list().history[0].outcome,'unsupported');

 const small=createApprovalBroker({max:2,timeoutMs:5000});
 const held=small.request({source:'chat',options:[{optionId:'a',kind:'allow_once'}]});
 small.request({source:'chat',options:[{optionId:'a',kind:'allow_once'}]});
 const overflow=small.request({source:'chat',options:[{optionId:'a',kind:'allow_once'}]});
 assert.deepEqual(await overflow,{outcome:'cancelled'});assert.equal(small.list().history[0].outcome,'overflow');
 small.cancel({source:'chat'});assert.deepEqual(await held,{outcome:'cancelled'});
 const cancelledId=small.list().history.find(h=>h.outcome==='cancelled-agent').id;
 assert.equal(small.reply({id:cancelledId,decision:'approve'}).status,409,'Cross-session replies cannot decide a cancelled request');
 console.log('PASS broker: delivery state, approve/reject/expired/expired-undelivered/unsupported/overflow/cancelled-agent stay distinct and duplicate replies are refused.');
}

// 2) Hermes ACP transport forwards real permission requests instead of silently cancelling.
const dir=fs.mkdtempSync(path.join(process.platform==='darwin'?'/tmp':'/tmp','jarvis-a-'));
const home=path.join(dir,'home'),bin=path.join(dir,'bin');fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(home);
fs.writeFileSync(path.join(bin,'hermes'),`#!/usr/bin/env node
const rl=require('readline').createInterface({input:process.stdin});
const send=o=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...o})+'\\n');
let promptId=null,awaiting=null;
rl.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
 else if(m.method==='session/new'||m.method==='session/load')send({id:m.id,result:{sessionId:'acp-fake-session'}});
 else if(m.method==='session/prompt'){
  promptId=m.id;const text=(m.params.prompt||[]).map(p=>p.text||'').join('');
  const end=outcome=>{if(!promptId)return;send({method:'session/update',params:{sessionId:'acp-fake-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'PERMISSION '+JSON.stringify(outcome)}}}});send({id:promptId,result:{stopReason:'end_turn'}});promptId=null;awaiting=null;};
  if(text.includes('approve fixture')){awaiting=end;send({id:901,method:'session/request_permission',params:{sessionId:'acp-fake-session',toolCall:{title:'Edit fixture.txt',kind:'edit',rawInput:{command:'patch fixture.txt'},locations:[{path:'fixture.txt'}]},options:[{optionId:'allow-1',kind:'allow_once',name:'Allow once'},{optionId:'allow-2',kind:'allow_always',name:'Always allow'},{optionId:'reject-1',kind:'reject_once',name:'Reject'}]}});}
  else end({outcome:'end_turn'});
 }
 else if(m.method==='session/cancel'){if(promptId){send({id:promptId,result:{stopReason:'cancelled'}});promptId=null;awaiting=null;}}
 else if(m.id===901&&m.result&&awaiting)awaiting(m.result);
});
`,{mode:0o755});
{
 const oldPath=process.env.PATH;process.env.PATH=bin+path.delimiter+oldPath;
 try{
  const broker=createApprovalBroker({timeoutMs:5000});
  let captured=null;
  const run=runHermes({config:{workDir:home},prompt:'approve fixture',onText:()=>{},requestApproval:v=>{captured=v;return broker.request({source:'chat',...v});}});
  await sleep(200);
  const request=broker.list().requests[0];
  assert.equal(request.summary,'Edit fixture.txt');assert.equal(request.detail,'edit · patch fixture.txt');
  assert.deepEqual(request.paths,['fixture.txt']);
  assert.deepEqual(request.options.map(o=>o.optionId),['allow-1','allow-2'],'Only allow options are offered to the user');
  assert.equal(captured.sessionId,'acp-fake-session');
  broker.reply({id:request.id,decision:'approve',optionId:'allow-2'});
  const result=await run;
  assert.match(result.text,/PERMISSION \{"outcome":"selected","optionId":"allow-2"\}/,'The agent receives exactly the selected option');

  const rejected=await runHermes({config:{workDir:home},prompt:'approve fixture',onText:()=>{},requestApproval:v=>{const p=broker.request({source:'chat',...v});broker.reply({id:broker.list().requests.at(-1).id,decision:'reject'});return p;}});
  assert.match(rejected.text,/PERMISSION \{"outcome":"cancelled"\}/,'Explicit rejections reach the agent as cancellation');

  const auto=await runHermes({config:{workDir:home,agentFullAccess:true},prompt:'approve fixture',onText:()=>{}});
  assert.match(auto.text,/PERMISSION \{"outcome":"selected","optionId":"allow-1"\}/,'Full access keeps its auto allow_once behaviour');

  const bare=await runHermes({config:{workDir:home},prompt:'approve fixture',onText:()=>{}});
  assert.match(bare.text,/PERMISSION \{"outcome":"cancelled"\}/,'Without a forwarding hook the prior safe cancellation stands — never a fabricated prompt');
  console.log('PASS hermes transport: selection, rejection, full-access and no-transport paths all reach the agent.');
 } finally{process.env.PATH=oldPath;}
}

// 3) Bridge routes over the authenticated socket.
const bridgeHome=path.join(dir,'bridge-home'),bridgeBin=path.join(dir,'bridge-bin'),bridgeState=path.join(bridgeHome,'.local/state/omarchy-jarvis'),bridgeCfg=path.join(bridgeHome,'.config/omarchy-jarvis');
fs.mkdirSync(bridgeState,{recursive:true});fs.mkdirSync(bridgeCfg,{recursive:true});fs.mkdirSync(bridgeBin);
fs.copyFileSync(path.join(bin,'hermes'),path.join(bridgeBin,'hermes'));
for(const tool of ['systemctl','tailscale'])fs.writeFileSync(path.join(bridgeBin,tool),'#!/bin/sh\nprintf \'{}\\n\'\n',{mode:0o755});
fs.writeFileSync(path.join(bridgeCfg,'config.json'),JSON.stringify({host:'127.0.0.1',port:0,agent:'hermes',workDir:home,approvalTimeoutMs:1500,tunnel:{enabled:false},stt:{engine:'cli'}}));
fs.writeFileSync(path.join(bridgeState,'personality.json'),JSON.stringify({assistantName:'Fixture',userName:'Tester',personality:'Fixture',revision:1,stage:'ready',messages:[]}));
const bridge=spawn(process.execPath,[path.join(repo,'server/jarvis-server.mjs'),'--http'],{env:{...process.env,HOME:bridgeHome,PATH:bridgeBin+path.delimiter+process.env.PATH,XDG_RUNTIME_DIR:path.join(dir,'runtime'),DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',JARVIS_DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
let up=false;bridge.stdout.on('data',b=>{if(b.toString().includes('listening on'))up=true;});bridge.stderr.on('data',()=>{});
const cleanup=async code=>{bridge.kill();process.exit(code);};
for(let i=0;i<150&&!up;i++)await sleep(50);
if(!up){console.error('bridge did not start');await cleanup(1);}
const token=fs.readFileSync(path.join(bridgeState,'token'),'utf8').trim();
const req=(endpoint,input,auth=true,headers={})=>new Promise((resolve,reject)=>{
 const r=http.request({socketPath:path.join(bridgeState,'serve.sock'),path:endpoint,method:input===undefined?'GET':'POST',headers:{'content-type':'application/json',...(auth?{'x-jarvis-token':token}:{}),...headers}},res=>{let bytes='';res.on('data',b=>bytes+=b);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(bytes)});}catch{resolve({status:res.statusCode,data:bytes});}});});
 r.on('error',reject);r.end(input===undefined?undefined:JSON.stringify(input));
});
const chat=text=>new Promise((resolve,reject)=>{
 const r=http.request({socketPath:path.join(bridgeState,'serve.sock'),path:'/api/chat',method:'POST',headers:{'content-type':'application/json','x-jarvis-token':token,'sec-fetch-site':'same-origin'}},res=>{
  let buffer='',done=null;res.setEncoding('utf8');
  res.on('data',chunk=>{buffer+=chunk;const m=buffer.match(/event: (done|error)\ndata: (.*)\n\n/);if(m){done=m;res.destroy();}});
  r.setTimeout(20000,()=>r.destroy(new Error('chat timed out')));
  res.on('close',()=>resolve(done?{event:done[1],data:JSON.parse(done[2])}:reject(new Error('no terminal SSE event'))));
 });
 r.on('error',e=>{if(e.code==='ECONNRESET')return;reject(e);});r.write(JSON.stringify({text}));r.end();
});
assert.equal((await req('/api/approvals',undefined,false)).status,401);
assert.equal((await req('/api/approvals',{action:'reply'},true,{'sec-fetch-site':'cross-site'})).status,403);
assert.equal((await req('/api/approvals',{action:'nope'})).status,400);
const view=await req('/api/approvals');
assert.equal(view.data.transport,'acp');assert.equal(view.data.agent,'hermes');
{
 const turn=chat('approve fixture request');
 for(let i=0;i<60&&!(await req('/api/approvals')).data.requests.length;i++)await sleep(100);
 const pending=(await req('/api/approvals')).data.requests;
 assert.equal(pending.length,1);assert.equal(pending[0].source,'chat');assert.equal(pending[0].summary,'Edit fixture.txt');
 assert.equal((await req('/api/approvals',{action:'reply',id:pending[0].id,decision:'approve'})).data.ok,true);
 const done=await turn;assert.match(done.data.text,/"outcome":"selected","optionId":"allow-1"/,'Default selection is allow_once');
 const recent=(await req('/api/approvals')).data.history;
 assert.equal(recent[0].outcome,'approved');
}
{
 const turn=chat('approve fixture undelivered');
 await sleep(1900);
 const done=await turn;assert.match(done.data.text,/PERMISSION \{"outcome":"cancelled"\}/);
 const recent=(await req('/api/approvals')).data.history;
 assert.equal(recent[0].outcome,'expired-undelivered','No client polled before expiry');
}
{
 const turn=chat('approve fixture cross session');
 for(let i=0;i<60&&!(await req('/api/approvals')).data.requests.length;i++)await sleep(100);
 const pending=(await req('/api/approvals')).data.requests[0];
 await req('/api/chat/stop',{});
 await turn;
 const after=(await req('/api/approvals')).data;
 assert.equal(after.requests.length,0);
 const entry=after.history.find(h=>h.id===pending.id);
 assert.equal(entry.outcome,'cancelled-agent','Stopping a turn is not a user rejection');
 assert.equal((await req('/api/approvals',{action:'reply',id:pending.id,decision:'approve'})).status,409);
}
console.log('PASS bridge routes: auth, same-site, delivered approval, undelivered expiry and stop cancellation are recorded distinctly.');

// 4) Browser: prompt visibility, small-screen usability and decision from the inbox UI.
if(process.env.JARVIS_APPROVALS_BROWSER==='1'){
 const bHome=path.join(dir,'browser-home'),bState=path.join(bHome,'.local/state/omarchy-jarvis'),bCfg=path.join(bHome,'.config/omarchy-jarvis');
 fs.mkdirSync(bState,{recursive:true});fs.mkdirSync(bCfg,{recursive:true});
 fs.writeFileSync(path.join(bCfg,'config.json'),JSON.stringify({host:'127.0.0.1',port:0,agent:'hermes',workDir:home,approvalTimeoutMs:60000,tunnel:{enabled:false},stt:{engine:'cli'}}));
 fs.writeFileSync(path.join(bState,'personality.json'),JSON.stringify({assistantName:'Fixture',userName:'Tester',personality:'Fixture',revision:1,stage:'ready',messages:[]}));
 const bBridge=spawn(process.execPath,[path.join(repo,'server/jarvis-server.mjs'),'--http'],{env:{...process.env,HOME:bHome,PATH:bridgeBin+path.delimiter+process.env.PATH,XDG_RUNTIME_DIR:path.join(dir,'runtime2'),DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',JARVIS_DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
 let bUp=false;bBridge.stdout.on('data',b=>{if(b.toString().includes('listening on'))bUp=true;});bBridge.stderr.on('data',b=>console.error('B2:',b.toString().slice(0,300)));
 for(let i=0;i<150&&!bUp;i++)await sleep(50);
 assert.ok(bUp,'browser fixture bridge must start');
 const bToken=fs.readFileSync(path.join(bState,'token'),'utf8').trim();
 const bReq=(endpoint,input)=>new Promise((resolve,reject)=>{const r=http.request({socketPath:path.join(bState,'serve.sock'),path:endpoint,method:input===undefined?'GET':'POST',headers:{'content-type':'application/json','x-jarvis-token':bToken}},res=>{let bytes='';res.on('data',b=>bytes+=b);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(bytes)}));});r.on('error',reject);r.end(input===undefined?undefined:JSON.stringify(input));});
 const bChat=text=>new Promise((resolve,reject)=>{
  const r=http.request({socketPath:path.join(bState,'serve.sock'),path:'/api/chat',method:'POST',headers:{'content-type':'application/json','x-jarvis-token':bToken,'sec-fetch-site':'same-origin'}},res=>{
   let buffer='',done=null;res.setEncoding('utf8');
   res.on('data',chunk=>{buffer+=chunk;const m=buffer.match(/event: (done|error)\ndata: (.*)\n\n/);if(m){done=m;res.destroy();}});
   r.setTimeout(20000,()=>r.destroy(new Error('chat timed out')));
   res.on('close',()=>resolve(done?{event:done[1],data:JSON.parse(done[2])}:reject(new Error('no terminal SSE event'))));
  });
  r.on('error',e=>{if(e.code==='ECONNRESET')return;reject(e);});r.write(JSON.stringify({text}));r.end();
 });
 const profile=path.join(dir,'browser');
 const browser=spawn('chromium',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 for(let i=0;i<150&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++)await sleep(50);
 const debug=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
 const targets=await(await fetch('http://127.0.0.1:'+debug+'/json/list')).json();
 const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await once(ws,'open');
 let seq=0;const pendingMap=new Map();
 ws.addEventListener('message',e=>{const v=JSON.parse(e.data),p=pendingMap.get(v.id);if(p){pendingMap.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('CDP timeout')),15000);pendingMap.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const v=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(v.exceptionDetails)throw Error(v.exceptionDetails.exception?.description||v.exceptionDetails.text);return v.result.value;};
 const wait=async condition=>{for(let i=0;i<120;i++){if(await ev(condition))return;await sleep(50);}throw Error('Browser condition timed out: '+condition+' | url='+await ev('location.href')+' | head='+await ev('document.documentElement.outerHTML.slice(0,400)'));};
 const relay=http.createServer((r,s)=>{const f=http.request({socketPath:path.join(bState,'serve.sock'),path:r.url,method:r.method,headers:r.headers},up=>{s.writeHead(up.statusCode,up.headers);up.pipe(s);});f.on('error',()=>s.end());r.pipe(f);});
 relay.listen(0,'127.0.0.1');await once(relay,'listening');
 const probe=await fetch('http://127.0.0.1:'+relay.address().port+'/?k='+encodeURIComponent(bToken));
 const probeBody=await probe.text();
 if(!/jarvis/i.test(probeBody))throw Error('relay probe failed: status='+probe.status+' body='+probeBody.slice(0,200)+' headers='+JSON.stringify(Object.fromEntries(probe.headers)));
 console.log('relay probe ok:',probe.status,probeBody.length,'bytes');
 await cdp('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:true});
 await cdp('Page.navigate',{url:'http://127.0.0.1:'+relay.address().port+'/?k='+encodeURIComponent(bToken)});
 await wait("Array.from(document.querySelectorAll('.sidebar-nav-button')).some(b=>b.textContent.includes('Notifications'))");
 await wait("!!window.jarvisAPI && window.jarvisAPI('/api/approvals').then(v=>v.transport==='acp').catch(()=>false)");
 const turn=bChat('approve fixture browser');
 await wait("!!document.querySelector('.approval-prompt .approval-card')");
 const card=await ev("(()=>{const b=Array.from(document.querySelectorAll('.approval-prompt button')),r=b.map(x=>x.getBoundingClientRect());return {labels:b.map(x=>x.textContent.trim()),fits:r.every(x=>x.right<=innerWidth&&x.bottom<=innerHeight),touch:r.every(x=>x.height>=44),summary:document.querySelector('.approval-prompt h3').textContent}})()");
 assert.equal(card.summary,'Edit fixture.txt');assert.ok(card.fits&&card.touch,'Small screen shows usable Approve/Reject targets: '+JSON.stringify(card));
 await ev("Array.from(document.querySelectorAll('.approval-prompt button')).find(b=>b.textContent.trim()==='Reject').click()");
 const done=await turn;assert.match(done.data.text,/PERMISSION \{"outcome":"cancelled"\}/,'UI rejection reaches the running agent');
 await wait("!document.querySelector('.approval-prompt')");
 await ev("window.jarvisWorkspace('notifications')");
 await wait("document.body.dataset.workspace==='notifications'");
 await wait("document.querySelector('.approvals-inbox .approval-history')?.textContent.includes('Rejected by you')");
 await wait("document.body.dataset.sidebar='open';document.querySelector('.approval-count-badge')===null");
 console.log('PASS browser: 320px prompt with 44px decision targets, live rejection and outcome visible in the inbox.');
 ws.close();browser.kill();relay.close();bBridge.kill();
} else console.log('Browser stage skipped: JARVIS_APPROVALS_BROWSER=1 node tests/approvals.mjs');
await cleanup(0);
