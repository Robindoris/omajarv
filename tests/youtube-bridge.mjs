import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const repo=path.resolve(import.meta.dirname,'..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-youtube-'));
const project=path.join(fixture,'project');fs.mkdirSync(project);
let bridge,browser,relay;
try{
 const home=path.join(fixture,'home'),bin=path.join(fixture,'bin');fs.mkdirSync(path.join(home,'.config/omarchy-jarvis'),{recursive:true});fs.mkdirSync(bin);
 fs.writeFileSync(path.join(home,'.config/omarchy-jarvis/config.json'),JSON.stringify({host:'127.0.0.1',port:0,agent:'codex',workDir:project,tunnel:{enabled:false},stt:{engine:'cli',modelPath:path.join(fixture,'model.bin')}}));
 for(const tool of ['systemctl','tailscale'])fs.writeFileSync(path.join(bin,tool),'#!/bin/sh\nprintf \'{}\\n\'\n',{mode:0o755});
 fs.writeFileSync(path.join(fixture,'model.bin'),'synthetic');
 fs.writeFileSync(path.join(fixture,'transcript'),'Play a video called Named fixture');
 const executable=(name,code)=>fs.writeFileSync(path.join(bin,name),'#!/usr/bin/env node\n'+code,{mode:0o755});
 executable('yt-dlp',`const fs=require('node:fs');const target=process.argv.at(-1);const q=target==='https://www.youtube.com/@robindorak/videos'?'robindorak':target.replace(/^ytsearch5:/,'');fs.appendFileSync(${JSON.stringify(path.join(fixture,'queries'))},q+'\\n');if(q==='failure'){console.error('PRIVATE_FIXTURE_DIAGNOSTIC');process.exit(1);}const first={id:'abcdefghijk',title:'Named fixture',channel:'Fixture'};console.log(JSON.stringify({entries:q==='robindorak'?[{id:'12345678901',title:'Unrelated result',channel:'Other creator'},{id:'abcdefghijk',title:'Channel fixture video',channel:'RobindoriS',uploader_id:'@robindorak'}]:q==='nothing'?[]:q==='Named fixture'?[first,{id:'12345678901',title:'Other'}]:[{...first,title:'Space documentary'},{id:'12345678901',title:'Moon documentary'}]}));`);
 executable('codex',`require('node:fs').writeFileSync(${JSON.stringify(path.join(fixture,'agent-used'))},'unexpected');process.exit(1);`);
 executable('ffmpeg',`require('node:fs').writeFileSync(process.argv.at(-1),Buffer.alloc(1201));process.stdin.resume();`);
 executable('whisper-cli',`console.log(require('node:fs').readFileSync(${JSON.stringify(path.join(fixture,'transcript'))},'utf8'));`);
 bridge=spawn(process.execPath,[path.join(repo,'server/jarvis-server.mjs'),'--http'],{env:{...process.env,HOME:home,PATH:bin+':'+process.env.PATH,DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',XDG_RUNTIME_DIR:path.join(fixture,'runtime')},stdio:['ignore','pipe','pipe']});
 let logs='';bridge.stdout.on('data',b=>logs+=b);bridge.stderr.on('data',b=>logs+=b);
 for(let i=0;i<150&&!logs.includes('listening on');i++)await new Promise(r=>setTimeout(r,50));assert.match(logs,/listening on/,'Fixture bridge should start');
 const liveState=path.join(home,'.local/state/omarchy-jarvis'),token=fs.readFileSync(path.join(liveState,'token'),'utf8').trim();
 const request=(endpoint,input,options={})=>new Promise((resolve,reject)=>{const req=http.request({socketPath:path.join(liveState,'serve.sock'),path:endpoint,method:options.method||(input===undefined?'GET':'POST'),headers:{'content-type':options.binary?'application/octet-stream':'application/json',...(options.auth===false?{}:{'x-jarvis-token':token}),...options.headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks),headers:res.headers}));});req.on('error',reject);req.end(input===undefined?undefined:options.binary?input:JSON.stringify(input));});
 const json=r=>JSON.parse(r.bytes);
 assert.equal((await request('/api/chat',{text:'Play a video about space'},{auth:false})).status,401);
 const personalityProfile=json(await request('/api/personality'));
 assert.equal((await request('/api/personality',{...personalityProfile,assistantName:'Fixture',userName:'Tester',personality:'Be brief.'})).status,200);
 const events=response=>response.bytes.toString().split('\n\n').filter(s=>s.startsWith('event:')).map(s=>({event:s.split('\n')[0].slice(7),data:JSON.parse(s.split('\n')[1].slice(6))}));
 const chat=async text=>{const response=await request('/api/chat',{text});assert.equal(response.status,200);return events(response);};
 for(const [text,selection] of [['Play a video about space',null],['Can you play a video called "Named fixture"?','abcdefghijk']]){
  const result=await chat(text);assert.equal(result.find(e=>e.event==='video').data.selected,selection);assert.ok(result.some(e=>e.event==='done'));
 }
 assert.equal((await chat('Play a video about nothing')).find(e=>e.event==='video').data.results.length,0);
 const failure=await chat('Play a video about failure');assert.match(failure.find(e=>e.event==='video').data.error,/search is unavailable/);assert.match(failure.find(e=>e.event==='done').data.text,/search is unavailable/);assert.ok(!JSON.stringify(failure).includes('PRIVATE_FIXTURE_DIAGNOSTIC'));
 const beforeDirect=fs.readFileSync(path.join(fixture,'queries'),'utf8');
 const directReply=await chat('https://www.youtube.com/watch?v=KNknduZ3NsQ open it');assert.equal(directReply.find(e=>e.event==='video').data.selected,'KNknduZ3NsQ');assert.equal(fs.readFileSync(path.join(fixture,'queries'),'utf8'),beforeDirect,'Direct video URL bypasses search');
 for(const command of ['Here is the video https://youtu.be/KNknduZ3NsQ','Play it in the built-in player','open it'])assert.equal((await chat(command)).find(e=>e.event==='video').data.selected,'KNknduZ3NsQ');
 for(const command of ['find robindorak and play video any','play any video from robindorak','open any video from this chanel https://www.youtube.com/@robindorak'])assert.equal((await chat(command)).find(e=>e.event==='video').data.selected,'abcdefghijk');
 const emptyVoice=await request('/api/stt',Buffer.alloc(0),{binary:true,headers:{'content-type':'audio/webm'}});assert.equal(emptyVoice.status,400);assert.equal(json(emptyVoice).code,'recording_empty');
 const voice=await request('/api/stt',Buffer.alloc(1201),{binary:true,headers:{'content-type':'audio/wav'}});assert.equal(voice.status,200);assert.equal((await chat(json(voice).text)).find(e=>e.event==='video').data.selected,'abcdefghijk');
 assert.equal(fs.existsSync(path.join(fixture,'agent-used')),false,'Explicit video commands bypass provider execution');
 console.log('PASS YouTube bridge: authenticated topic/named requests, exact/ambiguous selection, empty/error responses, private diagnostics, mocked STT transcript to actual chat SSE.');
 const profile=path.join(fixture,'browser');browser=spawn('chromium',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 for(let i=0;i<150&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++)await new Promise(r=>setTimeout(r,50));
 const debug=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];const targets=await(await fetch('http://127.0.0.1:'+debug+'/json/list')).json();const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await once(ws,'open');let id=0;const pending=new Map();ws.addEventListener('message',e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const v=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(v.exceptionDetails)throw Error(v.exceptionDetails.exception?.description||v.exceptionDetails.text);return v.result.value;};
 const clickText=async(selector,text)=>evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
 const wait=async expression=>{for(let i=0;i<160;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Browser condition timed out: '+expression+' '+await evaluate('JSON.stringify({state:document.body.dataset.state,transcript:document.querySelector("#transcript").innerText,recorder:window.fixtureRecorder?.state})'));};
 relay=http.createServer((req,res)=>{const forwarded=http.request({socketPath:path.join(liveState,'serve.sock'),path:req.url,method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});forwarded.on('error',()=>{res.writeHead(502);res.end();});req.pipe(forwarded);});relay.listen(0,'127.0.0.1');await once(relay,'listening');
 await cdp('Page.navigate',{url:'http://127.0.0.1:'+relay.address().port+'/?k='+encodeURIComponent(token)});
 await cdp('Network.enable');await cdp('Network.setBlockedURLs',{urls:['*youtube.com/*','*youtube-nocookie.com/*']});
 await wait('typeof window.jarvisWorkspace==="function" && !!document.querySelector("#composer") && document.body.dataset.state!=="boot"');
 const sendChat=async text=>{await evaluate('window.jarvisWorkspace("conversation");document.querySelector("#textInput").value='+JSON.stringify(text)+';document.querySelector("#composer").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));');};
 const signal=async(event,info,origin='https://www.youtube-nocookie.com')=>evaluate(`window.dispatchEvent(new MessageEvent('message',{origin:${JSON.stringify(origin)},source:document.querySelector('.youtube-player iframe').contentWindow,data:JSON.stringify({event:${JSON.stringify(event)},info:${JSON.stringify(info)}})}))`);
 for(const width of [1280,390,320]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await new Promise(r=>setTimeout(r,250));
  await sendChat('Play a video about space');await wait('document.querySelectorAll(".youtube-results button").length===2 && !document.querySelector(".youtube-player iframe")');
  await clickText('.youtube-results button','Space documentary — Fixture');await wait('!!document.querySelector(".youtube-player iframe")');
  assert.equal(await evaluate('(()=>{const u=new URL(document.querySelector(".youtube-player iframe").src);return u.origin==="https://www.youtube-nocookie.com"&&u.searchParams.get("controls")==="1"&&u.searchParams.get("origin")===location.origin&&!u.searchParams.has("k");})()'),true);
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".youtube-player button")).every(e=>e.getBoundingClientRect().height>=44)'),true);
  assert.equal(await evaluate('(()=>{const r=document.querySelector(".youtube-player").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.querySelector(".youtube-player iframe").getBoundingClientRect().height>=200;})()'),true);
  await signal('onError',150,'https://untrusted.invalid');assert.equal(await evaluate('!!document.querySelector(".youtube-player [role=alert]")'),false);
  await signal('onError',150);await wait('document.querySelector(".youtube-player [role=alert]")?.textContent.includes("does not allow embedded")');
  await clickText('.youtube-controls button','Retry playback');await wait('!document.querySelector(".youtube-player [role=alert]")');
  await signal('onError',100);await wait('document.querySelector(".youtube-player [role=alert]")?.textContent.includes("unavailable or private")');
  await clickText('.youtube-controls button','Retry playback');await signal('onAutoplayBlocked');await wait('document.querySelector(".youtube-player [role=status]")?.textContent.includes("Autoplay was blocked")');
  await clickText('.youtube-controls button','Play');await wait('document.querySelector(".youtube-player [role=status]")?.textContent.includes("Playback requested")');
  await signal('onStateChange',1);await wait('document.querySelector(".youtube-player [role=status]")?.textContent==="Playing."');await clickText('.youtube-controls button','Pause');await signal('onStateChange',2);await wait('document.querySelector(".youtube-player [role=status]")?.textContent==="Paused."');await clickText('.youtube-controls button','Restart');
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(os.tmpdir(),'jarvis-youtube-'+width+'.png'),Buffer.from(shot.data,'base64'));
  await evaluate('document.querySelector(".youtube-player > button").click()');await wait('!document.querySelector(".youtube-player")');
  await sendChat('Play a video called Named fixture');await wait('document.querySelector(".youtube-player iframe")?.title==="Named fixture"');
  await evaluate('document.querySelector(".youtube-player > button").click()');await wait('!document.querySelector(".youtube-player")');
  await sendChat('Here is the video https://www.youtube.com/watch?v=KNknduZ3NsQ');await wait('document.querySelector(".youtube-player iframe")?.src.includes("/embed/KNknduZ3NsQ?")');
  await signal('infoDelivery',{videoData:{video_id:'KNknduZ3NsQ',title:'Direct video fixture title'}});await wait('document.querySelector(".youtube-player h2")?.textContent==="Direct video fixture title"');
  await evaluate('document.querySelector(".youtube-player > button").click()');await wait('!document.querySelector(".youtube-player")');
  await sendChat('Play it in the built-in player');await wait('document.querySelector(".youtube-player iframe")?.src.includes("/embed/KNknduZ3NsQ?")');
  await evaluate('document.querySelector(".youtube-player > button").click()');await wait('!document.querySelector(".youtube-player")');
  await sendChat('open any video from this chanel https://www.youtube.com/@robindorak');await wait('document.querySelector(".youtube-player iframe")?.title==="Channel fixture video"');
  await evaluate('document.querySelector(".youtube-player > button").click()');await wait('!document.querySelector(".youtube-player")');
  // Exercise topic and named requests through the real voice auto-send route.
  for(const utterance of ['Play a video about space','Play a video called Named fixture','open any video from this chanel https://www.youtube.com/@robindorak']){
  fs.writeFileSync(path.join(fixture,'transcript'),utterance);
  await wait('document.body.dataset.state==="idle"');
  await evaluate(`window.jarvisGetMicrophone=async()=>{const ctx=new AudioContext();return ctx.createMediaStreamDestination().stream;};window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){window.fixtureRecorder=this;this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob([new Uint8Array(1201)])});queueMicrotask(()=>this.onstop());}};window.jarvisWorkspace('voice');document.querySelector('#ptt').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',pointerId:1,bubbles:true}));`);
  await wait('window.fixtureRecorder?.state==="recording"');await new Promise(r=>setTimeout(r,500));await evaluate('window.dispatchEvent(new PointerEvent("pointerup",{pointerType:"mouse",pointerId:1,bubbles:true}))');if(utterance.includes('about'))await wait('document.querySelectorAll(".youtube-results button").length===2 && !document.querySelector(".youtube-player iframe")');else await wait('document.querySelector(".youtube-player iframe")?.title==='+JSON.stringify(utterance.includes('robindorak')?'Channel fixture video':'Named fixture'));
  await evaluate('document.querySelector(".youtube-player").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await wait('!document.querySelector(".youtube-player")');
  }
  console.log('PASS YouTube '+width+'px: actual chat/voice routing, ambiguity, title, player parameters, embed errors, spoof rejection, autoplay action, controls, retry, close and layout.');
 }
 await sendChat('Play a video about nothing');await wait('document.querySelector(".youtube-player h2")?.textContent==="No videos found"');
 await sendChat('Play a video about failure');await wait('document.querySelector(".youtube-player [role=alert]")?.textContent.includes("search is unavailable")');
 ws.close();
}finally{relay?.closeAllConnections();relay?.close();browser?.kill('SIGKILL');bridge?.kill('SIGTERM');if(browser)await Promise.race([once(browser,'exit'),new Promise(r=>setTimeout(r,3000))]);if(bridge)await Promise.race([once(bridge,'exit'),new Promise(r=>setTimeout(r,3000))]);fs.rmSync(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
