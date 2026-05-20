#!/data/data/com.termux/files/usr/bin/sh
# Update script — Termux compatible

set -e
cd "$(dirname "$0")"

echo "🔄 [$(date)] Starting update..."

if [ ! -d .git ]; then
  echo "❌ Not a git repo. Init dulu: git init && git remote add origin <url>"
  exit 1
fi

OLD_HEAD=$(git rev-parse HEAD)
echo "📥 git pull..."
git pull --ff-only
NEW_HEAD=$(git rev-parse HEAD)

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
  echo "✅ Already up-to-date ($OLD_HEAD)"
  exit 0
fi

echo "📦 Update detected: $OLD_HEAD → $NEW_HEAD"

for dir in paper-trading-mcp whatsapp-bot telegram-bot futsal-mcp; do
  if [ -f "$dir/package.json" ]; then
    echo "📦 npm install in $dir..."
    (cd "$dir" && npm install --silent --no-audit --no-fund) || echo "⚠️  $dir install failed"
  fi
done

if command -v pm2 >/dev/null 2>&1; then
  echo "🔄 PM2 restart all..."
  pm2 restart all
else
  echo "⚠️  PM2 not installed, manual restart needed"
fi

echo "✅ Update complete: $NEW_HEAD"
