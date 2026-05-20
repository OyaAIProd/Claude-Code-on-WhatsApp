const fetch = require("node-fetch");
const { db } = require("./db");

let useAI = !!process.env.ANTHROPIC_API_KEY;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";
const CACHE_TTL_HOURS = 24;

const BULL_KW = ["surge", "rally", "soar", "breakout", "adoption", "partnership", "approval", "etf", "bullish", "gain", "record", "pump", "all-time high", "ath"];
const BEAR_KW = ["crash", "plunge", "dump", "hack", "scam", "sell-off", "selloff", "bearish", "crackdown", "ban", "lawsuit", "decline", "fud", "exploit"];

function scoreSentimentKeyword(text) {
  const t = text.toLowerCase();
  let b = 0, r = 0;
  for (const k of BULL_KW) if (t.includes(k)) b++;
  for (const k of BEAR_KW) if (t.includes(k)) r++;
  const s = b - r;
  const label = s > 0 ? "BULLISH" : s < 0 ? "BEARISH" : "NEUTRAL";
  const emoji = s > 0 ? "🟢" : s < 0 ? "🔴" : "⚪";
  const norm = Math.max(-1, Math.min(1, s / 3));
  return { sentiment: label, score: norm, emoji, reason: `${b} bull / ${r} bear kw`, raw: s };
}

function isAIEnabled() { return useAI; }

function setAIEnabled(v) {
  if (v && !API_KEY) return false;
  useAI = !!v;
  return useAI;
}

function getCached(url) {
  if (!url) return null;
  const row = db.prepare("SELECT *, (julianday('now') - julianday(analyzed_at)) * 24 AS age_hours FROM news_sentiment_cache WHERE url=?").get(url);
  if (row && row.age_hours !== null && row.age_hours < CACHE_TTL_HOURS) return row;
  return null;
}

function setCached(url, sentiment, score, reason) {
  if (!url) return;
  try {
    db.prepare("INSERT OR REPLACE INTO news_sentiment_cache (url, sentiment, score, reason, analyzed_at) VALUES (?, ?, ?, ?, datetime('now'))")
      .run(url, sentiment, score, reason || "");
  } catch {}
}

async function analyzeNewsItemAI(title, description, url) {
  if (!useAI || !API_KEY) {
    const s = scoreSentimentKeyword(`${title} ${description}`);
    return { ...s, mode: "keyword" };
  }
  const cached = getCached(url);
  if (cached) {
    const emoji = cached.sentiment === "BULLISH" ? "🟢" : cached.sentiment === "BEARISH" ? "🔴" : "⚪";
    return { sentiment: cached.sentiment, score: cached.score, reason: cached.reason, emoji, mode: "AI/cache" };
  }
  try {
    console.error(`🤖 AI sentiment call: ${title.slice(0, 60)}`);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      timeout: 15000,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 80,
        system: 'You analyze crypto news sentiment. Reply with ONLY a JSON object: {"sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": -1.0 to 1.0, "reason": "<8 words max>"}',
        messages: [{ role: "user", content: `Title: ${title}\nDescription: ${description || ""}` }]
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const txt = data?.content?.[0]?.text || "";
    const match = txt.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error("no JSON in response");
    const parsed = JSON.parse(match[0]);
    const sentiment = (parsed.sentiment || "NEUTRAL").toUpperCase();
    const score = Math.max(-1, Math.min(1, Number(parsed.score) || 0));
    const reason = String(parsed.reason || "").slice(0, 80);
    setCached(url, sentiment, score, reason);
    const emoji = sentiment === "BULLISH" ? "🟢" : sentiment === "BEARISH" ? "🔴" : "⚪";
    return { sentiment, score, reason, emoji, mode: "AI" };
  } catch (err) {
    console.error("AI sentiment fallback:", err.message);
    const s = scoreSentimentKeyword(`${title} ${description}`);
    return { ...s, mode: "keyword" };
  }
}

module.exports = { analyzeNewsItemAI, scoreSentimentKeyword, isAIEnabled, setAIEnabled };
