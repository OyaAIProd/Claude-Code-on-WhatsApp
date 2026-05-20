# 📥 Install Guide

Pilih sesuai OS lo. Setup pertama: **3-5 menit**.

---

## 🪟 Windows (One-Click)

### Cara Install

1. Download/clone repo ini ke folder mana aja
2. **Double-click** `install.bat`
3. Ikutin prompt:
   - Auto-install Node.js (kalau belum ada)
   - Auto-install Claude Code CLI
   - Login Claude.ai via browser
   - Auto-install dependencies semua project
   - Auto-buat shortcut di Desktop

Selesai.

### Cara Pakai
- **Double-click shortcut "Claude Code Personal OS"** di Desktop
- Browser otomatis kebuka ke setup wizard di `http://localhost:3458/setup`
- Isi 5 form (~3 menit):
  1. Password admin dashboard
  2. Nomor WhatsApp lo (boss)
  3. Kode rahasia (auto-generate kalau dikosongin)
  4. Groq API key (free di [console.groq.com](https://console.groq.com))
  5. Telegram bot token (opsional)
- Scan QR WhatsApp yang muncul di terminal pakai HP

### Cara Stop
- Tutup terminal window, atau
- Double-click `stop.bat`

### Cara Update
- Double-click `update.bat`

---

## 🐧 Linux / 🍎 macOS / 📱 Termux Android

### Cara Install

1. Clone/download repo
2. Buka terminal di folder repo
3. Run:
```bash
chmod +x install.sh
./install.sh
```

Script bakal:
- Auto-detect Linux/macOS/Termux
- Install Node.js + Git + build tools via package manager (apt/brew/pkg)
- Install Claude Code CLI global
- Login Claude
- npm install semua project
- Bikin shortcut:
  - Linux: `.desktop` entry di `~/Desktop`
  - macOS: `.command` di `~/Desktop`
  - Termux: script di `~/.shortcuts/` (untuk Termux:Widget)

### Cara Pakai
- **Linux**: double-click "Claude Code Personal OS" di Desktop
- **macOS**: double-click "Claude Code Personal OS.command"
- **Termux**: tap widget Termux di home screen Android, atau run `./start.sh`

Browser auto-buka ke setup wizard. Isi 5 form, scan QR WhatsApp, done.

### Cara Stop
```bash
./stop.sh
```

### Cara Update
```bash
./update.sh
```

---

## 📲 Termux Khusus (Android)

Karena Termux env unik, ada beberapa requirement:

1. **Install Termux dari F-Droid**, BUKAN Play Store
   - Play Store version outdated dan gak bisa update package
   - F-Droid: https://f-droid.org → search Termux

2. **Setup storage access**:
```bash
termux-setup-storage
```

3. Optional install **Termux:API** + **Termux:Widget** + **Termux:Boot** dari F-Droid untuk auto-start saat HP boot

4. Lanjut `./install.sh`

Detail lengkap: [TERMUX-SETUP.md](TERMUX-SETUP.md)

---

## 🔧 Kalau Ada Error

### Windows: "node tidak dikenali"
- Restart terminal/PowerShell setelah install Node
- Kalau masih, restart PC

### Linux: "Permission denied"
- Pastiin `chmod +x install.sh start.sh stop.sh update.sh`

### Termux: "better-sqlite3 compile fail"
```bash
pkg install -y python clang make
cd whatsapp-bot && npm rebuild better-sqlite3
```

### "claude not found" setelah install
- Restart terminal
- Kalau masih, manual: `npm install -g @anthropic-ai/claude-code`

### Port 3458 sudah dipakai
- Edit `whatsapp-bot/.env`, ubah `ADMIN_PORT=3459`
- Restart bot

### QR WhatsApp gak muncul/blur
- Set terminal font size lebih kecil (Settings → Profiles → Font Size)
- Atau zoom out terminal: Ctrl + scroll

---

## 🚀 Setelah Install

1. **Dashboard**: `http://localhost:3458` (login dengan password yang lo set di wizard)
2. **Manage dari WA**: kirim text ke bot dari nomor lo
3. **Setup Telegram juga**: tambah token di wizard atau via dashboard
4. **Auto-start saat boot** (Windows): [Task Scheduler tutorial](TERMUX-SETUP.md#auto-start)

---

## 💡 Tips

- Pakai **nomor WhatsApp disposable** buat bot (risk WA ban di akun otomatis)
- **Update tiap minggu** untuk security patches: `update.bat` / `update.sh`
- **Backup DB** sebelum update: copy `whatsapp-bot/data/wa.db` ke folder aman
- **HP Android**: pakai Termux + PM2 + Termux:Boot untuk uptime 24/7
