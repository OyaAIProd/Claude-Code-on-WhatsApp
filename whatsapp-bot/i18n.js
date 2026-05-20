const { db, getChatConfig, setChatConfig } = require("./storage");

const DICT = {
  id: {
    // System / setup
    setup_required: "Setup belum lengkap. Buka admin dashboard untuk konfigurasi awal.",
    boss_only: "❌ Boss only.",
    portfolio_not_found: "❌ Portfolio tidak ditemukan",
    invalid_format: "❌ Format gak valid",
    session_dropped: "✅ Session di-drop. Pesan berikutnya bikin session baru.",
    chat_id_label: "Chat ID lo",
    sender_jid_label: "Sender JID",
    // Setup/help
    help_intro: "🤖 *Claude Code di WhatsApp*\n\nFull agent — file system, web, MCP, semua tool.\n\n*Pakai:*\n- Text bebas / 🎤 voice note Indonesia\n- Slash command Claude diteruskan: */init*, */review*, dll",
    // Status
    processing: "⏳ _memproses..._",
    done: "✅ _selesai_",
    failed: "❌ _gagal_",
    receiving_file: "📥 _menerima file..._",
    voice_transcribed: "🎤",
    // Buttons
    pick_option: "_Reply nomor atau ketik /pilih <n>_",
    no_pending: "❌ Gak ada pertanyaan pending.",
    // Errors
    no_text: "_(jawaban kosong)_",
    error_prefix: "❌ Error:",
    budget_exceeded_title: "🚫 *Budget habis*",
    budget_reset_at: "Reset jam 00:00.",
    // Persona
    persona_changed: "✅ Persona →",
    // Translation
    lang_changed: "✅ Bahasa →",
    // Reminders
    reminder_set: "⏰ Reminder set:",
    reminder_fire_title: "⏰ *Reminder*",
    // Media
    file_received: "📎 File diterima:",
    image_silent_ack: "💾",
    // Workflows
    workflow_pending: "🔄 Workflow pending approval:",
    workflow_active: "✅ Workflow #",
    // Update
    update_available: "🆕 Update tersedia:",
    // Setup wizard prompts (system)
    casual_prompt: "Lo asisten Claude Code via WhatsApp. Ngomong casual Jakarta (gw/lo/kita). Reply singkat — WhatsApp screen kecil, max 2-3 paragraf. Boleh emoji secukupnya.",
    casual_prompt_group: "Lo asisten Claude Code di WhatsApp group chat. Ngomong casual Jakarta. Reply pendek banget — ini group chat, jangan kepanjangan. Boleh emoji."
  },
  en: {
    setup_required: "Setup incomplete. Open admin dashboard for initial config.",
    boss_only: "❌ Boss only.",
    portfolio_not_found: "❌ Portfolio not found",
    invalid_format: "❌ Invalid format",
    session_dropped: "✅ Session dropped. Next message creates new session.",
    chat_id_label: "Your Chat ID",
    sender_jid_label: "Sender JID",
    help_intro: "🤖 *Claude Code on WhatsApp*\n\nFull agent — file system, web, MCP, all tools.\n\n*Usage:*\n- Free text / 🎤 voice note (Indonesian)\n- Claude slash commands forwarded: */init*, */review*, etc",
    processing: "⏳ _processing..._",
    done: "✅ _done_",
    failed: "❌ _failed_",
    receiving_file: "📥 _receiving file..._",
    voice_transcribed: "🎤",
    pick_option: "_Reply with a number or type /pilih <n>_",
    no_pending: "❌ No pending question.",
    no_text: "_(empty reply)_",
    error_prefix: "❌ Error:",
    budget_exceeded_title: "🚫 *Budget exceeded*",
    budget_reset_at: "Resets at 00:00.",
    persona_changed: "✅ Persona →",
    lang_changed: "✅ Language →",
    reminder_set: "⏰ Reminder set:",
    reminder_fire_title: "⏰ *Reminder*",
    file_received: "📎 File received:",
    image_silent_ack: "💾",
    workflow_pending: "🔄 Workflow pending approval:",
    workflow_active: "✅ Workflow #",
    update_available: "🆕 Update available:",
    casual_prompt: "You are a Claude Code assistant via WhatsApp. Speak casually in English. Reply concisely — WhatsApp has small screens, max 2-3 paragraphs. Use emoji sparingly.",
    casual_prompt_group: "You are a Claude Code assistant in WhatsApp group chat. Speak casually. Keep replies very short — group chat shouldn't be too long. Use emoji."
  }
};

const DEFAULT_LANG = process.env.DEFAULT_LANG || "id";

function getLang(chatId) {
  const cfg = getChatConfig(chatId);
  return cfg?.ui_lang || DEFAULT_LANG;
}

function setLang(chatId, lang) {
  if (!DICT[lang]) return false;
  setChatConfig(chatId, { ui_lang: lang });
  return true;
}

function t(chatId, key, fallback = null) {
  const lang = getLang(chatId);
  const dict = DICT[lang] || DICT[DEFAULT_LANG];
  return dict[key] || DICT[DEFAULT_LANG][key] || fallback || key;
}

function availableLangs() {
  return Object.keys(DICT);
}

module.exports = { t, getLang, setLang, availableLangs, DICT, DEFAULT_LANG };
