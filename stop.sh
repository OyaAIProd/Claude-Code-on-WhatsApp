#!/bin/sh
echo "Stopping all node processes for Claude Code OS..."
pkill -f "node launch.js" 2>/dev/null
pkill -f "node index.js" 2>/dev/null
pkill -f "node src/worker.js" 2>/dev/null
pkill -f "node dashboard/server.js" 2>/dev/null
echo "Done."
