import {spawn} from 'node:child_process';
import {isIP} from 'node:net';
import {writeConfig} from './config.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function validateCameraURL(value){
 if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f]/.test(value))fail(400,'Use an RTSP camera URL without spaces.');
 let url;try{url=new URL(value);}catch{fail(400,'Invalid RTSP camera URL.');}
 // Literal LAN addresses avoid DNS rebinding and keep cameras off public services.
 const host=url.hostname,parts=host.split('.').map(Number);
 if(url.protocol!=='rtsp:'||isIP(host)!==4||!(parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31))||url.hash)fail(400,'Use rtsp:// with a private LAN IPv4 camera address (10.x, 172.16–31.x or 192.168.x).');
 return url.toString();
}
export function createIPCamera(config,{persist=writeConfig,spawnProcess=spawn}={}){
 const sessions=new Set();
 function view(){const c=config.ipCamera||{};return {configured:!!c.url,enabled:!!c.enabled,source:c.source==='camera'?'camera':'device',active:sessions.size};}
 function update(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['url','enabled','source','forget'].includes(k)))fail(400,'Invalid camera settings.');
  if(sessions.size)fail(409,'Stop camera tests and recording before saving camera settings.');
  const next={url:'',enabled:false,source:'device',...config.ipCamera};
  if(input.forget===true){next.url='';next.enabled=false;next.source='device';}
  else{
   if(input.forget!==undefined&&input.forget!==false)fail(400,'Invalid camera settings.');
   if(input.url!==undefined&&input.url!=='')next.url=validateCameraURL(input.url);
   if(input.enabled!==undefined){if(typeof input.enabled!=='boolean')fail(400,'Invalid camera enabled value.');next.enabled=input.enabled;}
   if(input.source!==undefined){if(!['camera','device'].includes(input.source))fail(400,'Choose device or camera microphone.');next.source=input.source;}
   if((next.enabled||next.source==='camera')&&!next.url)fail(400,'Save a camera URL first.');
   if(next.source==='camera'&&!next.enabled)fail(400,'Enable the camera before using its microphone.');
  }
  persist({...config,ipCamera:next});config.ipCamera=next;return view();
 }
 function stream(kind,req,res){
  if(!['audio','video'].includes(kind))fail(404,'Unknown camera stream.');
  const c=config.ipCamera;
  if(!c?.enabled||!c.url)fail(409,'Enable and configure the camera in Settings first.');
  const url=validateCameraURL(c.url);
  if(sessions.size>=3)fail(429,'Too many camera streams. Stop an existing test or recording.');
  const args=['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','rtsp,tcp','-rtsp_transport','tcp','-timeout','8000000','-i',url];
  if(kind==='audio')args.push('-map','0:a:0','-vn','-ac','1','-ar','48000','-c:a','pcm_s16le','-f','s16le','pipe:1');
  else args.push('-map','0:v:0','-an','-vf',"fps=8,scale=640:-2",'-c:v','mjpeg','-q:v','6','-f','image2pipe','pipe:1');
  const child=spawnProcess('ffmpeg',args,{stdio:['ignore','pipe','ignore']});
  let started=false,closed=false,killTimer;
  const cleanup=()=>{
   if(closed)return;closed=true;clearTimeout(startTimer);clearTimeout(lifetime);sessions.delete(session);
   child.stdout.unpipe(res);child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);killTimer.unref?.();
  };
  const error=()=>{
   if(closed)return;
   if(!res.headersSent){res.writeHead(502,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Camera stream unavailable. Check address, credentials and whether this camera provides '+kind+'.'}));}
   else res.end();cleanup();
  };
  const session={stop(){if(!res.writableEnded)res.end();cleanup();}};sessions.add(session);
  const startTimer=setTimeout(error,12000);
  const lifetime=setTimeout(()=>session.stop(),kind==='video'?60000:Math.min(610,Math.max(30,Number(config.maxRecordingSec)||120)+10)*1000);
  res.on('close',cleanup);child.once('error',error);child.once('close',()=>{clearTimeout(killTimer);if(!closed)error();});
  child.stdout.once('data',()=>{
   if(closed)return;started=true;clearTimeout(startTimer);
   res.writeHead(200,{'content-type':kind==='audio'?'application/octet-stream':'application/x-jarvis-jpeg-stream','cache-control':'no-store','x-accel-buffering':'no'});
  });
  // pipe's listener follows the first-data listener, so headers precede all bytes.
  child.stdout.pipe(res,{end:false});
  return session;
 }
 return {view,update,stream,close(){for(const session of [...sessions])session.stop();}};
}
