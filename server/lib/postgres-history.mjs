// Durable conversation storage. No credentials, SQL diagnostics or transcripts in errors.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {writePrivateFile} from './privacy.mjs';

export class ConversationStorageError extends Error {
  constructor(){super('Conversation storage is unavailable. Check the database connection before retrying.');this.name='ConversationStorageError';this.safeToDisplay=true;this.statusCode=503;}
}
export function readDatabaseUrl(stateDir, env=process.env){
  if(env.JARVIS_DATABASE_URL)return env.JARVIS_DATABASE_URL;
  const file=path.join(stateDir,'postgres.env');
  let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return '';throw new ConversationStorageError();}
  if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || (stat.mode&0o077))throw new ConversationStorageError();
  try{
    const match=fs.readFileSync(file,'utf8').match(/^DATABASE_URL=(.+)$/m);
    if(!match)throw new Error();
    const value=match[1].trim();
    return normalizeDatabaseUrl(value.startsWith('"')?JSON.parse(value):value);
  }catch{throw new ConversationStorageError();}
}
export function normalizeDatabaseUrl(value){
  try{const url=new URL(value);if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error();url.searchParams.delete('schema');return url.toString();}catch{throw new ConversationStorageError();}
}
function readLegacy(stateDir){
  const files={};
  for(const name of ['history.json','conversations.json','sessions.json']){
    try{const file=path.join(stateDir,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error();files[name]=JSON.parse(fs.readFileSync(file,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw new ConversationStorageError();}
  }
  return files;
}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function timestamp(value){if(!Number.isSafeInteger(value)||value<0)throw new ConversationStorageError();return value;}
function agentName(value){if(typeof value!=='string'||!value.length||value.length>200)throw new ConversationStorageError();return value;}
function message(row){if(!object(row)||typeof row.role!=='string'||!row.role||typeof row.text!=='string')throw new ConversationStorageError();timestamp(row.at);return row;}

export async function createPostgresHistory({connectionString,stateDir,schema='jarvis_memory'}){
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new ConversationStorageError();
  const {Pool}=await import('pg');
  const pool=new Pool({connectionString:normalizeDatabaseUrl(connectionString),max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,allowExitOnIdle:true,statement_timeout:15000,application_name:'omajarv-memory'});
  pool.on('error',()=>{}); // Request operations report a sanitized, actionable error.
  const q=name=>`"${schema}"."${name}"`;
  async function transaction(fn){
    let client;
    try{
      client=await pool.connect();await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[schema+':history']);
      const result=await fn(client);await client.query('COMMIT');return result;
    }catch{if(client)try{await client.query('ROLLBACK');}catch{}throw new ConversationStorageError();}
    finally{client?.release();}
  }
  async function query(sql,params){try{return await pool.query(sql,params);}catch{throw new ConversationStorageError();}}
  async function migrate(){
    await transaction(async client=>{
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${q('migrations')} (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      const applied=await client.query(`SELECT version FROM ${q('migrations')} ORDER BY version`);
      if(applied.rows.some(r=>r.version>1))throw new Error('Newer schema');
      if(applied.rows.some(r=>r.version===1))return;
      await client.query(`CREATE TABLE ${q('conversations')} (
        id text PRIMARY KEY, agent text NOT NULL, active boolean NOT NULL DEFAULT false,
        created_at bigint NOT NULL CHECK(created_at>=0), metadata jsonb NOT NULL DEFAULT '{}',
        next_sequence bigint NOT NULL DEFAULT 0 CHECK(next_sequence>=0))`);
      await client.query(`CREATE UNIQUE INDEX ON ${q('conversations')} (agent) WHERE active`);
      await client.query(`CREATE TABLE ${q('messages')} (
        id uuid PRIMARY KEY, conversation_id text NOT NULL REFERENCES ${q('conversations')}(id) ON DELETE CASCADE,
        sequence bigint NOT NULL CHECK(sequence>=0), role text NOT NULL, text text NOT NULL,
        at bigint NOT NULL CHECK(at>=0), agent text NOT NULL, model text NOT NULL DEFAULT '',
        metadata jsonb NOT NULL DEFAULT '{}', UNIQUE(conversation_id,sequence))`);
      await client.query(`CREATE TABLE ${q('provider_sessions')} (
        conversation_id text NOT NULL REFERENCES ${q('conversations')}(id) ON DELETE CASCADE,
        agent text NOT NULL, session text NOT NULL, model text NOT NULL DEFAULT '', updated_at bigint NOT NULL,
        PRIMARY KEY(conversation_id,agent))`);
      await client.query(`CREATE TABLE ${q('imports')} (source text PRIMARY KEY, fingerprint text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(), conversation_count integer NOT NULL, message_count integer NOT NULL)`);
      await client.query(`INSERT INTO ${q('migrations')}(version) VALUES(1)`);
    });
  }
  async function insertMessage(client,id,agent,row,sequence,metadata={}){
    message(row);
    const {role,text,at,...extra}=row;
    const result=await client.query(`INSERT INTO ${q('messages')}(id,conversation_id,sequence,role,text,at,agent,model,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[randomUUID(),id,sequence,role,text,at,agent,metadata.model||'',extra]);
    return result.rows[0].id;
  }
  async function importLegacy(){
    // Marker is checked before reading files: originals can remain untouched forever.
    return transaction(async client=>{
      if((await client.query(`SELECT 1 FROM ${q('imports')} WHERE source='legacy-json-v1'`)).rowCount)return {alreadyImported:true};
      const legacy=readLegacy(stateDir),histories=('history.json' in legacy?legacy['history.json']:{}),archives=('conversations.json' in legacy?legacy['conversations.json']:[]),sessions=('sessions.json' in legacy?legacy['sessions.json']:{});
      if(!object(histories)||!Array.isArray(archives)||!object(sessions))throw new Error('Invalid legacy data');
      const digest=createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
      const backupDir=path.join(stateDir,'memory-backups');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});fs.chmodSync(backupDir,0o700);
      const backup=path.join(backupDir,`legacy-${digest}.json`);
      if(!fs.existsSync(backup))writePrivateFile(backup,JSON.stringify({format:'jarvis-legacy-memory',version:1,files:legacy},null,2)+'\n');
      // Refuse mixing an unmarked existing store with legacy data.
      if((await client.query(`SELECT 1 FROM ${q('conversations')} LIMIT 1`)).rowCount)throw new Error('Store not empty');
      let conversationCount=0,messageCount=0;
      const chats=[...archives.map(chat=>({...chat,active:false})),...Object.entries(histories).map(([agent,messages])=>({id:randomUUID(),agent,messages,active:true,at:messages?.[0]?.at??Date.now()}))];
      for(const chat of chats){
        if(!object(chat)||!Array.isArray(chat.messages))throw new Error('Invalid chat');
        if(chat.active&&!chat.messages.length)continue;
        const agent=agentName(chat.agent),id=chat.id??randomUUID();if(typeof id!=='string'||!id)throw new Error('Invalid id');
        const {messages,...metadata}=chat;
        await client.query(`INSERT INTO ${q('conversations')}(id,agent,active,created_at,metadata,next_sequence) VALUES($1,$2,$3,$4,$5,$6)`,[id,agent,chat.active,timestamp(chat.at??messages[0]?.at??Date.now()),metadata,messages.length]);
        for(let sequence=0;sequence<messages.length;sequence++){await insertMessage(client,id,agent,messages[sequence],sequence);messageCount++;}
        if(chat.active&&sessions[agent]){
          if(typeof sessions[agent]!=='string')throw new Error('Invalid session');
          await client.query(`INSERT INTO ${q('provider_sessions')}(conversation_id,agent,session,updated_at) VALUES($1,$2,$3,$4)`,[id,agent,sessions[agent],Date.now()]);
        }
        conversationCount++;
      }
      await client.query(`INSERT INTO ${q('imports')}(source,fingerprint,conversation_count,message_count) VALUES('legacy-json-v1',$1,$2,$3)`,[digest,conversationCount,messageCount]);
      return {alreadyImported:false,conversationCount,messageCount};
    });
  }
  async function activeConversation(client,agent,at){
    let result=await client.query(`SELECT id,next_sequence FROM ${q('conversations')} WHERE agent=$1 AND active FOR UPDATE`,[agent]);
    if(result.rowCount)return result.rows[0];
    result=await client.query(`INSERT INTO ${q('conversations')}(id,agent,active,created_at) VALUES($1,$2,true,$3) RETURNING id,next_sequence`,[randomUUID(),agent,at]);return result.rows[0];
  }
  async function appendHistory(agent,role,text,metadata={}){
    agentName(agent);const row=message({role,text,at:metadata.at??Date.now()});
    return transaction(async client=>{
      const chat=await activeConversation(client,agent,row.at);
      const id=await insertMessage(client,chat.id,agent,row,chat.next_sequence,metadata);
      await client.query(`UPDATE ${q('conversations')} SET next_sequence=next_sequence+1 WHERE id=$1`,[chat.id]);
      if(metadata.session){
        await client.query(`INSERT INTO ${q('provider_sessions')}(conversation_id,agent,session,model,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,agent) DO UPDATE SET session=EXCLUDED.session,model=EXCLUDED.model,updated_at=EXCLUDED.updated_at`,[chat.id,agent,metadata.session,metadata.model||'',row.at]);
      }
      return {id,conversationId:chat.id};
    });
  }
  function mapMessage(row){return {...row.metadata,id:row.id,role:row.role,text:row.text,at:Number(row.at),agent:row.agent,model:row.model};}
  async function historyFor(agent){
    const result=await query(`SELECT m.* FROM ${q('messages')} m JOIN ${q('conversations')} c ON c.id=m.conversation_id WHERE c.agent=$1 AND c.active ORDER BY m.sequence`,[agent]);return result.rows.map(mapMessage);
  }
  async function conversations(){
    // One statement gives a consistent snapshot while appends/reset run concurrently.
    const result=await query(`SELECT c.id,c.agent,c.active,c.created_at,c.metadata,m.id AS message_id,m.sequence,m.role,m.text,m.at,m.model,m.metadata AS message_metadata FROM ${q('conversations')} c LEFT JOIN ${q('messages')} m ON m.conversation_id=c.id ORDER BY c.created_at DESC,c.id,m.sequence`);
    const chats=new Map();
    for(const row of result.rows){
      let chat=chats.get(row.id);
      if(!chat){chat={...row.metadata,id:row.id,agent:row.agent,active:row.active,at:Number(row.created_at),messages:[]};chats.set(row.id,chat);}
      if(row.message_id)chat.messages.push(mapMessage({...row,id:row.message_id,metadata:row.message_metadata}));
    }
    return [...chats.values()].map(chat=>({...chat,title:chat.messages.find(row=>row.role==='user')?.text.slice(0,90)||'Conversation'}));
  }
  async function clearHistory(){return transaction(client=>client.query(`UPDATE ${q('conversations')} SET active=false WHERE active`));}
  async function sessionFor(agent){const result=await query(`SELECT s.session FROM ${q('provider_sessions')} s JOIN ${q('conversations')} c ON c.id=s.conversation_id WHERE c.active AND s.agent=$1`,[agent]);return result.rows[0]?.session||'';}
  async function exportSnapshot(){
    return transaction(async client=>{
      const data={format:'jarvis-postgres-memory',version:1,schemaVersion:1,createdAt:Date.now(),tables:{}};
      for(const table of ['conversations','messages','provider_sessions','imports'])data.tables[table]=(await client.query(`SELECT * FROM ${q(table)}`)).rows;
      return data;
    });
  }
  async function restoreSnapshot(data){
    // Explicit recovery into an empty store only. Never clear a populated database.
    if(data?.format!=='jarvis-postgres-memory'||data.version!==1||data.schemaVersion!==1||!object(data.tables))throw new ConversationStorageError();
    return transaction(async client=>{
      if((await client.query(`SELECT 1 FROM ${q('conversations')} LIMIT 1`)).rowCount || (await client.query(`SELECT 1 FROM ${q('imports')} LIMIT 1`)).rowCount)throw new Error('Destination must be empty');
      const columns={conversations:['id','agent','active','created_at','metadata','next_sequence'],messages:['id','conversation_id','sequence','role','text','at','agent','model','metadata'],provider_sessions:['conversation_id','agent','session','model','updated_at'],imports:['source','fingerprint','imported_at','conversation_count','message_count']};
      for(const [table,keys]of Object.entries(columns)){
        if(!Array.isArray(data.tables[table]))throw new Error('Invalid snapshot');
        for(const row of data.tables[table])await client.query(`INSERT INTO ${q(table)}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(key=>row[key]));
      }
    });
  }
  const store={migrate,importLegacy,appendHistory,historyFor,conversations,clearHistory,sessionFor,exportSnapshot,restoreSnapshot,close:()=>pool.end()};
  return store;
}
