#!/usr/bin/env node
'use strict';
// Fetch the engine2 test-deck fixtures (docs/engine2-plan.md "Working setup").
//
// Sources:
//   • EDHREC average decks (default manifest below) — the "consensus popular deck" per
//     commander; stable, archetype-canonical, no deck-id hunting.
//   • Archidekt / Moxfield deck URLs passed as CLI args — for hand-picked real lists.
//
// Output: engine2/fixtures/decks/<slug>.json
//   { name, commander, source, source_url, archetype_expected, cards: [{name, qty}] }
// cards excludes the commander. Fixtures are committed; the extraction pilot seeds from
// the union of unique names across all fixtures (semantics-extract.js --pilot).
//
// Usage:
//   node scripts/fetch-test-decks.js                 # fetch missing manifest decks
//   node scripts/fetch-test-decks.js --force         # refetch everything
//   node scripts/fetch-test-decks.js --only korvold-aristocrats
//   node scripts/fetch-test-decks.js https://archidekt.com/decks/123456 --archetype aristocrats --slug my-deck

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'engine2', 'fixtures', 'decks');

// One per archetype (plan §Working setup). slug → EDHREC commander slug + expected goal.
const MANIFEST = [
  { slug: 'korvold-aristocrats',  edhrec: 'korvold-fae-cursed-king',      archetype: 'aristocrats' },
  { slug: 'edgar-vampires',       edhrec: 'edgar-markov',                 archetype: 'tribal:Vampire' },
  { slug: 'ur-dragon-dragons',    edhrec: 'the-ur-dragon',                archetype: 'tribal:Dragon' },
  { slug: 'talrand-spellslinger', edhrec: 'talrand-sky-summoner',         archetype: 'spellslinger' },
  { slug: 'meren-reanimator',     edhrec: 'meren-of-clan-nel-toth',       archetype: 'reanimator' },
  { slug: 'krenko-goblins',       edhrec: 'krenko-mob-boss',              archetype: 'tokens-wide' },
  { slug: 'chulane-blink',        edhrec: 'chulane-teller-of-tales',      archetype: 'blink' },
  { slug: 'atraxa-counters',      edhrec: 'atraxa-praetors-voice',        archetype: 'counters' },
  { slug: 'muldrotha-graveyard',  edhrec: 'muldrotha-the-gravetide',      archetype: 'graveyard' },
  { slug: 'yuriko-ninjas',        edhrec: 'yuriko-the-tigers-shadow',     archetype: 'tribal:Ninja' },
  { slug: 'sythis-enchantress',   edhrec: 'sythis-harvests-hand',         archetype: 'enchantress' },
  { slug: 'omnath-landfall',      edhrec: 'omnath-locus-of-creation',     archetype: 'landfall' },
];

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MTGproject-engine2/1.0', ...headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

function aggregate(entries) {
  // entries: [{name, qty}] possibly with repeats → merged, sorted for stable diffs
  const byName = new Map();
  for (const e of entries) {
    const name = String(e.name || '').trim();
    if (!name) continue;
    byName.set(name, (byName.get(name) || 0) + (e.qty || 1));
  }
  return [...byName.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => a.name.localeCompare(b.name));
}

async function fromEdhrec(slug) {
  const url = `https://json.edhrec.com/pages/average-decks/${slug}.json`;
  const data = await fetchJson(url);
  const lines = Array.isArray(data.deck) ? data.deck : null;
  if (!lines || !lines.length) throw new Error(`${url}: no "deck" list in response`);
  const entries = lines.map(line => {
    const m = String(line).match(/^(\d+)\s+(.+)$/);
    return m ? { qty: parseInt(m[1], 10), name: m[2] } : { qty: 1, name: String(line) };
  });
  // Commander = first line (EDHREC lists it first on average-deck pages)
  const commander = entries[0].name;
  return {
    name: `Average ${commander} deck (EDHREC)`,
    commander,
    source: 'edhrec-average',
    source_url: url,
    cards: aggregate(entries.slice(1)),
  };
}

