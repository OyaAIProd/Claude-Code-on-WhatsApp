const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "models.json");
const DEFAULT = process.env.CLAUDE_MODEL || "sonnet";
const VALID = ["sonnet", "opus", "haiku", "sonnet[1m]"];

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(d) { try { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); } catch {} }

function getModel(chatId) {
  const d = load();
  return d[chatId] || DEFAULT;
}

function setModel(chatId, model) {
  const d = load();
  d[chatId] = model;
  save(d);
}

function isValid(model) {
  if (VALID.includes(model)) return true;
  if (/^claude-/.test(model)) return true;
  return false;
}

module.exports = { getModel, setModel, isValid, DEFAULT, VALID };
