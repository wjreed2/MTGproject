# Strategy catalog research — expansion candidates

**Status:** Batch 1 **Completed** (2026-09-18) — catalog, detection, bridge, shortlist, migrations, tests/docs shipped in `js/` (see handoff). Batch 2/3 still research-only.
**Tokens split shipped 2026-09-18:** `strategy.tokens` is now an umbrella over Go Wide plus
ten specific token kinds. See the Tokens-split owner locks below and `docs/21-deck-themes.md`.
**Extended 2026-09-18:** `strategy.combat` researched separately in
[strategy-combat-research.md](strategy-combat-research.md). Owner lock: it is a **peer of**
`strategy.aggro`, not a replacement — Aggro = speed, Combat = the attack step is the engine
(measured independent, Spearman ρ = +0.258 across 42 individual decks). Combat **does** absorb
`strategy.extra_combats` / `strategy.evasion_matters` as engines. Rows below are marked.
**Author:** researching agent, 2026-09-17. Answers the handoff at
[strategy-catalog-expansion-handoff.md](strategy-catalog-expansion-handoff.md).

### Owner locks (2026-09-17, follow-up)

| Topic | Decision |
| --- | --- |
| **Lifegain** | **Strategy** — promote `theme.lifegain` → `strategy.lifegain` (peer). |
| **Food** | **Strategy** — `strategy.food` is a peer strategy, not only a Tokens engine. |
| **Typal** | **Strategies** — typal identities are strategies. Prefer label **Typal** over Tribal. |
| **Typal scope (owner clarifier)** | Typal is **not** creature-types only. It includes **Equipment, Artifacts, Auras**, creature types, and the same “X matters / kindred to a type” pattern for other card types/subtypes. Equipment matters / Artifacts matters / Auras matters are **typal strategies** (same class), not a separate product category from Elf typal. |
| **Enchantress** | **Is Auras typal** — do not keep Enchantress as a separate peer from Auras. `strategy.enchantress` aliases / migrates to Auras typal. |
| **Treasure / Clues** | **Typal strategies** like Food (`strategy.treasure`, `strategy.clues`). |
| **Lifegain** | Strategy, **not** typal (mechanic / life-total payoffs). |
| **Storm / Copy** | Stay under **Spellslinger** (engines or sub-signals). Do **not** park Copy under Blink — that bridge debt was wrong. |
| **Vehicles** | **Own typal row**, and remember it is still an **artifact** (child of / overlaps Artifacts typal — not a non-artifact identity). |
| **Pinned creature types** | Pin **Elf, Goblin, Zombie, Dragon** typal into the default shortlist (owner: “pin”). |
| **Equipment detection** | Prefer **type line** (`Equipment`) + equip/payoff oracle for `strategy.equipment` typal. Do **not** block Batch 1 on inventing a new project role tag; optional tag later only if tagging UX needs it. |

### Owner locks (2026-09-18) — Tokens split

Owner: *"Tokens / Go wide is not a single strategy. Tokens is an umbrella. Go wide
is when you have many creature tokens. Then, there are specific tokens."*

| Topic | Decision |
| --- | --- |
| **Tokens** | **Umbrella** (`strategy.tokens`, label **Tokens**). Means "makes tokens", nothing sharper. Supersedes the §2 row that said "keep as umbrella; see 2.2 for splits" without splitting it. |
| **Go Wide** | Own row, `strategy.tokens.go_wide`, child of Tokens. Identity = **creature tokens in volume**. Wide payoffs (anthems, "for each creature", convoke) are gated behind 5+ creature-token makers. On the default shortlist. |
| **Treasure / Food / Clues** | **Reparented** under Tokens. Supersedes the 2026-09-17 lock that filed them under Typal — they are token kinds, and Typal already covers card-type identity elsewhere. Labels drop the "typal" suffix so they read as siblings of Blood/Map/Junk. |
| **New specific tokens** | Blood, Powerstone, Incubate, Map, Junk, Role, Gold — all children of Tokens, all **search-only** (not shortlist chips). |
| **Roll-up** | A child's supporters count for the umbrella too (per-card boolean, no double-count). |
| **Umbrella hiding** | A child at **Focused** hides the umbrella row in the readout. A **user-set** umbrella is never hidden. |
| **Child role tags** | Fine token rows carry **`Token Maker` only**. Borrowing generic tags (Sac Outlet, Card Draw, Ramp) made a plain aristocrats deck rank as Junk — identity comes from oracle rules. |

---

## 1. Method

Sources used:

