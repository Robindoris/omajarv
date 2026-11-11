import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {writePrivateFile} from './privacy.mjs';
import {readDatabaseUrl,normalizeDatabaseUrl} from './postgres-history.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,statusCode:status,safeToDisplay:true});};
const empty=()=>({revision:0,events:[],notifications:[],requests:[],taskStates:{}});
const text=(v,max,name)=>{if(typeof v!=='string'||v.length>max||v.includes('\0'))fail('Invalid '+name+'.');return v.trim();};
function details(input){
 const title=text(input.title,200,'event title');if(!title)fail('An event title is required.');
 const notes=text(input.notes??'',8000,'event description');
 const zone=text(input.timeZone,100,'time zone');try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{fail('Select a valid time zone.');}
 const startAt=Date.parse(input.startAt),endAt=Date.parse(input.endAt);
 if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt||endAt-startAt>366*86400000||new Date(startAt).getUTCFullYear()<2000||new Date(endAt).getUTCFullYear()>2100)fail('Provide valid start and end times (2000–2100), with end after start.');
 const reminderMinutes=input.reminderMinutes??15;if(!Number.isInteger(reminderMinutes)||reminderMinutes<0||reminderMinutes>43200)fail('Reminder must be 0–43200 minutes before the event.');
 const recurrence=input.recurrence??'none';if(!['none','daily','weekly','monthly'].includes(recurrence))fail('Invalid recurrence.');
 return {title,notes,timeZone:zone,startAt,endAt,reminderMinutes,recurrence};
}
function parts(at,zone){return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
// Calendar arithmetic preserves local wall time over DST. On a missing local time,
// move forward by the DST gap rather than duplicating or dropping the occurrence.
export function nextOccurrence(at,frequency,zone,steps=1,anchorDay){
 const p=parts(at,zone);if(anchorDay&&typeof anchorDay==='object'){p.hour=anchorDay.hour;p.minute=anchorDay.minute;p.second=anchorDay.second;}const d=new Date(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second));
 if(frequency==='monthly'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+steps);d.setUTCDate(Math.min((typeof anchorDay==='object'?anchorDay.day:anchorDay)??p.day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));}
 else d.setUTCDate(d.getUTCDate()+steps*(frequency==='weekly'?7:1));
 const target=d.getTime();let guess=target,previous=target;
 for(let i=0;i<4;i++){const q=parts(guess,zone),actual=Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute,q.second),delta=target-actual;if(!delta)return guess;previous=guess;guess+=delta;}
 return Math.max(guess,previous);
}
function advanceNear(event,from){
 const duration=event.endAt-event.startAt;
 if(event.recurrence==='none')return event.startAt;
 const p=parts(event.startAt,event.timeZone),q=parts(from-duration,event.timeZone);
 const months=(q.year-p.year)*12+q.month-p.month;
 const days=Math.floor((Date.UTC(q.year,q.month-1,q.day)-Date.UTC(p.year,p.month-1,p.day))/86400000);
 const steps=Math.max(0,(event.recurrence==='monthly'?months:Math.floor(days/(event.recurrence==='weekly'?7:1)))-1);
 return steps?nextOccurrence(event.startAt,event.recurrence,event.timeZone,steps,p):event.startAt;
}
function occurrences(events,from,to){
 const result=[];
 for(const e of events){let at=advanceNear(e,from),count=0;const anchor=parts(e.startAt,e.timeZone);
  while(at<to&&count++<405){if(at+(e.endAt-e.startAt)>from)result.push({...e,occurrenceStart:at});if(e.recurrence==='none')break;at=nextOccurrence(at,e.recurrence,e.timeZone,1,anchor);}
 }
 return result.sort((a,b)=>a.occurrenceStart-b.occurrenceStart);
}
export function applyPlanner(state,input,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid planner request.');
 if(input.action?.startsWith('notification:')){
  const n=state.notifications.find(n=>n.id===input.id);if(!n)fail('Notification no longer exists.',404);
  if(input.action==='notification:read')n.read=true;
  else if(input.action==='notification:dismiss')n.dismissed=true;
  else if(input.action==='notification:snooze'){if(![5,15,60].includes(input.minutes))fail('Choose a 5, 15 or 60 minute snooze.');n.snoozedUntil=now+input.minutes*60000;n.read=false;}
  else fail('Unknown notification action.');return;
 }
 if(!['create','edit','delete'].includes(input.action))fail('Unknown calendar action.');
 const requestId=text(input.requestId,100,'request ID');if(!/^[\w-]{8,100}$/.test(requestId))fail('Provide a unique request ID.');
 const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex'),prior=state.requests.find(r=>r.id===requestId);
 if(prior){if(prior.hash!==hash)fail('Request ID already used for another action.',409);return;}
 if(input.revision!==state.revision)fail('Calendar changed. Refresh and review before saving.',409);
 if(input.action==='create'){
  if(state.events.length>=500)fail('Calendar limit reached (500 events).');
  const event={...details(input),id:randomUUID(),createdAt:now,updatedAt:now};event.nextStart=event.startAt;state.events.push(event);
 }else{
  const index=state.events.findIndex(e=>e.id===input.id);if(index<0)fail('Event no longer exists.',404);
  if(input.action==='delete')state.events.splice(index,1);
  else {const e=state.events[index];Object.assign(e,details(input),{updatedAt:now});e.nextStart=e.startAt;}
  // Editing/deleting an event invalidates its earlier reminders.
  state.notifications=state.notifications.filter(n=>!(n.source==='calendar'&&n.targetId===input.id));
 }
 state.revision++;state.requests=[...state.requests,{id:requestId,hash}].slice(-100);
}
export function collectNotifications(state,tasks,now=Date.now()){
 const add=(key,source,targetId,title,body,when)=>{if(state.notifications.some(n=>n.key===key))return;state.notifications.push({id:randomUUID(),key,source,targetId,title,body,createdAt:now,read:false,dismissed:false,snoozedUntil:0,...(when?{when}:{})});};
 for(const e of state.events){
  let count=0;
  if(e.nextStart!==null&&e.recurrence!=='none'&&e.nextStart<now-(e.endAt-e.startAt)-86400000)e.nextStart=Math.max(e.nextStart,advanceNear(e,now));
  while(e.nextStart!==null&&e.nextStart-e.reminderMinutes*60000<=now&&count++<405){
   const start=e.nextStart;
   // Catch up to missed reminders while the event is still relevant, without a storm of old alerts.
   if(start+(e.endAt-e.startAt)>=now)add(`event:${e.id}:${e.updatedAt}:${start}`,'calendar',e.id,e.title,`Starts ${new Intl.DateTimeFormat('en-GB',{timeZone:e.timeZone,dateStyle:'medium',timeStyle:'short'}).format(start)} (${e.timeZone})`,start);
   e.nextStart=e.recurrence==='none'?null:nextOccurrence(start,e.recurrence,e.timeZone,1,parts(e.startAt,e.timeZone));
  }
 }
 const next={};
 for(const t of tasks){
  const previous=state.taskStates[t.id];
  if(previous&&previous!==`${t.execution}:${t.runId||''}`&&['completed','failed','interrupted'].includes(t.execution))add(`task:${t.id}:${t.execution}:${t.runId||t.updatedAt}`,'kanban',t.id,`Task ${t.execution}: ${t.title}`,t.execution==='failed'?'Open the task to review the failure.':'Open the task for details.');
  if(t.dueDate&&t.dueDate<new Date(now).toLocaleDateString('en-CA')&&t.status!=='done')add(`overdue:${t.id}:${t.dueDate}`,'kanban',t.id,`Overdue: ${t.title}`,`Due ${t.dueDate}`);
  next[t.id]=`${t.execution}:${t.runId||''}`;
 }
 state.taskStates=next;state.notifications=state.notifications.slice(-500);
}
export async function openPlanner(directory,{connectionString=readDatabaseUrl(directory),schema=process.env.JARVIS_DATABASE_SCHEMA||'jarvis_memory',now=Date.now}={}){
 let pool,serial=Promise.resolve();const file=path.join(directory,'planner.json');
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))fail('Invalid planner storage configuration.');
 const table=`"${schema}"."planner_state"`;
 if(connectionString){const {Pool}=await import('pg');pool=new Pool({connectionString:normalizeDatabaseUrl(connectionString),max:3,connectionTimeoutMillis:5000,statement_timeout:15000,idleTimeoutMillis:1000,allowExitOnIdle:true});pool.on('error',()=>{});
  try{await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);await pool.query(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`);await pool.query(`CREATE TABLE IF NOT EXISTS ${table}(id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL CHECK(version=1),state jsonb NOT NULL)`);await pool.query(`INSERT INTO ${table}(id,version,state) VALUES(1,1,$1) ON CONFLICT DO NOTHING`,[JSON.stringify(empty())]);}catch{await pool.end();fail('Calendar storage is unavailable.',503);}
 }
 async function transaction(fn){
  let client;
  try{
   let state;
   if(pool){client=await pool.connect();await client.query('BEGIN');state=(await client.query(`SELECT state FROM ${table} WHERE id=1 FOR UPDATE`)).rows[0].state;}
   else {try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=empty();}}
   const before=JSON.stringify(state),result=fn(state);
   if(before!==JSON.stringify(state)){if(client)await client.query(`UPDATE ${table} SET state=$1 WHERE id=1`,[JSON.stringify(state)]);else writePrivateFile(file,JSON.stringify(state));}
   if(client)await client.query('COMMIT');return result;
  }catch(e){if(client)try{await client.query('ROLLBACK');}catch{}if(e.safeToDisplay)throw e;fail('Calendar storage is unavailable. Retry when the connection is restored.',503);}finally{client?.release();}
 }
 const run=fn=>{const result=serial.then(()=>transaction(fn));serial=result.catch(()=>{});return result;};
 const view=(s,range={})=>{
  const from=range.from??now()-31*86400000,to=range.to??now()+62*86400000;
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>400*86400000)fail('Choose a calendar range of at most 400 days.');
  return {revision:s.revision,events:structuredClone(s.events),occurrences:occurrences(s.events,from,to),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
 };
 return {view:range=>run(s=>view(s,range)),update:input=>run(s=>{applyPlanner(s,input,now());return view(s);}),notifications:()=>run(s=>{const items=s.notifications.filter(n=>!n.dismissed&&n.snoozedUntil<=now()).toReversed();return {items,unread:items.filter(n=>!n.read).length};}),notify:input=>run(s=>{applyPlanner(s,input,now());return {ok:true};}),tick:tasks=>run(s=>collectNotifications(s,tasks,now())),close:async()=>{await serial;await pool?.end();}};
}
