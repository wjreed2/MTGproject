#!/usr/bin/env node
'use strict';
/**
 * Pull a deck list from the deployed server by deck id — the id that
 * suggestion_feedback rows carry — so flagged picks can be reviewed against the
 * actual deck. Same target (SEMANTICS_PUSH_URL) and secret as the other internal
 * tools (semantics-push-prod.js, feedback-pull.js).
 *
 * Usage:
 *   npm run deck:pull -- <deckId>                    # print the decklist
 *   npm run deck:pull -- <deckId> --fixture <slug>   # also write engine2/fixtures/pulled/<slug>.json
 *                                                    # (analyze with: node scripts/semantics-analyze-preview.js engine2/fixtures/pulled/<slug>.json)
 *   npm run deck:pull -- <deckId> --api https://127.0.0.1:3001   # target override (local testing)
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const args = process.argv.slice(2);
  const deckId = args.find(a => !a.startsWith('--'));
  const val = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  if (!deckId) { console.error('usage: npm run deck:pull -- <deckId> [--fixture <slug>] [--api <base>]'); process.exit(2); }
  const api = (val('--api') || process.env.SEMANTICS_PUSH_URL || process.env.MTG_API_URL || '').replace(/\/+$/, '');
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || '').trim();
  if (!api || !secret) { console.error('Need SEMANTICS_PUSH_URL and SEMANTICS_INGEST_SECRET in .env'); process.exit(1); }

  const res = await fetch(`${api}/api/internal/deck/${encodeURIComponent(deckId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) { console.error(`pull failed (${res.status}): ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  const { deck, cards, planAdds = [], planCuts = [] } = await res.json();
  const commander = cards.find(c => c.isCommander);
  const rest = cards.filter(c => !c.isCommander);
  const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
  console.log(`${deck.name} · ${deck.format || 'commander'} · ${deck.owner} · ${total} cards`);
  console.log(`commander: ${commander ? commander.name : '(none flagged)'}\n`);
  for (const c of rest) console.log(`${c.qty} ${c.name}`);
  if (planAdds.length) console.log(`\nplanned ADDS (${planAdds.length}): ` + planAdds.map(s => `${s.qty > 1 ? s.qty + ' ' : ''}${s.name}`).join(', '));
  if (planCuts.length) console.log(`planned CUTS (${planCuts.length}): ` + planCuts.map(s => `${s.qty > 1 ? s.qty + ' ' : ''}${s.name}`).join(', '));

  const slug = val('--fixture');
  if (slug) {
    const outDir = path.join(__dirname, '..', 'engine2', 'fixtures', 'pulled');
    fs.mkdirSync(outDir, { recursive: true });
    const fx = {
      name: deck.name, source: 'deck-pull', deck_id: deck.id,
      commander: commander ? commander.name : null,
      cards: rest.map(c => ({ name: c.name, qty: c.qty || 1 })),
      planAdds, planCuts,
    };
    const out = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(out, JSON.stringify(fx, null, 2));
    console.log(`\nwrote ${path.relative(process.cwd(), out)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
