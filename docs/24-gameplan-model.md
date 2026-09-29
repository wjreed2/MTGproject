# Gameplan model — plan-first suggestions in engine2

**Status:** IMPLEMENTED v1 (2026-09-29), uncommitted. `engine2/gameplan.js` + recommender/explain/server wiring + Deck Goal readout. Fixtures: [`engine2/fixtures/gameplan/`](../engine2/fixtures/gameplan/) — **80/85 pass, all 63 high-confidence pass**; 10 invariants hold across 36 decks. Runner: `node scripts/semantics-gameplan-fixtures.js` (DB-backed; not in `npm test` yet — §11).

**Scope:** server-side engine2 (`/api/decks/analyze`) — Suggested Adds, Suggested Cuts, category targets, and the Deck Goal readout. Deterministic: CardIR + deck composition + rules layer. No LLM at analysis time. No wizard input: the plan is **inferred**; the user's **sliders** (category targets, price) are constraints the model obeys.

**Source:** a long deck-analysis chat (Vraska, Jyoti, Bumbleflower, Vren, Helga, Thranduil) whose advice was consistently better than engine2's. This doc captures the *method* behind that advice.

## 1. The problem (before)

`scoreAdds` was additive: every provided axis earned points if *any* deck card wanted it, `feeds` fired for pairs anywhere in the 99, role deficits paid a flat amount per category, and the top-ranked goal (often a generic one like "control") drove the wanted axes and category targets. Cards that do the same job were never compared, and nothing asked what the chat asked of every card: **what does this card do for the engine?**

## 2. Principles

1. **A plan is an engine plus a direction.** The engine's own text fixes its fuel and output; the **99 decides the direction** — what that output is spent on. The same commander can lead different decks (Vraska go-wide drain vs Vraska Vehicles; Bumbleflower counters vs Bumbleflower group hug).
2. **Plan fit is the primary signal** when the commander runs the deck; generic axis/role credit is supporting weight.
3. **Anti-plan signals are plan-relative.** Gifts to every player are anti-plan in a race and the plan in group hug.
4. **Synergy counts through the plan** — by the partner's role, not by edge count.
5. **Sliders own the numbers.** The plan's direction sets default category targets; the user's sliders override; cuts never go below a target.
6. **Every credit is explainable** in one English line (no axis tokens leave the server).

## 3. The Gameplan (`inferGameplan`)

```
Gameplan {
  engine: { card, types }            fuel: [FuelSpec]        output: [OutputSpec]
  direction: { top, label, confidence, second }              commanderCentric, centrality
  deckEval: Map<card, CardEval>      supply, bottleneck      critical: { piece → coverage }
  comboPieces, otherDirections, legendBreakers
}
```

### 3.1 Fuel — read from the engine's own abilities

