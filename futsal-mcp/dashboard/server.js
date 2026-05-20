const express = require("express");
const path = require("path");
const { db } = require("../src/db");
const bookings = require("../src/bookings");
const members = require("../src/members");
const knowledge = require("../src/knowledge");
const expenses = require("../src/expenses");

const app = express();
const PORT = parseInt(process.env.FUTSAL_DASH_PORT || "3457", 10);

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const BASIC_USER = process.env.FUTSAL_DASH_USER || "admin";
const BASIC_PASS = process.env.FUTSAL_DASH_PASS || "admin";

function basicAuth(req, res, next) {
  if (!BASIC_PASS || BASIC_PASS === "admin") return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Futsal Dashboard"');
    return res.status(401).send("Auth required");
  }
  const [u, p] = Buffer.from(auth.slice(6), "base64").toString().split(":");
  if (u !== BASIC_USER || p !== BASIC_PASS) {
    res.set("WWW-Authenticate", 'Basic realm="Futsal Dashboard"');
    return res.status(401).send("Bad credentials");
  }
  next();
}

app.use(basicAuth);

app.get("/api/fields", (req, res) => res.json(bookings.getFields()));

app.get("/api/schedule", (req, res) => {
  const date = bookings.normalizeDate(req.query.date) || new Date().toISOString().slice(0, 10);
  res.json({ date, day: bookings.dayOfDate(date), schedule: bookings.getDaySchedule(date) });
});

app.get("/api/bookings", (req, res) => res.json(bookings.listBookings(req.query)));
app.post("/api/booking", (req, res) => {
  try { res.json(bookings.createBooking(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete("/api/booking/:id", (req, res) => {
  try { res.json(bookings.cancelBooking(parseInt(req.params.id, 10), req.query.reason)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.post("/api/booking/:id/payment", (req, res) => {
  res.json({ ok: bookings.updatePayment(parseInt(req.params.id, 10), req.body.paid_idr) });
});

app.post("/api/field-status", (req, res) => {
  bookings.setFieldClosed(req.body);
  res.json({ ok: true });
});

app.post("/api/price", (req, res) => {
  bookings.setPrice(req.body);
  res.json({ ok: true });
});
app.get("/api/prices", (req, res) => {
  res.json(db.prepare("SELECT * FROM prices ORDER BY field_code, time_slot").all());
});

app.get("/api/stats", (req, res) => res.json(bookings.getStats(req.query)));
app.get("/api/profit-loss", (req, res) => {
  const stats = bookings.getStats({ from_date: req.query.from, to_date: req.query.to });
  const exp = expenses.expenseSummary({ from: req.query.from, to: req.query.to });
  res.json({ revenue: stats.revenue || 0, paid: stats.paid || 0, expenses: exp.total || 0, profit: (stats.paid || 0) - (exp.total || 0), by_field: stats.by_field, by_category: exp.by_category });
});

app.get("/api/members", (req, res) => res.json(members.listMembers(req.query)));
app.get("/api/member/:phone", (req, res) => {
  const m = members.getMember(req.params.phone);
  if (!m) return res.status(404).json({ error: "not found" });
  res.json({ ...m, history: members.getMemberHistory(req.params.phone, 30) });
});
app.put("/api/member/:phone", (req, res) => {
  members.setMember({ phone: req.params.phone, ...req.body });
  res.json({ ok: true });
});
app.post("/api/member/:phone/block", (req, res) => {
  members.blockMember(req.params.phone, req.body.blocked !== false);
  res.json({ ok: true });
});

app.get("/api/kb", (req, res) => {
  if (req.query.q) return res.json(knowledge.searchKB(req.query.q, parseInt(req.query.limit, 10) || 20));
  res.json(knowledge.listKB(req.query));
});
app.post("/api/kb", (req, res) => res.json({ id: knowledge.addKB(req.body) }));
app.put("/api/kb/:id", (req, res) => res.json({ ok: knowledge.updateKB(parseInt(req.params.id, 10), req.body) }));
app.delete("/api/kb/:id", (req, res) => res.json({ ok: knowledge.deleteKB(parseInt(req.params.id, 10)) }));

app.get("/api/expenses", (req, res) => res.json(expenses.listExpenses(req.query)));
app.post("/api/expense", (req, res) => res.json({ id: expenses.addExpense(req.body) }));
app.delete("/api/expense/:id", (req, res) => res.json({ ok: expenses.deleteExpense(parseInt(req.params.id, 10)) }));
app.get("/api/expense-summary", (req, res) => res.json(expenses.expenseSummary(req.query)));

app.get("/api/audit", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit));
});

app.get("/api/health", (req, res) => {
  const r = {
    bookings: db.prepare("SELECT COUNT(*) AS c FROM bookings").get().c,
    members: db.prepare("SELECT COUNT(*) AS c FROM members").get().c,
    kb: db.prepare("SELECT COUNT(*) AS c FROM knowledge_base").get().c,
    expenses: db.prepare("SELECT COUNT(*) AS c FROM expenses").get().c,
    uptime_h: (process.uptime() / 3600).toFixed(2),
    mem_mb: (process.memoryUsage().rss / 1024 / 1024).toFixed(1)
  };
  res.json(r);
});

app.listen(PORT, () => {
  console.error(`✅ Futsal Dashboard: http://localhost:${PORT}`);
  console.error(`   Auth: ${BASIC_PASS && BASIC_PASS !== "admin" ? "🔐 enabled" : "🔓 disabled (set FUTSAL_DASH_PASS)"}`);
});
