const fs = require("fs");
const fetch = global.fetch || require("node-fetch");

const GROQ_KEY = process.env.GROQ_API_KEY;
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

function imageToDataUri(filePath, mimetype) {
  const buf = fs.readFileSync(filePath);
  const mt = mimetype || (filePath.endsWith(".png") ? "image/png" : filePath.endsWith(".webp") ? "image/webp" : "image/jpeg");
  return `data:${mt};base64,${buf.toString("base64")}`;
}

async function describeImage(filePath, { mimetype, prompt } = {}) {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY belum diset");
  const dataUri = imageToDataUri(filePath, mimetype);
  const userPrompt = prompt || "Describe this image in 1-2 short sentences (Indonesian). If contains text, extract the text. Be concise — minimum tokens, maximum info.";
  const body = {
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: dataUri } }
        ]
      }
    ],
    max_tokens: 200,
    temperature: 0.2
  };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Groq Vision HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = { describeImage };
