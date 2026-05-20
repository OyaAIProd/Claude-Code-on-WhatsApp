const { db, getActivePortfolioId, resolvePortfolioId } = require("./db");
const { fmt } = require("./format");
const { fetchPrice, resolveCoinId } = require("./prices");
const { executeBuyInternal, executeSellInternal } = require("./execution");

function createSlTpOrders(sym, entryPrice, sl_pct, tp_pct, portfolio_id) {
  const pid = portfolio_id || getActivePortfolioId();
  if (sl_pct && sl_pct > 0) {
    const trigger = entryPrice * (1 - sl_pct / 100);
    db.prepare(`INSERT INTO pending_orders (portfolio_id, type, symbol, trigger_price_idr, percent, parent_holding_symbol, note) VALUES (?, 'STOP_LOSS', ?, ?, 100, ?, ?)`)
      .run(pid, sym, trigger, sym, `SL ${sl_pct}% dari entry Rp${fmt(entryPrice)}`);
  }
  if (tp_pct && tp_pct > 0) {
    const trigger = entryPrice * (1 + tp_pct / 100);
    db.prepare(`INSERT INTO pending_orders (portfolio_id, type, symbol, trigger_price_idr, percent, parent_holding_symbol, note) VALUES (?, 'TAKE_PROFIT', ?, ?, 100, ?, ?)`)
      .run(pid, sym, trigger, sym, `TP ${tp_pct}% dari entry Rp${fmt(entryPrice)}`);
  }
}

async function placeOrder({ type, symbol, trigger_price_idr, amount_idr, percent, note, portfolio_id }) {
  const { sym } = resolveCoinId(symbol);
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan: ${portfolio_id}` }] };
  if (type === "BUY_LIMIT" && !amount_idr) return { content: [{ type: "text", text: "❌ BUY_LIMIT butuh amount_idr" }] };
  if (type !== "BUY_LIMIT" && !percent) return { content: [{ type: "text", text: `❌ ${type} butuh percent (1-100)` }] };
  const r = db.prepare(`INSERT INTO pending_orders (portfolio_id, type, symbol, trigger_price_idr, amount_idr, percent, parent_holding_symbol, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(pid, type, sym, trigger_price_idr, amount_idr || null, percent || null, type !== "BUY_LIMIT" ? sym : null, note || "");
  const text =
    `✅ ORDER #${r.lastInsertRowid} dipasang (portfolio #${pid})\n` +
    `${type} ${sym} @ Rp${fmt(trigger_price_idr)}\n` +
    (amount_idr ? `Amount: Rp${fmt(amount_idr)}` : `Percent: ${percent}%`) +
    (note ? `\nNote: ${note}` : "");
  return { content: [{ type: "text", text }] };
}

async function cancelOrder({ id }) {
  const o = db.prepare("SELECT * FROM pending_orders WHERE id = ?").get(id);
  if (!o) return { content: [{ type: "text", text: `❌ Order #${id} tidak ada` }] };
  if (o.status !== "OPEN") return { content: [{ type: "text", text: `❌ Order #${id} status: ${o.status}` }] };
  db.prepare("UPDATE pending_orders SET status='CANCELLED' WHERE id = ?").run(id);
  return { content: [{ type: "text", text: `✅ Order #${id} dibatalkan` }] };
}

async function listOrders({ status, portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const rows = status
    ? db.prepare("SELECT * FROM pending_orders WHERE portfolio_id=? AND status = ? ORDER BY id DESC").all(pid, status)
    : db.prepare("SELECT * FROM pending_orders WHERE portfolio_id=? ORDER BY id DESC LIMIT 30").all(pid);
  if (!rows.length) return { content: [{ type: "text", text: "Tidak ada order." }] };
  const lines = rows.map((o) =>
    `#${o.id} [${o.status}] ${o.type} ${o.symbol} @ Rp${fmt(o.trigger_price_idr)}` +
    (o.amount_idr ? ` | Rp${fmt(o.amount_idr)}` : ` | ${o.percent}%`) +
    (o.note ? ` | ${o.note}` : "")
  );
  const text = [`📋 ORDERS (portfolio #${pid})`, "─".repeat(60), ...lines].join("\n");
  return { content: [{ type: "text", text }] };
}

async function checkPendingOrders(prices) {
  const orders = db.prepare("SELECT * FROM pending_orders WHERE status='OPEN'").all();
  for (const o of orders) {
    const p = prices[o.symbol];
    if (!p) continue;
    const cur = p.price_idr;
    let triggered = false;
    if (o.type === "BUY_LIMIT" && cur <= o.trigger_price_idr) triggered = true;
    else if ((o.type === "SELL_LIMIT" || o.type === "TAKE_PROFIT") && cur >= o.trigger_price_idr) triggered = true;
    else if (o.type === "STOP_LOSS" && cur <= o.trigger_price_idr) triggered = true;
    if (!triggered) continue;
    try {
      const pid = o.portfolio_id || 1;
      if (o.type === "BUY_LIMIT") {
        executeBuyInternal(o.symbol, o.amount_idr, { midPrice: cur, price_usd: p.price_usd, note: `Limit order #${o.id}`, portfolio_id: pid });
      } else {
        executeSellInternal(o.symbol, o.percent, { midPrice: cur, price_usd: p.price_usd, note: `${o.type} order #${o.id}`, portfolio_id: pid });
      }
      db.prepare("UPDATE pending_orders SET status='FILLED', filled_at=datetime('now') WHERE id=?").run(o.id);
      console.error(`🔔 Order #${o.id} filled: ${o.type} ${o.symbol} @ Rp${fmt(cur)}`);
      try {
        const { sendNotification } = require("./notify");
        const cat = o.type === "STOP_LOSS" ? "sl_hit" : (o.type === "TAKE_PROFIT" ? "tp_hit" : "order_fill");
        const prio = (cat === "sl_hit" || cat === "tp_hit") ? "high" : "default";
        sendNotification({
          title: `📌 ${o.type} ${o.symbol}`,
          body: `Order #${o.id} filled @ Rp${fmt(cur)} (portfolio #${o.portfolio_id || 1})`,
          category: cat, priority: prio, tags: ["chart_with_upwards_trend"]
        }).catch(() => {});
      } catch {}
    } catch (err) {
      console.error(`order fill error #${o.id}: ${err.message}`);
    }
  }
}

module.exports = { createSlTpOrders, placeOrder, cancelOrder, listOrders, checkPendingOrders };
