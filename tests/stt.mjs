import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-stt-test-')),originalHome=process.env.HOME,originalPath=process.env.PATH;
process.env.HOME=home;const bin=path.join(home,'bin');fs.mkdirSync(bin);process.env.PATH=bin+':'+originalPath;
try{
 const {transcribe,sttStatus}=await import('../server/lib/stt.mjs');const {paths}=await import('../server/lib/config.mjs');fs.mkdirSync(paths.tmp,{recursive:true,mode:0o700});
 const model=path.join(home,'fixture-model.bin');fs.writeFileSync(model,'fixture');const config={stt:{model:'fixture',modelPath:model,language:'en'}};
 const whisper=path.join(bin,'whisper-cli');fs.writeFileSync(whisper,`#!${process.execPath}\nif(process.env.JARVIS_STT_FAIL){console.error('PRIVATE_RECORDING_DIAGNOSTIC');process.exit(1);}console.log('Fixture transcription');`,{mode:0o755});
 const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 const source=path.join(home,'silence.wav');fs.writeFileSync(source,wav);
 for(const [extension,codec,type] of [['webm','libopus','audio/webm'],['ogg','libopus','audio/ogg'],['m4a','aac','audio/mp4']]){
  const target=path.join(home,'silence.'+extension);const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',source,'-c:a',codec,target],{timeout:10000,encoding:'utf8'});assert.equal(encoded.status,0,encoded.stderr);
  const bytes=fs.readFileSync(target);if(extension!=='m4a')assert.ok(bytes.length<1200,'Regression clip must fall below the old cutoff');
  const result=await transcribe(bytes,type,config);assert.equal(result.text.trim(),'Fixture transcription');assert.deepEqual(fs.readdirSync(paths.tmp),[],'Private recordings cleaned up');console.log('PASS '+extension+': '+bytes.length+' bytes decoded with real FFmpeg and accepted for transcription');
 }
 assert.equal((await transcribe(wav,'audio/wav',config)).text.trim(),'Fixture transcription');
 await assert.rejects(transcribe(Buffer.alloc(0),'audio/webm',config),e=>e.sttCode==='recording_empty'&&e.status===400);
 await assert.rejects(transcribe(Buffer.from('not audio'),'audio/webm',config),e=>e.sttCode==='conversion_failed'&&e.status===422&&e.safeToDisplay);
 await assert.rejects(transcribe(wav,'audio/wav',{stt:{modelPath:home+'/missing.bin'}}),e=>e.sttCode==='model_missing'&&!e.message.includes(home));
 process.env.JARVIS_STT_FAIL='1';await assert.rejects(transcribe(wav,'audio/wav',config),e=>e.sttCode==='recognition_failed'&&!e.message.includes('PRIVATE_RECORDING_DIAGNOSTIC'));delete process.env.JARVIS_STT_FAIL;
 assert.equal(sttStatus(config).ready,true);
 fs.symlinkSync('/usr/bin/sh',path.join(bin,'sh'));process.env.PATH=bin;assert.equal(sttStatus(config).ready,false,'Missing FFmpeg must not advertise readiness');
 await assert.rejects(transcribe(wav,'audio/wav',config),e=>e.sttCode==='converter_missing'&&e.status===503);
 assert.deepEqual(fs.readdirSync(paths.tmp),[]);console.log('PASS empty/invalid audio, model/recognizer failure categories, sanitized diagnostics, missing-converter readiness and cleanup');
}finally{process.env.HOME=originalHome;process.env.PATH=originalPath;delete process.env.JARVIS_STT_FAIL;fs.rmSync(home,{recursive:true,force:true});}
