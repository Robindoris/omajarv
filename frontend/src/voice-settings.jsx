import {CameraSettings} from './camera-settings';
import React,{useEffect,useState} from 'react';
import {Mic,Volume2,RefreshCw,Save} from 'lucide-react';
import {VoiceSetup} from './voice-setup';
import {Button} from './components/ui/button';

export function VoiceSettings({active}){
 const [installing,setInstalling]=useState(false);
 const [data,setData]=useState(null),[draft,setDraft]=useState(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){
  setLoading(true);setError('');setMessage('');
  try{const next=await window.jarvisAPI('/api/voice-settings');setData(next);setDraft(next.settings);}
  catch(e){setError(e.message);}finally{setLoading(false);}
 }
 useEffect(()=>{if(active)load();},[active]);
 function change(section,key,value){setMessage('');setDraft(previous=>section?{...previous,[section]:{...previous[section],[key]:value}}:{...previous,[key]:value});}
 async function save(event){
  event.preventDefault();setSaving(true);setError('');setMessage('');
  try{const next=await window.jarvisAPI('/api/voice-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});setData(next);setDraft(next.settings);setMessage('Voice settings saved. New recordings and spoken replies will use these settings.');window.dispatchEvent(new CustomEvent('jarvis-voice-settings-saved'));}
  catch(e){setError(e.message);}finally{setSaving(false);}
 }
 const dirty=Boolean(data&&JSON.stringify(data.settings)!==JSON.stringify(draft));
 function models(kind,section,key){
  const options=data.models[kind]||[];
  return <label className="settings-field">Installed local model<select aria-label={kind==='whisper'?'Installed Whisper model':'Installed Piper voice'} value={options.some(model=>model.path===draft[section].modelPath)?draft[section].modelPath:''} onChange={event=>{const model=options.find(model=>model.path===event.target.value);if(model){setMessage('');setDraft(previous=>({...previous,[section]:{...previous[section],[key]:model.name,modelPath:model.path}}));}}}><option value="">{options.length?'Choose an installed model…':'No installed models found'}</option>{options.map(model=><option key={model.path} value={model.path}>{model.name}</option>)}</select><small>{kind==='whisper'?'Whisper .bin model for speech recognition.':'Piper .onnx voice with a matching .onnx.json file.'}</small></label>;
 }
 return <div className="voice-settings">
  <header className="settings-heading"><div><span className="eyebrow">JARVIS / PREFERENCES</span><h2>Settings</h2><p>Voice recognition and local speech models.</p></div><Button type="button" variant="outline" disabled={loading||saving||dirty||installing} onClick={load}><RefreshCw size={15}/>Refresh</Button></header>
  <p className="settings-error" role="alert">{error}</p>
  <p className="settings-message" role="status">{loading?'Loading voice settings…':message}</p>
  <VoiceSetup onBusyChange={setInstalling} active={active} disabled={dirty||saving} onInstalled={()=>{load();window.dispatchEvent(new CustomEvent('jarvis-voice-settings-saved'));}}/>
  <CameraSettings active={active}/>
  {draft&&<form onSubmit={save}>
   <fieldset disabled={loading||saving||installing} className="settings-fields">
    <section className="settings-card" aria-labelledby="recognition-heading">
     <div className="settings-card-heading"><div><Mic size={18}/><h3 id="recognition-heading">Speech to text</h3></div><span className={'settings-badge '+(data.status.stt.ready?'ready':'')}>{data.status.stt.ready?'Ready':'Setup needed'}</span></div>
     <p>Turn microphone recordings into text with Whisper, running on this computer.</p>
     {models('whisper','stt','model')}
     <div className="settings-grid"><label className="settings-field">Whisper model name<input required maxLength={100} value={draft.stt.model} onChange={e=>change('stt','model',e.target.value)}/></label><label className="settings-field">Recognition language<input required maxLength={16} placeholder="en, sk, or auto" value={draft.stt.language} onChange={e=>change('stt','language',e.target.value)}/><small>Use a language code or auto. English-only (.en) models recognize English only.</small></label></div>
     <label className="settings-field">Whisper model path<input maxLength={4096} placeholder="Default model directory, or /path/to/ggml-model.bin" value={draft.stt.modelPath} onChange={e=>change('stt','modelPath',e.target.value)}/><small>Optional absolute path or ~/ path. Leave blank to use the model name in the default directory.</small></label>
     <label className="settings-field">Maximum recording length (seconds)<input required type="number" min={1} max={600} step={1} value={draft.maxRecordingSec} onChange={e=>change(null,'maxRecordingSec',e.target.value===''?'':Number(e.target.value))}/></label>
     <details className="settings-advanced"><summary>Advanced recognition settings</summary><p>Recognition currently uses the local Whisper CLI. Server preferences are retained for compatibility; recordings are not sent to an unauthenticated speech server.</p><div className="settings-grid"><label className="settings-field">Preferred engine<select value={draft.stt.engine} onChange={e=>change('stt','engine',e.target.value)}><option value="auto">Automatic (local CLI)</option><option value="cli">Local CLI</option><option value="server">Server (currently uses local CLI)</option></select></label><label className="settings-field">Reserved server port<input required type="number" min={1} max={65535} value={draft.stt.serverPort} onChange={e=>change('stt','serverPort',e.target.value===''?'':Number(e.target.value))}/></label></div></details>
    </section>
    <section className="settings-card" aria-labelledby="synthesis-heading">
     <div className="settings-card-heading"><div><Volume2 size={18}/><h3 id="synthesis-heading">Text to speech</h3></div><span className={'settings-badge '+(data.status.tts.ready?'ready':'')}>{data.status.tts.ready?'Ready':'Setup needed'}</span></div>
     <p>Read replies aloud with a local Piper voice.</p>
     {models('piper','tts','voice')}
     <label className="settings-field">Piper voice name<input required maxLength={100} value={draft.tts.voice} onChange={e=>change('tts','voice',e.target.value)}/></label>
     <label className="settings-field">Piper model path<input maxLength={4096} placeholder="Default voice directory, or /path/to/voice.onnx" value={draft.tts.modelPath} onChange={e=>change('tts','modelPath',e.target.value)}/><small>Custom models need their matching .onnx.json configuration beside the model.</small></label>
     <label className="settings-field">Speaking speed <span className="settings-speed">{draft.tts.speed}×</span><input aria-label="Speaking speed" type="range" min={0.5} max={2} step={0.05} value={draft.tts.speed} onChange={e=>change('tts','speed',Number(e.target.value))}/><small>0.5× slower · 1× normal · 2× faster</small></label>
    </section>
    <aside className="settings-notice"><strong>Local speech, optional downloads.</strong><p>Use Voice setup above to download and verify missing models with one click, or select an installed model here. Text chat works without voice models. Your selected AI agent may still use its online provider.</p></aside>
    <footer className="settings-actions"><span>{dirty?'You have unsaved changes.':'Settings are up to date.'}</span><Button type="button" variant="outline" disabled={!dirty} onClick={()=>{setDraft(data.settings);setError('');setMessage('');}}>Discard changes</Button><Button disabled={!dirty||saving}><Save size={15}/>{saving?'Saving…':'Save settings'}</Button></footer>
   </fieldset>
  </form>}
 </div>;
}
