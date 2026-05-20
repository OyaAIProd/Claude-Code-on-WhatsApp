const { fetchJson, resolveCoinId, fetchPrice } = require("./prices");
const { fmt } = require("./format");

async function getMarketSentiment() {
  try {
    const data = await fetchJson("https://api.alternative.me/fng/?limit=7");
    const arr = data.data || [];
    if (!arr.length) return { content: [{ type: "text", text: "Tidak ada data sentiment." }] };
    const current = arr[0];
    const trendRows = arr.map((d) => {
      const date = new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10);
      return `  ${date}: ${String(d.value).padStart(3)} (${d.value_classification})`;
    });
    const text =
      `🎯 FEAR & GREED INDEX\n${"─".repeat(40)}\n` +
      `Score sekarang: ${current.value}/100\n` +
      `Label: ${current.value_classification}\n\n` +
      `📈 Trend 7 hari:\n${trendRows.join("\n")}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal ambil sentiment: ${err.message}` }] };
  }
}

async function getTrending() {
  try {
    const data = await fetchJson("https://api.coingecko.com/api/v3/search/trending");
    const coins = (data.coins || []).slice(0, 7);
    if (!coins.length) return { content: [{ type: "text", text: "Tidak ada trending coin." }] };
    const rows = coins.map((c, i) => {
      const item = c.item || {};
      const pct = item.data?.price_change_percentage_24h?.usd;
      const pctStr = typeof pct === "number" ? `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%` : "n/a";
      const price = item.data?.price ? `$${Number(item.data.price).toLocaleString("en-US", { maximumFractionDigits: 6 })}` : "n/a";
      return `${i + 1}. ${item.name} (${item.symbol?.toUpperCase()}) - ${price} | ${pctStr}`;
    });
    return { content: [{ type: "text", text: ["🔥 TRENDING COINS", "─".repeat(50), ...rows].join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal ambil trending: ${err.message}` }] };
  }
}

async function getCoinDetail({ symbol }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const d = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=true&developer_data=true&sparkline=false`, 12000);
    const md = d.market_data || {};
    const desc = (d.description?.en || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 250);
    const cd = d.community_data || {};
    const dd = d.developer_data || {};
    const text =
      `🪙 ${d.name} (${sym})\n${"─".repeat(50)}\n` +
      `💰 Price: $${md.current_price?.usd ?? "n/a"} | Rp${fmt(md.current_price?.idr || 0)}\n` +
      `📊 Market Cap: $${(md.market_cap?.usd || 0).toLocaleString("en-US")}\n` +
      `💱 Volume 24h: $${(md.total_volume?.usd || 0).toLocaleString("en-US")}\n` +
      `📈 24h: ${(md.price_change_percentage_24h || 0).toFixed(2)}% | 7d: ${(md.price_change_percentage_7d || 0).toFixed(2)}% | 30d: ${(md.price_change_percentage_30d || 0).toFixed(2)}%\n` +
      `🏔️ ATH: $${md.ath?.usd ?? "n/a"} (${(md.ath_change_percentage?.usd || 0).toFixed(1)}% dari ATH)\n` +
      `🕳️ ATL: $${md.atl?.usd ?? "n/a"}\n\n` +
      `👥 Community: Twitter ${cd.twitter_followers || 0} | Reddit ${cd.reddit_subscribers || 0}\n` +
      `💻 Dev: ${dd.stars || 0}⭐ | ${dd.forks || 0} forks | ${dd.commit_count_4_weeks || 0} commits/4w\n\n` +
      `ℹ️ ${desc}${desc.length >= 250 ? "..." : ""}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal ambil detail: ${err.message}` }] };
  }
}