- **In-repo catalogs** — `PLAN_STRATEGIES` and `PLAN_STRATEGY_ORACLE_RULES` in
  [js/deck-plan.js](../js/deck-plan.js), `THEME_CATALOG` / `THEME_TAGS` / `THEME_ORACLE` /
  `IR_AXIS_THEME` / `CLASH_PAIRS` / `JIVE_PAIRS` in [js/deck-themes.js](../js/deck-themes.js),
  `ARCHETYPE_TO_STRATEGY` / `STRATEGY_PROJECT_TAGS` /
  `STRATEGY_SCRYFALL_ENRICHMENT_OTAGS` in [js/archetype-role-bridge.js](../js/archetype-role-bridge.js),
  and the project role-tag vocabulary in `js/project-role-tags.js` (what the app can already
  detect and tag: Ramp, Card Draw, Removal, Board Wipe, Tutor, Counterspell, Protection, Bounce,
  Control, Burn, Ping, Group Slug, Stax, Hatebear, Anthem, Evasion, Pump, Combat Trick, Bite,
  Extra Combat, Token Maker, Blink, Copy, Treasure, Lifegain, Discard, Mill, Wheel, Landfall,
  Recursion, Reanimate, Graveyard Cast, Self-Mill, Sac Outlet, Death Trigger, Drain, Sac Synergy).
- **Commander archetype vocabulary** — well-known EDHREC/community archetype names, used only
  as naming/coverage inspiration, not as a live dependency. No API calls made.
