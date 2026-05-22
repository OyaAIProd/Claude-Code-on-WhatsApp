const { db } = require("./storage");
const gemini = require("./gemini");
const vision = require("./vision");
const locations = require("./locations");
const aliases = require("./aliases");

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
// Timemark photos carry exact GPS + a handwritten label — store them.
for (const col of ["lat REAL", "lng REAL", "label TEXT"]) { try { db.exec(`ALTER TABLE tracking_events ADD COLUMN ${col}`); } catch {} }

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
      (chat_id, chat_name, subject_type, subject_name, subject_key, action, dari, ke, via, via_key, time_on_media, place, goods_desc, lat, lng, label, confidence, source_sender, media_path, ts)
      VALUES (@chat_id,@chat_name,@subject_type,@subject_name,@subject_key,@action,@dari,@ke,@via,@via_key,@time_on_media,@place,@goods_desc,@lat,@lng,@label,@confidence,@source_sender,@media_path,@ts)`).run({
      chat_id: e.chat_id || "", chat_name: e.chat_name || "",
      subject_type: e.subject_type || "lainnya",
      subject_name: e.subject_name, subject_key: canon(e.subject_name),
      action: e.action || null, dari: e.dari || null, ke: e.ke || null,
      via: e.via || null, via_key: e.via ? canon(e.via) : null,
      time_on_media: e.time_on_media || null, place: e.place || null,
      goods_desc: e.goods_desc || null,
      lat: typeof e.lat === "number" ? e.lat : null, lng: typeof e.lng === "number" ? e.lng : null, label: e.label || null,
      confidence: e.confidence != null ? e.confidence : 0.7,
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

const EXTRACT_PROMPT = `Ini foto dari grup operasional logistik/pelayaran. KEBANYAKAN foto dibuat pakai app TIMEMARK (geotag) — ada OVERLAY berisi:
- Jam absensi (mis "Absensi 03:33") + tanggal (mis "Jumat, 22/05/2026")
- Nama lokasi (kecamatan/kabupaten, mis "Pulau Burung, Kec. Pulau Burung, Indragiri Hilir, Riau")
- KOORDINAT GPS (mis "0.429595°N, 103.542709°E")
- cuaca + peta kecil di pojok
Di TENGAH biasanya ada BARANG/paket, sering ada TULISAN TANGAN di kertas/karung (label asal/tujuan, mis "Pelangiran").

