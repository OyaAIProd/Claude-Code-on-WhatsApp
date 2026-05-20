const fetch = global.fetch || require("node-fetch");
const fs = require("fs");
const path = require("path");

const REPO = process.env.UPDATER_REPO || "ghanibot/Claude-Code-on-WhatsApp";
const CHECK_INTERVAL_MS = parseInt(process.env.UPDATE_CHECK_INTERVAL_MS || `${6 * 3600 * 1000}`, 10);
const CURRENT_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch { return "0.0.0"; }
})();

let lastCheckedAt = null;
let latestRemote = null;

function semverGt(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function fetchLatestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "claude-code-on-whatsapp-updater", "Accept": "application/vnd.github+json" },
      timeout: 10000
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      version: (data.tag_name || "").replace(/^v/, ""),
      url: data.html_url,
      body: data.body,
      published_at: data.published_at
    };
  } catch (err) {
    console.error("[UPDATER] fetch:", err.message);
    return null;
  }
}

async function checkForUpdate({ notifyFn } = {}) {
  lastCheckedAt = new Date().toISOString();
  const latest = await fetchLatestRelease();
  if (!latest) return null;
  latestRemote = latest;
  if (semverGt(latest.version, CURRENT_VERSION)) {
    console.error(`[UPDATER] 🆕 Update available: v${CURRENT_VERSION} → v${latest.version}`);
    console.error(`[UPDATER] ${latest.url}`);
    if (typeof notifyFn === "function") {
      try {
        await notifyFn({
          title: `🆕 Update tersedia: v${latest.version}`,
          body: `Versi sekarang v${CURRENT_VERSION}. Update via ./update.sh atau update.bat\n\n${(latest.body || "").slice(0, 300)}\n\n${latest.url}`,
          category: "watch_alert",
          priority: "default"
        });
      } catch {}
    }
    return { hasUpdate: true, current: CURRENT_VERSION, latest: latest.version, url: latest.url };
  }
  return { hasUpdate: false, current: CURRENT_VERSION, latest: latest.version };
}

function getStatus() {
  return {
    current_version: CURRENT_VERSION,
    latest_version: latestRemote?.version || null,
    last_checked_at: lastCheckedAt,
    update_available: latestRemote ? semverGt(latestRemote.version, CURRENT_VERSION) : false,
    repo: REPO
  };
}

function startUpdater(notifyFn) {
  setTimeout(() => checkForUpdate({ notifyFn }), 30 * 1000);
  setInterval(() => checkForUpdate({ notifyFn }), CHECK_INTERVAL_MS);
  console.error(`✅ Updater started (check every ${CHECK_INTERVAL_MS / 3600000}h, current v${CURRENT_VERSION})`);
}

module.exports = { startUpdater, checkForUpdate, getStatus, semverGt, CURRENT_VERSION };
