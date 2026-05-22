const { db } = require("./storage");
const gemini = require("./gemini");

// Structured event log: every photo/caption becomes one or more events on an entity timeline.
// Operational questions ("kapal X berangkat? sampai mana?") are answered from here, deterministically.
db.exec(`
  CREATE TABLE IF NOT EXISTS tracking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    chat_name TEXT,
    subject_type TEXT,
    subject_name TEXT,
    subject_key TEXT,
    action TEXT,
    dari TEXT,
    ke TEXT,
    via TEXT,
    via_key TEXT,
    time_on_media TEXT,
    place TEXT,
    goods_desc TEXT,
    confidence REAL,
    source_sender TEXT,
    media_path TEXT,
    ts INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_te_subject ON tracking_events(subject_key, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_te_via ON tracking_events(via_key, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_te_chat ON tracking_events(chat_id, ts DESC);
  CREATE VIRTUAL TABLE IF NOT EXISTS tracking_events_fts USING fts5(subject_name, via, dari, ke, place, goods_desc, content='tracking_events', content_rowid='id');
  CREATE TRIGGER IF NOT EXISTS te_ai AFTER INSERT ON tracking_events BEGIN
    INSERT INTO tracking_events_fts(rowid, subject_name, via, dari, ke, place, goods_desc)
      VALUES (new.id, new.subject_name, new.via, new.dari, new.ke, new.place, new.goods_desc);
  END;
  CREATE TRIGGER IF NOT EXISTS te_ad AFTER DELETE ON tracking_events BEGIN
    INSERT INTO tracking_events_fts(tracking_events_fts, rowid, subject_name, via, dari, ke, place, goods_desc)
      VALUES ('delete', old.id, old.subject_name, old.via, old.dari, old.ke, old.place, old.goods_desc);
  END;
`);

// Canonicalize entity names: drop honorifics/vessel prefixes for matching, keep display name.
const PREFIXES = /^(kapal|km|kmp|kep|kapten|pak|bu|bang|mas|mbak|sdr|tn|ny)\s+/i;
function canon(name) {
  let s = String(name || "").trim();
  let prev;
  do { prev = s; s = s.replace(PREFIXES, ""); } while (s !== prev);
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function addEvent(e) {
  if (!e || !e.subject_name) return null;
  try {
    const r = db.prepare(`INSERT INTO tracking_events
      (chat_id, chat_name, subject_type, subject_name, subject_key, action, dari, ke, via, via_key, time_on_media, place, goods_desc, confidence, source_sender, media_path, ts)
      VALUES (@chat_id,@chat_name,@subject_type,@subject_name,@subject_key,@action,@dari,@ke,@via,@via_key,@time_on_media,@place,@goods_desc,@confidence,@source_sender,@media_path,@ts)`).run({
      chat_id: e.chat_id || "", chat_name: e.chat_name || "",
      subject_type: e.subject_type || "lainnya",
      subject_name: e.subject_name, subject_key: canon(e.subject_name),
      action: e.action || null, dari: e.dari || null, ke: e.ke || null,
      via: e.via || null, via_key: e.via ? canon(e.via) : null,
      time_on_media: e.time_on_media || null, place: e.place || null,
      goods_desc: e.goods_desc || null, confidence: e.confidence != null ? e.confidence : 0.7,
      source_sender: e.source_sender || null, media_path: e.media_path || null,
      ts: e.ts || Math.floor(Date.now() / 1000)
    });
    return r.lastInsertRowid;
  } catch (err) { console.error("[EVENT] add:", err.message); return null; }
}

function parseJsonArray(text) {
  if (!text) return [];
  let t = text.replace(/```json|```/gi, " ");
  const m = t.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const arr = JSON.parse(m[0]); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

const EXTRACT_PROMPT = `Ini foto dari grup operasional logistik/pelayaran. Ekstrak SEMUA event yang terlihat atau tersirat di gambar. Output JSON ARRAY SAJA (tanpa penjelasan, tanpa markdown):
[{"subject_type":"kapal|orang|barang|kendaraan|lokasi|lainnya","subject_name":"nama spesifik (mis 'KM Ramli','kep Awi','barang sembako')","action":"berangkat|sampai|transit|muat|bongkar|terlihat|null","dari":"asal/kota else ''","ke":"tujuan else ''","via":"perantara/pembawa (mis 'kep Awi') else ''","time_on_media":"jam/tanggal yang TERTULIS di gambar (time-mark) else ''","place":"lokasi terlihat else ''","goods_desc":"ciri barang singkat else ''"}]
Wajib baca teks/angka/jam yang ADA di gambar. Kalau cuma satu hal, array 1 elemen. Bahasa Indonesia.`;

// Extract structured events from an image (via Gemini CLI). Caption is authoritative context.
async function extractFromImage(imagePath, { caption = "", chatId, chatName, senderName, ts } = {}) {
  if (!gemini.available()) return [];
  const prompt = caption ? `${EXTRACT_PROMPT}\nCAPTION user (PRIORITAS, pakai untuk isi field): "${caption}"` : EXTRACT_PROMPT;
  let raw = "";
  try { raw = await gemini.describe(imagePath, prompt); } catch (e) { console.error("[EVENT] gemini:", e.message); }
  const arr = parseJsonArray(raw);
  const saved = [];
  for (const ev of arr) {
    if (!ev || !ev.subject_name) continue;
    const id = addEvent({
      chat_id: chatId, chat_name: chatName, subject_type: ev.subject_type, subject_name: ev.subject_name,
      action: ev.action && ev.action !== "null" ? ev.action : null,
      dari: ev.dari, ke: ev.ke, via: ev.via, time_on_media: ev.time_on_media, place: ev.place,
      goods_desc: ev.goods_desc, source_sender: senderName, media_path: imagePath, ts
    });
    if (id) saved.push({ id, ...ev });
  }
  if (saved.length) console.log(`[EVENT] +${saved.length} dari foto ${senderName || ""}`);
  return { events: saved, rawDesc: raw };
}

// Timeline of one entity (matches subject OR via), newest first.
function queryTimeline(subjectQuery, { chatId = null, limit = 8 } = {}) {
  const key = canon(subjectQuery);
  if (!key) return [];
  // token-contains match so "kapal ramli"/"km ramli"/"ramli" all hit
  const toks = key.split(" ").filter(t => t.length >= 3);
  if (!toks.length) return [];
  try {
    const rows = db.prepare(`SELECT * FROM tracking_events ${chatId ? "WHERE chat_id=?" : ""} ORDER BY ts DESC LIMIT 400`).all(...(chatId ? [chatId] : []));
    const hit = rows.filter(r => {
      const hay = `${r.subject_key || ""} ${r.via_key || ""}`;
      return toks.some(t => hay.includes(t));
    });
    return hit.slice(0, limit);
  } catch (err) { console.error("[EVENT] timeline:", err.message); return []; }
}

module.exports = { addEvent, extractFromImage, queryTimeline, canon, parseJsonArray, EXTRACT_PROMPT };
