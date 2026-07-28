# MTG Archive

[![CI](https://github.com/wjreed2/MTGproject/actions/workflows/ci.yml/badge.svg)](https://github.com/wjreed2/MTGproject/actions/workflows/ci.yml)

A Magic: The Gathering collection manager, deckbuilder, goldfish playtester, card
scanner, and trade platform. Node/Express + MySQL backend, vanilla-JS front end
bundled by esbuild, deployed on Railway.

## Tests

Run everything locally:

```bash
npm test          # engine + scanner suites (no DB/network needed)
```

CI (GitHub Actions, see the **Actions** tab and the badge above) runs on every
push and pull request to `main`/`development`:

| Suite | Covers | Tests |
|---|---|---|
| `engine-smoke-test.js` | Game-engine effect / SBA / mana parsing | 34 |
| `engine-integration-test.js` | Goldfish engine runtime — counters, proliferate, sagas, deck-out, commander/poison loss | 44 |
| `phash-smoke-test.js` | Scanner pHash fingerprint determinism (DCT / Hamming / luma) | 13 |

CI also rebuilds `dist/bundle.js` and fails if it doesn't match the committed
copy — so a source change that wasn't re-bundled is caught before it ships.

Other checks that aren't in CI (need a live server + MySQL, or the network):

```bash
npm run test:phash            # scanner fingerprint only (subset of npm test)
node scripts/test-mtgjson-stream.js   # MTGJSON price-stream parser (hits the network)
```

## Build & run

```bash
npm install
npm run build:bundle   # compile js/*.js -> dist/bundle.js
npm start              # serve on PORT (default 3001)
```
