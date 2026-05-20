const fs = require("fs");
const path = require("path");
const { db } = require("./storage");

const CAL_DIR = path.join(__dirname, "data", "calendar");
fs.mkdirSync(CAL_DIR, { recursive: true });

function createEvent({ ownerJid, chatId, title, description, startAt, endAt, location, attendees, sourceMsgId }) {
  const start = new Date(startAt);
  if (isNaN(start.getTime())) throw new Error("startAt invalid");
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + 3600 * 1000);
  const r = db.prepare(`INSERT INTO events (owner_jid, chat_id, title, description, start_at, end_at, location, attendees, source_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(ownerJid || null, chatId || null, title.slice(0, 200), description || null, start.toISOString(), end.toISOString(), location || null, attendees ? JSON.stringify(attendees) : null, sourceMsgId || null);
  return { id: r.lastInsertRowid, start: start.toISOString(), end: end.toISOString(), title };
}

function listEvents({ ownerJid, chatId, fromDate, limit = 30 } = {}) {
  const where = [], params = [];
  if (ownerJid) { where.push("owner_jid=?"); params.push(ownerJid); }
  if (chatId) { where.push("chat_id=?"); params.push(chatId); }
  if (fromDate) { where.push("start_at >= ?"); params.push(fromDate); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  params.push(limit);
  return db.prepare(`SELECT * FROM events ${whereSql} ORDER BY start_at ASC LIMIT ?`).all(...params);
}

function getEvent(id) {
  return db.prepare(`SELECT * FROM events WHERE id=?`).get(id);
}

function deleteEvent(id) {
  const r = db.prepare(`DELETE FROM events WHERE id=?`).run(id);
  return r.changes > 0;
}

function icsEscape(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function formatIcsDate(iso) {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function buildIcs(events) {
  const list = Array.isArray(events) ? events : [events];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ClaudeWA//Calendar 1.0//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of list) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:claudewa-${e.id}@whatsapp-bot`);
    lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString())}`);
    lines.push(`DTSTART:${formatIcsDate(e.start_at)}`);
    lines.push(`DTEND:${formatIcsDate(e.end_at || e.start_at)}`);
    lines.push(`SUMMARY:${icsEscape(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.attendees) {
      try {
        const arr = JSON.parse(e.attendees);
        for (const a of arr) lines.push(`ATTENDEE;CN=${icsEscape(a)}:MAILTO:${a.replace(/\s/g, "")}@whatsapp.local`);
      } catch {}
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function exportIcsToFile(events) {
  const ics = buildIcs(events);
  const filename = `events_${Date.now()}.ics`;
  const filePath = path.join(CAL_DIR, filename);
  fs.writeFileSync(filePath, ics);
  return { path: filePath, filename, ics };
}

function parseHumanDateTime(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const now = new Date();
  let m;
  if ((m = s.match(/^besok\s+(\d{1,2})[:.](\d{2})/))) {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0); return d;
  }
  if ((m = s.match(/^lusa\s+(\d{1,2})[:.](\d{2})/))) {
    const d = new Date(now); d.setDate(d.getDate() + 2); d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0); return d;
  }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2})[:.](\d{2})/))) {
    return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = { createEvent, listEvents, getEvent, deleteEvent, buildIcs, exportIcsToFile, parseHumanDateTime };
