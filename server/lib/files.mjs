import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {writePrivateFile} from './privacy.mjs';
export const FILE_LIMIT=10*1024*1024,TEXT_LIMIT=256*1024;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,safeToDisplay:true});};
const protectedName=name=>/^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.config|\.codex|\.claude|\.cursor|\.npmrc|\.netrc|\.pypirc|\.docker|\.jarvis-trash|\.jarvis-tmp-.*|credentials?(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|auth\.json|config\.json|personality\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keystore))$/i.test(name);
function parts(value,empty=true){if(typeof value!=='string'||value.length>1500||value.includes('\\')||value.startsWith('/')||/[\x00-\x1f\x7f]/.test(value))fail('Use a valid workspace-relative name.');const p=value?value.split('/'):[];if((!empty&&!p.length)||p.some(x=>!x||x==='.'||x==='..'||x.length>240))fail('Use a valid workspace-relative name.');if(p.some(protectedName))fail('This location is protected.',403);return p;}
const version=s=>createHash('sha256').update([s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs].join(':')).digest('hex');
function safeStat(file){const s=fs.lstatSync(file,{bigint:true});if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory())||(s.isFile()&&s.nlink!==1n))fail('Links and special files are blocked.',403);return s;}
const identity=s=>`${s.dev}:${s.ino}`;
function checkSecrets(bytes){const value=bytes.toString('utf8');if(/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,})\b|(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[=:]\s*["']?[^\s"']{8,}/i.test(value))fail('Potential credentials are blocked.',403);}
function textBytes(bytes){let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('Only UTF-8 text can be previewed or edited.',415);}if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))fail('Binary files cannot be edited.',415);if(/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,})\b|(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[=:]\s*["']?[^\s"']{8,}/i.test(value))fail('Potential credentials are blocked.',403);return value;}
export function createWorkspaceFiles({workspace,stateDir}){
 const approvalFile=path.join(stateDir,'file-workspaces.json');
 let approved=[];try{approved=JSON.parse(fs.readFileSync(approvalFile,'utf8'));if(!Array.isArray(approved)||approved.length>20)throw new Error();}catch(e){if(e.code!=='ENOENT')fail('Workspace approvals are unavailable.',503);}
 function candidate(value=workspace){
  if(typeof value!=='string'||value.length>4096||/[\x00-\x1f\x7f\\]/.test(value)||value.split('/').some(p=>p==='..'||p==='.')||(!path.isAbsolute(value)&&!value.startsWith('~/')))fail('Enter an absolute workspace folder path.');
  const configured=path.resolve(value.replace(/^~(?=\/|$)/,os.homedir()));
  if(!value)fail('Choose a dedicated project workspace in local settings.',403);
  // Runtime HOME aliases may occur in ancestors. Approve their canonical target;
  // never follow a workspace entry that is itself a link.
  safeStat(configured);
  const dir=fs.realpathSync(configured);
  if(dir==='/'||dir===fs.realpathSync(os.homedir())||[os.userInfo().homedir,'/home','/tmp','/var','/usr','/bin','/sbin','/lib','/lib64'].includes(dir)||/^\/(?:etc|proc|sys|dev|run|boot)(?:\/|$)/.test(dir)||dir.split('/').some(x=>protectedName(x)))fail('Choose a dedicated project workspace in local settings.',403);
  const s=safeStat(dir);if(!s.isDirectory())fail('Workspace is unavailable.',403);
  return {path:dir,identity:identity(s)};
 }
 function root(id){const r=approved.find(r=>r.id===id);if(!r)fail('Approve this workspace before browsing.',403);const s=safeStat(r.path);if(fs.realpathSync(r.path)!==r.path||identity(s)!==r.identity)fail('Workspace changed. Approve it again.',403);return r;}
 function directory(r,components,fn){let fd=fs.openSync(r.path,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{if(identity(fs.fstatSync(fd,{bigint:true}))!==r.identity)fail('Workspace changed. Approve it again.',403);for(const name of components){const next=fs.openSync(`/proc/self/fd/${fd}/${name}`,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);fs.closeSync(fd);fd=next;}const pinned=`/proc/self/fd/${fd}`,actual=fs.readlinkSync(pinned);if(actual!==r.path&&!actual.startsWith(r.path+'/'))fail('Workspace location changed.',403);return fn(pinned,fd);}finally{fs.closeSync(fd);}}
 function parent(r,rel,fn){const p=parts(rel,false),name=p.pop();return directory(r,p,dir=>fn(dir+'/'+name,name));}
 function read(file,limit=FILE_LIMIT){const s=safeStat(file);if(!s.isFile())fail('Select a regular file.');if(s.size>BigInt(limit))fail('File exceeds the size limit.',413);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const opened=fs.fstatSync(fd,{bigint:true});if(identity(opened)!==identity(s)||!opened.isFile()||opened.nlink!==1n)fail('File changed. Refresh and try again.',409);const bytes=Buffer.alloc(limit+1);const count=fs.readSync(fd,bytes,0,bytes.length,0);if(count>limit)fail('File exceeds the size limit.',413);if(version(fs.fstatSync(fd,{bigint:true}))!==version(s))fail('File changed. Refresh and try again.',409);return {bytes:bytes.subarray(0,count),version:version(s)};}finally{fs.closeSync(fd);}}
 function expect(file,expected){const s=safeStat(file);if(typeof expected!=='string'||version(s)!==expected)fail('This item changed. Refresh before trying again.',409);return s;}
 function existing(file){try{return safeStat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 function tree(file,relative='',budget={nodes:0,bytes:0}){const s=safeStat(file);if(++budget.nodes>1000)fail('Folder operation exceeds 1000 items.',413);if(s.isFile()){budget.bytes+=Number(s.size);if(budget.bytes>32*1024*1024)fail('Folder operation exceeds 32 MB.',413);const data=read(file);checkSecrets(data.bytes);return [{relative,type:'file',bytes:data.bytes}];}const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{if(identity(fs.fstatSync(fd,{bigint:true}))!==identity(s))fail('Folder changed. Refresh first.',409);const pinned=`/proc/self/fd/${fd}`,out=[{relative,type:'directory'}];for(const name of fs.readdirSync(pinned)){parts(name,false);out.push(...tree(pinned+'/'+name,relative?relative+'/'+name:name,budget));}return out;}finally{fs.closeSync(fd);}}
 function trashDir(r,fn){return directory(r,[],dir=>{const target=dir+'/.jarvis-trash';try{fs.mkdirSync(target,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=safeStat(target);if(!s.isDirectory()||(Number(s.mode)&0o077))fail('Trash storage is not private.',403);const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{return fn(`/proc/self/fd/${fd}`);}finally{fs.closeSync(fd);}});}
 function trash(r,rel,expected){return parent(r,rel,file=>{expect(file,expected);tree(file);return trashDir(r,dir=>{if(fs.readdirSync(dir).length>=2000)fail('Trash is full. Restore items before deleting more.',409);const id=randomUUID(),meta={id,path:rel,deletedAt:Date.now()};fs.writeFileSync(dir+'/'+id+'.json',JSON.stringify(meta),{flag:'wx',mode:0o600});try{fs.renameSync(file,dir+'/'+id);}catch(e){fs.unlinkSync(dir+'/'+id+'.json');throw e;}return {ok:true,trashId:id};});});}
 function write(r,rel,bytes,input){if(bytes.length>FILE_LIMIT)fail('File exceeds 10 MB.',413);checkSecrets(bytes);return parent(r,rel,file=>{const old=existing(file);if(old){if(!old.isFile())fail('A folder already uses that name.',409);if(input.overwrite!==true)fail('File exists. Confirm overwrite using its current version.',409);expect(file,input.version);}else if(input.version||input.overwrite===true)fail('The original file no longer exists. Refresh first.',409);const temp=path.dirname(file)+'/.jarvis-tmp-'+randomUUID();try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});if(old)trash(r,rel,input.version);fs.linkSync(temp,file);fs.unlinkSync(temp);}finally{fs.rmSync(temp,{force:true});}return {ok:true};});}
 function overview(){let available=false,candidateLabel='',candidatePath='',approvalError='';try{const c=candidate();candidatePath=c.path;candidateLabel=path.basename(c.path);available=!approved.some(r=>r.path===c.path&&r.identity===c.identity);}catch(e){approvalError=e.safeToDisplay?e.message:'Configured workspace is unavailable. Check its location and permissions in local settings.';}return {candidateLabel,candidatePath,approvalError,roots:approved.map(r=>({id:r.id,label:r.label,path:r.path})),canApprove:available,limits:{file:FILE_LIMIT,text:TEXT_LIMIT,folderItems:1000,folderBytes:32*1024*1024}};}
 function list(r,rel){const p=parts(rel);return directory(r,p,dir=>{const names=fs.readdirSync(dir);if(names.length>2000)fail('Folder exceeds the 2000 entry browsing limit.',413);let blocked=0;const entries=[];for(const name of names){try{parts(name,false);const s=safeStat(dir+'/'+name);entries.push({name,type:s.isDirectory()?'directory':'file',size:Number(s.size),modifiedAt:Number(s.mtimeMs),version:version(s)});}catch(e){if(e.status===403||e.code==='ENOENT'){blocked++;continue;}throw e;}}return {entries,blocked,path:rel};});}
 function dispatch(input,bytes){
  if(!input||typeof input!=='object')fail('Invalid file request.');
  if(input.action==='search'){
   if(typeof input.query!=='string'||input.query.length>160||/[\x00-\x1f\x7f]/.test(input.query))fail('Use up to 160 printable characters.');
   const query=input.query.trim().toLocaleLowerCase(),results=[];let truncated=false,visited=0,folders=0;
   if(!Array.isArray(input.roots)||input.roots.length>20)fail('Invalid search roots.');
   if(!query)return {results,truncated};
   const queue=input.roots.map(id=>({r:root(id),rel:'',depth:0})),deadline=Date.now()+150;
   while(queue.length){
    if(++folders>100||Date.now()>deadline){truncated=true;break;}
    const {r,rel,depth}=queue.shift();let entries;
    try{entries=list(r,rel).entries;}catch(e){truncated=true;continue;}
    for(const item of entries){
     if(++visited>4000){truncated=true;break;}
     const name=rel?rel+'/'+item.name:item.name;
     if(name.toLocaleLowerCase().includes(query)){
      if(results.length===20){truncated=true;break;}
      results.push({root:r.id,path:name,title:item.name,type:item.type});
     }
     if(item.type==='directory'){if(depth<8)queue.push({r,rel:name,depth:depth+1});else truncated=true;}
    }
    if(visited>4000||results.length===20){truncated=true;break;}
   }
   return {results,truncated};
  }
  if(input.action==='roots')return overview();
  if(input.action==='reviewRoot')return candidate(input.path);
  if(input.action==='approve'){if(input.confirm!==true)fail('Confirm workspace approval.');const c=candidate(input.path===undefined?workspace:input.path);if(input.path!==undefined&&input.identity!==c.identity)fail('Workspace changed. Review its location again.',409);if(approved.length>=20&&!approved.some(r=>r.path===c.path))fail('At most 20 workspaces can be approved.',409);if(!approved.some(r=>r.path===c.path&&r.identity===c.identity)){const next=[...approved.filter(r=>r.path!==c.path),{...c,id:randomUUID(),label:path.basename(c.path)}];writePrivateFile(approvalFile,JSON.stringify(next));approved=next;}return overview();}
  const r=root(input.root),rel=input.path||'';
  if(input.action==='list')return list(r,rel);
  if(input.action==='stat')return parent(r,rel,file=>{const s=safeStat(file);return {version:version(s),type:s.isDirectory()?'directory':'file'};});
  if(input.action==='preview'||input.action==='download')return parent(r,rel,file=>{const data=read(file,input.action==='preview'?TEXT_LIMIT:FILE_LIMIT);checkSecrets(data.bytes);return input.action==='preview'?{text:textBytes(data.bytes),version:data.version}:{bytes:data.bytes,name:path.basename(rel)};});
  if(input.action==='mkdir')return parent(r,rel,file=>{if(existing(file))fail('An item already uses that name.',409);fs.mkdirSync(file,{mode:0o700});return {ok:true};});
  if(input.action==='write'||input.action==='upload'){const data=input.action==='upload'?bytes:typeof input.text==='string'?Buffer.from(input.text):null;if(!Buffer.isBuffer(data))fail('File contents are required.');if(input.action==='write')textBytes(data);if(input.action==='write'&&data.length>TEXT_LIMIT)fail('Text edit exceeds 256 KB.',413);return write(r,rel,data,input);}
  if(input.action==='trash')return trash(r,rel,input.version);
  if(input.action==='trashList')return trashDir(r,dir=>({items:fs.readdirSync(dir).filter(n=>/^[\w-]+\.json$/.test(n)).map(n=>{const meta=JSON.parse(read(dir+'/'+n,4096).bytes.toString());parts(meta.path,false);return meta;}).sort((a,b)=>b.deletedAt-a.deletedAt)}));
  if(input.action==='restore'){if(typeof input.id!=='string'||! /^[a-f0-9-]{36}$/.test(input.id))fail('Invalid trash selection.');return trashDir(r,dir=>{const meta=JSON.parse(read(dir+'/'+input.id+'.json',4096).bytes.toString());parts(meta.path,false);return parent(r,meta.path,file=>{if(existing(file))fail('Restore destination exists. Rename it before restoring.',409);tree(dir+'/'+input.id);fs.renameSync(dir+'/'+input.id,file);fs.unlinkSync(dir+'/'+input.id+'.json');return {ok:true};});});}
  if(input.action==='move'||input.action==='copy'){
   parts(input.to,false);if(input.to===rel||input.to.startsWith(rel+'/'))fail('Choose a different destination outside this folder.');
   return parent(r,rel,source=>{const original=expect(source,input.version),items=tree(source);return parent(r,input.to,target=>{const old=existing(target);if(old){if(original.isDirectory()||old.isDirectory())fail('Folder overwrites are blocked.',409);if(input.overwrite!==true)fail('Destination exists. Confirm overwrite.',409);expect(target,input.targetVersion);}
    if(input.action==='move'){if(old)trash(r,input.to,input.targetVersion);fs.renameSync(source,target);}
    else {const temp=path.dirname(target)+'/.jarvis-tmp-'+randomUUID();try{for(const item of items){const dest=item.relative?temp+'/'+item.relative:temp;if(item.type==='directory')fs.mkdirSync(dest,{mode:0o700});else fs.writeFileSync(dest,item.bytes,{flag:'wx',mode:0o600});}if(old)trash(r,input.to,input.targetVersion);fs.renameSync(temp,target);}finally{fs.rmSync(temp,{force:true,recursive:true});}}
    return {ok:true};});});
  }
  fail('Unknown file operation.');
 }
 return {resolveRoot(id){return root(id).path;},dispatch(input,bytes){try{return dispatch(input,bytes);}catch(e){if(e.safeToDisplay)throw e;const status=['EACCES','EPERM','ELOOP','ENOTDIR'].includes(e.code)?403:e.code==='ENOENT'?404:e.code==='EEXIST'?409:500;fail(status===403?'Permission denied or unsafe link.':status===404?'Item not found. Refresh the folder.':status===409?'Destination already exists.':'File operation failed. Check permissions and available storage.',status);}}};
}
