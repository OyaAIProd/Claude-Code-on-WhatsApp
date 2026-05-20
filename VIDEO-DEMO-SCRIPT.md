# 🎬 Video Demo Script — "Claude Code Personal OS"

Target durasi: **90-120 detik** (TikTok/Reels/YouTube Shorts) atau **3-5 menit** (YouTube long-form).
Style: **Apple/Linear/Notion product reveal** — clean minimal, fast cuts, ambient music, no narration (text overlays only).

---

## 🎨 Visual Identity

- **Color palette**: 
  - Background: deep dark `#0a0e1a` (matches dashboard)
  - Accent: teal `#26a69a`
  - Warning: orange `#ffa726`
  - Danger: red `#ef5350`
  - Text: `#e8ecf5`
- **Font**: SF Pro / Inter / JetBrains Mono (code)
- **Music**: ambient electronic / lo-fi tech (royalty-free: Pixabay/Epidemic Sound). 90-100 BPM.
- **Transitions**: hard cuts + occasional crossfade. NO swooshes/cheesy effects.
- **Cursor**: enlarged, white, slight delay on click. macOS-style with ripple.

---

## 🎞️ Storyboard (Long Version — 4 Menit)

### SCENE 1 — Hook (0:00 – 0:08)
**Visual**:
- Black screen
- Fade in: handheld POV — phone on desk, screen WhatsApp, voice note tap recording
- User voice (subtitled): "Beli Bitcoin 500ribu, kasih analisa dulu"
- Bot reaction ⏳ instant appear

**Text overlay** (bottom): `Claude Code di WhatsApp lo`

---

### SCENE 2 — Voice → Analysis (0:08 – 0:20)
**Visual**:
- Close-up phone screen
- Voice message bubble dengan transkrip muncul: `🎤 "Beli Bitcoin 500ribu, kasih analisa dulu"`
- Bot reply progress message edit live:
  ```
  ⏳ memproses 3s...
  
  🎭 persona: casual
  📊 Cek harga BTC
  📐 Indikator BTC
  🧠 ML signal BTC
  📰 News crypto
  ```
- Reaction emoji ⏳ → ✅ on user message

**Text overlay**: `Voice → Whisper → Multi-tool Reasoning`

---

### SCENE 3 — AI Verdict (0:20 – 0:32)
**Visual**:
- Bot reply masuk:
  > 🛑 *Jangan dulu beli BTC*
  > 
  > RSI 78 (overbought zone), MACD bearish divergence, sentiment Extreme Greed.
  > 
  > Saran: pasang BUY_LIMIT di Rp1.350M (-2% dari sekarang). Gw setup auto-trigger.
  > 
  > [BUTTONS: setup_limit | wait | beli_paksa]
- 3 button muncul as numbered list:
  ```
  1. Setup BUY_LIMIT auto
  2. Nunggu signal lebih bagus
  3. Beli paksa sekarang
  ```
- Finger tap "1"
- Bot eksekusi → ✅ Order #42 set

**Text overlay**: `Independent AI · Bisa NOLAK trade lo`

---

### SCENE 4 — Cross-Chat Memory (0:32 – 0:50)
**Visual**:
- Switch ke POV laptop monitor: WhatsApp Web showing 3 group ramai chat
- Various messages flow di multiple groups: "Kapten JS lagi di Pelabuhan Tanjung Priok bro", "Laporan Q1 udah gw kirim", "BTC nyentuh ATH"
- Cut ke DM bot dari boss: ketik "Kapten JS sekarang dimana?"
- Bot reply dengan **citation**:
  > 🔎 _Menurut chat di group_ Tim Pelayaran _kemarin 14:23, Kapten Tono bilang_:
  > "JS lagi standby di Pelabuhan Tanjung Priok bro"

**Text overlay**: `Cross-Chat Memory · RAG + FTS5 + Vector Embeddings`

---

### SCENE 5 — File Handling (0:50 – 1:08)
**Visual**:
- POV phone — boss kirim PDF "Laporan Q1.pdf" ke bot DM
- Bot ack: `📥 menerima file...` lalu edit jadi:
  ```
  📎 Laporan Q1.pdf (245KB) · 8 halaman
  ✅ Extract OK (5234 char)
  ```
