import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server/public/jarvis.js',import.meta.url),'utf8');
const poll=source.slice(source.indexOf('  async function pollSudo()'),source.indexOf('  async function cancelSudo'));
assert(poll.includes('finally'));
async function fixture(responses){
 let calls=0;
 const context=vm.createContext({sudoEnabled:true,sudoPolling:false,sudoSubmitting:false,sudoRequest:null,document:{visibilityState:'visible',querySelector:()=>null},AbortController,setTimeout,clearTimeout,Date,sudoUnavailable:()=>{},apiFetch:async()=>{const response=responses[calls++];if(response instanceof Error)throw response;return response;}});
 vm.runInContext(poll,context);
 await context.pollSudo();await context.pollSudo();return {calls,context};
}
assert.equal((await fixture([{ok:true,json:async()=>({enabled:false,requests:[]})}])).calls,1);
assert.equal((await fixture([{ok:false,status:403}])).calls,1);
assert.equal((await fixture([new Error('offline'),{ok:true,json:async()=>({enabled:true,requests:[]})}])).calls,2);
assert.equal((await fixture([{ok:true,json:async()=>({requests:[]})},{ok:true,json:async()=>({requests:[]})}])).calls,2);
console.log('PASS: disabled sudo polling stops, legacy 403 stops, transient failures retry, HTTPS polling continues.');
