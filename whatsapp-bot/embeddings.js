const { db } = require("./storage");

let pipelinePromise = null;
let extractor = null;

async function ensureExtractor() {
  if (extractor) return extractor;
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { pipeline } = await import("@xenova/transformers");
        const ex = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
        console.log("✅ Embeddings model loaded (Xenova/all-MiniLM-L6-v2, 384-dim)");
        return ex;
      } catch (err) {
        console.error("[EMBED] init fail:", err.message);
        return null;
      }
    })();
  }
  extractor = await pipelinePromise;
  return extractor;
}

async function embed(text) {
  const ex = await ensureExtractor();
  if (!ex || !text) return null;
  try {
    const out = await ex(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (err) { console.error("[EMBED] embed:", err.message); return null; }
}

function vectorToBlob(vec) {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer);
}

function blobToVector(blob) {
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.length / 4));
}

function cosineSim(a, b) {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

async function storeEmbedding(messageId, text) {
  if (!text || text.length < 10) return false;
  const vec = await embed(text);
  if (!vec) return false;
  try {
    db.prepare(`INSERT OR REPLACE INTO embeddings (message_id, vector) VALUES (?, ?)`).run(messageId, vectorToBlob(vec));
    return true;
  } catch (err) { console.error("[EMBED] store:", err.message); return false; }
}

async function semanticSearch(query, { limit = 10, excludeChatId = null } = {}) {
  const qvec = await embed(query);
  if (!qvec) return [];
  try {
    let sql = `SELECT e.message_id, e.vector, m.chat_id, m.chat_name, m.sender_jid, m.sender_name, m.text, m.timestamp, m.is_group, m.media_filename, m.media_path FROM embeddings e JOIN messages m ON m.id = e.message_id`;
    const params = [];
    if (excludeChatId) { sql += " WHERE m.chat_id != ?"; params.push(excludeChatId); }
    const rows = db.prepare(sql).all(...params);
    const scored = rows.map(r => {
      const v = blobToVector(r.vector);
      return { ...r, score: cosineSim(qvec, v) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).filter(r => r.score > 0.3);
  } catch (err) { console.error("[EMBED] search:", err.message); return []; }
}

async function backfill(batchSize = 50) {
  const ex = await ensureExtractor();
  if (!ex) return 0;
  const rows = db.prepare(`SELECT m.id, m.text FROM messages m LEFT JOIN embeddings e ON e.message_id=m.id WHERE e.message_id IS NULL AND m.text IS NOT NULL AND length(m.text) > 10 ORDER BY m.id DESC LIMIT ?`).all(batchSize);
  let done = 0;
  for (const r of rows) {
    if (await storeEmbedding(r.id, r.text)) done++;
  }
  if (done) console.log(`[EMBED] backfilled ${done}/${rows.length}`);
  return done;
}

function startEmbeddingsBackground() {
  setTimeout(() => backfill(20), 120 * 1000);
  setInterval(() => backfill(30), 5 * 60 * 1000);
  console.log("✅ Embeddings backfill started (every 5min)");
}

module.exports = { embed, storeEmbedding, semanticSearch, backfill, startEmbeddingsBackground, ensureExtractor };
