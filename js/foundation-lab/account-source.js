/**
 * Node helpers for Lab account-deck dumps (gitignored user data).
 */
const fs = require('fs');
const path = require('path');

function defaultLabAccountEmail() {
  return String(process.env.FOUNDATION_LAB_DEFAULT_ACCOUNT || '').trim().toLowerCase();
}

function userDecksDir() {
  return path.join(__dirname, '..', '..', 'data', 'foundation-lab', 'user-decks');
}

function loadNormalize() {
  return require('./normalize.js');
}

function loadLive() {
  return require('./live-decks.js');
}

function summarizeFixtures(fixtures, email) {
  let copies = 0;
  let unique = 0;
  let withIr = 0;
  const seen = new Set();
  const axisFreq = {};
  for (const f of fixtures || []) {
    for (const c of f.cards || []) {
      copies += Math.max(1, Number(c.qty) || 1);
      const key = String(c.oracleId || c.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique += 1;
      const ir = c.ir || c.cardIR;
      if (ir && ((ir.provides && ir.provides.length) || (ir.needs && ir.needs.length) || (ir.roles && ir.roles.length))) {
        withIr += 1;
        for (const entry of (ir.provides || [])) {
          const axis = (entry && entry.axis) || entry;
          if (!axis) continue;
          axisFreq[axis] = (axisFreq[axis] || 0) + 1;
        }
      }
    }
  }
  return {
    email: email || null,
    deckCount: (fixtures || []).length,
    uniqueCards: unique,
    cardCopies: copies,
    uniqueWithIr: withIr,
    irCoverage: unique ? Math.round((withIr / unique) * 1000) / 1000 : 0,
    provideAxisFrequencies: axisFreq,
  };
}

function loadUserAccountFixtures(dir) {
  const root = dir || userDecksDir();
  const indexPath = path.join(root, 'index.json');
  if (!fs.existsSync(indexPath)) {
    return { email: null, fixtures: [], coverage: null, pulledAt: null };
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const { normalizeLabFixture } = loadNormalize();
  const fixtures = [];
  const entries = index.decks || index.fixtures || [];
  for (const entry of entries) {
    const file = path.join(root, entry.file || `${entry.id}.json`);
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fixture = normalizeLabFixture(raw);
    if (!fixture.id) fixture.id = entry.id || path.basename(file, '.json');
    fixture.source = raw.source || 'account';
    fixture.accountEmail = raw.accountEmail || index.email || null;
    fixture.liveDeckId = raw.liveDeckId || raw.id || null;
    fixtures.push(fixture);
  }
  return {
    email: index.email || null,
    fixtures,
    coverage: index.coverage || summarizeFixtures(fixtures, index.email),
    pulledAt: index.pulledAt || null,
  };
}

function writeUserAccountFixtures(payload, dir) {
  const root = dir || userDecksDir();
  fs.mkdirSync(root, { recursive: true });
  const fixtures = payload.fixtures || [];
  const email = payload.email || DEFAULT_EMAIL;
  const coverage = payload.coverage || summarizeFixtures(fixtures, email);
  const decks = fixtures.map(f => {
    const id = f.id || 'deck';
    const file = `${id}.json`;
    fs.writeFileSync(path.join(root, file), JSON.stringify(f, null, 2) + '\n', 'utf8');
    return { id, name: f.name, commander: f.commander, file, liveDeckId: f.liveDeckId || null };
  });
  const index = {
    email,
    pulledAt: payload.pulledAt || new Date().toISOString(),
    deckCount: fixtures.length,
    coverage: {
      deckCount: coverage.deckCount,
      uniqueCards: coverage.uniqueCards,
      cardCopies: coverage.cardCopies,
      uniqueWithIr: coverage.uniqueWithIr,
      irCoverage: coverage.irCoverage,
    },
    decks,
  };
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}

function liveDecksToFixtures(decks, irByOracle, email) {
  const { liveDeckToLabFixture } = loadLive();
  return (decks || []).map(d => liveDeckToLabFixture(d, irByOracle, email));
}

module.exports = {
  FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL: defaultLabAccountEmail(),
  defaultLabAccountEmail,
  userDecksDir,
  loadUserAccountFixtures,
  writeUserAccountFixtures,
  summarizeFixtures,
  liveDecksToFixtures,
};
