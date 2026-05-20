const { db, getActivePortfolioId, resolvePortfolioId } = require("./db");
const { fmt } = require("./format");
const { resolveCoinId } = require("./prices");

async function addWatch({ symbol, price_above, price_below, portfolio_id }) {
  const { sym } = resolveCoinId(symbol);
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  if (!price_above && !price_below) return { content: [{ type: "text", text: "❌ Isi price_above atau price_below" }] };
  const r = db.prepare("INSERT INTO watchlist (portfolio_id, symbol, price_above, price_below) VALUES (?, ?, ?, ?)").run(pid, sym, price_above || null, price_below || null);
  return { content: [{ type: "text", text: `✅ Watch #${r.lastInsertRowid} ${sym}` + (price_above ? ` >Rp${fmt(price_above)}` : "") + (price_below ? ` <Rp${fmt(price_below)}` : "") + ` (portfolio #${pid})` }] };
}

async function listWatches({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const rows = db.prepare("SELECT * FROM watchlist WHERE portfolio_id=? ORDER BY id DESC").all(pid);
  if (!rows.length) return { content: [{ type: "text", text: "Watchlist kosong." }] };
  const lines = rows.map((w) =>
    `#${w.id} ${w.symbol}` +
    (w.price_above ? ` >Rp${fmt(w.price_above)}` : "") +
    (w.price_below ? ` <Rp${fmt(w.price_below)}` : "") +
    (w.triggered ? ` 🔔 [${w.triggered_at}] ${w.triggered_reason || ""}` : "")
  );
  return { content: [{ type: "text", text: [`👁️ WATCHLIST (portfolio #${pid})`, "─".repeat(60), ...lines].join("\n") }] };
}

async function removeWatch({ id }) {
  const r = db.prepare("DELETE FROM watchlist WHERE id = ?").run(id);
  return { content: [{ type: "text", text: r.changes ? `✅ Watch #${id} dihapus` : `❌ Tidak ada watch #${id}` }] };
}

async function getAlerts({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const rows = db.prepare("SELECT * FROM watchlist WHERE portfolio_id=? AND triggered=1 ORDER BY triggered_at DESC LIMIT 30").all(pid);
  if (!rows.length) return { content: [{ type: "text", text: "Belum ada alert." }] };
  const lines = rows.map((w) => `[${w.triggered_at}] #${w.id} ${w.symbol}: ${w.triggered_reason}`);
  return { content: [{ type: "text", text: ["🔔 ALERTS", "─".repeat(60), ...lines].join("\n") }] };
}

function checkWatchlist(prices) {
  const watches = db.prepare("SELECT * FROM watchlist WHERE triggered=0").all();
  for (const w of watches) {
    const p = prices[w.symbol];
    if (!p) continue;
    const cur = p.price_idr;
    let reason = null;
    if (w.price_above && cur >= w.price_above) reason = `${w.symbol} ≥ Rp${fmt(w.price_above)} (now Rp${fmt(cur)})`;
    else if (w.price_below && cur <= w.price_below) reason = `${w.symbol} ≤ Rp${fmt(w.price_below)} (now Rp${fmt(cur)})`;
    if (reason) {
      db.prepare("UPDATE watchlist SET triggered=1, triggered_at=datetime('now'), triggered_reason=? WHERE id=?").run(reason, w.id);
      console.error(`🔔 ALERT: ${reason}`);
      try {
        const { sendNotification } = require("./notify");
        sendNotification({
          title: `🔔 Watchlist ${w.symbol}`,
          body: reason, category: "watch_alert", priority: "high", tags: ["bell"]
        }).catch(() => {});
      } catch {}
    }
  }
}

module.exports = { addWatch, listWatches, removeWatch, getAlerts, checkWatchlist };
