# Agent Handoff

## Current state

The project has moved from a narrow role-count recommendation model toward a broader conceptual model of how a Commander deck is constructed and evaluated.

Current major design frontier:
- formalize Foundation / Strategy / Payoffs / Manabase
- determine how deterministic algorithms evaluate Foundation functions for every deck
- preserve dynamic deck identity
- improve deck-specific card fit without runtime AI

## Settled
- deterministic-only architecture
- user-final-say principle
- Plan wizard structure and CP-Q locks
- confirmed-role behavior
- Plan envelope
- cast-turn L*/R* model
- Protection subsystem as currently specified
- EDHREC rank as a signal rather than a dictator
- Aggro/Control threshold mechanism
- no live Scryfall/EDHREC scraping
- no partner engine2 modification

## Open
- exact Foundation taxonomy
- tutor classification
- Protection's conceptual place
- deterministic deck-context/deck-fit model
- exact integration of EDHREC rank with fit
- diagnosing slider influence
- exact public Foundation wording
- deterministic semantic coverage for complex cards

## Recommended next investigation

Define a formal deterministic deck-context representation. Identify which signals are always available, inferred, and user-confirmed. Map those signals to candidate-card fit in an explainable way.

Do not assume a single score or a single static role target can capture deck identity. Existing targets already change based on plan and playstyle; extend that principle carefully rather than replacing the existing system wholesale.

Do not revisit runtime AI, live Scryfall/EDHREC, partner engine2 modification, or explicitly rejected approaches unless the user explicitly asks.
