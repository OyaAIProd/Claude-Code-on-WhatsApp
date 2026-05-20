const { spawn } = require("child_process");
const { db } = require("./storage");

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const PROFILE_MODEL = process.env.CLAUDE_PROFILE_MODEL || "haiku";

function getProfile(userJid) {
  if (!userJid) return null;
  return db.prepare("SELECT * FROM user_profiles WHERE user_jid=?").get(userJid);
}

function listProfiles(limit = 30) {
  return db.prepare("SELECT * FROM user_profiles ORDER BY last_active DESC LIMIT ?").all(limit);
}

function incrementActivity(userJid, displayName) {
  if (!userJid) return;
  try {
    db.prepare(`INSERT INTO user_profiles (user_jid, display_name, message_count, last_active) VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(user_jid) DO UPDATE SET message_count=message_count+1, last_active=datetime('now'), display_name=COALESCE(excluded.display_name, display_name)`)
      .run(userJid, displayName || null);
  } catch (err) { console.error("incrementActivity:", err.message); }
}

function getUsersNeedingProfile(minNewMsgs = 30) {
  return db.prepare(`SELECT user_jid, display_name, message_count, last_active FROM user_profiles WHERE message_count >= 10 ORDER BY last_active DESC`)
    .all()
    .filter(u => {
      const p = db.prepare("SELECT message_count, last_generated FROM user_profiles WHERE user_jid=?").get(u.user_jid);
      if (!p.last_generated) return true;
      if ((u.message_count - (p.message_count || 0)) < minNewMsgs && p.last_generated) {
        const ageMs = Date.now() - new Date(p.last_generated).getTime();
        return ageMs > 7 * 24 * 3600 * 1000;
      }
      return true;
    });
}

function runClaudeOnce(prompt, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const args = ["--print", "--output-format", "json", "--model", PROFILE_MODEL, "--permission-mode", "bypassPermissions", prompt];
    const proc = spawn(CLAUDE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const to = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} reject(new Error("Timeout")); }, timeoutMs);
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      clearTimeout(to);
      if (code !== 0) return reject(new Error(`exit ${code}: ${stderr.slice(0, 200)}`));
      try { resolve(JSON.parse(stdout.trim()).result || stdout); } catch { resolve(stdout); }
    });
    proc.on("error", reject);
  });
}

async function generateProfileFor(userJid) {
  const p = getProfile(userJid);
  if (!p) return null;
  const msgs = db.prepare(`SELECT text, chat_name, timestamp FROM messages WHERE sender_jid=? AND text IS NOT NULL AND text != '' ORDER BY timestamp DESC LIMIT 50`).all(userJid);
  if (!msgs.length) return null;
  const sample = msgs.map(m => `[${m.chat_name?.slice(0, 20)}] ${m.text.slice(0, 150)}`).join("\n");
  const prompt = `Analisa profil user dari sample chat WhatsApp ini. Output JSON SAJA:
{"traits": "<2-3 sifat: misal 'detail-oriented, suka tanya tehknis, langsung to-the-point'>", "communication_style": "<formal|casual|technical|friendly|mixed>", "interests": "<3-5 topik utama dia bahas>"}

User display name: ${p.display_name || "?"}
Total msgs: ${p.message_count}

Sample (50 msg terakhir):
${sample.slice(0, 4000)}

Output JSON:`;
  try {
    const out = await runClaudeOnce(prompt);
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    const parsed = JSON.parse(match[0]);
    db.prepare(`UPDATE user_profiles SET traits=?, communication_style=?, interests=?, last_generated=datetime('now') WHERE user_jid=?`)
      .run(parsed.traits || "", parsed.communication_style || "", parsed.interests || "", userJid);
    console.log(`[USER_PROFILE] ${p.display_name || userJid}: ${parsed.communication_style}`);
    return parsed;
  } catch (err) {
    console.error(`[USER_PROFILE] ${userJid}: ${err.message}`);
    return null;
  }
}

async function runProfileTick() {
  try {
    const users = getUsersNeedingProfile(30).slice(0, 5);
    for (const u of users) {
      await generateProfileFor(u.user_jid);
      await new Promise(r => setTimeout(r, 5000));
    }
  } catch (err) { console.error("user profile tick:", err.message); }
}

function buildProfileContext(userJid) {
  const p = getProfile(userJid);
  if (!p || !p.traits) return "";
  return `\n\n👤 PROFIL USER (yang lagi ngomong sekarang):\nNama: ${p.display_name || "?"}\nGaya: ${p.communication_style || "?"}\nSifat: ${p.traits}\nMinat: ${p.interests || "?"}\nSesuaikan tone reply lo dengan gaya komunikasi user ini.\n`;
}

function startUserProfileGenerator() {
  setTimeout(runProfileTick, 90 * 1000);
  setInterval(runProfileTick, 60 * 60 * 1000);
  console.log(`✅ User profile generator started`);
}

module.exports = { getProfile, listProfiles, incrementActivity, generateProfileFor, buildProfileContext, startUserProfileGenerator };
