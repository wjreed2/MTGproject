# Commander plan — design notes (roles, cast turn, protection)

**Status:** Notes only — not Ready Prompts yet; do not implement from this file alone.  
**Date started:** 2026-08-03  
**Informs:** Suggested Adds/Cuts role targets & scoring; Commander Gameplan (ramp / lands / early-ramp CMC).  
**Interview rule:** When the product owner asks for questions on a topic below, ask clarifying design questions then. Do **not** interview proactively from this doc.

---

## Intent

Move the commander plan away from a **fixed set of roles and fixed on-curve assumptions** toward inputs that reflect how the player actually wants to play the deck. Those inputs drive:

1. Which roles matter and at what counts (Adds/Cuts thresholds & deficits) — including roles the deck’s plan must **feed**.
2. How much ramp and how many lands, and which CMC band of ramp counts as “early.”
3. How much / what kind of protection to recommend (new protection role framing).

---

## Theme A — Dynamic roles (replace static role set)

### Current baseline (code)

- Role vocabulary is a fixed project list (`js/project-role-tags.js` → `PROJECT_ROLE_TAGS`).
- Adds/Cuts ideal counts come from a **static threshold table** plus archetype nudges (`_computeBaseThresholds` / `_computeCutThresholds` in `js/decks.js`): e.g. Ramp 10, Card Draw 10, Removal 10, Protection 3, etc.
- Commander Gameplan Custom pills can surface deck tags, but the **scored/ideal role set** for Cuts/Adds remains the fixed threshold keys.
- Plan wizard today picks **strategy + wincon** IDs; those map to role-tag bundles via `js/archetype-role-bridge.js` — the user does **not** yet pick individual plan-fed roles.

### Direction (product)

- Roles used for plan / Adds / Cuts / Gameplan should become **dynamic** — which roles are in play is not always the same fixed set.
- **Add roles** as part of that expansion (beyond today’s threshold keys / usage), not only reweight the current static list.
- See **Theme D** for how the user declares which roles the plan feeds.

### Deferred questions

Ask only when the owner requests an interview on dynamic roles. Topics to cover later may include: which roles enter/leave the active set, how the wizard or plan declares them, interaction with Primary/Secondary/Default tags, and migration from `_computeBaseThresholds`.

---

## Theme B — Target turn to cast the commander

### Current baseline (code)

- Gameplan treats the commander cast turn largely as **on-curve mana value** (`cmdCMC`, plus extra-turn adjustments in `_cmdGameplanProbs`).
- “Early ramp” counting uses CMC relative to commander MV (e.g. ramp castable before the commander turn / `cmc < cmdCMC` paths; Prompt 10 documents ideal early-ramp as **commander CMC − 2**).
- Land / ramp suggestion density is therefore tied to that on-curve assumption, not an explicit player target turn.

### Direction (product)

- Identify **what turn the user wants to cast their commander**.
- That target turn is a **signifier** for:
  - Amount of **ramp** to aim for
  - Number of **lands**
  - What **CMC** the ramp package should sit at (what counts as early / useful before that turn)

### Deferred questions

Ask only when the owner requests an interview on commander cast turn. Topics to cover later may include: UI capture (wizard vs Gameplan), default vs override vs inferred, interaction with Prompt 10 early-ramp formula, and how Adds ramp/land deficits use the turn.

---

## Theme C — Protecting key pieces (new protection role type)

### Current baseline (code)

- A project label **Protection** already exists (`PROJECT_ROLE_TAGS`: hexproof / indestructible / phase out / “protection from…” query).
- Thresholds already include a static **Protection** ideal (base 3; higher for counters / lifegain / voltron archetypes).
- That is a coarse count of “protection-tagged” cards — it does **not** yet ask how important protection is, or what card types are being protected.

### Direction (product)

- Identify **how important it is to protect key pieces**.
- Identify **what card type(s)** those key pieces are (creature, enchantment, artifact, etc.).
- Those answers determine the **level** and **type** of protection to add.
- **Protection will be a new role type** in the dynamic-role sense (richer than today’s single flat Protection count) — even though a Protection label already exists in the tag list.
- May overlap Theme D if “key pieces” are named cards vs role buckets — **clarify with owner** (see Theme D open clarification).

### Deferred questions

Ask only when the owner requests an interview on protection. Topics to cover later may include: importance scale, multi-type key pieces, commander vs non-commander protection, mapping to tag/query subtypes (hexproof vs indestructible vs counters vs bounce-save), and whether Protection becomes a primary-tier role when importance is high.

---

