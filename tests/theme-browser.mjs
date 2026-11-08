import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import {createKanban} from '../server/lib/kanban.mjs';
import { buildTheme, themeStyles } from '../server/lib/theme.mjs';
const cameraJPEG=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x120','-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1']).stdout;
assert.ok(cameraJPEG.length>100,'Synthetic camera JPEG must be encoded');
const cameraAudioResponses=new Set();let cameraTranscriptions=0,cameraFailNext=false;
let cameraFixture={configured:false,enabled:false,source:'device',active:0},cameraStreams=0,cameraAudioReads=0;
const cameraPCM=Buffer.alloc(9600);for(let i=0;i<4800;i++)cameraPCM.writeInt16LE(Math.round(Math.sin(i*Math.PI*2*440/48000)*8000),i*2);
const root=path.resolve(import.meta.dirname, '../server/public');
const screenshotRoot=process.env.TMPDIR || os.tmpdir();
const dark=buildTheme({background:'#0C1013',foreground:'#DBE2E6',accent:'#6567EC',muted:'#91A1AC',red:'#E28174',yellow:'#E2DA74'},'Orbit 204');
const light=buildTheme({mode:'light',background:'#fafafa',foreground:'#151515',accent:'#336688',muted:'#555555',red:'#b53333',yellow:'#805e00'},'Light fixture');
const boardFixtureDir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-browser-board-'));
const fixtureStore=createKanban(boardFixtureDir,{now:()=>new Date(2026,0,2,23,30)});
let fixtureBoard=fixtureStore.view(),dropBoardResponse=false;
let fixtureVoiceSettings={settings:{stt:{engine:'auto',model:'base.en',modelPath:'',language:'en',serverPort:8178},tts:{voice:'en_US-ljspeech-medium',modelPath:'',speed:1},maxRecordingSec:120},models:{whisper:[{name:'small',path:'/fixture/ggml-small.bin'}],piper:[{name:'fixture-voice',path:'/fixture/voice.onnx'}]},status:{stt:{ready:true},tts:{ready:false}}};
let failVoiceSave=false;
let setupPosts=0,setupTicks=0;
let fixtureSetup={job:{state:'idle',received:0,total:8,file:'',error:''},missing:{whisper:true,piper:true},runtime:{whisper:true,piper:true,ffmpeg:true},models:[{id:'whisper',name:'Whisper base.en',bytes:4,needed:true,source:'Fixture source',terms:'Fixture terms'},{id:'piper',name:'Piper LJ Speech medium',bytes:4,needed:true,source:'Fixture source',terms:'Fixture terms'}]};
let fixtureSTTReady=true,fixtureTTSReady=true;
let themeReads=0;
let savedPersonality=false;
let sudoPending=false, sudoApproved=false;
let failSudoPoll=false;
const sudoKeys=generateKeyPairSync('rsa',{modulusLength:3072});
const sudoPublicKey=sudoKeys.publicKey.export({type:'spki',format:'pem'}).toString();
let fixtureProfile={assistantName:'Nova',userName:'Alex',personality:'Be friendly.',revision:0,stage:'complete'};
const server=http.createServer((req,res)=>{
const url=new URL(req.url,'http://localhost');
if(url.pathname.startsWith('/api/')){
 assert.equal(url.searchParams.has('k'),false,'API URLs must not carry the bearer token');
 assert.equal(req.headers['x-jarvis-token'],'fixture','Phone API authentication must use a header');
}
res.setHeader('cache-control','no-store');
if(url.pathname==='/test-sudo/start'){sudoPending=true;return res.end('ok');}
if(url.pathname==='/test-sudo/fail-once'){failSudoPoll=true;return res.end('ok');}
if(url.pathname==='/test-sudo/end'){sudoPending=false;return res.end('ok');}
if(url.pathname==='/api/sudo/pending'){
 if(failSudoPoll){failSudoPoll=false;res.writeHead(503);return res.end();}
 res.setHeader('content-type','application/json');
 return res.end(JSON.stringify({requests:sudoPending?[{id:'fixture-approval',command:'sudo "fixture-command"',cwd:'/fixture/workspace',publicKey:sudoPublicKey,expiresAt:Date.now()+120000}]:[]}));
}
if(url.pathname==='/api/sudo/reply'){
 let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  assert.ok(!body.includes('browser-sudo-fixture'),'plaintext must never enter the approval HTTP request');
  const payload=JSON.parse(body);
  if(payload.cancel){sudoPending=false;return res.end('{"ok":true}');}
  assert.deepEqual(Object.keys(payload).sort(),['ciphertext','id']);
  const decrypted=privateDecrypt({key:sudoKeys.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(payload.ciphertext,'base64'));
  assert.equal(decrypted.toString(),'browser-sudo-fixture');decrypted.fill(0);
  sudoPending=false;sudoApproved=true;res.setHeader('content-type','application/json');res.end('{"ok":true}');
 });return;
}
if(url.pathname==='/api/conversations'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({conversations:[{id:'saved-fixture',title:'Earlier chat',agent:'codex',count:2,at:1}]}));}
if(url.pathname==='/api/voice-setup'){
 res.setHeader('content-type','application/json');
 if(req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{assert.deepEqual(JSON.parse(body),{consent:true});setupPosts++;setupTicks=0;fixtureSetup.job={state:'downloading',received:2,total:8,file:'fixture.bin',error:''};res.writeHead(202);res.end(JSON.stringify(fixtureSetup));});return;}
 if(fixtureSetup.job.state==='downloading'&&++setupTicks>=2){fixtureSetup.job={state:'complete',received:8,total:8,file:'',error:''};fixtureSetup.models=fixtureSetup.models.map(m=>({...m,needed:false}));}
 return res.end(JSON.stringify(fixtureSetup));
}
if(url.pathname==='/api/ip-camera'){
 res.setHeader('content-type','application/json');
 if(req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{const input=JSON.parse(body);if(input.forget)cameraFixture={configured:false,enabled:false,source:'device',active:0};else cameraFixture={configured:cameraFixture.configured||!!input.url,enabled:input.enabled,source:input.source,active:0};res.end(JSON.stringify(cameraFixture));});return;}
 return res.end(JSON.stringify(cameraFixture));
}
if(['/api/ip-camera/audio','/api/ip-camera/video'].includes(url.pathname)){
 if(cameraFailNext){cameraFailNext=false;res.writeHead(502,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Camera stream unavailable. Check camera settings.'}));}
 const audio=url.pathname.endsWith('audio');if(audio){cameraAudioReads++;cameraAudioResponses.add(res);}
 res.setHeader('content-type','application/octet-stream');cameraStreams++;
 res.write(audio?cameraPCM:cameraJPEG);
 const timer=setInterval(()=>res.write(audio?cameraPCM:cameraJPEG),100);
 res.on('close',()=>{clearInterval(timer);cameraStreams--;cameraAudioResponses.delete(res);});return;
}

if(url.pathname==='/api/transcribe'){cameraTranscriptions++;res.writeHead(500);return res.end('{}');}
if(url.pathname==='/api/voice-settings'){
 res.setHeader('content-type','application/json');
 if(req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{if(failVoiceSave){failVoiceSave=false;res.writeHead(409);return res.end(JSON.stringify({error:'Stop the active recording before saving.'}));}fixtureVoiceSettings={...fixtureVoiceSettings,settings:JSON.parse(body)};res.end(JSON.stringify(fixtureVoiceSettings));});return;}
 return res.end(JSON.stringify(fixtureVoiceSettings));
}
if(url.pathname==='/api/kanban/backup'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(url.searchParams.has('revision')?fixtureStore.savedBackup(Number(url.searchParams.get('revision'))):fixtureStore.backup()));}
if(url.pathname==='/api/kanban/backups'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({backups:fixtureStore.backups()}));}
if(url.pathname==='/api/kanban'){
 res.setHeader('content-type','application/json');
 if(req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{
 fixtureBoard=fixtureStore.update(JSON.parse(body));if(dropBoardResponse){dropBoardResponse=false;res.destroy();return;}res.end(JSON.stringify(fixtureBoard));
 }catch(error){res.writeHead(error.status||400);res.end(JSON.stringify({error:error.message}));}});return;}
 fixtureBoard=fixtureStore.view();return res.end(JSON.stringify(fixtureBoard));
}
if(url.pathname==='/api/theme'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(++themeReads<2?dark:light));}
if(url.pathname==='/theme.css'){res.setHeader('content-type','text/css');return res.end(themeStyles(dark));}
if(url.pathname==='/api/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({agent:{label:'Codex'},session:{turns:0},stt:{ready:fixtureSTTReady},tts:{ready:fixtureTTSReady}}));}
if(url.pathname==='/api/history'){res.setHeader('content-type','application/json');return res.end('{"messages":[],"busy":false}');}
if(url.pathname==='/api/personality'){
 res.setHeader('content-type','application/json');
 if(req.method==='POST'){
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{fixtureProfile={...JSON.parse(body),revision:1,stage:'complete'};savedPersonality=true;res.end(JSON.stringify(fixtureProfile));});return;
 }
 return res.end(JSON.stringify(fixtureProfile));
}
const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
if(name.includes('..')||!fs.existsSync(path.join(root,name))){res.writeHead(404);return res.end();}
let source=fs.readFileSync(path.join(root,name));
res.setHeader('content-type',name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript');
if(name==='index.html'&&!url.searchParams.has('defaultViewTest'))source=source.toString().replace('</body>',`<script>setInterval(function(){var s=getComputedStyle(document.documentElement);document.body.dataset.testCore=s.getPropertyValue('--core').trim();document.body.dataset.testBg=getComputedStyle(document.body).backgroundColor;
var safeTop=Number(new URL(location.href).searchParams.get('safeTop') || 0);
var safeBottom=Number(new URL(location.href).searchParams.get('safeBottom') || 0);
document.documentElement.style.setProperty('--safe-top',safeTop+'px');
document.documentElement.style.setProperty('--safe-bottom',safeBottom+'px');
var hud=document.querySelector('.hud').getBoundingClientRect(), nav=document.querySelector('.view-switch').getBoundingClientRect();
document.body.dataset.testSafeHeader=String(hud.top>=safeTop+32 && hud.right<=innerWidth);
document.body.dataset.testNavigation=String(Array.from(document.querySelectorAll('.view-switch button')).every(function(button){
 var rect=button.getBoundingClientRect();return rect.left>=nav.left && rect.right<=nav.right+.5 && button.scrollWidth<=button.clientWidth;
}));
var transcript=document.getElementById('transcript'), composer=document.getElementById('composer');
if(document.body.dataset.workspace==='conversation')document.body.dataset.testComposer=String(!composer.hidden && composer.getBoundingClientRect().bottom <= innerHeight);
if(document.body.dataset.workspace==='conversation')document.body.dataset.testTranscript=String(transcript.getBoundingClientRect().height >= 180);
if(!document.body.dataset.testViews){
 document.getElementById('voiceView').click();
 var voice=document.body.dataset.view==='voice' && document.getElementById('voiceView').getAttribute('aria-pressed')==='true';
 document.getElementById('chatView').click();
 document.body.dataset.testViews=String(voice && document.body.dataset.view==='chat' && document.getElementById('chatView').getAttribute('aria-pressed')==='true');
}
},100);</script></body>`);
if(name==='index.html'&&!url.searchParams.has('defaultViewTest'))source=source.toString().replace('</body>',`<script>
var personalityTestStep=0;
setInterval(function(){
 var dialog=document.getElementById('personalityDialog');
 if(personalityTestStep===0){document.getElementById('personalityBtn').click();personalityTestStep=1;}
 else if(personalityTestStep===1 && !dialog.hidden){
  var rect=dialog.getBoundingClientRect();
  document.body.dataset.testPersonalityLayout=String(rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight);
  document.getElementById('personalityInput').value='Be warm and explain clearly.';
  document.getElementById('personalityForm').requestSubmit();personalityTestStep=2;
 } else if(personalityTestStep===2 && dialog.hidden){
  document.getElementById('personalityBtn').click();personalityTestStep=3;
 } else if(personalityTestStep===3 && !dialog.hidden){
  document.body.dataset.testPersonalitySaved=String(document.getElementById('personalityInput').value==='Be warm and explain clearly.');
  window.jarvisWorkspace('conversation');fetch('/test-sudo/start');personalityTestStep=4;
 } else if(personalityTestStep===4 && document.getElementById('sudoDialog').open){
  var sudoDialog=document.getElementById('sudoDialog'), rect=sudoDialog.getBoundingClientRect();
  document.body.dataset.testSudoLayout=String(rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight);
  document.getElementById('sudoPassword').value='temporary-unsent-fixture';
  fetch('/test-sudo/fail-once');personalityTestStep=41;
 } else if(personalityTestStep===41 && /Connection interrupted/.test(document.getElementById('sudoError').textContent)){
  document.body.dataset.testSudoRetained=String(document.getElementById('sudoDialog').open && document.getElementById('sudoPassword').value==='' && document.getElementById('sudoSubmit').disabled);
  personalityTestStep=42;
 } else if(personalityTestStep===42 && !document.getElementById('sudoSubmit').disabled){
  document.body.dataset.testSudoReconnected=String(document.getElementById('sudoDialog').open);
  document.getElementById('sudoPassword').value='browser-sudo-fixture';
  document.getElementById('sudoForm').requestSubmit();personalityTestStep=5;
 } else if(personalityTestStep===5 && !document.getElementById('sudoDialog').open){
  document.body.dataset.testSudoCleared=String(document.getElementById('sudoPassword').value==='');
  fetch('/test-sudo/start');personalityTestStep=6;
 } else if(personalityTestStep===6 && document.getElementById('sudoDialog').open){
  fetch('/test-sudo/end');personalityTestStep=7;
 } else if(personalityTestStep===7 && /no longer waiting/.test(document.getElementById('sudoError').textContent)){
  document.body.dataset.testSudoEnded=String(document.getElementById('sudoDialog').open && document.getElementById('sudoSubmit').disabled);
  document.getElementById('sudoCancel').click();personalityTestStep=8;
 }
},300);
</script></body>`);
res.end(source);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-theme-browser-'));
try{
for(const viewport of [{width:1280,height:900,top:0,bottom:0},{width:390,height:844,top:59,bottom:34},{width:320,height:740,top:20,bottom:0}]) {
themeReads=0;savedPersonality=false;sudoPending=false;sudoApproved=false;failSudoPoll=false;
const browserProfile=fs.mkdtempSync(path.join(profile,'browser-'));
fixtureSetup.job={state:'idle',received:0,total:8,file:'',error:''};fixtureSetup.models=fixtureSetup.models.map(m=>({...m,needed:true}));
const child=spawn('chromium',['--headless','--no-sandbox',...(process.env.JARVIS_TEST_WEBGL ? ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] : ['--disable-gpu']),'--no-first-run','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+browserProfile,'about:blank'],{stdio:['ignore','ignore','pipe']});
let errors='';child.stderr.on('data',b=>errors+=b);
let socket;
try {
const activePort=path.join(browserProfile,'DevToolsActivePort');
for(let i=0;i<100&&!fs.existsSync(activePort);i++)await new Promise(resolve=>setTimeout(resolve,50));
assert.ok(fs.existsSync(activePort),errors.slice(-600));
const port=fs.readFileSync(activePort,'utf8').split('\n')[0];
const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
await once(socket,'open');
let rpcId=0;
const pending=new Map();
socket.addEventListener('message',event=>{
 const value=JSON.parse(event.data);
 if(pending.has(value.id)){
  const waiter=pending.get(value.id);pending.delete(value.id);
  if(value.error)waiter.reject(new Error(value.error.message));else waiter.resolve(value.result);
 }
});
const call=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++rpcId;const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Timed out: '+method+' '+JSON.stringify(params).slice(0,180)));},15000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});socket.send(JSON.stringify({id,method,params}));
});
await call('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:true});
await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?k=fixture&safeTop='+viewport.top+'&safeBottom='+viewport.bottom});
const expired=new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Browser virtual-time timeout')),25000);
 socket.addEventListener('message',event=>{if(JSON.parse(event.data).method==='Emulation.virtualTimeBudgetExpired'){clearTimeout(timer);resolve();}});
});
await call('Emulation.setVirtualTimePolicy',{policy:'pauseIfNetworkFetchesPending',budget:16000});
await expired;
if(process.env.JARVIS_TEST_WEBGL){
 const core=await call('Runtime.evaluate',{expression:'JSON.stringify(document.getElementById("reactor").dataset)',returnByValue:true});
 assert.equal(JSON.parse(core.result.value).coreModel,'loaded','Blender core must load in WebGL');
 assert.equal(JSON.parse(core.result.value).coreClips,'7','All six rotors and plasma must animate');
}
const dimensions=await call('Runtime.evaluate',{expression:'JSON.stringify({width:innerWidth,height:innerHeight})',returnByValue:true});
const overflow = await call('Runtime.evaluate',{expression:`JSON.stringify(Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>${viewport.width}).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width,e.getBoundingClientRect().right]))`,returnByValue:true});
assert.deepEqual(JSON.parse(dimensions.result.value),{width:viewport.width,height:viewport.height},overflow.result.value);
const page=await call('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
const dom=page.result.value;
const spacing=await call('Runtime.evaluate',{expression:`JSON.stringify((function(){
 const style=selector=>getComputedStyle(document.querySelector(selector));
 return {gap:style('.stage').gap,stagePadding:style('.stage').padding,
 headerInset:style('.transcript-head').paddingLeft,messageInset:style('.transcript').paddingLeft,
 captionInsideCore:document.querySelector('.reactor-wrap').contains(document.getElementById('voiceTicker')),captionBorder:style('#voiceTicker').borderTopWidth,
 reactorRadius:style('.reactor-wrap').borderRadius,conversationRadius:style('.transcript-wrap').borderRadius};
})())`,returnByValue:true});
const inset=viewport.width<768?'16px':'24px';
const radius=viewport.width<768?'14px':'18px';
assert.deepEqual(JSON.parse(spacing.result.value),{gap:viewport.width<768?'12px':'24px',stagePadding:'0px',headerInset:inset,messageInset:inset,captionInsideCore:true,captionBorder:'0px',reactorRadius:'0px',conversationRadius:radius},'Stage spacing and borderless reactor caption must match the layout');
const coreLayer=await call('Runtime.evaluate',{expression:`JSON.stringify((()=>{
 const core=document.querySelector('.reactor-wrap'),chat=document.querySelector('.transcript-wrap');
 const a=core.getBoundingClientRect(),b=chat.getBoundingClientRect();
 return {aligned:Math.abs(a.x-b.x)<1 && Math.abs(a.y-b.y)<1 && Math.abs(a.width-b.width)<1 && Math.abs(a.height-b.height)<1,
 behind:Number(getComputedStyle(core).zIndex)<Number(getComputedStyle(chat).zIndex),
 interactive:getComputedStyle(core).pointerEvents};
})())`,returnByValue:true});
assert.deepEqual(JSON.parse(coreLayer.result.value),{aligned:true,behind:true,interactive:'none'},'Conversation core must sit behind the full message panel without intercepting input');
const screenshot=await call('Page.captureScreenshot');
fs.writeFileSync(path.join(screenshotRoot,'jarvis-phone-theme-'+viewport.width+'.png'),Buffer.from(screenshot.data,'base64'));
// Exercise gestures in the rendered app, including the tablet breakpoint.
await call('Runtime.evaluate',{expression:"document.querySelectorAll('dialog[open]').forEach(d=>d.close())"});
for(const width of [390,820,1280]) {
 await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});
 const gestures=await call('Runtime.evaluate',{expression:`JSON.stringify((()=>{
  const menu=document.querySelector('.workspace-sidebar');
  const fire=(type,x,y,target=document.body)=>{
   const touch=new Touch({identifier:1,target,clientX:x,clientY:y});
   target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'||type==='touchcancel'?[]:[touch],changedTouches:[touch]}));
  };
  const drag=(x,y,endX,endY,target=document.body,cancel=false)=>{
   fire('touchstart',x,y,target);fire('touchmove',endX,endY,target);
   const follows=menu.style.transform!=='';
   fire(cancel?'touchcancel':'touchend',endX,endY,target);
   return follows;
  };
  document.body.dataset.sidebar='closed';
  const follows=drag(16,160,150,165),opened=document.body.dataset.sidebar==='open';
  drag(180,160,30,165,menu);
  const closed=document.body.dataset.sidebar==='closed';
  drag(16,160,20,300);const scrollSafe=document.body.dataset.sidebar==='closed';
  drag(140,160,270,160);const centerSafe=document.body.dataset.sidebar==='closed';
  drag(16,160,34,160);const shortSafe=document.body.dataset.sidebar==='closed';
  drag(16,160,150,160,document.body,true);const cancelSafe=document.body.dataset.sidebar==='closed'&&!menu.style.transform;
  return {follows,opened,closed,scrollSafe,centerSafe,shortSafe,cancelSafe};
 })())`,returnByValue:true});
 assert.deepEqual(JSON.parse(gestures.result.value),{follows:width<=900,opened:width<=900,closed:true,scrollSafe:true,centerSafe:true,shortSafe:true,cancelSafe:true},'Sidebar gestures at '+width+'px');
}
await call('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:true});
await call('Runtime.evaluate',{expression:"document.getElementById('sudoDialog').close(); document.body.dataset.sidebar='open'; document.querySelector('#sidebar-extra .sidebar-nav-button').click()"});
const sidebarLayout=await call('Runtime.evaluate',{expression:"JSON.stringify({open:!document.getElementById('kanban-panel').hidden,fits:document.getElementById('kanban-panel').getBoundingClientRect().right<=innerWidth,history:document.getElementById('conversation-list').textContent.includes('Earlier chat')})",returnByValue:true});
assert.deepEqual(JSON.parse(sidebarLayout.result.value),{open:true,fits:true,history:true});
await call('Runtime.evaluate',{expression:"Array.from(document.querySelectorAll('#sidebar-extra button')).find(button=>button.textContent==='Settings').click()"});
async function settingsEval(expression){
 const tick=new Promise(resolve=>{const listener=event=>{if(JSON.parse(event.data).method==='Emulation.virtualTimeBudgetExpired'){socket.removeEventListener('message',listener);resolve();}};socket.addEventListener('message',listener);});
 await call('Emulation.setVirtualTimePolicy',{policy:'pauseIfNetworkFetchesPending',budget:500});await tick;
 return (await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
}

// Exercise real UI mutations rather than checking only whether the board is visible.
await settingsEval("window.jarvisWorkspace('kanban')");
await settingsEval(`(()=>{const input=document.querySelector('[aria-label="New task title"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Browser fixture task');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await settingsEval("document.querySelector('#kanban-panel form').requestSubmit()");
await settingsEval("true");
assert.equal(fixtureBoard.tasks[0].title,'Browser fixture task');
fixtureBoard=fixtureStore.update({revision:fixtureStore.view().revision,action:'edit',id:fixtureBoard.tasks[0].id,notes:'Edited on another device'});
await settingsEval(`(()=>{const input=document.querySelector('#kanban-panel .kb-task select');input.value='doing';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await settingsEval("true");assert.equal(fixtureBoard.tasks[0].status,'todo');
assert.equal(await settingsEval("document.querySelector('.kanban-error').textContent.includes('Board changed')"),true,'A polling refresh must not hide a failed mutation');
await settingsEval(`(()=>{const input=document.querySelector('#kanban-panel .kb-task select');input.value='doing';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await settingsEval("true");assert.equal(fixtureBoard.tasks[0].status,'doing');

console.log('Checking Kanban keyboard and drag at '+viewport.width+'px');
// Keyboard editing and moves, notes/priority/date/status filters and host-calendar highlights.
if(viewport.width<768)await settingsEval("document.querySelector('.kb-filter-toggle').click()");
await settingsEval("document.querySelector('#kanban-panel .kb-task').focus()");
await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
assert.equal(await settingsEval("!!document.querySelector('.kb-dialog[open]')"),true);
await settingsEval(`(()=>{const note=document.querySelector('.kb-dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(note,'Search needle in task notes');note.dispatchEvent(new Event('input',{bubbles:true}));const selects=document.querySelectorAll('.kb-dialog select');selects[0].value='urgent';selects[0].dispatchEvent(new Event('change',{bubbles:true}));const date=document.querySelector('.kb-dialog input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(date,'2026-01-02');date.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await settingsEval("document.querySelector('.kb-dialog form').requestSubmit()");await settingsEval("true");
assert.equal(fixtureStore.view().tasks[0].notes,'Search needle in task notes');
assert.equal(await settingsEval("document.querySelector('.kb-task').classList.contains('today')"),true,'Due date must use Jan 2 on the host, not the browser clock');
await settingsEval(`(()=>{const q=document.querySelector('.kb-filters input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(q,'needle');q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
assert.equal(await settingsEval("document.querySelectorAll('.kb-task').length"),1);
await settingsEval(`(()=>{const select=document.querySelector('.kb-filters select');select.value='low';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
assert.equal(await settingsEval("document.querySelectorAll('.kb-task').length"),0);
await settingsEval("Array.from(document.querySelectorAll('.kb-filters button')).find(b=>b.textContent.includes('Reset filters')).click()");
assert.equal(await settingsEval("document.querySelectorAll('.kb-task').length"),1);
await settingsEval("document.querySelector('.kb-task').focus()");
await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',modifiers:1});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',modifiers:1});
await settingsEval("true");assert.equal(fixtureStore.view().tasks[0].status,'todo');
assert.equal(await settingsEval("getComputedStyle(document.activeElement).outlineStyle!=='none'"),true,'Keyboard focus must stay visible');
// Grip drag uses Pointer Events for mouse and real finger events on mobile.
await settingsEval("void document.querySelector('.kb-grip').scrollIntoView({block:'center',inline:'center',behavior:'instant'})");
const points=JSON.parse(await settingsEval(`JSON.stringify((()=>{const g=document.querySelector('.kb-grip').getBoundingClientRect(),dest=document.querySelector('[data-column=doing]').getBoundingClientRect();return {x:g.left+g.width/2,y:g.top+g.height/2,tx:Math.min(innerWidth-18,dest.left+dest.width/2),ty:g.top+g.height/2};})())`));
if(viewport.width<768){
 await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:points.x,y:points.y,id:1}]});
 for(let n=1;n<=6;n++)await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:points.x+(points.tx-points.x)*n/6,y:points.ty,id:1}]});
 await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}else{
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:points.x,y:points.y});
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:points.tx,y:points.ty});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:points.tx,y:points.ty});
}
await settingsEval("true");
assert.equal(fixtureStore.view().tasks[0].status,'doing','A finger/mouse drag must move the task to the hovered column');
assert.equal(await settingsEval("Array.from(document.querySelectorAll('.kb-grip,.kb-task-actions button,.kb-task select')).every(e=>e.getBoundingClientRect().height>=44)"),true,'Card touch targets must be at least 44 CSS pixels');
console.log('Checking Kanban backup and retry at '+viewport.width+'px');
// Confirmed restore shows a preview, does not run tasks and restores a consistent snapshot.
await settingsEval("Array.from(document.querySelectorAll('.kb-toolbar button')).find(b=>b.textContent==='Saved backups').click()");
await settingsEval("document.querySelector('.kb-backup-list button').click()");
assert.equal(await settingsEval("document.querySelector('.kb-dialog').textContent.includes('Confirm board restore')"),true);
const beforeRestore=fixtureStore.view().revision;
await settingsEval("Array.from(document.querySelectorAll('.kb-dialog button')).find(b=>b.textContent==='Confirm restore').click()");await settingsEval("true");
assert.ok(fixtureStore.view().revision>beforeRestore);
assert.equal(fixtureStore.view().tasks.some(t=>['queued','running'].includes(t.execution)),false);
// Simulate a server commit followed by a lost response; the retry must not duplicate the task.
dropBoardResponse=true;
await settingsEval(`(()=>{const q=document.querySelector('[aria-label="New task title"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(q,'Lost response task');q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await settingsEval("document.querySelector('.kb-add').requestSubmit()");await settingsEval("true");
assert.equal(fixtureStore.view().tasks.filter(t=>t.title==='Lost response task').length,1);
await settingsEval("Array.from(document.querySelectorAll('.kb-error button')).find(b=>b.textContent.includes('Retry request safely')).click()");await settingsEval("true");
assert.equal(fixtureStore.view().tasks.filter(t=>t.title==='Lost response task').length,1,'Idempotent retry must not create duplicates');
const boardShot=await call('Page.captureScreenshot');fs.writeFileSync(path.join(screenshotRoot,'jarvis-kanban-'+viewport.width+'.png'),Buffer.from(boardShot.data,'base64'));
const other=fixtureStore.view().tasks.find(t=>t.title==='Lost response task');fixtureBoard=fixtureStore.update({revision:fixtureStore.view().revision,action:'delete',id:other.id});
for(let i=0;i<5;i++)await settingsEval("true");

await settingsEval("document.querySelector('[aria-label=\"Delete Browser fixture task\"]').click()");
await settingsEval("Array.from(document.querySelectorAll('.kb-dialog button')).find(b=>b.textContent==='Confirm delete').click()");
await settingsEval("true");assert.equal(fixtureBoard.tasks.length,0);
await settingsEval("window.jarvisWorkspace('settings')");
for(let i=0;i<100;i++){if(await settingsEval("!!document.querySelector('[aria-label=\"Installed Whisper model\"]')"))break;await new Promise(resolve=>setTimeout(resolve,30));}
assert.equal(await settingsEval("document.body.dataset.workspace"),'settings');
assert.equal(await settingsEval("document.getElementById('settings-panel').hidden"),false);
assert.equal(await settingsEval("getComputedStyle(document.querySelector('.stage')).display"),'none');
assert.equal(await settingsEval("document.querySelector('.voice-settings').scrollWidth<=document.getElementById('settings-panel').clientWidth"),true,'Settings must fit the viewport');
assert.equal(await settingsEval("document.querySelector('#sidebar-extra [aria-current=page]').textContent"),'Settings');
await settingsEval(`(function(){const input=document.querySelector('[aria-label="Installed Whisper model"]');input.value='/fixture/ggml-small.bin';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await new Promise(resolve=>setTimeout(resolve,30));
await settingsEval("document.querySelector('#settings-panel form').requestSubmit()");
for(let i=0;i<100;i++){if(await settingsEval("document.querySelector('.settings-message').textContent.includes('saved')"))break;await new Promise(resolve=>setTimeout(resolve,30));}
assert.equal(fixtureVoiceSettings.settings.stt.modelPath,'/fixture/ggml-small.bin');
assert.equal(fixtureVoiceSettings.settings.stt.model,'small');
assert.equal(await settingsEval("document.querySelector('.settings-message').textContent.includes('saved')"),true);
await settingsEval("window.jarvisWorkspace('conversation');window.jarvisWorkspace('settings')");
await new Promise(resolve=>setTimeout(resolve,100));
assert.equal(await settingsEval("document.querySelector('[aria-label=\"Installed Whisper model\"]').value"),'/fixture/ggml-small.bin','Saved model must reload');
failVoiceSave=true;
await settingsEval(`(function(){const input=document.querySelector('[aria-label="Installed Piper voice"]');input.value='/fixture/voice.onnx';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await new Promise(resolve=>setTimeout(resolve,30));
await settingsEval("document.querySelector('#settings-panel form').requestSubmit()");
for(let i=0;i<100;i++){if(await settingsEval("document.querySelector('.settings-error').textContent.includes('Stop')"))break;await new Promise(resolve=>setTimeout(resolve,30));}
assert.equal(await settingsEval("document.querySelector('.settings-error').textContent"),'Stop the active recording before saving.');
assert.equal(fixtureVoiceSettings.settings.tts.modelPath,'','Failed save must not change settings');
await settingsEval("Array.from(document.querySelectorAll('#settings-panel button')).find(button=>button.textContent==='Discard changes').click()");
await new Promise(resolve=>setTimeout(resolve,30));
assert.equal(await settingsEval("document.querySelector('[aria-label=\"Installed Piper voice\"]').value"),'');

const initialSetupPosts=setupPosts;
assert.equal(await settingsEval("document.querySelector('.setup-steps [aria-current=step]').textContent.includes('Welcome')"),true);
assert.equal(setupPosts,initialSetupPosts,'Opening Settings must not download');
await settingsEval("Array.from(document.querySelectorAll('.voice-onboarding button')).find(b=>b.textContent.includes('Set up voice')).click()");
assert.equal(await settingsEval("document.querySelector('.setup-steps [aria-current=step]').textContent.includes('Models')"),true);
await settingsEval("Array.from(document.querySelectorAll('.voice-onboarding button')).find(b=>b.textContent.includes('Download missing models')).click()");
for(let i=0;i<10&&setupPosts===initialSetupPosts;i++)await settingsEval('true');
assert.equal(setupPosts,initialSetupPosts+1);
for(let i=0;i<10;i++){if(await settingsEval("document.querySelector('.voice-onboarding').textContent.includes('Model setup complete')"))break;}
assert.equal(await settingsEval("document.querySelector('.voice-onboarding').textContent.includes('Model setup complete')"),true);
await settingsEval("Array.from(document.querySelectorAll('.voice-onboarding button')).find(b=>b.textContent.includes('Next')).click()");
assert.equal(await settingsEval("document.querySelector('.setup-steps [aria-current=step]').textContent.includes('Try voice')"),true);
const settingsScreenshot=await call('Page.captureScreenshot');
fs.writeFileSync(path.join(screenshotRoot,'jarvis-settings-'+viewport.width+'.png'),Buffer.from(settingsScreenshot.data,'base64'));
// Camera onboarding and media work with no device microphone.
console.log('Checking camera onboarding and streams at '+viewport.width+'px');
await call('Emulation.setVirtualTimePolicy',{policy:'advance'});
const cameraEval=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
async function cameraWait(expression){for(let i=0;i<150;i++){if(await cameraEval(expression))return;await new Promise(r=>setTimeout(r,20));}throw new Error('Camera browser condition timed out: '+expression);}
await cameraEval(`(()=>{const q=document.querySelector('[aria-label="Camera RTSP address"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(q,'rtsp://192.168.1.30/fixture');q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await cameraEval("document.querySelector('.camera-enable input').click()");
await cameraEval(`(()=>{const s=document.querySelector('[aria-label="Voice microphone source"]');s.value='camera';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Save camera settings').click()");
await cameraWait("document.querySelector('.camera-settings').textContent.includes('Camera settings saved')");
assert.equal(cameraFixture.source,'camera');
assert.equal(await cameraEval("document.querySelector('.camera-settings input[type=password]').value"),'','Saved camera address must be cleared from UI');
await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Test video stream').click()");
await cameraWait("!!document.querySelector('.camera-preview')?.naturalWidth");
assert.equal(await cameraEval("document.querySelector('.camera-preview').naturalWidth"),160);
await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Stop camera test').click()");
await cameraWait("!document.querySelector('.camera-preview')");
await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Test camera audio').click()");
await cameraWait("document.querySelector('.camera-settings').textContent.includes('Audio connected')");
await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Stop camera test').click()");
await cameraWait("!Array.from(document.querySelectorAll('.camera-actions button')).some(b=>b.textContent==='Stop camera test')");
await cameraEval("window.deviceMicRequests=0;window.savedDeviceMic=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>{window.deviceMicRequests++;throw new Error('No device microphone in fixture');};window.jarvisWorkspace('voice');document.getElementById('voiceView').click();document.getElementById('ptt').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:77,pointerType:'touch'}))");
await cameraWait("document.body.dataset.state==='listening' && document.getElementById('pttTimer').textContent!=='00:00'");
assert.equal(await cameraEval('window.deviceMicRequests'),0,'Camera recording must never request a device microphone');
assert.ok(cameraAudioReads>0);
await cameraEval("document.getElementById('stopBtn').click();navigator.mediaDevices.getUserMedia=window.savedDeviceMic;window.jarvisWorkspace('settings')");
for(let i=0;i<100&&cameraStreams;i++)await new Promise(r=>setTimeout(r,20));
assert.equal(cameraStreams,0,'Stopping tests/recording closes every camera fetch');
assert.equal(cameraTranscriptions,0,'Cancelled recordings and tests must never be uploaded');
await cameraEval("document.getElementById('voiceView').click();document.getElementById('ptt').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:78,pointerType:'touch'}))");
await cameraWait("document.body.dataset.state==='listening' && document.getElementById('pttTimer').textContent!=='00:00'");
for(const response of cameraAudioResponses)response.end();
await cameraWait("document.getElementById('transcript').textContent.includes('CAMERA AUDIO DISCONNECTED')");
assert.equal(cameraTranscriptions,0,'Disconnected camera audio must be cancelled rather than uploaded');
await cameraEval("document.getElementById('stopBtn').click();window.jarvisWorkspace('settings')");

await cameraWait("!!document.querySelector('.camera-settings')");
assert.equal(await cameraEval("document.querySelector('.camera-settings').scrollWidth<=document.getElementById('settings-panel').clientWidth"),true,'Camera settings fit mobile');
cameraFailNext=true;
await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Test video stream').click()");
await cameraWait("document.querySelector('.camera-settings .settings-error').textContent.includes('Camera stream unavailable')");
assert.equal(await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Test video stream').disabled"),false,'Failed test must allow retry');
await cameraEval("window.savedCameraConfirm=window.confirm;window.confirm=()=>true;Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Forget camera').click();window.confirm=window.savedCameraConfirm;");
await cameraWait("document.querySelector('.camera-settings').textContent.includes('Camera removed')");
assert.equal(cameraFixture.configured,false);assert.equal(cameraFixture.source,'device');
assert.equal(await cameraEval("document.querySelector('.camera-settings select').value"),'device');
assert.equal(await cameraEval("Array.from(document.querySelectorAll('.camera-actions button')).find(b=>b.textContent==='Test camera audio').disabled"),true,'Forgotten cameras cannot be tested');
// Reset the fake profile for the next viewport without invoking browser confirmations.
cameraFixture={configured:false,enabled:false,source:'device',active:0};
await call('Emulation.setVirtualTimePolicy',{policy:'pause'});
const voice=await call('Runtime.evaluate',{expression:`window.jarvisWorkspace('conversation'); document.getElementById('voiceView').click();
JSON.stringify({fits:document.querySelector('.app').scrollWidth<=innerWidth,
top:document.querySelector('.hud').getBoundingClientRect().top,
bottom:document.querySelector('.controls').getBoundingClientRect().bottom})`,returnByValue:true});
const voiceLayout=JSON.parse(voice.result.value);
const voiceOverflow=await call('Runtime.evaluate',{expression:"JSON.stringify(Array.from(document.querySelectorAll('.app *')).filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right]))",returnByValue:true});
assert.ok(voiceLayout.fits,'Voice view must not overflow horizontally: '+voiceOverflow.result.value);
assert.ok(voiceLayout.top>=viewport.top+32);
assert.ok(voiceLayout.bottom<=viewport.height-viewport.bottom);
if(process.env.JARVIS_TEST_WEBGL){
 const point=await call('Runtime.evaluate',{expression:`JSON.stringify((()=>{const c=document.getElementById('reactor'),r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,touch:getComputedStyle(c).touchAction,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===c};})())`,returnByValue:true});
 const p=JSON.parse(point.result.value);assert.equal(p.touch,'none');assert.equal(p.hit,true,'Visible orbit must receive gestures');
 for(const [dx,dy] of [[30,0],[0,30],[30,30]]){
  if(viewport.width<900){
   await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});
   await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+dx,y:p.y+dy}]});
  }else{
   await call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+dx,y:p.y+dy,button:'left',buttons:1});
  }
  const dragging=await call('Runtime.evaluate',{expression:"document.getElementById('reactor').classList.contains('orbit-dragging')",returnByValue:true});
  assert.equal(dragging.result.value,true,'Core must capture real mouse/touch drags');
  if(viewport.width<900)await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  else await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1});
  const released=await call('Runtime.evaluate',{expression:"document.getElementById('reactor').classList.contains('orbit-dragging')",returnByValue:true});
  assert.equal(released.result.value,false,'Releasing the core clears capture');
 }
}
const voiceScreenshot=await call('Page.captureScreenshot');
fs.writeFileSync(path.join(screenshotRoot,'jarvis-phone-voice-'+viewport.width+'.png'),Buffer.from(voiceScreenshot.data,'base64'));
await call('Runtime.evaluate',{expression:`document.getElementById('sudoCommand').textContent='sudo "pacman" "-S" "--needed" "ffmpeg"';
document.getElementById('sudoDirectory').textContent='Working directory: /fixture/workspace';
document.getElementById('sudoPasswordLabel').textContent='Computer password';
document.getElementById('sudoDialog').showModal();`});
const sudoScreenshot=await call('Page.captureScreenshot');
fs.writeFileSync(path.join(screenshotRoot,'jarvis-phone-sudo-'+viewport.width+'.png'),Buffer.from(sudoScreenshot.data,'base64'));
assert.match(dom,/data-test-core="#336688"/);
assert.match(dom,/data-test-bg="rgb\(250, 250, 250\)"/);
assert.match(dom,/data-theme="Light fixture"/);
assert.match(dom,/<meta name="theme-color" content="#fafafa">/);
assert.ok(themeReads>=2);
assert.match(dom,/data-test-composer="true"/, 'Composer should stay visible and inside the phone viewport');
assert.match(dom,/data-test-transcript="true"/, 'Conversation should have room for readable replies');
assert.match(dom,/data-test-views="true"/, 'Both view controls should update their selected state');
assert.match(dom,/data-test-personality-layout="true"/, 'Personality editor must fit the phone viewport');
assert.match(dom,/data-test-personality-saved="true"/, 'Personality must save and reload');
assert.match(dom,/data-test-safe-header="true"/, 'Header must remain below the iPhone safe area');
assert.match(dom,/data-test-navigation="true"/, 'Every navigation label must fit inside the screen');
assert.match(dom,/data-test-sudo-layout="true"/, 'Sudo dialog must fit the phone screen');
assert.match(dom,/data-test-sudo-cleared="true"/, 'Password field must be cleared after submission');
assert.match(dom,/data-test-sudo-retained="true"/, 'A temporary polling failure must not dismiss authorization');
assert.match(dom,/data-test-sudo-reconnected="true"/, 'Authorization must recover after a connection hiccup');
assert.match(dom,/data-test-sudo-ended="true"/, 'A stopped command must show an explanation instead of silently disappearing');
assert.ok(sudoApproved,'WebCrypto-encrypted password must reach only the fake sudo helper');
assert.ok(savedPersonality);
// Fresh pages choose voice only after both runtimes are ready. No media starts.
console.log('Checking default voice mode at '+viewport.width+'px');
await call('Page.enable');
await call('Page.addScriptToEvaluateOnNewDocument',{source:"window.defaultMicRequests=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.defaultMicRequests++;return Promise.reject(new Error('Automatic microphone access is forbidden'));};"});
const defaultsEval=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
async function defaultTick(){
 const expired=new Promise(resolve=>{const listener=event=>{if(JSON.parse(event.data).method==='Emulation.virtualTimeBudgetExpired'){socket.removeEventListener('message',listener);resolve();}};socket.addEventListener('message',listener);});
 await call('Emulation.setVirtualTimePolicy',{policy:'pauseIfNetworkFetchesPending',budget:1000});await expired;
}
async function defaultLoad(stt,tts){
 fixtureSTTReady=stt;fixtureTTSReady=tts;
 await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?k=fixture&defaultViewTest=1'});
 await defaultTick();
}
await defaultLoad(true,true);
assert.equal(await defaultsEval('document.body.dataset.workspace'),'voice','Ready startup defaults to voice');
assert.equal(await defaultsEval('document.body.dataset.view'),'voice');
assert.equal(await defaultsEval("document.getElementById('voiceView').getAttribute('aria-pressed')"),'true');
assert.equal(await defaultsEval('window.defaultMicRequests'),0);
await defaultLoad(false,false);
assert.equal(await defaultsEval('document.body.dataset.workspace'),'conversation','Missing models keep text mode');
assert.equal(await defaultsEval("document.getElementById('ptt').disabled"),true);
assert.equal(await defaultsEval("document.getElementById('composer').hidden"),false);
await defaultsEval("window.jarvisWorkspace('settings')");
fixtureSTTReady=true;fixtureTTSReady=true;
await defaultsEval("window.dispatchEvent(new CustomEvent('jarvis-voice-settings-saved'))");await defaultTick();
assert.equal(await defaultsEval('document.body.dataset.workspace'),'settings','Completing setup never ejects the user from Settings');
assert.equal(await defaultsEval('document.body.dataset.view'),'voice','Setup completion updates the default mode');
assert.equal(await defaultsEval('window.defaultMicRequests'),0);
await defaultsEval("document.getElementById('chatView').click()");
fixtureTTSReady=false;await defaultsEval("window.dispatchEvent(new CustomEvent('jarvis-voice-settings-saved'))");await defaultTick();
fixtureTTSReady=true;await defaultsEval("window.dispatchEvent(new CustomEvent('jarvis-voice-settings-saved'))");await defaultTick();
assert.equal(await defaultsEval('document.body.dataset.workspace'),'conversation','Status updates preserve explicit text navigation');
assert.equal(await defaultsEval('document.body.dataset.view'),'chat');
await defaultLoad(true,false);
assert.equal(await defaultsEval('document.body.dataset.view'),'chat','Incomplete speech runtime keeps text as default');
await defaultLoad(true,true);
assert.equal(await defaultsEval('document.body.dataset.workspace'),'voice','Subsequent ready loads use voice');
assert.equal(await defaultsEval('window.defaultMicRequests'),0,'Readiness never activates a microphone');
assert.equal(cameraStreams,0,'Default view never opens a camera stream');

} finally {
 socket?.close();
 const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;
}
}
console.log('PASS: desktop/mobile layout, Kanban edits/filters/local dates, touch and keyboard moves, safe retries, confirmed restore, onboarding, theme and sudo dialogs.');
} finally {server.closeAllConnections();server.close();fs.rmSync(boardFixtureDir,{recursive:true,force:true});fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
