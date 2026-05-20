#!/bin/sh
cd "$(dirname "$0")"

echo "Starting Claude Code Personal OS..."
echo "Dashboard: http://localhost:3458"
echo "Tekan Ctrl+C untuk stop."
echo ""

# Open browser after 8s (Linux/Mac), or print URL on Termux
(
  sleep 8
  if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3458 2>/dev/null
  elif command -v open >/dev/null 2>&1; then open http://localhost:3458 2>/dev/null
  elif command -v termux-open-url >/dev/null 2>&1; then termux-open-url http://localhost:3458
  fi
) &

exec node launch.js
