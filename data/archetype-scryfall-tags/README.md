# Archetype → Scryfall oracle tag map

Verified mapping of Commander/EDH deck archetypes to real Scryfall Tagger
oracle tags (`otag:`), for suggested adds/cuts and theme/archetype work.

## Files

| File | Purpose |
|------|---------|
| `archetype-scryfall-tags.csv` | Import-ready sheet (5 columns matching the Google Sheet) |
| `archetype-scryfall-tags.enriched.csv` | Same + tagging counts / match metadata |
| `build-summary.json` | Row counts, skipped missing candidates |

Columns: `Archetype Name` | `Scryfall Tagger Category` | `Exact Tagger Tag` | `Scryfall Search Syntax` | `Tag Description`

## Coverage

- **55 archetypes** (macro strategies + 15 tribes)
- **~600 rows**, every `Exact Tagger Tag` resolves against Scryfall’s `oracle_tags` bulk file
- Tribes use real conventions: `typal-{creature}`, `tutor-creature-{creature}`, `impulse-creature-{creature}` — **not** fabricated `angels-tutor` / card-name tags

## Rebuild / verify

```bash
# Download latest oracle tags (~18MB; gitignored)
python3 scripts/fetch-scryfall-oracle-tags.py data/scryfall/oracle-tags.json

# Rebuild CSV from curated lists in the builder script
python3 scripts/build-archetype-scryfall-tag-map.py \
  --oracle-tags data/scryfall/oracle-tags.json \
  --out-dir data/archetype-scryfall-tags

# Fail CI-style if any tag is invented
python3 scripts/verify-archetype-scryfall-tags.py \
  --oracle-tags data/scryfall/oracle-tags.json \
  --csv data/archetype-scryfall-tags/archetype-scryfall-tags.csv
```

## Import into Google Sheets

1. Open [Commander typal tags](https://docs.google.com/spreadsheets/d/1AllkKqGjwLYFOyQwJ2GBTWD5usemCz4yRSzfsIriovk/edit)
2. Prefer a **new tab** (e.g. `Verified 2026-07`) rather than overwriting — the previous sheet mixes real tags with fabricated ones (~80%+ miss rate vs bulk data)
3. File → Import → Upload `archetype-scryfall-tags.csv` → Replace current sheet / Insert new sheet

## What went wrong before (do not repeat)

Previous CSV passes invented plausible hyphenated slugs (`makes-token`, `angels-tutor`,
`aetherflux-reservoir-combo`, card-name `*-effect` tags). Those are **not** Scryfall
tags. Always diff against `oracle_tags` bulk data (or run `verify-archetype-scryfall-tags.py`)
before trusting a row.

Note: Scryfall search accepts some **aliases** with different punctuation
(`otag:board-wipe` → `sweeper`, `otag:self-mill` → `mill-self`). The verified CSV
emits the **canonical slug** from bulk data.
