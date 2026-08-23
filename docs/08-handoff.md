# Agent Handoff

## Current state

Foundation **interview is complete** (rounds 2–5). Hybrid (Classic staples + sandbox theme) is still the running suggestion merge. **Destination:** this work is **Hybrid v2** — when v1 ships, Hybrid’s toggle slot becomes the Foundation engine + readout. Classic and Semantic stay. Locks: [14-foundation-model.md](./14-foundation-model.md), [15-foundation-interview.md](./15-foundation-interview.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md).

Current major design frontier:
- **Implement Hybrid v1** (replacement engine). Interview is done — no more Foundation interview rounds unless the owner asks.
- Preserve dynamic deck identity (do not homogenize via EDHREC)
- Coefficients, seed tables, and Theme E are later; they do not block v1

## Settled (rounds 2–5)
- deterministic-only; user final say; no live Scryfall/EDHREC; no partner `engine2/` edits; **no CardIR regen** (additive derived fields from existing CardIR are OK)
- Plan wizard + CP-Q locks; Undecided + inferred recommendations
- Deck categories: **Mana Base · Foundation · Strategy · Payoffs**
- Foundation capability-based; three layers; five v1 capabilities
- Competition field: Casual / Focused / High / cEDH (cEDH distinct); playstyle slider in wizard
- Two axes: competition = intensity; playstyle = mix
- Mana-on-time = commander on T + key cards + declared-wincon pieces; max vs sum CMC; inspector override
- Proposal vs confirmed-role numbers: confirmed wins; warn if below proposal; stop Adds at the set target
- Keep going derived; one resource target; close-the-game validates the user’s wincon
- Wipes: floor 1, common 2–4, zero is an exception; tutor pref field; measurable synergy
- Hybrid v2 readout in Adds/Cuts (compact + expand); why-line on every card
- Cuts: surplus = no swap; poor fit = named direct swap
- Wizard order: competition + playstyle after strategy; casting pattern after wincon/key cards; tutor pref last

## Open (implementation, not interview)
- numeric coefficients / seed tables
- Theme E CardIR wizard depth
- EDHREC vs fit coefficients
- diagnosing current slider influence on Classic (legacy until cutover)

## Recommended next investigation

Implement Hybrid v1 per [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md). Do not start a new Foundation interview round unless the owner asks.

Do not revisit runtime AI, live Scryfall/EDHREC, partner engine2 modification, or CardIR **rewrite** unless the user explicitly asks. Additive use of existing CardIR is in scope.