- Boss text: "Ubah jadi PowerPoint, kasih ringkasan tiap halaman jadi 1 slide"
- Bot progress muncul:
  ```
  ⏳ memproses 12s...
  📄 Read: Laporan Q1.pdf.extracted.txt
  🖥️ Bash: node -e "...pptxgenjs..."
  ```
- File `Laporan_Q1_summary.pptx` masuk WA as attachment
- Boss buka di PowerPoint app HP → 8 slide bersih dengan ringkasan

**Text overlay**: `PDF · DOCX · XLSX · PPTX · Auto-generate native`

---

### SCENE 6 — Group Silent Mode (1:08 – 1:22)
**Visual**:
- POV person di group ramai 30 anggota
- Andi kirim foto kucing → 💾 reaction
- Budi kirim screenshot meme → 💾 reaction
- Cici kirim PDF → 💾 reaction
- Group ngalir terus tanpa bot interference
- Cut: boss DM bot 1 jam kemudian: "tadi siapa kirim foto kucing?"
- Bot reply: "_Andi_ di group _Crypto Indo_ pukul 14:23. Foto kucing oranye duduk di atas keyboard."

**Text overlay**: `Silent Listening · Privacy First · On-Demand Recall`

---

### SCENE 7 — Dashboard Reveal (1:22 – 1:42)
**Visual**:
- Cut ke laptop screen, cursor click browser tab
- Buka `localhost:3457` — Futsal Dashboard
- Smooth scroll dashboard:
  - 6 KPI cards top (Bookings, Members, Revenue, Expenses, Profit)
  - P&L table
  - Cursor click "Jadwal" tab → schedule grid muncul, 3 lapangan, slot hijau/merah
  - Cursor click "Bookings" → list table
  - Cursor click "Members" → top spenders
  - Cursor click "Knowledge Base" → FAQ list

**Text overlay**: `Web Dashboard · localhost:3457 · Mobile Responsive`

---

### SCENE 8 — Mini Workflows (1:42 – 2:00)
**Visual**:
- Boss DM bot: "Tiap hari kalo Andi kirim file PDF di group Marketing, lo summarize lalu kirim ke gw"
- Bot reply dengan plan + buttons:
  ```
  🔄 Mau gw bikin workflow:
  Name: pdf_andi_summary
  Trigger: file PDF dari Andi di "Marketing"
  Action: summarize → forward ke DM boss
  
  [BUTTONS: yes=Approve | no=Cancel]
  ```
- Tap "1" → workflow active
- Time skip: Andi kirim PDF besoknya → bot trigger workflow → ringkasan masuk DM boss

**Text overlay**: `Mini-Workflows · Zapier in your pocket`

---

### SCENE 9 — Termux POV (2:00 – 2:20)
**Visual**:
- Tangan pegang HP Android (close-up)
- Buka Termux app
- Ketik `pm2 status` → tabel proses jalan:
  ```
  wa-bot      ● online   12h    150MB
  tg-bot      ● online   12h    80MB
  futsal-dash ● online   12h    60MB
  pt-worker   ● online   12h    90MB
  ```
- Ketik `claude --version` → `2.1.143`
- Ketik `./update.sh` → "🔄 git pull..." → "✅ Already up-to-date"

**Text overlay**: `100% di Termux Android · No PC needed · Auto-update`

---

### SCENE 10 — Multi-Lingual + Persona (2:20 – 2:35)
**Visual**:
- POV group dengan member dari berbagai negara
- Member US text: "what's the deadline for Q2 report?"
- Bot reply: `🌐 _en→id_\nKapan deadline laporan Q2?`
- Bot ke boss (bahasa Indonesia): "User Mike nanya deadline laporan Q2"
- Cut: boss switch `/persona formal` → bot reply jadi formal "Mohon maaf, deadline laporan Q2 adalah tanggal..."
- Cut: boss switch `/persona funny` → bot reply jadi lucu "Bro deadline Q2 itu kayaknya tanggal X, jangan kelupaan ya wkwk"

**Text overlay**: `19 Bahasa · 6 Persona · Auto-detect`

---

### SCENE 11 — Voice Note Reply (2:35 – 2:50)
**Visual**:
- Boss kirim voice note di group: "Tunjukkan candlestick BTC 30 hari dengan Fibonacci"
- Bot proses, reply:
  - 🎤 transkrip muncul
  - Photo chart muncul (candlestick dengan Fibonacci overlay + EMA + pattern annotations DOJI, HAMMER, etc)
  - Text analisa: "Detected DOJI di 3 candle terakhir, support kuat di Rp1.35M..."

