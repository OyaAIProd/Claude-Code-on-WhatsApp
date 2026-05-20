const { db } = require("./storage");

function extractButtonMarker(text) {
  if (!text) return { cleaned: text, buttons: null };
  const m = text.match(/\[BUTTONS:\s*([^\]]+)\]/);
  if (!m) return { cleaned: text, buttons: null };
  const optionStr = m[1].trim();
  const opts = optionStr.split("|").map(o => {
    const t = o.trim();
    const kv = t.match(/^([^=]+)=(.+)$/);
    if (kv) return { id: kv[1].trim(), label: kv[2].trim() };
    const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return { id: slug, label: t };
  }).filter(o => o.id && o.label).slice(0, 6);
  const cleaned = text.replace(/\[BUTTONS:[^\]]+\]/g, "").trim();
  return { cleaned, buttons: opts };
}

function extractRememberPattern(text) {
  const m = text.match(/\[REMEMBER:\s*([^\]]+)\]/);
  if (!m) return { cleaned: text, pattern: null };
  const cleaned = text.replace(/\[REMEMBER:[^\]]+\]/g, "").trim();
  return { cleaned, pattern: m[1].trim() };
}

function formatChoicesText(buttons) {
  if (!buttons || !buttons.length) return "";
  return buttons.map((b, i) => `*${i + 1}.* ${b.label}`).join("\n");
}

function recordPendingChoice({ chatId, ownerJid, messageKey, options, rememberPattern }) {
  const r = db.prepare(`INSERT INTO button_choices (chat_id, owner_jid, message_key, options_json, remember_pattern) VALUES (?, ?, ?, ?, ?)`)
    .run(chatId, ownerJid || null, messageKey ? JSON.stringify(messageKey) : null, JSON.stringify(options), rememberPattern || null);
  return r.lastInsertRowid;
}

function getLatestPending(chatId) {
  return db.prepare(`SELECT * FROM button_choices WHERE chat_id=? AND status='pending' ORDER BY id DESC LIMIT 1`).get(chatId);
}

function resolveButtonReply(choiceId, selectedIdOrLabel) {
  const c = db.prepare(`SELECT * FROM button_choices WHERE id=?`).get(choiceId);
  if (!c) return null;
  const opts = JSON.parse(c.options_json || "[]");
  let picked = null;
  if (/^\d+$/.test(String(selectedIdOrLabel))) {
    picked = opts[parseInt(selectedIdOrLabel, 10) - 1];
  } else {
    const needle = String(selectedIdOrLabel).toLowerCase().trim();
    picked = opts.find(o => o.id.toLowerCase() === needle || o.label.toLowerCase() === needle || o.id.toLowerCase().startsWith(needle));
  }
  if (!picked) return null;
  db.prepare(`UPDATE button_choices SET selected=?, status='answered', responded_at=datetime('now') WHERE id=?`).run(picked.id, choiceId);
  if (c.remember_pattern && /(remember|always|don.?t.?ask|jangan_tanya)/i.test(picked.id)) {
    rememberDecision(c.chat_id, c.remember_pattern, picked.id);
  }
  return { choice: c, picked };
}

function rememberDecision(chatId, pattern, decision) {
  try {
    db.prepare(`INSERT INTO button_memory (chat_id, pattern, decision) VALUES (?, ?, ?) ON CONFLICT(chat_id, pattern) DO UPDATE SET decision=excluded.decision, created_at=datetime('now')`)
      .run(chatId, pattern, decision);
  } catch (err) { console.error("rememberDecision:", err.message); }
}

function getRememberedDecision(chatId, pattern) {
  return db.prepare(`SELECT decision, created_at FROM button_memory WHERE chat_id=? AND pattern=?`).get(chatId, pattern);
}

function listRemembered(chatId) {
  return db.prepare(`SELECT * FROM button_memory WHERE chat_id=? ORDER BY created_at DESC`).all(chatId);
}

function clearRemembered(chatId, pattern) {
  if (pattern) {
    const r = db.prepare(`DELETE FROM button_memory WHERE chat_id=? AND pattern=?`).run(chatId, pattern);
    return r.changes > 0;
  }
  const r = db.prepare(`DELETE FROM button_memory WHERE chat_id=?`).run(chatId);
  return r.changes > 0;
}

async function sendButtons(sock, chatId, text, buttons, quotedMsg) {
  if (!buttons || !buttons.length) return null;
  try {
    const sections = [{
      title: "Pilih opsi",
      rows: buttons.slice(0, 6).map(b => ({ title: b.label.slice(0, 24), rowId: b.id, description: "" }))
    }];
    return await sock.sendMessage(chatId, {
      text,
      footer: "Tap nomor atau ketik /pilih <n>",
      buttonText: "Opsi",
      title: "Claude",
      sections
    }, quotedMsg ? { quoted: quotedMsg } : {});
  } catch (err) {
    console.error("sendButtons (list) fail, fallback text:", err.message);
    return null;
  }
}

module.exports = {
  extractButtonMarker, extractRememberPattern, formatChoicesText,
  recordPendingChoice, getLatestPending, resolveButtonReply,
  rememberDecision, getRememberedDecision, listRemembered, clearRemembered,
  sendButtons
};
