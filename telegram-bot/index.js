require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const fs = require("fs");
const path = require("path");
const { startPolling, sendMessage, sendPhoto, editMessageText, sendChatAction, setMyCommands } = require("./telegram");
const { streamMessage, extractChartUrls, resetSession, getCwd, setCwd, DEFAULT_CWD } = require("./ai");
const { transcribeTelegramVoice } = require("./voice");
const sessMgr = require("./sessions_mgr");
const modelMgr = require("./models_mgr");

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

class ProgressTracker {
  constructor(chatId) {
    this.chatId = chatId;
    this.messageId = null;
    this.steps = [];
    this.lastEdit = 0;
    this.MIN_INTERVAL = 1500;
    this.pending = null;
  }
  async init(prefix = "⏳ *Memproses...*") {
    const r = await sendMessage(this.chatId, prefix);
    this.messageId = r?.result?.message_id;
    this.prefix = prefix;
  }
  addStep(label) {
    this.steps.push(label);
    this.scheduleUpdate();
  }
  scheduleUpdate() {
    const now = Date.now();
    if (now - this.lastEdit >= this.MIN_INTERVAL) {
      this.doUpdate();
    } else if (!this.pending) {
      const wait = this.MIN_INTERVAL - (now - this.lastEdit);
      this.pending = setTimeout(() => { this.pending = null; this.doUpdate(); }, wait);
    }
  }
  async doUpdate() {
    if (!this.messageId) return;
    this.lastEdit = Date.now();
    const recent = this.steps.slice(-10);
    const text = `${this.prefix}\n\n${recent.join("\n")}`;
    try { await editMessageText(this.chatId, this.messageId, text); } catch {}
  }
  async finalize() {
    if (this.pending) { clearTimeout(this.pending); this.pending = null; }
    if (!this.messageId) return;
    try {
      const summary = this.steps.length ? `✅ *Selesai* (${this.steps.length} langkah)` : "✅ *Selesai*";
      await editMessageText(this.chatId, this.messageId, summary);
    } catch {}
  }
}

async function processUserMessage(chatId, text) {
  const tracker = new ProgressTracker(chatId);
  await tracker.init();
  try {
    const result = await streamMessage(text, chatId, (evt) => {
      if (evt.type === "tool_use") {
        tracker.addStep(evt.label);
      } else if (evt.type === "thinking") {
        tracker.addStep("💭 berpikir...");
      } else if (evt.type === "init") {
        tracker.addStep(`🚀 session ${evt.session_id?.slice(0, 8)} ${evt.model || ""}`);
      }
    });
    await tracker.finalize();

    const chartUrls = extractChartUrls(result.text);
    for (const url of chartUrls) {
      await sendPhoto(chatId, url, "");
    }
    if (result.text) {
      const clean = result.text.replace(/https:\/\/quickchart\.io\/chart\/render\/[a-zA-Z0-9_-]+/g, "[chart ⬆]");
      const curSess = sessMgr.listSessions(chatId).find(s => s.id === result.sessionId);
      const meta = `_${result.model} | ${curSess?.name || "session"} | $${(result.cost || 0).toFixed(4)}_`;
      await sendMessage(chatId, clean + "\n\n" + meta);
    } else {
      await sendMessage(chatId, "(jawaban kosong)");
    }
  } catch (err) {
    console.error("processUserMessage error:", err);
    if (tracker.messageId) {
      try { await editMessageText(chatId, tracker.messageId, `❌ Error: ${err.message.slice(0, 400)}`); } catch {}
    } else {
      await sendMessage(chatId, `❌ Error: ${err.message.slice(0, 400)}`);
    }
  }
}

