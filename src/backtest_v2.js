const fetch = require("node-fetch");
const { db } = require("./db");
const { resolveCoinId } = require("./prices");
const { fmt } = require("./format");

async function fetchOhlcDaily(symbol, days) {
  const { coinId } = resolveCoinId(symbol);
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=idr&days=${days}`;
  const res = await fetch(url, { timeout: 12000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function sma(arr, period) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += arr[j];
    out.push(s / period);
  }
  return out;
}

function ema(arr, period) {
  const out = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (prev === null) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += arr[j];
      prev = s / period;
    } else {
      prev = arr[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

function rsi(arr, period = 14) {
  const out = new Array(arr.length).fill(null);
  if (arr.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  out[period] = 100 - 100 / (1 + avgG / (avgL || 1e-12));
  for (let i = period + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-12));
  }
  return out;
}

function bollinger(arr, period = 20, k = 2) {
  const m = sma(arr, period);
  const upper = [], lower = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (arr[j] - m[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper.push(m[i] + k * sd);
    lower.push(m[i] - k * sd);
  }
  return { upper, mid: m, lower };
}

function evalCondition(cond, ctx) {
  if (cond.type === "and") return cond.children.every(c => evalCondition(c, ctx));
  if (cond.type === "or") return cond.children.some(c => evalCondition(c, ctx));
  if (cond.type === "cross_above") return ctx.prev[cond.left] <= ctx.prev[cond.right] && ctx.cur[cond.left] > ctx.cur[cond.right];
  if (cond.type === "cross_below") return ctx.prev[cond.left] >= ctx.prev[cond.right] && ctx.cur[cond.left] < ctx.cur[cond.right];
  if (cond.type === "lt") return ctx.cur[cond.left] < (typeof cond.right === "number" ? cond.right : ctx.cur[cond.right]);
  if (cond.type === "gt") return ctx.cur[cond.left] > (typeof cond.right === "number" ? cond.right : ctx.cur[cond.right]);
  return false;
}

function buildContext(closes, params) {
  const ctx = { close: closes };
  if (params.ema_fast) ctx.ema_fast = ema(closes, params.ema_fast);
  if (params.ema_slow) ctx.ema_slow = ema(closes, params.ema_slow);
  if (params.sma_fast) ctx.sma_fast = sma(closes, params.sma_fast);
  if (params.sma_slow) ctx.sma_slow = sma(closes, params.sma_slow);
  if (params.rsi_period) ctx.rsi = rsi(closes, params.rsi_period);
  if (params.bb_period) {
    const bb = bollinger(closes, params.bb_period, params.bb_k || 2);
    ctx.bb_upper = bb.upper; ctx.bb_mid = bb.mid; ctx.bb_lower = bb.lower;
  }
  return ctx;
}

function simulate(closes, ctx, buyRule, sellRule, initial = 10_000_000) {
  let cash = initial, coin = 0, trades = 0, wins = 0, lastBuyPrice = null;
  const equity = [];
  for (let i = 1; i < closes.length; i++) {
    const cur = {};
    const prev = {};
    for (const k of Object.keys(ctx)) { cur[k] = ctx[k][i]; prev[k] = ctx[k][i - 1]; }
    const c = { cur, prev };
    if (coin === 0 && cur.close && buyRule && evalCondition(buyRule, c) && cash > 0) {
      coin = cash / cur.close * 0.997;
      lastBuyPrice = cur.close;
      cash = 0;
      trades++;
    } else if (coin > 0 && sellRule && evalCondition(sellRule, c)) {
      const proceeds = coin * cur.close * 0.997;
      if (lastBuyPrice && cur.close > lastBuyPrice) wins++;
      cash = proceeds;
      coin = 0;
      trades++;
      lastBuyPrice = null;
    }
    equity.push(cash + coin * cur.close);
  }
  const finalE = equity[equity.length - 1] || initial;
  let peak = initial, maxDD = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  const rets = [];
  for (let i = 1; i < equity.length; i++) rets.push((equity[i] / equity[i - 1]) - 1);
  const meanR = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
  const varR = rets.reduce((s, v) => s + (v - meanR) ** 2, 0) / (rets.length || 1);
  const sd = Math.sqrt(varR);
  const sharpe = sd > 0 ? (meanR / sd) * Math.sqrt(365) : 0;
  return { finalEquity: finalE, returnPct: (finalE / initial - 1) * 100, maxDD, sharpe, trades, winRate: trades > 0 ? (wins / Math.max(trades / 2, 1)) * 100 : 0, equity };
}

const STRATEGY_DSL = {
  ema_cross: (p) => ({
    params: { ema_fast: p.fast || 10, ema_slow: p.slow || 30 },
    buy: { type: "cross_above", left: "ema_fast", right: "ema_slow" },
    sell: { type: "cross_below", left: "ema_fast", right: "ema_slow" }
  }),
  rsi_meanrev: (p) => ({
    params: { rsi_period: p.period || 14 },
    buy: { type: "lt", left: "rsi", right: p.oversold || 30 },
    sell: { type: "gt", left: "rsi", right: p.overbought || 70 }
  }),
  bb_breakout: (p) => ({
    params: { bb_period: p.period || 20, bb_k: p.k || 2 },
    buy: { type: "cross_above", left: "close", right: "bb_upper" },
    sell: { type: "cross_below", left: "close", right: "bb_mid" }
  }),
  ema_rsi_combo: (p) => ({
    params: { ema_fast: p.fast || 20, ema_slow: p.slow || 50, rsi_period: 14 },
    buy: { type: "and", children: [
      { type: "gt", left: "ema_fast", right: "ema_slow" },
      { type: "lt", left: "rsi", right: 40 }
    ]},
    sell: { type: "or", children: [
      { type: "cross_below", left: "ema_fast", right: "ema_slow" },
      { type: "gt", left: "rsi", right: 75 }
    ]}
  })
};

async function runBacktest({ symbol, strategy, params = {}, days = 90 }) {
  try {
    const sym = String(symbol).toUpperCase();
    if (!STRATEGY_DSL[strategy]) {
      return { content: [{ type: "text", text: `❌ Strategy tidak dikenal: ${strategy}. Tersedia: ${Object.keys(STRATEGY_DSL).join(", ")}` }] };
    }
    const ohlc = await fetchOhlcDaily(sym, days);
    const closes = ohlc.map(c => c[4]);
    const def = STRATEGY_DSL[strategy](params);
    const ctx = buildContext(closes, def.params);
    const r = simulate(closes, ctx, def.buy, def.sell);
    db.prepare("INSERT INTO backtest_results (symbol, strategy, params_json, days, final_equity, return_pct, win_rate, max_dd, sharpe, trades_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      sym, strategy, JSON.stringify(params), days, r.finalEquity, r.returnPct, r.winRate, r.maxDD, r.sharpe, r.trades
    );
    const spark = sparkline(r.equity);
    const text =
      `🔁 BACKTEST ${sym} ${strategy} (${days}d)\n` +
      `${"─".repeat(55)}\n` +
      `📐 Params: ${JSON.stringify(params)}\n` +
      `💰 Final equity: Rp${fmt(r.finalEquity)}\n` +
      `📈 Return: ${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(2)}%\n` +
      `🎯 Win rate: ${r.winRate.toFixed(1)}%\n` +
      `📉 Max DD: ${r.maxDD.toFixed(2)}%\n` +
      `⚡ Sharpe: ${r.sharpe.toFixed(2)}\n` +
      `📋 Trades: ${r.trades}\n\n` +
      `📊 Equity: ${spark}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ${err.message}` }] };
  }
}

function sparkline(arr) {
  const chars = "▁▂▃▄▅▆▇█";
  const min = Math.min(...arr), max = Math.max(...arr);
  if (max === min) return chars[3].repeat(Math.min(arr.length, 40));
  const step = (max - min) / 7;
  return arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / 40)) === 0)
    .map(v => chars[Math.min(7, Math.floor((v - min) / step))]).join("");
}

async function paramSweep({ symbol, strategy, sweep_param, values, days = 90 }) {
  try {
    if (!STRATEGY_DSL[strategy]) return { content: [{ type: "text", text: `❌ Strategy tidak dikenal` }] };
    if (!Array.isArray(values) || !values.length) return { content: [{ type: "text", text: `❌ Values harus array` }] };
    const ohlc = await fetchOhlcDaily(symbol, days);
    const closes = ohlc.map(c => c[4]);
    const results = [];
    for (const v of values) {
      const params = { [sweep_param]: v };
      const def = STRATEGY_DSL[strategy](params);
      const ctx = buildContext(closes, def.params);
      const r = simulate(closes, ctx, def.buy, def.sell);
      results.push({ value: v, returnPct: r.returnPct, sharpe: r.sharpe, maxDD: r.maxDD, trades: r.trades, winRate: r.winRate });
    }
    results.sort((a, b) => b.sharpe - a.sharpe);
    const rows = results.map(r =>
      `${String(r.value).padStart(6)}: ret ${r.returnPct.toFixed(1).padStart(7)}% | sharpe ${r.sharpe.toFixed(2).padStart(5)} | DD ${r.maxDD.toFixed(1).padStart(5)}% | trades ${r.trades}`
    );
    const text =
      `🔬 PARAM SWEEP ${symbol} ${strategy}.${sweep_param}\n` +
      `${"─".repeat(65)}\n` +
      `${rows.join("\n")}\n\n` +
      `🏆 Best (by Sharpe): ${sweep_param}=${results[0].value} → ${results[0].returnPct.toFixed(1)}% return`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ${err.message}` }] };
  }
}

