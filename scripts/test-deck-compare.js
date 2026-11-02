/**
 * Deck Compare core — allocation of scanned copies, report groups and the
 * deck mutations behind the report actions (js/deck-compare-core.js).
 */
const assert = require('assert');
const C = require('../js/deck-compare-core');

function card(name, qty = 1, extra = {}) {
  const sid = extra.sid || name.toLowerCase().replace(/[^a-z]+/g, '-');
  return { uid: sid + (extra.foil ? '_f' : '_n'), scryfallId: sid, name, qty, foil: !!extra.foil, ...extra };
}

function deckOf({ cards = [], cuts = [], adds = [], maybeboard = [], sideboard = [] } = {}) {
  return { id: 'd1', name: 'Test', cards, cuts, adds, maybeboard, sideboard, sideboardEnabled: true };
}

function scan(map) {
  const out = {};
  for (const [name, qty] of Object.entries(map)) out[C.nameKey(name)] = { name, qty };
  return out;
}

const row = (rep, name) => rep.rows.find(r => r.key === C.nameKey(name));
let n = 0;
function test(label, fn) { fn(); n++; console.log('ok -', label); }

test('nameKey / basics', () => {
  assert.strictEqual(C.nameKey('  Delver of Secrets // Insectile Aberration '), 'delver of secrets');
  assert.ok(C.isBasicLand('Island'));
  assert.ok(C.isBasicLand('Snow-Covered Forest'));
  assert.ok(!C.isBasicLand('Island Sanctuary'));
});

test('allocation order: keep → cut → add → maybe → side → extra', () => {
  const deck = deckOf({
    cards: [card('Sol Ring', 1), card('Opt', 2)],
    cuts: [card('Opt', 1)],
    adds: [card('Opt', 1)],
    maybeboard: [card('Opt', 1)],
  });
  const rep = C.buildReport(deck, scan({ Opt: 6, 'Sol Ring': 2 }));
  const opt = row(rep, 'Opt');
  assert.deepStrictEqual(
    [opt.keep, opt.scannedKeep, opt.scannedCut, opt.scannedAdd, opt.scannedMaybe, opt.extra],
    [1, 1, 1, 1, 1, 2]);
  const sol = row(rep, 'Sol Ring');
  assert.strictEqual(sol.scannedKeep, 1);
  assert.strictEqual(sol.extra, 1);
  assert.strictEqual(C.lastCopyBucket(sol), 'extra');
  assert.strictEqual(C.lastCopyBucket({ ...opt, scanned: 2 }), 'cut');
});

test('matching is by name, not printing (DFC + different printing)', () => {
  const deck = deckOf({ cards: [card('Delver of Secrets // Insectile Aberration', 1, { sid: 'p1' })] });
  const rep = C.buildReport(deck, scan({ 'Delver of Secrets // Insectile Aberration': 1 }));
  assert.strictEqual(rep.matched, 1);
  assert.strictEqual(rep.notInDeck.length, 0);
  assert.ok(rep.complete);
});

test('progress: cuts do not count, extras only when included', () => {
  const deck = deckOf({
    cards: [card('Island', 10), card('Opt', 1)],
    cuts: [card('Opt', 1)],
    maybeboard: [card('Ponder', 1)],
  });
  let rep = C.buildReport(deck, scan({ Island: 10 }));
  assert.strictEqual(rep.expected, 10);
  assert.strictEqual(rep.matched, 10);
  assert.ok(rep.complete);
  assert.strictEqual(rep.unscannedCuts.length, 1);
  assert.strictEqual(rep.unscannedExtras.length, 0);
  rep = C.buildReport(deck, scan({ Island: 10 }), { includeExtras: true });
  assert.strictEqual(rep.expected, 11);
  assert.ok(!rep.complete);
  assert.strictEqual(rep.unscannedExtras.length, 1);
});

test('basic lands count up and report a short count', () => {
  const deck = deckOf({ cards: [card('Island', 14)] });
  const rep = C.buildReport(deck, scan({ Island: 12 }));
  const isl = row(rep, 'Island');
  assert.ok(isl.isBasic);
  assert.strictEqual(isl.missing, 2);
  assert.strictEqual(rep.missing.length, 1);
});

test('swaps off: cuts and adds are ignored', () => {
  const deck = deckOf({ cards: [card('Opt', 1)], cuts: [card('Opt', 1)], adds: [card('Ponder', 1)] });
  const rep = C.buildReport(deck, scan({ Ponder: 1 }), { swaps: false });
  assert.strictEqual(row(rep, 'Opt').cut, 0);
  assert.strictEqual(row(rep, 'Opt').missing, 1);
  assert.strictEqual(row(rep, 'Ponder').extra, 1);
});

