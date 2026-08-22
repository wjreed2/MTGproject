# Hybrid Suggested Adds

**Status:** Implemented as a merge of Classic staples + sandbox theme rows (Ready Prompts 27–28). Deck Need / Deck Fit / coverage-unit scoring is **not** wired into this merge yet.

This file is the working context for improving Hybrid suggestions. Do not treat it as a license to replace Classic scoring, edit partner `engine2/`, or introduce runtime AI.

## Name collisions — read first

Four different “hybrid” ideas exist. Do not mix them:

| Name | What it is | Status |
|------|------------|--------|
| **Hybrid suggestion mode** | UI toggle: Classic staples + `engine2.1wizard` theme rows | Implemented |
| **`hybridMult` / `hybridDMultiplier`** | Classic D-term bump/shrink when a confirmed plan matches the candidate | Implemented in `js/adds-scoring.js` |
| **`plan.hybridRoleModifiers`** | v2 hook on the plan schema (`alpha`/`beta` overrides) | Hook present; defaults used; not a user-facing editor |
| **Hybrid mana** | `{W/U}`-style costs in goldfish / mana parsing | Unrelated to suggestions |

When this file says Hybrid, it means **suggestion mode** unless a formula term is named.

## What Hybrid is today

Suggested Adds has three explicit engines (`mtg_suggest_algo`):

1. **Classic** — client role-tag heuristics (`_scoreAddCandidate` → `scoreAddCandidateTerms`).
2. **Hybrid** — Classic list, then merge sandbox theme rows from `POST /api/decks/analyze-wizard`.
3. **Semantic** — partner `POST /api/decks/analyze` (`engine2/` only). No silent fallback.

Master switches:

- Deck Goal off → Classic is forced; engine toggles hide.
- Settings **Hybrid adds** (`mtg_hybrid_adds !== '0'`) off → Hybrid option is removed; anyone parked on Hybrid is coerced to Semantic. Plan data is not cleared.

Cuts do **not** get a Classic+sandbox merge. In Hybrid mode, Cuts use Classic `_cutScore`. Semantic Cuts use partner `engine2` (lower score = stronger cut). Planned cuts in `deck.cuts` are planning markers, not scored recommendations.

## Adds merge (Prompt 27)

Implemented in `js/decks.js` (`_fetchWizardThemeAdds`, `_mergeHybridAddPicks`).

Preconditions for the sandbox half:

- Hybrid mode on
- `planConfirmed`
- `/api/decks/analyze-wizard` returns adds
- CardIR coverage `coverage.semantics >= 0.5`

If the fetch fails or coverage is low, the list degrades to Classic-only. Theme rows are tagged `source: 'sandbox'` and show sandbox Why lines; Classic rows keep term breakdowns.

Slotting (current constants):

- Total cap = `_ADD_SUGGESTION_COUNT` (16)
- Theme slots = `min(6, max(2, floor(16/2)))` → **6**
- Staple slots = remainder → **10**
- Staple rows are Classic picks that fill an active **Ramp / Card Draw / Removal** deficit while `hasPrimaryNeed` is true
- Remaining Classic picks fill leftover slots after theme rows
- Dedupe by lowercased card name

Classic still runs the Owned / All Cards pool, color-identity filter, planned-add exclusion, CK/budget gates, and primary-tier D rules. Sandbox does not replace those for staple holes.

## Bidirectional loop (Prompt 28)

`POST /api/decks/analyze-wizard` (sandbox only; partner `/analyze` untouched):

- Planned Adds count as in-deck
- Planned Cuts reduce/remove copies
- Confirmed `primaryStrategyId` / type picks reorder sandbox goals when they map
- Confirmed plan fields can enrich sandbox thresholds (Prompts 29–31)
- Wizard pre-fill may use sandbox goals/types; user confirm remains required

Changing the confirmed plan should change Hybrid theme rows without dropping Classic staple rows when Ramp/Draw/Removal are still short.

## What Hybrid is not

Hybrid is **not** a unified Deck Fit score. It concatenates two independently ranked lists.

It does **not** currently:

- Allocate shared-capacity coverage units across interaction vs protection
- Recompute whole-deck metrics before vs after a candidate (counterfactual replacement)
- Scale interaction need from speed + power + strategy as a single context model
- Feed Commander Gameplan probabilities into `_scoreAddCandidate`
- Treat `L*` as an Adds land deficit (`R*` does become Ramp threshold when the plan is confirmed; broader mana-demand modifiers from the Foundation model are not applied yet)
- Evaluate threat-type interaction coverage vs color/budget vulnerabilities
- Report Foundation strengths / deficiencies / vulnerabilities (explanatory output is designed, not built)
- Merge Cuts the same way as Adds

## Design intent for the next layer

The product goal is still: recommend the card that makes **this deck** better at executing its plan, not the globally strongest or highest-EDHREC card.

Signals that should eventually inform Hybrid (and Classic) ranking, without homogenizing decks:

- confirmed plan (strategy, win condition, sub-tags, type picks, key cards)
- commander, colors, curve / mana demands
- power and speed / target cast turn
- role needs and deficits
- CardIR provides/needs/roles/anti/wincon/tribal when coverage is adequate
- EDHREC rank as a quality/popularity **signal**
- projected replacements (planned Adds/Cuts)

Do not collapse those into “always pick the highest EDHREC card” or a single static role target. Existing targets already change with plan and playstyle; extend that.

Related design (not yet implemented as scoring):

- [14-foundation-model.md](./14-foundation-model.md) — locked capability-based Foundation (need → solution → preference; no universal quotas)
- [11-interaction.md](./11-interaction.md) — context-dependent interaction quantity/quality and threat-type coverage
- [12-coverage.md](./12-coverage.md) — shared-capacity multi-role credit
- [13-deck-fit.md](./13-deck-fit.md) — deck-level need/fit and counterfactual replacement

Future Hybrid Why lines should speak in strengths / deficiencies / vulnerabilities where the algorithm disagrees with intent, rather than only tag deficits. Do not replace the staple/theme split with a single opaque Foundation score.

## Hard constraints (repeat)

- Deterministic only — no runtime AI/LLM in ranking
- Never edit partner `engine2/`
- All sandbox ranking changes go in `engine2.1wizard/`
- Never live-Scryfall or EDHREC-scrape at suggestion time
- User has final say; do not silently overwrite confirmed plan or tags
- Do not redo CardIR unless existing semantics cannot support the model and that rewrite is explicitly approved

## Key files

| Path | Role |
|------|------|
| `js/decks.js` | Mode toggle, Classic ranking, Hybrid merge, Why UI |
| `js/adds-scoring.js` | Classic term math including `hybridMult` and `H` |
| `js/deck-plan.js` / `js/deck-plan-wizard.js` | Plan schema, confirm gate, wizard |
| `server.js` `POST /api/decks/analyze-wizard` | Sandbox analyze + planning-board projection |
| `engine2.1wizard/*` | Sandbox goals, thresholds, recommender, explain, wizard-bridge |
| `engine2/*` | Partner Semantic path only |

Canonical merge-track design: [Ready Prompts/suggested-adds-improvement-plan.md](../Ready%20Prompts/suggested-adds-improvement-plan.md). Implementation prompts 27–28 are Completed.