- **Architecture view semantics** — `docs/22-deck-architecture.md` (Foundation vs Strategy vs
  Payoffs vs Mana Sources; "Strategy engines/subsections" concept; "never writes Primary/Secondary
  Default tags" from the classifier alone).
- **Owner's locked rules** from the handoff — Equipment is a strategy, not an auto-alias for
  Voltron; catalog can be large but UI must not dump it all.

No live network calls were made; this document reasons from known Commander archetype
vocabulary and the existing detection surface (project role tags, oracle regexes, CardIR axes).

---

## 2. Proposed strategy catalog

Legend — **Specificity**: coarse / medium / fine. **Default shortlist**: whether this should be
in the ~15–25 item inferred/preferred list shown before search (vs. search-only in the full
catalog). Ids are proposals (`strategy.<slug>`), not final.

### 2.1 Current 18 (baseline, kept, mostly unchanged)

| id | Label | Specificity | Card-mapping sketch | Overlaps / confusable with | Default shortlist? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy.tokens` | Tokens | coarse | `Token Maker` tag; oracle "create...token(s)"; payoffs = Anthem, sac outlets, token doublers | Sacrifice, Tribal, Landfall (Treasure) | Yes | **Umbrella — split shipped 2026-09-18.** Children: Go Wide, Treasure, Food, Clues, Blood, Powerstone, Incubate, Map, Junk, Role, Gold |
| `strategy.tokens.go_wide` | Go Wide | medium | Oracle "create ... creature token"; gated payoffs = anthem, "for each creature you control", convoke | Typal, Combat, Sacrifice | Yes | Child of Tokens. Voltron's true opposite — it carries the go-tall/go-wide clash now |
| `strategy.sacrifice` | Sacrifice / Aristocrats | medium | `Sac Outlet`, `Death Trigger`, `Sac Synergy`, `Drain`; oracle "sacrifice", "whenever ... dies" | Tokens (fodder), Reanimator (death→GY) | Yes | |
| `strategy.spellslinger` | Spellslinger | medium | `Copy`; oracle cast/instant/sorcery/magecraft/storm/prowess | Control (also casts spells), Artifacts (Wizards) | Yes | |
| `strategy.reanimator` | Reanimator / Graveyard | medium | `Recursion`, `Reanimate`, `Graveyard Cast`, `Self-Mill`; oracle return-from-GY/reanimate | Sacrifice (feeds GY), Mill (self-mill overlap) | Yes | |
| `strategy.voltron` | Voltron | medium | Single-target buffed-creature payoffs: evasion, protection, unblockable, commander-damage math; NOT equipment/aura type alone | Equipment matters, Enchantress/Auras | Yes | See §3 — untangle from Equipment |
| `strategy.counters` | +1/+1 Counters | medium | Counter-placement + payoffs; oracle `+1/+1 counter`, proliferate | Superfriends (proliferate overlap), Voltron (buffed creature) | Yes | |
| `strategy.landfall` | Landfall | medium | `Landfall` tag; oracle landfall/"land enters"/extra land drop | Tokens (Treasure ramp), Artifacts (rocks) | Yes | |
| `strategy.tribal` | Tribal → **Typal** | coarse (see §2.4) | Chosen creature type(s); anthem/lord payoffs for that type | Tokens (typed tokens), Kindred payoffs | Yes (umbrella) | **Owner lock:** rename to Typal; specific types are strategy-settable (§2.4) |
| `strategy.artifacts` | Artifacts | coarse | Broad artifact-matters: rocks, affinity, metalcraft, artifact payoffs — NOT every deck with mana rocks | Equipment matters, Voltron, Tokens (Treasure) | Yes | See §3 |
| `strategy.enchantress` | → **Auras typal** | — | Legacy id | `strategy.auras` | — | **Owner lock:** Enchantress **is** aura typal; migrate/alias, do not keep as separate peer |
| `strategy.control` | Control / Value grind | coarse | Counterspell, Removal, Board Wipe, Card Draw, Bounce, Stax (light) | Stax (heavy), Goodstuff | Yes | |
| `strategy.blink` | Blink / ETB value | medium | `Blink` tag; oracle exile-then-return/flicker; ETB payoff density | Spellslinger (Copy overlaps blink-adjacent), Control | Yes | |
| `strategy.superfriends` | Superfriends | medium | Planeswalker density + `Protection`/proliferate/loyalty payoffs | Counters (proliferate), Control | Yes | |
| `strategy.theft` | Theft / Steal | fine | `Control`(gain-control)/`Bounce`; oracle "gain control of"/"exchange control" | Control (name overlap only, different mechanic) | No (niche but real; search) | |
| `strategy.stax` | Stax / Resource denial | medium | `Stax`, `Hatebear`; oracle tax/can't/skip-phase/prevent | Control (light stax), Group Slug | Yes | |
| `strategy.mill` | Mill | medium | `Mill` tag; oracle "mill" | Reanimator (self-mill build-around vs opponent mill) | Yes | Split self-mill (feeds reanimator) vs opponent-mill wincon — note in §3 |
| `strategy.goodstuff` | Goodstuff / High power | coarse | High-power staples, no unifying payoff; catch-all for "best cards" decks | Control | Yes | Genuinely a bucket, not a detectable payoff chain — keep coarse |
| `strategy.other` | Other / Hybrid | n/a | Fallback | n/a | Yes (fallback, always shown) | |

### 2.2 Equipment / Artifacts / Voltron split (owner's explicit ask)

| id | Label | Specificity | Card-mapping sketch | Overlaps / confusable with | Default shortlist? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy.equipment` | Equipment matters | fine | Card type = Equipment (maker/payoff), Equip-keyword density, "whenever equipped creature", equipment-cost-reduction, equipment tutors; payoff = equipment count/synergy, not just "has evasion" | Voltron (equipment as a Voltron sub-plan), Artifacts (equipment is an artifact subtype) | Yes | Peer strategy per owner rule #2. Detect via type line `Equipment`, not via Voltron's commander-damage oracle rules |
| `strategy.voltron` (redefined) | Voltron | medium | Single-creature-focused payoffs: evasion, protection, unblockable/menace, unkillable-commander tools, unblockable-tutors, unblockable-support — independent of *what* buffs the creature | Equipment matters, Auras/Enchantress, Counters | Yes | Density of equipment/auras is a **signal toward** Voltron, not identity (owner rule #1) |
| `strategy.auras` | Auras typal (was Enchantress) | fine–medium | Auras + enchantment-matters payoffs that fire on enchanting / constellation / “whenever an enchantment enters” draw — the classic Enchantress engine **is this typal**, not a sibling | Voltron (aura-as-suit), Artifacts (parallel) | Yes | **Owner lock:** Enchantress = Auras typal. Alias `strategy.enchantress` → here |
| `strategy.vehicles` | Vehicles typal | fine | Vehicle + Crew | Artifacts typal (Vehicles **are** artifacts) | Yes (own row; see §6a) | Own row; still artifact family |
| `strategy.artifacts` (redefined) | Artifacts typal | coarse | Non-Equipment/Vehicle artifact synergy: affinity, metalcraft, artifact-cost-reduction, artifact recursion/tutors, "whenever an artifact enters" — density of ramp rocks alone is NOT enough | Equipment, Vehicles, Voltron | Yes | Keep as broad typal umbrella; Equipment/Vehicles peel off as fine rows |
| `strategy.artifact_ramp` | Artifact ramp / rock density | fine (engine, not strategy — see §4) | Mana rocks + Treasure count | Artifacts, Tokens | No — engine under Artifacts or Mana Sources | Listed only to show exclusion — see §4 |

### 2.3 Sacrifice-family and Aristocrats splits

| id | Label | Specificity | Card-mapping sketch | Overlaps | Default shortlist? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy.food` | Food matters | fine | Food token subtype maker/payoff; "sacrifice a Food" | Tokens, Lifegain | Yes | **Owner lock:** peer typal strategy |
| `strategy.clues` | Clues matters | fine | Clue token maker/payoff, "sacrifice a Clue: draw" | Tokens, Control | No (search); infer when loud | **Owner lock:** typal strategy like Food |
| `strategy.treasure` | Treasure matters | fine | Treasure makers + Treasure payoffs (not rocks alone) | Tokens, Artifacts, Landfall | No (search); infer when loud | **Owner lock:** typal strategy like Food |
| `strategy.blood_matters` | Blood tokens matters | fine | Blood token maker/payoff | Tokens, Reanimator | No | Newer / smaller pool — Batch 3 |

### 2.4 Typal (owner lock: broad “X matters” strategies)

**Owner (2026-09-17):** Typal should be **strategies**. Clarifier: typal **includes Equipment,
Artifacts, Auras, etc.** — not only creature types. Same product class as “Elf typal”: the deck
is built around a **type / subtype / card-type identity**.

| id | Label | Specificity | Card-mapping sketch | Overlaps | Default shortlist? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy.typal` | Typal (umbrella) | coarse | “Matters” payoffs for a chosen type dimension | Many fine typal rows | Yes | Entry when type unset / multi-type; or browse parent in picker |
| `strategy.equipment` | Equipment typal / Equipment matters | fine | Equipment type line, Equip keyword, equipment payoffs | Artifacts typal, Voltron | Yes | Peer strategy; **is typal**, not Voltron-auto |
| `strategy.artifacts` | Artifacts typal / Artifacts matters | coarse–medium | Non-equip/vehicle artifact synergy (affinity, metalcraft, artifact ETB payoffs); rocks alone ≠ identity | Equipment, Vehicles | Yes | Baseline row; framed as typal |
| `strategy.auras` | Auras typal (= Enchantress) | fine–medium | Auras + enchantment ETB/constellation/enchantress draw; aura recursion | Voltron | Yes | **Owner lock:** Enchantress is this row |
| `strategy.vehicles` | Vehicles typal | fine | Vehicle + Crew | Artifacts typal (Vehicles **are** artifacts) | Yes (own row; see §6a) | Own row; still artifact family |
| `strategy.typal.<creatureType>` | e.g. Elf typal, Goblin typal | fine | Bodies + lords/payoffs for that creature type | Tokens (typed tokens) | No (search + infer); popular types may shortlist later | Creature-type typal |
| `strategy.food` | Food typal | fine | Food token subtype makers/payoffs | Tokens, Lifegain | Yes | **Owner lock** |
| `strategy.treasure` | Treasure typal | fine | Treasure makers + Treasure-specific payoffs | Tokens, Artifacts, Landfall | No (search + infer) | **Owner lock** |
| `strategy.clues` | Clues typal | fine | Clue makers + Clue payoffs | Tokens, Control | No (search + infer) | **Owner lock** |

**Shape for implementers:**

- One **typal pattern**: dimension = creature type **or** card type **or** token subtype (Equipment,
  Artifact, Aura, Vehicle, Food, Elf, …).
- Stable ids can stay readable (`strategy.equipment`, `strategy.typal.elf`) rather than forcing
  every row through one `strategy.typal.*` string — product-wise they are all typal strategies.
- Do **not** hand-author every creature type up front; dynamic creature-type ids + search/infer.
- Voltron stays **non-typal** (single-creature suit-up / commander damage), though typal density
  can **signal** toward it.

Supersedes “creature-type sub-picks only” and the narrower typal reading from earlier in this doc.

### 2.5 New strategies — additions grouped by family

| id | Label | Specificity | Card-mapping sketch | Overlaps / confusable with | Default shortlist? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy.lifegain` | Lifegain matters | medium | `Lifegain` tag; oracle "gain life"/lifelink; payoffs = life-total-matters triggers (Well of Lost Dreams-style, "whenever you gain life") | Sacrifice/Drain (lifegain as a byproduct vs. build-around), Superfriends (Ajani-style) | Yes | **Owner lock:** promote `theme.lifegain` → peer strategy |
| `strategy.lifedrain` | Life drain / Life loss matters | fine | Split of Aristocrats-drain into its own build-around when drain (not sac) is primary | Sacrifice, Lifegain (inverse), Mill | No | Mostly redundant with `wincon.life_drain` + Sacrifice; keep as wincon unless a distinct non-sac drain pile emerges |
| `strategy.group_hug` | Group Hug | fine | Symmetrical effects that help all players: extra card draw for table, "each player may...", Howling Mine-style | Control (opposite intent), Politics | No | Real, low pop |
| `strategy.group_slug` | Group Slug | fine | `Group Slug` tag; symmetrical/edict damage that punishes the table | Sacrifice (drain), Stax | No | |
| `strategy.politics` | Monarch / Goad / Politics | fine | Monarch, Goad keyword, "deal damage divided", vote/council's dilemma cards | Group Hug, Group Slug, Stax | No | |
| `strategy.combo` | Combo / Infinite | medium | Combo-piece pairs, tutors-for-combo density, "infinite"/"win the game" oracle | Spellslinger, Artifacts, Control | Yes | Currently folds into `strategy.other`; splitting it out lets Adds/plan reason about combo-support cards |
| `strategy.ramp_matters` | Big Mana / Ramp payoffs | fine | Heavy ramp density + X-spell/cost payoffs that *want* huge mana, not just curve-smoothing ramp | Artifacts (rocks), Landfall | No | Distinguish from generic Ramp foundation function — this is ramp *as the plan*, e.g. Ramp into X-spells |
| `strategy.x_spells` | Big X spells | fine | X-cost spells as payoffs, cost-reduction on X spells | Ramp matters, Spellslinger | No | |
| `strategy.extra_combats` | Extra Combats | fine | `Extra Combat` tag; "additional combat phase" oracle | Voltron, Tokens (go-wide + extra combat) | No | **Absorbed into `strategy.combat`** as the `combat.finishers` engine (44 cards in the format — too small for a peer row) |
| `strategy.extra_turns` | Extra Turns | fine | "take an extra turn" oracle, Time Warp effects | Combo, Control | No | |
| `strategy.wheel` | Wheels / Discard-draw | fine | `Wheel`/`Discard` tags; "each player discards...draws" | Reanimator (discard-to-GY), Spellslinger | No | |
| `strategy.discard_matters` | Discard matters (non-wheel) | fine | Madness, hellbent, discard-as-cost payoffs, opponent discard (mill-adjacent hate) | Reanimator, Wheel | No | Split from Wheel: symmetric wheel vs. asymmetric discard |
| `strategy.infect` | Infect / Poison | fine | Infect/Toxic/Proliferate-for-poison keyword cards | Counters (proliferate), Voltron (single evasive infect creature) | No | Small but well-known archetype; niche format legality note |
| `strategy.devotion` | Devotion matters | fine | Devotion-to-color payoffs (Gods, devotion counters) | Enchantress (mono-color enchantment shells), Goodstuff | No | |
| `strategy.aggro` | **Aggro / Fast clock** | coarse | Low curve, haste density, burn-to-face, rituals / cost reducers — **speed signals only, sharing no term with Combat** | `strategy.combat` (different axis: engine vs speed), Spellslinger (burn) | No | **KEPT** (owner, 2026-09-18), relabelled **Aggro / Fast clock**. Research pass queued at [strategy-aggro-research-handoff.md](strategy-aggro-research-handoff.md). Peer of `strategy.combat`; see [strategy-combat-research.md](strategy-combat-research.md) §2.1 and §5.5. Still needs its own measured signal set before it can be inferred — curve spans 2%–91% MV≤3 on real decks, so it is more detectable than earlier thought |
| `strategy.storm` | Storm | fine | Storm keyword, rituals, cantrips — **Spellslinger engine**, not its own default peer | Spellslinger, Combo | No | Stay under Spellslinger unless usage demands peel |
| `strategy.copy_clone` | Copy / Clone matters | fine | Copy spells, clone permanents, copy triggers | Spellslinger (parent), Blink (only when used to re-buy ETBs) | No | **Owner:** belongs with Spellslinger, **not** Blink. Fix bridge debt that mapped Copy → Blink |
| `strategy.historic` | Legendary / Historic matters | fine | "historic" keyword, legendary-matters payoffs | Goodstuff, Voltron (legendary commander synergy) | No | |
| `strategy.party` | Party (D&D types) | fine | Cleric/Rogue/Warrior/Wizard "Party" payoffs | Tribal | No | Narrow, format/set-specific |
| `strategy.doubling` | Doublers / Copy-effects (non-creature) | fine | Doubling Season-style effects: token doubler, counter doubler, mana doubler, damage doubler | Tokens, Counters, Landfall | No | Cross-cutting enabler; consider engine-under-parent instead of standalone (see §4) |
| `strategy.exile_matters` | Exile matters / Impulse draw | fine | "exile the top card...you may play it" impulse draw density, exile-as-resource payoffs | Spellslinger, Blink | No | Emerging modern archetype (Modern Horizons-era) |
| `strategy.food_chain` | Sacrifice-for-mana / Free spells | fine | Free-spell cost alternative ("exile a creature you control" for cost), Food-Chain-style combo shells | Sacrifice, Combo | No | Narrow, mostly combo-adjacent |
| `strategy.pillowfort` | Pillowfort / Deterrence | fine | "can't attack you", Propaganda-style tax-to-attack, fog effects | Stax, Control | No | Currently folds into Control/Stax — split candidate if fog density becomes detectable |
| `strategy.energy` | Energy counters matter | fine | `{E}` energy symbol payoffs | Counters (mechanically distinct: energy pool, not on-permanent) | No | Very small card pool (Kaladesh block); low priority |
| `strategy.day_night` | Day/Night matters | fine | Daybound/Nightbound mechanic payoffs | Aggro, Control | No | Very small pool (Innistrad: Midnight Hunt); low priority |
| `strategy.spells_matter_noncreature` | Noncreature spells matter | fine | "noncreature spell" payoffs (broader than instant/sorcery — includes artifacts/enchantments/PWs) | Spellslinger, Superfriends, Artifacts | No | Distinct trigger condition from Spellslinger's instant/sorcery focus |
| `strategy.graveyard_hate_adjacent` | Self-mill / Delirium | fine | Self-mill as a value engine (delirium, escape, disturb) distinct from Reanimator's big-reanimate payoff | Reanimator, Mill | No | Split candidate from Reanimator if self-mill-without-reanimate decks are common enough |
| `strategy.threaten_effects` | Threaten / Sacrifice-their-stuff | fine | "gain control...sacrifice it" one-shot theft into sac payoffs | Theft, Sacrifice | No | Narrow overlap row; mostly redundant with Theft + Sacrifice combined |
| `strategy.evasion_matters` | Evasion payoffs (non-Voltron) | fine | Team-wide evasion grants (flying tribal-lite, menace anthem) distinct from single-creature Voltron | Voltron, Tokens, Tribal | No | **Absorbed into `strategy.combat`** as the `combat.enablers` engine — this row existed only because nothing owned team-wide evasion |
| `strategy.counterspell_control` | Hard Control / Counter-heavy | fine | High counterspell density as the primary plan, not just a Control ingredient | Control, Stax | No | Sub-flavor of Control; likely stays an engine under Control |
| `strategy.card_advantage_engines` | Draw-engine value | fine | Repeatable card-advantage engines as the named plan (not generic "good draw spells") | Control, Goodstuff | No | Likely stays Foundation (Resources) territory, not a peer strategy — listed to show the boundary |

Running count: 18 baseline + Equipment/Auras/Vehicles split (3 new, Artifacts redefined) +
Sacrifice-family additions (4) + new families (§2.5, ~29) = **~54 proposed rows**, comfortably
inside the 40–80 target, with room to add 10–20 more fine-grained tribal-adjacent or set-specific
rows later without redesigning the shape.

---

## 3. Signal vs identity rules

**General rule:** card-type or tag *density* is a **signal** that feeds inference/suggestion
scoring. It never *auto-assigns* a strategy as declared/primary. Only the user's Plan wizard
choice (or an explicit "set as strategy" action) makes a strategy identity. This mirrors the
existing plan/theme split: `PLAN_STRATEGIES` = declared identity, `THEME_CATALOG` = detected
evidence band (`none/trace/light/decent/focused/very_focused`).

- **Equipment vs Voltron vs Artifacts** (owner's explicit example):
  - Equipment type line + Equip keyword density → signal toward `strategy.equipment` AND
    toward `strategy.voltron` AND toward `strategy.artifacts` (equipment is a card type that is
    also an artifact). All three can light up from the same 10 cards.
  - **Identity separation:** `strategy.equipment` = the deck is built to matter *because it runs
    a critical mass of Equipment cards themselves* (tutors for equipment, cost reduction on
    equip, "whenever a permanent becomes equipped"). `strategy.voltron` = the deck is built to
    win via one creature getting big and evasive/protected, *regardless of the buff source*.
    `strategy.artifacts` = the deck cares about artifacts broadly (affinity, metalcraft,
    artifact-cast-reduction), not specifically Equipment.
  - Today's `archetype-role-bridge.js` maps `'Equipment' → 'strategy.voltron'` and
    `'Equipment' → wincon.commander_damage'` — this is the **debt the handoff calls out**. Fix
    direction: add `strategy.equipment` as its own bridge row with its own project-tag mapping
    (Equip keyword doesn't have a dedicated project role tag today — likely needs a new
    `Equipment` project tag or a type-line check, not otag reuse) rather than silently folding
    into Voltron.

- **Auras typal (= Enchantress) / Voltron:**
  - Aura / enchantment-matters density → signal toward `strategy.auras` (typal identity;
    includes classic Enchantress draw engines) and/or `strategy.voltron` (if the plan is suit
    up one creature).
  - **Owner lock:** Enchantress **is** Auras typal — one strategy, not two. Migrate
    `strategy.enchantress` → `strategy.auras` (alias OK during transition).
  - Voltron remains non-typal: one-creature win, buff source independent.

- **Food / Treasure / Clues / Tokens / Lifegain:**
  - Token-subtype makers → signal toward `strategy.tokens` and the matching typal row
    (`strategy.food` / `strategy.treasure` / `strategy.clues`) when subtype payoffs dominate.
  - Lifegain is a **non-typal** strategy when life-total matters is the identity.
  - Suggest, don't auto-pick.

- **Mill (self vs. opponent):** `strategy.mill` currently conflates two different intents —
  opponent-deck-out wincon vs. self-mill-as-graveyard-fuel (which properly feeds Reanimator).
  Recommend the oracle/tag split stay as today (both use the `Mill`/`Self-Mill` tags) but flag
  in card-mapping notes: self-mill density alone should not suggest `strategy.mill` as primary;
  it should suggest `strategy.reanimator`. This is already partly true (`Self-Mill` project tag
  feeds Reanimator's `STRATEGY_PROJECT_TAGS`, not Mill's) — no code change needed, just
  documenting the existing correct behavior so it isn't "fixed" incorrectly later.

- **Spellslinger vs Copy / Storm vs Blink:**
  - **Owner:** Storm and Copy/Clone belong with **Spellslinger**, not Blink. Blink is
    exile-then-return / ETB value only.
  - Today's bridge/enrichment parking Copy under Blink is **debt to fix** (remap Copy signals
    toward Spellslinger; Blink may still *use* copy effects as an engine, but identity stays
    Spellslinger when copy/storm is the plan).
  - Do **not** peel Storm or Copy as default peer strategies yet — engines under Spellslinger.

---

## 4. Not strategies (stay Foundation / engine / wincon)

These should **not** become peer catalog rows, per the handoff's exclusion list and the
Architecture view's Foundation/Strategy/Payoffs split:

- **Foundation roles** — Ramp, Card Draw, Removal, Board Wipes, generic Interaction. These are
  Foundation *functions* (`docs/22-deck-architecture.md`), always shown, never strategies.
- **`strategy.artifact_ramp`** (mana rock density) — an **engine row under** Artifacts (or under
  Foundation → Mana Sources), matching `PLAN_THEME_SUBTAG_DEFAULTS['strategy.artifacts']`'s
  `art.rocks` subsection today. Do not promote to a peer strategy.
- **`strategy.doubling`** (generic doublers) — cross-cutting enabler that boosts whichever
  parent strategy is present (token doubler boosts Tokens, counter doubler boosts Counters). Best
  modeled as a shared "Doubler" project tag/engine referenced from multiple parents, not its own
  strategy row.
- **`strategy.card_advantage_engines`** — stays Foundation (Resources capability), not Strategy.
- **Pure wincons that already have a `wincon.*` id and no distinct card pile** — e.g. plain
  Combat damage, Commander damage as *generic* wincons stay in `PLAN_WINCONS`; they only become
  a strategy row when there's a specific build-around card pool (Voltron already is that for
  commander-damage; Combo already is being proposed as a strategy in §2.5 because it *does* have
  a distinct detectable card pool — tutors + combo pieces — beyond just "wincon.combo").