**Text overlay**: `Native chart generation · Pattern detection · QuickChart`

---

### SCENE 12 — Stats & Audit (2:50 – 3:05)
**Visual**:
- Boss type `/health` → reply:
  ```
  💚 HEALTH CHECK
  🤖 Uptime: 142.5h
  💾 RAM: 312MB
  🗄️ DB: 47.3MB
  💬 Messages: 8,234
  📎 Files: 156
  💼 Chats tracked: 12
  👑 Bosses: 1
  ```
- Type `/budget` → reply dengan progress bar usage
- Type `/audit 20` → list 20 action terakhir

**Text overlay**: `Audit Log · Per-User Token Budget · Daily Backup`

---

### SCENE 13 — Outro (3:05 – 3:30)
**Visual**:
- Fade ke logo / brand mark (bisa simple text "C°" atau symbol)
- Multiple devices arrangement (HP, laptop, monitor) showing bot in action
- Text overlay sequence (each 1 second):
  - "WhatsApp Bridge ✓"
  - "Telegram Bridge ✓"
  - "Trading Bot ✓"
  - "Business Manager ✓"
  - "RAG + Vector Search ✓"
  - "Voice + Vision + File AI ✓"
  - "100% di HP lo"
- Final card:
  ```
  Claude Code Personal OS
  
  Built with Claude Code
  github.com/[your-handle]/[repo]
  ```

---

## 🤖 AI VIDEO GENERATION PROMPT

Pakai prompt ini di **Sora 2 / Veo 3 / Runway Gen-4 / Kling 2.0**. Generate per scene karena most tools max 10-20 detik per clip.

### Master Style Guide (paste di awal setiap prompt)

```
STYLE: Apple-style product reveal, ultra clean modern minimal, deep dark UI #0a0e1a background, teal #26a69a accent, sharp typography Inter/SF Pro, JetBrains Mono for code. Smooth camera moves: dolly-in, parallax, locked tripod. Ambient electronic background music, no narration, text overlays only (bottom-third or full-screen kinetic typography). Cinematic 24fps, shallow depth of field on physical shots, crisp 4K on UI captures. Color grade: cool teal highlights, blacks deep, slight film grain. Cursor on UI: enlarged white macOS-style, slight delay on click, ripple effect on tap.
```

---

### SCENE 1 PROMPT — Hook

```
[STYLE: Apple product reveal, ultra cinematic, 24fps, 4K]

Top-down close-up shot: modern smartphone (matte black) on minimalist wood desk, screen showing WhatsApp chat interface with dark theme. Soft daylight from left, slight bokeh. A hand enters frame from right, finger taps voice-record button (microphone icon). Sound waveform animates inside the message bubble. After 2 seconds, message sends — checkmarks (sent → delivered → read) animate.

Bottom message bubble shows transcribed text: "Beli Bitcoin 500ribu, kasih analisa dulu" (white text on dark green bubble).

Above transcript bubble, hourglass emoji ⏳ reaction appears with a subtle pulse animation.

Camera: locked tripod, no movement. Duration: 8 seconds.

Text overlay (top-third, white Inter Bold, fade in at 5s): "Claude Code di WhatsApp lo"

End frame: phone screen with progress message starting to render.
```

---

### SCENE 2 PROMPT — Voice → Multi-Tool Analysis

```
[STYLE: continuation, same phone, dark UI]

Close-up phone screen, WhatsApp chat view dark theme. The bot's progress message animates LINE BY LINE appearing top-to-bottom:

⏳ memproses 3s...

🎭 persona: casual
📊 Cek harga BTC
📐 Indikator BTC
🧠 ML signal BTC
📰 News crypto

Each line appears with a 0.5s delay, with a soft glow accent in teal. Text is rendered in monospace JetBrains Mono. The "memproses" line counter increments live from 1s to 5s.

After all lines render, the message gets EDITED in-place to: "✅ 4 step · 5.2s" with checkmark turning teal.

Simultaneously, on the original voice message above (with transcript "Beli Bitcoin..."), the reaction emoji morphs from ⏳ to ✅ with a small spring animation.

Camera: subtle slow zoom-in (5%) over 12 seconds.

Text overlay (bottom-third, fade in at 9s): "Voice → Whisper → Multi-tool Reasoning"

Duration: 12 seconds.
```

