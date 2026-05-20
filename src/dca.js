const { db, getActivePortfolioId, resolvePortfolioId } = require("./db");
const { fmt } = require("./format");
const { resolveCoinId } = require("./prices");
const { executeBuyInternal } = require("./execution");

async function createDca({ symbol, amount_idr, interval_minutes, portfolio_id }) {
  const { sym } = resolveCoinId(symbol);
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const next = new Date(Date.now() + interval_minutes * 60000).toISOString().slice(0, 19).replace("T", " ");
  const r = db.prepare("INSERT INTO dca_plans (portfolio_id, symbol, amount_idr, interval_minutes, next_run_at) VALUES (?, ?, ?, ?, ?)").run(pid, sym, amount_idr, interval_minutes, next);
  return { content: [{ type: "text", text: `✅ DCA #${r.lastInsertRowid}: ${sym} Rp${fmt(amount_idr)} setiap ${interval_minutes}m. Next: ${next} (portfolio #${pid})` }] };
}

async function listDca({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const rows = db.prepare("SELECT * FROM dca_plans WHERE portfolio_id=? ORDER BY id DESC").all(pid);
  if (!rows.length) return { content: [{ type: "text", text: "Tidak ada DCA plan." }] };
  const lines = rows.map((d) => `#${d.id} [${d.active ? "ACTIVE" : "OFF"}] ${d.symbol} Rp${fmt(d.amount_idr)}/${d.interval_minutes}m | next: ${d.next_run_at}`);
  return { content: [{ type: "text", text: [`📋 DCA PLANS (portfolio #${pid})`, "─".repeat(60), ...lines].join("\n") }] };
}

async function cancelDca({ id }) {
  const r = db.prepare("UPDATE dca_plans SET active=0 WHERE id = ?").run(id);
  return { content: [{ type: "text", text: r.changes ? `✅ DCA #${id} dimatikan` : `❌ Tidak ada DCA #${id}` }] };
}

function runDcaTick(prices) {
  const dcas = db.prepare("SELECT * FROM dca_plans WHERE active=1 AND next_run_at <= datetime('now')").all();
  for (const d of dcas) {
    try {
      const p = prices[d.symbol];
      if (!p) continue;
      executeBuyInternal(d.symbol, d.amount_idr, { midPrice: p.price_idr, price_usd: p.price_usd, note: `DCA plan #${d.id}`, portfolio_id: d.portfolio_id || 1 });
      const next = new Date(Date.now() + d.interval_minutes * 60000).toISOString().slice(0, 19).replace("T", " ");
      db.prepare("UPDATE dca_plans SET next_run_at=? WHERE id=?").run(next, d.id);
      console.error(`💰 DCA #${d.id} executed: ${d.symbol} Rp${fmt(d.amount_idr)}`);
      try {
        const { sendNotification } = require("./notify");
        sendNotification({
          title: `💰 DCA #${d.id} ${d.symbol}`,
          body: `Bought Rp${fmt(d.amount_idr)} ${d.symbol} (portfolio #${d.portfolio_id || 1})`,
          category: "dca_executed", priority: "low", tags: ["moneybag"]
        }).catch(() => {});
      } catch {}
    } catch (err) {
      console.error(`DCA #${d.id} error: ${err.message}`);
    }
  }
}

module.exports = { createDca, listDca, cancelDca, runDcaTick };