WAJIB baca SEMUA: jam, tanggal, koordinat (jadi angka desimal: N/E positif, S/W negatif), nama lokasi, tulisan tangan, jenis barang.
Output JSON ARRAY SAJA (tanpa markdown):
[{"subject_type":"kapal|orang|barang|kendaraan|lokasi|lainnya","subject_name":"nama spesifik (mis 'barang','KM Ramli','kep Awi')","action":"berangkat|sampai|transit|muat|bongkar|terlihat|null","dari":"asal else ''","ke":"tujuan else ''","via":"pembawa/perantara else ''","time_on_media":"jam + tanggal overlay (mis '03:33 Jumat 22/05/2026') else ''","place":"nama lokasi overlay else ''","lat":<angka koordinat overlay atau null>,"lng":<angka atau null>,"label":"tulisan tangan di barang (mis 'Pelangiran') else ''","goods_desc":"ciri barang else ''"}]
Kalau cuma satu hal, array 1 elemen. Bahasa Indonesia.`;

function num(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }

// Optional Antigravity CLI engine. Inert unless ANTIGRAVITY_BIN is set (it isn't installed yet).
// When you install it, set in .env: ANTIGRAVITY_BIN=antigravity  (and ANTIGRAVITY_ARGS if flags differ).
function antigravityDescribe(imagePath, prompt) {
  return new Promise((resolve) => {
    const bin = process.env.ANTIGRAVITY_BIN;
    if (!bin) return resolve("");
    const { spawn } = require("child_process");
    const path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
    let dir, rel;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag_"));
      rel = `img_${crypto.randomBytes(4).toString("hex")}${path.extname(imagePath) || ".jpg"}`;
      fs.copyFileSync(imagePath, path.join(dir, rel));
    } catch { return resolve(""); }
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
    const safe = String(prompt).replace(/"/g, "'").replace(/[\r\n]+/g, " ");
    const argsTpl = process.env.ANTIGRAVITY_ARGS || `-p "{prompt} @{file}"`;
    const cmd = `${bin} ${argsTpl.replace("{prompt}", safe).replace("{file}", rel)}`;
    let out = "", done = false;
    const fin = (v) => { if (!done) { done = true; cleanup(); resolve(v); } };
    try {
      const p = spawn(cmd, { cwd: dir, env: process.env, shell: true });
      const to = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} fin(""); }, 120000);
      p.stdout.on("data", d => { out += d.toString(); });
      p.on("error", () => { clearTimeout(to); fin(""); });
      p.on("close", () => { clearTimeout(to); fin(out.trim()); });
    } catch { fin(""); }
  });
}

// Extract structured events from an image. Groq first (fast); Gemini fallback (more accurate).
async function extractFromImage(imagePath, { caption = "", chatId, chatName, senderName, ts } = {}) {
  const prompt = caption ? `${EXTRACT_PROMPT}\nCAPTION user (PRIORITAS, pakai untuk isi field): "${caption}"` : EXTRACT_PROMPT;
  // Robust engine chain — try each, use first that returns parseable JSON. One engine's failure
  // (e.g. Groq 429 limit) never blocks the others.
  const engines = [
    { name: "groq", avail: () => true, fn: () => vision.describeImage(imagePath, { prompt, caption }) },
    { name: "antigravity", avail: () => !!process.env.ANTIGRAVITY_BIN, fn: () => antigravityDescribe(imagePath, prompt) },
    { name: "gemini", avail: () => gemini.available(), fn: () => gemini.describe(imagePath, prompt) }
  ];
  let raw = "", used = "";
  for (const e of engines) {
    try {
      if (!e.avail()) continue;
      const r = await e.fn();
      if (r && parseJsonArray(r).length) { raw = r; used = e.name; break; }
      if (r && !raw) raw = r;             // keep best-effort text even if not JSON
    } catch (err) { console.error(`[EVENT] ${e.name} gagal:`, err.message); }
  }
  if (used) console.log(`[EVENT] vision via ${used}`);
  const arr = parseJsonArray(raw);
  const saved = [];
  for (const ev of arr) {
    if (!ev || !ev.subject_name) continue;
    const lat = num(ev.lat), lng = num(ev.lng);
    // If GPS falls inside a named waypoint's radius, use the canonical waypoint as place.
    let place = ev.place;
    if (lat != null && lng != null) {
      const wp = locations.waypointAt(lat, lng);
      if (wp) place = wp.waypoint.name;
    }
    const id = addEvent({
      chat_id: chatId, chat_name: chatName, subject_type: ev.subject_type, subject_name: ev.subject_name,
      action: ev.action && ev.action !== "null" ? ev.action : null,
      dari: ev.dari, ke: ev.ke, via: ev.via, time_on_media: ev.time_on_media, place,
      goods_desc: ev.goods_desc, lat, lng, label: ev.label, source_sender: senderName, media_path: imagePath, ts
    });
    if (id) saved.push({ id, ...ev, lat, lng });
    // Photo carries exact GPS → also a location point (map + location reasoning, no WA live-share needed).
    if (lat != null && lng != null) {
      try {
        locations.saveLocation({
          chat_id: chatId, chat_name: chatName, sender_jid: null, sender_name: senderName,
          lat, lng, place_name: ev.place || ev.label || null, is_live: 0, ts
        });
      } catch {}
    }
  }
  // Human-readable summary (used as vision_desc for general recall/FTS).
  const summary = saved.length
    ? saved.map(e => `${e.subject_name}${e.action && e.action !== "null" ? " " + e.action : ""}${e.dari || e.ke ? ` ${e.dari || "?"}→${e.ke || "?"}` : ""}${e.via ? " via " + e.via : ""}${e.place ? " @" + e.place : ""}${e.time_on_media ? ` (jam ${e.time_on_media})` : ""}${e.goods_desc ? ` [${e.goods_desc}]` : ""}`).join("; ")
    : (raw || "").replace(/```json|```/gi, " ").replace(/\s+/g, " ").trim().slice(0, 400);
  if (saved.length) console.log(`[EVENT] +${saved.length} dari foto ${senderName || ""}`);
  return { events: saved, rawDesc: raw, summary };
}

// Timeline of one entity (matches subject OR via), newest first.
function queryTimeline(subjectQuery, { chatId = null, limit = 8 } = {}) {
  const key = canon(subjectQuery);
  if (!key) return [];
  // token-contains match so "kapal ramli"/"km ramli"/"ramli" all hit
  let toks = key.split(" ").filter(t => t.length >= 3);
  // expand with alias targets ("kep Agus" -> real account name tokens)
  for (const t of aliases.expandTargets(subjectQuery)) toks.push(...t.split(" ").filter(x => x.length >= 3));
  toks = [...new Set(toks)];
  if (!toks.length) return [];
  try {
    const rows = db.prepare(`SELECT * FROM tracking_events ${chatId ? "WHERE chat_id=?" : ""} ORDER BY ts DESC LIMIT 400`).all(...(chatId ? [chatId] : []));
    const hit = rows.filter(r => {
      // match subject, via (carrier), OR the person who posted it (so "kep Risky" finds his photos)
      const hay = `${r.subject_key || ""} ${r.via_key || ""} ${canon(r.source_sender || "")}`;
      return toks.some(t => hay.includes(t));
    });
    return hit.slice(0, limit);
  } catch (err) { console.error("[EVENT] timeline:", err.message); return []; }
}

function relAge(ts) {
  const h = (Date.now() / 1000 - ts) / 3600;
  if (h < 1) return "barusan";
  if (h < 18) return `${Math.round(h)} jam lalu`;
  if (h < 42) return "kemarin";
  return `${Math.round(h / 24)} hari lalu`;
}
function fmtWIB(ts) {
  try { return new Date(ts * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); }
  catch { return "?"; }
}

// Infer current status from a timeline (oldest→newest), incl arrival (explicit=certain, repeat=probable).
function inferStatus(timelineDesc) {
  const ev = [...timelineDesc].sort((a, b) => a.ts - b.ts);
  if (!ev.length) return null;
  const dep = [...ev].reverse().find(e => e.action === "berangkat");
  // explicit arrival after departure
  const explicitArr = ev.find(e => e.action === "sampai" && (!dep || e.ts >= dep.ts));
  if (explicitArr) return { kind: "arrived_certain", at: explicitArr.place || explicitArr.ke || (dep && dep.ke), event: explicitArr, dep };
  if (dep) {
    // repeat-shipment heuristic: a later event (same via, or goods at destination) after departure
    const dest = dep.ke;
    const later = ev.find(e => e.ts > dep.ts && (
      (dest && (canon(e.place || "") === canon(dest) || canon(e.ke || "") === canon(dest))) ||
      (e.via_key && dep.via_key && e.via_key === dep.via_key && e.goods_desc)
    ));
    if (later) return { kind: "arrived_probable", at: later.place || dest, event: later, dep, reason: "foto/barang terkait muncul lagi setelah berangkat" };
    return { kind: "in_transit", dep };
  }
  return { kind: "seen", event: ev[ev.length - 1] };
}

// STATUS block injected to Claude (deterministic pre-resolver output).
function buildStatusContext(subjectQuery, chatId = null) {
  const tl = queryTimeline(subjectQuery, { chatId, limit: 10 });
  if (!tl.length) return "";
  const lines = [...tl].sort((a, b) => a.ts - b.ts).map(e => {
    const bits = [e.subject_name];
    if (e.action) bits.push(`*${e.action}*`);
    if (e.dari || e.ke) bits.push(`${e.dari || "?"}→${e.ke || "?"}`);
    if (e.via) bits.push(`via ${e.via}`);
    if (e.place) bits.push(`@${e.place}`);
    if (e.time_on_media) bits.push(`jam-di-foto:${e.time_on_media}`);
    return `  - [${fmtWIB(e.ts)} WIB, ${relAge(e.ts)}] ${bits.join(" ")}${e.goods_desc ? ` (${e.goods_desc})` : ""}`;
  });
  const st = inferStatus(tl);
  let hint = "";
  if (st) {
    if (st.kind === "arrived_certain") hint = `STATUS: SUDAH SAMPAI di ${st.at || "tujuan"} (eksplisit/pasti).`;
    else if (st.kind === "arrived_probable") hint = `STATUS: KEMUNGKINAN sudah sampai di ${st.at || "tujuan"} — ${st.reason}. Sebut sebagai dugaan ("kemungkinan sudah sampai, soalnya...").`;
    else if (st.kind === "in_transit") hint = `STATUS: dalam perjalanan ${st.dep.dari || "?"}→${st.dep.ke || "?"} via ${st.dep.via || "?"} (berangkat ${relAge(st.dep.ts)}). Belum ada konfirmasi sampai.`;
    else hint = `STATUS: terlihat terakhir; belum ada event berangkat/sampai jelas.`;
  }
  // Newest event with a place = current-position signal (the "secondary support" from photos).
  const withPlace = [...tl].sort((a, b) => b.ts - a.ts).find(e => e.place);
  let posisi = "";
  if (withPlace) posisi = `POSISI TERKINI (dari foto/event terbaru): ${withPlace.place} per ${fmtWIB(withPlace.ts)} WIB (${relAge(withPlace.ts)}).`;
  return `\n\n🚢 EVENT TIMELINE (dari foto/caption grup — JAWAB dari sini, sebut jam + alasan):\n${lines.join("\n")}\n${hint}\n${posisi}\nAturan: jam-di-foto = waktu kejadian. "kemungkinan" = jangan klaim pasti. TUMPUAN KEDUA: kalau share-lokasi GPS orang ini udah EXPIRED tapi ada FOTO/event lebih baru di tempat lain (mis "barang turun di Pelangiran"), pakai tempat dari foto sebagai posisi terkini — foto/event yang lebih baru MENANG atas GPS expired.\n`;
}

module.exports = { addEvent, extractFromImage, queryTimeline, canon, parseJsonArray, EXTRACT_PROMPT, inferStatus, buildStatusContext };
