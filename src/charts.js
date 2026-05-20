const fetch = require("node-fetch");
const { resolveCoinId } = require("./prices");
const { db } = require("./db");

async function fetchOhlc(symbol, days) {
  const { coinId } = resolveCoinId(symbol);
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url, { timeout: 12000 });
  if (!res.ok) throw new Error(`OHLC HTTP ${res.status}`);
  return res.json();
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

function detectPatterns(ohlc) {
  const patterns = [];
  for (let i = 0; i < ohlc.length; i++) {
    const [t, o, h, l, c] = ohlc[i];
    const body = Math.abs(c - o);
    const range = h - l;
    if (!range) continue;
    const upperWick = h - Math.max(o, c);
    const lowerWick = Math.min(o, c) - l;
    const bodyPct = body / range;
    if (bodyPct < 0.1) patterns.push({ idx: i, t, type: "DOJI", bullish: null });
    else if (bodyPct < 0.35 && lowerWick > body * 2 && upperWick < body * 0.5) patterns.push({ idx: i, t, type: "HAMMER", bullish: true });
    else if (bodyPct < 0.35 && upperWick > body * 2 && lowerWick < body * 0.5) patterns.push({ idx: i, t, type: "SHOOTING_STAR", bullish: false });
    if (i > 0) {
      const [pt, po, ph, pl, pc] = ohlc[i - 1];
      const prevBody = Math.abs(pc - po);
      if (body > prevBody * 1.2) {
        if (po > pc && c > o && c >= po && o <= pc) patterns.push({ idx: i, t, type: "BULL_ENGULFING", bullish: true });
        else if (po < pc && c < o && o >= pc && c <= po) patterns.push({ idx: i, t, type: "BEAR_ENGULFING", bullish: false });
      }
    }
  }
  return patterns;
}

function findSupportResistance(closes, lookback = 5) {
  const levels = [];
  for (let i = lookback; i < closes.length - lookback; i++) {
    const window = closes.slice(i - lookback, i + lookback + 1);
    const isHigh = closes[i] === Math.max(...window);
    const isLow = closes[i] === Math.min(...window);
    if (isHigh) levels.push({ idx: i, price: closes[i], type: "resistance" });
    if (isLow) levels.push({ idx: i, price: closes[i], type: "support" });
  }
  const grouped = [];
  for (const lv of levels) {
    const near = grouped.find(g => Math.abs(g.price - lv.price) / lv.price < 0.015);
    if (near) { near.count++; near.price = (near.price * (near.count - 1) + lv.price) / near.count; }
    else grouped.push({ ...lv, count: 1 });
  }
  return grouped.filter(g => g.count >= 1).sort((a, b) => b.count - a.count).slice(0, 4);
}

function fibLevels(high, low) {
  const diff = high - low;
  return {
    "0.0": high,
    "0.236": high - diff * 0.236,
    "0.382": high - diff * 0.382,
    "0.5": high - diff * 0.5,
    "0.618": high - diff * 0.618,
    "0.786": high - diff * 0.786,
    "1.0": low
  };
}

