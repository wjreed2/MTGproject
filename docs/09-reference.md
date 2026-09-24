# Reference / Verification

## Locked Plan Wizard constants

- `PLAN_WIZARD_ANALYZE_THRESHOLD = 80`
- `PLAN_INFERENCE_CONFIDENCE_MIN = 0.35`
- `PLAN_PRIMARY_OPTIONS_COUNT = 6`
- `PLAN_BUDGET_BUSTER_MAX = 2`
- `PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE = 0.85`

## Budget behavior

- `roughMaxDeckBudgetUsd` is a soft tie-break only.
- `roughMaxPerCardBudgetUsd` deprioritizes over-budget cards.
- `allowBudgetBusters` permits up to 2 cards above the per-card budget if they are in the top 15% of the scored pool.

## Role derivation

- Union project role tags + CardIR roles/needs/provides when available.
- Map to project labels and dedupe.
- Ramp, Card Draw, and Removal are pre-added and checked, but can be unchecked.
- Default target per added/derived role is 10, with a soft warning outside 8–12.

## Protection

- High importance auto-adds Protection as a checked confirmed role, with opt-out.

## Ping

Ping = 1 damage to creature/player; it is a project role.

## Burn subtypes

Parent project tag **Burn** (Scryfall `otag:burn`) is an umbrella only — it does **not** count as interaction or removal by itself.

| Label | Meaning | Interaction? |
| --- | --- | --- |
| `Burn.Any` | Damage to any target / creature-or-player style | Yes |
| `Burn.Creature` | Creature-directed damage | Yes |
| `Burn.Player` | Target player / player-or-planeswalker | No |
| `Burn.Opponents` | Each/all opponents (e.g. Valakut Exploration, Guttersnipe) | No |

Scryfall tagger already has `burn.any`, `burn.creature`, and `burn.player` (ingested as project labels `Burn.Any` / `Burn.Creature` / `Burn.Player`). There is **no** Scryfall `burn.opponents` otag — `Burn.Opponents` is a project oracle query. CardIR/semantics only has the flat role `burn` (no `burn.any` etc.). Reads and writes use tag schema **v5**. After deploy, re-run the admin Scryfall tag import so `scryfall_oracle_tags` rows exist at schema `5` — v4 rows are invisible to v5 readers. Until that import, Architecture and Foundation fall back to oracle text via `js/burn-roles.js`. Oracle burn labels require damage text; “target creature” on bounce or exile is not `Burn.Creature`.

## Verification checklist

- Empty decklist + 3 key cards via autocomplete roles derive; staples pre-checked.
- Uncheck derived role leaves roles-to-fill / ideals.
- Uncheck Ramp warning + confirmation required.
- Add role via search appears with target 10.
- Change key cards after confirm → stale banner; Re-derive only on explicit action.
- Multi-role card counts toward each matched confirmed role.
- Unset T with MV 5 commander → effective T=5.
- T=4 → early ramp <=3; n=11.
- L* in [35,40]; R* solves for 85% consistency.
- Manual L* edit stored; Gameplan + Adds both reflect new ideals.
- Not important protection ideal 0.
- High protection ideal 10; Protection pre-checked.
- Voltron High precheck + explanation.
- Protection types ideal unchanged; matching boost only.
- Card with only protection.single counts once toward Protection.
- Planned cut excluded from have counts.
- Sub-tag cap enforced.
- Confirmed Tribal plan sandbox theme picks when coverage is adequate; Classic staples still appear when Ramp is short.
- Changing confirmed plan changes hybrid theme suggestions.
- Hybrid Adds: sandbox coverage below 0.5 degrades to Classic-only; theme slots 6 of 16; Cuts stay Classic in Hybrid mode.
- Do not confuse Hybrid **mode**, Classic `hybridMult`, `plan.hybridRoleModifiers`, and hybrid mana costs.
