# Foundation interview — round 2 (schema, context, engine destination)

**Status:** Completed — owner-locked 2026-08-22.  
**Prereq:** [14-foundation-model.md](./14-foundation-model.md) philosophy.  
**Interview style:** one multiple-choice question at a time; answer is locked unless the owner clarifies.

Do not reopen these without an explicit ask. Rounds 3–5 are locked in [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md). The Foundation interview is complete. Next work is Hybrid v1 implementation.

---

## Locked summary

| ID | Lock |
|----|------|
| **F-Q1 D** | Three layers: capabilities → mechanisms → outcomes/secondaries. |
| **F-Q2 A** | v1 capabilities (names refined 2026-08-23; model not reopened): Close the game · Access the mana needed to execute the plan · Generate resources · Interact with relevant threats · Continue executing the plan after disruption. Degree varies by deck. Strategy/payoffs stay Strategy. Tutors, wipes, protection cards, etc. are mechanisms. |
| **F-Q3 A** | Skippable wizard **competition** field. Undecided allowed; algorithm may recommend, never silently overwrite. Categories: Casual / Focused / High / **cEDH**. **cEDH is its own thing**, not “cEDH-ish.” |
| **F-Q4 A** | Deck Context table (always-on list signals; wizard confirms; infer when Undecided; opposing threat speed inferred). **Playstyle slider (S ∈ [−7, 7]) is a wizard field**, same stored value as any later panel edit. |
| **F-Q5 A+B** | This work **replaces Hybrid** (Classic staples + sandbox theme merge) as the suggestion engine. Ranking from Foundation. **Explanatory readout required** (strengths / deficiencies / vulnerabilities). Not an opaque score. Hybrid may keep running until cutover. |
| **F-Q6 A** | v1 threat types: Creature · Wide board · Artifact · Enchantment · Graveyard · Stack · Land. Combo/engine is a *reason*, not a type. |
| **F-Q7 B** | Shared capacity v1 only on competing-use pairs. First pair: **interaction ↔ protection**. Capacity 1.0, default 50/50 unless one need is larger; credit = quality × share. Ramp+Draw stay additive until proven competing. |
| **F-Q8 B refined** | Quality-weighted coverage units. **Access the mana needed to execute the plan** is Gameplan-style success (commander on T + key cards + wincon pieces; broader than land drops), not an L*/R* quota. Hypergeo still counts real cards. L*/R* may be shown as derived explanation. **Other roles keep a per-deck target number**, filled by coverage units. |
| **F-Q9 A** | Public copy (refined 2026-08-23; meaning unchanged): “Foundation is whether your deck can perform the basic jobs a Commander deck needs to perform — make mana, keep resources coming, answer threats, and finish the game — in a way that fits your plan. Your strategy is how you do those jobs.” |
| **F-Q10 A** | New deterministic layer over existing tags + CardIR + Gameplan. No CardIR regen. Partner `engine2/` untouched. Degrade when CardIR coverage is low. |

---

## Original questions (kept for history)

### F-Q1 — Layers vs a flat capability list

**Locked: D**

### F-Q2 — v1 first-class capabilities

**Locked: A.** Capability name refined 2026-08-23 to **Access the mana needed to execute the plan** (broader than land drops; Round 3 rules unchanged). L*/R* are not the need quota — see F-Q8.

### F-Q3 — Intended competitiveness / power

**Locked: A**, labels Casual / Focused / High / **cEDH** (not cEDH-ish).

### F-Q4 — Deck Context v1

**Locked: A**, plus playstyle in the wizard.

### F-Q5 — How Foundation meets Hybrid

**Locked: A + B.** Destination replaces Hybrid. Readout required.

### F-Q6 — Interaction threat types in v1

**Locked: A**

### F-Q7 — Coverage units v1 (shared capacity)

**Locked: B**

### F-Q8 — Quantity vs quality

**Locked: B, owner-refined.** Mana-on-time = success test, not land/ramp quota. Other roles = per-deck target numbers + coverage units.

### F-Q9 — Public Foundation wording

**Locked: A**

### F-Q10 — CardIR / orchestration v1

**Locked: A**

---

## Answer log

| ID | Owner | Date | Notes |
|----|-------|------|-------|
| F-Q1 | D | 2026-08-22 | Three layers |
| F-Q2 | A | 2026-08-22 | Five capabilities |
| F-Q3 | A | 2026-08-22 | Wizard competition field; cEDH distinct |
| F-Q4 | A | 2026-08-22 | Context table; playstyle in wizard |
| F-Q5 | A+B | 2026-08-22 | Replaces Hybrid; readout required |
| F-Q6 | A | 2026-08-22 | Seven threat types |
| F-Q7 | B | 2026-08-22 | Competing pair interaction↔protection |
| F-Q8 | B refined | 2026-08-22 | Coverage units; mana = on-time success; other roles have targets |
| F-Q9 | A | 2026-08-22 | Public wording |
| F-Q10 | A | 2026-08-22 | New layer; no CardIR regen; no engine2 edits |
