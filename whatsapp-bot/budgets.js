const { db } = require("./storage");

const DEFAULT_DAILY_USD = parseFloat(process.env.DEFAULT_DAILY_BUDGET_USD || "0.5");
const BOSS_DAILY_USD = parseFloat(process.env.BOSS_DAILY_BUDGET_USD || "10");

function ensureBudget(userJid, isBoss = false) {
  if (!userJid) return null;
  let row = db.prepare("SELECT * FROM user_budgets WHERE user_jid=?").get(userJid);
  if (!row) {
    const limit = isBoss ? BOSS_DAILY_USD : DEFAULT_DAILY_USD;
    db.prepare("INSERT INTO user_budgets (user_jid, daily_limit_usd) VALUES (?, ?)").run(userJid, limit);
    row = db.prepare("SELECT * FROM user_budgets WHERE user_jid=?").get(userJid);
  }
  return row;
}

function resetIfNewDay(userJid) {
  const row = ensureBudget(userJid);
  if (!row) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (row.last_reset_at !== today) {
    db.prepare("UPDATE user_budgets SET used_usd_today=0, last_reset_at=? WHERE user_jid=?").run(today, userJid);
    return ensureBudget(userJid);
  }
  return row;
}

function checkBudget(userJid, isBoss = false) {
  if (!userJid) return { allowed: true };
  const row = resetIfNewDay(userJid);
  if (!row) return { allowed: true };
  if (isBoss && row.daily_limit_usd === DEFAULT_DAILY_USD) {
    db.prepare("UPDATE user_budgets SET daily_limit_usd=? WHERE user_jid=?").run(BOSS_DAILY_USD, userJid);
  }
  if (row.daily_limit_usd <= 0) return { allowed: true, unlimited: true, row };
  const remaining = row.daily_limit_usd - row.used_usd_today;
  if (remaining <= 0) {
    db.prepare("UPDATE user_budgets SET last_blocked_at=datetime('now') WHERE user_jid=?").run(userJid);
    return { allowed: false, remaining: 0, row };
  }
  return { allowed: true, remaining, row };
}

function consumeBudget(userJid, costUsd) {
  if (!userJid || !costUsd || costUsd <= 0) return;
  try {
    db.prepare("UPDATE user_budgets SET used_usd_today=used_usd_today+?, used_usd_total=used_usd_total+?, total_requests=total_requests+1 WHERE user_jid=?")
      .run(costUsd, costUsd, userJid);
  } catch (err) { console.error("consumeBudget:", err.message); }
}

function setLimit(userJid, dailyUsd) {
  ensureBudget(userJid);
  db.prepare("UPDATE user_budgets SET daily_limit_usd=? WHERE user_jid=?").run(dailyUsd, userJid);
}

function listBudgets() {
  return db.prepare("SELECT * FROM user_budgets ORDER BY used_usd_today DESC").all();
}

function getBudget(userJid) {
  return resetIfNewDay(userJid);
}

module.exports = { checkBudget, consumeBudget, setLimit, listBudgets, getBudget, ensureBudget, DEFAULT_DAILY_USD, BOSS_DAILY_USD };
