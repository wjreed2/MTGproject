/**
 * Architecture section ⋮ menu: panel chrome, catalogs, pin/show, plan-facing helpers.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const arch = require(path.join(__dirname, '../js/deck-architecture.js'));
const {
  normalizeArchitectureOverrides,
  showArchitectureSubsection,
  hideArchitectureSubsection,
  isArchitectureSubsectionPinned,
  architectureSubsectionCatalog,
  architectureInferredSubsectionOptions,
  classifyDeckArchitecture,
  architectureViewHtml,
  PAYOFF_FIXED_SUBS,
} = arch;

// Panel menu button appears when editable; inline-SVG kebab icon (ui-ruleset §9.6).
{
  const model = classifyDeckArchitecture({ cards: [], plan: {} }, {}, { cards: [] });
  const editable = architectureViewHtml(model, { canEdit: true });
  assert.ok(editable.includes('data-arch-panel-menu'), 'editable view includes section ⋮');
  assert.ok(/data-arch-panel-menu[^>]*><svg [^>]*aria-hidden="true"/.test(editable), 'section menu uses an inline-SVG icon');
  assert.ok(editable.includes('data-arch-cat="foundation"'), 'foundation panel menu');
  assert.ok(editable.includes('data-arch-cat="strategy"'), 'strategy panel menu');
  assert.ok(editable.includes('data-arch-cat="payoffs"'), 'payoffs panel menu');
  assert.ok(editable.includes('data-arch-cat="manabase"'), 'mana panel menu');
  assert.ok(!editable.includes('arch-unassigned') || !editable.match(/arch-unassigned[\s\S]*data-arch-panel-menu/),
    'unassigned has no section menu');

  const ro = architectureViewHtml(model, { canEdit: false });
  assert.ok(!ro.includes('data-arch-panel-menu'), 'read-only: no section menu');
}

// Catalogs are closed for foundation/mana; strategy/payoffs pull plan + themes.
{
  const foundation = architectureSubsectionCatalog('foundation', {});
  assert.strictEqual(foundation.length, 3);
  assert.ok(foundation.every(x => x.kind === 'fixed'));

  const mana = architectureSubsectionCatalog('manabase', {});
  assert.strictEqual(mana.length, 3);

  const strategy = architectureSubsectionCatalog('strategy', {});
  assert.ok(strategy.some(x => x.id === 'subtag:tokens.makers'), 'strategy includes Type makers');
  assert.ok(strategy.some(x => x.id === 'theme:strategy.tokens'), 'strategy includes theme engines');
  assert.ok(!strategy.some(x => x.id === 'subtag:tokens.payoffs'), 'payoff-ish subtags stay out of strategy catalog');

  const payoffs = architectureSubsectionCatalog('payoffs', {});
  assert.ok(PAYOFF_FIXED_SUBS.every(s => payoffs.some(p => p.id === s.id)), 'fixed payoff piles listed');
  assert.ok(payoffs.some(x => x.id === 'subtag:tokens.payoffs'), 'payoff catalog includes Type payoffs');
}

// show pins + unhides; hide clears pin.
{
  let ov = hideArchitectureSubsection({}, 'foundation', 'interaction');
  assert.ok(normalizeArchitectureOverrides(ov).hiddenSubs.length === 1);
  ov = showArchitectureSubsection(ov, 'foundation', 'interaction');
  assert.strictEqual(normalizeArchitectureOverrides(ov).hiddenSubs.length, 0);
  assert.ok(isArchitectureSubsectionPinned(ov, 'foundation', 'interaction'));
  ov = hideArchitectureSubsection(ov, 'foundation', 'interaction');
  assert.ok(!isArchitectureSubsectionPinned(ov, 'foundation', 'interaction'));
}

// Pinning a strategy subtag forces the pile into the view even when empty.
{
  const planApi = require('../js/deck-plan.js');
  if (typeof planApi.setPlanFeatureEnabled === 'function') planApi.setPlanFeatureEnabled(true);
  const deck = {
    cards: [{ name: 'Sol Ring', qty: 1, type: 'Artifact', customTags: ['Ramp'], scryfallId: 'sol' }],
    plan: { primaryStrategyId: 'strategy.sacrifice', winConditionId: 'wincon.combat' },
    architectureOverrides: {
      byKey: {},
      hiddenSubs: [],
      pinnedSubs: [{ category: 'strategy', subsection: 'subtag:tokens.makers' }],
    },
  };
  const model = classifyDeckArchitecture(deck, deck.plan, {
    cards: deck.cards,
    overrides: deck.architectureOverrides,
  });
  assert.ok(model.strategySubs.some(s => s.id === 'subtag:tokens.makers'), 'pinned strategy sub appears');
  const html = architectureViewHtml(model, { canEdit: true });
  assert.ok(html.includes('Type makers') || html.includes('makers'), 'pinned pile rendered');
}

// Inferred options surface hidden piles.
{
  const model = classifyDeckArchitecture({
    cards: [],
    plan: {},
    architectureOverrides: {
      hiddenSubs: [{ category: 'manabase', subsection: 'ramp' }],
    },
  }, {}, {
    cards: [],
    overrides: { hiddenSubs: [{ category: 'manabase', subsection: 'ramp' }] },
  });
  // After classify, ramp is hidden from the model; inferred still offers restore.
  const inferred = architectureInferredSubsectionOptions('manabase', model, {
    hiddenSubs: [{ category: 'manabase', subsection: 'ramp' }],
  });
  assert.ok(inferred.some(i => i.id === 'ramp' && i.reason === 'hidden'), 'hidden ramp suggested');
}

// Primary / secondary strategy titles wrap their engine piles (Architecture overrides).
{
  const { architectureStrategyBands, architectureViewHtml } = arch;
  const model = classifyDeckArchitecture({
    cards: [{ name: 'Sol Ring', qty: 1, type: 'Artifact', customTags: ['Ramp'], scryfallId: 'sol' }],
    plan: {},
    architectureOverrides: {
      primaryStrategyId: 'strategy.voltron',
      secondaryStrategyId: 'strategy.tokens',
      winConditionId: 'wincon.combat',
    },
  }, {}, {
    cards: [{ name: 'Sol Ring', qty: 1, type: 'Artifact', customTags: ['Ramp'], scryfallId: 'sol' }],
  });
  const bands = architectureStrategyBands(model);
  assert.ok(bands, 'bands when Architecture identity is set');
  assert.strictEqual(bands[0].role, 'primary');
  assert.strictEqual(bands[0].strategyId, 'strategy.voltron');
  assert.ok(bands.some(b => b.role === 'secondary' && b.strategyId === 'strategy.tokens'));
  const html = architectureViewHtml(model, { canEdit: true });
  assert.ok(html.includes('data-arch-strategy-band="primary"'), 'primary band in HTML');
  assert.ok(html.includes('data-arch-strategy-band="secondary"'), 'secondary band in HTML');
  assert.ok(html.includes('arch-strategy-band-body'), 'engine piles nested under band');
  assert.ok(/arch-strategy-band--primary[\s\S]*arch-sub-title">/.test(html), 'primary uses subsection title class');
}

// Off-identity leftovers are labelled Detected themes and start collapsed.
{
  const { architectureStrategyBands, architectureViewHtml } = arch;
  const model = classifyDeckArchitecture({
    cards: [
      { name: 'Sol Ring', qty: 1, type: 'Artifact', customTags: ['Ramp'], scryfallId: 'sol' },
    ],
    plan: {},
    architectureOverrides: {
      primaryStrategyId: 'strategy.voltron',
      winConditionId: 'wincon.combat',
    },
  }, {}, {
    cards: [
      { name: 'Sol Ring', qty: 1, type: 'Artifact', customTags: ['Ramp'], scryfallId: 'sol' },
    ],
  });
  // Pin an off-identity strategy sub so the other band always appears in this test.
  model.strategySubs = (model.strategySubs || []).concat([{
    id: 'theme:landfall_test',
    label: 'Landfall',
    source: 'inferred',
    strategyId: 'strategy.landfall',
    bandId: 'strategy.landfall',
  }]);
  const bands = architectureStrategyBands(model);
  const other = bands && bands.find(b => b.role === 'other');
  assert.ok(other, 'other band for leftovers');
  assert.strictEqual(other.label, 'Detected themes');
  assert.strictEqual(other.collapsed, true);
  const html = architectureViewHtml(model, {});
  assert.ok(html.includes('Detected themes'), 'Detected themes label in HTML');
  assert.ok(!html.includes('Also running'), 'old Also running label gone');
  assert.ok(/<details[^>]*data-arch-strategy-band="other"/.test(html), 'other band is a details element');
  assert.ok(!/<details[^>]*data-arch-strategy-band="other"[^>]*\sopen[\s>]/.test(html), 'Detected themes starts collapsed');
}

// Goal tribal:warrior → strong flattened band (not quiet nested subheader).
{
  const { architectureStrategyBands, architectureViewHtml } = arch;
  const warriors = [
    { name: 'Boldwyr Intimidator', qty: 1, type: 'Creature — Giant Warrior', type_line: 'Creature — Giant Warrior', scryfallId: 'bi' },
    { name: 'Goblin Sharpshooter', qty: 1, type: 'Creature — Goblin', type_line: 'Creature — Goblin', scryfallId: 'gs' },
  ];
  const model = classifyDeckArchitecture({
    cards: warriors,
    plan: {},
  }, {}, {
    cards: warriors,
    goals: [{ goal: 'tribal:warrior', label: 'Warrior Typal', confidence: 0.9 }],
  });
  assert.ok(model.strategySubs.some(s => s.id === 'goal:tribal:warrior'), 'warrior goal pile');
  const bands = architectureStrategyBands(model);
  assert.ok(bands && bands[0], 'bands from goals');
  assert.strictEqual(bands[0].bandId || bands[0].strategyId, 'tribal:warrior');
  assert.ok(/warrior/i.test(bands[0].label), 'band labelled Warrior Typal');
  const html = architectureViewHtml(model, {});
  assert.ok(html.includes('arch-strategy-band--flat') || html.includes('arch-sub--strong'),
    'warrior uses strong/flat chrome');
  assert.ok(html.includes('Warrior Typal') || html.includes('Warrior typal'), 'warrior label in HTML');
}

// Strategy section menu writes architectureOverrides (not deck.plan).
{
  const fs = require('fs');
  const decksSrc = fs.readFileSync(path.join(__dirname, '../js/decks.js'), 'utf8');
  assert.ok(decksSrc.includes('function architectureSetSecondaryStrategy'), 'secondary setter exists');
  assert.ok(decksSrc.includes('data-nav="set-secondary"'), 'section menu offers secondary');
  assert.ok(decksSrc.includes('Set secondary strategy'), 'secondary menu label');
  assert.ok(decksSrc.includes('Set primary strategy'), 'primary menu label');
  assert.ok(decksSrc.includes('_patchArchitectureIdentity'), 'writes via architectureOverrides helper');
  assert.ok(decksSrc.includes('primaryStrategyId: strategyId'), 'patches primaryStrategyId on overrides');
}

console.log('test-arch-panel-menu: ok');

