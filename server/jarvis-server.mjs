#!/usr/bin/env node
// JARVIS LAN bridge.
//
// Serves the animated voice UI over HTTPS (microphone access needs a secure
// context, even on a home network), transcribes push-to-talk audio with local
// whisper.cpp, streams answers from the default Omarchy agent, and speaks the
// reply with local Piper.
//
//   node server/jarvis-server.mjs [--http] [--port N] [--verbose]

import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDirs, loadConfig, paths, readToken, VERSION } from "./lib/config.mjs";
import { hostname, lanAddresses, publicUrl, urlFor } from "./lib/net.mjs";
import { tailscaleStatus } from "./lib/tailscale.mjs";
import { startTunnel, stopTunnel, tunnelStatus } from "./lib/tunnel.mjs";
import { transcribe, sttStatus, stopWhisperServer, ensureWhisperServer } from "./lib/stt.mjs";
import { synthesize, ttsStatus } from "./lib/tts.mjs";
import { agentStatus, forgetSessions, rememberedSession, rememberSession, runAgent } from "./lib/agent.mjs";

import { historyFor, appendHistory, clearHistory } from "./lib/history.mjs";

import { readTheme, themeStyles } from "./lib/theme.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const verbose = flag("--verbose") || process.env.JARVIS_VERBOSE === "1";
const useHttp = flag("--http") || process.env.JARVIS_HTTP === "1";

ensureDirs();
const config = loadConfig();
if (option("--port")) config.port = Number(option("--port"));
const token = readToken();

const log = (...args) => console.log(new Date().toISOString(), ...args);
const debug = (...args) => verbose && log(...args);

// --------------------------------------------------------------------- TLS

function ensureCertificate() {
  if (fs.existsSync(paths.certFile) && fs.existsSync(paths.keyFile)) { fs.chmodSync(paths.keyFile, 0o600); return true; }
  const ips = ["127.0.0.1", ...lanAddresses().map((entry) => entry.address)];
  const san = ["DNS:localhost", `DNS:${hostname()}.local`, `DNS:${hostname()}`, ...ips.map((ip) => `IP:${ip}`)].join(",");
  const result = spawnSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", paths.keyFile,
      "-out", paths.certFile,
      "-days", "825",
      "-subj", "/CN=omarchy-jarvis",
      "-addext", `subjectAltName=${san}`,
      "-addext", "basicConstraints=critical,CA:FALSE",
      "-addext", "keyUsage=critical,digitalSignature,keyEncipherment",
      "-addext", "extendedKeyUsage=serverAuth",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    log("certificate generation failed:", (result.stderr || "").trim().slice(0, 300));
    return false;
  }
  fs.chmodSync(paths.keyFile, 0o600);
  log("generated self-signed certificate for", san);
  return true;
}

// ---------------------------------------------------------------- utilities

const MAX_JSON = 64 * 1024;
const MAX_AUDIO = 24 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\/+/, ""));
  const filePath = path.resolve(paths.public, relative);
  if (!filePath.startsWith(paths.public + path.sep) && filePath !== path.join(paths.public, "index.html")) {
    return sendJson(res, 403, { ok: false, error: "Forbidden" });
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return sendJson(res, 404, { ok: false, error: "Not found" });
  }
  if (!stat.isFile()) return sendJson(res, 404, { ok: false, error: "Not found" });

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=300",
  };
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function authorized(req, params) {
  const equal = value => typeof value === "string" && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  return equal(params.get("k")) || equal(req.headers["x-jarvis-token"]);
}

