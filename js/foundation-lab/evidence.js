/**
 * Lab evidence labels for Foundation mechanism detection.
 * Prefers detector output (CardIR + tags + oracle). Falls back to the same maps.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  const FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL = 'manfordf@gmail.com';

  function maps() {
    return {
      axes: (root && root.FOUNDATION_IR_AXES_FOR_MECHANISM) || {},
      roles: (root && root.FOUNDATION_IR_ROLES_FOR_MECHANISM) || {},
    };
  }

  function irOf(card) {
    return (card && (card.ir || card.cardIR)) || null;
  }

  function irAxesOf(card) {
    const ir = irOf(card);
    if (!ir || typeof ir !== 'object') return { provides: [], needs: [], roles: [] };
    const axis = (list) => (Array.isArray(list) ? list : [])
      .map(e => (e && typeof e === 'object') ? e.axis : e)
      .filter(Boolean)
      .map(s => String(s));
    return {
      provides: axis(ir.provides),
      needs: axis(ir.needs),
      roles: Array.isArray(ir.roles) ? ir.roles.map(String) : [],
    };
  }

  function cardIRAvailable(card) {
    const ir = irOf(card);
    if (!ir || typeof ir !== 'object') return false;
    return !!(
      (Array.isArray(ir.provides) && ir.provides.length)
      || (Array.isArray(ir.needs) && ir.needs.length)
      || (Array.isArray(ir.roles) && ir.roles.length)
      || ir.wincon
    );
  }

  function irWouldSupport(card, mechId) {
    const { axes, roles } = maps();
    const wanted = axes[mechId] || [];
    const wantedRoles = roles[mechId] || [];
    const parts = irAxesOf(card);
    if (wanted.some(a => parts.provides.includes(a))) return true;
    if (wantedRoles.some(r => parts.roles.includes(r))) return true;
    return false;
  }

  function fromDetector(card, mechId, detected) {
    let m = detected;
    if (!m && root && typeof root.detectFoundationMechanisms === 'function') {
      const list = root.detectFoundationMechanisms(card, (root && root.FOUNDATION_CONFIG) || {});
      m = (list || []).find(x => x.id === mechId) || null;
    }
    if (!m) return null;
    const sources = Array.isArray(m.evidenceSources) && m.evidenceSources.length
      ? m.evidenceSources.slice()
      : (m.evidenceSource ? [m.evidenceSource] : []);
    const used = sources.includes('cardir');
    const available = cardIRAvailable(card);
    return {
      mechanism: mechId,
      evidenceSource: m.evidenceSource || (sources.length > 1 ? 'multiple' : (sources[0] || 'unknown')),
      evidenceSources: sources,
      cardIRAvailable: available,
      cardIRUsed: used,
      cardIRWouldSupport: used || irWouldSupport(card, mechId),
      cardIRUnused: available && !used,
      irAxes: Array.isArray(m.irAxes) ? m.irAxes.slice() : [],
      note: used
        ? 'CardIR provides/roles contributed to mechanism detection.'
        : (available
          ? 'CardIR is present but did not map to this mechanism.'
          : 'No CardIR provides/needs/roles on this card.'),
    };
  }

  function foundationLabEvidenceForMechanism(card, mechId, detected) {
    const from = fromDetector(card, mechId, detected);
    if (from) return from;
    const available = cardIRAvailable(card);
    return {
      mechanism: mechId,
      evidenceSource: 'unknown',
      evidenceSources: [],
      cardIRAvailable: available,
      cardIRUsed: false,
      cardIRWouldSupport: irWouldSupport(card, mechId),
      cardIRUnused: available,
      irAxes: [],
      note: available
        ? 'CardIR is present but this mechanism was not detected.'
        : 'No CardIR provides/needs/roles on this card.',
    };
  }

  function foundationLabEvidenceForCard(card) {
    const available = cardIRAvailable(card);
    const axes = irAxesOf(card);
    const mechs = (root && typeof root.detectFoundationMechanisms === 'function')
      ? root.detectFoundationMechanisms(card, (root && root.FOUNDATION_CONFIG) || {})
      : [];
    return {
      card: card && card.name || '',
      cardIRAvailable: available,
      cardIRUsedForMechanisms: (mechs || []).some(m => (m.evidenceSources || []).includes('cardir')),
      provides: axes.provides,
      needs: axes.needs,
      roles: axes.roles,
      mechanisms: mechs,
    };
  }

  return {
    FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL,
    FOUNDATION_LAB_IR_AXES_FOR_MECHANISM: (root && root.FOUNDATION_IR_AXES_FOR_MECHANISM) || {},
    FOUNDATION_LAB_CAPABILITY_IR_AXES: {},
    foundationLabCardIRAvailable: cardIRAvailable,
    foundationLabIrAxesOf: irAxesOf,
    foundationLabEvidenceForMechanism,
    foundationLabEvidenceForCard,
    irWouldSupportMechanism: irWouldSupport,
  };
});
