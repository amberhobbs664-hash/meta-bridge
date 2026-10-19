# meta-bridge — Facebook Page + Instagram connector

Workspace එක Meta (Facebook Pages + Instagram) එක්ක සම්බන්ධ කරන bridge service එක.
OAuth connect → tokens encrypt කරලා vault එකේ → immediate publish + auto-scheduler.

## මියුරුට: Meta App එක හදන steps (එක සැරයක්, ඔයාගේ account එකෙන්)

1. **developers.facebook.com** → Log in → **My Apps → Create App** → නම දෙන්න (උදා: `Pawasa AgentHub`)
2. App dashboard → **Add Product → Facebook Login → Set Up** → platform: **Web**
3. **Facebook Login → Settings** → Valid OAuth Redirect URIs එකට දාන්න:
   `http://localhost:3101/auth/meta/callback` (production URL එක පස්සේ)
4. **App Settings → Basic** → **App ID** + **App Secret** copy කරගන්න → `.env` එකේ `META_APP_ID`, `META_APP_SECRET` වලට දාන්න
5. Left sidebar → **App Review → Permissions and Features** → මේ ටික request කරන්න:
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` (Facebook Page)
   - `instagram_business_basic`, `instagram_business_content_publish` (Instagram)
   - ⚠️ තමන්ගේම pages වලට **Standard Access** ඇති — business verification / review **ඕනේ නැහැ**
6. Instagram account එක **Business/Creator** කරලා Facebook Page එකට link කරන්න (Page Settings → Linked Accounts)
7. App එකේ **Roles → Roles** → මාව (developer/tester) add කරන්න — මට test කරන්න පුළුවන් වෙන්න
8. Browser එකේ `http://localhost:3101/auth/meta` → Facebook login → page(s) select → **Done**

ඒකෙන් පස්සේ:
- `GET /api/pages` — connected pages (tokens කවදාවත් expose වෙන්නේ නැහැ)
- `POST /api/publish` — `{ page_id, message, link?, image_url? }` → FB post එකක් දැන්ම
- `POST /api/instagram/publish` — `{ page_id, image_url, caption }` → IG post (image_url public වෙන්න ඕනේ)
- `POST /api/schedule` — `{ page_id, kind: "fb"|"ig", message/caption, image_url?, run_at: "ISO datetime" }` → වෙලාවට auto-publish, approval tap නැහැ
- `GET /api/schedule` — jobs + status (`scheduled` / `running` / `done` / `failed`)

## Run (local)

```bash
cp .env.example .env
# .env edit: META_STORE_KEY=$(openssl rand -hex 32), META_APP_ID, META_APP_SECRET
npm install
npm test    # mock mode: no network, no Meta app needed
npm start
```

Mock mode (`META_MOCK=true`): හැමදේම වැඩ කරනවා, post ids fake — Meta App එක නැතුව flow එක test කරන්න.

## Notes

- Page access tokens expire වෙන්නේ නැහැ. User token refresh cron එක Phase 2 දි.
- Error 190 (token invalid) ආවොත් `/auth/meta` එකෙන් reconnect.
- `data/connections.json` — encrypted vault, `0600` permissions. Backup එකක් තියාගන්න.
- FB Reels `scheduled_publish_time` support කරන්නේ නැහැ — scheduler එකේම timing layer එකෙන් handle වෙනවා.
- Production deploy: Roar AI app hosting (Colombo) — `BASE_URL` env එක production URL එකට මාරු කරන්න.