async function walkForward({ symbol, strategy, train_days = 60, test_days = 30, folds = 3 }) {
  try {
    const totalDays = (train_days + test_days) * folds;
    const ohlc = await fetchOhlcDaily(symbol, Math.min(totalDays, 365));
    const closes = ohlc.map(c => c[4]);
    if (closes.length < train_days + test_days) return { content: [{ type: "text", text: `❌ Data tidak cukup` }] };
    const def = STRATEGY_DSL[strategy]({});
    const results = [];
    let cursor = 0;
    for (let f = 0; f < folds; f++) {
      const trainEnd = cursor + train_days;
      const testEnd = Math.min(trainEnd + test_days, closes.length);
      if (testEnd > closes.length) break;
      const testCloses = closes.slice(trainEnd, testEnd);
      const ctx = buildContext(testCloses, def.params);
      const r = simulate(testCloses, ctx, def.buy, def.sell);
      results.push({ fold: f + 1, returnPct: r.returnPct, sharpe: r.sharpe, maxDD: r.maxDD });
      cursor += test_days;
    }
    const avgRet = results.reduce((s, v) => s + v.returnPct, 0) / results.length;
    const avgSharpe = results.reduce((s, v) => s + v.sharpe, 0) / results.length;
    const rows = results.map(r => `Fold ${r.fold}: ret ${r.returnPct.toFixed(2)}% | sharpe ${r.sharpe.toFixed(2)} | DD ${r.maxDD.toFixed(2)}%`);
    const text =
      `🚶 WALK-FORWARD ${symbol} ${strategy}\n` +
      `${"─".repeat(55)}\n` +
      `${rows.join("\n")}\n\n` +
      `📊 Avg return: ${avgRet.toFixed(2)}% | Avg Sharpe: ${avgSharpe.toFixed(2)}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ${err.message}` }] };
  }
}

async function listStrategies() {
  const lines = Object.keys(STRATEGY_DSL).map(s => `  - ${s}`);
  const text =
    `📚 STRATEGI BACKTEST\n` +
    `${"─".repeat(40)}\n${lines.join("\n")}\n\n` +
    `Pakai: run_backtest_v2 symbol:"BTC" strategy:"ema_cross" params:{fast:10,slow:30} days:90`;
  return { content: [{ type: "text", text }] };
}

module.exports = { runBacktest, paramSweep, walkForward, listStrategies, STRATEGY_DSL, fetchOhlcDaily, simulate, buildContext };