- **Per-type typal rows** — **superseded by owner lock.** Specific creature types are
  strategy-settable (`strategy.typal.<type>`); see §2.4. Still avoid hand-authoring every
  creature type as a static table row — use dynamic ids + search/infer.
- **`strategy.threaten_effects`** — likely redundant once Theft + Sacrifice are both present;
  don't split unless card-mapping later shows a gap.

---

## 5. Phased promote list

**Batch 1 — add soon:**
1. `strategy.equipment` (+ fix Equipment→Voltron debt)
2. Auras typal = Enchantress (`strategy.auras`; alias/migrate `strategy.enchantress`)
3. `strategy.vehicles` — **own row**, still artifact typal (overlap Artifacts OK)
4. `strategy.combo`
5. `strategy.lifegain` (non-typal)
6. `strategy.food`; Treasure / Clues as typal (search + infer)
7. Typal family framing; **pin** Elf / Goblin / Zombie / Dragon on shortlist
8. Remap **Copy → Spellslinger** (not Blink); Storm stays Spellslinger engine
9. Equipment typal via **type line** + payoffs (no new role tag required)
10. Redefine Artifacts / Voltron detection boundaries per §3

**Batch 2 — soon after:**
- `strategy.group_slug`, `strategy.group_hug`, `strategy.politics`
- `strategy.extra_combats` → **now an engine under `strategy.combat`**; `strategy.extra_turns` stays a candidate
- `strategy.wheel` / `strategy.discard_matters` split
- `strategy.infect`
- `strategy.ramp_matters` / `strategy.x_spells`
- Optional peel of Storm / Copy as peer rows **only if** Spellslinger umbrella proves too coarse
  in real decks (default: stay engines)

