import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the desktop dispatcher with a deliberately stalled metadata request.
const source = fs.readFileSync(new URL('../server/desktop.mjs', import.meta.url), 'utf8');
const perform = source.slice(source.indexOf('async function perform('), source.indexOf('async function finishRecording('));
const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('readline.createInterface('));
let resolveModels;
const pendingModels = new Promise(resolve => { resolveModels = resolve; });
const events = [];
const chats = [];
let lookups = 0;
const context = vm.createContext({
  emit: (event, data) => events.push({event, ...data}),
  request: endpoint => { assert.equal(endpoint, 'models'); lookups++; return pendingModels; },
  chat: async text => { chats.push(text); },
});
vm.runInContext(`let operation = false, recording = null, generation = 0, modelLookup = null; ${perform}\n${dispatch}`, context);
const lookup = vm.runInContext("dispatch({action:'models'})", context);
const duplicate = vm.runInContext("dispatch({action:'models'})", context);
assert.equal(lookups, 1);
assert.equal(vm.runInContext('operation', context), false);
assert.equal(vm.runInContext('generation', context), 0);
await vm.runInContext("dispatch({action:'send',text:'hello'})", context);
assert.deepEqual(chats, ['hello']);
const statesBefore = events.filter(e => e.event === 'state').length;
resolveModels(JSON.stringify({agent:'opencode',listed:true,models:[]}));
await Promise.all([lookup, duplicate]);
assert.equal(events.filter(e => e.event === 'models').length, 1);
assert.equal(events.filter(e => e.event === 'state').length, statesBefore);
vm.runInContext('operation = true', context);
await assert.rejects(vm.runInContext("dispatch({action:'setModel',model:'provider/model'})", context), /Stop the current request/);
console.log('PASS: model metadata does not block chat, duplicate lookups share work, and busy model changes report an error.');
