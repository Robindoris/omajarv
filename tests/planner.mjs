import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {openPlanner,nextOccurrence} from '../server/lib/planner.mjs';
import {readDatabaseUrl} from '../server/lib/postgres-history.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-planner-test-'));
let now=Date.parse('2026-03-27T08:50:00Z');
const schema='test_planner_'+randomBytes(8).toString('hex');
const connectionString=process.env.JARVIS_TEST_DATABASE_ENV?readDatabaseUrl(path.dirname(process.env.JARVIS_TEST_DATABASE_ENV)):'';
const options={connectionString,schema,now:()=>now};let store,second,admin;
const create=(revision,extra={})=>({action:'create',requestId:randomUUID(),revision,title:'Calendar fixture',notes:'Synthetic event description',startAt:'2026-03-27T09:00:00Z',endAt:'2026-03-27T10:00:00Z',timeZone:'Europe/Bratislava',reminderMinutes:15,recurrence:'daily',...extra});
try{
 store=await openPlanner(dir,options);
 const input=create(0);const saved=await store.update(input);assert.equal(saved.events.length,1);await store.update(input);assert.equal((await store.view()).revision,1);
 await assert.rejects(store.update({...input,title:'Changed'}),e=>e.status===409);
 await assert.rejects(store.update(create(0)),e=>e.status===409);
 await assert.rejects(store.update(create(1,{endAt:'2026-03-27T08:00:00Z'})),e=>e.status===400);
 await assert.rejects(store.update(create(1,{timeZone:'invalid/zone'})),e=>e.status===400);
 await store.tick([]);let inbox=await store.notifications();assert.equal(inbox.unread,1);await store.tick([]);assert.equal((await store.notifications()).items.length,1);
 await store.notify({action:'notification:snooze',id:inbox.items[0].id,minutes:15});assert.equal((await store.notifications()).items.length,0);now+=16*60000;assert.equal((await store.notifications()).unread,1);
 await store.notify({action:'notification:read',id:inbox.items[0].id});assert.equal((await store.notifications()).unread,0);
 assert.equal(new Date(nextOccurrence(Date.parse('2026-03-28T09:00:00Z'),'daily','Europe/Bratislava')).toISOString(),'2026-03-29T08:00:00.000Z');
 assert.equal(new Date(nextOccurrence(Date.parse('2026-01-31T09:00:00Z'),'monthly','Europe/Bratislava')).toISOString(),'2026-02-28T09:00:00.000Z');
 assert.equal(new Date(nextOccurrence(Date.parse('2026-03-28T01:30:00Z'),'daily','Europe/Bratislava')).toISOString(),'2026-03-29T01:30:00.000Z');
 const range=await store.view({from:Date.parse('2026-03-01'),to:Date.parse('2026-04-01')});assert.equal(range.occurrences.length,5);assert.equal(range.occurrences[0].occurrenceStart,Date.parse(input.startAt),'delivered reminder must not hide event');
 const task={id:'fake-task',execution:'running',runId:'fake-run',title:'Kanban fixture',updatedAt:now,status:'doing'};await store.tick([task]);await store.tick([{...task,execution:'failed'}]);assert.equal((await store.notifications()).items.filter(n=>n.source==='kanban').length,1);await store.tick([{...task,execution:'failed'}]);assert.equal((await store.notifications()).items.filter(n=>n.source==='kanban').length,1);
 await store.close();store=await openPlanner(dir,options);assert.equal((await store.notifications()).items.length,2);assert.equal((await store.view()).events.length,1);
 if(connectionString){
  second=await openPlanner(dir,options);const results=await Promise.allSettled([store.update(create(1)),second.update(create(1))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const {Pool}=await import('pg');admin=new Pool({connectionString});await admin.query(`CREATE FUNCTION "${schema}".reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`);await admin.query(`CREATE TRIGGER reject_write BEFORE UPDATE ON "${schema}".planner_state FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_write()`);
  await assert.rejects(store.update(create(2)),e=>e.status===503);assert.equal((await store.view()).revision,2);
 }else assert.equal(fs.statSync(path.join(dir,'planner.json')).mode&0o777,0o600);
 console.log('PASS: '+(connectionString?'PostgreSQL':'JSON')+' calendar CRUD validation, recurrence/DST, reminders, snooze/read, deduplication, task alerts, persistence'+(connectionString?', concurrent revisions and transaction rollback.':'.'));
}finally{await store?.close();await second?.close();if(connectionString){if(!admin){const {Pool}=await import('pg');admin=new Pool({connectionString});}await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}fs.rmSync(dir,{recursive:true,force:true});}
