const { db } = require("./storage");
const fetch = global.fetch || require("node-fetch");

const GROQ_KEY = process.env.GROQ_API_KEY;
const EXTRACT_MODEL = process.env.GROQ_EXTRACT_MODEL || "llama-3.1-8b-instant";

db.exec(`
  CREATE TABLE IF NOT EXISTS visual_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    name TEXT,
    name_key TEXT,
    kind TEXT,
    features TEXT,
    last_location TEXT,
    last_seen_ts INTEGER,
    image_paths TEXT,
    mentions INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ve_chat ON visual_entities(chat_id);
  CREATE INDEX IF NOT EXISTS idx_ve_key ON visual_entities(chat_id, name_key);
`);

const STOP = new Set(["yang","dan","atau","itu","ini","ada","kep","pak","bu","bang","mas","mbak","kapten","kakak","abang","milik","punya","sudah","udah","dah","baru","saja","aja","sama","dengan","untuk","dari","sampai","tiba","datang","berangkat","pergi","jam","tadi","kemarin","nih","dong","kapal","truk","mobil","foto","gambar"]);

function nameKey(name) {
  return String(name || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenize(s) {
  return [...new Set(String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(t => t.length >= 3 && !STOP.has(t)))];
}

// Extract named entities + location from a caption via Groq (cheap, separate from Claude tokens).
async function extractFromCaption(caption) {
  if (!GROQ_KEY || !caption || caption.trim().length < 3) return { entities: [], location: null };
  const prompt = `Dari caption foto WhatsApp ini, ekstrak entitas bernama (orang/kapal/kendaraan/barang/tempat) dan lokasi. Output JSON SAJA tanpa markdown:
{"entities":[{"name":"<nama lengkap entitas, mis 'kapal kep Awi'>","kind":"<kapal|orang|kendaraan|barang|lokasi|lainnya>"}],"location":"<nama lokasi/tempat kalau disebut, else null>"}
Caption: "${caption.trim()}"`;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300, temperature: 0,
        response_format: { type: "json_object" }
      })
    });
    if (!res.ok) return { entities: [], location: null };
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const entities = Array.isArray(parsed.entities) ? parsed.entities.filter(e => e && e.name) : [];
    return { entities, location: parsed.location || null };
  } catch (err) {
    console.error("[ENTITY] extract:", err.message);
    return { entities: [], location: null };
  }
}

function upsertEntity(chatId, { name, kind, features, location, ts, imagePath }) {
  const key = nameKey(name);
  if (!key) return;
  try {
    const existing = db.prepare("SELECT * FROM visual_entities WHERE chat_id=? AND name_key=?").get(chatId, key);
    if (existing) {
      let paths = [];
      try { paths = JSON.parse(existing.image_paths || "[]"); } catch {}
      if (imagePath && !paths.includes(imagePath)) paths.push(imagePath);
      if (paths.length > 8) paths = paths.slice(-8);
      db.prepare(`UPDATE visual_entities SET
        name=?, kind=COALESCE(?,kind),
        features=CASE WHEN ?<>'' THEN ? ELSE features END,
        last_location=COALESCE(?,last_location),
        last_seen_ts=?, image_paths=?, mentions=mentions+1, updated_at=datetime('now')
        WHERE id=?`).run(
        name, kind || null,
        features || "", features || "",
        location || null,
        ts || Math.floor(Date.now() / 1000),
        JSON.stringify(paths), existing.id
      );
    } else {
      db.prepare(`INSERT INTO visual_entities (chat_id, name, name_key, kind, features, last_location, last_seen_ts, image_paths)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        chatId, name, key, kind || null, features || "", location || null,
        ts || Math.floor(Date.now() / 1000), JSON.stringify(imagePath ? [imagePath] : [])
      );
    }
  } catch (err) { console.error("[ENTITY] upsert:", err.message); }
}

// Best-effort: match a captionless image's vision description to a known entity by feature overlap.
function matchByFeatures(chatId, visionDesc, { minScore = 2 } = {}) {
  const qTokens = tokenize(visionDesc);
  if (qTokens.length < 2) return null;
  let rows = [];
  try { rows = db.prepare("SELECT * FROM visual_entities WHERE chat_id=? AND features IS NOT NULL AND features<>''").all(chatId); } catch { return null; }
  let best = null, bestScore = 0;
  for (const r of rows) {
    const fTokens = new Set(tokenize(r.features));
    let score = 0;
    for (const t of qTokens) if (fTokens.has(t)) score++;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (best && bestScore >= minScore) return { entity: best, score: bestScore };
  return null;
}

// For query injection: entities whose name appears in the query, else most-recently-seen ones.
function getRelevantEntities(chatId, userText, limit = 5) {
  let rows = [];
  try { rows = db.prepare("SELECT * FROM visual_entities WHERE chat_id=? ORDER BY last_seen_ts DESC").all(chatId); } catch { return []; }
  if (!rows.length) return [];
  const q = nameKey(userText);
  const named = rows.filter(r => r.name_key && q.includes(r.name_key));
  if (named.length) return named.slice(0, limit);
  return rows.slice(0, limit);
}

function buildEntityContext(entities) {
  if (!entities.length) return "";
  const lines = entities.map(e => {
    const when = e.last_seen_ts ? new Date(e.last_seen_ts * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "?";
    const loc = e.last_location ? ` | lokasi terakhir: ${e.last_location}` : "";
    const feat = e.features ? ` | ciri: ${e.features.replace(/\s+/g, " ").slice(0, 120)}` : "";
    return `• ${e.name} (${e.kind || "?"})${loc} | terakhir keliatan: ${when} WIB${feat}`;
  });
  return `\n\n🧩 MEMORI ENTITAS VISUAL (objek/orang/lokasi yang bot kenal dari foto+caption sebelumnya):\n${lines.join("\n")}\nPakai ini untuk jawab "X dimana / X gimana". Caption asli = prioritas. Pencocokan foto tanpa caption = perkiraan, sebut "kemungkinan".\n`;
}

module.exports = { extractFromCaption, upsertEntity, matchByFeatures, getRelevantEntities, buildEntityContext, nameKey };
