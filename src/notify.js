const { db } = require("./db");

function getConfig() {
  let row = db.prepare("SELECT * FROM notification_config WHERE id=1").get();
  if (!row) {
    db.prepare("INSERT INTO notification_config (id) VALUES (1)").run();
    row = db.prepare("SELECT * FROM notification_config WHERE id=1").get();
  }
  return row;
}

function categoryEnabled(cfg, category) {
  const map = {
    order_fill: "notify_order_fill",
    sl_hit: "notify_sl_hit",
    tp_hit: "notify_tp_hit",
    liquidation: "notify_liquidation",
    watch_alert: "notify_watch_alert",
    dca_executed: "notify_dca_executed",
    copy_trade: "notify_copy_trade"
  };
  const col = map[category];
  if (!col) return true;
  return !!cfg[col];
}

async function sendNotification({ title, body, priority = "default", tags = [], category }) {
  try {
    const cfg = getConfig();
    if (!cfg.enabled || !cfg.topic) return false;
    if (category && !categoryEnabled(cfg, category)) return false;
    const headers = {
      "Title": title || "Paper Trading",
      "Priority": priority,
      "Tags": Array.isArray(tags) ? tags.join(",") : String(tags || "")
    };
    const url = `https://ntfy.sh/${cfg.topic}`;
    await fetch(url, { method: "POST", headers, body: String(body || "") });
    return true;
  } catch (err) {
    console.error("notify error:", err.message);
    return false;
  }
}

function genTopic() {
  return "paper-trading-" + Math.random().toString(36).slice(2, 10);
}

async function setupNotifications({ topic, enabled = true }) {
  const finalTopic = (topic && String(topic).trim()) || genTopic();
  const safe = finalTopic.replace(/[^a-zA-Z0-9_-]/g, "");
  db.prepare("INSERT OR REPLACE INTO notification_config (id, topic, enabled, updated_at) VALUES (1, ?, ?, datetime('now'))").run(safe, enabled ? 1 : 0);
  const text =
    `🔔 NOTIFIKASI DIPASANG\n` +
    `${"─".repeat(50)}\n` +
    `📡 Topic: ${safe}\n` +
    `🔌 Status: ${enabled ? "🟢 ENABLED" : "🔴 DISABLED"}\n` +
    `🌐 URL: https://ntfy.sh/${safe}\n\n` +
    `📲 LANGKAH PASANG DI HP:\n` +
    `1. Install ntfy app (Play Store / App Store)\n` +
    `2. Buka app → tap + (subscribe)\n` +
    `3. Masukkan topic: ${safe}\n` +
    `4. Semua alert trading otomatis push ke HP\n\n` +
    `💡 Tes: panggil test_notification untuk verifikasi`;
  return { content: [{ type: "text", text }] };
}

async function updateNotifications(args) {
  const cfg = getConfig();
  const cols = ["enabled", "notify_order_fill", "notify_sl_hit", "notify_tp_hit", "notify_liquidation", "notify_watch_alert", "notify_dca_executed", "notify_copy_trade", "min_priority"];
  const updates = [];
  const vals = [];
  for (const c of cols) {
    if (args[c] !== undefined) {
      updates.push(`${c}=?`);
      if (typeof args[c] === "boolean") vals.push(args[c] ? 1 : 0);
      else vals.push(args[c]);
    }
  }
  if (!updates.length) {
    return { content: [{ type: "text", text: "❌ Tidak ada field untuk update." }] };
  }
  vals.push(1);
  db.prepare(`UPDATE notification_config SET ${updates.join(",")}, updated_at=datetime('now') WHERE id=?`).run(...vals);
  return getNotificationConfig();
}

async function testNotification({ message }) {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.topic) {
    return { content: [{ type: "text", text: "❌ Notifikasi belum dipasang. Jalankan setup_notifications dulu." }] };
  }
  const ok = await sendNotification({
    title: "🧪 Test Paper Trading",
    body: message || "Notifikasi berfungsi! Sistem siap kirim alert trading.",
    priority: "default",
    tags: ["test", "rocket"]
  });
  return { content: [{ type: "text", text: ok ? `✅ Test terkirim ke topic '${cfg.topic}'` : "❌ Gagal kirim — cek koneksi internet." }] };
}

async function getNotificationConfig() {
  const cfg = getConfig();
  const flag = (v) => v ? "🟢" : "🔴";
  const text =
    `🔔 KONFIGURASI NOTIFIKASI\n` +
    `${"─".repeat(50)}\n` +
    `📡 Topic: ${cfg.topic || "(belum diset)"}\n` +
    `🔌 Status: ${cfg.enabled ? "🟢 ENABLED" : "🔴 DISABLED"}\n` +
    `⚡ Min priority: ${cfg.min_priority}\n\n` +
    `📋 Kategori:\n` +
    `  ${flag(cfg.notify_order_fill)} Order fill\n` +
    `  ${flag(cfg.notify_sl_hit)} Stop-loss hit\n` +
    `  ${flag(cfg.notify_tp_hit)} Take-profit hit\n` +
    `  ${flag(cfg.notify_liquidation)} Liquidation\n` +
    `  ${flag(cfg.notify_watch_alert)} Watchlist alert\n` +
    `  ${flag(cfg.notify_dca_executed)} DCA executed\n` +
    `  ${flag(cfg.notify_copy_trade)} Copy trade\n\n` +
    (cfg.topic ? `🌐 Subscribe URL: https://ntfy.sh/${cfg.topic}` : `💡 Jalankan setup_notifications untuk mulai`);
  return { content: [{ type: "text", text }] };
}

module.exports = {
  sendNotification,
  setupNotifications,
  updateNotifications,
  testNotification,
  getNotificationConfig
};
