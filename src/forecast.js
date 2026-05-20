const { db } = require("./db");
const { fmt } = require("./format");
const { fetchJson, resolveCoinId } = require("./prices");
const { rsi, macd, ema } = require("./indicators");

const CACHE_TTL_SEC = 3600;

function cacheGet(symbol, kind) {
  const row = db.prepare("SELECT json_payload, (julianday('now') - julianday(computed_at)) * 86400 AS age FROM ml_cache WHERE symbol=? AND kind=?").get(symbol, kind);
  if (!row) return null;
  if (row.age > CACHE_TTL_SEC) return null;
  try { return JSON.parse(row.json_payload); } catch { return null; }
}

function cacheSet(symbol, kind, payload) {
  db.prepare("INSERT OR REPLACE INTO ml_cache (symbol, kind, json_payload, computed_at) VALUES (?, ?, ?, datetime('now'))").run(symbol, kind, JSON.stringify(payload));
}

function linearRegression(closes) {
  const n = closes.length;
  if (n < 2) return { slope: 0, intercept: closes[0] || 0, r_squared: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += closes[i]; sxy += i * closes[i]; sx2 += i * i;
  }
  const denom = n * sx2 - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * i;
    ssRes += (closes[i] - yhat) ** 2;
    ssTot += (closes[i] - meanY) ** 2;
  }
  const r_squared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r_squared };
}

async function fetchOhlcDaily(coinId, days = 90) {
  const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`, 15000);
  if (!Array.isArray(data) || data.length < 20) throw new Error(`OHLC data terlalu pendek (${data?.length || 0})`);
  return data.map((r) => ({ ts: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }));
}

async function fetchMarketChart(coinId, days = 90) {
  const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`, 15000);
  const closes = (data.prices || []).map((p) => p[1]);
  const vols = (data.total_volumes || []).map((p) => p[1]);
  return { closes, vols };
}

function sigmoid(z) {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function buildFeatures(closes, vols) {
  const rows = [];
  for (let i = 30; i < closes.length - 1; i++) {
    const slice = closes.slice(0, i + 1);
    const r = rsi(slice);
    if (r === null || !isFinite(r)) continue;
    const m = macd(slice);
    const hist = m.histogram[i];
    const e20 = ema(slice, 20)[i];
    const e50 = ema(slice, 50)[i];
    if (!isFinite(e20) || !isFinite(e50) || e50 === 0) continue;
    const emaRatio = (e20 / e50) - 1;
    const ret3d = closes[i - 3] > 0 ? (closes[i] / closes[i - 3] - 1) * 100 : 0;
    const volPrev = vols[i - 1] || 1;
    const volChg = volPrev > 0 ? ((vols[i] || volPrev) / volPrev - 1) * 100 : 0;
    const label = closes[i + 1] > closes[i] ? 1 : 0;
    rows.push({ x: [r / 100, hist / closes[i], emaRatio, ret3d / 100, volChg / 100], y: label });
  }
  return rows;
}

function normalize(rows) {
  const dim = rows[0].x.length;
  const means = new Array(dim).fill(0);
  const stds = new Array(dim).fill(0);
  for (const r of rows) for (let i = 0; i < dim; i++) means[i] += r.x[i];
  for (let i = 0; i < dim; i++) means[i] /= rows.length;
  for (const r of rows) for (let i = 0; i < dim; i++) stds[i] += (r.x[i] - means[i]) ** 2;
  for (let i = 0; i < dim; i++) stds[i] = Math.sqrt(stds[i] / rows.length) || 1;
  const norm = rows.map((r) => ({ x: r.x.map((v, i) => (v - means[i]) / stds[i]), y: r.y }));
  return { norm, means, stds };
}

function trainLogistic(rows, iterations = 200, lr = 0.01, lambda = 0.001) {
  const dim = rows[0].x.length;
  let w = new Array(dim).fill(0);
  let b = 0;
  for (let it = 0; it < iterations; it++) {
    const gw = new Array(dim).fill(0);
    let gb = 0;
    for (const r of rows) {
      let z = b;
      for (let i = 0; i < dim; i++) z += w[i] * r.x[i];
      const p = sigmoid(z);
      const err = p - r.y;
      for (let i = 0; i < dim; i++) gw[i] += err * r.x[i];
      gb += err;
    }
    for (let i = 0; i < dim; i++) w[i] -= lr * (gw[i] / rows.length + lambda * w[i]);
    b -= lr * (gb / rows.length);
  }
  return { w, b };
}

function predictLogistic(model, xNorm) {
  let z = model.b;
  for (let i = 0; i < xNorm.length; i++) z += model.w[i] * xNorm[i];
  return sigmoid(z);
}

function binReturn(r) {
  if (r < -0.03) return 0;
  if (r < -0.005) return 1;
  if (r < 0.005) return 2;
  if (r < 0.03) return 3;
  return 4;
}

const STATE_NAMES = ["STRONG_DOWN", "DOWN", "FLAT", "UP", "STRONG_UP"];
const STATE_EMOJI = ["🔻", "🔴", "⚪", "🟢", "🚀"];

function buildMarkov(closes) {
  const states = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      const r = (closes[i] / closes[i - 1]) - 1;
      states.push(binReturn(r));
    }
  }
  const m = Array.from({ length: 5 }, () => new Array(5).fill(0));
  for (let i = 0; i < states.length - 1; i++) m[states[i]][states[i + 1]]++;
  const T = Array.from({ length: 5 }, () => new Array(5).fill(0));
  for (let i = 0; i < 5; i++) {
    const sum = m[i].reduce((a, b) => a + b, 0);
    if (sum === 0) { T[i][i] = 1; continue; }
    for (let j = 0; j < 5; j++) T[i][j] = m[i][j] / sum;
  }
  let v = new Array(5).fill(0.2);
  for (let it = 0; it < 100; it++) {
    const nv = new Array(5).fill(0);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) nv[j] += v[i] * T[i][j];
    const s = nv.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < 5; i++) nv[i] /= s;
    v = nv;
  }
  const currentState = states.length ? states[states.length - 1] : 2;
  const nextProbs = T[currentState];
  let nextState = 0, maxP = -1;
  for (let i = 0; i < 5; i++) if (nextProbs[i] > maxP) { maxP = nextProbs[i]; nextState = i; }
  return { transitions: T, steady: v, currentState, nextState, nextProbs, counts: m };
}

