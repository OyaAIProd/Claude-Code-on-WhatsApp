const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const { db, getActivePortfolioId, resolvePortfolioId } = require("./db");
const { fmt } = require("./format");
const { fetchPrice } = require("./prices");
const { executeBuyInternal, executeSellInternal } = require("./execution");
const { createSlTpOrders, placeOrder, cancelOrder, listOrders } = require("./orders");
const { openPosition, closePosition, listPositions } = require("./positions");
const { createDca, listDca, cancelDca } = require("./dca");
const { addWatch, listWatches, removeWatch, getAlerts } = require("./watchlist");
const {
  getPortfolioTool, getPerformance, getTradeHistory, getEquityHistory,
  getIndicators, suggestSize, backtest, getCorrelation, journalStats,
  getTaxReport, rebalance
} = require("./analytics");
const {
  getMarketSentiment, getTrending, getCoinDetail, getMarketOverview,
  getPriceHistory, getVolumeSpikes, analyzeMarket
} = require("./intel");
const { getCryptoNews, getMarketMood, setAiSentiment } = require("./news");
const {
  createPortfolio, listPortfolios, switchPortfolio, deletePortfolio,
  comparePortfolios, renamePortfolio, resetPortfolio
} = require("./portfolios");
const wsFeed = require("./ws_feed");
const multiEx = require("./multi_exchange");
const { startTicks } = require("./tick");
const forecast = require("./forecast");
const copyTrading = require("./copy_trading");
const notify = require("./notify");
const backtestV2 = require("./backtest_v2");
const bot = require("./bot");
const newsTrader = require("./news_trader");
const charts = require("./charts");
const autoSltp = require("./auto_sltp");

const server = new McpServer({ name: "paper-trading", version: "3.0.0" });

