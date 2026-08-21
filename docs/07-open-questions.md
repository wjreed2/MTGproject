# Open Questions

## Foundation
How should the algorithm formally represent Foundation functions?

Known:
- The conceptual definition is established.
- Exact taxonomy and implementation rules are not fully finalized.
- Foundation means functions evaluated for every deck.

## Tutors
How should tutors be classified?

Known:
- Tutors improve consistency and may be crucial in high-power decks.
- Some players intentionally avoid them.
- Classification should account for deck philosophy/power/plan rather than assuming a universal tutor density.

## Protection
How should Protection be classified conceptually?

Known:
- The Plan wizard has a Protection subsystem.
- Its relationship to the broader Foundation model remains open.

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
How speed, power, strategy, win condition, commander, and curve change interaction **quantity** and **quality**. Quantity vs quality, timing weight, and free/alternate-cost valuation are separate sub-questions.

## Unequal multi-role quality
A card that is excellent at A and mediocre at B should not get the same split as a card that is good at both. Not modeled.

## Redundancy and timing
How extra copies and when a card can be used affect coverage. Not modeled.

## Counterfactual orchestration
Minimum layer needed to evaluate “replace X with Y” without changing CardIR. Whether a future simulator should **validate** rather than replace the deterministic model.

## Seed / research schema
How context → need curves are stored and versioned (deterministic lookup, not an LLM).

## Next investigation
Define a formal deterministic `deck context` representation:
1. Identify signals always available.
2. Identify signals inferred.
3. Identify signals user-confirmed.
4. Map signals to candidate-card fit in an explainable way that does not homogenize decks.

Do not assume a single score or a single static role target can capture deck identity. Hybrid already splits staple vs theme; extend that principle rather than replacing the merge wholesale.
