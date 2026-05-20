const { db, audit } = require("./db");
const { normalizePhone } = require("./bookings");

function getMember(phone) {
  return db.prepare("SELECT * FROM members WHERE phone=?").get(normalizePhone(phone));
}

function listMembers({ limit = 50, sort = "bookings_count" } = {}) {
  const validSort = ["bookings_count", "total_spent_idr", "last_booking_at", "cancel_count"];
  const sortCol = validSort.includes(sort) ? sort : "bookings_count";
  return db.prepare(`SELECT * FROM members WHERE blocked=0 ORDER BY ${sortCol} DESC LIMIT ?`).all(limit);
}

function leaderboard(limit = 10) {
  return db.prepare("SELECT name, phone, bookings_count, total_spent_idr FROM members WHERE blocked=0 ORDER BY bookings_count DESC LIMIT ?").all(limit);
}

function setMember({ phone, name, nickname, notes }) {
  const normPhone = normalizePhone(phone);
  const updates = [];
  const vals = [];
  if (name !== undefined) { updates.push("name=?"); vals.push(name); }
  if (nickname !== undefined) { updates.push("nickname=?"); vals.push(nickname); }
  if (notes !== undefined) { updates.push("notes=?"); vals.push(notes); }
  if (!updates.length) return false;
  vals.push(normPhone);
  const exist = getMember(normPhone);
  if (!exist) {
    db.prepare("INSERT INTO members (phone, name, nickname, notes) VALUES (?, ?, ?, ?)").run(normPhone, name || null, nickname || null, notes || null);
  } else {
    db.prepare(`UPDATE members SET ${updates.join(",")} WHERE phone=?`).run(...vals);
  }
  audit("member_update", normPhone, JSON.stringify({ name, nickname, notes }));
  return true;
}

function blockMember(phone, blocked = true) {
  const normPhone = normalizePhone(phone);
  db.prepare("UPDATE members SET blocked=? WHERE phone=?").run(blocked ? 1 : 0, normPhone);
  audit(blocked ? "member_block" : "member_unblock", normPhone);
  return true;
}

function getBlockedMembers() {
  return db.prepare("SELECT * FROM members WHERE blocked=1 ORDER BY phone").all();
}

function getMemberHistory(phone, limit = 30) {
  const normPhone = normalizePhone(phone);
  return db.prepare("SELECT * FROM bookings WHERE contact_phone=? ORDER BY booking_date DESC, time_slot DESC LIMIT ?").all(normPhone, limit);
}

module.exports = { getMember, listMembers, leaderboard, setMember, blockMember, getBlockedMembers, getMemberHistory };
