const { db } = require("./storage");

function log({ chat_id, sender_jid, sender_name, action, target, detail, status }) {
  try {
    db.prepare(`INSERT INTO audit_log (chat_id, sender_jid, sender_name, action, target, detail, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(chat_id || null, sender_jid || null, sender_name || null, action, target || null, detail || null, status || "ok");
  } catch (err) { console.error("audit log:", err.message); }
}

function recent({ limit = 30, action = null, chatId = null }) {
  let sql = "SELECT * FROM audit_log WHERE 1=1";
  const params = [];
  if (action) { sql += " AND action = ?"; params.push(action); }
  if (chatId) { sql += " AND chat_id = ?"; params.push(chatId); }
  sql += " ORDER BY id DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function stats(hours = 24) {
  return db.prepare(`SELECT action, COUNT(*) AS c FROM audit_log WHERE created_at > datetime('now','-${hours} hours') GROUP BY action ORDER BY c DESC`).all();
}

module.exports = { log, recent, stats };