async function fromArchidekt(deckId) {
  const url = `https://archidekt.com/api/decks/${deckId}/`;
  const data = await fetchJson(url);
  const EXCLUDE = new Set(['maybeboard', 'sideboard', 'considering']);
  // Categories flagged includedInDeck:false (custom maybeboards) are excluded too.
  const notInDeck = new Set(
    (data.categories || []).filter(c => c && c.includedInDeck === false).map(c => String(c.name).toLowerCase())
  );
  let commander = null;
  const entries = [];
  for (const c of data.cards || []) {
    const name = c?.card?.oracleCard?.name;
    const cats = (c?.categories || []).map(x => String(x).toLowerCase());
    if (!name) continue;
    if (cats.some(x => EXCLUDE.has(x) || notInDeck.has(x))) continue;
    if (cats.includes('commander')) { commander = commander || name; continue; }
    entries.push({ name, qty: c.quantity || 1 });
  }
  return { name: data.name || `Archidekt ${deckId}`, commander, source: 'archidekt', source_url: `https://archidekt.com/decks/${deckId}`, cards: aggregate(entries) };
}

async function fromMoxfield(deckId) {
  const url = `https://api2.moxfield.com/v2/decks/all/${deckId}`;
  const data = await fetchJson(url);
  const commander = Object.keys(data.commanders || {})[0] || null;
  const entries = Object.entries(data.mainboard || {}).map(([name, v]) => ({ name, qty: v?.quantity || 1 }));
  return { name: data.name || `Moxfield ${deckId}`, commander, source: 'moxfield', source_url: `https://www.moxfield.com/decks/${deckId}`, cards: aggregate(entries) };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyIx = args.indexOf('--only');
  const only = onlyIx >= 0 ? args[onlyIx + 1] : null;
  const urlArgs = args.filter(a => /^https?:\/\//.test(a));
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jobs = [];

  for (const m of MANIFEST) {
    if (only && m.slug !== only) continue;
    jobs.push({ slug: m.slug, archetype: m.archetype, fetch: () => fromEdhrec(m.edhrec) });
  }
  for (const url of urlArgs) {
    const slug = flag('--slug') || url.replace(/^https?:\/\//, '').replace(/[^\w-]+/g, '-').slice(0, 50);
    const archetype = flag('--archetype') || 'unknown';
    let job = null;
    const arch = url.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/);
    const mox = url.match(/moxfield\.com\/decks\/([\w-]+)/);
    if (arch) job = () => fromArchidekt(arch[1]);
    else if (mox) job = () => fromMoxfield(mox[1]);
    else { console.error(`skip: unrecognized URL ${url}`); continue; }
    jobs.push({ slug, archetype, fetch: job });
  }

  let wrote = 0, skipped = 0, failedCount = 0;
  for (const j of jobs) {
    const file = path.join(OUT_DIR, `${j.slug}.json`);
    if (!force && fs.existsSync(file)) { skipped++; continue; }
    try {
      const deck = await j.fetch();
      if (!deck.commander) throw new Error('no commander detected');
      const total = deck.cards.reduce((s, c) => s + c.qty, 0);
      const fixture = { ...deck, archetype_expected: j.archetype };
      fs.writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
      console.log(`✓ ${j.slug}: ${deck.commander} — ${deck.cards.length} unique / ${total} cards (${j.archetype})`);
      wrote++;
    } catch (e) {
      console.error(`✗ ${j.slug}: ${e.message}`);
      failedCount++;
    }
    await new Promise(r => setTimeout(r, 400)); // be polite to upstream APIs
  }

  // Union summary for the pilot
  const union = new Set();
  for (const f of fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json'))) {
    const fx = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    if (fx.commander) union.add(fx.commander);
    for (const c of fx.cards || []) union.add(c.name);
  }
  console.log(`\n${wrote} written, ${skipped} already present, ${failedCount} failed`);
  console.log(`pilot union: ${union.size} unique card names across all deck fixtures`);
  process.exit(failedCount ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
