import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-fallback-'));
const original={HOME:process.env.HOME,PATH:process.env.PATH};
process.env.HOME=home;process.env.PATH=path.join(home,'bin')+':'+original.PATH;
try{
 fs.mkdirSync(path.join(home,'bin'));
 const agentFile=path.join(home,'.config/omarchy/defaults/agent');
 fs.mkdirSync(path.dirname(agentFile),{recursive:true});
 fs.writeFileSync(path.join(home,'bin/opencode'),`#!${process.execPath}
if(process.argv[2]==='models'){console.log('openai/paid\\nopencode/fixture-free');process.exit();}
let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{
 if(process.argv.includes('openai/paid')){console.log(JSON.stringify({type:'error',error:{message:'insufficient credits'}}));process.exitCode=1;return;}
 require('node:fs').writeFileSync(${JSON.stringify(path.join(home,'args'))},JSON.stringify(process.argv));
 console.log(JSON.stringify({type:'text',sessionID:'free-session',part:{text:'Free answer'}}));
});`,{mode:0o755});
 fs.writeFileSync(path.join(home,'bin/codex'),`#!${process.execPath}
let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{
 if(text.includes('partial'))console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Partial'}}));
 if(text.includes('tools'))console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}}));
 console.log(JSON.stringify({type:'turn.failed',error:{message:text.includes('network')?'Connection failed':'insufficient_quota'}}));
 process.exitCode=1;
});`,{mode:0o755});
 const {runAgent,agentStatus,activeModel,updateActiveModel}=await import('../server/lib/agent.mjs');
 const config={agent:'',systemPrompt:'test',workDir:home};
 assert.equal(agentStatus(config).id,'opencode');
 await runAgent({config,text:'No system agent'});
 assert.ok(JSON.parse(fs.readFileSync(path.join(home,'args'))).includes('opencode/fixture-free'));
 fs.writeFileSync(agentFile,'codex');
 for(const text of ['network','partial','tools']){
  await assert.rejects(runAgent({config,text}));
  assert.equal(agentStatus(config).id,'codex','Do not fallback after unrelated failures, output or tool execution');
 }
 let change;
 const result=await runAgent({config,text:'credit failure',onAgentChange:a=>change=a});
 assert.equal(result.agent,'opencode');assert.equal(change.model,'opencode/fixture-free');
 assert.equal(agentStatus(config).id,'opencode');assert.equal(activeModel(config),'opencode/fixture-free');
 updateActiveModel('openai/paid');assert.equal(activeModel(config),'openai/paid');
 fs.writeFileSync(agentFile,'hermes');assert.equal(agentStatus(config).id,'hermes','System changes clear the runtime fallback');
 fs.writeFileSync(agentFile,'codex');assert.equal(agentStatus(config).id,'codex');
 assert.equal(agentStatus({...config,agent:'opencode'}).id,'opencode','Explicit override is preserved');
 const paid=await runAgent({config:{...config,agent:'opencode',agentModels:{opencode:'openai/paid'}},text:'Paid OpenCode model depleted'});
 assert.equal(paid.agent,'opencode');assert.equal(activeModel({...config,agent:'opencode'}),'opencode/fixture-free');
 console.log('PASS: free fallback, billing-only retry, partial/tool guards, model choice and system agent changes.');
}finally{Object.assign(process.env,original);fs.rmSync(home,{recursive:true,force:true});}
