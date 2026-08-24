/**
 * Convert a live site deck (GET /api/decks shape) into a Lab fixture.
 * Does not invent a second schema — maps existing card/plan fields.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  function slugId(name, id) {
    if (id) return String(id);
    return String(name || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
  }

  function slimCardIR(ir) {
    if (!ir || typeof ir !== 'object') return null;
    return {
      ir_version: ir.ir_version,
      vocab_version: ir.vocab_version,
      oracle_id: ir.oracle_id || null,
      name: ir.name || null,
      provides: Array.isArray(ir.provides) ? ir.provides : [],
      needs: Array.isArray(ir.needs) ? ir.needs : [],
      roles: Array.isArray(ir.roles) ? ir.roles : [],
      anti: Array.isArray(ir.anti) ? ir.anti : [],
      wincon: ir.wincon || null,
      tribal: ir.tribal || null,
      confidence: ir.confidence,
    };
  }

  function liveCardToLab(card, irByOracle) {
    const c = card || {};
    const oid = String(c.oracleId || c.oracle_id || '').toLowerCase();
    const irRaw = (oid && irByOracle && irByOracle[oid]) || c.ir || c.cardIR || null;
    const ir = slimCardIR(irRaw) || irRaw;
    const type = String(c.type || c.type_line || '');
    const colors = c.colors || c.colorIdentity || c.color_identity || [];
    return {
      name: String(c.name || '').trim(),
      qty: Math.max(1, Number(c.qty) || 1),
      cmc: Number.isFinite(Number(c.cmc)) ? Number(c.cmc) : 0,
      type,
      type_line: type,
      roleTags: Array.isArray(c.roleTags) ? c.roleTags.slice() : (Array.isArray(c.tags) ? c.tags.slice() : []),
      oracleText: String(c.oracleText || c.oracle_text || c.oracle || ''),
      colors: Array.isArray(colors) ? colors.map(x => String(x).toUpperCase()) : [],
      colorIdentity: Array.isArray(colors) ? colors.map(x => String(x).toUpperCase()) : [],
      isCommander: !!c.isCommander,
      oracleId: oid || null,
      ir,
    };
  }

  function liveDeckToLabFixture(deck, irByOracle, ownerEmail) {
    const d = deck || {};
    const cards = (d.cards || []).map(c => liveCardToLab(c, irByOracle));
    const cmd = cards.find(c => c.isCommander);
    const plan = d.plan && typeof d.plan === 'object' ? d.plan : {};
    return {
      id: slugId(d.name, d.id),
      name: String(d.name || d.id || 'Untitled'),
      archetype: 'user-deck',
      commander: String(d.commander || (cmd && cmd.name) || ''),
      colorIdentity: d.commanderColorIdentity || (cmd && (cmd.colorIdentity || cmd.colors)) || [],
      plan,
      cards,
      notes: ownerEmail ? `Live account deck (${ownerEmail})` : 'Live account deck',
      source: 'account',
      accountEmail: ownerEmail || null,
      liveDeckId: d.id || null,
      expected: {},
    };
  }

  return { liveDeckToLabFixture, liveCardToLab, slimCardIR };
});
