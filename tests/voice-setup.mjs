import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createVoiceSetup} from '../server/lib/voice-setup.mjs';
import {downloadVerified,piperChoices} from '../server/setup.mjs';
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
 // Explicit size selection switches an already configured model, without reusing a different size.
 const choices={lightweight:{name:'Tiny',description:'Fast',files:[{...catalog.whisper[0],file:'ggml-tiny.en.bin'}]},heavy:{name:'Small',description:'Accurate',files:[{...catalog.whisper[0],file:'ggml-small.en.bin'}]}};
 let variantDownloads=0;
 const variants=createVoiceSetup(config,{catalog,choices,directories,update,discover:()=>({whisper:[config.stt.modelPath],piper:[]}),download:async(item,file,options)=>{variantDownloads++;await downloadVerified(item,file,{...options,fetcher:async()=>new Response('test')});}});
 assert.equal(variants.view().choices.length,2);
 assert.throws(()=>variants.start({consent:true,whisperSize:'unknown'}));
 for(const size of ['lightweight','heavy']){
  variants.start({consent:true,whisperSize:size});await variants.wait();
  assert.equal(variants.view().job.state,'complete');
  assert.equal(config.stt.modelPath,path.join(directories.whisper,choices[size].files[0].file));
 }
 assert.equal(variantDownloads,2);
 variants.start({consent:true,whisperSize:'lightweight'});await variants.wait();
 assert.equal(variantDownloads,2,'installed selected variant is reused');
 assert.equal(config.stt.model,'tiny.en');
 assert.equal(config.stt.language,'en');
 choices.multilingualHeavy={name:'Multilingual small',description:'Multilingual',files:[{...catalog.whisper[0],file:'ggml-small.bin'}]};
 variants.start({consent:true,whisperSize:'multilingualHeavy'});await variants.wait();
 assert.equal(config.stt.model,'small');assert.equal(config.stt.language,'auto');
 assert.throws(()=>variants.start({consent:true,whisperSize:['heavy']}));

 // Piper selection must replace a different configured voice and require both files.
 const otherVoice=path.join(home,'other.onnx');
 fs.writeFileSync(otherVoice,'test');fs.writeFileSync(otherVoice+'.json','test');
 config.tts.modelPath=otherVoice;
 let voiceDownloads=0;
 const voices=createVoiceSetup(config,{catalog,directories,update,discover:()=>({whisper:[],piper:[otherVoice]}),download:async(item,file,options)=>{voiceDownloads++;await downloadVerified(item,file,{...options,fetcher:async()=>new Response('test')});}});
 assert.equal(voices.view().piperChoices[0].bytes,8);
 assert.equal(voices.view().piperChoices[0].installed,true);
 for(const piperVoice of ['unknown',null,[],{}])assert.throws(()=>voices.start({consent:true,piperVoice}));
 voices.start({consent:true,piperVoice:'ljspeech-medium'});await voices.wait();
 assert.equal(config.tts.modelPath,path.join(directories.piper,catalog.piper[0].file));
 assert.equal(voiceDownloads,0,'selected installed Piper voice is reused');
 fs.unlinkSync(config.tts.modelPath+'.json');
 config.tts.modelPath=otherVoice;
 assert.equal(voices.view().piperChoices[0].installed,false,'Piper requires its matching configuration');
 voices.start({consent:true,piperVoice:'ljspeech-medium'});await voices.wait();
 assert.equal(voices.view().job.state,'complete');
 assert.equal(voiceDownloads,2,'explicit Piper choice downloads the verified pair instead of reusing another voice');
 assert.equal(config.tts.voice,'en_US-ljspeech-medium');

 // Each allowlisted voice has a pinned model/config pair and can be selected independently.
 const voiceCatalog=Object.fromEntries(Object.entries(piperChoices).map(([id,item])=>[id,{...item,files:item.files.map(file=>({...file,bytes:4,sha:catalog.piper[0].sha}))}]));
 const requested=[];
 const multiple=createVoiceSetup(config,{catalog,directories,voices:voiceCatalog,update,discover:()=>({whisper:[],piper:[]}),download:async(item,file,options)=>{requested.push(item.file);await downloadVerified(item,file,{...options,fetcher:async()=>new Response('test')});}});
 assert.equal(multiple.view().piperChoices.length,5);
 for(const [id,voice] of Object.entries(piperChoices)){
  assert.ok(voice.files[0].file.endsWith('.onnx'));
  assert.ok(voice.files.some(file=>file.file===voice.files[0].file+'.json'));
  for(const file of voice.files){
   assert.match(file.sha,/^[a-f0-9]{64}$/);
   assert.ok(file.bytes>0);
   assert.match(file.url,/\/resolve\/[a-f0-9]{40}\//);
  }
  multiple.start({consent:true,piperVoice:id});await multiple.wait();
  assert.equal(multiple.view().job.state,'complete');
  assert.equal(config.tts.modelPath,path.join(directories.piper,voice.files[0].file));
  assert.equal(config.tts.voice,path.basename(voice.files[0].file,'.onnx'));
  const count=requested.length;
  multiple.start({consent:true,piperVoice:id});await multiple.wait();
  assert.equal(requested.length,count,'installed voice is reused without downloading');
 }
 assert.throws(()=>multiple.start({consent:true,piperVoice:'__proto__'}));
 assert.throws(()=>multiple.start({consent:true,piperVoice:'constructor'}));

 console.log('PASS: explicit consent, real byte progress, verified downloads, reuse, single job, busy checks and retry without config loss.');
}finally{fs.rmSync(home,{recursive:true,force:true});}
