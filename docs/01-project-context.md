# Project Context

## Project identity

The project is a Commander-focused Magic: The Gathering deck-building, tracking, analysis, and recommendation application.

Current major focus:
- deterministic deck-plan identification
- Suggested Adds / Suggested Cuts (Classic, Hybrid, and Semantic modes)
- Commander Gameplan
- locked Foundation capability model (design) feeding **Hybrid v2** (interview complete; not yet scoring)

The system is intended to help a player turn a vague deck idea into a structured, editable plan and then use that plan, actual deck contents, card roles, deck composition, and deterministic signals to recommend cards and identify cuts.

## Core philosophy

- The algorithm narrows and suggests; the user has final say.
- Recommendations should improve consistency and deck fit without homogenizing decks.
- Deck identity matters. Prefer cards that fit the particular deck rather than blindly recommending the strongest generic card for a role.
- The system should work deterministically and explainably, without runtime AI/LLM dependence.
- The model should be dynamic: the number of cards appropriate for a function can vary by deck, plan, playstyle, and context.

## Current conceptual model

Deck categories (F5-Q4; not suggestion modes):
1. **Mana Base** — lands and mana infrastructure
2. **Foundation** — five fundamental capabilities evaluated for every deck (degree varies): close the game; access the mana needed to execute the plan; generate resources; interact with relevant threats; continue executing the plan after disruption
3. **Strategy** — plan, theme, subtheme: *how* the deck does those jobs
4. **Payoffs** — cards that cash in on that strategy (not a sixth Foundation job)

Foundation is the collection of fundamental **capabilities** the algorithm evaluates for every deck. It is universal at the capability level, not as a fixed set of card-count quotas. Locked detail: [14-foundation-model.md](./14-foundation-model.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md).

**Internal definition:** a collection of fundamental capabilities/functions evaluated for every deck. **Close the game** is a Foundation capability; the Wizard captures the intended win condition and the algorithm validates support. Specific threats, finishers, and combos that execute the strategy belong in **Payoffs**.

Keep **internal** and **public** Foundation definitions separate. Public language targets approximately a 9th-grade reading level. Working public sentence: F-Q9 A in [15-foundation-interview.md](./15-foundation-interview.md).

**Access the mana needed to execute the plan** is a Foundation success test (commander on T + key cards + declared-wincon pieces; broader than land drops). **Mana Base** remains its own category (infrastructure, quantity vs quality). Do not rename Mana Base to Foundation.

Board wipes are a form of interaction. Proposed floor 1, common 2–4; **zero is an explicit exception**, not the default.

Tutors are one possible consistency mechanism, not a Foundation quota. If the user dislikes tutors, the consistency need remains and other tools should be considered.

**Strategy establishes expectations → user establishes intent → deck provides evidence.** Synergy can reshape how Foundation is fulfilled; it cannot eliminate the need for a functional Foundation.

## Terminology

### Plan
Plan is the structured description of how the deck wins and what strategic path it follows. It is not simply a synonym for roles.

The Plan envelope is a parent recipe target, default 30, with strategy/win-condition-derived sub-tags living inside it.

### Theme / Subtheme
Theme and subtheme describe specific identity pieces within the broader Plan envelope. Theme type pickers are used for strategies that require types, such as Tribal, Stax, or Mill.

The **Themes** panel on the open-deck page reports which of those strategies the current list actually supports (card count + quality band) and whether that jives or clashes with the themes the user set. See [21-deck-themes.md](./21-deck-themes.md).

### Role vs capability
Role is a functional category used by the deck system (Ramp, Removal, …). CardIR capabilities (`provides` / `needs` / axes) are more detailed structured descriptions. Preserve the distinction.

### Multi-role cards
Multi-role cards can be efficient but often have costs: more mana, more pips, a weaker effect, or restrictions. A card can be valuable because it fills two needs and replaces a weak card in either role. Evaluate the replacement at deck level rather than simply adding role points. Naive full credit in every role double-counts mutually exclusive uses — see [12-coverage.md](./12-coverage.md).

### Deck fit
Deck fit means determining which card is best for this particular deck rather than merely which card is strongest in a generic category. It is evaluated at the **deck-as-a-whole** level. Design notes: [13-deck-fit.md](./13-deck-fit.md). Hybrid suggestions today merge Classic + sandbox lists; they do not yet compute this unified fit. See [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).

Current direction combines deterministic context signals including:
- confirmed plan
- roles
- strategy
- win condition
- key cards
- existing deck composition
- card relationships
- playstyle
- curve/cast-turn goals
- power / speed / implied opposing threat speed
- EDHREC rank (signal, not dictator)
- projected replacements (planned Adds/Cuts)
