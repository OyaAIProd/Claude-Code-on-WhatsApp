const { db, getActivePortfolioId, resolvePortfolioId, getPortfolio } = require("./db");
const { fmt, sparkline } = require("./format");
const { fetchPrice, fetchJson, resolveCoinId, COIN_IDS } = require("./prices");
const { computeTotalEquity, executeBuyInternal, executeSellInternal } = require("./execution");
const { rsi, macd, ema, sma, bollinger, pearson, maxDrawdown, sharpe } = require("./indicators");
const { STARTING_BALANCE } = require("./config");

async function getPortfolioTool({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const portfolio = getPortfolio(pid);
  const holdings = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND amount > 0.000001").all(pid);
  let holdValue = 0;
  const lines = [];
  for (const h of holdings) {
    const cached = db.prepare("SELECT price_idr FROM price_cache WHERE symbol = ?").get(h.symbol);
    const price = cached?.price_idr || h.avg_buy_price;
    const value = h.amount * price;
    const cost = h.amount * h.avg_buy_price;
    const pnl = value - cost;
    const pct = cost > 0 ? ((value / cost) - 1) * 100 : 0;
    holdValue += value;
    const sl = db.prepare("SELECT trigger_price_idr FROM pending_orders WHERE portfolio_id=? AND symbol=? AND type='STOP_LOSS' AND status='OPEN' ORDER BY id DESC LIMIT 1").get(pid, h.symbol);
    const tp = db.prepare("SELECT trigger_price_idr FROM pending_orders WHERE portfolio_id=? AND symbol=? AND type='TAKE_PROFIT' AND status='OPEN' ORDER BY id DESC LIMIT 1").get(pid, h.symbol);
    const markers = [];
    if (sl) {
      const dist = ((price - sl.trigger_price_idr) / price * 100);
      markers.push(`🛡️SL Rp${fmt(sl.trigger_price_idr)} (${dist >= 0 ? "-" : "+"}${Math.abs(dist).toFixed(1)}%)`);
    }
    if (tp) {
      const dist = ((tp.trigger_price_idr - price) / price * 100);
      markers.push(`🎯TP Rp${fmt(tp.trigger_price_idr)} (${dist >= 0 ? "+" : "-"}${Math.abs(dist).toFixed(1)}%)`);
    }
    lines.push(`  ${h.symbol}: ${h.amount.toFixed(6)} | avg Rp${fmt(h.avg_buy_price)} | val Rp${fmt(value)} | ${pnl >= 0 ? "+" : ""}Rp${fmt(pnl)} (${pct.toFixed(1)}%)` +
      (markers.length ? `\n      ${markers.join(" | ")}` : "\n      ⚠️ no SL/TP"));
  }
  const total = portfolio.cash_idr + holdValue;
  const sb = portfolio.starting_balance || STARTING_BALANCE;
  const totalPnl = total - sb;
  const text =
    `📊 PORTFOLIO #${pid} (${portfolio.name})\n` +
    `${"─".repeat(48)}\n` +
    `💵 Cash IDR: Rp${fmt(portfolio.cash_idr)}\n\n` +
    `📦 Holdings:\n${lines.length ? lines.join("\n") : "  (kosong)"}\n\n` +
    `${"─".repeat(48)}\n` +
    `💼 Total Aset: Rp${fmt(total)}\n` +
    `📈 PnL: ${totalPnl >= 0 ? "+" : ""}Rp${fmt(totalPnl)} (${((totalPnl / sb) * 100).toFixed(2)}%)\n` +
    `🏦 Modal Awal: Rp${fmt(sb)}`;
  return { content: [{ type: "text", text }] };
}

function computePerformance(pid) {
  const portfolio = getPortfolio(pid);
  const holdings = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND amount > 0.000001").all(pid);
  const trades = db.prepare("SELECT * FROM trades WHERE portfolio_id=? ORDER BY id ASC").all(pid);
  const snaps = db.prepare("SELECT * FROM equity_snapshots WHERE portfolio_id=? ORDER BY id ASC").all(pid);
  let holdValue = 0, unrealized = 0;
  for (const h of holdings) {
    const cached = db.prepare("SELECT price_idr FROM price_cache WHERE symbol = ?").get(h.symbol);
    const price = cached?.price_idr || h.avg_buy_price;
    holdValue += h.amount * price;
    unrealized += h.amount * (price - h.avg_buy_price);
  }
  const sb = portfolio.starting_balance || STARTING_BALANCE;
  const total = portfolio.cash_idr + holdValue;
  const ret = ((total / sb) - 1) * 100;
  const feeTotal = trades.reduce((s, t) => s + (t.fee_idr || 0), 0);
  const volume = trades.reduce((s, t) => s + (t.total_idr || 0), 0);
  const wins = [], losses = [];
  let realized = 0;
  const lots = {};
  for (const t of trades) {
    if (t.side === "BUY") {
      if (!lots[t.symbol]) lots[t.symbol] = [];
      lots[t.symbol].push({ qty: t.amount, price: t.price_idr });
    } else {
      let remaining = t.amount;
      let pnl = 0;
      const q = lots[t.symbol] || [];
      while (remaining > 0 && q.length) {
        const lot = q[0];
        const take = Math.min(lot.qty, remaining);
        pnl += take * (t.price_idr - lot.price);
        lot.qty -= take;
        remaining -= take;
        if (lot.qty < 1e-9) q.shift();
      }
      pnl -= t.fee_idr || 0;
      realized += pnl;
      if (pnl > 0) wins.push(pnl);
      else if (pnl < 0) losses.push(pnl);
    }
  }
  const winRate = (wins.length + losses.length) > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0;
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99.99 : 0);
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const biggestWin = wins.length ? Math.max(...wins) : 0;
  const biggestLoss = losses.length ? Math.min(...losses) : 0;
  const equity = snaps.map((s) => s.total_idr);
  const dailyReturns = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) dailyReturns.push((equity[i] / equity[i - 1]) - 1);
  }
  const sr = sharpe(dailyReturns);
  const mdd = equity.length ? maxDrawdown(equity) : 0;
  return { portfolio, sb, total, ret, feeTotal, volume, trades, wins, losses, winRate, profitFactor, avgWin, avgLoss, biggestWin, biggestLoss, realized, unrealized, sr, mdd, holdings };
}

