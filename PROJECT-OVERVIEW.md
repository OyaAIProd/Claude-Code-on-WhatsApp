# 🚀 Project Overview — Claude Code Personal Operating System

## TL;DR

Stack lengkap untuk **Claude Code di HP via WhatsApp/Telegram**, otomasi trading paper crypto, manajemen bisnis (futsal), dengan kemampuan:
- Listen semua group WhatsApp + memory cross-chat permanent
- Eksekusi tool: file ops, web search, code edit, MCP servers
- Auto-translate, voice transcribe, image vision, file analysis
- Per-user token budget, audit log, RAG with vector embeddings
- Web dashboard, interactive buttons, mini-workflows
- 100% run di Termux Android — datacenter di saku

---

## 🏗️ Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│  USER INPUT                                             │
│  ┌──────────────┬──────────────┬──────────────┐         │
│  │  WhatsApp    │   Telegram   │  Web Browser │         │
│  │  (HP/Group)  │   (HP)       │  (Dashboard) │         │
│  └──────┬───────┴──────┬───────┴──────┬───────┘         │
└─────────┼──────────────┼──────────────┼─────────────────┘
          │              │              │
   ┌──────▼──────────────▼──────────────▼──────┐
   │  BOT LAYER (Node.js, di Termux/PC)         │
   │  • whatsapp-bot/ (Baileys WS)              │
   │  • telegram-bot/ (long-poll)               │
   │  • futsal-mcp/dashboard/ (Express)         │
   └────────────────────┬───────────────────────┘
                        │
   ┌────────────────────▼───────────────────────┐
   │  AI ENGINE                                  │
   │  • Claude Code CLI spawn (subprocess)       │
   │  • OAuth subscription Claude.ai             │
   │  • Stream-json output, watchdog 120s       │
   │  • Per-chat session UUID + multi-session   │
   │  • Effort levels: low/medium/high/xhigh/max │
   └────────────────────┬───────────────────────┘
                        │
   ┌────────────────────▼───────────────────────┐
   │  MCP SERVERS (tool ecosystem)               │
   │  • paper-trading (81 tools)                 │
   │  • futsal-mcp (24 tools)                    │
   │  • Built-in: Bash/Read/Write/Edit/Web/...   │
   └────────────────────┬───────────────────────┘
                        │
   ┌────────────────────▼───────────────────────┐
   │  STORAGE                                    │
   │  • SQLite (WAL mode) per project            │
   │  • FTS5 full-text search                    │
   │  • Vector embeddings (MiniLM 384-dim)       │
   │  • Daily auto-backup, rotation              │
   └─────────────────────────────────────────────┘
