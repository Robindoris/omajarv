// Central configuration + filesystem layout for the JARVIS bridge.
// Everything the server needs to know about the machine lives here so the
// rest of the code can stay free of path juggling.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { writePrivateFile } from './privacy.mjs';

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
  serveSocket: path.join(HOME, ".local", "state", "omarchy-jarvis", "serve.sock"),
  sessionsFile: path.join(HOME, ".local", "state", "omarchy-jarvis", "sessions.json"),
  logFile: path.join(HOME, ".local", "state", "omarchy-jarvis", "server.log"),
  omarchyAgentFile: process.env.JARVIS_OMARCHY_AGENT_FILE || path.join(HOME, ".config", "omarchy", "defaults", "agent"),
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
    "You are an Omarchy administrator. Never expose secrets. " +
    "Lightly mock users who ask for secrets, without revealing them. " +
    "Answer briefly and get straight to the point.",
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
  agentModels: {},
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
    fs.chmodSync(paths.configFile, 0o600);
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
  writePrivateFile(paths.configFile, JSON.stringify(defaults, null, 2) + "\n");
  return true;
}

// Persist a full (loaded) config object. Callers pass the same object the
// server keeps in memory so disk and runtime stay in step.
export function writeConfig(config) {
  ensureDirs();
  writePrivateFile(paths.configFile, JSON.stringify(config, null, 2) + "\n");
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
  writePrivateFile(paths.tokenFile, token + "\n");
  return token;
}

export function readSessions() {
  try {
    const sessions = JSON.parse(fs.readFileSync(paths.sessionsFile, "utf8"));
    fs.chmodSync(paths.sessionsFile, 0o600);
    return sessions;
  } catch {
    return {};
  }
}

export function writeSessions(sessions) {
  ensureDirs();
  writePrivateFile(paths.sessionsFile, JSON.stringify(sessions, null, 2) + "\n");
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
  return (config.agent || omarchyDefaultAgent() || "opencode").trim();
}
