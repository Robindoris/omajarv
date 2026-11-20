import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';import {createPostgresHistory,readDatabaseUrl} from '../server/lib/postgres-history.mjs';
if(!process.env.JARVIS_SEARCH_DATABASE_STATE)throw Error('Specify a private database state directory.');
const connectionString=readDatabaseUrl(process.env.JARVIS_SEARCH_DATABASE_STATE,{}),schema='test_search_'+randomBytes(8).toString('hex'),stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-search-pg-'));
const pool=new Pool({connectionString}),store=await createPostgresHistory({connectionString,schema,stateDir});
try{
 await store.migrate();const first=await store.appendHistory('fixture','user','Common title');await store.appendHistory('fixture','assistant','bodyword %_ literal');await store.clearHistory();const other=await store.appendHistory('fixture','user','Common other');
 const scope={projectId:'p1',associations:{[first.conversationId]:'p1'}};
 const find=(q,context=scope)=>store.searchConversations(q,context);
 assert.deepEqual((await find('common')).results.map(c=>c.id),[first.conversationId]);assert.equal((await find(first.conversationId)).results[0].id,first.conversationId);assert.equal((await find('bodyword')).results.length,1);assert.equal((await find('%_')).results.length,1);assert.equal((await find('absent')).results.length,0);
 assert.deepEqual((await find('common',{projectId:null,associations:scope.associations})).results.map(c=>c.id),[other.conversationId]);
 for(const metadata of [{excluded:true},{excludedFromSearch:true},{deleted:true},{deletedAt:Date.now()},{searchable:false}]){await pool.query(`UPDATE "${schema}".conversations SET metadata=$2 WHERE id=$1`,[first.conversationId,metadata]);assert.equal((await find('common')).results.length,0);}
 await pool.query(`UPDATE "${schema}".conversations SET metadata='{}' WHERE id=$1`,[first.conversationId]);assert.equal((await find('common')).results.length,1);
 await pool.query(`DELETE FROM "${schema}".conversations WHERE id=$1`,[first.conversationId]);assert.equal((await find('common')).results.length,0);
 for(let i=0;i<22;i++){await store.clearHistory();await store.appendHistory('fixture','user','Common '+i);}
 const limited=await find('common',{projectId:null,associations:{}});assert.equal(limited.results.length,20);assert.equal(limited.truncated,true);
 console.log('PASS PostgreSQL search: isolated disposable schema, literal metacharacters, IDs/body/title, project authorization, exclusion/deletion propagation without stale index, 20-result bound.');
}catch{process.exitCode=1;console.error('FAIL PostgreSQL search acceptance; no credentials or database diagnostics logged.');}
finally{await store.close();await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();fs.rmSync(stateDir,{recursive:true,force:true});}
