// Downloads Supertonic-3 ONNX models + voice styles into ./assets (kept local, gitignored).
// Run once: `node tts/supertonic/download-model.mjs`
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://huggingface.co/Supertone/supertonic-3/resolve/main";
const ASSETS = path.join(__dirname, "assets");

const FILES = [
  "onnx/duration_predictor.onnx",
  "onnx/text_encoder.onnx",
  "onnx/vector_estimator.onnx",
  "onnx/vocoder.onnx",
  "onnx/tts.json",
  "onnx/unicode_indexer.json",
  "voice_styles/M1.json",
  "voice_styles/F1.json",
  "voice_styles/M2.json",
  "voice_styles/F2.json"
];

async function dl(rel) {
  const url = `${BASE}/${rel}`;
  const dest = path.join(ASSETS, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`✓ skip (exists): ${rel}`);
    return;
  }
  process.stdout.write(`↓ ${rel} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, fs.createWriteStream(dest));
  const mb = (fs.statSync(dest).size / 1e6).toFixed(1);
  console.log(`done (${mb}MB)`);
}

(async () => {
  console.log("Downloading Supertonic-3 model into", ASSETS);
  for (const f of FILES) {
    try { await dl(f); }
    catch (e) { console.error(`✗ ${f}: ${e.message}`); process.exitCode = 1; }
  }
  console.log("\nSelesai. Model siap di tts/supertonic/assets/");
})();
