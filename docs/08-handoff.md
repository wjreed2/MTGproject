# Agent Handoff

## Current state

The project has moved from a narrow role-count recommendation model toward a broader conceptual model of how a Commander deck is constructed and evaluated.

**Hybrid Suggested Adds is implemented** as a merge: Classic fills Ramp/Draw/Removal holes; `engine2.1wizard` fills confirmed-plan theme/synergy rows. Cuts are not merged that way. See [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).

That merge is **not** Deck Fit. The design frontier is how much of each Foundation function a deck needs (especially interaction), how multi-role cards contribute without double-counting, and how those needs rank candidates inside the existing Hybrid split.

Current major design frontier:
- formalize Foundation / Strategy / Payoffs / Manabase
- determine how deterministic algorithms evaluate Foundation functions for every deck
- define Deck Context → Deck Need → Deck Fit without runtime AI
- define coverage units for shared-capacity multi-role cards
- preserve dynamic deck identity (do not homogenize via EDHREC)

## Settled
- deterministic-only architecture
- user-final-say principle
- Plan wizard structure and CP-Q locks (including Undecided + inferred recommendations)
- confirmed-role behavior
- Plan envelope
- cast-turn L*/R* model
- Protection subsystem as currently specified
- EDHREC rank as a signal rather than a dictator
- Aggro/Control threshold mechanism
- Classic Adds term set (D/M/C_eff/L/E/B/P/V/T/K/H) as implemented
- Hybrid mode = Classic staples + sandbox theme; partner `engine2/` untouched
- no live Scryfall/EDHREC scraping
- no partner engine2 modification
- do not redo CardIR without explicit approval

## Open
- exact Foundation taxonomy
- tutor classification
- Protection's conceptual place in Foundation
- deterministic deck-context/deck-fit model
- coverage-unit formula
- interaction need curves (speed/power/strategy/…)
- exact integration of EDHREC rank with fit
- diagnosing slider influence
- exact public Foundation wording
- deterministic semantic coverage for complex cards

## Recommended next investigation

Define a formal deterministic deck-context representation. Identify which signals are always available, inferred, and user-confirmed. Map those signals to candidate-card fit in an explainable way.

Do not assume a single score or a single static role target can capture deck identity. Existing targets already change based on plan and playstyle; Hybrid already splits staple vs theme. Extend that principle carefully rather than replacing the existing system wholesale.

Do not revisit runtime AI, live Scryfall/EDHREC, partner engine2 modification, or explicitly rejected approaches unless the user explicitly asks.
