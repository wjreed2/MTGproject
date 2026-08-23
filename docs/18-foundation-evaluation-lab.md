# Foundation Evaluation Lab

**Status:** Development/calibration harness for Foundation v1. Not a user-facing mode. Does not change the locked Foundation model.

The Lab evaluates the **existing** `evaluateFoundation` adapter across a representative fixture suite so we can inspect targets, coverage, contributing cards, Adds/Cuts, synergy, and interaction classifications — then store human ratings as evidence for later **deterministic** coefficient tuning in `js/foundation/foundation-config.js`.

Ratings never write back into the engine.

## Where it lives

| Piece | Path |
|-------|------|
| Production evaluator (unchanged by the Lab) | `js/foundation/foundation-engine.js` |
| Isolated coefficients | `js/foundation/foundation-config.js` (`cloneFoundationConfig` for Lab experiments) |
| Mechanism detection | `js/foundation/foundation-mechanisms.js` (CardIR provides/roles + tags + oracle) |
| Adds/Cuts ranking helpers | `js/foundation/foundation-suggest.js` |
| Lab adapter / diagnostics | `js/foundation-lab/` |
| Representative decks (Kind A lock) | `fixtures/foundation/*.json` |
| Account decks (Kind B/C review) | Hosted app `GET /api/foundation-lab/user-fixtures` (admin); dump `data/foundation-lab/user-decks/` (gitignored) |
| Batch runner | `scripts/test-foundation.js` (`npm run test:foundation`) |
| Golden cases | `scripts/test-foundation-golden.js` |
| Dev UI | `foundation-lab.html` → `/foundation-lab.html` |

Do not put Lab review chrome into the production deck-builder Hybrid slot.

## Pipeline

```
Account decks (manfordf@gmail.com)  ─┐
Synthetic fixtures (Kind A lock)    ─┴→ evaluateFoundationLab(deck, context, config)
    → Foundation evaluation result (diagnostics + adds/cuts + evidence sources)
    → CLI report and/or Lab UI
    → Human ratings (localStorage / JSON export)
    → Regression compare of two run JSON files
```

`evaluateFoundationLab` is the Lab boundary. Swap or extend the production evaluator later without redesigning fixtures, ratings, or compare.

## Commands

```bash
npm run test:foundation
npm run test:foundation -- --deck meren-reanimator
npm run test:foundation -- --all --report
npm run test:foundation -- --json
npm run test:foundation -- --out data/foundation-lab/runs/baseline.json
npm run test:foundation -- --compare baseline.json current.json
npm run test:foundation -- --ratings path/to/ratings.json --report
npm run test:foundation -- --user
npm run test:foundation -- --user manfordf@gmail.com
npm run foundation:pull-user-decks
npm run test:foundation:audit
npm run test:foundation:golden
npm run test:foundation:write-fixtures
```

`--user` evaluates **every site deck** for that account (default `manfordf@gmail.com`). It does not use the 23 synthetic fixtures. Requires `SEMANTICS_PUSH_URL` + `SEMANTICS_INGEST_SECRET`, or a prior dump in `data/foundation-lab/user-decks/` (gitignored).

Default `npm run test:foundation` (no flags) still runs the synthetics so CI keeps the Kind A recognition lock.

Open the UI on a running app server: `/foundation-lab.html`.

## Phone (no desktop)

The Lab is a page on the **hosted app**, not a separate native feature. A phone cannot run `npm run test:foundation`.

Once this code is on the same host the phone app already uses (Railway / production):

1. Sign in as **admin** in the app (Safari or the Capacitor build pointed at that host — not a LAN IP of a laptop).
2. Settings → Developer → **Foundation Lab**.
3. Rate decks with the on-screen GOOD / OK / BAD buttons. Export uses the share sheet when available; Copy ratings works if Safari blocks downloads.

The page and `/fixtures/foundation` require an admin session. They are not a public or regular-user mode.

The Lab UI defaults to **Account decks** (`GET /api/foundation-lab/user-fixtures?email=manfordf@gmail.com`). Switch to **Synthetic fixtures** only for the recognition lock.

Each contributor row shows **evidence source**: `cardir`, `role_tag`, `oracle`, or `multiple` (when sources agree). The Evaluation pipeline table is Need → Mechanism → Card → Evidence → Coverage.

## Isolated experimental configuration

```
Production Hybrid → evaluateFoundation(input) → frozen FOUNDATION_CONFIG
Evaluation Lab    → evaluateFoundation(deck, context, experimentalConfig)
```

Same evaluator. Lab **Experimental config** (or CLI `--config`) clones production via `cloneFoundationConfig(patch)` and passes the clone in. Production `FOUNDATION_CONFIG` stays frozen. Hybrid does not pass a config override.

Example patch (does not change live Hybrid):

```json
{ "version": "lab-experiment", "capabilities": { "interaction": { "adequate": 0.63 } } }
```

## Test kinds

| Kind | Meaning | Suite |
|------|---------|--------|
| A | Mathematical / structural | `npm run test:foundation` / `test:foundation:golden` on synthetics; config-isolation test |
| B | Model / evidence | [19-foundation-cardir-audit.md](./19-foundation-cardir-audit.md); Lab evidence column on account decks |
| C | Recommendation quality | Human GOOD/OK/BAD ratings — never auto-trained |

Lab `--config` / Experimental config clones a patch onto a **copy** of production `FOUNDATION_CONFIG`. It cannot mutate the frozen production object. Hybrid still calls `evaluateFoundation` without a config override.

Keys: G good, O ok, B bad, N/P next/prev deck, A/C focus adds/cuts, J/K next/prev recommendation.

## What the Lab does not do

- No runtime AI/LLM
- No CardIR regeneration
- No `engine2/` edits
- No automatic learning from ratings
- No coefficient optimizer
- No new production Hybrid/Foundation mode
