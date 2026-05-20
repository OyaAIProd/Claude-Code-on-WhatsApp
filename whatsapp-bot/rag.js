const { db } = require("./storage");

function escapeFts(q) {
  return String(q || "")
    .replace(/["']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(t => t.length >= 2)
    .map(t => `"${t}"*`)
    .join(" OR ");
}

function searchImagesByDescription(query, { limit = 6, chatId = null } = {}) {
  if (!query) return [];
  const tokens = String(query).toLowerCase().split(/\s+/).filter(t => t.length >= 3);
  if (!tokens.length) return [];
  const likes = tokens.map(() => "LOWER(vision_desc) LIKE ?").join(" OR ");
  const params = tokens.map(t => `%${t}%`);
  let sql = `SELECT id, chat_id, chat_name, sender_jid, sender_name, text, timestamp, is_group, media_filename, media_path, media_caption, vision_desc, from_me FROM messages WHERE vision_desc IS NOT NULL AND (${likes})`;
  if (chatId) { sql += " AND chat_id = ?"; params.push(chatId); }
  sql += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);
  try { return db.prepare(sql).all(...params); } catch (err) { console.error("img search:", err.message); return []; }
}

function searchAllMessages(query, { limit = 15, excludeChatId = null, minTimestamp = null } = {}) {
  const ftsQuery = escapeFts(query);
  if (!ftsQuery) return [];
  try {
    const where = [];
    const params = [ftsQuery];
    if (excludeChatId) { where.push("m.chat_id != ?"); params.push(excludeChatId); }
    if (minTimestamp) { where.push("m.timestamp >= ?"); params.push(minTimestamp); }
    const whereClause = where.length ? ` AND ${where.join(" AND ")}` : "";
    params.push(limit);
    const sql = `
      SELECT m.id, m.chat_id, m.chat_name, m.is_group, m.sender_name, m.sender_jid,
             m.text, m.timestamp, m.media_filename, m.media_path, m.from_me,
             messages_fts.rank AS score
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      WHERE messages_fts MATCH ?${whereClause}
      ORDER BY messages_fts.rank
      LIMIT ?
    `;
    return db.prepare(sql).all(...params);
  } catch (err) {
    console.error("FTS search:", err.message);
    return [];
  }
}

function searchByChat(chatId, query, limit = 15) {
  const ftsQuery = escapeFts(query);
  if (!ftsQuery) return [];
  try {
    return db.prepare(`
      SELECT m.id, m.chat_id, m.chat_name, m.sender_name, m.text, m.timestamp, m.media_filename, m.media_path,
             messages_fts.rank AS score
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      WHERE messages_fts MATCH ? AND m.chat_id = ?
      ORDER BY messages_fts.rank
      LIMIT ?
    `).all(ftsQuery, chatId, limit);
  } catch (err) {
    console.error("FTS search by chat:", err.message);
    return [];
  }
}

const RAG_TRIGGER_PATTERNS = [
  /siapa(\s+yang)?\s+(bilang|ngomong|kata|kirim|share|sebut)/i,
  /\bdimana\b|\bkapan\b|\bkemana\b|\bkenapa\b/i,
  /apa kata|apa yg dibilang|pendapat|bilang apa|kata-?nya/i,
  /\bcari(in|kan)?\b|\bfind\b|\bsearch\b|\btemukan\b/i,
  /(file|dokumen|pdf|excel|word|ppt|powerpoint|laporan|attachment|attach)\s+\S+/i,
  /(pernah|sudah|udah)\s+(dibahas|dikirim|disebut|dishare|bilang)/i,
  /(ringkas|ringkasan|summari[zs]e|recap|rangkum|rekap)/i,
  /(ada\s+(yg|yang))?\s*(tau|tahu)\s+(gak|ga|nggak|engga|enggak)?/i,
  /(kapten|mister|mr|pak|bu|bang|mas|mbak)\s+[a-zA-Z]+/i,
  /apa\s+(yg|yang)\s+(dibilang|dikatakan|dishare|dikirim)/i,
  /\b(group|grup|chat)\s+(apa|mana|tentang|soal)/i,
  /(ada|adakah)\s+(info|berita|kabar|update|news)\s+(soal|tentang)/i,
  /\b(history|histor[iy]|riwayat)\b/i,
  /\b(arsip|archive)\b/i
];

function shouldDoRagSearch(userText) {
  if (!userText) return false;
  const t = userText.trim();
  if (t.length < 5) return false;
  if (RAG_TRIGGER_PATTERNS.some(p => p.test(t))) return true;
  const greetingPattern = /^(halo|hai|hi|hello|hey|p|test|tes|woi|woy|bro|sis|coba|ok|oke|sip|thx|thanks|makasih|y[ae]s?)\W*$/i;
  if (greetingPattern.test(t)) return false;
  const wc = t.split(/\s+/).length;
  if (wc >= 5 && /\?$/.test(t)) return true;
  return false;
}

function buildRagContext(matches, label = "🔎 CROSS-CHAT SEARCH RESULTS") {
  if (!matches.length) return "";
  const lines = matches.map((m, i) => {
    const time = new Date(m.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ");
    const sender = m.from_me ? "[BOT]" : (m.sender_name || m.sender_jid?.split("@")[0] || "?");
    const where = m.is_group ? `group "${m.chat_name}"` : `DM ${m.chat_name}`;
    let line = `${i + 1}. [${time}] ${sender} @ ${where}: ${(m.text || "(media)").slice(0, 200)}`;
    if (m.media_filename) line += `\n   📎 file: ${m.media_filename} (PATH=${m.media_path})`;
    return line;
  });
  return `\n\n${label}:\n${lines.join("\n")}\n--- END SEARCH RESULTS ---\n`;
}

function getGroupProfiles(currentChatId = null, limit = 8) {
  try {
    const rows = db.prepare(`
      SELECT chat_id, chat_name, topic, summary, message_count, last_msg_at, last_generated_at
      FROM group_profiles
      WHERE topic IS NOT NULL AND length(topic) > 0
      ORDER BY last_msg_at DESC
      LIMIT ?
    `).all(limit);
    return rows;
  } catch { return []; }
}

function buildGroupProfilesContext(profiles, currentChatId) {
  if (!profiles.length) return "";
  const lines = profiles.map(p => {
    const mark = p.chat_id === currentChatId ? "👉" : "  ";
    return `${mark} ${p.chat_name} (${p.message_count} msg) — ${p.topic}${p.summary ? `: ${p.summary.slice(0, 120)}` : ""}`;
  });
  return `\n\n🗂️ KNOWN GROUPS/CHATS (bot has been listening to):\n${lines.join("\n")}\n`;
}

function upsertGroupProfile({ chat_id, chat_name, topic, summary, member_names, message_count, last_msg_at }) {
  try {
    db.prepare(`
      INSERT INTO group_profiles (chat_id, chat_name, topic, summary, member_names, message_count, last_msg_at, last_generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(chat_id) DO UPDATE SET
        chat_name=excluded.chat_name, topic=excluded.topic, summary=excluded.summary,
        member_names=excluded.member_names, message_count=excluded.message_count, last_msg_at=excluded.last_msg_at,
        last_generated_at=datetime('now')
    `).run(chat_id, chat_name, topic, summary, member_names, message_count, last_msg_at);
  } catch (err) { console.error("upsertGroupProfile:", err.message); }
}

function getChatsNeedingProfile(maxAgeHours = 24, minNewMsgs = 30) {
  try {
    const all = db.prepare(`
      SELECT m.chat_id, m.chat_name, m.is_group, COUNT(*) AS msg_count, MAX(m.timestamp) AS last_msg_at
      FROM messages m
      WHERE m.is_group = 1
      GROUP BY m.chat_id
      HAVING msg_count >= 10
    `).all();
    return all.filter(c => {
      const existing = db.prepare("SELECT message_count, last_generated_at FROM group_profiles WHERE chat_id=?").get(c.chat_id);
      if (!existing) return true;
      if ((c.msg_count - (existing.message_count || 0)) >= minNewMsgs) return true;
      const ageMs = Date.now() - new Date(existing.last_generated_at).getTime();
      return ageMs > maxAgeHours * 3600 * 1000;
    });
  } catch (err) { console.error("getChatsNeedingProfile:", err.message); return []; }
}

function getProfileSourceMessages(chatId, limit = 80) {
  return db.prepare(`
    SELECT sender_name, text, timestamp, media_filename
    FROM messages WHERE chat_id=? AND text IS NOT NULL AND text != ''
    ORDER BY timestamp DESC LIMIT ?
  `).all(chatId, limit).reverse();
}

module.exports = {
  searchAllMessages, searchByChat, searchImagesByDescription, shouldDoRagSearch, buildRagContext,
  getGroupProfiles, buildGroupProfilesContext, upsertGroupProfile,
  getChatsNeedingProfile, getProfileSourceMessages, escapeFts
};
