# Bracket Estimation — implementation plan

Estimate a Commander deck's WotC bracket (1–5) and surface it in the deck list and the
deck builder.

Binding constraints: `docs/ui-ruleset.md` governs every pixel. Analysis runs server-side
and degrades to "unknown", never to a guess.

---

## 0. The core design decision

The bracket system is **not a score**. It is four hard restrictions plus a vibe. Modelling
it as a 0–100 power-level number and bucketing it would be wrong and would produce
confident nonsense.

Model it as a **floor-raising constraint solver**:

```
floor = 1
for each violated restriction: floor = max(floor, bracket that first permits it)
ceiling = 4                                  (see below)
bracket = pick within [floor, ceiling] using soft signals
```

| Restriction | B1 | B2 | B3 | B4 | B5 |
|---|---|---|---|---|---|
| Game Changers | 0 | 0 | ≤3 | any | any |
| Mass land denial | no | no | no | yes | yes |
| Chained extra turns | no | no | no | yes | yes |
| Two-card infinite combos | no | no | late-game only | yes | yes |
| Tutors | sparse | — | — | — | — |

**Honest output range is 2–4.** Two brackets are not measurable from a decklist:

- **1 (Exhibition)** is an *intent* — a theme deck, a joke deck, a Ban-List-Lasagna deck.
  A tuned bracket-2 list and a bracket-1 list look identical. Never auto-assign 1.
- **5 (cEDH)** is *metagame positioning*, not card content. A bracket-4 pile and a cEDH
  list both run Mana Crypt and Thoracle. Never auto-assign 5.

So: the estimator returns 2, 3, or 4, and the UI offers a **self-declared bracket** that
overrides it (a deck property, like format). The estimate then reads as "we'd call this a
3; you've declared it a 2" — which is itself the useful signal, and is exactly how the
bracket system is meant to be used at a table.

This decision is what makes the rest of the plan small.

---

## 1. What already exists (reuse, don't rebuild)

