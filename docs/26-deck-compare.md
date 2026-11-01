# Deck Compare — physical deck vs digital deck

**Status:** IMPLEMENTED v1 (2026-11-01). Logic and UI covered by `scripts/test-deck-compare.js`
plus a browser harness run against the built scanner chunk; not yet tried with a live camera
on a phone.

Entry point: deck ⋮ menu → **Compare physical deck**. Files: `js/deck-compare-core.js` (pure
counting, allocation, deck changes; Node-tested) and `js/deck-compare.js` (modal, report
actions, scanner bridge). Markup `#deckCompareModal` in `index.html`; styles under
"DECK COMPARE MODAL" in `styles/main.css`.

## Partner rules (DECIDED)

1. **The current scanner is not affected in any way.** `js/scanner.js` is not edited and
   `dist/chunk-scanner.js` is unchanged. While a compare scan is running, `js/deck-compare.js`
   swaps five scanner entry points (`_scnAutoStageAndResume`, `_scnAdd`, `_scnFpStreamAdd`,
   `scnAddPendingToCollection`, `closeScanner`) for compare versions and restores the exact
   originals when the scanner closes. It also stashes and restores any queued collection scans.
   Outside a compare scan the scanner behaves exactly as before. Nothing scanned during a compare
   is written to the collection.
2. **It matches the current UI.** Glass modal styled like the Export modal, 34px/8px glass
   controls, card rows reuse the scanner's Scanned-panel rows (`.scn-session-row`, `.scn-qty-btn`).

## Behaviour (DECIDED with the user)

- Cards are matched by **name** (DFC front face), not printing.
- Scanned copies fill buckets in this order: main (not cut) → planned cuts → planned adds →
  maybeboard → sideboard → not in deck.
- Progress counts main-board copies that aren't cuts. Maybeboard/sideboard count only when
  **Include maybeboard & sideboard** is ticked (default off).
- Every row has − / number / + so counts can be typed. That covers basic lands and anything
  the scanner misses. Basics can also be scanned one at a time; repeat scans count up through
  the scanner's own duplicate handling.
- **I've scanned everything** opens the report:
  1. Planned cuts not scanned → *Remove from deck* (asks "Are you sure?" first).
  2. Main-board cards not scanned → reported, with checkboxes and *Remove selected* (asks
     first). The commander is never removed.
  3. Scanned cuts → *Keep* (removes the cut mark).
  4. Scanned adds → *Move to main*.
  5. Scanned maybeboard/sideboard cards → *Move to main*.
  6. Scanned cards not in the deck → **Adds** by default (or Main / Maybe). With Adds & Cuts
     planning off: Main / Maybe.
  7. (Only when extras are counted) unscanned maybeboard/sideboard → *Remove selected*.
- One-level **Undo** for the last change made from this screen. It restores the deck zones;
  history entries already written stay in the history log.
- Scan progress is saved per deck in `localStorage` (`mtg_deck_compare_v1_<deckId>`) on this
  device only. **Start over** clears it.
- Read-only decks can be compared, but the actions are disabled.

## Known limits

- Scans still queued in the scanner are counted when the scanner closes. A page reload
  mid-scan loses that run's queue (earlier runs are saved).
- Two identical printings in a row (e.g. basics): the scanner's own "same card still in the
  reticle" guard may skip a repeat if the card isn't moved out of frame. Use + or type the number.