test('orphan cut markers and cuts above main qty are clamped', () => {
  const deck = deckOf({ cards: [card('Opt', 1)], cuts: [card('Opt', 3), card('Gone', 1)] });
  const rep = C.buildReport(deck, {});
  assert.strictEqual(row(rep, 'Opt').cut, 1);
  assert.strictEqual(row(rep, 'Gone'), undefined);
});

test('removeUnscannedCuts removes the cut copies and their markers', () => {
  const deck = deckOf({ cards: [card('Opt', 2), card('Sol Ring', 1)], cuts: [card('Opt', 1), card('Sol Ring', 1)] });
  const events = [];
  const rep = C.buildReport(deck, scan({ Opt: 1, 'Sol Ring': 1 })); // Sol Ring cut but scanned
  assert.deepStrictEqual(rep.unscannedCuts.map(r => r.name), ['Opt']);
  const res = C.removeUnscannedCuts(deck, rep.unscannedCuts, { onEvent: (t, c) => events.push([t, c.name]) });
  assert.ok(res.mainChanged);
  assert.strictEqual(deck.cards.find(c => c.name === 'Opt').qty, 1);
  assert.deepStrictEqual(deck.cuts.map(c => c.name), ['Sol Ring']);
  assert.deepStrictEqual(events, [['qty_change', 'Opt']]);
});

test('removeUnscannedCuts takes the printing the cut points at', () => {
  const deck = deckOf({
    cards: [card('Opt', 1, { sid: 'a' }), card('Opt', 1, { sid: 'b' })],
    cuts: [card('Opt', 1, { sid: 'b' })],
  });
  const rep = C.buildReport(deck, scan({ Opt: 1 }));
  C.removeUnscannedCuts(deck, rep.unscannedCuts);
  assert.deepStrictEqual(deck.cards.map(c => c.scryfallId), ['a']);
  assert.strictEqual(deck.cuts.length, 0);
});

test('removeMissing never touches the commander and keeps cut printings for the cut', () => {
  const deck = deckOf({
    cards: [card('Atraxa', 1, { isCommander: true }), card('Opt', 1, { sid: 'a' }), card('Opt', 1, { sid: 'b' }), card('Island', 5)],
    cuts: [card('Opt', 1, { sid: 'b' })],
  });
  const rep = C.buildReport(deck, scan({ Island: 3 }));
  assert.deepStrictEqual(rep.missing.map(r => r.name).sort(), ['Atraxa', 'Island', 'Opt']);
  const events = [];
  C.removeMissing(deck, rep.missing, { onEvent: (t, c) => events.push([t, c.name]) });
  assert.ok(deck.cards.some(c => c.isCommander && c.name === 'Atraxa'));
  assert.strictEqual(deck.cards.find(c => c.name === 'Island').qty, 3);
  assert.deepStrictEqual(deck.cards.filter(c => c.name === 'Opt').map(c => c.scryfallId), ['b']);
  assert.strictEqual(deck.cuts.length, 1);
  assert.deepStrictEqual(events.sort(), [['qty_change', 'Island'], ['remove', 'Opt']]);
});

test('keepScannedCuts drops only scanned cut markers', () => {
  const deck = deckOf({ cards: [card('Opt', 2)], cuts: [card('Opt', 2)] });
  const rep = C.buildReport(deck, scan({ Opt: 1 }));
  assert.strictEqual(row(rep, 'Opt').scannedCut, 1);
  const res = C.keepScannedCuts(deck, rep.scannedCuts);
  assert.ok(res.planningChanged && !res.mainChanged);
  assert.strictEqual(deck.cuts[0].qty, 1);
  assert.strictEqual(deck.cards[0].qty, 2);
});

test('promoteScannedAdds moves scanned adds into main', () => {
  const deck = deckOf({ cards: [card('Opt', 1)], adds: [card('Ponder', 2), card('Opt', 1)] });
  const rep = C.buildReport(deck, scan({ Ponder: 1, Opt: 2 }));
  const events = [];
  C.promoteScannedAdds(deck, rep.scannedAdds, { onEvent: (t, c) => events.push([t, c.name]) });
  assert.strictEqual(deck.cards.find(c => c.name === 'Opt').qty, 2);
  assert.strictEqual(deck.cards.find(c => c.name === 'Ponder').qty, 1);
  assert.deepStrictEqual(deck.adds.map(c => [c.name, c.qty]), [['Ponder', 1]]);
  assert.deepStrictEqual(events.sort(), [['add', 'Ponder'], ['qty_change', 'Opt']]);
});

