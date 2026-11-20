import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../server/public/jarvis.js', import.meta.url), 'utf8');
let busy = true, poll, submitted = 0;
const context = vm.createContext({
  document:{body:{dataset:{workspace:'voice'}}},
  apiFetch: async path => path === '/api/stt'
    ? {ok:true, text:async () => JSON.stringify({text:'Call Eric'})}
    : {ok:true, json:async () => ({busy})},
  setTimeout: fn => {poll = fn;},
  generation:1, S:{TRANSCRIBING:'transcribing',IDLE:'idle'},
  setState() {}, el:{textInput:{value:''}}, remoteBusy:true,
  startChat: text => {assert.equal(text,'Call Eric'); submitted++;},
  armError: message => {throw new Error(message);},
});
vm.runInContext(source.slice(source.indexOf('  var voiceReplyRelease = null;'), source.indexOf('  /* Chat streaming')), context);
context.voiceReplyRelease = true;
const pending = context.transcribeAudio({type:'audio/wav'}, 'audio/wav', true);
await new Promise(resolve => setImmediate(resolve));
assert.equal(submitted,0);
assert.equal(context.el.textInput.value,'Call Eric');
busy = false; poll();
await pending;
assert.equal(submitted,1);
assert.equal(context.remoteBusy,false);
assert.equal(context.el.textInput.value,'');

// A newer recording/Stop invalidates a transcript waiting for release.
busy = true;
context.voiceReplyRelease = true;
const cancelled = context.transcribeAudio({type:'audio/wav'}, 'audio/wav', true);
await new Promise(resolve => setImmediate(resolve));
context.generation++;
busy = false; poll();
await cancelled;
assert.equal(submitted,1);
context.document = {body:{dataset:{workspace:'conversation'}}};
let composerOpened = false;
context.openComposer = open => {composerOpened = open;};
context.el.textInput.value = 'Existing draft.';
await context.transcribeAudio({type:'audio/wav'}, 'audio/wav', false);
assert.equal(submitted,1,'Conversation dictation must not send chat');
assert.equal(context.el.textInput.value,'Existing draft. Call Eric');
assert.equal(composerOpened,true);
await context.transcribeAudio({type:'audio/wav'}, 'audio/wav', true);
assert.equal(submitted,1,'Switching out of Voice before transcription completes must not send');
console.log('Voice waits for reply release; Conversation dictation stays editable');
