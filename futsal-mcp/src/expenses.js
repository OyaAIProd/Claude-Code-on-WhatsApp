const { db, audit } = require("./db");
const { normalizeDate } = require("./bookings");

function addExpense({ date, category, amount_idr, description }) {
  const normDate = normalizeDate(date) || new Date().toISOString().slice(0, 10);
  const r = db.prepare("INSERT INTO expenses (date, category, amount_idr, description) VALUES (?, ?, ?, ?)").run(normDate, category, amount_idr, description || null);
  audit("expense_add", `#${r.lastInsertRowid}`, `${category} Rp${amount_idr}`);
  return r.lastInsertRowid;
}

function listExpenses({ from, to, category, limit = 100 } = {}) {
  const where = [], params = [];
  if (from) { where.push("date >= ?"); params.push(from); }
  if (to) { where.push("date <= ?"); params.push(to); }
  if (category) { where.push("category = ?"); params.push(category); }
  const sql = `SELECT * FROM expenses ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date DESC, id DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function deleteExpense(id) {
  const r = db.prepare("DELETE FROM expenses WHERE id=?").run(id);
  audit("expense_delete", `#${id}`);
  return r.changes > 0;
}

function expenseSummary({ from, to } = {}) {
  const where = [], params = [];
  if (from) { where.push("date >= ?"); params.push(from); }
  if (to) { where.push("date <= ?"); params.push(to); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db.prepare(`SELECT SUM(amount_idr) AS total FROM expenses ${whereSql}`).get(...params);
  const byCat = db.prepare(`SELECT category, SUM(amount_idr) AS total, COUNT(*) AS count FROM expenses ${whereSql} GROUP BY category ORDER BY total DESC`).all(...params);
  return { total: total?.total || 0, by_category: byCat };
}

module.exports = { addExpense, listExpenses, deleteExpense, expenseSummary };
