import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createKanban} from '../server/lib/kanban.mjs';
import {createKanbanRunner} from '../server/lib/kanban-runner.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-board-runner-'));
let runner;
try{
 const board=createKanban(dir);let held,starts=0,busy=true;
 const act=input=>board.update({revision:board.view().revision,...input});
 act({action:'create',title:'First'});act({action:'create',title:'Second'});const [a,b]=board.view().tasks;
 act({action:'queue',id:a.id});act({action:'queue',id:b.id});
 runner=createKanbanRunner({board,busy:()=>busy,execute:async(task,signal)=>{starts++;await new Promise((resolve,reject)=>{held=resolve;signal.addEventListener('abort',()=>reject(new Error('Stopped')),{once:true});});}});
 await runner.tick();assert.equal(starts,0);busy=false;
 const first=runner.tick();await runner.tick();assert.equal(starts,1,'one active run even on duplicate ticks');assert.equal(board.view().tasks[0].execution,'running');held();await first;
 assert.equal(board.view().tasks[0].status,'done');assert.equal(board.view().tasks[1].execution,'queued');
 const second=runner.tick();assert.equal(runner.stop(b.id),true);await second;assert.equal(board.view().tasks[1].execution,'interrupted');
 await runner.tick();assert.equal(starts,2,'interrupted run not retried');runner.close();
 act({action:'queue',id:b.id});runner=createKanbanRunner({board,busy:()=>false,execute:async()=>{throw new Error('PRIVATE_PROVIDER_DIAGNOSTIC');}});await runner.tick();
 assert.equal(board.view().tasks[1].execution,'failed');assert.ok(!board.view().tasks[1].lastError.includes('PRIVATE_PROVIDER_DIAGNOSTIC'));
 console.log('PASS: serialized execution, shared busy lock, completion, cancellation, safe errors and no automatic retries.');
}finally{runner?.close();fs.rmSync(dir,{recursive:true,force:true});}
