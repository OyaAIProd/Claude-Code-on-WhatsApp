require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { db } = require("../storage");
const bosses = require("../bosses");
const budgets = require("../budgets");
const audit = require("../audit");
const locations = require("../locations");

const ENV_PATH = path.join(__dirname, "..", ".env");
const PORT = parseInt(process.env.ADMIN_PORT || "3458", 10);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function basicAuth(req, res, next) {
  if (!ADMIN_PASS) {
    res.set("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).send("Admin password belum diset. Tambahkan ADMIN_PASS di .env, lalu restart.");
  }
  const a = req.headers.authorization;
  if (!a || !a.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).send("Auth required");
  }
  const [u, p] = Buffer.from(a.slice(6), "base64").toString().split(":");
  if (u !== ADMIN_USER || p !== ADMIN_PASS) {
    res.set("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).send("Bad credentials");
  }
  next();
}

function isSetupComplete() {
  const env = readEnv();
  return !!(env.ADMIN_PASS && env.BOSS_SECRET_CODE && env.WA_INITIAL_BOSSES);
}

app.get("/setup", (req, res) => res.sendFile(path.join(__dirname, "public", "setup.html")));
app.get("/setup-status", (req, res) => res.json({ complete: isSetupComplete(), missing: ["ADMIN_PASS","BOSS_SECRET_CODE","WA_INITIAL_BOSSES","GROQ_API_KEY","TELEGRAM_BOT_TOKEN"].filter(k => !readEnv()[k]) }));

app.post("/setup", (req, res) => {
  const { admin_password, boss_number, boss_name, boss_secret_code, groq_api_key, telegram_token, telegram_chat_id, claude_model } = req.body;
  if (!admin_password || admin_password.length < 4) return res.status(400).json({ error: "Password admin min 4 karakter" });
  if (!boss_number) return res.status(400).json({ error: "Nomor WhatsApp boss wajib diisi" });
  const secret = boss_secret_code || crypto.randomBytes(6).toString("hex");
  const updates = {
    ADMIN_PASS: admin_password,
    ADMIN_USER: "admin",
    ADMIN_PORT: "3458",
    WA_INITIAL_BOSSES: String(boss_number).replace(/[^\d,]/g, ""),
    BOSS_SECRET_CODE: secret,
    CLAUDE_MODEL: claude_model || "sonnet",
    CLAUDE_PERMISSION_MODE: "bypassPermissions",
    CLAUDE_TIMEOUT_MS: "600000"
  };
  if (groq_api_key) updates.GROQ_API_KEY = groq_api_key;
  if (telegram_token) {
    const tgPath = path.join(__dirname, "..", "..", "telegram-bot", ".env");
    const tgLines = [`TELEGRAM_BOT_TOKEN=${telegram_token}`];
    if (telegram_chat_id) tgLines.push(`TELEGRAM_ALLOWED_CHAT_IDS=${telegram_chat_id}`);
    if (groq_api_key) tgLines.push(`GROQ_API_KEY=${groq_api_key}`);
    tgLines.push(`CLAUDE_MODEL=${claude_model || "sonnet"}`, "CLAUDE_PERMISSION_MODE=bypassPermissions");
    try { fs.writeFileSync(tgPath, tgLines.join("\n") + "\n"); } catch (err) { console.error("write tg env:", err.message); }
  }
  writeEnv(updates);
  try { bosses.addBoss(boss_number, boss_name || "boss"); } catch {}
  audit.log({ action: "initial_setup_complete", detail: `boss=${boss_number}` });
  res.json({ ok: true, secret_code: secret, note: "Setup complete. Restart bot untuk apply config." });
});

app.use((req, res, next) => {
  if (req.path === "/setup" || req.path === "/setup-status" || req.path.startsWith("/api/setup")) return next();
  if (!isSetupComplete()) {
    if (req.path === "/") return res.redirect("/setup");
  }
  next();
});

app.use(basicAuth);

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    out[k.trim()] = rest.join("=").trim();
  }
  return out;
}

