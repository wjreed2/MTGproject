/**
 * Suggested Adds must not recommend cards with zero utility role tags.
 * Land / Commander alone do not count.
 */
const assert = require('assert');

function utilityAddRoles(roles) {
  return (roles || []).filter(t => t && t !== 'Land' && t !== 'Commander');
}

function filterAddCandidates(pool) {
  return pool.filter(c => utilityAddRoles(c.roleTags || c._tags || []).length > 0);
}

const pool = [
  { name: 'Sol Ring', roleTags: ['Ramp'] },
  { name: 'Swords to Plowshares', roleTags: ['Removal'] },
  { name: 'Generic Beater', roleTags: [] },
  { name: 'Only Land Tag', roleTags: ['Land'] },
  { name: 'Only Commander Tag', roleTags: ['Commander'] },
  { name: 'Land plus Ramp', roleTags: ['Land', 'Ramp'] },
  { name: 'Custom Draw', _tags: ['Card Draw'] },
];

const kept = filterAddCandidates(pool).map(c => c.name);
assert.deepStrictEqual(kept, ['Sol Ring', 'Swords to Plowshares', 'Land plus Ramp', 'Custom Draw']);

assert.strictEqual(utilityAddRoles([]).length, 0);
assert.strictEqual(utilityAddRoles(['Land', 'Commander']).length, 0);
assert.strictEqual(utilityAddRoles(['Land', 'Ramp']).length, 1);
assert.strictEqual(utilityAddRoles([null, '', 'Removal']).length, 1);

console.log('test-adds-require-role-tag: ok');
