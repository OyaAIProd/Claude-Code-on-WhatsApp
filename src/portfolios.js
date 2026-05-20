const { db, getActivePortfolioId, resolvePortfolioId } = require("./db");
const { fmt } = require("./format");
const { computePerformance } = require("./analytics");
const { STARTING_BALANCE } = require("./config");

async function createPortfolio({ name, starting_balance, description }) {
  const sb = starting_balance && starting_balance > 0 ? starting_balance : STARTING_BALANCE;
  const exists = db.prepare("SELECT id FROM portfolios WHERE name=?").get(name);
  if (exists) return { content: [{ type: "text", text: `❌ Portfolio '${name}' sudah ada (#${exists.id})` }] };
  const count = db.prepare("SELECT COUNT(*) AS c FROM portfolios").get().c;
  const active = count === 0 ? 1 : 0;
  const r = db.prepare("INSERT INTO portfolios (name, cash_idr, starting_balance, description, active) VALUES (?, ?, ?, ?, ?)").run(name, sb, sb, description || null, active);
  return { content: [{ type: "text", text: `✅ Portfolio #${r.lastInsertRowid} '${name}' dibuat. Modal: Rp${fmt(sb)}${active ? " (ACTIVE)" : ""}` }] };
}

async function listPortfolios() {
  const rows = db.prepare("SELECT * FROM portfolios ORDER BY id ASC").all();
  if (!rows.length) return { content: [{ type: "text", text: "Tidak ada portfolio." }] };
  const lines = rows.map((p) => {
    let holdValue = 0;
    const holdings = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND amount > 0.000001").all(p.id);
    for (const h of holdings) {
      const cached = db.prepare("SELECT price_idr FROM price_cache WHERE symbol = ?").get(h.symbol);
      holdValue += h.amount * (cached?.price_idr || h.avg_buy_price);
    }
    const total = p.cash_idr + holdValue;
    const sb = p.starting_balance || STARTING_BALANCE;
    const retPct = ((total / sb) - 1) * 100;
    const star = p.active ? "⭐" : "  ";
    return `${star} #${p.id} '${p.name}' | cash Rp${fmt(p.cash_idr)} | hold Rp${fmt(holdValue)} | total Rp${fmt(total)} | ${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%${p.description ? ` | ${p.description}` : ""}`;
  });
  return { content: [{ type: "text", text: ["📂 PORTFOLIOS", "─".repeat(80), ...lines].join("\n") }] };
}

async function switchPortfolio({ id_or_name }) {
  const pid = resolvePortfolioId(id_or_name);
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan: ${id_or_name}` }] };
  db.prepare("UPDATE portfolios SET active=0").run();
  db.prepare("UPDATE portfolios SET active=1 WHERE id=?").run(pid);
  const p = db.prepare("SELECT * FROM portfolios WHERE id=?").get(pid);
  return { content: [{ type: "text", text: `✅ Active portfolio: #${pid} '${p.name}' | Cash: Rp${fmt(p.cash_idr)}` }] };
}

async function deletePortfolio({ id_or_name, confirm }) {
  if (!confirm) return { content: [{ type: "text", text: "❌ Set confirm=true untuk delete." }] };
  const pid = resolvePortfolioId(id_or_name);
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const p = db.prepare("SELECT * FROM portfolios WHERE id=?").get(pid);
  if (p.active) return { content: [{ type: "text", text: `❌ Tidak bisa hapus portfolio aktif. Switch dulu.` }] };
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM holdings WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM trades WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM pending_orders WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM dca_plans WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM watchlist WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM positions WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM equity_snapshots WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM portfolios WHERE id=?").run(pid);
  });
  tx();
  return { content: [{ type: "text", text: `✅ Portfolio #${pid} '${p.name}' dihapus.` }] };
}