async function quickchartUrl(config) {
  const res = await fetch("https://quickchart.io/chart/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chart: config, width: 900, height: 500, backgroundColor: "#1a1a2e" })
  });
  if (!res.ok) throw new Error(`QuickChart HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error("QuickChart failed");
  return data.url;
}

async function generateCandlestickChart({ symbol, days = 30, indicators = [], fibonacci = false, patterns = true, support_resistance = true }) {
  const sym = String(symbol).toUpperCase();
  const ohlc = await fetchOhlc(sym, days);
  const closes = ohlc.map(c => c[4]);
  const candleData = ohlc.map(c => ({ x: c[0], o: c[1], h: c[2], l: c[3], c: c[4] }));
  const datasets = [
    {
      label: `${sym} OHLC`,
      type: "candlestick",
      data: candleData,
      color: { up: "#26a69a", down: "#ef5350", unchanged: "#999" }
    }
  ];
  const inds = (indicators || []).map(i => String(i).toLowerCase());
  if (inds.includes("ema20")) {
    const e = ema(closes, 20);
    datasets.push({ label: "EMA20", type: "line", data: ohlc.map((c, i) => ({ x: c[0], y: e[i] })).filter(p => p.y != null), borderColor: "#ffa726", borderWidth: 2, pointRadius: 0, fill: false });
  }
  if (inds.includes("ema50")) {
    const e = ema(closes, 50);
    datasets.push({ label: "EMA50", type: "line", data: ohlc.map((c, i) => ({ x: c[0], y: e[i] })).filter(p => p.y != null), borderColor: "#42a5f5", borderWidth: 2, pointRadius: 0, fill: false });
  }
  if (inds.includes("ema200")) {
    const e = ema(closes, 200);
    datasets.push({ label: "EMA200", type: "line", data: ohlc.map((c, i) => ({ x: c[0], y: e[i] })).filter(p => p.y != null), borderColor: "#ab47bc", borderWidth: 2, pointRadius: 0, fill: false });
  }
  const annotations = {};
  let detectedPatterns = [];
  let srLevels = [];
  if (patterns) {
    detectedPatterns = detectPatterns(ohlc);
    detectedPatterns.slice(-8).forEach((p, idx) => {
      const candle = ohlc[p.idx];
      const yPos = p.bullish === false ? candle[2] : candle[3];
      annotations[`pat_${idx}`] = {
        type: "label",
        xValue: candle[0], yValue: yPos,
        backgroundColor: p.bullish === true ? "rgba(38,166,154,0.8)" : (p.bullish === false ? "rgba(239,83,80,0.8)" : "rgba(255,167,38,0.8)"),
        color: "#fff", font: { size: 9, weight: "bold" }, padding: 3,
        content: p.type, position: { x: "center", y: p.bullish === false ? "start" : "end" }
      };
    });
  }
  if (support_resistance) {
    srLevels = findSupportResistance(closes);
    srLevels.forEach((lv, idx) => {
      annotations[`sr_${idx}`] = {
        type: "line",
        yMin: lv.price, yMax: lv.price,
        borderColor: lv.type === "resistance" ? "#ef5350" : "#26a69a",
        borderWidth: 1.5, borderDash: [2, 2],
        label: { content: `${lv.type === "resistance" ? "R" : "S"} $${lv.price.toFixed(2)}`, enabled: true, position: "start", backgroundColor: lv.type === "resistance" ? "rgba(239,83,80,0.7)" : "rgba(38,166,154,0.7)", color: "#fff", font: { size: 10 } }
      };
    });
  }
  if (fibonacci) {
    const high = Math.max(...closes);
    const low = Math.min(...closes);
    const levels = fibLevels(high, low);
    let i = 0;
    for (const [pct, price] of Object.entries(levels)) {
      annotations[`fib_${pct}`] = {
        type: "line",
        yMin: price, yMax: price,
        borderColor: ["#ff5252", "#ff7043", "#ffa726", "#ffee58", "#66bb6a", "#26a69a", "#42a5f5"][i % 7],
        borderWidth: 1, borderDash: [5, 5],
        label: { content: `Fib ${pct} = $${price.toFixed(2)}`, enabled: true, position: "end", backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", font: { size: 10 } }
      };
      i++;
    }
  }
  const config = {
    type: "candlestick",
    data: { datasets },
    options: {
      plugins: {
        title: { display: true, text: `${sym} ${days}d ${fibonacci ? "+ Fibonacci" : ""}`, color: "#fff", font: { size: 18 } },
        legend: { labels: { color: "#fff" } },
        annotation: { annotations }
      },
      scales: {
        x: { type: "time", time: { unit: days > 30 ? "week" : "day" }, ticks: { color: "#ccc" }, grid: { color: "#333" } },
        y: { ticks: { color: "#ccc", callback: "function(v){return '$'+v.toLocaleString()}" }, grid: { color: "#333" } }
      }
    }
  };
  const url = await quickchartUrl(config);
  const patternSummary = detectedPatterns.length
    ? detectedPatterns.slice(-5).map(p => p.type).join(", ")
    : "no clear pattern";
  const srSummary = srLevels.length
    ? srLevels.map(l => `${l.type[0].toUpperCase()}$${l.price.toFixed(2)}`).join(" ")
    : "n/a";
  return {
    url,
    summary: `${sym} ${days}d | high $${Math.max(...closes).toFixed(2)} | low $${Math.min(...closes).toFixed(2)} | last $${closes[closes.length - 1].toFixed(2)}`,
    patterns: detectedPatterns,
    sr_levels: srLevels,
    pattern_summary: `Patterns: ${patternSummary} | Levels: ${srSummary}`
  };
}

async function generatePortfolioChart({ portfolio_id = 1, days = 30 }) {
  const rows = db.prepare("SELECT total_idr, cash_idr, hold_value_idr, created_at FROM equity_snapshots WHERE portfolio_id=? AND created_at > datetime('now', ?) ORDER BY id").all(portfolio_id, `-${days} days`);
  if (!rows.length) throw new Error("Belum ada equity snapshot. Lakukan minimal 1 trade dulu.");
  const data = rows.map(r => ({ x: new Date(r.created_at).getTime(), total: r.total_idr, cash: r.cash_idr, hold: r.hold_value_idr }));
  const config = {
    type: "line",
    data: {
      datasets: [
        { label: "Total Equity", data: data.map(d => ({ x: d.x, y: d.total })), borderColor: "#26a69a", backgroundColor: "rgba(38,166,154,0.2)", fill: true, borderWidth: 2, pointRadius: 0 },
        { label: "Cash", data: data.map(d => ({ x: d.x, y: d.cash })), borderColor: "#42a5f5", borderWidth: 2, pointRadius: 0, fill: false },
        { label: "Holdings", data: data.map(d => ({ x: d.x, y: d.hold })), borderColor: "#ffa726", borderWidth: 2, pointRadius: 0, fill: false }
      ]
    },
    options: {
      plugins: {
        title: { display: true, text: `Portfolio #${portfolio_id} Equity (${days}d)`, color: "#fff", font: { size: 18 } },
        legend: { labels: { color: "#fff" } }
      },
      scales: {
        x: { type: "time", ticks: { color: "#ccc" }, grid: { color: "#333" } },
        y: { ticks: { color: "#ccc", callback: "function(v){return 'Rp'+v.toLocaleString('id-ID')}" }, grid: { color: "#333" } }
      }
    }
  };
  const url = await quickchartUrl(config);
  const first = data[0].total, last = data[data.length - 1].total;
  const ret = ((last / first) - 1) * 100;
  return { url, summary: `Equity ${ret >= 0 ? "+" : ""}${ret.toFixed(2)}% (${days}d) | Now Rp${Math.round(last).toLocaleString("id-ID")}` };
}

module.exports = { generateCandlestickChart, generatePortfolioChart };
