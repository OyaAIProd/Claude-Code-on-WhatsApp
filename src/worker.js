const fs = require("fs");
const path = require("path");
const { startTicks } = require("./tick");
const wsFeed = require("./ws_feed");
const multiEx = require("./multi_exchange");
const newsTrader = require("./news_trader");

const PID_FILE = path.join(__dirname, "..", "data", "worker.pid");
const PID_DIR = path.dirname(PID_FILE);

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function checkExistingWorker() {
  if (!fs.existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    if (pid && isProcessAlive(pid)) return pid;
    fs.unlinkSync(PID_FILE);
  } catch {}
  return false;
}

function writePidFile() {
  try {
    fs.mkdirSync(PID_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch (err) { console.error("PID file write error:", err.message); }
}

function cleanup() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}

(async () => {
  const existing = checkExistingWorker();
  if (existing && existing !== process.pid) {
    console.error(`❌ Worker already running (PID ${existing}). Exit.`);
    process.exit(1);
  }
  writePidFile();
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", () => { try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch {} });

  console.error("🔧 Paper Trading Worker v1.0");
  console.error(`PID: ${process.pid}`);
  console.error(`PID file: ${PID_FILE}`);

  try { wsFeed.start(); } catch (err) { console.error("WS feed:", err.message); }
  try { multiEx.start(); } catch (err) { console.error("Multi-exchange:", err.message); }
  try { newsTrader.ensurePoller(); } catch {}
  startTicks();

  console.error("✅ Worker running. Tetep jalan walau Claude Code di-tutup.");
  console.error("Tekan Ctrl+C untuk stop, atau biarkan running di background.");
  setInterval(() => {}, 1 << 30);
})();
