const { db } = require("./db");
const { COIN_IDS } = require("./config");

const SYMBOLS = Object.keys(COIN_IDS);

const BINANCE_MAP = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", BNB: "BNBUSDT", SOL: "SOLUSDT", ADA: "ADAUSDT",
  XRP: "XRPUSDT", DOGE: "DOGEUSDT", MATIC: "POLUSDT", LINK: "LINKUSDT", AVAX: "AVAXUSDT",
  LTC: "LTCUSDT", ATOM: "ATOMUSDT", NEAR: "NEARUSDT", ARB: "ARBUSDT"
};
const COINBASE_MAP = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", ADA: "ADA-USD", XRP: "XRP-USD",
  DOGE: "DOGE-USD", MATIC: "MATIC-USD", LINK: "LINK-USD", AVAX: "AVAX-USD",
  LTC: "LTC-USD", ATOM: "ATOM-USD", NEAR: "NEAR-USD", ARB: "ARB-USD"
};
const KRAKEN_MAP = {
  BTC: "BTC/USD", ETH: "ETH/USD", SOL: "SOL/USD", ADA: "ADA/USD", XRP: "XRP/USD",
  DOGE: "DOGE/USD", MATIC: "MATIC/USD", LINK: "LINK/USD", AVAX: "AVAX/USD",
  LTC: "LTC/USD", ATOM: "ATOM/USD", NEAR: "NEAR/USD"
};

const cache = {};
const status = {
  binance: { connected: false, reconnects: 0, lastMsg: null },
  coinbase: { connected: false, reconnects: 0, lastMsg: null },
  kraken: { connected: false, reconnects: 0, lastMsg: null }
};

function ensure(sym) {
  if (!cache[sym]) cache[sym] = {};
}

function setPrice(exchange, sym, { bid, ask, last }) {
  ensure(sym);
  cache[sym][exchange] = { bid, ask, last, ts: Date.now() };
  status[exchange].lastMsg = Date.now();
}

function connectBinance() {
  const streams = Object.values(BINANCE_MAP).map(s => `${s.toLowerCase()}@bookTicker`).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  let ws;
  try { ws = new WebSocket(url); }
  catch (err) { console.error("binance WS create error:", err.message); scheduleReconnect("binance"); return; }
  const reverse = Object.fromEntries(Object.entries(BINANCE_MAP).map(([k,v]) => [v, k]));
  ws.onopen = () => { status.binance.connected = true; console.error("✅ Binance WS connected"); };
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      const d = m.data;
      if (!d || !d.s) return;
      const sym = reverse[d.s];
      if (!sym) return;
      setPrice("binance", sym, { bid: parseFloat(d.b), ask: parseFloat(d.a), last: (parseFloat(d.b) + parseFloat(d.a)) / 2 });
    } catch {}
  };
  ws.onclose = () => { status.binance.connected = false; scheduleReconnect("binance"); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  return ws;
}

function connectCoinbase() {
  const url = "wss://ws-feed.exchange.coinbase.com";
  let ws;
  try { ws = new WebSocket(url); }
  catch (err) { console.error("coinbase WS create error:", err.message); scheduleReconnect("coinbase"); return; }
  const products = Object.values(COINBASE_MAP);
  const reverse = Object.fromEntries(Object.entries(COINBASE_MAP).map(([k,v]) => [v, k]));
  ws.onopen = () => {
    status.coinbase.connected = true;
    console.error("✅ Coinbase WS connected");
    ws.send(JSON.stringify({ type: "subscribe", product_ids: products, channels: ["ticker"] }));
  };
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type !== "ticker") return;
      const sym = reverse[m.product_id];
      if (!sym) return;
      const last = parseFloat(m.price);
      const bid = parseFloat(m.best_bid || last);
      const ask = parseFloat(m.best_ask || last);
      setPrice("coinbase", sym, { bid, ask, last });
    } catch {}
  };
  ws.onclose = () => { status.coinbase.connected = false; scheduleReconnect("coinbase"); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  return ws;
}

