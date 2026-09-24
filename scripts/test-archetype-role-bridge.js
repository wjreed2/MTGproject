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
// Tokens is an umbrella now, so the archetype that names the plan lands on the
// Go Wide child. Token doublers stay on the umbrella — they double whatever the
// deck makes, Treasure included.
assert.strictEqual(bridge.strategyForArchetype('Tokens (Go-Wide)'), 'strategy.tokens.go_wide');
assert.strictEqual(bridge.strategyForArchetype('Doubling / Copy Effects'), 'strategy.tokens');
assert.ok(bridge.projectLabelsForStrategy('strategy.tokens.go_wide').includes('Anthem'));
assert.strictEqual(bridge.strategyForArchetype('Tribal (Dragons)'), 'strategy.typal.dragon');
assert.strictEqual(bridge.strategyForArchetype('Equipment'), 'strategy.equipment');
assert.strictEqual(bridge.strategyForArchetype('Copy/Clone'), 'strategy.spellslinger');
assert.strictEqual(bridge.strategyForArchetype('Enchantress'), 'strategy.auras');
assert.strictEqual(bridge.strategyForArchetype('Lifegain'), 'strategy.lifegain');
assert.strictEqual(bridge.strategyForArchetype('Combo'), 'strategy.combo');
assert.strictEqual(bridge.strategyForArchetype('Vehicles'), 'strategy.vehicles');
assert.ok(bridge.projectLabelsForStrategy('strategy.sacrifice').includes('Sac Outlet'));
assert.ok(bridge.projectLabelsForStrategy('strategy.blink').includes('Blink'));
assert.ok(!bridge.projectLabelsForStrategy('strategy.blink').includes('Copy'),
  'Copy belongs with Spellslinger, not Blink');
assert.ok(bridge.projectLabelsForStrategy('strategy.spellslinger').includes('Copy'));
assert.ok(bridge.enrichmentOtagsForStrategy('strategy.equipment').includes('synergy-equipment'));
assert.ok(!bridge.enrichmentOtagsForStrategy('strategy.voltron').includes('synergy-equipment'),
  'equipment otags peeled off Voltron');

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

assert.deepStrictEqual(roles.demoteRampTutorLabels(['Ramp', 'Tutor']), ['Ramp']);
assert.ok(String(roles.scryfallQueryForLabel('Tutor') || '').includes('-otag:ramp'),
  'Tutor query excludes ramp land-searches');

// Combat row: present in both catalogs, tags resolve, archetype sheet points at it.
assert.ok(plan.PLAN_STRATEGIES.some(s => s.id === 'strategy.combat'), 'strategy.combat in PLAN_STRATEGIES');
assert.ok(plan.PLAN_STRATEGY_SHORTLIST_IDS.includes('strategy.combat'), 'strategy.combat is shortlisted');
assert.deepStrictEqual(bridge.STRATEGY_PROJECT_TAGS['strategy.combat'],
  ['Attack Trigger', 'Saboteur', 'Extra Combat', 'Combat Trick']);
assert.strictEqual(bridge.strategyForArchetype('Extra Combats'), 'strategy.combat');
// Aggro stays its own (future) row — speed, not engine. See strategy-aggro-research-handoff.md.
assert.notStrictEqual(bridge.strategyForArchetype('Aggro'), 'strategy.combat',
  'Aggro is a speed row, not Combat');
// Both new labels are otag-backed and were verified against the Scryfall API.
assert.strictEqual(roles.scryfallQueryForLabel('Attack Trigger'), 'otag:attack-trigger');
assert.strictEqual(roles.scryfallQueryForLabel('Saboteur'), 'otag:saboteur');

const rows = bridge.bridgeRows();
assert.ok(rows.length > 50, 'bridge CSV rows should cover archetypes');
assert.ok(rows.every(r => !r.projectRoleTag || roles.isProjectRoleLabel(r.projectRoleTag)));

console.log('[archetype-role-bridge] ok —', rows.length, 'bridge rows,',
  roles.PROJECT_ROLE_TAGS.length, 'project role tags');
