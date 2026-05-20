const PATTERNS = [
  { name: "ktp_nik", regex: /\b\d{16}\b/g, severity: "high" },
  { name: "npwp", regex: /\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g, severity: "high" },
  { name: "credit_card", regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, severity: "critical" },
  { name: "indo_phone", regex: /\b(?:\+62|62|0)8\d{8,11}\b/g, severity: "medium" },
  { name: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, severity: "low" },
  { name: "iban", regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, severity: "high" },
  { name: "bank_account_long", regex: /\b\d{10,16}\b/g, severity: "medium" },
  { name: "password_label", regex: /(password|pwd|passw|sandi)\s*[:=]\s*\S+/gi, severity: "critical" },
  { name: "api_key", regex: /\b(sk-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, severity: "critical" }
];

function detect(text) {
  if (!text) return [];
  const found = [];
  for (const p of PATTERNS) {
    const matches = [...text.matchAll(p.regex)];
    for (const m of matches) {
      found.push({ name: p.name, severity: p.severity, match: m[0], index: m.index });
    }
  }
  return found;
}

function redact(text) {
  if (!text) return text;
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(p.regex, (m) => `[${p.name.toUpperCase()}_REDACTED:${m.length}]`);
  }
  return out;
}

function severitySummary(findings) {
  const groups = {};
  for (const f of findings) groups[f.severity] = (groups[f.severity] || 0) + 1;
  return groups;
}

module.exports = { detect, redact, severitySummary, PATTERNS };
