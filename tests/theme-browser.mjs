import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { buildTheme, themeStyles } from '../server/lib/theme.mjs';
const root=path.resolve(import.meta.dirname, '../server/public');
const dark=buildTheme({background:'#0C1013',foreground:'#DBE2E6',accent:'#6567EC',muted:'#91A1AC',red:'#E28174',yellow:'#E2DA74'},'Orbit 204');
const light=buildTheme({mode:'light',background:'#fafafa',foreground:'#151515',accent:'#336688',muted:'#555555',red:'#b53333',yellow:'#805e00'},'Light fixture');
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
if(url.pathname==='/api/theme'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(++themeReads<2?dark:light));}
if(url.pathname==='/theme.css'){res.setHeader('content-type','text/css');return res.end(themeStyles(dark));}
if(url.pathname==='/api/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({agent:{label:'Codex'},session:{turns:0},stt:{ready:true},tts:{ready:true}}));}
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
if(name==='index.html')source=source.toString().replace('</body>',`<script>setInterval(function(){var s=getComputedStyle(document.documentElement);document.body.dataset.testCore=s.getPropertyValue('--core').trim();document.body.dataset.testBg=getComputedStyle(document.body).backgroundColor;
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
document.body.dataset.testComposer=String(!composer.hidden && composer.getBoundingClientRect().bottom <= innerHeight);
document.body.dataset.testTranscript=String(transcript.getBoundingClientRect().height >= 180);
if(!document.body.dataset.testViews){
 document.getElementById('voiceView').click();
 var voice=document.body.dataset.view==='voice' && document.getElementById('voiceView').getAttribute('aria-pressed')==='true';
 document.getElementById('chatView').click();
 document.body.dataset.testViews=String(voice && document.body.dataset.view==='chat' && document.getElementById('chatView').getAttribute('aria-pressed')==='true');
}
},100);</script></body>`);
if(name==='index.html')source=source.toString().replace('</body>',`<script>
var personalityTestStep=0;
setInterval(function(){
 var dialog=document.getElementById('personalityDialog');
 if(personalityTestStep===0){document.getElementById('personalityBtn').click();personalityTestStep=1;}
 else if(personalityTestStep===1 && dialog.open){
  var rect=dialog.getBoundingClientRect();
  document.body.dataset.testPersonalityLayout=String(rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight);
  document.getElementById('personalityInput').value='Be warm and explain clearly.';
  document.getElementById('personalityForm').requestSubmit();personalityTestStep=2;
 } else if(personalityTestStep===2 && !dialog.open){
  document.getElementById('personalityBtn').click();personalityTestStep=3;
 } else if(personalityTestStep===3 && dialog.open){
  document.body.dataset.testPersonalitySaved=String(document.getElementById('personalityInput').value==='Be warm and explain clearly.');
  dialog.close();fetch('/test-sudo/start');personalityTestStep=4;
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
for(const viewport of [{width:390,height:844,top:59,bottom:34},{width:320,height:740,top:20,bottom:0}]) {
themeReads=0;savedPersonality=false;sudoPending=false;sudoApproved=false;failSudoPoll=false;
const browserProfile=fs.mkdtempSync(path.join(profile,'browser-'));
const child=spawn('chromium',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+browserProfile,'about:blank'],{stdio:['ignore','ignore','pipe']});
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
 const id=++rpcId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
});
await call('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:true});
await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?k=fixture&safeTop='+viewport.top+'&safeBottom='+viewport.bottom});
const expired=new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Browser virtual-time timeout')),25000);
 socket.addEventListener('message',event=>{if(JSON.parse(event.data).method==='Emulation.virtualTimeBudgetExpired'){clearTimeout(timer);resolve();}});
});
await call('Emulation.setVirtualTimePolicy',{policy:'pauseIfNetworkFetchesPending',budget:16000});
await expired;
const dimensions=await call('Runtime.evaluate',{expression:'JSON.stringify({width:innerWidth,height:innerHeight})',returnByValue:true});
const overflow = await call('Runtime.evaluate',{expression:`JSON.stringify(Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>${viewport.width}).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width,e.getBoundingClientRect().right]))`,returnByValue:true});
assert.deepEqual(JSON.parse(dimensions.result.value),{width:viewport.width,height:viewport.height},overflow.result.value);
const page=await call('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
const dom=page.result.value;
const screenshot=await call('Page.captureScreenshot');
fs.writeFileSync('/tmp/jarvis-phone-theme-'+viewport.width+'.png',Buffer.from(screenshot.data,'base64'));
const voice=await call('Runtime.evaluate',{expression:`document.getElementById('personalityDialog').close(); document.getElementById('voiceView').click();
JSON.stringify({fits:document.querySelector('.app').scrollWidth<=innerWidth,
top:document.querySelector('.hud').getBoundingClientRect().top,
bottom:document.querySelector('.controls').getBoundingClientRect().bottom})`,returnByValue:true});
const voiceLayout=JSON.parse(voice.result.value);
assert.ok(voiceLayout.fits,'Voice view must not overflow horizontally');
assert.ok(voiceLayout.top>=viewport.top+32);
assert.ok(voiceLayout.bottom<=viewport.height-viewport.bottom);
const voiceScreenshot=await call('Page.captureScreenshot');
fs.writeFileSync('/tmp/jarvis-phone-voice-'+viewport.width+'.png',Buffer.from(voiceScreenshot.data,'base64'));
await call('Runtime.evaluate',{expression:`document.getElementById('sudoCommand').textContent='sudo "pacman" "-S" "--needed" "ffmpeg"';
document.getElementById('sudoDirectory').textContent='Working directory: /fixture/workspace';
document.getElementById('sudoPasswordLabel').textContent='Computer password';
document.getElementById('sudoDialog').showModal();`});
const sudoScreenshot=await call('Page.captureScreenshot');
fs.writeFileSync('/tmp/jarvis-phone-sudo-'+viewport.width+'.png',Buffer.from(sudoScreenshot.data,'base64'));
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
} finally {
 socket?.close();
 const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;
}
}
console.log('PASS: phone layout/theme, personality editing and encrypted sudo dialog submission/clearing at both mobile widths.');
} finally {server.closeAllConnections();server.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
