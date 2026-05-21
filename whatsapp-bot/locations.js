const { db } = require("./storage");

// Shared-location memory: who shared where + named waypoints. Reasoning is local math (no tokens).
const LIVE_HOURS = parseFloat(process.env.LIVE_LOC_HOURS || "8");

db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    chat_name TEXT,
    sender_jid TEXT,
    sender_name TEXT,
    sender_key TEXT,
    lat REAL,
    lng REAL,
    place_name TEXT,
    is_live INTEGER DEFAULT 0,
    live_expires_at INTEGER,
    ts INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_loc_key ON locations(sender_key, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_loc_chat ON locations(chat_id, ts DESC);
  CREATE TABLE IF NOT EXISTS waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    name_key TEXT UNIQUE,
    lat REAL,
    lng REAL,
    ts INTEGER DEFAULT (strftime('%s','now'))
  );
`);

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function saveLocation({ chat_id, chat_name, sender_jid, sender_name, lat, lng, place_name = null, is_live = 0, live_expires_at = null, ts }) {
  if (typeof lat !== "number" || typeof lng !== "number") return;
  try {
    db.prepare(`INSERT INTO locations (chat_id, chat_name, sender_jid, sender_name, sender_key, lat, lng, place_name, is_live, live_expires_at, ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      chat_id, chat_name || "", sender_jid, sender_name || "", norm(sender_name), lat, lng, place_name,
      is_live ? 1 : 0,
      live_expires_at || (is_live ? Math.floor((ts || Date.now() / 1000)) + Math.round(LIVE_HOURS * 3600) : null),
      ts || Math.floor(Date.now() / 1000)
    );
  } catch (err) { console.error("[LOC] save:", err.message); }
}

// Find the most recent shared location for a person named in the query (fuzzy on sender_name).
function latestForName(query, chatId = null) {
  const q = norm(query);
  if (!q) return null;
  const tokens = q.split(" ").filter(t => t.length >= 3 && !["kep", "pak", "bu", "bang", "mas", "kapten", "lokasi", "posisi", "dimana", "mana", "share", "live"].includes(t));
  if (!tokens.length) return null;
  try {
    const rows = db.prepare(`SELECT * FROM locations ${chatId ? "WHERE chat_id=?" : ""} ORDER BY ts DESC LIMIT 200`).all(...(chatId ? [chatId] : []));
    for (const r of rows) {
      const name = r.sender_key || "";
      if (tokens.some(t => name.includes(t))) return r;
    }
  } catch (err) { console.error("[LOC] latestForName:", err.message); }
  return null;
}

function latestForJid(jid, chatId = null) {
  try {
    return db.prepare(`SELECT * FROM locations WHERE sender_jid=? ${chatId ? "AND chat_id=?" : ""} ORDER BY ts DESC LIMIT 1`).get(...(chatId ? [jid, chatId] : [jid]));
  } catch { return null; }
}

function isExpired(loc) {
  if (!loc) return true;
  if (!loc.is_live) return false; // static pins don't expire
  return loc.live_expires_at ? (Date.now() / 1000 > loc.live_expires_at) : false;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestWaypoint(lat, lng) {
  const wps = listWaypoints();
  if (!wps.length) return null;
  let best = null, bestD = Infinity;
  for (const w of wps) {
    const d = haversineKm(lat, lng, w.lat, w.lng);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best ? { waypoint: best, distanceKm: bestD } : null;
}

function addWaypoint(name, lat, lng) {
  const key = norm(name);
  if (!key) return null;
  try {
    db.prepare(`INSERT INTO waypoints (name, name_key, lat, lng) VALUES (?,?,?,?)
      ON CONFLICT(name_key) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, ts=strftime('%s','now')`).run(name, key, lat, lng);
    return db.prepare("SELECT * FROM waypoints WHERE name_key=?").get(key);
  } catch (err) { console.error("[LOC] addWaypoint:", err.message); return null; }
}
function listWaypoints() {
  try { return db.prepare("SELECT * FROM waypoints ORDER BY name").all(); } catch { return []; }
}
function deleteWaypoint(name) {
  try { return db.prepare("DELETE FROM waypoints WHERE name_key=?").run(norm(name)).changes > 0; } catch { return false; }
}
function recentLocations(chatId = null, limit = 50) {
  try {
    return db.prepare(`SELECT * FROM locations ${chatId ? "WHERE chat_id=?" : ""} ORDER BY ts DESC LIMIT ?`).all(...(chatId ? [chatId, limit] : [limit]));
  } catch { return []; }
}

function fmtWIB(ts) {
  try { return new Date(ts * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); }
  catch { return "?"; }
}

// Context for the model when someone asks where a person is.
function buildLocationContext(loc) {
  if (!loc) return "";
  const expired = isExpired(loc);
  const near = nearestWaypoint(loc.lat, loc.lng);
  const ageH = (Date.now() / 1000 - loc.ts) / 3600;
  let s = `\n\n📍 LOKASI TERPELAJAR — ${loc.sender_name || "?"}:\n`;
  s += `• Koordinat: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.place_name ? ` (${loc.place_name})` : ""}\n`;
  s += `• Tipe: ${loc.is_live ? "live" : "pin"}${loc.is_live ? (expired ? " (SUDAH EXPIRED)" : " (masih aktif)") : ""}\n`;
  s += `• Waktu: ${fmtWIB(loc.ts)} WIB (${ageH < 1 ? "barusan" : ageH < 18 ? Math.round(ageH) + " jam lalu" : Math.round(ageH / 24) + " hari lalu"})\n`;
  if (near) s += `• Titik terdekat: ${near.waypoint.name} (~${near.distanceKm.toFixed(1)} km)\n`;
  s += `Cara jawab: sebut posisi terakhir + waktu + titik terdekat. Kalau live EXPIRED, bilang "ini titik terakhir per [waktu], bukan posisi live sekarang". Kalau ada info lebih baru di chat (mis caption "otw X"), pakai itu.\n`;
  s += `Kalau user minta dikirimin lokasinya, akhiri output dengan marker: [SEND_LOCATION: ${loc.lat},${loc.lng} | ${loc.sender_name || "lokasi"}]\n`;
  return s;
}

module.exports = {
  saveLocation, latestForName, latestForJid, isExpired, haversineKm, nearestWaypoint,
  addWaypoint, listWaypoints, deleteWaypoint, recentLocations, buildLocationContext, norm
};
