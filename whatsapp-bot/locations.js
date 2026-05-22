const { db } = require("./storage");
const aliases = require("./aliases");

// Shared-location memory: who shared where + named waypoints. Reasoning is local math (no tokens).
const LIVE_HOURS = parseFloat(process.env.LIVE_LOC_HOURS || "8");
const DEFAULT_RADIUS_KM = parseFloat(process.env.WAYPOINT_RADIUS_KM || "1");

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
    radius_km REAL DEFAULT 1,
    ts INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    name_key TEXT UNIQUE,
    stops TEXT,
    ts INTEGER DEFAULT (strftime('%s','now'))
  );
`);
try { db.exec("ALTER TABLE waypoints ADD COLUMN radius_km REAL DEFAULT 1"); } catch {}

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
  let tokens = q.split(" ").filter(t => t.length >= 3 && !["kep", "pak", "bu", "bang", "mas", "kapten", "lokasi", "posisi", "dimana", "mana", "share", "live"].includes(t));
  const aliasJids = [];
  for (const tgt of aliases.expandTargets(query)) {        // "kep Agus" -> real account
    if (/@/.test(tgt)) aliasJids.push(tgt);
    else tokens.push(...tgt.split(" ").filter(x => x.length >= 3));
  }
  tokens = [...new Set(tokens)];
  if (!tokens.length && !aliasJids.length) return null;
  try {
    const rows = db.prepare(`SELECT * FROM locations ${chatId ? "WHERE chat_id=?" : ""} ORDER BY ts DESC LIMIT 200`).all(...(chatId ? [chatId] : []));
    for (const r of rows) {
      const name = r.sender_key || "";
      if (tokens.some(t => name.includes(t))) return r;
      if (aliasJids.length && r.sender_jid && aliasJids.some(j => r.sender_jid.includes(j.split("@")[0]))) return r;
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

// Waypoint whose radius CONTAINS the point (closest one if several overlap). null if outside all.
function waypointAt(lat, lng) {
  let best = null, bestD = Infinity;
  for (const w of listWaypoints()) {
    const d = haversineKm(lat, lng, w.lat, w.lng);
    const r = w.radius_km || DEFAULT_RADIUS_KM;
    if (d <= r && d < bestD) { bestD = d; best = w; }
  }
  return best ? { waypoint: best, distanceKm: bestD } : null;
}

function addWaypoint(name, lat, lng, radiusKm = null) {
  const key = norm(name);
  if (!key) return null;
  try {
    db.prepare(`INSERT INTO waypoints (name, name_key, lat, lng, radius_km) VALUES (?,?,?,?,?)
      ON CONFLICT(name_key) DO UPDATE SET lat=excluded.lat, lng=excluded.lng,
        radius_km=COALESCE(excluded.radius_km, radius_km), ts=strftime('%s','now')`).run(name, key, lat, lng, radiusKm);
    return db.prepare("SELECT * FROM waypoints WHERE name_key=?").get(key);
  } catch (err) { console.error("[LOC] addWaypoint:", err.message); return null; }
}
function setRadius(name, radiusKm) {
  try { return db.prepare("UPDATE waypoints SET radius_km=? WHERE name_key=?").run(radiusKm, norm(name)).changes > 0; }
  catch { return false; }
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

// Latest location per person (so the map shows current positions, not stale history points).
function latestPerSender(limit = 100) {
  const rows = recentLocations(null, 2000); // ts DESC
  const seen = new Map();
  for (const r of rows) {
    const key = r.sender_key || (r.sender_name || "").toLowerCase() || r.sender_jid || "?";
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()].slice(0, limit);
}

// Last N points of one person (oldest→newest) for direction reasoning.
function getTrack(jid, chatId = null, limit = 8) {
  try {
    const rows = db.prepare(`SELECT lat,lng,ts FROM locations WHERE sender_jid=? ${chatId ? "AND chat_id=?" : ""} ORDER BY ts DESC LIMIT ?`).all(...(chatId ? [jid, chatId, limit] : [jid, limit]));
    return rows.reverse();
  } catch { return []; }
}

const ARRIVE_KM = parseFloat(process.env.WAYPOINT_ARRIVE_KM || "0.4");

// Where is he + heading? Compare current vs oldest point in window against named waypoints.
function movementAnalysis(points) {
  if (!points || !points.length) return null;
  const cur = points[points.length - 1];
  const nearest = nearestWaypoint(cur.lat, cur.lng);
  const inside = waypointAt(cur.lat, cur.lng);   // inside a waypoint's radius?
  const out = { current: cur, nearest, inside, arrived: null, approaching: null, leaving: null, moved: false };
  if (inside) out.arrived = inside.waypoint;
  if (points.length >= 2) {
    const ref = points[0];
    out.moved = haversineKm(ref.lat, ref.lng, cur.lat, cur.lng) > 0.2;
    if (out.moved && !out.arrived) {
      let appDelta = -0.2, leaveDelta = 0.2;
      for (const w of listWaypoints()) {
        const dNow = haversineKm(cur.lat, cur.lng, w.lat, w.lng);
        const dRef = haversineKm(ref.lat, ref.lng, w.lat, w.lng);
        const delta = dNow - dRef;            // <0 mendekat, >0 menjauh
        if (delta < appDelta) { appDelta = delta; out.approaching = w; }
        if (delta > leaveDelta && dRef < 6) { leaveDelta = delta; out.leaving = w; }
      }
    }
  }
  return out;
}

function movementPhrase(a) {
  if (!a) return "";
  if (a.arrived) return `sudah sampai/berada di ${a.arrived.name}`;
  if (a.leaving && a.approaching && a.leaving.name !== a.approaching.name) return `habis dari ${a.leaving.name}, lagi menuju ${a.approaching.name}`;
  if (a.approaching) return `lagi menuju ${a.approaching.name}`;
  if (a.nearest) return `${a.moved ? "bergerak, " : ""}dekat ${a.nearest.waypoint.name} (~${a.nearest.distanceKm.toFixed(1)} km)`;
  return "";
}

// ── Routes: ordered waypoint sequences (A→B→C) so order is unambiguous ──
function addRoute(name, stopNames) {
  const key = norm(name);
  if (!key || !Array.isArray(stopNames) || stopNames.length < 2) return null;
  const stopKeys = [];
  for (const s of stopNames) {
    const wk = norm(s);
    const w = db.prepare("SELECT name_key FROM waypoints WHERE name_key=?").get(wk);
    if (!w) return { error: `titik "${s}" belum ada (tambah dulu via /titik add)` };
    stopKeys.push(wk);
  }
  try {
    db.prepare(`INSERT INTO routes (name, name_key, stops) VALUES (?,?,?)
      ON CONFLICT(name_key) DO UPDATE SET name=excluded.name, stops=excluded.stops, ts=strftime('%s','now')`).run(name, key, JSON.stringify(stopKeys));
    return getRoute(name);
  } catch (err) { console.error("[LOC] addRoute:", err.message); return null; }
}
function getRoute(name) {
  const r = db.prepare("SELECT * FROM routes WHERE name_key=?").get(norm(name));
  return r ? hydrateRoute(r) : null;
}
function listRoutes() {
  try { return db.prepare("SELECT * FROM routes ORDER BY name").all().map(hydrateRoute); } catch { return []; }
}
function deleteRoute(name) {
  try { return db.prepare("DELETE FROM routes WHERE name_key=?").run(norm(name)).changes > 0; } catch { return false; }
}
function hydrateRoute(r) {
  let keys = [];
  try { keys = JSON.parse(r.stops || "[]"); } catch {}
  const stops = keys.map(k => db.prepare("SELECT * FROM waypoints WHERE name_key=?").get(k)).filter(Boolean);
  return { id: r.id, name: r.name, name_key: r.name_key, stops };
}

// Pick the route whose stops include the person's nearest waypoint (the route they're likely on).
function activeRouteFor(lat, lng) {
  const near = nearestWaypoint(lat, lng);
  if (!near) return null;
  const routes = listRoutes();
  for (const rt of routes) {
    if (rt.stops.some(s => s.name_key === near.waypoint.name_key)) return rt;
  }
  return routes.length === 1 ? routes[0] : null;
}

// Route-aware: from/to stop with sequence numbers, so places aren't confused.
function analyzeRoute(points, stops) {
  if (!points.length || !stops || stops.length < 2) return null;
  const cur = points[points.length - 1], ref = points[0];
  let ni = 0, nd = Infinity;
  stops.forEach((w, i) => { const d = haversineKm(cur.lat, cur.lng, w.lat, w.lng); if (d < nd) { nd = d; ni = i; } });
  if (nd <= ARRIVE_KM) return { arrived: true, atIndex: ni, atStop: stops[ni], stops };
  let app = null, appD = -0.2, lv = null, lvD = 0.2;
  stops.forEach((w, i) => {
    const dNow = haversineKm(cur.lat, cur.lng, w.lat, w.lng);
    const dRef = haversineKm(ref.lat, ref.lng, w.lat, w.lng);
    const delta = dNow - dRef;
    if (delta < appD) { appD = delta; app = { w, i }; }
    if (delta > lvD && dRef < 8) { lvD = delta; lv = { w, i }; }
  });
  return { arrived: false, approaching: app, leaving: lv, nearestIndex: ni, stops };
}
function routePhrase(a) {
  if (!a) return "";
  if (a.arrived) return `sudah sampai di ${a.atStop.name} (titik ke-${a.atIndex + 1})`;
  if (a.leaving && a.approaching && a.leaving.i !== a.approaching.i)
    return `habis dari ${a.leaving.w.name} (titik ${a.leaving.i + 1}), menuju ${a.approaching.w.name} (titik ${a.approaching.i + 1})`;
  if (a.approaching) return `menuju ${a.approaching.w.name} (titik ${a.approaching.i + 1})`;
  return "";
}

function fmtWIB(ts) {
  try { return new Date(ts * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); }
  catch { return "?"; }
}

// Context for the model when someone asks where a person is.
function buildLocationContext(loc) {
  if (!loc) return "";
  const expired = isExpired(loc);
  const inside = waypointAt(loc.lat, loc.lng);
  const near = nearestWaypoint(loc.lat, loc.lng);
  const ageH = (Date.now() / 1000 - loc.ts) / 3600;
  let s = `\n\n📍 LOKASI TERPELAJAR — ${loc.sender_name || "?"}:\n`;
  s += `• Koordinat: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.place_name ? ` (${loc.place_name})` : ""}\n`;
  s += `• Tipe: ${loc.is_live ? "live" : "pin"}${loc.is_live ? (expired ? " (SUDAH EXPIRED)" : " (masih aktif)") : ""}\n`;
  s += `• Waktu: ${fmtWIB(loc.ts)} WIB (${ageH < 1 ? "barusan" : ageH < 18 ? Math.round(ageH) + " jam lalu" : Math.round(ageH / 24) + " hari lalu"})\n`;
  if (inside) s += `• Posisi: BERADA DI ${inside.waypoint.name} (masuk radius ${inside.waypoint.radius_km || 1}km)\n`;
  else if (near) s += `• Titik terdekat: ${near.waypoint.name} (~${near.distanceKm.toFixed(1)} km, DI LUAR radius)\n`;
  let onRoute = false;
  try {
    const track = getTrack(loc.sender_jid, loc.chat_id, 8);
    const route = activeRouteFor(loc.lat, loc.lng);
    if (route && route.stops.length >= 2) {
      onRoute = true;
      s += `• Rute "${route.name}": ${route.stops.map((w, i) => `${i + 1}.${w.name}`).join(" → ")}\n`;
      const rp = routePhrase(analyzeRoute(track, route.stops));
      if (rp) s += `• Posisi di rute: ${rp}\n`;
    }
    const phrase = movementPhrase(movementAnalysis(track));
    if (phrase) s += `• Pergerakan: ${phrase}\n`;
  } catch {}
  s += `Cara jawab: sebut posisi (pakai "Posisi di rute"/"Pergerakan": lagi dimana + menuju titik mana, sebut urutannya) + waktu. Kalau live EXPIRED → "ini titik terakhir per [waktu], bukan posisi live sekarang".\n`;
  if (onRoute) s += `PP/lanjutan: kalau orang ini udah di titik TERAKHIR rute lalu kirim caption/pesan "otw <tempat>" (gambar/video/teks), anggap dia MULAI leg berikutnya/balik menuju <tempat> dari titik terakhir. Pakai urutan rute biar gak ketuker tempat.\n`;
  s += `Kalau ada info lebih baru di chat (mis caption "otw X"), itu menang atas titik lama.\n`;
  s += `Kalau user minta dikirimin lokasinya, akhiri output dengan marker: [SEND_LOCATION: ${loc.lat},${loc.lng} | ${loc.sender_name || "lokasi"}]\n`;
  return s;
}

module.exports = {
  saveLocation, latestForName, latestForJid, isExpired, haversineKm, nearestWaypoint, waypointAt, setRadius,
  addWaypoint, listWaypoints, deleteWaypoint, recentLocations, latestPerSender, buildLocationContext, norm,
  getTrack, movementAnalysis, movementPhrase,
  addRoute, getRoute, listRoutes, deleteRoute, activeRouteFor, analyzeRoute, routePhrase
};
