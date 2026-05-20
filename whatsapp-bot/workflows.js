const { db } = require("./storage");

function createPending({ ownerJid, name, description, triggerChatId, triggerType, triggerPattern, steps }) {
  const r = db.prepare(`INSERT INTO workflows (owner_jid, name, description, trigger_chat_id, trigger_type, trigger_pattern, steps_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval')`)
    .run(ownerJid, name || `wf_${Date.now()}`, description || "", triggerChatId || null, triggerType, triggerPattern || "", JSON.stringify(steps || []));
  return r.lastInsertRowid;
}

function approve(id) {
  const r = db.prepare(`UPDATE workflows SET status='active' WHERE id=? AND status='pending_approval'`).run(id);
  return r.changes > 0;
}

function reject(id) {
  const r = db.prepare(`UPDATE workflows SET status='rejected' WHERE id=?`).run(id);
  return r.changes > 0;
}

function pauseWf(id) {
  const r = db.prepare(`UPDATE workflows SET status='paused' WHERE id=? AND status='active'`).run(id);
  return r.changes > 0;
}

function resumeWf(id) {
  const r = db.prepare(`UPDATE workflows SET status='active' WHERE id=? AND status='paused'`).run(id);
  return r.changes > 0;
}

function deleteWf(id) {
  const r = db.prepare(`DELETE FROM workflows WHERE id=?`).run(id);
  return r.changes > 0;
}

function list(ownerJid) {
  if (ownerJid) return db.prepare(`SELECT * FROM workflows WHERE owner_jid=? ORDER BY id DESC`).all(ownerJid);
  return db.prepare(`SELECT * FROM workflows ORDER BY id DESC`).all();
}

function get(id) {
  return db.prepare(`SELECT * FROM workflows WHERE id=?`).get(id);
}

function getActiveByTrigger(triggerChatId, triggerType) {
  return db.prepare(`SELECT * FROM workflows WHERE status='active' AND trigger_chat_id=? AND trigger_type=?`).all(triggerChatId, triggerType);
}

function getAllActive() {
  return db.prepare(`SELECT * FROM workflows WHERE status='active'`).all();
}

function matchTriggerPattern(workflow, ctx) {
  if (!workflow.trigger_pattern) return true;
  try {
    const regex = new RegExp(workflow.trigger_pattern, "i");
    const target = (ctx.text || "") + " " + (ctx.media_filename || "");
    return regex.test(target);
  } catch { return false; }
}

function incrementRuns(id) {
  db.prepare(`UPDATE workflows SET runs_count=runs_count+1, last_run=datetime('now') WHERE id=?`).run(id);
}

function describeForApproval(wfId) {
  const w = get(wfId);
  if (!w) return null;
  const steps = JSON.parse(w.steps_json || "[]");
  const trigger = w.trigger_type === "file_in_chat" ? `📎 file masuk di chat ${w.trigger_chat_id || "(saat ini)"}`
    : w.trigger_type === "text_keyword" ? `💬 pesan match pattern "${w.trigger_pattern}"`
    : `${w.trigger_type}`;
  return {
    id: wfId,
    name: w.name,
    description: w.description,
    trigger,
    steps,
    status: w.status
  };
}

module.exports = {
  createPending, approve, reject, pauseWf, resumeWf, deleteWf, list, get,
  getActiveByTrigger, getAllActive, matchTriggerPattern, incrementRuns, describeForApproval
};
