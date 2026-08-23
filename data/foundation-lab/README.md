# Foundation Evaluation Lab

Calibration / development harness for Foundation v1. Not a user-facing Hybrid mode.

- Fixtures: `fixtures/foundation/`
- Adapter: `js/foundation-lab/` wrapping `evaluateFoundation` (does not retune production scoring)
- CLI: `npm run test:foundation`
- UI: `/foundation-lab.html` (dev server)
- Ratings: localStorage export, or drop a JSON file here as `ratings.json` and pass `--ratings`

Run outputs land in `runs/` (gitignored). Human ratings never feed the engine.