| Need | Already in the repo |
|---|---|
| Game Changer list | [server.js:10530](server.js#L10530) `/api/scryfall/game-changers`, 24h in-memory cache of `is:gamechanger` oracle ids + names |
| Client GC matching | [js/decks.js:820](js/decks.js#L820) `ensureGameChangerIndex()`, [js/decks.js:852](js/decks.js#L852) `_deckGameChangerEntries()`, [js/decks.js:865](js/decks.js#L865) `renderDeckGameChangers()` |
| Tutor detection | `otag:tutor` → the `Tutor` role tag, already ingested into `scryfall_oracle_tags` and synced onto deck cards |
| Scryfall-query → oracle-id ingest | [server.js:9398](server.js#L9398) `buildTagMapFromQueries()` + `scryfall_tag_query_cache`, driven by [js/project-role-tags.js](js/project-role-tags.js) |
| Name → oracle row resolution (incl. DFC fallback) | `_e2ResolveCards()` in server.js, used by `/api/decks/analyze` |
| Per-deck cached analysis + background warm | [server.js:5776](server.js#L5776) `computeDeckSemanticsGoal()`, [server.js:5831](server.js#L5831) `warmDeckGoalsOnce()`, `decks.semantics_goal_json` / `semantics_goal_rev` |
| Card-level power hint | `card_semantics.ir_json.power_level_hint` (1–5), and `scryfall_oracle_cards.edhrec_rank` |
| Jump-to-card from a finding | `jumpToDeckIssue(name)` |

The deck-goal feature is the template for this one, end to end. Copy its shape.

**Do not** depend on `card_semantics` coverage. The IR corpus is a curated few thousand
cards; bracket estimation must work on any decklist. Semantics is an *optional* enhancer
(see §3.5), never a requirement.

---

## 2. New data: bracket signal lists

Bracket pillars need card lists Scryfall's tagger doesn't hand over cleanly. Do **not**
add these to `PROJECT_ROLE_TAGS` — those labels become user-visible deck role tags, badge
tiers, and group-by options, and polluting them would ripple through the tag manager and
`SCRYFALL_PROTECTED_TAGS`.

Instead, a parallel list with its own table.

**New file `js/bracket-signals.js`** (UMD, same pattern as `js/project-role-tags.js` so
server and client share one source):

```js
const BRACKET_SIGNALS = Object.freeze([
  { key: 'game_changer',  query: 'is:gamechanger' },
  { key: 'extra_turn',    query: 'o:"extra turn"' },
  { key: 'free_spell',    query: 'o:"without paying its mana cost"' },
  { key: 'mass_land_denial', query: '(o:"destroy all lands" or o:"destroy all nonbasic lands" '
      + 'or o:"sacrifice all lands" or o:"each player sacrifices a land" or o:"lands don\'t untap")',
    plus: [ /* curated names — Winter Orb, Static Orb, Tangle Wire, Rising Waters, … */ ],
    minus: [ /* false hits the text rule catches — one-sided ramp, "destroy all lands you control" */ ] },
  { key: 'fast_mana',     names: [ /* curated ~25: Sol Ring, Mana Crypt, Jeweled Lotus, rituals, … */ ] },
]);
```

Curated `plus`/`minus`/`names` lists are the right tool here — mass land denial and fast
mana are small, stable, argued-over sets. A list in source is reviewable and diffable; a
clever oracle-text regex is neither. Keep each list under ~80 names.

**New table** (created in the same schema-init block as `scryfall_oracle_tags`):

```sql
CREATE TABLE IF NOT EXISTS bracket_signal_cards (
  signal     VARCHAR(32) NOT NULL,
  oracle_id  CHAR(36)    NOT NULL,
  fetched_at BIGINT      NOT NULL,
  PRIMARY KEY (signal, oracle_id),
  KEY idx_bsc_oracle (oracle_id)
);
```

**New script `scripts/import-bracket-signals.js`** — runs each query through the existing
`fetchAllScryfallCardsForQuery()` + `scryfall_tag_query_cache`, applies `plus`/`minus`,
upserts, deletes stale rows. Same shape as the oracle-tag importer. Run it on deploy and
weekly; the table is a few thousand rows.

This also retires the in-memory-only `_gameChangerCache` restart-amnesia at
[server.js:10530](server.js#L10530) — keep the endpoint (the client GC badge uses it) but
have it read the table with the Scryfall fetch as the refill path.

---

## 3. The rules module

**New file `lib/bracket-estimate.js`** — pure, no DB, no network, no `require` of server
code. Same discipline as `engine2/interactions.js`. This is what gets unit-tested.

```js
estimateBracket({ cards, commander, signals, format }) → {
  bracket: 2|3|4|null,          // null when coverage is too low to say
  floor, ceiling,
  confidence: 0..1,
  declaredOverride: null,
  pillars: [{
    key: 'game_changers',
    label: 'Game Changers',
    count: 3,
    verdict: 'ok' | 'caps' | 'exceeds',
    minBracket: 3,              // lowest bracket this pillar permits
    cards: ['Rhystic Study', …],
    note: 'Three Game Changers is the ceiling for bracket 3.'
  }, …],
  reasons: { floorBecause: '…', notLowerBecause: '…', notHigherBecause: '…' },
  coverage: 0.98,
}
```

`cards` arrive pre-resolved: `{ name, qty, oracleId, cmc, typeLine, oracleText, edhrecRank,
signals: Set<string>, roleTags: string[] }`. The module does zero lookups — the caller
resolves.

### 3.1 Pillar: Game Changers
Count distinct GC oracle ids (commander included — a GC commander counts). 0 → permits 2;
1–3 → floor 3; 4+ → floor 4. Exact, no judgement.

### 3.2 Pillar: Mass land denial
Any `mass_land_denial` signal card → floor 4. Binary. List the offenders.

### 3.3 Pillar: Extra turns
Count `extra_turn` cards. The restriction is on *chaining*, not on owning one. Heuristic:
floor 4 if `extra_turn` count ≥ 3, **or** ≥1 extra-turn card alongside a recursion/copy
enabler (`Recursion` / `Copy` role tags, or oracle text "exile it instead" + a flicker).
1–2 non-recurring extra turns → no floor raise, but flag it in the panel as "borderline —
brackets 1–3 ask you not to chain these."

Be explicit in the UI that this one is a judgement call. It is the pillar most likely to
be wrong, and saying so costs nothing.

### 3.4 Pillar: Two-card infinite combos
The hard one. **Ship without it** (see §7 phasing). Until the combo data lands, the pillar
reports `verdict: 'unchecked'`, is excluded from the floor calculation, and the panel says
so. A missing pillar that announces itself is fine; a silently-skipped one is not.

Phase 4 fills it from **Commander Spellbook** — the only accurate source. New table
`combo_variants (variant_id, card_oracle_ids_json, produces_json, card_count, mana_value)`
fed by `scripts/import-combos.js` from their bulk `variants.json`. Match = every oracle id
of a variant is in the deck. Floor 3 for any 2-card infinite, floor 4 if the combo's
combined mana value is low enough to land before turn ~6 (the "late-game only" clause).

This unlocks a genuinely wanted feature on its own — "your deck contains these combos" —
which is why it deserves its own phase rather than being crammed in.

### 3.5 Soft signals (pick within `[floor, ceiling]`)
Only used to choose between 3 and 4 when no hard restriction forces 4. Weighted, and
**never** able to move the floor:

- **EDHREC staple density** — fraction of nonland cards in the top 500 by `edhrec_rank`.
  The single best cheap optimization proxy, and `edhrec_rank` is already a column.
- **Avg mana value** of nonlands.
- **Fast mana count** (`fast_mana` signal).
- **Free interaction** (`free_spell` signal ∩ counterspell/removal role tags).
- **Tutor density** (`Tutor` role tag count).
- **`power_level_hint`** from `card_semantics` when present — a bonus term, weighted by
  coverage, zero when the corpus doesn't know the cards.

Tune the thresholds against fixtures (§6), don't invent them at the keyboard.

### 3.6 Coverage gate
If fewer than 80% of nonland cards resolve to an oracle row, return `bracket: null` and
let the UI say "not enough card data yet" — the same floor `/api/decks/analyze` already
applies at `coverage.semantics < 0.7`. Never show a number derived from half a deck.

Non-Commander formats return `null` immediately (gate on the existing
`_COMMANDER_FMTS_WITH_GC` set).

---

## 4. Server

**`POST /api/decks/bracket`** — mirrors `/api/decks/analyze`: `requireAuth`, the same
1-second per-account rate limit, body `{ cards:[{name,qty}], commander, format }`.

1. `_e2ResolveCards(names)` → oracle rows (already handles the DFC `//` fallback).
2. One `SELECT signal, oracle_id FROM bracket_signal_cards WHERE oracle_id IN (…)`.
3. One `SELECT oracle_id, tags_json FROM scryfall_oracle_tags WHERE oracle_id IN (…) AND schema_version = ?` for role tags.
4. `lib/bracket-estimate.js` → response.

Three indexed queries on ≤100 oracle ids. No per-card work, no Scryfall round trip.

**Caching** — two new columns on `decks`, added in the same `columnExists` block as
`semantics_goal_json` ([server.js:2344](server.js#L2344)):

```sql
ALTER TABLE decks ADD COLUMN bracket_json JSON NULL;
ALTER TABLE decks ADD COLUMN bracket_rev  INT  NULL;
```

Keyed on `revision`, exactly like `semantics_goal_rev`. Extend `warmDeckGoalsOnce()` to
compute the bracket in the same pass — it already loads the cards and resolves the names
for every stale public deck, so the bracket is nearly free there. Rename it
`warmDeckAnalysisOnce()` while you're in it.

`bracket_json` is what lets Browse and the deck grid show a bracket without an analysis
round trip per tile.

---

## 5. UI

Every control follows [docs/ui-ruleset.md](docs/ui-ruleset.md) §3 (34px / 8px radius /
`.btn-outline` chrome), tier-D glass for tooltips, lgx accents not gold, SVG icons not
emoji, and `calc(<base> + var(--dl-fs))` for every font size inside `#tab-decks`.

### 5.1 Builder header chip — *primary surface*
New `<span id="deckBracketBadge">` immediately after `#deckInfoBadge`
([index.html:688](index.html#L688)). Render it as a sibling of the existing
`.deck-gc-circle` family so it inherits an established grammar rather than inventing one:

- `B3` resting, `B…` while loading, `B?` on failure or low coverage
- click → tier-D tooltip: bracket name, one-line reason, the five pillar rows
- `display:none` for non-Commander formats, same gate as `renderDeckGameChangers()`
- A self-declared bracket shows as `B2` with a small accent ring and
  `title="Declared bracket 2 — estimate says 3"`

Colour: the lgx verdict scale (`--lgx-good` → `--lgx-bad`) across 1→5. **Not** a
red/green traffic light — bracket 4 is not "bad".

### 5.2 Deck info tooltip — free real estate
[js/decks.js:26](js/decks.js#L26) `_renderDeckInfoTooltip()` already renders Format /
Value / Game changers. Add a `Bracket` row. Two lines of change, no new chrome, and it
means the number is discoverable even before anyone finds the chip. Do this in the same
commit as the chip.

### 5.3 Analytics panel — *the detail surface*
New `#deckBracketPanel` in `deckTabPane-design` ([index.html:1008](index.html#L1008)),
placed above `#deckThemesPanel`. Contents:

- Headline: **3 · Upgraded**, with a confidence line
- A 1–5 range strip with `[floor, ceiling]` shaded and the estimate marked — this is the
  thing that communicates "estimate, not verdict" better than any disclaimer
- Five pillar rows: label · count chip · verdict · expandable card list. Reuse
  `.deck-gc-row` + `jumpToDeckIssue(name)` — that pattern already exists and already
  escapes properly
- `Why not 2` / `Why not 4` one-liners from `reasons`
- Self-declared bracket picker. **Native `<select>` is banned in glass** — reuse the
  `_glassMenuFit()` / `.glass-dd-wrap` mechanism at [js/decks.js:2379](js/decks.js#L2379)
- A closing line: this is an estimate from card content; the bracket you play is the one
  you tell your table

### 5.4 Deck sidebar
[js/decks.js:4046](js/decks.js#L4046) `_deckSidebarItem()` — meta line becomes
`Commander · 100 cards · B3`. One string.

### 5.5 Deck grid tiles — deliberately *not* a badge
`_deckGridCard()` ([js/decks.js:3984](js/decks.js#L3984)) is intentionally captionless —
"Nothing sits over the art. The card is the tile." Adding a bracket chip over the art
would undo a deliberate design decision. Put the bracket in the existing `label` string
(the tile's `title` and `aria-label`) and leave the art alone.

If at-a-glance brackets on the grid turn out to be wanted, that is a separate conversation
about reintroducing tile captions — not something to smuggle in here.

### 5.6 Browse / public decks
[js/browse.js:98](js/browse.js#L98) `_browseGoalHtml()` — those cards *do* have captions,
and the bracket sits naturally beside the goal readout. Needs `bracket_json` on the
listing payload. Phase 3.

### 5.7 Settings toggle
User-wide `Show deck brackets` in Settings, default **on**, `localStorage` key
`mtg_show_brackets`, same shape as `toggleDeckMapSetting()`. Off hides the chip, the
tooltip row, the sidebar suffix and the panel; it never deletes `bracket_json` or a
declared bracket.

---

## 6. Tests

New `scripts/test-bracket-estimate.js`, appended to the `npm test` chain in
`package.json`. It must be pure — `lib/bracket-estimate.js` takes resolved cards, so the
test needs no DB.

Ground truth available for free:

- **The 12 deck fixtures** in `engine2/fixtures/decks/` — assert each lands in a plausible
  band and, more importantly, **assert stability**: a fixture's bracket must not move when
  unrelated rules change. Golden-file them.
- **Precons are bracket 2 by definition.** `scripts/import-precons.js` exists and the
  28-precon audit set is documented in `docs/engine2-plan.md`. Any precon estimating above
  2 is a bug in the estimator, and this is the strongest signal available anywhere. Worth
  a dedicated assertion pass.
- **Hand-built edge cases**: exactly 3 GCs stays 3 · a 4th GC moves to 4 · one Armageddon
  forces 4 from an otherwise-precon list · a single non-recursive Time Warp does *not*
  force 4 · an empty/unresolvable deck returns `null`, not 2.

Reminders from prior sessions: `npm test` is a 44-script `&&` chain, so **only the first
failure is visible** — run the new test standalone while iterating. Nothing currently
asserts on the deck info tooltip or sidebar meta strings (checked), so §5.2 and §5.4 are
safe string edits.

---

## 7. Phasing

Each phase is independently shippable and independently useful.

| Phase | Scope | Ships |
|---|---|---|
| **1 — Rules core** | `js/bracket-signals.js`, `bracket_signal_cards` + importer, `lib/bracket-estimate.js`, `scripts/test-bracket-estimate.js` | Nothing user-visible. Fully tested. |
| **2 — Builder** | `POST /api/decks/bracket`, header chip, info-tooltip row, Settings toggle | A bracket number on your own decks |
| **3 — Detail + cache** | Analytics panel, self-declared bracket, `bracket_json`/`bracket_rev`, warm job, sidebar + Browse | The full readout, and brackets on other people's decks |
| **4 — Combos** | Commander Spellbook ingest, `combo_variants`, pillar 4 goes live | The pillar that's currently `unchecked`, plus combo detection as a feature |

Phase 1 is the bulk of the thinking and has no UI risk. Phase 4 is a real sub-project —
don't let it block phases 2–3.

After each user-visible phase: `npm run changelog:add` (DB-backed `app_changelog`, not
`CHANGELOG.md`), and `npm run build:bundle` — `dist/bundle.js` is committed and drifts.
`js/bracket-signals.js` needs adding to the `bundle` chunk list in
`scripts/build-bundle.js`, next to `js/project-role-tags.js`.

---

## 8. Open questions

1. **Does the bracket belong on the deck grid at all?** §5.5 says no on ruleset grounds.
   If you want it there, that's a caption decision, not a bracket decision.
2. **Should a declared bracket travel with a shared/public deck?** Argument for: it's the
   deck's social contract and the whole point of the system. Argument against: it's a
   claim, and Browse showing a claimed 2 next to an estimated 4 invites an argument. Lean
   toward showing both, labelled.
3. **Mass land denial edge cases** — Blood Moon and Back to Basics are not on the official
   MLD list but feel like it to a lot of players. Recommend following the official list
   exactly and surfacing the near-misses in the panel as an unweighted "worth knowing"
   note.
4. **Extra-turn chaining** (§3.3) is the weakest heuristic. Consider capping its effect at
   a warning rather than a floor raise until the fixtures say otherwise.
