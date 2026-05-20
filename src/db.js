const Database = require("better-sqlite3");
const fs = require("fs");
const { DB_DIR, DB_PATH, STARTING_BALANCE } = require("./config");

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY,
    cash_idr REAL DEFAULT ${STARTING_BALANCE},
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS holdings (
    symbol TEXT PRIMARY KEY,
    amount REAL DEFAULT 0,
    avg_buy_price REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    side TEXT,
    amount REAL,
    price_usd REAL,
    price_idr REAL,
    total_idr REAL,
    fee_idr REAL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS price_cache (
    symbol TEXT PRIMARY KEY,
    price_usd REAL,
    price_idr REAL,
    change_24h REAL,
    volume_24h REAL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pending_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    symbol TEXT,
    trigger_price_idr REAL,
    amount_idr REAL,
    percent REAL,
    status TEXT DEFAULT 'OPEN',
    parent_holding_symbol TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    filled_at TEXT
  );
  CREATE TABLE IF NOT EXISTS equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT (datetime('now')),
    cash_idr REAL,
    hold_value_idr REAL,
    total_idr REAL
  );
  CREATE TABLE IF NOT EXISTS dca_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    amount_idr REAL,
    interval_minutes INTEGER,
    next_run_at TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    price_above REAL,
    price_below REAL,
    triggered INTEGER DEFAULT 0,
    triggered_at TEXT,
    triggered_reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    side TEXT,
    entry_price_idr REAL,
    qty REAL,
    leverage REAL,
    margin_idr REAL,
    liq_price_idr REAL,
    status TEXT DEFAULT 'OPEN',
    pnl_idr REAL DEFAULT 0,
    funding_paid_idr REAL DEFAULT 0,
    last_funding_at TEXT DEFAULT (datetime('now')),
    opened_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    cash_idr REAL,
    starting_balance REAL DEFAULT ${STARTING_BALANCE},
    description TEXT,
    active INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS news_sentiment_cache (
    url TEXT PRIMARY KEY,
    sentiment TEXT,
    score REAL,
    reason TEXT,
    analyzed_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ml_cache (
    symbol TEXT,
    kind TEXT,
    json_payload TEXT,
    computed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, kind)
  );
  CREATE TABLE IF NOT EXISTS copy_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_portfolio_id INTEGER,
    target_portfolio_id INTEGER,
    size_multiplier REAL DEFAULT 1.0,
    follow_buy INTEGER DEFAULT 1,
    follow_sell INTEGER DEFAULT 1,
    min_confidence INTEGER DEFAULT 0,
    max_position_pct REAL DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now')),
    active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS notification_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    topic TEXT,
    enabled INTEGER DEFAULT 0,
    notify_order_fill INTEGER DEFAULT 1,
    notify_sl_hit INTEGER DEFAULT 1,
    notify_tp_hit INTEGER DEFAULT 1,
    notify_liquidation INTEGER DEFAULT 1,
    notify_watch_alert INTEGER DEFAULT 1,
    notify_dca_executed INTEGER DEFAULT 0,
    notify_copy_trade INTEGER DEFAULT 0,
    min_priority TEXT DEFAULT 'normal',
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS exchange_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    exchange TEXT,
    bid_usd REAL,
    ask_usd REAL,
    last_usd REAL,
    ts TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_exchange_prices_sym_ts ON exchange_prices(symbol, ts);
  CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER,
    name TEXT,
    symbol TEXT,
    strategy TEXT,
    config_json TEXT,
    max_position_pct REAL DEFAULT 20,
    max_loss_count INTEGER DEFAULT 3,
    loss_count INTEGER DEFAULT 0,
    interval_minutes INTEGER DEFAULT 15,
    next_run_at TEXT,
    last_signal TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS bot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER,
    action TEXT,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS news_trader_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    enabled INTEGER DEFAULT 0,
    portfolio_id INTEGER DEFAULT 1,
    min_bullish_score REAL DEFAULT 0.7,
    min_bearish_score REAL DEFAULT -0.7,
    action_mode TEXT DEFAULT 'alert',
    poll_interval_min INTEGER DEFAULT 15,
    last_poll_at TEXT
  );
  CREATE TABLE IF NOT EXISTS news_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin TEXT,
    score REAL,
    sentiment TEXT,
    headline TEXT,
    url TEXT,
    action_taken TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS auto_sltp_config (
    portfolio_id INTEGER,
    symbol TEXT DEFAULT '*',
    default_sl_pct REAL,
    default_tp_pct REAL,
    enabled INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (portfolio_id, symbol)
  );
  CREATE TABLE IF NOT EXISTS backtest_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    strategy TEXT,
    params_json TEXT,
    days INTEGER,
    final_equity REAL,
    return_pct REAL,
    win_rate REAL,
    max_dd REAL,
    sharpe REAL,
    trades_count INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