async function getMarketOverview() {
  try {
    const data = await fetchJson("https://api.coingecko.com/api/v3/global");
    const g = data.data || {};
    const totalCapUsd = g.total_market_cap?.usd || 0;
    const totalVolUsd = g.total_volume?.usd || 0;
    const btcDom = g.market_cap_percentage?.btc || 0;
    const ethDom = g.market_cap_percentage?.eth || 0;
    const change = g.market_cap_change_percentage_24h_usd || 0;
    const text =
      `🌍 GLOBAL CRYPTO MARKET\n${"─".repeat(45)}\n` +
      `💰 Total Market Cap: $${(totalCapUsd / 1e9).toFixed(2)}B\n` +
      `📊 Total Volume 24h: $${(totalVolUsd / 1e9).toFixed(2)}B\n` +
      `📈 Cap Change 24h: ${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}%\n\n` +
      `🪙 BTC Dominance: ${btcDom.toFixed(2)}%\n` +
      `🪙 ETH Dominance: ${ethDom.toFixed(2)}%\n\n` +
      `🔢 Active Cryptos: ${g.active_cryptocurrencies || 0}\n🏪 Markets: ${g.markets || 0}\n` +
      `⏰ Updated: ${g.updated_at ? new Date(g.updated_at * 1000).toISOString().slice(0, 19).replace("T", " ") : "n/a"}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal ambil overview: ${err.message}` }] };
  }
}

async function getPriceHistory({ symbol, days }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=idr&days=${days}`, 12000);
    if (!Array.isArray(data) || !data.length) return { content: [{ type: "text", text: `❌ Data history kosong untuk ${sym}` }] };
    const highs = data.map((d) => d[2]);
    const lows = data.map((d) => d[3]);
    const closes = data.map((d) => d[4]);
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    const avg = closes.reduce((s, v) => s + v, 0) / closes.length;
    const variance = closes.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / closes.length;
    const stdDev = Math.sqrt(variance);
    const volatilityPct = (stdDev / avg) * 100;
    const first = closes[0];
    const last = closes[closes.length - 1];
    const changePct = ((last / first) - 1) * 100;
    const text =
      `📈 HISTORY ${sym} (${days}d)\n${"─".repeat(45)}\n` +
      `🟢 Highest: Rp${fmt(highest)}\n🔴 Lowest:  Rp${fmt(lowest)}\n📊 Average: Rp${fmt(avg)}\n` +
      `🎢 Volatility: ${volatilityPct.toFixed(2)}%\n` +
      `🔁 Change: ${changePct >= 0 ? "▲" : "▼"} ${Math.abs(changePct).toFixed(2)}% (${days}d)\n` +
      `📦 Data points: ${data.length}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal ambil history: ${err.message}` }] };
  }
}

async function getVolumeSpikes({ threshold_pct }) {
  try {
    const data = await fetchJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=50&page=1", 12000);
    const spikes = [];
    for (const c of data) {
      if (!c.market_cap || c.market_cap < 1e6) continue;
      const ratio = (c.total_volume / c.market_cap) * 100;
      if (ratio > threshold_pct) {
        spikes.push({ sym: c.symbol.toUpperCase(), name: c.name, vol: c.total_volume, cap: c.market_cap, ratio, chg: c.price_change_percentage_24h || 0 });
      }
    }
    if (!spikes.length) return { content: [{ type: "text", text: `Tidak ada spike >${threshold_pct}%` }] };
    const lines = spikes.slice(0, 20).map((s, i) =>
      `${i + 1}. ${s.sym} (${s.name}) | Vol/Cap: ${s.ratio.toFixed(1)}% | Vol $${(s.vol/1e6).toFixed(1)}M | 24h ${s.chg>=0?"▲":"▼"}${Math.abs(s.chg).toFixed(2)}%`
    );
    return { content: [{ type: "text", text: [`🐋 VOLUME SPIKES (>${threshold_pct}%)`, "─".repeat(70), ...lines].join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal: ${err.message}` }] };
  }
}

async function analyzeMarket({ symbols }) {
  const rows = [];
  for (const s of symbols) {
    try {
      const p = await fetchPrice(s);
      const arrow = p.change_24h >= 0 ? "▲" : "▼";
      rows.push(`${p.symbol.padEnd(6)} $${String(Number(p.price_usd).toFixed(2)).padStart(12)} | ${arrow}${Math.abs(p.change_24h).toFixed(2)}%`);
    } catch (err) {
      rows.push(`${String(s).toUpperCase().padEnd(6)} Error: ${err.message}`);
    }
  }
  return { content: [{ type: "text", text: ["🌐 MARKET", "─".repeat(40), ...rows].join("\n") }] };
}

module.exports = { getMarketSentiment, getTrending, getCoinDetail, getMarketOverview, getPriceHistory, getVolumeSpikes, analyzeMarket };
