import {conversationSearch,searchQuery} from './unified-search.mjs';
// Both clients use this single storage boundary. PostgreSQL is authoritative when configured.
import {paths} from './config.mjs';
import {createPostgresHistory,readDatabaseUrl} from './postgres-history.mjs';
const connectionString=readDatabaseUrl(paths.stateDir);
let store;
if(connectionString){
  store=await createPostgresHistory({connectionString,stateDir:paths.stateDir,schema:process.env.JARVIS_DATABASE_SCHEMA||'jarvis_memory'});
  try{await store.migrate();await store.importLegacy();}
  catch(error){await store.close();throw error;}
}else{
  store=await import('./history-json.mjs');
}
export const historyFor=async agent=>store.historyFor(agent);
export const appendHistory=async (agent,role,text,metadata)=>store.appendHistory(agent,role,text,metadata);
export const conversations=async ()=>store.conversations();
export const clearHistory=async ()=>store.clearHistory();
export const historyBackend=connectionString?'postgres':'json';

export async function searchConversations(value,{projectId=null,associations={}}={}){
 const query=searchQuery(value);
 if(!query)return {results:[],truncated:false};
 if(store.searchConversations)return store.searchConversations(query,{projectId,associations});
 return conversationSearch(query,(await store.conversations()).filter(c=>(Object.hasOwn(associations,c.id)?associations[c.id]:null)===projectId));
}
