const { spawn } = require("child_process");
const path = require("path");

const ROOT = __dirname;
const COLORS = { wa: "\x1b[36m", tg: "\x1b[35m", fut: "\x1b[33m", wk: "\x1b[32m", reset: "\x1b[0m" };

const services = [
  { name: "wa",  label: "WA-BOT     ", color: COLORS.wa,  cwd: path.join(ROOT, "whatsapp-bot"),    cmd: "node", args: ["index.js"], enabled: true },
  { name: "tg",  label: "TELEGRAM   ", color: COLORS.tg,  cwd: path.join(ROOT, "telegram-bot"),    cmd: "node", args: ["index.js"], enabled: true },
  { name: "fut", label: "FUTSAL-DASH", color: COLORS.fut, cwd: path.join(ROOT, "futsal-mcp"),      cmd: "node", args: ["dashboard/server.js"], enabled: true },
  { name: "wk",  label: "WORKER     ", color: COLORS.wk,  cwd: ROOT,                                cmd: "node", args: ["src/worker.js"], enabled: true }
];

const children = [];
let shuttingDown = false;

function startService(svc) {
  if (!svc.enabled) return;
  console.log(`${svc.color}[${svc.label}]${COLORS.reset} starting...`);
  const proc = spawn(svc.cmd, svc.args, { cwd: svc.cwd, env: process.env, shell: false });
  children.push({ ...svc, proc });

  proc.stdout.on("data", (d) => {
    d.toString().split("\n").forEach(line => { if (line.trim()) process.stdout.write(`${svc.color}[${svc.label}]${COLORS.reset} ${line}\n`); });
  });
  proc.stderr.on("data", (d) => {
    d.toString().split("\n").forEach(line => { if (line.trim()) process.stdout.write(`${svc.color}[${svc.label}]${COLORS.reset} ${line}\n`); });
  });
  proc.on("close", (code, signal) => {
    console.log(`${svc.color}[${svc.label}]${COLORS.reset} exited code=${code}${signal ? " signal=" + signal : ""}`);
    const killedBySignal = signal === "SIGTERM" || signal === "SIGKILL" || code === 143 || code === 137;
    if (!shuttingDown && !killedBySignal && code !== 0 && code !== null) {
      console.log(`${svc.color}[${svc.label}]${COLORS.reset} restart in 3s...`);
      setTimeout(() => startService(svc), 3000);
    }
  });
  proc.on("error", (err) => console.log(`${svc.color}[${svc.label}]${COLORS.reset} error: ${err.message}`));
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n🛑 Shutting down all services...");
  for (const c of children) {
    try { c.proc.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("🚀 Paper Trading — Launching all services");
console.log("Services:", services.filter(s => s.enabled).map(s => s.name).join(", "));
console.log("Press Ctrl+C to stop all\n");

for (const svc of services) {
  setTimeout(() => startService(svc), services.indexOf(svc) * 800);
}
