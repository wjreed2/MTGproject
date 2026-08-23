# Foundation Evaluation Lab

**Status:** Development/calibration harness for Foundation v1. Not a user-facing mode. Does not change the locked Foundation model.

The Lab evaluates the **existing** `evaluateFoundation` adapter across a representative fixture suite so we can inspect targets, coverage, contributing cards, Adds/Cuts, synergy, and interaction classifications — then store human ratings as evidence for later **deterministic** coefficient tuning in `js/foundation/foundation-config.js`.

Ratings never write back into the engine.

## Where it lives

| Piece | Path |
|-------|------|
| Production evaluator (unchanged by the Lab) | `js/foundation/foundation-engine.js` |
| Isolated coefficients | `js/foundation/foundation-config.js` |
| Adds/Cuts ranking helpers | `js/foundation/foundation-suggest.js` |
| Lab adapter / diagnostics | `js/foundation-lab/` |
| Representative decks | `fixtures/foundation/*.json` |
| Batch runner | `scripts/test-foundation.js` (`npm run test:foundation`) |
| Golden cases | `scripts/test-foundation-golden.js` |
| Dev UI | `foundation-lab.html` → `/foundation-lab.html` |

Do not put Lab review chrome into the production deck-builder Hybrid slot.

## Pipeline

```
Test deck fixtures
    → evaluateFoundationLab(deck, context, config)
    → Foundation evaluation result (diagnostics + adds/cuts)
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
npm run test:foundation:golden
npm run test:foundation:write-fixtures
```

Open the UI on a running app server: `/foundation-lab.html`.

Keys: G good, O ok, B bad, N/P next/prev deck, A/C focus adds/cuts, J/K next/prev recommendation.

## What the Lab does not do

- No runtime AI/LLM
- No CardIR regeneration
- No `engine2/` edits
- No automatic learning from ratings
- No coefficient optimizer
- No new production Hybrid/Foundation mode
