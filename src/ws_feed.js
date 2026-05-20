const fetch = require("node-fetch");
const { db } = require("./db");
const { BINANCE_SYMBOLS, BINANCE_TO_SYM, DEFAULT_USD_IDR } = require("./config");

let ws = null;
let connected = false;
let reconnectCount = 0;
let reconnectDelay = 1000;
let lastUpdateTs = {};
let usdIdrRate = DEFAULT_USD_IDR;
let usdIdrUpdatedAt = null;
let shuttingDown = false;

async function refreshUsdIdr() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD", { timeout: 9000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j && j.rates && typeof j.rates.IDR === "number" && j.rates.IDR > 0) {
      usdIdrRate = j.rates.IDR;
      usdIdrUpdatedAt = new Date().toISOString();
      console.error(`💱 USD/IDR rate updated: ${usdIdrRate}`);
    }
  } catch (err) {
    console.error("USD/IDR fetch failed, using fallback:", err.message);
  }
}

function buildStreamUrl() {
  const streams = Object.values(BINANCE_SYMBOLS).map((s) => `${s.toLowerCase()}@ticker`).join("/");
  return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}

function connect() {
  if (shuttingDown) return;
  const url = buildStreamUrl();
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error("WS create failed:", err.message);
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    connected = true;
    reconnectDelay = 1000;
    console.error("🟢 WS connected to Binance");
  });

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const d = msg.data;
      if (!d || !d.s) return;
      const sym = BINANCE_TO_SYM[d.s];
      if (!sym) return;
      const priceUsd = Number(d.c);
      const change24 = Number(d.P);
      const vol24 = Number(d.q) || Number(d.v) * priceUsd || 0;
      if (!priceUsd || !isFinite(priceUsd)) return;
      const priceIdr = priceUsd * usdIdrRate;
      db.prepare(`INSERT OR REPLACE INTO price_cache (symbol, price_usd, price_idr, change_24h, volume_24h, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
        .run(sym, priceUsd, priceIdr, change24, vol24);
      lastUpdateTs[sym] = Date.now();
    } catch {}
  });

  ws.addEventListener("close", () => {
    connected = false;
    console.error("🔴 WS closed");
    scheduleReconnect();
  });

  ws.addEventListener("error", (err) => {
    console.error("⚠️ WS error:", err?.message || "unknown");
  });
}

function scheduleReconnect() {
  if (shuttingDown) return;
  reconnectCount++;
  const delay = Math.min(reconnectDelay, 30000);
  console.error(`🔄 WS reconnect in ${delay}ms (attempt #${reconnectCount})`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, delay);
}

function start() {
  if (typeof WebSocket === "undefined") {
    console.error("⚠️ Native WebSocket not available, skipping WS feed");
    return;
  }
  refreshUsdIdr();
  setInterval(refreshUsdIdr, 3600 * 1000);
  connect();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function shutdown() {
  shuttingDown = true;
  try { if (ws) ws.close(); } catch {}
}

function getStatus() {
  return {
    connected,
    reconnectCount,
    usdIdrRate,
    usdIdrUpdatedAt,
    lastUpdateTs: { ...lastUpdateTs },
    trackedSymbols: Object.keys(BINANCE_SYMBOLS)
  };
}

module.exports = { start, getStatus, refreshUsdIdr };
