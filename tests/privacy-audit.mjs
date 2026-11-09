import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-audit-'));
const oldHome=process.env.HOME, oldPath=process.env.PATH;
process.env.HOME=home;
process.env.PATH=path.join(home,'bin')+':'+oldPath;
let remote, stopTunnel;
try {
  const {ensureDirs,paths,writeSessions}=await import('../server/lib/config.mjs');
  const {writePrivateFile,publicAgentError}=await import('../server/lib/privacy.mjs');
  const {toWav16k}=await import('../server/lib/stt.mjs');
  const tunnel=await import('../server/lib/tunnel.mjs');stopTunnel=tunnel.stopTunnel;
  ensureDirs();fs.mkdirSync(path.join(home,'bin'));
  const file=path.join(paths.stateDir,'private-fixture');
  fs.writeFileSync(file,'old',{mode:0o644});
  writePrivateFile(file,'new private value');
  assert.equal(fs.statSync(file).mode & 0o777,0o600);
  assert.equal(fs.readFileSync(file,'utf8'),'new private value');
  fs.writeFileSync(paths.sessionsFile,'{}',{mode:0o644});
  writeSessions({test:'fixture'});
  assert.equal(fs.statSync(paths.sessionsFile).mode & 0o777,0o600);
  assert.ok(!publicAgentError(new Error('PRIVATE_PROMPT_FIXTURE')).includes('PRIVATE_PROMPT_FIXTURE'));

  fs.writeFileSync(path.join(home,'bin/cloudflared'),`#!${process.execPath}
const fs=require('node:fs');
fs.writeFileSync(process.env.HOME+'/tunnel-args',JSON.stringify(process.argv.slice(2)));
console.error('ERR PRIVATE_DIAGNOSTIC_MARKER');
setTimeout(()=>console.log('https://fixture.trycloudflare.com'),10);
setTimeout(()=>{},30000);
`,{mode:0o755});
  const recorded=[], originalLog=console.log;
  console.log=(...args)=>recorded.push(args.join(' '));
  try {
    tunnel.startTunnel({port:4317,tunnel:{enabled:true}});
    for(let i=0;i<100&&tunnel.tunnelStatus().state!=='up';i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(tunnel.tunnelStatus().state,'up');
    const args=JSON.parse(fs.readFileSync(path.join(home,'tunnel-args'),'utf8'));
    assert.ok(!args.includes('--no-tls-verify'));
    const ingressFile=args[args.indexOf('--config')+1];
    assert.deepEqual(JSON.parse(fs.readFileSync(ingressFile,'utf8')),
      {ingress:[{service:`unix:${paths.serveSocket}`} ]});
    assert.equal(fs.statSync(ingressFile).mode & 0o777,0o600);
    assert.ok(args.includes('--hello-world'));
    assert.ok(!args.includes('--url'));
    assert.ok(!args.includes('--origin-server-name'));
    assert.ok(!JSON.stringify(tunnel.tunnelStatus()).includes('PRIVATE_DIAGNOSTIC_MARKER'));
    assert.ok(!recorded.join('\n').includes('PRIVATE_DIAGNOSTIC_MARKER'));
    assert.ok(!recorded.join('\n').includes('trycloudflare.com'));
  } finally {tunnel.stopTunnel();console.log=originalLog;}

  // A real FFmpeg conversion still accepts browser-style WAV and ordinary M4A.
  const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
  wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const input=path.join(home,'recording.wav'), output=path.join(home,'converted.wav');
  fs.writeFileSync(input,wav);
  toWav16k(input,output);assert.ok(fs.statSync(output).size>44);
  const m4a=path.join(home,'recording.m4a');
  const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',input,'-c:a','aac',m4a],{encoding:'utf8'});
  assert.equal(encoded.status,0,encoded.stderr);
  toWav16k(m4a,output);assert.ok(fs.statSync(output).size>44);

  // Run the fixture HTTP server separately, so a synchronous decoder cannot hide requests.
  const requestFile=path.join(home,'unexpected-network-request');
  remote=spawn(process.execPath,['--input-type=module','-e',`
import http from 'node:http';import fs from 'node:fs';
const server=http.createServer((req,res)=>{fs.writeFileSync(${JSON.stringify(requestFile)},'requested');res.end('not audio');});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
`],{stdio:['ignore','pipe','ignore']});
  const port=await new Promise(resolve=>remote.stdout.once('data',chunk=>resolve(Number(chunk.toString().trim()))));
  const manifest=path.join(home,'recording.m3u8');
  fs.writeFileSync(manifest,`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${port}/segment.ts\n#EXT-X-ENDLIST\n`);
  assert.throws(()=>toWav16k(manifest,output),/Audio conversion failed/);
  assert.equal(fs.existsSync(requestFile),false,'Uploaded playlists must not make network requests');
  const panel=fs.readFileSync('plugin/h3man.jarvis/Panel.qml','utf8');
  assert.ok([...panel.matchAll(/\bText\s*\{/g)].every(match=>panel.slice(match.index,match.index+75).includes('textFormat: Text.PlainText')));
  console.log('PASS: private file modes, diagnostic suppression, private Cloudflare ingress, safe WAV/M4A conversion, blocked playlist networking and plain native labels.');
} finally {
  stopTunnel?.();
  if(remote){const stopped=once(remote,'exit');remote.kill('SIGTERM');await stopped;}
  process.env.HOME=oldHome;process.env.PATH=oldPath;
  fs.rmSync(home,{recursive:true,force:true});
}
