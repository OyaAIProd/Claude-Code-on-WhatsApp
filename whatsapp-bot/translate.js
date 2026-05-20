const { db, getChatConfig, setChatConfig } = require("./storage");
const fetch = global.fetch || require("node-fetch");

const GROQ_KEY = process.env.GROQ_API_KEY;
const TRANSLATE_MODEL = process.env.GROQ_TRANSLATE_MODEL || "llama-3.3-70b-versatile";

const LANG_NAMES = {
  id: "Indonesia", en: "English", ja: "Japanese", ko: "Korean", zh: "Chinese",
  ar: "Arabic", de: "German", fr: "French", es: "Spanish", pt: "Portuguese",
  ru: "Russian", th: "Thai", vi: "Vietnamese", ms: "Malay", tl: "Tagalog",
  hi: "Hindi", it: "Italian", nl: "Dutch", tr: "Turkish"
};

function getChatLangConfig(chatId) {
  const cfg = getChatConfig(chatId);
  return {
    preferred: cfg?.preferred_lang || null,
    mode: cfg?.translate_mode || "off"
  };
}

function setChatLang(chatId, lang, mode) {
  const updates = {};
  if (lang !== undefined) updates.preferred_lang = lang;
  if (mode !== undefined) updates.translate_mode = mode;
  setChatConfig(chatId, updates);
  return getChatLangConfig(chatId);
}

function detectLang(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[฀-๿]/.test(text)) return "th";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  const scores = { id: 0, en: 0, es: 0, fr: 0, de: 0, pt: 0, it: 0, nl: 0, tr: 0, ms: 0, tl: 0, vi: 0 };
  const id_kw = /\b(yang|saya|kamu|kita|adalah|dan|atau|tidak|gak|nggak|gw|lo|nih|dong|sih|aja|deh|halo|terima kasih|makasih|bro|sis|tolong|sudah|udah|belum|bisa|jangan|harus|akan|sama|untuk|dari|dengan|ini|itu|kalau|kalo|gimana|kenapa|dimana|kapan)\b/g;
  const en_kw = /\b(the|is|are|was|were|have|has|will|would|could|should|with|from|that|this|hello|hi|thanks|thank you|please|sorry|because|about|after|before|during|between)\b/g;
  const es_kw = /\b(el|la|los|las|que|de|en|por|para|con|sin|sobre|entre|hola|gracias|pero|cuando|donde|porque|tambi[eé]n)\b/g;
  const fr_kw = /\b(le|la|les|de|du|des|et|ou|qui|que|dans|pour|avec|bonjour|merci|mais|comme)\b/g;
  const de_kw = /\b(der|die|das|und|oder|nicht|ist|sind|war|haben|wird|hallo|danke|aber|wenn)\b/g;
  const pt_kw = /\b(o|os|as|de|que|n[ãa]o|para|com|por|olá|obrigado|também|porque)\b/g;
  const it_kw = /\b(il|la|i|gli|le|di|che|non|per|con|sono|ciao|grazie|anche|perch[eé])\b/g;
  const ms_kw = /\b(saya|awak|anda|tak|tidak|terima kasih|tolong|sila|boleh|nak|tak nak)\b/g;
  scores.id = (t.match(id_kw) || []).length;
  scores.en = (t.match(en_kw) || []).length;
  scores.es = (t.match(es_kw) || []).length;
  scores.fr = (t.match(fr_kw) || []).length;
  scores.de = (t.match(de_kw) || []).length;
  scores.pt = (t.match(pt_kw) || []).length;
  scores.it = (t.match(it_kw) || []).length;
  scores.ms = (t.match(ms_kw) || []).length;
  let best = null, max = 0;
  for (const [k, v] of Object.entries(scores)) { if (v > max) { max = v; best = k; } }
  if (max < 1) return null;
  return best;
}

async function translateText(text, targetLang, sourceLang = null) {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY missing");
  if (!text || !targetLang) return text;
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const srcHint = sourceLang ? ` from ${LANG_NAMES[sourceLang] || sourceLang}` : "";
  const body = {
    model: TRANSLATE_MODEL,
    messages: [
      { role: "system", content: `You are a precise translator. Translate the user's text${srcHint} to ${targetName}. Reply with ONLY the translation, no explanations, no quotes, no prefixes. Preserve emoji, formatting, urls, names, numbers, code blocks as-is.` },
      { role: "user", content: text }
    ],
    max_tokens: Math.min(4000, text.length * 4),
    temperature: 0.2
  };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Groq translate HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function maybeTranslateIncoming(chatId, text) {
  const { preferred, mode } = getChatLangConfig(chatId);
  if (!preferred || mode === "off" || !text || text.length < 4) return null;
  const detected = detectLang(text);
  if (!detected || detected === preferred) return null;
  if (mode !== "auto" && mode !== "incoming") return null;
  try {
    const translated = await translateText(text, preferred, detected);
    if (!translated || translated.trim() === text.trim()) return null;
    return { from: detected, to: preferred, text: translated };
  } catch (err) {
    console.error("translate incoming:", err.message);
    return null;
  }
}

function listLangs() {
  return Object.entries(LANG_NAMES).map(([k, v]) => ({ code: k, name: v }));
}

module.exports = { detectLang, translateText, maybeTranslateIncoming, getChatLangConfig, setChatLang, listLangs, LANG_NAMES };
