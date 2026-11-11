// Model listing and selection for agents that expose one.
//
// OpenCode prints `opencode models` as "provider/model" lines; ids ending in
// "-free" need no paid provider key, so they are listed first. Hermes manages
// its own default model interactively (hermes model); the bridge does not
// override it, but the panel still shows where to choose. The listing holds
// only model identifiers, never credentials.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { privateError } from "./privacy.mjs";

const run = promisify(execFile);

const LOOKUP_AGENT_IDS = { opencode: true, hermes: true };
const REFRESH_MS = 15 * 60 * 1000;
const MAX_MODELS = 300;
const CLI_TIMEOUT_MS = 30000;

let cache = { at: 0, models: [] };

export function modelSelectable(agentId) {
  return LOOKUP_AGENT_IDS[agentId] === true;
}

function freeModel(id) {
  return String(id || "").endsWith("-free");
}

function parseModels(out) {
  const seen = new Set();
  for (const line of String(out || "").split("\n")) {
    const id = line.trim();
    if (!id || id.includes(" ") || !id.includes("/")) continue;
    if (seen.size >= MAX_MODELS) break;
    seen.add(id);
  }
  const list = [...seen];
  list.sort((a, b) => {
    if (freeModel(a) !== freeModel(b)) return freeModel(a) ? -1 : 1;
    return a.localeCompare(b);
  });
  return list;
}

async function opencodeModelIds() {
  if (cache.models.length && Date.now() - cache.at < REFRESH_MS) return cache.models;
  const { stdout } = await run("opencode", ["models"], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb" },
  });
  const models = parseModels(stdout);
  if (!models.length) throw privateError("OpenCode reported no models. Check its provider setup.");
  cache = { at: Date.now(), models };
  return models;
}

function decorate(agentId, models, selected) {
  return models.map((id) => ({
    id,
    free: freeModel(id),
    selected: id === selected,
  }));
}

export async function listModels(agentId, config) {
  if (!modelSelectable(agentId)) {
    return { ok: true, agent: agentId, listed: false, models: [], note: "" };
  }
  if (agentId === "hermes") {
    return {
      ok: true,
      agent: agentId,
      listed: false,
      models: [],
      note: "Hermes picks its own default model. Run 'hermes model' in a terminal to change it.",
    };
  }
  try {
    const ids = await opencodeModelIds();
    const selected = (config.agentModels && config.agentModels[agentId]) || "";
    return { ok: true, agent: agentId, listed: true, models: decorate(agentId, ids, selected), note: "" };
  } catch (error) {
    return {
      ok: true,
      agent: agentId,
      listed: false,
      models: [],
      note: typeof error?.message === "string" && error?.safeToDisplay === true ? error.message : "Could not list this agent's models. Check its provider setup in a terminal.",
    };
  }
}

export async function modelAvailable(agentId, config, model) {
  const ids = await opencodeModelIds();
  return ids.includes(model);
}

// Discover a free hosted model; never silently use a paid provider default.
export async function freeOpenCodeModel() {
  let ids;
  try { ids = await opencodeModelIds(); }
  catch { throw privateError('Could not discover a free OpenCode model. Install OpenCode and check its model catalog in a terminal.'); }
  const model = ids.find(id => id.startsWith('opencode/') && freeModel(id));
  if (!model) throw privateError('OpenCode has no free model available. Configure a provider or choose another agent.');
  return model;
}
