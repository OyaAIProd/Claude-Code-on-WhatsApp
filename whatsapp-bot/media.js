const fs = require("fs");
const path = require("path");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { analyzeFile, isAnalyzable } = require("./file_analyzer");

const FILES_DIR = path.join(__dirname, "data", "files");
fs.mkdirSync(FILES_DIR, { recursive: true });

function sanitize(name) {
  return String(name || "unknown").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 100);
}

function detectMediaType(message) {
  if (!message) return null;
  if (message.documentMessage) return "document";
  if (message.imageMessage) return "image";
  if (message.videoMessage) return "video";
  if (message.audioMessage && !message.audioMessage.ptt) return "audio";
  if (message.stickerMessage) return "sticker";
  return null;
}

function extractMediaMeta(message, type) {
  let m = null;
  if (type === "document") m = message.documentMessage;
  else if (type === "image") m = message.imageMessage;
  else if (type === "video") m = message.videoMessage;
  else if (type === "audio") m = message.audioMessage;
  else if (type === "sticker") m = message.stickerMessage;
  if (!m) return null;
  return {
    filename: m.fileName || m.title || null,
    mimetype: m.mimetype || null,
    caption: m.caption || null,
    size: m.fileLength ? Number(m.fileLength) : null
  };
}

function guessExt(mimetype, filename) {
  if (filename && /\./.test(filename)) return "";
  const map = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/msword": ".doc",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.ms-powerpoint": ".ppt",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/zip": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg"
  };
  return map[mimetype] || "";
}

async function downloadAndSave(msg, chatName, type, logger) {
  const meta = extractMediaMeta(msg.message, type);
  if (!meta) return null;
  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger });
    if (!buffer || !buffer.length) return null;
    const safeChat = sanitize(chatName);
    const dir = path.join(FILES_DIR, safeChat);
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const ext = guessExt(meta.mimetype, meta.filename);
    const filename = meta.filename ? sanitize(meta.filename) : `${type}_${ts}${ext}`;
    const finalName = `${ts}_${filename}`;
    const filePath = path.join(dir, finalName);
    fs.writeFileSync(filePath, buffer);
    let extraction = null;
    if (isAnalyzable(filePath)) {
      try {
        const result = await analyzeFile(filePath);
        if (result.ok) {
          extraction = {
            length: result.length,
            preview: result.preview,
            meta: result.meta,
            cachePath: result.cachePath
          };
          console.log(`[ANALYZE] ${meta.filename || finalName}: ${result.length} chars extracted (${JSON.stringify(result.meta || {})})`);
        } else {
          console.log(`[ANALYZE] ${meta.filename || finalName}: ${result.error}`);
        }
      } catch (err) { console.error("analyze err:", err.message); }
    }
    return {
      path: filePath,
      filename: meta.filename || finalName,
      mimetype: meta.mimetype,
      caption: meta.caption,
      size: buffer.length,
      type,
      extraction
    };
  } catch (err) {
    console.error("downloadAndSave:", err.message);
    return null;
  }
}

function listChatFiles(chatName, limit = 30) {
  const dir = path.join(FILES_DIR, sanitize(chatName));
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).map(f => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    return { name: f, path: p, size: st.size, mtime: st.mtime };
  });
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

module.exports = { downloadAndSave, detectMediaType, extractMediaMeta, listChatFiles, FILES_DIR };
