const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const vision = require("./vision");
const voice = require("./voice");
const { ffmpegBin, ffprobeBin } = require("./tts");

const MAX_FRAMES = Math.max(2, Math.min(parseInt(process.env.VIDEO_FRAMES || "5", 10), 5)); // Groq cap = 5

function probeDuration(file) {
  try {
    const pb = ffprobeBin();
    if (!pb) return 0;
    const r = spawnSync(pb, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    const d = parseFloat((r.stdout || "").trim());
    return isFinite(d) && d > 0 ? d : 0;
  } catch { return 0; }
}

function run(bin, args) {
  return new Promise((resolve) => {
    try {
      const p = spawn(bin, args, { stdio: "ignore" });
      p.on("close", code => resolve(code === 0));
      p.on("error", () => resolve(false));
    } catch { resolve(false); }
  });
}

// Scene-aware: pick frames where the picture changes (action), up to MAX_FRAMES.
async function sceneFrames(file, prefix) {
  const bin = ffmpegBin();
  if (!bin) return [];
  const pattern = `${prefix}_s%02d.jpg`;
  await run(bin, ["-y", "-i", file, "-vf", "select='gt(scene,0.25)',scale=512:-1", "-vsync", "vfr", "-frames:v", String(MAX_FRAMES), "-q:v", "4", pattern]);
  const dir = path.dirname(prefix), base = path.basename(prefix);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.startsWith(base + "_s") && f.endsWith(".jpg")).sort().map(f => path.join(dir, f));
  } catch {}
  return files;
}

async function frameAt(file, ts, outPath) {
  const bin = ffmpegBin();
  if (!bin) return null;
  const ok = await run(bin, ["-y", "-ss", String(ts), "-i", file, "-frames:v", "1", "-q:v", "4", "-vf", "scale=512:-1", outPath]);
  return ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 0 ? outPath : null;
}

async function evenFrames(file, prefix, dur, n) {
  const stamps = dur > 0
    ? Array.from({ length: n }, (_, i) => +(dur * ((i + 0.5) / n)).toFixed(1))
    : Array.from({ length: n }, (_, i) => i);
  const out = [];
  for (let i = 0; i < stamps.length; i++) {
    const fp = await frameAt(file, stamps[i], `${prefix}_e${i}.jpg`);
    if (fp) out.push(fp);
  }
  return out;
}

async function extractAudio(file, outPath) {
  const bin = ffmpegBin();
  if (!bin) return false;
  const ok = await run(bin, ["-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", outPath]);
  return ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000;
}

// "See + hear" a video: scene frames -> Groq vision (1 multi-image call) + audio -> Whisper dialog.
// All via Groq/ffmpeg — no Claude tokens. Returns a structured Indonesian description.
async function describeVideo(videoPath, { caption } = {}) {
  if (!ffmpegBin()) return null;
  const dur = probeDuration(videoPath);
  const prefix = path.join(os.tmpdir(), `vid_${crypto.randomBytes(5).toString("hex")}`);

  let frames = [];
  try {
    frames = await sceneFrames(videoPath, prefix);
    if (frames.length < 2) {
      const ev = await evenFrames(videoPath, prefix, dur, MAX_FRAMES);
      frames = frames.concat(ev);
    }
    frames = frames.slice(0, MAX_FRAMES);
  } catch (e) { console.error("[VIDEO] frames:", e.message); }

  let visual = "";
  try {
    if (frames.length) visual = await vision.describeImages(frames, { caption });
  } catch (e) { console.error("[VIDEO] vision:", e.message); }
  finally { for (const f of frames) { try { fs.unlinkSync(f); } catch {} } }

  let dialog = "";
  const ap = `${prefix}_a.mp3`;
  try {
    if (await extractAudio(videoPath, ap)) {
      dialog = (await voice.transcribeViaGroq(fs.readFileSync(ap), "audio.mp3")) || "";
    }
  } catch (e) { console.error("[VIDEO] audio:", e.message); }
  finally { try { fs.unlinkSync(ap); } catch {} }

  const parts = [];
  parts.push(`🎬 VIDEO${dur ? ` (${dur.toFixed(0)}s)` : ""}`);
  if (visual) parts.push(visual.trim());
  parts.push(`DIALOG: ${dialog.trim() ? `"${dialog.replace(/\s+/g, " ").trim().slice(0, 800)}"` : "(tidak ada ucapan terdeteksi)"}`);
  const out = parts.join("\n").trim();
  return out || null;
}

function available() { return !!ffmpegBin(); }

module.exports = { describeVideo, available };
