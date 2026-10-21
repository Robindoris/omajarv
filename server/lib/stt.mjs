// Local speech-to-text through whisper.cpp.
//
// Preferred path: a long-lived `whisper-server` child process, so the model is
// loaded once and a push-to-talk utterance costs an inference instead of a
// process start. If that binary is unavailable we fall back to `whisper-cli`,
// which still works, just slower.

import fs from "node:fs";
import { whisperPath } from "./models.mjs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { paths } from "./config.mjs";

let serverChild = null;
let serverPort = 0;
let serverReady = false;
let serverStarting = null;

export function whisperModelPath(model) {
  return path.join(paths.whisperModels, `ggml-${model}.bin`);
}

export function findBin(...names) {
  for (const name of names) {
    const result = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
    if (result.status === 0) return result.stdout.trim();
  }
  return "";
}

export function sttStatus(config) {
  const model = whisperPath(config, paths.whisperModels);
  const hasModel = fs.existsSync(model);
  const server = Boolean(findBin("whisper-server"));
  const cli = Boolean(findBin("whisper-cli", "whisper-cpp", "main"));
  return {
    ready: hasModel && (server || cli),
    model: config.stt.model,
    engine: server && config.stt.engine !== "cli" ? "whisper-server" : cli ? "whisper-cli" : "missing",
    modelPath: hasModel ? model : null,
  };
}

// Start the inference daemon. Safe to call repeatedly; concurrent callers share
// the same in-flight promise. whisper.cpp prints nothing reliable about its
// listening socket, so readiness is probed over HTTP.
export function ensureWhisperServer(config) {
  if (serverReady) return Promise.resolve(true);
  if (serverStarting) return serverStarting;
  if (config.stt.engine === "cli") return Promise.resolve(false);

  const bin = findBin("whisper-server");
  const model = whisperPath(config, paths.whisperModels);
  if (!bin || !fs.existsSync(model)) return Promise.resolve(false);

  const port = config.stt.serverPort;
  serverPort = port;

  serverStarting = (async () => {
    // Another instance (a manual run, or a stale unit) may already own the port.
    if (await portAlive(port)) {
      serverReady = true;
      return true;
    }

    const child = spawn(
      bin,
      ["-m", model, "--host", "127.0.0.1", "--port", String(port), "-t", "4", "--convert"],
      // whisper.cpp drops converted audio in its working directory; keep that
      // in our own tmp folder instead of the project root.
      { cwd: paths.tmp, stdio: ["ignore", "ignore", "ignore"] },
    );
    serverChild = child;
    child.on("exit", () => {
      if (serverChild === child) serverChild = null;
      serverReady = false;
    });

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await portAlive(port)) {
        serverReady = true;
        return true;
      }
      if (!serverChild) return false;
      await sleep(250);
    }
    return false;
  })().finally(() => {
    serverStarting = null;
  });

  return serverStarting;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function portAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    return res.status < 500;
  } catch {
    return false;
  }
}

// Short wait used inside a request: if the daemon is still warming up we would
// rather run whisper-cli now than make the user stare at a spinner for 20s.
async function waitForServer(ms) {
  if (serverReady) return true;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (serverReady) return true;
    await sleep(150);
  }
  return serverReady;
}

export function stopWhisperServer() {
  if (serverChild) {
    serverChild.kill("SIGTERM");
    serverChild = null;
  }
  serverReady = false;
}

// ffmpeg normalises whatever the browser recorded (Opus in WebM, AAC in MP4,
// Ogg, plain WAV) to the single format whisper.cpp accepts.
export function toWav16k(inputPath, outputPath) {
  const ffmpeg = findBin("ffmpeg");
  if (!ffmpeg) throw new Error("ffmpeg is required to convert recordings");
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${(result.stderr || "").trim().slice(0, 300)}`);
  return outputPath;
}

const EXT_BY_TYPE = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
};

export async function transcribe(buffer, contentType, config) {
  const started = Date.now();
  if (!buffer || buffer.length < 1200) throw new Error("Recording was empty");

  const base = path.join(paths.tmp, `stt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const inputPath = `${base}.in.${EXT_BY_TYPE[type] || "bin"}`;
  const wavPath = `${base}.16k.wav`;
  fs.writeFileSync(inputPath, buffer, { mode: 0o600 });

  try {
    toWav16k(inputPath, wavPath);
    if (!serverReady && config.stt.engine !== "cli") ensureWhisperServer(config).catch(() => {});
    const useServer = await waitForServer(4000);
    const text = useServer ? await transcribeViaServer(wavPath, config) : transcribeViaCli(wavPath, config);
    return { text: cleanTranscript(text), ms: Date.now() - started };
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(wavPath, { force: true });
  }
}

async function transcribeViaServer(wavPath, config) {
  const form = new FormData();
  const bytes = fs.readFileSync(wavPath);
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
  form.append("response_format", "json");
  form.append("temperature", "0.0");
  if (config.stt.language && config.stt.language !== "auto") form.append("language", config.stt.language);

  const res = await fetch(`http://127.0.0.1:${serverPort}/inference`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`whisper-server returned ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data.text || "";
}

function transcribeViaCli(wavPath, config) {
  const bin = findBin("whisper-cli", "whisper-cpp", "main");
  if (!bin) throw new Error("whisper.cpp is not installed");
  const model = whisperPath(config, paths.whisperModels);
  if (!fs.existsSync(model)) throw new Error(`whisper model ${config.stt.model} is missing`);
  const args = ["-m", model, "-f", wavPath, "-nt", "-np", "-t", "6"];
  if (config.stt.language && config.stt.language !== "auto") args.push("-l", config.stt.language);
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`whisper-cli failed: ${(result.stderr || "").trim().slice(0, 300)}`);
  return result.stdout || "";
}

// Whisper likes to hallucinate bracketed sound descriptions on silence.
export function cleanTranscript(text) {
  return String(text || "")
    .replace(/\[(?:BLANK_AUDIO|SILENCE|MUSIC|APPLAUSE|NOISE|INAUDIBLE)\]/gi, " ")
    .replace(/\((?:silence|blank audio|music)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
