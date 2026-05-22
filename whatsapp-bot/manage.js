// Self-management CLI — lets Claude change the bot's own data via Bash.
// Usage: node manage.js <domain> <action> [args...]
// Domains: alias | titik | rute | lesson | fact | skill
const aliases = require("./aliases");
const locations = require("./locations");
const events = require("./events");
const learning = require("./learning");
const qa = require("./qa_learning");
const skills = require("./skills_mod");

const [, , domain, action, ...a] = process.argv;
function out(o) { console.log(typeof o === "string" ? o : JSON.stringify(o)); }
const isNum = s => /^\+?\d[\d\s-]{5,}$/.test(String(s || "").trim());

try {
  switch (`${domain} ${action}`) {
    // ── ALIAS (nickname -> account) ──
    case "alias set": { // manage.js alias set "kep Agus" "riky 04"|628xxxx
      const [alias, target] = a;
      if (!alias || !target) { out("ERR: need <alias> <target>"); break; }
      const r = aliases.setAlias(alias, isNum(target) ? null : target, isNum(target) ? target.replace(/\D/g, "") + "@s.whatsapp.net" : null);
      out(r ? { ok: true, alias: r.alias, target: r.target_name || r.target_jid } : "ERR: fail");
      break;
    }
    case "alias del": { out({ ok: aliases.deleteAlias(a[0]) }); break; }
    case "alias list": { out(aliases.listAliases().map(x => ({ alias: x.alias, target: x.target_name || x.target_jid }))); break; }

    // ── TITIK (waypoint) ──
    case "titik set": { // titik set "saka jalan" -0.5 103.2 [radiusKm]
      const [name, lat, lng, r] = a;
      out(locations.addWaypoint(name, parseFloat(lat), parseFloat(lng), r ? parseFloat(r) : null) ? { ok: true } : "ERR");
      break;
    }
    case "titik radius": { out({ ok: locations.setRadius(a[0], parseFloat(a[1])) }); break; }
    case "titik del": { out({ ok: locations.deleteWaypoint(a[0]) }); break; }
    case "titik list": { out(locations.listWaypoints().map(w => ({ name: w.name, lat: w.lat, lng: w.lng, radius_km: w.radius_km }))); break; }

    // ── RUTE (ordered route) ──
    case "rute set": { // rute set "pelayaran" "pelangiran>saka jalan>pulau burung"
      const [name, stopsStr] = a;
      const stops = String(stopsStr || "").split(/[>,]/).map(s => s.trim()).filter(Boolean);
      const r = locations.addRoute(name, stops);
      out(r && r.error ? `ERR: ${r.error}` : (r ? { ok: true, stops: r.stops.map(s => s.name) } : "ERR"));
      break;
    }
    case "rute del": { out({ ok: locations.deleteRoute(a[0]) }); break; }
    case "rute list": { out(locations.listRoutes().map(r => ({ name: r.name, stops: r.stops.map(s => s.name) }))); break; }

    // ── LESSON ──
    case "lesson add": { out({ id: learning.saveLesson(a[0] || "global", { topicKey: a[1] || a[2], lesson: a[2] || a[1], scope: "global" }) }); break; }
    case "lesson del": { out({ ok: learning.deleteLesson(parseInt(a[0], 10)) }); break; }
    case "lesson list": { out(learning.listLessons(a[0] || "global", 50).map(l => ({ id: l.id, lesson: l.lesson }))); break; }

    // ── FACT (qa) ──
    case "fact del": { out({ ok: qa.deleteFact(parseInt(a[0], 10)) }); break; }
    case "fact list": { out(qa.listFacts(a[0] || "", 50).map(f => ({ id: f.id, subject: f.subject, status: f.status }))); break; }

    // ── SKILL ──
    case "skill del": { out({ ok: skills.deleteSkill(a[0]) }); break; }
    case "skill list": { out(skills.listSkills(50).map(s => ({ name: s.name }))); break; }

    default:
      out(`ERR: unknown "${domain} ${action}". Domains: alias|titik|rute|lesson|fact|skill. Actions: set/del/list/radius.`);
  }
} catch (e) { out(`ERR: ${e.message}`); }
