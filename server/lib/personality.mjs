import fs from 'node:fs';
import path from 'node:path';
import { paths, defaults } from './config.mjs';
import { writePrivateFile } from './privacy.mjs';

const questions = {
  assistantName: 'Welcome! What would you like to name your assistant?',
  personality: 'How would you like me to behave? Describe my personality, tone, and how you want me to help.',
  userName: 'What name would you like me to call you?',
};
export function createPersonality(config) {
  const file = path.join(paths.stateDir, 'personality.json');
  let stored;
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Unable to read assistant personality settings');
  }
  if (stored) fs.chmodSync(file, 0o600);
  let state = stored || {assistantName:'JARVIS', userName:'',
    personality:config.systemPrompt !== defaults.systemPrompt ? config.systemPrompt : 'Be calm, helpful and concise. Adapt your tone and level of detail to my requests.',
    stage:'assistantName', revision:0, messages:[], startedAt:Date.now()};
  const configured = () => fs.existsSync(paths.configFile);
  const view = () => ({assistantName:state.assistantName, userName:state.userName,
    personality:state.personality, stage:configured() ? state.stage : 'pendingSetup', revision:state.revision});
  const persist = next => {
    writePrivateFile(file, JSON.stringify(next));
    state = next;
  };
  const checkRevision = revision => {
    if (revision !== state.revision) {
      const error = new Error('Assistant settings changed on another device. Refresh and try again.');
      error.status = 409;
      throw error;
    }
  };
  const field = (name, value, limit) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
      const error = new Error(`${name} must contain 1–${limit} characters.`);
      error.status = 400;
      throw error;
    }
    return value.trim();
  };
  return {
    view,
    summary() { const {personality, ...summary} = view(); return summary; },
    messages() {
      if (!configured()) return [];
      return state.messages.length ? state.messages : questions[state.stage]
        ? [{role:'assistant', text:questions[state.stage], at:state.startedAt || 0}] : [];
    },
    answering() { return configured() && !!questions[state.stage]; },
    answer(text, revision) {
      checkRevision(revision);
      const stage = state.stage;
      const value = field(stage === 'personality' ? 'Personality' : 'Name', text, stage === 'personality' ? 8000 : 80);
      const nextStage = stage === 'assistantName' ? 'personality' : stage === 'personality' ? 'userName' : 'complete';
      const reply = questions[nextStage] || `Nice to meet you, ${value}. I'm ${state.assistantName}. You can change our names and my personality in Personality settings anytime. How can I help?`;
      persist({...state, [stage]:value, stage:nextStage, revision:state.revision + 1,
        messages:[...this.messages(), {role:'user', text:value, at:Date.now()}, {role:'assistant', text:reply, at:Date.now()}]});
      return reply;
    },
    update(payload) {
      checkRevision(payload.revision);
      const assistantName = field('Assistant name', payload.assistantName, 80);
      const personality = field('Personality', payload.personality, 8000);
      const userName = field('Your name', payload.userName, 80);
      persist({...state, assistantName, personality, userName, stage:'complete', revision:state.revision + 1});
      return view();
    },
    resetTranscript() { persist({...state, messages:[]}); },
    prompt() {
      return `Your name is ${state.assistantName}. The user's preferred name is ${state.userName || 'not yet provided'}.\n\n${state.personality}`;
    },
  };
}
