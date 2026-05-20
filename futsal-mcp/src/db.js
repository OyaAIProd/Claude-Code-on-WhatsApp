const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "futsal.db");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS fields (
    code TEXT PRIMARY KEY,
    name TEXT,
    type TEXT DEFAULT 'futsal',
    slots TEXT,
    active INTEGER DEFAULT 1,
    address TEXT,
    maps_url TEXT,
    photo_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS prices (
    field_code TEXT,
    time_slot TEXT,
    price_idr REAL,
    day_type TEXT DEFAULT 'all',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (field_code, time_slot, day_type)
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_code TEXT,
    booking_date TEXT,
    time_slot TEXT,
    team_name TEXT,
    contact_phone TEXT,
    contact_name TEXT,
    price_idr REAL,
    paid_idr REAL DEFAULT 0,
    status TEXT DEFAULT 'confirmed',
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    cancelled_at TEXT,
    UNIQUE(field_code, booking_date, time_slot)
  );
  CREATE INDEX IF NOT EXISTS idx_bk_date ON bookings(booking_date);
  CREATE INDEX IF NOT EXISTS idx_bk_phone ON bookings(contact_phone);
  CREATE TABLE IF NOT EXISTS members (
    phone TEXT PRIMARY KEY,
    name TEXT,
    nickname TEXT,
    bookings_count INTEGER DEFAULT 0,
    cancel_count INTEGER DEFAULT 0,
    total_spent_idr REAL DEFAULT 0,
    last_booking_at TEXT,
    notes TEXT,
    blocked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS field_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_code TEXT,
    status_date TEXT,
    is_closed INTEGER DEFAULT 0,
    reason TEXT,
    closed_slots TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(field_code, status_date)
  );
  CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    question TEXT,
    answer TEXT,
    tags TEXT,
    priority INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(question, answer, tags, content='knowledge_base', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER IF NOT EXISTS kb_ai AFTER INSERT ON knowledge_base BEGIN
    INSERT INTO kb_fts(rowid, question, answer, tags) VALUES (new.id, COALESCE(new.question,''), COALESCE(new.answer,''), COALESCE(new.tags,''));
  END;
  CREATE TRIGGER IF NOT EXISTS kb_ad AFTER DELETE ON knowledge_base BEGIN
    INSERT INTO kb_fts(kb_fts, rowid, question, answer, tags) VALUES('delete', old.id, COALESCE(old.question,''), COALESCE(old.answer,''), COALESCE(old.tags,''));
  END;
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    category TEXT,
    amount_idr REAL,
    description TEXT,
    receipt_path TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(date);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT, target TEXT, detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const seed = db.prepare("SELECT COUNT(*) AS c FROM fields").get();
if (seed.c === 0) {
  db.prepare("INSERT INTO fields (code, name, slots) VALUES (?, ?, ?)").run("lp1", "Lapangan 1 (Sintetis)", JSON.stringify(["15.00","16.00","19.00","20.00"]));
  db.prepare("INSERT INTO fields (code, name, slots) VALUES (?, ?, ?)").run("lp2", "Lapangan 2 (Vinyl)", JSON.stringify(["15.00","16.00","17.00","18.00","19.00","20.00","21.00","22.00"]));
  db.prepare("INSERT INTO fields (code, name, slots) VALUES (?, ?, ?)").run("lp3", "Lapangan 3 (Vinyl)", JSON.stringify(["15.00","16.00","17.00","18.00","19.00","20.00","21.00","22.00"]));
}

function getCfg(key, fallback = null) {
  const r = db.prepare("SELECT value FROM config WHERE key=?").get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
function setCfg(key, value) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, v);
}

function audit(action, target, detail) {
  try { db.prepare("INSERT INTO audit_log (action, target, detail) VALUES (?, ?, ?)").run(action, target || null, detail || null); } catch {}
}

module.exports = { db, getCfg, setCfg, audit, DATA_DIR, DB_PATH };
