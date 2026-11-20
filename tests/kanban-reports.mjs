import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createKanban} from '../server/lib/kanban.mjs';
import {parseKanbanReport} from '../server/lib/kanban-report.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-reports-'));
try{
 let board=createKanban(dir);
 const act=input=>board.update({revision:board.view().revision,...input});
 const add=()=>{act({action:'create',title:'Implement and verify report persistence',notes:'Original task specification',priority:'high'});return board.view().tasks.at(-1).id;};
 const detail={changes:'Saved reports',verification:'node isolated-test: PASS',blockers:'',followUp:'Add report search'};
 for(const outcome of ['completed','failed','blocked','interrupted']){
  const id=add();act({action:'queue',id});const task=board.startNext();assert.equal(task.id,id);
  assert.equal(board.finish(id,task.runId,outcome,outcome==='completed'?'':'Stopped',detail),true);
  const saved=board.view().tasks.find(t=>t.id===id);
  assert.equal(saved.notes,'Original task specification');assert.equal(saved.priority,'high');
  assert.equal(saved.reports[0].outcome,outcome);assert.equal(saved.reports[0].verification,detail.verification);
  assert.equal(saved.status,outcome==='completed'?'done':'doing');
  const revision=board.view().revision;assert.equal(board.finish(id,task.runId,outcome),false);assert.equal(board.view().revision,revision);
 }
 const cancelled=add();act({action:'queue',id:cancelled});act({action:'cancel',id:cancelled});assert.match(board.view().tasks.at(-1).reports[0].blockers,/Cancelled/);
 const interrupted=add();act({action:'queue',id:interrupted});board.startNext();board=createKanban(dir);assert.equal(board.view().tasks.at(-1).reports[0].outcome,'interrupted');
 board=createKanban(dir);assert.equal(board.view().tasks.at(-1).reports.length,1);
 const backup=board.backup();act({action:'restore',confirm:true,backup});assert.deepEqual(board.backup().tasks,backup.tasks);
 const first=add(),next=add();act({action:'queue',id:first});const running=board.startNext();board.finish(first,running.runId,'completed','',detail);assert.equal(board.view().tasks.find(t=>t.id===next).execution,'queued');
 assert.equal(parseKanbanReport('Blocked: write denied').outcome,'blocked');
 assert.equal(parseKanbanReport('```jarvis-report\n'+JSON.stringify({outcome:'completed',...detail})+'\n```').outcome,'completed');
 assert.equal(parseKanbanReport('```jarvis-report\n'+JSON.stringify({outcome:'completed',...detail,blockers:'Write denied'})+'\n```').outcome,'blocked');
 console.log('PASS: reports, outcomes, cancellation, recovery, duplicate finishes, restore, queue advancement and structured completion.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

// A rejected durable write must leave both outcome and report available for retry.
{
 let state={board:{revision:0,tasks:[],requests:[]},backups:[]},reject=false;
 const board=createKanban('/unused',{storage:{load:()=>structuredClone(state),save:(board,backups)=>{if(reject)throw new Error('fixture storage unavailable');state=structuredClone({board,backups});}}});
 const act=input=>board.update({revision:board.view().revision,...input});
 act({action:'create',title:'Verify atomic completion persistence'});const id=board.view().tasks[0].id;act({action:'queue',id});const task=board.startNext();
 reject=true;assert.throws(()=>board.finish(id,task.runId,'completed'),/storage unavailable/);
 assert.equal(board.view().tasks[0].execution,'running');assert.equal(board.view().tasks[0].reports,undefined);
 reject=false;assert.equal(board.finish(id,task.runId,'completed'),true);assert.equal(state.board.tasks[0].reports.length,1);
 console.log('PASS: failed durable report writes remain retryable and atomic.');
}
