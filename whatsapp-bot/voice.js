const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const fetch = global.fetch || require("node-fetch");

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_WHISPER_MODEL || "whisper-large-v3";

async function downloadVoice(msg, logger) {
  return await downloadMediaMessage(msg, "buffer", {}, { logger });
}

async function transcribeViaGroq(audioBuffer, filename = "voice.ogg") {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY belum diset di .env. Daftar gratis di console.groq.com");
  const boundary = "----wabot" + Date.now();
  const parts = [];
  const push = (s) => parts.push(Buffer.from(s));
  push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${GROQ_MODEL}\r\n`);
  push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nid\r\n`);
  push(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`);
  push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/ogg\r\n\r\n`);
  parts.push(audioBuffer);
  push(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat(parts);
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length
    },
    body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.text || "").trim();
}

async function transcribeWhatsappVoice(msg, logger) {
  const buf = await downloadVoice(msg, logger);
  if (!buf || !buf.length) throw new Error("Audio buffer kosong");
  return await transcribeViaGroq(buf);
}

module.exports = { transcribeWhatsappVoice, transcribeViaGroq };
