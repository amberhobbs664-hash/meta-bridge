// In-process scheduler: fires due jobs through an injected publish function.
// Jobs: { id, kind: 'fb'|'ig', page_id, message?, caption?, image_url?, link?, run_at (ISO), status }
"use strict";

const store = require("./store");

function dueJobs(now = new Date()) {
  return store.listJobs().filter((j) => j.status === "scheduled" && new Date(j.run_at) <= now);
}

// publishJob(job) must resolve to { id } (the platform post id) or throw.
async function runDue(publishJob, now = new Date()) {
  const results = [];
  for (const job of dueJobs(now)) {
    store.updateJob(job.id, { status: "running" });
    try {
      const out = await publishJob(job);
      store.updateJob(job.id, { status: "done", result_id: out.id, finished_at: new Date().toISOString() });
      results.push({ id: job.id, ok: true, result_id: out.id });
    } catch (e) {
      store.updateJob(job.id, { status: "failed", error: e.message, finished_at: new Date().toISOString() });
      results.push({ id: job.id, ok: false, error: e.message });
    }
  }
  return results;
}

function startLoop(publishJob, intervalMs = 30000) {
  const timer = setInterval(() => {
    runDue(publishJob).catch((e) => console.error("[scheduler]", e.message));
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { dueJobs, runDue, startLoop };
