# Production deployment runbook (Railway + changelog ingest)

Use this checklist whenever you deploy **MTG Archive** to production so sessions, DB, CORS, and **automated release notes** keep working.

## 1. Railway — required variables

In the Railway project → your **Node/web service** → **Variables**, confirm (names may already exist):

| Variable | Purpose |
|----------|---------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | MySQL (Railway plugin or external) |
| `SESSION_SECRET` | Long random string (32+ chars); **required** in production |
| `SESSION_SECURE` | Set to `1` when the app is served over **HTTPS** so cookies work |
| `ALLOWED_ORIGIN` | Your public site origin(s), e.g. `https://yourdomain.com` (comma-separated OK; CORS + cookies). Local phone-on-LAN: include that origin too, e.g. `https://localhost:3001,https://192.168.0.20:3001`. |
| `APP_URL` | Public base URL (password reset links, etc.) |
| `CHANGELOG_INGEST_SECRET` | Long random string; **same idea as `SESSION_SECRET`** — used by `POST /api/internal/changelog-ingest` and by `npm run changelog:add` locally/CI |
| `FOUNDATION_LAB_DEFAULT_ACCOUNT` | Optional. Admin Foundation Lab default account-decks email. Injected into `/foundation-lab.html` only; leave unset if operators always type an email. |

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

## 1b. Engine2 semantics data (dev → prod sync)

All CardIR extraction runs **dev-side only** (`scripts/semantics-extract.js`); prod never
calls an LLM. Finished rows move to prod through an authenticated ingest endpoint,
mirroring the changelog pipeline:

1. Railway → add `SEMANTICS_INGEST_SECRET` (long random string; `openssl rand -base64 48`).
2. Local `.env` → the same `SEMANTICS_INGEST_SECRET`, plus `SEMANTICS_PUSH_URL=https://yourdomain.com`
   (dedicated variable — `MTG_API_URL` often points at the local dev server for changelog testing
   and is only used as a fallback).
3. First load and every incremental load thereafter:

   ```bash
   node scripts/semantics-push-prod.js --dry-run   # preview what would move
   node scripts/semantics-push-prod.js             # incremental (updated_at watermark)
   node scripts/semantics-push-prod.js --full      # re-push everything (idempotent upserts)
   ```

   Incremental is automatic: the script asks the target which of the local rows it is
   missing or holds staler (`POST /api/internal/semantics-ingest/diff`, by `oracle_id` +
   `updated_at`) and sends only those — so the workflow is simply "run extraction
   locally, then run the push". Batches of 150 cards inside a transaction; axes rows are
   replaced per card. A row-level diff rather than a single watermark because extraction
   can run on more than one machine (§1c); older deployments without `/diff` fall back to
   the watermark and say so.

   The reverse direction — `npm run semantics:pull` — mirrors finished rows back down
   into a local DB, and `npm run semantics:status` shows corpus coverage. Both are for
   the multi-machine workflow in §1c; a single-machine setup never needs them.

4. Prod also needs the oracle catalog current (admin **import-oracle** endpoint) so the
   new `scryfall_oracle_cards` columns are populated — the analyze route joins on them.

5. Tag schema is **v5** (`SCRY_TAG_SCHEMA_VERSION` on the server and `_SCRY_TAG_SCHEMA_VERSION`
   in the client). After this deploy, re-run the admin Scryfall tag import (and EDHREC
   percentile recompute) at schema `5`. Leaving only v4 rows makes role pools empty and
   collection saves strip Scryfall tags.

## 1c. Two machines running extraction (collaborator setup)

Extraction is CPU-free but subscription-expensive: every card costs a headless
`claude -p` call. With two people running it, the only thing that stops the same card
being extracted twice is a shared view of what is already done — and the **deployed DB is
that shared view**. Nobody connects to anyone else's MySQL; everything moves over the
same authenticated internal endpoints the push already uses.

The loop on each machine is **pull → extract → push**:

```bash
npm run semantics:status     # shared coverage + what this machine owes / is missing
npm run semantics:pull       # mirror down everything the other machine has finished
node scripts/semantics-extract.js --incremental --rank-from 20001 --rank-to 22000
npm run semantics:push       # send the new rows up
```

`semantics:pull` is the reverse of the push: it reads the local `updated_at` watermark,
fetches newer rows from `GET /api/internal/semantics-export` (paged by an
`(updated_at, oracle_id)` cursor), and upserts them with their **original** timestamps —
so pulled rows never look new to the push and the two directions cannot ping-pong.
Because the local DB then knows what the other machine did, `--incremental` skips those
cards instead of paying for them again.

### Dividing the corpus

`npm run semantics:status` prints the shared DB's coverage by EDHREC-rank band, e.g.

```
    15001–20000  █████████████████·······  70.4%   3439/4883  1444 left
    20001–25000  █·······················   2.5%    120/4775  4655 left
```

Agree on a band each (say, one takes 20001–25000, the other 25001–30000) and pass it to
the runner with `--rank-from` / `--rank-to`; `--unranked` takes the no-EDHREC-rank tail.
The split is by convention, not by lock — the bands are only disjoint because you agreed
they are. Re-pull before starting a band so the skip list is current, and push when a
batch finishes rather than sitting on a week of rows.

Give each machine's runs a distinguishable `--run-id` (`will-2026-09-17-b20k`) — run
tables are local-only and never sync, but the id is stamped into every `card_semantics`
row and is the only way to tell afterwards which machine produced what.

### Onboarding a second machine

1. Clone the repo and `npm install`.
2. Local MySQL: create an empty database, then `.env` with `DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME`
   and `SESSION_SECRET`.
3. `.env` also needs the two sync variables — **the same `SEMANTICS_INGEST_SECRET` that is
   set on Railway**, plus `SEMANTICS_PUSH_URL=https://<the deployed host>`. That secret is
   the whole authorisation story for push/pull; it is not the DB password and grants
   nothing else.
4. `npm start` once. Boot creates every table, engine2's included (`ensureCardSemanticsTables`) —
   the pull refuses to run against a DB that has never booted the app.
5. Populate the oracle catalog, which is what extraction reads card text from: register an
   account locally, promote it (`UPDATE accounts SET role='admin' WHERE email='…'`), then
   Settings → **Rebuild Scryfall (Full)**. Expect ~38k oracle rows and a long first run.
6. Claude Code CLI signed in on that machine (subscription billing — the runner strips
   `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the child env so a run can never
   silently bill the API). Set `CLAUDE_BIN` if `claude` is not on PATH.
7. `npm run semantics:pull` to mirror the corpus so far, then `npm run semantics:status`
   to pick a band.

### Why the push diffs instead of trusting a watermark

With one machine, "push everything newer than the target's `MAX(updated_at)`" is correct.
With two it silently loses rows: machine B's cards, stamped while A was still extracting,
sit *below* the watermark A's push just raised, so B would never send them. The push
therefore asks the target which rows it is missing
(`POST /api/internal/semantics-ingest/diff`, by `oracle_id` + `updated_at`, 2000 per
request) and sends exactly those. Targets deployed before that route exists fall back to
the watermark with a warning — **deploy the current `server.js` before the second machine
starts extracting**, or the fallback will quietly drop its rows.

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