## Theme D — Key cards / plan-fed roles (wizard picks what to feed)

### Direction (product)

- The user should identify **X** important things for the plan. **Open clarification (ask when owner requests interview):** is X **named key cards**, **card roles**, or **both** (e.g. pick roles first, optionally pin specific cards)?
- Whatever is chosen tells the algorithm:
  - Which **roles are important**
  - Which **roles to feed** (deficit / Adds priority / plan-match weight)
- **Wizard UX (stated example):** ask the user to pick from a **list the wizard implies from the decklist** (when a list is available) of roles that should be fed by the deck’s plan.
  - Example picks: Sac Outlet, Ramp, Ping, Drain, Tutor, Protection, etc.
  - Implication source: role tags already present / frequent on the decklist (and/or commander oracle signals), ranked so the wizard proposes likely plan-fed roles rather than a blank catalog.
  - If no decklist yet: fall back to full role catalog and/or commander-only inference (details TBD in interview).

### Current baseline (related)

- Deck cards already carry project **role tags**; Gameplan Custom pills can list tags used in the deck.
- Plan wizard infers **strategy/wincon**, then Adds uses bundled role labels from that strategy — not a user multi-select of “roles to feed.”
- Adds primary-tier roles today are hard-coded: Ramp, Card Draw, Removal (`ADDS_PRIMARY_ROLES`).

### Deferred questions

Ask only when the owner requests an interview on key cards / plan-fed roles. Must clarify cards vs roles vs both; also count of X, whether wizard-implied list is exclusive or additive to the full catalog, how “feed” maps to thresholds vs H/planMatchScore, and whether Protection here is the same Theme C protection package.

---

## Role inventory (research — for wizard pick lists)

Sources reviewed: `js/project-role-tags.js`, Adds efficiency/threshold usage (`js/adds-scoring.js`, `_computeBaseThresholds`), plan strategy/wincon bridges (`js/archetype-role-bridge.js`), engine2 role vocab (`engine2/vocab.js`), strategy enrichment otags (research-only, not project labels).

### A. Project role tags (canonical client labels — 36)

These are what the app stores on cards and what a decklist-implied wizard list can count today:

| # | Label | Source |
|--:|-------|--------|
| 1 | Ramp | otag:`ramp` |
| 2 | Card Draw | otag:`draw` |
| 3 | Removal | otag:`removal` |
| 4 | Board Wipe | otag:`board-wipe` |
| 5 | Tutor | otag:`tutor` |
| 6 | Counterspell | otag:`counterspell` |
| 7 | Protection | query (hexproof / indestructible / phase out / “protection from”) |
| 8 | Bounce | otag:`bounce` |
| 9 | Control | query (gain/exchange control) |
| 10 | Burn | otag:`burn` |
| 11 | Group Slug | otag:`group-slug` |
| 12 | Stax | otag:`tax` |
| 13 | Hatebear | otag:`hatebear` |
| 14 | Anthem | otag:`anthem` |
| 15 | Evasion | otag:`evasion` |
| 16 | Pump | query (gets +N) |
| 17 | Combat Trick | otag:`combat-trick` |
| 18 | Bite | otag:`bite` |
| 19 | Extra Combat | otag:`extra-combat` |
| 20 | Token Maker | query (create token) |
| 21 | Blink | otag:`blink` |
| 22 | Copy | otag:`copy` |
| 23 | Treasure | query (treasure token) |
| 24 | Lifegain | otag:`lifegain` |
| 25 | Discard | otag:`discard` |
| 26 | Mill | otag:`mill` |
| 27 | Wheel | otag:`wheel` |
| 28 | Landfall | otag:`landfall` |
| 29 | Recursion | otag:`recursion` |
| 30 | Reanimate | otag:`reanimate` |
| 31 | Graveyard Cast | otag:`synergy-graveyard-cast` |
| 32 | Self-Mill | otag:`self-mill` |
| 33 | Sac Outlet | otag:`sacrifice-outlet` |
| 34 | Death Trigger | otag:`death-trigger` |
| 35 | Drain | otag:`drain-life` |
| 36 | Sac Synergy | otag:`synergy-sacrifice` |

**Pseudo-role (not in `PROJECT_ROLE_TAGS`):** **Plan** — used as an Adds/Cuts threshold/count bucket for on-plan cards, not a Scryfall auto-tag.

### B. Static Cuts/Adds threshold keys (today)

Ramp, Card Draw, Removal, Board Wipe, Plan, Tutor, Counterspell, Protection, Recursion — plus archetype nudges. Dynamic roles would expand beyond this set.