async function predict_price({ symbol, days_ahead = 7 }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const cached = cacheGet(sym, "linreg");
    let payload;
    if (cached) payload = cached;
    else {
      const { closes } = await fetchMarketChart(coinId, 90);
      if (closes.length < 30) throw new Error("Data terlalu pendek");
      const reg = linearRegression(closes);
      payload = { reg, lastIdx: closes.length - 1, lastPrice: closes[closes.length - 1], n: closes.length };
      cacheSet(sym, "linreg", payload);
    }
    const { reg, lastIdx, lastPrice, n } = payload;
    const lines = [];
    lines.push(`📈 PRICE FORECAST ${sym} (linear regression)`);
    lines.push("─".repeat(55));
    lines.push(`📊 Dilatih dari ${n} hari OHLC`);
    lines.push(`💰 Harga sekarang: $${lastPrice.toFixed(4)}`);
    lines.push(`📐 Slope: $${reg.slope.toFixed(6)}/hari | R²: ${reg.r_squared.toFixed(3)}`);
    const conf = reg.r_squared > 0.6 ? "🟢 TINGGI" : reg.r_squared > 0.3 ? "🟡 SEDANG" : "🔴 RENDAH";
    lines.push(`🎯 Confidence: ${conf}`);
    lines.push("");
    lines.push(`📅 Proyeksi ${days_ahead} hari:`);
    for (let d = 1; d <= days_ahead; d++) {
      const t = lastIdx + d;
      const projected = reg.intercept + reg.slope * t;
      const pct = ((projected / lastPrice) - 1) * 100;
      const arrow = pct >= 0 ? "▲" : "▼";
      lines.push(`  D+${d}: $${projected.toFixed(4)} | ${arrow} ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal predict_price: ${err.message}` }] };
  }
}

const FEATURE_NAMES = ["RSI", "MACD_hist", "EMA20/50", "ret_3d", "vol_chg"];

