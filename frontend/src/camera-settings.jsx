import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {cameraAudio,cameraVideo} from './camera-media';
export function CameraSettings({active}){
 const [data,setData]=useState(null),[url,setURL]=useState(''),[enabled,setEnabled]=useState(false),[source,setSource]=useState('device'),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[testing,setTesting]=useState(''),[frame,setFrame]=useState('');
 const live=useRef(null),image=useRef(''),mounted=useRef(false),testRef=useRef('');
 function stop(){const current=live.current;live.current=null;current?.controller.abort();clearTimeout(current?.timer);current?.stream?.jarvisStop?.();current?.context?.close().catch(()=>{});if(image.current){URL.revokeObjectURL(image.current);image.current='';}testRef.current='';if(mounted.current){setFrame('');setTesting('');}}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop();};},[]);
 useEffect(()=>{
  if(!active){stop();return;}
  const controller=new AbortController();let alive=true;
  window.jarvisAPI('/api/ip-camera',{signal:controller.signal}).then(next=>{if(alive){setData(next);setEnabled(next.enabled);setSource(next.source);}}).catch(e=>{if(alive)setError(e.message);});
  return()=>{alive=false;controller.abort();stop();};
 },[active]);
 async function save(forget=false){
  setBusy(true);setError('');setMessage('');
  try{const next=await window.jarvisAPI('/api/ip-camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(forget?{forget:true}:{url,enabled,source})});setData(next);setURL('');setEnabled(next.enabled);setSource(next.source);setMessage(forget?'Camera removed. Device microphone selected.':'Camera settings saved. Test video and audio below.');}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function test(kind){
  if(testRef.current)return;
  stop();const session={controller:new AbortController(),stream:null,context:null,timer:null};live.current=session;testRef.current=kind;setTesting(kind);setError('');setMessage('Connecting to camera…');
  session.timer=setTimeout(()=>{if(live.current===session){stop();setMessage('Camera test finished.');}},kind==='video'?30000:25000);
  try{
   if(kind==='video'){
    await cameraVideo(blob=>{if(live.current!==session)return;if(image.current)URL.revokeObjectURL(image.current);image.current=URL.createObjectURL(blob);setFrame(image.current);setMessage('Video stream connected.');},{signal:session.controller.signal});
   }else{
    const Context=window.AudioContext||window.webkitAudioContext;session.context=new Context();await session.context.resume();
    session.stream=await cameraAudio({signal:session.controller.signal});
    if(live.current!==session){session.stream.jarvisStop();return;}
    clearTimeout(session.timer);session.timer=setTimeout(()=>{if(live.current===session){stop();setMessage('Camera audio test finished.');}},10000);
    session.context.createMediaStreamSource(session.stream).connect(session.context.destination);setMessage('Audio connected. Listen for camera sound. Test stops after 10 seconds.');
    session.stream.addEventListener('jarvis-camera-ended',()=>{if(live.current===session){stop();setMessage('Camera audio ended. Check the connection if unexpected.');}},{once:true});
    return;
   }
   if(live.current===session){stop();setMessage('Video test finished.');}
  }catch(e){if(live.current===session){stop();setError(e.message||'Camera test failed.');}}
 }
 const dirty=!!url||data&&(enabled!==data.enabled||source!==data.source);
 return <section className="settings-card camera-settings" aria-label="IP camera setup">
  <h3>IP camera and optional microphone</h3>
  <ol className="camera-guide"><li>Enable RTSP and microphone audio in your camera’s own app. Connect the camera to the same trusted LAN as this computer.</li><li>Enter its private IPv4 RTSP address and stream path. Include camera credentials only if required. The saved address stays private and is never displayed again.</li><li>Save and use Test video stream and Test camera audio. Audio testing plays sound through your speakers; lower the volume to avoid feedback.</li><li>Choose Camera microphone for a computer without a microphone. Press the normal voice record button to talk. Whisper models are still required.</li></ol>
  <p>RTSP cameras only. No camera discovery, cloud login or automatic recording. Video is a live preview, not sent to the AI. Tests stop automatically. Requires FFmpeg on this computer.</p>
  <p role="status">{data?.configured?'Camera address saved privately.':'No camera configured.'}</p>
  <label className="settings-field">Camera RTSP address<input aria-label="Camera RTSP address" type="password" autoComplete="new-password" maxLength={2048} placeholder={data?.configured?'Leave blank to keep saved address':'rtsp://192.168.1.50:554/stream'} value={url} disabled={busy||!!testing} onChange={e=>setURL(e.target.value)}/></label>
  <label className="camera-enable"><input type="checkbox" checked={enabled} disabled={!data||busy||!!testing} onChange={e=>{setEnabled(e.target.checked);if(!e.target.checked)setSource('device');}}/>Enable camera streaming</label>
  <label className="settings-field">Voice microphone source<select aria-label="Voice microphone source" value={source} disabled={!data||busy||!!testing} onChange={e=>setSource(e.target.value)}><option value="device">This device’s microphone</option><option value="camera" disabled={!enabled}>Camera microphone</option></select></label>
  <p className="settings-error" role="alert">{error}</p><p role="status">{message}</p>
  <div className="camera-actions"><Button type="button" disabled={!data||busy||!!testing||!dirty} onClick={()=>save()}>Save camera settings</Button><Button type="button" variant="outline" disabled={!data?.configured||busy||!!testing} onClick={()=>{if(window.confirm('Remove the saved camera and use the device microphone?'))save(true);}}>Forget camera</Button><Button type="button" variant="outline" disabled={!data?.enabled||busy||!!testing||!!dirty} onClick={()=>test('video')}>Test video stream</Button><Button type="button" variant="outline" disabled={!data?.enabled||busy||!!testing||!!dirty} onClick={()=>test('audio')}>Test camera audio</Button>{testing&&<Button type="button" variant="outline" onClick={()=>{stop();setMessage('Camera test stopped.');}}>Stop camera test</Button>}</div>
  {frame&&<img className="camera-preview" src={frame} alt="Live IP camera preview"/>}
 </section>;
}
