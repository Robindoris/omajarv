// Reuse board validation/lifecycle rules inside a serialized PostgreSQL transaction.
import fs from 'node:fs';
import path from 'node:path';
import {createKanban,normalize} from './kanban.mjs';
import {readDatabaseUrl,ConversationStorageError} from './postgres-history.mjs';
export async function openKanban(directory,{connectionString=readDatabaseUrl(directory),schema=process.env.JARVIS_DATABASE_SCHEMA||'jarvis_memory'}={}){
 if(!connectionString)return createKanban(directory);
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new ConversationStorageError();
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString,max:4,connectionTimeoutMillis:5000,statement_timeout:15000,idleTimeoutMillis:1000,allowExitOnIdle:true});
 pool.on('error',()=>{});
 const table=`"${schema}"."kanban_state"`;
 async function transaction(fn){
  let client;
  try{client=await pool.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[schema+':kanban']);const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){if(client)try{await client.query('ROLLBACK');}catch{}if(error.safeToDisplay)throw error;throw Object.assign(new Error('Task board storage is unavailable. Check the database connection and retry.'),{status:503,statusCode:503,safeToDisplay:true});}
  finally{client?.release();}
 }
 async function operate(method,args=[],recover=false){return transaction(async client=>{
  const {rows}=await client.query(`SELECT board,backups FROM ${table} WHERE id=1 FOR UPDATE`);
  if(!rows.length)throw new Error();
  let state=rows[0],changed=false;
  const board=createKanban(directory,{recover,storage:{load:()=>structuredClone(state),save:(board,backups)=>{state={board,backups};changed=true;}}});
  const result=method?board[method](...args):undefined;
  if(changed)await client.query(`UPDATE ${table} SET board=$1,backups=$2 WHERE id=1`,[JSON.stringify(state.board),JSON.stringify(state.backups)]);
  return result;
 });}
 try{
  await transaction(async client=>{
   await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
   await client.query(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`);
   await client.query(`CREATE TABLE IF NOT EXISTS ${table}(id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL CHECK(version=1),board jsonb NOT NULL,backups jsonb NOT NULL)`);
   if((await client.query(`SELECT 1 FROM ${table} WHERE id=1`)).rowCount)return;
   const read=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
   const state={board:read('kanban.json',{revision:0,tasks:[],requests:[]}),backups:read('kanban-backups.json',[])};
   if(!Number.isSafeInteger(state.board.revision)||state.board.revision<0||!Array.isArray(state.board.tasks)||state.board.tasks.length>200||new Set(state.board.tasks.map(t=>t.id)).size!==state.board.tasks.length||!Array.isArray(state.board.requests)||!Array.isArray(state.backups))throw new Error();
   state.board.tasks=state.board.tasks.map(normalize);
   for(const backup of state.backups){if(backup.format!=='jarvis-kanban'||backup.version!==1||!Array.isArray(backup.tasks)||backup.tasks.length>200)throw new Error();backup.tasks.forEach(normalize);}
   await client.query(`INSERT INTO ${table}(id,version,board,backups) VALUES(1,1,$1,$2)`,[JSON.stringify(state.board),JSON.stringify(state.backups)]);
  });
  await operate(null,[],true);
 }catch(error){await pool.end();throw error;}
 return Object.assign(Object.fromEntries(['view','backup','backups','savedBackup','update','startNext','finish'].map(method=>[method,(...args)=>operate(method,args)])),{close:()=>pool.end()});
}
