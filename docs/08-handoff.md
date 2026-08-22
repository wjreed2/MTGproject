# Agent Handoff

## Current state

The project has moved from a narrow role-count recommendation model toward a broader conceptual model of how a Commander deck is constructed and evaluated.

**Hybrid Suggested Adds is implemented** as a merge: Classic fills Ramp/Draw/Removal holes; `engine2.1wizard` fills confirmed-plan theme/synergy rows. Cuts are not merged that way. See [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).

That merge is **not** Deck Fit or Foundation evaluation. Foundation **philosophy** is now locked (2026-08-21/22): capability-based, three input sources (strategy, user intent, deck evidence), explanatory strengths/deficiencies/vulnerabilities. Classic role-count thresholds still run. See [14-foundation-model.md](./14-foundation-model.md).

Current major design frontier:
- formalize the Foundation **capability schema** (philosophy locked; taxonomy/formulas open)
- wire Deck Context → Deck Need → Deck Fit into Hybrid without replacing the staple/theme split
- define coverage units for shared-capacity multi-role cards
- interaction threat-type coverage (deficiency vs color vulnerability vs budget vs preference)
- preserve dynamic deck identity (do not homogenize via EDHREC)

## Settled
- deterministic-only architecture
- user-final-say principle
- Plan wizard structure and CP-Q locks (including Undecided + inferred recommendations)
- confirmed-role behavior
- Plan envelope
- cast-turn L*/R* model
- Protection subsystem as currently specified (wizard); conceptually part of resilience, no universal quota
- EDHREC rank as a signal rather than a dictator
- Aggro/Control threshold mechanism
- Classic Adds term set (D/M/C_eff/L/E/B/P/V/T/K/H) as implemented
- Hybrid mode = Classic staples + sandbox theme; partner `engine2/` untouched
- Foundation is capability-based; no universal tutor/wipe/protection/selection quotas
- need → solution → preference (tutors are a mechanism)
- synergy can reshape, not erase, Foundation
- overall evaluation = effectiveness at intended plan and competition level
- output is explanatory, not an opaque score
- no live Scryfall/EDHREC scraping
- no partner engine2 modification
- do not redo CardIR without explicit approval

## Open
- exact Foundation capability taxonomy and formulas
- exact Deck Context schema and weighting curves
- coverage-unit formula
- interaction threat taxonomy and need curves
- redundancy and synergy **detection rules** (philosophy locked)
- exact integration of EDHREC rank with fit
- diagnosing slider influence
- exact public Foundation wording
- presentation/UI for strengths / deficiencies / vulnerabilities
- deterministic semantic coverage for complex cards

## Recommended next investigation

Continue the Foundation interview in [15-foundation-interview.md](./15-foundation-interview.md). Formalize the capability schema and Deck Context only after those F-Q items are locked.

Do not assume a single score or a single static role target can capture deck identity. Existing targets already change based on plan and playstyle; Hybrid already splits staple vs theme. Extend that principle carefully rather than replacing the existing system wholesale.

Do not revisit runtime AI, live Scryfall/EDHREC, partner engine2 modification, or explicitly rejected approaches unless the user explicitly asks.
