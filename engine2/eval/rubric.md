# Suggestion judging rubric (engine2 eval loop)

You are judging deck-building suggestions for a Magic: The Gathering **Commander** deck. You see the deck (commander + the 99) and the engine's suggestions. You do **not** see why the engine suggested them — judge each card on its own merits for this deck.

## For each suggested ADD — score 1–100: "would I put this card in this deck?"

| Score | Meaning |
|---|---|
| 90–100 | Clear upgrade. Obviously belongs; I'd add it immediately. |
| 70–89 | Good add. Fits the plan and would make the deck better. |
| 50–69 | Reasonable. Playable, on theme, but not special — a filler-level add. |
| 40–49 | Marginal. Defensible, but I probably wouldn't. |
| 20–39 | Poor. Off-plan, weak at its job, or a worse version of something already here. |
| 1–19 | Wrong. Doesn't work in this deck, works against its plan, or is illegal/nonsensical here. |

Weigh, in order:
1. **Plan fit** — does it advance what *this* deck is doing (its commander's engine and what the 99 spends it on)? Synergy with random cards that don't advance the plan doesn't count.
2. **Quality at its job** — among cards that do the same job, is this a good one? (Counterspell > Cancel; an untapped land fetch > a tapped one.)
3. **Need** — does the deck actually lack this job? A 12th ramp spell in a deck with 25 is low value.
4. **Cost to the plan** — creatures in a noncreature-spell deck, symmetric gifts in a deck racing opponents, copies that aren't cast for cast-trigger engines, etc.

Deck-owner preferences (treat as given, don't penalise the deck for them): minimum 37 lands; about 3 board wipes; some decks run little removal on purpose; bracket-3 power level (Game Changers are fine but not required).

Deck-specific facts the owner has established (they override your own read):
- **Vraska, Soul of Stone** lists: team haste (Rising of the Day, Fervor-style effects) is plan-critical — the Sculpture tokens tap for mana the turn they're made, so mass haste is part of the engine, not a generic aggro card. Spell COPIES (storm, Thousand-Year Storm) aren't cast, so they don't trigger Vraska.
- **Jyoti, Moag Ancient** lists: a legendary copy of Jyoti is still good — its enter trigger makes the Dryads even though the legend rule then keeps only one. A nonlegendary copy is better (it stays and adds a second combat pump).

## For each suggested CUT — score 1–100: "would I cut this card from this deck?"

Same scale: 90–100 = obviously cut it; 1–19 = cutting it would hurt the deck (it's a key piece).

## Recall — what's missing

List up to **5 cards you would add** to this deck that are **not** in the suggestions (legal in the commander's colors, not already in the deck), each with a one-line reason.

## Output

Return **only** JSON:

```json
{
  "deck": "<slug>",
  "plan_summary": "<one sentence: what this deck is trying to do>",
  "adds": [ { "name": "...", "score": 0, "reason": "<≤ 20 words>", "failure": "<null | off_plan | weak_at_job | not_needed | works_against_plan | wrong_bodies | other>" } ],
  "cuts": [ { "name": "...", "score": 0, "reason": "<≤ 20 words>" } ],
  "missing": [ { "name": "...", "reason": "<≤ 20 words>" } ]
}
```

`failure` is required for any add scored below 50 (null otherwise). Be consistent: the same card in two similar decks should get a similar score.
