# 📱 Termux Setup Guide — Run 100% di Android

Panduan setup full stack: paper-trading MCP + WhatsApp bot + Futsal MCP + Telegram bot + Dashboard, semua run di HP Android via Termux.

## 1. Install Termux (PENTING: dari F-Droid, bukan Play Store)

Play Store Termux **outdated dan tidak bisa update package**. Wajib pakai F-Droid.

1. Buka browser: https://f-droid.org
2. Download F-Droid APK → install (ijinin "Install Unknown Sources")
3. Buka F-Droid → search "Termux" → install
4. Optional: install "Termux:API" + "Termux:Boot" + "Termux:Widget" dari F-Droid (untuk auto-start, notif, dll)

## 2. Setup Storage + Update

```bash
# Akses storage HP
termux-setup-storage   # tap Allow di popup

# Update Termux package
pkg update && pkg upgrade -y

# Tools dasar
pkg install -y git nodejs python clang make curl wget openssl libsqlite ffmpeg unzip
```

Verify:
```bash
node --version    # harus 20+
npm --version
git --version
sqlite3 --version
```

## 3. Install Claude Code di Termux

```bash
# Install Claude Code CLI global
npm install -g @anthropic-ai/claude-code

# Verify
claude --version

# Login (buka browser di HP)
claude login
# Klik link → buka di browser HP → login Claude.ai → authorize → balik ke Termux
```

Cek login berhasil:
```bash
claude --print "halo"
# Harus reply dari Claude
```

## 4. Clone Project

```bash
# Folder kerja
mkdir -p ~/projects && cd ~/projects

# Clone repo (sesuaikan URL)
git clone <your-repo-url> paper-trading
cd paper-trading

# Install deps semua project
cd paper-trading-mcp && npm install && cd ..
cd whatsapp-bot && npm install && cd ..
cd telegram-bot && npm install && cd ..
cd futsal-mcp && npm install && cd ..
```

## 5. Konfigurasi .env

```bash
cd ~/projects/paper-trading/whatsapp-bot
nano .env
```

Isi:
```
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=
GROQ_API_KEY=gsk_...
WA_INITIAL_BOSSES=628XXX
BOSS_SECRET_CODE=xxxxxx
CLAUDE_MODEL=haiku
CLAUDE_PERMISSION_MODE=bypassPermissions
```

Save: Ctrl+O, Enter, Ctrl+X

Sama untuk `futsal-mcp/.env`:
```
FUTSAL_DASH_PORT=3457
FUTSAL_DASH_USER=admin
FUTSAL_DASH_PASS=password-kuat
```

## 6. Daftarkan MCP servers ke Claude Code

```bash
mkdir -p ~/.claude
cat > ~/.claude/settings.json <<EOF
{
  "mcpServers": {
    "paper-trading": {
      "command": "node",
      "args": ["/data/data/com.termux/files/home/projects/paper-trading/paper-trading-mcp/src/index.js"]
    },
    "futsal": {
      "command": "node",
      "args": ["/data/data/com.termux/files/home/projects/paper-trading/futsal-mcp/src/index.js"]
    }
  }
}
EOF
```

Cek:
```bash
claude
# di interactive: /mcp → harus list paper-trading + futsal connected
```

## 7. Run Services

### Manual (4 terminal tab)

Termux support multi-session: swipe dari kiri → New Session

**Tab 1: WhatsApp Bot**
```bash
cd ~/projects/paper-trading/whatsapp-bot
npm start
# Scan QR dari WhatsApp HP yang LAIN (nomor disposable)
```

**Tab 2: Telegram Bot**
```bash
cd ~/projects/paper-trading/telegram-bot
npm start
```

**Tab 3: Futsal Dashboard**
```bash
cd ~/projects/paper-trading/futsal-mcp
npm run dashboard
# Buka browser HP: http://localhost:3457
```

**Tab 4: Worker (paper-trading)**
```bash
cd ~/projects/paper-trading
node src/worker.js
```

### Otomatis via PM2 (recommended)

```bash
npm install -g pm2

cd ~/projects/paper-trading
pm2 start whatsapp-bot/index.js --name wa-bot --cwd whatsapp-bot
pm2 start telegram-bot/index.js --name tg-bot --cwd telegram-bot
pm2 start futsal-mcp/dashboard/server.js --name futsal-dash
pm2 start src/worker.js --name pt-worker
pm2 save

# Auto-start on Termux open (Termux:Boot)
pm2 startup
# Follow instruction kalau ada
```

## 8. Auto-Start saat HP boot (Termux:Boot)

1. Install **Termux:Boot** dari F-Droid
2. Buka Termux:Boot sekali (kasih izin)
3. Bikin script start:
```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-all <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
sleep 10
pm2 resurrect
EOF
chmod +x ~/.termux/boot/start-all
```
4. Restart HP → semua bot auto-jalan

## 9. Update Mechanism

### Update Manual
```bash
cd ~/projects/paper-trading
./update.sh   # script ada di repo root
```

### Update Otomatis (cron)
```bash
pkg install cronie
crond
crontab -e
# tambah baris: tiap hari jam 3 pagi
0 3 * * * cd ~/projects/paper-trading && ./update.sh >> ~/.update.log 2>&1
```

## 10. Dashboard Access

### Dari HP itu sendiri
- Buka browser → `http://localhost:3457` (futsal)

### Dari laptop/PC di jaringan WiFi yg sama
1. Cek IP HP:
```bash
ifconfig | grep "inet "
# Cari IP wlan0, misal 192.168.1.42
```
2. Di laptop browser: `http://192.168.1.42:3457`

Pastikan firewall HP gak block.

## 11. Tips & Tricks

- **Keep alive**: `termux-wake-lock` cegah Android kill proses
- **Disk space**: `df -h` cek. Hapus `~/.cache/` kalau penuh
- **Reset auth WA**: `rm -rf whatsapp-bot/data/auth && pm2 restart wa-bot`
- **Backup DB**: 
```bash
cp ~/projects/paper-trading/*/data/*.db /sdcard/backup/
```
- **Update Node**: `pkg upgrade nodejs`
- **Update Claude Code**: `npm update -g @anthropic-ai/claude-code`

## 12. Troubleshooting

| Error | Fix |
|---|---|
| `better-sqlite3` compile fail | `pkg install clang python make` lalu `npm rebuild better-sqlite3` |
| `EACCES /sdcard/...` | Jalankan `termux-setup-storage` dulu |
| QR gak muncul | `pkg install qrencode`, atau ukurin font terminal kecil |
| Port 3457 taken | Set env `FUTSAL_DASH_PORT=3458` di .env |
| Claude login redirect fail | Copy link manual, paste ke browser, copy code, paste balik ke Termux |
| `pm2 not found` | `npm install -g pm2`. Kalau permission error: `chown -R $(whoami) ~/.npm` |

## 13. Architecture di Termux

```
HP Android (Termux)
├── Claude Code CLI (OAuth, subscription billing)
│
├── PM2 manages:
│   ├── wa-bot (WhatsApp bridge, port internal)
│   ├── tg-bot (Telegram bridge, long-polling)
│   ├── futsal-dash (port 3457, web admin)
│   └── pt-worker (background SL/TP, news poll, dst)
│
└── MCP servers (spawned per Claude Code call):
    ├── paper-trading (81 tools)
    └── futsal-mcp (24 tools)
```

Resource estimate (idle):
- RAM: ~400-600MB total
- Disk: ~500MB + DB growth
- Battery: ~5-10%/jam saat aktif

Cocok HP RAM 4GB+ dan storage 32GB+.