### C. Adds efficiency-mode roles (L / C_eff eligible)

Ramp, Removal, Protection, Combat Trick, Pump, Counterspell, Burn, Bounce, Discard, Tutor, Bite.

### D. Plan strategy → role bundles (bridge)

| Strategy | Project roles fed by default map |
|----------|----------------------------------|
| Tokens | Token Maker, Treasure, Anthem |
| Sacrifice | Sac Outlet, Death Trigger, Sac Synergy, Drain |
| Spellslinger | Card Draw, Tutor, Counterspell, Copy, Burn |
| Reanimator | Recursion, Reanimate, Graveyard Cast, Self-Mill |
| Voltron | Pump, Evasion, Protection, Anthem |
| Counters | Pump, Anthem |
| Landfall | Landfall, Ramp |
| Tribal | Anthem, Token Maker, Evasion |
| Artifacts | Treasure, Tutor, Ramp, Recursion |
| Enchantress | Card Draw, Anthem, Protection |
| Control | Counterspell, Removal, Board Wipe, Card Draw, Bounce, Stax |
| Blink | Blink, Copy |
| Superfriends | Protection, Tutor, Card Draw |
| Theft | Control, Bounce |

### E. Plan wincon → role bundles (bridge)

| Wincon | Project roles |
|--------|---------------|
| Combat | Anthem, Pump, Evasion, Token Maker, Extra Combat |
| Commander damage | Pump, Evasion, Protection |
| Combo | Tutor, Recursion |
| Mill | Mill, Self-Mill |
| Life drain | Drain, Lifegain |
| Lock | Stax, Hatebear |
| Value | Card Draw, Removal, Recursion |

### F. Engine2 IR roles (server vocabulary — parallel namespace)

`ramp`, `mana_rock`, `mana_dork`, `land`, `card_draw`, `tutor`, `wheel`, `spot_removal`, `board_wipe`, `counterspell`, `burn`, `discard_outlet`, `mill`, `protection`, `recursion`, `reanimator`, `graveyard_hate`, `wincon`, `sac_outlet`, `token_maker`, `anthem`, `tribal_lord`, `evasion`, `stax`, `lifegain`, `blink`, `copy`, `combat_trick`, `extra_combat`, `extra_turn`, `cost_reducer`, `utility`.

Useful as **candidates to add** as project labels later (not all exist client-side today): mana rock/dork split, graveyard hate, tribal lord, extra turn, cost reducer, discard outlet vs Discard, etc.

### G. Gaps vs owner examples / common EDH roles

| Mentioned / common | Closest today | Gap note |
|--------------------|---------------|----------|
| **Ping** | Burn, Drain, Group Slug; enrichment otag `bombard` | **No project label “Ping”** yet — likely a role to **add** |
| Fog / combat fog | engine2 axis `combat.fog_like` | No project tag (Adds notes already call this out) |
| Silence / taxing cast | Stax / Hatebear | No dedicated Silence tag |
| Extra turn | engine2 `extra_turn` | No project tag |
| Mana rock / dork / ritual | folded into Ramp | engine2 splits them |
| Free sac outlet | Sac Outlet (+ enrichment `free-sacrifice-outlet`) | No separate project label |
| Graveyard hate | engine2 `graveyard_hate` | No project tag |
| Tribal lord | engine2 `tribal_lord` | Often Anthem / tribal payoffs today |
| Cost reducer | engine2 `cost_reducer` | No project tag |
| Equipment / Aura synergy | strategy enrichment otags | Not first-class project roles |
| Cantrip | enrichment only | Usually Card Draw |

---

## Downstream surfaces (when prompts are drafted)

| Surface | Likely impact |
|---------|----------------|
| **Plan wizard** | New step: pick X plan-fed roles (and/or key cards) from decklist-implied list |
| **Suggested Adds** | Dynamic role deficits from fed roles; ramp/land from cast turn; protection typed to key pieces |
| **Suggested Cuts** | Thresholds / surplus roles become plan-dynamic |
| **Commander Gameplan** | Cast-turn input; early-ramp CMC band; land/ramp meta; protection / fed-role custom requirements |

Do not draft Ready Prompt bodies until interviews for the relevant theme are done (or the owner explicitly says to draft from notes alone).

---

## Session log

| Date | Note |
|------|------|
| 2026-08-03 | Initial notes: dynamic roles, cast turn, protection. Questions deferred. |
| 2026-08-03 | Theme D: user picks X key cards **or** roles (clarify later). Wizard implies plan-fed roles from decklist. Full role inventory researched across project tags, thresholds, plan bridges, engine2. |
