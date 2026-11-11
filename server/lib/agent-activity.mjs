// Public, credential-free activity derived from the active execution, never board columns.
export function createAgentActivity({now=Date.now}={}){
 let value=null;
 return {
  begin(source,task=null){value={source,phase:'thinking',task:task?{id:task.id,title:task.title}:null,startedAt:now(),updatedAt:now()};},
  phase(phase){if(value&&!value.endedAt&&['thinking','working','responding'].includes(phase)&&value.phase!==phase){value={...value,phase,updatedAt:now()};return true;}return false;},
  finish(phase){if(value)value={...value,phase,updatedAt:now(),endedAt:now()};},
  snapshot(){return value&&(!value.endedAt||now()-value.endedAt<8000)?{...value,task:value.task?{...value.task}:null}:null;}
 };
}
