const { db } = require("./storage");
const { escapeFts } = require("./rag");
const fetch = global.fetch || require("node-fetch");

// Learns FACTS from group conversations: when people ask & answer each other, extract the
// resolved status + reason so the bot can answer later. Extraction uses Groq (not Claude tokens).
const GROQ_KEY = process.env.GROQ_API_KEY;
const EXTRACT_MODEL = process.env.GROQ_EXTRACT_MODEL || "llama-3.1-8b-instant";
const INTERVAL_MS = parseInt(process.env.QA_LEARN_INTERVAL_MS || `${15 * 60 * 1000}`, 10);

db.exec(`
  CREATE TABLE IF NOT EXISTS qa_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    chat_name TEXT,
    subject TEXT,
    subject_key TEXT,
    status TEXT,
    reason TEXT,
    fact_ts INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_qa_chat ON qa_facts(chat_id);
  CREATE INDEX IF NOT EXISTS idx_qa_key ON qa_facts(chat_id, subject_key);
  CREATE VIRTUAL TABLE IF NOT EXISTS qa_facts_fts USING fts5(subject, status, reason, content='qa_facts', content_rowid='id');
  CREATE TRIGGER IF NOT EXISTS qa_ai AFTER INSERT ON qa_facts BEGIN
    INSERT INTO qa_facts_fts(rowid, subject, status, reason) VALUES (new.id, new.subject, new.status, new.reason);
  END;
  CREATE TRIGGER IF NOT EXISTS qa_ad AFTER DELETE ON qa_facts BEGIN
    INSERT INTO qa_facts_fts(qa_facts_fts, rowid, subject, status, reason) VALUES ('delete', old.id, old.subject, old.status, old.reason);
  END;
  CREATE TRIGGER IF NOT EXISTS qa_au AFTER UPDATE ON qa_facts BEGIN
    INSERT INTO qa_facts_fts(qa_facts_fts, rowid, subject, status, reason) VALUES ('delete', old.id, old.subject, old.status, old.reason);
    INSERT INTO qa_facts_fts(rowid, subject, status, reason) VALUES (new.id, new.subject, new.status, new.reason);
  END;
  CREATE TABLE IF NOT EXISTS qa_watermark (chat_id TEXT PRIMARY KEY, last_ts INTEGER);
`);

function subjectKey(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function upsertFact({ chat_id, chat_name, subject, status, reason, fact_ts }) {
  const key = subjectKey(subject);
  if (!key || !status) return;
  try {
    const existing = db.prepare("SELECT id, fact_ts FROM qa_facts WHERE chat_id=? AND subject_key=?").get(chat_id, key);
    if (existing) {
      // Newer info supersedes older status for the same subject.
      if ((fact_ts || 0) >= (existing.fact_ts || 0)) {
        db.prepare("UPDATE qa_facts SET subject=?, status=?, reason=?, fact_ts=?, chat_name=?, created_at=datetime('now') WHERE id=?")
          .run(subject, status, reason || "", fact_ts || 0, chat_name || "", existing.id);
      }
      return;
    }
    db.prepare("INSERT INTO qa_facts (chat_id, chat_name, subject, subject_key, status, reason, fact_ts) VALUES (?,?,?,?,?,?,?)")
      .run(chat_id, chat_name || "", subject, key, status, reason || "", fact_ts || 0);
  } catch (err) { console.error("[QA] upsert:", err.message); }
}

async function extractFacts(transcript) {
  if (!GROQ_KEY || !transcript.trim()) return [];
  const prompt = `Ini cuplikan obrolan WhatsApp grup. Cari pertanyaan yang SUDAH TERJAWAB (status sesuatu + alasannya), termasuk jawaban dari orang lain & gak lugas. Output JSON SAJA:
{"facts":[{"subject":"<hal yang dibahas, mis 'kapal ke Pulau Burung'>","status":"<jawaban/keadaan, mis 'belum berangkat'>","reason":"<alasan kalau ada, else \\"\\">"}]}
Cuma masukin yang BENAR-BENAR terjawab di obrolan. Kalau gak ada, "facts":[].

Obrolan:
${transcript.slice(0, 6000)}

JSON:`;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700, temperature: 0,
        response_format: { type: "json_object" }
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    return Array.isArray(parsed.facts) ? parsed.facts.filter(f => f && f.subject && f.status) : [];
  } catch (err) { console.error("[QA] extract:", err.message); return []; }
}

function getNewMessages(chatId, sinceTs, limit = 40) {
  return db.prepare(`SELECT sender_name, text, timestamp FROM messages
    WHERE chat_id=? AND is_group=1 AND text IS NOT NULL AND text!='' AND timestamp > ?
    ORDER BY timestamp ASC LIMIT ?`).all(chatId, sinceTs || 0, limit);
}

function getGroupsWithNew() {
  return db.prepare(`SELECT m.chat_id, m.chat_name, MAX(m.timestamp) AS last_ts
    FROM messages m WHERE m.is_group=1
    GROUP BY m.chat_id
    HAVING last_ts > COALESCE((SELECT last_ts FROM qa_watermark w WHERE w.chat_id=m.chat_id), 0)`).all();
}

