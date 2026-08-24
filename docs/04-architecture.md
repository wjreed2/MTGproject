# Architecture & Data Sources

## Major files

- `js/foundation/` — Hybrid v2 evaluator + isolated config (production path)
- `js/foundation-lab/` — Evaluation Lab adapter (dev/calibration only; see [18-foundation-evaluation-lab.md](./18-foundation-evaluation-lab.md))
- `js/deck-plan.js` — plan schema, rankers, `planMatchScore`, plan-only backfill gate
- `js/deck-plan-wizard.js` — wizard UI and step flow
- `js/deck-themes.js` — themes running through the list + plan jive/clash (Strategy readout)
- `js/commander-plan-ext.js` — key-card role derivation, L* / R*, Protection helpers
- `js/decks.js` — playstyle slider, `_computeCutThresholds`, Classic/Hybrid/Semantic suggestion UI, Hybrid merge
- `js/adds-scoring.js` — Classic Adds term math
- `engine2/` — partner Semantic analyze (do not modify)
- `engine2.1wizard/` — sandbox copy for Hybrid / wizard marriage; never a substitute for editing `engine2/`
- `server.js` — `/api/decks/analyze` (partner) and `/api/decks/analyze-wizard` (sandbox)

## Plan inference

- Path A: `deckCardCount < 80` — rank strategies/win conditions from commander Oracle text.
- Path B: `deckCardCount >= 80` — rank from decklist role-tag counts and card-type ratios.
- Wizard sequence remains the same; only ranking quality changes.

## Persisted plan schema

- `winConditionId`
- `primaryStrategyId`
- `secondaryStrategyId`
- `roughMaxDeckBudgetUsd`
- `roughMaxPerCardBudgetUsd`
- `allowBudgetBusters`
- `fieldSources`
- `planConfirmed`
- `planSubTags`
- `planTypePicks`
- `planTypePickSources`
- `typePicks`
- `keyCards`
- `confirmedRoles`
- `rolesDerivedAt`
- `rolesStale`
- `stapleWarningAck`
- `targetCastTurn`
- `consistencyPct`
- `landIdeal`
- `earlyRampIdeal`
- `protectionImportance`
- `protectionTypes[]`
- `tertiaryStrategyId` (v2 hook, null)
- `hybridRoleModifiers` (v2 hook, null)
- `cutsShielding` (v2 hook, null)

## Roles

Roles are functional labels used by the existing system, such as:
- Ramp
- Card Draw
- Removal
- Protection
- Recursion
- Plan-related roles

Confirmed roles count for confirmed-role ideals and stronger D scoring.

A card can count toward multiple confirmed roles; multi-role cards count +quantity toward each matched role.

## Playstyle

Aggro / Control is a slider that changes role COUNT TARGETS, not individual card scores. It therefore changes deficits and surpluses indirectly.

Roles not touched by the slider:
- Tutor
- Counterspell
- Protection
- Recursion
- confirmed-plan-only roles

## Hybrid suggestion mode

See [10-hybrid-suggestions.md](./10-hybrid-suggestions.md) for the working spec.

Classic half handles staple holes (Ramp / Card Draw / Removal). Sandbox half (`engine2.1wizard` via `/api/decks/analyze-wizard`) handles theme/synergy constrained by the confirmed plan. Merge/dedupe by name; degrade to Classic-only when CardIR coverage is below 50% or the fetch fails.

Cuts: Hybrid mode uses Classic `_cutScore`. Semantic mode uses partner engine2 (`{name, score, reasons, breakdown}`; lower score = stronger cut). User planned cuts live in `deck.cuts` and are not scored recommendations.

`plan.hybridRoleModifiers` is a v2 hook for Classic D multiplier overrides. It is not the Hybrid UI toggle.

## CardIR

Stored in MySQL `card_semantics.ir_json`, joined by `oracle_id`.

Top-level fields include: `ir_version`, `vocab_version`, `oracle_id`, `name`, `layout`, `faces`, `provides`, `needs`, `roles`, `anti`, `wincon`, `tribal`, `power_level_hint`, `confidence`, `_prov`.

The capability layer used most by scoring: `provides`, `needs`, `roles`, `anti`, `wincon`, `tribal`, `power_level_hint`. Full rules/effect AST is in `faces[].abilities[]`.

Engine2 (and the sandbox copy) is deterministic semantic analysis, not game simulation.

## Goldfish / playtest

- `js/goldfish.js` — opening-hand Monte Carlo (1000 trials) and interactive manual goldfish
- `js/goldfish-engine.js` + `js/engine/*` — richer interactive playtest (mana, stack, triggers, combat, bot); incomplete / `manualQueue` dependent; **not** an automated Hybrid evaluator

`docs/engine2-plan.md` still calls for future engine2 simulation milestones. Those must not silently become the suggestion engine.

## External data

### Scryfall
Provides card data including:
- `edhrec_rank`
- Oracle text
- mana value
- types
- project-derived role data

No live lookup at suggestion time.

### EDHREC
Used conceptually through EDHREC rank as a popularity/usage signal.

Do not use per-category endpoints or runtime scraping.

### Archidekt
Investigation found:
`GET /api/decks/24232329/v2/cards/?includeDeleted=1`

Response contained a `cards` array with fields including:
- `id`
- `categories`
- `card`
- `deletedAt`

Investigation suggested historical cards may be represented through deleted metadata rather than a dedicated history endpoint. This was an investigation, not a finalized dependency.

### CardIR / project role metadata
Key-card role derivation uses project role tags plus CardIR roles and axes a card needs/provides when CardIR is available.
