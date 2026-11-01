# Deck Compare — physical deck vs digital deck

**Status:** IMPLEMENTED v1 (2026-11-01), shared across devices. Logic, server and
multi-device sync tested (see Tests below); not yet tried with a live camera on a phone.

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
- Read-only decks can be compared, but the actions are disabled.

## Shared tally across devices (DECIDED 2026-11-01)

One scan tally per deck, shared by **everyone who can edit the deck** (owner + 'edit'
collaborators; 'view' collaborators get 403 and count on their own device only).

- Server: tables `deck_compare_sessions` (include-extras flag, revision) and
  `deck_compare_scans` (deck_id, name_key, name, qty, entry), created at boot.
  `GET /api/decks/:id/compare` and `POST /api/decks/:id/compare/ops`. Ops are
  `add` (stacks — two devices counting at once both count), `set` (typed count), `reset`,
  `extras`. They are applied with `DeckCompareCore.applyTallyOps` (the same code the client
  runs) under a per-deck row lock. The new state is pushed to the deck's socket room as
  `deck:compare`, carrying the sender's `clientId` so the sender skips its own echo.
- When it syncs (user's choice: "when scanning is marked as done" is fine): when a scanner run
  finishes (Done or ✕), and on every manual edit (typed count, − / +, extras toggle,
  Start over). Other devices with the deck open update live, without a refresh.
- Each device keeps the last server state plus an **outbox** of unsent ops in `localStorage`
  (`mtg_deck_compare_v1_<deckId>`). Edits show instantly, survive going offline and are
  sent on reconnect. A small label in the progress line shows Synced / Saving… / Offline.
- **Start over** clears the tally on every device.
- The scan-vs-report screen and the search box stay per device.
- Deck edits made from the report travel through the normal deck sync.

### Related fix to the existing deck sync

`refreshDeckFromRemote` used to drop every `deck:updated` made by the **same account**, so
your own phone and computer never saw each other's deck edits live (only collaborators did).
Deck-op writes now carry a per-page `clientId` (`_deckClientId` in `js/db-client.js`), and
the server echoes it. A page skips only its own echo, and the account's other devices apply
the change (toast: "Deck updated on another device"). Broadcasts without a `clientId`
(legacy write paths) keep the old account-level skip. The socket also rejoins the open
deck's room on every reconnect. Before this, a phone whose socket dropped (screen asleep)
silently stopped getting live updates until a refresh.

### Tests

- `scripts/test-deck-compare.js` (in `npm test`): tally ops, sanitising, queue → ops.
- `npm run test:e2e:compare` (needs MySQL + a running server): endpoints, live push, concurrent
  adds, permissions, bad input, reset, deck-delete cleanup. Ran green against a local
  MariaDB; `e2e-deck-op-sync` is still green with the clientId change.
- A two-browser run (phone + computer, same account) against the real server, done during
  development: phone scan reaches the computer with no refresh, typed counts go the other way,
  reconnect catch-up, offline outbox, deck edits reach the other device, Start over everywhere.

## Known limits

- Scans still queued in the scanner are sent when the scanner closes. A page reload
  mid-run loses that run's queue (earlier runs are saved and synced).
- A device only gets live updates while the deck is open there. Opening the compare
  screen always fetches the latest tally.
- Two identical printings in a row (e.g. basics): the scanner's own "same card still in the
  reticle" guard may skip a repeat if the card isn't moved out of frame. Use + or type the number.
