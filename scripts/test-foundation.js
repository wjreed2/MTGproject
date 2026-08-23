#!/usr/bin/env node
/**
 * Foundation Evaluation Lab — batch runner.
 *
 *   npm run test:foundation
 *   npm run test:foundation -- --deck meren-reanimator
 *   npm run test:foundation -- --all
 *   npm run test:foundation -- --json
 *   npm run test:foundation -- --report
 *   npm run test:foundation -- --compare baseline.json current.json
 *   npm run test:foundation -- --ratings path.json
 *
 *   npm run test:foundation -- --user
 *   npm run test:foundation -- --user manfordf@gmail.com
 *   npm run test:foundation -- --user-dir data/foundation-lab/user-decks
 *
 * Default (no --user) is the 23 synthetic fixtures (Kind A recognition lock).
 * --user evaluates every site deck for that account (Kind B/C review), not the synthetics.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadFoundationLab } = require('../js/foundation-lab/load.js');
const {
  loadFoundationFixtures,
  loadFoundationFixture,
  defaultDir,
} = require('../js/foundation-lab/fixture-loader.js');
const {
  FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL,
  loadUserAccountFixtures,
  writeUserAccountFixtures,
  userDecksDir,
} = require('../js/foundation-lab/account-source.js');

loadFoundationLab();
const {
  evaluateFoundationLab,
  compareFoundationRuns,
  formatFoundationCompareReport,
  summarizeFoundationLab,
  formatFoundationCalibrationReport,
  FOUNDATION_CONFIG,
  cloneFoundationConfig,
} = globalThis;

function parseArgs(argv) {
  const args = {
    all: true,
    json: false,
    report: false,
    deck: null,
    compare: null,
    ratings: null,
    out: null,
    config: null,
    user: null,
    userDir: null,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--all') args.all = true;
    else if (a === '--json') args.json = true;
    else if (a === '--report') args.report = true;
    else if (a === '--deck') { args.deck = rest[++i]; args.all = false; }
    else if (a === '--compare') {
      args.compare = [rest[++i], rest[++i]];
    } else if (a === '--ratings') args.ratings = rest[++i];
    else if (a === '--out') args.out = rest[++i];
    else if (a === '--config') args.config = rest[++i];
    else if (a === '--user-dir') args.userDir = rest[++i];
    else if (a === '--user') {
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) args.user = rest[++i];
      else args.user = FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL;
    }
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
}

function loadRatings(p) {
  if (!p) return [];
  const raw = loadJson(p);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.ratings)) return raw.ratings;
  return [];
}

function runsDir() {
  const dir = path.join(__dirname, '..', 'data', 'foundation-lab', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

function loadConfigOverride(p) {
  if (!p) return FOUNDATION_CONFIG;
  const patch = loadJson(p);
  if (typeof cloneFoundationConfig === 'function') return cloneFoundationConfig(patch);
  return Object.assign(deepClone(FOUNDATION_CONFIG), patch);
}

function runSuite(fixtures, config) {
  const decks = [];
  const errors = [];
  for (const fixture of fixtures) {
    try {
      const result = evaluateFoundationLab(fixture, { source: 'cli' }, config);
      const stored = { ...result };
      delete stored.engine;
      if (stored.structErrors && stored.structErrors.length) {
        errors.push({ deck: fixture.id, errors: stored.structErrors });
      }
      decks.push(stored);
    } catch (err) {
      errors.push({ deck: fixture.id, errors: [String(err && err.stack || err)] });
      decks.push({
        fixtureId: fixture.id,
        name: fixture.name,
        health: 'suspicious',
        structErrors: [String(err && err.message || err)],
        adds: [],
        cuts: [],
        capabilityCoverage: {},
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    engineVersion: (config && config.version) || (FOUNDATION_CONFIG && FOUNDATION_CONFIG.version),
    configVersion: (config && config.version) || (FOUNDATION_CONFIG && FOUNDATION_CONFIG.version),
    fixtureCount: fixtures.length,
    errorCount: errors.length,
    errors,
    decks,
  };
}

function printHuman(run, ratings) {
  const sum = summarizeFoundationLab(run, ratings);
  console.log(formatFoundationCalibrationReport(sum, run));
  if (run.errors && run.errors.length) {
    console.log('\nErrors:');
    for (const e of run.errors) console.log('  ', e.deck, e.errors.join('; '));
  }
}

async function pullAccountFixtures(email) {
  const api = (process.env.SEMANTICS_PUSH_URL || process.env.MTG_API_URL || '').replace(/\/+$/, '');
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || '').trim();
  if (!api || !secret) return null;
  const url = `${api}/api/internal/account-decks?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) {
    throw new Error(`account-decks pull failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const payload = await res.json();
  writeUserAccountFixtures(payload);
  return payload.fixtures || [];
}

async function resolveFixtures(args) {
  if (args.userDir) {
    const loaded = loadUserAccountFixtures(args.userDir);
    return { fixtures: loaded.fixtures, source: 'account', email: loaded.email };
  }
  if (args.user) {
    const email = args.user;
    try {
      const pulled = await pullAccountFixtures(email);
      if (pulled && pulled.length) return { fixtures: pulled, source: 'account', email };
    } catch (err) {
      console.error(err.message);
    }
    const dumped = loadUserAccountFixtures(userDecksDir());
    if (dumped.fixtures.length) {
      return { fixtures: dumped.fixtures, source: 'account', email: dumped.email || email };
    }
    throw new Error(
      'No account decks. Set SEMANTICS_PUSH_URL + SEMANTICS_INGEST_SECRET and run '
      + '`npm run foundation:pull-user-decks`, or open Foundation Lab on the hosted app as admin.'
    );
  }
  if (args.deck) {
    return { fixtures: [loadFoundationFixture(args.deck, defaultDir())], source: 'synthetic' };
  }
  return { fixtures: loadFoundationFixtures(defaultDir()), source: 'synthetic' };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Foundation Evaluation Lab

  npm run test:foundation
  npm run test:foundation -- --deck <id>
  npm run test:foundation -- --all --json --report
  npm run test:foundation -- --compare baseline.json current.json
  npm run test:foundation -- --ratings ratings.json --report
  npm run test:foundation -- --user
  npm run test:foundation -- --user manfordf@gmail.com
  npm run test:foundation -- --user-dir data/foundation-lab/user-decks
`);
    return 0;
  }

  if (args.compare) {
    const [a, b] = args.compare;
    if (!a || !b) {
      console.error('--compare requires two JSON paths');
      return 1;
    }
    const cmp = compareFoundationRuns(loadJson(a), loadJson(b));
    console.log(formatFoundationCompareReport(cmp));
    if (args.json) console.log(JSON.stringify(cmp, null, 2));
    return cmp.concerning ? 2 : 0;
  }

  let resolved;
  try {
    resolved = await resolveFixtures(args);
  } catch (err) {
    console.error(String(err && err.message || err));
    return 1;
  }
  const fixtures = resolved.fixtures;
  if (!fixtures.length) {
    console.error('No Foundation fixtures');
    return 1;
  }

  const config = loadConfigOverride(args.config);
  const run = runSuite(fixtures, config);
  run.source = resolved.source;
  if (resolved.email) run.accountEmail = resolved.email;
  const ratings = loadRatings(args.ratings);

  const outPath = args.out || path.join(runsDir(), 'latest.json');
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2) + '\n', 'utf8');

  if (args.json) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    printHuman(run, ratings);
    console.log('\nWrote', outPath);
    if (resolved.source === 'account') {
      console.log('Source: account decks' + (resolved.email ? ` (${resolved.email})` : ''));
    }
  }

  if (args.report && !args.json) {
    /* already printed */
  }

  return run.errorCount ? 1 : 0;
}

main().then(code => process.exit(code)).catch(err => {
  console.error(err);
  process.exit(1);
});
