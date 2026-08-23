# Foundation / Hybrid v2 — implementation plan

**Status:** Architecture v1 complete. Calibration (Phase 19) remains configurable and is not a rewrite. Owner go-ahead 2026-08-23.  
**Contract:** [14-foundation-model.md](./14-foundation-model.md), [15-foundation-interview.md](./15-foundation-interview.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md).

Do not reopen the Foundation interview. Do not change the five capabilities. Do not invent missing coefficients as if they were locked. Isolate all numbers in `js/foundation/foundation-config.js`.

## Implementation rules

1. Read docs/00, 08, 14, 15, 16 before changing scoring.
2. Build architecture before numerical optimization.
3. Do not modify `engine2/`, CardIR extraction/rebuild, runtime AI/LLM, or live Scryfall/EDHREC.
4. Preserve Classic and Semantic. Foundation replaces **Hybrid** in the same UI slot.
5. Git: `development_manford` only.

## Implementation map (Phase 1)

Existing deck data → Plan / Wizard (`js/deck-plan.js`, `js/deck-plan-wizard.js`, `js/commander-plan-ext.js`) → Gameplan (`_cmdGameplanProbs` in `js/decks.js`, `castConsistency` in `js/commander-plan-ext.js`) → **NEW Foundation evaluator** (`js/foundation/`) → Foundation readout → Adds / Cuts ranking (`js/decks.js` Hybrid path). Classic scoring stays in `js/adds-scoring.js`. Semantic stays on `engine2/` via `/api/decks/analyze`.

| Existing piece | Where |
|----------------|--------|
| Role counts / thresholds | `js/decks.js` `_computeCutThresholds`, Adds ctx |
| Classic Adds | `js/adds-scoring.js` `scoreAddCandidateTerms` |
| Classic Cuts | `js/decks.js` `_cutScore` |
| Hybrid merge (legacy) | `_mergeHybridAddPicks` + `POST /api/decks/analyze-wizard` |
| Plan schema | `emptyPlan` + `emptyCommanderPlanFields` |
| Gameplan | `_cmdGameplanProbs`, `solveLandAndEarlyRampIdeals` |
| CardIR fields | `roles`, `provides`, `needs` axes (optional on cards) |
| Why UI | `_buildAddWhyLines`, `_suggestWhyDetailHtml` |
| Mode UI | Classic / Hybrid / Semantic toggles |

## Phases

1. Map (this file) — done.  
2–3. Domain model + isolated config — done.  
4. Need generation — done.  
5–10. Five capability evaluators — done.  
11–12. Synergy + multi-role — done.  
13–14. Target proposal + readout — done.  
15–17. Adds, Cuts, Hybrid slot — done.  
18. Deck suite (`scripts/test-foundation-deck-suite.js`) — done.  
19. Calibration — **open**, config-only.  
20. Release criteria for architecture — met; numerical tuning is not required to use Hybrid v2.

Recommended code order matches the owner plan: model → config → needs → mana → resources → interaction → protection/shared capacity → Keep Going → close the game → synergy/multi-role → readout → Adds → Cuts → cutover → tests → calibration.

## First milestone

A complete deterministic evaluator with **intentionally approximate** parameters that can **explain** a deck’s Foundation. Numerical calibration is Phase 19.

## Code

| Path | Role |
|------|------|
| `js/foundation/foundation-config.js` | Isolated coefficients |
| `js/foundation/foundation-engine.js` | Needs → mechanisms → coverage → evaluation |
| `js/foundation/foundation-suggest.js` | Adds/Cuts ranking + compact/expand HTML |
