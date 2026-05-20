const fetch = require("node-fetch");
const { db } = require("./db");
const { COIN_IDS } = require("./config");

async function fetchJson(url, timeout = 9000) {
  const res = await fetch(url, { timeout });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function stripCdata(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchRssItems(url) {
  const res = await fetch(url, { timeout: 12000, headers: { "User-Agent": "Mozilla/5.0 paper-trading-mcp" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return matches.map((m) => {
    const x = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(x);
      return r ? stripCdata(r[1]) : "";
    };
    return {
      title: pick("title"),
      link: pick("link"),
      description: pick("description"),
      pubDate: pick("pubDate")
    };
  });
}

function resolveCoinId(symbol) {
  const sym = String(symbol).toUpperCase();
  const coinId = COIN_IDS[sym];
  if (!coinId) {
    throw new Error(
      `Coin tidak dikenal: ${sym}. Tersedia: ${Object.keys(COIN_IDS).join(", ")}`
    );
  }
  return { sym, coinId };
}

async function fetchPrice(symbol) {
  const sym = String(symbol).toUpperCase();
  const coinId = COIN_IDS[sym];
  if (!coinId) {
    throw new Error(
      `Coin tidak dikenal: ${sym}. Tersedia: ${Object.keys(COIN_IDS).join(", ")}`
    );
  }

  const cached = db.prepare("SELECT *, (julianday('now') - julianday(updated_at)) * 86400 AS age_sec FROM price_cache WHERE symbol = ?").get(sym);
  if (cached && cached.age_sec !== null && cached.age_sec < 10) {
    return {
      symbol: sym,
      price_usd: cached.price_usd,
      price_idr: cached.price_idr,
      change_24h: cached.change_24h || 0,
      volume_24h: cached.volume_24h || 0,
      fromCache: false,
      fromWs: true
    };
  }

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd,idr&include_24hr_change=true&include_24hr_vol=true`;

  try {
    const res = await fetch(url, { timeout: 9000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const coin = data[coinId];
    if (!coin || typeof coin.usd !== "number") throw new Error("Data kosong");

    db.prepare(`
      INSERT OR REPLACE INTO price_cache
        (symbol, price_usd, price_idr, change_24h, volume_24h, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      sym,
      coin.usd,
      coin.idr,
      coin.usd_24h_change || 0,
      coin.usd_24h_vol || 0
    );

    return {
      symbol: sym,
      price_usd: coin.usd,
      price_idr: coin.idr,
      change_24h: coin.usd_24h_change || 0,
      volume_24h: coin.usd_24h_vol || 0,
      fromCache: false
    };
  } catch (err) {
    const fb = db.prepare("SELECT * FROM price_cache WHERE symbol = ?").get(sym);
    if (fb) return { ...fb, fromCache: true };
    throw new Error(`Gagal ambil harga ${sym}: ${err.message}`);
  }
}

module.exports = { fetchPrice, fetchJson, fetchRssItems, stripCdata, resolveCoinId, COIN_IDS };
