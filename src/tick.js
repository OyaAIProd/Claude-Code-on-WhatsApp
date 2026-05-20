const { db } = require("./db");
const { fetchPrice } = require("./prices");
const { checkPendingOrders } = require("./orders");
const { checkPositions } = require("./positions");
const { checkWatchlist } = require("./watchlist");
const { runDcaTick } = require("./dca");
const { takeAllEquitySnapshots } = require("./execution");

async function gatherPrices() {
  const orders = db.prepare("SELECT DISTINCT symbol FROM pending_orders WHERE status='OPEN'").all();
  const positions = db.prepare("SELECT DISTINCT symbol FROM positions WHERE status='OPEN'").all();
  const watches = db.prepare("SELECT DISTINCT symbol FROM watchlist WHERE triggered=0").all();
  const dcas = db.prepare("SELECT DISTINCT symbol FROM dca_plans WHERE active=1 AND next_run_at <= datetime('now')").all();
  const symbols = new Set();
  for (const r of orders) symbols.add(r.symbol);
  for (const r of positions) symbols.add(r.symbol);
  for (const r of watches) symbols.add(r.symbol);
  for (const r of dcas) symbols.add(r.symbol);
  const prices = {};
  for (const sym of symbols) {
    try {
      const p = await fetchPrice(sym);
      prices[sym] = p;
    } catch {
      const cached = db.prepare("SELECT * FROM price_cache WHERE symbol = ?").get(sym);
      if (cached) prices[sym] = { ...cached, symbol: sym };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return prices;
}

function gatherPricesFast() {
  const orders = db.prepare("SELECT DISTINCT symbol FROM pending_orders WHERE status='OPEN'").all();
  const positions = db.prepare("SELECT DISTINCT symbol FROM positions WHERE status='OPEN'").all();
  const watches = db.prepare("SELECT DISTINCT symbol FROM watchlist WHERE triggered=0").all();
  const symbols = new Set();
  for (const r of orders) symbols.add(r.symbol);
  for (const r of positions) symbols.add(r.symbol);
  for (const r of watches) symbols.add(r.symbol);
  const prices = {};
  for (const sym of symbols) {
    const cached = db.prepare("SELECT * FROM price_cache WHERE symbol = ?").get(sym);
    if (cached) prices[sym] = { ...cached, symbol: sym };
  }
  return prices;
}

async function fullTick() {
  try {
    const prices = await gatherPrices();
    await checkPendingOrders(prices);
    checkPositions(prices);
    checkWatchlist(prices);
    runDcaTick(prices);
  } catch (err) {
    console.error("fullTick error:", err.message);
  }
}

async function fastTick() {
  try {
    const prices = gatherPricesFast();
    await checkPendingOrders(prices);
    checkPositions(prices);
    checkWatchlist(prices);
  } catch (err) {
    console.error("fastTick error:", err.message);
  }
}

function startTicks() {
  setTimeout(() => {
    fullTick();
    setInterval(fullTick, 30000);
    setInterval(fastTick, 2000);
    setInterval(takeAllEquitySnapshots, 3600 * 1000);
    takeAllEquitySnapshots();
    try {
      const multiEx = require("./multi_exchange");
      setInterval(() => multiEx.persistSnapshot(), 300 * 1000);
    } catch {}
    try {
      const bot = require("./bot");
      setInterval(() => bot.runBotTick(), 60 * 1000);
    } catch {}
  }, 5000);
}

module.exports = { startTicks, fullTick, fastTick };
