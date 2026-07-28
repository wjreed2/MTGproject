// Runtime integration test: loads the real goldfish engine with a stubbed DOM
// and exercises typed counters, proliferate, sagas, deck-out, commander damage
// and poison loss end-to-end. Run: node scripts/engine-integration-test.js
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal DOM/browser stubs. getElementById returns inert element objects so
// modal/render paths run instead of bailing on null.
const makeEl = () => ({
  style: {}, innerHTML: '', textContent: '', dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, appendChild() {}, remove() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
  clientWidth: 800, clientHeight: 600, offsetWidth: 200, offsetHeight: 200,
  querySelectorAll: () => [], querySelector: () => makeEl(),
});
const elCache = new Map();
const ctx = {
  console,
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: (id) => { if (!elCache.has(id)) elCache.set(id, makeEl()); return elCache.get(id); },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: makeEl,
    body: { style: {}, appendChild: () => {}, classList: { add() {}, remove() {}, toggle() {} } },
  },
  window: { addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }) },
  requestAnimationFrame: fn => fn(),
  setTimeout: (fn) => { ctx.__timeouts.push(fn); return ctx.__timeouts.length; },
  clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { userAgent: 'test' },
  // Mirror the canonical escapeHtml from js/ui.js (the bundle concatenates ui.js
  // before the engine; this bare VM does not, so provide it here).
  escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  __timeouts: [],
};
ctx.globalThis = ctx;
vm.createContext(ctx);

