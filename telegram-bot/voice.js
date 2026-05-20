const fetch = require("node-fetch");

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_WHISPER_MODEL || "whisper-large-v3";

async function downloadVoiceFile(fileId, botToken) {
  const metaRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const meta = await metaRes.json();
  if (!meta.ok) throw new Error(`getFile gagal: ${meta.description}`);
  const filePath = meta.result.file_path;
  const audioRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  if (!audioRes.ok) throw new Error(`download audio HTTP ${audioRes.status}`);
  return Buffer.from(await audioRes.arrayBuffer());
}

async function transcribeViaGroq(audioBuffer, filename = "voice.ogg") {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY belum diset di .env. Daftar gratis di console.groq.com");
  const boundary = "----telegrambot" + Date.now();
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
    throw new Error(`Groq Whisper HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.text || "";
}

async function transcribeTelegramVoice(fileId, botToken) {
  const buf = await downloadVoiceFile(fileId, botToken);
  const text = await transcribeViaGroq(buf);
  return text.trim();
}

module.exports = { transcribeTelegramVoice, downloadVoiceFile, transcribeViaGroq };
