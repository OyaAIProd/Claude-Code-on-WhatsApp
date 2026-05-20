const fmt = (n) => Math.round(n).toLocaleString("id-ID");

function sparkline(values) {
  const chars = "▁▂▃▄▅▆▇█";
  if (!values.length) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v) => chars[Math.min(7, Math.floor(((v - min) / range) * 8))]).join("");
}

module.exports = { fmt, sparkline };
