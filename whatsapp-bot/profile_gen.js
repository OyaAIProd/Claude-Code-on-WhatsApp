const { spawn } = require("child_process");
const { db } = require("./storage");
const rag = require("./rag");

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const PROFILE_MODEL = process.env.CLAUDE_PROFILE_MODEL || "haiku";
const INTERVAL_MS = parseInt(process.env.PROFILE_GEN_INTERVAL_MS || `${30 * 60 * 1000}`, 10);

function runClaudeOnce(prompt, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const args = ["--print", "--output-format", "json", "--model", PROFILE_MODEL, "--permission-mode", "bypassPermissions", prompt];
    const proc = spawn(CLAUDE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const to = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} reject(new Error("Timeout")); }, timeoutMs);
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      clearTimeout(to);
      if (code !== 0) return reject(new Error(`exit ${code}: ${stderr.slice(0, 200)}`));
      try {
        const j = JSON.parse(stdout.trim());
        resolve(j.result || stdout);
      } catch { resolve(stdout); }
    });
    proc.on("error", reject);
  });
}

async function generateProfileFor(chat) {
  const sourceMsgs = rag.getProfileSourceMessages(chat.chat_id, 80);
  if (!sourceMsgs.length) return null;
  const sample = sourceMsgs.map(m => `${m.sender_name || "?"}: ${(m.text || "").slice(0, 150)}`).join("\n");
  const members = [...new Set(sourceMsgs.map(m => m.sender_name).filter(Boolean))];

  const prompt = `Lo analyze percakapan WhatsApp group ini. Output JSON SAJA (no markdown, no fence):
{"topic": "<3-7 kata topik utama group>", "summary": "<1-2 kalimat ringkas yang group ini bahas dan keadaan terkini>"}

Group: "${chat.chat_name}"
Total msgs analyzed: ${sourceMsgs.length}
Members: ${members.slice(0, 10).join(", ")}

Sample pesan terbaru:
${sample.slice(0, 6000)}

Output JSON sekarang:`;

  try {
    const out = await runClaudeOnce(prompt);
    const jsonMatch = out.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    rag.upsertGroupProfile({
      chat_id: chat.chat_id,
      chat_name: chat.chat_name,
      topic: parsed.topic || "",
      summary: parsed.summary || "",
      member_names: JSON.stringify(members.slice(0, 20)),
      message_count: chat.msg_count,
      last_msg_at: chat.last_msg_at
    });
    console.log(`[PROFILE] ${chat.chat_name}: ${parsed.topic}`);
    return parsed;
  } catch (err) {
    console.error(`[PROFILE] ${chat.chat_name}: ${err.message}`);
    return null;
  }
}

async function runProfileTick() {
  try {
    const chats = rag.getChatsNeedingProfile(24, 30);
    if (!chats.length) return;
    console.log(`[PROFILE] ${chats.length} groups need profile update`);
    for (const chat of chats) {
      await generateProfileFor(chat);
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (err) { console.error("profile tick:", err.message); }
}

function startProfileGenerator() {
  setTimeout(runProfileTick, 60 * 1000);
  setInterval(runProfileTick, INTERVAL_MS);
  console.log(`✅ Profile generator started (every ${INTERVAL_MS / 60000}min, model=${PROFILE_MODEL})`);
}

module.exports = { startProfileGenerator, generateProfileFor, runProfileTick };