async function predict_direction({ symbol }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const cached = cacheGet(sym, "logistic");
    let payload;
    if (cached) payload = cached;
    else {
      const { closes, vols } = await fetchMarketChart(coinId, 90);
      const rows = buildFeatures(closes, vols);
      if (rows.length < 20) throw new Error(`Sample terlalu sedikit (${rows.length})`);
      const { norm, means, stds } = normalize(rows);
      const model = trainLogistic(norm, 200, 0.01, 0.001);
      const lastRow = rows[rows.length - 1];
      const lastNorm = lastRow.x.map((v, i) => (v - means[i]) / stds[i]);
      const prob = predictLogistic(model, lastNorm);
      let correct = 0;
      for (const r of norm) {
        const p = predictLogistic(model, r.x);
        if ((p >= 0.5 ? 1 : 0) === r.y) correct++;
      }
      const acc = correct / norm.length;
      payload = { weights: model.w, bias: model.b, means, stds, last_features: lastRow.x, prob, train_acc: acc, n: rows.length };
      cacheSet(sym, "logistic", payload);
    }
    const prob = payload.prob;
    let signal = "HOLD";
    let emoji = "⚪";
    if (prob > 0.6) { signal = "BUY"; emoji = "🟢"; }
    else if (prob < 0.4) { signal = "SELL"; emoji = "🔴"; }
    const importance = payload.weights.map((w, i) => ({ name: FEATURE_NAMES[i], weight: w, abs: Math.abs(w) }));
    importance.sort((a, b) => b.abs - a.abs);
    const lines = [];
    lines.push(`🤖 DIRECTION FORECAST ${sym} (logistic regression)`);
    lines.push("─".repeat(55));
    lines.push(`📊 Dilatih dari ${payload.n} sampel | Train acc: ${(payload.train_acc * 100).toFixed(1)}%`);
    lines.push(`🎯 Prob NAIK besok: ${(prob * 100).toFixed(1)}%`);
    lines.push(`${emoji} Signal: ${signal}`);
    lines.push("");
    lines.push("📐 Feature importance:");
    for (const f of importance) {
      const bar = "█".repeat(Math.min(20, Math.round(f.abs * 5)));
      const dir = f.weight >= 0 ? "+" : "-";
      lines.push(`  ${f.name.padEnd(10)} ${dir}${f.abs.toFixed(3)} ${bar}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal predict_direction: ${err.message}` }] };
  }
}

async function predict_regime({ symbol }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const cached = cacheGet(sym, "markov");
    let mk;
    if (cached) mk = cached;
    else {
      const { closes } = await fetchMarketChart(coinId, 90);
      mk = buildMarkov(closes);
      cacheSet(sym, "markov", mk);
    }
    const lines = [];
    lines.push(`🔮 REGIME FORECAST ${sym} (Markov chain)`);
    lines.push("─".repeat(55));
    lines.push(`📍 State sekarang: ${STATE_EMOJI[mk.currentState]} ${STATE_NAMES[mk.currentState]}`);
    lines.push(`➡️ Most likely besok: ${STATE_EMOJI[mk.nextState]} ${STATE_NAMES[mk.nextState]} (${(mk.nextProbs[mk.nextState] * 100).toFixed(1)}%)`);
    lines.push("");
    lines.push("📊 Transition dari state sekarang:");
    for (let j = 0; j < 5; j++) {
      const p = mk.nextProbs[j];
      const bar = "█".repeat(Math.round(p * 20));
      lines.push(`  ${STATE_EMOJI[j]} ${STATE_NAMES[j].padEnd(12)} ${(p * 100).toFixed(1)}% ${bar}`);
    }
    lines.push("");
    lines.push("⚖️ Steady-state distribution:");
    for (let j = 0; j < 5; j++) {
      const p = mk.steady[j];
      const bar = "█".repeat(Math.round(p * 20));
      lines.push(`  ${STATE_EMOJI[j]} ${STATE_NAMES[j].padEnd(12)} ${(p * 100).toFixed(1)}% ${bar}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal predict_regime: ${err.message}` }] };
  }
}

