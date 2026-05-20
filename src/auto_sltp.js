const { db, resolvePortfolioId, getActivePortfolioId } = require("./db");
const { fmt } = require("./format");

function getAutoConfig(portfolio_id, symbol) {
  const pid = portfolio_id || getActivePortfolioId();
  const sym = symbol ? String(symbol).toUpperCase() : null;
  if (sym) {
    const specific = db.prepare("SELECT * FROM auto_sltp_config WHERE portfolio_id=? AND symbol=? AND enabled=1").get(pid, sym);
    if (specific) return specific;
  }
  const wildcard = db.prepare("SELECT * FROM auto_sltp_config WHERE portfolio_id=? AND symbol='*' AND enabled=1").get(pid);
  return wildcard || null;
}

async function setAutoSltp({ portfolio_id, symbol, default_sl_pct, default_tp_pct, apply_to_existing = true, replace_existing = false }) {
  try {
    const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
    if (!pid) return { content: [{ type: "text", text: "❌ Portfolio tidak ditemukan" }] };
    const sym = symbol ? String(symbol).toUpperCase() : "*";
    if (!default_sl_pct && !default_tp_pct) return { content: [{ type: "text", text: "❌ Isi minimal default_sl_pct atau default_tp_pct" }] };
    db.prepare(`INSERT INTO auto_sltp_config (portfolio_id, symbol, default_sl_pct, default_tp_pct, enabled, updated_at) VALUES (?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(portfolio_id, symbol) DO UPDATE SET default_sl_pct=excluded.default_sl_pct, default_tp_pct=excluded.default_tp_pct, enabled=1, updated_at=datetime('now')`)
      .run(pid, sym, default_sl_pct || null, default_tp_pct || null);
    const scope = sym === "*" ? "SEMUA coin" : sym;
    let appliedReport = "";
    if (apply_to_existing) {
      const r = await applyAutoSltpToHoldings({ portfolio_id: pid, dry_run: false, replace_existing });
      appliedReport = "\n\n" + r.content[0].text;
    }
    const text =
      `✅ AUTO SL/TP DIPASANG (portfolio #${pid})\n` +
      `${"─".repeat(50)}\n` +
      `🎯 Scope: ${scope}\n` +
      `🛡️ Default SL: ${default_sl_pct ? default_sl_pct + "%" : "(tidak diset)"}\n` +
      `🎯 Default TP: ${default_tp_pct ? default_tp_pct + "%" : "(tidak diset)"}\n\n` +
      `💡 Setiap buy ${scope === "SEMUA coin" ? "(tanpa override sl_pct/tp_pct)" : sym} auto-pasang SL/TP ini.` +
      appliedReport;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ${err.message}` }] };
  }
}

async function getAutoSltpConfig({ portfolio_id }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: "❌ Portfolio tidak ditemukan" }] };
  const rows = db.prepare("SELECT * FROM auto_sltp_config WHERE portfolio_id=? ORDER BY symbol").all(pid);
  if (!rows.length) return { content: [{ type: "text", text: `Belum ada auto SL/TP config untuk portfolio #${pid}.` }] };
  const lines = rows.map(r => {
    const scope = r.symbol === "*" ? "ALL" : r.symbol;
    const sl = r.default_sl_pct ? `SL ${r.default_sl_pct}%` : "(no SL)";
    const tp = r.default_tp_pct ? `TP ${r.default_tp_pct}%` : "(no TP)";
    const status = r.enabled ? "🟢" : "🔴";
    return `${status} ${scope.padEnd(6)} | ${sl} | ${tp}`;
  });
  const text = [`🛡️ AUTO SL/TP CONFIG (portfolio #${pid})`, "─".repeat(50), ...lines].join("\n");
  return { content: [{ type: "text", text }] };
}

async function disableAutoSltp({ portfolio_id, symbol }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: "❌ Portfolio tidak ditemukan" }] };
  const sym = symbol ? String(symbol).toUpperCase() : "*";
  const r = db.prepare("UPDATE auto_sltp_config SET enabled=0 WHERE portfolio_id=? AND symbol=?").run(pid, sym);
  return { content: [{ type: "text", text: r.changes ? `✅ Auto SL/TP ${sym === "*" ? "wildcard" : sym} dinonaktifkan.` : `❌ Config gak ada.` }] };
}

