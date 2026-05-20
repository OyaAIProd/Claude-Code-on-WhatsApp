const { db, getActivePortfolioId, resolvePortfolioId, getPortfolio, updatePortfolioCash } = require("./db");
const { fmt } = require("./format");
const { fetchPrice, resolveCoinId } = require("./prices");
const { takeEquitySnapshot } = require("./execution");

async function openPosition({ symbol, side, margin_idr, leverage, portfolio_id }) {
  const { sym } = resolveCoinId(symbol);
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const portfolio = getPortfolio(pid);
  if (margin_idr > portfolio.cash_idr) return { content: [{ type: "text", text: `❌ Cash kurang. Punya: Rp${fmt(portfolio.cash_idr)}` }] };
  const p = await fetchPrice(sym);
  const notional = margin_idr * leverage;
  const qty = notional / p.price_idr;
  const liq = side === "LONG"
    ? p.price_idr * (1 - (1 / leverage) * 0.9)
    : p.price_idr * (1 + (1 / leverage) * 0.9);
  const r = db.prepare(`INSERT INTO positions (portfolio_id, symbol, side, entry_price_idr, qty, leverage, margin_idr, liq_price_idr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(pid, sym, side, p.price_idr, qty, leverage, margin_idr, liq);
  updatePortfolioCash(pid, -margin_idr);
  takeEquitySnapshot(pid);
  const text =
    `✅ POSITION #${r.lastInsertRowid} ${side} ${sym} (portfolio #${pid})\n` +
    `Entry: Rp${fmt(p.price_idr)} | Qty: ${qty.toFixed(8)}\n` +
    `Margin: Rp${fmt(margin_idr)} | Lev: ${leverage}x | Notional: Rp${fmt(notional)}\n` +
    `💀 Liq: Rp${fmt(liq)}`;
  return { content: [{ type: "text", text }] };
}

async function closePosition({ id }) {
  const pos = db.prepare("SELECT * FROM positions WHERE id = ? AND status='OPEN'").get(id);
  if (!pos) return { content: [{ type: "text", text: `❌ Position #${id} tidak ada / sudah closed` }] };
  const p = await fetchPrice(pos.symbol);
  const exitPrice = p.price_idr;
  const pnl = pos.side === "LONG"
    ? (exitPrice - pos.entry_price_idr) * pos.qty
    : (pos.entry_price_idr - exitPrice) * pos.qty;
  const refund = pos.margin_idr + pnl - (pos.funding_paid_idr || 0);
  const pid = pos.portfolio_id || 1;
  db.transaction(() => {
    db.prepare("UPDATE positions SET status='CLOSED', pnl_idr=?, closed_at=datetime('now') WHERE id=?").run(pnl, id);
    updatePortfolioCash(pid, Math.max(0, refund));
  })();
  takeEquitySnapshot(pid);
  const text =
    `✅ CLOSE #${id} ${pos.side} ${pos.symbol}\n` +
    `Entry Rp${fmt(pos.entry_price_idr)} → Exit Rp${fmt(exitPrice)}\n` +
    `PnL: ${pnl >= 0 ? "+" : ""}Rp${fmt(pnl)} | Funding: -Rp${fmt(pos.funding_paid_idr || 0)}\n` +
    `Refund: Rp${fmt(Math.max(0, refund))}`;
  return { content: [{ type: "text", text }] };
}

async function listPositions({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const rows = db.prepare("SELECT * FROM positions WHERE portfolio_id=? ORDER BY id DESC LIMIT 30").all(pid);
  if (!rows.length) return { content: [{ type: "text", text: "Tidak ada position." }] };
  const lines = [];
  for (const pos of rows) {
    let mark = pos.entry_price_idr, upnl = pos.pnl_idr || 0;
    if (pos.status === "OPEN") {
      const cached = db.prepare("SELECT price_idr FROM price_cache WHERE symbol = ?").get(pos.symbol);
      mark = cached?.price_idr || pos.entry_price_idr;
      upnl = pos.side === "LONG" ? (mark - pos.entry_price_idr) * pos.qty : (pos.entry_price_idr - mark) * pos.qty;
    }
    lines.push(
      `#${pos.id} [${pos.status}] ${pos.side} ${pos.symbol} ${pos.leverage}x | entry Rp${fmt(pos.entry_price_idr)} | liq Rp${fmt(pos.liq_price_idr)} | mark Rp${fmt(mark)} | PnL ${upnl>=0?"+":""}Rp${fmt(upnl)} | margin Rp${fmt(pos.margin_idr)}`
    );
  }
  return { content: [{ type: "text", text: [`📊 POSITIONS (portfolio #${pid})`, "─".repeat(80), ...lines].join("\n") }] };
}

function checkPositions(prices) {
  const positions = db.prepare("SELECT * FROM positions WHERE status='OPEN'").all();
  for (const pos of positions) {
    const p = prices[pos.symbol];
    if (!p) continue;
    const cur = p.price_idr;
    const liqHit = pos.side === "LONG" ? cur <= pos.liq_price_idr : cur >= pos.liq_price_idr;
    if (liqHit) {
      try {
        db.transaction(() => {
          db.prepare("UPDATE positions SET status='LIQUIDATED', pnl_idr=?, closed_at=datetime('now') WHERE id=?").run(-pos.margin_idr, pos.id);
        })();
        console.error(`💀 LIQUIDATED #${pos.id} ${pos.side} ${pos.symbol} @ Rp${fmt(cur)}`);
        try {
          const { sendNotification } = require("./notify");
          sendNotification({
            title: `💀 LIQUIDATED #${pos.id}`,
            body: `${pos.side} ${pos.symbol} liquidated @ Rp${fmt(cur)}. Margin Rp${fmt(pos.margin_idr)} lost.`,
            category: "liquidation", priority: "urgent", tags: ["skull", "warning"]
          }).catch(() => {});
        } catch {}
      } catch (err) { console.error(`liq error: ${err.message}`); }
      continue;
    }
    const lastFunding = new Date(pos.last_funding_at).getTime();
    if (Date.now() - lastFunding >= 3600 * 1000) {
      const fund = pos.margin_idr * 0.0001 * pos.leverage;
      db.prepare("UPDATE positions SET funding_paid_idr = COALESCE(funding_paid_idr,0) + ?, last_funding_at=datetime('now') WHERE id=?").run(fund, pos.id);
    }
  }
}

module.exports = { openPosition, closePosition, listPositions, checkPositions };