test('promoteScannedExtras moves scanned maybe/side copies into main', () => {
  const deck = deckOf({ cards: [], maybeboard: [card('Opt', 1)], sideboard: [card('Ponder', 1)] });
  const rep = C.buildReport(deck, scan({ Opt: 1, Ponder: 1 }));
  const events = [];
  C.promoteScannedExtras(deck, rep.scannedExtras, { onEvent: (t, c, d) => events.push([t, c.name, d]) });
  assert.deepStrictEqual(deck.cards.map(c => c.name).sort(), ['Opt', 'Ponder']);
  assert.strictEqual(deck.maybeboard.length + deck.sideboard.length, 0);
  assert.deepStrictEqual(events.sort(), [['to_main', 'Opt', 'mb'], ['to_main', 'Ponder', 'sb']]);
});

test('addNotInDeck defaults to Adds and uses the scanned printing', () => {
  const deck = deckOf({ cards: [card('Opt', 1)] });
  const scanned = scan({ Opt: 2, Ponder: 1 });
  scanned.ponder.entry = card('Ponder', 1, { sid: 'pp', set: 'm21' });
  scanned.opt.entry = card('Opt', 1, { sid: 'opt2' });
  const rep = C.buildReport(deck, scanned);
  const res = C.addNotInDeck(deck, rep.notInDeck);
  assert.ok(res.planningChanged && !res.mainChanged);
  assert.deepStrictEqual(deck.adds.map(c => [c.name, c.qty, c.scryfallId]).sort(), [['Opt', 1, 'opt2'], ['Ponder', 1, 'pp']]);
  // Now they are planned adds that are physically present.
  const after = C.buildReport(deck, scanned);
  assert.strictEqual(after.notInDeck.length, 0);
  assert.strictEqual(after.scannedAdds.length, 2);
});

test('addNotInDeck to main / maybeboard', () => {
  const deck = deckOf({ cards: [] });
  const scanned = scan({ Ponder: 1 });
  scanned.ponder.entry = card('Ponder', 1);
  const events = [];
  let res = C.addNotInDeck(deck, C.buildReport(deck, scanned).notInDeck, 'mb', { onEvent: t => events.push(t) });
  assert.ok(res.mainChanged);
  assert.strictEqual(deck.maybeboard.length, 1);
  const deck2 = deckOf({ cards: [] });
  res = C.addNotInDeck(deck2, C.buildReport(deck2, scanned).notInDeck, 'main', { onEvent: t => events.push(t) });
  assert.strictEqual(deck2.cards[0].name, 'Ponder');
  assert.ok(!deck2.cards[0].isCommander);
  assert.deepStrictEqual(events, ['add_sb', 'add']);
});

test('removeUnscannedExtras only when extras are counted', () => {
  const deck = deckOf({ cards: [], maybeboard: [card('Opt', 2)], sideboard: [card('Ponder', 1)] });
  assert.strictEqual(C.buildReport(deck, {}).unscannedExtras.length, 0);
  const rep = C.buildReport(deck, scan({ Opt: 1 }), { includeExtras: true });
  C.removeUnscannedExtras(deck, rep.unscannedExtras);
  assert.deepStrictEqual(deck.maybeboard.map(c => [c.name, c.qty]), [['Opt', 1]]);
  assert.strictEqual(deck.sideboard.length, 0);
});

test('mergeScanned folds scanner queue entries by name and keeps entries on request', () => {
  const tally = C.mergeScanned({}, [
    { ...card('Island', 1, { sid: 'i1' }), image: 'x' },
    { ...card('Island', 3, { sid: 'i2' }) },
    { ...card('Ponder', 1) },
  ], { keepEntry: k => k === 'ponder' });
  assert.strictEqual(tally.island.qty, 4);
  assert.strictEqual(tally.island.image, 'x');
  assert.ok(!tally.island.entry);
  assert.strictEqual(tally.ponder.entry.name, 'Ponder');
  assert.ok(!('qty' in tally.ponder.entry));
});

test('tally ops: adds from two devices stack, set overrides, zero removes', () => {
  const st = C.applyTallyOps({}, [
    { t: 'add', key: 'Island', name: 'Island', n: 3 },
    { t: 'add', key: 'island', name: 'Island', n: 2 }, // second device
    { t: 'add', key: 'Opt', name: 'Opt', n: 1 },
    { t: 'set', key: 'opt', name: 'Opt', qty: 0 },
    { t: 'add', key: 'Ponder', name: 'Ponder', n: -1 }, // can't go below zero
  ]);
  assert.deepStrictEqual(st.scanned, { island: { name: 'Island', qty: 5 } });
  C.applyTallyOps(st, [{ t: 'set', key: 'island', name: 'Island', qty: 14 }, { t: 'extras', on: true }]);
  assert.strictEqual(st.scanned.island.qty, 14);
  assert.strictEqual(st.includeExtras, true);
  C.applyTallyOps(st, [{ t: 'reset' }]);
  assert.deepStrictEqual(st, { scanned: {}, includeExtras: false });
});