async function ml_combined_signal({ symbol }) {
  try {
    const { sym, coinId } = resolveCoinId(symbol);
    const { closes, vols } = await fetchMarketChart(coinId, 90);
    let regCache = cacheGet(sym, "linreg");
    if (!regCache) {
      const reg = linearRegression(closes);
      regCache = { reg, lastIdx: closes.length - 1, lastPrice: closes[closes.length - 1], n: closes.length };
      cacheSet(sym, "linreg", regCache);
    }
    let logCache = cacheGet(sym, "logistic");
    if (!logCache) {
      const rows = buildFeatures(closes, vols);
      if (rows.length < 20) throw new Error("Sample tidak cukup");
      const { norm, means, stds } = normalize(rows);
      const model = trainLogistic(norm, 200, 0.01, 0.001);
      const lastRow = rows[rows.length - 1];
      const lastNorm = lastRow.x.map((v, i) => (v - means[i]) / stds[i]);
      const prob = predictLogistic(model, lastNorm);
      logCache = { weights: model.w, bias: model.b, means, stds, prob, n: rows.length };
      cacheSet(sym, "logistic", logCache);
    }
    let mkCache = cacheGet(sym, "markov");
    if (!mkCache) {
      mkCache = buildMarkov(closes);
      cacheSet(sym, "markov", mkCache);
    }
    let score = 0;
    const reasons = [];
    const slopePct = regCache.reg.slope / regCache.lastPrice * 100;
    if (regCache.reg.r_squared > 0.3) {
      if (slopePct > 0.5) { score += 2; reasons.push(`📈 LinReg trend NAIK kuat (slope/price=${slopePct.toFixed(2)}%, R²=${regCache.reg.r_squared.toFixed(2)})`); }
      else if (slopePct > 0) { score += 1; reasons.push(`📈 LinReg trend naik lemah (R²=${regCache.reg.r_squared.toFixed(2)})`); }
      else if (slopePct < -0.5) { score -= 2; reasons.push(`📉 LinReg trend TURUN kuat (slope/price=${slopePct.toFixed(2)}%, R²=${regCache.reg.r_squared.toFixed(2)})`); }
      else { score -= 1; reasons.push(`📉 LinReg trend turun lemah (R²=${regCache.reg.r_squared.toFixed(2)})`); }
    } else {
      reasons.push(`⚠️ LinReg R² rendah (${regCache.reg.r_squared.toFixed(2)}) → diabaikan`);
    }
    const prob = logCache.prob;
    if (prob > 0.65) { score += 2; reasons.push(`🤖 Logistic prob NAIK ${(prob * 100).toFixed(1)}% (STRONG)`); }
    else if (prob > 0.55) { score += 1; reasons.push(`🤖 Logistic prob NAIK ${(prob * 100).toFixed(1)}%`); }
    else if (prob < 0.35) { score -= 2; reasons.push(`🤖 Logistic prob TURUN ${((1-prob) * 100).toFixed(1)}% (STRONG)`); }
    else if (prob < 0.45) { score -= 1; reasons.push(`🤖 Logistic prob TURUN ${((1-prob) * 100).toFixed(1)}%`); }
    else { reasons.push(`🤖 Logistic netral (${(prob * 100).toFixed(1)}%)`); }
    const ns = mkCache.nextState;
    if (ns === 4) { score += 2; reasons.push(`🚀 Markov: STRONG_UP paling mungkin`); }
    else if (ns === 3) { score += 1; reasons.push(`🟢 Markov: UP paling mungkin`); }
    else if (ns === 1) { score -= 1; reasons.push(`🔴 Markov: DOWN paling mungkin`); }
    else if (ns === 0) { score -= 2; reasons.push(`🔻 Markov: STRONG_DOWN paling mungkin`); }
    else { reasons.push(`⚪ Markov: FLAT paling mungkin`); }
    let final, finalEmoji;
    if (score >= 4) { final = "CONFIDENT_BUY"; finalEmoji = "🟢🟢"; }
    else if (score >= 2) { final = "BUY"; finalEmoji = "🟢"; }
    else if (score >= -1) { final = "HOLD"; finalEmoji = "⚪"; }
    else if (score >= -3) { final = "SELL"; finalEmoji = "🔴"; }
    else { final = "CONFIDENT_SELL"; finalEmoji = "🔴🔴"; }
    const lines = [];
    lines.push(`🧠 ML COMBINED SIGNAL ${sym}`);
    lines.push("─".repeat(55));
    lines.push(`${finalEmoji} REKOMENDASI: ${final} (score=${score})`);
    lines.push("");
    lines.push("📝 Reasoning:");
    for (const r of reasons) lines.push(`  ${r}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gagal ml_combined_signal: ${err.message}` }] };
  }
}

function refreshAllMlCache() {
  try {
    const syms = Object.keys(require("./config").COIN_IDS);
    const stale = [];
    for (const sym of syms) {
      const row = db.prepare("SELECT (julianday('now') - julianday(computed_at)) * 86400 AS age FROM ml_cache WHERE symbol=? ORDER BY age DESC LIMIT 1").get(sym);
      if (!row || row.age > CACHE_TTL_SEC) stale.push(sym);
    }
  } catch {}
}

module.exports = {
  linearRegression,
  buildFeatures,
  trainLogistic,
  predictLogistic,
  buildMarkov,
  predict_price,
  predict_direction,
  predict_regime,
  ml_combined_signal,
  refreshAllMlCache
};
