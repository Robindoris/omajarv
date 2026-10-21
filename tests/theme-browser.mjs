import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { buildTheme, themeStyles } from '../server/lib/theme.mjs';
const root=path.resolve(import.meta.dirname, '../server/public');
const dark=buildTheme({background:'#0C1013',foreground:'#DBE2E6',accent:'#6567EC',muted:'#91A1AC',red:'#E28174',yellow:'#E2DA74'},'Orbit 204');
const light=buildTheme({mode:'light',background:'#fafafa',foreground:'#151515',accent:'#336688',muted:'#555555',red:'#b53333',yellow:'#805e00'},'Light fixture');
let themeReads=0;
const server=http.createServer((req,res)=>{
const url=new URL(req.url,'http://localhost');
res.setHeader('cache-control','no-store');
if(url.pathname==='/api/theme'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(++themeReads<2?dark:light));}
if(url.pathname==='/theme.css'){res.setHeader('content-type','text/css');return res.end(themeStyles(dark));}
if(url.pathname==='/api/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({agent:{label:'Codex'},session:{turns:0},stt:{ready:true},tts:{ready:true}}));}
if(url.pathname==='/api/history'){res.setHeader('content-type','application/json');return res.end('{"messages":[],"busy":false}');}
const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
if(name.includes('..')||!fs.existsSync(path.join(root,name))){res.writeHead(404);return res.end();}
let source=fs.readFileSync(path.join(root,name));
res.setHeader('content-type',name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript');
if(name==='index.html')source=source.toString().replace('</body>',`<script>setInterval(function(){var s=getComputedStyle(document.documentElement);document.body.dataset.testCore=s.getPropertyValue('--core').trim();document.body.dataset.testBg=getComputedStyle(document.body).backgroundColor;},100);</script></body>`);
res.end(source);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-theme-browser-'));
try{
const child=spawn('chromium',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage','--user-data-dir='+profile,'--window-size=390,844','--virtual-time-budget=16000','--screenshot=/tmp/jarvis-phone-theme-light.png','--dump-dom','http://127.0.0.1:'+server.address().port+'/?k=fixture'],{stdio:['ignore','pipe','pipe']});
let dom='',errors='';child.stdout.on('data',b=>dom+=b);child.stderr.on('data',b=>errors+=b);
const timer=setTimeout(()=>child.kill('SIGTERM'),30000);
const [code]=await once(child,'exit');clearTimeout(timer);
assert.equal(code,0,errors.slice(-600));
assert.match(dom,/data-test-core="#336688"/);
assert.match(dom,/data-test-bg="rgb\(250, 250, 250\)"/);
assert.match(dom,/data-theme="Light fixture"/);
assert.match(dom,/<meta name="theme-color" content="#fafafa">/);
assert.ok(themeReads>=2);
console.log('PASS: mobile Chromium applies initial theme and switches an open page to the new palette, including browser chrome.');
} finally {server.closeAllConnections();server.close();fs.rmSync(profile,{recursive:true,force:true});}
