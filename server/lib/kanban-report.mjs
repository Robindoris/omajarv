// Only an explicit structured result can claim verified completion.
export function parseKanbanReport(reply){
 const fallback={outcome:'blocked',changes:'No structured change summary recorded.',verification:'No verification recorded.',blockers:'The agent did not return a valid verified completion report.',followUp:'Review the response and retry with verification.'};
 const match=String(reply).match(/```jarvis-report\s*([\s\S]*?)```/);
 if(!match)return fallback;
 try{
  const value=JSON.parse(match[1]);
  if(!['completed','failed','blocked'].includes(value.outcome))return fallback;
  for(const key of ['changes','verification','blockers','followUp'])if(typeof value[key]!=='string'||value[key].length>4000||value[key].includes('\0'))return fallback;
  if(!value.changes.trim()||!value.verification.trim()||!value.followUp.trim())return fallback;
  if(value.outcome==='completed'&&value.blockers.trim())return {...value,outcome:'blocked'};
  return Object.fromEntries(['outcome','changes','verification','blockers','followUp'].map(key=>[key,value[key]]));
 }catch{return fallback;}
}
