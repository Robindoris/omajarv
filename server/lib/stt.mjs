// Local speech-to-text through whisper.cpp CLI.
// HTTP listeners on loopback are not trusted with recordings.

import fs from "node:fs";
import { whisperPath, usable } from "./models.mjs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { paths } from "./config.mjs";

function speechError(message,sttCode,status=500){return Object.assign(new Error(message),{safeToDisplay:true,sttCode,status});}

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
  const hasModel = usable(model);
  const cli = Boolean(findBin("whisper-cli", "whisper-cpp", "main"));
  return {
    ready: hasModel && cli && Boolean(findBin("ffmpeg")),
    model: config.stt.model,
    engine: cli ? "whisper-cli" : "missing",
    modelPath: hasModel ? model : null,
  };
}

// Unauthenticated loopback HTTP cannot establish ownership of a speech server.
// Use the CLI pipe/process boundary until an authenticated server transport exists.
export async function ensureWhisperServer() { return false; }
export function stopWhisperServer() {}

// ffmpeg normalises whatever the browser recorded (Opus in WebM, AAC in MP4,
// Ogg, plain WAV) to the single format whisper.cpp accepts.
export function toWav16k(inputPath, outputPath) {
  const ffmpeg = findBin("ffmpeg");
  if (!ffmpeg) throw speechError("FFmpeg is missing. Install FFmpeg to convert microphone recordings.","converter_missing",503);
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "pipe", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath], {
    encoding: "utf8", input: fs.readFileSync(inputPath), timeout:120000,
  });
  if(result.error?.code==='ETIMEDOUT')throw speechError('Audio conversion timed out. Try a shorter recording.','conversion_timeout',504);
  if (result.status !== 0) throw speechError('Audio conversion failed. Try recording again or use a different browser audio format.','conversion_failed',422);
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
  // Encoded size is not duration: valid quiet Opus clips can be only a few hundred bytes.
  if (!buffer || !buffer.length) throw speechError('Recording was empty. Record again and hold the microphone button longer.','recording_empty',400);

  const base = path.join(paths.tmp, `stt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const inputPath = `${base}.in.${EXT_BY_TYPE[type] || "bin"}`;
  const wavPath = `${base}.16k.wav`;
  fs.writeFileSync(inputPath, buffer, { mode: 0o600 });

  try {
    toWav16k(inputPath, wavPath);
    const text = transcribeViaCli(wavPath, config);
    return { text: cleanTranscript(text), ms: Date.now() - started };
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(wavPath, { force: true });
  }
}

function transcribeViaCli(wavPath, config) {
  const bin = findBin("whisper-cli", "whisper-cpp", "main");
  if (!bin) throw speechError("Whisper is missing. Install the local Whisper CLI in voice setup.","recognizer_missing",503);
  const model = whisperPath(config, paths.whisperModels);
  if (!usable(model)) throw speechError("The Whisper model is missing or empty. Select an installed model in voice settings.","model_missing",503);
  const args = ["-m", model, "-f", wavPath, "-nt", "-np", "-t", "6"];
  if (config.stt.language && config.stt.language !== "auto") args.push("-l", config.stt.language);
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if(result.error?.code==='ETIMEDOUT')throw speechError('Local speech recognition timed out. Try a shorter recording or a smaller Whisper model.','recognition_timeout',504);
  if (result.status !== 0) throw speechError('Local speech recognition failed. Check the selected Whisper model and installation.','recognition_failed');
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
