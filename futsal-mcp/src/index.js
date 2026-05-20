const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const { db } = require("./db");
const bookings = require("./bookings");
const members = require("./members");
const knowledge = require("./knowledge");
const expenses = require("./expenses");

const fmtIdr = (n) => Math.round(n || 0).toLocaleString("id-ID");

const server = new McpServer({ name: "futsal-mcp", version: "1.0.0" });

server.tool("list_fields", "Daftar lapangan futsal yang aktif", {}, async () => {
  const list = bookings.getFields();
  const lines = list.map(f => `• ${f.code} — ${f.name} (slot: ${JSON.parse(f.slots || "[]").join(", ")})`);
  return { content: [{ type: "text", text: `🏟️ LAPANGAN AKTIF\n${lines.join("\n") || "(belum ada)"}` }] };
});

server.tool("get_schedule", "Jadwal lapangan satu hari (semua slot + status)",
  { date: z.string().describe("YYYY-MM-DD atau 'hari ini'/'besok'/'lusa'") },
  async ({ date }) => {
    const normDate = bookings.normalizeDate(date);
    if (!normDate) return { content: [{ type: "text", text: `❌ Date tidak valid: ${date}` }] };
    const sched = bookings.getDaySchedule(normDate);
    const lines = sched.map(f => {
      const slotLines = f.slots.map(s => `  ${s.available ? "🟢" : "🔴"} ${s.slot} — Rp${fmtIdr(s.price)}${s.reason ? " (" + s.reason + ")" : ""}`);
      return `🏟️ *${f.field_name}* (${f.field_code})\n${slotLines.join("\n")}`;
    });
    return { content: [{ type: "text", text: `📅 ${normDate} (${bookings.dayOfDate(normDate)})\n\n${lines.join("\n\n")}` }] };
  });

server.tool("check_availability", "Cek apakah slot tertentu tersedia",
  { field_code: z.string(), date: z.string(), time_slot: z.string() },
  async ({ field_code, date, time_slot }) => {
    const normDate = bookings.normalizeDate(date);
    const av = bookings.checkAvailability(field_code, normDate, time_slot);
    const price = bookings.getPriceFor(field_code, time_slot);
    const text = av.available
      ? `✅ ${field_code} ${normDate} ${time_slot} TERSEDIA · Rp${fmtIdr(price)}`
      : `❌ ${field_code} ${normDate} ${time_slot} TIDAK TERSEDIA · ${av.reason}`;
    return { content: [{ type: "text", text }] };
  });

server.tool("create_booking", "Buat booking baru. Cek availability dulu sebelum panggil.",
  {
    field_code: z.string(),
    date: z.string(),
    time_slot: z.string(),
    team_name: z.string(),
    phone: z.string().optional(),
    name: z.string().optional(),
    price_idr: z.number().optional(),
    note: z.string().optional()
  },
  async (args) => {
    try {
      const r = bookings.createBooking(args);
      return { content: [{ type: "text", text: `✅ BOOKING #${r.id}\n${r.field_code} ${r.date} ${r.time_slot}\nTim: ${r.team_name}\nHarga: Rp${fmtIdr(r.price)}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ ${err.message}` }] };
    }
  });

server.tool("cancel_booking", "Cancel booking by id",
  { id: z.number().int(), reason: z.string().optional() },
  async ({ id, reason }) => {
    try {
      bookings.cancelBooking(id, reason);
      return { content: [{ type: "text", text: `🗑️ Booking #${id} dibatalkan${reason ? ` (${reason})` : ""}` }] };
    } catch (err) { return { content: [{ type: "text", text: `❌ ${err.message}` }] }; }
  });

server.tool("list_bookings", "Filter bookings by date/field/phone/status",
  {
    date: z.string().optional(),
    field_code: z.string().optional(),
    phone: z.string().optional(),
    status: z.enum(["confirmed", "cancelled"]).optional()
  },
  async (args) => {
    const list = bookings.listBookings(args);
    if (!list.length) return { content: [{ type: "text", text: "📭 Kosong." }] };
    const lines = list.map(b => `#${b.id} ${b.booking_date} ${b.time_slot} ${b.field_code} | *${b.team_name}* | ${b.contact_phone || "?"} | Rp${fmtIdr(b.price_idr)} ${b.status === "cancelled" ? "🗑️" : "✅"}`);
    return { content: [{ type: "text", text: `📋 BOOKINGS (${list.length}):\n\n${lines.join("\n")}` }] };
  });

server.tool("update_payment", "Update pembayaran booking",
  { id: z.number().int(), paid_idr: z.number() },
  async ({ id, paid_idr }) => {
    const ok = bookings.updatePayment(id, paid_idr);
    return { content: [{ type: "text", text: ok ? `💰 Booking #${id} paid: Rp${fmtIdr(paid_idr)}` : `❌ Gagal` }] };
  });

