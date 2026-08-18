#!/usr/bin/env node
'use strict';
// Build the radar-chart view of the decks. Reuses the semantic vectors already
// baked into docs/axis-ordination.html: aggregates each card's provides/needs axes
// into the 14 high-level theme categories (shared scripts/lib/axis-categories.js
// map), sums per deck, normalises each category to the field maximum, and inlines
// the result into docs/deck-radar.html.
//
// Usage: node scripts/build-deck-radar.js   (run build-axis-ordination.js first)

const fs = require('fs');
const path = require('path');
const { CATS, catOf } = require('./lib/axis-categories');

const ORD = path.join(__dirname, '..', 'docs', 'axis-ordination.html');
const TEMPLATE = path.join(__dirname, '..', 'docs', 'deck-radar.template.html');
const OUT = path.join(__dirname, '..', 'docs', 'deck-radar.html');

function main() {
  const html = fs.readFileSync(ORD, 'utf8');
  const s = html.indexOf('window.ORDINATION = ') + 'window.ORDINATION = '.length;
  const e = html.indexOf(';\n</script>', s);
  const D = JSON.parse(html.slice(s, e));

  // feature index → category index (baked by the ordination build, with fallback)
  const featCat = D.features.map(f => (f.cat != null ? f.cat : catOf(f.axis)));

  // Per-deck category sums, split into provides (what the deck FILLS) and needs
  // (what the deck WANTS). Commander counted double — it seeds the plan.
  const kind = D.features.map(f => f.kind);          // 'P' provides | 'N' needs
  const prov = D.decks.map(() => new Array(CATS.length).fill(0));
  const need = D.decks.map(() => new Array(CATS.length).fill(0));
  for (const c of D.cards) {
    const mult = c.c ? 2 : 1;
    for (const [j, v] of c.v) {
      const ci = featCat[j]; if (ci < 0) continue;
      (kind[j] === 'N' ? need : prov)[c.d][ci] += v * mult;
    }
  }
  const round = m => m.map(row => row.map(v => Math.round(v * 10) / 10));

  const payload = {
    generated: 'build-deck-radar.js',
    cats: CATS,
    decks: D.decks.map((d, i) => ({
      id: i, commander: d.commander, archetype: d.archetype,
      short: d.commander.split(',')[0],
    })),
    provides: round(prov),
    needs: round(need),
  };

  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  const out = tpl.replace('/*__DATA__*/', () => `window.RADAR = ${JSON.stringify(payload)};`);
  fs.writeFileSync(OUT, out);
  console.log(`decks: ${payload.decks.length} · categories: ${CATS.length}`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(out.length / 1024).toFixed(0)} KB)`);
}

main();
