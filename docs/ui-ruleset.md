# UI Ruleset — Deck List page & the Liquid Glass system

Derived from the live deck list tab (`#tab-decks`, grid view) on `feature/liquid-glass`.
The deck list is the **canonical reference surface**: commit f3d885a's rule — *"every
control matches the deck-list button exactly"* — is the governing principle. Any new UI,
on any page, should follow these rules unless a rule here explicitly scopes itself to the
deck list.

Sources of truth: `styles/main.css`, `styles/mobile.css`, `js/decks.js` (`renderDeckGrid`,
`_deckGridCard`), `index.html:566-595`.

---

## 0. Ground rules (apply to everything)

1. **Four visual states exist and all must work.** Styling cascades through four layers:
   `:root` (dark base) → `[data-theme="light"]` → `body.glass-mode` (remaps the same
   tokens) → `[data-theme="light"] body.glass-mode`. Glass mode is **on by default**
   (`js/games.js:44`), so the glass values are the effective design system; the base
   layer is the opt-out. If you style with tokens only, you usually get all four states
   for free. If you hardcode an `rgba()`, you owe a light-glass companion rule.
2. **Never hardcode a colour that a token covers.** Palette: `--bg..--bg4`,
   `--border..--border3`, `--text..--text3`, `--gold/--gold2/--gold3/--gold-dim/--gold-glow`,
   `--blue/--blue2/--teal/--red/--green/--purple`. Accent work in glass uses the **lgx
   triplet** (see §1), not gold.
3. **No emoji as icons.** Inline SVG line icons only, sized inline
   (`width:13px;height:13px;flex-shrink:0` in menu rows, 15×15 in mobile icon buttons).
   The `🌐` on the public badge and the `↓`/`⌕`/`▸▾` glyphs are pre-rule legacy — do not
   copy them into new work (cleanup list, §9).
4. **Fonts:** glass mode flattens *everything* to `var(--glass-font)` with `!important`
   (`main.css:11616`). Do not set `font-family` on new glass-mode elements and expect it
   to survive; Cinzel survives only on the explicit exception list (topbar brand). Use
   `font-variant-numeric: tabular-nums` (inherited) for numbers; JetBrains Mono is the
   base-mode numeric font (`.deck-qty`, counts).
5. **Deck-page type scale:** every font-size inside `#tab-decks` is written as
   `calc(<base> + var(--dl-fs))` (`--dl-fs: 2pt`). New deck-page text must join this
   system, not hardcode a size.
6. **Transitions:** `var(--ease)` (`cubic-bezier(0.4,0,0.2,1)`) always. Durations:
   0.18s for controls, 0.15s for colour/border swaps, 0.2s for tile transforms, 0.12s
   for chips. No other curves.
7. **Prefer classes over inline styles** for anything with more than one state or that
   appears more than once. (Several deck-list elements violate this today — §9.)

---

## 1. Tokens you must know

```css
/* Accent (liquid glass) — r,g,b unwrapped, used as rgba(var(--lgx1), a) */
--lgx1: 110,168,255;   /* glass blue   */
--lgx2: 168,140,255;   /* glass purple */
--lgx-green: 82,196,132;  --lgx-card: 92,206,214;
--lgx-good: 86,196,255;   --lgx-bad: 205,94,245;   /* verdict scale */

/* Radius ladder (glass values — the live ones) */
--radius: 12px;  --radius2: 18px;  --radius3: 24px;  --deck-pane-radius: 20px;
```

**Canonical accent gradients** (memorise these three alphas):
- hover: `linear-gradient(135deg, rgba(var(--lgx1),.14), rgba(var(--lgx2),.14))`
- active/pressed: same at **.22**
- selected (menu rows, view-toggle): same at **.22–.30**

**Accent text colour:** `color-mix(in oklab, rgb(var(--lgx1)) 55%, rgb(var(--lgx2)))`.

