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
