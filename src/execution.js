const { db, getPortfolio, updatePortfolioCash, getActivePortfolioId } = require("./db");
const { fmt } = require("./format");

function applySpread(midPrice, side) {
  if (side === "BUY") return midPrice * 1.001;
  return midPrice * 0.999;
}

function applySlippage(price, side) {
  const slip = 0.0005 + Math.random() * 0.0025;
  if (side === "BUY") return price * (1 + slip);
  return price * (1 - slip);
}

function getFeeRate(volume30d) {
  if (volume30d < 10_000_000) return { rate: 0.003, tier: "T1 (0.3%)" };
  if (volume30d < 50_000_000) return { rate: 0.002, tier: "T2 (0.2%)" };
  if (volume30d < 200_000_000) return { rate: 0.0015, tier: "T3 (0.15%)" };
  return { rate: 0.001, tier: "T4 (0.1%)" };
}

function getVolume30d(portfolio_id) {
  const pid = portfolio_id || getActivePortfolioId();
  const row = db
    .prepare("SELECT COALESCE(SUM(total_idr),0) AS v FROM trades WHERE portfolio_id=? AND created_at >= datetime('now','-30 days')")
    .get(pid);
  return row?.v || 0;
}

function computeTotalEquity(portfolio_id) {
  const pid = portfolio_id || getActivePortfolioId();
  const portfolio = getPortfolio(pid);
  const holdings = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND amount > 0.000001").all(pid);
  let holdValue = 0;
  for (const h of holdings) {
    const cached = db.prepare("SELECT price_idr FROM price_cache WHERE symbol = ?").get(h.symbol);
    holdValue += h.amount * (cached?.price_idr || h.avg_buy_price);
  }
  return { cash: portfolio.cash_idr, holdValue, total: portfolio.cash_idr + holdValue };
}

function takeEquitySnapshot(portfolio_id) {
  try {
    const pid = portfolio_id || getActivePortfolioId();
    const e = computeTotalEquity(pid);
    db.prepare("INSERT INTO equity_snapshots (portfolio_id, cash_idr, hold_value_idr, total_idr) VALUES (?, ?, ?, ?)").run(pid, e.cash, e.holdValue, e.total);
  } catch (err) {
    console.error("snapshot error:", err.message);
  }
}

function takeAllEquitySnapshots() {
  try {
    const ports = db.prepare("SELECT id FROM portfolios").all();
    for (const p of ports) takeEquitySnapshot(p.id);
  } catch (err) {
    console.error("snapshot all error:", err.message);
  }
}

