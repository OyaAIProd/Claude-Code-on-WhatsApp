const { db } = require("./storage");

function parseHumanDuration(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const now = Date.now();
  let m;
  if ((m = s.match(/^(\d+)\s*(detik|second|sec|s)$/))) return now + parseInt(m[1], 10) * 1000;
  if ((m = s.match(/^(\d+)\s*(menit|minute|min|m)$/))) return now + parseInt(m[1], 10) * 60 * 1000;
  if ((m = s.match(/^(\d+)\s*(jam|hour|hr|h)$/))) return now + parseInt(m[1], 10) * 3600 * 1000;
  if ((m = s.match(/^(\d+)\s*(hari|day|d)$/))) return now + parseInt(m[1], 10) * 86400 * 1000;
  const date = new Date(s);
  if (!isNaN(date.getTime())) return date.getTime();
  return null;
}

function createReminder({ ownerJid, targetChatId, dueAt, message }) {
  const dueIso = new Date(dueAt).toISOString();
  const r = db.prepare(`INSERT INTO reminders (owner_jid, target_chat_id, due_at, message) VALUES (?, ?, ?, ?)`)
    .run(ownerJid, targetChatId, dueIso, message);
  return { id: r.lastInsertRowid, due_at: dueIso, message };
}

function listReminders(ownerJid) {
  return db.prepare(`SELECT * FROM reminders WHERE owner_jid=? AND status='pending' ORDER BY due_at`).all(ownerJid);
}

function cancelReminder(id) {
  const r = db.prepare(`UPDATE reminders SET status='cancelled' WHERE id=? AND status='pending'`).run(id);
  return r.changes > 0;
}

function getDueReminders() {
  return db.prepare(`SELECT * FROM reminders WHERE status='pending' AND due_at <= datetime('now') ORDER BY due_at LIMIT 50`).all();
}

function markReminderDone(id) {
  db.prepare(`UPDATE reminders SET status='sent' WHERE id=?`).run(id);
}

function createCron({ ownerJid, targetChatId, name, cronExpr, prompt }) {
  const r = db.prepare(`INSERT INTO cron_tasks (owner_jid, target_chat_id, name, cron_expr, prompt) VALUES (?, ?, ?, ?, ?)`)
    .run(ownerJid, targetChatId, name || `task_${Date.now()}`, cronExpr, prompt);
  computeNextRun(r.lastInsertRowid);
  return r.lastInsertRowid;
}

function listCron(ownerJid) {
  return db.prepare(`SELECT * FROM cron_tasks WHERE owner_jid=? ORDER BY id DESC`).all(ownerJid);
}

function setCronActive(id, active) {
  const r = db.prepare(`UPDATE cron_tasks SET active=? WHERE id=?`).run(active ? 1 : 0, id);
  return r.changes > 0;
}

function deleteCron(id) {
  const r = db.prepare(`DELETE FROM cron_tasks WHERE id=?`).run(id);
  return r.changes > 0;
}

function parseCronField(field, min, max) {
  if (field === "*") return null;
  if (field.includes(",")) return field.split(",").map(v => parseInt(v.trim(), 10));
  if (field.includes("/")) {
    const [base, step] = field.split("/");
    const result = [];
    const start = base === "*" ? min : parseInt(base, 10);
    for (let v = start; v <= max; v += parseInt(step, 10)) result.push(v);
    return result;
  }
  if (field.includes("-")) {
    const [a, b] = field.split("-").map(v => parseInt(v.trim(), 10));
    const r = [];
    for (let v = a; v <= b; v++) r.push(v);
    return r;
  }
  return [parseInt(field, 10)];
}

function cronMatches(cronExpr, date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hr, dom, mon, dow] = parts;
  const minMatch = parseCronField(min, 0, 59);
  const hrMatch = parseCronField(hr, 0, 23);
  const domMatch = parseCronField(dom, 1, 31);
  const monMatch = parseCronField(mon, 1, 12);
  const dowMatch = parseCronField(dow, 0, 6);
  if (minMatch && !minMatch.includes(date.getMinutes())) return false;
  if (hrMatch && !hrMatch.includes(date.getHours())) return false;
  if (domMatch && !domMatch.includes(date.getDate())) return false;
  if (monMatch && !monMatch.includes(date.getMonth() + 1)) return false;
  if (dowMatch && !dowMatch.includes(date.getDay())) return false;
  return true;
}

function computeNextRun(id) {
  const task = db.prepare(`SELECT * FROM cron_tasks WHERE id=?`).get(id);
  if (!task) return;
  const now = new Date();
  for (let i = 1; i <= 60 * 24 * 32; i++) {
    const t = new Date(now.getTime() + i * 60 * 1000);
    t.setSeconds(0); t.setMilliseconds(0);
    if (cronMatches(task.cron_expr, t)) {
      db.prepare(`UPDATE cron_tasks SET next_run=? WHERE id=?`).run(t.toISOString(), id);
      return t;
    }
  }
}

function getDueCronTasks() {
  return db.prepare(`SELECT * FROM cron_tasks WHERE active=1 AND (next_run IS NOT NULL AND next_run <= datetime('now'))`).all();
}

function markCronRan(id) {
  db.prepare(`UPDATE cron_tasks SET last_run=datetime('now') WHERE id=?`).run(id);
  computeNextRun(id);
}

function startScheduler({ onReminderDue, onCronDue }) {
  const tick = async () => {
    try {
      const dueRem = getDueReminders();
      for (const r of dueRem) {
        try { await onReminderDue(r); markReminderDone(r.id); } catch (err) { console.error("reminder fire:", err.message); }
      }
      const dueCron = getDueCronTasks();
      for (const c of dueCron) {
        try { await onCronDue(c); markCronRan(c.id); } catch (err) { console.error("cron fire:", err.message); }
      }
    } catch (err) { console.error("scheduler tick:", err.message); }
  };
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 60 * 1000);
  for (const c of db.prepare(`SELECT id FROM cron_tasks WHERE active=1 AND (next_run IS NULL)`).all()) computeNextRun(c.id);
  console.log(`✅ Scheduler started (reminders + cron)`);
}

module.exports = {
  parseHumanDuration,
  createReminder, listReminders, cancelReminder, getDueReminders, markReminderDone,
  createCron, listCron, setCronActive, deleteCron, computeNextRun, getDueCronTasks, markCronRan,
  cronMatches, startScheduler
};
