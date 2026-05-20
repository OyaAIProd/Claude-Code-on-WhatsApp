# Paper Trading Telegram ↔ Claude Code Bridge

Bridge Telegram ke **Claude Code CLI beneran** (bukan API langsung). Pakai login Claude.ai subscription lo, bukan API billing terpisah. Akses penuh ke 77 paper-trading tools + semua MCP server + slash command + memory system.

## Cara kerja

```
HP lo (Telegram) ──polling──→ index.js
                                  ↓
                              ai.js spawn:
                              claude --print --output-format json
                                     --resume <session-uuid>
                                     --model sonnet
                                     --permission-mode bypassPermissions
                                     --append-system-prompt "<persona>"
                                     "<pesan user>"
                                  ↓
                              Claude Code CLI loop
                              (paper-trading MCP auto-loaded
                               kalau udah konfigurasi di Claude Code)
                                  ↓
                              JSON output → parse
                              extract QuickChart URL → sendPhoto
                              kirim text ke Telegram
```

## Setup

### 1. Pastikan Claude Code login OAuth
```powershell
claude login   # buka browser, login ke Claude.ai subscription lo
```
Bot bakal pake credentials ini, jadi cost dipotong dari subscription, bukan API billing terpisah.

### 2. Konfigurasi paper-trading MCP di Claude Code
Pastikan MCP `paper-trading` udah terdaftar di Claude Code config (`~/.claude/settings.json` atau project `.claude/settings.json`). Cek di Claude Code: ketik `/mcp` — `paper-trading` harus muncul.

### 3. Telegram bot token
1. Chat ke [@BotFather](https://t.me/botfather), `/newbot`, catat token
2. Cari bot lo via username, `/start` di Telegram

### 4. Env vars
```powershell
$env:TELEGRAM_BOT_TOKEN = "123456:ABC..."
$env:TELEGRAM_ALLOWED_CHAT_IDS = "your-chat-id"   # opsional, /id command

# Opsional override
$env:CLAUDE_BIN = "claude"                # path ke binary (default: claude di PATH)
$env:CLAUDE_MODEL = "sonnet"              # sonnet/opus/haiku alias atau full ID
$env:CLAUDE_PERMISSION_MODE = "bypassPermissions"   # acceptEdits/auto/default/plan
$env:CLAUDE_TIMEOUT_MS = "180000"         # 3 menit
```

### 5. Run
```powershell
cd telegram-bot
npm install
npm start
```

## Commands

- `/start` — pesan intro
- `/reset` — clear session memory (Claude lupa semua chat sebelumnya)
- `/id` — tampilin chat ID lo

## Contoh chat

| Lo kirim | Behavior |
|---|---|
| "harga BTC" | call `get_price`, reply singkat |
| "analisa ETH" | indicators+ML+sentiment → verdict spesifik |
| "beli BTC 500rb" | Analisa dulu. Kalau RSI overbought / ML SELL → **NOLAK** + saran "pasang BUY_LIMIT di Rp X" |
| "candlestick BTC 30d + fibonacci" | `generate_candlestick_chart` → kirim photo + jelasin pola |
| "untung rugi gw" | `generate_portfolio_chart` → equity curve photo |
| "start bot SOL" | `start_bot` (Claude bakal konfirmasi setup dulu) |

## Session

Tiap chat ID Telegram dipetakan ke UUID session Claude Code. Disimpan di `sessions.json`. Conversation persist antar pesan — Claude inget context sebelumnya.

`/reset` hapus mapping, conversation berikutnya mulai fresh.

## Cost

Pakai subscription Claude.ai lo (Pro/Max). Gak ada tambahan API charge. Cost dipotong dari quota subscription via OAuth.

Kalau lo prefer API billing terpisah (bukan subscription), set `ANTHROPIC_API_KEY` di env — Claude Code bakal pake itu instead.

## File

```
telegram-bot/
├── index.js       (entry — Telegram polling loop)
├── ai.js          (spawn claude CLI subprocess)
├── telegram.js    (Bot API wrapper: sendMessage/sendPhoto)
├── README.md      (file ini)
├── package.json
└── sessions.json  (auto-generated mapping chat_id → uuid)
```

## Permission mode

Default `bypassPermissions` — Claude eksekusi tool tanpa nanya. ⚠️ Karena bot expose ke Telegram, set `TELEGRAM_ALLOWED_CHAT_IDS` ke chat ID lo aja biar orang lain gak bisa nyuruh Claude ngapa-ngapain.

Kalau mau lebih hati-hati, pake `acceptEdits` (Claude tetep nanya untuk Bash + risky ops, tapi tool MCP paper-trading aman karena gak ngubah filesystem).

## Troubleshooting

- **`Claude CLI exit N` error**: cek `claude --version` working di terminal lo, dan udah `claude login`
- **Tool gak kepanggil**: cek `/mcp` di Claude Code → `paper-trading` harus connected
- **Chart gak muncul**: bot detect URL `https://quickchart.io/chart/render/...` dari Claude output. Pastikan tool `generate_candlestick_chart` jalan: tes manual `node -e "require('./src/charts.js').generateCandlestickChart({symbol:'BTC',days:7}).then(console.log)"`
- **Session lost**: `/reset` aja, mulai fresh
