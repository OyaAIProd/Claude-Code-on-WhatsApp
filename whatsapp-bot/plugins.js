const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "plugins");
fs.mkdirSync(PLUGINS_DIR, { recursive: true });

const plugins = [];

function load() {
  plugins.length = 0;
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith(".js") && !f.startsWith("_"));
  for (const f of files) {
    const full = path.join(PLUGINS_DIR, f);
    try {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      if (!mod.name) { console.error(`[PLUGIN] ${f}: missing 'name'`); continue; }
      plugins.push({ ...mod, file: f });
      console.log(`[PLUGIN] loaded: ${mod.name} (${f})`);
    } catch (err) {
      console.error(`[PLUGIN] load fail ${f}: ${err.message}`);
    }
  }
  return plugins;
}

function list() {
  return plugins.map(p => ({ name: p.name, file: p.file, description: p.description || "", commands: (p.commands || []).map(c => c.name) }));
}

async function handleCommand(cmd, ctx) {
  for (const p of plugins) {
    if (!p.commands) continue;
    const match = p.commands.find(c => c.name === cmd);
    if (match && typeof match.handler === "function") {
      try { return await match.handler(ctx); } catch (err) {
        console.error(`[PLUGIN] ${p.name}.${cmd} error: ${err.message}`);
        return { error: err.message };
      }
    }
  }
  return null;
}

async function runHooks(hookName, ctx) {
  const results = [];
  for (const p of plugins) {
    const fn = p[hookName];
    if (typeof fn === "function") {
      try { results.push(await fn(ctx)); } catch (err) { console.error(`[PLUGIN] ${p.name}.${hookName} err: ${err.message}`); }
    }
  }
  return results;
}

module.exports = { load, list, handleCommand, runHooks, PLUGINS_DIR };
