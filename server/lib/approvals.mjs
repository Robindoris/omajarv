// Pending agent permission requests surfaced to every authenticated device.
// Outcomes keep explicit user decisions distinct from timeouts, undelivered
// prompts and agent-side cancellation; nothing is ever auto-decided here.
import { randomUUID } from 'node:crypto';

const ALLOW_KINDS = new Set(['allow_once', 'allow_always']);

export function createApprovalBroker({ now = Date.now, timeoutMs = 120000, max = 4, historyLimit = 50 } = {}) {
  const pending = new Map();
  const history = [];
  const view = e => ({
    id: e.id, source: e.source, task: e.task, summary: e.summary, detail: e.detail,
    paths: e.paths, options: e.options, createdAt: e.createdAt, expiresAt: e.expiresAt, deliveredAt: e.deliveredAt,
  });
  const record = (e, outcome, extra = {}) => {
    history.unshift({ ...view(e), outcome, decidedAt: now(), ...extra });
    if (history.length > historyLimit) history.length = historyLimit;
  };
  const settle = (e, outcome, option = null) => {
    if (pending.get(e.id) !== e) return false;
    pending.delete(e.id);
    clearTimeout(e.timer);
    const delivered = e.deliveredAt !== null;
    const final = outcome === 'expired' ? (delivered ? 'expired' : 'expired-undelivered') : outcome;
    record(e, final);
    e.resolve(option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' });
    return true;
  };
  return {
    // Resolves with the ACP response outcome for the agent; never fabricates a selection.
    request({ source, task = null, sessionId = null, toolCall = null, options = [] }) {
      const id = randomUUID();
      const createdAt = now();
      const allow = (Array.isArray(options) ? options : [])
        .filter(o => o && typeof o.optionId === 'string' && ALLOW_KINDS.has(o.kind)).slice(0, 3);
      const raw = toolCall && typeof toolCall === 'object' ? toolCall : {};
      const summary = String(raw.title || raw.name || 'Agent action').slice(0, 300);
      const detail = [String(raw.kind || ''), String(typeof raw.rawInput === 'object' && raw.rawInput ? (raw.rawInput.command || '') : '').slice(0, 400)].filter(Boolean).join(' · ').slice(0, 700);
      const paths = (Array.isArray(raw.locations) ? raw.locations : [])
        .map(l => String(l?.path || '')).filter(Boolean).slice(0, 3);
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const entry = {
        id, source, task: task ? { id: String(task.id), title: String(task.title).slice(0, 200) } : null,
        sessionId: sessionId ? String(sessionId).slice(0, 200) : null, summary, detail, paths,
        options: allow.map(o => ({ optionId: o.optionId, name: String(o.name || o.kind).slice(0, 120), kind: o.kind })),
        createdAt, expiresAt: createdAt + timeoutMs, deliveredAt: null, resolve, timer: null,
      };
      if (!allow.length) {
        // The agent offered nothing approvable: report the limitation, do not prompt.
        record(entry, 'unsupported');
        resolve({ outcome: 'cancelled' });
        return promise;
      }
      if (pending.size >= max) {
        record(entry, 'overflow');
        resolve({ outcome: 'cancelled' });
        return promise;
      }
      entry.timer = setTimeout(() => settle(entry, 'expired'), timeoutMs);
      pending.set(id, entry);
      return promise;
    },
    // A successful read means at least one authenticated client received the prompt.
    list() {
      const value = now();
      for (const e of pending.values()) if (e.deliveredAt === null) e.deliveredAt = value;
      return { requests: [...pending.values()].map(view), history: history.map(e => ({ ...e })) };
    },
    peek() { return pending.size; },
    reply(input) {
      const id = String(input?.id || '');
      const entry = pending.get(id);
      if (!entry) {
        const prior = history.find(h => h.id === id);
        if (prior) return { ok: false, status: 409, outcome: prior.outcome, error: 'Already answered or expired. Refresh to see the final state.' };
        return { ok: false, status: 404, error: 'Approval request not found.' };
      }
      if (input.decision === 'approve') {
        const option = entry.options.find(o => o.optionId === input.optionId)
          || entry.options.find(o => o.kind === 'allow_once') || entry.options[0];
        settle(entry, 'approved', option);
        return { ok: true };
      }
      if (input.decision === 'reject') { settle(entry, 'rejected'); return { ok: true }; }
      return { ok: false, status: 400, error: 'Decision must be approve or reject.' };
    },
    // Abandoned by the agent turn/session: distinct from any user decision.
    cancel({ source = null, reason = 'cancelled-agent' } = {}) {
      for (const e of [...pending.values()]) if (!source || e.source === source) settle(e, reason);
    },
  };
}
