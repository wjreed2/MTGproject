# Open Questions

## Foundation
Philosophy locked in [14-foundation-model.md](./14-foundation-model.md). Schema locked in [15-foundation-interview.md](./15-foundation-interview.md).

Still open:
- Exact formulas for context-dependent need levels (round 3).
- Quantity vs quality **weights** (units locked; numbers not).
- Exact presentation/UI for overall evaluation (later round).
- Wizard insert order for playstyle + competition.

## Tutors
Philosophy is **locked**: no tutor quota; tutors are one consistency mechanism; user philosophy constrains the solution, not the need.

Still open: how to detect a consistency need quantitatively, and how to rank tutor vs redundancy vs draw vs selection.

## Protection
Philosophy is **locked**: part of resilience; evaluate what actually needs protecting; no universal quota.

Still open: how wizard Protection importance maps onto capability coverage, and shared capacity with interaction.

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
**Locked F-Q9 A.** Working copy in [15-foundation-interview.md](./15-foundation-interview.md). Still editable as copy, not as meaning.

## Coverage units
**Where** is locked (F-Q7: competing pairs, first interaction↔protection). Exact numeric weights remain open.

## Interaction need (quantitative)
Threat **types** are locked (F-Q6). Still open: how competition, speed, and strategy set the **amount** of coverage needed per type.

## Unequal multi-role quality
A card that is excellent at A and mediocre at B should not get the same split as a card that is good at both. Functional-equivalence scoring is not modeled.

## Redundancy and synergy detection
How extra copies, timing, and explicit measurable synergy relationships are detected. Synergy must be deterministic (no runtime LLM). Rules are not specified.

## Counterfactual orchestration
Minimum layer needed to evaluate “replace X with Y” without changing CardIR. Whether a future simulator should **validate** rather than replace the deterministic model.

## Seed / research schema
How context → need curves are stored and versioned (deterministic lookup, not an LLM). Exact methodology is open.

## Exact Deck Context schema
v1 fields locked (F-Q4): list signals always on; wizard confirms strategy/wincon/T/protection/budget/roles/playstyle/competition; infer when Undecided; threat speed inferred. Quantitative **curves** still open (round 3).

## Next investigation
Round 2 is **locked** ([15-foundation-interview.md](./15-foundation-interview.md)). Round 3 is need-setting: mana-on-time x, y, z; how other-role target numbers are set; how competition/playstyle change needs.

Do not implement the Hybrid-replacement engine until need-setting, mechanisms/synergy, and output/cutover are locked.
