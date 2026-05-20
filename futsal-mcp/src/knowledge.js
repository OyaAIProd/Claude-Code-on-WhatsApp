const { db, audit } = require("./db");

function addKB({ category, question, answer, tags, priority = 1 }) {
  const r = db.prepare("INSERT INTO knowledge_base (category, question, answer, tags, priority) VALUES (?, ?, ?, ?, ?)")
    .run(category || "general", question, answer, tags || null, priority);
  audit("kb_add", `#${r.lastInsertRowid}`, question.slice(0, 60));
  return r.lastInsertRowid;
}

function updateKB(id, { category, question, answer, tags, priority, active }) {
  const updates = [], vals = [];
  if (category !== undefined) { updates.push("category=?"); vals.push(category); }
  if (question !== undefined) { updates.push("question=?"); vals.push(question); }
  if (answer !== undefined) { updates.push("answer=?"); vals.push(answer); }
  if (tags !== undefined) { updates.push("tags=?"); vals.push(tags); }
  if (priority !== undefined) { updates.push("priority=?"); vals.push(priority); }
  if (active !== undefined) { updates.push("active=?"); vals.push(active ? 1 : 0); }
  if (!updates.length) return false;
  updates.push("updated_at=datetime('now')");
  vals.push(id);
  const r = db.prepare(`UPDATE knowledge_base SET ${updates.join(",")} WHERE id=?`).run(...vals);
  audit("kb_update", `#${id}`);
  return r.changes > 0;
}

function deleteKB(id) {
  const r = db.prepare("DELETE FROM knowledge_base WHERE id=?").run(id);
  audit("kb_delete", `#${id}`);
  return r.changes > 0;
}

function listKB({ category, limit = 50 } = {}) {
  if (category) return db.prepare("SELECT * FROM knowledge_base WHERE active=1 AND category=? ORDER BY priority DESC, id DESC LIMIT ?").all(category, limit);
  return db.prepare("SELECT * FROM knowledge_base WHERE active=1 ORDER BY priority DESC, id DESC LIMIT ?").all(limit);
}

function searchKB(query, limit = 8) {
  if (!query) return [];
  const tokens = String(query).trim().split(/\s+/).filter(t => t.length >= 2).map(t => `"${t.replace(/"/g, "")}"*`).join(" OR ");
  if (!tokens) return [];
  try {
    return db.prepare(`SELECT k.*, kb_fts.rank FROM kb_fts JOIN knowledge_base k ON k.id = kb_fts.rowid WHERE kb_fts MATCH ? AND k.active=1 ORDER BY kb_fts.rank LIMIT ?`).all(tokens, limit);
  } catch (err) { console.error("kb search:", err.message); return []; }
}

function buildKBContext(matches) {
  if (!matches.length) return "";
  return `\n📚 KNOWLEDGE BASE FUTSAL:\n${matches.map((m, i) => `${i + 1}. [${m.category}] *${m.question}*\n   → ${m.answer}`).join("\n")}\n--- END KB ---\n`;
}

module.exports = { addKB, updateKB, deleteKB, listKB, searchKB, buildKBContext };