server.tool("set_field_status", "Tutup/buka field di tanggal tertentu",
  {
    field_code: z.string(),
    date: z.string(),
    is_closed: z.boolean(),
    closed_slots: z.array(z.string()).optional(),
    reason: z.string().optional()
  },
  async (args) => {
    bookings.setFieldClosed(args);
    return { content: [{ type: "text", text: `🔧 ${args.field_code} ${args.date}: ${args.is_closed ? "TUTUP" : "BUKA"}${args.reason ? " (" + args.reason + ")" : ""}` }] };
  });

server.tool("set_price", "Set harga slot",
  { field_code: z.string(), time_slot: z.string(), price_idr: z.number(), day_type: z.string().default("all") },
  async (args) => {
    bookings.setPrice(args);
    return { content: [{ type: "text", text: `💰 ${args.field_code} ${args.time_slot} (${args.day_type}): Rp${fmtIdr(args.price_idr)}` }] };
  });

server.tool("get_stats", "Statistik booking + revenue",
  { from_date: z.string().optional(), to_date: z.string().optional() },
  async (args) => {
    const s = bookings.getStats(args);
    const byFieldLines = (s.by_field || []).map(f => `  ${f.field_code}: ${f.c} booking, Rp${fmtIdr(f.rev)}`);
    return { content: [{ type: "text", text:
      `📊 STATS ${args.from_date || "(awal)"} - ${args.to_date || "(sekarang)"}\n` +
      `Total booking: ${s.bookings || 0}\n` +
      `Revenue: Rp${fmtIdr(s.revenue)}\n` +
      `Paid: Rp${fmtIdr(s.paid)}\n` +
      `Cancelled: ${s.cancelled || 0}\n\n` +
      `Per Lapangan:\n${byFieldLines.join("\n") || "  (none)"}`
    }] };
  });

server.tool("get_member", "Detail member by phone", { phone: z.string() }, async ({ phone }) => {
  const m = members.getMember(phone);
  if (!m) return { content: [{ type: "text", text: `❌ Member ${phone} gak ada.` }] };
  return { content: [{ type: "text", text:
    `👤 *${m.name || "?"}*${m.nickname ? ` (${m.nickname})` : ""}\n` +
    `📱 ${m.phone}\n` +
    `📋 Bookings: ${m.bookings_count} (${m.cancel_count} cancel)\n` +
    `💰 Total spent: Rp${fmtIdr(m.total_spent_idr)}\n` +
    `🕐 Last: ${m.last_booking_at || "-"}\n` +
    (m.notes ? `📝 ${m.notes}\n` : "") +
    (m.blocked ? `🚫 BLOCKED` : "")
  }] };
});

server.tool("set_member", "Update info member",
  { phone: z.string(), name: z.string().optional(), nickname: z.string().optional(), notes: z.string().optional() },
  async (args) => {
    members.setMember(args);
    return { content: [{ type: "text", text: `✅ Member ${args.phone} updated.` }] };
  });

server.tool("list_members", "Daftar member top by bookings/spent",
  { limit: z.number().int().default(20), sort: z.enum(["bookings_count","total_spent_idr","last_booking_at","cancel_count"]).default("bookings_count") },
  async (args) => {
    const list = members.listMembers(args);
    if (!list.length) return { content: [{ type: "text", text: "📭 Belum ada member." }] };
    return { content: [{ type: "text", text: `👥 TOP MEMBERS (sort: ${args.sort}):\n${list.map((m, i) => `${i + 1}. ${m.name || "?"} ${m.phone} | ${m.bookings_count}x | Rp${fmtIdr(m.total_spent_idr)}`).join("\n")}` }] };
  });

server.tool("block_member", "Block/unblock member",
  { phone: z.string(), blocked: z.boolean().default(true) },
  async ({ phone, blocked }) => {
    members.blockMember(phone, blocked);
    return { content: [{ type: "text", text: `${blocked ? "🚫" : "✅"} ${phone} ${blocked ? "blocked" : "unblocked"}` }] };
  });

server.tool("member_history", "Riwayat booking member", { phone: z.string(), limit: z.number().int().default(20) }, async ({ phone, limit }) => {
  const list = members.getMemberHistory(phone, limit);
  if (!list.length) return { content: [{ type: "text", text: "📭 Belum ada history." }] };
  return { content: [{ type: "text", text: `📋 HISTORY ${phone}:\n${list.map(b => `${b.booking_date} ${b.time_slot} ${b.field_code} | ${b.team_name} | Rp${fmtIdr(b.price_idr)} ${b.status === "cancelled" ? "🗑️" : "✅"}`).join("\n")}` }] };
});