function writeEnv(updates) {
  const cur = readEnv();
  for (const [k, v] of Object.entries(updates)) cur[k] = v == null ? "" : String(v);
  const lines = Object.entries(cur).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

app.get("/api/config", (req, res) => {
  const env = readEnv();
  const safe = {
    BOSS_SECRET_CODE: env.BOSS_SECRET_CODE ? "***" + env.BOSS_SECRET_CODE.slice(-4) : "",
    WA_INITIAL_BOSSES: env.WA_INITIAL_BOSSES || "",
    CLAUDE_MODEL: env.CLAUDE_MODEL || "sonnet",
    CLAUDE_PERMISSION_MODE: env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
    CLAUDE_TIMEOUT_MS: env.CLAUDE_TIMEOUT_MS || "600000",
    GROQ_API_KEY: env.GROQ_API_KEY ? "✓ set" : "(empty)",
    GROQ_WHISPER_MODEL: env.GROQ_WHISPER_MODEL || "whisper-large-v3",
    EMBEDDINGS_ENABLED: env.EMBEDDINGS_ENABLED || "1",
    LOG_LEVEL: env.LOG_LEVEL || "warn"
  };
  res.json(safe);
});

app.post("/api/config", (req, res) => {
  const allowed = ["BOSS_SECRET_CODE", "WA_INITIAL_BOSSES", "CLAUDE_MODEL", "CLAUDE_PERMISSION_MODE", "CLAUDE_TIMEOUT_MS", "GROQ_API_KEY", "GROQ_WHISPER_MODEL", "EMBEDDINGS_ENABLED", "LOG_LEVEL", "ADMIN_PASS"];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  writeEnv(updates);
  audit.log({ action: "admin_config_update", target: Object.keys(updates).join(","), detail: "via dashboard" });
  res.json({ ok: true, updated: Object.keys(updates), note: "Restart bot untuk apply." });
});

app.post("/api/secret-code/generate", (req, res) => {
  const newCode = crypto.randomBytes(6).toString("hex");
  writeEnv({ BOSS_SECRET_CODE: newCode });
  audit.log({ action: "admin_secret_rotate", detail: "new code generated" });
  res.json({ ok: true, code: newCode, note: "Code baru di-generate. Restart bot untuk apply." });
});

app.get("/api/bosses", (req, res) => res.json(bosses.listBosses()));

app.post("/api/bosses", (req, res) => {
  const { number, name } = req.body;
  if (!number) return res.status(400).json({ error: "number required" });
  const jid = bosses.addBoss(number, name);
  if (!jid) return res.status(400).json({ error: "invalid number" });
  audit.log({ action: "admin_boss_add", target: jid });
  res.json({ ok: true, jid });
});

app.delete("/api/bosses/:number", (req, res) => {
  const ok = bosses.removeBoss(req.params.number);
  audit.log({ action: "admin_boss_remove", target: req.params.number });
  res.json({ ok });
});

app.get("/api/budgets", (req, res) => res.json(budgets.listBudgets()));

app.put("/api/budgets/:jid", (req, res) => {
  const limit = parseFloat(req.body.daily_limit_usd);
  if (isNaN(limit)) return res.status(400).json({ error: "invalid limit" });
  budgets.setLimit(req.params.jid, limit);
  audit.log({ action: "admin_budget_set", target: req.params.jid, detail: `$${limit}/day` });
  res.json({ ok: true });
});

app.get("/api/stats", (req, res) => {
  const msgCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
  const chatCount = db.prepare("SELECT COUNT(DISTINCT chat_id) AS c FROM messages").get().c;
  const profileCount = db.prepare("SELECT COUNT(*) AS c FROM group_profiles").get().c;
  const fileCount = db.prepare("SELECT COUNT(*) AS c FROM messages WHERE media_path IS NOT NULL").get().c;
  const sessionCount = db.prepare("SELECT COUNT(*) AS c FROM chat_sessions").get().c;
  const reminderCount = db.prepare("SELECT COUNT(*) AS c FROM reminders WHERE status='pending'").get().c;
  const cronCount = db.prepare("SELECT COUNT(*) AS c FROM cron_tasks WHERE active=1").get().c;
  const wfCount = db.prepare("SELECT COUNT(*) AS c FROM workflows WHERE status='active'").get().c;
  res.json({ msgCount, chatCount, profileCount, fileCount, sessionCount, reminderCount, cronCount, wfCount, uptime_h: (process.uptime() / 3600).toFixed(2), mem_mb: (process.memoryUsage().rss / 1024 / 1024).toFixed(1) });
});

app.get("/api/audit", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json(audit.recent({ limit }));
});

// ── Map: shared locations + named waypoints ──────────────────────
app.get("/map", (req, res) => res.sendFile(path.join(__dirname, "public", "map.html")));
app.get("/api/map", (req, res) => {
  try {
    const locs = locations.recentLocations(null, 150).map(l => ({
      sender: l.sender_name, lat: l.lat, lng: l.lng, is_live: l.is_live, ts: l.ts,
      expired: locations.isExpired(l), place: l.place_name, chat: l.chat_name
    }));
    res.json({ locations: locs, waypoints: locations.listWaypoints() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/waypoint", (req, res) => {
  const { name, lat, lng } = req.body || {};
  if (!name || typeof lat !== "number" || typeof lng !== "number") return res.status(400).json({ error: "name, lat, lng required" });
  const w = locations.addWaypoint(name, lat, lng);
  res.json(w || { error: "fail" });
});
app.post("/api/waypoint/delete", (req, res) => {
  const { name } = req.body || {};
  res.json({ ok: locations.deleteWaypoint(name || "") });
});

app.listen(PORT, () => {
  console.error(`✅ Admin Dashboard: http://localhost:${PORT}`);
  console.error(`   User: ${ADMIN_USER}`);
  if (!ADMIN_PASS) console.error(`   ⚠️  ADMIN_PASS belum diset di .env — dashboard locked.`);
});
