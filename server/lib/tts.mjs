// Local text-to-speech through Piper. One process per utterance: piper loads
// its voice in ~200ms, which is invisible next to model generation and keeps
// the bridge free of a second long-lived daemon.

import fs from "node:fs";
import { piperPath } from "./models.mjs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { paths } from "./config.mjs";
import { findBin } from "./stt.mjs";

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

function detectFlavor(bin) {
  if (piperFlavor) return piperFlavor;
  return new Promise((resolve) => {
    const child = spawn(bin, ["--help"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      piperFlavor = "dash";
      resolve(piperFlavor);
    }, 4000);
    const collect = (chunk) => (out += chunk.toString());
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("close", () => {
      clearTimeout(timer);
      piperFlavor = /--output_file|--length_scale/.test(out) ? "under" : "dash";
      piperBin = bin;
      resolve(piperFlavor);
    });
  });
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
    const wav = fs.readFileSync(outPath);
    if (wav.length < 44) throw new Error("piper produced no audio");
    return wav;
  } finally {
    fs.rmSync(outPath, { force: true });
  }
}

function fixtureConfigExists(model) {
  return fs.existsSync(`${model}.json`);
}

function runPiper(bin, args, text, outPath) {
  const attempt = (finalArgs) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, finalArgs, { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 44) resolve();
        else reject(new Error(stderr.trim().slice(0, 300) || `piper exited ${code}`));
      });
      child.stdin.end(text + "\n");
    });

  return attempt(args).catch((error) => {
    // Older piper releases spell the output flag differently.
    if (!piperFlavor || piperFlavor === "under") throw error;
    const fallback = args.map((arg) => (arg === "-f" ? "--output_file" : arg === "--length-scale" ? "--length_scale" : arg));
    piperFlavor = "under";
    return attempt(fallback);
  });
}
