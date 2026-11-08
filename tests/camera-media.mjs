import assert from 'node:assert/strict';
let source='device',deviceCalls=0,cancelled=0,contexts=[],streamController;
const deviceStream={device:true};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{deviceCalls++;return deviceStream;}}}});
class Stream extends EventTarget{constructor(){super();this.track={readyState:'live',stop(){this.readyState='ended';}};}getTracks(){return [this.track];}}
class Context{
 sampleRate=48000;destination={};closed=false;
 constructor(){contexts.push(this);}
 async resume(){}
 async close(){this.closed=true;}
 createMediaStreamDestination(){return {stream:new Stream()};}
 createScriptProcessor(){this.processor={connect(){},disconnect(){}};return this.processor;}
 createGain(){return {gain:{},connect(){}};}
}
globalThis.window={AudioContext:Context,jarvisAPI:async()=>({source}),jarvisStreamFetch:async()=>new Response(new ReadableStream({start(controller){streamController=controller;controller.enqueue(new Uint8Array([0,64,0,192]));},cancel(){cancelled++;}}))};
const {cameraAudio}=await import('../frontend/src/camera-media.js');
assert.equal(await window.jarvisGetMicrophone(),deviceStream);assert.equal(deviceCalls,1);
source='camera';const stream=await window.jarvisGetMicrophone();assert.equal(deviceCalls,1,'Camera selection never requests device access');
const context=contexts.at(-1),output=new Float32Array(2);context.processor.onaudioprocess({outputBuffer:{getChannelData:()=>output}});
assert.deepEqual([...output],[.5,-.5],'Camera PCM reaches the recording stream with correct signed samples');
stream.getTracks()[0].stop();await new Promise(resolve=>setImmediate(resolve));
assert.equal(stream.getTracks()[0].readyState,'ended');assert.equal(context.closed,true);assert.equal(cancelled,1,'Stopping a track cancels the camera fetch');
const controller=new AbortController();controller.abort();await assert.rejects(()=>cameraAudio({signal:controller.signal}),/cancelled/);
window.jarvisStreamFetch=async()=>new Response(JSON.stringify({error:'Camera audio unavailable.'}),{status:502,headers:{'content-type':'application/json'}});
await assert.rejects(()=>window.jarvisGetMicrophone(),/Camera audio unavailable/);assert.equal(deviceCalls,1,'Camera failure never silently opens a device microphone');
assert.ok(contexts.every(c=>c.closed),'Failures close every audio context');
window.jarvisStreamFetch=async()=>new Response(new ReadableStream({start(controller){streamController=controller;controller.enqueue(new Uint8Array([0,32]));},cancel(){cancelled++;}}));
const disconnected=await cameraAudio();let ended=false;disconnected.addEventListener('jarvis-camera-ended',()=>ended=true);streamController.close();await new Promise(resolve=>setImmediate(resolve));
assert.equal(ended,true);assert.equal(disconnected.getTracks()[0].readyState,'ended','Lost camera input stops the recording track');
console.log('PASS: explicit microphone selection, PCM audio conversion, stop cancellation, no silent fallback, failure cleanup and disconnect signaling.');
