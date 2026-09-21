# Strategy research — Combat

**Status:** Research **Completed** and the non-engine2 half **IMPLEMENTED** (2026-09-18) — see §7. Extends
[strategy-catalog-research.md](strategy-catalog-research.md) with one new strategy the owner
asked for by name, and specifies how it would connect to the `engine2/` semantics layer.

> ⚠️ **§6 (engine2) is PROPOSAL ONLY and is blocked on partner approval.**
> Nothing in `engine2/` or the semantics data may change without it. Everything outside §6
> — the catalog row, oracle patterns, theme wiring, role tags, architecture wiring — is
> independent of that decision and can ship on its own.

---

## 0. Decisions locked by the owner (2026-09-18)

| # | Decision | Detail |
| --- | --- | --- |
| 1 | **Label** | `strategy.combat` — **Combat**, an umbrella with three children (lock #10). Naming took three rounds: "Combat / Attacks matter" was rejected (both halves near-synonyms, so the slash carried no information), "Combat / Attack triggers" was then chosen, and was **superseded by the drilldown decision** — once the mechanisms became pickable children the qualifier belonged on a child, not the parent. Exactly the move Tokens made: `Tokens / Go-wide` → `Tokens` + child `Go Wide` |
| 2 | **Saboteur is a mechanism, not a peer row** | One row, three defining mechanisms: saboteur · attacks-matter · extra-combat. Mirrors Voltron's existing equipment-vs-pump split |
| 3 | **Shortlist uncapped** | `PLAN_STRATEGY_SHORTLIST_IDS` accepts unlimited entries; nothing is dropped to make room. `PLAN_PRIMARY_OPTIONS_COUNT` still caps the *displayed* chips at 6, so the UI does not dump the catalog |
| 4 | **Goad splits** | Combat owns compelled combat that feeds **your** attack (must-attack, lure, must-be-blocked). **Goad-as-politics** (goad + deterrents + fogs) stays with engine2's `goad` template and `strategy.stax` |
| 5 | **`strategy.aggro` is KEPT** | Aggro = **speed**; Combat = **the attack step is the engine**. Two separate rows. Owner note: the word "aggro" is ambiguous because people also use it for attack-centred decks — resolved by lock #7 |
| 6 | **Weak evidence chips kept** | A deck with core-only or support-only cards still shows its honest band; the two-pillar rule keeps it out of *identity* only (§7.1). No band gating for combat |
| 7 | **Speed row is labelled `Aggro / Fast clock`** | Keeps the familiar word, qualifies it toward speed. Its own research pass is queued — [strategy-aggro-research-handoff.md](strategy-aggro-research-handoff.md) — and needs **no engine2 change** |
| 8 | **Role tags: add both now** | Both ship as **otag-backed** rows — `otag:attack-trigger` and `otag:saboteur`. An earlier draft said Saboteur needed a `query:` form on a 43% coverage figure; that figure was measured on the single-builder corpus and was **wrong** (§4.1) |
| 10 | **Combat has drilldowns** | `strategy.combat` is an umbrella with three pickable children — `strategy.combat.attacks` (Attack triggers), `strategy.combat.saboteur` (Saboteur), `strategy.combat.extra_combats` (Extra combats) — matching the `parent:` structure Tokens adopted. Supersedes lock #2 for *selection* (the mechanisms are pickable now) while keeping its substance: they are one family, not unrelated peers |
| 9 | **Two-pillar gate built outside engine2** | Shipped in `js/` rather than waiting for the engine2 template, with an explicit deletion contract for when engine2 ships a `combat` goal (§7.1) |

**Headline numbers**

| | |
| --- | --- |
| **Card pool the row opens** | **2,694** commander-legal cards match the identity core; **1,267 (47%) match no existing theme pattern at all** |
| **Validation** | **42 individual, human-built Commander decks** (§5.2). 18 fire the two-pillar rule; every control/stax/combo deck reads silent |
| **Role tags** | Both slugs verified directly against the Scryfall API: `otag:attack-trigger` (2,025 commander-legal) and `otag:saboteur` (928, a strict superset of the oracle phrase) |
| **engine2 state** | 10 combat-family axes exist; **zero** goal templates own them, **zero** `IR_AXIS_THEME` rows map them, and the saboteur family (787 cards) has **no axis at all** |

---

## 1. Method

**In-repo sources read**

- `js/deck-plan.js` — `PLAN_STRATEGIES` (:41), `PLAN_STRATEGY_SHORTLIST_IDS` (:74),
  `PLAN_WINCONS` (:101), `PLAN_STRATEGY_ORACLE_RULES` (:144), `PLAN_WINCON_ORACLE_RULES` (:175),
  `PLAN_THEME_SUBTAG_DEFAULTS` (:285), `rankStrategiesForDeck` (:1035), `strategyMatch` (:1085).
- `js/deck-themes.js` — `DECK_THEME_CONFIG` bands (:22), `THEME_CATALOG` (:41), `THEME_TAGS` (:90),
  `THEME_ORACLE` (:122), `IR_AXIS_THEME` (:238), `CLASH_PAIRS` (:259), `JIVE_PAIRS` (:269),
  `cardSupportsTheme` (:403).
- `js/archetype-role-bridge.js` — `STRATEGY_PROJECT_TAGS` (:35), `WINCON_PROJECT_TAGS` (:70),
  `ARCHETYPE_TO_STRATEGY` (:82), `ARCHETYPE_TO_WINCON` (:145).
- `js/deck-architecture.js` — `COMBAT_GOALS` (:603), `WINCON_CLOSER_TAGS` (:623),
  `GOAL_ROLE_TAGS` (:693), `GOAL_KEY_STRATEGY` (:819).
- `js/project-role-tags.js`; `server.js` tag ingest (`buildTagMapFromQueries` :9751,
  `SCRY_TAG_SCHEMA_VERSION` :9316, `POST /api/admin/scryfall/rebuild-tags` :11549).
- `engine2/vocab.js`, `goal-templates.js`, `deck-goals.js`, `interactions.js`, `thresholds.js`,
  `explain.js`, `prompt.js`, `ir-schema.js` — **read only**.
- `data/archetype-scryfall-tags/archetype-scryfall-tags.csv` — existing **Aggro** and
  **Extra Combats** archetype rows.

**Measurements run**

1. **Pool calibration** — candidate oracle patterns against `scryfall_oracle_cards`,
   `legal_commander = 1` (**31,830 cards**). Local card tables were imported 2026-09-16, i.e.
   current; only the local `decks` table is a stale testing set.
2. **Tag frequency** — every project role-tag label counted across `scryfall_oracle_tags`
   (26,724 tagged cards).
3. **Primary deck corpus — 42 individual Commander decks** from the public Archidekt profile
   `SalubriousSnail` (user id 59324, 5,282 followers, 43 public decks). 3,399 cards, 2,206
   unique. Reproducible without scraping:
   - list: `GET https://archidekt.com/api/decks/v3/?ownerUsername=SalubriousSnail&pageSize=100`
   - deck: `GET https://archidekt.com/api/decks/<id>/`
   - filter: drop cards in any category with `includedInDeck: false`; the commander is the
     category with `isPremier: true`. With that filter every deck resolves to exactly 100 cards.
   - the payload carries full `oracleCard.text`, `types`, `keywords`, `cmc` **and Scryfall
     `oTags`**, so §4.1's otag evidence comes from live data.
4. **Secondary corpus** — the 12 `engine2/fixtures/decks` reference decks and the 5 local DB
   decks, kept for continuity.
5. **Axis coverage audit** — programmatic diff of `vocab.AXES` against `goal-templates.js`
   and `IR_AXIS_THEME`.

**Sample caveats — read these before trusting a number**

- The 42-deck corpus is **one builder**. It is a large improvement over EDHREC averages
  because the decks are *individual* (variance preserved) and span real archetypes, but it
  carries a single author's style, power level, and card preferences. It is a good
  discrimination test and a poor popularity estimate.
- The 12 `engine2/fixtures/decks` are EDHREC **average** decks
  (`source: "edhrec-average"`). Averaging dilutes cards only some builds run, so it
  **systematically compresses variance**. §5.4 shows this concretely — it made curve look
  far less discriminating than it is.
- `card_semantics` is **empty locally** (0 rows), so no claim in §6 was executed end-to-end.

---

## 2. What "Combat" is — the scoping decision

"Combat" is seven shapes that share the attack step. The catalog already owns four:

| Shape | Example | Owned by |
| --- | --- | --- |
| Go-tall / suit up one threat | Voltron commander | `strategy.voltron` ✅ |
| Swarm and alpha strike | Krenko | `strategy.tokens` ✅ |
| Ramp into oversized bodies | Hydras | engine2 `stompy` goal ✅ |
| Force *other people* to attack | Goad / politics | engine2 `goad` goal ✅ |
| **Attack triggers as the engine** | Adeline, Isshin, Legion Warboss | **nothing** ❌ |
| **Saboteur — connecting is the engine** | Yuriko, Edric, Ninjas, Bident of Thassa | **nothing** ❌ |
| **Extra combats / alpha-strike finishers** | Aurelia, Moraug, World at War | **nothing** ❌ |

**Definition:**

> `strategy.combat` = the deck's engine **is the attack step**. Attacking, or connecting, is
> what generates the value — not merely how the deck happens to finish.

### 2.1 Combat vs Aggro — two rows, not one (owner lock #5)

| | `strategy.combat` | `strategy.aggro` — **Aggro / Fast clock** |
| --- | --- | --- |
| Claim | the attack step is the **engine** | the deck is **fast** |
| Signals | attack triggers, combat-damage triggers, extra combats, evasion/haste grants | curve, burn-to-face, haste density, rituals / cost reducers |
| Counter-example | Ur-Dragon: mean MV **4.35**, a *slow* combat deck | Xyris, Korvold: cheap curves, *not* combat engines |

Measured independence, §5.5. The owner flagged that "aggro" is ambiguous because people also
use it for attack-centred decks, and resolved it by labelling the row **Aggro / Fast clock**
(lock #7) — the familiar word, qualified toward speed. Its signal set is a separate research
pass: [strategy-aggro-research-handoff.md](strategy-aggro-research-handoff.md).

**Absorbed as engines, not peer rows:** `strategy.extra_combats` and
`strategy.evasion_matters` from the catalog research §2.5.

### 2.2 "Saboteur" — definition

Community/Tagger term for an ability that **triggers on dealing combat damage to a player**.
The payoff is gated on *connecting*, not on *attacking*.

| | Attack trigger | **Saboteur** |
| --- | --- | --- |
| Oracle | "Whenever ~ **attacks**…" | "Whenever ~ **deals combat damage to a player**…" |
| Fires | on declaring the attacker | only on connecting |
| Chump-blocked? | still triggers | no trigger |
| Wants | width, haste, extra combats | evasion density, unblockable bodies, ninjutsu |
| Pool | 1,915 cards | 787 cards |
| Examples | Adeline, Legion Warboss, Isshin | Yuriko, Edric, Ninjas, Guiltfeeder |

They are different deckbuilding problems, which is why they are separate mechanisms inside
one row rather than one blended signal. Empirically the split is clean: on the
`yuriko-ninjas` fixture, **13 of 13** core hits were saboteur and **0** were attack triggers;
on *Dog go bonk*, 15 of 18 were attack triggers.

*Naming note:* `saboteur` is jargon, not a rules term, and is used as an identifier in two
places — the proposed goal-template mechanism key and the proposed role-tag label. Renaming
the concept renames both.

---

## 3. Catalog row

| id | Label | Specificity | Card-mapping sketch | Overlaps / confusable with | Default shortlist? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy.combat` | **Combat** (umbrella) | medium | **Core:** attack triggers, combat-damage triggers, extra combat phases. **Support:** team evasion grants, team pump/anthems, haste granting, must-attack/lure, double-strike & damage doublers. Not "every creature with flying" | Voltron (one creature vs. the team), Tokens, Typal, Equipment, Aggro (speed, not engine) | **Yes** (shortlist uncapped, lock #3) | Identity requires **two pillars** (§5.2) |

### 3.1 Drilldown children (owner lock #10)

The three mechanisms are **pickable child strategies**, using the same `parent:` field Tokens
uses. The umbrella inherits every child's supporters through `cardSupportsTheme`'s roll-up, and
`_hideCoveredUmbrellas` drops the umbrella row once a child reaches Focused — so "Saboteur
(Focused)" displaces a redundant "Combat (Focused)" sitting beside it.

| id | Label | Owns | Detected by |
| --- | --- | --- | --- |
| `strategy.combat` | **Combat** | the umbrella — "this deck is built to attack" | the **support** patterns (team evasion, haste granting, team pump, must-attack, strike grants), plus roll-up from every child |
| `strategy.combat.attacks` | Attack triggers | declaring an attack is the trigger | "whenever ~ attacks", "whenever you attack", "whenever one or more creatures you control attack"; tag `Attack Trigger`; axis `combat.attack_trigger` |
| `strategy.combat.saboteur` | Saboteur | *connecting* is the trigger | "deals combat damage to a player" and the plural "one or more creatures you control deal combat damage"; tag `Saboteur` |
| `strategy.combat.extra_combats` | Extra combats | doing it more than once | "additional combat phase"; tag `Extra Combat`; axis `combat.extra` |

`COMBAT_ATTACK_TRIGGERS` / `COMBAT_SABOTEUR` / `COMBAT_EXTRA_COMBATS` are the children's pattern
sets **and** compose `COMBAT_PILLAR_CORE`, so the drilldowns and the two-pillar gate cannot drift
apart.

**Pattern restored while splitting:** the shipped pillar block carried only 5 core patterns — the
plural saboteur wording ("one or more creatures you control **deal** combat damage") had been
dropped. The split put it back, so the code now matches the set §5.2 was measured with. It catches
Admiral Beckett Brass-style cards.

**Engines under each row** (`PLAN_THEME_SUBTAG_DEFAULTS` subsections, not peer rows):

| Engine id | Label | What counts | Suggested target |
| --- | --- | --- | ---: |
| `combat.attacks_matter` | Attacks matter | Attack triggers — "whenever ~ attacks", "whenever you attack" | 10 |
| `combat.saboteur` | Saboteur | Combat-damage triggers — "deals combat damage to a player" | 8 |
| `combat.enablers` | Evasion & haste | Team evasion grants, haste granting, unblockable, must-attack / lure | 6 |
| `combat.finishers` | Extra combats & alpha strike | Extra combat phases, overrun effects, damage doublers | 3 |

---

## 4. Signals

### 4.1 Layer 1 — project role tags

Measured frequency across 26,724 tagged cards:

| Label | Cards | Verdict |
| --- | --- | --- |
| `Extra Combat` | **46** | ✅ Use — precise and unambiguous |
| `Combat Trick` | 1,401 | ✅ Secondary |
| `Anthem` | 544 | ⚠️ Shared with Tokens/Typal — weak support only |
| `Pump` | 2,776 | ❌ Too broad; already Voltron's and Counters' |
| `Evasion` | **5,384** (17% of pool) | ❌ **Do not use** — §5.1 shows this is what collapses a tag-based combat signal into Voltron |
| `Bite` | 164 | ❌ Fight/bite resolves outside the attack step |

**`STRATEGY_PROJECT_TAGS['strategy.combat'] = ['Extra Combat', 'Combat Trick']`** — narrow by
design. It cannot carry the row alone; that is the point.

#### The missing labels — now evidence-backed

The 37-label vocabulary has no label for an attack trigger or a saboteur trigger, which is
the identity core. The 42-deck Archidekt payload carries **live Scryfall otags**, so the
slugs are verified rather than guessed:

Both slugs were then checked **directly against the Scryfall API**, which corrected an earlier
reading taken from the 42-deck corpus alone:

| Label | Slug | Commander-legal | Versus the §4.2 oracle patterns |
| --- | --- | ---: | --- |
| **Attack Trigger** | `otag:attack-trigger` | **2,025** | Broader than the patterns and catches cards they miss (All-Out Assault, Duelist's Heritage, Firkraag, Horn of the Mark). The patterns catch 37 the otag misses — the two are complementary |
| **Saboteur** | `otag:saboteur` | **928** | **A strict superset.** `o:"deals combat damage to a player" f:commander` = 701 cards, and `... -otag:saboteur` returns **0** — the otag misses nothing, and adds 227 more (older "deals damage to a player" templating, plural "creatures … deal" wordings) |

⚠️ **Correction.** An earlier draft of this doc concluded Saboteur's otag covered "only 43%"
and should use a `query:` form instead. That number came from comparing tag hits *inside the
42-deck corpus*, where Archidekt's per-card `oTags` are incomplete. Measured against Scryfall
itself the otag is strictly better than the oracle phrase. **Both labels ship as otags.**

**Decision (owner, lock #8): add both now**, both otag-backed. Tag-based Adds/cuts scoring is
the one place the oracle patterns do not reach, so without a tag Combat stays invisible there:

```js
{ label: 'Attack Trigger', otag: 'attack-trigger' },
{ label: 'Saboteur',       otag: 'saboteur' },
```

Note the display names Scryfall shows ("attack trigger") are spaced while the **search slugs are
hyphenated** — exactly the trap `js/project-role-tags.js` warns about.

Other verified combat otags in the corpus, useful for the enrichment map:
`evasion` (235), `attacking matters-self` (82), `attacking matters` (74), `combat trick` (39),
`gives haste` (36), `gives trample` (29), `combat ramp` (23), `gives unblockable` (19),
`force attacker` (16), `unblockable` (15), `hate-attacker` (11).

**Cost of adding them** — not compute. Each label is a Scryfall search;
`buildTagMapFromQueries` (`server.js:9751`) runs one per label and caches results in
`scryfall_tag_query_cache` for 24h. `scryfall_oracle_tags` stores the *whole* label array per
card, so adding labels rewrites every affected row (~26.7k), then prunes by `fetched_at`
(`server.js:10012`). `SCRY_TAG_SCHEMA_VERSION` stays `'4'` — the label set is not versioned —
so no consumer changes. The real costs are **sequencing** (nothing exists until an admin runs
`POST /api/admin/scryfall/rebuild-tags` on prod) and **verification** (a bad query bakes wrong
labels onto thousands of cards). The concordance table above *is* that verification.

### 4.2 Layer 2 — oracle patterns (`THEME_ORACLE`)

Run against 31,830 commander-legal cards. `pool%` is the practical precision measure.

**Identity core:**

| Signal | Pattern | Cards | pool% |
| --- | --- | --- | --- |
| Attack trigger | `/\bwhenever (this creature\|…) attacks\b/`, `/\bwhenever you attack\b/`, `/\bwhenever one or more creatures you control attack/` | 1,915 | 6.02% |
| Combat-damage trigger | `/\bdeals combat damage to a player\b/`, `/\bwhenever (a\|one or more) creatures? you control deals? combat damage/` | 787 | 2.47% |
| Extra combat | `/\badditional combat phase\b/` | 44 | 0.14% |
| **core union** | | **2,694** | **8.46%** |

**Support:**

| Signal | Pattern | Cards | pool% |
| --- | --- | --- | --- |
| Team evasion | `/\bcreatures you control (have\|gain) (flying\|trample\|menace\|fear\|intimidate\|shadow\|horsemanship)\b/`, `/\bcan'?t be blocked\b/`, `/\bmust be blocked if able\b/` | 1,339 | 4.21% |
| Team pump | `/\bcreatures you control get \+/` | 587 | 1.84% |
| Haste granting | `/\bcreatures you control (have\|gain) haste\b/`, `/\bgains? haste\b/` | 534 | 1.68% |
| Forced combat | `/\bgoad(s\|ed\|ing)?\b/`, `/\battacks? (this\|each) (turn\|combat) if able\b/` | 210 | 0.66% |
| Strike / doubler | `/\bcreatures you control (have\|gain) (double\|first) strike\b/`, `/\b(deals\|would deal) (double\|twice)[^.]{0,40}damage\b/` | 83 | 0.26% |
| **support union** | | **2,674** | **8.40%** |

**Two patterns tested and rejected:**

- `/\bhaste\b/` (bare) — matches every creature that *has* haste; added 6 false hits to
  Korvold and 11 to Krenko. Only **granting** haste is a signal.
- `/\bcombat damage\b/` (bare) — this is `wincon.combat`'s rule, and
  `js/deck-architecture.js:615` already complains it matches "every saboteur draw trigger."
  Those triggers are exactly `strategy.combat`'s pool. The strategy absorbs them; the wincon
  rule stays narrow.

### 4.3 Layer 3 — type line and creature share

Combat has no type line. `Flying` alone is 3,130 cards, so printed keywords are not used as a
signal. Instead give `rankStrategiesForDeck` (`js/deck-plan.js:1035`) a creature-share nudge,
weighted *below* the existing equipment (×6) / vehicles (×8) ratio nudges:

```js
if (s.id === 'strategy.combat' && ratios.creatureShare > 0.35) raw += ratios.creatureShare * 3 * W;
```

### 4.4 Layer 4 — CardIR semantics

§6 — **proposal only, partner approval required.**

---

## 5. Measured results

### 5.1 Why the obvious tag-based approach fails

The intuitive tag set for combat (`Evasion`, `Pump`, `Anthem`, `Combat Trick`, `Extra Combat`)
against the fixture decks, alongside the **existing** Voltron tag set
(`Pump`, `Evasion`, `Protection`, `Anthem`):

| Deck | broad combat tags | narrow (`Extra Combat`+`Combat Trick`) | existing voltron tags |
| --- | ---: | ---: | ---: |
| ur-dragon-dragons | 32 | 1 | **34** |
| edgar-vampires | 19 | 1 | **21** |
| yuriko-ninjas | 17 | 0 | **17** |
| atraxa-counters | 12 | 1 | **13** |
| krenko-goblins | 11 | 0 | **12** |
| korvold-aristocrats | 9 | 1 | **10** |
| muldrotha-graveyard | 7 | 0 | **9** |

The broad column tracks Voltron to within 1–2 cards on every deck. **A tag-based combat row
would be a second Voltron** — the mistake the owner rejected for Equipment. The narrow column
is honest but too thin (0–2 cards) to carry identity.

**Combat's identity must come from the oracle layer** (and, if §6 is approved, from engine2).

*Side finding:* `THEME_TAGS['strategy.voltron'] = ['Evasion']` is over-broad — it fires 34 on
an Ur-Dragon deck and 17 on Yuriko, neither of which is Voltron. Logged in §8.

### 5.2 The two-pillar rule, validated on 42 individual decks

**Rule:** a deck reads as combat identity when it has **both**

- **Pillar A (core, ≥5 cards)** — attack triggers, combat-damage triggers, or extra combats
- **Pillar B (support, ≥3 cards)** — team evasion, team pump, haste granting, forced combat,
  or strike/doubler effects

**18 of 42 fire.** Ordered by pillar A:

| Deck | A | B | U | atk / sab / xcom | read |
| --- | ---: | ---: | ---: | --- | --- |
| On the Prowl *(Sygg)* | **21** | 15 | 33 | 5 / **16** / 0 | ✅ saboteur |
| Wrath of Dog | 18 | 7 | 21 | **13** / 5 / 0 | ✅ attacks-matter |
| Buffs by Hans *(Xyris)* | 18 | 5 | 18 | 0 / **18** / 0 | ✅ saboteur |
| Dog go bonk | 18 | 12 | 27 | **15** / 2 / 1 | ✅ attacks-matter |
| Equipment are the best mana rocks | 16 | 6 | 20 | 5 / 11 / 0 | ✅ — see overlap note |
| Goblin Throne | 13 | 8 | 18 | 6 / 7 / **2** | ✅ |
| Corsairs of Chronology | 12 | 4 | 14 | 2 / 10 / 0 | ✅ saboteur |
| Malfegor's Mudpit Melee | 12 | 5 | 16 | 7 / 5 / 0 | ✅ |
| *"…my last aggro deck wasn't aggro enough"* | 11 | 14 | 22 | 7 / 0 / **4** | ✅ extra-combat |
| Dungeon Dog and his Wacky Experiments | 11 | 9 | 18 | 9 / 2 / 0 | ✅ |
| Group Hellbent | 11 | 6 | 16 | 4 / 8 / 0 | ✅ |
| Dumb, Hyper-budget Winota Pile | 8 | 13 | 18 | 7 / 1 / 0 | ✅ |
| Grindy voltron token pile thing? | 8 | 7 | 15 | 8 / 0 / 0 | ✅ |
| $20 Meat Avalanche *(Goreclaw)* | 8 | 9 | 17 | 3 / 5 / 0 | ✅ |
| Cattron *(Arahbo)* | 8 | 4 | 12 | 4 / 4 / 0 | ✅ |
| Skanos's Math Class | 6 | 3 | 9 | 3 / 3 / 0 | ⚠️ marginal |
| hehe damage funny *(Zo-Zu)* | 6 | 6 | 11 | 4 / 2 / 0 | ✅ |
| Enigmatic Control *(Tuvasa)* | 5 | 3 | 7 | 3 / 2 / 0 | ⚠️ **false positive** |

**Clean negatives** — every control / stax / combo deck reads silent:

| Deck | A | B |
| --- | ---: | ---: |
| "Turbostax" | **0** | **0** |
| Gruulslinger | 0 | 1 |
| Diving for Spells | 0 | 1 |
| Flickers of the Tenth | 1 | 1 |
| Sanguine Control | 1 | 1 |
| Prime Pod | 2 | 3 |
| Turtle Gates | 2 | 0 |
| Lavinia Lockout | 3 | 0 |

#### Boundary cases — reported, not tuned away

**Two false negatives, both "hatebear beatdown":**

| Deck | A | B | why it misses |
| --- | ---: | ---: | --- |
| Biblically Accurate Beatdown *(Liesa)* | 7 | **1** | support is taxes/protection (Ghostly Prison, Thalia, Archangel of Tithes), not evasion/haste |
| Hate Beats - Breena edition | 6 | **2** | same shape |

Pillar B as specced is tuned for go-wide and evasive combat and does not see **attrition
beatdown**, whose support package is stax and protection. Loosening to B≥2 rescues both — but
also admits *Radha's Explosive Vegetables* (A7/B2), which the owner confirms is **deliberately
built with the minimum possible count of MV≤3 cards** (1 of 61 nonlands) — a big-mana ramp
deck, not combat. **B≥3 stays; this is a documented limitation, not a tuning target.**

**One false positive:** Enigmatic Control (Tuvasa enchantress) clears at A5/B3, the exact
minimum. Decks sitting on both thresholds simultaneously are the weakest reads the rule
produces; a deck at exactly (5,3) should be treated as a suggestion, never a pre-selection.

**One overlap to expect:** "Equipment are the best mana rocks" fires at A16/B6 because
Equipment cards carry saboteur triggers ("whenever equipped creature deals combat damage to a
player…"). Equipment voltron decks genuinely *are* combat decks; the row should surface as a
**secondary**, with Equipment staying primary. Same for the typal decks in the fixture set
(Ur-Dragon, Krenko, Edgar) — see §5.3.

### 5.3 Band behaviour

`DECK_THEME_CONFIG` bands are none / trace 1 / light 5 / decent 10 / focused 18 /
very-focused 30, with `minListCount: 5`. Distribution of the combat union across the 42 decks:

| Band | Decks |
| --- | ---: |
| very_focused (30+) | 1 |
| focused (18–29) | 8 |
| decent (10–17) | 7 |
| light (5–9) | 11 |
| trace (1–4) | 14 |
| none | 1 |

15 decks reach Decent or better; 14 sit in Trace and are hidden by `minListCount`. That is a
healthy spread — the theme is neither universal nor rare.

Per owner lock #6, Light-band evidence chips are kept even when the two-pillar rule rejects
identity (e.g. `muldrotha-graveyard` at 5 core / 0 support). The band is honest evidence; the
two-pillar rule governs identity. No combat-specific gating.

### 5.4 Correction — how much the EDHREC-average sample misled

Earlier passes used the 12 `engine2/fixtures/decks` EDHREC **average** decks and concluded
"curve barely separates decks." That was an artifact:

| | EDHREC averages (12) | Individual decks (42) |
| --- | --- | --- |
| MV≤3 share | 49% – 85% | **2% – 91%** (median 67%) |

The 2% floor was verified as real, not a parsing bug: *Radha's Explosive Vegetables* has 1 of
61 nonlands at MV≤3, which the owner confirms is deliberate. Averaging dilutes cards only some
builds run, compressing exactly the variance a curve signal depends on. **Curve is a strong
discriminator on real decks**, which matters for `strategy.aggro` (§5.5) more than for combat.

**Methodological rule for future passes: validate detection against individual decks, never
averages.**

### 5.5 Combat vs Aggro independence (owner lock #5)

Spearman rank correlation between a speed-only index (curve, sharing no term with combat) and
the combat core:

| Corpus | ρ |
| --- | --- |
| 12 EDHREC averages | −0.145 |
| **42 individual decks** | **+0.258** |

Mildly positive on the better corpus — combat decks skew slightly cheaper, which is intuitive
— but nowhere near redundant. **Both rows are justified.** Concrete counter-examples in both
directions:

- **Slow combat:** Ur-Dragon (mean MV 4.35), $20 Meat Avalanche (3.97), Skanos's Math Class (4.08)
- **Fast non-combat:** Turbostax, Gruulslinger, Diving for Spells (mean MV 2.47, A=0)

### 5.6 How much of the pool is genuinely new

Of the 2,694 identity-core cards, overlap with existing `THEME_ORACLE` patterns:

| Existing theme | overlap | share |
| --- | ---: | ---: |
| Tokens | 529 | 19.6% |
| Counters | 441 | 16.4% |
| Lifegain | 184 | 6.8% |
| Equipment | 148 | 5.5% |
| Reanimator | 122 | 4.5% |
| Voltron | 93 | 3.5% |
| Sacrifice | 89 | 3.3% |
| Mill / Auras / Spellslinger / Artifacts / Blink / Landfall / Control | ≤77 each | ≤2.9% |
| **NONE — combat-only** | **1,267** | **47.0%** |

Sample combat-only cards: *Higure, the Still Wind · World at War · Guiltfeeder · Dazzling
Sphinx · Labyrinth Adversary · Order of the Golden Cricket · Ma Chao, Western Warrior*.

---

## 6. engine2 — PROPOSAL ONLY ⚠️ PARTNER APPROVAL REQUIRED

**Nothing in this section may be implemented without sign-off.** The rest of the document
stands on its own: combat detects from oracle patterns, role tags, and theme wiring without
any engine2 change. What engine2 adds is *accuracy* and, more importantly, stops the
recommender actively working against combat decks.

### 6.0 The ask, in under 100 words

> engine2 cannot see combat decks. Its vocabulary has no axis for "deals combat damage to a
> player" — 787 commander-legal cards, the entire saboteur archetype — so those cards extract
> as generic card draw and the deck's plan disappears. No goal template covers attacking as an
> engine. And because combat axes are almost never used on the `needs` side, combat cards form
> no interaction edges: a working combat deck looks like ~30 unconnected cards to the cut
> scorer, which then recommends cutting them. The fix is additive — one axis (vocab v4→v5),
> one goal template, two prompt join rules.

### 6.1 What engine2 already has

`engine2/vocab.js:204` opens a block commented `// combat`:

| Axis | Used by which goal template? |
| --- | --- |
| `body.evasive` | `voltron` core only |
| `body.big` | `stompy` core, `reanimator` support |
| `evasion.grant` | `tokens-wide`, `stompy`, `counters`, `voltron` — all support |
| `anthem.global` | `tokens-wide` core |
| `combat.extra` | `tokens-wide` **support only** |
| `combat.attack_trigger` | `goad` **support only** |
| `combat.fog_like` | `control` support, `goad` core — *anti*-combat |
| `combat.goad` | `goad` core |
| `voltron.aura_equipment` / `voltron.carrier` | `voltron` |
| `pump.single` | `voltron` core |

Plus `haste.enabler` (:279) and `wincon.damage_burst` (:265). The IR also carries
`wincon: { kind: 'combat' }` (`WINCON_KINDS`, :86), used by both combat-flavoured golden
fixtures (Serra Angel, Krenko).

### 6.2 The four measured gaps

1. **The saboteur family has no axis.** 787 commander-legal cards say "deals combat damage to
   a player"; nothing encodes it. `combat.attack_trigger` covers *declaring* an attack;
   *connecting* is a different, evasion-gated event. Such cards extract as
   `card_advantage.draw_engine` and the combat connection is lost. This is why
   `engine2/fixtures/decks/yuriko-ninjas.json` is labelled `archetype_expected: "tribal:Ninja"`
   — the deck's real plan has nowhere to land.
2. **No goal template owns combat.** 22 templates: `stompy` (ramp into big bodies),
   `tokens-wide` (swarm), `voltron` (go-tall), `goad` (force *others* to attack). Nothing for
   "this deck attacks, and attacking is the engine."
3. **No `IR_AXIS_THEME` row maps any combat axis.** 52 of 121 axes are unmapped, including
   every combat axis. The one that maps, `evasion.grant`, goes to **Voltron** — backwards for
   a team-wide grant.
4. **Combat axes form no interaction edges.** `computeInteractions`
   (`engine2/interactions.js:66`) creates an `enabler_payoff` edge only when
   `a.provides.axis === b.needs.axis`. Across the golden fixture set the `needs` side contains
   exactly **one** combat axis (`haste.enabler`), and `engine2/prompt.js:78` explicitly
   instructs the extractor that "a creature does not need `anthem.global`." So combat cards
   never join a cluster, contribute ~0 to `synergyDegree`, and surface in `cutReasons` as
   "barely connected to the deck." **This is the consequential one, and a template alone does
   not fix it.**

*Adjacent, out of scope:* `IR_AXIS_THEME` has a **dead row** — `/^equipment\./` matches no
axis. Equipment's IR signal rides `voltron.aura_equipment`, which the row above sends to
Voltron. The Equipment→Voltron debt is fixed in the tag/type-line paths but **still live on
the IR path**. See §8.

### 6.3 Proposed new axis (vocab v4 → v5)

```js
// engine2/vocab.js, in the `// combat` block
'combat.damage_trigger': 'triggers when a creature you control deals combat damage to a player '
                       + '(saboteur triggers — needs evasive or unblockable bodies to fire)',
```

Additive; pre-v5 rows simply lack it until re-extraction — the same pattern `combat.goad`,
`mill.opponent` and `mill.matters` already shipped under in v4, where the template scores 0
and stays inert until backfill.

Labels for `engine2/explain.js` `AXIS_LABELS`: `combat.damage_trigger` → "combat-damage
triggers", `combat.attack_trigger` → "attack triggers", `combat.extra` → "extra combats",
`haste.enabler` → "haste granting".

**Not proposed:** a `combat.aggression` axis — `haste.enabler` and `combat.goad` already
cover it, and a third overlapping axis would dilute provider counts in the template's fill maths.

### 6.4 Proposed prompt join rules (the Gap-4 fix)

`engine2/prompt.js` only — no new vocab tokens, but extraction output changes, so this is a
new `prompt_version` → new `run_id`, diffed by `scripts/semantics-audit.js` before promotion
(`docs/engine2-ir-spec.md` §10).

1. **Saboteur payoffs declare their dependency.** A card triggering on "deals combat damage to
   a player" provides `combat.damage_trigger` **and needs `body.evasive`** (`requires` when the
   card does nothing otherwise, else `wants`). This mirrors the rule already at prompt:79 —
   "a payoff whose trigger fires on casting/controlling/having a CLASS of things NEEDS that
   class's axis."
2. **Attack-trigger payoffs declare theirs.** `combat.attack_trigger` cards need
   `token.creature_wide` or `combat.extra` (`wants`) — the vocab description already says
   "needs go-wide or extra combats"; it is simply never encoded.
3. **Relax `body.evasive` from "sizeable."** Current wording excludes the 1/2 unblockable body
   that saboteur decks are built on. Proposed: *"a body that reliably connects — evasive,
   unblockable, or hard-to-block — whether or not it is large."* Size lives in `body.big`.
   ⚠️ This is a semantic change to an existing axis and **requires re-extraction for
   consistency** — same cost as the new axis, incurred in the same run.

### 6.5 Proposed goal template

Placed **after `voltron`** (`goal-templates.js:173`) and before `big-mana`. Position matters:
`deck-goals.js` breaks exact-score ties by `explainedShare` then template index, so a late
slot means combat only wins when it explains more of the deck than the incumbent read — Krenko
stays `tokens-wide`, Ur-Dragon stays `tribal:Dragon`.

```js
{
  key: 'combat', label: 'Combat / attacks matter',
  verb: 'turn the attack step into the engine — connect, trigger, and swing again',
  // Three MECHANISMS reach the same plan, exactly like voltron's equipment-vs-pump split.
  // `defining` scales the whole confidence by the best mechanism's fill, so the support half
  // can never carry the goal alone — that is what keeps a value deck's handful of
  // attack-triggers (Muldrotha: 5 core, 0 support) from reading as combat.
  core: [
    {
      defining: true,
      anyOf: [
        { key: 'saboteur',     axes: ['combat.damage_trigger'], min: 6 },
        { key: 'attacks',      axes: ['combat.attack_trigger'], min: 8 },
        { key: 'extra-combat', axes: ['combat.extra'],          min: 2 },
      ],
    },
    { axes: ['evasion.grant', 'body.evasive', 'haste.enabler', 'anthem.global'], min: 4 },
  ],
  support: ['wincon.damage_burst', 'pump.single', 'token.creature_wide',
            'counters.plus1_mass', 'protection.single'],
}
```

**Calibration**, from §5.2 (provider counts; commander ×3 per `deck-goals.js:29`):

- `saboteur: 6` — On the Prowl (16) and Buffs by Hans (18) fill past 1.0; Talrand's 3 does not.
- `attacks: 8` — Dog go bonk (15) and Wrath of Dog (13) fill it; Muldrotha's 5 does not.
- `extra-combat: 2` — only 44 cards in the format carry it; two is a deliberate package. The
  self-declared aggro deck runs 4.
- Second group `min: 4` — Pillar B. Korvold (0) and Muldrotha (0) score 0 here, halving
  `coreAvg` *and* leaving the defining fill unable to rescue them.

**Excluded:** `combat.fog_like` and `combat.goad` — anti-combat and politics respectively,
already owned by `stax` / `goad` (owner lock #4).

### 6.6 Threshold entries

```js
// engine2/thresholds.js
GOAL_ADJUSTMENTS.combat = { Plan: 5, 'Board Wipe': -2, Ramp: -1 };  // cf. stompy { Ramp: 2, Plan: 5 }
SPEED_BY_GOAL.combat = 40;                                          // between tokens-wide (35) and tribal (45)
```

---

## 7. Wiring outside engine2 — ✅ SHIPPED 2026-09-18

All of the below is implemented and `npm test` passes (one unrelated pre-existing failure,
`test-card-image-loading`, fails identically on the untouched baseline). `engine2/` is
untouched.

### 7.1 The two-pillar gate — shipped client-side, marked for deletion

**Owner decision (2026-09-18): build it outside engine2 now**, accepting that it is temporary.

`combatPillars(deck)` lives in `js/deck-themes.js` beside the patterns it mirrors, and
`rankStrategiesForDeck` (`js/deck-plan.js`) zeroes Combat's score when the deck fails it.
`COMBAT_PILLAR_CORE` / `COMBAT_PILLAR_SUPPORT` are the single source of truth — `THEME_ORACLE`
is built by concatenating them, so the gate and the evidence patterns cannot drift apart.

**What it gates and what it does not:**

| Surface | Gated? |
| --- | --- |
| Strategy *suggestion* (`rankStrategiesForDeck` chips) | **Yes** — score forced to 0, so it can never clear `PLAN_INFERENCE_CONFIDENCE_MIN` (0.35) and is never pre-selected |
| Theme *evidence* band and support count | **No** — owner lock #6; the band stays honest |
| Picking Combat by hand | **No** — the row stays in the catalog and remains selectable |
| `rankStrategiesForCommander` | **No** — two pillars cannot be evaluated from one card, so a Yuriko-style commander still suggests Combat |

**Why it is temporary, and the removal contract.** engine2's goal inference wins whenever it is
present — `js/deck-architecture.js` `_buildStrategySubs` returns `goalSubs` outright when any
exist, and the client's theme vocabulary is only the fallback. So this gate:

- works today, while engine2 has no combat goal
- becomes dead code the day engine2 ships one
- and in between gives two independent definitions of "is this a combat deck" that can
  disagree — client says no, engine2 says yes, and engine2 wins

That reasoning is reproduced verbatim in the code comment, together with a four-step removal
checklist (inline the patterns back into `THEME_ORACLE`, delete the pillar block and its two
exports, delete the gate in `deck-plan.js`, drop the tests). Search **`COMBAT TWO-PILLAR GATE`**
to find the call site.

**Fail-open by design:** `_combatTwoPillarOk` returns `true` when the themes module is
unavailable, so a bundling or load-order problem can never silently hide the strategy.

### 7.2 One deliberate deviation from the measured set

`THEME_ORACLE['strategy.combat']` ships the §4.2 pattern set **minus the goad alternation**,
per owner lock #4 (goad is politics, not your combat plan). §5.2's measurements were taken
*with* goad included; its contribution there was small (3 cards in krenko-goblins, 1 in
talrand-spellslinger), so the published counts are within a card or two of what the shipped
patterns produce on those decks.

### 7.3 What landed

| File | Change |
| --- | --- |
| `js/deck-plan.js:41` / `js/deck-themes.js:41` | `{ id: 'strategy.combat', label: 'Combat' }` plus the three `parent: 'strategy.combat'` children, in both `PLAN_STRATEGIES` and `THEME_CATALOG` |
| `js/deck-themes.js` | Core patterns split three ways so each child owns its mechanism; the umbrella keeps the support half and inherits the rest by roll-up. `IR_AXIS_THEME` points `combat.attack_trigger` at the attacks child and `combat.extra` at the extra-combats child |
| `js/deck-plan.js` | Child oracle rules, child subtag defaults (`catk.*`, `csab.*`, `cxcom.*`) with their `SUBTAG_ID_STRATEGY_PREFIX` entries, and `_isCombatStrategy()` so the creature-share nudge and the two-pillar gate cover umbrella **and** children |
| `js/deck-plan.js:74` | Add to `PLAN_STRATEGY_SHORTLIST_IDS` — uncapped (lock #3) |
| `js/deck-themes.js:122` | The §4.2 core + support patterns in `THEME_ORACLE` |
| `js/deck-themes.js:90` | `THEME_TAGS` = `['Extra Combat', 'Combat Trick']` |
| `js/deck-themes.js:269` `JIVE_PAIRS` | combat↔tokens, ↔tribal, ↔counters, ↔voltron, ↔equipment, ↔vehicles |
| `js/deck-themes.js:259` `CLASH_PAIRS` | combat↔control, ↔stax, ↔mill (fires only when both are `focused`) |
| `js/deck-plan.js:144` | `{ id: 'strategy.combat', patterns: [/\bwhenever you attack\b/i, /\bdeals combat damage to a player\b/i, /\badditional combat phase\b/i] }` |
| `js/deck-plan.js:285` | The four §3 engines in `PLAN_THEME_SUBTAG_DEFAULTS` |
| `js/deck-plan.js:1035` | The §4.3 creature-share nudge |
| `js/archetype-role-bridge.js:35` | `'strategy.combat': ['Extra Combat', 'Combat Trick', 'Anthem']` |
| `js/archetype-role-bridge.js:82` | Repoint `'Extra Combats'` → `strategy.combat`. **`'Aggro'` stays mapped to its own row** (lock #5) |
| `js/archetype-role-bridge.js` enrichment | Reuse the sheet's Aggro/Extra-Combats otags plus the §4.1 verified list |
| `js/deck-architecture.js:603` | Add `'combat'` to `COMBAT_GOALS` |
| `js/deck-architecture.js:693` | `combat: ['Evasion', 'Extra Combat', 'Combat Trick', 'Anthem', 'Pump']` — broad is fine here; this map only *places* cards into an already-chosen pile |
| `js/deck-architecture.js:819` | `combat: 'strategy.combat'` in `GOAL_KEY_STRATEGY` (inert until §6 ships) |
| `js/project-role-tags.js` | Both §4.1 labels added, otag-backed |
| `js/decks.js` | Same two labels in the fallback tag list, plus `DEFAULT_TAG_BADGE` art (fist / cloak) so the new tags get badges |

### 7.4 Still to do by hand

**One admin action is outstanding:** the two new role tags exist in code but no card carries
them until someone runs `POST /api/admin/scryfall/rebuild-tags` on prod. Until then Combat
detects from oracle patterns and IR axes only, and its tag-driven signal is silent.

**Tests touched:** `test-deck-themes.js`, `test-deck-plan.js`, `test-deck-architecture.js`,
`test-archetype-role-bridge.js`. Rebuild `dist/bundle.js` (`npm run build:bundle`) and commit
it — CI fails on a stale copy.

### 7.5 Follow-up (2026-09-18): `combat.enablers` was missing its haste half

Owner caught a gap in what shipped in §7.3: the `combat.enablers` Plan sub-target
(`js/deck-plan.js`) is labelled "Evasion & haste" but its `projectTags` only listed
`['Evasion']` — no tag existed for haste-granting, so haste cards never counted toward that
row or toward `GOAL_ROLE_TAGS.combat` in `js/deck-architecture.js`, even though the §4.2
"Haste granting" pattern (534 cards, 1.68% pool) has covered it in `THEME_ORACLE` /
`COMBAT_PILLAR_SUPPORT` since §7.1 shipped.

Added a third otag-style project role tag, `Haste Enabler`, to `js/project-role-tags.js` —
backed by a `query:` (not `otag:`) mirroring the exact §4.2 regex pair (`creatures you control
have/gain haste`, `gains?/gain haste`) rather than the unverified `gives-haste` (36) corpus
count from §4.1, so the tag agrees with the oracle-pattern definition already shipped. Wired
into `combat.enablers`'s `projectTags` and into `GOAL_ROLE_TAGS.combat`. This is the same
non-engine2 layer as §7.3 — `haste.enabler` stays an orphan axis inside engine2 (§8 debt #4,
untouched, still needs partner sign-off).

Rolls into the same **§7.4 outstanding admin action** — `Haste Enabler` needs the same prod
`rebuild-tags` run before any card carries it.

---

## 8. Boundaries and debt

**Combat is not:**

- **`wincon.combat`** — that answers "how does this deck close?"; the strategy answers "what is
  the engine?" They are not even correlated in sign: the loudest combat deck in the corpus
  (On the Prowl, Sygg) does not win with combat *damage*, it wins with the cards its combat
  damage draws.
- **`wincon.commander_damage`** — that stays with Voltron (one creature, not a team).
- **Goad-as-politics** — lock #4.
- **`strategy.aggro`** — lock #5; speed, not engine.
- **A peer row for extra combats** — 44 cards in the format; it is `combat.finishers`.

**Debt found, not fixed here:**

1. **`IR_AXIS_THEME` dead row** — `/^equipment\./` matches no axis; Equipment's IR signal goes
   to Voltron. Fixing it needs param-aware matching (`voltron.aura_equipment` param
   `equipment` → Equipment, `aura` → Auras), which `_irThemes` (`js/deck-themes.js:377`) does
   not do — it tests the axis string only.
2. **`THEME_TAGS['strategy.voltron'] = ['Evasion']`** is over-broad (5,384 cards; fires 34 on
   Ur-Dragon). Once combat exists, most of that signal belongs to it.
3. **`evasion.grant` → Voltron** is backwards; team-wide evasion is go-wide.
4. **`haste.enabler` is an orphan axis** — in vocab, used in `needs` by the Krenko golden
   fixture, referenced by no goal template.
5. 23 of 121 axes have no goal-template home; 52 of 121 are unmapped by `IR_AXIS_THEME`.

---

## 9. Validation before shipping

**Outside engine2:** run `npm test` (the four tests above), rebuild the bundle, and spot-check
the theme panel against the §5.2 corpus — 18 decks should show combat at Light or better, and
"Turbostax" / Gruulslinger / Diving for Spells should show nothing.

**Inside engine2, if approved:**

1. Re-run `scripts/semantics-deck-sweep.js` against prod semantics. Gate is ≥10 of 12 fixtures
   landing their expected archetype in the top 2 — **combat must not displace any incumbent
   read.** Watch `krenko-goblins`, `ur-dragon-dragons`, `edgar-vampires`: all three should fire
   combat as a *secondary*.
2. Add a 13th fixture deck with `archetype_expected: "combat"`. The fixture set has no combat
   deck at all, which is part of why the gap went unnoticed. *Dog go bonk* (A18/B12, 15 attack
   triggers) or *On the Prowl* (A21/B15) are the natural candidates.
3. Run `scripts/semantics-audit.js` to diff the new extraction run before promoting — the
   `body.evasive` wording change in §6.4 moves axes on every small evasive creature in the pool.

---

## 10. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| ~~Q1~~ | ~~Label for the speed row~~ | ✅ **Resolved** — **Aggro / Fast clock** (lock #7) |
| ~~Q2~~ | ~~When does `strategy.aggro` get its own signal research?~~ | ✅ **Resolved** — separate pass, queued at [strategy-aggro-research-handoff.md](strategy-aggro-research-handoff.md). Confirmed it needs **no engine2 or semantics change**: every signal it wants (cmc, `Haste` keyword, `Burn` tag, `mana.ritual`, `mana.cost_reduction`, `wincon.damage_burst`, `haste.enabler`) already exists |
| ~~Q3~~ | ~~Role tags now or later?~~ | ✅ **Resolved** — add both now (lock #8) |
| **Q4** | **engine2 §6 — partner approval.** ⏳ **Still open — the only blocker.** §6.0 is the under-100-word case to hand over | — |

---

## 11. Acceptance checklist

- [x] `strategy.combat` proposed with a card-mapping sketch, not just a name
- [x] Signals at every detection layer, with measured pool coverage per pattern
- [x] Identity-vs-signal rule stated and validated on **42 individual decks**
- [x] Role-tag slugs **verified against live Scryfall data**, not guessed
- [x] engine2 quarantined as proposal-only pending partner approval, with a short written case
- [x] Overlaps, clash/jive pairs, and boundaries against `wincon.combat` / Voltron / goad / aggro
- [x] Boundary cases (2 false negatives, 1 false positive) reported rather than tuned away
- [x] Sample bias stated: single-author corpus; averages rejected as a validation set
- [x] Adjacent debt logged without being silently fixed
