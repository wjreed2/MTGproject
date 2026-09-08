#!/usr/bin/env node
/**
 * Concatenate app JS sources and minify into dist/bundle.js plus lazily-loaded
 * feature chunks (dist/chunk-*.js). Uses UTF-8 reads so symbols survive
 * minification on Windows (no shell cat pipe).
 *
 * Chunks are classic scripts injected on first use by js/lazy-chunks.js — see
 * the stub list there for the entry points. Rules that keep the split safe:
 *  - File order inside each chunk matters (const bindings: phash-core before
 *    scanner.js; goldfish.js before goldfish-engine.js — the engine overlay's
 *    markup calls plain-goldfish functions, and the duplicated gfTutor* symbols
 *    must keep goldfish-engine's versions winning).
 *  - js/engine/engine-mana.js stays in CORE: api.js resolveCardCmc() uses its
 *    parseMana() on common render paths.
 *  - A file may appear in exactly one output.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');

const CHUNKS = {
  'bundle': [
    'js/deck-ops.js',
    'js/db-client.js',
    'js/auth.js',
    'js/state.js',
    'js/api.js',
    'js/engine/engine-mana.js', // parseMana used by api.js resolveCardCmc on render paths
    'js/ui.js',
    'js/lazy-chunks.js',
    'js/trade-core.js',
    'js/ownership.js',
    'js/collection.js',
    'js/sets.js',
    'js/project-role-tags.js',
    'js/archetype-role-bridge.js',
    'js/adds-scoring.js',
    'js/foundation/foundation-config.js',
    'js/foundation/foundation-mechanisms.js',
    'js/foundation/foundation-engine.js',
    'js/foundation/foundation-suggest.js',
    'js/commander-plan-ext.js',
    'js/deck-plan.js',
    'js/deck-plan-wizard.js',
    'js/deck-themes.js',
    'js/decks.js',
    'js/deck-export.js',
    'js/trade-scoring.js',
    'js/browse.js',
    'js/wishlist.js',
    'js/trade.js',
    'js/deck-map.js',
    'js/analytics.js',
    'js/game-seats.js',
    'js/game-num-wheel.js',
    'js/games.js',
    'js/playgroups.js',
  ],
  'chunk-import': ['js/import.js'],
  'chunk-voice': ['js/voice.js'],
  'chunk-scanner': [
    'js/phash-core.js',
    'js/scanner-warp-core.js',
    'js/scanner.js',
  ],
  'chunk-goldfish': [
    'js/goldfish.js',
    'js/engine/engine-effects.js',
    'js/engine/engine-sba.js',
    'js/engine/engine-static.js',
    'js/engine/engine-replace.js',
    'js/goldfish-engine.js',
  ],
};

// Guard: no source may land in two outputs (double top-level const/let would throw).
{
  const seen = new Map();
  for (const [out, files] of Object.entries(CHUNKS)) {
    for (const f of files) {
      if (seen.has(f)) throw new Error(`${f} listed in both ${seen.get(f)} and ${out}`);
      seen.set(f, out);
    }
  }
}

for (const [out, files] of Object.entries(CHUNKS)) {
  const combined = files.map(rel => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) throw new Error(`Missing bundle source: ${rel}`);
    return fs.readFileSync(abs, 'utf8');
  }).join('\n');
  const { code } = esbuild.transformSync(combined, { minify: true });
  const outPath = path.join(ROOT, `dist/${out}.js`);
  fs.writeFileSync(outPath, code, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outPath)} (${(code.length / 1024).toFixed(0)} KiB)`);
}
