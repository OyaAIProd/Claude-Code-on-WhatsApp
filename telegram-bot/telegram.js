const fetch = require("node-fetch");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN belum diset. Set env var dulu.");
}

const BASE = `https://api.telegram.org/bot${TOKEN}`;

function isAllowed(chatId) {
  if (!ALLOWED_CHAT_IDS.length) return true;
  return ALLOWED_CHAT_IDS.includes(String(chatId));
}

async function sendMessage(chatId, text, opts = {}) {
  try {
    const body = { chat_id: chatId, text: text.slice(0, 4000), parse_mode: opts.parse_mode || "Markdown", disable_web_page_preview: true };
    const res = await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.json();
  } catch (err) {
    console.error("sendMessage error:", err.message);
  }
}

async function sendPhoto(chatId, photoUrl, caption) {
  try {
    const body = { chat_id: chatId, photo: photoUrl, caption: caption?.slice(0, 1000) || "", parse_mode: "Markdown" };
    const res = await fetch(`${BASE}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.json();
  } catch (err) {
    console.error("sendPhoto error:", err.message);
  }
}

async function setMyCommands(commands) {
  try {
    const res = await fetch(`${BASE}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands })
    });
    return res.json();
  } catch (err) {
    console.error("setMyCommands error:", err.message);
  }
}

async function editMessageText(chatId, messageId, text, opts = {}) {
  try {
    const body = { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000), parse_mode: opts.parse_mode || "Markdown", disable_web_page_preview: true };
    const res = await fetch(`${BASE}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.json();
  } catch (err) {
    console.error("editMessageText error:", err.message);
  }
}

async function sendChatAction(chatId, action = "typing") {
  try {
    await fetch(`${BASE}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action })
    });
  } catch {}
}

let offset = 0;
let polling = false;

async function startPolling(handler) {
  if (!TOKEN) return;
  polling = true;
  console.error("🤖 Telegram bot polling started...");
  while (polling) {
    try {
      const res = await fetch(`${BASE}/getUpdates?offset=${offset}&timeout=30`, { timeout: 35000 });
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const u of data.result) {
          offset = u.update_id + 1;
          if (u.message && u.message.chat && !isAllowed(u.message.chat.id)) {
            await sendMessage(u.message.chat.id, "❌ Chat ID lo belum diizinkan. Set TELEGRAM_ALLOWED_CHAT_IDS di env, atau kosongkan untuk allow semua.");
            continue;
          }
          handler(u).catch(err => console.error("handler error:", err.message));
        }
      }
    } catch (err) {
      console.error("polling error:", err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

function stopPolling() { polling = false; }

module.exports = { sendMessage, sendPhoto, editMessageText, sendChatAction, setMyCommands, startPolling, stopPolling, isAllowed };
