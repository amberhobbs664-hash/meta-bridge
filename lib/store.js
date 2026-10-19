// Encrypted on-disk vault for Meta page tokens.
// AES-256-GCM, key from META_STORE_KEY (64 hex chars = 32 bytes).
// Nothing secret is ever logged.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const VAULT_FILE = path.join(DATA_DIR, "connections.json");

function key() {
  const hex = (process.env.META_STORE_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("META_STORE_KEY must be 64 hex chars (32 bytes). Generate: openssl rand -hex 32");
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: enc.toString("hex") };
}

function decrypt(blob) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(blob.iv, "hex"));
  decipher.setAuthTag(Buffer.from(blob.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(blob.data, "hex")), decipher.final()]).toString("utf8");
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(VAULT_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { pages: {}, jobs: [] };
    throw e;
  }
}

function writeAll(doc) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(VAULT_FILE, JSON.stringify(doc, null, 2), { mode: 0o600 });
}

// ---- pages ----
function savePage(page) {
  // page: { page_id, page_name, page_token, ig_user_id }
  const doc = readAll();
  doc.pages[page.page_id] = {
    page_id: page.page_id,
    page_name: page.page_name,
    ig_user_id: page.ig_user_id || null,
    connected_at: new Date().toISOString(),
    token: encrypt(page.page_token),
  };
  writeAll(doc);
}

function getPage(page_id) {
  const doc = readAll();
  const rec = doc.pages[page_id];
  if (!rec) return null;
  return { ...rec, page_token: decrypt(rec.token) };
}

function listPages() {
  const doc = readAll();
  return Object.values(doc.pages).map((r) => ({
    page_id: r.page_id,
    page_name: r.page_name,
    ig_user_id: r.ig_user_id,
    connected_at: r.connected_at,
    token_ok: true, // token itself is never exposed
  }));
}

function removePage(page_id) {
  const doc = readAll();
  delete doc.pages[page_id];
  writeAll(doc);
}

// ---- scheduled jobs ----
function addJob(job) {
  const doc = readAll();
  job.id = "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  job.status = "scheduled";
  job.created_at = new Date().toISOString();
  doc.jobs.push(job);
  writeAll(doc);
  return job;
}

function listJobs() {
  return readAll().jobs;
}

function updateJob(id, patch) {
  const doc = readAll();
  const j = doc.jobs.find((x) => x.id === id);
  if (!j) return null;
  Object.assign(j, patch);
  writeAll(doc);
  return j;
}

function removeJob(id) {
  const doc = readAll();
  doc.jobs = doc.jobs.filter((x) => x.id !== id);
  writeAll(doc);
}

module.exports = { savePage, getPage, listPages, removePage, addJob, listJobs, updateJob, removeJob, encrypt, decrypt };
