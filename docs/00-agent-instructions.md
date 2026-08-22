# MTG Project — Agent Instructions

This directory is the persistent project context for the Commander-focused MTG deck-building and recommendation application.

## Source of truth
- Treat these Markdown files as project context and working decisions.
- Do not assume a proposal is implemented merely because it has been discussed.
- Preserve settled decisions unless the user explicitly revisits them.
- Distinguish **DECIDED**, **FIX SCOPED**, **NEEDS INVESTIGATION**, **PROPOSED**, **FLAGGED**, and implementation status.
- The user wants honest technical evaluation. Do not agree merely to be agreeable.
- Conceptual design and reasoning should come before code when discussing architecture or algorithms.

## Hard constraints
- This is **NOT an MTG AI project**.
- Do not introduce runtime AI/LLM into the wizard or suggestion engine.
- The system must remain deterministic, explainable, and reproducible.
- Never use live Scryfall at suggestion time.
- Do not use EDHREC per-category endpoints or runtime scraping.
- Never edit partner `engine2/`.
- `engine2.1wizard/` is the allowed sandbox for hybrid experimentation/integration.
- Do not silently overwrite confirmed plans or user choices.

## Updating context
When a substantive decision is made:
1. Update the appropriate topic file.
2. If it changes a settled decision, update [05-decisions.md](./05-decisions.md).
3. If it creates or changes work, update [06-backlog.md](./06-backlog.md).
4. If it creates an unresolved question, update [07-open-questions.md](./07-open-questions.md).
5. Keep this directory internally consistent.

Hybrid suggestion work: start from [10-hybrid-suggestions.md](./10-hybrid-suggestions.md). Foundation philosophy is locked in [14-foundation-model.md](./14-foundation-model.md). Round 2 interview (unanswered): [15-foundation-interview.md](./15-foundation-interview.md). Do not confuse Hybrid **mode** with Classic `hybridMult` or hybrid mana costs.

## Important principle
The algorithm narrows and suggests; the user has final say. Recommendations should improve consistency and deck fit without homogenizing decks.
