const { db } = require("./db");
const { fmt } = require("./format");
const { fetchRssItems, COIN_IDS } = require("./prices");
const aiSent = require("./ai_sentiment");
const { sendNotification } = require("./notify");
const { addWatch } = require("./watchlist");

function getConfig() {
  let row = db.prepare("SELECT * FROM news_trader_config WHERE id=1").get();
  if (!row) {
    db.prepare("INSERT INTO news_trader_config (id) VALUES (1)").run();
    row = db.prepare("SELECT * FROM news_trader_config WHERE id=1").get();
  }
  return row;
}

const SOURCES = [
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://cointelegraph.com/rss"
];

function detectCoin(title, desc) {
  const hay = `${title} ${desc}`.toUpperCase();
  for (const sym of Object.keys(COIN_IDS)) {
    if (hay.includes(sym)) return sym;
    const name = COIN_IDS[sym].toUpperCase().replace(/-/g, " ");
    if (hay.includes(name)) return sym;
  }
  return null;
}

function keywordScore(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  const bull = ["surge", "rally", "soar", "breakout", "adoption", "partnership", "approval", "etf", "bullish", "gain", "record", "pump", "skyrocket", "boom"];
  const bear = ["crash", "plunge", "dump", "hack", "scam", "sell-off", "bearish", "crackdown", "ban", "lawsuit", "decline", "drop", "loss", "exploit"];
  let s = 0;
  for (const k of bull) if (text.includes(k)) s += 1;
  for (const k of bear) if (text.includes(k)) s -= 1;
  return Math.max(-1, Math.min(1, s / 4));
}

async function pollNews() {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  try {
    db.prepare("UPDATE news_trader_config SET last_poll_at=datetime('now') WHERE id=1").run();
    let items = [];
    for (const url of SOURCES) {
      try {
        const fetched = await fetchRssItems(url);
        items = items.concat(fetched);
      } catch {}
    }
    if (!items.length) return;
    items = items.slice(0, 20);
    for (const it of items) {
      const exists = db.prepare("SELECT id FROM news_signals WHERE url=?").get(it.link);
      if (exists) continue;
      const coin = detectCoin(it.title, it.description);
      if (!coin) continue;
      let score, sentiment, reason;
      if (aiSent.isAIEnabled()) {
        try {
          const r = await aiSent.analyzeNewsItemAI(it.title, it.description);
          score = r.score; sentiment = r.sentiment; reason = r.reason;
        } catch {
          score = keywordScore(it.title, it.description);
          sentiment = score > 0.2 ? "BULLISH" : (score < -0.2 ? "BEARISH" : "NEUTRAL");
          reason = "keyword fallback";
        }
      } else {
        score = keywordScore(it.title, it.description);
        sentiment = score > 0.2 ? "BULLISH" : (score < -0.2 ? "BEARISH" : "NEUTRAL");
        reason = "keyword scoring";
      }
      let action = "logged";
      const sigCfg = getConfig();
      if (score >= sigCfg.min_bullish_score || score <= sigCfg.min_bearish_score) {
        if (sigCfg.action_mode === "alert" || sigCfg.action_mode === "watchlist") {
          sendNotification({
            title: `📰 ${sentiment} ${coin} (${score.toFixed(2)})`,
            body: it.title,
            category: "watch_alert", priority: "high", tags: ["newspaper"]
          }).catch(() => {});
          action = "alert_sent";
        }
        if (sigCfg.action_mode === "watchlist") {
          try {
            const { fetchPrice } = require("./prices");
            const p = await fetchPrice(coin);
            if (score > 0) {
              await addWatch({ symbol: coin, price_below: p.price_idr * 0.98, portfolio_id: sigCfg.portfolio_id });
            } else {
              await addWatch({ symbol: coin, price_above: p.price_idr * 1.02, portfolio_id: sigCfg.portfolio_id });
            }
            action = "watch_added";
          } catch {}
        }
      }
      db.prepare("INSERT INTO news_signals (coin, score, sentiment, headline, url, action_taken) VALUES (?, ?, ?, ?, ?, ?)").run(coin, score, sentiment, it.title.slice(0, 200), it.link, action);
    }
    db.prepare("DELETE FROM news_signals WHERE created_at < datetime('now','-30 days')").run();
  } catch (err) {
    console.error("news_trader poll error:", err.message);
  }
}