function connectKraken() {
  const url = "wss://ws.kraken.com/v2";
  let ws;
  try { ws = new WebSocket(url); }
  catch (err) { console.error("kraken WS create error:", err.message); scheduleReconnect("kraken"); return; }
  const pairs = Object.values(KRAKEN_MAP);
  const reverse = Object.fromEntries(Object.entries(KRAKEN_MAP).map(([k,v]) => [v, k]));
  ws.onopen = () => {
    status.kraken.connected = true;
    console.error("✅ Kraken WS connected");
    ws.send(JSON.stringify({ method: "subscribe", params: { channel: "ticker", symbol: pairs } }));
  };
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.channel !== "ticker" || !Array.isArray(m.data)) return;
      for (const t of m.data) {
        const sym = reverse[t.symbol];
        if (!sym) continue;
        setPrice("kraken", sym, { bid: parseFloat(t.bid), ask: parseFloat(t.ask), last: parseFloat(t.last) });
      }
    } catch {}
  };
  ws.onclose = () => { status.kraken.connected = false; scheduleReconnect("kraken"); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  return ws;
}

const backoff = { binance: 1000, coinbase: 1000, kraken: 1000 };
function scheduleReconnect(exchange) {
  status[exchange].reconnects++;
  const delay = backoff[exchange];
  backoff[exchange] = Math.min(backoff[exchange] * 2, 30000);
  setTimeout(() => {
    backoff[exchange] = 1000;
    if (exchange === "binance") connectBinance();
    else if (exchange === "coinbase") connectCoinbase();
    else if (exchange === "kraken") connectKraken();
  }, delay);
}

function start() {
  try { connectBinance(); } catch {}
  setTimeout(() => { try { connectCoinbase(); } catch {} }, 500);
  setTimeout(() => { try { connectKraken(); } catch {} }, 1000);
}

function getAggregatePrice(sym) {
  const c = cache[sym];
  if (!c) return null;
  const prices = Object.values(c).filter(p => p.last && Date.now() - p.ts < 10000).map(p => p.last);
  if (!prices.length) return null;
  return prices.reduce((s,v)=>s+v,0) / prices.length;
}

function persistSnapshot() {
  try {
    for (const sym of Object.keys(cache)) {
      for (const ex of Object.keys(cache[sym])) {
        const p = cache[sym][ex];
        if (!p || Date.now() - p.ts > 60000) continue;
        db.prepare("INSERT INTO exchange_prices (symbol, exchange, bid_usd, ask_usd, last_usd) VALUES (?, ?, ?, ?, ?)").run(sym, ex, p.bid, p.ask, p.last);
      }
    }
    db.prepare("DELETE FROM exchange_prices WHERE ts < datetime('now','-7 days')").run();
  } catch (err) { console.error("exchange snapshot error:", err.message); }
}

async function getExchangePrices({ symbol }) {
  const sym = String(symbol).toUpperCase();
  const c = cache[sym];
  if (!c) return { content: [{ type: "text", text: `❌ Tidak ada data live untuk ${sym}` }] };
  const rows = [];
  for (const ex of ["binance", "coinbase", "kraken"]) {
    const p = c[ex];
    if (!p) { rows.push(`${ex.padEnd(10)} N/A`); continue; }
    const spreadPct = ((p.ask - p.bid) / p.bid * 100).toFixed(3);
    const age = ((Date.now() - p.ts) / 1000).toFixed(1);
    rows.push(`${ex.padEnd(10)} bid $${p.bid.toFixed(4)} | ask $${p.ask.toFixed(4)} | last $${p.last.toFixed(4)} | spread ${spreadPct}% | ${age}s ago`);
  }
  const text = [`🌐 PRICES ${sym}`, "─".repeat(75), ...rows].join("\n");
  return { content: [{ type: "text", text }] };
}

