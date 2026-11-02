# Semantics holes

Gaps where **Scryfall otags (or other structured external tags) already distinguish a useful role**, but **CardIR / engine2 semantics** do not — so Hybrid, Foundation, Architecture, and plan derivation cannot rely on IR alone for that distinction.

**How to use this file:** add one entry per hole. Prefer facts (what Scryfall has, what vocab/roles have, example cards). Do not treat a workaround in project role tags as closing the semantics hole.

**Related:** [engine2-ir-spec.md](./engine2-ir-spec.md), [engine2-plan.md](./engine2-plan.md), [19-foundation-cardir-audit.md](./19-foundation-cardir-audit.md), [09-reference.md](./09-reference.md) (Burn subtypes).

---

## Burn target subtypes (`burn.any` / `burn.creature` / `burn.player`)

| | |
| --- | --- |
| **Status** | Open (semantics) — project tags + Architecture/Foundation gate work around it |
| **Found** | 2026-09-20 (Valakut Exploration counted as Interaction) |
| **Scryfall** | **Hits it.** Tagger otags: `burn` (umbrella), `burn.any`, `burn.creature`, `burn.player` (hyphen aliases `burn-any`, etc.). No `burn.opponents` otag. |
| **CardIR / vocab** | Flat role `burn` only (`engine2/vocab.js` `ROLES`). No `burn.any` / `burn.creature` / `burn.player`. Wincon kind `burn` is unrelated (closing via damage). |
| **Why it matters** | Undifferentiated `burn` / project `Burn` treats face damage and creature answers the same. Face-only burn is **not** interaction; any-target / creature burn **is**. |

**Example**

- Valakut Exploration: Scryfall `burn` + `burn.player` — opponent damage only → must **not** count as Interaction.
- Lightning Bolt: `burn` + `burn.any` → interaction.
- Flame Slash: `burn` + `burn.creature` → interaction.

**Workaround (not a semantics fix)**

- Project labels `Burn.Any` / `Burn.Creature` / `Burn.Player` ingest the Scryfall otags; `Burn.Opponents` is a project oracle query (no Scryfall otag).
- `js/burn-roles.js` + Architecture / Foundation ignore plain `Burn` for interaction unless oracle (or subtype tags) show creature / any-target damage.

**Desired semantics fix (when IR is extended)**

- Add CardIR roles or axes for burn target class (at least any / creature / player), extract from oracle, and stop treating flat `burn` as spot interaction / Removal.

---

## No `combat` goal template — Architecture subthemes carried client-side

| | |
| --- | --- |
| **Status** | Open (semantics) — client-side workaround in `js/deck-architecture.js` |
| **Found** | 2026-09-21 (Combat strategy in the deckbuilder's Architecture view showed no subthemes) |
| **Scryfall** | N/A — not an otag gap; see [strategy-combat-research.md](../Ready%20Prompts/strategy-combat-research.md) for the otag work, which already shipped |
| **CardIR / vocab / engine2** | `engine2/vocab.js` has the combat axes (`combat.attack_trigger`, `combat.extra`, …) but **no goal template owns them** and the saboteur trigger family (787 commander-legal cards, "deals combat damage to a player") has **no axis at all**. Full gap analysis, proposed axis, proposed prompt join rules, and a fully-specced goal template are in `strategy-combat-research.md` §6 — written, reviewed, **blocked on partner sign-off**, never implemented |
| **Why it matters** | `GOAL_KEY_STRATEGY.combat` (`js/deck-architecture.js`) maps engine2's `combat` goal key to `strategy.combat`, but engine2 never emits that key (no template exists), so the mapping is permanently inert. `js/deck-architecture.js`'s `_buildStrategySubs` normally falls back to the client-side theme vocabulary (oracle patterns, `THEME_CATALOG`) to populate a strategy's subthemes when engine2 has nothing to say — but it only takes that fallback path when engine2 emits **zero** goals for the whole deck, which is rare. Almost every deck gets *some* engine2 goal, so the fallback almost never ran for Combat specifically, and the Architecture view's Combat section showed no subthemes (Attack triggers / Saboteur / Extra combats) even though the oracle-pattern detection, role tags, and catalog wiring in `strategy-combat-research.md` §7 all shipped and work |

**Example**

- A deck engine2 reads as `aristocrats` (or any other goal) that also has 10+ attack-trigger creatures and haste-granting support: Architecture's Strategy section shows an "Aristocrats" pile but **no** Combat pile, even though the deck visibly also plays a combat sub-plan and the Combat strategy chip / theme evidence band elsewhere in the app does show it.

**Workaround (not a semantics fix)**

- `_buildStrategySubs` (`js/deck-architecture.js`) now special-cases the combat family: when engine2 goals exist (so the function would otherwise return only `goalSubs` and skip the theme-vocabulary fallback entirely), it separately runs the theme-vocabulary path (`_themeVocabStrategySubs`, factored out for reuse) and splices in only the rows whose `strategyId` is `strategy.combat` or a `strategy.combat.*` child, deduped against anything engine2 already produced.
- Marked inline as `── COMBAT SUBTHEME WORKAROUND ── TEMPORARY` with a removal note next to the splice, and the pre-existing `GOAL_KEY_STRATEGY.combat` comment now points at it.
- Scoped narrowly on purpose: only the combat family is spliced in this way. If another goal-less strategy hits the same problem later, extend `_isCombatStrategyId`-style scoping rather than reverting to the old "return goalSubs outright" behavior for everyone (that would resurrect goal/theme double-counting bugs the original code avoided).

**Deletion contract — how to turn this off when engine2 ships combat**

1. Implement `strategy-combat-research.md` §6 (new axis, prompt join rules, `combat` goal template) with partner sign-off, and re-extract.
2. Once `deck-goals.js` emits `goal: 'combat'` for real decks, `GOAL_KEY_STRATEGY.combat` stops being inert and `_buildGoalSubs` supplies `strategy.combat.*` rows on its own.
3. Delete the `COMBAT SUBTHEME WORKAROUND` block in `_buildStrategySubs` (`js/deck-architecture.js`) — the `if (goalSubs.length) { ... }` branch collapses back to `if (goalSubs.length) return goalSubs;`.
4. `_isCombatStrategyId` can be deleted too if nothing else references it.
5. Re-run `scripts/test-deck-architecture.js` and spot-check the Architecture view on a combat deck (e.g. the *Dog go bonk* / *On the Prowl* fixtures suggested in `strategy-combat-research.md` §9.2) to confirm the engine2-driven subthemes still render.

**Desired semantics fix (when IR is extended)**

- Ship `strategy-combat-research.md` §6 in full: `combat.damage_trigger` axis (vocab v4→v5), the saboteur/attack-trigger `needs` join rules in `engine2/prompt.js`, and the `combat` goal template placed after `voltron` in `goal-templates.js`. This is the only item still blocking full accuracy — see that doc's §6.0 for the under-100-word case and Q4 for the open partner-approval question.

---
