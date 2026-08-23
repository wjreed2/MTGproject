#!/usr/bin/env node
'use strict';
/**
 * Pull every deck for an account from the hosted app into a gitignored Lab dump.
 *
 *   npm run foundation:pull-user-decks
 *   npm run foundation:pull-user-decks -- --email manfordf@gmail.com
 *   npm run foundation:pull-user-decks -- --api https://127.0.0.1:3001
 *
 * Uses SEMANTICS_PUSH_URL + SEMANTICS_INGEST_SECRET (same as deck:pull).
 * Does not commit decklists. Does not regenerate CardIR.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const {
  FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL,
  writeUserAccountFixtures,
  userDecksDir,
} = require('../js/foundation-lab/account-source.js');

async function main() {
  const args = process.argv.slice(2);
  const val = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const email = (val('--email') || FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL).trim().toLowerCase();
  const api = (val('--api') || process.env.SEMANTICS_PUSH_URL || process.env.MTG_API_URL || '').replace(/\/+$/, '');
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || '').trim();
  if (!api || !secret) {
    console.error('Need SEMANTICS_PUSH_URL (or MTG_API_URL) and SEMANTICS_INGEST_SECRET in .env');
    process.exit(1);
  }
  const url = `${api}/api/internal/account-decks?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) {
    console.error(`pull failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
    process.exit(1);
  }
  const payload = await res.json();
  if (payload.error && !payload.fixtures?.length) {
    console.error(payload.error);
    process.exit(1);
  }
  payload.pulledAt = new Date().toISOString();
  const index = writeUserAccountFixtures(payload);
  const cov = payload.coverage || index.coverage || {};
  console.log(`Wrote ${index.deckCount} decks for ${email} → ${path.relative(process.cwd(), userDecksDir())}`);
  console.log(`IR coverage: ${cov.uniqueWithIr || 0}/${cov.uniqueCards || 0} unique cards (${Math.round((cov.irCoverage || 0) * 100)}%)`);
}

main().catch(e => { console.error(e); process.exit(1); });
