# Agent Handoff

## Current state

Foundation **interview is complete** (rounds 2–5). Do not reopen Foundation design questions. **Hybrid v2 architecture is in the Hybrid slot** (evaluator, readout, Adds/Cuts ranking). Classic and Semantic stay. Sandbox theme merge is off until `includeSandboxThemeRows`. Locks: [14-foundation-model.md](./14-foundation-model.md), [15-foundation-interview.md](./15-foundation-interview.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md) (includes 2026-08-23 drift preventers). Slot behavior: [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).

**Architecture v1 is in the Hybrid slot** (evaluator, readout, Adds/Cuts ranking, wizard fields). Mechanism detection now consumes **existing** CardIR provides/roles plus tags/oracle (`js/foundation/foundation-mechanisms.js`). Production eval materializes tags via `_probTagsOnCard` (oracle-tag cache + customTags + disables), not raw `card.roleTags`. Calibration uses the **Foundation Evaluation Lab** with isolated experimental config (`cloneFoundationConfig`). Lab **Account decks** default comes from env `FOUNDATION_LAB_DEFAULT_ACCOUNT` (injected into the admin Lab page — not hardcoded in public `/js`). CardIR inventory: [19-foundation-cardir-audit.md](./19-foundation-cardir-audit.md). Infra: [20-foundation-calibration-infra.md](./20-foundation-calibration-infra.md). Settled Hybrid v2 slot behavior: [10-hybrid-suggestions.md](./10-hybrid-suggestions.md). Do not invent missing numbers or redesign the five capabilities.

**Deck themes readout (PROPOSED, partial lock)** — [21-deck-themes.md](./21-deck-themes.md). Placement **C** (under Plan), Decent/Focused/Very focused *labels* (numbers not locked), name chips. Remaining: clash in v1 vs facts-only; hide vs keep the Gameplan-adjacent sketch.

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

Use the Foundation Evaluation Lab **synthetic** suite to inspect Need → Mechanism → Evidence → Coverage before changing numbers. Experimental config is a clone (`cloneFoundationConfig`); do not edit live Hybrid coefficients until that review. CardIR is now evidence for mechanism detection when present. Do not regenerate CardIR. Do not reopen the five-capability model. Tune only `js/foundation/foundation-config.js`.

Do not revisit runtime AI, live Scryfall/EDHREC, partner engine2 modification, or CardIR **rewrite** unless the user explicitly asks. Additive use of existing CardIR is in scope.