---

### SCENE 3 PROMPT — AI Verdict + Interactive Buttons

```
[STYLE: continuation, phone screen, dark WhatsApp]

Bot reply message bubble (left-aligned, dark grey background) animates in with typing dots first, then reveals text:

🛑 Jangan dulu beli BTC

RSI 78 (overbought zone), MACD bearish divergence, sentiment Extreme Greed.

Saran: pasang BUY_LIMIT di Rp1.350M (-2% dari sekarang).

(text appears word-by-word, ~80 wpm typing speed effect)

Below the text, three numbered options appear sequentially with subtle fade:
1. Setup BUY_LIMIT auto
2. Nunggu signal lebih bagus
3. Beli paksa sekarang

Bottom: italic gray text "_Reply nomor atau /pilih <n>_"

A finger from off-screen taps option "1". Brief haptic ripple. The user's reply bubble appears right-aligned saying "1". 

Then bot replies: "✅ Order #42 set. BUY_LIMIT BTC @ Rp1.350M" with a teal accent left border on the bubble.

Camera: locked. Duration: 12 seconds.

Text overlay (bottom, kinetic): "Independent AI · Bisa NOLAK trade lo"
```

---

### SCENE 4 PROMPT — Cross-Chat Memory

```
[STYLE: switch to laptop, professional desk environment]

Wide shot transitioning: 16-inch MacBook Pro on wooden desk, soft window light, designer plants. Camera pushes in toward the screen.

Screen shows WhatsApp Web (dark mode) with 3 group chats visible on left sidebar (highlighted: "Tim Pelayaran", "Crypto Indo", "Family Group"). Multiple notification badges incrementing in real-time on each.

Inside one group ("Tim Pelayaran"), messages scroll automatically: 
- Kapten Tono: "JS lagi standby di Pelabuhan Tanjung Priok bro"
- Various other replies flowing past

Quick cut to DM chat with bot (labeled "Claude AI"):
User types: "Kapten JS sekarang dimana?"
Bot replies after 2s progress with citation card:

> 🔎 Menurut chat di group **Tim Pelayaran** kemarin 14:23:
> "JS lagi standby di Pelabuhan Tanjung Priok bro" — Kapten Tono

The cited message has a subtle teal left border and "Source" tag.

Camera: dolly-in toward laptop over 15s, then locked.

Text overlay (full screen middle, large): "Cross-Chat Memory"
Subtitle (smaller): "RAG + FTS5 + Vector Embeddings"

Duration: 18 seconds.
```

---

### SCENE 5 PROMPT — File Handling: PDF → PPTX

```
[STYLE: back to phone POV, vertical orientation]

Hand holds phone in portrait, WhatsApp chat with bot. User attaches PDF "Laporan_Q1.pdf" — the file appears as document bubble with red PDF icon.

Bot immediately reacts with 📥 emoji on the PDF message, then sends:
"📥 menerima file..."

The "menerima file..." message LIVE EDITS to:
"📎 *Laporan_Q1.pdf* (245KB) · 8 halaman
✅ Extract OK (5234 char)"

User types: "Ubah jadi PowerPoint, kasih ringkasan tiap halaman jadi 1 slide"

Bot progress message appears and streams:
⏳ memproses 12s...
📄 Read: Laporan_Q1.pdf.extracted.txt
🖥️ Bash: node -e "...pptxgenjs..."

Then a new PowerPoint file attachment appears: "Laporan_Q1_summary.pptx" (orange icon).

User taps the file, screen transitions to PowerPoint mobile app showing 8 clean slides each with a heading and 3 bullet points. Slides flip automatically left-to-right showing all 8.

Camera: handheld realistic phone POV throughout, slight natural shake.

Text overlay (bottom, fade): "PDF · DOCX · XLSX · PPTX · Generated Native"

Duration: 18 seconds.
```

---

### SCENE 6 PROMPT — Group Silent Mode

