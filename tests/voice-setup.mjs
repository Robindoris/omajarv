import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createVoiceSetup} from '../server/lib/voice-setup.mjs';
import {downloadVerified} from '../server/setup.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-voice-setup-'));
try {
 const catalog=Object.fromEntries(['whisper','piper'].map(kind=>[kind,[{file:kind==='whisper'?'ggml-base.en.bin':'en_US-ljspeech-medium.onnx',bytes:4,url:'https://fixture.invalid/'+kind,sha:crypto.createHash('sha256').update('test').digest('hex')}]]));
 // Include the required Piper configuration in the verified catalog.
 catalog.piper.push({...catalog.piper[0],file:'en_US-ljspeech-medium.onnx.json'});
 const directories={whisper:path.join(home,'whisper'),piper:path.join(home,'piper')};
 const config={stt:{model:'base.en',modelPath:path.join(home,'missing.bin')},tts:{voice:'en_US-ljspeech-medium',modelPath:path.join(home,'missing.onnx')}};
 let downloads=0,commits=0,held;
 const download=async(item,file,options)=>{downloads++;await new Promise(resolve=>held=resolve);await downloadVerified(item,file,{...options,fetcher:async()=>new Response('test')});};
 const update=(cfg,patch)=>{commits++;cfg.stt={...cfg.stt,...patch.stt};cfg.tts={...cfg.tts,...patch.tts};};
 const setup=createVoiceSetup(config,{catalog,directories,download,update,discover:()=>({whisper:[],piper:[]})});
 assert.equal(setup.view().job.state,'idle');assert.equal(downloads,0,'GET never starts downloads');
 for(const consent of [undefined,{},null,{consent:false},{consent:true,url:'https://evil.invalid'}])assert.throws(()=>setup.start(consent));
 setup.start({consent:true});assert.equal(setup.view().job.state,'downloading');
 assert.throws(()=>setup.start({consent:true}),e=>e.status===409);
 for(let i=0;i<3;i++){held();await new Promise(resolve=>setTimeout(resolve,5));}
 await setup.wait();assert.equal(setup.view().job.state,'complete');assert.equal(setup.view().job.received,12);assert.equal(commits,1);
 assert.equal(config.stt.modelPath,path.join(directories.whisper,catalog.whisper[0].file));
 assert.equal(setup.view().missing.piper,false);
 setup.start({consent:true});assert.equal(downloads,3,'existing configured models are reused without downloads');
 const busy=createVoiceSetup(config,{busy:()=>true});assert.throws(()=>busy.start({consent:true}),e=>e.status===409);
 const failedConfig={stt:{modelPath:path.join(home,'absent.bin')},tts:{modelPath:path.join(home,'absent.onnx')}};
 const original=structuredClone(failedConfig);
 const fail=createVoiceSetup(failedConfig,{catalog,directories,discover:()=>({whisper:[],piper:[]}),download:async()=>{throw new Error('PRIVATE_DIAGNOSTIC');},update});
 fail.start({consent:true});await fail.wait();assert.equal(fail.view().job.state,'error');assert.ok(!fail.view().job.error.includes('PRIVATE_DIAGNOSTIC'));assert.deepEqual(failedConfig,original);
 // Retry is permitted after failure and still cannot silently change settings.
 fail.start({consent:true});await fail.wait();assert.equal(fail.view().job.state,'error');
 const reuseConfig={stt:{modelPath:path.join(home,'absent.bin')},tts:{modelPath:path.join(home,'absent.onnx')}};
 const reuse=createVoiceSetup(reuseConfig,{catalog,directories,update,discover:()=>({whisper:[config.stt.modelPath],piper:[config.tts.modelPath]}),download:async()=>{throw new Error('Should reuse existing files');}});
 assert.equal(reuse.view().needsConfiguration,true);assert.equal(reuse.view().models[0].needed,false);
 reuse.start({consent:true});assert.equal(reuseConfig.stt.modelPath,config.stt.modelPath);assert.equal(reuse.view().job.state,'complete');
 console.log('PASS: explicit consent, real byte progress, verified downloads, reuse, single job, busy checks and retry without config loss.');
}finally{fs.rmSync(home,{recursive:true,force:true});}
