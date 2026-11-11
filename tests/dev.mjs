import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=path.resolve(import.meta.dirname,'..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-dev-launcher-'));
const runtime=path.join(fixture,'persistent'),alias=path.join(fixture,'alias'),testHome=path.join(fixture,'user');
fs.mkdirSync(testHome);fs.mkdirSync(path.join(alias,'home/.config/omarchy-jarvis'),{recursive:true});
fs.writeFileSync(path.join(alias,'home/.config/omarchy-jarvis/config.json'),JSON.stringify({host:'127.0.0.1',agent:'codex',tunnel:{enabled:false},stt:{engine:'cli'}}));
fs.writeFileSync(path.join(alias,'home/preserve-fixture'),'Keep this existing dev data');
const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const wrappers=path.join(fixture,'mise/command-wrappers/bin'),tools=path.join(fixture,'tools');
fs.mkdirSync(wrappers,{recursive:true});fs.mkdirSync(tools);
const actual=path.join(tools,'codex');
fs.writeFileSync(actual,'#!/bin/sh\necho fixture-agent\n',{mode:0o700});
fs.writeFileSync(path.join(wrappers,'codex'),'#!/bin/sh\necho untrusted-mise-wrapper >&2\nexit 1\n',{mode:0o700});
fs.writeFileSync(path.join(tools,'mise'),`#!${process.execPath}\nif(process.env.HOME!==${JSON.stringify(testHome)})process.exit(1);console.log(${JSON.stringify(actual)});`,{mode:0o700});
const env={...process.env,PATH:wrappers+path.delimiter+tools+path.delimiter+process.env.PATH,HOME:testHome,JARVIS_DEV_DIR:runtime,JARVIS_DEV_ALIAS:alias,JARVIS_DEV_PORT:String(port)};
let children=[];
function run(command){const child=spawn(process.execPath,[path.join(root,'scripts/dev.mjs'),command],{env,cwd:root,stdio:['ignore','pipe','pipe']});children.push(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return {child,output:()=>output};}
async function waitFor(test,message){for(let i=0;i<200;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail(message);}
async function finished(process){if(process.child.exitCode===null)await once(process.child,'exit');assert.equal(process.child.exitCode,0,process.output());}
try{
 const first=run('start');await waitFor(()=>first.output().includes('development ready'),first.output());
 assert.ok(fs.lstatSync(path.join(alias,'home')).isSymbolicLink());
 assert.equal(fs.readlinkSync(path.join(runtime,'bin/codex')),actual,'Resolve mise agents with the real home before dev isolation');
 assert.equal(fs.readFileSync(path.join(runtime,'home/preserve-fixture'),'utf8'),'Keep this existing dev data');
 const state=path.join(runtime,'home/.local/state/omarchy-jarvis');const token=fs.readFileSync(path.join(state,'token'),'utf8');
 const pid=JSON.parse(fs.readFileSync(path.join(runtime,'server.json'))).pid;
 const duplicate=run('start');await finished(duplicate);assert.match(duplicate.output(),/already running/);assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,'server.json'))).pid,pid);
 const stopped=run('stop');await finished(stopped);await finished(first);
 // Simulate /tmp cleanup while retaining persistent dev data.
 fs.rmSync(alias,{recursive:true,force:true});
 const second=run('start');await waitFor(()=>second.output().includes('development ready'),second.output());
 assert.equal(fs.readFileSync(path.join(state,'token'),'utf8'),token,'access credentials survive an alias rebuild');
 assert.equal(fs.readFileSync(path.join(runtime,'home/preserve-fixture'),'utf8'),'Keep this existing dev data');
 const restart=run('restart');await waitFor(()=>restart.output().includes('development ready'),restart.output());await finished(second);
 assert.equal(fs.readFileSync(path.join(state,'token'),'utf8'),token);
 const last=run('stop');await finished(last);await finished(restart);
 console.log('PASS: dev migration, persistent data/token, duplicate prevention, restart and recovery after temporary alias removal.');
}finally{
 for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
 fs.rmSync(fixture,{recursive:true,force:true});
}