async function comparePortfolios({ ids }) {
  let targets = [];
  if (ids && ids.length) {
    for (const x of ids) {
      const pid = resolvePortfolioId(x);
      if (pid) targets.push(pid);
    }
  } else {
    targets = db.prepare("SELECT id FROM portfolios ORDER BY id ASC").all().map((r) => r.id);
  }
  if (!targets.length) return { content: [{ type: "text", text: "Tidak ada portfolio untuk dibandingkan." }] };
  const lines = [];
  lines.push("ID  NAME              TOTAL          RET%      WR%    SHARPE  MDD%   TRADES");
  lines.push("─".repeat(80));
  for (const pid of targets) {
    const m = computePerformance(pid);
    const name = (m.portfolio.name || "").padEnd(16).slice(0, 16);
    lines.push(
      `${String(pid).padEnd(3)} ${name}  Rp${fmt(m.total).padStart(12)}  ${(m.ret >= 0 ? "+" : "") + m.ret.toFixed(2).padStart(6)}%  ${m.winRate.toFixed(1).padStart(5)}%  ${m.sr.toFixed(2).padStart(6)}  ${m.mdd.toFixed(2).padStart(5)}  ${String(m.trades.length).padStart(5)}`
    );
  }
  return { content: [{ type: "text", text: ["⚖️ COMPARE PORTFOLIOS", "─".repeat(80), ...lines].join("\n") }] };
}

async function renamePortfolio({ id_or_name, new_name }) {
  const pid = resolvePortfolioId(id_or_name);
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const exists = db.prepare("SELECT id FROM portfolios WHERE name=? AND id!=?").get(new_name, pid);
  if (exists) return { content: [{ type: "text", text: `❌ Nama '${new_name}' sudah dipakai` }] };
  db.prepare("UPDATE portfolios SET name=? WHERE id=?").run(new_name, pid);
  return { content: [{ type: "text", text: `✅ Portfolio #${pid} → '${new_name}'` }] };
}

async function resetPortfolio({ confirm, portfolio_id, all }) {
  if (!confirm) return { content: [{ type: "text", text: "❌ Set confirm=true untuk reset." }] };
  if (all) {
    const ports = db.prepare("SELECT id, starting_balance FROM portfolios").all();
    const tx = db.transaction(() => {
      for (const p of ports) {
        db.prepare("UPDATE portfolios SET cash_idr=? WHERE id=?").run(p.starting_balance || STARTING_BALANCE, p.id);
        db.prepare("DELETE FROM holdings WHERE portfolio_id=?").run(p.id);
        db.prepare("DELETE FROM trades WHERE portfolio_id=?").run(p.id);
        db.prepare("DELETE FROM pending_orders WHERE portfolio_id=?").run(p.id);
        db.prepare("DELETE FROM dca_plans WHERE portfolio_id=?").run(p.id);
        db.prepare("DELETE FROM watchlist WHERE portfolio_id=?").run(p.id);
        db.prepare("DELETE FROM positions WHERE portfolio_id=?").run(p.id);
        db.prepare("DELETE FROM equity_snapshots WHERE portfolio_id=?").run(p.id);
      }
      db.prepare("UPDATE portfolio SET cash_idr=?, updated_at=datetime('now')").run(STARTING_BALANCE);
    });
    tx();
    return { content: [{ type: "text", text: `✅ Semua portfolio direset.` }] };
  }
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: `❌ Portfolio tidak ditemukan` }] };
  const p = db.prepare("SELECT * FROM portfolios WHERE id=?").get(pid);
  const sb = p?.starting_balance || STARTING_BALANCE;
  const tx = db.transaction(() => {
    db.prepare("UPDATE portfolios SET cash_idr=? WHERE id=?").run(sb, pid);
    db.prepare("DELETE FROM holdings WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM trades WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM pending_orders WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM dca_plans WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM watchlist WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM positions WHERE portfolio_id=?").run(pid);
    db.prepare("DELETE FROM equity_snapshots WHERE portfolio_id=?").run(pid);
    if (pid === 1) db.prepare("UPDATE portfolio SET cash_idr=?, updated_at=datetime('now')").run(sb);
  });
  tx();
  return { content: [{ type: "text", text: `✅ Portfolio #${pid} reset. Modal: Rp${fmt(sb)}` }] };
}

module.exports = { createPortfolio, listPortfolios, switchPortfolio, deletePortfolio, comparePortfolios, renamePortfolio, resetPortfolio };
