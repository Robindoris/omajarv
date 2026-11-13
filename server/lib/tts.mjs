// Local text-to-speech through Piper. One process per utterance: piper loads
// its voice in ~200ms, which is invisible next to model generation and keeps
// the bridge free of a second long-lived daemon.

import fs from "node:fs";
import { piperPath } from "./models.mjs";
import path from "node:path";
import { boundedExec } from "./bounded-process.mjs";
import crypto from "node:crypto";
import { paths } from "./config.mjs";
import { findBin } from "./stt.mjs";

const MAX_WAV = 16 * 1024 * 1024;
let synthesisBusy = false;
let piperBin = null;
let piperFlavor = ""; // "dash" (-f/--length-scale) or "under" (--output_file/--length_scale)

export function voiceModelPath(voice) {
  return path.join(paths.piperVoices, `${voice}.onnx`);
}

export function ttsStatus(config) {
  const model = piperPath(config, paths.piperVoices);
  const bin = findBin("piper", "piper-tts", "piper_exe");
  return {
    ready: Boolean(bin) && fs.existsSync(model),
    voice: config.tts.voice,
    engine: bin ? "piper" : "missing",
    modelPath: fs.existsSync(model) ? model : null,
  };
}

async function detectFlavor(bin) {
  if (piperFlavor && piperBin === bin) return piperFlavor;
  const {stdout, stderr} = await boundedExec(bin, ["--help"], {timeout:4000, maxBuffer:64*1024});
  piperFlavor = /--output_file|--length_scale/.test(stdout + stderr) ? "under" : "dash";
  piperBin = bin;
  return piperFlavor;
}

export function cleanForSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[*_#>|]+/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

export async function synthesize(text, config, options = {}) {
  if (synthesisBusy) throw new Error("Speech synthesis is busy. Try again shortly.");
  synthesisBusy = true;
  try { return await synthesizeOne(text, config, options); }
  finally { synthesisBusy = false; }
}

async function synthesizeOne(text, config, options) {
  const spoken = cleanForSpeech(options.text ?? text);
  if (!spoken) throw new Error("Nothing to speak");

  const bin = piperBin || findBin("piper", "piper-tts", "piper_exe");
  if (!bin) throw new Error("piper is not installed");
  const voice = options.voice || config.tts.voice;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(voice) || voice.includes("..")) throw new Error("Invalid voice name");
  const model = options.voice && options.voice !== config.tts.voice ? voiceModelPath(voice) : piperPath(config, paths.piperVoices);
  if (!fs.existsSync(model)) throw new Error(`piper voice ${voice} is not downloaded`);

  await detectFlavor(bin);

  const speed = Number(options.speed || config.tts.speed || 1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error("Speech speed must be between 0.5 and 2");
  const outPath = path.join(paths.tmp, `tts-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.wav`);

  const base = ["-m", model, "-f", outPath];
  if (fixtureConfigExists(model)) base.push("-c", `${model}.json`);
  if (Math.abs(speed - 1) > 0.02) base.push("--length-scale", (1 / speed).toFixed(2));

  try {
    await runPiper(bin, base, spoken, outPath);
    // Never allocate from an untrusted reported size; read a bounded snapshot.
    const fd = fs.openSync(outPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let wav;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_WAV) throw new Error("Piper audio exceeds size limit");
      const buffer = Buffer.alloc(MAX_WAV + 1);
      let size = 0, count;
      while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length - size, null))) size += count;
      if (size > MAX_WAV) throw new Error("Piper audio exceeds size limit");
      wav = buffer.subarray(0, size);
    } finally { fs.closeSync(fd); }
    if (wav.length < 44) throw new Error("piper produced no audio");
    return wav;
  } finally {
    fs.rmSync(outPath, { force: true });
  }
}

function fixtureConfigExists(model) {
  return fs.existsSync(`${model}.json`);
}

async function runPiper(bin, args, text, outPath) {
  const attempt = async finalArgs => {
    await boundedExec(bin, finalArgs, {input:text + "\n", timeout:30000,
      maxBuffer:64*1024, fileSizeLimit:MAX_WAV});
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size <= 44) throw new Error("Piper produced no audio");
  };
  // Prefer the detected flag spelling; a limit/deadline failure is never retried.
  const under = args.map(arg => arg === "-f" ? "--output_file" : arg === "--length-scale" ? "--length_scale" : arg);
  return attempt(piperFlavor === "under" ? under : args).catch(error => {
    if (piperFlavor !== "dash" || !Number.isInteger(error.code)) throw error;
    fs.rmSync(outPath, {force:true});
    piperFlavor = "under";
    return attempt(under);
  });
}
