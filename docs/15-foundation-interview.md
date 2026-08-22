# Foundation interview — round 2 (schema, context, Hybrid wiring)

**Status:** IN PROGRESS — awaiting owner answers. Nothing in this file is locked until marked **Locked**.  
**Date started:** 2026-08-22  
**Prereq:** [14-foundation-model.md](./14-foundation-model.md) philosophy is already **DECIDED**. Do not reopen: no runtime AI, no universal card-count quotas, need → solution → preference, synergy reshapes but does not erase Foundation, output is explanatory.

**How to answer:** Reply with IDs, e.g. `F-Q1 D, F-Q2 A, F-Q3 A, …` plus any overrides. Skip or say “later” on any item.

**Not this round:** Theme E CardIR wizard depth (`commander-plan-notes.md`); leftover Theme A label questions; quantitative seed tables (need this schema first).

---

## What this round is for

Philosophy is locked. Implementation still cannot start cleanly because we have not locked:

1. Which Foundation **capabilities** exist (vs mechanisms vs outcomes).
2. What **Deck Context** v1 actually contains (especially competitiveness).
3. How that layer **meets Hybrid** without replacing Classic staples + sandbox theme.
4. A **finite** interaction threat list and a **narrow** coverage-unit v1.

Agent recommendations below are honest technical picks, not locks.

---

## F-Q1 — Layers vs a flat capability list

Foundation notes mix *jobs* (interact), *tools* (tutors, wipes), and *outcomes* (resilience, flexibility). A flat list will recreate quotas.

**A.** One flat list (wincon, ramp, draw, tutors, wipes, protection, recursion, …).  
**B.** Two layers: capabilities + mechanisms only.  
**C.** Outcomes only (resilience / consistency / speed) with no named capabilities.  
**D.** Three layers: **capabilities** (evaluated every deck) → **mechanisms** (need → solution) → **outcomes / secondaries** (resilience, flexibility, mana-efficiency interpretation).

**Recommend: D.** Tutors, wipes, and protection cards are solutions. Resilience is an outcome of several solutions. Putting them all on one list is how “tutor density 2” comes back.

---

## F-Q2 — v1 first-class capabilities

If F-Q1 = D, which capabilities are in **v1** (evaluated for every deck)?

**A.** Five: **Close the game** · **Make mana on time** (L* quantity + manabase quality + R* ramp, with broader curve modifiers later) · **Generate resources** (not only Draw tag) · **Interact with relevant threats** · **Keep going after disruption** (resilience outcome).  
**B.** A plus a sixth: **Execute the strategy / payoffs** as Foundation.  
**C.** Keep Classic tags as the capability list (Ramp, Draw, Removal, …) and only change copy.  
**D.** Smaller: only wincon + mana + interaction; fold resources and resilience into those.

**Recommend: A.** Payoffs/strategy stay **Strategy**, not Foundation (already locked). C would ignore the capability lock. D under-specifies resource and recovery jobs that the last pass called out.

Mechanisms **not** in this list: tutors, selection, redundancy, recursion, protection cards, board wipes, cantrips, wheels. They satisfy capabilities.

---

## F-Q3 — Intended competitiveness / power

Overall evaluation is “plan at the **intended level of competition**.” The wizard has no power/bracket field. Playstyle is Aggro↔Control, not power.

**A.** Add a skippable wizard field (e.g. Casual / Focused / High / cEDH-ish), Undecided allowed; algorithm infers a recommendation when Undecided (same rule as other wizard fields).  
**B.** Infer power from budget + T + fast mana + tutors. No new field.  
**C.** Treat Aggro/Control slider as the competitiveness signal.  
**D.** Defer any competitiveness signal; evaluate only plan-fit, not competition level.

**Recommend: A.** B is noisy and will homogenize around expensive/fast cards. C is the wrong axis. D leaves a locked evaluation sentence unimplemented. Keep it skippable; never silently overwrite.

---

## F-Q4 — Deck Context v1: what is confirmed vs inferred

Which context bundle is **v1**?

| Signal | Always on deck | Inferred if Undecided | User-confirmed |
|--------|----------------|------------------------|----------------|
| Colors, commander, curve, tags, CardIR (if coverage) | yes | — | — |
| Strategy, wincon, T, R*/L*, protection importance, budget, confirmed roles | — | yes when Undecided | wizard |
| Competitiveness (if F-Q3 A) | — | yes when Undecided | wizard |
| Playstyle S ∈ [−7, 7] | existing slider | — | slider |
| Implied opposing threat speed | — | from T + competitiveness + strategy | not a separate control |

**A.** Table as written (v1).  
**B.** Do not infer strategy/wincon; Undecided means those Foundation weights stay generic.  
**C.** Add more v1 controls (explicit threat-speed slider, explicit power number 1–10).  
**D.** Infer almost everything from the list; wizard only for wincon+strategy.

**Recommend: A.** Matches existing Undecided + inferred-recommendation lock. B is safer but weaker. C is too many new controls. D fights user-final-say.

