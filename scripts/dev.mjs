#!/usr/bin/env node
// Persistent, isolated development launcher. Never starts/stops the installed service.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.resolve(process.env.JARVIS_DEV_DIR||path.join(root,'.jarvis-dev'));
const alias=path.resolve(process.env.JARVIS_DEV_ALIAS||path.join(os.tmpdir(),'jarvis-v2-dev'));
const port=Number(process.env.JARVIS_DEV_PORT||4318);
const command=process.argv[2]||'start';
const home=path.join(runtime,'home'),aliasHome=path.join(alias,'home');
const metadata=path.join(runtime,'server.json'),lock=path.join(runtime,'launcher.lock');
const serverFile=path.join(root,'server/jarvis-server.mjs');
const state=path.join(home,'.local/state/omarchy-jarvis');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
function agentPath(){
 // Mise wrappers consult HOME for trust state. Resolve installed executables
 // before switching to the isolated dev HOME, without changing mise trust.
 const bin=path.join(runtime,'bin');
 for(const name of ['codex','claude','opencode','hermes']){
  const link=path.join(bin,name);
  if(fs.existsSync(link)&&fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);
  const first=String(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,name)).find(file=>{try{fs.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}});
  if(!first||!/[\\/]mise[\\/](?:command-wrappers[\\/]bin|shims)[\\/]/.test(first))continue;
  const result=spawnSync('mise',['which',name],{encoding:'utf8',timeout:10000});
  const resolved=result.stdout?.trim();
  if(result.status!==0||!resolved||!path.isAbsolute(resolved))throw new Error(`Unable to resolve ${name} through mise before starting development.`);
  fs.accessSync(resolved,fs.constants.X_OK);
  fs.symlinkSync(resolved,link);
 }
 return bin+path.delimiter+process.env.PATH;
}
const live=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
function owned(info){
 if(!info||info.root!==root||!Number.isSafeInteger(info.pid)||!live(info.pid))return false;
 try{return fs.readFileSync(`/proc/${info.pid}/cmdline`,'utf8').split('\0').includes(serverFile);}catch{return false;}
}
function privateDir(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);}
function writeJson(file,value){const temporary=file+'.new';fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});fs.renameSync(temporary,file);}
function bootstrap(){
 privateDir(runtime);privateDir(alias);
 if(!fs.existsSync(home)){
  // Preserve the prior hand-created dev home, but never follow its theme/provider links.
  if(fs.existsSync(aliasHome)&&!fs.lstatSync(aliasHome).isSymbolicLink()){
   fs.cpSync(aliasHome,home,{recursive:true,dereference:false,verbatimSymlinks:true,filter:source=>{
    const stat=fs.lstatSync(source);return !stat.isSocket()&&!source.includes('/omarchy-jarvis/tmp/');
   }});
  }else privateDir(home);
 }
 privateDir(home);
 let aliasExists=false;try{fs.lstatSync(aliasHome);aliasExists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(aliasExists){
  const stat=fs.lstatSync(aliasHome);
  if(stat.isSymbolicLink()){
   if(path.resolve(path.dirname(aliasHome),fs.readlinkSync(aliasHome))!==home)throw new Error('The dev alias belongs to another checkout. Set JARVIS_DEV_ALIAS to a different directory.');
  }else{
   // The old runtime remains as a recovery copy after migration.
   fs.renameSync(aliasHome,path.join(alias,'home-before-persistent-'+Date.now()));fs.symlinkSync(home,aliasHome,'dir');
  }
 }else fs.symlinkSync(home,aliasHome,'dir');
 const configDir=path.join(home,'.config/omarchy-jarvis');privateDir(configDir);
 const configFile=path.join(configDir,'config.json');
 if(!fs.existsSync(configFile))writeJson(configFile,{host:'127.0.0.1',port,agent:'',codexFullAccess:false,agentFullAccess:false,tunnel:{enabled:false},stt:{engine:'cli'}});
 const stateParent=path.join(home,'.local/state');privateDir(stateParent);
 const theme=path.join(stateParent,'omarchy');
 try{fs.lstatSync(theme);}catch(error){if(error.code!=='ENOENT')throw error;fs.symlinkSync(path.join(os.homedir(),'.local/state/omarchy'),theme,'dir');}
 const bin=path.join(runtime,'bin');privateDir(bin);privateDir(path.join(runtime,'runtime'));
 fs.writeFileSync(path.join(bin,'tailscale'),`#!/bin/sh\ncase "$*" in\n 'status --json'|'serve status --json') printf '{}\\n' ;;\n *) echo 'Manage development Tailscale Serve externally; production listeners are preserved.' >&2; exit 1 ;;\nesac\n`,{mode:0o700});
}
function request(endpoint){return new Promise(resolve=>{
 let token;try{token=fs.readFileSync(path.join(state,'token'),'utf8').trim();}catch{return resolve(null);}
 const req=http.request({socketPath:path.join(state,'serve.sock'),path:endpoint,headers:{'X-Jarvis-Token':token}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{resolve(res.statusCode===200?JSON.parse(text):null);}catch{resolve(null);}});});
 req.setTimeout(1500,()=>req.destroy());req.on('error',()=>resolve(null));req.end();
});}
async function stop(){
 const info=readJson(metadata);
 if(!owned(info)){
  if(await request('/api/health'))throw new Error('A dev bridge is running without this launcher’s PID record. Inspect its terminal; it was not stopped.');
  console.log('Development server is stopped.');return;
 }
 const history=await request('/api/history');if(history?.busy)throw new Error('Development JARVIS is answering a request. Wait or stop the reply before restarting.');
 process.kill(info.pid,'SIGTERM');
 for(let i=0;i<100&&live(info.pid);i++)await sleep(100);
 if(live(info.pid))throw new Error('The dev process has not stopped; no second instance was launched.');
 if(readJson(metadata)?.pid===info.pid)fs.rmSync(metadata,{force:true});
}
async function start(){
 const existing=readJson(metadata);
 if(owned(existing)){
  bootstrap();
  if(await request('/api/health')){console.log(`JARVIS development is already running on http://127.0.0.1:${existing.port}.`);return;}
  throw new Error('The managed dev process is still starting or unhealthy. Inspect its terminal before restarting.');
 }
 if(await request('/api/health'))throw new Error('A dev bridge already owns this socket. Inspect its terminal instead of starting a duplicate.');
 bootstrap();
 let lockOwned=false,child;
 try{
  const previous=readJson(lock);if(previous&&Number.isSafeInteger(previous.pid)&&live(previous.pid))throw new Error('Another dev launcher is already starting the server.');
  if(fs.existsSync(lock))fs.rmSync(lock);
  const fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);lockOwned=true;
  const built=spawnSync(process.execPath,[path.join(root,'frontend/build.mjs')],{cwd:root,stdio:'inherit'});
  if(built.status!==0)throw new Error('Frontend build failed; the development server was not started.');
  const env={...process.env,HOME:aliasHome,CODEX_HOME:process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),HERMES_HOME:process.env.HERMES_HOME||path.join(os.homedir(),'.hermes'),JARVIS_OMARCHY_AGENT_FILE:process.env.JARVIS_OMARCHY_AGENT_FILE||path.join(os.homedir(),'.config/omarchy/defaults/agent'),PATH:path.join(runtime,'bin')+path.delimiter+process.env.PATH,XDG_RUNTIME_DIR:path.join(runtime,'runtime'),DBUS_SESSION_BUS_ADDRESS:'unix:path='+path.join(runtime,'runtime/no-session-bus')};
  delete env.XDG_CONFIG_HOME;delete env.XDG_STATE_HOME;delete env.XDG_DATA_HOME;
  env.PATH=agentPath();
  child=spawn(process.execPath,[serverFile,'--http','--port',String(port)],{cwd:root,env,stdio:'inherit'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  writeJson(metadata,{pid:child.pid,root,port});
  const clear=()=>{if(readJson(metadata)?.pid===child.pid)fs.rmSync(metadata,{force:true});};
  child.once('exit',code=>{clear();process.exitCode=process.exitCode||code||0;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(child.exitCode===null)child.kill(signal);});
  for(let i=0;i<100;i++){
   if(await request('/api/health')){console.log(`JARVIS development ready: http://127.0.0.1:${port}`);console.log('Persistent private dev data: .jarvis-dev/ (Git-ignored).');return;}
   if(child.exitCode!==null)throw new Error('Development server exited before becoming ready.');
   await sleep(100);
  }
  child.kill('SIGTERM');throw new Error('Development server did not become ready within the startup window.');
 }finally{if(lockOwned)fs.rmSync(lock,{force:true});}
}
try{
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('JARVIS_DEV_PORT must be an integer between 1024 and 65535.');
 if(!['start','stop','restart','status'].includes(command))throw new Error('Usage: npm run dev [-- start|stop|restart|status]');
 if(command==='status'){console.log(await request('/api/health')?'Development server is running.':'Development server is stopped.');}
 else{if(['stop','restart'].includes(command))await stop();if(command!=='stop')await start();}
}catch(error){console.error(error.message);process.exitCode=1;}
