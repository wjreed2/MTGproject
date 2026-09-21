# Gap audit — engine2 data, the Batch-1 rows, and the strategies still missing

**Status:** Research **Completed** (2026-09-18). App-side fixes **IMPLEMENTED 2026-09-20** —
see §9. `engine2/`, CardIR and the semantics data are untouched and still need partner
sign-off for anything in §2.
**Author:** auditing agent, 2026-09-18.
**Answers:** the owner's three questions — (1) what else is missing in the `engine2/`
data beyond Combat, (2) do the recently-added strategies/themes have gaps of their own,
(3) what strategies and themes are still missing entirely.

> ⚠️ **Everything in §2 is PROPOSAL ONLY and blocked on partner approval.** Nothing in
> `engine2/` or the semantics data may change without it. §1, §3, §4 and §5 are outside
> `engine2/` and can move independently.

> 🕐 **Snapshot warning.** `js/deck-themes.js` was being edited *while this audit ran*
> (writes at 11:56 and 12:19 on 2026-09-18). The theme catalog grew 29 → 37 rows mid-audit
> with a new parent/child token family (`strategy.tokens.go_wide`, `.blood`, `.powerstone`,
> `.incubate`, `.map`, `.junk`, `.role`, `.gold`). **Every number below was re-measured
> against the 12:19 state.** Findings about that in-flight token family are marked
> 🚧 and are reported as *watch items*, not as defects — that work is clearly unfinished.

---

## 0. Method

**Corpora**

| # | Corpus | Size | Used for |
| --- | --- | --- | --- |
| 1 | `scryfall_oracle_cards` where `legal_commander = 1` | **31,830 cards** | pool coverage / precision of every pattern |
| 2 | `scryfall_oracle_tags` | **25,664** of those carry project role tags | tag-layer recall |
| 3 | `engine2/fixtures/decks` | 12 EDHREC **average** decks | regression check with known `archetype_expected` |
| 4 | Archidekt `SalubriousSnail` | **42 individual decks**, same corpus as [strategy-combat-research.md](strategy-combat-research.md) §1 | false-positive rate, archetype demand |

**Caveats, stated up front**

- Corpus 3 is **averaged** decks. Averaging compresses variance (combat doc §5.4) — it is a
  regression check, not a measurement of real builds.
- Corpus 4 is **one builder**. Good discrimination test, poor popularity estimate. An
  archetype scoring 0 there is not proven rare format-wide.
- `card_semantics` is **empty locally (0 rows)**, so nothing downstream of CardIR extraction
  was executed end-to-end. Every engine2 claim below is from static analysis of the code and
  vocabulary, not from a live semantics run.
- Popularity judgements in §5 are **my read of the Commander metagame**, not a measurement.
  They are labelled as such.

**Reproduction** — probe scripts are throwaway; each finding states the exact query or the
file:line so it can be re-derived in one command. Pool probes are regexes over
`oracle_text + faces[].oracle_text`, lowercased, on the 31,830-card pool.

---

## 1. Headline findings, ranked by consequence

| # | Finding | Evidence | Where |
| --- | --- | --- | --- |
| **1** | **The engine2 goal key and the client's goal maps have drifted apart.** 8 of 22 goal templates resolve to a strategy id **that does not exist**, and 6 of 22 get **zero project role tags**, which makes their Architecture subsection permanently unfillable. One of the six is `tokens-wide` — the most common archetype in the format | §1.1 | `js/deck-architecture.js:871`, `:693` |
| **2** | **The four pinned typal rows duplicate the dynamic tribe rows.** A Goblin deck shows **two rows both labelled "Goblin typal"**, counts 35 and 31, both "Very focused" | §3.1 | `js/deck-themes.js` THEME_CATALOG vs `detectTribes` |
| **3** | **Voltron is a Decent-or-better read in 21 of 42 real decks.** It is driven almost entirely by the `Evasion` tag (5,079 cards, 16% of the pool) | §4.1 | combat doc debt #2, now quantified |
| **4** | **Spellslinger's instant/sorcery fallback fires on any blue-ish deck.** "Turbostax" — a stax deck — reads Spellslinger **51, Very focused**, 44 of those from the type-line fallback alone | §4.2 | `js/deck-themes.js cardSupportsTheme` |
| **5** | **Five rows earn a band from the format, not from the deck.** A uniformly random 99-card sample already scores Voltron 17.7, Combat 16.1, Tokens 12.1, Sacrifice 10.2, Counters 10.1 — all "Decent" | §4.3 | band ladder vs pool% |
| **6** | **9 vocabulary axes have no consumer anywhere** — not a template, not a combo rule, not `IR_AXIS_THEME`, not `explain.js`, not the recommender. 20 have no goal-template home; 48 of 121 are invisible to the client theme panel | §2.1 | `engine2/vocab.js` |
| **7** | **Superfriends can see the planeswalkers and nothing else.** 303 of 303 hits come from the type line; its 146-card payoff package (proliferate, Doubling Season, Oath of Teferi, walker protection) scores **0** | §3.5 | `THEME_ORACLE` has no `strategy.superfriends` key |
| **8** | **Nine strategy rows have no engine2 goal template; seven templates have no strategy row.** The mismatch is bidirectional and neither side knows about the other | §2.3 | — |
| **9** | **A handful of detection regexes match zero cards** because Oracle templating moved on — `unblockable` (0), `commander damage` (0), `flicker` (0), `reanimate` (0), `enters the battlefield` (1) | §4.5 | §4.5 table |
| **10** | **Poison is absent from every user-facing layer** while present in the semantic one: `counters.poison` axis ✅, `WINCON_KINDS: 'poison'` ✅, but no strategy row, no goal template, no wincon row, no project tag, no theme | §5.4 | — |

---

## 2. engine2 data gaps beyond Combat — ⚠️ PROPOSAL ONLY

### 2.1 Axis coverage — the three rings

121 axes in `engine2/vocab.js`. Measured by a programmatic diff against every consumer
(`goal-templates.js`, `combo-rules.js`, `IR_AXIS_THEME`, `explain.js` `AXIS_LABELS`,
`recommender.js`, `deck-goals.js`, `prompt.js`):

| Consumer | Axes it reads | of 121 |
| --- | ---: | ---: |
| goal templates | 98 | 81% |
| `IR_AXIS_THEME` (client theme panel) | 73 | 60% |
| `explain.js` `AXIS_LABELS` | 40 | 33% |
| `commander-plan-ext.js` `AXIS_TO_PROJECT` | 27 | 22% |
| `recommender.js` (by name) | 19 | 16% |
| `combo-rules.js` | 14 | 12% |

**Ring 1 — 9 axes with no consumer at all.** Extraction may emit them; nothing reads them.

