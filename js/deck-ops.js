// ── Granular deck-op sync (shared client/server) ─────────────────────────────
// Replaces whole-snapshot deck uploads: clients diff their live deck against the
// last server-acknowledged shadow and send only per-card/per-field ops; the
// server applies ops onto its CURRENT state inside a row lock. A card or plan
// slot nobody touched is never mentioned in an op, so a stale client can no
// longer clobber another collaborator's concurrent edits.
//
// Op shapes ({z} is a zone: cards | maybeboard | sideboard | adds | cuts):
//   {t:'set',   z, k, card}   upsert one card by key (replaces all dupes of k)
//   {t:'qty',   z, k, qty}    quantity-only change (no-op if k is gone)
//   {t:'rm',    z, k}         remove one card by key
//   {t:'order', z, keys}      reorder zone; unknown keys keep relative order at end
//   {t:'meta',  f, v|del}     top-level deck field set/delete (name, notes, …)

const DeckOps = (() => {
  const ZONES = ['cards', 'maybeboard', 'sideboard', 'adds', 'cuts'];

  // Server-attached at GET from the price log; never deck content.
  const VOLATILE_CARD_FIELDS = ['priceTCG', 'priceTCGFoil', 'priceCK', 'priceCKFoil'];

  // Client/session decoration + column-authoritative fields — never diffed as meta.
  const NON_CONTENT_DECK_FIELDS = [
    'updatedAt', 'revision', 'shareToken', 'ownerEmail', 'ownerId',
    'ownerCustomTags', 'userPermission', 'clearAddsCuts', 'id',
  ].concat(ZONES);

  function cardKey(card) {
    if (!card) return '';
    const uid = card.uid
      || (card.scryfallId ? card.scryfallId + (card.foil ? '_f' : '_n') : '')
      || (String(card.name || '').toLowerCase() + (card.foil ? '_f' : '_n'));
    return (card.isCommander ? 'cmd:' : 'card:') + uid;
  }

  function _stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(_stableStringify).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify(v[k])).join(',') + '}';
  }

  /** Equality projection for one card — volatile fields out, defaults normalized. */
  function _comparableCard(card) {
    const out = {};
    for (const k of Object.keys(card || {})) {
      if (VOLATILE_CARD_FIELDS.includes(k)) continue;
      if (card[k] === undefined) continue;
      out[k] = card[k];
    }
    out.qty = Number(card?.qty) || 1;
    out.foil = card?.foil != null ? !!card.foil : String(card?.uid || '').endsWith('_f');
    const tags = Array.isArray(card?.customTags) ? card.customTags : [];
    const seen = new Set();
    out.customTags = tags.filter(t => {
      const lc = String(t || '').toLowerCase().trim();
      if (!lc || seen.has(lc)) return false;
      seen.add(lc);
      return true;
    }).slice().sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
    return out;
  }

  function _comparableNoQty(card) {
    const c = _comparableCard(card);
    delete c.qty;
    return c;
  }

  /** Merge same-key entries (qty summed, first entry's fields win) preserving order. */
  function _mergedZone(list) {
    const byKey = new Map();
    const order = [];
    for (const c of list || []) {
      if (!c) continue;
      const k = cardKey(c);
      const prev = byKey.get(k);
      if (prev) {
        prev.qty = (Number(prev.qty) || 1) + (Number(c.qty) || 1);
      } else {
        const clone = { ...c, qty: Number(c.qty) || 1 };
        byKey.set(k, clone);
        order.push(k);
      }
    }
    return { byKey, order };
  }

  /**
   * Normalized deep snapshot of deck content — the client stores this as the
   * "shadow" (last server-acked state) and later diffs live state against it.
   */
  function snapshotDeck(deck) {
    const snap = { meta: {}, zones: {} };
    for (const k of Object.keys(deck || {})) {
      if (NON_CONTENT_DECK_FIELDS.includes(k)) continue;
      if (deck[k] === undefined || typeof deck[k] === 'function') continue;
      snap.meta[k] = JSON.parse(JSON.stringify(deck[k]));
    }
    for (const z of ZONES) {
      const { byKey, order } = _mergedZone(deck?.[z]);
      snap.zones[z] = order.map(k => JSON.parse(JSON.stringify(byKey.get(k))));
    }
    return snap;
  }

  /** Diff a shadow snapshot against the live deck → minimal op list. */
  function diffDecks(shadowSnap, liveDeck) {
    const ops = [];
    const live = snapshotDeck(liveDeck);
    const shadow = shadowSnap && shadowSnap.zones ? shadowSnap : { meta: {}, zones: {} };

    for (const z of ZONES) {
      const prev = _mergedZone(shadow.zones[z]);
      const next = _mergedZone(live.zones[z]);

      for (const k of prev.order) {
        if (!next.byKey.has(k)) ops.push({ t: 'rm', z, k });
      }
      for (const k of next.order) {
        const cur = next.byKey.get(k);
        const old = prev.byKey.get(k);
        if (!old) {
          ops.push({ t: 'set', z, k, card: cur });
        } else if (_stableStringify(_comparableCard(old)) !== _stableStringify(_comparableCard(cur))) {
          if (_stableStringify(_comparableNoQty(old)) === _stableStringify(_comparableNoQty(cur))) {
            ops.push({ t: 'qty', z, k, qty: Number(cur.qty) || 1 });
          } else {
            ops.push({ t: 'set', z, k, card: cur });
          }
        }
      }

      // Same membership, different sequence → explicit reorder.
      const survivors = prev.order.filter(k => next.byKey.has(k));
      const nextSurvivors = next.order.filter(k => prev.byKey.has(k));
      if (survivors.length === nextSurvivors.length
          && survivors.some((k, i) => k !== nextSurvivors[i])) {
        ops.push({ t: 'order', z, keys: next.order });
      }
    }

    const metaKeys = new Set([...Object.keys(shadow.meta || {}), ...Object.keys(live.meta || {})]);
    for (const f of metaKeys) {
      const inLive = Object.prototype.hasOwnProperty.call(live.meta, f);
      const inShadow = Object.prototype.hasOwnProperty.call(shadow.meta || {}, f);
      if (!inLive && inShadow) ops.push({ t: 'meta', f, del: 1 });
      else if (!inShadow || _stableStringify(shadow.meta[f]) !== _stableStringify(live.meta[f])) {
        ops.push({ t: 'meta', f, v: live.meta[f] });
      }
    }
    return ops;
  }

  /**
   * Apply ops onto a live deck object (server blob or a client's local deck).
   * Mutates in place. Returns { changedZones: string[], changedMeta: boolean }.
   */
  function applyOps(deck, ops) {
    const changedZones = new Set();
    let changedMeta = false;
    for (const op of ops || []) {
      if (!op || typeof op !== 'object') continue;
      if (op.t === 'meta') {
        if (typeof op.f !== 'string' || NON_CONTENT_DECK_FIELDS.includes(op.f)) continue;
        if (op.del) delete deck[op.f];
        else deck[op.f] = op.v;
        changedMeta = true;
        continue;
      }
      if (!ZONES.includes(op.z)) continue;
      if (!Array.isArray(deck[op.z])) deck[op.z] = [];
      const zone = deck[op.z];
      if (op.t === 'set' && op.card) {
        const idx = zone.findIndex(c => cardKey(c) === op.k);
        const card = JSON.parse(JSON.stringify(op.card));
        if (idx >= 0) {
          zone[idx] = card;
          deck[op.z] = zone.filter((c, i) => i === idx || cardKey(c) !== op.k);
        } else {
          zone.push(card);
        }
        changedZones.add(op.z);
      } else if (op.t === 'qty') {
        const hit = zone.find(c => cardKey(c) === op.k);
        if (hit) { hit.qty = Number(op.qty) || 1; changedZones.add(op.z); }
      } else if (op.t === 'rm') {
        const before = zone.length;
        deck[op.z] = zone.filter(c => cardKey(c) !== op.k);
        if (deck[op.z].length !== before) changedZones.add(op.z);
      } else if (op.t === 'order' && Array.isArray(op.keys)) {
        const pos = new Map(op.keys.map((k, i) => [k, i]));
        deck[op.z] = zone
          .map((c, i) => [c, i])
          .sort((a, b) => {
            const pa = pos.has(cardKey(a[0])) ? pos.get(cardKey(a[0])) : op.keys.length + a[1];
            const pb = pos.has(cardKey(b[0])) ? pos.get(cardKey(b[0])) : op.keys.length + b[1];
            return pa - pb;
          })
          .map(pair => pair[0]);
        changedZones.add(op.z);
      }
    }
    return { changedZones: [...changedZones], changedMeta };
  }

  /**
   * Apply ops onto a stored snapshot (shadow) without touching any live deck.
   * Used when a remote op broadcast arrives while local unsent edits exist: the
   * shadow advances by the remote ops, so the local edits stay diffable.
   */
  function applyOpsToSnapshot(snap, ops) {
    const pseudo = { ...(snap?.meta || {}) };
    for (const z of ZONES) pseudo[z] = (snap?.zones?.[z] || []).map(c => ({ ...c }));
    applyOps(pseudo, ops);
    return snapshotDeck(pseudo);
  }

  return { ZONES, cardKey, snapshotDeck, diffDecks, applyOps, applyOpsToSnapshot };
})();

// Node (server + tests) export; harmless no-op in the concatenated browser bundle.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DeckOps;
}
