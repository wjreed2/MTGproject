/**
 * Human evaluation records for the Foundation Lab.
 * Ratings are evidence for later deterministic tuning — they never feed the engine.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const ITEM_TYPES = Object.freeze([
    'target', 'coverage', 'add', 'cut', 'synergy', 'vulnerability',
  ]);
  const QUALITY = Object.freeze(['too_low', 'about_right', 'too_high']);
  const REC = Object.freeze(['good', 'ok', 'bad']);

  const ADD_BAD_REASONS = Object.freeze([
    'Does not actually help this deck',
    'Wrong capability',
    'Wrong strategy',
    'Too weak independently',
    'Better alternatives exist',
    'Too narrow',
    'Already enough of this effect',
    'Doesn\'t fit colors',
    'Doesn\'t fit budget',
    'Algorithm misunderstood the card',
    'Poor synergy',
    'Other',
  ]);

  const CUT_BAD_REASONS = Object.freeze([
    'Important to strategy',
    'Important synergy',
    'Wrong capability assessment',
    'Card is stronger than algorithm thinks',
    'Needed despite surplus-looking role',
    'Should only be cut with a replacement',
    'Better cut exists',
    'Budget misunderstanding',
    'Other',
  ]);

  function ratingKey(rec) {
    return [rec.deck, rec.itemType, rec.capability || '', rec.card || '', rec.field || '']
      .join('|').toLowerCase();
  }

  function makeRating(partial) {
    const rec = {
      schemaVersion: 1,
      deck: String(partial.deck || ''),
      engineVersion: String(partial.engineVersion || ''),
      configVersion: String(partial.configVersion || ''),
      itemType: ITEM_TYPES.includes(partial.itemType) ? partial.itemType : 'add',
      capability: partial.capability || null,
      card: partial.card || null,
      field: partial.field || null,
      rating: partial.rating || null,
      reasons: Array.isArray(partial.reasons) ? partial.reasons.slice() : [],
      notes: String(partial.notes || ''),
      suggestedTarget: partial.suggestedTarget == null ? null : Number(partial.suggestedTarget),
      createdAt: partial.createdAt || new Date().toISOString(),
    };
    rec.key = ratingKey(rec);
    return rec;
  }

  function upsertRating(list, rec) {
    const next = makeRating(rec);
    const out = (list || []).slice();
    const i = out.findIndex(r => ratingKey(r) === next.key);
    if (i >= 0) out[i] = next;
    else out.push(next);
    return out;
  }

  return {
    FOUNDATION_LAB_ITEM_TYPES: ITEM_TYPES,
    FOUNDATION_LAB_QUALITY: QUALITY,
    FOUNDATION_LAB_REC: REC,
    FOUNDATION_LAB_ADD_BAD_REASONS: ADD_BAD_REASONS,
    FOUNDATION_LAB_CUT_BAD_REASONS: CUT_BAD_REASONS,
    makeFoundationLabRating: makeRating,
    upsertFoundationLabRating: upsertRating,
    foundationLabRatingKey: ratingKey,
  };
});
