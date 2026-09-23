// ── Granular collection-op sync (shared client/server) ───────────────────────
// The collection is the last thing still synced as a whole document, and every
// data incident it has produced comes from that: a blob PUT cannot merge, so the
// client has to refuse to send a possibly-stale one (markDirty's unsynced guard,
// which silently discarded 500 scanned cards on 2026-09-18), and a blob hydrate
// overwrites whatever the client had not managed to send yet.
//
// Ops fix both by never describing the whole document. A client diffs its live
// collection against the last server-acked shadow and sends only what changed;
// the server applies those onto its CURRENT rows. A row nobody touched is never
// mentioned, so a stale client cannot revert another device's edits, and work
// done offline survives because the diff REGENERATES it after a reload — the
// same property that already makes js/deck-ops.js safe.
//
// Op shapes:
//   {t:'set', k, card}   upsert one row by key (replaces every duplicate of k)
//   {t:'qty', k, qty}    quantity-only change (no-op if k is gone)
//   {t:'rm',  k}         remove one row by key

const CollectionOps = (() => {
  // Attached by the server at GET or refreshed client-side from the price log —
  // never user content. Diffing these would turn every price refresh into a full
  // collection rewrite.
  const VOLATILE_CARD_FIELDS = ['priceTCG', 'priceTCGFoil', 'priceCK', 'priceCKFoil'];

  // Server-owned projections: oracle_id and role_tags_json are columns the server
  // fills in (including by background infill), so a client must never report them
  // as an edit. They ride along inside a `set` payload; the server ignores them.
  const DERIVED_CARD_FIELDS = ['oracleId', 'roleTags'];

  /**
   * Identity of a collection row. The uid convention is already
   * `<scryfallId>_n` / `<scryfallId>_f`, so this only has to reconstruct it for
   * rows that predate it or were built by hand.
   */
  function cardKey(card) {
    if (!card) return '';
    if (card.uid) return String(card.uid);
    const finish = card.foil ? '_f' : '_n';
    if (card.scryfallId) return String(card.scryfallId) + finish;
    const name = String(card.name || '').toLowerCase().trim();
    return name ? name + finish : '';
  }

  function _stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(_stableStringify).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify(v[k])).join(',') + '}';
  }

  /** Equality projection for one row — volatile and server-owned fields out. */
  function _comparableCard(card) {
    const out = {};
    for (const k of Object.keys(card || {})) {
      if (VOLATILE_CARD_FIELDS.includes(k)) continue;
      if (DERIVED_CARD_FIELDS.includes(k)) continue;
      if (card[k] === undefined || typeof card[k] === 'function') continue;
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
    }).sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
    return out;
  }

  function _comparableNoQty(card) {
    const c = _comparableCard(card);
    delete c.qty;
    return c;
  }

  /**
   * Merge same-key rows (quantities summed, first row's fields win) preserving
   * order. A collection should never hold two rows for one uid, but imports and
   * the pre-op save path could produce them, and a diff must not oscillate.
   */
  function _merged(rows) {
    const byKey = new Map();
    const order = [];
    for (const c of rows || []) {
      if (!c) continue;
      const k = cardKey(c);
      if (!k) continue;
      const prev = byKey.get(k);
      if (prev) {
        prev.qty = (Number(prev.qty) || 1) + (Number(c.qty) || 1);
      } else {
        byKey.set(k, { ...c, qty: Number(c.qty) || 1 });
        order.push(k);
      }
    }
    return { byKey, order };
  }

  /**
   * Normalized deep snapshot of collection content — the client stores this as
   * the "shadow" (last server-acked state) and later diffs live state against it.
   * Row order is not content: the server returns rows ordered by added_at, so
   * there is no reorder op and no order to preserve.
   */
  function snapshotCollection(rows) {
    const { byKey, order } = _merged(rows);
    return order.map(k => JSON.parse(JSON.stringify(byKey.get(k))));
  }

  /** Diff a shadow snapshot against the live collection → minimal op list. */
  function diffCollections(shadowRows, liveRows) {
    const ops = [];
    const prev = _merged(shadowRows);
    const next = _merged(liveRows);

    for (const k of prev.order) {
      if (!next.byKey.has(k)) ops.push({ t: 'rm', k });
    }
    for (const k of next.order) {
      const cur = next.byKey.get(k);
      const old = prev.byKey.get(k);
      if (!old) {
        ops.push({ t: 'set', k, card: JSON.parse(JSON.stringify(cur)) });
      } else if (_stableStringify(_comparableCard(old)) !== _stableStringify(_comparableCard(cur))) {
        // Quantity alone is the overwhelmingly common edit (every scan of a card
        // already owned), and it is the one a stale client can send safely.
        if (_stableStringify(_comparableNoQty(old)) === _stableStringify(_comparableNoQty(cur))) {
          ops.push({ t: 'qty', k, qty: Number(cur.qty) || 1 });
        } else {
          ops.push({ t: 'set', k, card: JSON.parse(JSON.stringify(cur)) });
        }
      }
    }
    return ops;
  }

  /**
   * Apply ops onto a collection (server rows or a client's local copy) and return
   * a NEW array — the server applies these under a row lock and wants the result
   * without mutating what it read.
   */
  function applyOps(rows, ops) {
    const out = Array.isArray(rows) ? rows.map(c => ({ ...c })) : [];
    const idx = new Map();
    out.forEach((c, i) => { const k = cardKey(c); if (k && !idx.has(k)) idx.set(k, i); });
    let added = 0, removed = 0, changed = 0;
    const dropped = new Set();

    for (const op of ops || []) {
      if (!op || typeof op !== 'object' || !op.k) continue;
      if (op.t === 'set' && op.card) {
        const card = JSON.parse(JSON.stringify(op.card));
        if (idx.has(op.k)) {
          out[idx.get(op.k)] = card;
          changed++;
        } else {
          idx.set(op.k, out.length);
          out.push(card);
          added++;
        }
      } else if (op.t === 'qty') {
        if (!idx.has(op.k)) continue; // the row is gone; a qty op must not resurrect it
        out[idx.get(op.k)].qty = Number(op.qty) || 1;
        changed++;
      } else if (op.t === 'rm') {
        if (!idx.has(op.k)) continue;
        dropped.add(op.k);
        removed++;
      }
    }

    const result = dropped.size ? out.filter(c => !dropped.has(cardKey(c))) : out;
    return { rows: result, added, removed, changed };
  }

  /**
   * Advance a shadow by ops without touching any live collection — used when the
   * server acks someone else's change while local unsent edits exist, so those
   * edits stay diffable against a shadow that has moved on.
   */
  function applyOpsToSnapshot(snapRows, ops) {
    return snapshotCollection(applyOps(snapRows, ops).rows);
  }

  /**
   * Share of the known collection an op batch would delete, 0..1. A diff against
   * a cold or empty local copy reads as "remove everything", which is exactly the
   * clobber the old blob guard existed to prevent — callers refuse a batch above
   * a threshold rather than trusting the diff blindly.
   */
  function destructiveShare(ops, shadowSize) {
    const size = Number(shadowSize) || 0;
    if (!size) return 0;
    const removes = (ops || []).filter(o => o && o.t === 'rm').length;
    return removes / size;
  }

  return {
    cardKey,
    snapshotCollection,
    diffCollections,
    applyOps,
    applyOpsToSnapshot,
    destructiveShare,
    VOLATILE_CARD_FIELDS,
    DERIVED_CARD_FIELDS,
  };
})();

// Node (server + tests) export; harmless no-op in the concatenated browser bundle.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CollectionOps;
}
