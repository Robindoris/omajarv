// Agent bridge: turns "codex"/"opencode"/"claude"/... into one normalized
// JSONL stream of text deltas for the browser.
//
// The agent is whatever Omarchy considers the default coding agent, unless the
// user pins one in ~/.config/omarchy-jarvis/config.json.

import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { paths, readSessions, writeSessions, resolveAgent } from "./config.mjs";

const LABELS = {
  codex: "Codex",
  opencode: "OpenCode",
  claude: "Claude Code",
  gemini: "Gemini",
  grok: "Grok",
  copilot: "GitHub Copilot",
  crush: "Crush",
  omp: "Oh My Pi",
  pi: "Pi",
  muse: "Muse Code",
  hermes: "Hermes",
  openclaw: "OpenClaw",
  "cursor-agent": "Cursor CLI",
};

export function agentLabel(id) {
  return LABELS[id] || id;
}

function binPresent(bin) {
  const dirs = String(process.env.PATH || "").split(path.delimiter);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function agentStatus(config) {
  const id = resolveAgent(config);
  return { id, label: agentLabel(id), ready: ["codex", "claude"].includes(id) && binPresent(id) };
}

function buildPrompt(text, config) {
  const prompt = String(text || "").trim();
  return `${config.systemPrompt}\n\nSpoken user request: ${prompt}`;
}

// Each supported adapter passes the prompt on stdin and returns a
// parser that maps one agent JSON event onto zero or more text deltas.
function adapter(id, { prompt, session, config }) {
  const cwd = config.workDir || paths.root;

  switch (id) {
    case "codex": {
      const accessArgs = config.codexFullAccess === true
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["--approve-for-me"];
      const base = session
        ? ["exec", "resume", "--json", "--skip-git-repo-check", ...accessArgs, session, "-"]
        : ["exec", "--json", "--skip-git-repo-check", ...accessArgs, "-"];
      return {
        cmd: "codex",
        args: base,
        cwd,
        stdin: prompt,
        parse: (event, emit, setSession) => {
          if (event.type === "thread.started" && event.thread_id) setSession(event.thread_id);
          if (event.type === "item.completed" || event.type === "item.updated") {
            const item = event.item || {};
            if (item.type === "agent_message" && typeof item.text === "string") emit(item.text);
          }
        },
        finalText: (state) => state.text,
      };
    }

    case "claude": {
      const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "auto"];
      if (session) args.push("--resume", session);
      return {
        cmd: "claude",
        args,
        cwd,
        stdin: prompt,
        parse: (event, emit, setSession) => {
          if (event.session_id) setSession(event.session_id);
          if (event.type === "stream_event") {
            const delta = event.event?.delta;
            if (event.event?.type === "content_block_delta" && delta?.type === "text_delta") emit(delta.text);
          } else if (event.type === "assistant" && Array.isArray(event.message?.content)) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) emit(block.text);
            }
          }
        },
      };
    }

    default:
      throw new Error(`${agentLabel(id)} is disabled: a private stdin transport has not been verified. Select Codex or Claude.`);
  }
}

// Run one turn. `onText` receives incremental text; the promise resolves with
// the full reply plus the adapter's session id (for --resume next turn).
export function runAgent({ config, text, sessionId, signal, onText }) {
  const id = resolveAgent(config);
  const prompt = buildPrompt(text, config);
  const spec = adapter(id, { prompt, session: sessionId, config });

  return new Promise((resolve, reject) => {
    const child = spawn(spec.cmd, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    let session = sessionId || "";
    let text_out = "";
    let raw = "";
    let stderr = "";
    let settled = false;
    let emittedPerSource = new Map();

    const timer = setTimeout(() => {
      fail(new Error(`${agentLabel(id)} timed out`));
    }, 240000);

    function emit(chunk) {
      if (!chunk) return;
      text_out += chunk;
      onText?.(chunk);
    }

    // Some CLIs repeat the whole message on each event; only forward the part
    // we have not seen yet, keyed by the message/part id when one is present.
    function emitCumulative(key, full) {
      const previous = emittedPerSource.get(key) || "";
      if (full === previous) return;
      if (full.startsWith(previous)) emit(full.slice(previous.length));
      else emit(full);
      emittedPerSource.set(key, full);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      reject(error);
    }

    function done(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !text_out) {
        reject(new Error(stderr.trim().slice(-400) || `${agentLabel(id)} exited with code ${code}`));
        return;
      }
      if (spec.finalText && !text_out) {
        const final = spec.finalText({ text: text_out }, raw);
        if (final) emit(final);
      }
      resolve({ text: text_out.trim(), session, agent: id, label: agentLabel(id) });
    }

    if (spec.stdin !== null) child.stdin.end(spec.stdin);
    else child.stdin.end();

    const onLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      raw += trimmed + "\n";
      if (spec.textOut || !spec.parse) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      try {
        spec.parse(event, (chunk) => {
          const key = event.item?.id || event.part?.id || event.message?.id || event.sessionID || "default";
          emitCumulative(key, chunk);
          session = event.session_id || event.thread_id || event.sessionID || session;
        }, (value) => {
          if (value) session = value;
        });
      } catch {
        // A malformed event must not take the whole turn down.
      }
    };

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", onLine);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });

    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (spec.textOut && !text_out) {
        const out = raw.trim();
        if (out) emit(out);
      }
      done(code ?? 0);
    });

    if (signal) {
      const onAbort = () => fail(new Error("Cancelled"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function killTree(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }, 2500).unref?.();
}

export function rememberedSession(agentId) {
  return readSessions()[agentId] || "";
}

export function rememberSession(agentId, session) {
  if (!session) return;
  const sessions = readSessions();
  sessions[agentId] = session;
  writeSessions(sessions);
}

export function forgetSessions() {
  writeSessions({});
}
