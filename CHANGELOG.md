# Changelog

## 2026-05-09

### Added
- **Deck Similarity panel** — new "Similarity" section on the deck detail page. Analyzes the active deck against EDHREC (alignment score, missing staples, spicy picks) and other decks in the archive with the same commander (Jaccard similarity). Lazy-loaded via "Analyze" button. Server routes: `GET /api/decks/edhrec-similarity`, `GET /api/decks/archive-similarity`.

### Added
- **Goldfish playtester: drag cards to zones** — hand and battlefield cards can now be dragged onto the GY, exile, command zone, and library zone panels. Zone highlights on hover during drag.

### Added
- **Goldfish playtester: zone click → battlefield** — clicking a card in the GY viewer, exile viewer, or command zone panel now places it at the auto-positioned bottom row (same as tapping from hand), via `_gfPlayFromZone`.

### Changed
- **Goldfish playtester: counter badge** — replaced small corner chip with a large pill-shaped overlay centered on the card (1.4rem, white-on-dark, white border).

### Changed
- **Goldfish playtester: zone panel margins** — padding increased to `10px 8px` across all four zone quadrants for consistent spacing; zone preview images reduced from 137px to 120px to fit cleanly.

### Changed
- **Goldfish playtester: hover zoom** — hand card zoom reduced to 1.44× (from 2.4×), battlefield card zoom reduced to 1.2× (from 2.0×).

### Fixed
- **Goldfish playtester: library card back image** — replaced broken Scryfall placeholder URL with a locally-served image (`/styles/mtg-card-back.jpg`).
