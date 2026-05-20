const { db } = require("./storage");

function normalizeJid(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.includes("@")) return s;
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  return `${s}@s.whatsapp.net`;
}

function extractNumber(jid) {
  if (!jid) return null;
  return String(jid).split("@")[0].split(":")[0].replace(/[^\d]/g, "");
}

function isBoss(jid) {
  if (!jid) return false;
  const num = extractNumber(jid);
  if (!num) return false;
  const bosses = db.prepare("SELECT jid FROM bosses").all();
  return bosses.some(b => extractNumber(b.jid) === num);
}

function addBoss(jidOrNumber, name) {
  const jid = normalizeJid(jidOrNumber);
  if (!jid) return null;
  db.prepare("INSERT OR REPLACE INTO bosses (jid, name) VALUES (?, ?)").run(jid, name || null);
  return jid;
}

function removeBoss(jidOrNumber) {
  const jid = normalizeJid(jidOrNumber);
  if (!jid) return false;
  const r = db.prepare("DELETE FROM bosses WHERE jid=?").run(jid);
  return r.changes > 0;
}

function listBosses() {
  return db.prepare("SELECT * FROM bosses ORDER BY added_at").all();
}

function seedInitialBosses(envValue) {
  if (!envValue) return;
  const numbers = String(envValue).split(",").map(s => s.trim()).filter(Boolean);
  for (const n of numbers) addBoss(n, "initial-boss");
}

module.exports = { isBoss, addBoss, removeBoss, listBosses, normalizeJid, seedInitialBosses, extractNumber };