async function onMessage(update) {
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;

  if (msg.voice) {
    await sendChatAction(chatId, "typing");
    let transcript;
    try {
      transcript = await transcribeTelegramVoice(msg.voice.file_id, TG_TOKEN);
      if (!transcript) throw new Error("Transkrip kosong");
    } catch (err) {
      return sendMessage(chatId, `❌ Gagal transkrip voice: ${err.message}`);
    }
    await sendMessage(chatId, `🎤 _"${transcript}"_`);
    return processUserMessage(chatId, transcript);
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const argText = text.slice(cmd.length).trim();

  if (cmd === "/start" || cmd === "/help") {
    return sendMessage(chatId, `🤖 *Claude Code di HP*\n\nFull agent — file system, web, MCP, semua tool.\n\n*Pakai:*\n- Text bebas / 🎤 voice note Indonesia\n- Slash command Claude diteruskan: */init*, */review*, dll\n\n*Session:*\n/sessions - list semua session\n/resume <n> - pindah ke session ke-n\n/new [name] - bikin session baru\n/rename <name> - rename current\n/delete <n> - hapus session\n/reset - hapus current session\n\n*Model:*\n/model - liat model sekarang\n/model sonnet|opus|haiku - ganti\n\n*Folder:*\n/cd <path> - ganti cwd\n/pwd - tampilin cwd\n/home - reset cwd\n\n*Lain:*\n/id - chat ID lo`);
  }

  if (cmd === "/reset") {
    resetSession(chatId);
    return sendMessage(chatId, "✅ Current session di-drop. Pesan berikutnya bikin session baru.");
  }
  if (cmd === "/id") return sendMessage(chatId, `Chat ID lo: \`${chatId}\``);

  if (cmd === "/pwd") return sendMessage(chatId, `📂 cwd: \`${getCwd(chatId)}\``);
  if (cmd === "/home") {
    setCwd(chatId, DEFAULT_CWD);
    return sendMessage(chatId, `✅ cwd → \`${DEFAULT_CWD}\``);
  }
  if (cmd === "/cd") {
    if (!argText) return sendMessage(chatId, "❌ Format: /cd <path>");
    let absPath = argText;
    if (!path.isAbsolute(argText)) absPath = path.resolve(getCwd(chatId), argText);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
      return sendMessage(chatId, `❌ Folder gak ada: \`${absPath}\``);
    }
    setCwd(chatId, absPath);
    return sendMessage(chatId, `✅ cwd → \`${absPath}\``);
  }

  if (cmd === "/sessions" || cmd === "/list") {
    const list = sessMgr.listSessions(chatId);
    if (!list.length) return sendMessage(chatId, "📭 Belum ada session. Kirim pesan biasa untuk bikin yang pertama.");
    const cur = sessMgr.getCurrentId(chatId);
    const lines = list.map((s, i) => {
      const mark = s.id === cur ? "👉" : "  ";
      const lastUsed = s.last_used ? s.last_used.slice(0, 16).replace("T", " ") : "?";
      return `${mark} *${i + 1}.* ${s.name}\n      \`${s.id.slice(0, 8)}\` | ${lastUsed}`;
    });
    return sendMessage(chatId, `📂 *SESSIONS (${list.length})*\n\n${lines.join("\n")}\n\nPakai: /resume <nomor> atau /resume <uuid>`);
  }

  if (cmd === "/resume") {
    if (!argText) return sendMessage(chatId, "❌ Format: /resume <nomor>\nLiat /sessions dulu.");
    const r = sessMgr.resumeBy(chatId, argText);
    if (!r) return sendMessage(chatId, `❌ Session "${argText}" gak ada. Liat /sessions.`);
    return sendMessage(chatId, `✅ Pindah ke session: *${r.name}*\n\`${r.id.slice(0, 8)}\``);
  }

  if (cmd === "/new") {
    const id = sessMgr.newSession(chatId, argText || null);
    return sendMessage(chatId, `✨ Session baru: *${argText || "session"}*\n\`${id.slice(0, 8)}\`\n\nKirim pesan biasa untuk mulai.`);
  }

  if (cmd === "/rename") {
    if (!argText) return sendMessage(chatId, "❌ Format: /rename <nama baru>");
    const ok = sessMgr.renameCurrent(chatId, argText);
    return sendMessage(chatId, ok ? `✅ Session di-rename: *${argText}*` : "❌ Gak ada current session.");
  }

  if (cmd === "/delete") {
    if (!argText) return sendMessage(chatId, "❌ Format: /delete <nomor>");
    const d = sessMgr.deleteSession(chatId, argText);
    return sendMessage(chatId, d ? `🗑️ Session dihapus: *${d.name}*` : `❌ Session "${argText}" gak ada.`);
  }

  if (cmd === "/model") {
    if (!argText) {
      const cur = modelMgr.getModel(chatId);
      return sendMessage(chatId, `🧠 Model sekarang: *${cur}*\n\nGanti: /model sonnet | opus | haiku\nValid: ${modelMgr.VALID.join(", ")}, atau full ID claude-...`);
    }
    if (!modelMgr.isValid(argText)) {
      return sendMessage(chatId, `❌ Model gak valid: "${argText}"\nValid: ${modelMgr.VALID.join(", ")}, atau full ID claude-...`);
    }
    modelMgr.setModel(chatId, argText);
    return sendMessage(chatId, `✅ Model → *${argText}*`);
  }

  return processUserMessage(chatId, text);
}

async function registerCommands() {
  const cmds = [
    { command: "help", description: "Cara pakai bot" },
    { command: "sessions", description: "List semua session" },
    { command: "resume", description: "Pindah ke session lain" },
    { command: "new", description: "Bikin session baru" },
    { command: "rename", description: "Rename current session" },
    { command: "delete", description: "Hapus session" },
    { command: "reset", description: "Drop current session" },
    { command: "model", description: "Ganti / liat model AI" },
    { command: "pwd", description: "Tampilin folder kerja" },
    { command: "cd", description: "Ganti folder kerja" },
    { command: "home", description: "Reset cwd ke home" },
    { command: "id", description: "Tampilin chat ID" },
    { command: "init", description: "Claude: init CLAUDE.md" },
    { command: "review", description: "Claude: review code" },
    { command: "security-review", description: "Claude: security audit" }
  ];
  await setMyCommands(cmds);
  console.error(`✅ Registered ${cmds.length} Telegram /menu commands`);
}

(async () => {
  console.error("🚀 Paper Trading Telegram ↔ Claude Code Bridge v2");
  console.error(`Model: ${process.env.CLAUDE_MODEL || "sonnet"}`);
  console.error(`Permission: ${process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions"}`);
  console.error(`Default cwd: ${DEFAULT_CWD}`);
  console.error(`Voice: ${process.env.GROQ_API_KEY ? "🟢 Groq Whisper" : "🔴 GROQ_API_KEY missing"}`);
  if (!TG_TOKEN) console.error("❌ TELEGRAM_BOT_TOKEN missing");
  await registerCommands();
  await startPolling(onMessage);
})();
