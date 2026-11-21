import React,{useEffect,useState} from 'react';
import {Button} from './components/ui/button';
import {ShieldCheck,ShieldX} from 'lucide-react';
export const OUTCOME_LABELS={approved:'Approved',rejected:'Rejected by you',expired:'Expired — prompt was shown but unanswered','expired-undelivered':'Expired unseen — no device received the prompt','cancelled-agent':'Cancelled with the agent turn',unsupported:'The agent offered nothing approvable',overflow:'Ignored — too many approvals were already pending'};
export function useApprovals(intervalMs=3000){
 const [state,setState]=useState({requests:[],history:[],transport:'none',agent:'',expiresAfterMs:120000});
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function load(){try{setState(await window.jarvisAPI('/api/approvals'));}catch{}}
 useEffect(()=>{load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},intervalMs);return()=>clearInterval(timer);},[]);
 async function reply(id,decision){
  setError('');setNotice('');
  try{await window.jarvisAPI('/api/approvals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reply',id,decision})});setNotice(decision==='approve'?'Approval sent to the agent.':'Rejection sent to the agent.');}
  catch(e){if(e.status===409||e.outcome)setNotice('Already answered ('+(OUTCOME_LABELS[e.outcome]||e.outcome||'elsewhere')+') on another device.');else setError(e.message);}
  await load();
 }
 return {...state,reply,error,notice};
}
function RequestCard({request,reply,busy,compact=false}){
 const remaining=Math.max(0,Math.ceil((request.expiresAt-Date.now())/1000));
 return <div className={'planner-card approval-card'+(compact?' compact':'')}>
  <span className="eyebrow">{request.source==='kanban'&&request.task?'KANBAN · '+request.task.title:request.source==='chat'?'CONVERSATION':'AGENT'} · {request.deliveredAt?'delivered':'awaiting delivery'}</span>
  <h3>{request.summary}</h3>
  {request.detail&&<p className="approval-meta">{request.detail}</p>}
  {!!request.paths.length&&<p className="approval-paths">{request.paths.join(', ')}</p>}
  <p className="approval-meta">{remaining}s to decide · {request.options.map(o=>o.name).join(' / ')||'Allow'}</p>
  <div className="planner-actions approval-actions">
   <Button disabled={busy} onClick={()=>reply(request.id,'approve')}><ShieldCheck size={16}/>Approve</Button>
   <Button variant="outline" disabled={busy} onClick={()=>reply(request.id,'reject')}><ShieldX size={16}/>Reject</Button>
  </div>
 </div>;
}
export function ApprovalPrompt({approvals}){
 const [busy,setBusy]=useState(false);
 if(!approvals.requests.length)return null;
 async function reply(id,decision){setBusy(true);try{await approvals.reply(id,decision);}finally{setBusy(false);}}
 return <div className="approval-prompt" role="alert" aria-live="assertive">
  <RequestCard request={approvals.requests[0]} reply={reply} busy={busy} compact/>
  {approvals.requests.length>1&&<p className="approval-meta">+{approvals.requests.length-1} more — open Notifications to answer them.</p>}
 </div>;
}
export function ApprovalsInbox({approvals}){
 const [busyId,setBusyId]=useState('');
 async function reply(id,decision){setBusyId(id);try{await approvals.reply(id,decision);}finally{setBusyId('');}}
 return <section className="approvals-inbox" aria-label="Approval requests">
  <div className="planner-heading"><div><span className="eyebrow">SAFETY</span><h2><ShieldCheck size={24}/>Approvals</h2></div>{!!approvals.requests.length&&<span>{approvals.requests.length} awaiting you</span>}</div>
  {approvals.transport==='full-access'&&<p className="planner-muted">Full access is enabled: the agent approves its own actions and never asks.</p>}
  {approvals.transport==='none'&&<p className="planner-muted">The {approvals.agent||'current'} agent does not forward permission requests to JARVIS; nothing is decided here. Check its own prompts or switch to Hermes for cross-device approvals.</p>}
  {approvals.error&&<p role="alert" className="planner-muted">{approvals.error}</p>}
  {approvals.notice&&<p role="status" className="planner-muted">{approvals.notice}</p>}
  {!approvals.requests.length&&approvals.transport==='acp'&&<div className="planner-card">No approvals are waiting. Requests appear here and on every connected device the moment the agent needs permission.</div>}
  {approvals.requests.map(request=><RequestCard key={request.id} request={request} reply={reply} busy={busyId===request.id}/>)}
  {!!approvals.history.length&&<><h3>Recent decisions</h3>{approvals.history.map(entry=><article key={entry.id} className="planner-card approval-history"><span className="eyebrow">{entry.source} · {new Date(entry.decidedAt).toLocaleString()}</span><h4>{entry.summary}</h4><p>{OUTCOME_LABELS[entry.outcome]||entry.outcome}</p></article>)}</>}
 </section>;
}
