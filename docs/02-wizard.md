# Plan Wizard

## Locked wizard structure

The Plan wizard is one modal pass with Back/edit support. Optional steps can be skipped where specified.

Current sequence (planned additions from Foundation interview round 2 — exact insert order not locked):
1. Commander — only if deck has none; may skip for now.
2. Key cards — soft 2–5 band; finish always allowed.
3. Roles — confirm/edit derived roles.
4. Win condition — required.
5. Primary strategy — required.
6. Secondary strategy — optional/skippable.
7. Theme type pickers — one per strategy needing types.
8. Plan sub-tags — theme pieces inside the Plan envelope.
9. Cast turn — target T, consistency %, L* / R* (L*/R* are derived explanation, not Foundation quotas).
10. Protection — importance + optional types.
11. Budget — skippable.
12. **Playstyle** — Aggro↔Control slider (S ∈ [−7, 7]); wizard field; same value as any later panel edit.
13. **Competition** — skippable Casual / Focused / High / cEDH; Undecided allowed.

## Plan confirmation

Minimum plan declaration:
- `winConditionId`
- `primaryStrategyId`

After wizard completion:
- `planConfirmed = true`
- confirmed roles/targets apply only after confirmation

Nothing silently overwrites a confirmed plan.

## Wizard UX note

The wizard should have these plain-language prompts:

> **I will win by [win condition]**

> **I will use [deck theme] to get there**

Both selections should use:
- searchable dropdowns
- all available win conditions / deck themes
- a scrollable selection experience on mobile

This is a UX requirement/note; do not assume it is implemented unless implementation status is explicitly established.

## Win-condition catalog

- `wincon.combat`
- `wincon.commander_damage`
- `wincon.combo`
- `wincon.mill`
- `wincon.life_drain`
- `wincon.lock`
- `wincon.value`
- `wincon.other`

## Strategy catalog

18 IDs:
- `strategy.tokens`
- `strategy.sacrifice`
- `strategy.spellslinger`
- `strategy.reanimator`
- `strategy.voltron`
- `strategy.counters`
- `strategy.landfall`
- `strategy.tribal`
- `strategy.artifacts`
- `strategy.enchantress`
- `strategy.control`
- `strategy.blink`
- `strategy.superfriends`
- `strategy.theft`
- `strategy.stax`
- `strategy.mill`
- `strategy.goodstuff`
- `strategy.other`

## Plan envelope

- Parent Plan target defaults to 30.
- Theme sub-tags live inside Plan.
- Sum of active sub-tag targets cannot exceed Plan target.
- Sub-tag D credit occurs only when Plan itself has a deficit and the sub-tag remains under its cap.
- Planned-cut quantity is subtracted from have counts for role/plan math.
- Primary-tier rule: Ramp/Draw/Removal deficits block Plan sub-tag D while any primary deficit >= 1.

## Undecided option and inferred recommendations

For wizard questions that use a selection:
- Include an explicit **Undecided** option.
- Leaving the question unselected must also be treated as **Undecided**.
- An Undecided answer is not the same as a confirmed negative choice.

When a wizard field is Undecided, the system should make a deterministic recommendation using the information already available, including:
- previous choices made in the wizard
- the current deck
- or both

The recommendation should be presented as a recommendation, not silently treated as the user's confirmed choice. The user should retain final say and be able to accept, change, or leave the recommendation Undecided.

The recommendation logic must remain deterministic and explainable; do not use runtime AI/LLM inference.