async function getBestPrice({ symbol }) {
  const sym = String(symbol).toUpperCase();
  const c = cache[sym];
  if (!c) return { content: [{ type: "text", text: `❌ Tidak ada data live untuk ${sym}` }] };
  let bestBid = { exchange: null, price: -Infinity };
  let bestAsk = { exchange: null, price: Infinity };
  for (const [ex, p] of Object.entries(c)) {
    if (Date.now() - p.ts > 10000) continue;
    if (p.bid > bestBid.price) bestBid = { exchange: ex, price: p.bid };
    if (p.ask < bestAsk.price) bestAsk = { exchange: ex, price: p.ask };
  }
  if (!bestBid.exchange || !bestAsk.exchange) return { content: [{ type: "text", text: `❌ Data stale untuk ${sym}` }] };
  const arbPct = ((bestBid.price - bestAsk.price) / bestAsk.price * 100);
  const text =
    `🎯 BEST PRICE ${sym}\n` +
    `${"─".repeat(50)}\n` +
    `🟢 BUY (lowest ask):  $${bestAsk.price.toFixed(4)} @ ${bestAsk.exchange}\n` +
    `🔴 SELL (highest bid): $${bestBid.price.toFixed(4)} @ ${bestBid.exchange}\n` +
    `${arbPct > 0 ? "💰" : "📊"} Arbitrage spread: ${arbPct.toFixed(3)}%${arbPct > 0.3 ? " 🔥" : ""}`;
  return { content: [{ type: "text", text }] };
}

async function getArbitrage({ min_spread_pct = 0.3 }) {
  const opps = [];
  for (const sym of Object.keys(cache)) {
    const c = cache[sym];
    let bestBid = { exchange: null, price: -Infinity };
    let bestAsk = { exchange: null, price: Infinity };
    for (const [ex, p] of Object.entries(c)) {
      if (Date.now() - p.ts > 10000) continue;
      if (p.bid > bestBid.price) bestBid = { exchange: ex, price: p.bid };
      if (p.ask < bestAsk.price) bestAsk = { exchange: ex, price: p.ask };
    }
    if (!bestBid.exchange || !bestAsk.exchange) continue;
    if (bestBid.exchange === bestAsk.exchange) continue;
    const pct = ((bestBid.price - bestAsk.price) / bestAsk.price * 100);
    if (pct >= min_spread_pct) {
      opps.push({ sym, pct, buyEx: bestAsk.exchange, buyPrice: bestAsk.price, sellEx: bestBid.exchange, sellPrice: bestBid.price });
    }
  }
  opps.sort((a, b) => b.pct - a.pct);
  if (!opps.length) return { content: [{ type: "text", text: `Tidak ada peluang arbitrase >= ${min_spread_pct}% saat ini.` }] };
  const rows = opps.map(o =>
    `${o.sym.padEnd(6)} ${o.pct.toFixed(3)}% | buy ${o.buyEx} @ $${o.buyPrice.toFixed(4)} → sell ${o.sellEx} @ $${o.sellPrice.toFixed(4)}`
  );
  const text = [`💰 ARBITRASE (>= ${min_spread_pct}%)`, "─".repeat(75), ...rows].join("\n");
  return { content: [{ type: "text", text }] };
}

async function getExchangeStatus() {
  const fmtTs = (t) => t ? `${((Date.now() - t) / 1000).toFixed(1)}s ago` : "never";
  const symRows = [];
  for (const sym of SYMBOLS) {
    const c = cache[sym] || {};
    symRows.push(`${sym.padEnd(6)} bin:${fmtTs(c.binance?.ts).padEnd(12)} cb:${fmtTs(c.coinbase?.ts).padEnd(12)} kr:${fmtTs(c.kraken?.ts)}`);
  }
  const text =
    `🌐 MULTI-EXCHANGE STATUS\n` +
    `${"─".repeat(70)}\n` +
    `Binance:  ${status.binance.connected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"} | reconnects: ${status.binance.reconnects} | last: ${fmtTs(status.binance.lastMsg)}\n` +
    `Coinbase: ${status.coinbase.connected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"} | reconnects: ${status.coinbase.reconnects} | last: ${fmtTs(status.coinbase.lastMsg)}\n` +
    `Kraken:   ${status.kraken.connected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"} | reconnects: ${status.kraken.reconnects} | last: ${fmtTs(status.kraken.lastMsg)}\n\n` +
    `Per-symbol last update:\n${symRows.join("\n")}`;
  return { content: [{ type: "text", text }] };
}

module.exports = { start, getAggregatePrice, persistSnapshot, getExchangePrices, getBestPrice, getArbitrage, getExchangeStatus, cache, status };
