// Cloudflare Quick Tunnel: gives the bridge a real, publicly trusted HTTPS URL
// (no certificate warning on the phone) without opening a router port.
//
// Quick tunnels are account-less and get a NEW random hostname every time the
// process starts — which is exactly what we want here: the QR code is tied to
// the life of this run, and a restart rotates the address.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.mjs";
import { findBin } from "./stt.mjs";

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const MAX_RESTARTS = 20;

let child = null;
let currentUrl = "";
let state = "off"; // off | starting | up | error
let lastError = "";
let restarts = 0;
let monitor = null;
let stopped = false;
let configRef = null;
const urlFile = path.join(paths.stateDir, "tunnel-url");

export function tunnelStatus() {
  return {
    enabled: Boolean(configRef?.tunnel?.enabled),
    provider: "cloudflare",
    state,
    url: currentUrl,
    restarts,
    error: lastError,
    binary: Boolean(findBin("cloudflared")),
  };
}

export function startTunnel(config) {
  configRef = config;
  const enabled = config.tunnel?.enabled === true;
  if (!enabled) {
    state = "off";
    return;
  }
  if (!findBin("cloudflared")) {
    state = "error";
    lastError = "cloudflared is not installed";
    return;
  }
  if (child) return;
  stopped = false;
  launch();
}

function launch() {
  if (stopped) return;
  state = "starting";
  currentUrl = "";
  lastError = "";
  clearUrlFile();

  const port = configRef.port;
  const args = [
    "tunnel",
    "--url",
    `https://localhost:${port}`,
    // The origin is our own self-signed certificate on loopback; the tunnel
    // still terminates public TLS with a valid Cloudflare certificate.
    "--no-tls-verify",
    "--no-autoupdate",
  ];

  child = spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"] });

  const consume = (chunk) => {
    const text = chunk.toString();
    const match = text.match(URL_PATTERN);
    if (match && match[0] !== currentUrl) {
      currentUrl = match[0];
      state = "up";
      writeUrlFile(currentUrl);
      console.log(new Date().toISOString(), "tunnel up:", currentUrl);
    }
    if (/ERR|failed to|error/i.test(text) && !currentUrl) lastError = text.trim().slice(-300);
  };

  child.stdout.on("data", consume);
  child.stderr.on("data", consume);

  child.on("error", (error) => {
    lastError = error.message;
    state = "error";
    scheduleRestart();
  });

  child.on("exit", () => {
    if (child === null) return;
    child = null;
    if (stopped) return;
    state = "error";
    currentUrl = "";
    clearUrlFile();
    console.log(new Date().toISOString(), "tunnel dropped; restarting with a new address");
    scheduleRestart();
  });

  // Cloudflare takes a few seconds to hand out a hostname.
  if (monitor) clearTimeout(monitor);
  monitor = setTimeout(() => {
    if (!currentUrl && state === "starting") {
      lastError = "no hostname after 45s";
      try {
        child?.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }, 45000);
}

function scheduleRestart() {
  if (stopped) return;
  if (restarts >= MAX_RESTARTS) {
    state = "error";
    lastError = `gave up after ${MAX_RESTARTS} restarts`;
    return;
  }
  restarts += 1;
  setTimeout(launch, Math.min(30000, 4000 * restarts));
}

export function stopTunnel() {
  stopped = true;
  if (monitor) clearTimeout(monitor);
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
    child = null;
  }
  state = "off";
  currentUrl = "";
  clearUrlFile();
}

function writeUrlFile(url) {
  try {
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.writeFileSync(urlFile, url + "\n", { mode: 0o600 });
  } catch {
    // A missing cache file only costs us the CLI shortcut.
  }
}

function clearUrlFile() {
  try {
    fs.rmSync(urlFile, { force: true });
  } catch {
    // ignore
  }
}
