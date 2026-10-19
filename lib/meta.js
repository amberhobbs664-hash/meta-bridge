// Meta Graph API client: OAuth token exchange, page tokens, FB + IG publishing.
// Set META_MOCK=true to run the whole flow without network (fake ids).
"use strict";

const GRAPH = "https://graph.facebook.com";
const VERSION = process.env.META_API_VERSION || "v21.0";
const MOCK = process.env.META_MOCK === "true";

const mockId = (p) => `${p}_mock_${Date.now().toString(36)}`;

async function gfetch(path, { method = "GET", token = null, params = {}, body = null } = {}) {
  const url = new URL(`${GRAPH}/${VERSION}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = new Error(data.error?.message || `Graph API HTTP ${res.status}`);
    e.code = data.error?.code;
    e.subcode = data.error?.error_subcode;
    e.meta = data.error;
    throw e;
  }
  return data;
}

// code -> short-lived user token -> long-lived user token (60 days)
async function exchangeCode(code, redirectUri) {
  if (MOCK) return { access_token: "mock_user_token", expires_in: 5184000 };
  const appId = process.env.META_APP_ID, secret = process.env.META_APP_SECRET;
  const short = await gfetch("/oauth/access_token", {
    params: { client_id: appId, client_secret: secret, redirect_uri: redirectUri, code },
  });
  const long = await gfetch("/oauth/access_token", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: secret,
      fb_exchange_token: short.access_token,
    },
  });
  return long;
}

// long-lived user token -> pages the user admins (page tokens do not expire)
async function fetchPages(userToken) {
  if (MOCK) {
    return [{ page_id: "123456789", page_name: "Mock Page", page_token: "mock_page_token", ig_user_id: "987654321" }];
  }
  const data = await gfetch("/me/accounts", { token: userToken, params: { fields: "id,name,access_token" } });
  const pages = [];
  for (const p of data.data || []) {
    let ig_user_id = null;
    try {
      const ig = await gfetch(`/${p.id}`, { token: p.access_token, params: { fields: "instagram_business_account" } });
      ig_user_id = ig.instagram_business_account?.id || null;
    } catch (_) { /* page without linked IG — fine */ }
    pages.push({ page_id: p.id, page_name: p.name, page_token: p.access_token, ig_user_id });
  }
  return pages;
}

// FB: text/link/photo post. scheduled_publish_time = unix seconds (feed posts only).
async function publishToPage(page, { message, link, image_url, scheduled_publish_time }) {
  if (MOCK) return { id: mockId("fbpost") };
  const token = page.page_token;
  if (image_url && !message && !link) {
    // photo post
    return gfetch(`/${page.page_id}/photos`, { method: "POST", token, body: { url: image_url, caption: message || "" } });
  }
  const body = { message };
  if (link) body.link = link;
  if (image_url) body.picture = undefined; // link posts use `link`; multi-photo via attached_media (phase 2)
  if (scheduled_publish_time) {
    body.scheduled_publish_time = scheduled_publish_time;
    body.published = false;
  }
  return gfetch(`/${page.page_id}/feed`, { method: "POST", token, body });
}

// IG: two-step container -> publish. image_url must be public.
async function publishToInstagram(page, { image_url, caption }) {
  if (!page.ig_user_id) throw new Error("No Instagram business account linked to this page");
  if (MOCK) return { id: mockId("igpost") };
  const token = page.page_token;
  const container = await gfetch(`/${page.ig_user_id}/media`, {
    method: "POST", token, body: { image_url, caption: caption || "" },
  });
  // poll until FINISHED
  for (let i = 0; i < 20; i++) {
    const st = await gfetch(`/${container.id}`, { token, params: { fields: "status_code" } });
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR") throw new Error("Instagram media container failed to process");
    await new Promise((r) => setTimeout(r, 3000));
  }
  return gfetch(`/${page.ig_user_id}/media_publish`, { method: "POST", token, body: { creation_id: container.id } });
}

function authUrl(redirectUri) {
  const appId = process.env.META_APP_ID;
  const scope = [
    "pages_show_list", "pages_read_engagement", "pages_manage_posts",
    "instagram_business_basic", "instagram_business_content_publish",
  ].join(",");
  const u = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", scope);
  u.searchParams.set("response_type", "code");
  return u.toString();
}

module.exports = { exchangeCode, fetchPages, publishToPage, publishToInstagram, authUrl };
