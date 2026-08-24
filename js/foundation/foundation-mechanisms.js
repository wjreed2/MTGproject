/**
 * Foundation mechanism detection.
 * Evidence: CardIR provides/roles (when present) + role tags + oracle text.
 * Needs axes are diagnostic only — they do not create mechanisms.
 * Does not invent coefficients; qualities match existing tag/oracle paths.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const SOURCE_ORDER = Object.freeze(['cardir', 'role_tag', 'oracle']);

  const IR_AXES_FOR_MECHANISM = Object.freeze({
    ramp: Object.freeze([
      'mana.rock', 'mana.dork', 'mana.ramp_land', 'mana.ritual', 'mana.doubler',
      'mana.untap_lands', 'mana.extra_land_drop', 'token.treasure',
    ]),
    draw: Object.freeze([
      'card_advantage.draw', 'card_advantage.draw_engine', 'card_advantage.impulse',
      'card_advantage.wheel',
    ]),
    selection: Object.freeze([
      'card_advantage.loot', 'topdeck.manipulation',
    ]),
    tutor: Object.freeze([
      'tutor.any', 'tutor.creature', 'tutor.instant_sorcery', 'tutor.artifact',
      'tutor.enchantment', 'tutor.land', 'tutor.to_battlefield',
    ]),
    recursion: Object.freeze([
      'gy.recursion', 'gy.reanimate', 'gy.cast_from', 'loop.death_recursion',
    ]),
    protection: Object.freeze([
      'protection.single', 'protection.mass',
    ]),
    wipe: Object.freeze(['removal.wipe']),
    spotInteraction: Object.freeze([
      'removal.spot', 'discard.attack', 'theft.control',
    ]),
    stack: Object.freeze(['control.counter']),
    engine: Object.freeze([
      'anthem.global', 'trigger.cast_payoff', 'trigger.death_payoff', 'trigger.etb_payoff',
      'enchantments.matter', 'artifacts.matter',
    ]),
    finisher: Object.freeze([
      'wincon.alt', 'wincon.damage_burst', 'infinite.mana_sink',
    ]),
  });

  const IR_ROLES_FOR_MECHANISM = Object.freeze({
    ramp: Object.freeze(['ramp', 'mana_rock', 'mana_dork']),
    draw: Object.freeze(['card_draw', 'draw', 'wheel']),
    tutor: Object.freeze(['tutor']),
    recursion: Object.freeze(['recursion', 'reanimator']),
    protection: Object.freeze(['protection']),
    wipe: Object.freeze(['board_wipe']),
    spotInteraction: Object.freeze(['spot_removal', 'burn']),
    stack: Object.freeze(['counterspell']),
    engine: Object.freeze(['anthem']),
    finisher: Object.freeze(['wincon']),
  });

  const AXIS_TO_MECH = {};
  Object.keys(IR_AXES_FOR_MECHANISM).forEach(id => {
    IR_AXES_FOR_MECHANISM[id].forEach(axis => { AXIS_TO_MECH[axis] = id; });
  });
  const ROLE_TO_MECH = {};
  Object.keys(IR_ROLES_FOR_MECHANISM).forEach(id => {
    IR_ROLES_FOR_MECHANISM[id].forEach(role => { ROLE_TO_MECH[role] = id; });
  });

  /** Mechanism quality may exceed 1 (e.g. qualityEngine: 1.15). Coverage/status clamp elsewhere. */
  function qualityValue(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 0) return 0;
    return x;
  }

  function normalizeTagList(tags) {
    return Array.isArray(tags) ? tags.map(t => String(t || '').trim()).filter(Boolean) : [];
  }

  /**
   * Copy a card with materialized role tags for Foundation eval.
   * Does not mutate the live deck object.
   */
  function withFoundationRoleTags(card, tags) {
    const list = normalizeTagList(tags);
    return Object.assign({}, card, { roleTags: list, tags: list });
  }

  function cardTags(card) {
    const raw = (card && (card.roleTags || card.tags)) || [];
    return normalizeTagList(raw);
  }

  function oracleOf(card) {
    return String((card && (card.oracleText || card.oracle_text || card.text)) || '');
  }

  function typeOf(card) {
    return String((card && (card.type_line || card.type || '')) || '');
  }

  function isLand(card) {
    return /\bLand\b/i.test(typeOf(card));
  }

  function irOf(card) {
    const ir = card && (card.ir || card.cardIR);
    return ir && typeof ir === 'object' ? ir : null;
  }

  function axisList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const e of list) {
      const axis = (e && typeof e === 'object') ? e.axis : e;
      if (axis) out.push(String(axis));
    }
    return out;
  }

  function irParts(card) {
    const ir = irOf(card);
    if (!ir) return { provides: [], needs: [], roles: [], wincon: null };
    try {
      return {
        provides: axisList(ir.provides),
        needs: axisList(ir.needs),
        roles: Array.isArray(ir.roles) ? ir.roles.map(r => String(r || '')).filter(Boolean) : [],
        wincon: ir.wincon || null,
      };
    } catch (_) {
      return { provides: [], needs: [], roles: [], wincon: null };
    }
  }

  function resQ(cfg, key, fallback) {
    const n = cfg && cfg.capabilities && cfg.capabilities.resources && cfg.capabilities.resources[key];
    return n != null ? n : fallback;
  }

  function qualityFor(id, cfg) {
    switch (id) {
      case 'ramp': return 0.85;
      case 'draw': return resQ(cfg, 'qualityDraw', 1);
      case 'selection': return resQ(cfg, 'qualitySelection', 0.55);
      case 'tutor': return resQ(cfg, 'qualityTutor', 0.7);
      case 'recursion': return resQ(cfg, 'qualityRecursion', 0.65);
      case 'protection': return 0.8;
      case 'wipe': return 0.85;
      case 'spotInteraction': return 0.8;
      case 'stack': return 0.9;
      case 'engine': return resQ(cfg, 'qualityEngine', 1.15);
      case 'finisher': return 0.85;
      case 'other': return resQ(cfg, 'qualityOther', 0.5);
      default: return 0.5;
    }
  }

  function capsFor(id) {
    switch (id) {
      case 'ramp': return ['manaAccess'];
      case 'draw':
      case 'selection': return ['resources'];
      case 'tutor': return ['resources', 'closeGame'];
      case 'recursion': return ['resources', 'keepGoing'];
      case 'protection': return ['keepGoing'];
      case 'wipe':
      case 'spotInteraction':
      case 'stack': return ['interaction'];
      case 'engine': return ['resources', 'keepGoing'];
      case 'finisher': return ['closeGame'];
      default: return [];
    }
  }

  function collapseSources(set) {
    const evidenceSources = SOURCE_ORDER.filter(s => set.has(s))
      .concat([...set].filter(s => !SOURCE_ORDER.includes(s)));
    if (!evidenceSources.length) return { evidenceSource: 'unknown', evidenceSources: [] };
    if (evidenceSources.length === 1) return { evidenceSource: evidenceSources[0], evidenceSources };
    return { evidenceSource: 'multiple', evidenceSources };
  }

  /**
   * Detect mechanisms a card offers. CardIR provides/roles when present;
   * role tags and oracle text remain as fallbacks and as agreeing evidence.
   */
  function detectFoundationMechanisms(card, cfg) {
    const tags = cardTags(card);
    const oracle = oracleOf(card);
    const byId = new Map();

    function add(id, quality, source, extra) {
      if (!id) return;
      let row = byId.get(id);
      if (!row) {
        row = {
          id,
          quality: qualityValue(quality),
          capabilities: capsFor(id),
          evidenceSourceSet: new Set(),
          irAxes: [],
        };
        byId.set(id, row);
      } else {
        row.quality = Math.max(row.quality, qualityValue(quality));
      }
      if (source) row.evidenceSourceSet.add(source);
      if (extra && extra.axis && !row.irAxes.includes(extra.axis)) row.irAxes.push(extra.axis);
    }

    // Role tags (existing)
    if (tags.includes('Ramp') || tags.includes('Mana Rock')) add('ramp', 0.85, 'role_tag');
    if (tags.includes('Card Draw')) add('draw', qualityFor('draw', cfg), 'role_tag');
    if (tags.includes('Tutor')) add('tutor', qualityFor('tutor', cfg), 'role_tag');
    if (tags.includes('Recursion') || tags.includes('Reanimate')) {
      add('recursion', qualityFor('recursion', cfg), 'role_tag');
    }
    if (tags.includes('Protection')) add('protection', 0.8, 'role_tag');
    if (tags.includes('Removal') || tags.includes('Bite') || tags.includes('Burn') || tags.includes('Bounce')) {
      add('spotInteraction', 0.8, 'role_tag');
    }
    if (tags.includes('Board Wipe')) add('wipe', 0.85, 'role_tag');
    if (tags.includes('Counterspell')) add('stack', 0.9, 'role_tag');

    // Oracle heuristics (existing conditions)
    if (/\bscry\b|\bsurveil\b|\blook at the top/i.test(oracle) && !tags.includes('Card Draw')) {
      add('selection', qualityFor('selection', cfg), 'oracle');
    }
    if (/\bwhenever you (cast|draw|sacrifice)/i.test(oracle)) {
      add('engine', qualityFor('engine', cfg), 'oracle');
    }
    if (tags.includes('Anthem')) add('engine', qualityFor('engine', cfg), 'role_tag');
    if (/\bhexproof\b|\bindestructible\b|\bward\b|\bshroud\b|\bprotection from/i.test(oracle) && !tags.includes('Protection')) {
      add('protection', 0.7, 'oracle');
    }
    if (/\byou win the game\b|\binfinite\b|\bcommander damage\b/i.test(oracle)) {
      add('finisher', 0.85, 'oracle');
    }

    // CardIR provides + roles (missing/incomplete IR is a no-op)
    const ir = irParts(card);
    for (const axis of ir.provides) {
      const id = AXIS_TO_MECH[axis];
      if (id) add(id, qualityFor(id, cfg), 'cardir', { axis });
    }
    for (const role of ir.roles) {
      const id = ROLE_TO_MECH[role];
      if (id) add(id, qualityFor(id, cfg), 'cardir');
    }
    if (ir.wincon) add('finisher', 0.85, 'cardir');

    if (!byId.size && tags.length && !isLand(card)) {
      add('other', qualityFor('other', cfg), 'role_tag');
    }

    const mechs = [];
    for (const row of byId.values()) {
      const collapsed = collapseSources(row.evidenceSourceSet);
      mechs.push({
        id: row.id,
        quality: row.quality,
        capabilities: row.capabilities,
        evidenceSource: collapsed.evidenceSource,
        evidenceSources: collapsed.evidenceSources,
        irAxes: row.irAxes,
      });
    }
    return mechs;
  }

  return {
    detectFoundationMechanisms,
    withFoundationRoleTags,
    FOUNDATION_IR_AXES_FOR_MECHANISM: IR_AXES_FOR_MECHANISM,
    FOUNDATION_IR_ROLES_FOR_MECHANISM: IR_ROLES_FOR_MECHANISM,
    FOUNDATION_MECHANISM_SOURCE_ORDER: SOURCE_ORDER,
    foundationMechanismIdForAxis: (axis) => AXIS_TO_MECH[axis] || null,
    foundationMechanismIdForIrRole: (role) => ROLE_TO_MECH[role] || null,
  };
});
