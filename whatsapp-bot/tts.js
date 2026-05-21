const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

// Supertonic-3 on-device TTS (ONNX). Self-contained in tts/supertonic/ for easy export/move.
const TTS_DIR = path.join(__dirname, "tts", "supertonic");
const HELPER = path.join(TTS_DIR, "helper.js");
const ONNX_DIR = path.join(TTS_DIR, "assets", "onnx");
const VOICE_DIR = path.join(TTS_DIR, "assets", "voice_styles");

const DEFAULT_VOICE = process.env.TTS_VOICE || "M1";
const DEFAULT_LANG = process.env.TTS_LANG || "id";
const TTS_SPEED = parseFloat(process.env.TTS_SPEED || "1.05");
const TTS_STEPS = parseInt(process.env.TTS_STEPS || "5", 10);   // 5=faster (default), up to 12=higher quality

let helperPromise = null;
let ttsPromise = null;
const styleCache = new Map();

function isAvailable() {
  return fs.existsSync(path.join(ONNX_DIR, "vocoder.onnx")) &&
         fs.existsSync(path.join(ONNX_DIR, "unicode_indexer.json")) &&
         fs.existsSync(HELPER);
}

function getHelper() {
  if (!helperPromise) helperPromise = import(pathToFileURL(HELPER).href);
  return helperPromise;
}

async function getTTS() {
  if (!ttsPromise) ttsPromise = (async () => {
    const helper = await getHelper();
    return helper.loadTextToSpeech(ONNX_DIR, false);
  })();
  return ttsPromise;
}

async function getStyle(voice) {
  if (styleCache.has(voice)) return styleCache.get(voice);
  const helper = await getHelper();
  const p = path.join(VOICE_DIR, `${voice}.json`);
  if (!fs.existsSync(p)) throw new Error(`voice style ${voice} gak ada di ${VOICE_DIR}`);
  const style = helper.loadVoiceStyle([p], false);
  styleCache.set(voice, style);
  return style;
}

// Strip things that sound bad when read aloud. (helper also removes emoji/brackets internally.)
function cleanForSpeech(text) {
  if (!text) return "";
  let s = text;
  s = s.replace(/```[\s\S]*?```/g, " . ");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/https?:\/\/\S+/g, " ");
  s = s.replace(/\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/[a-z]+(?:\/[a-z]+)?\s·\s[0-9.]+s\s·\s\$[0-9.]+/gi, " ");  // strip trailing meta line
  s = s.replace(/[*_~#>|]/g, " ");
  s = s.replace(/^\s*[-•]\s*/gm, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function toOpus(wavPath) {
  return new Promise((resolve) => {
    const out = wavPath.replace(/\.wav$/, ".ogg");
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const p = spawn("ffmpeg", ["-y", "-i", wavPath, "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", out], { stdio: "ignore" });
    p.on("close", code => fin(code === 0 && fs.existsSync(out) ? out : null));
    p.on("error", () => fin(null));
  });
}

// Synthesize full text (auto-chunked by Supertonic for long input — no length cap).
async function synthesize(text, { lang = DEFAULT_LANG, voice = DEFAULT_VOICE } = {}) {
  if (!isAvailable()) throw new Error("TTS_NOT_READY: model belum di-download. Jalankan: node tts/supertonic/download-model.mjs");
  const clean = cleanForSpeech(text);
  if (!clean) return null;
  const helper = await getHelper();
  const tts = await getTTS();
  const style = await getStyle(voice);

  const safeLang = ["en","ko","ja","ar","bg","cs","da","de","el","es","et","fi","fr","hi","hr","hu","id","it","lt","lv","nl","pl","pt","ro","ru","sk","sl","sv","tr","uk","vi","na"].includes(lang) ? lang : "na";
  const { wav, duration } = await tts.call(clean, safeLang, style, TTS_STEPS, TTS_SPEED);

  const wavLen = Math.floor(tts.sampleRate * duration[0]);
  const wavOut = wav.slice(0, wavLen > 0 ? wavLen : wav.length);
  const base = path.join(os.tmpdir(), `tts_${crypto.randomBytes(6).toString("hex")}`);
  const wavPath = base + ".wav";
  helper.writeWavFile(wavPath, wavOut, tts.sampleRate);

  const ogg = await toOpus(wavPath);
  return { path: ogg || wavPath, isOpus: !!ogg, wavPath, durationSec: Number(duration[0]) || 0 };
}

module.exports = { synthesize, isAvailable, cleanForSpeech, DEFAULT_LANG, DEFAULT_VOICE };
