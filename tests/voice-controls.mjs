import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../server/public/jarvis.js', import.meta.url), 'utf8');
const listeners = {};
const attributes = {};
const context = vm.createContext({
  el: {muteBtn: {addEventListener: (_, fn) => {listeners.mute = fn;}, setAttribute: (k,v) => {attributes[k] = v;}, classList: {toggle() {}}}},
  outputMuted: false, audioEl: {muted: false}, outputGain: {gain: {value: 1}}, flashStatus() {},
});
vm.runInContext(source.slice(source.indexOf('  if (el.muteBtn) {'), source.indexOf("  if (el.stopBtn) {\n    el.stopBtn.addEventListener")), context);
listeners.mute();
assert.equal(context.audioEl.muted, true);
assert.equal(context.outputGain.gain.value, 0);
assert.equal(attributes['aria-pressed'], 'true');
listeners.mute();
assert.equal(context.audioEl.muted, false);
assert.equal(context.outputGain.gain.value, 1);
// Toggling before the audio graph exists must work too.
context.audioEl = null; context.outputGain = null;
listeners.mute();
assert.equal(context.outputMuted, true);

// A stop during an asynchronous audio start must not return to Speaking.
let resume, play, played = 0, changedState = 0;
Object.assign(context, {
  generation: 1, isPlaying: false, speechQueue: ['blob:fixture'],
  audioEl: {play() {played++; return new Promise(resolve => {play = resolve;});}},
  AC: {state: 'suspended', resume() {return new Promise(resolve => {resume = resolve;});}},
  S: {SPEAKING: 'speaking'}, setState() {changedState++;},
  updateSpeechState() {}, cleanupAudioUrl() {},
});
vm.runInContext(source.slice(source.indexOf('  async function playNext() {'), source.indexOf('  function cleanupAudioUrl() {')), context);
let pending = context.playNext();
context.generation++;
resume(); await pending;
assert.equal(played, 0);
assert.equal(changedState, 0);
context.isPlaying = false; context.speechQueue = ['blob:second']; context.AC.state = 'running';
pending = context.playNext();
context.generation++;
play(); await pending;
assert.equal(changedState, 0);
console.log('Voice mute and playback cancellation checks passed');