test('tally ops: entry kept from the first add that carries one', () => {
  const st = C.applyTallyOps({}, [
    { t: 'add', key: 'ponder', name: 'Ponder', n: 1, entry: { name: 'Ponder', scryfallId: 'a', image: 'img' } },
    { t: 'add', key: 'ponder', name: 'Ponder', n: 1, entry: { name: 'Ponder', scryfallId: 'b' } },
  ]);
  assert.strictEqual(st.scanned.ponder.qty, 2);
  assert.strictEqual(st.scanned.ponder.entry.scryfallId, 'a');
  assert.strictEqual(st.scanned.ponder.image, 'img');
});

test('sanitizeTallyOps drops junk, clamps numbers, strips entry qty, caps entry size', () => {
  const big = { name: 'X', blob: 'y'.repeat(20000) };
  const ops = C.sanitizeTallyOps([
    null, 'x', { t: 'nope' }, { t: 'add', key: '', n: 1 }, { t: 'add', key: 'Opt', n: 0 },
    { t: 'add', key: '  Opt ', name: 'Opt', n: 5000 },
    { t: 'set', key: 'Island', qty: -4 },
    { t: 'add', key: 'X', name: 'X', n: 1, entry: big },
    { t: 'add', key: 'Y', name: 'Y', n: 1, entry: { name: 'Y', qty: 3 } },
    { t: 'extras', on: 1 }, { t: 'reset', extra: 1 },
  ]);
  assert.deepStrictEqual(ops, [
    { t: 'add', key: 'opt', name: 'Opt', n: 999 },
    { t: 'set', key: 'island', name: 'Island', qty: 0 },
    { t: 'add', key: 'x', name: 'X', n: 1 },
    { t: 'add', key: 'y', name: 'Y', n: 1, entry: { name: 'Y' } },
    { t: 'extras', on: true },
    { t: 'reset' },
  ]);
});

test('queueToAddOps aggregates a scanner run per name and keeps entries on request', () => {
  const ops = C.queueToAddOps([
    card('Island', 1, { sid: 'i1' }), card('Island', 2, { sid: 'i2' }), card('Ponder', 1),
  ], { keepEntry: k => k === 'ponder' });
  assert.deepStrictEqual(ops.map(o => [o.key, o.n, !!o.entry]), [['island', 3, false], ['ponder', 1, true]]);
  assert.ok(!('qty' in ops[1].entry));
});

test('prototype keys are refused everywhere (no shared-prototype pollution)', () => {
  const ops = C.sanitizeTallyOps([
    { t: 'add', key: '__proto__', name: '__proto__', n: 5, entry: { polluted: true } },
    { t: 'set', key: 'constructor', name: 'constructor', qty: 2 },
    { t: 'add', key: 'opt', name: 'Opt', n: 1 },
  ]);
  assert.deepStrictEqual(ops.map(o => o.key), ['opt']);
  // Even unsanitised ops must not touch the prototype.
  const st = C.applyTallyOps({}, [
    { t: 'add', key: '__proto__', name: '__proto__', n: 5, entry: { polluted: true } },
    { t: 'set', key: '__proto__', qty: 3 },
  ]);
  assert.strictEqual(({}).qty, undefined);
  assert.strictEqual(({}).entry, undefined);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(st.scanned, '__proto__'), false);
  const merged = C.mergeScanned({}, [{ name: '__proto__', qty: 2 }]);
  assert.strictEqual(({}).qty, undefined);
  assert.deepStrictEqual(Object.keys(merged), []);
  assert.ok(!C.isSafeKey('__proto__') && !C.isSafeKey('constructor') && C.isSafeKey('sol ring'));
});

test('surplus copies of a listed card are added with the deck entry (printing kept)', () => {
  const deck = deckOf({ cards: [card('Sol Ring', 1, { sid: 'sr-cmm', set: 'cmm', customTags: ['Ramp'] })] });
  const rep = C.buildReport(deck, scan({ 'Sol Ring': 2 })); // typed count — no scanned entry
  C.addNotInDeck(deck, rep.notInDeck, 'add');
  assert.deepStrictEqual(deck.adds.map(c => [c.name, c.qty, c.scryfallId, c.set]), [['Sol Ring', 1, 'sr-cmm', 'cmm']]);
  assert.ok(!('customTags' in deck.adds[0]));
});

console.log(`\n${n} deck-compare tests passed`);