> **Correction, 2026-09-21.** The second column originally read "Named in the extraction
> prompt?" and was measured by grepping `engine2/prompt.js` source. That was the wrong
> test. `buildSystemPrompt()` injects **all 121 axes with their descriptions** at runtime
> (`prompt.js:39`), so every axis IS taught to the extractor — a render of the prompt
> contains 121 of 121. What the grep actually found was the 21 axes that additionally
> carry a *hand-written rule* in the prompt body. The column has been relabelled.
> Nothing else in this section depends on it: "no consumer" is still true, and it is
> about readers, not about extraction.

| Axis | Has a bespoke prompt rule? | Comment |
| --- | --- | --- |
| `mana.untap_lands` | no | combo glue (Dramatic Reversal shells) — `combo-rules` uses `untap.permanent` instead |
| `mana.color_fix` | no | arguably belongs to Foundation, not Strategy — but then it should not be an axis |
| `card_advantage.loot` | no | looting is a real reanimator/discard enabler; `discard.outlet` absorbs part of it |
| `card_advantage.draw_payoff` | no | the vocab even documents it as "(needs draw providers)" |
| `trigger.self_death_value` | no | aristocrats fodder identity |
| `topdeck.matters` | no | miracles / cascade payoffs |
| `group.hug` | no | **and** no strategy row and no theme — see §5.2 |
| `flash.enabler` | no | flash decks are a real archetype |
| `tutor.to_battlefield` | **yes** | the prompt teaches it explicitly (the Crop Rotation rule), so cards *do* get tagged with it, and then nothing ever reads it |

`tutor.to_battlefield` is the sharpest of these: extraction spends prompt budget teaching a
distinction that has no downstream reader.

**Ring 2 — 20 axes with no goal-template home** (after crediting combo rules). The nine above,
plus: `token.clue`, `token.blood`, `token.map`, `counters.poison`, `draw.group`,
`tribal.lord`, `tribal.synergy`, `tribal.body`, `hate.tokens`, `hate.counters`,
`haste.enabler`.

The three `tribal.*` axes are the notable ones: tribal goals are generated dynamically from
subtype counts in `deck-goals.js:272`, so they bypass the template table by design — **but
they also bypass its `min` calibration**, which is why a tribal read is a body count and never
a payoff count. See §5.3.

`haste.enabler` was already logged as an orphan in combat doc §8 debt #4. It is still orphaned.

**Ring 3 — 48 of 121 axes are unmapped by `IR_AXIS_THEME`**, i.e. invisible to the client's
theme panel even when semantics are present. The largest unmapped families are mana
(`mana.ramp_land`, `mana.rock`, `mana.dork`, `mana.ritual`, `mana.doubler`,
`mana.big_mana_payoff`), tutors (all 7), card advantage (all 6), and protection/removal.

Some of that is correct — Foundation functions should not read as Strategy themes. But
`mana.big_mana_payoff`, `card_advantage.impulse`, `card_advantage.wheel`, `extra_turns`,
`group.slug`, `combat.goad` and `monarch.initiative` are *archetype* signals with a goal
template behind them and no theme row to land in (§2.3).

### 2.2 One dead `IR_AXIS_THEME` row, one now-fixed family

- `{ re: /^equipment\./, id: 'strategy.equipment' }` matches **zero** axes — there is no
  `equipment.*` axis. Equipment's IR signal rides `voltron.aura_equipment` param
  `equipment`, and `_irThemes` (`js/deck-themes.js`) tests the axis string only, never the
  param. **This is combat doc §8 debt #1, still live.** Equipment and Vehicles remain the
  only two shortlist rows with no IR path at all.
- 🚧 The token-subtype rows (`token.food` → Food, `token.clue` → Clues, `token.treasure` →
  Treasure, `token.blood` → Blood) **gained their IR mappings during this audit** — they were
  missing at 11:40 and present at 12:19. Good fix; noting it so it is not re-reported.

### 2.3 Templates and rows do not line up, in both directions

**Nine strategy rows have no engine2 goal template:**
`strategy.combat` (proposed, blocked), `strategy.equipment`, `strategy.vehicles`,
`strategy.food`, `strategy.treasure`, `strategy.clues`, `strategy.superfriends`,
`strategy.theft`, `strategy.goodstuff` (n/a by design).

Consequence, from `engine2/recommender.js`: `planAxes` and `wantedAxes` are built from the
**top goal's template axes**. A deck with no template for its real plan gets no plan axes, so
Adds shops for the wrong things and Cuts sees its on-plan cards as unconnected. This is the
same Gap-4 argument the combat doc made, generalised — Equipment, Vehicles and Superfriends
decks are in exactly the position combat decks are.

**Seven goal templates have no strategy row:**
`impulse`, `stompy`, `goad`, `big-mana`, `wheels`, `graveyard`, `group-slug`.

engine2 can conclude "this deck is Big mana" and the user has no way to declare it, no theme
row to see it in, and — because of §1.1 — the Architecture view resolves it to a strategy id
that does not exist.

### 2.4 The goal-key contract break (this is the consequential one)

`engine2/deck-goals.js:255` emits `goal: tpl.key` verbatim — `tokens-wide`, `group-slug`,
`big-mana`. The client maps that key through two tables. Measured:

| engine2 goal key | `GOAL_ROLE_TAGS[key]` | resolved `strategyId` | valid id? |
| --- | --- | --- | --- |
| `aristocrats` | 8 tags | `strategy.sacrifice` | ✅ |
| **`tokens-wide`** | **MISSING → `[]`** | **`strategy.tokens-wide`** | ❌ |
| `spellslinger` | 4 tags | `strategy.spellslinger` | ✅ |
| **`impulse`** | **MISSING → `[]`** | **`strategy.impulse`** | ❌ |
| `reanimator` | 5 tags | `strategy.reanimator` | ✅ |
| `blink` | 3 | `strategy.blink` | ✅ |
| `lifegain` | 2 | `strategy.lifegain` | ✅ |
| **`stompy`** | 6 tags | **`strategy.stompy`** | ❌ |
| `counters` | 4 | `strategy.counters` | ✅ |
| `landfall` | 2 | `strategy.landfall` | ✅ |
| `enchantress` | 2 | `strategy.auras` | ✅ |
| `artifacts` | 3 | `strategy.artifacts` | ✅ |
| `control` | 5 | `strategy.control` | ✅ |
| `stax` | 3 (one of them dead — see below) | `strategy.stax` | ✅ |
| **`goad`** | **MISSING → `[]`** | **`strategy.goad`** | ❌ |
| **`mill`** | **MISSING → `[]`** | `strategy.mill` | ✅ (by luck — the fallback string happens to be a real id) |
| `voltron` | 4 | `strategy.voltron` | ✅ |
| **`big-mana`** | **MISSING → `[]`** | **`strategy.big-mana`** | ❌ |
| **`wheels`** | 3 tags | **`strategy.wheels`** | ❌ |
| **`graveyard`** | 5 tags | **`strategy.graveyard`** | ❌ |
| **`group-slug`** | **MISSING → `[]`** | **`strategy.group-slug`** | ❌ |
| `combo` | 3 | `strategy.combo` | ✅ |

