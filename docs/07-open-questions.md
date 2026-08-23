# Open Questions

## Foundation
Philosophy locked in [14-foundation-model.md](./14-foundation-model.md). Interview complete: [15-foundation-interview.md](./15-foundation-interview.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md).

Still open (implementation, not interview):
- Numeric **coefficients** and seed tables (directions locked: competition raises interact / keep-going / resources and tightens mana-on-time).
- Quantity vs quality **weights** (units locked; numbers not).

Readout shape, wizard insert order, Hybrid v2 cutover, Cuts/swaps, and v1 scope are **locked** in round 5.

## Tutors
Philosophy is **locked**: no tutor quota; consistency need only if a plan-critical piece is present but unreliable; rank extra copies / selection / resources / tutors for that hole; drop tutors if the user dislikes them; skippable wizard field fine / rather not / never.

Still open: exact quantitative unreliability test and ranking coefficients among those mechanisms.

## Protection
Philosophy is **locked**: intent weight (not Classic 0/3/6/10 quota); commander is a protect-target; types are matching hints; shared capacity with interaction.

Still open: exact mapping from importance weight onto coverage numbers.

## Deck fit
How should the system determine deck fit?

Known direction:
- plan
- roles
- strategy
- win condition
- key cards
- deck composition
- playstyle
- card relationships
- curve/mana context
- EDHREC rank

Exact weighting/architecture is not finalized.

## EDHREC rank vs deck identity
How should EDHREC rank interact with deck identity?

Known:
- It should inform quality/popularity without homogenizing decks.
- Exact coefficient/normalization/interaction with fit remains an implementation/design question.

## Aggro / Control slider
Why is the slider not affecting recommendations as much as expected?

Known:
- Threshold math appears correct.
- Other scoring, role matching, caps, primary-tier rules, or candidate availability may be muting the effect.
- Diagnose before changing slider coefficients.

## Complex MTG card text
How should highly complex MTG card text be classified deterministically?

Known:
- Useful coverage appears feasible with structured data, keyword rules, role tags, CardIR, and deterministic heuristics.
- Complex edge cases and coverage limits remain an engineering concern.

## Public Foundation wording
**Locked F-Q9 A.** Copy refined 2026-08-23 in [15-foundation-interview.md](./15-foundation-interview.md). Meaning unchanged; not equal quotas.

## Coverage units
**Where** is locked (F-Q7: competing pairs, first interaction↔protection). Exact numeric weights remain open.

## Interaction need (quantitative)
Threat **types** are locked (F-Q6). **Direction** locked (F3-Q3): higher competition raises interaction. Still open: per-type **amounts** and coefficients. Fast combo may dip interaction slightly, never to zero (F4-Q8).

## Unequal multi-role quality
A card that is excellent at A and mediocre at B should not get the same split as a card that is good at both. Functional-equivalence scoring is not modeled.

## Redundancy and synergy detection
**Rules locked (F4-Q6–Q7):** measurable plan overlap + CardIR provides/needs and combo rules when coverage is good; else degrade to plan overlap. Synergy may reduce the same capability only; never zero; never a different hole. Still open: exact overlap / combo rule tables.

## Counterfactual orchestration
Minimum layer needed to evaluate “replace X with Y” without changing CardIR. Whether a future simulator should **validate** rather than replace the deterministic model.

## Seed / research schema
How context → need curves are stored and versioned (deterministic lookup, not an LLM). Exact methodology is open.

## Exact Deck Context schema
v1 fields locked (F-Q4 + rounds 3–5): list signals always on; wizard confirms strategy/wincon/T/protection/budget/roles/playstyle/competition/casting pattern/tutor pref; infer when Undecided; threat speed inferred. Quantitative **curves / coefficients** still open.

## Next investigation
Foundation interview is **complete**. Implement Hybrid v1 per [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md). Do not start another interview round unless the owner asks.
