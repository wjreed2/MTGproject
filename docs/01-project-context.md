# Project Context

## Project identity

The project is a Commander-focused Magic: The Gathering deck-building, tracking, analysis, and recommendation application.

Current major focus:
- deterministic deck-plan identification
- Suggested Adds / Suggested Cuts
- Commander Gameplan
- optional hybrid `engine2.1wizard` integration downstream

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

Win condition belongs conceptually in Foundation because a deck must ultimately close the game. Specific threats, finishers, and combos that execute the strategy belong in Payoffs.

Manabase/Landbase remains its own category.

## Terminology

### Plan
Plan is the structured description of how the deck wins and what strategic path it follows. It is not simply a synonym for roles.

The Plan envelope is a parent recipe target, default 30, with strategy/win-condition-derived sub-tags living inside it.

### Theme / Subtheme
Theme and subtheme describe specific identity pieces within the broader Plan envelope. Theme type pickers are used for strategies that require types, such as Tribal, Stax, or Mill.

### Deck fit
Deck fit means determining which card is best for this particular deck rather than merely which card is strongest in a generic category.

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
- EDHREC rank
