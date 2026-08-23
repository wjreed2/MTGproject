#!/usr/bin/env node
/**
 * Write fixtures/foundation/*.json from js/foundation-lab/suite-defs.js
 */
const fs = require('fs');
const path = require('path');
const { FOUNDATION_LAB_SUITE_DEFS } = require('../js/foundation-lab/suite-defs.js');
const { writeFixtureIndex } = require('../js/foundation-lab/fixture-loader.js');

const dir = path.join(__dirname, '..', 'fixtures', 'foundation');
fs.mkdirSync(dir, { recursive: true });

const keep = new Set(FOUNDATION_LAB_SUITE_DEFS.map(d => d.id + '.json'));
keep.add('index.json');
for (const name of fs.readdirSync(dir)) {
  if (name.endsWith('.json') && !keep.has(name)) {
    fs.unlinkSync(path.join(dir, name));
  }
}

for (const def of FOUNDATION_LAB_SUITE_DEFS) {
  const out = { ...def };
  delete out._sourcePath;
  const dest = path.join(dir, def.id + '.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

const index = writeFixtureIndex(dir);
console.log('Wrote', index.length, 'Foundation Lab fixtures to', dir);
