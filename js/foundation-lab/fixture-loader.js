/**
 * Load Foundation Evaluation Lab fixtures from fixtures/foundation/*.json.
 * Node-only. Browser UI fetches the same JSON over /fixtures.
 */
const fs = require('fs');
const path = require('path');

function defaultDir() {
  return path.join(__dirname, '..', '..', 'fixtures', 'foundation');
}

function loadNormalize() {
  return require('./normalize.js');
}

function listFixtureFiles(dir) {
  const root = dir || defaultDir();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(f => f.endsWith('.json') && f !== 'index.json')
    .map(f => path.join(root, f))
    .sort();
}

function loadFoundationFixtures(dir) {
  const { normalizeLabFixture } = loadNormalize();
  const files = listFixtureFiles(dir);
  const fixtures = [];
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fixture = normalizeLabFixture(raw);
    fixture._sourcePath = file;
    if (!fixture.id) fixture.id = path.basename(file, '.json');
    fixtures.push(fixture);
  }
  return fixtures;
}

function loadFoundationFixture(id, dir) {
  const all = loadFoundationFixtures(dir);
  const hit = all.find(f => f.id === id || f.id === String(id).replace(/\.json$/, ''));
  if (!hit) throw new Error('Unknown Foundation fixture: ' + id);
  return hit;
}

function writeFixtureIndex(dir) {
  const root = dir || defaultDir();
  const fixtures = loadFoundationFixtures(root);
  const index = fixtures.map(f => ({
    id: f.id,
    name: f.name,
    archetype: f.archetype,
    commander: f.commander,
    file: f.id + '.json',
  }));
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}

module.exports = {
  defaultDir,
  listFixtureFiles,
  loadFoundationFixtures,
  loadFoundationFixture,
  writeFixtureIndex,
};