```
[STYLE: hands-on phone, WhatsApp group chat dark mode]

POV inside a busy WhatsApp group called "Crypto Indo" with 30 members. Messages stream rapidly:
- Andi sends a cat photo (no caption) — appears with 💾 reaction from bot
- Budi sends a meme screenshot — 💾 reaction
- Cici sends a PDF document — 💾 reaction
- Members keep chatting normally between media, bot silent

The 💾 emoji reactions are SUBTLE — small below each media message.

Hard cut to a calm minimalist DM chat (different lighting, evening warm tone) — boss texting bot:
"tadi siapa kirim foto kucing?"

Bot replies:
"_Andi_ di group **Crypto Indo** pukul 14:23.
Foto kucing oranye duduk di atas keyboard."

The reply card has a subtle thumbnail preview of the cat photo on the right.

Camera: locked, slight push-in.

Text overlay (center, large fade): "Silent Listening · Privacy First"

Duration: 14 seconds.
```

---

### SCENE 7 PROMPT — Dashboard Reveal

```
[STYLE: laptop screen close-up, browser tab, smooth UI animation]

Wide shot: laptop with mouse, cursor hovers over browser address bar typing "localhost:3457" and hits enter.

Page loads: Futsal Dashboard.

Dashboard layout (matches storyboard color palette):
- Top header: "⚽ Futsal Dashboard" left, nav tabs right (Dashboard, Jadwal, Bookings, Members, Knowledge, Expenses, Audit)
- 6 KPI cards in a row: Total Bookings (487), Members (123), KB Entries (45), Revenue 30d (Rp 45.230.000), Expenses 30d (Rp 12.500.000), Profit 30d (Rp 32.730.000 — teal)
- Below: P&L table

Cursor (enlarged white macOS) clicks "Jadwal" tab — smooth slide-in transition reveals grid of slots per field, each slot card hijau atau merah depending on availability.

Cursor clicks "Bookings" — list table animates in row-by-row.
Cursor clicks "Members" — top members ranked by total spent.
Cursor clicks "Knowledge" — FAQ list.

All transitions smooth crossfade ~300ms.

Camera: locked on monitor, slight push-in.

Text overlay (top corner): "Web Dashboard · localhost:3457"

Duration: 20 seconds.
```

---

### SCENE 8 PROMPT — Mini-Workflows

```
[STYLE: phone POV, dark WhatsApp]

User types message to bot:
"Tiap hari kalo Andi kirim file PDF di group Marketing, lo summarize lalu kirim ke gw"

Bot processes (progress message brief), then replies:
"🔄 Mau gw bikin workflow:

**Name**: pdf_andi_summary
**Trigger**: file PDF dari Andi di "Marketing"
**Action**: summarize → forward ke DM boss

Reply *YA* atau pilih:"

Below: 2 buttons styled
1. Approve  
2. Cancel

Finger taps "1". User reply bubble "1" appears.

Bot: "✅ Workflow #3 active. Gw akan listen pattern itu mulai sekarang."

QUICK CUT (1 second transition with white flash): Time skip to next day.

Cut to phone showing notification from bot:
"🔄 Workflow #3 fired. Andi just sent 'Q1_Report.pdf' to Marketing.

**Summary**:
- Revenue Q1: Rp 1.2B (+15% vs Q4)
- New customers: 47
- Top channel: Instagram Ads
- ..."

Camera: phone POV throughout.

Text overlay (middle large): "Mini-Workflows · Zapier in your pocket"

Duration: 16 seconds.
```

---

### SCENE 9 PROMPT — Termux on Android

```
[STYLE: handheld phone macro shot, ambient warm light]

Close-up of hands holding a generic black Android phone (mid-range, no logo). Tap Termux app icon. App opens — black terminal background, green/white text.

Type at prompt (animated typing, ~6 cps):
`pm2 status`

Output appears with realistic terminal rendering, tabular layout with color coding:
```
┌────────────────┬─────────┬──────┬──────┐
│ wa-bot         │ online  │ 12h  │ 150MB│
│ tg-bot         │ online  │ 12h  │ 80MB │
│ futsal-dash    │ online  │ 12h  │ 60MB │
│ pt-worker      │ online  │ 12h  │ 90MB │
└────────────────┴─────────┴──────┴──────┘
```

Cut, new commands:
`claude --version` → "2.1.143"
`./update.sh` → "🔄 git pull..." (1s delay) → "✅ Already up-to-date"

Camera: shallow DOF on phone, soft natural light.

Text overlay (corner): "100% Termux Android · Auto-update"

Duration: 18 seconds.
```

