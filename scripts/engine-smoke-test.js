// Quick parser-level smoke test for engine-effects.js + engine-sba.js.
// Run: node scripts/engine-smoke-test.js
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console };
vm.createContext(ctx);
for (const f of ['engine-effects.js', 'engine-sba.js', 'engine-mana.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'engine', f), 'utf8'), ctx, { filename: f });
}

let pass = 0, fail = 0;
function check(label, actual, expectFn) {
  const ok = expectFn(actual);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n    got: ${JSON.stringify(actual)}`); }
}

console.log('— Typed counters —');
check("put two -1/-1 counters on target creature",
  vm.runInContext(`parseEffects("Put two -1/-1 counters on target creature.")`, ctx)[0],
  fx => fx && fx.type === 'counter' && fx.counter === '-1/-1' && fx.n === 2 && fx.target === 'choose');
check("put a charge counter on ~ (self)",
  vm.runInContext(`parseEffects("Put a charge counter on Coalition Relic.")`, ctx)[0],
  fx => fx && fx.type === 'counter' && fx.counter === 'charge' && fx.n === 1 && fx.target === 'self');
check("put a +1/+1 counter on each creature you control",
  vm.runInContext(`parseEffects("Put a +1/+1 counter on each creature you control.")`, ctx)[0],
  fx => fx && fx.type === 'counter' && fx.counter === '+1/+1' && fx.target === 'all' && fx.bothSides === false);
check("put a -1/-1 counter on each creature (both sides)",
  vm.runInContext(`parseEffects("Put a -1/-1 counter on each creature.")`, ctx)[0],
  fx => fx && fx.type === 'counter' && fx.counter === '-1/-1' && fx.target === 'all' && fx.bothSides === true);
check("'a number of +1/+1 counters' does not mis-parse as kind",
  vm.runInContext(`parseEffects("Put a number of +1/+1 counters on it equal to the number of cards in your hand.")`, ctx)[0],
  fx => !fx || fx.type !== 'counter' || fx.counter === '+1/+1');
check("enters with three charge counters",
  vm.runInContext(`parseTriggers("Coalition Relic enters the battlefield with three charge counters on it.", "Coalition Relic")`, ctx).onETB[0],
  fx => fx && fx.type === 'counter' && fx.counter === 'charge' && fx.n === 3);

console.log('— Player counters / proliferate —');
check("you get {E}{E}",
  vm.runInContext(`parseEffects("You get {E}{E}.")`, ctx)[0],
  fx => fx && fx.type === 'player_counter' && fx.counter === 'energy' && fx.n === 2 && fx.target === 'self');
check("each opponent gets a poison counter",
  vm.runInContext(`parseEffects("Each opponent gets a poison counter.")`, ctx)[0],
  fx => fx && fx.type === 'player_counter' && fx.counter === 'poison' && fx.n === 1 && fx.target === 'opp');
check("you get an experience counter",
  vm.runInContext(`parseEffects("You get an experience counter.")`, ctx)[0],
  fx => fx && fx.type === 'player_counter' && fx.counter === 'experience' && fx.n === 1);
check("proliferate",
  vm.runInContext(`parseEffects("Proliferate.")`, ctx)[0],
  fx => fx && fx.type === 'proliferate');

console.log('— Win / lose —');
check("you win the game",
  vm.runInContext(`parseEffects("You win the game.")`, ctx)[0],
  fx => fx && fx.type === 'win_game');
check("target opponent loses the game",
  vm.runInContext(`parseEffects("Target opponent loses the game.")`, ctx)[0],
  fx => fx && fx.type === 'lose_game' && fx.target === 'opp');
check("Felidar upkeep: branch lifeAtLeast 40 → win_game",
  vm.runInContext(`parseTriggers("At the beginning of your upkeep, if you have 40 or more life, you win the game.", "Felidar Sovereign")`, ctx).onUpkeep[0],
  fx => fx && fx.type === 'branch' && fx.condition?.kind === 'lifeAtLeast' && fx.condition?.n === 40
       && fx.ifEffects?.[0]?.type === 'win_game');
check("Approach-style unparsed 'If ...you win' does NOT auto-win",
  vm.runInContext(`parseEffects("If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game.")`, ctx)[0],
  fx => !fx || fx.type !== 'win_game');

console.log('— Sagas —');
const saga = vm.runInContext(`parseSagaChapters("(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\\nI — Create a 2/2 white Knight creature token with vigilance.\\nII — Draw a card.\\nIII — You gain 4 life.")`, ctx);
check("3-chapter saga parses", saga,
  s => s && s.maxChapter === 3 && s.entries.length === 3
    && s.entries[0].effects?.[0]?.type === 'token'
    && s.entries[1].effects?.[0]?.type === 'draw'
    && s.entries[2].effects?.[0]?.type === 'life');
const saga2 = vm.runInContext(`parseSagaChapters("I, II — Exile the top card of your library.\\nIII — Draw a card.")`, ctx);
check("'I, II —' combined chapters parse", saga2,
  s => s && s.maxChapter === 3 && s.entries[0].chapters.join(',') === '1,2');
check("non-saga oracle returns null",
  vm.runInContext(`parseSagaChapters("Flying, vigilance. When this enters, draw a card.")`, ctx),
  v => v === null);

console.log('— SBA: annihilation + typed toughness —');
const sba = vm.runInContext(`
  (() => {
    const state = { life: 20, oppLife: 20, battlefield: [
      { iid: 1, name: 'Test', type: 'Creature', toughness: '3', counters: { '+1/+1': 2, '-1/-1': 2 }, damage: 0 },
      { iid: 2, name: 'Shrunk', type: 'Creature', toughness: '2', counters: { '-1/-1': 2 }, damage: 0 },
    ]};
    const deaths = [];
    runSBAs(state, { moveCard: c => { deaths.push(c.name); state.battlefield = state.battlefield.filter(x => x.iid !== c.iid); } });
    return { counters: state.battlefield[0] ? state.battlefield[0].counters : null, deaths };
  })()
`, ctx);
check("+2/+2 & -2/-2 annihilate; 0-toughness creature dies", sba,
  r => r && r.deaths.includes('Shrunk') && r.counters && !r.counters['+1/+1'] && !r.counters['-1/-1']);

console.log('— B18: ability costs —');
check("'{T}, Remove a charge counter from Tumble Magnet: ...' cost parses",
  vm.runInContext(`parseAbilityCost("{T}, Remove a charge counter from Tumble Magnet")`, ctx),
  c => c && c.tap === true && c.removeCounters?.kind === 'charge' && c.removeCounters?.n === 1);
check("'Remove three time counters from ~' cost parses",
  vm.runInContext(`parseAbilityCost("Remove three time counters from this permanent")`, ctx),
  c => c && c.removeCounters?.kind === 'time' && c.removeCounters?.n === 3);
check("'Sacrifice another creature' cost parses as other-sac",
  vm.runInContext(`parseAbilityCost("Sacrifice another creature")`, ctx),
  c => c && c.sacrificeOther === 'another creature' && !c.sacrificeSelf);
check("Blood-token ability parses (mana+tap+discard+sacSelf → draw)",
  vm.runInContext(`parseActivatedAbilities("{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.")[0]`, ctx),
  ab => ab && ab.cost.mana === '{1}' && ab.cost.tap && ab.cost.discard === 1
     && ab.cost.sacrificeSelf && ab.effects[0]?.type === 'draw');

console.log('— B18/B14: mana-ability sac costs + auto-pool exclusion —');
check("Treasure mana ability parses with costSacSelf",
  vm.runInContext(`parseManaAbilities("{T}, Sacrifice this artifact: Add one mana of any color.")[0]`, ctx),
  ab => ab && ab.costTap && ab.costSacSelf && ab.chooseColor && ab.colors === 'any');
check("Ashnod's Altar parses with costSacOther + {C}{C}",
  vm.runInContext(`parseManaAbilities("Sacrifice a creature: Add {C}{C}.")[0]`, ctx),
  ab => ab && !ab.costTap && !ab.costSacSelf && ab.costSacOther === 'a creature'
     && ab.amount === 2 && String(ab.colors) === 'C,C');
check("Powerstone restriction parses from \"can't be spent\" phrasing",
  vm.runInContext(`parseManaAbilities("{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.")[0]`, ctx),
  ab => ab && ab.restriction != null);
check("Treasure excluded from the auto-tap mana pool",
  vm.runInContext(`computeAvailableMana([{ iid: 1, name: 'Treasure', type: 'Token Artifact — Treasure',
    typeLine: 'Token Artifact — Treasure', tapped: false,
    oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.' }]).total`, ctx),
  total => total === 0);
check("Plain land still in the auto-tap pool",
  vm.runInContext(`computeAvailableMana([{ iid: 2, name: 'Forest', type: 'Basic Land — Forest', tapped: false }]).total`, ctx),
  total => total === 1);

console.log('— Trigger classification: opponent casts / phase scope / subjects —');
check("'Whenever an opponent casts a spell' → onOppCast",
  vm.runInContext(`parseTriggers("Whenever an opponent casts a spell, you gain 1 life.", "X")`, ctx),
  t => t.onOppCast.length === 1 && t.onAnyCast.length === 0);
check("'Whenever a player casts a spell' → both onAnyCast and onOppCast",
  vm.runInContext(`parseTriggers("Whenever a player casts a spell, you gain 1 life.", "X")`, ctx),
  t => t.onOppCast.length === 1 && t.onAnyCast.length === 1);
check("'each upkeep' stamps _phaseScope 'each'",
  vm.runInContext(`parseTriggers("At the beginning of each upkeep, draw a card.", "X")`, ctx).onUpkeep[0],
  fx => fx && fx._phaseScope === 'each');
check("'your upkeep' stamps _phaseScope 'your'",
  vm.runInContext(`parseTriggers("At the beginning of your upkeep, draw a card.", "X")`, ctx).onUpkeep[0],
  fx => fx && fx._phaseScope === 'your');
check("'another Elf dies' stamps _subjectType 'elf'",
  vm.runInContext(`parseTriggers("Whenever another Elf dies, draw a card.", "X")`, ctx).onAnyDeath[0],
  fx => fx && fx._subjectType === 'elf');
check("'a creature enters under your control' stamps scope 'you'",
  vm.runInContext(`parseTriggers("Whenever a creature enters the battlefield under your control, draw a card.", "X")`, ctx).onAnyETB[0],
  fx => fx && fx._eventScope === 'you');
check("'a creature dies' (unscoped) stamps scope 'any'",
  vm.runInContext(`parseTriggers("Whenever a creature dies, draw a card.", "X")`, ctx).onAnyDeath[0],
  fx => fx && fx._eventScope === 'any' && fx._subjectType === 'creature');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