async function getPerformance({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const m = computePerformance(pid);
  const open = m.holdings.map((h) => h.symbol).join(", ") || "kosong";
  const text =
    `📊 PERFORMA (portfolio #${pid} - ${m.portfolio.name})\n` +
    `${"─".repeat(48)}\n` +
    `💼 Modal Awal: Rp${fmt(m.sb)}\n` +
    `💰 Total Aset: Rp${fmt(m.total)}\n` +
    `📈 Return: ${m.ret >= 0 ? "+" : ""}${m.ret.toFixed(2)}%\n\n` +
    `📊 Sharpe (daily, ann.): ${m.sr.toFixed(2)}\n` +
    `📉 Max Drawdown: ${m.mdd.toFixed(2)}%\n` +
    `🎯 Win Rate: ${m.winRate.toFixed(1)}% (${m.wins.length}W / ${m.losses.length}L)\n` +
    `💎 Profit Factor: ${m.profitFactor.toFixed(2)}\n` +
    `🟢 Avg Win: Rp${fmt(m.avgWin)} | 🔴 Avg Loss: Rp${fmt(m.avgLoss)}\n` +
    `🏆 Biggest Win: Rp${fmt(m.biggestWin)} | 💀 Biggest Loss: Rp${fmt(m.biggestLoss)}\n` +
    `💵 PnL Realized: ${m.realized >= 0 ? "+" : ""}Rp${fmt(m.realized)}\n` +
    `🪙 PnL Unrealized: ${m.unrealized >= 0 ? "+" : ""}Rp${fmt(m.unrealized)}\n\n` +
    `📋 Total Trades: ${m.trades.length}\n` +
    `💸 Fee dibayar: Rp${fmt(m.feeTotal)}\n` +
    `📦 Volume: Rp${fmt(m.volume)}\n` +
    `🔐 Open Position: ${open}`;
  return { content: [{ type: "text", text }] };
}

async function getTradeHistory({ limit, portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const trades = db.prepare("SELECT * FROM trades WHERE portfolio_id=? ORDER BY created_at DESC LIMIT ?").all(pid, limit);
  if (!trades.length) return { content: [{ type: "text", text: "Belum ada trade." }] };
  const rows = trades.map((t) => {
    const tagBits = [];
    if (t.strategy) tagBits.push(`s:${t.strategy}`);
    if (t.setup) tagBits.push(`u:${t.setup}`);
    if (t.confidence) tagBits.push(`c:${t.confidence}`);
    if (t.r_multiple !== null && t.r_multiple !== undefined) tagBits.push(`R:${Number(t.r_multiple).toFixed(2)}`);
    const tags = tagBits.length ? ` [${tagBits.join(" ")}]` : "";
    return `[${t.created_at}] ${t.side} ${t.symbol} ${t.amount.toFixed(6)} @ Rp${fmt(t.price_idr)} | Rp${fmt(t.total_idr)}${tags}${t.note ? ` | ${t.note}` : ""}`;
  });
  return { content: [{ type: "text", text: [`📋 RIWAYAT TRADE (portfolio #${pid})`, "─".repeat(60), ...rows].join("\n") }] };
}

async function getEquityHistory({ days, portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const rows = db.prepare("SELECT * FROM equity_snapshots WHERE portfolio_id=? AND ts >= datetime('now', ?) ORDER BY ts ASC").all(pid, `-${days} days`);
  if (!rows.length) return { content: [{ type: "text", text: "Belum ada snapshot equity." }] };
  const byDay = {};
  for (const r of rows) byDay[r.ts.slice(0, 10)] = r.total_idr;
  const dates = Object.keys(byDay).sort();
  const totals = dates.map((d) => byDay[d]);
  const lines = [];
  for (let i = 0; i < dates.length; i++) {
    const ret = i > 0 ? ((totals[i] / totals[i - 1]) - 1) * 100 : 0;
    lines.push(`  ${dates[i]}: Rp${fmt(totals[i])} | ${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%`);
  }
  const text = `📈 EQUITY HISTORY (${days}d, portfolio #${pid})\n${"─".repeat(50)}\n${lines.join("\n")}\n\nTrend: ${sparkline(totals)}`;
  return { content: [{ type: "text", text }] };
}

async function getIndicators({ symbol, days }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=idr&days=${days}&interval=daily`, 12000);
    const closes = (data.prices || []).map((p) => p[1]);
    if (closes.length < 30) return { content: [{ type: "text", text: `❌ Data terlalu pendek (${closes.length})` }] };
    const r = rsi(closes);
    const m = macd(closes);
    const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
    const bb = bollinger(closes, 20, 2);
    const last = closes[closes.length - 1];
    const i = closes.length - 1;
    const macdLast = m.line[i], sigLast = m.signal[i], histLast = m.histogram[i];
    const macdPrev = m.line[i - 1], sigPrev = m.signal[i - 1];
    let macdSig = "neutral";
    if (macdPrev < sigPrev && macdLast > sigLast) macdSig = "🟢 BULLISH CROSS";
    else if (macdPrev > sigPrev && macdLast < sigLast) macdSig = "🔴 BEARISH CROSS";
    else if (histLast > 0) macdSig = "🟢 bullish";
    else macdSig = "🔴 bearish";
    let rsiSig = "neutral";
    if (r > 70) rsiSig = "🔴 OVERBOUGHT";
    else if (r < 30) rsiSig = "🟢 OVERSOLD";
    let trend = "sideways";
    if (e20[i] > e50[i] && e50[i] > e200[i]) trend = "🟢 STRONG BULL";
    else if (e20[i] < e50[i] && e50[i] < e200[i]) trend = "🔴 STRONG BEAR";
    else if (e20[i] > e50[i]) trend = "🟢 short-term bull";
    else if (e20[i] < e50[i]) trend = "🔴 short-term bear";
    let bbSig = "mid range";
    if (last > bb.upper[i]) bbSig = "🔴 above upper (overbought)";
    else if (last < bb.lower[i]) bbSig = "🟢 below lower (oversold)";
    const text =
      `📐 INDIKATOR ${sym} (${days}d)\n${"─".repeat(55)}\n` +
      `💰 Price: Rp${fmt(last)}\n` +
      `📊 RSI(14): ${r.toFixed(2)} | ${rsiSig}\n` +
      `📈 MACD: ${macdLast.toFixed(2)} | Signal: ${sigLast.toFixed(2)} | Hist: ${histLast.toFixed(2)} | ${macdSig}\n` +
      `📉 EMA20: Rp${fmt(e20[i])}\n📉 EMA50: Rp${fmt(e50[i])}\n📉 EMA200: Rp${fmt(e200[i])}\n` +
      `🎯 Trend: ${trend}\n` +
      `🎢 Bollinger: U=Rp${fmt(bb.upper[i])} M=Rp${fmt(bb.mid[i])} L=Rp${fmt(bb.lower[i])} | ${bbSig}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal indikator: ${err.message}` }] };
  }
}

async function suggestSize({ symbol, risk_pct, sl_pct, portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const sym = String(symbol).toUpperCase();
  const e = computeTotalEquity(pid);
  const riskRp = e.total * (risk_pct / 100);
  let posSize = riskRp / (sl_pct / 100);
  const capped = posSize > e.cash;
  if (capped) posSize = e.cash;
  const p = await fetchPrice(sym);
  const coinAmt = posSize / p.price_idr;
  const text =
    `📐 POSITION SIZE ${sym}\n${"─".repeat(45)}\n` +
    `💼 Total Equity: Rp${fmt(e.total)}\n💵 Cash: Rp${fmt(e.cash)}\n` +
    `⚠️ Risk: ${risk_pct}% = Rp${fmt(riskRp)}\n🛡️ SL: ${sl_pct}%\n${"─".repeat(45)}\n` +
    `💰 Position size: Rp${fmt(posSize)}${capped ? " (capped cash)" : ""}\n` +
    `🪙 ~ ${coinAmt.toFixed(8)} ${sym} @ Rp${fmt(p.price_idr)}`;
  return { content: [{ type: "text", text }] };
}

async function backtest({ symbol, strategy, days }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=idr&days=${days}&interval=daily`, 12000);
    const closes = (data.prices || []).map((p) => p[1]);
    if (closes.length < 30) return { content: [{ type: "text", text: `❌ Data pendek (${closes.length})` }] };
    let cash = STARTING_BALANCE, coin = 0;
    const equity = [];
    const tradesArr = [];
    const fee = 0.003;
    let lastBuyPrice = 0;
    if (strategy === "buy_and_hold") {
      coin = cash / closes[0] * (1 - fee);
      cash = 0;
      for (const c of closes) equity.push(cash + coin * c);
      tradesArr.push({ pnl: 0, exit: closes[closes.length - 1] });
    } else if (strategy === "sma_cross_10_30") {
      const s10 = sma(closes, 10), s30 = sma(closes, 30);
      for (let i = 0; i < closes.length; i++) {
        if (i > 30) {
          const prevDiff = s10[i - 1] - s30[i - 1];
          const curDiff = s10[i] - s30[i];
          if (prevDiff <= 0 && curDiff > 0 && cash > 0) {
            coin = cash / closes[i] * (1 - fee);
            lastBuyPrice = closes[i];
            cash = 0;
          } else if (prevDiff >= 0 && curDiff < 0 && coin > 0) {
            const proceeds = coin * closes[i] * (1 - fee);
            tradesArr.push({ pnl: proceeds - lastBuyPrice * coin });
            cash = proceeds;
            coin = 0;
          }
        }
        equity.push(cash + coin * closes[i]);
      }
    } else if (strategy === "rsi_30_70") {
      for (let i = 14; i < closes.length; i++) {
        const r = rsi(closes.slice(0, i + 1));
        if (r < 30 && cash > 0) {
          coin = cash / closes[i] * (1 - fee);
          lastBuyPrice = closes[i];
          cash = 0;
        } else if (r > 70 && coin > 0) {
          const proceeds = coin * closes[i] * (1 - fee);
          tradesArr.push({ pnl: proceeds - lastBuyPrice * coin });
          cash = proceeds;
          coin = 0;
        }
        equity.push(cash + coin * closes[i]);
      }
    }
    const finalEq = equity[equity.length - 1] || cash + coin * closes[closes.length - 1];
    const retPct = ((finalEq / STARTING_BALANCE) - 1) * 100;
    const wins = tradesArr.filter((t) => t.pnl > 0).length;
    const winRate = tradesArr.length ? (wins / tradesArr.length) * 100 : 0;
    const mdd = maxDrawdown(equity);
    const sample = equity.filter((_, i) => i % Math.max(1, Math.floor(equity.length / 30)) === 0);
    const text =
      `🧪 BACKTEST ${sym} ${strategy} (${days}d)\n${"─".repeat(55)}\n` +
      `💰 Final Equity: Rp${fmt(finalEq)}\n📈 Return: ${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%\n` +
      `🎯 Win Rate: ${winRate.toFixed(1)}% (${wins}/${tradesArr.length})\n` +
      `📉 Max DD: ${mdd.toFixed(2)}%\n📊 Trades: ${tradesArr.length}\nCurve: ${sparkline(sample)}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Backtest gagal: ${err.message}` }] };
  }
}

