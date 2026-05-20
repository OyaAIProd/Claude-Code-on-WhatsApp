# WhatsApp ↔ Claude Code Bridge

Bridge WhatsApp ke **Claude Code CLI beneran**. Pakai library [Baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp Web protocol, no browser).

⚠️ **WARNING**: WhatsApp BISA BANNED akun otomatis. Pakai nomor disposable yang lo gak sayang. Risiko di lo.

## Fitur

- 📱 Login pakai QR code (sekali, persist di `data/auth/`)
- 👥 Aktif di SEMUA group + DM
- 📋 Log semua pesan ke SQLite (untuk summarize + cari)
- 🎯 Trigger respond:
  - **Group**: kalau di-mention `@bot` atau di-reply
  - **DM**: kalau sender boss atau `/dm-on` toggled
- 👑 Boss whitelist — cuma boss bisa configure (model, dll)
- 🧠 Per-chat Claude session — context persist
- 🔍 Summarize / cari pesan / siapa ngomong apa

## Setup

### 1. Install
```powershell
cd whatsapp-bot
npm install
```

### 2. Set boss awal di `.env`
```
WA_INITIAL_BOSSES=628123456789,628987654321
```
Format: nomor international tanpa `+`, tanpa spasi. Bisa kosongin, set runtime via `/boss-add`.

### 3. Run
```powershell
npm start
```

### 4. Scan QR
- Terminal muncul QR code
- Buka WhatsApp di HP nomor disposable lo → **Settings → Linked Devices → Link a Device** → scan QR
- Saat connect, log: `✅ Connected sebagai: 628XXX@s.whatsapp.net`

Session disimpan di `data/auth/`. Restart bot = auto-connect, gak perlu scan lagi.

## Commands (di chat WhatsApp)

### Umum (siapa aja)
| Command | Fungsi |
|---|---|
| `/help` | Tampilin help |
| `/summarize [N]` | Ringkas N pesan terakhir (default 30) |
| `/whosaid <keyword>` | Cari pesan dengan keyword |
| `/recent [N]` | Tampilin N pesan terakhir |
| `/model` | Liat model AI sekarang |

### Boss only
| Command | Fungsi |
|---|---|
| `/model sonnet\|opus\|haiku` | Ganti model (per chat) |
| `/boss-add <number>` | Tambah boss |
| `/boss-remove <number>` | Hapus boss |
| `/list-bosses` | Daftar boss |
| `/list-chats` | Daftar chat yg pernah dipantau |
| `/reset` | Clear Claude session |
| `/dm-on` `/dm-off` | Toggle auto-respond DM non-boss |
| `/listen-on` `/listen-off` | Listen only mode (no reply, cuma log) |

## Trigger Behavior

### Group
Bot **selalu log** pesan, tapi cuma reply kalau:
- Di-mention `@<bot-number>`
- Di-reply (quote bot's previous message)
- Pesan diawali `/` (command)

### DM (Personal)
- **Sender boss** → respond
- **Non-boss** → ignore (kecuali `/dm-on` di-toggle)
- Bot reply via `/help` etc tetap berlaku

### Cooldown
3 detik antar reply per chat — anti-spam.

## Contoh Pakai

### Pertama kali setup
```
1. npm start (QR muncul)
2. Scan dari HP nomor disposable
3. ✅ Connected
4. DM bot dari nomor lo: /boss-add 628XXXX (nomor lo)
5. ✅ Sekarang lo bisa configure
```

### Di group, mention bot
```
User: "@ClaudeBot summarize 50 pesan terakhir dong"
Bot: "Oke, ini ringkasannya:
     - Andi nanya soal trading BTC ke Budi
     - Budi reply suggest tunggu support Rp 800k
     - Cici nimbrung soal news Fed rate..."
```

### Tanya isi group
```
Boss DM bot: "summarize group 'Crypto Indonesia' 30 menit terakhir"
Bot: (forward ke Claude, dapet context dari DB, return summary)
```

### Ganti model per chat
```
Boss: /model opus
Bot: ✅ Model → opus
(chat berikutnya pakai opus)
```

### Search pesan
```
User: /whosaid bitcoin
Bot: 🔍 Hasil "bitcoin":
     • Andi: "BTC nyentuh 800k tadi"
     • Budi: "btc bullish nih"
```

## Storage

DB di `data/wa.db`:
- `messages` — semua pesan masuk (text + quoted + mentions + timestamp)
- `bosses` — whitelist
- `chat_config` — per-chat session + model + flags

DB ini **terpisah** dari paper-trading DB. Bisa di-backup/restore independen.

## Architecture

```
WhatsApp (HP) ──QR pair──→ Baileys (WebSocket ke server WA)
                              ↓
                         index.js handleMessage
                              ↓
                    storage.js (save all messages)
                              ↓
                  Trigger? (mention/reply/DM-boss/command)
                              ↓
                       ai.js spawn:
                       claude --print --output-format stream-json
                              --resume <chat-session-uuid>
                              --append-system-prompt "<persona>"
                              + context = recent 25 messages
                       "<user-text>"
                              ↓
                       sock.sendMessage(chatId, {text, quoted})
```

## Permission Mode

`bypassPermissions` default — Claude eksekusi tool tanpa nanya. Karena bot baca pesan group, **boss whitelist crucial**. Non-boss gak bisa trigger Claude.

## Cost

- WhatsApp: gratis
- Claude: subscription Claude.ai lo
- Per reply: ~2-5k token = ~$0.01-0.05

## Risk + Mitigasi

| Risk | Mitigasi |
|---|---|
| WA ban akun otomatis | Pakai nomor disposable, jangan main, jangan spam |
| Boss whitelist bypass | Cek `bosses` table di DB, hanya jid exact match |
| Pesan sensitif ter-log | Semua pesan di-store. Hapus DB kalau perlu |
| Cost meledak | Cooldown 3s per chat. Set `/listen-off` group rame |
| QR session expired | Hapus `data/auth/`, restart, scan ulang |

## File Structure

```
whatsapp-bot/
├── index.js          - entry, Baileys connection, handler
├── storage.js        - SQLite log + chat config
├── bosses.js         - whitelist
├── ai.js             - spawn Claude CLI, context build
├── package.json
├── .env              - WA_INITIAL_BOSSES, CLAUDE_MODEL
├── .env.example
└── data/
    ├── auth/         - Baileys session (jangan share!)
    └── wa.db         - SQLite messages + config
```

## Troubleshooting

- **QR gak muncul**: tunggu 5-10 detik. Atau hapus `data/auth/`, restart
- **Loop reconnect**: cek log error code. 401 = logged out, hapus auth folder
- **Bot gak reply mention**: cek `botJid` di log, mungkin gagal extract. Set `LOG_LEVEL=debug`
- **Pesan gak ke-save**: cek SQLite di `data/wa.db` via `sqlite3 wa.db "SELECT * FROM messages LIMIT 5"`
- **Claude CLI error**: tes manual `claude --print "halo"` di terminal lo
