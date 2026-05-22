const { db } = require("./storage");

// Source habits: remember which GROUP a kind of question usually gets answered from,
// so similar questions later search the same place first.
db.exec(`
  CREATE TABLE IF NOT EXISTS query_habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_tokens TEXT,
    target_chat_id TEXT,
    target_chat_name TEXT,
    hits INTEGER DEFAULT 1,
    last_used INTEGER DEFAULT (strftime('%s','now'))
  );
`);

const STOP = new Set(["yang", "dan", "atau", "itu", "ini", "ada", "apa", "siapa", "kapan", "mana", "tolong", "coba", "dong", "sih", "cari", "carikan", "liat", "lihat", "tau", "tahu", "grup", "group", "chat", "data", "soal", "tentang", "sekarang", "udah", "sudah"]);
// Normalize topic synonyms so "posisi/dimana/lokasi kep X" share the same topic.
const SYN = { posisi: "lokasi", dimana: "lokasi", kemana: "lokasi", lokasinya: "lokasi", koordinat: "lokasi", berangkat: "perjalanan", sampai: "perjalanan", transit: "perjalanan" };

function tokens(text) {
  return [...new Set(
    String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
      .map(t => SYN[t] || t)
      .filter(t => t.length >= 3 && !STOP.has(t))
  )];
}

// Find a group (chat) by a name fragment ("internal" -> "Grup Internal Pelayaran").
function resolveGroupByName(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return null;
  try {
    const rows = db.prepare("SELECT DISTINCT chat_id, chat_name FROM messages WHERE is_group=1 AND chat_name IS NOT NULL").all();
    return rows.find(r => (r.chat_name || "").toLowerCase().includes(n)) || null;
  } catch { return null; }
}

// Detect an explicit group reference in the query ("di grup internal", "cari di internal").
function resolveGroupRef(queryText) {
  const m = String(queryText || "").match(/\b(?:di|ke|dari|grup|group)\s+(?:grup\s+|group\s+)?([\p{L}][\p{L}\s]{2,30})/iu);
  if (!m) return null;
  // try progressively shorter name fragments
  const words = m[1].trim().split(/\s+/);
  for (let n = Math.min(words.length, 3); n >= 1; n--) {
    const cand = words.slice(0, n).join(" ");
    const g = resolveGroupByName(cand);
    if (g) return g;
  }
  return null;
}

function recordHabit(queryText, targetChatId, targetChatName) {
  const toks = tokens(queryText);
  if (toks.length < 2 || !targetChatId) return;
  try {
    // merge into an existing similar habit pointing to same group, else insert
    const rows = db.prepare("SELECT * FROM query_habits WHERE target_chat_id=?").all(targetChatId);
    let best = null, bestOv = 0;
    for (const r of rows) {
      const ht = JSON.parse(r.topic_tokens || "[]");
      const ov = toks.filter(t => ht.includes(t)).length;
      if (ov > bestOv) { bestOv = ov; best = r; }
    }
    if (best && bestOv >= 2) {
      const merged = [...new Set([...JSON.parse(best.topic_tokens || "[]"), ...toks])].slice(0, 12);
      db.prepare("UPDATE query_habits SET topic_tokens=?, hits=hits+1, last_used=strftime('%s','now') WHERE id=?").run(JSON.stringify(merged), best.id);
    } else {
      db.prepare("INSERT INTO query_habits (topic_tokens, target_chat_id, target_chat_name) VALUES (?,?,?)").run(JSON.stringify(toks.slice(0, 12)), targetChatId, targetChatName || "");
    }
  } catch (err) { console.error("[HABIT] record:", err.message); }
}

// Best learned group for a similar query (>=2 shared topic tokens).
function findHabit(queryText) {
  const toks = tokens(queryText);
  if (toks.length < 2) return null;
  try {
    const rows = db.prepare("SELECT * FROM query_habits ORDER BY hits DESC").all();
    let best = null, bestOv = 0;
    for (const r of rows) {
      const ht = JSON.parse(r.topic_tokens || "[]");
      const ov = toks.filter(t => ht.includes(t)).length;
      if (ov > bestOv) { bestOv = ov; best = r; }
    }
    return best && bestOv >= 1 ? { chat_id: best.target_chat_id, chat_name: best.target_chat_name } : null;
  } catch { return null; }
}

function listHabits() {
  try { return db.prepare("SELECT id, topic_tokens, target_chat_name, hits FROM query_habits ORDER BY hits DESC LIMIT 50").all(); } catch { return []; }
}

// Explicit rule: "questions about <keyword/topic> -> look in <group>". (boss-defined)
function setRule(keyword, groupRef) {
  const toks = tokens(keyword);
  if (!toks.length) return { error: "topik/keyword kosong" };
  const g = resolveGroupByName(groupRef) || (/@g\.us$/.test(groupRef || "") ? { chat_id: groupRef, chat_name: groupRef } : null);
  if (!g) return { error: `grup "${groupRef}" gak ketemu (cek /list-chats)` };
  try {
    db.prepare("INSERT INTO query_habits (topic_tokens, target_chat_id, target_chat_name, hits) VALUES (?,?,?,5)")
      .run(JSON.stringify(toks.slice(0, 12)), g.chat_id, g.chat_name);
    return { ok: true, topic: toks.join(" "), group: g.chat_name };
  } catch (err) { return { error: err.message }; }
}
function delHabit(id) {
  try { return db.prepare("DELETE FROM query_habits WHERE id=?").run(id).changes > 0; } catch { return false; }
}

module.exports = { recordHabit, findHabit, resolveGroupByName, resolveGroupRef, listHabits, setRule, delHabit, tokens };
