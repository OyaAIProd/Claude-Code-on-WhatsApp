const { db, resolvePortfolioId, getPortfolio } = require("./db");
const { fmt } = require("./format");
const { computeTotalEquity } = require("./execution");
const { sendNotification } = require("./notify");

function fanout(trade) {
  try {
    if (trade.is_copy) return;
    const subs = db.prepare("SELECT * FROM copy_subscriptions WHERE source_portfolio_id=? AND active=1").all(trade.portfolio_id);
    if (!subs.length) return;
    const { executeBuyInternal, executeSellInternal } = require("./execution");
    const srcEq = computeTotalEquity(trade.portfolio_id).total;
    for (const sub of subs) {
      try {
        if (trade.side === "BUY" && !sub.follow_buy) continue;
        if (trade.side === "SELL" && !sub.follow_sell) continue;
        if (trade.confidence && trade.confidence < sub.min_confidence) continue;
        if (sub.min_confidence > 0 && !trade.confidence) continue;
        const targetEq = computeTotalEquity(sub.target_portfolio_id).total;
        if (targetEq <= 0) continue;
        const note = `[COPY from #${trade.portfolio_id}]${trade.note ? " " + trade.note : ""}`;
        if (trade.side === "BUY") {
          const scaledAmt = trade.amount_idr * sub.size_multiplier * (targetEq / srcEq);
          const cap = targetEq * (sub.max_position_pct / 100);
          const targetPortfolio = getPortfolio(sub.target_portfolio_id);
          const finalAmt = Math.min(scaledAmt, cap, targetPortfolio.cash_idr * 0.95);
          if (finalAmt < 1000) continue;
          executeBuyInternal(trade.symbol, finalAmt, {
            midPrice: trade.exec_price, price_usd: trade.price_usd, note, portfolio_id: sub.target_portfolio_id,
            strategy: trade.strategy, setup: trade.setup, confidence: trade.confidence, is_copy: true
          });
        } else {
          executeSellInternal(trade.symbol, trade.percent || 100, {
            midPrice: trade.exec_price, price_usd: trade.price_usd, note, portfolio_id: sub.target_portfolio_id,
            strategy: trade.strategy, setup: trade.setup, confidence: trade.confidence, is_copy: true
          });
        }
        sendNotification({
          title: `📋 Copy Trade #${sub.id}`,
          body: `${trade.side} ${trade.symbol} mirrored from portfolio #${trade.portfolio_id}`,
          category: "copy_trade", priority: "default", tags: ["copy"]
        }).catch(() => {});
      } catch (err) {
        console.error(`copy fanout sub ${sub.id} error:`, err.message);
      }
    }
  } catch (err) {
    console.error("copy fanout error:", err.message);
  }
}

async function followPortfolio({ source, target, size_multiplier = 1.0, min_confidence = 0, max_position_pct = 100, follow_buy = true, follow_sell = true }) {
  try {
    const src = resolvePortfolioId(source);
    const tgt = resolvePortfolioId(target);
    if (!src || !tgt) return { content: [{ type: "text", text: "❌ Portfolio source/target tidak ditemukan." }] };
    if (src === tgt) return { content: [{ type: "text", text: "❌ Source dan target tidak boleh sama." }] };
    const existing = db.prepare("SELECT id FROM copy_subscriptions WHERE source_portfolio_id=? AND target_portfolio_id=? AND active=1").get(src, tgt);
    if (existing) return { content: [{ type: "text", text: `❌ Subscription #${existing.id} sudah ada.` }] };
    const r = db.prepare(`INSERT INTO copy_subscriptions (source_portfolio_id, target_portfolio_id, size_multiplier, min_confidence, max_position_pct, follow_buy, follow_sell) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      src, tgt, size_multiplier, min_confidence, max_position_pct, follow_buy ? 1 : 0, follow_sell ? 1 : 0
    );
    const text =
      `✅ SUBSCRIPTION #${r.lastInsertRowid}\n` +
      `📥 Source: #${src} → Target: #${tgt}\n` +
      `📐 Size multiplier: ${size_multiplier}x\n` +
      `🎯 Min confidence: ${min_confidence}/10\n` +
      `🛡️ Max position: ${max_position_pct}%\n` +
      `📋 Follow: ${follow_buy ? "BUY ✓" : "BUY ✗"} | ${follow_sell ? "SELL ✓" : "SELL ✗"}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ${err.message}` }] };
  }
}