**Literal radius meanings:** `8px` = control (buttons/inputs/badges inside deck panes) ·
`999px` = pill (free-standing top-bar buttons, ownership chips, scrollbar thumbs) ·
`14px` = floating menu · `16px` = deck tile (glass) · `18px` = dropdown panel/toast ·
`20px` = panel/stat card · `26px` = modal.

---

## 2. Glass surface tiers — pick the right material

| Tier | Use for | Recipe |
|---|---|---|
| **A — flat panel** | panels, empty states, action bars | `rgba(255,255,255,.05)` fill, `1px rgba(255,255,255,.13)` border, `inset 0 1px 0 rgba(255,255,255,.16)` specular + `0 8px 28px rgba(0,0,0,.35)`. **No backdrop-filter** — blur is a no-op over the wallpaper and costs a compositor layer. |
| **B — lit blue→purple** | tab panes, section boxes, modal bodies | lgx wash over a white wash: `linear-gradient(180deg, rgba(var(--lgx1),.13..15) 0%, rgba(var(--lgx2),.06..07) 55-60%, rgba(var(--lgx2),.04) 100%)` stacked on `linear-gradient(180deg, rgba(255,255,255,.085..09), rgba(255,255,255,.05) 60-180px, rgba(255,255,255,.05))`. Border `rgba(255,255,255,.16-.20)`. |
| **C — control** | every button/input/select | `rgba(255,255,255,.07)` fill — see §3. |
| **D — floating overlay** | dropdowns, context menus, tooltips, toasts | near-opaque `rgba(17,23,42,.97)` (or `.60-.62` for soft panels), **`backdrop-filter: blur(28px) saturate(180%)`** (the standard), border `rgba(255,255,255,.17)`, `inset 0 1px 0 rgba(255,255,255,.14)` + `0 18px 60px rgba(0,0,0,.55)`. |
| **E — art scrim** | text over card art (tile captions, overlay chips) | gradient to `rgba(10,14,28,.78-.80)` + `blur(12px) saturate(160%)` + `mask-image` fade (chips: `blur(8px)`, `border-radius:999px`). |
| **F — KPI/stat card** | stat tiles | 150° white gradient `.10→.04→.07`, radius 20px, double inset specular, static `::after` sheen. |
| **G — chrome** | topbar/sidebar/bottom nav | `rgba(10,14,28,.42-.45)` + heavy blur (20-24px). |

Light-glass conversion rule of thumb: white fills `.05 → .5`, borders → `rgba(255,255,255,.65+)`,
specular inset `.16 → .9`, drop shadows `rgba(0,0,0,α)` → `rgba(30,50,90, .4α)`.

Blur budget: only tiers D–G blur. Never add `backdrop-filter` to tier A/B surfaces.

---

## 3. Buttons — THE canonical control

Reference: the deck-list Filter button (`.btn.btn-outline.btn-sm`, `main.css:4259`, `10202`).
Every control in a deck pane — and per f3d885a, everywhere else — matches it:

```
height: 34px            padding: 0 12px         border-radius: 8px
font-size: 0.82rem      display: inline-flex    align-items: center
```

**Resting chrome (glass):**
`background: rgba(255,255,255,.07)` · `border: 1px solid rgba(255,255,255,.16)` ·
`color: rgba(240,244,252,.82)` ·
`box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 2px 10px rgba(0,0,0,.22)`.
Light: `rgba(255,255,255,.55)` fill / `.75` border / `rgba(28,40,58,.82)` text /
`inset .9` + `0 2px 10px rgba(30,50,90,.10)`.

**States:**
- hover → `border-color: rgba(var(--lgx1),.55)` + the **.14** lgx gradient, `color: var(--text)`
- active/pressed/`.active` → `border-color: rgba(var(--lgx2),.55)` + the **.22** gradient
  (+ keep the inset specular)
