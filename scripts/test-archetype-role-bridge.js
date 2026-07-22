/**
 * Archetype ↔ project role-tag bridge integrity.
 */
const assert = require('assert');
const roles = require('../js/project-role-tags.js');
const bridge = require('../js/archetype-role-bridge.js');
const plan = require('../js/deck-plan.js');

assert.strictEqual(bridge.BRIDGE_LABEL_ERRORS.length, 0,
  'bridge labels must all be project role tags: ' + bridge.BRIDGE_LABEL_ERRORS.join('; '));

// Every strategy/wincon label is a real project role tag
for (const [id, labels] of Object.entries(bridge.STRATEGY_PROJECT_TAGS)) {
  for (const label of labels) {
    assert.ok(roles.isProjectRoleLabel(label), `${id} → ${label} must be a project role tag`);
  }
}
for (const [id, labels] of Object.entries(bridge.WINCON_PROJECT_TAGS)) {
  for (const label of labels) {
    assert.ok(roles.isProjectRoleLabel(label), `${id} → ${label} must be a project role tag`);
  }
}

// deck-plan consumes the same map object identity / contents
assert.deepStrictEqual(
  [...(plan.PLAN_STRATEGY_PROJECT_TAGS['strategy.tokens'] || [])],
  [...bridge.STRATEGY_PROJECT_TAGS['strategy.tokens']],
  'deck-plan tokens strategy tags come from bridge'
);
assert.ok(
  plan.PLAN_STRATEGY_PROJECT_TAGS['strategy.tribal'].includes('Anthem'),
  'tribal strategy now maps to project labels (was empty)'
);

// Sheet archetype → strategy → labels path
assert.strictEqual(bridge.strategyForArchetype('Tokens (Go-Wide)'), 'strategy.tokens');
assert.strictEqual(bridge.strategyForArchetype('Tribal (Dragons)'), 'strategy.tribal');
assert.ok(bridge.projectLabelsForStrategy('strategy.sacrifice').includes('Sac Outlet'));

// Backing queries exist for every project label used by strategies
for (const labels of Object.values(bridge.STRATEGY_PROJECT_TAGS)) {
  for (const label of labels) {
    const q = roles.scryfallQueryForLabel(label);
    assert.ok(q, `scryfall backing missing for ${label}`);
  }
}

// Enrichment otags are NOT project labels (guard against accidental promotion)
const enrichment = bridge.enrichmentOtagsForStrategy('strategy.tokens');
assert.ok(enrichment.includes('repeatable-creature-tokens'));
assert.ok(!roles.isProjectRoleLabel('repeatable-creature-tokens'),
  'enrichment otags must not be treated as project role labels');

const rows = bridge.bridgeRows();
assert.ok(rows.length > 50, 'bridge CSV rows should cover archetypes');
assert.ok(rows.every(r => !r.projectRoleTag || roles.isProjectRoleLabel(r.projectRoleTag)));

console.log('[archetype-role-bridge] ok —', rows.length, 'bridge rows,',
  roles.PROJECT_ROLE_TAGS.length, 'project role tags');