async function clearAutoSltp({ portfolio_id, symbol }) {
  const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
  if (!pid) return { content: [{ type: "text", text: "❌ Portfolio tidak ditemukan" }] };
  const sym = symbol ? String(symbol).toUpperCase() : "*";
  const r = db.prepare("DELETE FROM auto_sltp_config WHERE portfolio_id=? AND symbol=?").run(pid, sym);
  return { content: [{ type: "text", text: r.changes ? `🗑️ Config ${sym} dihapus.` : `❌ Config gak ada.` }] };
}

async function applyAutoSltpToHoldings({ portfolio_id, dry_run = false, replace_existing = false }) {
  try {
    const pid = portfolio_id ? resolvePortfolioId(portfolio_id) : getActivePortfolioId();
    if (!pid) return { content: [{ type: "text", text: "❌ Portfolio tidak ditemukan" }] };
    const holdings = db.prepare("SELECT * FROM holdings WHERE portfolio_id=? AND amount > 0.000001").all(pid);
    if (!holdings.length) return { content: [{ type: "text", text: "Tidak ada holding aktif." }] };
    const { createSlTpOrders } = require("./orders");
    const lines = [];
    let applied = 0, skipped = 0;
    for (const h of holdings) {
      const cfg = getAutoConfig(pid, h.symbol);
      if (!cfg) { lines.push(`  ⏭️  ${h.symbol}: no auto config`); skipped++; continue; }
      const hasSl = db.prepare("SELECT id FROM pending_orders WHERE portfolio_id=? AND symbol=? AND type='STOP_LOSS' AND status='OPEN'").get(pid, h.symbol);
      const hasTp = db.prepare("SELECT id FROM pending_orders WHERE portfolio_id=? AND symbol=? AND type='TAKE_PROFIT' AND status='OPEN'").get(pid, h.symbol);
      if ((hasSl && hasTp) && !replace_existing) {
        lines.push(`  ⏭️  ${h.symbol}: SL+TP udah ada (skip, set replace_existing=true buat overwrite)`);
        skipped++;
        continue;
      }
      const slPrice = cfg.default_sl_pct ? h.avg_buy_price * (1 - cfg.default_sl_pct / 100) : null;
      const tpPrice = cfg.default_tp_pct ? h.avg_buy_price * (1 + cfg.default_tp_pct / 100) : null;
      if (dry_run) {
        lines.push(`  🔮 ${h.symbol}: would set SL${cfg.default_sl_pct ? ` ${cfg.default_sl_pct}% (Rp${fmt(slPrice)})` : "(n/a)"} | TP${cfg.default_tp_pct ? ` ${cfg.default_tp_pct}% (Rp${fmt(tpPrice)})` : "(n/a)"}`);
        applied++;
        continue;
      }
      if (replace_existing) {
        db.prepare("UPDATE pending_orders SET status='CANCELLED' WHERE portfolio_id=? AND symbol=? AND type IN ('STOP_LOSS','TAKE_PROFIT') AND status='OPEN'").run(pid, h.symbol);
      } else {
        if (hasSl && hasTp) continue;
      }
      const slPctApply = (replace_existing || !hasSl) ? cfg.default_sl_pct : null;
      const tpPctApply = (replace_existing || !hasTp) ? cfg.default_tp_pct : null;
      if (slPctApply || tpPctApply) {
        createSlTpOrders(h.symbol, h.avg_buy_price, slPctApply, tpPctApply, pid);
        const parts = [];
        if (slPctApply) parts.push(`SL ${slPctApply}% @ Rp${fmt(h.avg_buy_price * (1 - slPctApply/100))}`);
        if (tpPctApply) parts.push(`TP ${tpPctApply}% @ Rp${fmt(h.avg_buy_price * (1 + tpPctApply/100))}`);
        lines.push(`  ✅ ${h.symbol}: ${parts.join(" | ")}`);
        applied++;
      }
    }
    const text = [
      `${dry_run ? "🔮 DRY RUN" : "🛡️ APPLY AUTO SL/TP"} (portfolio #${pid})`,
      "─".repeat(60),
      ...lines,
      "",
      `${dry_run ? "Would apply" : "Applied"}: ${applied} | Skipped: ${skipped}`,
      replace_existing ? "⚠️ Existing SL/TP di-replace (cancelled)" : "💡 Pakai replace_existing=true buat overwrite SL/TP yang udah ada"
    ].join("\n");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ${err.message}` }] };
  }
}

module.exports = { getAutoConfig, setAutoSltp, getAutoSltpConfig, disableAutoSltp, clearAutoSltp, applyAutoSltpToHoldings };
