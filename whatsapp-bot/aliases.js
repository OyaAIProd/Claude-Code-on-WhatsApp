const { db } = require("./storage");

// Person aliases: map a group nickname ("kep Agus") to the real WhatsApp account
// (pushName / number), so questions by nickname resolve to that person's events & locations.
db.exec(`
  CREATE TABLE IF NOT EXISTS person_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias_key TEXT UNIQUE,
    alias TEXT,
    target_name TEXT,
    target_key TEXT,
    target_jid TEXT,
    ts INTEGER DEFAULT (strftime('%s','now'))
  );
`);

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function setAlias(alias, targetName, targetJid = null) {
  const aliasKey = norm(alias);
  if (!aliasKey || !(targetName || targetJid)) return null;
  try {
    db.prepare(`INSERT INTO person_aliases (alias_key, alias, target_name, target_key, target_jid) VALUES (?,?,?,?,?)
      ON CONFLICT(alias_key) DO UPDATE SET target_name=excluded.target_name, target_key=excluded.target_key, target_jid=excluded.target_jid, ts=strftime('%s','now')`)
      .run(aliasKey, alias, targetName || null, norm(targetName), targetJid || null);
    return db.prepare("SELECT * FROM person_aliases WHERE alias_key=?").get(aliasKey);
  } catch (err) { console.error("[ALIAS] set:", err.message); return null; }
}

function listAliases() {
  try { return db.prepare("SELECT * FROM person_aliases ORDER BY alias").all(); } catch { return []; }
}
function deleteAlias(alias) {
  try { return db.prepare("DELETE FROM person_aliases WHERE alias_key=?").run(norm(alias)).changes > 0; } catch { return false; }
}

// Given a query, return extra search terms (target name keys + jids) for any alias mentioned in it.
function expandTargets(queryText) {
  const q = norm(queryText);
  if (!q) return [];
  const out = [];
  try {
    for (const a of listAliases()) {
      if (a.alias_key && q.includes(a.alias_key)) {
        if (a.target_key) out.push(a.target_key);
        if (a.target_jid) out.push(a.target_jid);
      }
    }
  } catch {}
  return [...new Set(out)];
}

module.exports = { setAlias, listAliases, deleteAlias, expandTargets, norm };
