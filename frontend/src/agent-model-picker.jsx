import React,{useEffect,useState,useRef} from 'react';
export function AgentModelPicker(){
 const [status,setStatus]=useState(null),[listing,setListing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef(''),request=useRef(0);
 async function load(agent){
  const seq=++request.current;
  try{const data=await window.jarvisAPI('/api/models');if(seq===request.current&&current.current===agent)setListing(data);}
  catch(e){if(seq===request.current)setError(e.message);}
 }
 useEffect(()=>{
  const update=e=>{const data=e.detail;setStatus(data);if(current.current!==data.agent.id){current.current=data.agent.id;setListing(null);setError('');if(data.agent.modelSelectable)load(data.agent.id);}};
  window.addEventListener('jarvis-agent-status',update);
  return()=>{request.current++;window.removeEventListener('jarvis-agent-status',update);};
 },[]);
 if(!status?.agent.modelSelectable)return null;
 async function change(e){
  const model=e.target.value,agent=current.current;setBusy(true);setError('');
  try{const data=await window.jarvisAPI('/api/agent/model',{method:'POST',body:JSON.stringify({agent,model})});if(current.current===agent){setListing(data);setStatus(s=>({...s,agent:{...s.agent,model}}));}}
  catch(e){setError(e.message);load(current.current);}
  finally{setBusy(false);}
 }
 return <div className="agent-model-control">
 {listing?.listed?<select aria-label="Agent model" value={status.agent.model||''} disabled={busy||status.chatBusy} onFocus={()=>load(current.current)} onChange={change}>
  <option value="">Agent default</option>
  {status.agent.model&&!listing.models.some(m=>m.id===status.agent.model)&&<option value={status.agent.model}>{status.agent.model}</option>}
  {listing.models.map(m=><option key={m.id} value={m.id}>{m.id}{m.free?' · Free':''}</option>)}
 </select>:<span className="agent-model-note">{listing?.note||'Loading models…'}</span>}
 {error&&<span role="alert">{error}</span>}
 </div>;
}