```

---

## 📦 Komponen Utama

### 1. `paper-trading/` (MCP Server, 81 tools)
Simulator trading crypto realistis dengan:
- Real-time WebSocket prices (Binance + Coinbase + Kraken multi-exchange)
- Slippage + bid/ask spread simulation
- Limit/stop orders, trailing stop loss, auto SL/TP
- 5 ML models: linear regression, logistic regression, Markov chain, combined signal
- Backtest engine: composable strategies, parameter sweep, walk-forward
- Live trading bot otomatis berdasarkan ML signal
- Margin trading (LONG/SHORT) dengan liquidation
- Tax report PPh 0.1% Indonesia (FIFO)
- News-driven trader (RSS poll + AI sentiment)
- Copy trading antar portfolio
- Multi-portfolio A/B testing
- Native chart generation (candlestick + Fibonacci + EMA + Bollinger + pattern detection)
- Push notification via ntfy.sh

### 2. `whatsapp-bot/` (Bridge ke Claude Code)
- **Baileys** unofficial WhatsApp Web protocol
- Listen SEMUA group + DM
- Boss whitelist + secret code untuk auto-promote
- Voice note Indonesia → Groq Whisper transcribe
- Image silent save + Groq vision background describe
- File auto-download (PDF/DOCX/XLSX/PPTX) + auto-extract text
- File generation native (PDF via pdfkit, DOCX via docx, XLSX via xlsx, PPTX via pptxgenjs)
- Cross-chat RAG (FTS5 + vector semantic search)
- Group profile auto-gen (apa group bahas, members, topik)
- User profile memory (sifat, gaya komunikasi, minat)
- Multi-respon queue (proses paralel pesan susulan)
- Streaming progress message dengan emoji reaction ⏳→✅
- Per-chat: session, model, effort, persona, cwd, permission mode
- Multi-session per chat (`/sessions /resume /new`)
- Interactive buttons via marker `[BUTTONS: yes|no]` + remember decisions
- Auto-translate incoming foreign language (Groq llama-3.3-70b)
- 19 bahasa support dengan numbered language picker
- Per-user token budget (default $0.5/hari, boss $10) dengan daily reset
- Audit log immutable, daily auto-backup SQLite rotate keep 7
- PII detection (KTP/NPWP/credit card/API key/password) auto-flag
- Mini workflows: boss instruct natural → Claude bikin plan → approval → fire on trigger
- Reminder + cron scheduler (`/remind 30m call John` / `/cron add "0 8 * * *" ringkasin chat`)
- Calendar events + ICS export (no Google OAuth)
- Knowledge base import (URL/file/text) → FTS5 indexed → auto-inject ke RAG
- Plugin system (drop .js ke `plugins/` → hot reload)
- Persona switcher (casual, formal, professional, funny, technical, supportive, auto-detect)

### 3. `telegram-bot/` (Bridge ke Claude Code)
Sama arsitektur whatsapp-bot, beda kanal:
- Long-poll Telegram Bot API
- Auto-load `.env` via dotenv
- Voice note Indonesia → Groq Whisper
- Streaming progress via Telegram edit message
- Chart auto-send sebagai photo (QuickChart URL)
- Multi-session + multi-model per chat
- Slash command forward (`/init`, `/review`, `/skill-name` → Claude native)
- Custom system prompt: "AI trader independen, gak penurut"

### 4. `futsal-mcp/` (Business management, 24 tools)
- Booking management (slot/field/date/team/phone)
- Member CRUD + leaderboard
- Pricing per slot per day_type
- Knowledge base FAQ dengan FTS5
- Expense tracking + summary
- P&L report (revenue - expenses)
- Field closure scheduling
- Audit log
- Web dashboard `localhost:3457` dengan:
  - KPI cards (bookings, members, revenue, expenses, profit 30d)
  - Schedule grid (hijau/merah per slot)
  - Booking CRUD UI
  - Member top list
  - KB CRUD + search
  - Expense tracker
  - Audit log viewer

### 5. **Worker** (background service)
- Standalone proses, jalan walau Claude Code mati
- Handle: limit/stop order trigger, SL/TP, DCA, news poll, bot tick, equity snapshot
- PID file detection — MCP server skip ticks kalau worker aktif
- Survives reboot via PM2 + Termux:Boot

---

## 🎯 Use Cases

### Personal Trading
- Boss DM bot: "analisa BTC + suggest entry" → Claude pakai paper-trading MCP, fetch indicators+ML+news, kasih verdict + suggest limit price
- Voice note: "beli BTC 500rb dengan SL 5% TP 3%" → Claude eksekusi
- Worker monitor: harga touch TP → auto-sell, push notif ke HP via ntfy

### Group Management
- Bot di-add ke 10 group WA → silent listen + log
- User di group lain DM: "kapten JS sudah dimana?" → RAG search semua chat → "Kemarin di group _Tim Pelayaran_ dia bilang lagi di Pelabuhan Tanjung Priok"
- Kirim PDF laporan ke group → auto-extract → tersedia buat tanya kapan aja "isi laporan q1 apa?"

### Bisnis Futsal
- Customer WA group: "ada slot lapangan 2 jam 7 malem besok gak?" → bot pakai futsal MCP check_availability → reply
- Boss DM: "booking untuk tim Putra besok 19:00, hp 0812..." → bot eksekusi
- "Total revenue bulan ini" → futsal MCP profit_loss → reply + ICS file kalender

### Automation
- "Setiap pagi jam 7 ringkasin chat group semalem" → cron task → Claude auto-execute
- "Kalau ada PDF di group X, summarize lalu kirim ke gw" → mini-workflow → fire on file trigger

---

## 🔐 Security

- HTTP Basic auth dashboard
- Boss whitelist by phone number match (strip device suffix `:23`, domain agnostic)
- Secret code rotation
- Per-user token budget daily reset
- Audit log immutable
- PII regex detection (9 patterns)
- Permission modes: bypass/default/acceptEdits/plan/dontAsk
- Safe mode toggle (Claude minta YA dulu sebelum tool risky)
- Encryption at rest (TODO/opt-in)

---

## 💰 Cost Estimate

| Item | Monthly |
|---|---|
| Claude.ai Pro/Max subscription | $20-100 |
| Groq Whisper + Vision (free tier) | $0 |
| WhatsApp / Telegram API | $0 |
| Termux + Android phone | $0 |
| QuickChart (charts) | $0 |
| ntfy.sh (push) | $0 |
| **Total** | **$20-100/bulan** |

vs. enterprise SaaS competitor: $500-2000/bulan.

---

## 📊 Stats

- **Lines of code**: ~12,000+ across all projects
- **Modules**: 50+
- **MCP tools**: 105 (81 paper-trading + 24 futsal)
- **Bot commands**: 60+ slash commands
- **Database tables**: 30+
- **Languages supported**: 19
- **Personas**: 6 (auto-detect)
- **File formats**: PDF, DOCX, XLSX, PPTX, TXT, CSV, JSON, MD + image (PNG/JPG/WebP)
- **Indicators**: RSI, MACD, EMA, Bollinger, Stochastic, Pattern detection
- **Strategies (backtest)**: ema_cross, rsi_meanrev, bb_breakout, ema_rsi_combo
- **Background workers**: 7 (orders, positions, watchlist, DCA, bot, profile gen, embeddings backfill)

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **DB**: SQLite (WAL) via better-sqlite3
- **Search**: FTS5 + vector embeddings (@xenova/transformers, MiniLM-L6-v2)
- **Bot lib**: @whiskeysockets/baileys (WA), native fetch (TG)
- **AI**: Claude Code CLI (subscription), Groq (Whisper/Vision/LLM cheap)
- **MCP SDK**: @modelcontextprotocol/sdk
- **Chart**: QuickChart.io (server-side render)
- **PDF gen**: pdfkit, mammoth (DOCX), xlsx (Excel), pptxgenjs
- **HTTP**: Express
- **Process mgr**: PM2
- **Schedule**: native cron parser
- **OS**: Termux Android / Windows / Linux / macOS

---

## 🚀 Quick Start

### Windows (Dev)
```powershell
git clone <repo> && cd paper-trading
foreach ($d in "paper-trading-mcp","whatsapp-bot","telegram-bot","futsal-mcp") { cd $d; npm install; cd .. }
# Setup .env per project
# Run via npm start tiap project (4 terminal)
```

### Termux Android (Production)
Lihat `TERMUX-SETUP.md` — 13 langkah lengkap.

---

## 📞 Support

Repo: `<your-github>` · Issues: GitHub Issues · Updates: `./update.sh` (auto git pull + npm install + PM2 restart)
