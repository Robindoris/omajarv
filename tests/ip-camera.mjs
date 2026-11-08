import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import http from 'node:http';
import {createIPCamera,validateCameraURL} from '../server/lib/ip-camera.mjs';
for(const value of ['file:///etc/passwd','http://192.168.1.3/','rtsp://127.0.0.1/','rtsp://169.254.169.254/','rtsp://8.8.8.8/','rtsp://camera.local/','rtsp://192.168.1.1/ x','rtsp://192.168.1.2/#x'])assert.throws(()=>validateCameraURL(value));
assert.match(validateCameraURL('rtsp://user:fixture-password@192.168.1.3:554/live'),/^rtsp:/);
const config={maxRecordingSec:1,unrelated:{keep:true}},children=[],calls=[];let saved;
const camera=createIPCamera(config,{persist:c=>saved=structuredClone(c),spawnProcess:(command,args,options)=>{
 calls.push({command,args,options});const child=new EventEmitter();child.stdout=new PassThrough();child.kills=[];child.kill=signal=>{child.kills.push(signal);setImmediate(()=>child.emit('close',0));return true;};children.push(child);
 if(config.ipCamera.url.endsWith('/broken'))setImmediate(()=>child.emit('error',new Error('RAW PRIVATE CAMERA DIAGNOSTIC')));
 else setImmediate(()=>child.stdout.write(args.includes('s16le')?Buffer.alloc(960,1):Buffer.from([255,216,1,2,255,217])));
 return child;
}});
assert.equal(camera.view().configured,false);assert.throws(()=>camera.update({source:'camera'}));
assert.throws(()=>camera.update({enabled:'yes'}));assert.throws(()=>camera.update({url:'file:///etc/shadow'}));
camera.update({url:'rtsp://user:fixture-password@192.168.1.3/live',enabled:true,source:'camera'});
assert.equal(saved.unrelated.keep,true);assert.equal(camera.view().source,'camera');assert.equal(JSON.stringify(camera.view()).includes('fixture-password'),false);
camera.update({url:'',source:'device'});assert.match(config.ipCamera.url,/fixture-password/);
const before=structuredClone(config);const failing=createIPCamera(config,{persist:()=>{throw new Error('disk full');}});assert.throws(()=>failing.update({enabled:false}));assert.deepEqual(config,before);
const server=http.createServer((req,res)=>{try{camera.stream(req.url.slice(1),req,res);}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
try{
 const video=await fetch(base+'/video'),audio=await fetch(base+'/audio');
 assert.equal(video.status,200);assert.equal(audio.status,200);assert.equal(video.headers.get('cache-control'),'no-store');
 assert.equal((await video.body.getReader().read()).value[0],255);assert.equal((await audio.body.getReader().read()).value.length,960);
 assert.equal(camera.view().active,2);assert.throws(()=>camera.update({enabled:false}),/Stop/);
 const third=await fetch(base+'/video');assert.equal(third.status,200);assert.equal((await fetch(base+'/audio')).status,429);
 const args=calls[0].args;assert.equal(calls[0].command,'ffmpeg');assert.equal(calls[0].options.stdio[2],'ignore');assert.ok(args.includes('tcp'));assert.ok(args.includes('rtsp,tcp'));assert.ok(args.includes('8000000'));
 camera.close();assert.equal(camera.view().active,0);assert.ok(children.every(c=>c.kills.includes('SIGTERM')));
 const controller=new AbortController();const disconnected=await fetch(base+'/audio',{signal:controller.signal});await disconnected.body.getReader().read();controller.abort();
 for(let i=0;i<50&&camera.view().active;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(camera.view().active,0,'Client disconnect releases the camera process');assert.ok(children.at(-1).kills.includes('SIGTERM'));
 camera.update({url:'rtsp://192.168.1.3/broken'});
 const broken=await fetch(base+'/audio');assert.equal(broken.status,502);assert.equal((await broken.text()).includes('RAW PRIVATE'),false);
 camera.update({forget:true});assert.deepEqual(camera.view(),{configured:false,enabled:false,source:'device',active:0});assert.equal(config.ipCamera.url,'');assert.equal((await fetch(base+'/audio')).status,409);
 console.log('PASS: private RTSP validation, credential redaction, atomic persistence, video/audio bytes, concurrency, sanitized errors, disabled state and child cleanup.');
}finally{camera.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
