import React,{useEffect,useState} from 'react';
import {Button} from './components/ui/button';
export function UnifiedSearch({projectId,onOpen}){
 const [query,setQuery]=useState(''),[data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setQuery('');setData(null);setError('');},[projectId]);
 useEffect(()=>{
  let current=true,running=false;const ctrl=new AbortController();setData(null);setError('');setLoading(!!query.trim());
  if(!query.trim())return()=>{current=false;ctrl.abort();};
  const run=async()=>{if(running||document.visibilityState==='hidden')return;running=true;try{const next=await window.jarvisAPI('/api/search?q='+encodeURIComponent(query),{signal:ctrl.signal});if(current&&next.projectId===projectId)setData(next);}catch(e){if(current&&e.name!=='AbortError'){setError(e.message);setData(null);}}finally{running=false;if(current)setLoading(false);}};const timer=setTimeout(run,250),poll=setInterval(run,5000);
  return()=>{current=false;clearTimeout(timer);clearInterval(poll);ctrl.abort();};
 },[query,projectId]);
 async function open(type,item){setError('');try{await onOpen(type,item);setData(null);setQuery('');}catch(e){setError(e.message);}}
 return <section className="unified-search" aria-label="Workspace search"><label htmlFor="workspace-search">Search workspace</label><input id="workspace-search" type="search" maxLength={160} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Files, tasks, conversations" aria-describedby="workspace-search-status" onKeyDown={e=>{if(e.key==='Escape'){setQuery('');setData(null);}}}/><p id="workspace-search-status" role="status">{loading?'Searching…':error||(!query.trim()?'Search in the active project.':data&&!Object.values(data.groups).some(g=>g.results.length)?'No matches.':'')}</p>{data&&Object.entries(data.groups).map(([type,group])=><section key={type} aria-label={type+' search results'}><h3>{type[0].toUpperCase()+type.slice(1)} ({group.results.length})</h3><ul>{group.results.map(item=><li key={item.id||item.root+item.path}><Button variant="ghost" onClick={()=>open(type,item)}><span>{item.title}{item.path&&<small style={{display:'block'}}>{item.path}</small>}</span></Button></li>)}</ul>{group.truncated&&<p>Search limit reached. Use a more specific query.</p>}</section>)}</section>;
}