| Engine ability (CardIR faces) | Fuel test for a card | Example |
|---|---|---|
| `cast_spell` trigger; subject types / `non<type>` text / `mv_cmp` / subtype | casting it passes the filter (`{X}` spells pass an MV floor) | Vraska: noncreature · Helga: creature MV ≥ 4 · Edgar: Vampire spells · Bumbleflower: any spell |
| event trigger — `draw` (opponents'), `landfall`, `lifegain`, `dies`, `sacrifice`, `token_created`, `counter_placed`, `discard`, `mill` | provides an axis that supplies the event (`EVENT_FUEL`) | Xyris: opponents drawing → `draw.group` / wheels · Titania: lands entering |
| `replacement` on opponents' `dies` | removes / kills / gifts-then-kills opponents' creatures | Vren |
| pump of land creatures | makes or animates land creatures (tokens, manlands, "lands are creatures") | Jyoti |
| `grant_ability` from a graveyard type | is that type with an activated ability | Thranduil |
| `etb` trigger on a subtype | is / makes that subtype | tribal commanders |

Self-only triggers ("whenever ~ attacks") are not fuel. Engines with none (Krenko's tap ability) simply have no fuel link — the readout stays silent rather than reporting "0 of 12".

### 3.2 Output

The engine's own effects: creature tokens (artifact or not), +1/+1 counters, scaling mana, cards for opponents, a combat pump, borrowed abilities. **Commander gifts** (Bumbleflower's opponent draw) are counted once, not with the 3× commander emphasis, in goal inference — a cost of the engine is not a statement of plan.

### 3.3 Direction — chosen from the 99

1. **Compatible directions** come from the output (`tokens → tokens-wide / vehicles / aristocrats / artifacts …`; `counters → counters / voltron / group-hug`; `opp_draw → group-hug / wheels`; tribal goals always compatible).
2. Take the best-ranked compatible goal from goal inference.
3. **Near-tie break** (within 0.05): switch only on clearly stronger **evidence** — 1.5× and +4 cards — where evidence = converters for that direction (×1) + **amplifiers of the engine's output toward it (×2)**. Five counter doublers say "counters" louder than a pile of cheap gifts says "group hug". Never switch away from the commander's own tribe.
4. A runner-up at ≥ 0.6 is reported as secondary ("Vehicles, with some Artifacts matter").

### 3.4 Centrality — is the commander the engine?

`commanderCentric` when the deck is built around the engine: **centrality ≥ 0.35** (share of nonland cards linked as fuel / amplifier / converter, or with an interaction edge to it; fuel lands count) **or ≥ 8 amplifiers** (Jyoti: a deep blink/copy/pump package on thin land-creature fuel — the thin fuel is the bottleneck, not a sign of a 99-driven deck). 13 of the 27 older fixture decks read as engine-led; the rest keep goal-driven scoring.

### 3.5 Converters, amplifiers, protection, critical pieces

- **Converter** — spends the output the direction's way: direction axes (`CONVERTER_AXES`; tribal = lords, anthems, evasion, extra combats — *not* generic drain), plus fuel payoffs that hit opponents (Guttersnipe), team pumps off the fuel (Jeskai Ascendancy), token-output cashers (Mister Fantastic), and draw-punishers in group hug (Psychosis Crawler).
- **Amplifier** — multiplies the engine: output doublers, parallel engines on the same fuel (Kykar), rules-layer edges to the engine (Wizard's Staff doubling, Biosynthic Burst untapping Helga, nonlegendary copies of Jyoti), blink for an ETB engine, anything growing a pump engine's X. Candidates not in the deck get a two-card rules pass (`engineEdges`).
- **Protection** — mass vs single: mass saves a wide output; single-target saves a creature engine.
- **Critical pieces** (`critical`) — must-draw pieces counted only if they cover the plan's actual case: `haste_for_tokens` (team haste only — Swiftfoot Boots doesn't count), `wipe_turn_return` (return-after-death that can target the engine — indestructible doesn't stop −X/−X or sacrifice), `crew_sources` (creatures and token makers — crewing ignores summoning sickness).

### 3.6 Bottleneck

Supply per link vs a target (fuel 30 for cast engines / 10 land creatures / 12 events; converters 6; protection 6; amplifiers only for multiplicative pump plans). The thinnest link below target is named; links the model can't define for this plan are skipped.

## 4. Card evaluation (`evaluateCard`)

Per card: `links` (fuel · amplifier · converter · protection · combo · critical · foundation:<cat>), `alsoFuel`, `riders`, `anti`, and two point totals — **adds** and **cuts** — with English trace lines.

### 4.1 Riders

"If you control a Bird", "Equip Wizard {1}": value × P(condition met). The commander meeting it → 1.0 (Vraska is a Wizard: Wizard's Staff, Mana Sculpt). Otherwise a hypergeometric estimate from qualifying cards + token makers by midgame (~15 cards seen). A reliable rider (≥ 0.5) also lifts the `narrow` flag — Dazzling Denial with a Bird commander is a real counter.

### 4.2 Anti-plan signals

| Code | Test |
|---|---|
| `no_fuel` | fails a `non<type>` cast filter by being that type — listed only when nothing else ties the card to the plan; a mild point cost stays (fewer creatures in a noncreature engine) |
| `copy_not_cast` | a standing copy engine (static/trigger copy, storm) with a cast engine — not a walker ultimate or equipment rider |
| `symmetric_benefit` | the gift is the card's purpose (group-hug axis, or group draw ≥ its other weights); off unless the direction is group hug / wheels, or the gift *is* the fuel |
| `legendary_copy` | copies your creature without "isn't legendary"; scaled by P(no legend-rule breaker drawn); never the breaker itself |
| `redundant_with_engine` | grants creatures mana abilities when the plan's creatures are lands |
| `off_color_cost_reducer` | discounts a color the plan's core mostly isn't |
| `narrow` | a ≤ 2-tax soft counter, unless a reliable rider fixes it |
| `no_engine_target` | blink with nothing to re-trigger — unless the card is otherwise a plan piece |
| `tapped_mana` | a nonland rock that enters tapped |

**Structural** anti reasons (copy / symmetric / legendary copy / redundant / off-color / no target) **cancel the card's positive chain credit**: Prismari's burn isn't a converter when its storm copies never trigger Vraska; Primal Vigor doubles everyone's tokens.

### 4.3 Points

| Credit | Adds | Cuts |
|---|---|---|
| fuel | +2.5 (cast) / +3 (other) | same |
| amplifier | +5 | +5 |
| converter | +4 | +4 |
| bottleneck link | +2.5 | +1 |
| protection mass / single | +2.5 (wide output) or +1.5 / +1 (creature engine) | +2.5 / +3 |
| combo piece | +2 | +4 |
| fills a thin critical piece | +4 | — |
| rider | +2 × reliability | same |
| off-direction payoff | −1 | −3 |
| no plan role at all | — | −1.5 |
| anti-plan (each) | −3 (no_fuel −1.5) | −6 (no_fuel −2) |

Chain credits apply only when `commanderCentric`; riders and anti-plan always apply.

## 5. Scoring integration

- **Plan-first rebalance.** For engine-led decks, every non-plan trace line is scaled ×0.5 (`rebalance`) and the score re-summed — breakdown still equals the badge.
- **Plan goals.** `planGoals` puts the direction first, so wanted axes, category targets (`computeThresholds({ goal: direction })`), cut shields, and the server's candidate-pool retrieval all follow the plan, not the raw top goal. Sliders still override targets.
- **Plan-weighted synergy (cuts).** Edge strength × partner weight: engine 1 · amplifier/converter/combo/critical 0.6 · fuel-only 0.2 (fuel is the commodity) · other 0.1 · structural anti-plan partner 0.
- **Shields.** Anti-plan cards lose the staple and wincon shields. Critical pieces at ≤ 5 copies are shielded (+4). Symmetric gifts never hide behind a Ramp/Draw role floor — their role credit goes to every player.
- **Engine supply.** Needs the engine's own repeatable output satisfies (anthems in Vraska) aren't "starved".

## 6. Readout and explanations

`gameplan.readout(plan)` → English lines in the API (`gameplan` field) and the Deck Goal card (`.deck-goal-plan`):

> Vraska, Soul of Stone is the engine — fuelled by noncreature spells, making artifact creature tokens.
> Direction: Vehicles, with some Artifacts matter.
> Weakest link: not enough land creatures on your side to keep Jyoti, Moag Ancient running (3 of ~10).
> Haste for tokens: 2 cards (28% to see one by midgame) — Swiftfoot Boots only hastes one creature.

Why lines: "Feeds Vraska — noncreature spells", "Multiplies Vraska's output", "Bonus always on — Vraska is a Wizard", "Copies aren't cast — they won't trigger the engine", "Helps every player, not just you", "One of only 4 return-after-death protection pieces".

## 7. Data changes

- **Vocab v5** — `vehicle.body`, `vehicles.matter`, `crew.source` (needs-only; provides synthesized from creature type lines and creature-token output). Prompt **p10**. Goal templates **vehicles**, **group-hug**.
- **Backfills** (idempotent, local DB applied; prod via `semantics:push`): `semantics-backfill-vehicles.js` (153 Vehicles, 51 payoffs — positive phrasings only), `semantics-backfill-rules.js` (earlier), `semantics-backfill-groupdraw.js` gained an oracle fallback for "you and that player each draw" gifts (17 rows) and no longer downgrades `vocab_version`.

## 8. Fixtures — and how far they generalize

**Decks:** 9 — the chat's six (Vraska ×2, Jyoti, Bumbleflower, Vren, Helga; Thranduil = the real deck + agreed swaps) plus two synthetic direction-flips (**vraska-vehicles**, **bumbleflower-hug**).

**Assertions:** 85 (plan, direction, link, prefer, anti_plan, not_anti_plan, rider, bottleneck, coverage, cuts include/exclude, adds include/exclude, adds_links, adds_axes). `user_override: true` marks Will's corrections — they win.

**Are they deck-specific?** Each assertion is written against a deck, but tests a named **principle** (`P-ENGINE`, `P-DIRECTION`, `P-DUAL`, `P-FUEL`, `P-RIDER`, `P-SLOT`, `P-ANTI`, `P-BOTTLENECK`, `P-COVERAGE`, `P-OVERRIDE`). Three mechanisms keep the model from overfitting:

1. **Paired decks** — same engine or same cards, opposite verdicts: Impact Tremors beats Smuggler's Copter in drain-Vraska and loses in Vehicles-Vraska (VRA-22 / VEH-02); Rites of Flourishing is anti-plan in counters-Bumbleflower and on-plan in hug-Bumbleflower (BUM-02 / HUG-01); Counterspell beats Dazzling Denial under Vraska and loses under a Bird commander (VRA-04 / SYN-01).
2. **Property assertions** — "≥ 6 of the top 10 adds are amplifiers/converters/critical", "≥ 3 of the top 12 adds are Vehicles or Vehicle payoffs" — check the principle instead of the chat's exact card names (which are softened to medium).
3. **Invariants** (INV-01…10) — run on **every** deck the runner can load (the 9 gameplan decks + 27 older fixture/pulled decks): no creature is fuel in a noncreature engine; `copy_not_cast` only with cast engines; `symmetric_benefit` never in group hug; a commander-typed rider is always reliability 1; spot removal is fuel for a Vren-class engine; no raw tokens in reasons. All hold.

The 27-deck before/after sweep is the out-of-sample check. It found real generalization bugs the fixtures couldn't (Xyris's opponent-draw fuel read as "gifts to everyone"; Edgar's Vampire-spell fuel read as "any spell"; "0 of 12" readouts for undefined links) — all fixed. Result: 13/27 engine-led, cut lists changed in 14, mean cut overlap 85%, no inferred goal changed for non-engine decks.

## 9. Remaining failures (all medium)

- BUM-05, VRN-08, VEH-07 — the chat's exact add names don't make the top 24; their property twins pass (the engine picks other on-plan cards, e.g. The Fantasticar for Vehicles).
- VEH-06 — Impact Tremors / Guttersnipe not in the Vehicles build's shown cuts (off-direction −3 isn't enough against their legacy credit).
- THR-02 — Guardian of the Halls / Greenbelt Guardian / Elvish Mystic: loop alternates and a dork are shielded as combo pieces; the chat's call is card quality (§10).

## 10. Next

- ~~roleStrength within an equivalence class~~ — built: [25-card-quality.md](./25-card-quality.md). Remaining: loop-piece quality (Guardian of the Halls vs Greenhilt Trainee).
- **Gameplan fixtures in CI** — a snapshot mode needs the adds pool; options: snapshot the top-N pool per deck at write time.
- **Multi-engine decks** (commander + a second engine in the 99) and **partner** commanders.
- **Tuning** — centrality 0.35 / 8 amplifiers, legacy weight 0.5, the points table — against more real decks.
- **Mana-base quality** — deterministic, separate module.
