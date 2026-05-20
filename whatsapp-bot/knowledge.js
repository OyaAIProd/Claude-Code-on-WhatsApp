const fetch = global.fetch || require("node-fetch");
const { db } = require("./storage");

async function fetchUrl(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 ClaudeWA" }, timeout: 20000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, contentType: ct };
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

async function importFromUrl({ url, ownerJid, chatId, tags }) {
  const { buffer, contentType } = await fetchUrl(url);
  let text = "", title = url;
  if (/text\/html|application\/xhtml/.test(contentType)) {
    const html = buffer.toString("utf8");
    title = htmlTitle(html) || url;
    text = htmlToText(html);
  } else if (/text\//.test(contentType) || /application\/json|application\/xml/.test(contentType)) {
    text = buffer.toString("utf8");
  } else if (/application\/pdf/.test(contentType)) {
    const fa = require("./file_analyzer");
    const fs = require("fs"); const path = require("path"); const os = require("os");
    const tmp = path.join(os.tmpdir(), `import_${Date.now()}.pdf`);
    fs.writeFileSync(tmp, buffer);
    const r = await fa.analyzeFile(tmp);
    fs.unlinkSync(tmp);
    if (!r.ok) throw new Error(`PDF parse: ${r.error}`);
    text = r.text;
  } else {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }
  if (text.length > 500_000) text = text.slice(0, 500_000);
  return saveImport({ source_type: "url", source_url: url, title, content: text, ownerJid, chatId, tags });
}

async function importFromFile({ filePath, ownerJid, chatId, tags, title }) {
  const fa = require("./file_analyzer");
  const r = await fa.analyzeFile(filePath);
  if (!r.ok) throw new Error(r.error);
  return saveImport({ source_type: "file", source_url: filePath, title: title || require("path").basename(filePath), content: r.text, ownerJid, chatId, tags });
}

function importFromText({ text, title, ownerJid, chatId, tags }) {
  if (!text || text.length < 10) throw new Error("Text terlalu pendek");
  return saveImport({ source_type: "text", source_url: null, title: title || `note_${Date.now()}`, content: text, ownerJid, chatId, tags });
}

function saveImport({ source_type, source_url, title, content, ownerJid, chatId, tags }) {
  const r = db.prepare(`INSERT INTO knowledge_imports (source_type, source_url, title, content, owner_jid, chat_id, tags, length) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(source_type, source_url || null, title.slice(0, 200), content, ownerJid || null, chatId || null, tags || null, content.length);
  return { id: r.lastInsertRowid, title, length: content.length };
}

function searchKnowledge(query, limit = 6) {
  const escaped = String(query || "").replace(/["']/g, " ").trim().split(/\s+/).filter(t => t.length >= 2).map(t => `"${t}"*`).join(" OR ");
  if (!escaped) return [];
  try {
    return db.prepare(`SELECT k.id, k.title, k.source_url, k.source_type, k.tags, snippet(knowledge_fts, 1, '*', '*', '...', 30) AS snippet, knowledge_fts.rank AS score FROM knowledge_fts JOIN knowledge_imports k ON k.id = knowledge_fts.rowid WHERE knowledge_fts MATCH ? ORDER BY knowledge_fts.rank LIMIT ?`).all(escaped, limit);
  } catch (err) { console.error("knowledge search:", err.message); return []; }
}

function listImports(limit = 30, ownerJid = null) {
  if (ownerJid) return db.prepare(`SELECT id,title,source_type,source_url,length,created_at FROM knowledge_imports WHERE owner_jid=? ORDER BY id DESC LIMIT ?`).all(ownerJid, limit);
  return db.prepare(`SELECT id,title,source_type,source_url,length,created_at FROM knowledge_imports ORDER BY id DESC LIMIT ?`).all(limit);
}

function getImport(id) {
  return db.prepare(`SELECT * FROM knowledge_imports WHERE id=?`).get(id);
}

function deleteImport(id) {
  const r = db.prepare(`DELETE FROM knowledge_imports WHERE id=?`).run(id);
  return r.changes > 0;
}

function buildKnowledgeContext(matches) {
  if (!matches.length) return "";
  const lines = matches.map((m, i) => `${i + 1}. [${m.source_type}] *${m.title}*${m.source_url ? ` (${m.source_url})` : ""}\n   ${m.snippet}`);
  return `\n\n📚 KNOWLEDGE BASE MATCHES:\n${lines.join("\n")}\n--- END KB ---\n`;
}

module.exports = { importFromUrl, importFromFile, importFromText, searchKnowledge, listImports, getImport, deleteImport, buildKnowledgeContext };
