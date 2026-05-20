const { db, audit } = require("./db");

const DAYS = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

function dayOfDate(dateStr) {
  const d = new Date(dateStr);
  return DAYS[d.getDay()];
}

function normalizeDate(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  const today = new Date();
  if (s === "hari ini" || s === "today") return today.toISOString().slice(0, 10);
  if (s === "besok" || s === "tomorrow") { const d = new Date(today); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  if (s === "lusa") { const d = new Date(today); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); }
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return "0" + digits.slice(2);
  if (digits.startsWith("0")) return digits;
  return digits;
}

function getFields() {
  return db.prepare("SELECT * FROM fields WHERE active=1 ORDER BY code").all();
}

function getFieldSlots(fieldCode) {
  const f = db.prepare("SELECT slots FROM fields WHERE code=?").get(fieldCode);
  try { return JSON.parse(f?.slots || "[]"); } catch { return []; }
}

function getPriceFor(fieldCode, timeSlot, dayType = "all") {
  const exact = db.prepare("SELECT price_idr FROM prices WHERE field_code=? AND time_slot=? AND day_type=?").get(fieldCode, timeSlot, dayType);
  if (exact) return exact.price_idr;
  const fallback = db.prepare("SELECT price_idr FROM prices WHERE field_code=? AND time_slot=? AND day_type='all'").get(fieldCode, timeSlot);
  return fallback?.price_idr || 0;
}

function listBookings({ date, field_code, phone, status }) {
  const where = [], params = [];
  if (date) { where.push("booking_date=?"); params.push(date); }
  if (field_code) { where.push("field_code=?"); params.push(field_code); }
  if (phone) { where.push("contact_phone=?"); params.push(normalizePhone(phone)); }
  if (status) { where.push("status=?"); params.push(status); }
  else { where.push("status != 'cancelled'"); }
  const sql = `SELECT * FROM bookings ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY booking_date, time_slot`;
  return db.prepare(sql).all(...params);
}

function checkAvailability(fieldCode, date, timeSlot) {
  const closed = db.prepare("SELECT is_closed, closed_slots FROM field_status WHERE field_code=? AND status_date=?").get(fieldCode, date);
  if (closed?.is_closed) return { available: false, reason: "field closed" };
  if (closed?.closed_slots) {
    try {
      const cs = JSON.parse(closed.closed_slots);
      if (cs.includes(timeSlot)) return { available: false, reason: "slot closed" };
    } catch {}
  }
  const exist = db.prepare("SELECT id, team_name FROM bookings WHERE field_code=? AND booking_date=? AND time_slot=? AND status != 'cancelled'").get(fieldCode, date, timeSlot);
  if (exist) return { available: false, reason: `booked by ${exist.team_name}`, booking_id: exist.id };
  return { available: true };
}

function getDaySchedule(date) {
  const fields = getFields();
  const result = [];
  for (const f of fields) {
    const slots = getFieldSlots(f.code);
    const dayRows = [];
    for (const slot of slots) {
      const av = checkAvailability(f.code, date, slot);
      const price = getPriceFor(f.code, slot, "all");
      dayRows.push({ slot, available: av.available, reason: av.reason || null, price, booking_id: av.booking_id || null });
    }
    result.push({ field_code: f.code, field_name: f.name, slots: dayRows });
  }
  return result;
}