**Two independent failures:**

1. **Zero role tags → an unfillable pile.** `_cardStrategySubs` (`js/deck-architecture.js`)
   decides membership with `sub.projectTags.some(t => tagSet.has(t))`. With `projectTags: []`
   **no card can ever join**. And because the near-duplicate drop rule is guarded by
   `if (tags.length && …)`, an empty-tag goal is never deduped away either — it survives as a
   permanently empty subsection. Six goals are in this state, including `tokens-wide`.
2. **Invalid strategy id.** `GOAL_KEY_STRATEGY[base] || ('strategy.' + base)` invents
   `strategy.tokens-wide`, `strategy.stompy`, `strategy.graveyard`, … Nothing that joins back
   to `PLAN_STRATEGIES` will match: `strategyLabel()` falls through to printing the raw id,
   `PLAN_THEME_SUBTAG_DEFAULTS` misses, `STRATEGY_PROJECT_TAGS` misses, the shortlist misses.
   The subsection *heading* still looks right because `_identityLabel` prefers the goal's own
   `label` — which is why this has stayed invisible.

**The stale half of the same tables.** `GOAL_ROLE_TAGS` and `GOAL_KEY_STRATEGY` also carry
keys that no template defines: `tokens`, `auras`, `equipment`, `vehicles`, `food`, `pump`,
`group_slug` (underscore, vs the template's hyphen). They read as an older or aspirational
key vocabulary that was never reconciled. Confirmed by grep: **no file under `js/` mentions
`tokens-wide`, `group-slug` or `big-mana` at all.**

Two more dead references in the same family:

- `GOAL_ROLE_TAGS.stax` lists `'Tax'`, which is **not** a project role-tag label (the label is
  `'Stax'`; `'tax'` is the Scryfall otag). It matches nothing.
- `COMBAT_GOALS` (`js/deck-architecture.js`) lists `'tokens'` and `'equipment'` — neither is a
  template key — so `_goalImpliesCommanderWincon` never fires for a token-swarm deck.

**None of this needs partner approval.** The fix is entirely client-side: correct the keys, or
normalise engine2's key once at the boundary. `engine2/` does not have to change.

### 2.5 Combo detection rests on six signatures

`engine2/combo-rules.js` has 6 rules, and the `combo` template is `usesCombos: true,
minCombos: 1` — so combo detection *is* those six:

| key | signature |
| --- | --- |
| `thoracle_empty_library` | `wincon.alt[empty_library]` + `self_exile_library` |
| `copy_untap_loop` | `token.copy` + `untap.permanent` |
| `aristocrats_engine` | `sac.outlet_free` + `loop.death_recursion` + `drain.incremental` |
| `infinite_mana_sink` | `mana.doubler` + `infinite.mana_sink` |
| `extra_turn_recursion` | `extra_turns` + `gy.recursion` + `gy.self_fill` |
| `wheel_lock` | `card_advantage.wheel` + `hate.draw` |

Missing families that a Commander player would name first: **infinite mana from an untapper
plus a rock** (Basalt Monolith + Rings, Isochron + Dramatic Reversal — `mana.untap_lands` and
`untap.permanent` both exist and `mana.untap_lands` has no consumer at all), **Kiki/Twin**
(`token.copy` + `haste.enabler` — both exist, `haste.enabler` orphaned), **infinite blink**
(`blink.engine` + `etb_value` + a sac outlet), **persist/undying + free sac**, and
**mill-out loops** (`mill.opponent` + `untap.permanent`).

Three of those five are assemblable **from axes that already exist and currently have no
reader** — which is a cheap, additive win if the partner approves touching `combo-rules.js`
(a rules file, not the semantics vocabulary; no re-extraction needed).

### 2.6 `WINCON_KINDS` and `PLAN_WINCONS` do not agree

| `engine2` `WINCON_KINDS` | matching `PLAN_WINCONS` row |
| --- | --- |
| `combat` | `wincon.combat` ✅ |
| `drain` | `wincon.life_drain` ✅ |
| `mill_out` | `wincon.mill` ✅ |
| `combo_piece` | `wincon.combo` ✅ |
| **`poison`** | **none** |
| **`burn`** | **none** |
| **`alt_win`** | **none** (folds into `wincon.combo` or `wincon.other`) |
| — | `wincon.commander_damage` (no IR kind) |
| — | `wincon.lock` (no IR kind) |
| — | `wincon.value` (no IR kind) |

Pool sizes: `"you win the game"` **37 cards** (Thassa's Oracle, Approach of the Second Sun,
Mechanized Production, Hellkite Tyrant), `"loses the game"` **40**, poison/infect/toxic
**163**, burn-to-face **834**.

Also note `WINCON_CLOSER_TAGS` covers only 4 of the 8 plan wincons — deliberate and documented
in the source, so not a defect.

### 2.7 The IR-role → project-label bridge is clean but thin

`js/commander-plan-ext.js` maps 25 of 32 engine2 `ROLES` and **27 of 121 axes** to project
labels. No bad keys, no bad labels — it is correct, just small. Easy additions with no engine2
change: `mill.opponent`→`Mill`, `gy.reanimate`→`Reanimate`, `gy.self_fill`→`Self-Mill`,
`card_advantage.wheel`→`Wheel`, `control.tax`→`Stax`, `theft.control`→`Control`,
`token.treasure`→`Treasure`, `combat.extra`→`Extra Combat`.
Unmapped roles: `land`, `graveyard_hate`, `wincon`, `tribal_lord`, `extra_turn`,
`cost_reducer`, `utility`.

---

## 3. Gaps in the recently-added rows

### 3.1 The pinned typal rows duplicate the dynamic tribe rows — user-visible

`analyzeDeckThemes` adds `THEME_CATALOG` rows first, then adds `detectTribes` hits unless
`detected.some(t => t.id === hit.id)`. The ids differ (`strategy.typal.goblin` vs
`tribal:Goblin`) so **both survive** — and `themeLabel('tribal:Goblin')` renders
`"Goblin typal"`, the same string as the catalog row's label.

Measured on the fixtures:

| deck | row 1 | row 2 |
| --- | --- | --- |
| `krenko-goblins` | `strategy.typal.goblin` "Goblin typal" **35** Very focused | `tribal:Goblin` "Goblin typal" **31** Very focused |
| `ur-dragon-dragons` | `strategy.typal.dragon` "Dragon typal" **33** Very focused | `tribal:Dragon` "Dragon typal" **27** Focused |
| `chulane-blink` | `strategy.typal.elf` "Elf typal" **12** Decent | `tribal:Elf` "Elf typal" **12** Decent |

The counts differ because the pinned row counts creature subtypes **plus** its oracle patterns
(`/goblins you control/`, `/goblin creatures?/`) while the dynamic row counts subtypes only.

This is the strongest argument **against** pinning more creature types — every new pin adds a
duplicate. Resolution options, in my order of preference:

1. Alias `strategy.typal.<x>` ↔ `tribal:<X>` in `canonicalizeThemeId` and dedupe in
   `analyzeDeckThemes`, keeping the pinned row's richer count.
2. Keep the pins as *picker* entries only (`PLAN_STRATEGIES`) and drop them from
   `THEME_CATALOG`, letting `detectTribes` own the panel.

### 3.2 A label inconsistency the Typal rename missed

`engine2/deck-goals.js:272` labels dynamic tribal goals `` `${hit.type} tribal` `` while
`js/deck-themes.js themeLabel` renders `` `${tribe} typal` ``. Same concept, two words, both
user-visible depending on which path produced the row.

### 3.3 Food and Clues have no bridge tags at all

`STRATEGY_PROJECT_TAGS['strategy.food'] = []` and `['strategy.clues'] = []`. Every other
shortlist row has at least one. Adds/plan-match scoring is tag-driven, so declaring Food or
Clues as your strategy contributes nothing to what Adds suggests. `strategy.goodstuff` and
`strategy.other` are also empty, which is defensible; Food and Clues are not — they are
shortlist rows a user can pick as a primary strategy.

There is no `Food` or `Clue` project role tag to point them at, so this needs either two new
role tags (`otag:food`, `otag:clue` — verify slugs first, per the trap documented in
`js/project-role-tags.js`) or a type-line/oracle-driven exception like Equipment's.

### 3.4 `strategy.tribal` — the Typal umbrella — detects nothing

`cardSupportsTheme(card, 'strategy.tribal')` returns false for **every card in the pool**
(0 of 31,830): no `THEME_TAGS`, no `THEME_ORACLE` entry, and `/^tribal\./` IR only fires when
semantics are present. A user who picks "Typal" without a type pick sees a 0-count row.
The fallback works (`detectTribes` surfaces the actual tribe) but the declared row reads as
unsupported, which is the opposite of the truth.

### 3.5 Superfriends sees the walkers and nothing else

| layer | state |
| --- | --- |
| `THEME_TAGS` | `[]` — there is no planeswalker project role tag |
| `THEME_ORACLE` | **no entry at all** |
| `IR_AXIS_THEME` | no row — and **no planeswalker axis exists in vocab** |
| goal template | none |
| type-line rule | `if (tid === 'strategy.superfriends' && tl.includes('planeswalker')) return true;` |

Measured recall: **303 cards, 303 of them from the type line**. The payoff package —
`"planeswalkers you control"` / `"loyalty counters"` — is **146 cards** (Doubling Season,
Oath of Teferi, The Chain Veil, Deepglow Skate, Sphere of Safety, walker tutors and
protection) and scores **zero**. A Superfriends deck running 8 walkers and 20 support cards
reads "Light (8)".

This is the largest single recall gap in the catalog, and the cheapest to close — an oracle
pattern set costs nothing and needs no engine2 change.

### 3.6 Combo's theme patterns are close to dead

| pattern | cards |
| --- | ---: |
| `/\binfinite\b/i` | **3** |
| `/\bcombo\b/i` | **0** |
| `/\ba copy of (it\|that spell\|this spell)\b/i` | 78 |
| `/\buntap (all\|each\|target).{0,40}(permanent\|creature\|land)/i` | 257 |

"Infinite" and "combo" are player vocabulary, not Oracle vocabulary. Two of the four patterns
contribute essentially nothing, and the row's whole 330-card recall comes from the other two.
The `PLAN_STRATEGY_ORACLE_RULES` version is worse: `/\binfinite\b/` (3) + `/\bwin the game\b/`
+ `/\byou win\b/` = 124 cards total, i.e. the strategy ranker reads "combo" as "alternate
wincon", which is a different thing.

### 3.7 A typo that kills a rule

```js
{ id: 'strategy.counters', patterns: [/\+\+1\/\+1 counter/i, /\bproliferate\b/i] },
```
`js/deck-plan.js` — `\+\+1` requires the literal text `++1/+1 counter`. **0 matches.** The
Counters row's plan-ranking signal is `proliferate` alone (95 cards) instead of the 3,000+ the
theme panel sees. Almost certainly meant to be `/\+1\/\+1 counter/i`.

### 3.8 Combat — what I could and could not confirm

- ✅ The two role tags **are ingested locally**: `Attack Trigger` 2,025 cards, `Saboteur` 928 —
  matching the numbers the combat doc verified against Scryfall. The prod rebuild
  (`POST /api/admin/scryfall/rebuild-tags`) is still listed as outstanding in that doc; I
  cannot check prod from here.
- ✅ **The duplicate-definition risk has not materialised.** I ran the theme panel and
  `combatPillars` side by side on all 42 corpus decks: **0 decks** where the panel shows
  Combat at Decent+ and the two-pillar gate rejects it. The documented negative controls
  behave — Radha's Explosive Vegetables 9 (core 7 / support 2, fail), Biblically Accurate
  Beatdown 9 (6/1, fail), Turbostax no combat at all.
- ⚠️ `strategy.combat` is the **#1 read in 11 of 42 decks** and ≥Decent in 17. For a
  single-builder corpus that skews attack-centred that is plausible, but it is the loudest new
  row by a wide margin and worth re-checking on a second corpus before more support patterns
  are added to it.
- ⚠️ `strategy.combat` has **no `PLAN_TYPE_DIMENSIONS` entry**, so the four engines
  (`combat.attacks_matter` / `saboteur` / `enablers` / `finishers`) are not selectable the way
  Voltron's equipment-vs-aura split is. Intentional or not, it is asymmetric with Voltron.

### 3.9 🚧 Watch items in the in-flight token family

Reported as watch items only — this work was visibly in progress during the audit. Re-checked
at 14:44; the last write was `js/deck-plan.js` at 12:20:56 and the tree has been quiet since.

- **Closed between 12:19 and 12:21:** the 8 rows are now in `PLAN_STRATEGIES` (30 → 38 rows,
  shortlist 26 → 27) and all 8 have `PLAN_STRATEGY_ORACLE_RULES` entries. Food/Treasure/Clues/
  Blood gained their `IR_AXIS_THEME` mappings.
- **Still open at 14:44:** none of the 8 has `THEME_TAGS`, `PLAN_THEME_SUBTAG_DEFAULTS` rows,
  or `STRATEGY_PROJECT_TAGS` bridge entries; `.powerstone / .incubate / .map / .junk / .role /
  .gold` have no IR mapping; 5 of them appear in neither `CLASH_PAIRS` nor `JIVE_PAIRS`; 7 of
  the 8 are off the shortlist (`strategy.food` and `strategy.treasure` excepted).
- `strategy.tokens.go_wide` overlaps `strategy.tokens` on the same IR axes
  (`token.creature`, `token.creature_wide`) and measures **8.42% of the pool** — E[hits] on a
  random 99-card deck is 8.3, i.e. "Light" for free. It was the #1 read on one corpus deck.
  Same duplicate-row shape as §3.1, one level up.
- `parent:` is a new field in `THEME_CATALOG`; nothing outside the catalog reads it yet.

---

## 4. Precision problems the new rows inherit

### 4.1 Voltron — 21 of 42 decks read Decent or better

`THEME_TAGS['strategy.voltron'] = ['Evasion']`, and the `Evasion` tag covers **5,079 cards,
16% of the pool**. Measured contribution on the loudest decks:

| deck | Voltron count | from `Evasion` tag | from oracle |
| --- | ---: | ---: | ---: |
| On the Prowl | 26 | 26 | 0 |
| Dumb, Hyper-budget Winota Pile | 23 | 17 | 6 |
| Sharuum slide | 19 | 18 | 4 |
| Hate Beats — Breena | 19 | 16 | 3 |
| Corsairs of Chronology | 17 | 17 | 0 |

None of the five is a Voltron deck. This is combat doc §8 debt #2 — *"once combat exists, most
of that signal belongs to it"* — with the number attached: **50% false-positive rate at
Decent+**. Now that `strategy.combat` exists and owns attack-step signals, dropping `Evasion`
from Voltron's tag list is the single highest-value precision fix available, and it touches
one line.

Voltron's oracle patterns are also half-dead (§4.5): of its four, `commander damage` and
`unblockable` match **0 cards each**.

### 4.2 Spellslinger's type-line fallback

`cardSupportsTheme` counts **every instant and sorcery** once the deck clears
`spellslingerMinPayoffs: 2` and `spellslingerMinVolume: 6` (MV≤2 instants/sorceries) — bars
that most blue or red decks clear incidentally.

| deck | Spellslinger | by tag | by oracle | **by type-line fallback** |
| --- | ---: | ---: | ---: | ---: |
| "Turbostax" (a **stax** deck) | 51 | 5 | 2 | **44** |
| Buffs by Hans (a **combat** deck) | 44 | 2 | 2 | **41** |
| Turtle Gates | 34 | 2 | 1 | **31** |
| Biggo X-cost Goofballs | 32 | 2 | 3 | **27** |
| Diving for Spells (genuinely spellslinger) | 53 | 2 | 10 | 41 |

Spellslinger is the #1 read in 6 of 42 decks and, by my reading of the decklists, wrong in at
least 4 of those. The bar needs raising — candidates: require payoffs ≥ 4, require the volume
count to exclude generically-good removal, or cap the fallback's contribution.

It also produced a false positive on an *average* deck: `ur-dragon-dragons` reads
`spellslinger:18` — **Focused** — on a Dragon typal list.

### 4.3 Bands that measure the format

Expected hits in a uniformly random 99-card sample of the commander-legal pool, against the
band ladder (`trace ≥1, light ≥5, decent ≥10, focused ≥18, very_focused ≥30`):

| row | pool% | E[hits] / 99 | band a random deck already earns |
| --- | ---: | ---: | --- |
| `strategy.voltron` | 17.86% | **17.7** | Decent (one card short of Focused) |
| `strategy.combat` | 16.25% | **16.1** | Decent |
| `strategy.tokens` | 12.22% | **12.1** | Decent |
| `strategy.sacrifice` | 10.30% | **10.2** | Decent |
| `strategy.counters` | 10.17% | **10.1** | Decent |
| `strategy.reanimator` | 9.91% | 9.8 | Light |
| `strategy.tokens.go_wide` 🚧 | 8.42% | 8.3 | Light |
| `strategy.lifegain` | 7.84% | 7.8 | Light |

Seven rows clear `minListCount: 5` — the "show it in the list" floor — on a random pile of
cards. A real deck is not a random sample (colour identity and playability both bite), so this
is an upper bound on the noise floor, not a prediction. But it is the right diagnostic: **a
row whose pool share times 99 already lands in a band cannot distinguish decks with that
band.** Either the pattern set narrows, or the band thresholds become per-row.

The five Decent-at-random rows are exactly the five that show up as spurious top-3 reads in
§3.1 and §4.1.

### 4.4 Mill still conflates self-mill with opponent-mill

`THEME_TAGS['strategy.mill'] = ['Mill']` (1,191 cards) and `THEME_ORACLE` is the single pattern
`/\bmill(s|ed|ing)?\b/i`. Measured: `muldrotha-graveyard` reads **`mill:20` as its #2 row** —
a self-mill graveyard deck presenting as a mill deck.

The catalog research §3 explicitly decided *not* to change this, on the grounds that
`Self-Mill` feeds Reanimator rather than Mill in `STRATEGY_PROJECT_TAGS`. That is true of the
**bridge** — but `THEME_TAGS['strategy.mill']` uses the plain `Mill` tag, and 976 cards carry
`Self-Mill`, most of them also carrying `Mill`. The documented intent is not what the theme
panel does. Either exclude cards whose only mill text is self-directed, or state the row as
"Mill (self or opponent)".

### 4.5 Patterns that match zero or near-zero cards

Oracle templating moved on (notably the 2024 "enters" rewording) and several patterns did not.
All counts against the 31,830-card pool:

| pattern | where | cards |
| --- | --- | ---: |
| `/\bunblockable\b/i` | `THEME_ORACLE.voltron`, `cardSupportsTheme` voltron rule, `PLAN_…voltron` | **0** |
| `/\bcommander damage\b/i` | `THEME_ORACLE.voltron`, `PLAN_…voltron`, `PLAN_WINCON…commander_damage` | **0** |
| `/\bflicker\b/i` | `THEME_ORACLE.blink`, `PLAN_…blink` | **0** |
| `/\breanimate\b/i` | `PLAN_…reanimator` | **0** |
| `/\benters the battlefield\b/i` | `PLAN_…blink` | **1** |
| `/\bwhenever .{0,40}becomes? equipped\b/i` | `THEME_ORACLE.equipment` | **0** |
| `/\bskip .{0,20}phase\b/i` | `PLAN_…stax`, `PLAN_WINCON…lock` | **0** |
| `/\btax\b/i` | `PLAN_…stax` | **1** |
| `/\btribal\b/i`, `/\btypal\b/i` | `PLAN_…tribal` | **1**, **0** |
| `/\btutor\b/i`, `/\bremoval\b/i` | `PLAN_…goodstuff` | **0**, **0** |
| `/\bsteal\b/i` | `PLAN_…theft` | **3** |
| `/\+\+1\/\+1 counter/i` | `PLAN_…counters` (typo, §3.7) | **0** |
| `/\badds? twice that much\b/` family | probe for mana doubling | **1** |

Replacements are mostly obvious: `unblockable` → `can't be blocked` (1,230),
`enters the battlefield` → `enters` (7,312), `flicker` → the exile-and-return phrasing (182),
`commander damage` → drop it (the concept has no Oracle phrasing; commander-damage identity has
to come from the type line and the format rules, not card text).

`PLAN_STRATEGY_ORACLE_RULES` also has the opposite problem on four rows — Spellslinger 21.7%,
Sacrifice 17.0%, Reanimator 13.5%, Control 12.1% of the whole pool, because they match bare
words like `/\bcast\b/`, `/\bdies\b/`, `/\bgraveyard\b/`, `/\bdraw (a|two|three) cards?\b/`.

---

## 5. Strategies and themes still missing

Sizing reference from decisions already taken: `strategy.extra_combats` was **rejected** as a
peer row at 44 cards; `strategy.clues` was **accepted** at ~146; `strategy.landfall` lives at
~203; `strategy.blink` at ~235. So ~150 identity cards is the working bar for a row.

### 5.1 Promote — engine2 already has the template, the catalog has no row

These are the cheapest wins in the whole audit: engine2 can already *conclude* them, and §2.4
means each one currently resolves to a broken strategy id.

| Proposed row | engine2 template | Pool evidence | Corpus evidence (42 decks) |
| --- | --- | --- | --- |
| **Big creatures / Stompy** | `stompy` ✅ | — | **6 decks** with ≥8 power-5+ creatures; Radha's Explosive Vegetables **19**, $20 Meat Avalanche **16** |
| **Big mana / X spells** | `big-mana` ✅ | `"where X is"` **1,125 cards (3.5%)** | Skanos's Math Class **14**, Grindy voltron token pile **10** |
| **Graveyard value** | `graveyard` ✅ | `"from your graveyard"` — distinct from Reanimator's big-reanimate payoff | **8 decks** ≥8; Rona go zoom **12** |
| **Group slug** | `group-slug` ✅ | symmetrical damage / each-opponent-loses-life **445 (1.4%)**; `Group Slug` role tag exists at **805 cards** | Malfegor's Mudpit Melee 6, hehe damage funny 6 |
| **Impulse / exile value** | `impulse` ✅ | impulse draw **147**, foretell/plot/suspend/cast-from-exile **386** | hehe damage funny **8** |
| **Wheels** | `wheels` ✅ | `Wheel` role tag **134 cards**; wheel phrasing 32 | thin in this corpus (max 2) |
| **Politics / Monarch / Goad** | `goad` ✅ (partial — owner lock #4 already assigned goad-as-politics here) | union of monarch (60) + initiative (64) + vote (34) + goad (81) + tempting offer (21) = **217 (0.68%)** | **Dungeon Dog and his Wacky Experiments: 18** — a clean positive control |

My recommendation: **all seven.** Each already has a template, a `GOAL_ADJUSTMENTS` entry and a
`SPEED_BY_GOAL` entry. Adding the catalog rows is what closes §2.4's broken-id half and turns
seven existing engine2 reads into things the user can see and declare. Wheels is the weakest of
the seven on evidence; it still has a template and a role tag, so it costs nothing to include.

### 5.2 Consider — real archetypes with no template and no row

| Candidate | Pool | 42-deck corpus | My read |
| --- | ---: | ---: | --- |
| **Pillowfort / deterrence** | 185 | max 3 | Real and well-known; engine2 has `politics.deterrent` + `combat.fog_like` and the `goad` template already leans on them. Probably an **engine under Stax/Politics**, not a peer row |
| **Infect / Poison** | 163 | max 6 | See §5.4 — absent from *every* user-facing layer |
| **Toughness matters / defenders** | 472 | max 2 | Doran/Arcades/High Alert is a recognised archetype with **no axis anywhere**. Row-worthy on pool size; rare in this corpus |
| **Extra turns** | 54 | max 1 | Below the 44-card precedent's bar. Keep as a combo engine (`extra_turns` axis + `extra_turn_recursion` combo rule already exist) |
| **Energy** | 142 | max 1 | Borderline. `counters.charge_energy` exists as Counters support. Leave as an engine |
| **Devotion** | 61 | max 2 | Too small |
| **Historic / Legendary matters** | 128 | max 6 | Borderline; no axis. Low priority |
| **Group hug** | 110 | max 2 | `group.hug` axis exists and has **no consumer at all** (§2.1). Either give it a row or delete the axis — the current state is the worst of both |
| **Land destruction** | 269 | — | Real but socially unpopular; an engine under Stax |
| **Cycling / discard-for-value** | 347 | — | Engine under Reanimator / Discard |
| **Ward / protection tax** | 278 | — | Engine, not a strategy |
| **Modified** (equipped/enchanted/countered) | 47 | — | Too small; cross-cuts Equipment/Auras/Counters |
| **Curses** | 42 | — | Too small |
| **Party / Outlaws / Mutate** | 43 / 20 / 35 | — | Too small, set-specific |

### 5.3 Typal — do **not** add more pinned creature types

The corpus and fixtures between them produce tribal reads for Vampire, Ninja, Human, Pirate,
Cat, Beast, Hydra, Rogue, Elemental, Phyrexian — all handled correctly by `detectTribes` with
no catalog row. The four pinned rows buy nothing that `detectTribes` does not already do, and
each one costs a duplicate row (§3.1).

The real typal gap is different: **`tribal:X` counts bodies, not payoffs.** `cardSupportsTheme`
for a `tribal:` id is `_creatureSubtypes(card).some(...)` — nothing else. So a Goblin deck's
lords, anthems, Goblin tutors and "whenever a Goblin enters" payoffs contribute **zero**, and
the pinned rows only partly patch it with two oracle patterns each. Meanwhile
`tribal.lord` / `tribal.synergy` / `tribal.body` exist in the vocabulary and have no
goal-template home (§2.1 ring 2).

Recommendation: fix the *shape* (payoff counting + the dedupe in §3.1) rather than adding
Vampire/Ninja/Sliver/Merfolk rows.

Related: the four pinned rows share `strategy.tribal`'s generic subtag rows via
`planThemeSubtagDefaults`'s `strategy.typal.* → strategy.tribal` redirect, with project tags
`Anthem, Token Maker, Evasion`. An Elf deck's "Lords/anthems" pile therefore accepts **any**
anthem, not Elf anthems. Precision gap, low severity.

### 5.4 Poison is the most completely absent archetype

| layer | state |
| --- | --- |
| `engine2/vocab.js` `counters.poison` | ✅ exists |
| `engine2/vocab.js` `WINCON_KINDS: 'poison'` | ✅ exists |
| goal template | ❌ none — `counters.poison` has no template home |
| `IR_AXIS_THEME` | ✅ maps via `/^counters\./` → but to **`strategy.counters`**, i.e. +1/+1 counters |
| `PLAN_TYPE_DIMENSIONS['strategy.counters']` | ✅ offers a `poison` kind… |
| …which anything downstream reads | ❌ nothing reads the type pick; `THEME_ORACLE.counters` is `+1/+1 counter` and `proliferate` only |
| `PLAN_WINCONS` | ❌ no poison wincon |
| project role tag | ❌ none |
| theme row | ❌ none |

163 commander-legal cards (Blightsteel Colossus, Triumph of the Hordes, Skrelv, Fynn,
Vraska Betrayal's Sting, all of Phyrexia: All Will Be One). A poison deck currently reads as
a +1/+1 Counters deck. Related: **-1/-1 counters** (295 cards — Yawgmoth, Devoted Druid,
Archfiend of Ifnir) has the same problem, is offered as a counter kind in the picker, and has
**no axis at all** in the vocabulary.

### 5.5 Missing wincon rows

`PLAN_WINCONS` should probably gain **Poison / Infect** (163) and **Alternate win condition**
(37 "you win the game" + 40 "loses the game" — Thassa's Oracle, Approach, Mechanized
Production, Hellkite Tyrant, Mirrodin Besieged). Burn-to-face (834) has no home either; it may
belong under a widened `wincon.combat` label rather than its own row.

---

## 6. Suggested order of work

**Outside engine2 — no approval needed, highest value first**

1. **Fix the goal-key contract** (§2.4). Add the six missing `GOAL_ROLE_TAGS` entries, correct
   `GOAL_KEY_STRATEGY` for the eight invalid ids, delete the stale keys (`tokens`, `auras`,
   `equipment`, `vehicles`, `food`, `pump`, `group_slug`), fix `'Tax'` → `'Stax'`, and fix
   `COMBAT_GOALS`' `'tokens'`/`'equipment'`. Add a test that asserts every
   `goal-templates.js` key has a `GOAL_ROLE_TAGS` entry and resolves to a real
   `PLAN_STRATEGIES` id — this class of drift should fail CI, not an audit.
2. **Drop `Evasion` from `THEME_TAGS['strategy.voltron']`** (§4.1) and re-measure the 42-deck
   corpus. Expect Voltron's Decent+ rate to fall from 21/42 to single digits.
3. **Dedupe the typal rows** (§3.1) before any more pins are added.
4. **Give Superfriends an oracle pattern set** (§3.5) — 146 payoff cards for a few regexes.
5. **Fix the dead patterns** (§4.5) and the `counters` typo (§3.7).
6. **Raise the Spellslinger fallback bar** (§4.2).
7. **Add the seven §5.1 rows**, which also completes step 1's broken-id half.
8. **Give Food and Clues bridge tags** (§3.3).
9. Revisit the band ladder once 2–6 land (§4.3) — several of those rows will drop out of the
   noise floor on their own, so retune *after*, not before.

**Inside engine2 — ⚠️ needs partner approval, and none of it is urgent**

- The existing Combat proposal (combat doc §6) stays the front of the queue.
- Delete or connect the 9 no-consumer axes (§2.1). Deleting is a vocab version bump;
  connecting is free.
- Fix `/^equipment\./` by making `_irThemes` param-aware (client-side!) rather than adding an
  `equipment.*` axis — that one is *outside* engine2 after all.
- New axes worth arguing for, in priority order: `combat.damage_trigger` (already proposed),
  a planeswalker/`superfriends.*` axis, `counters.minus1`, and an `equipment.matters` axis if
  param-aware IR matching is rejected.
- `combo-rules.js` additions (§2.5) — three of the five missing families need no new axes.

---

## 7. Open questions for the owner

| # | Question | My recommendation |
| --- | --- | --- |
| Q1 | Is the in-flight token-subtype work (§3.9) intentional and owned by another pass? It overlaps §3.1's duplicate-row problem one level up | Reconcile before it ships — `strategy.tokens.go_wide` vs `strategy.tokens` is the same defect as `strategy.typal.goblin` vs `tribal:Goblin` |
| Q2 | Do the four pinned typal rows stay? | Keep them in the **picker**, drop them from `THEME_CATALOG`, let `detectTribes` own the panel |
| Q3 | Should band thresholds become per-row? | Yes eventually, but only after the precision fixes — several rows will self-correct |
| Q4 | Poison and -1/-1: strategy rows, counter kinds, or wincons? | Poison: a wincon row **and** a theme row. -1/-1: a counter kind that detection actually reads |
| Q5 | Is Spellslinger allowed to lose recall to gain precision? | Yes — it is currently the #1 read on four decks that are not spellslinger decks |
| Q6 | Delete the 9 dead axes, or wire them up? | Wire up `group.hug`, `flash.enabler`, `card_advantage.loot`, `topdeck.matters`; delete or merge the rest |

---

## 8. Acceptance checklist

- [x] engine2 quarantined as proposal-only; every engine2 claim marked
- [x] Pool coverage measured for every pattern claim, against 31,830 commander-legal cards
- [x] Validated on **individual** decks (42), not only averages, per the combat doc's rule
- [x] Existing detection measured by **running the shipped code**, not by reading it
- [x] False-positive rates reported as rates, not anecdotes
- [x] Sample bias stated: single-builder corpus, averaged fixtures, empty local semantics
- [x] Concurrent edits to `js/deck-themes.js` disclosed and re-measured against
- [x] In-flight work separated from defects
- [x] No code changed

---

## 9. What shipped — 2026-09-20

Owner asked for everything fixable without touching `engine2/`, CardIR or the semantics
data. All of the below is app-side. `npm test` passes except `test-card-image-loading`,
which fails identically on the untouched baseline (`js/decks.js`, unrelated).

**Measured before → after**

| | before | after |
| --- | ---: | ---: |
| Voltron at Decent+ on the 42-deck corpus | 21/42 | **3/42** |
| Voltron pool share | 17.86% | **2.55%** |
| Mill pool share (self-mill removed) | 3.59% | 0.75% |
| Superfriends cards visible | 303 | **421** |
| Spellslinger as the #1 read | 6/42 | 4/42 |
| Fixtures with the expected archetype at rank #1–2 | 10/12 (top 3) | **11/12** |
| engine2 goal keys resolving to a real strategy id | 14/22 | **22/22** |
| engine2 goal keys with project role tags | 16/22 | **22/22** |
| `AXIS_TO_PROJECT` axis coverage | 27/121 | 44/121 |

**Changes**

1. **Goal-key contract** (`js/deck-architecture.js`) — `GOAL_ROLE_TAGS` and
   `GOAL_KEY_STRATEGY` rekeyed to the exact `engine2/goal-templates.js` keys;
   `tokens`→`tokens-wide`, `group_slug`→`group-slug`; added `impulse`, `goad`, `mill`,
   `big-mana`, `stompy`, `wheels`, `graveyard`, `group-slug`; dropped the dead `pump`
   key and the `'Tax'` label; `COMBAT_GOALS` rekeyed. `goad`→`strategy.stax` per owner
   lock #4, `graveyard`→`strategy.reanimator`, `tokens-wide`→`strategy.tokens.go_wide`.
2. **A contract guard** in `scripts/test-deck-architecture.js` — every template key must
   resolve to a real `PLAN_STRATEGIES` id and a non-empty list of real role tags. This
   class of drift now fails the build.
3. **Five new rows**: `strategy.stompy`, `strategy.big_mana`, `strategy.impulse`,
   `strategy.wheels`, `strategy.group_slug` — catalogue, tags, oracle, plan rules,
   sub-tag defaults, bridge tags, IR axes, JIVE pairs. Stompy and Big mana are on the
   shortlist; the other three are search-and-infer. **Not** added: `strategy.politics`,
   because owner lock #4 already parks goad-as-politics on Stax.
4. **Voltron** dropped the `Evasion` tag and its two zero-match patterns.
5. **Typal dedupe** — `canonicalizeThemeId` folds `tribal:<Pinned>` into
   `strategy.typal.<pinned>`; unpinned tribes are untouched.
6. **Superfriends** gained the payoff patterns it never had.
7. **Dead patterns** removed across both files; the `++1/+1` typo fixed.
8. **Mill** gated to opponent-directed text.
9. **Spellslinger** gates raised 6/2 → 10/5.
10. **`_irThemes` is param-aware**, so `voltron.aura_equipment` splits to Equipment vs
    Auras and the dead `/^equipment\./` row is gone. `evasion.grant` re-pointed from
    Voltron to Combat.
11. **Wincons**: `wincon.poison` and `wincon.alt_win` added, with oracle rules and
    bridge tags.
12. **Food/Clues** given bridge tags; `AXIS_TO_PROJECT` widened.

**Three findings above were wrong or overstated — corrected here**

1. **"Blink cannot see the blink fixture."** Not a detection gap. `chulane-blink`
   contains **zero** cards with both "exile" and "return" — the EDHREC average for
   Chulane is a landfall/Elf value pile. The fixture's `archetype_expected: "blink"`
   does not match its own contents. Blink's patterns were still improved (0.74% → 1.39%
   pool), but nothing was going to detect that deck.
2. **The Spellslinger fix is a threshold change, not a rule change.** §4.2 implied the
   "count every instant once the gates clear" rule was wrong. It is not — in a real
   spellslinger deck the expensive finishers *are* the plan. The gates were the problem.
3. **Voltron could not take an "equipped creature gets +N" pattern.** Owner rule #1:
   equipment and aura density is a signal toward Voltron, never Voltron identity.
   `test-deck-themes.js` caught the attempt.

### 9b. Second pass — 2026-09-21 (owner asked for a re-check)

Re-verifying the above against the code found four things the first pass got wrong or
left undone. All are now fixed.

1. **§4.5 was only three-quarters done.** A source-level sweep of *every* regex in both
   catalog files (not just the ones §4.5 listed) found four still matching zero cards:
   `THEME_ORACLE.equipment` `/whenever .* becomes equipped/` (§4.5 listed it; it was
   missed), `THEME_ORACLE.reanimator` `/\breanimate/` (§4.5 only listed the PLAN copy),
   `THEME_ORACLE.stax` `/costs \{N\}\b more/` — the `\b` sits between `}` and a space,
   two non-word characters, so it can never match — and the token family's
   `/sacrifice a map/` and `/sacrifice a gold/` (those tokens print "Sacrifice this
   token"). Replacements: `/equip \{?\d/` (596 cards), `/costs? \{?\d+\}? more to
   cast/` (57). **Both files now contain zero dead oracle patterns.**

2. **Poison got its wincon row but not its theme row**, though §5.4 and Q4 both asked for
   both. Worse, the `IR_AXIS_THEME` rule `/^counters\./ → strategy.counters` was left
   alone, so `counters.poison` still routed an infect card to **+1/+1 Counters** — the
   exact conflation §5.4 exists to name. Now: `strategy.poison` (163 cards, 0.50% of the
   pool), `/^counters\.(?!poison)/` for Counters and `/^counters\.poison$/` for Poison,
   plus tags, sub-tags, shortlist and jive pairs. `'Infect/Poison'` in the bridge moved
   off `strategy.other`. Counters is unchanged at 10.17% and Atraxa still reads
   Counters #1 at 25.

3. **§2.6's actual defect was never fixed.** The first pass added the two missing rows
   (`wincon.poison`, `wincon.alt_win`) but not the thing that makes them reachable: there
   was no `WINCON_KINDS` → `PLAN_WINCONS` map anywhere, and the only client reading
   `ir.wincon.kind` was `deck-architecture.js`, for `combo_piece` alone. Added
   `IR_WINCON_KIND_TO_PLAN` **and wired it into two real consumers** — `winconMatch()`
   per card, and `rankWinConditionsForCommander()` where a declared IR wincon now
   outweighs a regex guess. `burn` folds into `wincon.combat`.

5. **Two Ring-1 axes wired, answering Q6.** `card_advantage.loot` → `Discard` and
   `mana.untap_lands` → `Ramp`. Both already existed and had no reader anywhere.
   `AXIS_TO_PROJECT` is now **48 of 121** axes (was 27 before any of this work);
   `IR_AXIS_THEME` is **87 of 121** with zero dead rows (was 73 with one dead row).
   Ring 1 is down from 9 axes to 7 — `group.hug`, `flash.enabler` and `topdeck.matters`
   are left alone because wiring them means inventing strategy rows for archetypes §5.2
   rated *Consider*, not *Promote*. That is a product call, not a cleanup.

4. **§2.1's "Named in the extraction prompt?" column was wrong** — see the correction
   note in that section. All 121 axes are taught; the grep measured bespoke rules.

Also confirmed, not a defect: `test-card-image-loading` fails on Windows only. `js/ui.js`
is byte-identical to HEAD and is 100% CRLF (`core.autocrlf=true`, no `.gitattributes`),
while the test's slice needle uses bare `
`. It passes in CI and has nothing to do with
any change here.

---

**Still open** — everything in §2 (engine2, partner sign-off), the band-threshold retune
(§4.3 — deferred on purpose; three of the five inflated rows fell out by themselves), and
the "is extraction actually emitting this axis?" audit, which needs prod credentials.