- disabled → **no convention exists yet.** If you need one, define it once globally
  (suggest `opacity:.4; cursor:not-allowed`, matching `.tablet-life-btn:disabled`) —
  don't invent per-element.
- touch: under `@media (hover:none)`, hover styles must be reset so only `.active`
  highlights (pattern at `main.css:365`).

**Variants:**
- `.btn-primary` (one per view max): blue gradient
  `linear-gradient(160deg, rgba(70,150,255,.92), rgba(10,110,240,.85))`, white text,
  `border rgba(255,255,255,.30)`, glow shadow. Never solid green/gold in glass.
- `.btn-outline` — the default control (all rules above).
- `.btn-ghost` — menu rows and tertiary actions only.
- `.btn-danger` — `rgba(255,90,74,.16)` fill / `.4` border / `#ffa79c` text.
- `.btn-sm` — min-height 28px; base `.btn` min-height 34px.
- Icon-only: square, `padding: 0`, explicit `width/min-width` (34px desktop, 38×34 mobile).

**Pill exception:** free-standing buttons in the page top bar keep the glass base
`border-radius: 999px`; anything inside a panel header or control cluster is normalised
to 8px. Don't fight the normaliser — place the button correctly instead.

**Menu-row buttons** (`.deck-menu-item`): full-width, left-aligned, `.btn-ghost`,
`font-size: .78rem`, `padding: 4px 10px` (glass: `6px 10px`), `gap: 7px`, 13×13 SVG icon,
`+ 6px` vertical rhythm between rows.

---

## 4. Inputs, selects & dropdown menus

**Inputs/selects** share the button metrics inside deck panes: 34px / `0 12px` / 8px /
`calc(0.82rem + var(--dl-fs))`. Outside deck panes, glass rounds inputs to 12px — the
8px override is deliberate and scoped; keep new deck-pane inputs at 8px.

**Focus ring (glass):** `border-color: rgba(var(--lgx1),.75)` +
`box-shadow: 0 0 0 3px rgba(var(--lgx1),.18)`. (Base mode uses the gold equivalent.)
Never remove `:focus` styling without replacing it.

**Native `<select>` is banned in glass UI.** Single-choice selects get glassified at
runtime (`js/decks.js:2379` swaps in `.glass-dd-wrap` + `.glass-dd-btn` trigger and a
`.glass-menu`). New single-choice controls should reuse that mechanism, not ship a raw
select.

**`.glass-menu` (the floating menu standard):**
`rgba(18,24,44,.92)` + `blur(20px) saturate(1.15)`, border `rgba(var(--lgx1),.28)`,
radius 14px, `padding: 5px`, rows `.glass-menu-item` radius 9px, `padding: 8px 14px`,
hover = **.20** lgx gradient, `.selected` = **.30** gradient + `#fff`.

**Scroll behaviour (commit e090e0e) — every dropdown must:**
- cap height: `min(340px, available room)`, floor 140px, 12px viewport margin;
- flip above the trigger when below-space < 180px and above is larger;
- `overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch`;
- scroll the `.selected` row into view on open;
- swallow the opening tap (no click-through to elements underneath).
Use `_glassMenuFit()` (`js/decks.js:2331`) rather than reimplementing.

**Anchored dropdown panels** (`.deck-options-dropdown`, `.settings-dropdown`):
`top: calc(100% + 6px)`, `width: min(260-300px, 100vw - 20px)`,
`max-height: min(85vh, 640px)`, `overflow-y: auto`, `z-index: 500`, tier-D glass,
`.open` class toggles display, outside-click closes.

---

## 5. Deck grid & tiles

- **Grid:** `.deck-grid` — `repeat(auto-fill, minmax(200px,1fr))`, `gap: 1rem`.
  Mobile ≤768px: exactly 2 columns, `gap: 8px`.
- **The live tile component is `.browse-deck-card`** (shared with Browse). The parallel
  `.deck-grid-card` ruleset is dead CSS — never build on it (§9).
