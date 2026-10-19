// Runs the full bridge flow in META_MOCK=true (no network, no Meta app needed).
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
// test-only vault key, also used by the in-process store require below
process.env.META_STORE_KEY = "aa".repeat(32);
const ENV = {
  ...process.env,
  PORT: String(PORT),
  BASE_URL: BASE,
  META_MOCK: "true",
  SCHED_INTERVAL_MS: "800",
};

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
async function j(res) { return res.json().catch(() => ({})); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // fresh vault for the test run
  const dataDir = path.join(__dirname, "..", "data");
  fs.rmSync(dataDir, { recursive: true, force: true });

  const child = spawn("node", [path.join(__dirname, "..", "server.js")], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let started = false;
  child.stdout.on("data", (d) => { if (d.toString().includes("meta-bridge on")) started = true; });
  child.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 50 && !started; i++) await sleep(200);
  ok("server boots", started);

  try {
    let r = await fetch(`${BASE}/api/health`); let b = await j(r);
    ok("GET /api/health", b.ok === true && b.mock === true, JSON.stringify(b));

    // encryption roundtrip (in-process, same key)
    const store = require("../lib/store");
    const enc = store.encrypt("secret-token-123");
    ok("vault encrypt/decrypt roundtrip", store.decrypt(enc) === "secret-token-123");

    r = await fetch(`${BASE}/api/_mock/seed-page`, { method: "POST" }); b = await j(r);
    ok("mock page seeded", b.ok === true);

    r = await fetch(`${BASE}/api/pages`); b = await j(r);
    ok("page listed, token not exposed", b.pages?.length === 1 && !("page_token" in b.pages[0]) && !("token" in b.pages[0]));

    // immediate FB publish (mock)
    r = await fetch(`${BASE}/api/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: "123456789", message: "Hello from meta-bridge test" }),
    }); b = await j(r);
    ok("POST /api/publish (mock)", b.ok === true && String(b.id).startsWith("fbpost_mock_"), JSON.stringify(b));

    // immediate IG publish (mock)
    r = await fetch(`${BASE}/api/instagram/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: "123456789", image_url: "https://example.com/pic.jpg", caption: "test" }),
    }); b = await j(r);
    ok("POST /api/instagram/publish (mock)", b.ok === true && String(b.id).startsWith("igpost_mock_"));

    // scheduler: job due in the past fires automatically
    r = await fetch(`${BASE}/api/schedule`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: "123456789", kind: "fb", message: "scheduled hello", run_at: new Date(Date.now() - 1000).toISOString() }),
    }); b = await j(r);
    const jobId = b.job?.id;
    ok("POST /api/schedule", b.ok === true && !!jobId);
    await sleep(2500); // let the 800ms loop fire
    r = await fetch(`${BASE}/api/schedule`); b = await j(r);
    const job = (b.jobs || []).find((x) => x.id === jobId);
    ok("scheduler auto-fired the due job", job?.status === "done" && String(job.result_id).startsWith("fbpost_mock_"), JSON.stringify(job));

    // unknown page -> 404, not a crash
    r = await fetch(`${BASE}/api/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: "nope", message: "x" }),
    });
    ok("unknown page -> 404", r.status === 404);
  } finally {
    child.kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
