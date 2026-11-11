import React,{useEffect,useRef,useState} from 'react';
import {Download,Check,ArrowRight,Mic,RefreshCw} from 'lucide-react';
import {Button} from './components/ui/button';
const mb=bytes=>(bytes/1000000).toFixed(1)+' MB';
export function VoiceSetup({active,disabled,onInstalled,onBusyChange}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[starting,setStarting]=useState(false),[step,setStep]=useState(0),[guide,setGuide]=useState(true),[mic,setMic]=useState('');
 const [size,setSize]=useState(''),[voice,setVoice]=useState('');
 const installed=useRef(onInstalled);installed.current=onInstalled;
 const last=useRef('');
 useEffect(()=>{
  if(!active)return;
  let alive=true,controller=new AbortController();
  async function poll(){try{const next=await window.jarvisAPI('/api/voice-setup',{signal:controller.signal});if(!alive)return;setData(next);if(last.current==='downloading'&&next.job.state==='complete')installed.current();last.current=next.job.state;}catch(e){if(alive)setError(e.message);}}
  poll();const timer=setInterval(poll,1500);return()=>{alive=false;controller.abort();clearInterval(timer);};
 },[active]);
 async function start(){
  setStarting(true);setError('');
  try{const next=await window.jarvisAPI('/api/voice-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,...(size?{whisperSize:size}:{}),...(voice?{piperVoice:voice}:{})})});setData(next);last.current=next.job.state;if(next.job.state==='complete')installed.current();}
  catch(e){setError(e.message);}finally{setStarting(false);}
 }
 async function testMic(){
  let stream;setMic('Requesting microphone access…');
  try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access needs HTTPS and a supported browser.');stream=await navigator.mediaDevices.getUserMedia({audio:true});setMic('Microphone connected. No audio was recorded or sent.');}
  catch(e){setMic(e.name==='NotAllowedError'?'Microphone permission was denied. You can enable it in browser settings.':e.message);}
  finally{stream?.getTracks().forEach(track=>track.stop());}
 }
 const downloading=starting||data?.job.state==='downloading';
 useEffect(()=>{onBusyChange?.(downloading);},[downloading,onBusyChange]);
 const selectedChoice=data?.choices?.find(choice=>choice.id===size);
 const selectedVoice=data?.piperChoices?.find(choice=>choice.id===voice);
 const needed=data?.models.filter(model=>model.needed)||[];
 const runtimes=data?Object.entries(data.runtime).filter(([,ready])=>!ready).map(([name])=>name):[];
 const progress=data?.job.total?Math.min(100,Math.floor(data.job.received/data.job.total*100)):0;
 return <section className="voice-onboarding settings-notice" aria-label="Voice setup guide">
  <div className="settings-card-heading"><div><Download size={18}/><h3>Voice setup</h3></div><Button type="button" variant="ghost" onClick={()=>{setGuide(!guide);setStep(0);}}>{guide?'Hide guide':'Setup guide'}</Button></div>
  {guide&&<><ol className="setup-steps" aria-label="Setup progress">{['Welcome','Models','Try voice'].map((label,index)=><li key={label} aria-current={step===index?'step':undefined}><span>{step>index?<Check size={12}/>:index+1}</span>{label}</li>)}</ol>
   {step===0&&<div className="setup-step"><h4>Make JARVIS yours</h4><p>Set your assistant’s name and personality in the sidebar. Text chat works immediately. Whisper and Piper run speech locally; your selected AI agent may still send messages to its provider.</p><div className="setup-actions"><Button type="button" variant="outline" onClick={()=>document.getElementById('personalityBtn').click()}>Personalize JARVIS</Button><Button type="button" onClick={()=>setStep(1)}>Set up voice<ArrowRight size={14}/></Button></div></div>}
   {step===2&&<div className="setup-step"><h4>{data&&!needed.length&&!data.needsConfiguration&&!runtimes.length?'Ready to talk':'Finish voice setup'}</h4><p>{!data?'Checking installed model files…':needed.length?'Download the missing models below or continue with text chat.':data.needsConfiguration?'Use the installed models below to finish configuration.':'Your configured model files are installed.'} {runtimes.length?`Install the missing local speech tools on this computer: ${runtimes.join(', ')}. This button downloads models only.`:'The local speech tools are available.'}</p><div className="setup-actions"><Button type="button" variant="outline" onClick={testMic}><Mic size={14}/>Check microphone</Button><Button type="button" onClick={()=>{setGuide(false);window.jarvisWorkspace('conversation');}}>{needed.length||data?.needsConfiguration||runtimes.length?'Continue with text':'Start conversation'}</Button></div><p role="status">{mic}</p></div>}
  </>}
  {<div className="setup-models" aria-label="Local model downloads"><p>Reuse installed models, or download local speech models below. Downloads contact Hugging Face/CDN; no recordings or messages are uploaded.</p>
   <label className="settings-field">Speech recognition model size<select aria-label="Speech recognition model size" value={size} disabled={!data||disabled||downloading} onChange={event=>setSize(event.target.value)}><option value="">Keep current model / automatic setup</option>{data?.choices?.map(choice=><option key={choice.id} value={choice.id}>{choice.name} · {mb(choice.bytes)}{choice.installed?' · Installed':''}</option>)}</select><small>{data?.choices?.find(choice=>choice.id===size)?.description||'Reuse your configured or discovered model before downloading the default.'} English-only and multilingual alternatives are available.</small></label>
   <label className="settings-field">Voice output model<select aria-label="Voice output model" value={voice} disabled={!data||disabled||downloading} onChange={event=>setVoice(event.target.value)}><option value="">Keep current voice / automatic setup</option>{data?.piperChoices?.map(choice=><option key={choice.id} value={choice.id}>{choice.name} · {mb(choice.bytes)}{choice.installed?' · Installed':''}</option>)}</select><small>{selectedVoice?.description||'Free local voices in English, Slovak and Czech. Select a voice to see its terms and download size.'}</small></label>
   {!data&&<p role="status">Checking installed models…</p>}
   {data?.models.map(original=>{const model=original.id==='whisper'&&selectedChoice?{...original,name:selectedChoice.name,bytes:selectedChoice.bytes,needed:!selectedChoice.installed,source:'Hugging Face / ggerganov/whisper.cpp',terms:'OpenAI Whisper MIT license'}:original.id==='piper'&&selectedVoice?{...original,name:selectedVoice.name,bytes:selectedVoice.bytes,needed:!selectedVoice.installed,source:'Hugging Face / rhasspy/piper-voices',terms:selectedVoice.terms}:original;return <div className="setup-model" key={model.id}><div><strong>{model.name}</strong><small>{model.needed?mb(model.bytes)+' · download needed':(model.id==='piper'&&selectedVoice?mb(model.bytes)+' · ':'')+'Installed · no download needed'}</small><small>{model.source} · {model.terms}</small>{model.id==='piper'&&selectedVoice?.modelCard&&<small><a href={selectedVoice.modelCard} target="_blank" rel="noreferrer">Read voice model card</a></small>}</div><span>{model.needed?'Optional':<Check size={16}/>}</span></div>;})}
   <p>Choose a speech recognition size or Piper voice above to download or switch models. You can select other installed models in the settings below. Missing binaries are installed separately using your system package manager.</p>
   <div className="setup-actions"><Button type="button" disabled={!data||disabled||downloading||(!size&&!voice&&!needed.length&&!data.needsConfiguration&&data.job.state!=='error')} onClick={start}>{downloading?<RefreshCw size={15}/>:<Download size={15}/>} {downloading?'Downloading…':size||voice?'Download / use selected model':data?.job.state==='error'?'Retry model setup':!needed.length&&data?.needsConfiguration?'Use installed models':'Download missing models'}{!size&&!voice&&!downloading&&needed.length>0?' · '+mb(needed.reduce((n,m)=>n+m.bytes,0)):''}</Button>{guide&&step===1&&<><Button type="button" variant="outline" onClick={()=>setStep(0)}>Back</Button><Button type="button" variant="outline" onClick={()=>setStep(2)}>{needed.length?'Skip for now':'Next'}<ArrowRight size={14}/></Button></>}</div>
   {disabled&&<p>Save or discard your settings changes before installing models.</p>}
  </div>}
  {data?.job.state==='downloading'&&<div role="status" className="download-progress"><p>Downloading {data.job.file} · {mb(data.job.received)} / {mb(data.job.total)}</p><progress aria-label="Model download progress" max={100} value={progress}/><span>{progress}% · checksum verification follows each file</span></div>}
  {data?.job.state==='complete'&&<p role="status">Model setup complete. Installed models are selected; check the speech tool status below.</p>}
  <p className="settings-error" role="alert">{error||data?.job.error}</p>
 </section>;
}
