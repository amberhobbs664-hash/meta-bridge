// meta-bridge server: Meta OAuth connect + FB/IG publish + auto-scheduler.
// Run: META_STORE_KEY=<64 hex> node server.js   (see .env.example)
"use strict";

require("dotenv").config();
const express = require("express");
const meta = require("./lib/meta");
const store = require("./lib/store");
const scheduler = require("./lib/scheduler");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3101;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const REDIRECT_URI = `${BASE_URL}/auth/meta/callback`;

function needConfigured(res) {
  if (process.env.META_MOCK === "true") return false;
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    res.status(503).json({ ok: false, error: "META_APP_ID / META_APP_SECRET not set. See README (Meta App steps)." });
    return true;
  }
  return false;
}

// ---- health ----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "meta-bridge", version: "0.1.0", mock: process.env.META_MOCK === "true", time: new Date().toISOString() });
});

// ---- OAuth: connect a Facebook user -> their pages land in the vault ----
app.get("/auth/meta", (req, res) => {
  if (needConfigured(res)) return;
  res.redirect(meta.authUrl(REDIRECT_URI));
});

app.get("/auth/meta/callback", async (req, res) => {
  try {
    if (needConfigured(res)) return;
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing ?code=");
    const tok = await meta.exchangeCode(code, REDIRECT_URI);
    const pages = await meta.fetchPages(tok.access_token);
    for (const p of pages) store.savePage(p);
    res.json({
      ok: true,
      connected: pages.map((p) => ({ page_id: p.page_id, page_name: p.page_name, ig_user_id: p.ig_user_id })),
      note: "Tokens are encrypted in the vault. Reconnect any time from /auth/meta.",
    });
  } catch (e) {
    console.error("[oauth]", e.code, e.message);
    res.status(502).json({ ok: false, error: e.message, code: e.code });
  }
});

// ---- connected pages (tokens never exposed) ----
app.get("/api/pages", (req, res) => res.json({ ok: true, pages: store.listPages() }));
app.delete("/api/pages/:id", (req, res) => {
  store.removePage(req.params.id);
  res.json({ ok: true });
});

// ---- immediate publish ----
app.post("/api/publish", async (req, res) => {
  try {
    const { page_id, message, link, image_url, scheduled_publish_time } = req.body || {};
    const page = store.getPage(page_id);
    if (!page) return res.status(404).json({ ok: false, error: "page not connected" });
    const out = await meta.publishToPage(page, { message, link, image_url, scheduled_publish_time });
    res.json({ ok: true, id: out.id || out.post_id });
  } catch (e) {
    console.error("[publish]", e.code, e.message);
    res.status(502).json({ ok: false, error: e.message, code: e.code });
  }
});

app.post("/api/instagram/publish", async (req, res) => {
  try {
    const { page_id, image_url, caption } = req.body || {};
    const page = store.getPage(page_id);
    if (!page) return res.status(404).json({ ok: false, error: "page not connected" });
    if (!image_url) return res.status(400).json({ ok: false, error: "image_url required (must be public)" });
    const out = await meta.publishToInstagram(page, { image_url, caption });
    res.json({ ok: true, id: out.id });
  } catch (e) {
    console.error("[ig]", e.code, e.message);
    res.status(502).json({ ok: false, error: e.message, code: e.code });
  }
});

// ---- scheduler: "මේ page එකට මේ වෙලාවට මේ post එක" ----
app.post("/api/schedule", (req, res) => {
  const { page_id, kind = "fb", message, caption, image_url, link, run_at } = req.body || {};
  if (!page_id || !run_at) return res.status(400).json({ ok: false, error: "page_id and run_at (ISO) required" });
  if (!store.getPage(page_id)) return res.status(404).json({ ok: false, error: "page not connected" });
  if (isNaN(new Date(run_at).getTime())) return res.status(400).json({ ok: false, error: "run_at must be ISO datetime" });
  const job = store.addJob({ page_id, kind, message, caption, image_url, link, run_at });
  res.json({ ok: true, job: { id: job.id, run_at: job.run_at, status: job.status } });
});

app.get("/api/schedule", (req, res) => {
  const jobs = store.listJobs().map((j) => ({ ...j }));
  res.json({ ok: true, jobs });
});

app.delete("/api/schedule/:id", (req, res) => {
  store.removeJob(req.params.id);
  res.json({ ok: true });
});

// ---- scheduler loop: fires due jobs, no approval taps ----
async function publishJob(job) {
  const page = store.getPage(job.page_id);
  if (!page) throw new Error("page disconnected");
  if (job.kind === "ig") return meta.publishToInstagram(page, { image_url: job.image_url, caption: job.caption });
  return meta.publishToPage(page, { message: job.message, link: job.link, image_url: job.image_url });
}
const SCHED_INTERVAL_MS = parseInt(process.env.SCHED_INTERVAL_MS || "30000", 10);
scheduler.startLoop(publishJob, SCHED_INTERVAL_MS);

// mock helper (META_MOCK=true only): seed a fake connected page for testing
if (process.env.META_MOCK === "true") {
  app.post("/api/_mock/seed-page", (req, res) => {
    store.savePage({ page_id: "123456789", page_name: "Mock Page", page_token: "mock_page_token", ig_user_id: "987654321" });
    res.json({ ok: true });
  });
}

app.listen(PORT, () => {
  console.log(`meta-bridge on :${PORT}  (mock=${process.env.META_MOCK === "true"})`);
  console.log(`connect: ${BASE_URL}/auth/meta`);
});

module.exports = app; // for tests