---

### SCENE 10 PROMPT — Multi-Lingual

```
[STYLE: split-screen or sequential clips, phone UI]

Sequential POV multiple group members in WhatsApp group "Global Project":

Member 1 (Mike, profile pic flag emoji 🇺🇸) sends: "what's the deadline for Q2 report?"

Bot immediately replies BELOW Mike's message (in italic gray text styled as translation):
"🌐 _en→id_
Kapan deadline laporan Q2?"

Member 2 (Yuki, 🇯🇵) sends: "Q2のレポートの締め切りはいつですか？"
Bot replies: "🌐 _ja→id_  
Kapan deadline untuk laporan Q2?"

Cut to boss DM:
Boss: `/persona formal`
Bot: "✅ Persona → formal"
Boss next: "Tolong sampaikan deadline-nya"
Bot reply now formal: "Baik. Deadline laporan Q2 adalah tanggal 30 Juni 2026. Akan saya teruskan ke grup."

Then `/persona funny` → "✅ funny"
Boss: "Sama lagi tapi versi gaul"
Bot reply: "Bro deadline Q2 itu 30 Juni, jangan kelupaan ya wkwk besok udah deketan"

Camera: phone POV, multiple shot cuts each 4s.

Text overlay (center): "19 Bahasa · 6 Persona · Auto-detect"

Duration: 15 seconds.
```

---

### SCENE 11 PROMPT — Voice + Chart

```
[STYLE: phone POV, WhatsApp dark]

Boss records voice note. The audio waveform appears live as he speaks: "Tunjukkan candlestick BTC 30 hari dengan Fibonacci"

Voice note sends. Bot processes (progress message brief).

A photo attachment loads into the chat (smooth load animation): A dark-themed candlestick chart with:
- BTC 30d candles (green up, red down)
- Fibonacci levels overlay (dashed horizontal lines in rainbow gradient: red top → teal bottom) with price labels
- EMA20 (orange line) and EMA50 (blue line) crossing
- Pattern markers: "DOJI", "HAMMER", "BULL_ENGULFING" small labels on specific candles
- Support/Resistance dashed lines (red R, teal S)
- Title: "BTC 30d + Fibonacci"

Below photo, bot text analysis:
"Detected DOJI di 3 candle terakhir di area Fib 0.618 (Rp1.35M). Support kuat di Rp1.32M. Resistance dekat Rp1.42M. Setup bullish reversal kalau break Rp1.40M."

Camera: locked phone POV.

Text overlay (corner small): "Native chart generation · Pattern AI"

Duration: 15 seconds.
```

---

### SCENE 12 PROMPT — Stats & Audit

```
[STYLE: phone POV, system commands]

Quick cuts of admin commands:

1. Boss types `/health`
Bot reply formatted box:
```
💚 HEALTH CHECK
🤖 Uptime: 142.5h
💾 RAM: 312MB  
🗄️ DB: 47.3MB
💬 Messages: 8,234
📎 Files: 156
💼 Chats: 12
👑 Bosses: 1
```

2. Cut, types `/budget` → reply with progress bar visualization:
```
💰 Budget 628XXX
Hari ini: $0.42 / $10.00
████░░░░░░ 4.2%
Total lifetime: $123.45 (1,234 req)
```

3. Cut, types `/audit 10` → list of 10 most recent actions with timestamps and color-coded action types

Text overlay sequential:
"Audit Log ✓"
"Token Budget ✓"
"Daily Backup ✓"

Duration: 15 seconds.
```

---

### SCENE 13 PROMPT — Outro

```
[STYLE: hero shot, cinematic product reveal]

Wide shot: minimalist setup on a wood desk — Android phone, MacBook, iPad arranged in triangle composition. Each device screen shows different aspect of the system: phone has WhatsApp with bot, MacBook has dashboard, iPad has Telegram bot.

Camera slowly orbits 30° around the setup with shallow DOF, focus shifts between devices.

Text overlay sequence (each shows for 1 second, kinetic typography sliding in):
"WhatsApp Bridge"
"Telegram Bridge"
"Trading Bot"
"Business Manager"
"RAG + Vector Search"
"Voice · Vision · Files"
"100% di HP lo"

All devices' screens dim to black simultaneously. Final card center fades in:

```
Claude Code Personal OS