server.tool(
  "get_price",
  "Harga real-time coin dari CoinGecko (USD + IDR)",
  { symbol: z.string() },
  async ({ symbol }) => {
    const p = await fetchPrice(symbol);
    const arrow = p.change_24h >= 0 ? "▲" : "▼";
    const vol = p.volume_24h ? (p.volume_24h / 1e6).toFixed(1) + "M" : "n/a";
    const tag = p.fromWs ? " 🟢 WS" : (p.fromCache ? " ⚠️ cache" : "");
    const text =
      `💰 ${p.symbol}\n` +
      `USD: $${Number(p.price_usd).toLocaleString("en-US", { maximumFractionDigits: 4 })}\n` +
      `IDR: Rp${fmt(p.price_idr)}\n` +
      `24h: ${arrow} ${Number(p.change_24h).toFixed(2)}%\n` +
      `Vol: $${vol}${tag}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool("get_portfolio", "Lihat portfolio lengkap (cash, holdings, PnL, total aset)",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, getPortfolioTool);

server.tool(
  "buy",
  "Beli crypto dengan IDR. Mendukung SL/TP otomatis + journal tags.",
  {
    symbol: z.string(),
    amount_idr: z.number().positive(),
    note: z.string().optional(),
    sl_pct: z.number().positive().optional(),
    tp_pct: z.number().positive().optional(),
    strategy: z.string().optional(),
    setup: z.string().optional(),
    confidence: z.number().int().min(1).max(10).optional(),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  },
  async ({ symbol, amount_idr, note, sl_pct, tp_pct, strategy, setup, confidence, portfolio_id }) => {
    const sym = String(symbol).toUpperCase();
    try {
      const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
      if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
      const p = await fetchPrice(sym);
      const risk_idr = sl_pct ? amount_idr * (sl_pct / 100) : null;
      const r = executeBuyInternal(sym, amount_idr, {
        midPrice: p.price_idr, price_usd: p.price_usd, note, risk_idr, strategy, setup, confidence, portfolio_id: pid,
        sl_pct_explicit: sl_pct, tp_pct_explicit: tp_pct
      });
      if (sl_pct || tp_pct) createSlTpOrders(sym, r.exec, sl_pct, tp_pct, pid);
      const text =
        `✅ BELI ${sym} (portfolio #${pid})\n` +
        `${r.coinAmt.toFixed(8)} coin\n` +
        `Mid: Rp${fmt(p.price_idr)} → Exec: Rp${fmt(r.exec)}\n` +
        `Spread +Rp${fmt(r.spreadDelta)} | Slippage +Rp${fmt(r.slipDelta)}\n` +
        `Fee tier: ${r.feeInfo.tier}\n` +
        `Total: Rp${fmt(amount_idr)} + fee Rp${fmt(r.fee)} = Rp${fmt(r.total)}\n` +
        `Sisa cash: Rp${fmt(r.remaining)}` +
        (sl_pct ? `\n🛡️ SL ${sl_pct}% @ Rp${fmt(r.exec * (1 - sl_pct/100))}` : "") +
        (tp_pct ? `\n🎯 TP ${tp_pct}% @ Rp${fmt(r.exec * (1 + tp_pct/100))}` : "") +
        (r.autoSlTp ? `\n🤖 AUTO ${r.autoSlTp.scope}: ${r.autoSlTp.sl_pct ? `SL ${r.autoSlTp.sl_pct}%` : ""}${r.autoSlTp.sl_pct && r.autoSlTp.tp_pct ? " | " : ""}${r.autoSlTp.tp_pct ? `TP ${r.autoSlTp.tp_pct}%` : ""}` : "") +
        (strategy ? `\n📌 Strategy: ${strategy}` : "") +
        (setup ? ` | Setup: ${setup}` : "") +
        (confidence ? ` | Conf: ${confidence}/10` : "") +
        (note ? `\nNote: ${note}` : "");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ ${err.message}` }] };
    }
  }
);

server.tool(
  "sell",
  "Jual sebagian holdings (percent 1-100). Mendukung journal tags.",
  {
    symbol: z.string(),
    percent: z.number().min(0.0001).max(100),
    note: z.string().optional(),
    strategy: z.string().optional(),
    setup: z.string().optional(),
    confidence: z.number().int().min(1).max(10).optional(),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  },
  async ({ symbol, percent, note, strategy, setup, confidence, portfolio_id }) => {
    const sym = String(symbol).toUpperCase();
    try {
      const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
      if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
      const p = await fetchPrice(sym);
      const r = executeSellInternal(sym, percent, {
        midPrice: p.price_idr, price_usd: p.price_usd, note, strategy, setup, confidence, portfolio_id: pid
      });
      const text =
        `✅ JUAL ${sym} ${percent}% (portfolio #${pid})\n` +
        `${r.sellAmt.toFixed(8)} coin\n` +
        `Mid: Rp${fmt(p.price_idr)} → Exec: Rp${fmt(r.exec)}\n` +
        `Spread -Rp${fmt(r.spreadDelta)} | Slippage -Rp${fmt(r.slipDelta)}\n` +
        `Fee tier: ${r.feeInfo.tier}\n` +
        `Gross: Rp${fmt(r.sellAmt * r.exec)} - fee Rp${fmt(r.fee)} = Net Rp${fmt(r.net)}\n` +
        `PnL: ${r.pnl >= 0 ? "+" : ""}Rp${fmt(r.pnl)}` +
        (r.rMultiple !== null ? ` | R=${r.rMultiple.toFixed(2)}` : "") + "\n" +
        (r.remaining > 0.000001 ? `Sisa: ${r.remaining.toFixed(8)} ${sym}` : `${sym} habis dijual`) +
        (strategy ? `\n📌 Strategy: ${strategy}` : "") +
        (setup ? ` | Setup: ${setup}` : "") +
        (confidence ? ` | Conf: ${confidence}/10` : "") +
        (note ? `\nNote: ${note}` : "");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ ${err.message}` }] };
    }
  }
);

server.tool("get_trade_history", "Riwayat trade terakhir",
  { limit: z.number().int().positive().default(20), portfolio_id: z.union([z.number(), z.string()]).optional() },
  getTradeHistory);

server.tool("get_performance", "Statistik performa lengkap: Sharpe, max DD, win rate, profit factor, PnL realized/unrealized",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, getPerformance);

server.tool("analyze_market", "Cek harga beberapa coin sekaligus",
  { symbols: z.array(z.string()).min(1).max(14) }, analyzeMarket);

server.tool("place_order", "Pasang limit/stop order. Type: BUY_LIMIT, SELL_LIMIT, STOP_LOSS, TAKE_PROFIT",
  {
    type: z.enum(["BUY_LIMIT", "SELL_LIMIT", "STOP_LOSS", "TAKE_PROFIT"]),
    symbol: z.string(),
    trigger_price_idr: z.number().positive(),
    amount_idr: z.number().positive().optional(),
    percent: z.number().min(0.0001).max(100).optional(),
    note: z.string().optional(),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  }, placeOrder);

server.tool("cancel_order", "Batalkan pending order", { id: z.number().int() }, cancelOrder);
server.tool("list_orders", "Daftar pending orders",
  { status: z.enum(["OPEN", "FILLED", "CANCELLED"]).optional(), portfolio_id: z.union([z.number(), z.string()]).optional() },
  listOrders);

server.tool("set_sl_tp", "Pasang SL/TP ke holding existing (% dari current avg buy price)",
  {
    symbol: z.string(),
    sl_pct: z.number().positive().optional(),
    tp_pct: z.number().positive().optional(),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  },
  async ({ symbol, sl_pct, tp_pct, portfolio_id }) => {
    const sym = String(symbol).toUpperCase();
    const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
    if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
    const h = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND symbol = ?").get(pid, sym);
    if (!h) return { content: [{ type: "text", text: `❌ Tidak punya ${sym}` }] };
    if (!sl_pct && !tp_pct) return { content: [{ type: "text", text: "❌ Isi sl_pct atau tp_pct" }] };
    createSlTpOrders(sym, h.avg_buy_price, sl_pct, tp_pct, pid);
    const text =
      `✅ SL/TP dipasang untuk ${sym}\n` +
      (sl_pct ? `🛡️ SL ${sl_pct}% @ Rp${fmt(h.avg_buy_price * (1 - sl_pct/100))}\n` : "") +
      (tp_pct ? `🎯 TP ${tp_pct}% @ Rp${fmt(h.avg_buy_price * (1 + tp_pct/100))}` : "");
    return { content: [{ type: "text", text }] };
  }
);

server.tool("get_equity_history", "Riwayat equity + daily returns + sparkline",
  { days: z.number().int().positive().default(30), portfolio_id: z.union([z.number(), z.string()]).optional() },
  getEquityHistory);

server.tool("suggest_size", "Saran ukuran posisi berdasarkan risk % equity & stop-loss %",
  {
    symbol: z.string(),
    risk_pct: z.number().positive().max(100),
    sl_pct: z.number().positive().max(100),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  }, suggestSize);

server.tool("get_indicators", "Indikator teknikal: RSI(14), MACD, EMA20/50/200, Bollinger Bands",
  { symbol: z.string(), days: z.number().int().min(30).max(365).default(60) }, getIndicators);

server.tool("create_dca", "Buat DCA plan: beli otomatis interval menit",
  {
    symbol: z.string(),
    amount_idr: z.number().positive(),
    interval_minutes: z.number().int().positive(),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  }, createDca);

server.tool("list_dca", "Daftar DCA plans aktif",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, listDca);

server.tool("cancel_dca", "Batalkan DCA plan", { id: z.number().int() }, cancelDca);

server.tool("add_watch", "Tambah watchlist alert: trigger saat price melewati ambang",
  {
    symbol: z.string(),
    price_above: z.number().positive().optional(),
    price_below: z.number().positive().optional(),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  }, addWatch);

server.tool("list_watches", "Daftar watchlist alerts",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, listWatches);

server.tool("remove_watch", "Hapus watchlist", { id: z.number().int() }, removeWatch);

server.tool("get_alerts", "Lihat alerts yang sudah ter-trigger",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, getAlerts);

server.tool("backtest", "Backtest strategi: sma_cross_10_30, rsi_30_70, buy_and_hold",
  {
    symbol: z.string(),
    strategy: z.enum(["sma_cross_10_30", "rsi_30_70", "buy_and_hold"]),
    days: z.number().int().min(30).max(365).default(90)
  }, backtest);

server.tool("rebalance", "Rebalance portfolio ke target % per coin. confirm=true untuk eksekusi.",
  {
    targets: z.record(z.string(), z.number()),
    confirm: z.boolean().default(false),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  }, rebalance);

server.tool("open_position", "Buka margin position (LONG/SHORT) dengan leverage",
  {
    symbol: z.string(),
    side: z.enum(["LONG", "SHORT"]),
    margin_idr: z.number().positive(),
    leverage: z.number().min(1).max(100),
    portfolio_id: z.union([z.number(), z.string()]).optional()
  }, openPosition);

server.tool("close_position", "Tutup margin position", { id: z.number().int() }, closePosition);

server.tool("list_positions", "Daftar margin positions",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, listPositions);

server.tool("get_tax_report", "Laporan pajak crypto FIFO (PPh final 0.1% Indonesia)",
  { year: z.number().int().optional(), portfolio_id: z.union([z.number(), z.string()]).optional() },
  getTaxReport);

server.tool("get_volume_spikes", "Deteksi coin dengan volume/marketcap ratio tinggi (whale activity)",
  { threshold_pct: z.number().positive().default(200) }, getVolumeSpikes);

server.tool("get_crypto_news", "Berita crypto + sentiment scoring (AI atau keyword). Filter by coin opsional.",
  { coin: z.string().optional() }, getCryptoNews);

server.tool("get_correlation", "Matriks korelasi Pearson antara coin (daily closes)",
  { symbols: z.array(z.string()).min(2).max(8), days: z.number().int().min(7).max(365).default(30) },
  getCorrelation);

server.tool("journal_stats", "Statistik jurnal: win rate & expectancy per strategy/setup",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, journalStats);

server.tool("get_market_sentiment", "Fear & Greed Index dari Alternative.me (7 hari terakhir)", {}, getMarketSentiment);
server.tool("get_trending_coins", "Top 7 trending coins dari CoinGecko", {}, getTrending);
server.tool("get_coin_detail", "Detail lengkap satu coin (price, market cap, ATH/ATL, dev/community stats)",
  { symbol: z.string() }, getCoinDetail);
server.tool("get_market_overview", "Global crypto market data (total cap, BTC dominance, active coins)", {}, getMarketOverview);
server.tool("get_price_history", "OHLC history coin (default 7 hari, dalam IDR). Ringkasan: highest, lowest, average, volatility.",
  { symbol: z.string(), days: z.number().int().min(1).max(365).default(7) }, getPriceHistory);

server.tool("reset_portfolio", "Reset portfolio (target = aktif, atau pakai portfolio_id; atau all=true untuk semua)",
  {
    confirm: z.boolean(),
    portfolio_id: z.union([z.number(), z.string()]).optional(),
    all: z.boolean().optional()
  }, resetPortfolio);

server.tool("create_portfolio", "Buat portfolio baru untuk A/B testing strategi",
  { name: z.string(), starting_balance: z.number().positive().optional(), description: z.string().optional() },
  createPortfolio);
server.tool("list_portfolios", "Daftar semua portfolio + total equity & return %", {}, listPortfolios);
server.tool("switch_portfolio", "Set portfolio aktif (default semua tool)",
  { id_or_name: z.union([z.number(), z.string()]) }, switchPortfolio);
server.tool("delete_portfolio", "Hapus portfolio (tidak bisa kalau aktif)",
  { id_or_name: z.union([z.number(), z.string()]), confirm: z.boolean() }, deletePortfolio);
server.tool("compare_portfolios", "Side-by-side: total, return %, win rate, Sharpe, max DD, trades",
  { ids: z.array(z.union([z.number(), z.string()])).optional() }, comparePortfolios);
server.tool("rename_portfolio", "Ubah nama portfolio",
  { id_or_name: z.union([z.number(), z.string()]), new_name: z.string() }, renamePortfolio);

server.tool("get_ws_status", "Status koneksi WebSocket realtime feed (Binance)", {},
  async () => {
    const s = wsFeed.getStatus();
    const lines = [];
    lines.push(`🔌 Status: ${s.connected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"}`);
    lines.push(`🔄 Reconnects: ${s.reconnectCount}`);
    lines.push(`💱 USD/IDR: ${s.usdIdrRate} (updated ${s.usdIdrUpdatedAt || "n/a"})`);
    lines.push("");
    lines.push("Last update per symbol:");
    for (const sym of s.trackedSymbols) {
      const ts = s.lastUpdateTs[sym];
      const age = ts ? `${((Date.now() - ts) / 1000).toFixed(1)}s ago` : "never";
      lines.push(`  ${sym.padEnd(6)} ${age}`);
    }
    return { content: [{ type: "text", text: ["🌐 WS FEED STATUS", "─".repeat(50), ...lines].join("\n") }] };
  }
);

server.tool("get_market_mood", "Mood agregat dari 20 berita: % bullish/bearish + headlines top",
  { coin: z.string().optional() }, getMarketMood);

server.tool("set_ai_sentiment", "Toggle AI sentiment scoring (butuh ANTHROPIC_API_KEY)",
  { enabled: z.boolean() }, setAiSentiment);

server.tool("predict_price", "Forecast harga linear regression dengan R² confidence + projeksi N hari",
  { symbol: z.string(), days_ahead: z.number().int().min(1).max(30).default(7) }, forecast.predict_price);

server.tool("predict_direction", "Prediksi arah next-day (logistic regression dari indikator teknikal)",
  { symbol: z.string() }, forecast.predict_direction);

server.tool("predict_regime", "Deteksi rezim pasar via Markov chain (5 state)",
  { symbol: z.string() }, forecast.predict_regime);

server.tool("ml_combined_signal", "Sinyal final gabungan 3 model ML",
  { symbol: z.string() }, forecast.ml_combined_signal);

server.tool("follow_portfolio", "Buat copy-trading subscription: target portfolio mirror trade dari source",
  {
    source: z.union([z.number(), z.string()]),
    target: z.union([z.number(), z.string()]),
    size_multiplier: z.number().positive().default(1.0),
    min_confidence: z.number().int().min(0).max(10).default(0),
    max_position_pct: z.number().positive().max(100).default(100),
    follow_buy: z.boolean().default(true),
    follow_sell: z.boolean().default(true)
  }, copyTrading.followPortfolio);

server.tool("unfollow_portfolio", "Hentikan copy-trading subscription",
  { subscription_id: z.number().int() }, copyTrading.unfollowPortfolio);

server.tool("list_subscriptions", "Daftar copy-trading subscriptions aktif",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, copyTrading.listSubscriptions);

server.tool("copy_stats", "Statistik kinerja subscription: mirrored count + return source vs target + korelasi",
  { subscription_id: z.number().int() }, copyTrading.copyStats);

server.tool("setup_notifications", "Pasang push notification ke HP via ntfy.sh (gratis, no key)",
  { topic: z.string().optional(), enabled: z.boolean().default(true) }, notify.setupNotifications);

server.tool("update_notifications", "Toggle kategori notif: enabled, notify_order_fill, notify_sl_hit, dll",
  {
    enabled: z.boolean().optional(),
    notify_order_fill: z.boolean().optional(),
    notify_sl_hit: z.boolean().optional(),
    notify_tp_hit: z.boolean().optional(),
    notify_liquidation: z.boolean().optional(),
    notify_watch_alert: z.boolean().optional(),
    notify_dca_executed: z.boolean().optional(),
    notify_copy_trade: z.boolean().optional(),
    min_priority: z.enum(["low", "default", "high", "urgent"]).optional()
  }, notify.updateNotifications);

server.tool("test_notification", "Kirim notif test ke HP",
  { message: z.string().optional() }, notify.testNotification);

server.tool("get_notification_config", "Lihat konfigurasi notifikasi saat ini", {}, notify.getNotificationConfig);

server.tool("get_exchange_prices", "Harga 3 exchange (Binance/Coinbase/Kraken) side-by-side",
  { symbol: z.string() }, multiEx.getExchangePrices);

server.tool("get_best_price", "Best BUY (lowest ask) + best SELL (highest bid) lintas exchange",
  { symbol: z.string() }, multiEx.getBestPrice);

server.tool("get_arbitrage", "Scan peluang arbitrase lintas exchange (default min spread 0.3%)",
  { min_spread_pct: z.number().positive().default(0.3) }, multiEx.getArbitrage);

server.tool("get_exchange_status", "Status koneksi WS Binance + Coinbase + Kraken + last update per symbol",
  {}, multiEx.getExchangeStatus);

server.tool("run_backtest_v2", "Backtest komposable: ema_cross, rsi_meanrev, bb_breakout, ema_rsi_combo",
  {
    symbol: z.string(),
    strategy: z.enum(["ema_cross", "rsi_meanrev", "bb_breakout", "ema_rsi_combo"]),
    params: z.record(z.string(), z.number()).default({}),
    days: z.number().int().min(30).max(365).default(90)
  }, backtestV2.runBacktest);

server.tool("param_sweep", "Sweep parameter strategi (cari nilai optimal by Sharpe)",
  {
    symbol: z.string(),
    strategy: z.enum(["ema_cross", "rsi_meanrev", "bb_breakout", "ema_rsi_combo"]),
    sweep_param: z.string(),
    values: z.array(z.number()),
    days: z.number().int().min(30).max(365).default(90)
  }, backtestV2.paramSweep);

server.tool("walk_forward", "Walk-forward analysis: anti-overfit dengan train/test split",
  {
    symbol: z.string(),
    strategy: z.enum(["ema_cross", "rsi_meanrev", "bb_breakout", "ema_rsi_combo"]),
    train_days: z.number().int().min(30).default(60),
    test_days: z.number().int().min(15).default(30),
    folds: z.number().int().min(2).max(10).default(3)
  }, backtestV2.walkForward);

server.tool("list_strategies", "Daftar strategi backtest v2 yang tersedia", {}, backtestV2.listStrategies);

server.tool("start_bot", "Mulai trading bot otomatis berdasarkan ML signal",
  {
    portfolio_id: z.union([z.number(), z.string()]).optional(),
    name: z.string().optional(),
    symbol: z.string(),
    strategy: z.string().default("ml_combined"),
    max_position_pct: z.number().positive().max(100).default(20),
    max_loss_count: z.number().int().min(1).default(3),
    interval_minutes: z.number().int().min(5).default(15)
  }, bot.startBot);

server.tool("stop_bot", "Hentikan bot", { id: z.number().int() }, bot.stopBot);
server.tool("list_bots", "Daftar bot",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, bot.listBots);
server.tool("bot_status", "Detail status bot + recent log", { id: z.number().int() }, bot.botStatus);
server.tool("bot_log", "Log aktivitas bot",
  { id: z.number().int(), limit: z.number().int().positive().default(30) }, bot.botLog);

server.tool("enable_news_trader", "Aktifkan news-driven trader (RSS poll + sentiment trigger)",
  {
    portfolio_id: z.number().int().default(1),
    min_bullish_score: z.number().default(0.7),
    min_bearish_score: z.number().default(-0.7),
    action_mode: z.enum(["alert", "watchlist"]).default("alert"),
    poll_interval_min: z.number().int().min(5).default(15)
  }, newsTrader.enableNewsTrader);

server.tool("disable_news_trader", "Matikan news trader", {}, newsTrader.disableNewsTrader);

server.tool("news_signals_history", "Riwayat sinyal berita yang terdeteksi",
  { coin: z.string().optional(), limit: z.number().int().positive().default(30) }, newsTrader.newsSignalsHistory);

server.tool("news_trader_status", "Status news trader + konfigurasi saat ini", {}, newsTrader.getNewsTraderStatus);

server.tool("generate_candlestick_chart", "Candlestick chart dengan auto-detect: DOJI/HAMMER/SHOOTING_STAR/BULL_ENGULFING/BEAR_ENGULFING + support/resistance + EMA + Fibonacci. Return URL image + pattern info untuk Claude analisa.",
  {
    symbol: z.string(),
    days: z.number().int().min(1).max(365).default(30),
    indicators: z.array(z.string()).optional(),
    fibonacci: z.boolean().default(false),
    patterns: z.boolean().default(true),
    support_resistance: z.boolean().default(true)
  },
  async (args) => {
    try {
      const r = await charts.generateCandlestickChart(args);
      const patternsList = r.patterns.slice(-8).map(p => `  - ${p.type} di candle ke-${p.idx}${p.bullish === true ? " 🟢" : (p.bullish === false ? " 🔴" : "")}`);
      const srList = r.sr_levels.map(l => `  - ${l.type} @ $${l.price.toFixed(2)} (touch ${l.count}x)`);
      const text =
        `📊 CHART ${args.symbol}\n${r.summary}\n\n` +
        `🕯️ POLA TERDETEKSI:\n${patternsList.length ? patternsList.join("\n") : "  (tidak ada pola signifikan)"}\n\n` +
        `📏 SUPPORT/RESISTANCE:\n${srList.length ? srList.join("\n") : "  (tidak terdeteksi)"}\n\n` +
        `🖼️ ${r.url}`;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ ${err.message}` }] };
    }
  });

server.tool("set_auto_sltp", "Set default SL/TP otomatis. Berlaku ke holding EXISTING + setiap buy berikutnya. symbol='*' = semua coin. symbol='BTC' = khusus BTC.",
  {
    portfolio_id: z.union([z.number(), z.string()]).optional(),
    symbol: z.string().optional(),
    default_sl_pct: z.number().positive().max(50).optional(),
    default_tp_pct: z.number().positive().max(200).optional(),
    apply_to_existing: z.boolean().default(true),
    replace_existing: z.boolean().default(false)
  }, autoSltp.setAutoSltp);

server.tool("apply_auto_sltp_to_holdings", "Apply config auto SL/TP ke semua holding yang udah ada (avg_buy_price sebagai basis). dry_run=true untuk preview. replace_existing=true untuk overwrite SL/TP yang udah ada.",
  {
    portfolio_id: z.union([z.number(), z.string()]).optional(),
    dry_run: z.boolean().default(false),
    replace_existing: z.boolean().default(false)
  }, autoSltp.applyAutoSltpToHoldings);

server.tool("get_auto_sltp_config", "Liat konfigurasi auto SL/TP per portfolio (wildcard + per-symbol)",
  { portfolio_id: z.union([z.number(), z.string()]).optional() }, autoSltp.getAutoSltpConfig);

server.tool("disable_auto_sltp", "Nonaktifkan auto SL/TP (tanpa hapus). symbol='*' atau kosong = wildcard.",
  { portfolio_id: z.union([z.number(), z.string()]).optional(), symbol: z.string().optional() }, autoSltp.disableAutoSltp);

server.tool("clear_auto_sltp", "Hapus auto SL/TP config sepenuhnya. symbol='*' atau kosong = wildcard.",
  { portfolio_id: z.union([z.number(), z.string()]).optional(), symbol: z.string().optional() }, autoSltp.clearAutoSltp);

server.tool("generate_portfolio_chart", "Gambar equity curve portfolio (untung/rugi visualisasi). Return URL.",
  {
    portfolio_id: z.number().int().default(1),
    days: z.number().int().min(1).max(365).default(30)
  },
  async (args) => {
    try {
      const r = await charts.generatePortfolioChart(args);
      return { content: [{ type: "text", text: `📈 PORTFOLIO CHART\n${r.summary}\n🖼️ ${r.url}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ ${err.message}` }] };
    }
  });

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Paper Trading MCP Server v5.1 running (stdio)...");
  const fs = require("fs");
  const path = require("path");
  const PID_FILE = path.join(__dirname, "..", "data", "worker.pid");
  let workerAlive = false;
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
      if (pid) { try { process.kill(pid, 0); workerAlive = true; } catch {} }
    } catch {}
  }
  if (workerAlive) {
    console.error("🔧 Worker terdeteksi running. MCP skip ticks + feeds (delegasi ke worker).");
  } else {
    console.error("⚠️  Worker tidak running. MCP handle ticks sendiri (mati saat Claude Code close).");
    try { wsFeed.start(); } catch (err) { console.error("WS feed failed to start:", err.message); }
    try { multiEx.start(); } catch (err) { console.error("Multi-exchange feed failed:", err.message); }
    try { newsTrader.ensurePoller(); } catch {}
    startTicks();
  }
})();
