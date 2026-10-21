// Central configuration + filesystem layout for the JARVIS bridge.
// Everything the server needs to know about the machine lives here so the
// rest of the code can stay free of path juggling.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const HOME = os.homedir();
export const ROOT = path.resolve(import.meta.dirname, "..");
export const VERSION = "1.0.0";

export const paths = {
  root: ROOT,
  public: path.join(ROOT, "public"),
  configDir: path.join(HOME, ".config", "omarchy-jarvis"),
  stateDir: path.join(HOME, ".local", "state", "omarchy-jarvis"),
  dataDir: path.join(HOME, ".local", "share", "omarchy-jarvis"),
  models: path.join(HOME, ".local", "share", "omarchy-jarvis", "models"),
  whisperModels: path.join(HOME, ".local", "share", "omarchy-jarvis", "models", "whisper"),
  piperVoices: path.join(HOME, ".local", "share", "omarchy-jarvis", "models", "piper"),
  tmp: path.join(HOME, ".local", "state", "omarchy-jarvis", "tmp"),
  configFile: path.join(HOME, ".config", "omarchy-jarvis", "config.json"),
  tokenFile: path.join(HOME, ".local", "state", "omarchy-jarvis", "token"),
  certFile: path.join(HOME, ".local", "state", "omarchy-jarvis", "cert.pem"),
  keyFile: path.join(HOME, ".local", "state", "omarchy-jarvis", "key.pem"),
  sessionsFile: path.join(HOME, ".local", "state", "omarchy-jarvis", "sessions.json"),
  logFile: path.join(HOME, ".local", "state", "omarchy-jarvis", "server.log"),
  omarchyAgentFile: path.join(HOME, ".config", "omarchy", "defaults", "agent"),
};

export const defaults = {
  port: 4317,
  host: "127.0.0.1",
  // "" means "ask Omarchy" (omarchy-default-agent), so JARVIS always follows
  // whatever agent the user picked in the Omarchy menu.
  agent: "",
  // Opt in to unrestricted Codex commands under the current Linux user.
  codexFullAccess: false,
  agentFullAccess: false,
  workDir: path.join(HOME, ".local", "share", "omarchy-jarvis", "workspace"),
  systemPrompt:
    "You are JARVIS, a calm, precise British voice assistant running locally on the user's Omarchy Linux machine. " +
    "Your answer is spoken aloud by a text-to-speech engine, so reply in plain prose of at most four short sentences. " +
    "Never use markdown, bullet points, emoji, code fences, or stage directions. " +
    "If a request needs more detail than that, answer the essential part and offer to go deeper.",
  maxRecordingSec: 120,
  maxTextChars: 4000,
  // "tunnel" puts the public Cloudflare Quick Tunnel URL in the QR code,
  // "lan" keeps it on the home network only.
  qrTarget: "lan",
  tunnel: {
    enabled: false,
  },
  stt: {
    engine: "auto", // auto | server | cli
    model: "base.en",
    modelPath: "",
    language: "en",
    serverPort: 8178,
  },
  tts: {
    voice: "en_US-ljspeech-medium",
    modelPath: "",
    speed: 1.0,
  },
  agentArgs: {},
};

function deepMerge(base, extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) && base && typeof base[key] === "object"
        ? deepMerge(base[key], value)
        : value;
  }
  return out;
}

export function ensureDirs() {
  for (const dir of [paths.configDir, paths.stateDir, paths.dataDir, paths.models, paths.whisperModels, paths.piperVoices, paths.tmp, defaults.workDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }
}

export function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(paths.configFile, "utf8"));
  } catch {
    // No config yet: defaults are the config.
  }
  const config = deepMerge(defaults, user);
  if (!fs.existsSync(path.join(config.workDir.replace(/^~/, HOME)))) config.workDir = HOME;
  return config;
}

export function writeDefaultConfig(force = false) {
  ensureDirs();
  if (fs.existsSync(paths.configFile) && !force) return false;
  fs.writeFileSync(paths.configFile, JSON.stringify(defaults, null, 2) + "\n", { mode: 0o600 });
  return true;
}

export function readToken() {
  try {
    const token = fs.readFileSync(paths.tokenFile, "utf8").trim();
    if (token) { fs.chmodSync(paths.tokenFile, 0o600); return token; }
  } catch {
    // fall through and mint one
  }
  return rotateToken();
}

export function rotateToken() {
  ensureDirs();
  const token = crypto.randomBytes(16).toString("base64url");
  fs.writeFileSync(paths.tokenFile, token + "\n", { mode: 0o600 });
  return token;
}

export function readSessions() {
  try {
    return JSON.parse(fs.readFileSync(paths.sessionsFile, "utf8"));
  } catch {
    return {};
  }
}

export function writeSessions(sessions) {
  ensureDirs();
  fs.writeFileSync(paths.sessionsFile, JSON.stringify(sessions, null, 2) + "\n", { mode: 0o600 });
}

// The Omarchy default coding agent, e.g. "codex". Empty when the user has
// never picked one.
export function omarchyDefaultAgent() {
  try {
    return fs.readFileSync(paths.omarchyAgentFile, "utf8").trim();
  } catch {
    return "";
  }
}

export function resolveAgent(config) {
  return (config.agent || omarchyDefaultAgent() || "codex").trim();
}
