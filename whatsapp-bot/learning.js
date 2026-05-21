const { db } = require("./storage");
const { escapeFts } = require("./rag");

// Durable lessons captured from user corrections — injected into future prompts so the bot
// stops repeating the same mistake and "learns where to look".
db.exec(`
  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    scope TEXT DEFAULT 'chat',
    topic_key TEXT,
    lesson TEXT,
    source TEXT,
    hits INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lessons_chat ON lessons(chat_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts USING fts5(topic_key, lesson, content='lessons', content_rowid='id');
  CREATE TRIGGER IF NOT EXISTS lessons_ai AFTER INSERT ON lessons BEGIN
    INSERT INTO lessons_fts(rowid, topic_key, lesson) VALUES (new.id, new.topic_key, new.lesson);
  END;
  CREATE TRIGGER IF NOT EXISTS lessons_ad AFTER DELETE ON lessons BEGIN
    INSERT INTO lessons_fts(lessons_fts, rowid, topic_key, lesson) VALUES ('delete', old.id, old.topic_key, old.lesson);
  END;
  CREATE TRIGGER IF NOT EXISTS lessons_au AFTER UPDATE ON lessons BEGIN
    INSERT INTO lessons_fts(lessons_fts, rowid, topic_key, lesson) VALUES ('delete', old.id, old.topic_key, old.lesson);
    INSERT INTO lessons_fts(rowid, topic_key, lesson) VALUES (new.id, new.topic_key, new.lesson);
  END;
`);

function saveLesson(chatId, { topicKey, lesson, source = "", scope = "chat" }) {
  if (!lesson || !lesson.trim()) return null;
  const key = (topicKey || lesson).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
  try {
    // Dedup: same topic_key in same scope/chat → update instead of pile up.
    const existing = db.prepare("SELECT id FROM lessons WHERE chat_id=? AND topic_key=?").get(scope === "global" ? "global" : chatId, key);
    if (existing) {
      db.prepare("UPDATE lessons SET lesson=?, source=?, updated_at=datetime('now') WHERE id=?").run(lesson.trim(), source.slice(0, 300), existing.id);
      return existing.id;
    }
    const r = db.prepare("INSERT INTO lessons (chat_id, scope, topic_key, lesson, source) VALUES (?,?,?,?,?)")
      .run(scope === "global" ? "global" : chatId, scope, key, lesson.trim(), source.slice(0, 300));
    return r.lastInsertRowid;
  } catch (err) { console.error("[LESSON] save:", err.message); return null; }
}

function searchLessons(chatId, queryText, limit = 4) {
  const q = escapeFts(queryText);
  try {
    if (q) {
      const rows = db.prepare(`
        SELECT l.id, l.chat_id, l.scope, l.topic_key, l.lesson, lessons_fts.rank AS score
        FROM lessons_fts JOIN lessons l ON l.id = lessons_fts.rowid
        WHERE lessons_fts MATCH ? AND (l.chat_id=? OR l.scope='global')
        ORDER BY lessons_fts.rank LIMIT ?
      `).all(q, chatId, limit);
      if (rows.length) {
        const ids = rows.map(r => r.id);
        db.prepare(`UPDATE lessons SET hits=hits+1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
        return rows;
      }
    }
  } catch (err) { console.error("[LESSON] search:", err.message); }
  return [];
}

function buildLessonContext(lessons) {
  if (!lessons.length) return "";
  const lines = lessons.map(l => `• ${l.lesson}`);
  return `\n\n📚 PELAJARAN (dari koreksi/ajaran user sebelumnya — WAJIB dipatuhi, jangan ulangi kesalahan lama):\n${lines.join("\n")}\n`;
}

function listLessons(chatId, limit = 30) {
  return db.prepare("SELECT * FROM lessons WHERE chat_id=? OR scope='global' ORDER BY updated_at DESC LIMIT ?").all(chatId, limit);
}

function deleteLesson(id) {
  const r = db.prepare("DELETE FROM lessons WHERE id=?").run(id);
  return r.changes > 0;
}

// Heuristic: catch explicit teaching/correction phrases as a fallback when Claude doesn't self-flag.
const TEACH_RE = /\b(lain kali|next time|mulai sekarang|ingat ya|inget ya|catat ya|catet ya|jangan lupa|kalau .* (cari|liat|cek) (di|ke|pakai)|harusnya (kamu|lo|kakak)?\s|seharusnya|yang bener(nya)?|bukan begitu|salah,?\s)/i;

function detectCorrection(userText) {
  const t = (userText || "").trim();
  if (t.length < 8 || t.length > 400) return null;
  if (!TEACH_RE.test(t)) return null;
  return { topicKey: t.slice(0, 60), lesson: t };
}

module.exports = { saveLesson, searchLessons, buildLessonContext, listLessons, deleteLesson, detectCorrection };
