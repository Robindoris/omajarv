import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {writePrivateFile} from './privacy.mjs';
const columns=['todo','doing','done'];
const executions=['idle','queued','running','completed','failed','interrupted'];
const priorities=['low','normal','high','urgent'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,safeToDisplay:true});};
export function localDate(date=new Date()) {return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function validDate(value){if(value==='')return true;if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return false;const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d,12);return y>=2000&&y<=9999&&localDate(date)===value;}
export function nextDueDate(value,recurrence,today=localDate()) {
 const [y,m,d]=(value||today).split('-').map(Number),next=new Date(y,m-1,d,12);
 if(recurrence.frequency==='monthly'){next.setDate(1);next.setMonth(next.getMonth()+recurrence.interval);next.setDate(Math.min(d,new Date(next.getFullYear(),next.getMonth()+1,0,12).getDate()));}
 else next.setDate(next.getDate()+recurrence.interval*(recurrence.frequency==='weekly'?7:1));
 return localDate(next);
}
function text(value,max,label){if(typeof value!=='string'||value.length>max||value.includes('\0'))fail(`Invalid ${label} (maximum ${max} characters).`);return value;}
function fields(input){
 const out={};
 if('title' in input){out.title=text(input.title,200,'title').trim();if(!out.title)fail('A task title is required.');}
 if('notes' in input)out.notes=text(input.notes,8000,'notes');
 if('priority' in input){if(!priorities.includes(input.priority))fail('Invalid priority.');out.priority=input.priority;}
 if('dueDate' in input){if(!validDate(input.dueDate))fail('Use a valid date in YYYY-MM-DD format.');out.dueDate=input.dueDate;}
 if('recurrence' in input){const r=input.recurrence;if(!r||!['none','daily','weekly','monthly'].includes(r.frequency)||!Number.isInteger(r.interval)||r.interval<1||r.interval>365)fail('Invalid recurrence interval.');out.recurrence={frequency:r.frequency,interval:r.interval};}
 return out;
}
function normalize(task){
 if(!task||typeof task.id!=='string'||!/^[\w:-]{1,100}$/.test(task.id)||!columns.includes(task.status))fail('Invalid task in backup.');
 const clean=fields(task);if(!clean.title)fail('Task title missing in backup.');
 const defaults={notes:'',priority:'normal',dueDate:'',recurrence:{frequency:'none',interval:1},execution:task.status==='done'?'completed':'idle',attempts:0,lastError:'',createdAt:task.updatedAt||Date.now()};
 const result={...defaults,...clean,id:task.id,status:task.status,updatedAt:Number.isFinite(task.updatedAt)?task.updatedAt:Date.now()};
 if(executions.includes(task.execution))result.execution=task.execution;
 for(const key of ['createdAt','startedAt','completedAt','attempts'])if(Number.isFinite(task[key])&&task[key]>=0)result[key]=task[key];
 for(const key of ['runId','nextOccurrenceId','recurringFrom'])if(typeof task[key]==='string'&&task[key].length<=100)result[key]=task[key];
 result.lastError=typeof task.lastError==='string'?task.lastError.slice(0,2000):'';
 return result;
}
export function createKanban(directory,{now=()=>new Date()}={}) {
 const file=path.join(directory,'kanban.json'),backupsFile=path.join(directory,'kanban-backups.json');
 let board={revision:0,tasks:[],requests:[]},backups=[];
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!Number.isSafeInteger(saved.revision)||saved.revision<0||!Array.isArray(saved.tasks)||saved.tasks.length>200)fail('Invalid stored board. Restore a private backup.');board={revision:saved.revision,tasks:saved.tasks.map(normalize),requests:saved.requests||[]};fs.chmodSync(file,0o600);}catch(error){if(error.code!=='ENOENT')throw error;}
 try{backups=JSON.parse(fs.readFileSync(backupsFile,'utf8'));fs.chmodSync(backupsFile,0o600);}catch(error){if(error.code!=='ENOENT')throw error;}
 const stamp=()=>now().getTime();
 const snapshot=(value=board)=>({format:'jarvis-kanban',version:1,createdAt:stamp(),revision:value.revision,tasks:structuredClone(value.tasks)});
 function commit(tasks,request){
  const history=[...backups,snapshot()].slice(-20);
  const next={revision:board.revision+1,tasks,requests:request?[...board.requests,request].slice(-100):board.requests};
  // A pre-change recovery point is durable before replacing the canonical board.
  writePrivateFile(backupsFile,JSON.stringify(history));
  writePrivateFile(file,JSON.stringify(next));backups=history;board=next;
 }
 // Interrupted processes must never restart an old run or silently retry it.
 if(board.tasks.some(t=>['queued','running'].includes(t.execution))){
  commit(board.tasks.map(t=>['queued','running'].includes(t.execution)?{...t,execution:'interrupted',lastError:'JARVIS restarted before this run finished. Review the task before retrying.',updatedAt:stamp()}:t));
 }
 function complete(task,tasks){
  task.status='done';task.execution='completed';task.completedAt=stamp();task.lastError='';
  if(task.recurrence.frequency!=='none'&&!task.nextOccurrenceId){
   if(tasks.length>=200)fail('Board is full. Remove a task before completing this recurring task.');
   const id=randomUUID(),next=normalize({...task,id,status:'todo',execution:'idle',attempts:0,lastError:'',createdAt:stamp(),updatedAt:stamp(),dueDate:nextDueDate(task.dueDate,task.recurrence,localDate(now()))});
   delete next.runId;delete next.startedAt;delete next.completedAt;delete next.nextOccurrenceId;next.recurringFrom=task.id;tasks.push(next);task.nextOccurrenceId=id;
  }
 }
 const api={
  view:()=>({revision:board.revision,tasks:structuredClone(board.tasks),hostDate:localDate(now()),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),
  backup:()=>snapshot(),
  backups:()=>backups.map(({createdAt,revision,tasks})=>({createdAt,revision,count:tasks.length})).reverse(),
  savedBackup(revision){const found=backups.findLast(b=>b.revision===revision);if(!found)fail('Backup not found.',404);return structuredClone(found);},
  update(input){
   if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid board request.');
   let request;
   if(input.requestId!==undefined){
    if(typeof input.requestId!=='string'||!/^[\w-]{8,100}$/.test(input.requestId))fail('Invalid request identifier.');
    const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous=board.requests.find(r=>r.id===input.requestId);
    if(previous){if(previous.hash!==hash)fail('This request ID was already used for another action.',409);return api.view();}
    request={id:input.requestId,hash};
   }
   if(input.revision!==board.revision)fail('Board changed on another device. Latest tasks loaded; review and try again.',409);
   let tasks=structuredClone(board.tasks);
   if(input.action==='restore'){
    if(input.confirm!==true)fail('Confirm the restore after reviewing the backup.');
    if(tasks.some(t=>['queued','running'].includes(t.execution)))fail('Stop or cancel queued/running tasks before restoring.',409);
    const backup=input.backup;
    if(backup?.format!=='jarvis-kanban'||backup.version!==1||!Array.isArray(backup.tasks)||backup.tasks.length>200)fail('Not a supported JARVIS board backup.');
    tasks=backup.tasks.map(normalize);if(new Set(tasks.map(t=>t.id)).size!==tasks.length)fail('Backup contains duplicate task IDs.');
    tasks=tasks.map(t=>['running','queued'].includes(t.execution)?{...t,execution:'interrupted',lastError:'Restored unfinished run. Review before retrying.'}:t);
   } else if(input.action==='create'){
    if(tasks.length>=200)fail('Board limit reached (200 tasks).');
    const detail=fields(input);if(!detail.title)fail('A task title is required.');
    tasks.push(normalize({id:randomUUID(),status:'todo',...detail,updatedAt:stamp()}));
   } else {
    const task=tasks.find(t=>t.id===input.id);if(!task)fail('Task no longer exists. Refresh the board.',404);
    if(['queued','running'].includes(task.execution)&&!['cancel'].includes(input.action))fail('This task is already queued or running. Stop it before editing or retrying.',409);
    if(input.action==='delete')tasks=tasks.filter(t=>t.id!==task.id);
    else if(input.action==='edit')Object.assign(task,fields(input));
    else if(input.action==='move'&&columns.includes(input.status)){
     task.status=input.status;if(task.status==='done')complete(task,tasks);else if(task.execution==='completed')task.execution='idle';
    } else if(input.action==='queue'){
     if(task.status==='done')fail('Move the completed task to Next up before running again.',409);
     task.execution='queued';task.status='todo';task.runId=randomUUID();task.lastError='';
    } else if(input.action==='cancel'){
     if(task.execution==='running')fail('The running agent must be stopped before its task can be retried.',409);
     if(task.execution!=='queued')fail('This task is not queued.',409);
     task.execution='interrupted';task.lastError='Cancelled before starting.';
    } else if(input.action==='advance'){
     complete(task,tasks);
     const next=tasks.find(t=>t.status==='todo'&&t.execution==='idle'&&t.id!==task.id);
     if(next){next.execution='queued';next.runId=randomUUID();next.lastError='';}
    } else fail('Invalid board action.');
    task.updatedAt=stamp();
   }
   commit(tasks,request);return api.view();
  },
  startNext(){
   if(board.tasks.some(t=>t.execution==='running'))return null;
   const tasks=structuredClone(board.tasks),task=tasks.find(t=>t.execution==='queued');if(!task)return null;
   task.execution='running';task.status='doing';task.attempts++;task.startedAt=stamp();task.updatedAt=stamp();commit(tasks);return structuredClone(task);
  },
  finish(id,runId,state,error=''){
   if(!['completed','failed','interrupted'].includes(state))fail('Invalid run result.');
   const tasks=structuredClone(board.tasks),task=tasks.find(t=>t.id===id);
   if(!task||task.runId!==runId||task.execution!=='running')return false;
   task.execution=state;task.lastError=String(error).slice(0,2000);task.updatedAt=stamp();
   if(state==='completed')complete(task,tasks);
   commit(tasks);return true;
  },
 };
 return api;
}
