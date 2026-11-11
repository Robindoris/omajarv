import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createPostgresHistory,normalizeDatabaseUrl,readDatabaseUrl} from '../server/lib/postgres-history.mjs';
const source=process.env.JARVIS_TEST_DATABASE_ENV;
if(!source)throw new Error('Set JARVIS_TEST_DATABASE_ENV to a private project connection file. Tests use isolated random schemas only.');
const match=fs.readFileSync(source,'utf8').match(/^DATABASE_URL=(.+)$/m);
const connectionString=normalizeDatabaseUrl(JSON.parse(match[1]));
const admin=new Pool({connectionString});
const schemas=[],stores=[],homes=[];
async function fixture(){
 const schema='test_memory_'+randomBytes(8).toString('hex');schemas.push(schema);
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-memory-test-'));homes.push(stateDir);
 const store=await createPostgresHistory({connectionString,stateDir,schema});stores.push(store);await store.migrate();return {store,stateDir,schema};
}
function write(dir,name,data){fs.writeFileSync(path.join(dir,name),JSON.stringify(data),{mode:0o600});}
try{
 const role=(await admin.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=current_user')).rows[0];
 assert.deepEqual(Object.values(role),[false,false,false,false]);
 const {store,stateDir,schema}=await fixture();
 const active=[{role:'user',text:'First original',at:20},{role:'assistant',text:'Second original',at:10}];
 write(stateDir,'history.json',{fake:active});
 write(stateDir,'conversations.json',[{id:'saved-thread',agent:'fake',at:1,messages:[{role:'user',text:'Archived original',at:1}]}]);
 write(stateDir,'sessions.json',{fake:'fake-session'});
 const original=fs.readFileSync(path.join(stateDir,'history.json'),'utf8');
 assert.deepEqual(await store.importLegacy(),{alreadyImported:false,conversationCount:2,messageCount:3});
 assert.equal((await store.historyFor('fake'))[0].text,'First original');
 assert.equal(await store.sessionFor('fake'),'fake-session');
 const initial=await store.conversations();assert.equal(initial.length,2);assert(initial.some(c=>c.id==='saved-thread'));
 assert.deepEqual(await store.importLegacy(),{alreadyImported:true});assert.equal((await store.conversations()).length,2);
 assert.equal(fs.readFileSync(path.join(stateDir,'history.json'),'utf8'),original);
 const backup=fs.readdirSync(path.join(stateDir,'memory-backups'))[0];assert.equal(fs.statSync(path.join(stateDir,'memory-backups',backup)).mode&0o777,0o600);
 await Promise.all(Array.from({length:12},(_,i)=>store.appendHistory('fake','user','Concurrent '+i,{model:'fake-model'})));
 const rows=await store.historyFor('fake');assert.equal(rows.length,14);assert.equal(new Set(rows.map(r=>r.id)).size,14);
 await store.appendHistory('fake','assistant','Persisted reply',{session:'new-session',model:'fake-model'});
 const before=await store.conversations();await store.close();
 const restarted=await createPostgresHistory({connectionString,stateDir,schema});stores.push(restarted);await restarted.migrate();assert.deepEqual(await restarted.conversations(),before);assert.equal(await restarted.sessionFor('fake'),'new-session');
 const snapshot=await restarted.exportSnapshot();
 const recovery=await fixture();await recovery.store.restoreSnapshot(snapshot);assert.deepEqual(await recovery.store.conversations(),before);await assert.rejects(recovery.store.restoreSnapshot(snapshot));
 await restarted.clearHistory();assert.equal((await restarted.historyFor('fake')).length,0);assert.equal((await restarted.conversations()).length,2);await restarted.appendHistory('fake','user','New thread');assert.equal((await restarted.conversations()).length,3);
 const broken=await fixture();write(broken.stateDir,'history.json',{fake:[{role:'user',text:'Valid prefix',at:1},{role:'assistant',text:'Invalid suffix',at:-1}]});
 await assert.rejects(broken.store.importLegacy(),/Conversation storage is unavailable/);assert.equal((await broken.store.conversations()).length,0);
 write(broken.stateDir,'history.json',{fake:[{role:'user',text:'Recovered',at:1}]});assert.equal((await broken.store.importLegacy()).messageCount,1);
 const badRestore=await fixture(),damaged=structuredClone(snapshot);damaged.tables.messages[0].conversation_id='missing';await assert.rejects(badRestore.store.restoreSnapshot(damaged));assert.equal((await badRestore.store.conversations()).length,0);
 write(stateDir,'postgres.env',null);assert.throws(()=>readDatabaseUrl(stateDir,{}));
 console.log('PASS: restricted role, exact import/no loss, order, stable IDs, concurrent appends, restart persistence, idempotency, private backup, restore, failed import/restore rollback and retry.');
}finally{
 await Promise.allSettled(stores.map(s=>s.close()));
 for(const schema of schemas)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
 await admin.end();for(const home of homes)fs.rmSync(home,{recursive:true,force:true});
}
