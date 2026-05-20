const { fetchRssItems, COIN_IDS, resolveCoinId } = require("./prices");
const { analyzeNewsItemAI, scoreSentimentKeyword, isAIEnabled, setAIEnabled } = require("./ai_sentiment");

const RSS_SOURCES = [
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://cointelegraph.com/rss"
];

async function loadNews() {
  let items = [];
  let lastErr = null;
  for (const url of RSS_SOURCES) {
    try {
      items = await fetchRssItems(url);
      if (items.length) break;
    } catch (err) { lastErr = err; }
  }
  if (!items.length) throw new Error(lastErr?.message || "no items");
  return items;
}

function filterNewsByCoin(items, coin) {
  if (!coin) return items;
  const needle = String(coin).toLowerCase();
  const sym = needle.toUpperCase();
  const fullName = COIN_IDS[sym] ? COIN_IDS[sym].replace(/-/g, " ") : needle;
  const filtered = items.filter((it) => {
    const hay = `${it.title} ${it.description}`.toLowerCase();
    return hay.includes(needle) || hay.includes(fullName) || hay.includes(sym.toLowerCase());
  });
  return filtered.length ? filtered : items.slice(0, 10);
}

async function getCryptoNews({ coin }) {
  let items;
  try { items = await loadNews(); }
  catch (err) { return { content: [{ type: "text", text: `❌ Gagal ambil berita: ${err.message}` }] }; }
  const filtered = filterNewsByCoin(items, coin);
  const top = filtered.slice(0, 10);
  const aiMode = isAIEnabled();
  const results = aiMode
    ? await Promise.all(top.map((n) => analyzeNewsItemAI(n.title, n.description, n.link)))
    : top.map((n) => ({ ...scoreSentimentKeyword(`${n.title} ${n.description}`), mode: "keyword" }));
  let totalScore = 0, bullCount = 0, bearCount = 0, neutCount = 0;
  const rows = top.map((n, i) => {
    const s = results[i];
    totalScore += s.score;
    if (s.sentiment === "BULLISH") bullCount++;
    else if (s.sentiment === "BEARISH") bearCount++;
    else neutCount++;
    const dt = n.pubDate ? new Date(n.pubDate).toISOString().slice(0, 16).replace("T", " ") : "n/a";
    const body = n.description.slice(0, 140);
    const tag = `${s.emoji} ${s.sentiment} (${s.score >= 0 ? "+" : ""}${Number(s.score).toFixed(2)})${s.reason ? " - " + s.reason : ""}`;
    return `${i + 1}. ${tag} [${dt}] ${n.title}\n   ${body}${body.length >= 140 ? "..." : ""}\n   ${n.link}`;
  });
  const total = rows.length || 1;
  const avg = totalScore / total;
  const overall = avg > 0.1 ? "🟢 Bullish" : avg < -0.1 ? "🔴 Bearish" : "⚪ Neutral";
  const head = coin ? `📰 NEWS ${String(coin).toUpperCase()}` : "📰 CRYPTO NEWS";
  const modeTag = aiMode ? "(AI)" : "(keyword)";
  const summary = `📊 Sentiment ${modeTag}: ${overall} (avg: ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}) | 🟢${bullCount} 🔴${bearCount} ⚪${neutCount}`;
  return { content: [{ type: "text", text: [head, "─".repeat(60), summary, "─".repeat(60), ...rows].join("\n") }] };
}

async function getMarketMood({ coin }) {
  let items;
  try { items = await loadNews(); }
  catch (err) { return { content: [{ type: "text", text: `❌ Gagal ambil berita: ${err.message}` }] }; }
  const filtered = filterNewsByCoin(items, coin);
  const top = filtered.slice(0, 20);
  const aiMode = isAIEnabled();
  const results = aiMode
    ? await Promise.all(top.map((n) => analyzeNewsItemAI(n.title, n.description, n.link)))
    : top.map((n) => ({ ...scoreSentimentKeyword(`${n.title} ${n.description}`), mode: "keyword" }));
  let totalScore = 0, bull = 0, bear = 0, neut = 0;
  const annotated = top.map((n, i) => ({ ...n, ...results[i] }));
  for (const a of annotated) {
    totalScore += a.score;
    if (a.sentiment === "BULLISH") bull++;
    else if (a.sentiment === "BEARISH") bear++;
    else neut++;
  }
  const t = annotated.length || 1;
  const avg = totalScore / t;
  const overall = avg > 0.1 ? "🟢 BULLISH" : avg < -0.1 ? "🔴 BEARISH" : "⚪ NEUTRAL";
  const sorted = [...annotated].sort((a, b) => b.score - a.score);
  const topBull = sorted.slice(0, 3).filter((x) => x.sentiment === "BULLISH");
  const topBear = sorted.slice(-3).reverse().filter((x) => x.sentiment === "BEARISH");
  const modeTag = aiMode ? "(AI)" : "(keyword)";
  const head = `🌡️ MARKET MOOD ${coin ? String(coin).toUpperCase() : "GENERAL"} ${modeTag}`;
  const summary = [
    `Overall: ${overall} | Avg score: ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}`,
    `🟢 Bullish: ${((bull / t) * 100).toFixed(0)}% (${bull})`,
    `🔴 Bearish: ${((bear / t) * 100).toFixed(0)}% (${bear})`,
    `⚪ Neutral: ${((neut / t) * 100).toFixed(0)}% (${neut})`,
    `📦 Sample: ${t} news`
  ];
  const bullSection = topBull.length
    ? ["", "📈 Most Bullish:", ...topBull.map((x, i) => `  ${i + 1}. (${x.score.toFixed(2)}) ${x.title}`)]
    : [];
  const bearSection = topBear.length
    ? ["", "📉 Most Bearish:", ...topBear.map((x, i) => `  ${i + 1}. (${x.score.toFixed(2)}) ${x.title}`)]
    : [];
  return { content: [{ type: "text", text: [head, "─".repeat(60), ...summary, ...bullSection, ...bearSection].join("\n") }] };
}

async function setAiSentiment({ enabled }) {
  const ok = setAIEnabled(enabled);
  if (enabled && !ok) return { content: [{ type: "text", text: "❌ ANTHROPIC_API_KEY tidak diset di environment." }] };
  return { content: [{ type: "text", text: `✅ AI sentiment: ${ok ? "ENABLED 🤖" : "DISABLED (keyword fallback)"}` }] };
}

module.exports = { getCryptoNews, getMarketMood, setAiSentiment };
