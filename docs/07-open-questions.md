# Open Questions

## Foundation
Philosophy is **locked** in [14-foundation-model.md](./14-foundation-model.md): capability-based, three input sources, explanatory output.

Still open (implementation):
- Exact Foundation capability taxonomy and formal capability schema.
- Exact formulas for context-dependent need levels.
- Quantity vs quality modeling for each capability.
- Exact presentation/UI for overall evaluation, strengths, deficiencies, and vulnerabilities.

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
What exact public Foundation definition should be used?

Known:
- Target approximately a 9th-grade reading level.
- Exact final wording remains open.

## Coverage units
Exact definition, allocation formula, and weights. Shared capacity between interaction and protection is the motivating case. How coverage interacts with Classic role deficits (D) is open.

## Interaction need (quantitative)
How speed, power, strategy, win condition, commander, and curve change interaction **quantity** and **quality**. Exact threat taxonomy. Quantity vs quality, timing weight, and free/alternate-cost valuation are separate sub-questions.

## Unequal multi-role quality
A card that is excellent at A and mediocre at B should not get the same split as a card that is good at both. Functional-equivalence scoring is not modeled.

## Redundancy and synergy detection
How extra copies, timing, and explicit measurable synergy relationships are detected. Synergy must be deterministic (no runtime LLM). Rules are not specified.

## Counterfactual orchestration
Minimum layer needed to evaluate “replace X with Y” without changing CardIR. Whether a future simulator should **validate** rather than replace the deterministic model.

## Seed / research schema
How context → need curves are stored and versioned (deterministic lookup, not an LLM). Exact methodology is open.

## Exact Deck Context schema
Formal variables and quantitative weighting curves for speed, competitiveness, strategy, win condition, commander, curve, and other context inputs.

## Next investigation
Formalize the Foundation **capability schema** (still open) on top of the locked philosophy in [14-foundation-model.md](./14-foundation-model.md), and a deterministic `deck context` representation:
1. Identify signals always available.
2. Identify signals inferred.
3. Identify signals user-confirmed.
4. Map signals to candidate-card fit in an explainable way that does not homogenize decks.

Do not assume a single score or a single static role target can capture deck identity. Hybrid already splits staple vs theme; Classic counts still run. Extend that principle rather than replacing the merge wholesale.