**Batch 3 — later / maybe never:**
- `strategy.devotion`; `strategy.aggro` **kept** (owner lock) but needs its own signal research pass
- `strategy.historic`, `strategy.party`, `strategy.energy`, `strategy.day_night`,
  `strategy.blood_matters`
- `strategy.exile_matters`, `strategy.food_chain`, `strategy.pillowfort`
- Engine-only leftovers under existing parents

---

## 6a. Suggested default shortlist (owner asked for a recommendation)

**Always offer (~24)** — inferred ranking still reorders; this is the preferred pool before search:

| Strategy | Why |
| --- | --- |
| Tokens | Common umbrella |
| Go Wide | The creature-token half of the umbrella |
| Sacrifice / Aristocrats | Common |
| Spellslinger | Includes storm/copy as engines |
| Reanimator / Graveyard | Common |
| Voltron | Non-typal suit-up |
| +1/+1 Counters | Common |
| Landfall | Common |
| Typal (umbrella) | Browse / type unset |
| Artifacts typal | Broad typal (parent for Vehicles) |
| Equipment typal | Owner priority; typal via type line |
| Auras typal (= Enchantress) | Replaces separate Enchantress |
| Vehicles typal | **Own row**; still an artifact |
| Food typal | Owner lock |
| Elf typal | **Pinned** creature type |
| Goblin typal | **Pinned** |
| Zombie typal | **Pinned** |
| Dragon typal | **Pinned** |
| Control / Value grind | Common |
| Blink / ETB value | Flicker/ETB only — not copy |
| Superfriends | Distinct |
| Stax | Distinct |
| Mill | Distinct |
| Lifegain | Non-typal |
| Combo / Infinite | Was hidden in Other |
| Other / Hybrid | Fallback |

