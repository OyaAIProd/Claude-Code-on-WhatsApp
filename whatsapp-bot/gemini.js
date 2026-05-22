const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const path = require("path");

// Vision via Gemini CLI (headless, free through the Google login — no API key).
// Verified invocation: cd <image dir> && gemini -e none -y -m <model> -p "<prompt> @<relfile>"
//  -e none  -> no extensions/skills, so it just answers (doesn't go agentic)
//  relative @file inside cwd -> attaches as image (absolute paths are rejected as out-of-workspace)
const GEMINI_BIN = process.env.GEMINI_BIN || "gemini";
const MODELS = (process.env.GEMINI_MODELS || "gemini-2.5-flash,gemini-flash-latest,gemini-2.0-flash-001")
  .split(",").map(s => s.trim()).filter(Boolean);
const CALL_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10);
const DEFAULT_COOLDOWN_MS = parseInt(process.env.GEMINI_COOLDOWN_MS || "8000", 10);

const NOISE = /true color|ripgrep|skill |conflict|overriding|^Warning:|YOLO mode|Loaded cached|Fontconfig|Data collection|^\s*$/i;
const QUOTA_RE = /exhausted your capacity|RESOURCE_EXHAUSTED|quota|rate.?limit|429|too many requests/i;
const NOTFOUND_RE = /not found|404|ModelNotFound|Unknown model/i;

let chain = Promise.resolve();   // serial queue: one Gemini call at a time (protect free quota)
let cooldownUntil = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseResetMs(text) {
  const m = text.match(/reset(?:s)?\s+(?:after|in)\s+(\d+)\s*s/i) || text.match(/(\d+)\s*s(?:econds)?\b/i);
  return m ? Math.min(parseInt(m[1], 10) * 1000 + 1000, 60000) : DEFAULT_COOLDOWN_MS;
}

function runOnce(model, dir, relFile, prompt) {
  return new Promise((resolve) => {
    // The long extraction prompt (with < > | [ ] { }) breaks cmd parsing if put on the command
    // line. Solution: only the file ref goes on the command line (-p "@file", a single token);
    // the full instructions are piped via STDIN (gemini appends -p to stdin input).
    const cmd = `${GEMINI_BIN} -e none -y -o text -m ${model} -p "@${relFile}"`;
    let out = "", err = "", done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    let proc;
    try { proc = spawn(cmd, { cwd: dir, env: process.env, shell: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { return fin({ ok: false, err: e.message }); }
    try { proc.stdin.write(String(prompt).replace(/\r/g, "")); proc.stdin.end(); } catch {}
    const to = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} fin({ ok: false, err: "timeout" }); }, CALL_TIMEOUT_MS);
    proc.stdout.on("data", d => { out += d.toString(); });
    proc.stderr.on("data", d => { err += d.toString(); });
    proc.on("error", e => { clearTimeout(to); fin({ ok: false, err: e.message }); });
    proc.on("close", () => {
      clearTimeout(to);
      const all = out + "\n" + err;
      const clean = out.split("\n").filter(l => l.trim() && !NOISE.test(l)).join("\n").trim();
      if (QUOTA_RE.test(all) && !clean) return fin({ ok: false, quota: true, resetMs: parseResetMs(all), err: "quota" });
      if (NOTFOUND_RE.test(all) && !clean) return fin({ ok: false, notFound: true, err: "model not found" });
      if (!clean) return fin({ ok: false, err: (err || "empty").slice(0, 200) });
      fin({ ok: true, text: clean });
    });
  });
}

// Describe an image with model fallback + cooldown. Returns the description text (or "").
async function describe(imagePath, prompt) {
  const run = async () => {
    if (!fs.existsSync(imagePath)) return "";
    // Copy to a temp workspace with a safe (space-free) name; Gemini needs the file inside cwd.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gem_"));
    const ext = (path.extname(imagePath) || ".jpg").replace(/[^.\w]/g, "");
    const rel = `img_${crypto.randomBytes(4).toString("hex")}${ext}`;
    try { fs.copyFileSync(imagePath, path.join(dir, rel)); } catch (e) { return ""; }
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

    const now = Date.now();
    if (now < cooldownUntil) await sleep(cooldownUntil - now);

    let lastErr = "no models";
    try {
      for (let pass = 0; pass < 2; pass++) {
        for (const model of MODELS) {
          const r = await runOnce(model, dir, rel, prompt);
          if (r.ok) return r.text;
          lastErr = r.err;
          if (r.notFound) continue;                // try next model
          if (r.quota) {
            cooldownUntil = Date.now() + (r.resetMs || DEFAULT_COOLDOWN_MS);
            continue;                              // try next model immediately; cooldown applies if all exhausted
          }
          // generic error: try next model too
        }
        const wait = cooldownUntil - Date.now();
        if (wait > 0 && pass === 0) { console.warn(`[GEMINI] all models busy, cooldown ${Math.round(wait / 1000)}s`); await sleep(wait); }
        else break;
      }
      console.error(`[GEMINI] gagal: ${lastErr}`);
      return "";
    } finally { cleanup(); }
  };
  // serialize
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

function available() {
  try { const r = require("child_process").spawnSync(`${GEMINI_BIN} --version`, { stdio: "ignore", shell: true }); return r.status === 0; }
  catch { return false; }
}

module.exports = { describe, available, MODELS };
