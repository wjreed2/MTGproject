// ── Deck Compare core (physical deck vs digital deck) ────────────────────────
// Pure logic, no DOM: given a deck and a tally of physically scanned cards
// (keyed by card name), work out where every scanned copy belongs and what the
// end-of-scan report should offer. The UI lives in js/deck-compare.js.
//
// Matching is by card NAME (front face for double-faced cards), never by
// printing — the physical copy is often a different printing than the one the
// digital list holds.
//
// Scanned copies of a name are allocated in a fixed order:
//   1. main-board copies that are not planned cuts (the cards you keep)
//   2. planned cuts (still physically in the deck)
//   3. planned adds (already physically in the deck)
//   4. maybeboard, then sideboard
//   5. anything left over is not in the deck at all
// So "Sol Ring scanned twice, one in main" reads as one kept + one extra.

const DeckCompareCore = (() => {
  const BASIC_LANDS = new Set([
    'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
    'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
    'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes',
  ]);

  /** Same normalisation as decks.js _deckCardNameKey (DFC front face, spacing, case). */
  function nameKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').split(' // ')[0].trim();
  }

  /**
   * Tally keys become object properties (client and server). A key that names a
   * built-in property — '__proto__' above all — must never be used: assigning
   * to it would write onto the shared Object prototype.
   */
  function isSafeKey(key) {
    return !!key && key !== '__proto__' && !Object.prototype.hasOwnProperty.call(Object.prototype, key);
  }

  function _own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
  }

  function isBasicLand(name) {
    return BASIC_LANDS.has(nameKey(name));
  }

  /** Same as decks.js getCardInventoryKey (uid → printing+finish → name+finish). */
  function invKey(card) {
    if (!card) return '';
    if (card.uid) return card.uid;
    if (card.scryfallId) return card.scryfallId + (card.foil ? '_f' : '_n');
    return String(card.name || '').toLowerCase() + (card.foil ? '_f' : '_n');
  }

  function qtyOf(c) {
    if (!c) return 0;
    if (c.qty == null || c.qty === '') return 1;
    return Math.max(0, Math.floor(Number(c.qty) || 0));
  }

  function _list(deck, zone) {
    if (!deck) return [];
    if (zone === 'main') return Array.isArray(deck.cards) ? deck.cards : (deck.cards = []);
    if (zone === 'mb') return Array.isArray(deck.maybeboard) ? deck.maybeboard : (deck.maybeboard = []);
    if (zone === 'sb') return Array.isArray(deck.sideboard) ? deck.sideboard : (deck.sideboard = []);
    if (zone === 'add') return Array.isArray(deck.adds) ? deck.adds : (deck.adds = []);
    if (zone === 'cut') return Array.isArray(deck.cuts) ? deck.cuts : (deck.cuts = []);
    return [];
  }

  function _emptyRow(key, name) {
    return {
      key, name: name || key, image: '', isBasic: isBasicLand(name || key), isCommander: false,
      main: 0, mainNonCmd: 0, cut: 0, add: 0, maybe: 0, side: 0, scanned: 0, entry: null,
    };
  }

  /**
   * Per-name totals for every zone of the deck, plus the scanned tally.
   * @param deck  deck object (cards / maybeboard / sideboard / adds / cuts)
   * @param scanned  { [nameKey]: { name, qty, image?, entry? } }
   * @param opts  { swaps: bool (Adds & Cuts feature on), sideboard: bool (match sideboard on) }
   */
  function buildRows(deck, scanned, opts = {}) {
    const swaps = opts.swaps !== false;
    const useSide = opts.sideboard !== false;
    const rows = new Map();
    const row = (card) => {
      const key = nameKey(card?.name);
      if (!key) return null;
      let r = rows.get(key);
      if (!r) { r = _emptyRow(key, card.name); rows.set(key, r); }
      if (!r.image && card.image) r.image = card.image;
      return r;
    };
    for (const c of _list(deck, 'main')) {
      const r = row(c); if (!r) continue;
      r.main += qtyOf(c);
      if (c.isCommander) r.isCommander = true;
      else r.mainNonCmd += qtyOf(c);
    }
    if (swaps) {
      for (const c of _list(deck, 'cut')) {
        const key = nameKey(c?.name);
        const r = rows.get(key);
        if (!r) continue; // orphan cut marker — its main card is gone
        r.cut += qtyOf(c);
      }
      for (const r of rows.values()) r.cut = Math.min(r.cut, r.mainNonCmd);
      for (const c of _list(deck, 'add')) { const r = row(c); if (r) r.add += qtyOf(c); }
    }
    for (const c of _list(deck, 'mb')) { const r = row(c); if (r) r.maybe += qtyOf(c); }
    if (useSide) for (const c of _list(deck, 'sb')) { const r = row(c); if (r) r.side += qtyOf(c); }

    for (const [k, s] of Object.entries(scanned || {})) {
      const key = nameKey(k);
      const n = qtyOf({ qty: s?.qty });
      if (!isSafeKey(key) || !n) continue;
      let r = rows.get(key);
      if (!r) { r = _emptyRow(key, s.name || k); rows.set(key, r); }
      r.scanned += n;
      if (!r.image && s.image) r.image = s.image;
      if (s.entry && !r.entry) r.entry = s.entry;
    }
    for (const r of rows.values()) allocate(r);
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Spread a row's scanned copies over its buckets (order documented at the top). */
  function allocate(r) {
    let s = r.scanned;
    const take = n => { const t = Math.min(s, Math.max(0, n)); s -= t; return t; };
    r.keep = r.main - r.cut;
    r.scannedKeep = take(r.keep);
    r.missing = r.keep - r.scannedKeep;
    r.scannedCut = take(r.cut);
    r.unscannedCut = r.cut - r.scannedCut;
    r.scannedAdd = take(r.add);
    r.scannedMaybe = take(r.maybe);
    r.unscannedMaybe = r.maybe - r.scannedMaybe;
    r.scannedSide = take(r.side);
    r.unscannedSide = r.side - r.scannedSide;
    r.extra = s;
    r.inDeck = r.main + r.cut + r.add + r.maybe + r.side > 0;
    return r;
  }

  /** Where the most recently scanned copy of this row landed: keep|cut|add|maybe|side|extra. */
  function lastCopyBucket(r) {
    if (!r || r.scanned <= 0) return null;
    const buckets = [['keep', r.keep], ['cut', r.cut], ['add', r.add], ['maybe', r.maybe], ['side', r.side]];
    let cum = 0;
    for (const [name, cap] of buckets) {
      cum += Math.max(0, cap);
      if (r.scanned <= cum) return name;
    }
    return 'extra';
  }

  /**
   * Progress + grouped rows for the compare screen.
   * opts.includeExtras: count maybeboard / sideboard toward "everything scanned".
   */
  function buildReport(deck, scanned, opts = {}) {
    const rows = buildRows(deck, scanned, opts);
    const inc = !!opts.includeExtras;
    let expected = 0, matched = 0, scannedTotal = 0;
    for (const r of rows) {
      expected += r.keep + (inc ? r.maybe + r.side : 0);
      matched += r.scannedKeep + (inc ? r.scannedMaybe + r.scannedSide : 0);
      scannedTotal += r.scanned;
    }
    const pick = f => rows.filter(f);
    return {
      rows,
      expected, matched, scannedTotal,
      complete: expected > 0 && matched >= expected,
      // Scan phase groups
      notInDeck: pick(r => r.extra > 0),
      toScan: pick(r => r.missing > 0 || (inc && (r.unscannedMaybe > 0 || r.unscannedSide > 0))),
      cuts: pick(r => r.cut > 0),
      adds: pick(r => r.add > 0),
      extras: pick(r => (r.maybe + r.side) > 0 && (inc || r.scannedMaybe + r.scannedSide > 0)),
      done: pick(r => r.keep > 0 && r.missing === 0),
      // Report groups
      unscannedCuts: pick(r => r.unscannedCut > 0),
      missing: pick(r => r.missing > 0),
      scannedCuts: pick(r => r.scannedCut > 0),
      scannedAdds: pick(r => r.scannedAdd > 0),
      scannedExtras: pick(r => r.scannedMaybe + r.scannedSide > 0),
      unscannedExtras: inc ? pick(r => r.unscannedMaybe + r.unscannedSide > 0) : [],
    };
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  // Each takes the live deck + report rows, mutates the deck in place and returns
  // { mainChanged, planningChanged }. The caller saves, renders and records
  // history (events are reported through opts.onEvent(type, card, detail) using
  // the same event types decks.js records).

  /** Remove up to n copies of `key` from a zone. `prefer(card)` entries go first. */
  function _take(list, key, n, { prefer, skipCommander = true } = {}) {
    const out = [];
    if (n <= 0) return out;
    const idx = [];
    list.forEach((c, i) => {
      if (nameKey(c?.name) !== key) return;
      if (skipCommander && c.isCommander) return;
      idx.push(i);
    });
    if (prefer) idx.sort((a, b) => (prefer(list[b]) ? 1 : 0) - (prefer(list[a]) ? 1 : 0));
    const toSplice = [];
    for (const i of idx) {
      if (n <= 0) break;
      const c = list[i];
      const have = qtyOf(c);
      const t = Math.min(have, n);
      if (t <= 0) continue;
      n -= t;
      const snap = { ...c };
      if (have - t > 0) { c.qty = have - t; out.push({ card: snap, took: t, removed: false, ref: c }); }
      else { toSplice.push(i); out.push({ card: snap, took: t, removed: true, ref: null }); }
    }
    toSplice.sort((a, b) => b - a).forEach(i => list.splice(i, 1));
    return out;
  }

  /** Add n copies of a card to a zone, merging into a same-printing entry. Returns the entry. */
  function _put(list, card, n) {
    const k = invKey(card);
    const existing = list.find(c => invKey(c) === k);
    if (existing) { existing.qty = qtyOf(existing) + n; return { entry: existing, merged: true }; }
    const c = { ...card, uid: k, qty: n };
    delete c._plannedAdd;
    delete c.isCommander;
    list.push(c);
    return { entry: c, merged: false };
  }

  /** Cut markers for a name can never exceed its non-commander main copies. */
  function _clampCuts(deck, key) {
    const mainQty = _list(deck, 'main')
      .filter(c => !c.isCommander && nameKey(c.name) === key)
      .reduce((s, c) => s + qtyOf(c), 0);
    const cuts = _list(deck, 'cut');
    const cutQty = cuts.filter(c => nameKey(c.name) === key).reduce((s, c) => s + qtyOf(c), 0);
    if (cutQty > mainQty) _take(cuts, key, cutQty - mainQty, { skipCommander: false });
  }

  function _emitMainTake(results, onEvent) {
    for (const r of results) {
      if (r.removed) onEvent('remove', r.card);
      else onEvent('qty_change', r.ref);
    }
  }

  const _noop = () => {};

  /** "Remove unscanned cuts": the cut copies leave the main board and the cut markers go. */
  function removeUnscannedCuts(deck, rows, opts = {}) {
    const onEvent = opts.onEvent || _noop;
    let mainChanged = false;
    for (const r of rows) {
      const n = r.unscannedCut;
      if (!(n > 0)) continue;
      const cutKeys = new Set(_list(deck, 'cut').filter(c => nameKey(c.name) === r.key).map(invKey));
      const taken = _take(_list(deck, 'main'), r.key, n, { prefer: c => cutKeys.has(invKey(c)) });
      _take(_list(deck, 'cut'), r.key, n, { skipCommander: false });
      _clampCuts(deck, r.key);
      if (taken.length) mainChanged = true;
      _emitMainTake(taken, onEvent);
    }
    return { mainChanged, planningChanged: true };
  }

  /** "Remove missing": main-board copies that weren't scanned and aren't cuts. Never the commander. */
  function removeMissing(deck, rows, opts = {}) {
    const onEvent = opts.onEvent || _noop;
    let mainChanged = false;
    for (const r of rows) {
      if (r.isCommander && r.mainNonCmd === 0) continue;
      const n = Math.min(r.missing, Math.max(0, r.mainNonCmd - r.cut));
      if (!(n > 0)) continue;
      const cutKeys = new Set(_list(deck, 'cut').filter(c => nameKey(c.name) === r.key).map(invKey));
      // Leave the printing a cut marker points at for the cut to handle.
      const taken = _take(_list(deck, 'main'), r.key, n, { prefer: c => !cutKeys.has(invKey(c)) });
      _clampCuts(deck, r.key);
      if (taken.length) mainChanged = true;
      _emitMainTake(taken, onEvent);
    }
    return { mainChanged, planningChanged: false };
  }

  /** "Keep": a scanned cut is still in the physical deck — drop its cut marker. */
  function keepScannedCuts(deck, rows) {
    let planningChanged = false;
    for (const r of rows) {
      if (!(r.scannedCut > 0)) continue;
      if (_take(_list(deck, 'cut'), r.key, r.scannedCut, { skipCommander: false }).length) planningChanged = true;
    }
    return { mainChanged: false, planningChanged };
  }

  /** Scanned planned adds move into the main board. */
  function promoteScannedAdds(deck, rows, opts = {}) {
    const onEvent = opts.onEvent || _noop;
    let mainChanged = false;
    for (const r of rows) {
      if (!(r.scannedAdd > 0)) continue;
      for (const t of _take(_list(deck, 'add'), r.key, r.scannedAdd, { skipCommander: false })) {
        const { entry, merged } = _put(_list(deck, 'main'), t.card, t.took);
        onEvent(merged ? 'qty_change' : 'add', entry);
        mainChanged = true;
      }
    }
    return { mainChanged, planningChanged: true };
  }

  /** Scanned maybeboard / sideboard copies move into the main board. */
  function promoteScannedExtras(deck, rows, opts = {}) {
    const onEvent = opts.onEvent || _noop;
    let mainChanged = false;
    for (const r of rows) {
      for (const [zone, n] of [['mb', r.scannedMaybe], ['sb', r.scannedSide]]) {
        if (!(n > 0)) continue;
        for (const t of _take(_list(deck, zone), r.key, n, { skipCommander: false })) {
          _put(_list(deck, 'main'), t.card, t.took);
          onEvent('to_main', t.card, zone);
          mainChanged = true;
        }
      }
    }
    return { mainChanged, planningChanged: false };
  }

  function _deckEntryFor(deck, key) {
    for (const z of ['main', 'add', 'mb', 'sb', 'cut']) {
      const c = _list(deck, z).find(x => nameKey(x?.name) === key);
      if (c) return c;
    }
    return null;
  }

  /** Scanned cards that aren't in the deck go to a zone: 'add' (default), 'main' or 'mb'. */
  function addNotInDeck(deck, rows, zone = 'add', opts = {}) {
    const onEvent = opts.onEvent || _noop;
    const target = zone === 'main' ? 'main' : zone === 'mb' ? 'mb' : 'add';
    let changed = false;
    for (const r of rows) {
      if (!(r.extra > 0)) continue;
      // Surplus copies of a card the deck already lists carry no scanned entry —
      // reuse the deck's own entry so the printing and card data come along.
      const card = r.entry || _deckEntryFor(deck, r.key) || { name: r.name, image: r.image || '' };
      const base = { ...card };
      delete base.qty;
      delete base.customTags;
      const { entry, merged } = _put(_list(deck, target), base, r.extra);
      if (target === 'main') onEvent(merged ? 'qty_change' : 'add', entry);
      else if (target === 'mb') onEvent(merged ? 'qty_change_sb' : 'add_sb', entry);
      changed = true;
    }
    return {
      mainChanged: changed && target !== 'add',
      planningChanged: changed && target === 'add',
    };
  }

  /** Unscanned maybeboard / sideboard copies leave the deck (only offered when extras are counted). */
  function removeUnscannedExtras(deck, rows, opts = {}) {
    const onEvent = opts.onEvent || _noop;
    let mainChanged = false;
    for (const r of rows) {
      for (const [zone, n] of [['mb', r.unscannedMaybe], ['sb', r.unscannedSide]]) {
        if (!(n > 0)) continue;
        for (const t of _take(_list(deck, zone), r.key, n, { skipCommander: false })) {
          onEvent('remove_sb', t.card);
          mainChanged = true;
        }
      }
    }
    return { mainChanged, planningChanged: false };
  }

  /** Fold scanner queue entries ({name, qty, ...cardToEntry}) into a scanned tally. */
  function mergeScanned(scanned, entries, { keepEntry } = {}) {
    const out = scanned || {};
    for (const e of entries || []) {
      const key = nameKey(e?.name);
      const n = qtyOf(e);
      if (!key || !n) continue;
      if (!isSafeKey(key)) continue;
      const cur = _own(out, key) || (out[key] = { name: e.name, qty: 0 });
      cur.qty = qtyOf({ qty: cur.qty }) + n;
      if (!cur.image && e.image) cur.image = e.image;
      if (keepEntry && keepEntry(key) && !cur.entry) {
        const copy = { ...e };
        delete copy.qty;
        cur.entry = copy;
      }
    }
    return out;
  }

  // ── Shared scan tally ops (client + server) ─────────────────────────────────
  // The tally is shared by everyone who can edit the deck. Changes travel as ops:
  //   {t:'add', key, name, n, entry?}   n more (or fewer) copies scanned
  //   {t:'set', key, name, qty}         typed count
  //   {t:'reset'}                       start over
  //   {t:'extras', on}                  include maybeboard & sideboard
  // 'add' stacks, so two devices counting at once never lose each other's scans.

  const MAX_QTY = 999;
  const MAX_ENTRY_BYTES = 16384;

  function _clampQty(n) {
    return Math.max(0, Math.min(MAX_QTY, Math.floor(Number(n) || 0)));
  }

  /** Validate and normalise untrusted ops. Unknown or malformed ops are dropped. */
  function sanitizeTallyOps(ops) {
    const out = [];
    for (const op of Array.isArray(ops) ? ops : []) {
      if (!op || typeof op !== 'object') continue;
      if (op.t === 'reset') { out.push({ t: 'reset' }); continue; }
      if (op.t === 'extras') { out.push({ t: 'extras', on: !!op.on }); continue; }
      if (op.t !== 'add' && op.t !== 'set') continue;
      const name = String(op.name || op.key || '').slice(0, 255);
      const key = nameKey(op.key || name).slice(0, 255);
      if (!isSafeKey(key)) continue;
      if (op.t === 'set') {
        out.push({ t: 'set', key, name: name || key, qty: _clampQty(op.qty) });
        continue;
      }
      const n = Math.max(-MAX_QTY, Math.min(MAX_QTY, Math.trunc(Number(op.n) || 0)));
      if (!n) continue;
      const clean = { t: 'add', key, name: name || key, n };
      if (op.entry && typeof op.entry === 'object' && !Array.isArray(op.entry)) {
        try {
          if (JSON.stringify(op.entry).length <= MAX_ENTRY_BYTES) {
            const e = { ...op.entry };
            delete e.qty;
            clean.entry = e;
          }
        } catch (_) {}
      }
      out.push(clean);
    }
    return out;
  }

  /**
   * Apply ops to a tally state { scanned, includeExtras }. Mutates and returns it.
   * Rows that drop to zero are removed.
   */
  function applyTallyOps(state, ops) {
    const st = state || {};
    if (!st.scanned || typeof st.scanned !== 'object') st.scanned = {};
    st.includeExtras = !!st.includeExtras;
    for (const op of ops || []) {
      if (!op) continue;
      if (op.t === 'reset') { st.scanned = {}; st.includeExtras = false; continue; }
      if (op.t === 'extras') { st.includeExtras = !!op.on; continue; }
      const key = nameKey(op.key || op.name);
      if (!key) continue;
      if (!isSafeKey(key)) continue;
      const cur = _own(st.scanned, key);
      const qty = op.t === 'set'
        ? _clampQty(op.qty)
        : _clampQty((cur ? Number(cur.qty) || 0 : 0) + (Number(op.n) || 0));
      if (!qty) { delete st.scanned[key]; continue; }
      const row = cur || (st.scanned[key] = { name: op.name || key, qty: 0 });
      row.qty = qty;
      if (op.name && !row.name) row.name = op.name;
      if (op.entry && !row.entry) row.entry = op.entry;
      if (!row.image && op.entry && op.entry.image) row.image = op.entry.image;
    }
    return st;
  }

  /** Ops that turn one scanner run's queue into tally adds (aggregated per name). */
  function queueToAddOps(entries, { keepEntry } = {}) {
    const byKey = new Map();
    for (const e of entries || []) {
      const key = nameKey(e?.name);
      const n = qtyOf(e);
      if (!isSafeKey(key) || !n) continue;
      let op = byKey.get(key);
      if (!op) { op = { t: 'add', key, name: e.name, n: 0 }; byKey.set(key, op); }
      op.n += n;
      if (!op.entry && keepEntry && keepEntry(key)) {
        const copy = { ...e };
        delete copy.qty;
        op.entry = copy;
      }
    }
    return [...byKey.values()];
  }

  return {
    nameKey, isSafeKey, isBasicLand, invKey, buildRows, allocate, lastCopyBucket, buildReport, mergeScanned,
    sanitizeTallyOps, applyTallyOps, queueToAddOps,
    removeUnscannedCuts, removeMissing, keepScannedCuts, promoteScannedAdds,
    promoteScannedExtras, addNotInDeck, removeUnscannedExtras,
  };
})();

// Node (tests) export; harmless no-op in the concatenated browser bundle.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DeckCompareCore;
}
