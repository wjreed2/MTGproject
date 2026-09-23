# Deck Synergy Web — network analysis proposal

*Status: proposal (2026-09-08). Builds on engine2 semantics + the Deck Map ordination.
Companion docs: `engine2-plan.md` (§5 interactions, §6 goals), `21-deck-themes.md`.*

## 1. Summary

Add a per-deck **network analysis layer** on top of the engine2 semantic data and the
Deck Map PCA. For each deck it:

1. builds a **card-interaction graph** (nodes = cards, edges = mechanical synergies
   from `engine2/interactions.js`, plus PCA-space similarity),
2. computes **deck-level synergy metrics** — a composite 0–100 **Synergy Score** with
   legible subscores (Cohesion, Engines, Consistency, Focus, − Friction), and
3. renders an interactive **force-directed "Web" view** inside the existing Deck Map
   viewer, with the PCA projection seeding the layout so position stays semantic.

Almost everything needed already exists: `computeInteractions()` emits the typed edge
list, `synergyClusters()` (label propagation) finds packages, and the ordination basis
carries idf scaling we can reuse to stop staple axes (card draw, spot removal) from
inflating every deck's score. The network exists implicitly today — nobody has
aggregated it per pair, measured it per deck, or drawn it.

## 2. What we build on

| Piece | Where | What it gives us |
|---|---|---|
| CardIR capability layer | `card_semantics` (+`card_semantics_axes`) | provides / needs / anti / wincon per card |
| Interaction engine | `engine2/interactions.js` | typed edges: `enabler_payoff` (directed, param-aware), `engine` (2/3-cycles), `nonbo`, `protection_of`, `redundancy`; rule-based `combos`; `synergyDegree()`; <100 ms per 100-card deck, pure, no DB |
| Synergy clusters | `engine2/deck-goals.js` → `synergyClusters()` | deterministic label propagation over the edge graph |
| Global PCA basis | `data/ordination-basis.json` via `scripts/build-ordination-basis.js` | fixed feature space, per-feature idf scale `log(1 + N/df)`, 6-component loadings |
| Deck Map viewer | `dist/deck-map.html` (built from `docs/axis-ordination.template.html`), `GET /api/deck-map`, `js/deck-map.js` iframe host | canvas renderer, pan/zoom/touch, card-image tooltips, theme sync, per-deck selection |
| Reference decks | `engine2/fixtures/decks/` (12 EDHREC-average decks) | calibration anchors + no-DB test fixtures |

Standing rules that bind this feature: **English labels only** to the client (raw axis
tokens/trace never leave the server — same rule as the analyze API and `/api/deck-map`);
**user-wide Settings toggle, default ON**; **inline SVG icons, no emoji**; engine changes
run the engine test harness + `build:bundle`.

## 3. Graph model

### 3.1 Nodes