**Search + infer (not default chips):** Treasure, Clues, Theft, Extra turns/combats, Infect,
Wheels, Group hug/slug, Politics, other creature types beyond the four pins.

**Note — Equipment “tag vs type line” (explained):** Project role tags are labels like
`Landfall` / `Token Maker` stored on cards. Equipment already has a **printed card type**, so
detection should key off **type line** (`Equipment`) plus equip/payoff text — not wait on a new
`Equipment` role tag. That was an implementer fork, not a product fork. Equipment matters =
**typal** either way.

**Vehicles:** own strategy row in the picker; card-mapping and Architecture should still treat
them as **artifact typal** (overlap with Artifacts is expected, like Equipment).

---

## 6. Open questions for owner

### Locked (do not re-ask)

- **Lifegain** → strategy, **not** typal.
- **Food / Treasure / Clues** → typal strategies.
- **Typal scope** → Equipment, Artifacts, Auras, creature types, token subtypes, etc.
- **Enchantress** → **is Auras typal**.
- **Storm / Copy** → **Spellslinger**, not Blink.
- **Equipment** → typal; detect via **type line** (+ payoffs); no new role tag required for Batch 1.
- **Vehicles** → **own row**, still **artifact** typal (overlaps Artifacts).
- **Pinned creature types** → Elf, Goblin, Zombie, Dragon on default shortlist (§6a).
- **Default shortlist** → §6a (~24 including pins + Vehicles).

### Still open

None that block research close-out. Implementer may add more pinned creature types later from
usage data.

---

## Summary

- **Typal family** includes Equipment, Artifacts, Auras(=Enchantress), Vehicles (own row, still
  artifacts), Food/Treasure/Clues, creature types (Elf/Goblin/Zombie/Dragon **pinned**).
- **Equipment detection:** type line + payoffs (explained in §6a) — not a product dilemma.
- **Shortlist:** §6a (~24). Research open questions cleared for owner.
