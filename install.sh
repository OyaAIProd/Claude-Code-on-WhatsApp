#!/bin/sh
# Claude Code Personal OS — Universal Installer (Linux / macOS / Termux)

set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "============================================"
echo "  Claude Code Personal OS - Installer"
echo "============================================"
echo ""

# Detect environment
if [ -n "$TERMUX_VERSION" ] || [ -d /data/data/com.termux ]; then
  ENV_TYPE="termux"
elif [ "$(uname)" = "Darwin" ]; then
  ENV_TYPE="macos"
else
  ENV_TYPE="linux"
fi
echo "Environment detected: $ENV_TYPE"
echo ""

# ── Step 1: Install Node.js if missing ──────────
echo "[1/6] Check Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js belum ada. Install..."
  case "$ENV_TYPE" in
    termux)
      pkg update -y && pkg install -y nodejs git python clang make sqlite ffmpeg
      ;;
    macos)
      if command -v brew >/dev/null 2>&1; then
        brew install node git
      else
        echo "Install Homebrew dulu: https://brew.sh"
        exit 1
      fi
      ;;
    linux)
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y nodejs npm git build-essential
      elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y nodejs git gcc-c++ make
      elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm nodejs npm git base-devel
      else
        echo "Package manager gak ke-detect. Install Node.js manual dari https://nodejs.org"
        exit 1
      fi
      ;;
  esac
fi
echo "  Node.js $(node --version) OK"

# ── Step 2: Install Claude Code ────────────────
echo "[2/6] Check Claude Code CLI..."
if ! command -v claude >/dev/null 2>&1; then
  echo "Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
fi
echo "  Claude Code $(claude --version 2>/dev/null || echo 'installed') OK"

# ── Step 3: Login Claude ───────────────────────
echo "[3/6] Login Claude Code..."
echo "Lanjut login sekarang? Browser akan kebuka."
printf "[Y/n]: "
read -r ans
if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
  claude login || echo "Skip login. Bisa login nanti via: claude login"
fi

# ── Step 4: npm install ────────────────────────
echo "[4/6] Install dependencies..."
for d in whatsapp-bot telegram-bot futsal-mcp; do
  if [ -f "$d/package.json" ]; then
    echo "  Installing $d..."
    (cd "$d" && npm install --silent --no-audit --no-fund) || echo "  Warning: $d install issue"
  fi
done
if [ -f "package.json" ]; then
  echo "  Installing root..."
  npm install --silent --no-audit --no-fund || true
fi

# ── Step 5: Create shortcut ────────────────────
echo "[5/6] Buat shortcut..."
case "$ENV_TYPE" in
  linux)
    DESKTOP="$HOME/Desktop"
    [ -d "$DESKTOP" ] || mkdir -p "$DESKTOP"
    cat > "$DESKTOP/claude-code-os.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Claude Code Personal OS
Comment=Start AI personal assistant
Exec=sh -c "cd '$ROOT' && ./start.sh"
Icon=utilities-terminal
Terminal=true
Categories=Development;
EOF
    chmod +x "$DESKTOP/claude-code-os.desktop"
    echo "  Shortcut: $DESKTOP/claude-code-os.desktop"
    ;;
  macos)
    cat > "$HOME/Desktop/Claude Code Personal OS.command" <<EOF
#!/bin/sh
cd "$ROOT"
./start.sh
EOF
    chmod +x "$HOME/Desktop/Claude Code Personal OS.command"
    echo "  Shortcut: ~/Desktop/Claude Code Personal OS.command"
    ;;
  termux)
    # Termux pakai widget. Buat script di ~/.shortcuts/
    mkdir -p "$HOME/.shortcuts"
    cat > "$HOME/.shortcuts/Claude-Code-OS" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd "$ROOT"
./start.sh
EOF
    chmod +x "$HOME/.shortcuts/Claude-Code-OS"
    echo "  Termux widget shortcut: ~/.shortcuts/Claude-Code-OS"
    echo "  Tambah widget Termux:Widget di home screen Android"
    ;;
esac

# ── Step 6: Done ───────────────────────────────
chmod +x start.sh stop.sh update.sh 2>/dev/null || true

echo ""
echo "============================================"
echo "  INSTALL SELESAI"
echo "============================================"
echo ""
echo "Start sekarang? [Y/n]"
printf "> "
read -r ans
if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
  ./start.sh
fi