let pollerStarted = false;
function ensurePoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const tick = () => {
    pollNews().catch(() => {});
    const cfg = getConfig();
    setTimeout(tick, (cfg.poll_interval_min || 15) * 60 * 1000);
  };
  setTimeout(tick, 10000);
}

async function enableNewsTrader({ portfolio_id = 1, min_bullish_score = 0.7, min_bearish_score = -0.7, action_mode = "alert", poll_interval_min = 15 }) {
  db.prepare(`UPDATE news_trader_config SET enabled=1, portfolio_id=?, min_bullish_score=?, min_bearish_score=?, action_mode=?, poll_interval_min=? WHERE id=1`)
    .run(portfolio_id, min_bullish_score, min_bearish_score, action_mode, poll_interval_min);
  ensurePoller();
  const text =
    `📰 NEWS TRADER ENABLED\n` +
    `${"─".repeat(50)}\n` +
    `🎯 Portfolio: #${portfolio_id}\n` +
    `🟢 Min bullish: ${min_bullish_score}\n` +
    `🔴 Min bearish: ${min_bearish_score}\n` +
    `⚙️ Action mode: ${action_mode} (alert | watchlist)\n` +
    `⏱️ Poll interval: ${poll_interval_min} menit\n\n` +
    `💡 Pakai AI sentiment kalau ANTHROPIC_API_KEY diset, fallback keyword.`;
  return { content: [{ type: "text", text }] };
}

async function disableNewsTrader() {
  db.prepare("UPDATE news_trader_config SET enabled=0 WHERE id=1").run();
  return { content: [{ type: "text", text: "✅ News trader dinonaktifkan." }] };
}

async function newsSignalsHistory({ coin, limit = 30 }) {
  let rows;
  if (coin) {
    rows = db.prepare("SELECT * FROM news_signals WHERE coin=? ORDER BY id DESC LIMIT ?").all(String(coin).toUpperCase(), limit);
  } else {
    rows = db.prepare("SELECT * FROM news_signals ORDER BY id DESC LIMIT ?").all(limit);
  }
  if (!rows.length) return { content: [{ type: "text", text: "Belum ada sinyal berita." }] };
  const lines = rows.map(s => {
    const emoji = s.sentiment === "BULLISH" ? "🟢" : (s.sentiment === "BEARISH" ? "🔴" : "⚪");
    return `[${s.created_at}] ${emoji} ${s.coin} ${s.score.toFixed(2)} | ${s.action_taken}\n   ${s.headline.slice(0, 90)}`;
  });
  return { content: [{ type: "text", text: ["📰 NEWS SIGNALS", "─".repeat(70), ...lines].join("\n") }] };
}

async function getNewsTraderStatus() {
  const cfg = getConfig();
  const recent = db.prepare("SELECT COUNT(*) AS c FROM news_signals WHERE created_at > datetime('now','-24 hours')").get().c;
  const text =
    `📰 NEWS TRADER STATUS\n` +
    `${"─".repeat(50)}\n` +
    `🔌 Enabled: ${cfg.enabled ? "🟢" : "🔴"}\n` +
    `🎯 Portfolio: #${cfg.portfolio_id}\n` +
    `🟢 Min bullish: ${cfg.min_bullish_score}\n` +
    `🔴 Min bearish: ${cfg.min_bearish_score}\n` +
    `⚙️ Action mode: ${cfg.action_mode}\n` +
    `⏱️ Poll every: ${cfg.poll_interval_min} menit\n` +
    `🕐 Last poll: ${cfg.last_poll_at || "(belum)"}\n` +
    `📊 Signals (24h): ${recent}`;
  return { content: [{ type: "text", text }] };
}

module.exports = { enableNewsTrader, disableNewsTrader, newsSignalsHistory, getNewsTraderStatus, pollNews, ensurePoller };
