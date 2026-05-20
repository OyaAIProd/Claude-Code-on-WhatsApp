const { db, resolvePortfolioId, getActivePortfolioId } = require("./db");
const { fmt } = require("./format");
const { fetchPrice } = require("./prices");
const { executeBuyInternal, executeSellInternal, computeTotalEquity } = require("./execution");
const forecast = require("./forecast");
const { sendNotification } = require("./notify");

function log(botId, action, detail) {
  try {
    db.prepare("INSERT INTO bot_log (bot_id, action, detail) VALUES (?, ?, ?)").run(botId, action, detail);
  } catch (err) { console.error("bot log error:", err.message); }
}

async function startBot({ portfolio_id, name, symbol, strategy = "ml_combined", max_position_pct = 20, max_loss_count = 3, interval_minutes = 15 }) {
  try {
    const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
    if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
    const sym = String(symbol).toUpperCase();
    const next = new Date(Date.now() + 5000).toISOString().slice(0, 19).replace("T", " ");
    const r = db.prepare(`INSERT INTO bots (portfolio_id, name, symbol, strategy, max_position_pct, max_loss_count, interval_minutes, next_run_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`)
      .run(pid, name || `bot_${sym}_${Date.now()}`, sym, strategy, max_position_pct, max_loss_count, interval_minutes, next);
    log(r.lastInsertRowid, "CREATED", `${strategy} ${sym} on portfolio #${pid}`);
    const text =
      `🤖 BOT #${r.lastInsertRowid} STARTED\n` +
      `${"─".repeat(50)}\n` +
      `📛 Name: ${name || `bot_${sym}_${r.lastInsertRowid}`}\n` +
      `🪙 Symbol: ${sym} | Portfolio: #${pid}\n` +
      `🧠 Strategy: ${strategy}\n` +
      `🛡️ Max position: ${max_position_pct}% equity\n` +
      `⛔ Stop after: ${max_loss_count} consecutive losses\n` +
      `⏱️ Interval: ${interval_minutes} menit`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ${err.message}` }] };
  }
}

async function stopBot({ id }) {
  const r = db.prepare("UPDATE bots SET status='STOPPED' WHERE id=?").run(id);
  if (!r.changes) return { content: [{ type: "text", text: `❌ Bot #${id} tidak ada` }] };
  log(id, "STOPPED", "manual stop");
  return { content: [{ type: "text", text: `✅ Bot #${id} dihentikan` }] };
}

async function listBots({ portfolio_id }) {
  let rows;
  if (portfolio_id) {
    const pid = resolvePortfolioId(portfolio_id);
    rows = db.prepare("SELECT * FROM bots WHERE portfolio_id=? ORDER BY id").all(pid);
  } else {
    rows = db.prepare("SELECT * FROM bots ORDER BY id").all();
  }
  if (!rows.length) return { content: [{ type: "text", text: "Tidak ada bot." }] };
  const lines = rows.map(b =>
    `#${b.id} [${b.status}] ${b.name} | ${b.symbol} ${b.strategy} | maxPos ${b.max_position_pct}% | losses ${b.loss_count}/${b.max_loss_count} | next ${b.next_run_at || "n/a"}` +
    (b.last_signal ? `\n   💬 ${b.last_signal}` : "")
  );
  const text = ["🤖 BOT LIST", "─".repeat(70), ...lines].join("\n");
  return { content: [{ type: "text", text }] };
}

async function botStatus({ id }) {
  const b = db.prepare("SELECT * FROM bots WHERE id=?").get(id);
  if (!b) return { content: [{ type: "text", text: `❌ Bot #${id} tidak ada` }] };
  const recentLogs = db.prepare("SELECT * FROM bot_log WHERE bot_id=? ORDER BY id DESC LIMIT 10").all(id);
  const logLines = recentLogs.reverse().map(l => `[${l.created_at}] ${l.action}: ${l.detail}`);
  const text =
    `🤖 BOT #${b.id} STATUS\n` +
    `${"─".repeat(50)}\n` +
    `📛 ${b.name} | ${b.symbol} ${b.strategy}\n` +
    `🔌 Status: ${b.status === "ACTIVE" ? "🟢" : "🔴"} ${b.status}\n` +
    `📊 Loss count: ${b.loss_count}/${b.max_loss_count}\n` +
    `⏱️ Next run: ${b.next_run_at || "n/a"}\n` +
    `💬 Last signal: ${b.last_signal || "(belum ada)"}\n\n` +
    `📋 Recent log:\n${logLines.join("\n") || "(kosong)"}`;
  return { content: [{ type: "text", text }] };
}

async function botLog({ id, limit = 30 }) {
  const rows = db.prepare("SELECT * FROM bot_log WHERE bot_id=? ORDER BY id DESC LIMIT ?").all(id, limit);
  if (!rows.length) return { content: [{ type: "text", text: `Bot #${id} belum ada log.` }] };
  const lines = rows.reverse().map(l => `[${l.created_at}] ${l.action}: ${l.detail}`);
  return { content: [{ type: "text", text: [`📋 BOT #${id} LOG`, "─".repeat(60), ...lines].join("\n") }] };
}

async function runBotTick() {
  try {
    const due = db.prepare("SELECT * FROM bots WHERE status='ACTIVE' AND (next_run_at IS NULL OR next_run_at <= datetime('now'))").all();
    for (const b of due) {
      try {
        if (b.loss_count >= b.max_loss_count) {
          db.prepare("UPDATE bots SET status='STOPPED' WHERE id=?").run(b.id);
          log(b.id, "AUTO_STOP", `loss limit hit (${b.loss_count})`);
          sendNotification({ title: `⛔ Bot #${b.id} stopped`, body: `Max loss reached for ${b.symbol}`, category: "order_fill", priority: "high" }).catch(() => {});
          continue;
        }
        const signal = await forecast.ml_combined_signal({ symbol: b.symbol });
        const text = signal?.content?.[0]?.text || "";
        const isBuy = /CONFIDENT_BUY|^.*BUY/i.test(text) && !/SELL/i.test(text.split("\n")[0]);
        const isStrongBuy = /CONFIDENT_BUY/i.test(text);
        const isSell = /CONFIDENT_SELL|SELL/i.test(text) && !/HOLD|BUY/i.test(text.split("\n")[0]);
        let action = "HOLD";
        let detail = "";
        const p = await fetchPrice(b.symbol);
        const holding = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND symbol=?").get(b.portfolio_id, b.symbol);
        if (isBuy && (!holding || holding.amount < 0.000001)) {
          const eq = computeTotalEquity(b.portfolio_id);
          const sizeIdr = eq.total * (b.max_position_pct / 100) * (isStrongBuy ? 1 : 0.5);
          const cap = Math.min(sizeIdr, eq.cash * 0.95);
          if (cap >= 10000) {
            executeBuyInternal(b.symbol, cap, { midPrice: p.price_idr, price_usd: p.price_usd, note: `BOT #${b.id} ${b.strategy}`, portfolio_id: b.portfolio_id, strategy: b.strategy, confidence: isStrongBuy ? 9 : 7 });
            action = "BUY";
            detail = `Rp${fmt(cap)} @ Rp${fmt(p.price_idr)} (${isStrongBuy ? "strong" : "soft"})`;
          } else { detail = `cash terlalu kecil: Rp${fmt(eq.cash)}`; }
        } else if (isSell && holding && holding.amount > 0.000001) {
          const result = executeSellInternal(b.symbol, 100, { midPrice: p.price_idr, price_usd: p.price_usd, note: `BOT #${b.id} ${b.strategy}`, portfolio_id: b.portfolio_id, strategy: b.strategy });
          action = "SELL";
          detail = `${holding.amount.toFixed(6)} ${b.symbol} | PnL ${result.pnl >= 0 ? "+" : ""}Rp${fmt(result.pnl)}`;
          if (result.pnl < 0) db.prepare("UPDATE bots SET loss_count=loss_count+1 WHERE id=?").run(b.id);
          else db.prepare("UPDATE bots SET loss_count=0 WHERE id=?").run(b.id);
        } else {
          detail = "signal weak / already in expected position";
        }
        const next = new Date(Date.now() + b.interval_minutes * 60000).toISOString().slice(0, 19).replace("T", " ");
        db.prepare("UPDATE bots SET next_run_at=?, last_signal=? WHERE id=?").run(next, action + " - " + detail.slice(0, 80), b.id);
        log(b.id, action, detail);
      } catch (err) {
        console.error(`bot #${b.id} tick error:`, err.message);
        log(b.id, "ERROR", err.message.slice(0, 200));
      }
    }
  } catch (err) {
    console.error("runBotTick error:", err.message);
  }
}

module.exports = { startBot, stopBot, listBots, botStatus, botLog, runBotTick };
