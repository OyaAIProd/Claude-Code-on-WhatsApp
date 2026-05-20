function ema(arr, period) {
  if (!arr.length) return [];
  const k = 2 / (period + 1);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
  return out;
}

function sma(arr, period) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += arr[j];
    out.push(s / period);
  }
  return out;
}

function rsi(arr, period = 14) {
  if (arr.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function macd(arr) {
  const e12 = ema(arr, 12);
  const e26 = ema(arr, 26);
  const line = arr.map((_, i) => e12[i] - e26[i]);
  const sig = ema(line, 9);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, histogram: hist };
}

function bollinger(arr, period = 20, k = 2) {
  const mid = sma(arr, period);
  const upper = [], lower = [];
  for (let i = 0; i < arr.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += Math.pow(arr[j] - mid[i], 2);
    const sd = Math.sqrt(s / period);
    upper.push(mid[i] + k * sd);
    lower.push(mid[i] - k * sd);
  }
  return { mid, upper, lower };
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += a[i]; sy += b[i]; sxy += a[i] * b[i]; sx2 += a[i] * a[i]; sy2 += b[i] * b[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  return den === 0 ? 0 : num / den;
}

function maxDrawdown(equity) {
  let peak = equity[0] || 0, maxDD = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

function sharpe(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / returns.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(365);
}

module.exports = { ema, sma, rsi, macd, bollinger, pearson, maxDrawdown, sharpe };
