# Agent Handoff

## Current state

Foundation **philosophy** and **round-2 schema** are locked. Hybrid (Classic staples + sandbox theme) is still the running suggestion merge. **Destination:** Foundation ranking replaces Hybrid, with a required explanatory readout. Locks: [14-foundation-model.md](./14-foundation-model.md), [15-foundation-interview.md](./15-foundation-interview.md).

Current major design frontier:
- Round 3 — need-setting (mana x,y,z; per-deck role targets; competition/playstyle effects)
- Then mechanisms/synergy, then output/cutover
- Preserve dynamic deck identity (do not homogenize via EDHREC)

## Settled (includes round 2)
- deterministic-only; user final say; no live Scryfall/EDHREC; no partner `engine2/` edits; no CardIR regen
- Plan wizard + CP-Q locks; Undecided + inferred recommendations
- Foundation capability-based; three layers; five v1 capabilities
- Competition field: Casual / Focused / High / cEDH (cEDH distinct)
- Playstyle slider in the wizard
- Foundation engine **replaces Hybrid**; readout required (not opaque)
- Threat types v1; shared capacity interaction↔protection
- Mana-on-time = Gameplan success test, not L*/R* quota; other roles have per-deck targets + coverage units
- Public Foundation wording (F-Q9 A)
- New layer over tags + CardIR + Gameplan

## Open
- what “x, y, z” are for mana-on-time besides commander on T
- how per-deck role target numbers are set
- how competition and playstyle change those needs
- synergy **detection** rules
- presentation/UI for readout and new wizard steps (exact order)
- Theme E CardIR wizard depth
- seed tables / numeric curves
- EDHREC vs fit coefficients
- diagnosing current slider influence on Classic (legacy until cutover)

## Recommended next investigation

Continue the Foundation interview (round 3: need-setting). Do not implement the replacement engine until need-setting, mechanisms/synergy, and output/cutover are locked.

Do not revisit runtime AI, live Scryfall/EDHREC, partner engine2 modification, or CardIR rewrite unless the user explicitly asks.
