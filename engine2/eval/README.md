# engine2 eval loop

A repeatable cycle for finding where Suggested Adds / Cuts go wrong, fixing the engine at the **class** of error, and locking the fix in.

```
decks ──► real /api/decks/analyze ──► blind packets ──► judge (rubric.md) ──► report ──► triage ──► fix + fixture ──► next cycle
```

## 1. Decks

A **calibration set** judged every cycle (so progress is measurable) plus a few **new** decks each cycle (to find new blind spots). Spread across colors, archetypes and engine types (cast triggers, events, tribal, 99-driven). Sources: `engine2/fixtures/gameplan/decks` (Will's decks + direction-flip variants), `engine2/fixtures/decks` (EDHREC averages), `engine2/fixtures/pulled` (deck-pull).

Cycle 1 calibration set: vraska-v2, jyoti, bumbleflower, vren, helga, thranduil, korvold-aristocrats, talrand-spellslinger, atraxa-counters, krenko-goblins.

## 2. Packets

```
PORT=3097 node server.js &                      # a private local server running the working tree
node scripts/semantics-eval-loop.js packets --cycle N --decks a,b,c
```

Runs each deck through the real analyze route (same pool, scoring and filters users get) and writes, under `cycles/N/`:
- `packets/<deck>.json` — **blind**: the deck, the commander's text, the top 15 adds and the cuts with card text. No scores, no reasons.
- `engine/<deck>.json` — the engine's side (scores, reasons, breakdowns, plan readout) — for triage only; judges never see it.

## 3. Judge

Fresh agents (no conversation context) judge 2 decks each against [rubric.md](./rubric.md): every add and cut scored 1–100, a failure code for adds under 50, and up to 5 **missing** cards (recall). Output → `cycles/N/ratings/<deck>.json`.

## 4. Report

```
node scripts/semantics-eval-loop.js report --cycle N [--threshold 40]
```

Writes `cycles/N/report.md` / `report.json`: per-deck top-12 add mean, adds below threshold, cut agreement, missing cards, and every low-rated add or cut beside the engine's own reasons, grouped by failure code.

## 5. Triage → fix → lock in

Each low rating gets a cause, and the fix targets the class, never the card:

| Cause | Fix |
|---|---|
| **data** — the card's CardIR is wrong | backfill script or targeted re-extraction |
| **rules** — gameplan/quality misreads it | a rule in `engine2/gameplan.js` / `quality.js` |
| **tuning** — the weights are off | a points/weights change |
| **retrieval** — the right card never reached the pool | server pool (`poolHints`, gap roles) |
| **judge** — the judge is wrong (card text, deck owner's stated preferences) | rubric note; no engine change |

Every confirmed fix adds a fixture assertion (`engine2/fixtures/gameplan/…`), and the cycle isn't done until the gameplan fixtures, quality orderings, invariants and `npm test` all still pass.

## Guardrails

- The deck owner's word beats the judge: standing preferences (37 lands, ~3 wipes, deliberately low removal) are in the rubric, and any correction from Will overrides a rating.
- Judge drift: re-rate a sample of the previous cycle's cards each cycle; if scores for the same card in the same deck move by more than ~15, fix the rubric before the engine.
- Track per cycle: top-12 add mean, % adds below threshold, % cuts disagreed, recall misses. Stop on an archetype when it plateaus.
- Dev-side only. Users never hit an LLM; the judge exists to improve the deterministic engine.

## 6. Learned signal weights (optional, removable)

The add score is a sum of named signals (`plan_converter`, `quality`, `commander_meta`, `thin_substrate:*`, …), each hand-weighted. `scripts/semantics-learn-weights.js` fits one **multiplier per signal** from every judge label so far: each (deck, card) a judge rated, averaged across judges and cycles, plus the cards judges named as missing. Labels belong to the card-in-deck rather than an engine version, so they stay valid as the engine changes.

- Features: the current engine's raw trace per labeled card, with hand weights.
- Model: logistic regression whose prior is the current engine. Multipliers start at 1, are pulled back toward 1 (`--lambda`), and are kept inside a band (`--clamp`, default 0.7–1.6), so learning tunes signals but never switches one off.
- Validation: 5-fold cross-validation **by deck**. It reports per-deck AUC and the top-15 approval rate on held-out decks for hand vs learned.
- Output: `engine2/learned-weights.json`. `engine2/learned.js` applies it through one line in `recommender.js`. Set `ENGINE2_LEARNED=0` for hand weights; unit tests pin them.

```
node scripts/semantics-learn-weights.js                                  # report only
node scripts/semantics-learn-weights.js --lambda 0.1 --clamp 0.7,1.6 --write
```

**Remove:** delete `engine2/learned.js`, `engine2/learned-weights.json`, `scripts/semantics-learn-weights.js`, and the `LW` require plus the `LW.rescore` line in `engine2/recommender.js`.

**Known limit:** labels only cover cards the engine already surfaced, plus judge-named missing cards. Weights can re-rank signals the engine has; they can't learn a concept it lacks.
