const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "sessions.json");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(data) { try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch {} }

function migrateLegacy(data) {
  for (const chatId of Object.keys(data)) {
    if (typeof data[chatId] === "string") {
      const id = data[chatId];
      data[chatId] = { current: id, list: [{ id, name: "main", created: new Date().toISOString(), last_used: new Date().toISOString() }] };
    }
  }
  return data;
}

function getState(chatId) {
  const data = migrateLegacy(load());
  if (!data[chatId]) data[chatId] = { current: null, list: [] };
  save(data);
  return data[chatId];
}

function setCurrent(chatId, id) {
  const data = migrateLegacy(load());
  if (!data[chatId]) data[chatId] = { current: null, list: [] };
  data[chatId].current = id;
  const s = data[chatId].list.find(x => x.id === id);
  if (s) s.last_used = new Date().toISOString();
  save(data);
}

function newSession(chatId, name) {
  const data = migrateLegacy(load());
  if (!data[chatId]) data[chatId] = { current: null, list: [] };
  const id = crypto.randomUUID();
  data[chatId].list.push({ id, name: name || `session ${data[chatId].list.length + 1}`, created: new Date().toISOString(), last_used: new Date().toISOString() });
  data[chatId].current = id;
  save(data);
  return id;
}

function renameCurrent(chatId, newName) {
  const data = migrateLegacy(load());
  const state = data[chatId];
  if (!state || !state.current) return false;
  const s = state.list.find(x => x.id === state.current);
  if (!s) return false;
  s.name = newName;
  save(data);
  return true;
}

function listSessions(chatId) {
  const state = getState(chatId);
  return state.list.slice().sort((a, b) => (b.last_used || "").localeCompare(a.last_used || ""));
}

function resumeBy(chatId, indexOrId) {
  const sessions = listSessions(chatId);
  let target = null;
  if (typeof indexOrId === "number" || /^\d+$/.test(String(indexOrId))) {
    const idx = parseInt(indexOrId, 10);
    target = sessions[idx - 1];
  } else {
    target = sessions.find(s => s.id === indexOrId || s.id.startsWith(indexOrId) || s.name === indexOrId);
  }
  if (!target) return null;
  setCurrent(chatId, target.id);
  return target;
}

function deleteSession(chatId, indexOrId) {
  const data = migrateLegacy(load());
  const state = data[chatId];
  if (!state) return null;
  const sessions = listSessions(chatId);
  let target = null;
  if (/^\d+$/.test(String(indexOrId))) target = sessions[parseInt(indexOrId, 10) - 1];
  else target = state.list.find(s => s.id === indexOrId || s.id.startsWith(indexOrId) || s.name === indexOrId);
  if (!target) return null;
  state.list = state.list.filter(s => s.id !== target.id);
  if (state.current === target.id) state.current = state.list.length ? state.list[0].id : null;
  save(data);
  return target;
}

function getCurrentId(chatId) {
  const state = getState(chatId);
  return state.current;
}

function ensureCurrent(chatId) {
  let id = getCurrentId(chatId);
  if (!id) id = newSession(chatId);
  return id;
}

function markSuccess(chatId, id) {
  const data = migrateLegacy(load());
  const state = data[chatId];
  if (!state) return;
  let s = state.list.find(x => x.id === id);
  if (!s) {
    s = { id, name: `session ${state.list.length + 1}`, created: new Date().toISOString(), last_used: new Date().toISOString() };
    state.list.push(s);
  }
  s.last_used = new Date().toISOString();
  state.current = id;
  save(data);
}

function dropCurrent(chatId) {
  const data = migrateLegacy(load());
  if (!data[chatId]) return;
  const cur = data[chatId].current;
  if (!cur) return;
  data[chatId].list = data[chatId].list.filter(s => s.id !== cur);
  data[chatId].current = data[chatId].list.length ? data[chatId].list[0].id : null;
  save(data);
}

module.exports = { getState, setCurrent, newSession, renameCurrent, listSessions, resumeBy, deleteSession, getCurrentId, ensureCurrent, markSuccess, dropCurrent };
