#!/usr/bin/env node
// Offline maintenance: credentials are read privately, never passed in argv.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createPostgresHistory,readDatabaseUrl} from '../server/lib/postgres-history.mjs';
import {writePrivateFile} from '../server/lib/privacy.mjs';
const [command,stateDir=path.join(os.homedir(),'.local/state/omarchy-jarvis'),file]=process.argv.slice(2);
let store;
try{
  if(!['migrate','backup','restore-empty'].includes(command))throw new Error();
  const connectionString=readDatabaseUrl(stateDir);if(!connectionString)throw new Error();
  store=await createPostgresHistory({connectionString,stateDir});await store.migrate();
  if(command==='migrate'){
    const result=await store.importLegacy();
    console.log(result.alreadyImported?'Conversation migration already verified.':`Conversation migration verified: ${result.conversationCount} conversations, ${result.messageCount} messages.`);
  }else if(command==='backup'){
    const directory=path.join(stateDir,'memory-backups');fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const target=path.join(directory,`postgres-${Date.now()}.json`);
    writePrivateFile(target,JSON.stringify(await store.exportSnapshot())+'\n');console.log('Private conversation backup saved.');
  }else{
    if(!file)throw new Error();
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw new Error();
    await store.restoreSnapshot(JSON.parse(fs.readFileSync(file,'utf8')));console.log('Conversation backup restored into empty storage.');
  }
}catch{console.error('Conversation maintenance failed. Check private database settings, backup permissions and destination state. No database was cleared.');process.exitCode=1;}
finally{await store?.close();}
