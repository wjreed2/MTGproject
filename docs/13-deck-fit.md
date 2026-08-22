# Deck Need / Deck Fit

**Status:** UNDER DESIGN. Hybrid today merges two ranked lists. It does not compute a unified deck-level fit score or a counterfactual replacement.

## Existing building blocks

- role thresholds and deficits (Classic; playstyle + plan + R* already change targets)
- Commander Gameplan probabilities (forward model)
- L* / R* inverse targets
- CardIR axis histogram, interaction graph, combo signatures (engine2 / sandbox)
- Classic Adds/Cuts scoring
- EDHREC rank as a signal
- projected deck views (planned Adds/Cuts)
- plan fields and protection boosts

## Desired behavior

Ask: **does replacing something in this deck with this candidate make the deck better at achieving its plan?**

Not merely: **is this candidate a stronger card?**

Evaluate at the **deck-as-a-whole** level. A candidate may be an upgrade because it improves the whole deck, not merely because it is individually powerful.

## Deck Context (not finalized)

Context is the collection of deck characteristics that determines appropriate tradeoffs. Candidate dimensions already identified:

- power
- speed / target turn
- strategy
- win condition
- commander
- curve / mana demands
- colors
- role needs
- implied opposing threat speed

Exact schema is open. Distinguish signals that are always available, inferred, and user-confirmed.

## Deck Need

The amount, type, and quality of a capability the deck should have given its context. Foundation is evaluated for every deck at the **capability** level; that does **not** mean every function has a universal required count. Locked philosophy: [14-foundation-model.md](./14-foundation-model.md).

## Overall evaluation (DECIDED shape)

Ask how effectively the deck executes its **intended plan** at its **intended level of competition**. Output should be explanatory: overall evaluation plus strengths, deficiencies, vulnerabilities, and why — not an opaque number.

When the algorithm disagrees with user intent, surface a vulnerability/tradeoff and allow explicit acceptance.

## Deck Fit

How well a candidate improves the deck as a whole relative to its alternatives and current composition.

Identity should be inferred from multiple aligned signals, not a single static role target.

## EDHREC

EDHREC rank is a useful quality/popularity signal, but cannot dominate deck fit. In a high-power context, a very strong / high-ranked card may win. When candidates are close, deck-specific fit should decide.

Classic **E** is already percentile-per-role with a floor of 8 ranked cards and light price-band dampening. Do not retune E into “always pick the most popular card.”

## Research direction

Use research-backed seeded data / lookup tables for context-dependent need curves. Prefer a new deterministic layer over existing CardIR rather than regenerating CardIR.

## Counterfactual direction

Future Deck Fit should evaluate hypothetical replacements by recomputing relevant deterministic metrics before and after the change. No unified counterfactual orchestration layer currently exists.

Goldfish / `js/engine/*` is not that layer: opening-hand Monte Carlo and interactive playtest are not an automated multi-game plan-execution simulator. A future simulator should **validate** the deterministic model, not replace it, and only if explicitly scoped.

## How this should meet Hybrid (destination)

Foundation ranking **replaces Hybrid** (F-Q5), with a required readout. Use the locked Foundation model ([14-foundation-model.md](./14-foundation-model.md), [15-foundation-interview.md](./15-foundation-interview.md)). Hybrid may keep running until cutover.

Orchestration: new layer over tags + CardIR + Gameplan; no CardIR regen; partner `engine2/` untouched (F-Q10).