---

## F-Q5 — How Foundation meets Hybrid (v1 wiring)

Classic still uses role-count D. Hybrid merges Classic staples + sandbox theme.

**A.** Replace Classic thresholds with capability scores as soon as the schema exists.  
**B.** **Readout only** in v1: Foundation report (strengths / deficiencies / vulnerabilities) next to suggestions; ranking unchanged.  
**C.** Silently modulate Classic targets from capability need; no new report.  
**D.** **B then C:** explanatory readout first; then light target modulation; never replace the staple/theme split or collapse to one opaque score.

**Recommend: D.** A is a rewrite with no verification path. C without a report hides disagreements the last pass said must be explicit. Readout-first also lets us check the model against real decks before it moves cards.

---

## F-Q6 — Interaction threat types in v1

Locked: coverage of relevant threats, not raw Removal counts. The previous list was illustrative.

**A.** v1 types: **Creature** · **Wide board** · **Artifact** · **Enchantment** · **Graveyard** · **Stack** · **Land**. Combo/engine is a *reason* you need stack/graveyard/creature answers, not its own answer type.  
**B.** Keep “permanents” and “combos/engines” as first-class types alongside A.  
**C.** Creature / noncreature / stack only (three buckets).  
**D.** Defer taxonomy; keep Classic Removal / Counterspell / Wipe tags only.

**Recommend: A.** Finite, color-identity-mappable, matches the threat → color → budget flow. B double-counts (artifact is a permanent; combo is not an answer type). C is too coarse for “red vs graveyard” vulnerabilities. D ignores the coverage lock.

---

## F-Q7 — Coverage units v1 (shared capacity)

Motivating case: a counterspell cannot be full interaction and full protection at once. Ramp+Draw often *can* do both over a game.

**A.** Shared capacity on every multi-tag card.  
**B.** v1 only on **competing-use pairs**. First pair: **interaction ↔ protection**. Default split 50/50 of 1.0 usable capacity, weighted by which need is larger; credit = quality × share. Ramp+Draw and similar stay sublinear D + V until we prove they compete.  
**C.** Keep D+V only; no coverage layer.  
**D.** Hard exclusive: competing cards count for only their better job (the other gets 0).

**Recommend: B.** A is too broad and will fight V. D is the crude zero the design already rejected. Formula weights stay tunable; this only locks *where* shared capacity applies.

---

## F-Q8 — Quantity vs quality

**A.** Always two scores (count and quality) per capability.  
**B.** **Mixed:** Gameplan-backed jobs stay counts (lands, early ramp). Interaction (and similar coverage jobs) use **quality-weighted coverage units**. Quality is not a separate public score.  
**C.** Quality only ranks candidates; need is still integer tag counts everywhere.  
**D.** One 0–10 quality grade per capability, no units.

**Recommend: B.** Lands and R* already have honest count math. Interaction need is “can you answer this threat in time,” which a raw Removal count misses. D becomes the opaque number we rejected.

---

## F-Q9 — Public Foundation wording (9th-grade)

Internal definition stays: capabilities evaluated for every deck.

**A.** “Foundation is whether your deck can do the basic jobs every Commander deck has to do — make mana, keep resources coming, answer threats, and finish the game — in a way that fits your plan. Your strategy is *how* you do those jobs.”  
**B.** “Foundation is the must-have cards: ramp, draw, and removal.”  
**C.** Defer public copy; internal only until UI exists.  
**D.** Owner rewrite (paste below).

**Recommend: A** as working public copy, editable. B is the quota model. C is fine if you do not want copy locked yet.

---

## F-Q10 — CardIR / orchestration v1

**A.** New deterministic layer over existing tags + CardIR + Gameplan; **no CardIR regen**; sandbox-only if Hybrid consumes it. Partner `engine2/` untouched.  
**B.** Wait until CardIR is redone.  
**C.** Classic tags only; ignore CardIR for Foundation.  
**D.** Call partner engine2 analyze as the Foundation evaluator.

**Recommend: A.** Matches Preserve CardIR + no partner edits. Coverage gate already exists (Hybrid degrades below 0.5 semantics). C cannot do threat-type or synergy honestly. D violates the engine2 rule.

---

## Deferred (do not answer unless you want to)

- Exact numeric need curves / seed tables (after F-Q2–F-Q4).  
- Synergy detection rule list (after capability schema).  
- Theme E wizard axis chips.  
- Simulator as validator (already: validate, don’t replace — not v1).  
- Slider-influence diagnosis (implementation, not this interview).

---

## Answer log

| ID | Owner | Date | Notes |
|----|-------|------|-------|
| F-Q1 | | | |
| F-Q2 | | | |
| F-Q3 | | | |
| F-Q4 | | | |
| F-Q5 | | | |
| F-Q6 | | | |
| F-Q7 | | | |
| F-Q8 | | | |
| F-Q9 | | | |
| F-Q10 | | | |