function executeBuyInternal(sym, amount_idr, opts = {}) {
  const pid = opts.portfolio_id || getActivePortfolioId();
  const portfolio = getPortfolio(pid);
  const vol30 = getVolume30d(pid);
  const feeInfo = getFeeRate(vol30);
  const feeRate = feeInfo.rate;
  const fee = amount_idr * feeRate;
  const total = amount_idr + fee;
  if (total > portfolio.cash_idr) {
    throw new Error(`Saldo tidak cukup. Punya: Rp${fmt(portfolio.cash_idr)}, butuh: Rp${fmt(total)}`);
  }
  const mid = opts.midPrice;
  const afterSpread = applySpread(mid, "BUY");
  const exec = applySlippage(afterSpread, "BUY");
  const spreadDelta = (afterSpread - mid);
  const slipDelta = (exec - afterSpread);
  const coinAmt = amount_idr / exec;
  const h = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND symbol = ?").get(pid, sym) || { amount: 0, avg_buy_price: 0 };
  const newAmt = h.amount + coinAmt;
  const newAvg = ((h.amount * h.avg_buy_price) + (coinAmt * exec)) / newAmt;
  const noteParts = [];
  if (opts.note) noteParts.push(opts.note);
  noteParts.push(`mid=Rp${fmt(mid)} exec=Rp${fmt(exec)} spread+Rp${fmt(spreadDelta)} slip+Rp${fmt(slipDelta)} tier=${feeInfo.tier}`);
  const fullNote = noteParts.join(" | ");

  const tx = db.transaction(() => {
    updatePortfolioCash(pid, -total);
    const existing = db.prepare("SELECT symbol FROM holdings WHERE portfolio_id=? AND symbol=?").get(pid, sym);
    if (existing) {
      db.prepare(`UPDATE holdings SET amount=?, avg_buy_price=?, updated_at=datetime('now') WHERE portfolio_id=? AND symbol=?`).run(newAmt, newAvg, pid, sym);
    } else {
      db.prepare(`INSERT INTO holdings (portfolio_id, symbol, amount, avg_buy_price, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(pid, sym, newAmt, newAvg);
    }
    db.prepare(`INSERT INTO trades (portfolio_id, symbol, side, amount, price_usd, price_idr, total_idr, fee_idr, note, risk_idr, strategy, setup, confidence, slippage_idr, spread_idr, fee_tier) VALUES (?, ?, 'BUY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      pid, sym, coinAmt, opts.price_usd || 0, exec, amount_idr, fee, fullNote, opts.risk_idr || null, opts.strategy || null, opts.setup || null, opts.confidence || null, slipDelta * coinAmt, spreadDelta * coinAmt, feeInfo.tier
    );
  });
  tx();
  takeEquitySnapshot(pid);
  let autoSlTp = null;
  if (!opts.sl_pct_explicit && !opts.tp_pct_explicit) {
    try {
      const { getAutoConfig } = require("./auto_sltp");
      const cfg = getAutoConfig(pid, sym);
      if (cfg) {
        const { createSlTpOrders } = require("./orders");
        createSlTpOrders(sym, exec, cfg.default_sl_pct, cfg.default_tp_pct, pid);
        autoSlTp = { sl_pct: cfg.default_sl_pct, tp_pct: cfg.default_tp_pct, scope: cfg.symbol };
      }
    } catch (err) { console.error("auto SL/TP apply error:", err.message); }
  }
  try {
    const ct = require("./copy_trading");
    ct.fanout({ portfolio_id: pid, symbol: sym, side: "BUY", amount_idr, exec_price: mid, price_usd: opts.price_usd, note: opts.note, strategy: opts.strategy, setup: opts.setup, confidence: opts.confidence, is_copy: opts.is_copy });
  } catch {}
  return { coinAmt, exec, fee, total, spreadDelta, slipDelta, feeInfo, remaining: portfolio.cash_idr - total, autoSlTp };
}

function executeSellInternal(sym, percent, opts = {}) {
  const pid = opts.portfolio_id || getActivePortfolioId();
  const h = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND symbol = ?").get(pid, sym);
  if (!h || h.amount <= 0) throw new Error(`Tidak punya ${sym}`);
  const vol30 = getVolume30d(pid);
  const feeInfo = getFeeRate(vol30);
  const feeRate = feeInfo.rate;
  const mid = opts.midPrice;
  const afterSpread = applySpread(mid, "SELL");
  const exec = applySlippage(afterSpread, "SELL");
  const spreadDelta = (mid - afterSpread);
  const slipDelta = (afterSpread - exec);
  const sellAmt = h.amount * (percent / 100);
  const gross = sellAmt * exec;
  const fee = gross * feeRate;
  const net = gross - fee;
  const costBasis = sellAmt * h.avg_buy_price;
  const pnl = net - costBasis;
  const remaining = h.amount - sellAmt;
  let rMultiple = null;
  const lastBuy = db.prepare("SELECT risk_idr FROM trades WHERE portfolio_id=? AND symbol = ? AND side = 'BUY' AND risk_idr IS NOT NULL ORDER BY id DESC LIMIT 1").get(pid, sym);
  if (lastBuy && lastBuy.risk_idr > 0) rMultiple = pnl / lastBuy.risk_idr;
  const noteParts = [];
  if (opts.note) noteParts.push(opts.note);
  noteParts.push(`mid=Rp${fmt(mid)} exec=Rp${fmt(exec)} spread-Rp${fmt(spreadDelta)} slip-Rp${fmt(slipDelta)} tier=${feeInfo.tier} pnl=${pnl>=0?"+":""}Rp${fmt(pnl)}`);
  if (rMultiple !== null) noteParts.push(`R=${rMultiple.toFixed(2)}`);
  const fullNote = noteParts.join(" | ");

  const tx = db.transaction(() => {
    updatePortfolioCash(pid, net);
    if (remaining < 0.000001) {
      db.prepare("DELETE FROM holdings WHERE portfolio_id=? AND symbol = ?").run(pid, sym);
    } else {
      db.prepare("UPDATE holdings SET amount = ?, updated_at = datetime('now') WHERE portfolio_id=? AND symbol = ?").run(remaining, pid, sym);
    }
    db.prepare(`INSERT INTO trades (portfolio_id, symbol, side, amount, price_usd, price_idr, total_idr, fee_idr, note, r_multiple, strategy, setup, confidence, slippage_idr, spread_idr, fee_tier) VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      pid, sym, sellAmt, opts.price_usd || 0, exec, gross, fee, fullNote, rMultiple, opts.strategy || null, opts.setup || null, opts.confidence || null, slipDelta * sellAmt, spreadDelta * sellAmt, feeInfo.tier
    );
  });
  tx();
  takeEquitySnapshot(pid);
  try {
    const ct = require("./copy_trading");
    ct.fanout({ portfolio_id: pid, symbol: sym, side: "SELL", percent, exec_price: mid, price_usd: opts.price_usd, note: opts.note, strategy: opts.strategy, setup: opts.setup, confidence: opts.confidence, is_copy: opts.is_copy });
  } catch {}
  return { sellAmt, exec, fee, net, pnl, remaining, spreadDelta, slipDelta, feeInfo, rMultiple };
}

module.exports = {
  applySpread,
  applySlippage,
  getFeeRate,
  getVolume30d,
  computeTotalEquity,
  takeEquitySnapshot,
  takeAllEquitySnapshots,
  executeBuyInternal,
  executeSellInternal
};
