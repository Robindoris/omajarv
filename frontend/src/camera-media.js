// Authenticated same-origin streams: camera URLs and bridge keys never enter media URLs.
export async function cameraAudio({signal}={}){
 const Context=window.AudioContext||window.webkitAudioContext;
 if(!Context)throw new Error('This browser does not support camera audio.');
 const context=new Context({sampleRate:48000}),controller=new AbortController();
 let reader,processor,destination,closed=false,queue=[],offset=0,count=0,carry=null,phase=0;
 const stop=()=>{if(closed)return;closed=true;controller.abort();reader?.cancel().catch(()=>{});processor?.disconnect();destination?.stream.getTracks().forEach(t=>t.stop());context.close().catch(()=>{});signal?.removeEventListener('abort',stop);};
 if(signal?.aborted){stop();throw new Error('Camera audio cancelled.');}signal?.addEventListener('abort',stop,{once:true});
 try{
  await context.resume();
  const timer=setTimeout(()=>controller.abort(),15000);
  let response;try{response=await window.jarvisStreamFetch('/api/ip-camera/audio',{signal:controller.signal});}finally{clearTimeout(timer);}
  if(!response.ok){const data=await response.json();throw new Error(data.error||'Camera audio unavailable.');}
  reader=response.body.getReader();
  function enqueue(bytes){
   if(carry!==null){const joined=new Uint8Array(bytes.length+1);joined[0]=carry;joined.set(bytes,1);bytes=joined;carry=null;}
   if(bytes.length%2){carry=bytes[bytes.length-1];bytes=bytes.subarray(0,bytes.length-1);}
   const samples=new Float32Array(bytes.length/2),data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   for(let i=0;i<samples.length;i++)samples[i]=data.getInt16(i*2,true)/32768;
   if(samples.length){queue.push(samples);count+=samples.length;}
   while(count>96000&&queue.length>1){count-=queue.shift().length-offset;offset=0;}
  }
  const first=await reader.read();if(first.done)throw new Error('The camera has no audio stream.');enqueue(first.value);
  destination=context.createMediaStreamDestination();processor=context.createScriptProcessor(4096,0,1);
  let sample=0;
  const take=()=>{if(!queue.length)return 0;const value=queue[0][offset++];count--;if(offset>=queue[0].length){queue.shift();offset=0;}return value;};
  processor.onaudioprocess=event=>{const output=event.outputBuffer.getChannelData(0);for(let i=0;i<output.length;i++){phase+=48000/context.sampleRate;while(phase>=1){sample=take();phase--;}output[i]=sample;}};
  processor.connect(destination);
  // Keep Web Audio processing scheduled without monitoring the camera on speakers.
  const mute=context.createGain();mute.gain.value=0;processor.connect(mute);mute.connect(context.destination);
  const stream=destination.stream;stream.jarvisStop=stop;
  stream.getTracks().forEach(track=>{const original=track.stop.bind(track);track.stop=()=>{original();stop();};});
  (async()=>{try{while(!closed){const chunk=await reader.read();if(chunk.done)break;enqueue(chunk.value);}}catch{}finally{const unexpected=!closed;stop();if(unexpected)stream.dispatchEvent(new Event('jarvis-camera-ended'));}})();
  return stream;
 }catch(error){stop();throw new Error(error.name==='AbortError'?'Camera audio connection timed out or was cancelled.':error.message);}
}

export async function cameraVideo(onFrame,{signal}={}){
 const response=await window.jarvisStreamFetch('/api/ip-camera/video',{signal});
 if(!response.ok){const data=await response.json();throw new Error(data.error||'Camera video unavailable.');}
 const reader=response.body.getReader();let pending=new Uint8Array(),frames=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   const joined=new Uint8Array(pending.length+value.length);joined.set(pending);joined.set(value,pending.length);pending=joined;
   if(pending.length>4*1024*1024)throw new Error('Camera video frame is too large.');
   let start=-1;
   for(let i=0;i<pending.length-1;i++){
    if(start<0&&pending[i]===255&&pending[i+1]===216)start=i;
    if(start>=0&&pending[i]===255&&pending[i+1]===217){onFrame(new Blob([pending.slice(start,i+2)],{type:'image/jpeg'}));frames++;pending=pending.slice(i+2);i=-1;start=-1;}
   }
  }
  if(!frames)throw new Error('The camera returned no video frames.');
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

window.jarvisGetMicrophone=async()=>{
 const settings=await window.jarvisAPI('/api/ip-camera');
 if(settings.source==='camera')return cameraAudio();
 if(!navigator.mediaDevices?.getUserMedia)throw new Error('Device microphone unavailable. Select a camera microphone in Settings.');
 return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
};