function createBooking({ field_code, date, time_slot, team_name, phone, name, price_idr, note }) {
  const normDate = normalizeDate(date);
  if (!normDate) throw new Error("Date tidak valid");
  const av = checkAvailability(field_code, normDate, time_slot);
  if (!av.available) throw new Error(`Slot tidak tersedia: ${av.reason}`);
  const finalPrice = price_idr ?? getPriceFor(field_code, time_slot, "all");
  const normPhone = normalizePhone(phone);
  const r = db.prepare(`INSERT INTO bookings (field_code, booking_date, time_slot, team_name, contact_phone, contact_name, price_idr, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(field_code, normDate, time_slot, team_name, normPhone || null, name || null, finalPrice, note || null);
  if (normPhone) {
    db.prepare(`INSERT INTO members (phone, name, bookings_count, total_spent_idr, last_booking_at) VALUES (?, ?, 1, ?, datetime('now'))
      ON CONFLICT(phone) DO UPDATE SET bookings_count=bookings_count+1, total_spent_idr=total_spent_idr+excluded.total_spent_idr, last_booking_at=excluded.last_booking_at, name=COALESCE(excluded.name, name)`)
      .run(normPhone, name || null, finalPrice);
  }
  audit("booking_create", `#${r.lastInsertRowid}`, `${field_code} ${normDate} ${time_slot} ${team_name}`);
  return { id: r.lastInsertRowid, date: normDate, time_slot, field_code, team_name, price: finalPrice };
}

function cancelBooking(id, reason = null) {
  const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(id);
  if (!b) throw new Error("Booking tidak ditemukan");
  if (b.status === "cancelled") throw new Error("Sudah cancelled");
  db.prepare("UPDATE bookings SET status='cancelled', cancelled_at=datetime('now'), note=COALESCE(note,'')||?  WHERE id=?")
    .run(reason ? ` | CANCEL: ${reason}` : " | cancelled", id);
  if (b.contact_phone) {
    db.prepare("UPDATE members SET cancel_count=cancel_count+1 WHERE phone=?").run(b.contact_phone);
  }
  audit("booking_cancel", `#${id}`, reason || "");
  return { id, cancelled: true };
}

function updatePayment(id, paid_idr) {
  const r = db.prepare("UPDATE bookings SET paid_idr=? WHERE id=?").run(paid_idr, id);
  audit("booking_payment", `#${id}`, `paid=${paid_idr}`);
  return r.changes > 0;
}

function setFieldClosed({ field_code, date, is_closed, closed_slots, reason }) {
  const normDate = normalizeDate(date);
  if (!normDate) throw new Error("Date tidak valid");
  db.prepare(`INSERT INTO field_status (field_code, status_date, is_closed, closed_slots, reason) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(field_code, status_date) DO UPDATE SET is_closed=excluded.is_closed, closed_slots=excluded.closed_slots, reason=excluded.reason`)
    .run(field_code, normDate, is_closed ? 1 : 0, JSON.stringify(closed_slots || []), reason || null);
  audit("field_status", `${field_code}/${normDate}`, is_closed ? "closed" : "open");
  return true;
}

function setPrice({ field_code, time_slot, day_type, price_idr }) {
  db.prepare(`INSERT INTO prices (field_code, time_slot, day_type, price_idr, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(field_code, time_slot, day_type) DO UPDATE SET price_idr=excluded.price_idr, updated_at=datetime('now')`)
    .run(field_code, time_slot, day_type || "all", price_idr);
  audit("price_set", `${field_code}/${time_slot}/${day_type || "all"}`, `Rp${price_idr}`);
  return true;
}

function getStats({ from_date, to_date } = {}) {
  const where = [], params = [];
  if (from_date) { where.push("booking_date >= ?"); params.push(from_date); }
  if (to_date) { where.push("booking_date <= ?"); params.push(to_date); }
  where.push("status != 'cancelled'");
  const sql = `SELECT COUNT(*) AS bookings, SUM(price_idr) AS revenue, SUM(paid_idr) AS paid FROM bookings WHERE ${where.join(" AND ")}`;
  const row = db.prepare(sql).get(...params);
  const byField = db.prepare(`SELECT field_code, COUNT(*) AS c, SUM(price_idr) AS rev FROM bookings WHERE ${where.join(" AND ")} GROUP BY field_code`).all(...params);
  const cancelled = db.prepare(`SELECT COUNT(*) AS c FROM bookings WHERE status='cancelled' ${from_date ? "AND booking_date >= ?" : ""} ${to_date ? "AND booking_date <= ?" : ""}`).get(...[from_date, to_date].filter(Boolean));
  return { ...row, by_field: byField, cancelled: cancelled.c };
}

module.exports = {
  normalizeDate, normalizePhone, dayOfDate,
  getFields, getFieldSlots, getPriceFor,
  listBookings, checkAvailability, getDaySchedule,
  createBooking, cancelBooking, updatePayment,
  setFieldClosed, setPrice, getStats
};