for (const col of [
  "risk_idr REAL",
  "r_multiple REAL",
  "strategy TEXT",
  "setup TEXT",
  "confidence INTEGER",
  "slippage_idr REAL",
  "spread_idr REAL",
  "fee_tier TEXT"
]) {
  try { db.exec(`ALTER TABLE trades ADD COLUMN ${col}`); } catch {}
}

for (const tbl of ["holdings", "trades", "pending_orders", "dca_plans", "watchlist", "positions", "equity_snapshots"]) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN portfolio_id INTEGER DEFAULT 1`); } catch {}
}

const seedRow = db.prepare("SELECT id FROM portfolio LIMIT 1").get();
if (!seedRow) {
  db.prepare("INSERT INTO portfolio (cash_idr) VALUES (?)").run(STARTING_BALANCE);
}

const seedPort = db.prepare("SELECT id FROM portfolios LIMIT 1").get();
if (!seedPort) {
  const cur = db.prepare("SELECT cash_idr FROM portfolio LIMIT 1").get();
  db.prepare("INSERT INTO portfolios (id, name, cash_idr, starting_balance, description, active) VALUES (1, 'main', ?, ?, 'Default portfolio', 1)").run(cur?.cash_idr ?? STARTING_BALANCE, STARTING_BALANCE);
}

function getActivePortfolioId() {
  const r = db.prepare("SELECT id FROM portfolios WHERE active=1 LIMIT 1").get();
  if (r) return r.id;
  const any = db.prepare("SELECT id FROM portfolios ORDER BY id ASC LIMIT 1").get();
  if (any) {
    db.prepare("UPDATE portfolios SET active=1 WHERE id=?").run(any.id);
    return any.id;
  }
  return 1;
}

function resolvePortfolioId(idOrName) {
  if (idOrName === undefined || idOrName === null || idOrName === "") return getActivePortfolioId();
  if (typeof idOrName === "number") {
    const r = db.prepare("SELECT id FROM portfolios WHERE id=?").get(idOrName);
    return r ? r.id : null;
  }
  const s = String(idOrName);
  if (/^\d+$/.test(s)) {
    const r = db.prepare("SELECT id FROM portfolios WHERE id=?").get(Number(s));
    if (r) return r.id;
  }
  const byName = db.prepare("SELECT id FROM portfolios WHERE name=?").get(s);
  return byName ? byName.id : null;
}

function getPortfolio(portfolio_id) {
  const pid = portfolio_id || getActivePortfolioId();
  const p = db.prepare("SELECT * FROM portfolios WHERE id=?").get(pid);
  if (p) {
    return { id: p.id, name: p.name, cash_idr: p.cash_idr, starting_balance: p.starting_balance, updated_at: p.created_at };
  }
  const legacy = db.prepare("SELECT * FROM portfolio LIMIT 1").get();
  return { id: 1, name: "main", cash_idr: legacy?.cash_idr ?? STARTING_BALANCE, starting_balance: STARTING_BALANCE };
}

function updatePortfolioCash(portfolio_id, delta) {
  const pid = portfolio_id || getActivePortfolioId();
  db.prepare("UPDATE portfolios SET cash_idr = cash_idr + ? WHERE id=?").run(delta, pid);
  if (pid === 1) {
    db.prepare("UPDATE portfolio SET cash_idr = cash_idr + ?, updated_at=datetime('now')").run(delta);
  }
}

function setPortfolioCash(portfolio_id, value) {
  const pid = portfolio_id || getActivePortfolioId();
  db.prepare("UPDATE portfolios SET cash_idr = ? WHERE id=?").run(value, pid);
  if (pid === 1) {
    db.prepare("UPDATE portfolio SET cash_idr = ?, updated_at=datetime('now')").run(value);
  }
}

module.exports = { db, getActivePortfolioId, resolvePortfolioId, getPortfolio, updatePortfolioCash, setPortfolioCash };