async function getCorrelation({ symbols, days }) {
  const series = {};
  for (const s of symbols) {
    try {
      const { sym, coinId } = resolveCoinId(s);
      const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`, 12000);
      const closes = (data.prices || []).map((p) => p[1]);
      const rets = [];
      for (let i = 1; i < closes.length; i++) rets.push((closes[i] / closes[i - 1]) - 1);
      series[sym] = rets;
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Gagal ${s}: ${err.message}` }] };
    }
  }
  const syms = Object.keys(series);
  const minLen = Math.min(...syms.map((s) => series[s].length));
  for (const s of syms) series[s] = series[s].slice(-minLen);
  const header = "      " + syms.map((s) => s.padStart(7)).join("");
  const rows = [header];
  for (const a of syms) {
    const cells = syms.map((b) => pearson(series[a], series[b]).toFixed(2).padStart(7));
    rows.push(a.padEnd(6) + cells.join(""));
  }
  return { content: [{ type: "text", text: [`🔗 CORRELATION (${days}d)`, "─".repeat(60), ...rows].join("\n") }] };
}

async function journalStats({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const buys = db.prepare("SELECT * FROM trades WHERE portfolio_id=? AND side='BUY'").all(pid);
  const sells = db.prepare("SELECT * FROM trades WHERE portfolio_id=? AND side='SELL' ORDER BY id ASC").all(pid);
  const byStrategy = {};
  const bySetup = {};
  const lots = {};
  for (const b of buys) {
    if (!lots[b.symbol]) lots[b.symbol] = [];
    lots[b.symbol].push({ qty: b.amount, price: b.price_idr, strategy: b.strategy, setup: b.setup });
  }
  for (const s of sells) {
    let remaining = s.amount;
    const q = lots[s.symbol] || [];
    while (remaining > 0 && q.length) {
      const lot = q[0];
      const take = Math.min(lot.qty, remaining);
      const pnl = take * (s.price_idr - lot.price);
      if (lot.strategy) {
        if (!byStrategy[lot.strategy]) byStrategy[lot.strategy] = { wins: 0, losses: 0, totalPnl: 0 };
        byStrategy[lot.strategy].totalPnl += pnl;
        if (pnl > 0) byStrategy[lot.strategy].wins++; else if (pnl < 0) byStrategy[lot.strategy].losses++;
      }
      if (lot.setup) {
        if (!bySetup[lot.setup]) bySetup[lot.setup] = { wins: 0, losses: 0, totalPnl: 0 };
        bySetup[lot.setup].totalPnl += pnl;
        if (pnl > 0) bySetup[lot.setup].wins++; else if (pnl < 0) bySetup[lot.setup].losses++;
      }
      lot.qty -= take;
      remaining -= take;
      if (lot.qty < 1e-9) q.shift();
    }
  }
  const fmtGroup = (g) => Object.entries(g).map(([k, v]) => {
    const total = v.wins + v.losses;
    const wr = total ? (v.wins / total) * 100 : 0;
    const exp = total ? v.totalPnl / total : 0;
    return `  ${k}: ${wr.toFixed(1)}% WR (${v.wins}/${total}) | Exp: Rp${fmt(exp)} | Total: ${v.totalPnl>=0?"+":""}Rp${fmt(v.totalPnl)}`;
  });
  const stratLines = fmtGroup(byStrategy);
  const setupLines = fmtGroup(bySetup);
  const text =
    `📓 JOURNAL STATS (portfolio #${pid})\n${"─".repeat(55)}\n` +
    `By Strategy:\n${stratLines.length ? stratLines.join("\n") : "  (belum ada)"}\n\n` +
    `By Setup:\n${setupLines.length ? setupLines.join("\n") : "  (belum ada)"}`;
  return { content: [{ type: "text", text }] };
}

async function getTaxReport({ year, portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const trades = db.prepare("SELECT * FROM trades WHERE portfolio_id=? ORDER BY id ASC").all(pid);
  const lots = {};
  let totalGain = 0;
  const perSym = {};
  let totalSellVolume = 0;
  for (const t of trades) {
    const tYear = new Date(t.created_at).getFullYear();
    if (year && tYear !== year) continue;
    if (t.side === "BUY") {
      if (!lots[t.symbol]) lots[t.symbol] = [];
      lots[t.symbol].push({ qty: t.amount, price: t.price_idr });
    } else {
      let remaining = t.amount, gain = 0;
      const q = lots[t.symbol] || [];
      while (remaining > 0 && q.length) {
        const lot = q[0];
        const take = Math.min(lot.qty, remaining);
        gain += take * (t.price_idr - lot.price);
        lot.qty -= take;
        remaining -= take;
        if (lot.qty < 1e-9) q.shift();
      }
      totalGain += gain;
      totalSellVolume += t.total_idr || 0;
      perSym[t.symbol] = (perSym[t.symbol] || 0) + gain;
    }
  }
  const tax = totalSellVolume * 0.001;
  const lines = Object.entries(perSym).map(([s, g]) => `  ${s}: ${g >= 0 ? "+" : ""}Rp${fmt(g)}`);
  const text =
    `📋 TAX REPORT ${year || "ALL"} (FIFO, portfolio #${pid})\n${"─".repeat(50)}\n` +
    `💵 Realized Gain: ${totalGain >= 0 ? "+" : ""}Rp${fmt(totalGain)}\n` +
    `📦 Sell Volume: Rp${fmt(totalSellVolume)}\n` +
    `🧾 PPh Final 0.1%: Rp${fmt(tax)}\n\n` +
    `📊 Per Symbol:\n${lines.length ? lines.join("\n") : "  (kosong)"}`;
  return { content: [{ type: "text", text }] };
}

async function rebalance({ targets, confirm, portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const sum = Object.values(targets).reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 100) > 1) return { content: [{ type: "text", text: `❌ Target sum ${sum}% (harus ~100)` }] };
  const e = computeTotalEquity(pid);
  const current = {};
  const holdings = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND amount > 0.000001").all(pid);
  for (const h of holdings) {
    const cached = db.prepare("SELECT price_idr FROM price_cache WHERE symbol = ?").get(h.symbol);
    current[h.symbol] = h.amount * (cached?.price_idr || h.avg_buy_price);
  }
  const plan = [];
  for (const [sym, pct] of Object.entries(targets)) {
    const SYM = sym.toUpperCase();
    if (!COIN_IDS[SYM]) { plan.push({ sym: SYM, action: "SKIP unknown" }); continue; }
    const targetVal = e.total * (pct / 100);
    const curVal = current[SYM] || 0;
    const delta = targetVal - curVal;
    plan.push({ sym: SYM, curVal, targetVal, delta, action: delta > 0 ? "BUY" : "SELL" });
  }
  const lines = plan.map((p) =>
    p.action === "SKIP unknown" ? `  ${p.sym}: SKIP unknown` :
    `  ${p.sym}: now Rp${fmt(p.curVal)} → target Rp${fmt(p.targetVal)} | ${p.action} Rp${fmt(Math.abs(p.delta))}`
  );
  let execNote = "";
  if (confirm) {
    for (const p of plan) {
      if (p.action === "BUY" && p.delta > 1000) {
        try {
          const px = await fetchPrice(p.sym);
          executeBuyInternal(p.sym, p.delta, { midPrice: px.price_idr, price_usd: px.price_usd, note: "rebalance", portfolio_id: pid });
        } catch (err) { execNote += `\n  ⚠️ ${p.sym} buy fail: ${err.message}`; }
      } else if (p.action === "SELL" && p.delta < -1000) {
        try {
          const h = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND symbol = ?").get(pid, p.sym);
          if (h && h.amount > 0) {
            const cached = db.prepare("SELECT price_idr FROM price_cache WHERE symbol = ?").get(p.sym);
            const px = cached?.price_idr || h.avg_buy_price;
            const sellPct = Math.min(100, (Math.abs(p.delta) / (h.amount * px)) * 100);
            const pp = await fetchPrice(p.sym);
            executeSellInternal(p.sym, sellPct, { midPrice: pp.price_idr, price_usd: pp.price_usd, note: "rebalance", portfolio_id: pid });
          }
        } catch (err) { execNote += `\n  ⚠️ ${p.sym} sell fail: ${err.message}`; }
      }
    }
    execNote = "\n\n✅ Eksekusi selesai." + execNote;
  } else {
    execNote = "\n\n💡 Set confirm=true untuk eksekusi.";
  }
  return { content: [{ type: "text", text: [`⚖️ REBALANCE PLAN (portfolio #${pid})`, "─".repeat(60), ...lines].join("\n") + execNote }] };
}

module.exports = {
  getPortfolioTool, getPerformance, getTradeHistory, getEquityHistory,
  getIndicators, suggestSize, backtest, getCorrelation, journalStats,
  getTaxReport, rebalance, computePerformance
};