function publicLandingPage() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JARVIS</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#04070a;color:#6ff2ff;
font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;padding:24px">
<div><div style="letter-spacing:.4em;font-size:18px;margin-bottom:18px">J.A.R.V.I.S.</div>
<div style="color:#7d98a3;max-width:34ch">This endpoint needs its access link.
Open the QR code from the Omarchy bar, or run <b style="color:#6ff2ff">jarvis qr</b> on the machine.</div></div>
</body>`;
}

async function statusPayload() {
  const tailscale = await tailscaleStatus(config);
  const agent = agentStatus(config);
  const tunnel = tunnelStatus();
  return {
    ok: true,
    version: VERSION,
    host: lanAddresses()[0]?.address || "127.0.0.1",
    port: config.port,
    url: publicUrl(config, token, tunnel.url),
    lanUrl: ["127.0.0.1", "localhost", "::1"].includes(config.host) ? "" : urlFor(config, token),
    tunnelUrl: tunnel.state === "up" ? publicUrl({ ...config, qrTarget: "tunnel" }, token, tunnel.url) : "",
    qrTarget: (config.qrTarget || "tunnel") === "lan" || !tunnel.url ? "lan" : "tunnel",
    tunnel,
    tailscale,
    tailscaleUrl: tailscale.url ? `${tailscale.url}/?k=${encodeURIComponent(token)}` : "",
    agent: { ...agent, access: (agent.id === "codex" ? config.codexFullAccess : config.agentFullAccess) ? "Full access" : "Agent defaults" },
    chatBusy,
    stt: sttStatus(config),
    tts: ttsStatus(config),
    session: { id: rememberedSession(agent.id), turns: turnCount },
    limits: { maxRecordingSec: config.maxRecordingSec, maxTextChars: config.maxTextChars },
  };
}

let turnCount = 0;
let chatBusy = false;
let activeAbort = null;

// -------------------------------------------------------------------- routes

async function handleApi(req, res, pathname, params) {
  if (!authorized(req, params)) return sendJson(res, 401, { ok: false, error: "Bad or missing token" });

  if (pathname === "/api/health") return sendJson(res, 200, { ok: true });
  if (pathname === "/api/theme" && req.method === "GET") return sendJson(res, 200, readTheme());
  if (pathname === "/api/status") return sendJson(res, 200, await statusPayload());

  if (pathname === "/api/history" && req.method === "GET") {
    const agent = agentStatus(config);
    return sendJson(res, 200, { ok: true, agent: agent.id, messages: historyFor(agent.id), busy: chatBusy });
  }
  if (pathname === "/api/chat/stop" && req.method === "POST") {
    activeAbort?.abort();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/session/reset" && req.method === "POST") {
    if (chatBusy) return sendJson(res, 409, { ok: false, error: "Stop the current reply before starting a new conversation." });
    forgetSessions();
    clearHistory();
    turnCount = 0;
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/stt" && req.method === "POST") {
    try {
      const body = await readBody(req, MAX_AUDIO);
      const result = await transcribe(body, req.headers["content-type"], config);
      debug("stt", result.ms + "ms");
      if (!result.text) return sendJson(res, 200, { ok: false, error: "I did not catch that." , text: "", ms: result.ms });
      return sendJson(res, 200, { ok: true, text: result.text, ms: result.ms });
    } catch (error) {
      log("stt error:", error.message);
      return sendJson(res, 500, { ok: false, error: error.message });
    }
  }

  if (pathname === "/api/tts" && req.method === "POST") {
    try {
      const body = JSON.parse((await readBody(req, MAX_JSON)).toString() || "{}");
      const wav = await synthesize(body.text || "", config, { voice: body.voice, speed: body.speed });
      res.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": wav.length,
        "cache-control": "no-store",
      });
      return res.end(wav);
    } catch (error) {
      log("tts error:", error.message);
      return sendJson(res, 500, { ok: false, error: error.message });
    }
  }

  if (pathname === "/api/chat" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse((await readBody(req, MAX_JSON)).toString() || "{}");
    } catch {
      return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
    }
    const text = String(payload.text || "").trim().slice(0, config.maxTextChars);
    if (!text) return sendJson(res, 400, { ok: false, error: "Empty message" });
    if (chatBusy) return sendJson(res, 409, { ok: false, error: "JARVIS is still answering the previous request." });
    if (payload.reset) { forgetSessions(); clearHistory(); turnCount = 0; }
    chatBusy = true;

    const agent = agentStatus(config);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();

    const send = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const abort = new AbortController();
    activeAbort = abort;
    appendHistory(agent.id, "user", text);
    const heartbeat = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15000);
    // res 'close' means the phone navigated away or cancelled; a req 'close'
    // fires as soon as the body is read, which would abort every turn.
    res.on("close", () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) abort.abort();
    });

    abort.signal.addEventListener("abort", () => send("error", { error: "Stopped" }), { once: true });
    const started = Date.now();
    let reply = "";
    send("meta", { agent: agent.id, label: agent.label, session: rememberedSession(agent.id) });

    try {
      const result = await runAgent({
        config,
        text,
        sessionId: rememberedSession(agent.id),
        signal: abort.signal,
        onText: (chunk) => {
          reply += chunk;
          send("token", { text: chunk });
        },
      });
      if (abort.signal.aborted) throw new Error("Stopped");
      rememberSession(agent.id, result.session);
      appendHistory(agent.id, "assistant", reply.trim());
      turnCount += 1;
      send("done", { text: reply.trim(), ms: Date.now() - started, session: result.session, agent: result.agent });
    } catch (error) {
      log("chat error:", error.message);
      appendHistory(agent.id, "system", abort.signal.aborted ? "Stopped" : error.message);
      send("error", { error: error.message });
    } finally {
      clearInterval(heartbeat);
      activeAbort = null;
      chatBusy = false;
      if (!res.writableEnded) res.end();
    }
    return;
  }

  return sendJson(res, 404, { ok: false, error: "Unknown endpoint" });
}

async function handler(req, res) {
  let url;
  try { url = new URL(req.url, "https://jarvis.invalid"); }
  catch { return sendJson(res, 400, { ok: false, error: "Invalid request URL" }); }
  const pathname = url.pathname;

  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");

  try {
    if (pathname === "/theme.css" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
      return res.end(themeStyles());
    }
    if (pathname === "/manifest.webmanifest") {
      if (!authorized(req, url.searchParams)) return sendJson(res, 401, { error: "Access link required" });
      res.setHeader("content-type", "application/manifest+json");
      res.setHeader("cache-control", "no-store");
      return res.end(JSON.stringify({ id: "/", name: "J.A.R.V.I.S.", short_name: "JARVIS",
        start_url: `/?k=${encodeURIComponent(token)}`, scope: "/", display: "standalone",
        background_color: readTheme().palette.bg, theme_color: readTheme().palette.bg,
        icons: [192, 512].map(size => ({src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any"})) }));
    }
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname, url.searchParams);

    // Never distribute the bearer credential, including direct LAN and proxied requests.
    if (pathname === "/" && !authorized(req, url.searchParams)) {
      res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(publicLandingPage());
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return serveStatic(req, res, pathname);
  } catch (error) {
    log("request error:", error.message);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Internal error" });
    else res.end();
  }
}

// --------------------------------------------------------------------- boot

let server;
if (!useHttp) {
  if (!ensureCertificate()) throw new Error("HTTPS certificate setup failed; refusing to start without TLS");
  server = https.createServer(
    { cert: fs.readFileSync(paths.certFile), key: fs.readFileSync(paths.keyFile), minVersion: "TLSv1.2" },
    handler,
  );
} else {
  server = http.createServer(handler);
}

server.listen(config.port, config.host, () => {
  log(`JARVIS ${VERSION} listening on ${useHttp ? "http" : "https"}://${config.host}:${config.port}`);
  log("phone access: open the JARVIS Phone tab or run jarvis qr (access links are not logged)");
  const agent = agentStatus(config);
  log("agent:", agent.id, agent.ready ? "(ready)" : "(not installed!)");
  log("stt:", JSON.stringify(sttStatus(config)));
  log("tts:", JSON.stringify(ttsStatus(config)));
  if (config.tunnel?.enabled === true) {
    startTunnel(config);
    log("cloudflare quick tunnel: starting (the address rotates on every restart)");
  }
  // Warm the whisper daemon in the background so the first utterance is fast.
  if (sttStatus(config).engine === "whisper-server") {
    ensureWhisperServer(config).then((ok) => log("whisper-server:", ok ? "ready" : "failed to start"));
  }
});

server.on("error", (error) => {
  log("server error:", error.message);
  process.exitCode = 1;
});

const shutdown = (signal) => {
  log("shutting down:", signal);
  stopWhisperServer();
  stopTunnel();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
