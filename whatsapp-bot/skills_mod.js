const { db } = require("./storage");
const { escapeFts } = require("./rag");

// Hermes-style reusable skills: the bot can save a procedure and auto-load it when a future
// task matches. Only the name+description are matched (cheap); full content injected on hit.
db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT DEFAULT 'global',
    chat_id TEXT,
    name TEXT,
    name_key TEXT UNIQUE,
    description TEXT,
    content TEXT,
    uses INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(name, description, content='skills', content_rowid='id');
  CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
    INSERT INTO skills_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
  END;
  CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
    INSERT INTO skills_fts(skills_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
  END;
  CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
    INSERT INTO skills_fts(skills_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
    INSERT INTO skills_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
  END;
`);

function nameKey(name) {
  return String(name || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function saveSkill({ name, description, content, chatId = null, scope = "global" }) {
  if (!name || !content) return null;
  const key = nameKey(name);
  if (!key) return null;
  try {
    const existing = db.prepare("SELECT id FROM skills WHERE name_key=?").get(key);
    if (existing) {
      db.prepare("UPDATE skills SET name=?, description=?, content=?, scope=?, chat_id=?, updated_at=datetime('now') WHERE id=?")
        .run(name, description || "", content, scope, chatId, existing.id);
      return existing.id;
    }
    const r = db.prepare("INSERT INTO skills (scope, chat_id, name, name_key, description, content) VALUES (?,?,?,?,?,?)")
      .run(scope, chatId, name, key, description || "", content);
    return r.lastInsertRowid;
  } catch (err) { console.error("[SKILL] save:", err.message); return null; }
}

// Match query against skill name+description (not full content) → return best skills to load.
function matchSkills(queryText, chatId, limit = 2) {
  const q = escapeFts(queryText);
  if (!q) return [];
  try {
    const rows = db.prepare(`
      SELECT s.id, s.name, s.description, s.content, s.scope, skills_fts.rank AS score
      FROM skills_fts JOIN skills s ON s.id = skills_fts.rowid
      WHERE skills_fts MATCH ? AND (s.scope='global' OR s.chat_id=?)
      ORDER BY skills_fts.rank LIMIT ?
    `).all(q, chatId, limit);
    if (rows.length) {
      const ids = rows.map(r => r.id);
      db.prepare(`UPDATE skills SET uses=uses+1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    }
    return rows;
  } catch (err) { console.error("[SKILL] match:", err.message); return []; }
}

function buildSkillContext(skills) {
  if (!skills.length) return "";
  const blocks = skills.map(s => `🛠️ SKILL "${s.name}"${s.description ? ` — ${s.description}` : ""}\n${s.content}`);
  return `\n\n========== LOADED SKILLS (prosedur tersimpan, ikuti kalau relevan dengan tugas) ==========\n${blocks.join("\n\n")}\n========== END SKILLS ==========\n`;
}

function listSkills(limit = 50) {
  return db.prepare("SELECT id, name, description, scope, uses, updated_at FROM skills ORDER BY uses DESC, updated_at DESC LIMIT ?").all(limit);
}
function getSkill(name) {
  return db.prepare("SELECT * FROM skills WHERE name_key=?").get(nameKey(name));
}
function deleteSkill(name) {
  const r = db.prepare("DELETE FROM skills WHERE name_key=?").run(nameKey(name));
  return r.changes > 0;
}

module.exports = { saveSkill, matchSkills, buildSkillContext, listSkills, getSkill, deleteSkill, nameKey };
