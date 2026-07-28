#!/usr/bin/env node
/**
 * Concatenate app JS sources and minify to dist/bundle.js.
 * Uses UTF-8 reads so symbols survive minification on Windows (no shell cat pipe).
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const SOURCES = [
  'js/deck-ops.js',
  'js/db-client.js',
  'js/auth.js',
  'js/state.js',
  'js/api.js',
  'js/ui.js',
  'js/trade-core.js',
  'js/ownership.js',
  'js/collection.js',
  'js/sets.js',
  'js/project-role-tags.js',
  'js/archetype-role-bridge.js',
  'js/adds-scoring.js',
  'js/deck-plan.js',
  'js/deck-plan-wizard.js',
  'js/decks.js',
  'js/trade-scoring.js',
  'js/browse.js',
  'js/wishlist.js',
  'js/trade.js',
  'js/import.js',
  'js/analytics.js',
  'js/voice.js',
  'js/games.js',
  'js/phash-core.js',
  'js/scanner-warp-core.js',
  'js/scanner.js',
  'js/goldfish.js',
  'js/engine/engine-effects.js',
  'js/engine/engine-mana.js',
  'js/engine/engine-sba.js',
  'js/engine/engine-static.js',
  'js/engine/engine-replace.js',
  'js/goldfish-engine.js',
];

const combined = SOURCES.map(rel => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing bundle source: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}).join('\n');

const { code } = esbuild.transformSync(combined, { minify: true });
const out = path.join(ROOT, 'dist/bundle.js');
fs.writeFileSync(out, code, 'utf8');
console.log(`Wrote ${path.relative(ROOT, out)} (${(code.length / 1024).toFixed(0)} KiB)`);
