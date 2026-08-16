# Architecture & Data Sources

## Major files

- `js/deck-plan.js` — plan schema, rankers, `planMatchScore`, plan-only backfill gate
- `js/deck-plan-wizard.js` — wizard UI and step flow
- `js/commander-plan-ext.js` — key-card role derivation, L* / R*, Protection helpers
- `js/decks.js` — client-side playstyle slider and `_computeCutThresholds`
- `engine2/thresholds.js` — server-side simplified threshold mirror
- `engine2.1wizard/` — sandbox for hybrid engine integration; do not modify partner `engine2/`

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

## Hybrid

Classic half handles staple holes:
- Ramp
- Draw
- Removal

Sandbox half handles theme/synergy constrained by the confirmed plan.

Degrade to Classic-only when sandbox coverage is low.

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