Built with Claude Code
github.com/[your-handle]/[repo]
```

(Logo/wordmark style: clean monospace, white on black)

Soft fade to black at 25 seconds.

Duration: 25 seconds.
```

---

## 🎵 Music Suggestions (Royalty-Free)

- **Pixabay**: search "ambient tech", "minimal corporate", "lo-fi product"
- **YouTube Audio Library**: filter "Cinematic" + "Calm" + "No copyright"
- **Spesifik track yang cocok**:
  - "Floating" by Patrick Patrikios (YT Audio Library)
  - "Reaching for the Sun" by Aakash Gandhi
  - "Cinematic Background Lofi" by Coma-Media (Pixabay)

Tempo target 90-100 BPM, build-up subtle di scene 7 (dashboard reveal), drop di scene 13 (outro).

---

## 🛠️ Tools untuk Edit

| Component | Tool |
|---|---|
| Screen capture (HP) | OBS / scrcpy / Vysor (Android mirror) |
| Screen capture (PC) | OBS / ShareX / Loom |
| Phone POV physical shots | Smartphone yang lain + tripod, atau gimbal |
| Video editing | DaVinci Resolve (free, pro) / Premiere / Final Cut |
| Motion graphics text overlay | After Effects / Motion / Premiere Essential Graphics |
| AI video gen | Sora 2 / Veo 3 / Runway / Kling 2.0 / Pika |
| Cursor effect | macOS "Cursor Pro" / FFmpeg post-process |
| Audio sync | Resolve Fairlight / Audition |

---

## 📋 Production Checklist

- [ ] Record WhatsApp screen di HP nomor disposable (jangan nomor utama!)
- [ ] Record dashboard di browser fullscreen, hide bookmarks bar
- [ ] Capture Termux di Android dengan font size besar (atur via Termux preferences)
- [ ] Setup chat dummy: bikin 3 group test sama 5-10 members fake
- [ ] Pre-populate DB dengan data demo (bookings, members, KB entries)
- [ ] Test seluruh flow demo dulu, recheck timing
- [ ] Record dengan 60fps biar smooth, downsample ke 24fps di edit
- [ ] Color grade: cool LUT (teal tint), slight crush blacks
- [ ] Subtitle SRT pakai Whisper auto-generate, manual cleanup
- [ ] Export: 1080p H.264 YouTube, atau 2160p H.265 untuk archive
- [ ] Vertical 9:16 reels untuk TikTok/IG/Shorts: re-edit, vertical-safe centered
- [ ] Thumbnail: hero shot phone closeup dengan text overlay "Claude Code di HP"

---

## 🎯 Marketing Hooks (untuk caption / description)

- "Apa jadinya kalau Claude Code masuk ke WhatsApp lo?"
- "Aku bikin asisten AI yang inget SEMUA chat di SEMUA group"
- "Trading bot yang bisa NOLAK perintah lo. Independent AI."
- "Generate PDF/Excel/PowerPoint langsung dari chat WhatsApp"
- "Run 100% di Termux Android. No server, no cloud, datacenter di saku."
- "Voice note Indonesia → Whisper → Claude → action otomatis"

---

## 📝 Naskah Pendek (90 detik TikTok/Reels Version)

**Cuts**:
1. (0-3s) Phone POV WhatsApp, voice note rec, bot ⏳ react
2. (3-10s) Progress streaming, multi-tool steps animate
3. (10-18s) Bot NOLAK trade dengan alasan, button options muncul, tap "1"
4. (18-25s) Cross-chat memory demo — DM tanya "Kapten JS dimana?" → bot cite
5. (25-35s) PDF dikirim → bot auto-extract → minta convert ke PPTX → file masuk
6. (35-45s) Dashboard reveal cepet, smooth scroll, 6 KPI + schedule grid + bookings
7. (45-55s) Termux POV, pm2 status, ./update.sh, semua online
8. (55-65s) Multi-lingual cuts, persona swap demos
9. (65-75s) Voice → candlestick chart photo masuk WA dengan Fibonacci
10. (75-85s) Outro hero shot 3 devices, "Claude Code Personal OS"
11. (85-90s) End card + handle

Pakai trending audio yang gak terlalu rame, ambience cocok product reveal.

---

Mau gw bikin storyboard JSON detail per second untuk Sora/Veo, atau cukup ini?