Deck cards that resolve to a CardIR (same exact-name → DFC-front-face resolution as
`/api/deck-map`). Cards with no extracted IR are **excluded from the graph and from every
denominator** and reported as `coverage` — "no data" must never render as "no synergy".
Pure lands / empty vectors are likewise excluded (they'd be permanent isolates).

Per-node outputs: weighted synergy degree, cluster id, theme category (existing 14-cat
palette), commander flag, `passenger` flag (no meaningful edge), `loadBearing` flag
(articulation point — removing it disconnects a package; O(V+E) DFS).

### 3.2 Edges — aggregate per pair

`computeInteractions()` emits one edge per *(pair, axis, type)*; a draw engine next to
ten payoffs produces a hairball. The network layer aggregates to **one edge per unordered
pair**:

```
pairEdge = {
  a, b,
  w,                  // signed sum of weighted contributions
  types: {...},       // mass per type: enabler_payoff / engine / redundancy / nonbo / protection_of
  reasons: [top 3, English via labelOf()],   // "token maker → sac fodder"
  dir,                // net direction of enabler_payoff mass: a→b, b→a, or mutual
}
```

### 3.3 Distinctiveness weighting (the PCA tie-in)

Raw axis matching over-rewards staples: every deck "synergizes" through card draw and
spot removal. The ordination basis already knows which axes are ubiquitous — its idf
scale. Weight each contribution by the axis's distinctiveness before summing:

```
w(axis) = clamp( scale[P:axis] / median(scale), 0.5, 2.0 )
contribution = strength(edge) × w(axis)
```

So `storm.count` or `counters.poison` edges count roughly 2× a generic
`card_advantage.draw` edge. This is the main thing that makes the composite score mean
"this deck is built around something" instead of "this deck contains Magic cards".

### 3.4 Similarity edges (optional layer, viz-first)

Cosine similarity between card vectors in the reduced 6-component PCA space (cheap,
denoised) — top-k (~3) per node above a threshold (~0.75), typed `overlap`. These capture
multi-axis kinship the literal axis-equality `redundancy` rule misses. Kept **out of the
score initially** (complementarity ≠ similarity); rendered as faint dashed links and
promoted into the Consistency subscore later only if calibration supports it.

### 3.5 Pruning for the client

Always keep `engine`, combo-member, and `nonbo` edges; for the rest keep each node's
top-8 by |w|. A 100-card deck lands around 300–600 edges → tens of KB.

## 4. Deck-level metrics and the Synergy Score

All computed over the n semantic (graph-eligible) cards; every subscore is calibrated to
0–100 (below). Positive pair weight `w+` uses the idf-weighted aggregate from §3.

| Subscore | Definition | Reads as |
|---|---|---|
| **Cohesion** | share of nodes with ≥1 non-redundancy edge of `w ≥ τ`, blended with largest-connected-component share | "does the deck hang together, or is it 60 goodstuff passengers" |
| **Engines** | Σ engine-cycle strength + 8·combos, per node | "are there loops, not just one-way pushes" |
| **Consistency** | redundancy mass across distinct axes (per-axis capped) | "does it do its thing reliably" |
| **Focus** | Σ top-3 cluster sizes ⁄ n | "one plan vs. three half-plans" |
| **Friction** | Σ \|nonbo w\| ⁄ pairs (penalty) | "cards fighting each other" |

**Composite:** `Synergy = Σ αᵢ·subᵢ − β·Friction`, starting weights roughly
Cohesion 0.35 / Engines 0.30 / Consistency 0.20 / Focus 0.15. Also reported but not
scored: **commander lift** (commander's degree percentile within the deck) and
**coverage**.

**Calibration, not magic constants:** run the metrics over the 12 EDHREC fixtures plus
every real deck (`--all-accounts` style sweep); map raw values to 0–100 through
percentile anchors stored next to the ordination basis (rebuilt by the same script, so
score drift is tied to explicit basis rebuilds). Acceptance checks live in the test
suite: tribal/combo fixtures must rank above precon-level piles, and a shuffled
"goodstuff" negative-control fixture must land in the bottom quartile.

Everything is deterministic — same IRs in, same score out — so it's testable with the
existing assert-and-count harness style and safe to show users.

## 5. Visualization — a "Web" mode in the Deck Map

Extend the existing viewer (`docs/axis-ordination.template.html`) rather than building a
new page — it already has canvas rendering, pan/zoom, touch, theme sync, deck selection,
and card-image tooltips.

- **Mode toggle** Map ⇄ Web. Web mode is per-deck: pick a deck, see its graph.
- **Layout:** 2D force-directed (custom ~100-line simulation, no library — n ≈ 100).
  **Seed positions from the deck's PCA projection**, then let forces refine. Layout is
  deterministic (seeded from data, not `Math.random()`), stable between visits, and
  semantically oriented — similar cards start near each other, connected cards pull
  together, the map and the web agree about geography.
- **Nodes:** dot size ∝ synergy degree; fill = theme category (existing CATS palette);
  ring for the commander; hollow/dim for passengers.
- **Edges:** solid teal-weighted strokes for synergy (arrowhead when direction is
  net one-way), highlighted closed loops for engines, glow for combo members, dashed
  red for nonbos, faint dashed for overlap. Edge tap/hover shows the English reasons.
- **Clusters:** convex hulls (or tinted halos) labeled by dominant theme.
- **Hover/tap a card:** dim everything outside its neighborhood; list its connections
  in the side panel.
- **Side panel:** Synergy Score dial + subscore bars, top packages, passenger list,
  load-bearing list. Passengers double as cut candidates; load-bearing cards as
  "add redundancy here" prompts — direct hooks into the recommender later.

## 6. API

`GET /api/decks/:id/network` (requireAuth + ownership check, same join discipline as
`/api/deck-map` — drive `deck_cards` off `(account_id, deck_id)`).

- Factor the name→IR resolver (exact + DFC-front fallback) out of the `/api/deck-map`
  handler into a shared server helper; both endpoints use it.
- Server runs `buildDeckNetwork()` (§7) on the resolved IRs — sub-100 ms, no precompute
  or new tables needed.
- Response: `{ nodes, edges, clusters, metrics, score, coverage }` — **English labels
  only**, no raw axis tokens, no `trace`. `Cache-Control: private, max-age=300`.

## 7. Implementation plan

| Phase | Work | Done when |
|---|---|---|
| **1 — Engine module** | `engine2/deck-network.js`: `buildDeckNetwork(cards, {idfScale, anchors})` → nodes/edges/clusters/metrics/score. Pure, no DB. Reuses `computeInteractions`, `synergyClusters`, adds aggregation (§3.2), idf weighting (§3.3), components/articulation, metrics (§4). Plus `scripts/network-test.js` on the deck fixtures, appended to `npm test` | fixtures produce stable scores; goodstuff control ranks bottom quartile; 100-card build <150 ms |
| **2 — Calibration** | extend `build-ordination-basis.js` (or sibling script) to emit percentile anchors into `data/ordination-basis.json`; sweep fixtures + real decks | anchors committed; rank-order acceptance checks pass |
| **3 — API** | shared IR resolver helper; `GET /api/decks/:id/network` | endpoint returns labeled payload, tokens verified absent |
| **4 — Web mode** | viewer template: mode toggle, force layout (PCA-seeded), edge/node/hull rendering, side panel; rebuild via `build-axis-ordination.js` | Web mode works in dev page + app iframe, both themes, touch OK |
| **5 — App surface** | Synergy Score chip in the deck header/inspector (inline SVG icon); Settings toggle (user-wide, default ON, hides but keeps data); `npm run changelog:add` | score visible; toggle behaves like Deck Map's |

Branch: `feature/deck-network` off `development`. Engine phases run
`engine-smoke-test` + `engine-integration-test` + `build:bundle` before commit.

## 8. Risks & open questions

- **Staple inflation** is the #1 failure mode — idf weighting (§3.3) is the mitigation;
  the negative-control fixture is the regression guard.
- **Score drift**: extraction batches change IRs, basis rebuilds change idf/anchors.
  Tie anchors to the basis file so drift only happens at explicit rebuilds (already the
  Deck Map's model).
- **Hairball risk** on dense decks: per-node top-k pruning + pair aggregation; if still
  noisy, raise τ per-deck until edge count ≤ ~5n.
- **Similarity edges in the score** — deferred (viz-only) until calibration shows they
  separate decks rather than flattening them.
- **Coverage honesty**: show coverage next to the score; below ~70 % coverage, badge the
  score as provisional rather than hiding it.
- **60-card formats**: metrics normalize by n and pairs, but anchors are Commander-
  derived; calibrate per-format buckets if non-EDH decks look systematically off.

## 9. Later

- **Cross-deck network**: decks as nodes, PCA-centroid distance as edges — a
  collection-level map of which decks share an identity (directly reuses the basis).
- **Recommender integration**: annotate suggested adds with the edges they *would*
  create ("connects to Skullclamp, Pitiless Plunderer"); cuts = passengers.
- **Temporal view**: score history per deck as it's edited (needs a tiny log table).