server.tool("kb_add", "Tambah Q&A ke knowledge base",
  { category: z.string().default("general"), question: z.string(), answer: z.string(), tags: z.string().optional(), priority: z.number().int().default(1) },
  async (args) => {
    const id = knowledge.addKB(args);
    return { content: [{ type: "text", text: `✅ KB #${id} added.` }] };
  });

server.tool("kb_search", "Cari knowledge base (FTS5)",
  { query: z.string(), limit: z.number().int().default(8) },
  async ({ query, limit }) => {
    const matches = knowledge.searchKB(query, limit);
    if (!matches.length) return { content: [{ type: "text", text: `❌ "${query}" gak ada di KB.` }] };
    return { content: [{ type: "text", text: `🔎 KB MATCH "${query}":\n${matches.map((m, i) => `${i + 1}. [${m.category}] *${m.question}*\n   → ${m.answer}`).join("\n\n")}` }] };
  });

server.tool("kb_list", "List knowledge base",
  { category: z.string().optional(), limit: z.number().int().default(50) },
  async (args) => {
    const list = knowledge.listKB(args);
    if (!list.length) return { content: [{ type: "text", text: "📭 KB kosong." }] };
    return { content: [{ type: "text", text: `📚 KB (${list.length}):\n${list.map(k => `#${k.id} [${k.category}] *${k.question}*\n  → ${k.answer.slice(0, 100)}`).join("\n\n")}` }] };
  });

server.tool("kb_update", "Update entry KB",
  { id: z.number().int(), question: z.string().optional(), answer: z.string().optional(), category: z.string().optional(), tags: z.string().optional(), priority: z.number().int().optional(), active: z.boolean().optional() },
  async ({ id, ...rest }) => {
    const ok = knowledge.updateKB(id, rest);
    return { content: [{ type: "text", text: ok ? `✅ KB #${id} updated.` : `❌` }] };
  });

server.tool("kb_delete", "Hapus KB entry", { id: z.number().int() }, async ({ id }) => {
  return { content: [{ type: "text", text: knowledge.deleteKB(id) ? `🗑️ KB #${id} deleted.` : `❌` }] };
});

server.tool("expense_add", "Catat pengeluaran",
  { date: z.string().optional(), category: z.string(), amount_idr: z.number(), description: z.string().optional() },
  async (args) => {
    const id = expenses.addExpense(args);
    return { content: [{ type: "text", text: `✅ Expense #${id} Rp${fmtIdr(args.amount_idr)} (${args.category})` }] };
  });

server.tool("expense_list", "List pengeluaran",
  { from: z.string().optional(), to: z.string().optional(), category: z.string().optional(), limit: z.number().int().default(50) },
  async (args) => {
    const list = expenses.listExpenses(args);
    if (!list.length) return { content: [{ type: "text", text: "📭 Belum ada expense." }] };
    return { content: [{ type: "text", text: `💸 EXPENSES (${list.length}):\n${list.map(e => `#${e.id} ${e.date} [${e.category}] Rp${fmtIdr(e.amount_idr)} ${e.description || ""}`).join("\n")}` }] };
  });

server.tool("expense_summary", "Ringkasan pengeluaran per kategori",
  { from: z.string().optional(), to: z.string().optional() },
  async (args) => {
    const s = expenses.expenseSummary(args);
    const cats = s.by_category.map(c => `  ${c.category}: Rp${fmtIdr(c.total)} (${c.count}x)`);
    return { content: [{ type: "text", text: `💸 EXPENSE SUMMARY ${args.from || ""} - ${args.to || ""}\nTotal: Rp${fmtIdr(s.total)}\n\nPer Kategori:\n${cats.join("\n") || "  (none)"}` }] };
  });

server.tool("profit_loss", "Hitung P&L (revenue - expenses)",
  { from: z.string().optional(), to: z.string().optional() },
  async (args) => {
    const stats = bookings.getStats({ from_date: args.from, to_date: args.to });
    const exp = expenses.expenseSummary({ from: args.from, to: args.to });
    const revenue = stats.revenue || 0;
    const paid = stats.paid || 0;
    const totalExp = exp.total || 0;
    const profit = paid - totalExp;
    return { content: [{ type: "text", text:
      `💼 PROFIT & LOSS ${args.from || "(awal)"} - ${args.to || "(skrg)"}\n` +
      `Revenue (booked): Rp${fmtIdr(revenue)}\n` +
      `Paid (collected): Rp${fmtIdr(paid)}\n` +
      `Outstanding: Rp${fmtIdr(revenue - paid)}\n` +
      `Expenses: Rp${fmtIdr(totalExp)}\n` +
      `─────────\n` +
      `${profit >= 0 ? "📈" : "📉"} *Profit*: Rp${fmtIdr(profit)}`
    }] };
  });

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Futsal MCP Server v1.0 running (stdio)");
})();
