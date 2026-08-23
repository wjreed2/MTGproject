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
 * Does not modify production scoring. Human ratings are evidence only.
 */
const fs = require('fs');
const path = require('path');

const { loadFoundationLab } = require('../js/foundation-lab/load.js');
const {
  loadFoundationFixtures,
  loadFoundationFixture,
  defaultDir,
} = require('../js/foundation-lab/fixture-loader.js');

loadFoundationLab();
const {
  evaluateFoundationLab,
  compareFoundationRuns,
  formatFoundationCompareReport,
  summarizeFoundationLab,
  formatFoundationCalibrationReport,
  FOUNDATION_CONFIG,
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
  return JSON.parse(JSON.stringify(obj));
}

function loadConfigOverride(p) {
  if (!p) return FOUNDATION_CONFIG;
  const patch = loadJson(p);
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

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Foundation Evaluation Lab

  npm run test:foundation
  npm run test:foundation -- --deck <id>
  npm run test:foundation -- --all --json --report
  npm run test:foundation -- --compare baseline.json current.json
  npm run test:foundation -- --ratings ratings.json --report
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

  const fixtures = args.deck
    ? [loadFoundationFixture(args.deck, defaultDir())]
    : loadFoundationFixtures(defaultDir());
  if (!fixtures.length) {
    console.error('No Foundation fixtures in', defaultDir());
    return 1;
  }

  const config = loadConfigOverride(args.config);
  const run = runSuite(fixtures, config);
  const ratings = loadRatings(args.ratings);

  const outPath = args.out || path.join(runsDir(), 'latest.json');
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2) + '\n', 'utf8');

  if (args.json) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    printHuman(run, ratings);
    console.log('\nWrote', outPath);
  }

  if (args.report && !args.json) {
    /* already printed */
  }

  return run.errorCount ? 1 : 0;
}

process.exit(main());
