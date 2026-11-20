// Literal, bounded search over the same authorized sources used by the UI.
export function searchQuery(value){
 if(typeof value!=='string'||value.length>160||/[\x00-\x1f\x7f]/.test(value))throw Object.assign(new Error('Use up to 160 printable characters.'),{status:400,safeToDisplay:true});
 return value.trim().toLocaleLowerCase();
}
export const visibleConversation=chat=>!chat.deleted&&!chat.deletedAt&&!chat.excluded&&!chat.excludedFromSearch&&chat.searchable!==false;
export function searchRows(query,rows,fields,{limit=20,maxRows=5000,maxChars=2000000}={}){
 const results=[];let scanned=0,chars=0,truncated=false;
 if(!query)return {results,truncated};
 for(const row of rows){
  if(++scanned>maxRows){truncated=true;break;}
  let match=false;
  for(const value of fields(row)){
   const text=String(value||'');if(chars+text.length>maxChars){truncated=true;break;}
   chars+=text.length;if(text.toLocaleLowerCase().includes(query)){match=true;break;}
  }
  if(match){if(results.length===limit){truncated=true;break;}results.push(row);}
  if(truncated)break;
 }
 return {results,truncated};
}
export function taskSearch(query,tasks){
 const found=searchRows(query,tasks,t=>[t.id,t.title,t.notes,...(t.reports||[]).flatMap(r=>[r.outcome,r.changes,r.verification,r.blockers,r.followUp])]);
 return {...found,results:found.results.map(t=>({id:t.id,title:t.title}))};
}
export function conversationSearch(query,chats){
 const found=searchRows(query,chats.filter(visibleConversation),c=>[c.id,c.title,...(c.messages||[]).map(m=>m.text)]);
 return {...found,results:found.results.map(c=>({id:c.id,title:c.title,agent:c.agent}))};
}
