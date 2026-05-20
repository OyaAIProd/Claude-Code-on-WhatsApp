const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const sessMgr = require("./sessions_mgr");
const modelMgr = require("./models_mgr");

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const DEFAULT_CWD = process.env.CLAUDE_DEFAULT_CWD || os.homedir();
const CWDS_FILE = path.join(__dirname, "cwds.json");
const PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || "600000", 10);

const APPEND_SYSTEM = `Lo asisten Claude Code via Telegram. Ngomong casual Jakarta (gw/lo/kita). Jawab di akhir maks 2-3 paragraf ringkas — user di HP, screen kecil. Boleh emoji.

Saat user nyuruh BELI/JUAL crypto via paper-trading MCP: analisa dulu (get_price → get_indicators → ml_combined_signal → get_market_sentiment). Boleh tolak trade jelek dengan alasan spesifik (cite RSI angka, MACD direction). Jujur soal uncertainty.

Saat user minta chart: generate_candlestick_chart (default indicators ['ema20','ema50']) / generate_portfolio_chart. Sertakan URL chart lengkap di output — bot akan auto detect URL quickchart.io dan kirim sebagai foto.

Lo punya akses penuh Claude Code: file system, web search, semua MCP server, semua tool. Pakai sesuai kebutuhan task user.`;

function loadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {}
}

function resetSession(chatId) {
  sessMgr.dropCurrent(chatId);
}

function getCwd(chatId) {
  const c = loadJson(CWDS_FILE);
  return c[chatId] || DEFAULT_CWD;
}

function setCwd(chatId, cwd) {
  const c = loadJson(CWDS_FILE);
  c[chatId] = cwd;
  saveJson(CWDS_FILE, c);
}

function describeTool(name, input) {
  const i = input || {};
  if (name === "Bash") return `🖥️ Menjalankan: \`${(i.command || "").slice(0, 80)}\``;
  if (name === "Read") return `📄 Membaca: \`${i.file_path || ""}\``;
  if (name === "Edit" || name === "Write") return `✏️ Mengedit: \`${i.file_path || ""}\``;
  if (name === "Grep") return `🔍 Grep: "${(i.pattern || "").slice(0, 50)}"`;
  if (name === "Glob") return `📁 Glob: "${i.pattern || ""}"`;
  if (name === "WebSearch") return `🌐 Search web: "${(i.query || "").slice(0, 60)}"`;
  if (name === "WebFetch") return `🌐 Fetch: ${(i.url || "").slice(0, 60)}`;
  if (name === "TodoWrite" || name === "TaskCreate" || name === "TaskUpdate") return `📋 Update tasks`;
  if (name === "Agent") return `🤖 Spawn agent: ${i.description || ""}`;
  if (name.startsWith("mcp__paper-trading__")) {
    const tool = name.replace("mcp__paper-trading__", "");
    if (tool === "buy") return `💰 BUY ${i.symbol} Rp${i.amount_idr?.toLocaleString("id-ID") || "?"}`;
    if (tool === "sell") return `💸 SELL ${i.symbol} ${i.percent}%`;
    if (tool === "get_price") return `📊 Cek harga ${i.symbol}`;
    if (tool === "get_portfolio") return `💼 Cek portfolio`;
    if (tool === "get_indicators") return `📐 Indikator ${i.symbol}`;
    if (tool === "ml_combined_signal") return `🧠 ML signal ${i.symbol}`;
    if (tool === "generate_candlestick_chart") return `📊 Bikin candlestick ${i.symbol}`;
    if (tool === "generate_portfolio_chart") return `📈 Bikin chart portfolio`;
    if (tool === "get_crypto_news") return `📰 Berita ${i.coin || "crypto"}`;
    if (tool === "ml_combined_signal") return `🧠 Sinyal ML`;
    return `🔧 ${tool}`;
  }
  if (name.startsWith("mcp__")) return `🔧 MCP: ${name.replace("mcp__", "").replace(/_/g, " ")}`;
  return `🔧 ${name}`;
}

function runClaudeOnce(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let buffer = "";
    let finalText = "";
    let cost = 0;
    let err = "";
    const events = [];
    const to = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error(`Timeout ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          events.push(evt);
          if (evt.type === "result") {
            finalText = evt.result || finalText;
            cost = evt.total_cost_usd || 0;
          }
        } catch {}
      }
    });
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", (e) => { clearTimeout(to); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(to);
      resolve({ code, finalText, cost, err, events });
    });
  });
}

function dispatchEvent(evt, onEvent) {
  if (evt.type === "system" && evt.subtype === "init") {
    onEvent({ type: "init", session_id: evt.session_id, model: evt.model });
  } else if (evt.type === "assistant" && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === "tool_use") {
        onEvent({ type: "tool_use", name: block.name, input: block.input, label: describeTool(block.name, block.input) });
      } else if (block.type === "text" && block.text) {
        onEvent({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        onEvent({ type: "thinking" });
      }
    }
  } else if (evt.type === "user" && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === "tool_result") {
        onEvent({ type: "tool_result", id: block.tool_use_id, error: block.is_error });
      }
    }
  } else if (evt.type === "result") {
    onEvent({ type: "done", text: evt.result || "", cost: evt.total_cost_usd || 0, duration_ms: evt.duration_ms });
  }
}

async function streamMessage(userText, chatId, onEvent = () => {}) {
  const cwd = getCwd(chatId);
  const model = modelMgr.getModel(chatId);
  const baseArgs = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--model", model,
    "--permission-mode", PERMISSION_MODE,
    "--append-system-prompt", APPEND_SYSTEM,
    "--add-dir", cwd
  ];

  let sessionId = sessMgr.getCurrentId(chatId);
  let useResume = !!sessionId;
  let attempt = 0;

  while (attempt < 2) {
    attempt++;
    if (!sessionId) sessionId = crypto.randomUUID();
    const args = [...baseArgs];
    if (useResume) args.push("--resume", sessionId);
    else args.push("--session-id", sessionId);
    args.push(userText);

    const { code, finalText, cost, err, events } = await runClaudeOnce(args, cwd);

    for (const evt of events) dispatchEvent(evt, onEvent);

    if (code === 0 && finalText) {
      sessMgr.markSuccess(chatId, sessionId);
      return { text: finalText, cost, sessionId, model };
    }

    if (useResume && /No conversation found|session.*not.*found|invalid.*session/i.test(err)) {
      console.error(`[chat ${chatId}] session ${sessionId} expired, retry with new session`);
      sessMgr.dropCurrent(chatId);
      sessionId = null;
      useResume = false;
      continue;
    }

    throw new Error(`Claude CLI exit ${code}: ${(err || "no error output").slice(0, 300)}`);
  }
  throw new Error("Gagal setelah 2 percobaan.");
}

function extractChartUrls(text) {
  if (!text) return [];
  const m = text.match(/https:\/\/quickchart\.io\/chart\/render\/[a-zA-Z0-9_-]+/g) || [];
  return [...new Set(m)];
}

module.exports = { streamMessage, extractChartUrls, resetSession, getCwd, setCwd, DEFAULT_CWD };
