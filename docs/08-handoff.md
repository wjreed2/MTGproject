# Agent Handoff

## Current state

Foundation **interview is complete** (rounds 2–5). Do not reopen Foundation design questions. Hybrid (Classic staples + sandbox theme) is still the running suggestion merge. **Destination:** **Hybrid v2** — when v1 ships, Hybrid’s toggle slot becomes the Foundation engine + readout. Classic and Semantic stay. Locks: [14-foundation-model.md](./14-foundation-model.md), [15-foundation-interview.md](./15-foundation-interview.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md) (includes 2026-08-23 drift preventers).

**Implementation may begin once the owner explicitly says to start implementation.** Ready to build the **evaluation pipeline and explainability**, not a finalized scoring system. Isolate coefficients. Do not finish the math before the architecture.

## Settled (rounds 2–5 + 2026-08-23 wording)
- deterministic-only; user final say; no live Scryfall/EDHREC; no partner `engine2/` edits; **no CardIR regen** (additive derived fields from existing CardIR are OK)
- Deck categories: **Mana Base · Foundation · Strategy · Payoffs**
- Foundation: five fundamental capabilities evaluated for every deck (**degree varies**): Close the game · Access the mana needed to execute the plan · Generate resources · Interact with relevant threats · Continue executing the plan after disruption
- Keep Going is an **outcome**, not a resilience quota
- Mechanisms may contribute to multiple capabilities when functionally justified; no automatic full credit
- Interaction color-identity gaps are **vulnerabilities**, not automatic deficiencies
- Overall evaluation is an **explanatory synthesis**, not a single numerical score
- Pipeline: Capability → Need → Mechanism(s) → Coverage → Evaluation (not Role tag → target → deficit)
- Five capabilities use **five evaluation models** (mana = success/probability; interaction = threat-type coverage; Keep Going = derived outcome; close the game = wincon execution; resources = one target + coverage). Do not invent coefficients or redesign the five.
- Competition / playstyle / mana rules / proposal vs confirmed numbers / Cuts swaps / readout / wizard order as in [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md)

## Open (implementation, not interview)
- numeric coefficients / seed tables (isolate; tune later)
- exact threat-type quantities, consistency thresholds, protection mapping, synergy rule tables, multi-role weighting
- Theme E CardIR wizard depth
- EDHREC vs fit coefficients
- diagnosing current slider influence on Classic (legacy until cutover)

## Recommended next investigation

When the owner says to start: implement Foundation v1 **architecture** per [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md). Do not start a new Foundation interview round unless the owner asks. Do not reopen the five-capability model.

Do not revisit runtime AI, live Scryfall/EDHREC, partner engine2 modification, or CardIR **rewrite** unless the user explicitly asks. Additive use of existing CardIR is in scope.