for (const f of ['engine/engine-effects.js', 'engine/engine-mana.js', 'engine/engine-sba.js',
                 'engine/engine-static.js', 'engine/engine-replace.js', 'goldfish-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const flushTimeouts = () => { const t = ctx.__timeouts.splice(0); t.forEach(fn => fn()); };

let pass = 0, fail = 0;
const check = (label, ok, extra) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? '\n    ' + extra : ''}`); }
};
const run = code => vm.runInContext(code, ctx);

// Fresh minimal game state per scenario.
function freshState() {
  run(`_gfe = {
    library: [], hand: [], battlefield: [], graveyard: [], exile: [], commandZone: [],
    life: 20, oppLife: 20, turn: 3, phase: 'main1', combatStep: null,
    attackers: new Set(), attackerTargets: {}, effectLog: [], manualQueue: [],
    tempEffects: [], activeReplacements: [], stack: [], stackHistory: [],
    manaPool: [], castThisTurn: [], landsPlayedThisTurn: 0, extraLandPlaysThisTurn: 0,
    drawnThisTurn: 0, mulligansInProgress: false, playerOut: false, oppOut: false,
    gameOver: false, counterPending: null, attachPending: null, discardPending: null,
    targetPending: null, deckTokens: [], blockAssign: {}, botAttackers: new Set(),
    selectedBlockerIid: null, defendStep: false, botActive: false,
    playerCounters: {}, oppCounters: {}, commanderDamage: {},
    opp: { deckName: 'BotDeck', library: [], hand: [], battlefield: [], graveyard: [],
           exile: [], commandZone: [], landsPlayedThisTurn: 0, extraLandPlaysThisTurn: 0,
           turn: 3, manaPool: [], castThisTurn: [] },
  };`);
}

console.log('— -1/-1 counters + annihilation + lethal shrink —');
freshState();
run(`_gfe.battlefield.push(
  { iid: 11, name: 'Grizzly', type: 'Creature — Bear', power: '2', toughness: '2', counters: { '+1/+1': 1 }, damage: 0, markers: [] },
  { iid: 12, name: 'Weakling', type: 'Creature — Goblin', power: '1', toughness: '1', counters: {}, damage: 0, markers: [] },
);`);
run(`_gfeAddCounters(11, 1, '-1/-1')`);
check('annihilation: +1/+1 and -1/-1 cancel on Grizzly',
  run(`JSON.stringify(_gfe.battlefield.find(c=>c.iid===11).counters)`) === '{}');
run(`_gfeAddCounters(12, 1, '-1/-1')`);
check('1/1 with a -1/-1 counter dies to the 0-toughness SBA',
  run(`!_gfe.battlefield.some(c => c.iid === 12) && _gfe.graveyard.some(c => c.iid === 12)`));

console.log('— effect executor: typed counter / energy / poison —');
freshState();
run(`_gfe.battlefield.push({ iid: 21, name: 'Relic', type: 'Artifact', counters: {}, damage: 0, markers: [] });`);
run(`_gfeFireEffects(parseEffects('Put a charge counter on Coalition Relic.'), _gfe.battlefield[0])`);
check('charge counter lands on source permanent',
  run(`_gfe.battlefield.find(c=>c.iid===21).counters.charge`) === 1);
run(`_gfeFireEffects(parseEffects('You get {E}{E}.'), _gfe.battlefield[0])`);
check('energy: you get 2', run(`_gfe.playerCounters.energy`) === 2);
run(`_gfeFireEffects(parseEffects('Each opponent gets a poison counter.'), _gfe.battlefield[0])`);
check('poison: opponent gets 1', run(`_gfe.oppCounters.poison`) === 1);
for (let i = 0; i < 9; i++) run(`_gfeAddPlayerCounter('opp', 'poison', 1)`);
check('10 poison eliminates the opponent', run(`_gfe.oppOut && _gfe.gameOver`));

console.log('— proliferate —');
freshState();
run(`_gfe.battlefield.push({ iid: 31, name: 'Relic', type: 'Artifact', counters: { charge: 2 }, damage: 0, markers: [] });`);
run(`_gfe.opp.battlefield.push({ iid: 32, name: 'OppBear', type: 'Creature — Bear', power: '4', toughness: '4', counters: { '-1/-1': 1 }, damage: 0, markers: [] });`);
run(`_gfe.playerCounters.energy = 3; _gfe.oppCounters.poison = 1;`);
run(`_gfeProliferate('you')`);
check('own charge 2→3', run(`_gfe.battlefield.find(c=>c.iid===31).counters.charge`) === 3);
check('enemy -1/-1 1→2', run(`_gfe.opp.battlefield.find(c=>c.iid===32).counters['-1/-1']`) === 2);
check('own energy 3→4', run(`_gfe.playerCounters.energy`) === 4);
check('enemy poison 1→2', run(`_gfe.oppCounters.poison`) === 2);

console.log('— sagas: enter, tick, final-chapter sacrifice —');
freshState();
const sagaOracle = "I — You gain 4 life.\\nII — Draw a card.\\nIII — Each opponent gets a poison counter.";
run(`_gfe.library.push({iid:901,name:'L1'},{iid:902,name:'L2'},{iid:903,name:'L3'});`);
run(`
  const saga = { iid: 41, name: 'Test Saga', type: 'Enchantment — Saga',
                 oracleText: "${sagaOracle}", counters: {}, damage: 0, markers: [] };
  _gfe.battlefield.push(saga);
  _gfeSagaOnEnter(saga, 'you');
`);
check('chapter I fired (gain 4 life)', run(`_gfe.life`) === 24);
check('1 lore counter after entering', run(`_gfe.battlefield.find(c=>c.iid===41).counters.lore`) === 1);
run(`_gfe.battlefield.find(c=>c.iid===41).enteredThisTurn = false;`);
run(`_gfeTickSagas('you')`);
check('chapter II fired (draw)', run(`_gfe.hand.length`) === 1);
run(`_gfeTickSagas('you')`);
check('chapter III fired (opp poison)', run(`_gfe.oppCounters.poison`) === 1);
flushTimeouts();
check('saga sacrificed after final chapter',
  run(`!_gfe.battlefield.some(c=>c.iid===41) && _gfe.graveyard.some(c=>c.iid===41)`));

console.log('— win/lose text + deck-out —');
freshState();
run(`_gfeFireEffects(parseEffects('You win the game.'), { name: 'Test Win', iid: 51 })`);
check('"you win the game" eliminates opponent', run(`_gfe.oppOut && _gfe.gameOver`));
freshState();
run(`_gfe.library = []; _gfeDraw(1);`);
check('drawing from empty library loses', run(`_gfe.playerOut && _gfe.gameOver`));
freshState();
run(`_gfe.opp.library = []; _gfeBotDraw(1);`);
check('bot drawing from empty library loses', run(`_gfe.oppOut && _gfe.gameOver`));

console.log('— commander damage —');
freshState();
run(`
  const cmd = { iid: 61, name: 'My Commander', type: 'Legendary Creature — Human Knight',
                power: '7', toughness: '7', counters: {}, damage: 0, markers: [], isCommander: true,
                oracleText: '' };
  _gfe.battlefield.push(cmd);
  _gfeResolveCombatCore({ attackers: [cmd], attackingSide: 'you', blockMap: {} });
  _gfeResolveCombatCore({ attackers: [cmd], attackingSide: 'you', blockMap: {} });
`);
check('14 commander damage tracked, no elimination yet',
  run(`_gfe.commanderDamage['opp|61']`) === 14 && !run(`_gfe.gameOver`));
run(`_gfeResolveCombatCore({ attackers: [_gfe.battlefield.find(c=>c.iid===61)], attackingSide: 'you', blockMap: {} });`);
check('21 commander damage eliminates the opponent', run(`_gfe.oppOut && _gfe.gameOver`));

console.log('— unblocked lifelink regression —');
freshState();
run(`
  const ll = { iid: 71, name: 'Lifelinker', type: 'Creature — Cleric', power: '3', toughness: '3',
               counters: {}, damage: 0, markers: [], oracleText: 'Lifelink' };
  _gfe.battlefield.push(ll);
  _gfe.life = 10;
  _gfeResolveCombatCore({ attackers: [ll], attackingSide: 'you', blockMap: {} });
`);
check('unblocked lifelink attacker gains life (10→13)', run(`_gfe.life`) === 13,
  `life = ${run('_gfe.life')}`);

console.log('— B18: remove-counters cost (Tumble Magnet style) —');
freshState();
run(`
  const magnet = { iid: 81, name: 'Counter Battery', type: 'Artifact',
    oracleText: 'Counter Battery enters the battlefield with three charge counters on it.\\n{T}, Remove a charge counter from Counter Battery: You gain 2 life.',
    counters: { charge: 3 }, damage: 0, markers: [], tapped: false };
  _gfe.battlefield.push(magnet);
  _gfeActivateAbility(81, 0);
`);
check('charge 3→2, source tapped, effect fired (+2 life)',
  run(`_gfe.battlefield.find(c=>c.iid===81).counters.charge`) === 2
  && run(`_gfe.battlefield.find(c=>c.iid===81).tapped`) === true
  && run(`_gfe.life`) === 22);
run(`_gfe.battlefield.find(c=>c.iid===81).tapped = false; _gfe.battlefield.find(c=>c.iid===81).counters.charge = 0;`);
run(`_gfeActivateAbility(81, 0);`);
check('insufficient counters: no payment, no effect',
  run(`_gfe.life`) === 22 && run(`_gfe.battlefield.find(c=>c.iid===81).tapped`) === false);

console.log('— B18: sacrifice-other cost picker —');
freshState();
run(`
  _gfe.battlefield.push(
    { iid: 91, name: 'Altar Priest', type: 'Creature — Human',
      oracleText: 'Sacrifice another creature: You gain 2 life.',
      power: '1', toughness: '1', counters: {}, damage: 0, markers: [], tapped: false },
    { iid: 92, name: 'Fodder', type: 'Creature — Goblin', power: '1', toughness: '1',
      counters: {}, damage: 0, markers: [], tapped: false, oracleText: '' },
  );
  _gfeActivateAbility(91, 0);
`);
check('sac pick mode opened', run(`!!_gfe.sacPending`));
run(`_gfeSacPickClick(91)`);  // self — must be rejected ("another")
check('cannot sacrifice the source for "another"', run(`!!_gfe.sacPending`));
run(`_gfeSacPickClick(92)`);
check('fodder sacrificed, effect fired (+2 life)',
  run(`!_gfe.battlefield.some(c=>c.iid===92) && _gfe.graveyard.some(c=>c.iid===92)`)
  && run(`_gfe.life`) === 22 && run(`!_gfe.sacPending`));

console.log('— B18: discard cost picker —');
freshState();
run(`
  _gfe.hand.push({ iid: 101, name: 'Spare Card', type: 'Sorcery', oracleText: '', counters: {} });
  _gfe.battlefield.push({ iid: 102, name: 'Rummager', type: 'Artifact',
    oracleText: '{T}, Discard a card: You gain 1 life.',
    counters: {}, damage: 0, markers: [], tapped: false });
  _gfeActivateAbility(102, 0);
`);
check('discard pick mode opened', run(`!!_gfe.discardCostPending`));
run(`_gfeDiscardCostClick(101)`);
check('card discarded to graveyard, effect fired (+1 life), source tapped',
  run(`_gfe.hand.length`) === 0
  && run(`_gfe.graveyard.some(c=>c.iid===101)`)
  && run(`_gfe.life`) === 21
  && run(`_gfe.battlefield.find(c=>c.iid===102).tapped`) === true);

console.log('— B14: Treasure token tap-sac for mana —');
freshState();
run(`_gfeSpawnEffectToken({ count: 1, subtype: 'Treasure', name: 'Treasure', keywords: [] }, null)`);
check('Treasure spawned as artifact with preset oracle',
  run(`_gfe.battlefield.length`) === 1
  && run(`/Token Artifact — Treasure/.test(_gfe.battlefield[0].typeLine)`)
  && run(`/Sacrifice this artifact/.test(_gfe.battlefield[0].oracleText)`));
run(`_gfeActivateManaAbility(_gfe.battlefield[0].iid, 0)`);
run(`_gfeConfirmManaColor('R')`);
check('mana added and Treasure sacrificed (token ceases)',
  run(`_gfe.manaPool.length`) === 1
  && run(`_gfe.manaPool[0].color`) === 'R'
  && run(`_gfe.battlefield.length`) === 0);

console.log('— B14: Ashnod\\u2019s Altar-style sac-for-mana —');
freshState();
run(`
  _gfe.battlefield.push(
    { iid: 111, name: 'Sac Altar', type: 'Artifact',
      oracleText: 'Sacrifice a creature: Add {C}{C}.',
      counters: {}, damage: 0, markers: [], tapped: false },
    { iid: 112, name: 'Fodder Bear', type: 'Creature — Bear', power: '2', toughness: '2',
      counters: {}, damage: 0, markers: [], tapped: false, oracleText: '' },
  );
  _gfeActivateManaAbility(111, 0);
`);
check('altar opens sacrifice pick', run(`!!_gfe.sacPending`));
run(`_gfeSacPickClick(112)`);
check('creature sacrificed, {C}{C} in pool',
  run(`_gfe.manaPool.length`) === 2
  && run(`_gfe.manaPool.every(e => e.color === 'C')`)
  && run(`!_gfe.battlefield.some(c=>c.iid===112) && _gfe.graveyard.some(c=>c.iid===112)`));

console.log('— B14: Food + Clue activated abilities —');
freshState();
run(`
  _gfe.battlefield.push(
    { iid: 121, name: 'Forest', type: 'Basic Land — Forest', tapped: false, counters: {}, markers: [], damage: 0 },
    { iid: 122, name: 'Forest', type: 'Basic Land — Forest', tapped: false, counters: {}, markers: [], damage: 0 },
  );
  _gfeSpawnEffectToken({ count: 1, subtype: 'Food', name: 'Food', keywords: [] }, null);
`);
run(`
  const food = _gfe.battlefield.find(c => /Food/.test(c.typeLine || ''));
  _gfeActivateAbility(food.iid, 0);
`);
check('Food: {2}+tap+sac paid, gained 3 life, lands tapped',
  run(`_gfe.life`) === 23
  && run(`!_gfe.battlefield.some(c => /Food/.test(c.typeLine || ''))`)
  && run(`_gfe.battlefield.filter(c => c.tapped).length`) === 2);

// Async scenarios (bot turn machinery polls via setTimeout — pump the queue).
async function pump(promise, maxIter = 500) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  let i = 0;
  while (!done && i++ < maxIter) {
    await new Promise(r => setImmediate(r));
    const t = ctx.__timeouts.splice(0);
    t.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }
  return done;
}

(async () => {
  console.log('— bot actually casts spells —');
  freshState();
  run(`
    _gfe.opp.battlefield.push(
      { iid: 201, name: 'Forest', type: 'Basic Land — Forest', tapped: false, counters: {}, markers: [], damage: 0 },
      { iid: 202, name: 'Forest', type: 'Basic Land — Forest', tapped: false, counters: {}, markers: [], damage: 0 },
    );
    _gfe.opp.hand.push({ iid: 203, name: 'Bot Bear', type: 'Creature — Bear', mana: '{1}{G}', cmc: 2,
      power: '2', toughness: '2', counters: {}, markers: [], oracleText: '' });
  `);
  await pump(run(`_gfeBotCastPhase()`));
  check('bot cast its 2-drop with 2 Forests',
    run(`_gfe.opp.battlefield.some(c => c.iid === 203)`)
    && run(`_gfe.opp.hand.length`) === 0);

  console.log('— mana synthesis for metadata-poor cards —');
  const synth = run(`
    (() => { const c = { name: 'NoMana', cmc: 4, colorIdentity: ['G', 'W'] };
      _gfeEnrichCardMetadata(c); return c.mana; })()
  `);
  check("cmc 4 + [G,W] identity synthesizes '{2}{G}{W}'", synth === '{2}{G}{W}', `got ${synth}`);

  console.log('— response window on bot spells —');
  freshState();
  run(`
    _gfe.battlefield.push({ iid: 211, name: 'Mountain', type: 'Basic Land — Mountain', tapped: false, counters: {}, markers: [], damage: 0 });
    _gfe.hand.push({ iid: 212, name: 'Shock', type: 'Instant', mana: '{R}', cmc: 1, counters: {}, markers: [],
      oracleText: 'Shock deals 2 damage to any target.' });
    _gfe.opp.battlefield.push(
      { iid: 213, name: 'Swamp', type: 'Basic Land — Swamp', tapped: false, counters: {}, markers: [], damage: 0 },
      { iid: 214, name: 'Swamp', type: 'Basic Land — Swamp', tapped: false, counters: {}, markers: [], damage: 0 },
    );
    _gfe.opp.hand.push({ iid: 215, name: 'Bot Rats', type: 'Creature — Rat', mana: '{1}{B}', cmc: 2,
      power: '2', toughness: '2', counters: {}, markers: [], oracleText: '' });
  `);
  const castPhase = run(`_gfeBotCastPhase()`);
  // Pump a few rounds — the bot should now be paused waiting on the player.
  await pump(Promise.resolve().then(() => new Promise(r => { let n = 0; const tick = () => (++n > 8 ? r() : setImmediate(tick)); tick(); })));
  ctx.__timeouts.splice(0).forEach(fn => fn());
  check('bot spell pauses on the stack awaiting your response',
    run(`_gfe.priorityWaitingFor`) === 'you'
    && run(`(_gfe.stack || []).some(e => e.pending && e.sourceSide === 'bot')`));
  run(`_gfePassPriority()`);
  await pump(castPhase);
  check('after passing, the bot spell resolves and its turn continues',
    run(`_gfe.priorityWaitingFor`) == null && run(`(_gfe.stack || []).length`) === 0
    && run(`_gfe.opp.battlefield.some(c => c.iid === 215)`));

  console.log('— countered bot permanent goes to graveyard —');
  freshState();
  run(`{
    const doomedBear = { iid: 221, name: 'Doomed Bear', type: 'Creature — Bear', mana: '{1}{B}',
      power: '2', toughness: '2', counters: {}, markers: [], oracleText: '' };
    _gfe.opp.battlefield.push(doomedBear);
    _gfeStackPush({
      sourceCard: doomedBear, sourceSide: 'bot', label: doomedBear.name, kind: 'spell',
      resolveFn: () => {},
      onCountered: () => {
        _gfe.opp.battlefield = _gfe.opp.battlefield.filter(c => c.iid !== 221);
        _gfe.opp.graveyard.push(doomedBear);
      },
    });
    _gfeStackCounterTop();
  }`);
  check('countered permanent moved battlefield → graveyard',
    run(`!_gfe.opp.battlefield.some(c => c.iid === 221) && _gfe.opp.graveyard.some(c => c.iid === 221)`));

  console.log('— cross-side triggers —');
  freshState();
  run(`{
    _gfe.battlefield.push({ iid: 231, name: 'Death Watcher', type: 'Enchantment', counters: {}, markers: [], damage: 0,
      oracleText: 'Whenever a creature dies, you gain 1 life.' });
    const watchedBear = { iid: 232, name: 'Bot Bear', type: 'Creature — Bear', power: '2', toughness: '2',
      counters: {}, markers: [], damage: 0, oracleText: '' };
    _gfe.opp.battlefield.push(watchedBear);
    _gfeDestroyCreature(watchedBear, 'bot', 'destroyed');
  }`);
  check("your 'whenever a creature dies' sees the bot's creature die",
    run(`_gfe.life`) === 21);

  freshState();
  run(`{
    _gfe.battlefield.push({ iid: 241, name: 'Scoped Watcher', type: 'Enchantment', counters: {}, markers: [], damage: 0,
      oracleText: 'Whenever a creature you control dies, you gain 1 life.' });
    const scopedBear = { iid: 242, name: 'Bot Bear', type: 'Creature — Bear', power: '2', toughness: '2',
      counters: {}, markers: [], damage: 0, oracleText: '' };
    _gfe.opp.battlefield.push(scopedBear);
    _gfeDestroyCreature(scopedBear, 'bot', 'destroyed');
  }`);
  check("'...you control dies' does NOT fire for the bot's creature",
    run(`_gfe.life`) === 20);

  freshState();
  run(`{
    _gfe.battlefield.push({ iid: 251, name: 'Elf Watcher', type: 'Enchantment', counters: {}, markers: [], damage: 0,
      oracleText: 'Whenever another Elf dies, you gain 1 life.' });
    const dyingGoblin = { iid: 252, name: 'Goblin', type: 'Creature — Goblin', power: '1', toughness: '1',
      counters: {}, markers: [], damage: 0, oracleText: '' };
    const dyingElf = { iid: 253, name: 'Elf', type: 'Creature — Elf', power: '1', toughness: '1',
      counters: {}, markers: [], damage: 0, oracleText: '' };
    _gfe.battlefield.push(dyingGoblin, dyingElf);
    _gfeDestroyCreature(dyingGoblin, 'you', 'destroyed');
    _gfeDestroyCreature(dyingElf, 'you', 'destroyed');
  }`);
  check('subject filter: Elf death fires, Goblin death does not (+1 life total)',
    run(`_gfe.life`) === 21);

  freshState();
  run(`{
    _gfe.battlefield.push({ iid: 261, name: 'Rhystic Watcher', type: 'Enchantment', counters: {}, markers: [], damage: 0,
      oracleText: 'Whenever an opponent casts a spell, you gain 1 life.' });
    const botSorcery = { iid: 262, name: 'Bot Sorcery', type: 'Sorcery', mana: '{B}', cmc: 1, counters: {}, markers: [], oracleText: '' };
    _gfe.opp.graveyard.push(botSorcery);
    _gfeWithSide('bot', () => _gfeHandleBotCardEffects(botSorcery, 'hand', 'graveyard'));
  }`);
  check("your 'whenever an opponent casts' fires on the bot's cast",
    run(`_gfe.life`) === 21);

  freshState();
  run(`
    _gfe.battlefield.push({ iid: 271, name: 'Each-Step Watcher', type: 'Enchantment', counters: {}, markers: [], damage: 0,
      oracleText: 'At the beginning of each end step, you gain 1 life.' });
    _gfe.battlefield.push({ iid: 272, name: 'Your-Step Watcher', type: 'Enchantment', counters: {}, markers: [], damage: 0,
      oracleText: 'At the beginning of your end step, you gain 2 life.' });
    _gfeFirePhaseTriggers('onEndStep', 'bot');   // bot's end step
  `);
  check("'each end step' fires on the bot's turn; 'your end step' does not (+1 only)",
    run(`_gfe.life`) === 21);
  run(`_gfeFirePhaseTriggers('onEndStep', 'you')`);
  check("both fire on your own end step (+3 more)",
    run(`_gfe.life`) === 24);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
