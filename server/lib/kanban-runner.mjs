// Serialize board execution with the same lock, agent and history as ordinary chat.
// A queue entry is explicit user authorization; failures never requeue themselves.
export function createKanbanRunner({board,busy,execute,onError=()=>{},onClaim=()=>{}}){
 let active=null,closed=false,claiming=false;
 async function tick(){
  if(closed||active||claiming||busy())return;
  let task;claiming=true;onClaim(true);try{task=board.startNext();if(task?.then)task=await task;}catch(error){onClaim(false);onError(error);return;}finally{claiming=false;}
  if(!task){onClaim(false);return;}
  const controller=new AbortController();active={task,controller};
  try{
   await execute(task,controller.signal);
   if(controller.signal.aborted)await board.finish(task.id,task.runId,'interrupted','Stopped by the user. Review before retrying.');
   else await board.finish(task.id,task.runId,'completed');
  }catch(error){
   try{await board.finish(task.id,task.runId,controller.signal.aborted?'interrupted':'failed',controller.signal.aborted?'Stopped by the user. Review before retrying.':error.safeToDisplay?error.message:'Agent request failed. Check the agent/provider and permissions, then retry once.');}catch(saveError){onError(saveError);}
  }finally{active=null;onClaim(false);}
 }
 const interval=setInterval(()=>void tick(),500);interval.unref();
 return {tick,stop(id){if(active?.task.id!==id)return false;active.controller.abort();return true;},active:()=>active?.task.id||null,close(){closed=true;clearInterval(interval);active?.controller.abort();}};
}
