// One explicitly requested, pinned model installation at a time. No package installs.
import path from 'node:path';
import {downloads,downloadVerified} from '../setup.mjs';
import {paths} from './config.mjs';
import {usable,whisperPath,piperPath,discoverModels} from './models.mjs';
import {findBin} from './stt.mjs';
import {updateVoiceSettings} from './voice-settings.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createVoiceSetup(config,{download=downloadVerified,update=updateVoiceSettings,busy=()=>false,discover=discoverModels,catalog=downloads,directories={whisper:paths.whisperModels,piper:paths.piperVoices}}={}) {
 let job={state:'idle',received:0,total:0,file:'',error:''};
 let running;
 const installed=(file,kind)=>usable(file)&&(kind!=='piper'||usable(file+'.json'));
 function plan(){
  const found=discover(config),changes={},needed={whisper:false,piper:false};
  for(const kind of ['whisper','piper']){
   const current=kind==='whisper'?whisperPath(config):piperPath(config);
   if(installed(current,kind))continue;
   const selected=found[kind].find(file=>installed(file,kind));
   needed[kind]=!selected;
   const file=selected||path.join(directories[kind],catalog[kind][0].file);
   if(kind==='whisper')changes.stt={model:path.basename(file).replace(/^ggml-/,'').replace(/\.bin$/,''),modelPath:file};
   else changes.tts={voice:path.basename(file,'.onnx'),modelPath:file};
  }
  return {changes,needed};
 }
 function view(){
  const {needed,changes}=plan();
  return {job:{...job},needsConfiguration:!!Object.keys(changes).length,missing:needed,runtime:{whisper:!!findBin('whisper-cli','whisper-cpp','main'),piper:!!findBin('piper','piper-tts'),ffmpeg:!!findBin('ffmpeg')},models:[
   {id:'whisper',name:needed.whisper?'Whisper base.en':'Whisper · '+(changes.stt?.model||config.stt.model),language:needed.whisper?'English':config.stt.language||'Configured language',bytes:catalog.whisper.reduce((n,f)=>n+f.bytes,0),source:needed.whisper?'Hugging Face / ggerganov/whisper.cpp':'Installed local model',terms:needed.whisper?'OpenAI Whisper MIT license':'Installed model terms apply',needed:needed.whisper},
   {id:'piper',name:needed.piper?'Piper LJ Speech medium':'Piper · '+(changes.tts?.voice||config.tts.voice),language:needed.piper?'English':'Configured voice',bytes:catalog.piper.reduce((n,f)=>n+f.bytes,0),source:needed.piper?'Hugging Face / rhasspy/piper-voices':'Installed local voice',terms:needed.piper?'LJ Speech model card: public-domain training dataset; upstream model/runtime terms apply':'Installed model terms apply',needed:needed.piper}
  ]};
 }
 function start(payload){
  if(payload?.consent!==true||Object.keys(payload).some(key=>key!=='consent'))fail('Confirm model download consent.');
  if(running)fail('A model download is already running.',409);
  if(busy())fail('Stop the active reply or speech request before setting up models.',409);
  const {needed,changes}=plan();
  const files=Object.entries(needed).filter(([,value])=>value).flatMap(([kind])=>catalog[kind].map(item=>({kind,item})));
  job={state:files.length?'downloading':'complete',received:0,total:files.reduce((n,{item})=>n+item.bytes,0),file:'',error:''};
  if(!files.length){
   try {if(Object.keys(changes).length)update(config,changes,{busy:busy()});}
   catch(error){job.state='error';job.error=error.status?error.message:'Unable to apply installed model settings.';throw error;}
   return view();
  }
  running=(async()=>{
   let complete=0;
   try {
    for(const {kind,item} of files){
     job.file=item.file;
     await download(item,path.join(directories[kind],item.file),{quiet:true,onProgress:bytes=>{job.received=complete+bytes;}});
     complete+=item.bytes;job.received=complete;
    }
    update(config,changes,{busy:busy()});
    job.state='complete';job.file='';
   } catch(error){job.state='error';job.error=error.status?error.message:'Model download or verification failed. Check the connection and free disk space, then retry.';}
   finally {running=null;}
  })();
  return view();
 }
 return {view,start,isRunning:()=>!!running,wait:()=>running||Promise.resolve()};
}
