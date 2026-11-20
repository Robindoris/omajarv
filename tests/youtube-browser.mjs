import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-video-browser-'));
try{
 const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {YouTubePlayer} from './frontend/src/youtube-player.jsx';createRoot(document.getElementById('root')).render(<YouTubePlayer/>);setTimeout(()=>{window.dispatchEvent(new CustomEvent('jarvis-video',{detail:{results:[{id:'abcdefghijk',title:'Space',channel:'Science'},{id:'12345678901',title:'Moon'}],selected:null}}));setTimeout(()=>{const section=document.querySelector('section');if(!section||section.querySelector('iframe'))throw Error('Ambiguous selection failed');section.querySelector('.youtube-results button').click();setTimeout(()=>{const frame=section.querySelector('iframe');const rect=section.getBoundingClientRect();if(!frame?.src.includes('/embed/abcdefghijk?autoplay=1&playsinline=1')||!section.textContent.includes('tap Play')||!section.textContent.includes('embedding is blocked')||rect.width>innerWidth||rect.left<0)throw Error('Player or responsive fallback failed');section.querySelector('[aria-label="Close video player"]').click();setTimeout(()=>{if(document.querySelector('iframe'))throw Error('Close failed');document.body.dataset.test='passed';},20);},30);},30);},100);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const css=fs.readFileSync('frontend/src/dashboard.css','utf8').split('.youtube-player {').at(-1);
 fs.writeFileSync(path.join(dir,'index.html'),'<html><head><style>:root{--panel:#111;--text:#fff;--core:#ccc}.youtube-player {'+css+'</style></head><body><div id="root"></div><script>'+result.outputFiles[0].text+'</script></body></html>');
 for(const width of [1280,390,320]){
 const run=spawnSync('chromium',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage','--user-data-dir='+path.join(dir,'profile'+width),'--window-size='+width+',900','--virtual-time-budget=2500','--dump-dom','file://'+path.join(dir,'index.html')],{encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});
 assert.ok((run.stdout||'').includes('data-test="passed"'),`Browser width ${width}: ${run.error?.message||run.stderr?.slice(-400)}`);
 console.log(`PASS ${width}px: ambiguous selection, embedded playback URL, fallback instructions, responsive bounds, close stops player`);
 }
}finally{fs.rmSync(dir,{recursive:true,force:true});}
