const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DB_DIR, "wa.db");
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    chat_name TEXT,
    is_group INTEGER,
    sender_jid TEXT,
    sender_name TEXT,
    message_id TEXT UNIQUE,
    text TEXT,
    quoted_message_id TEXT,
    quoted_text TEXT,
    quoted_sender_jid TEXT,
    mentioned_jids TEXT,
    timestamp INTEGER,
    from_me INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_msg_chat_ts ON messages(chat_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_sender ON messages(sender_jid);
  CREATE TABLE IF NOT EXISTS bosses (
    jid TEXT PRIMARY KEY,
    name TEXT,
    can_admin INTEGER DEFAULT 1,
    added_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chat_config (
    chat_id TEXT PRIMARY KEY,
    claude_session_id TEXT,
    model TEXT,
    cwd TEXT,
    auto_respond_dm INTEGER DEFAULT 0,
    listen_only INTEGER DEFAULT 0,
    permission_mode TEXT,
    safe_mode INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    session_uuid TEXT UNIQUE,
    name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_used TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cs_chat ON chat_sessions(chat_id);
`);

// Idempotent column add (older DBs created chat_config without voice_mode).
try { db.exec("ALTER TABLE chat_config ADD COLUMN voice_mode INTEGER DEFAULT 0"); } catch {}

function saveMessage(msg) {
  try {
    db.prepare(`INSERT OR IGNORE INTO messages
      (chat_id, chat_name, is_group, sender_jid, sender_name, message_id, text, quoted_message_id, quoted_text, quoted_sender_jid, mentioned_jids, timestamp, from_me, media_path, media_filename, media_mimetype, media_caption)
      VALUES (@chat_id, @chat_name, @is_group, @sender_jid, @sender_name, @message_id, @text, @quoted_message_id, @quoted_text, @quoted_sender_jid, @mentioned_jids, @timestamp, @from_me, @media_path, @media_filename, @media_mimetype, @media_caption)`).run({
        quoted_message_id: null, quoted_text: null, quoted_sender_jid: null, mentioned_jids: null,
        media_path: null, media_filename: null, media_mimetype: null, media_caption: null,
        from_me: 0, is_group: 0, chat_name: null, text: null,
        ...msg
      });
  } catch (err) { console.error("save msg:", err.message); }
}

function getRecentMessages(chatId, limit = 30) {
  return db.prepare("SELECT * FROM messages WHERE chat_id=? ORDER BY timestamp DESC LIMIT ?").all(chatId, limit).reverse();
}

function searchMessages(chatId, keyword, limit = 30) {
  return db.prepare("SELECT * FROM messages WHERE chat_id=? AND text LIKE ? ORDER BY timestamp DESC LIMIT ?").all(chatId, `%${keyword}%`, limit);
}

function getMessagesBySender(chatId, senderJid, limit = 50) {
  return db.prepare("SELECT * FROM messages WHERE chat_id=? AND sender_jid=? ORDER BY timestamp DESC LIMIT ?").all(chatId, senderJid, limit).reverse();
}

// Resolve a quoted/replied message by its WhatsApp id (to show who/what a reply targets).
function getMessageById(message_id) {
  if (!message_id) return null;
  try { return db.prepare("SELECT chat_id, sender_jid, sender_name, text, from_me, media_caption, vision_desc FROM messages WHERE message_id=?").get(message_id); }
  catch { return null; }
}

function getChatList() {
  return db.prepare("SELECT chat_id, chat_name, is_group, MAX(timestamp) AS last_ts, COUNT(*) AS msg_count FROM messages GROUP BY chat_id ORDER BY last_ts DESC LIMIT 30").all();
}

function getChatConfig(chatId) {
  let row = db.prepare("SELECT * FROM chat_config WHERE chat_id=?").get(chatId);
  if (!row) {
    db.prepare("INSERT INTO chat_config (chat_id) VALUES (?)").run(chatId);
    row = db.prepare("SELECT * FROM chat_config WHERE chat_id=?").get(chatId);
  }
  return row;
}

function setChatConfig(chatId, fields) {
  const cur = getChatConfig(chatId);
  const cols = Object.keys(fields);
  if (!cols.length) return cur;
  const sets = cols.map(c => `${c}=?`).join(", ");
  const vals = cols.map(c => fields[c]);
  vals.push(chatId);
  db.prepare(`UPDATE chat_config SET ${sets}, updated_at=datetime('now') WHERE chat_id=?`).run(...vals);
  return getChatConfig(chatId);
}

const crypto = require("crypto");

function listChatSessions(chatId) {
  return db.prepare("SELECT * FROM chat_sessions WHERE chat_id=? ORDER BY last_used DESC").all(chatId);
}
function newChatSession(chatId, name) {
  const uuid = crypto.randomUUID();
  const finalName = name || `session ${listChatSessions(chatId).length + 1}`;
  db.prepare("INSERT INTO chat_sessions (chat_id, session_uuid, name) VALUES (?, ?, ?)").run(chatId, uuid, finalName);
  setChatConfig(chatId, { claude_session_id: uuid });
  return { uuid, name: finalName };
}
function findChatSession(chatId, indexOrIdOrName) {
  const sessions = listChatSessions(chatId);
  if (/^\d+$/.test(String(indexOrIdOrName))) {
    return sessions[parseInt(indexOrIdOrName, 10) - 1] || null;
  }
  return sessions.find(s => s.session_uuid === indexOrIdOrName || s.session_uuid.startsWith(indexOrIdOrName) || s.name === indexOrIdOrName) || null;
}
function renameCurrentSession(chatId, newName) {
  const cfg = getChatConfig(chatId);
  if (!cfg.claude_session_id) return false;
  const r = db.prepare("UPDATE chat_sessions SET name=? WHERE chat_id=? AND session_uuid=?").run(newName, chatId, cfg.claude_session_id);
  return r.changes > 0;
}
function deleteChatSession(chatId, indexOrIdOrName) {
  const s = findChatSession(chatId, indexOrIdOrName);
  if (!s) return null;
  db.prepare("DELETE FROM chat_sessions WHERE id=?").run(s.id);
  const cfg = getChatConfig(chatId);
  if (cfg.claude_session_id === s.session_uuid) {
    const rest = listChatSessions(chatId);
    setChatConfig(chatId, { claude_session_id: rest[0]?.session_uuid || null });
  }
  return s;
}
function touchSession(chatId, uuid) {
  db.prepare("UPDATE chat_sessions SET last_used=datetime('now') WHERE chat_id=? AND session_uuid=?").run(chatId, uuid);
}
function ensureSession(chatId, uuid) {
  const exist = db.prepare("SELECT id FROM chat_sessions WHERE session_uuid=?").get(uuid);
  if (!exist) db.prepare("INSERT INTO chat_sessions (chat_id, session_uuid, name) VALUES (?, ?, ?)").run(chatId, uuid, `session ${listChatSessions(chatId).length + 1}`);
}

module.exports = { db, saveMessage, getRecentMessages, searchMessages, getMessagesBySender, getMessageById, getChatList, getChatConfig, setChatConfig, listChatSessions, newChatSession, findChatSession, renameCurrentSession, deleteChatSession, touchSession, ensureSession };
