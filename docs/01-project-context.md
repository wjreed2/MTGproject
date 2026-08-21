# Project Context

## Project identity

The project is a Commander-focused Magic: The Gathering deck-building, tracking, analysis, and recommendation application.

Current major focus:
- deterministic deck-plan identification
- Suggested Adds / Suggested Cuts (Classic, Hybrid, and Semantic modes)
- Commander Gameplan
- Deck Context / Need / Fit design for Hybrid (not yet scoring)

The system is intended to help a player turn a vague deck idea into a structured, editable plan and then use that plan, actual deck contents, card roles, deck composition, and deterministic signals to recommend cards and identify cuts.

## Core philosophy

- The algorithm narrows and suggests; the user has final say.
- Recommendations should improve consistency and deck fit without homogenizing decks.
- Deck identity matters. Prefer cards that fit the particular deck rather than blindly recommending the strongest generic card for a role.
- The system should work deterministically and explainably, without runtime AI/LLM dependence.
- The model should be dynamic: the number of cards appropriate for a function can vary by deck, plan, playstyle, and context.

## Current conceptual model

The user currently likes:
1. **Foundation**
2. **Strategy**
3. **Payoffs**
4. **Manabase**

Foundation is the collection of fundamental functions that the algorithm evaluates for every deck. It does **not** mean every listed function is strictly required.

**Internal definition:** a collection of fundamental functions evaluated for every deck. Win condition belongs in Foundation because a deck without a way to win cannot finish the game. Mana base and win condition are closest to universal necessities. Ramp, card advantage, interaction, and board wipes are **not** literal universal requirements; they help decks consistently execute the win condition.

Keep **internal** and **public** Foundation definitions separate. Public language targets approximately a 9th-grade reading level. Exact public wording is still open.

Win condition belongs conceptually in Foundation because a deck must ultimately close the game. Specific threats, finishers, and combos that execute the strategy belong in Payoffs.

Manabase/Landbase remains its own category.

Board wipes let a deck recover from an opponent controlling a large board or from multiple players fighting for control. In multiplayer, one card can answer many threats.

Tutors generally improve consistency and efficiency, but player philosophy varies. Higher-power decks may rely on them. Tutor importance therefore needs context rather than a universal density.

## Terminology

### Plan
Plan is the structured description of how the deck wins and what strategic path it follows. It is not simply a synonym for roles.

The Plan envelope is a parent recipe target, default 30, with strategy/win-condition-derived sub-tags living inside it.

### Theme / Subtheme
Theme and subtheme describe specific identity pieces within the broader Plan envelope. Theme type pickers are used for strategies that require types, such as Tribal, Stax, or Mill.

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