async function runQaTick() {
  if (!GROQ_KEY) return;
  try {
    const groups = getGroupsWithNew();
    for (const g of groups) {
      const wm = db.prepare("SELECT last_ts FROM qa_watermark WHERE chat_id=?").get(g.chat_id);
      const since = wm?.last_ts || (g.last_ts - 7 * 24 * 3600); // first run: last 7 days
      const msgs = getNewMessages(g.chat_id, since, 40);
      if (msgs.length < 2) { setWatermark(g.chat_id, g.last_ts); continue; }
      const hasQuestion = msgs.some(m => /\?|\b(udah|sudah|belum|kapan|berapa|gimana|apakah)\b/i.test(m.text || ""));
      if (!hasQuestion) { setWatermark(g.chat_id, g.last_ts); continue; }
      const transcript = msgs.map(m => `${m.sender_name || "?"}: ${(m.text || "").slice(0, 200)}`).join("\n");
      const facts = await extractFacts(transcript);
      const lastTs = msgs[msgs.length - 1].timestamp;
      for (const f of facts) upsertFact({ chat_id: g.chat_id, chat_name: g.chat_name, subject: f.subject, status: f.status, reason: f.reason, fact_ts: lastTs });
      if (facts.length) console.log(`[QA] ${g.chat_name}: +${facts.length} fakta`);
      setWatermark(g.chat_id, g.last_ts);
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (err) { console.error("[QA] tick:", err.message); }
}

function setWatermark(chatId, ts) {
  try { db.prepare("INSERT INTO qa_watermark (chat_id, last_ts) VALUES (?,?) ON CONFLICT(chat_id) DO UPDATE SET last_ts=excluded.last_ts").run(chatId, ts); } catch {}
}

const MAX_FACT_AGE_DAYS = parseInt(process.env.QA_FACT_MAX_AGE_DAYS || "21", 10);
const TRANSIENT_RE = /(stuck|macet|belum|nunggu|tunggu|tertunda|delay|rusak|antri|antre|proses|sedang|lagi |menunggu|pending|tertahan|terjebak|telat|terlambat)/i;

function relAge(ts) {
  if (!ts) return "?";
  const h = (Date.now() / 1000 - ts) / 3600;
  if (h < 1) return "barusan";
  if (h < 18) return `${Math.round(h)} jam lalu`;
  if (h < 42) return "kemarin";
  return `${Math.round(h / 24)} hari lalu`;
}

function searchFacts(chatId, queryText, limit = 3) {
  const q = escapeFts(queryText);
  if (!q) return [];
  try {
    const minTs = Math.floor(Date.now() / 1000) - MAX_FACT_AGE_DAYS * 86400;
    return db.prepare(`SELECT f.subject, f.status, f.reason, f.fact_ts, f.chat_name, qa_facts_fts.rank AS score
      FROM qa_facts_fts JOIN qa_facts f ON f.id = qa_facts_fts.rowid
      WHERE qa_facts_fts MATCH ? AND f.chat_id=? AND f.fact_ts >= ?
      ORDER BY qa_facts_fts.rank LIMIT ?`).all(q, chatId, minTs, limit);
  } catch (err) { console.error("[QA] search:", err.message); return []; }
}

function buildFactContext(facts) {
  if (!facts.length) return "";
  const lines = facts.map(f => {
    const when = f.fact_ts ? new Date(f.fact_ts * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "?";
    const ageH = f.fact_ts ? (Date.now() / 1000 - f.fact_ts) / 3600 : 0;
    const transient = TRANSIENT_RE.test(`${f.subject} ${f.status}`);
    const stale = transient && ageH > 18 ? " ⚠️KADALUARSA?" : "";
    return `• ${f.subject}: ${f.status}${f.reason ? ` (alasan: ${f.reason})` : ""} [${relAge(f.fact_ts)}, ${when} WIB]${stale}`;
  });
  return `\n\n📌 FAKTA TERPELAJAR (dari tanya-jawab orang di grup):
${lines.join("\n")}
ATURAN PAKAI FAKTA:
- Jawab pakai fakta + sebut alasan + KAPAN (mis "per kemarin...").
- Fakta bertanda ⚠️KADALUARSA? = keadaan SEMENTARA yang udah lewat >18 jam (mis "kapal stuck", "belum datang"). Anggap KEMUNGKINAN sudah selesai/berubah sekarang. Jawab gini: "Per [waktu] [status], tapi itu udah [lama] — kemungkinan sekarang udah beres, kecuali ada update terbaru." JANGAN klaim masih berlaku.
- Kalau ada info LEBIH BARU di RECENT CONVERSATION, itu menang atas fakta lama.\n`;
}

function listFacts(chatId, limit = 30) {
  return db.prepare("SELECT * FROM qa_facts WHERE chat_id=? ORDER BY fact_ts DESC LIMIT ?").all(chatId, limit);
}
function deleteFact(id) { return db.prepare("DELETE FROM qa_facts WHERE id=?").run(id).changes > 0; }

function startQaLearner() {
  if (!GROQ_KEY) { console.log("[QA] GROQ_API_KEY missing — Q&A learner off"); return; }
  setTimeout(runQaTick, 90 * 1000);
  setInterval(runQaTick, INTERVAL_MS);
  console.log(`✅ Q&A learner started (every ${INTERVAL_MS / 60000}min, model=${EXTRACT_MODEL})`);
}

module.exports = { startQaLearner, runQaTick, extractFacts, upsertFact, searchFacts, buildFactContext, listFacts, deleteFact };
