# Production deployment runbook (Railway + changelog ingest)

Use this checklist whenever you deploy **MTG Archive** to production so sessions, DB, CORS, and **automated release notes** keep working.

## 1. Railway — required variables

In the Railway project → your **Node/web service** → **Variables**, confirm (names may already exist):

| Variable | Purpose |
|----------|---------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | MySQL (Railway plugin or external) |
| `SESSION_SECRET` | Long random string (32+ chars); **required** in production |
| `SESSION_SECURE` | Set to `1` when the app is served over **HTTPS** so cookies work |
| `ALLOWED_ORIGIN` | Your public site origin, e.g. `https://yourdomain.com` (CORS + cookies) |
| `APP_URL` | Public base URL (password reset links, etc.) |
| `CHANGELOG_INGEST_SECRET` | Long random string; **same idea as `SESSION_SECRET`** — used by `POST /api/internal/changelog-ingest` and by `npm run changelog:add` locally/CI |

Optional but useful:

| Variable | Purpose |
|----------|---------|
| `PORT` | Usually set by Railway automatically |
| `BIND_HOST` | Leave default unless you need `127.0.0.1` only |
| `MTG_API_URL` | Only for **scripts** (e.g. `changelog:add`) when targeting prod: `https://yourdomain.com` (no trailing slash) |

**Yes — for changelog automation in prod you must set `CHANGELOG_INGEST_SECRET` on Railway.**  
If it is missing, the ingest endpoint returns **503** and `npm run changelog:add` against prod will fail until you add it.

Generate a value (run locally, then paste into Railway):

```bash
openssl rand -base64 48
```

Use a **new** value for production; do not reuse dev secrets in prod if you want blast-radius isolation (optional but recommended).

## 2. Deploy

1. Push to the branch Railway deploys from (often `main`).
2. Wait for the deploy to go **live**.
3. Quick checks:
   - `GET https://yourdomain.com/health` → `{"ok":true}`
   - Sign in on prod; open **What’s new** / user menu — digest should load (DB + `app_changelog` migrated).

## 3. Verify changelog ingest (prod)

From your machine (replace URL and use the **same** secret as in Railway):

```bash
export CHANGELOG_INGEST_SECRET='paste-from-railway'
export MTG_API_URL='https://yourdomain.com'
npm run changelog:add -- --title "Deploy check" --summary "Ingest smoke test — delete or leave." --entryKey "smoke-$(date +%s)"
```

- **401** → wrong bearer / wrong secret.
- **503** → `CHANGELOG_INGEST_SECRET` not set on the **running** service (redeploy after saving variables).
- **200** → row inserted; optional: remove test row in MySQL or leave with a clear `entryKey` for later cleanup.

## 4. Local dev alignment

- **`.env`** (not committed) should include `CHANGELOG_INGEST_SECRET` for local runs of `npm run changelog:add`.
- **`.env.example`** lists the variable for documentation only — never put real secrets there.

## 5. Security notes

- Treat `CHANGELOG_INGEST_SECRET` like an API key: **Railway Variables only**, not in git.
- Anyone with the secret can append changelog rows; rotate it in Railway if leaked, then update local `.env` / CI secrets.

## 6. Rollback

- Redeploy previous Railway deployment or revert git + redeploy.
- DB migrations: this app applies additive migrations on startup; for destructive changes, restore DB backup and match code version.