async function unfollowPortfolio({ subscription_id }) {
  const r = db.prepare("UPDATE copy_subscriptions SET active=0 WHERE id=?").run(subscription_id);
  if (!r.changes) return { content: [{ type: "text", text: `❌ Subscription #${subscription_id} tidak ada.` }] };
  return { content: [{ type: "text", text: `✅ Subscription #${subscription_id} dinonaktifkan.` }] };
}

async function listSubscriptions({ portfolio_id }) {
  let rows;
  if (portfolio_id) {
    const pid = resolvePortfolioId(portfolio_id);
    rows = db.prepare("SELECT * FROM copy_subscriptions WHERE (source_portfolio_id=? OR target_portfolio_id=?) AND active=1 ORDER BY id").all(pid, pid);
  } else {
    rows = db.prepare("SELECT * FROM copy_subscriptions WHERE active=1 ORDER BY id").all();
  }
  if (!rows.length) return { content: [{ type: "text", text: "Tidak ada subscription aktif." }] };
  const lines = rows.map(r =>
    `#${r.id}: #${r.source_portfolio_id} → #${r.target_portfolio_id} | ${r.size_multiplier}x | minConf ${r.min_confidence} | maxPos ${r.max_position_pct}% | ${r.follow_buy ? "B" : "-"}${r.follow_sell ? "S" : "-"}`
  );
  const text = ["📋 COPY SUBSCRIPTIONS", "─".repeat(60), ...lines].join("\n");
  return { content: [{ type: "text", text }] };
}

async function copyStats({ subscription_id }) {
  const sub = db.prepare("SELECT * FROM copy_subscriptions WHERE id=?").get(subscription_id);
  if (!sub) return { content: [{ type: "text", text: `❌ Subscription #${subscription_id} tidak ada.` }] };
  const mirrored = db.prepare("SELECT COUNT(*) AS c FROM trades WHERE portfolio_id=? AND note LIKE ?").get(sub.target_portfolio_id, `%[COPY from #${sub.source_portfolio_id}]%`).c;
  const srcSnap = db.prepare("SELECT total_idr FROM equity_snapshots WHERE portfolio_id=? ORDER BY id").all(sub.source_portfolio_id);
  const tgtSnap = db.prepare("SELECT total_idr FROM equity_snapshots WHERE portfolio_id=? ORDER BY id").all(sub.target_portfolio_id);
  const srcRet = srcSnap.length >= 2 ? ((srcSnap[srcSnap.length-1].total_idr / srcSnap[0].total_idr) - 1) * 100 : 0;
  const tgtRet = tgtSnap.length >= 2 ? ((tgtSnap[tgtSnap.length-1].total_idr / tgtSnap[0].total_idr) - 1) * 100 : 0;
  let corr = "n/a";
  const n = Math.min(srcSnap.length, tgtSnap.length);
  if (n >= 5) {
    const a = srcSnap.slice(-n).map(s => s.total_idr);
    const b = tgtSnap.slice(-n).map(s => s.total_idr);
    const ma = a.reduce((s,v)=>s+v,0)/n;
    const mb = b.reduce((s,v)=>s+v,0)/n;
    let num=0, da=0, dba=0;
    for (let i=0;i<n;i++) { num += (a[i]-ma)*(b[i]-mb); da += (a[i]-ma)**2; dba += (b[i]-mb)**2; }
    const denom = Math.sqrt(da*dba);
    corr = denom > 0 ? (num/denom).toFixed(3) : "n/a";
  }
  const text =
    `📊 COPY STATS #${subscription_id}\n` +
    `${"─".repeat(50)}\n` +
    `📥 Source #${sub.source_portfolio_id} → Target #${sub.target_portfolio_id}\n` +
    `📋 Mirrored trades: ${mirrored}\n` +
    `📈 Source return: ${srcRet >= 0 ? "+" : ""}${srcRet.toFixed(2)}%\n` +
    `📈 Target return: ${tgtRet >= 0 ? "+" : ""}${tgtRet.toFixed(2)}%\n` +
    `🔗 Equity correlation: ${corr}\n` +
    `🔌 Active: ${sub.active ? "🟢" : "🔴"}`;
  return { content: [{ type: "text", text }] };
}

module.exports = { fanout, followPortfolio, unfollowPortfolio, listSubscriptions, copyStats };
