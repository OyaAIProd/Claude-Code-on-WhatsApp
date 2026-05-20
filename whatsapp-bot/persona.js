const { db } = require("./storage");

const PERSONAS = {
  casual: {
    label: "Casual Jakarta",
    prompt: "Lo ngomong casual Jakarta — gw/lo/kita. Boleh emoji. Reply fragmental, gak formal."
  },
  formal: {
    label: "Formal Indonesia",
    prompt: "Anda berbicara formal Bahasa Indonesia baku — saya/Anda. Hindari slang. Tone profesional, hormat. Minim emoji."
  },
  professional: {
    label: "Profesional bisnis",
    prompt: "Lo tone profesional bisnis — saya/Anda. Singkat, padat, actionable. Pakai bullet kalau perlu. Minim emoji."
  },
  funny: {
    label: "Lucu santai",
    prompt: "Lo ngomong lucu/joke santai — gw/lo. Boleh sindir sopan + emoji aktif. Tetap helpful tapi gak boring."
  },
  technical: {
    label: "Engineer technical",
    prompt: "Lo ngomong teknis tepat — pakai term technical sesuai bidang. Singkat, no fluff. Code blocks rendered."
  },
  supportive: {
    label: "Supportive empati",
    prompt: "Lo tone supportive + empati. Validasi perasaan dulu sebelum kasih saran. Sabar, gentle, encouraging."
  }
};

function getPersona(chatId) {
  const cfg = db.prepare("SELECT persona, persona_auto FROM chat_config WHERE chat_id=?").get(chatId);
  return { name: cfg?.persona || "casual", auto: cfg?.persona_auto !== 0 };
}

function setPersona(chatId, name, auto) {
  if (!PERSONAS[name] && name !== "auto") return false;
  if (name === "auto") {
    db.prepare(`INSERT INTO chat_config (chat_id, persona_auto) VALUES (?, 1) ON CONFLICT(chat_id) DO UPDATE SET persona_auto=1, updated_at=datetime('now')`).run(chatId);
    return true;
  }
  const autoVal = auto === undefined ? 0 : (auto ? 1 : 0);
  db.prepare(`INSERT INTO chat_config (chat_id, persona, persona_auto) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET persona=excluded.persona, persona_auto=excluded.persona_auto, updated_at=datetime('now')`).run(chatId, name, autoVal);
  return true;
}

function detectPersonaFromText(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(gw|gue|lo|lu|elo|bro|sis|cuy|anjir|anjay|wkwk|haha|lol|asik|bener|gokil|mantap|gas)\b/.test(t)) return "casual";
  if (/\b(saya|anda|bapak|ibu|mohon|dengan hormat|sebelumnya|silakan|terima kasih)\b/i.test(t) && !/\b(gw|lo)\b/.test(t)) return "formal";
  if (/\b(meeting|deadline|stakeholder|kpi|roadmap|deliverable|proposal|laporan|action item)\b/.test(t)) return "professional";
  if (/(```|function\(|const |def |import |npm |\.js|\.ts|\.py|api|endpoint|database|sql|json|error:)/i.test(t)) return "technical";
  if (/\b(sedih|capek|stress|gabisa|gagal|takut|kecewa|frustasi|lelah)\b/.test(t)) return "supportive";
  return null;
}

function detectFromRecentMessages(messages, fallback = "casual") {
  if (!messages.length) return fallback;
  const candidates = {};
  for (const m of messages.slice(-12)) {
    if (m.from_me) continue;
    const d = detectPersonaFromText(m.text || "");
    if (d) candidates[d] = (candidates[d] || 0) + 1;
  }
  let best = null, max = 0;
  for (const [k, v] of Object.entries(candidates)) { if (v > max) { max = v; best = k; } }
  return best || fallback;
}

function buildPersonaPrompt(chatId, recentMessages = []) {
  const { name, auto } = getPersona(chatId);
  let effective = name;
  if (auto) {
    const detected = detectFromRecentMessages(recentMessages, name);
    effective = detected;
  }
  const p = PERSONAS[effective] || PERSONAS.casual;
  return { effective, label: p.label, prompt: `\n🎭 PERSONA (${effective}): ${p.prompt}\n` };
}

function listPersonas() {
  return Object.entries(PERSONAS).map(([k, v]) => ({ key: k, label: v.label }));
}

module.exports = { PERSONAS, getPersona, setPersona, detectPersonaFromText, detectFromRecentMessages, buildPersonaPrompt, listPersonas };
