const { db } = require("./storage");

// Display timestamps in WIB (Asia/Jakarta) — raw toISOString is UTC and shows wrong local time.
function fmtWIB(tsSec, withDate = true) {
  try {
    const d = new Date(tsSec * 1000);
    const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false });
    return withDate ? `${date} ${time}` : time;
  } catch { return new Date(tsSec * 1000).toISOString().slice(0, 16).replace("T", " "); }
}

// Question/filler words carry no topical signal — drop them so FTS ranks on content words only.
const FTS_STOPWORDS = new Set([
  "yang","dan","atau","itu","ini","ada","apa","apakah","siapa","kapan","dimana","kemana","kenapa",
  "gimana","bagaimana","mana","tadi","kemarin","tolong","coba","dong","deh","sih","kah","kok",
  "bilang","ngomong","kata","katanya","soal","tentang","punya","buat","sama","dengan","untuk",
  "dari","ke","di","pada","yg","gak","ga","nggak","engga","udah","sudah","pernah","aku","saya",
  "kamu","lo","gw","gue","dia","kita","mereka","bisa","mau","pengen","the","and","what","who",
  "when","where","why","how","is","are","was","were","about","please"
]);

function escapeFts(q) {
  const tokens = String(q || "")
    .toLowerCase()
    .replace(/["']/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(t => t.length >= 3 && !FTS_STOPWORDS.has(t));
  const uniq = [...new Set(tokens)];
  if (!uniq.length) return "";
  return uniq.map(t => `"${t}"*`).join(" OR ");
}

const IMG_STOPWORDS = new Set(["yang","foto","gambar","image","picture","photo","mana","tadi","kemarin","tentang","soal","apa","itu","ini","dong","coba","kirim","lihat","liat","show","cari","carikan","cariin"]);

function searchImagesByDescription(query, { limit = 3, chatId = null } = {}) {
  if (!query) return [];
  const tokens = [...new Set(
    String(query).toLowerCase().split(/\s+/)
      .filter(t => t.length >= 3 && !IMG_STOPWORDS.has(t))
  )];
  if (!tokens.length) return [];
  const field = "LOWER(IFNULL(vision_desc,'') || ' ' || IFNULL(media_caption,''))";
  const scoreExpr = tokens.map(() => `(CASE WHEN ${field} LIKE ? THEN 1 ELSE 0 END)`).join(" + ");
  const whereOr = tokens.map(() => `${field} LIKE ?`).join(" OR ");
  const likeParams = tokens.map(t => `%${t}%`);
  // params: scoreExpr likes (SELECT) + whereOr likes (WHERE) + [chatId] + limit
  const params = [...likeParams, ...likeParams];
  // Match media with EITHER a vision description (images) OR a caption (covers videos too).
  let sql = `SELECT id, chat_id, chat_name, sender_jid, sender_name, text, timestamp, is_group, media_filename, media_path, media_caption, vision_desc, from_me, (${scoreExpr}) AS match_score FROM messages WHERE media_path IS NOT NULL AND (vision_desc IS NOT NULL OR media_caption IS NOT NULL) AND (${whereOr})`;
  if (chatId) { sql += " AND chat_id = ?"; params.push(chatId); }
  sql += " ORDER BY match_score DESC, timestamp DESC LIMIT ?";
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

// Question/recall words — fire RAG even without a trailing "?" so open-ended recall
// ("tadi kep siapa yang berangkat") works the same as keyword queries.
const QUESTION_WORDS = /\b(siapa|apa|apakah|kapan|dimana|di\s?mana|kemana|berapa|mana|gimana|bagaimana|adakah|udah|sudah|kah)\b/i;
const RECALL_VERBS = /\b(berangkat|datang|pergi|sampai|tiba|kirim|terima|bayar|pesan|booking|jadwal|hadir|absen|izin|sakit|cuti|lapor)\b/i;
// Data-retrieval / enumeration commands ("tunjukkan daftar nama", "list anggota", "rekap ...").
const DATA_INTENT = /\b(tunjuk\w*|tampil\w*|daftar|list|sebut\w*|nama[- ]?nama|anggota|member|peserta|rekap\w*|laporan|riwayat|history|arsip|kasih\s+(tau|tahu|lihat|liat)|liat\w*|lihat\w*|cek\w*|carik\w*|cariin|temuk\w*|info\s+\w+|data\s+\w+)\b/i;

function shouldDoRagSearch(userText) {
  if (!userText) return false;
  const t = userText.trim();
  if (t.length < 5) return false;
  const greetingPattern = /^(halo|hai|hi|hello|hey|p|test|tes|woi|woy|bro|sis|coba|ok|oke|sip|thx|thanks|makasih|y[ae]s?)\W*$/i;
  if (greetingPattern.test(t)) return false;
  if (RAG_TRIGGER_PATTERNS.some(p => p.test(t))) return true;
  const wc = t.split(/\s+/).length;
  // Question word OR recall verb OR data/enumeration intent in a multi-word message → search memory.
  if (wc >= 3 && (QUESTION_WORDS.test(t) || RECALL_VERBS.test(t) || DATA_INTENT.test(t))) return true;
  if (wc >= 5 && /\?$/.test(t)) return true;
  return false;
}

function buildRagContext(matches, label = "🔎 CROSS-CHAT SEARCH RESULTS") {
  if (!matches.length) return "";
  const lines = matches.map((m, i) => {
    const time = fmtWIB(m.timestamp);
    const sender = m.from_me ? "[BOT]" : (m.sender_name || m.sender_jid?.split("@")[0] || "?");
    const where = m.is_group ? `group "${m.chat_name}"` : `DM ${m.chat_name}`;
    let line = `${i + 1}. [${time} WIB] ${sender} @ ${where}: ${(m.text || "(media)").slice(0, 200)}`;
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
  getChatsNeedingProfile, getProfileSourceMessages, escapeFts, fmtWIB
};
