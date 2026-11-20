import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writePrivateFile} from './privacy.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,safeToDisplay:true});};
const id=value=>typeof value==='string'&&/^[\w:-]{1,100}$/.test(value);
export function createProjects(directory,{validateRoot=()=>false,save=writePrivateFile}={}){
 const file=path.join(directory,'projects.json');
 let state={version:1,revision:0,activeId:null,projects:[],conversations:{}};
 try{state=JSON.parse(fs.readFileSync(file,'utf8'));if(state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.projects)||state.projects.length>100||!state.conversations||typeof state.conversations!=='object'||Array.isArray(state.conversations))throw new Error();
 const ids=new Set();for(const p of state.projects){if(!id(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||!Array.isArray(p.rootIds)||!p.rootIds.length||p.rootIds.length>20||!p.rootIds.every(id))throw new Error();ids.add(p.id);}if(state.activeId!==null&&!ids.has(state.activeId))throw new Error();for(const [key,value] of Object.entries(state.conversations))if(!id(key)||!ids.has(value))throw new Error();fs.chmodSync(file,0o600);
 }catch(error){if(error.code!=='ENOENT')fail('Project storage is unavailable. Restore a private backup.',503);}
 const project=value=>{if(value===null)return null;const found=state.projects.find(p=>p.id===value);if(!found)fail('Project no longer exists. Refresh the project list.',404);return found;};
 function commit(next){next.revision=state.revision+1;try{save(file,JSON.stringify(next));}catch{fail('Unable to save projects. Check storage and retry.',503);}state=next;}
 return {
  view:()=>structuredClone(state),
  active:()=>state.activeId,
  project,
  association:conversationId=>Object.hasOwn(state.conversations,conversationId)?state.conversations[conversationId]:null,
  checkContext(value){if(value!==state.activeId)fail('Active project changed on another client. Refresh before continuing.',409);},
  allowedRoot(rootId){const p=project(state.activeId);return !p||p.rootIds.includes(rootId);},
  validateSelection(value){const p=project(value);if(p)for(const root of p.rootIds)if(!validateRoot(root))fail('Project root is not approved or is unavailable.',403);return p;},
  linkConversation(conversationId,projectId=state.activeId){if(!id(conversationId))fail('Invalid conversation association.');project(projectId);if(this.association(conversationId)===projectId)return;if(Object.hasOwn(state.conversations,conversationId))fail('Conversation belongs to another project.',409);if(projectId===null)return;const next=structuredClone(state);next.conversations[conversationId]=projectId;commit(next);},
  update(input){
   if(!input||input.revision!==state.revision)fail('Projects changed on another client. Review and retry.',409);
   const next=structuredClone(state);
   if(input.action==='create'){
    if(next.projects.length>=100)fail('Project limit reached.');
    if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>100||/[\x00-\x1f\x7f]/.test(input.name))fail('Use a project name of 1–100 characters.');
    if(next.projects.some(p=>p.name.toLocaleLowerCase()===input.name.trim().toLocaleLowerCase()))fail('A project already uses this name.',409);
    if(!Array.isArray(input.rootIds)||!input.rootIds.length||input.rootIds.length>20||new Set(input.rootIds).size!==input.rootIds.length||!input.rootIds.every(root=>id(root)&&validateRoot(root)))fail('Choose approved, available workspace roots.',403);
    next.projects.push({id:randomUUID(),name:input.name.trim(),rootIds:input.rootIds,createdAt:Date.now()});
   }else if(input.action==='select'){this.validateSelection(input.id);next.activeId=input.id;}
   else if(input.action==='associateConversation'){
    if(!id(input.id))fail('Invalid conversation.');project(input.projectId);if(input.projectId===null)delete next.conversations[input.id];else next.conversations[input.id]=input.projectId;
   }else fail('Unknown project operation.');
   commit(next);return this.view();
  }
 };
}
