const fs = require("fs");
const fetch = global.fetch || require("node-fetch");

const GROQ_KEY = process.env.GROQ_API_KEY;
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

function imageToDataUri(filePath, mimetype) {
  const buf = fs.readFileSync(filePath);
  const mt = mimetype || (filePath.endsWith(".png") ? "image/png" : filePath.endsWith(".webp") ? "image/webp" : "image/jpeg");
  return `data:${mt};base64,${buf.toString("base64")}`;
}

function buildPrompt(caption) {
  const base = `Deskripsikan gambar ini dalam Bahasa Indonesia, padat tapi LENGKAP (jangan terpotong). Wajib sebut:
- Objek/subjek utama + JENIS-nya (kapal/truk/orang/tempat/dokumen/barang dll)
- Ciri visual khas yang bikin objek ini bisa dikenali lagi: warna, bentuk, ukuran, penanda/tulisan/logo, kondisi
- Latar/lokasi kalau keliatan (pelabuhan, gudang, jalan, dll)
- Kalau gambar isinya TEKS (struk, jadwal, dokumen, poster, chat) → EKSTRAK SEMUA teksnya verbatim, jangan diringkas`;
  if (caption && caption.trim()) {
    return `${base}

PENTING: User kasih caption untuk gambar ini: "${caption.trim()}"
Caption ini PRIORITAS — itu kebenaran tentang gambar. Pakai nama/lokasi/konteks dari caption sebagai label utama, lalu deskripsikan ciri visualnya supaya objek yang sama bisa dikenali lagi nanti walau tanpa caption. Contoh: caption "kapal kep Awi sampai Pelangiran" → "Kapal milik kep Awi (sesuai caption), kapal kayu warna ..., latar dermaga Pelangiran...".`;
  }
  return base + `\n\nGak ada caption — deskripsikan apa adanya, fokus ke ciri yang bisa dipakai mengenali objek ini lagi.`;
}

async function describeImage(filePath, { mimetype, prompt, caption } = {}) {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY belum diset");
  const dataUri = imageToDataUri(filePath, mimetype);
  const userPrompt = prompt || buildPrompt(caption);
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
    max_tokens: 700,
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

// Describe MULTIPLE frames in ONE request (Groq llama-4 = max 5 images). For video: the model
// sees the sequence -> coherent description across time, 1 call instead of N.
async function describeImages(filePaths, { prompt, caption } = {}) {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY belum diset");
  const paths = (filePaths || []).slice(0, 5);
  if (!paths.length) return "";
  const userPrompt = prompt || (
`Beberapa gambar di bawah ini adalah CUPLIKAN FRAME (berurutan) dari SATU video. Pahami sebagai satu video utuh, bukan gambar terpisah. Jawab Bahasa Indonesia, terstruktur:
- ISI VIDEO: apa yang terjadi/diperlihatkan (alur singkat dari frame awal ke akhir)
- OBJEK/ENTITAS: barang/orang/kendaraan/tempat penting + ciri khas (warna/bentuk/penanda) biar bisa dikenali lagi
- TEKS: kalau ada tulisan/teks di layar, ekstrak verbatim
- LATAR/LOKASI: kalau keliatan${caption && caption.trim() ? `

PENTING: caption video dari user: "${caption.trim()}" — ini PRIORITAS, pakai sebagai label utama.` : ""}`
  );
  const content = [{ type: "text", text: userPrompt }];
  for (const p of paths) content.push({ type: "image_url", image_url: { url: imageToDataUri(p) } });
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: VISION_MODEL, messages: [{ role: "user", content }], max_tokens: 900, temperature: 0.2 })
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Groq Vision HTTP ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = { describeImage, describeImages };