- **Tile:** `aspect-ratio: 0.715` (MTG card ratio), radius 12px (glass: **16px**),
  `overflow: hidden`, `1px var(--border)`, `background: var(--bg3)`. The whole tile is
  one click target — no nested buttons, no kebab menus on tiles.
- **Hover:** `translateY(-6px) scale(1.02)` +
  `0 16px 48px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.35)` ring (glass; gold ring
  is base-mode only).
- **Art:** `object-fit: cover; object-position: center top`. Slots must hold their shape
  before art loads (the aspect-ratio does this — don't remove it). No-art fallback:
  `.deck-grid-placeholder` (`var(--bg4)` fill, centered name).
- **Caption scrim:** tier E — `linear-gradient(transparent, rgba(10,14,28,.55) 30%,
  rgba(10,14,28,.80) 100%)` + `blur(12px) saturate(160%)` +
  `mask-image: linear-gradient(to top, #000 70%, transparent)`. The long fade is
  intentional (commit 89cdfdd restored it) — do not shorten it.
- **Caption contents, in order:** name (`.browse-deck-name`, 600 weight, ellipsis) →
  meta line (`.browse-deck-meta`: `format · commander[ · owner]`) → optional guild/combo
  name → bottom row: colour pips left, badges right.
- **Perf rule:** fetch visible tiles' art first (commit 1aa5eae).

### Tile badges & pips
- **Badge base:** `.deck-grid-badge` — `font-size: .6rem`, `padding: 1px 5px`,
  radius 6px, `margin-left: auto`, `line-height: 1`. Colour = tinted fill (~.2 alpha) +
  matching text token + ~.4 alpha border, e.g. public =
  `rgba(61,184,160,.2) / var(--teal) / rgba(61,184,160,.4)`.
  **Every badge variant gets a modifier class** (`.deck-grid-badge-public` style); the
  inline-styled "Shared" badge is a deviation to fix (§9).
- **Validation dot:** `.deck-card-valid-dot` — 20×20 circle, 11×11 SVG,
  `--error` = red at `.2/.5`, `--warn` = gold at `.2/.5`, absent when clean. Always set
  `title`. The same colour grammar scales up to the 32×32 `.deck-valid-circle`.
- **Colour pips:** `.mana-pip` — Scryfall symbol SVGs, WUBRG-sorted
  (`sortColorsWUBRG()`), circular, `box-shadow: 0 1px 3px rgba(0,0,0,.5)`, `gap: 5px`,
  deck-page size `calc(22px + var(--dl-fs))`.

---

## 6. Page furniture

- **Top action bar:** flex row, `gap: 10px`, `margin-bottom: 1.25rem`, `flex-wrap: wrap`.
  Contents: one `.btn-primary` + outline/dropdown secondaries. Buttons here may stay pill.
- **Section headers** (`.deck-section-label`): `.72rem`, uppercase, `letter-spacing: .1em`,
  `var(--text3)`, `border-left: 2px solid var(--blue)`, `padding-left: 8px`. Collapsible
  sections render the header as a `<button>` with `aria-expanded`, a `▸/▾` chevron
  (swap for an SVG chevron in new work), a `(count)` in `var(--text3)`, and persist
  collapsed state to a `mtg_*` localStorage key. Collapsed = omit the content from the
  DOM, not `display:none`.
- **Empty states:** centered, `grid-column: 1/-1`, `padding: 4rem 2rem`, `var(--text3)`,
  optional dimmed illustration (opacity ~.35), a title, one line of copy, and **one**
  `.btn-primary` CTA. Compact variant (when sibling content exists): single line +
  inline `.btn-primary.btn-sm`, `padding: 2rem`.
- **Loading:** the deck grid renders synchronously from memory — no skeletons. Keep it
  that way; per-tile art placeholders handle the async part. If a future list needs a
  loading state, use a quiet `var(--text3)` line, not a spinner.
- **Toast** (`.notif`): fixed bottom-right, slides in via `transform`, tier-D soft glass
  (`rgba(20,27,48,.62)` + `blur(24px) saturate(180%)`, radius 18px), ✓/✕ icon coloured
  `var(--green)`/`var(--red)`, auto-dismiss 3s. One toast style app-wide — always via
  `showNotif()`.

---

## 7. Modals

- Structure: `.modal-overlay` (+`.open`) → `.modal` → absolute `.btn-ghost.btn-icon`
  close ✕ (top-right) → `.modal-title` → body → footer (primary `flex:1` + outline
  Cancel).
- Glass recipe: navy gradient `linear-gradient(165deg, rgba(34,44,74,.92),
  rgba(20,27,48,.90))` (optionally under the tier-B lgx wash), `blur(30px)
  saturate(180%)`, **radius 26px**, `inset 0 1px 0 rgba(255,255,255,.16)` +
  `0 28px 90px rgba(0,0,0,.6)`. Overlay: `rgba(8,12,26,.45)` + `blur(24px)
  saturate(140%)`.
- Titles in glass: no uppercase, no letter-spacing, `1.05rem/700`.
- Field labels: `.78rem`, `var(--text3)`, `margin-bottom: 4px` (promote today's inline
  style to a class when touched).
- Controls inside modals follow §3/§4 exactly (34px/8px, no solid green/gold buttons).
- Mobile ≤768px: modals become bottom sheets — full width, `radius 18px 18px 0 0`,
  `max-height: 92vh`, safe-area bottom padding, 44px close tap target.
- Confirm/prompt: always `showConfirmModal()` / `showPromptModal()` (supports
  `btn-danger` OK) — never `window.confirm/prompt`.

---

## 8. Mobile rules (≤768px) that new work must respect

- `--page-gutter: .75rem`; topbar collapses to zero height (not `display:none`);
  bottom nav owns navigation.
- All inputs `font-size: max(16px, 1em)` (iOS zoom guard).
- Deck grid: 2 columns, `gap: 8px`.
- Icon-only header actions: 38px wide × 34px tall, label hidden, 15×15 SVG.
- Multi-row control headers use `display:contents` + `::before/::after` flex breaks with
  explicit `order` — follow the `#deckListPanelHeader` pattern rather than media-query
  duplication. Below 340px the `.glass-dd-prefix` labels drop.
- Touch: open-on-class only (`.is-stack-peek` pattern), never `:hover` — iOS sticky
  hover is why. Menus/dropdowns swallow their opening tap.

---

## 9. Known deviations — fix on touch, never copy

1. **`.deck-grid-card` family is dead CSS** (`main.css:4070-4123` + glass blocks) —
   `.browse-deck-card` is the live tile. Delete when convenient.
2. **"Shared" tile badge is fully inline-styled** (`js/decks.js:3561`) — give it
   `.deck-grid-badge-shared` and move the blue tint to CSS.
3. **`--gold-soft` is used but never defined** (`main.css:4310`, `4333`) — those hover
   border-colours silently drop. Define it or use `var(--gold-soft, var(--border2))`.
4. **`body.glass-mode .btn` chrome is declared twice** (`main.css:10202` vs `10698`),
   variants triplet too — consolidate; edits to one copy silently miss the other.
5. **Tag-picker highlight fix may be inert:** `main.css:12982` (`box-shadow:none`) is
   out-ranked by the `!important` at `main.css:13062-13068`.
6. **Emoji glyphs as icons** (`🌐` public badge, `↓ Import`, `⌕ Filter`, `▸/▾`
   chevrons) — replace with inline SVG line icons when touched.
7. **`.btn` has no `:disabled` rule** — define globally before first use (§3).
8. **New Deck modal internals are heavily inline-styled** (commander typeahead results,
   chosen-commander chip) — promote to classes when next edited.
