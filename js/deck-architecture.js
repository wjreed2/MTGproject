/**
 * By Architecture deck visualization — deterministic classification layer.
 *
 * Visualization Foundation functions (Card Advantage, Interaction /
 * Removal, Board Wipes, Win Condition) are NOT the five-capability evaluator
 * in js/foundation/. Mana Sources holds lands plus Ramp.
 *
 * Does not call Scryfall or EDHREC. Does not edit engine2/. The classifier
 * never writes role tags; user Set-primary may, via the deck UI.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  let planApi = root && root.getDeckPlan ? root : null;
  let themesApi = root && root.analyzeDeckThemes ? root : null;
  let burnApi = root && root.burnIndicatesInteraction ? root : null;
  let removalApi = root && root.classifyRemovalTargets ? root : null;
  if (typeof require === 'function') {
    try { if (!planApi || !planApi.getDeckPlan) planApi = require('./deck-plan.js'); } catch (_) { /* bundled */ }
    try { if (!themesApi || !themesApi.analyzeDeckThemes) themesApi = require('./deck-themes.js'); } catch (_) { /* bundled */ }
    try { if (!burnApi || !burnApi.burnIndicatesInteraction) burnApi = require('./burn-roles.js'); } catch (_) { /* bundled */ }
    try { if (!removalApi || !removalApi.classifyRemovalTargets) removalApi = require('./removal-roles.js'); } catch (_) { /* bundled */ }
  }

  const ARCH_CATEGORIES = Object.freeze(['foundation', 'strategy', 'payoffs', 'manabase']);

  const FOUNDATION_FNS = Object.freeze([
    Object.freeze({ id: 'card_advantage', label: 'Card Advantage', blurb: 'Ways the deck generates extra cards or resources.' }),
    Object.freeze({ id: 'interaction', label: 'Interaction / Removal', blurb: 'Answers to opposing threats.' }),
    Object.freeze({ id: 'board_wipes', label: 'Board Wipes', blurb: 'Multiplayer board resets, kept distinct from spot interaction.' }),
  ]);

  const MANABASE_SUBS = Object.freeze([
    Object.freeze({ id: 'ramp', label: 'Ramp', blurb: 'Ways the deck accelerates mana.' }),
    Object.freeze({ id: 'basics', label: 'Basics', blurb: 'Basic lands.' }),
    Object.freeze({ id: 'nonbasics', label: 'Nonbasics', blurb: 'Nonbasic lands.' }),
  ]);

  /** Fixed Payoffs piles (Architecture view). Plan payoff-ish sub-tags are separate catalog entries. */
  const PAYOFF_FIXED_SUBS = Object.freeze([
    Object.freeze({ id: 'win_condition', label: 'Win Condition' }),
    Object.freeze({ id: 'combo', label: 'Combo Pieces' }),
    Object.freeze({ id: 'token_swarm', label: 'Token / Swarm Payoffs' }),
    Object.freeze({ id: 'value_finishers', label: 'Value Finishers' }),
    Object.freeze({ id: 'threats', label: 'Threats / Bombs' }),
  ]);

  const CATEGORY_META = Object.freeze({
    foundation: Object.freeze({
      label: 'Foundation',
      blurb: 'Fundamental functions every deck needs. Built to ensure the deck can play the game.',
      legend: 'Play the game',
    }),
    strategy: Object.freeze({
      label: 'Strategy',
      blurb: 'The engine and plan that makes this deck work. Cards that enable, fuel, and amplify the strategy.',
      legend: 'Make the plan work',
    }),
    payoffs: Object.freeze({
      label: 'Payoffs',
      blurb: 'High-impact threats and finishers that execute the strategy and close the game.',
      legend: 'Win the game',
    }),
    manabase: Object.freeze({
      label: 'Mana Sources',
      blurb: 'Lands and ramp. The mana that supports everything else.',
      legend: 'Power everything',
    }),
  });

  const PAYOFF_SUBTAG_RE = /\.(payoffs|finish|finishers)$|^(ss\.finish|tribal\.finishers)$/;
  const STAPLE_ONLY = Object.freeze(['Ramp', 'Card Draw', 'Removal', 'Board Wipe', 'Land', 'Commander', 'Wheel']);
  // Plain `Burn` is NOT interaction — only Burn.Any / Burn.Creature (see burn-roles.js).
  const INTERACTION_TAGS = Object.freeze(['Removal', 'Counterspell', 'Bounce', 'Bite', 'Burn.Any', 'Burn.Creature']);
  // Interaction / Removal drill-down groups, in display order — all CardIR-derived
  // (removal-roles.js: target-type categories plus 'counterspell' for a
  // counter_spell effect). Cards with no CardIR match (bounce, burn, or coverage
  // gaps) fall into "Other Interaction".
  const REMOVAL_GROUP_ORDER = Object.freeze([
    Object.freeze({ id: 'counterspell', label: 'Counterspell' }),
    Object.freeze({ id: 'creature', label: 'Creature Removal' }),
    Object.freeze({ id: 'artifact', label: 'Artifact Removal' }),
    Object.freeze({ id: 'enchantment', label: 'Enchantment Removal' }),
    Object.freeze({ id: 'planeswalker', label: 'Planeswalker Removal' }),
    Object.freeze({ id: 'battle', label: 'Battle Removal' }),
    Object.freeze({ id: 'land', label: 'Land Removal' }),
    Object.freeze({ id: 'permanent', label: 'Permanent Removal' }),
  ]);
  const DRAW_TAGS = Object.freeze(['Card Draw', 'Wheel']);
  const LIGHT_MIN = 5;
  // Below this the engine is guessing; fall back to detected themes instead.
  const GOAL_MIN_CONFIDENCE = 0.35;
  const GOAL_MAX_SUBS = 3;
  const ARCH_SUB_TINT_STEPS = 5;

  function _burnInteraction(card, tags) {
    if (burnApi && typeof burnApi.burnIndicatesInteraction === 'function') {
      return !!burnApi.burnIndicatesInteraction(tags, _oracle(card));
    }
    const set = new Set(tags || []);
    return set.has('Burn.Any') || set.has('Burn.Creature');
  }

  function _preferredBurnInteractionLabel(card, tags) {
    if (burnApi && typeof burnApi.preferredBurnInteractionLabel === 'function') {
      return burnApi.preferredBurnInteractionLabel(tags, _oracle(card));
    }
    const set = new Set(tags || []);
    if (set.has('Burn.Any')) return 'Burn.Any';
    if (set.has('Burn.Creature')) return 'Burn.Creature';
    return null;
  }

  function _subsectionSlug(subId) {
    return String(subId || '').replace(/[^a-z0-9_-]/gi, '_');
  }

  function _subsectionTintIndex(subId) {
    const s = String(subId || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % ARCH_SUB_TINT_STEPS;
  }

  function _subsectionChrome(category, subId) {
    const slug = _subsectionSlug(subId);
    const tint = _subsectionTintIndex(subId);
    const classes = [
      `arch-sub--cat-${category}`,
      `arch-sub--${slug}`,
      `arch-sub-tint-${tint}`,
    ].join(' ');
    const dataAttrs = `data-arch-sub="${_esc(subId)}" data-arch-tint="${tint}"`;
    return { classes, dataAttrs };
  }

  function _chipHtml(category, subId, label, count) {
    const slug = _subsectionSlug(subId);
    const tint = _subsectionTintIndex(subId);
    const cls = `arch-chip arch-chip--cat-${category} arch-chip--${slug} arch-chip-tint-${tint}`;
    return `<span class="${cls}" data-arch-sub="${_esc(subId)}" data-arch-tint="${tint}">${_esc(label)} ${count}</span>`;
  }

  function _plan() {
    return planApi || root || {};
  }
  function _themes() {
    return themesApi || root || {};
  }

  /** Front face of a double-faced name; split cards ("Fire // Ice") keep both. */
  function _frontFaceName(name) {
    const n = String(name || '').trim();
    if (!n.includes('//')) return n;
    const parts = n.split('//').map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return n;
    // "A // A" art variants collapse; otherwise take the front face.
    return parts[0];
  }

  function architectureCardKey(card) {
    if (!card) return '';
    const oid = card.oracleId || card.oracle_id || '';
    if (oid) return 'oid:' + String(oid).toLowerCase();
    const uid = card.uid || card.scryfallId || '';
    if (uid) return 'uid:' + String(uid);
    return 'name:' + String(card.name || '').trim().toLowerCase();
  }

  function _qty(card) {
    const n = Number(card && card.qty);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function _typeLine(card) {
    if (root && typeof root.resolveCardTypeLine === 'function') {
      return String(root.resolveCardTypeLine(card) || '').toLowerCase();
    }
    return String(card && (card.type || card.typeLine || card.type_line) || '').toLowerCase();
  }

  function _isLand(card) {
    if (root && typeof root._isLandDeckCard === 'function') {
      try { return !!root._isLandDeckCard(card); } catch (_) { /* fall through */ }
    }
    return _typeLine(card).includes('land');
  }

  function _isBasicLand(card) {
    return _isLand(card) && /\bbasic\b/.test(_typeLine(card));
  }

  function _oracle(card) {
    if (root && typeof root.resolveCardOracleText === 'function') {
      return String(root.resolveCardOracleText(card) || '').toLowerCase();
    }
    return String(card && (card.oracleText || card.oracle_text) || '').toLowerCase();
  }

  function _roles(card, deck) {
    if (root && typeof root._probTagsOnCard === 'function') {
      try { return root._probTagsOnCard(card, deck) || []; } catch (_) { /* fall through */ }
    }
    const out = [];
    if (_isLand(card)) out.push('Land');
    if (card && card.isCommander) out.push('Commander');
    (card && card.roleTags || []).forEach(t => { if (t && !out.includes(t)) out.push(t); });
    (card && card.customTags || []).forEach(t => { if (t && !out.includes(t)) out.push(t); });
    return out;
  }

  function _ir(card) {
    return (card && (card.ir || card.cardIR)) || null;
  }

  /**
   * Interaction/Removal drill-down categories (creature/artifact/enchantment/…
   * removal, counterspell) — all CardIR-derived, none from project tags, so
   * this group is only as good as CardIR coverage (see removal-roles.js).
   * The server-computed map (from /api/decks/analyze, keyed by card name) is
   * preferred — it's derived from the full CardIR corpus without shipping raw
   * effect data to the client. Falls back to classifying card.ir directly when
   * present (Foundation Lab, tests). Returns [] with no CardIR either way —
   * the card lands in "Other Interaction", same as any other coverage gap.
   */
  function _removalTargetsForCard(card, ctx) {
    const map = ctx && ctx.removalTargets;
    const name = card && card.name;
    if (map && name && Array.isArray(map[name])) return map[name];
    const ir = _ir(card);
    if (ir && removalApi && typeof removalApi.classifyRemovalTargets === 'function') {
      return removalApi.classifyRemovalTargets(ir);
    }
    return [];
  }

  function _cmc(card) {
    const n = Number(card && (card.cmc != null ? card.cmc : card.manaValue));
    return Number.isFinite(n) ? n : 0;
  }

  function emptyArchitectureOverrides() {
    return {
      byKey: {},
      hiddenSubs: [],
      pinnedSubs: [],
      primaryStrategyId: null,
      secondaryStrategyId: null,
      promotedStrategyIds: [],
      winConditionId: null,
    };
  }

  function normalizeArchitectureOverrides(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const byKey = src.byKey && typeof src.byKey === 'object' ? src.byKey : src;
    const out = {
      byKey: {},
      hiddenSubs: [],
      pinnedSubs: [],
      primaryStrategyId: null,
      secondaryStrategyId: null,
      promotedStrategyIds: [],
      winConditionId: null,
    };
    for (const [k, v] of Object.entries(byKey || {})) {
      if (!k || !v || typeof v !== 'object') continue;
      // Legacy shapes stored memberships at the top level; skip list/identity keys.
      if (k === 'hiddenSubs' || k === 'pinnedSubs' || k === 'promotedStrategyIds'
          || k === 'primaryStrategyId' || k === 'secondaryStrategyId' || k === 'winConditionId') {
        continue;
      }
      out.byKey[k] = {
        primary: v.primary && v.primary.category ? _normMem(v.primary) : null,
        extrasRemoved: Array.isArray(v.extrasRemoved) ? _dedupeMems(v.extrasRemoved) : [],
        extrasAdded: Array.isArray(v.extrasAdded) ? _dedupeMems(v.extrasAdded) : [],
        unassigned: !!v.unassigned,
        writtenRole: v.writtenRole || null,
        prevPrimaryTag: v.prevPrimaryTag || null,
      };
    }
    out.hiddenSubs = _dedupeMems(Array.isArray(src.hiddenSubs) ? src.hiddenSubs : []);
    out.pinnedSubs = _dedupeMems(Array.isArray(src.pinnedSubs) ? src.pinnedSubs : []);
    out.primaryStrategyId = src.primaryStrategyId ? String(src.primaryStrategyId) : null;
    out.secondaryStrategyId = src.secondaryStrategyId ? String(src.secondaryStrategyId) : null;
    out.promotedStrategyIds = Array.isArray(src.promotedStrategyIds)
      ? [...new Set(src.promotedStrategyIds.map(String).filter(Boolean))]
      : [];
    out.winConditionId = src.winConditionId ? String(src.winConditionId) : null;
    return out;
  }

  function isArchitectureSubsectionHidden(overrides, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const mem = _normMem({ category, subsection });
    if (!mem) return false;
    const key = _memKey(mem);
    return ov.hiddenSubs.some(m => _memKey(m) === key);
  }

  function isArchitectureSubsectionPinned(overrides, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const mem = _normMem({ category, subsection });
    if (!mem) return false;
    const key = _memKey(mem);
    return ov.pinnedSubs.some(m => _memKey(m) === key);
  }

  function hideArchitectureSubsection(overrides, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const mem = _normMem({ category, subsection });
    if (!mem) return ov;
    const key = _memKey(mem);
    if (!ov.hiddenSubs.some(m => _memKey(m) === key)) ov.hiddenSubs.push(mem);
    ov.pinnedSubs = ov.pinnedSubs.filter(m => _memKey(m) !== key);
    return ov;
  }

  /** Unhide a subsection (and keep it pinned so empty / off-plan piles still render). */
  function showArchitectureSubsection(overrides, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const mem = _normMem({ category, subsection });
    if (!mem) return ov;
    const key = _memKey(mem);
    ov.hiddenSubs = ov.hiddenSubs.filter(m => _memKey(m) !== key);
    if (!ov.pinnedSubs.some(m => _memKey(m) === key)) ov.pinnedSubs.push(mem);
    return ov;
  }

  function pinArchitectureSubsection(overrides, category, subsection) {
    return showArchitectureSubsection(overrides, category, subsection);
  }

  function unpinArchitectureSubsection(overrides, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const mem = _normMem({ category, subsection });
    if (!mem) return ov;
    const key = _memKey(mem);
    ov.pinnedSubs = ov.pinnedSubs.filter(m => _memKey(m) !== key);
    return ov;
  }

  /** Drop hidden piles from the model and strip matching memberships so orphans land in Unassigned. */
  function applyHiddenArchitectureSubsections(model, overrides) {
    if (!model) return model;
    const ov = normalizeArchitectureOverrides(overrides);
    model.pinnedSubs = ov.pinnedSubs.slice();
    if (!ov.hiddenSubs.length) {
      model.hiddenSubs = [];
      return model;
    }
    const hidden = new Set(ov.hiddenSubs.map(_memKey));
    const isHid = (cat, id) => hidden.has(cat + '::' + id);

    model.strategySubs = (model.strategySubs || []).filter(s => !isHid('strategy', s.id));
    model.payoffSubs = (model.payoffSubs || []).filter(s => !isHid('payoffs', s.id));
    model.hiddenSubs = ov.hiddenSubs.slice();

    model.rows = (model.rows || []).map(row => {
      const foundationFns = (row.foundationFns || []).filter(id => !isHid('foundation', id));
      const strategySubs = (row.strategySubs || []).filter(id => !isHid('strategy', id));
      const payoffSubs = (row.payoffSubs || []).filter(id => !isHid('payoffs', id));
      const manabaseSubs = (row.manabaseSubs || []).filter(id => !isHid('manabase', id));
      if (foundationFns.length === (row.foundationFns || []).length
          && strategySubs.length === (row.strategySubs || []).length
          && payoffSubs.length === (row.payoffSubs || []).length
          && manabaseSubs.length === (row.manabaseSubs || []).length) {
        return row;
      }
      const categories = [];
      if (foundationFns.length) categories.push('foundation');
      if (strategySubs.length) categories.push('strategy');
      if (payoffSubs.length) categories.push('payoffs');
      if (manabaseSubs.length) categories.push('manabase');
      return Object.assign({}, row, {
        foundationFns,
        strategySubs,
        payoffSubs,
        manabaseSubs,
        categories,
        ambiguous: categories.length === 0,
      });
    });
    model.counts = _counts(model.rows, model.strategySubs, model.payoffSubs);
    model.unassigned = model.rows.filter(r => !(r.categories && r.categories.length));
    model.multiRole = model.rows.filter(r => (r.categories || []).length >= 2);
    return model;
  }

  function _lookupPlanSubtagRow(subtagId) {
    const api = _plan();
    const defs = api.PLAN_THEME_SUBTAG_DEFAULTS || {};
    for (const [strategyId, rows] of Object.entries(defs)) {
      const row = (rows || []).find(r => r.id === subtagId);
      if (row) {
        return {
          id: row.id,
          label: row.label,
          projectTags: (row.projectTags || []).slice(),
          target: row.target,
          strategyId,
        };
      }
    }
    return null;
  }

  function _isStrategyCatalogSubtag(subtagId, winConditionId) {
    return !!subtagId && !_isPayoffSubtag(subtagId, winConditionId);
  }

  /** Full Add-subsection catalog for a panel (no freeform ids). */
  function architectureSubsectionCatalog(category, plan) {
    const winId = plan && plan.winConditionId;
    const api = _plan();
    const th = _themes();
    if (category === 'foundation') {
      return FOUNDATION_FNS.map(fn => ({
        id: fn.id,
        label: fn.label,
        kind: 'fixed',
        inferredHint: false,
      }));
    }
    if (category === 'manabase') {
      return MANABASE_SUBS.map(sub => ({
        id: sub.id,
        label: sub.label,
        kind: 'fixed',
        inferredHint: false,
      }));
    }
    if (category === 'payoffs') {
      const out = PAYOFF_FIXED_SUBS.map(sub => ({
        id: sub.id,
        label: sub.label,
        kind: 'fixed',
        inferredHint: false,
      }));
      const defs = api.PLAN_THEME_SUBTAG_DEFAULTS || {};
      for (const rows of Object.values(defs)) {
        for (const row of rows || []) {
          if (!_isPayoffSubtag(row.id, winId) && row.id !== 'sac.drain') continue;
          if (out.some(o => o.subtagId === row.id)) continue;
          out.push({
            id: 'subtag:' + row.id,
            label: row.label,
            kind: 'subtag',
            subtagId: row.id,
            inferredHint: false,
          });
        }
      }
      return out;
    }
    if (category === 'strategy') {
      const out = [];
      const defs = api.PLAN_THEME_SUBTAG_DEFAULTS || {};
      for (const [strategyId, rows] of Object.entries(defs)) {
        const stratLabel = (typeof api.strategyLabel === 'function')
          ? api.strategyLabel(strategyId)
          : strategyId;
        for (const row of rows || []) {
          if (!_isStrategyCatalogSubtag(row.id, winId)) continue;
          out.push({
            id: 'subtag:' + row.id,
            label: row.label,
            kind: 'subtag',
            subtagId: row.id,
            strategyId,
            strategyLabel: stratLabel,
            group: stratLabel,
            inferredHint: false,
          });
        }
      }
      const themes = (th.THEME_CATALOG || []).filter(t => t && t.id && t.id !== 'strategy.other');
      for (const t of themes) {
        out.push({
          id: 'theme:' + t.id,
          label: t.label || t.id,
          kind: 'theme',
          themeId: t.id,
          group: 'Themes',
          inferredHint: true,
        });
      }
      return out;
    }
    return [];
  }

  /**
   * Suggested Set-subsection options: currently hidden piles, plus Light+ themes
   * not already shown (Strategy) and fixed Payoffs piles not on screen.
   */
  function architectureInferredSubsectionOptions(category, model, overrides) {
    const ov = normalizeArchitectureOverrides(overrides || {});
    const hidden = (ov.hiddenSubs || []).filter(m => m.category === category);
    const catalog = architectureSubsectionCatalog(category, model && model.plan);
    const byId = new Map(catalog.map(c => [c.id, c]));
    const present = new Set();
    if (category === 'foundation') {
      FOUNDATION_FNS.forEach(fn => {
        if (!hidden.some(h => h.subsection === fn.id)) present.add(fn.id);
      });
    }
    if (category === 'manabase') {
      MANABASE_SUBS.forEach(sub => {
        if (!hidden.some(h => h.subsection === sub.id)) present.add(sub.id);
      });
    }
    if (category === 'strategy') (model && model.strategySubs || []).forEach(s => present.add(s.id));
    if (category === 'payoffs') (model && model.payoffSubs || []).forEach(s => present.add(s.id));

    const inferred = [];
    const seen = new Set();
    const push = (id, reason) => {
      if (!id || seen.has(id) || present.has(id)) return;
      const base = byId.get(id) || { id, label: id, kind: 'fixed' };
      seen.add(id);
      inferred.push(Object.assign({}, base, { reason }));
    };
    for (const h of hidden) push(h.subsection, 'hidden');

    if (category === 'strategy') {
      const themes = ((model && model.themeAnalysis && model.themeAnalysis.themes) || []);
      for (const t of themes) {
        if (!t || !t.id || t.id === 'strategy.goodstuff' || t.id === 'strategy.other') continue;
        if ((t.supportCount || 0) < LIGHT_MIN) continue;
        push('theme:' + t.id, 'theme');
      }
    }
    if (category === 'payoffs') {
      for (const sub of PAYOFF_FIXED_SUBS) push(sub.id, 'fixed');
    }
    return inferred;
  }

  function _resolvePinnedStrategySub(subsectionId, plan) {
    if (String(subsectionId).startsWith('subtag:')) {
      const subtagId = String(subsectionId).slice('subtag:'.length);
      const row = _lookupPlanSubtagRow(subtagId);
      if (!row) return null;
      const api = _plan();
      const label = (typeof api.resolvePlanSubtagLabel === 'function')
        ? api.resolvePlanSubtagLabel(row.label, subtagId, plan)
        : row.label;
      return {
        id: subsectionId,
        label,
        source: 'declared',
        projectTags: row.projectTags || [],
        themeId: null,
        subtagId,
        strategyId: (typeof api.subtagStrategyId === 'function' ? api.subtagStrategyId(subtagId) : null) || null,
      };
    }
    if (String(subsectionId).startsWith('theme:')) {
      const themeId = String(subsectionId).slice('theme:'.length);
      const th = _themes();
      const hit = (th.THEME_CATALOG || []).find(t => t.id === themeId);
      return {
        id: subsectionId,
        label: (hit && hit.label) || themeId,
        source: 'inferred',
        projectTags: [],
        themeId,
        subtagId: null,
        strategyId: String(themeId).startsWith('tribal:')
          ? 'strategy.tribal'
          : (String(themeId).startsWith('strategy.typal.') ? themeId : themeId),
      };
    }
    return null;
  }

  function _resolvePinnedPayoffSub(subsectionId) {
    const fixed = PAYOFF_FIXED_SUBS.find(s => s.id === subsectionId);
    if (fixed) {
      return { id: fixed.id, label: fixed.label, source: 'declared' };
    }
    if (String(subsectionId).startsWith('subtag:')) {
      const subtagId = String(subsectionId).slice('subtag:'.length);
      const row = _lookupPlanSubtagRow(subtagId);
      if (!row) return null;
      return {
        id: subsectionId,
        label: row.label,
        source: 'declared',
        projectTags: row.projectTags || [],
        subtagId,
      };
    }
    return null;
  }

  function _mergePinnedSubsIntoLists(strategySubs, payoffSubs, overrides, plan) {
    const ov = normalizeArchitectureOverrides(overrides);
    const strat = (strategySubs || []).slice();
    const pay = (payoffSubs || []).slice();
    const stratIds = new Set(strat.map(s => s.id));
    const payIds = new Set(pay.map(s => s.id));
    for (const mem of ov.pinnedSubs) {
      if (mem.category === 'strategy' && !stratIds.has(mem.subsection)) {
        const resolved = _resolvePinnedStrategySub(mem.subsection, plan);
        if (resolved) {
          strat.push(resolved);
          stratIds.add(resolved.id);
        }
      }
      if (mem.category === 'payoffs' && !payIds.has(mem.subsection)) {
        const resolved = _resolvePinnedPayoffSub(mem.subsection);
        if (resolved) {
          pay.push(resolved);
          payIds.add(resolved.id);
        }
      }
    }
    return { strategySubs: strat, payoffSubs: pay };
  }

  function _normMem(m) {
    if (!m || !m.category) return null;
    const mem = { category: String(m.category), subsection: String(m.subsection || '') };
    if (mem.category === 'foundation' && mem.subsection === 'ramp') {
      mem.category = 'manabase';
    }
    return mem;
  }

  function _dedupeMems(list) {
    const seen = new Set();
    const out = [];
    for (const m of list || []) {
      const n = _normMem(m);
      if (!n) continue;
      const k = _memKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    return out;
  }

  function _memKey(m) {
    return (m && m.category || '') + '::' + (m && m.subsection || '');
  }

  function _isPayoffSubtag(id, winConditionId) {
    if (!id) return false;
    if (PAYOFF_SUBTAG_RE.test(id)) return true;
    if (id === 'sac.drain' && winConditionId === 'wincon.life_drain') return true;
    return false;
  }

  function mappedRoleForPlacement(category, subsection, card, deck) {
    if (category === 'manabase') {
      if (subsection === 'ramp') return 'Ramp';
      return 'Land';
    }
    if (category === 'foundation') {
      if (subsection === 'card_advantage') return 'Card Draw';
      if (subsection === 'ramp') return 'Ramp';
      if (subsection === 'board_wipes') return 'Board Wipe';
      if (subsection === 'interaction') {
        const tags = new Set(_roles(card, deck));
        const burnLabel = _preferredBurnInteractionLabel(card, [...tags]);
        if (burnLabel) return burnLabel;
        for (const t of INTERACTION_TAGS) {
          if (t !== 'Removal' && tags.has(t)) return t;
        }
        return 'Removal';
      }
      if (subsection === 'win_condition') return null;
    }
    return null;
  }

  // Goals whose plan is "attack with the thing" — for these the commander is the
  // deck's stated way to close, which is what Win Condition is asking.
  // engine2 template keys, verbatim — `tokens-wide`, not `tokens`, which never matched
  // and so never let a token-swarm deck imply a commander wincon.
  const COMBAT_GOALS = Object.freeze(['voltron', 'stompy', 'counters', 'tokens-wide', 'equipment', 'aristocrats', 'combo', 'combat']);

  function _goalImpliesCommanderWincon(goals) {
    const top = (goals || [])[0];
    if (!top || !top.goal) return false;
    const key = String(top.goal);
    return key.startsWith('tribal:') || COMBAT_GOALS.includes(key);
  }

  /**
   * winconMatch() in deck-plan.js scores whether a card SUPPORTS the plan's win
   * route — its tag lists carry supporters (Card Draw under wincon.value, Token
   * Maker/Pump/Evasion under wincon.combat) and its oracle rules substring-match
   * phrases like "combat damage", which every saboteur draw trigger contains.
   * The Win Condition pile asks a narrower question — does this card CLOSE the
   * game — so only closer-grade tags count here. Routes absent from this map
   * (value, combo, commander damage) have no tag that means "closes the game";
   * their closers surface via ir.wincon, oracle win text, or the commander rule.
   */
  const WINCON_CLOSER_TAGS = Object.freeze({
    'wincon.combat': Object.freeze(['Anthem', 'Extra Combat']),
    'wincon.mill': Object.freeze(['Mill']),
    'wincon.life_drain': Object.freeze(['Drain']),
    'wincon.lock': Object.freeze(['Stax']),
  });

  function _cardHasWinconSignal(card, plan, deck, goals) {
    if (card && card.isCommander && _goalImpliesCommanderWincon(goals)) return true;
    const ir = _ir(card);
    if (ir && ir.wincon) return true;
    if (ir && Array.isArray(ir.roles) && ir.roles.includes('wincon')) return true;
    const text = _oracle(card);
    if (/\byou win the game\b/.test(text) || /\ban opponent loses the game\b/.test(text)) return true;
    const winId = plan && plan.winConditionId;
    if (card && card.isCommander && (winId === 'wincon.commander_damage' || winId === 'wincon.combat')) return true;
    const closers = (winId && WINCON_CLOSER_TAGS[winId]) || [];
    if (closers.length) {
      const tags = new Set(_roles(card, deck));
      if (closers.some(t => tags.has(t))) return true;
    }
    // A card the user named as key to the plan gets the benefit of the doubt:
    // supporter-grade winconMatch evidence is enough there.
    const keys = (plan && plan.keyCards) || [];
    const name = String(card && card.name || '').trim().toLowerCase();
    if (name && keys.some(k => String(k && (k.name || k) || '').trim().toLowerCase() === name)) {
      const api = _plan();
      if (typeof api.winconMatch === 'function' && api.winconMatch(card, winId, deck)) return true;
    }
    return false;
  }

  function _isThreatBomb(card, plan, deck) {
    if (_isLand(card)) return false;
    const tl = _typeLine(card);
    const creatureOrPw = /\bcreature\b/.test(tl) || /\bplaneswalker\b/.test(tl);
    if (!creatureOrPw && !(card && card.isCommander)) return false;
    const api = _plan();
    const score = typeof api.planMatchScore === 'function' ? api.planMatchScore(card, plan, deck) : 0;
    const ir = _ir(card);
    const power = ir && (ir.power_level_hint === 'high' || ir.power_level_hint === 'bomb');
    if (card && card.isCommander) return true;
    if (power && score > 0) return true;
    if (score >= 2 && _cmc(card) >= 5) return true;
    return false;
  }

  function _foundationFnsForCard(card, plan, deck, tags) {
    const fns = [];
    const reasons = [];
    const tagSet = new Set(tags);
    if (DRAW_TAGS.some(t => tagSet.has(t)) || (_ir(card) && Array.isArray(_ir(card).roles) && _ir(card).roles.includes('card_draw'))) {
      fns.push('card_advantage');
      reasons.push(tagSet.has('Wheel') ? 'tag:Wheel' : 'tag:Card Draw');
    }
    if (INTERACTION_TAGS.some(t => tagSet.has(t)) || _burnInteraction(card, tags)) {
      fns.push('interaction');
      reasons.push('tag:interaction');
    }
    if (tagSet.has('Board Wipe')) {
      fns.push('board_wipes');
      reasons.push('tag:Board Wipe');
    }
    return { fns, reasons };
  }

  /**
   * Semantic goal key -> the role tags that constitute it. The analyze endpoint
   * ships English only (evidence and axis tokens are stripped server-side), so
   * card placement is resolved client-side from role tags the deck already has.
   */
  /**
   * engine2 goal key → project role tags used to PLACE cards into that goal's pile.
   *
   * KEYS MUST MATCH `engine2/goal-templates.js` EXACTLY. `deck-goals.js:255` emits the
   * raw template key — `tokens-wide`, not `tokens` — and a key that misses here
   * resolves to `[]`, which makes the goal's Architecture subsection permanently
   * unfillable: membership is `sub.projectTags.some(...)`, so with no tags no card ever
   * joins, and the near-duplicate drop rule is guarded by `if (tags.length && …)` so the
   * empty pile is not collapsed away either. Six goals were in that state, token swarm
   * among them (strategy-gap-audit.md §2.4). `scripts/test-deck-architecture.js` now
   * fails the build on any future drift.
   *
   * Broad on purpose: this map only places cards into an already-chosen pile, it never
   * picks the goal, so supporter-grade tags are the right granularity here.
   */
  const GOAL_ROLE_TAGS = Object.freeze({
    aristocrats: ['Sac Outlet', 'Death Trigger', 'Sac Synergy', 'Token Maker', 'Recursion', 'Reanimate', 'Lifegain', 'Drain'],
    'tokens-wide': ['Token Maker', 'Anthem', 'Copy'],
    spellslinger: ['Counterspell', 'Burn', 'Copy', 'Card Draw'],
    impulse: ['Treasure', 'Graveyard Cast', 'Burn', 'Burn.Any', 'Card Draw'],
    reanimator: ['Reanimate', 'Recursion', 'Self-Mill', 'Mill', 'Discard'],
    blink: ['Blink', 'Copy', 'Card Draw'],
    lifegain: ['Lifegain', 'Drain'],
    stompy: ['Pump', 'Bite', 'Combat Trick', 'Evasion', 'Extra Combat', 'Ramp'],
    counters: ['Pump', 'Anthem', 'Combat Trick', 'Bite'],
    landfall: ['Landfall', 'Ramp'],
    enchantress: ['Card Draw', 'Recursion'],
    artifacts: ['Treasure', 'Copy', 'Recursion'],
    control: ['Counterspell', 'Removal', 'Board Wipe', 'Bounce', 'Card Draw'],
    stax: ['Stax', 'Hatebear'],
    goad: ['Stax', 'Protection', 'Removal'],
    mill: ['Mill', 'Graveyard Cast', 'Control'],
    voltron: ['Protection', 'Evasion', 'Pump', 'Extra Combat'],
    'big-mana': ['Ramp', 'Treasure', 'Card Draw'],
    wheels: ['Wheel', 'Discard', 'Card Draw'],
    graveyard: ['Recursion', 'Reanimate', 'Self-Mill', 'Graveyard Cast', 'Mill'],
    'group-slug': ['Group Slug', 'Burn', 'Burn.Player', 'Burn.Opponents', 'Ping'],
    combo: ['Tutor', 'Copy', 'Recursion'],
    combat: ['Attack Trigger', 'Saboteur', 'Extra Combat', 'Combat Trick', 'Evasion', 'Anthem', 'Pump', 'Haste Enabler'],
    // Forward-compatible: engine2 has no template with these keys today. They cost
    // nothing and are correct the day it gains one.
    equipment: ['Protection', 'Evasion', 'Pump'],
    vehicles: ['Pump', 'Evasion', 'Ramp'],
    food: ['Token Maker', 'Lifegain', 'Sac Outlet'],
  });

  // A lower-confidence goal whose tag list mostly restates a higher one's is
  // the same pile twice under a second name (Lifegain inside Aristocrats,
  // Graveyard beside Reanimator) — drop it at this overlap or above.
  const GOAL_SUB_OVERLAP_DROP = 0.75;

  /**
   * Stable band key for Strategy grouping. Tribal goals stay distinct
   * (`tribal:warrior`) so they do not collapse under generic Typal.
   */
  function _bandIdForSub(sub) {
    if (!sub) return null;
    if (sub.bandId) return String(sub.bandId);
    if (sub.goalKey) {
      const key = String(sub.goalKey);
      if (key.startsWith('tribal:')) return key;
      return _strategyIdForSub(sub) || key;
    }
    if (sub.themeId) {
      const tid = String(sub.themeId);
      if (tid.startsWith('tribal:')) return tid;
      if (tid.startsWith('strategy.typal.')) return tid;
      return _strategyIdForSub(sub) || tid;
    }
    return _strategyIdForSub(sub);
  }

  /**
   * Strategy subsections named by the deck's inferred semantic goal.
   * Goals are confidence-ordered; one that can only duplicate a higher-ranked
   * pile is dropped so every rendered pile says something distinct.
   */
  function _buildGoalSubs(goals) {
    const out = [];
    const seen = new Set();
    for (const g of (goals || [])) {
      if (!g || !g.goal) continue;
      if ((g.confidence || 0) < GOAL_MIN_CONFIDENCE) continue;
      const key = String(g.goal);
      const base = key.startsWith('tribal:') ? 'tribal' : key;
      const id = 'goal:' + key;
      if (seen.has(id)) continue;
      const tags = key.startsWith('tribal:') ? [] : (GOAL_ROLE_TAGS[base] || []);
      if (tags.length && out.some(prev => {
        const prevTags = prev.projectTags || [];
        if (!prevTags.length) return false;
        const shared = tags.filter(t => prevTags.includes(t)).length;
        return shared / tags.length >= GOAL_SUB_OVERLAP_DROP;
      })) {
        continue;
      }
      seen.add(id);
      const strategyId = key.startsWith('tribal:')
        ? 'strategy.tribal'
        : (GOAL_KEY_STRATEGY[base] || ('strategy.' + base));
      out.push({
        id,
        label: g.label || key,
        source: 'goal',
        projectTags: tags,
        goalKey: key,
        themeId: null,
        subtagId: null,
        strategyId,
        bandId: key.startsWith('tribal:') ? key : strategyId,
      });
      if (out.length >= GOAL_MAX_SUBS) break;
    }
    return out;
  }

  function _isCombatStrategyId(id) {
    return id === 'strategy.combat' || String(id || '').startsWith('strategy.combat.');
  }

  // Declared sub-tag rows + theme-vocabulary rows for a plan. This is the
  // generic (non-engine2) source of Architecture strategy subthemes — see
  // _buildStrategySubs for how it composes with engine2 goals.
  function _themeVocabStrategySubs(plan, themeAnalysis, declaredIds) {
    const api = _plan();
    const winId = plan && plan.winConditionId;
    const subs = [];
    const seen = new Set();
    const parentTarget = (api.PLAN_PARENT_DEFAULT_TARGET) || 30;
    const rows = typeof api.activePlanSubTags === 'function'
      ? api.activePlanSubTags(plan, parentTarget)
      : [];
    for (const row of rows) {
      if (_isPayoffSubtag(row.id, winId)) continue;
      const id = 'subtag:' + row.id;
      if (seen.has(id)) continue;
      seen.add(id);
      subs.push({
        id,
        label: row.label,
        source: 'declared',
        projectTags: row.projectTags || [],
        themeId: null,
        subtagId: row.id,
        strategyId: (typeof api.subtagStrategyId === 'function' ? api.subtagStrategyId(row.id) : null) || null,
        bandId: (typeof api.subtagStrategyId === 'function' ? api.subtagStrategyId(row.id) : null) || null,
      });
    }
    const themes = (themeAnalysis && themeAnalysis.themes) || [];
    for (const t of themes) {
      if (!t || !t.id) continue;
      if (declaredIds.has(t.id)) continue;
      if (t.id === 'strategy.goodstuff' || t.id === 'strategy.other') continue;
      const count = t.supportCount || 0;
      if (count < LIGHT_MIN) continue;
      const id = 'theme:' + t.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const strategyId = String(t.id).startsWith('tribal:')
        ? 'strategy.tribal'
        : t.id;
      const bandId = String(t.id).startsWith('tribal:')
        ? String(t.id)
        : strategyId;
      subs.push({
        id,
        label: t.label || t.id,
        source: 'inferred',
        projectTags: [],
        themeId: t.id,
        subtagId: null,
        strategyId,
        bandId,
      });
    }
    return subs;
  }

  function _buildStrategySubs(plan, themeAnalysis, declaredIds, goals) {
    // The semantic engine's goal is a better statement of what the deck is
    // trying to do than the generic theme vocabulary, so it wins when present.
    const goalSubs = _buildGoalSubs(goals);
    if (goalSubs.length) {
      // ── COMBAT SUBTHEME WORKAROUND ── TEMPORARY. See docs/23-semantics-holes.md,
      // "engine2 has no `combat` goal template". engine2 never emits a `combat` goal
      // key (GOAL_KEY_STRATEGY.combat is inert — nothing calls it), so _buildGoalSubs
      // above never produces a strategy.combat.* sub, and because this function used
      // to return goalSubs outright whenever ANY engine2 goal existed (true for
      // nearly every deck), the theme-vocabulary rows that carry Combat's drilldown
      // children (Attack triggers / Saboteur / Extra combats) never got a chance to
      // run either. Splice those rows in by hand, scoped to the combat family only,
      // so engine2's goal read still wins everywhere else.
      //
      // DELETE this block (and _isCombatStrategyId's use here) the day engine2 ships
      // a `combat` goal template: at that point GOAL_KEY_STRATEGY.combat stops being
      // inert, _buildGoalSubs supplies combat subs on its own, and this splice would
      // just duplicate them.
      const seen = new Set(goalSubs.map(s => s.id));
      const combatSubs = _themeVocabStrategySubs(plan, themeAnalysis, declaredIds)
        .filter(s => _isCombatStrategyId(s.strategyId) && !seen.has(s.id));
      return combatSubs.length ? goalSubs.concat(combatSubs) : goalSubs;
    }
    return _themeVocabStrategySubs(plan, themeAnalysis, declaredIds);
  }

  /**
   * engine2 goal key → plan strategy id. Same contract as GOAL_ROLE_TAGS: the keys are
   * `engine2/goal-templates.js` keys, verbatim. A missing key used to fall through to
   * `'strategy.' + key`, inventing ids like `strategy.tokens-wide` and
   * `strategy.big-mana` that exist nowhere in PLAN_STRATEGIES — so every lookup that
   * joins back to the catalog (labels, sub-tag targets, Adds scoring, the shortlist)
   * silently missed. Eight of the 22 templates were in that state, and it stayed
   * invisible because the subsection heading reads from the goal's own label
   * (strategy-gap-audit.md §2.4).
   */
  const GOAL_KEY_STRATEGY = Object.freeze({
    aristocrats: 'strategy.sacrifice',
    'tokens-wide': 'strategy.tokens.go_wide',
    go_wide: 'strategy.tokens.go_wide',
    tokens: 'strategy.tokens',
    spellslinger: 'strategy.spellslinger',
    impulse: 'strategy.impulse',
    reanimator: 'strategy.reanimator',
    blink: 'strategy.blink',
    counters: 'strategy.counters',
    landfall: 'strategy.landfall',
    enchantress: 'strategy.auras',
    auras: 'strategy.auras',
    artifacts: 'strategy.artifacts',
    control: 'strategy.control',
    stax: 'strategy.stax',
    // Owner lock #4: goad-as-politics lives with Stax, not with Combat.
    goad: 'strategy.stax',
    mill: 'strategy.mill',
    voltron: 'strategy.voltron',
    stompy: 'strategy.stompy',
    'big-mana': 'strategy.big_mana',
    wheels: 'strategy.wheels',
    // The catalog row is literally "Reanimator / Graveyard" — no second row needed.
    graveyard: 'strategy.reanimator',
    'group-slug': 'strategy.group_slug',
    equipment: 'strategy.equipment',
    vehicles: 'strategy.vehicles',
    food: 'strategy.food',
    lifegain: 'strategy.lifegain',
    combo: 'strategy.combo',
    // Inert until engine2 ships a 'combat' goal template (that change needs partner sign-off
    // — strategy-combat-research.md §6); harmless and forward-compatible meanwhile. Because
    // this never fires, _buildStrategySubs' COMBAT SUBTHEME WORKAROUND block carries Combat's
    // subthemes client-side in the meantime — see that comment for the deletion contract.
    combat: 'strategy.combat',
  });

  function _canonicalStrategyId(id) {
    if (!id) return id;
    if (root && typeof root.canonicalizeStrategyId === 'function') {
      return root.canonicalizeStrategyId(id);
    }
    if (id === 'strategy.enchantress') return 'strategy.auras';
    if (id === 'theme.lifegain') return 'strategy.lifegain';
    return id;
  }

  function _strategyIdForSub(sub) {
    if (!sub) return null;
    if (sub.strategyId) return _canonicalStrategyId(sub.strategyId);
    if (sub.subtagId) {
      const api = _plan();
      if (typeof api.subtagStrategyId === 'function') {
        return _canonicalStrategyId(api.subtagStrategyId(sub.subtagId) || null);
      }
    }
    if (sub.themeId) {
      if (String(sub.themeId).startsWith('tribal:')) return 'strategy.tribal';
      if (String(sub.themeId).startsWith('strategy.typal.')) return sub.themeId;
      return _canonicalStrategyId(sub.themeId);
    }
    if (sub.goalKey) {
      const key = String(sub.goalKey);
      if (key.startsWith('tribal:')) return 'strategy.tribal';
      if (key.startsWith('strategy.typal.')) return key;
      const base = key.startsWith('strategy.') ? key : (GOAL_KEY_STRATEGY[key] || ('strategy.' + key));
      return _canonicalStrategyId(base);
    }
    return null;
  }

  function _strategyLabel(strategyId) {
    const api = _plan();
    if (typeof api.strategyLabel === 'function') return api.strategyLabel(strategyId);
    return strategyId || '';
  }

  function _identityLabel(bandId, subs) {
    if (!bandId) return '';
    const match = (subs || []).find(s => _bandIdForSub(s) === bandId);
    if (match && match.label) return match.label;
    const api = _plan();
    if (typeof api.strategyLabel === 'function' && String(bandId).startsWith('strategy.')) {
      return api.strategyLabel(bandId);
    }
    if (String(bandId).startsWith('tribal:')) {
      const type = bandId.slice('tribal:'.length);
      if (type) return type.charAt(0).toUpperCase() + type.slice(1) + ' typal';
    }
    return bandId;
  }

  /**
   * Architecture strategy/wincon identity: overrides → top goals → Light+ themes.
   * Independent of Plan (Plan may be feature-off).
   */
  function resolveArchitectureIdentity(overrides, strategySubs, goals, themeAnalysis) {
    const ov = normalizeArchitectureOverrides(overrides);
    const subs = strategySubs || [];
    let primary = ov.primaryStrategyId || null;
    let secondary = ov.secondaryStrategyId || null;
    const winConditionId = ov.winConditionId || null;

    const inferred = [];
    const seen = new Set();
    const push = (id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      inferred.push(id);
    };
    for (const sub of subs) {
      if (sub.source === 'goal' || sub.goalKey) push(_bandIdForSub(sub));
    }
    if (!inferred.length) {
      for (const g of (goals || [])) {
        if (!g || !g.goal) continue;
        if ((g.confidence || 0) < GOAL_MIN_CONFIDENCE) continue;
        const key = String(g.goal);
        push(key.startsWith('tribal:') ? key : (GOAL_KEY_STRATEGY[key] || ('strategy.' + key)));
        if (inferred.length >= 2) break;
      }
    }
    if (!inferred.length) {
      for (const sub of subs) push(_bandIdForSub(sub));
    }
    if (!inferred.length) {
      const themes = (themeAnalysis && themeAnalysis.themes) || [];
      for (const t of themes) {
        if (!t || !t.id) continue;
        if (t.id === 'strategy.goodstuff' || t.id === 'strategy.other') continue;
        if ((t.supportCount || 0) < LIGHT_MIN) continue;
        const tid = String(t.id);
        push(tid.startsWith('tribal:') ? tid : tid);
        if (inferred.length >= 2) break;
      }
    }

    if (!primary && inferred[0]) primary = inferred[0];
    if (!secondary && inferred[1] && inferred[1] !== primary) secondary = inferred[1];
    if (secondary && secondary === primary) secondary = null;

    return {
      primaryStrategyId: primary,
      secondaryStrategyId: secondary,
      winConditionId,
      primaryLabel: _identityLabel(primary, subs),
      secondaryLabel: _identityLabel(secondary, subs),
    };
  }

  /**
   * Bucket Strategy piles under primary / secondary identity so the panel can
   * title those strategies. Leftovers (inferred off-identity themes) sit last as
   * "Detected themes" and render collapsed. When neither identity is set,
   * returns null — caller keeps a flat list.
   */
  function architectureStrategyBands(model) {
    const list = (model && model.strategySubs) || [];
    const identity = (model && model.architectureIdentity)
      || resolveArchitectureIdentity(
        model && model.architectureOverrides,
        list,
        model && model.goals,
        model && model.themeAnalysis,
      );
    const primaryId = identity.primaryStrategyId || null;
    const secondaryId = identity.secondaryStrategyId || null;
    const ov = normalizeArchitectureOverrides(model && model.architectureOverrides);
    const promotedIds = (ov.promotedStrategyIds || [])
      .filter(id => id && id !== primaryId && id !== secondaryId);
    if (!primaryId && !secondaryId && !promotedIds.length) return null;
    const used = new Set();
    const take = (bandId) => {
      const subs = [];
      for (const sub of list) {
        if (used.has(sub.id)) continue;
        if (_bandIdForSub(sub) === bandId) {
          used.add(sub.id);
          subs.push(sub);
        }
      }
      return subs;
    };
    const bands = [];
    if (primaryId) {
      bands.push({
        role: 'primary',
        strategyId: primaryId,
        bandId: primaryId,
        label: identity.primaryLabel || _identityLabel(primaryId, list),
        subs: take(primaryId),
      });
    }
    if (secondaryId && secondaryId !== primaryId) {
      bands.push({
        role: 'secondary',
        strategyId: secondaryId,
        bandId: secondaryId,
        label: identity.secondaryLabel || _identityLabel(secondaryId, list),
        subs: take(secondaryId),
      });
    }
    // Promoted via the "Detected themes" Promote button — additive: each gets
    // its own strong header alongside primary/secondary, not swapped in for them.
    for (const promotedId of promotedIds) {
      bands.push({
        role: 'promoted',
        strategyId: promotedId,
        bandId: promotedId,
        label: _identityLabel(promotedId, list),
        subs: take(promotedId),
      });
    }
    const rest = list.filter(s => !used.has(s.id));
    if (rest.length) {
      bands.push({
        role: 'other',
        strategyId: null,
        bandId: null,
        label: 'Detected themes',
        collapsed: true,
        subs: rest,
      });
    }
    return bands;
  }

  function _buildPayoffSubs(plan, themeAnalysis, declaredIds) {
    const winId = plan && plan.winConditionId;
    const api = _plan();
    const parentTarget = (api.PLAN_PARENT_DEFAULT_TARGET) || 30;
    const rows = typeof api.activePlanSubTags === 'function'
      ? api.activePlanSubTags(plan, parentTarget)
      : [];
    const themeIds = new Set(((themeAnalysis && themeAnalysis.themes) || []).map(t => t.id));
    // "Token / Swarm Payoffs" is about board width, so it keys off the go-wide
    // half of the tokens family plus typal — not off Treasure or Clues, which
    // make tokens but never a swarm. The umbrella still counts: an unsplit
    // Tokens pick means the deck makes tokens and has not said which kind.
    const SWARM_STRATEGY_IDS = ['strategy.tokens', 'strategy.tokens.go_wide', 'strategy.tribal'];
    const swarmDeclared = SWARM_STRATEGY_IDS.some(id => declaredIds.has(id));
    const hasTokens = swarmDeclared
      || [...themeIds].some(id => SWARM_STRATEGY_IDS.includes(id) || String(id).startsWith('tribal:'));
    // Each pile answers a distinct question ("Win Condition Payoffs" was a
    // literal duplicate of Win Condition — same predicate — and is gone).
    const out = [];
    out.push({ id: 'win_condition', label: 'Win Condition', source: winId ? 'declared' : 'inferred' });
    if (winId === 'wincon.combo') out.push({ id: 'combo', label: 'Combo Pieces', source: 'declared' });
    if (hasTokens) out.push({ id: 'token_swarm', label: 'Token / Swarm Payoffs', source: swarmDeclared ? 'declared' : 'inferred' });
    if (winId === 'wincon.value' || rows.some(r => /payoff/i.test(r.label || '') || /payoff/.test(r.id || ''))) {
      out.push({ id: 'value_finishers', label: 'Value Finishers', source: winId === 'wincon.value' ? 'declared' : 'inferred' });
    }
    out.push({ id: 'threats', label: 'Threats / Bombs', source: 'inferred' });
    return out;
  }

  function _cardStrategySubs(card, deck, plan, strategySubs, tags) {
    const hit = [];
    const reasons = [];
    const tagSet = new Set(tags);
    const th = _themes();
    for (const sub of strategySubs) {
      if (sub.goalKey) {
        // A card may serve several goals (a token maker feeds Aristocrats AND
        // Tokens) — membership in each is judged on its own; near-duplicate
        // goal piles were already dropped in _buildGoalSubs.
        if (sub.goalKey.startsWith('tribal:')) {
          const type = sub.goalKey.slice('tribal:'.length).toLowerCase();
          if (type && _typeLine(card).includes(type)) {
            hit.push(sub.id);
            reasons.push('goalTribal:' + type);
          }
          continue;
        }
        if ((sub.projectTags || []).some(t => tagSet.has(t))) {
          hit.push(sub.id);
          reasons.push('goal:' + sub.goalKey);
        }
        continue;
      }
      if (sub.subtagId && (sub.projectTags || []).some(t => tagSet.has(t))) {
        hit.push(sub.id);
        reasons.push('planSubtag:' + sub.subtagId);
        continue;
      }
      if (sub.themeId && typeof th.cardSupportsTheme === 'function' && th.cardSupportsTheme(card, sub.themeId)) {
        hit.push(sub.id);
        reasons.push('theme:' + sub.themeId);
      }
    }
    return { hit, reasons };
  }

  function _cardPayoffSubs(card, deck, plan, payoffSubs, tags, ctxGoals) {
    const hit = [];
    const reasons = [];
    const tagSet = new Set(tags);
    const api = _plan();
    const winId = plan && plan.winConditionId;
    const parentTarget = (api.PLAN_PARENT_DEFAULT_TARGET) || 30;
    const rows = typeof api.activePlanSubTags === 'function' ? api.activePlanSubTags(plan, parentTarget) : [];
    const payoffRows = rows.filter(r => _isPayoffSubtag(r.id, winId));
    // Token-flavored payoff subtags (tokens.payoffs, tribal.finishers, …) are
    // excluded from Value Finishers so a token-plan row cannot feed that pile;
    // they do NOT feed Token / Swarm either. Their tags exist for plan-progress
    // counting and describe supply or single bodies ('Token Maker' is the
    // engine's supply; tribal.finishers' 'Evasion' pays off that one creature,
    // not the swarm) — Token / Swarm membership needs a conversion tag below.
    const tokenRows = payoffRows.filter(r => /token|tribal|type/i.test(r.id + r.label));
    const valueRows = payoffRows.filter(r => !tokenRows.includes(r));
    const rowMatch = (list) => list.some(r => (r.projectTags || []).some(t => t !== 'Token Maker' && tagSet.has(t)));

    // One signal, one home: a card that closes the game the deck's stated way
    // is Win Condition, and the other piles are defined as NOT that — Combo
    // Pieces is the more specific statement of it in a combo deck, Token /
    // Swarm pays off going wide short of winning outright, Value Finishers
    // grind the plan's payoffs out, Threats / Bombs is off-plan muscle.
    const isWincon = _cardHasWinconSignal(card, plan, deck, ctxGoals);
    let comboReason = '';
    if (payoffSubs.some(s => s.id === 'combo') && (isWincon || tagSet.has('Tutor'))) {
      if (_ir(card) && _ir(card).wincon && _ir(card).wincon.kind === 'combo_piece') comboReason = 'ir:combo';
      else if (/\binfinite\b/.test(_oracle(card))) comboReason = 'oracle:combo';
    }

    for (const sub of payoffSubs) {
      // Win Condition moved out of Foundation: "does this deck close games" is a
      // payoff question, and its finishers already live here.
      if (sub.subtagId && (sub.projectTags || []).some(t => tagSet.has(t))) {
        hit.push(sub.id);
        reasons.push('planSubtag:' + sub.subtagId);
      } else if (sub.id === 'win_condition' && isWincon && !comboReason) {
        hit.push(sub.id);
        reasons.push('wincon');
      } else if (sub.id === 'combo' && comboReason) {
        hit.push(sub.id);
        reasons.push(comboReason);
      } else if (sub.id === 'token_swarm' && !isWincon && !_isLand(card)
          && (tagSet.has('Anthem') || tagSet.has('Extra Combat') || tagSet.has('Drain'))) {
        hit.push(sub.id);
        reasons.push('payoff:tokens');
      } else if (sub.id === 'value_finishers' && !isWincon && !_isLand(card) && rowMatch(valueRows)) {
        hit.push(sub.id);
        reasons.push('planSubtag:payoff');
      } else if (sub.id === 'threats' && !isWincon && !comboReason && _isThreatBomb(card, plan, deck)) {
        hit.push(sub.id);
        reasons.push('threat');
      }
    }
    return { hit, reasons };
  }

  function _isStapleOnly(tags) {
    const meaningful = tags.filter(t => t && !STAPLE_ONLY.includes(t));
    return meaningful.length === 0;
  }

  function _cardIsRamp(card, tags) {
    const tagSet = tags instanceof Set ? tags : new Set(tags || []);
    if (tagSet.has('Ramp')) return true;
    const ir = _ir(card);
    return !!(ir && Array.isArray(ir.roles) && (
      ir.roles.includes('ramp') || ir.roles.includes('mana_rock') || ir.roles.includes('mana_dork')
    ));
  }

  function classifyCardArchitecture(card, ctx) {
    const { deck, plan, strategySubs, payoffSubs } = ctx;
    const tags = _roles(card, deck);
    const categories = new Set();
    const reasons = [];
    let ambiguous = false;

    const manabaseSubs = [];
    if (_isLand(card)) {
      categories.add('manabase');
      manabaseSubs.push(_isBasicLand(card) ? 'basics' : 'nonbasics');
      reasons.push('type:land');
    }
    if (_cardIsRamp(card, tags)) {
      categories.add('manabase');
      manabaseSubs.push('ramp');
      reasons.push('tag:Ramp');
    }

    const f = _foundationFnsForCard(card, plan, deck, tags);
    f.reasons.forEach(r => reasons.push(r));
    if (f.fns.length) categories.add('foundation');

    const s = _cardStrategySubs(card, deck, plan, strategySubs, tags);
    s.reasons.forEach(r => reasons.push(r));
    if (s.hit.length) categories.add('strategy');

    const p = _cardPayoffSubs(card, deck, plan, payoffSubs, tags, ctx.goals);
    p.reasons.forEach(r => reasons.push(r));
    if (p.hit.length) categories.add('payoffs');

    if (!categories.size && !_isLand(card)) {
      const api = _plan();
      const score = typeof api.planMatchScore === 'function' ? api.planMatchScore(card, plan, deck) : 0;
      const fallback = strategySubs.find(sub => sub.id === 'theme:fallback_enablers');
      if (score > 0 && !_isStapleOnly(tags) && fallback) {
        categories.add('strategy');
        s.hit.push(fallback.id);
        reasons.push('planMatch');
      } else {
        ambiguous = true;
      }
    }

    const fullName = card && card.name || '';
    return {
      key: architectureCardKey(card),
      // Every double-faced row truncated mid-back-face ("Jwari Disruption //
      // Jwari…"), spending half the row on a name you could not read. Show the
      // front face; fullName keeps both for the tooltip.
      name: _frontFaceName(fullName),
      fullName,
      qty: _qty(card),
      card,
      categories: _uniqIds([...categories]),
      foundationFns: _uniqIds(f.fns),
      strategySubs: _uniqIds(s.hit),
      payoffSubs: _uniqIds(p.hit),
      manabaseSubs: _uniqIds(manabaseSubs),
      interactionGroups: f.fns.includes('interaction') ? _uniqIds(_removalTargetsForCard(card, ctx)) : [],
      reasons: _uniqIds(reasons),
      ambiguous,
      primary: null,
      source: 'inferred',
    };
  }

  /** True for Plains/Island/.../Wastes, including snow-covered printings. */
  function _isBasicLandCard(card) {
    const t = _typeLine(card);
    return t.includes('basic') && t.includes('land');
  }

  /**
   * One Architecture line per card identity (`architectureCardKey`). Duplicate
   * deck slots for the same oracle (commander + extra copy, sync doubles, …)
   * must not render twice inside the same subsection.
   */
  function _uniqIds(list) {
    const out = [];
    const seen = new Set();
    for (const id of list || []) {
      if (id == null || id === '') continue;
      const k = String(id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(id);
    }
    return out;
  }

  function _mergeArchitectureRowsByKey(rows) {
    const out = [];
    const byKey = new Map();
    for (const row of rows || []) {
      if (!row || !row.key) {
        if (row) out.push(row);
        continue;
      }
      const seen = byKey.get(row.key);
      if (!seen) {
        const copy = {
          ...row,
          qty: row.qty || 1,
          categories: _uniqIds(row.categories),
          foundationFns: _uniqIds(row.foundationFns),
          strategySubs: _uniqIds(row.strategySubs),
          payoffSubs: _uniqIds(row.payoffSubs),
          manabaseSubs: _uniqIds(row.manabaseSubs),
          reasons: _uniqIds(row.reasons),
        };
        byKey.set(row.key, copy);
        out.push(copy);
        continue;
      }
      seen.qty = (seen.qty || 1) + (row.qty || 1);
      seen.foundationFns = _uniqIds([...(seen.foundationFns || []), ...(row.foundationFns || [])]);
      seen.strategySubs = _uniqIds([...(seen.strategySubs || []), ...(row.strategySubs || [])]);
      seen.payoffSubs = _uniqIds([...(seen.payoffSubs || []), ...(row.payoffSubs || [])]);
      seen.manabaseSubs = _uniqIds([...(seen.manabaseSubs || []), ...(row.manabaseSubs || [])]);
      seen.categories = _uniqIds([...(seen.categories || []), ...(row.categories || [])]);
      seen.reasons = _uniqIds([...(seen.reasons || []), ...(row.reasons || [])]);
      if (row.card && row.card.isCommander) seen.card = row.card;
      if (row.primary && (!seen.primary || row.source === 'override')) {
        seen.primary = row.primary;
        if (row.source === 'override') seen.source = 'override';
      }
      seen.ambiguous = !(seen.categories && seen.categories.length);
    }
    return out;
  }

  /**
   * One row per basic land name instead of one per copy — a 12-Plains deck
   * listed twelve identical rows. Rows are merged only when they agree on
   * category, so a per-copy override still stands on its own.
   */
  function _mergeBasicLandRows(rows) {
    const out = [];
    const byKey = new Map();
    for (const row of rows) {
      if (!row || !_isBasicLandCard(row.card)) { out.push(row); continue; }
      const key = String(row.name || '').toLowerCase() + '|' + (row.categories || []).slice().sort().join(',');
      const seen = byKey.get(key);
      if (seen) { seen.qty += row.qty; continue; }
      const merged = { ...row, qty: row.qty };
      byKey.set(key, merged);
      out.push(merged);
    }
    return out;
  }

  function applyArchitectureOverrides(rows, overrides) {
    const ov = normalizeArchitectureOverrides(overrides);
    return rows.map(row => {
      const rec = ov.byKey[row.key];
      if (!rec) return row;
      const next = { ...row, categories: row.categories.slice(), foundationFns: row.foundationFns.slice(), strategySubs: row.strategySubs.slice(), payoffSubs: row.payoffSubs.slice(), manabaseSubs: row.manabaseSubs.slice(), reasons: row.reasons.slice() };
      if (rec.unassigned) {
        next.categories = [];
        next.foundationFns = [];
        next.strategySubs = [];
        next.payoffSubs = [];
        next.manabaseSubs = [];
        next.ambiguous = true;
        next.primary = null;
        next.source = 'override';
        next.reasons = ['override:unassigned'];
        return next;
      }
      const removed = new Set((rec.extrasRemoved || []).map(_memKey));
      const strip = (cat, sub, listName) => {
        if (!removed.has(cat + '::' + sub)) return;
        next[listName] = (next[listName] || []).filter(id => id !== sub);
      };
      for (const fn of next.foundationFns.slice()) strip('foundation', fn, 'foundationFns');
      for (const id of next.strategySubs.slice()) strip('strategy', id, 'strategySubs');
      for (const id of next.payoffSubs.slice()) strip('payoffs', id, 'payoffSubs');
      for (const id of next.manabaseSubs.slice()) strip('manabase', id, 'manabaseSubs');

      for (const add of rec.extrasAdded || []) {
        if (add.category === 'foundation' && add.subsection && !next.foundationFns.includes(add.subsection)) next.foundationFns.push(add.subsection);
        if (add.category === 'strategy' && add.subsection && !next.strategySubs.includes(add.subsection)) next.strategySubs.push(add.subsection);
        if (add.category === 'payoffs' && add.subsection && !next.payoffSubs.includes(add.subsection)) next.payoffSubs.push(add.subsection);
        if (add.category === 'manabase' && add.subsection && !next.manabaseSubs.includes(add.subsection)) next.manabaseSubs.push(add.subsection);
      }

      if (rec.primary && rec.primary.category) {
        next.primary = { category: rec.primary.category, subsection: rec.primary.subsection || '' };
        next.source = 'override';
        if (rec.primary.category === 'foundation' && rec.primary.subsection && !next.foundationFns.includes(rec.primary.subsection)) {
          next.foundationFns.push(rec.primary.subsection);
        }
        if (rec.primary.category === 'strategy' && rec.primary.subsection && !next.strategySubs.includes(rec.primary.subsection)) {
          next.strategySubs.push(rec.primary.subsection);
        }
        if (rec.primary.category === 'payoffs' && rec.primary.subsection && !next.payoffSubs.includes(rec.primary.subsection)) {
          next.payoffSubs.push(rec.primary.subsection);
        }
        if (rec.primary.category === 'manabase' && rec.primary.subsection && !next.manabaseSubs.includes(rec.primary.subsection)) {
          next.manabaseSubs.push(rec.primary.subsection);
        }
        if (!next.categories.includes(rec.primary.category)) next.categories.push(rec.primary.category);
      }

      next.categories = [];
      if (next.foundationFns.length) next.categories.push('foundation');
      if (next.strategySubs.length) next.categories.push('strategy');
      if (next.payoffSubs.length) next.categories.push('payoffs');
      if (next.manabaseSubs.length) next.categories.push('manabase');
      next.ambiguous = next.categories.length === 0;
      return next;
    });
  }

  function setArchitecturePrimary(overrides, cardKey, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const rec = ov.byKey[cardKey] || { primary: null, extrasRemoved: [], extrasAdded: [], unassigned: false };
    rec.unassigned = false;
    rec.primary = { category, subsection: subsection || '' };
    ov.byKey[cardKey] = rec;
    return ov;
  }

  /**
   * Drag / Move-to between piles: strip only the source membership, then set
   * primary on the destination. Other panels' memberships stay. No-op when
   * from and to are the same pile.
   */
  function moveArchitectureMembership(overrides, cardKey, fromCat, fromSub, toCat, toSub) {
    let ov = normalizeArchitectureOverrides(overrides);
    if (!cardKey || !toCat) return ov;
    const toSubId = toSub || '';
    const same = fromCat && fromSub != null
      && fromCat === toCat && String(fromSub) === String(toSubId);
    if (same) return ov;
    if (fromCat && fromSub != null && String(fromSub) !== '') {
      ov = removeArchitectureMembership(ov, cardKey, fromCat, fromSub);
    }
    return setArchitecturePrimary(ov, cardKey, toCat, toSubId);
  }

  function addArchitectureExtra(overrides, cardKey, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const rec = ov.byKey[cardKey] || { primary: null, extrasRemoved: [], extrasAdded: [], unassigned: false };
    rec.unassigned = false;
    rec.extrasRemoved = rec.extrasRemoved.filter(m => _memKey(m) !== category + '::' + subsection);
    if (!rec.extrasAdded.some(m => _memKey(m) === category + '::' + subsection)) {
      rec.extrasAdded.push({ category, subsection });
    }
    ov.byKey[cardKey] = rec;
    return ov;
  }

  function removeArchitectureMembership(overrides, cardKey, category, subsection) {
    const ov = normalizeArchitectureOverrides(overrides);
    const rec = ov.byKey[cardKey] || { primary: null, extrasRemoved: [], extrasAdded: [], unassigned: false };
    rec.extrasAdded = rec.extrasAdded.filter(m => _memKey(m) !== category + '::' + subsection);
    if (!rec.extrasRemoved.some(m => _memKey(m) === category + '::' + subsection)) {
      rec.extrasRemoved.push({ category, subsection });
    }
    if (rec.primary && rec.primary.category === category && rec.primary.subsection === subsection) {
      rec.primary = null;
    }
    ov.byKey[cardKey] = rec;
    return ov;
  }

  function resetArchitectureCard(overrides, cardKey) {
    const ov = normalizeArchitectureOverrides(overrides);
    delete ov.byKey[cardKey];
    return ov;
  }

  function unassignArchitectureCard(overrides, cardKey) {
    const ov = normalizeArchitectureOverrides(overrides);
    ov.byKey[cardKey] = { primary: null, extrasRemoved: [], extrasAdded: [], unassigned: true };
    return ov;
  }

  function _counts(rows, strategySubs, payoffSubs) {
    const unique = (pred) => rows.filter(pred).reduce((s, r) => s + r.qty, 0);
    const foundationUnique = unique(r => r.categories.includes('foundation'));
    const strategyUnique = unique(r => r.categories.includes('strategy'));
    const payoffsUnique = unique(r => r.categories.includes('payoffs'));
    const manabaseUnique = unique(r => r.categories.includes('manabase'));
    const deckUnique = rows.reduce((s, r) => s + r.qty, 0);
    const foundationFns = {};
    for (const fn of FOUNDATION_FNS) {
      foundationFns[fn.id] = unique(r => r.foundationFns.includes(fn.id));
    }
    const strategy = {};
    for (const sub of strategySubs) strategy[sub.id] = unique(r => r.strategySubs.includes(sub.id));
    const payoffs = {};
    for (const sub of payoffSubs) payoffs[sub.id] = unique(r => r.payoffSubs.includes(sub.id));
    const manabase = {};
    for (const sub of MANABASE_SUBS) {
      manabase[sub.id] = unique(r => r.manabaseSubs.includes(sub.id));
    }
    const multiRole = rows.filter(r => r.categories.length >= 2);
    return {
      deckUnique,
      foundationUnique,
      strategyUnique,
      payoffsUnique,
      manabaseUnique,
      foundationFns,
      strategy,
      payoffs,
      manabase,
      multiRoleCount: multiRole.reduce((s, r) => s + r.qty, 0),
    };
  }

  function classifyDeckArchitecture(deck, plan, opts) {
    const api = _plan();
    const th = _themes();
    const resolvedPlan = (typeof api.getDeckPlan === 'function')
      ? api.getDeckPlan({ plan: plan || (deck && deck.plan) })
      : (plan || (deck && deck.plan) || {});
    const cards = ((opts && opts.cards) || (deck && deck.cards) || []).filter(c => c && !c._plannedAdd);
    const themeAnalysis = typeof th.analyzeDeckThemes === 'function'
      ? th.analyzeDeckThemes(deck || { cards, plan: resolvedPlan }, resolvedPlan)
      : { themes: [], fit: [] };
    const declaredList = typeof th.userThemesFromPlan === 'function'
      ? th.userThemesFromPlan(resolvedPlan)
      : [];
    const declaredIds = new Set(declaredList.map(t => t.id));
    const goals = (opts && opts.goals) || null;
    const overrides = (opts && opts.overrides) || (deck && deck.architectureOverrides);

    let strategySubs = _buildStrategySubs(resolvedPlan, themeAnalysis, declaredIds, goals);
    if (!strategySubs.length) {
      const apiPlan = _plan();
      const anyMatch = cards.some(c => typeof apiPlan.planMatchScore === 'function' && apiPlan.planMatchScore(c, resolvedPlan, deck) > 0 && !_isStapleOnly(_roles(c, deck)));
      if (anyMatch) {
        strategySubs = [{
          id: 'theme:fallback_enablers',
          label: 'Synergy Enablers',
          source: 'inferred',
          projectTags: [],
          themeId: null,
          subtagId: null,
          bandId: 'theme:fallback_enablers',
        }];
      }
    }

    const architectureIdentity = resolveArchitectureIdentity(overrides, strategySubs, goals, themeAnalysis);
    // Payoffs / card context see Architecture wincon (overrides) when Plan identity is off.
    const effectivePlan = Object.assign({}, resolvedPlan, {
      winConditionId: architectureIdentity.winConditionId || resolvedPlan.winConditionId || null,
      primaryStrategyId: architectureIdentity.primaryStrategyId || resolvedPlan.primaryStrategyId || null,
      secondaryStrategyId: architectureIdentity.secondaryStrategyId || resolvedPlan.secondaryStrategyId || null,
    });

    let payoffSubsAll = _buildPayoffSubs(effectivePlan, themeAnalysis, declaredIds);
    const merged = _mergePinnedSubsIntoLists(strategySubs, payoffSubsAll, overrides, effectivePlan);
    strategySubs = merged.strategySubs;
    payoffSubsAll = merged.payoffSubs;

    const ctx = { deck, plan: effectivePlan, strategySubs, payoffSubs: payoffSubsAll, goals, removalTargets: (opts && opts.removalTargets) || null };
    let rows = cards.map(c => classifyCardArchitecture(c, ctx));
    rows = applyArchitectureOverrides(rows, overrides);
    rows = _mergeArchitectureRowsByKey(rows);
    rows = _mergeBasicLandRows(rows);

    const usedPayoff = new Set();
    rows.forEach(r => r.payoffSubs.forEach(id => usedPayoff.add(id)));
    const pinnedPay = new Set(
      normalizeArchitectureOverrides(overrides).pinnedSubs
        .filter(m => m.category === 'payoffs')
        .map(m => m.subsection),
    );
    const payoffSubs = payoffSubsAll.filter(s => usedPayoff.has(s.id) || pinnedPay.has(s.id));

    const counts = _counts(rows, strategySubs, payoffSubs);
    const winId = effectivePlan.winConditionId;
    const winLabel = (typeof api.winconLabel === 'function' && winId)
      ? api.winconLabel(winId)
      : (winId ? winId : 'Not set');

    return applyHiddenArchitectureSubsections({
      plan: effectivePlan,
      architectureOverrides: normalizeArchitectureOverrides(overrides),
      architectureIdentity,
      goals: goals || [],
      winConditionLabel: winLabel,
      rows,
      strategySubs,
      payoffSubs,
      foundationFns: FOUNDATION_FNS,
      counts,
      unassigned: rows.filter(r => !r.categories.length),
      multiRole: rows.filter(r => r.categories.length >= 2),
      themeAnalysis,
    }, overrides);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _cardRowHtml(row, opts) {
    if (opts && typeof opts.cardHtml === 'function') {
      const custom = opts.cardHtml(row, opts);
      if (custom) return custom;
    }
    const c = row.card || {};
    const key = _esc(row.key);
    const name = _esc(row.name);
    const qty = row.qty;
    const o = opts || {};
    // Only mark the home pile instance — row.primary is an object whenever an
    // override exists, so a truthy check painted every copy (and looked like hover).
    const primaryHere = !!(row.primary && o.placeCat
      && row.primary.category === o.placeCat
      && String(row.primary.subsection || '') === String(o.placeSub || ''));
    const primaryMark = primaryHere ? ' is-arch-primary' : '';
    let badge = '';
    if (opts && typeof opts.badgeHtml === 'function') badge = opts.badgeHtml(c) || '';
    let mana = '';
    if (opts && typeof opts.manaHtml === 'function') mana = opts.manaHtml(c) || '';
    const qtyHtml = Number(qty) > 1 ? `<span class="deck-list-qty">×${qty}</span>` : '';
    const menu = (opts && opts.canEdit)
      ? `<button type="button" class="btn btn-ghost btn-sm arch-card-menu" data-arch-menu="${key}" title="Architecture placement">⋯</button>`
      : '';
    // Two fixed slots at the row end keep the mana cost and the badges each in their
    // own column across every row; the ⋯ sits on top of the mana cost.
    const badges = `${badge}${qtyHtml}`.trim();
    const titleAttr = row.fullName && row.fullName !== row.name ? ` title="${_esc(row.fullName)}"` : '';
    return `<div class="arch-card-row deck-card-row${primaryMark}" data-arch-key="${key}" data-card-name-key="${_esc(String(c.name || '').trim().toLowerCase())}" data-uid="${_esc(c.uid || c.scryfallId || '')}">
      <span class="deck-card-name"${titleAttr}>${name}</span><span class="arch-row-end"><span class="arch-row-mana">${mana}</span>${menu}</span><span class="arch-row-badges">${badges}</span>
    </div>`;
  }

  // Stacked + card-image: pack as many subcategory columns as will fit. Prefer
  // 2 overlapping piles per subcategory only when that does not reduce how many
  // subcategories sit in the row. Card size shrinks/caps to fit; columns do not
  // stretch to fill leftover width.
  const ARCH_STACK_CARD_MIN = 120;
  const ARCH_STACK_CARD_MAX = 280;
  const ARCH_STACK_COL_GAP = 36;

  function architectureMaxSubCount(model) {
    const hidden = new Set(((model && model.hiddenSubs) || []).map(_memKey));
    const vis = (cat, id) => !hidden.has(cat + '::' + id);
    return Math.max(
      FOUNDATION_FNS.filter(fn => vis('foundation', fn.id)).length || 1,
      ((model && model.strategySubs) || []).length || 1,
      ((model && model.payoffSubs) || []).length || 1,
      MANABASE_SUBS.filter(sub => vis('manabase', sub.id)).length || 1,
    );
  }

  function architectureColWidth(containerWidth, subCount) {
    const w = Math.max(0, Number(containerWidth) || 0);
    const n = Math.max(1, Math.min(24, subCount | 0 || 1));
    const snap = (x) => Math.round(x / 10) * 10;
    const clamp = (x) => Math.max(ARCH_STACK_CARD_MIN, Math.min(ARCH_STACK_CARD_MAX, snap(x)));
    const minCol = ARCH_STACK_CARD_MIN + ARCH_STACK_COL_GAP;
    const perRow = Math.max(1, Math.min(n, Math.floor(w / minCol) || 1));
    return { colWidth: clamp((w / perRow) - ARCH_STACK_COL_GAP), perRow };
  }

  function architectureStackFit(containerWidth, subCount) {
    const w = Math.max(0, Number(containerWidth) || 0);
    const n = Math.max(1, Math.min(24, subCount | 0 || 1));
    const snap = (x) => Math.round(x / 10) * 10;
    const clamp = (x) => Math.max(ARCH_STACK_CARD_MIN, Math.min(ARCH_STACK_CARD_MAX, snap(x)));
    const minCol = ARCH_STACK_CARD_MIN + ARCH_STACK_COL_GAP;
    const perRow1 = Math.max(1, Math.min(n, Math.floor(w / minCol) || 1));
    const perRow2 = Math.max(0, Math.min(n, Math.floor(w / (2 * minCol))));
    let stacks = 1;
    let perRow = perRow1;
    if (n * 2 * minCol <= w) {
      stacks = 2;
      perRow = n;
    } else if (perRow2 >= perRow1 && perRow2 > 0) {
      stacks = 2;
      perRow = perRow2;
    }
    const cardSize = clamp((w / Math.max(1, perRow * stacks)) - ARCH_STACK_COL_GAP);
    return { stacks, cardSize, perRow };
  }

  function architectureStacksAtSize(containerWidth, subCount, cardSize) {
    const w = Math.max(0, Number(containerWidth) || 0);
    const n = Math.max(1, Math.min(24, subCount | 0 || 1));
    const s = Math.max(
      ARCH_STACK_CARD_MIN,
      Math.min(ARCH_STACK_CARD_MAX, Number(cardSize) || ARCH_STACK_CARD_MIN),
    );
    const col1 = s + ARCH_STACK_COL_GAP;
    const col2 = 2 * col1;
    if (n * col2 <= w) return 2;
    const perRow1 = Math.max(1, Math.min(n, Math.floor(w / col1) || 1));
    const perRow2 = Math.floor(w / col2);
    if (perRow2 >= perRow1 && perRow2 > 0) return 2;
    return 1;
  }

  // Preserve sort order: left pile is the first half, right pile the rest.
  function architectureSplitRows(rows, stackCount) {
    const list = Array.isArray(rows) ? rows : [];
    const n = Math.max(1, Math.min(2, stackCount | 0));
    if (n === 1 || list.length <= 1) return [list];
    const size = Math.ceil(list.length / n);
    const cols = [];
    for (let i = 0; i < n; i++) {
      const slice = list.slice(i * size, (i + 1) * size);
      if (slice.length) cols.push(slice);
    }
    return cols;
  }

  function _packGroupsIntoStacks(groups, stackCount) {
    const list = Array.isArray(groups) ? groups : [];
    const n = Math.max(1, Math.min(2, stackCount | 0));
    if (n === 1 || list.length <= 1) return [list];
    const buckets = Array.from({ length: n }, () => ({ items: [], n: 0 }));
    const indexed = list.map((g, i) => ({ g, i, n: (g.rows || []).length }));
    indexed.sort((a, b) => b.n - a.n || a.i - b.i);
    for (const item of indexed) {
      const min = buckets.reduce((m, b) => (b.n < m.n ? b : m));
      min.items.push(item);
      min.n += item.n;
    }
    return buckets
      .map(b => b.items.sort((a, c) => a.i - c.i).map(x => x.g))
      .filter(col => col.length);
  }

  function _archPileHtml(rows, o) {
    const inner = (rows || []).map(r => _cardRowHtml(r, o)).join('');
    return `<div class="deck-stack-cards vertical">${inner || '<div class="arch-empty">None yet</div>'}</div>`;
  }

  function _archStacksWrapHtml(colHtmls) {
    const cols = (colHtmls || []).filter(Boolean);
    const n = cols.length || 1;
    return `<div class="arch-sub-stacks" data-arch-stacks="${n}">${
      cols.map(html => `<div class="arch-sub-stack-col">${html}</div>`).join('')
    }</div>`;
  }

  // Card order and Group By buckets come from the caller so the deck toolbar
  // applies here too. Non-Architecture Group By nests as collapsible drills
  // under the subsection (same header chrome as that subsection). Architecture
  // Group By skips the extra split — panels/subsections already are it.
  // Stacked + card-image mode wraps each pile in Visual-view overlapping stacks.
  function _cardsHtml(rows, opts) {
    const o = opts || {};
    const stackCols = o.visualStackCols > 0 ? Math.max(1, Math.min(2, o.visualStackCols | 0)) : 0;
    if (!stackCols) return (rows || []).map(r => _cardRowHtml(r, o)).join('');
    return _archStacksWrapHtml(
      architectureSplitRows(rows, stackCols).map(col => _archPileHtml(col, o)),
    );
  }

  function _groupDrillHtml(title, count, innerHtml, bodyClass) {
    const bodyCls = bodyClass || 'arch-sub-body';
    return `<details class="arch-sub arch-sub--drill" open>
      <summary class="arch-sub-head"><span class="arch-sub-title">${_esc(title)}</span><span class="arch-sub-head-end"><span class="arch-sub-count">${count}</span><span class="arch-sub-menu-slot" aria-hidden="true"></span></span></summary>
      <div class="${bodyCls}">${innerHtml || '<div class="arch-empty">None yet</div>'}</div>
    </details>`;
  }

  function _cardsBodyHtml(rows, opts) {
    const o = opts || {};
    const ordered = (typeof o.sortRows === 'function' && o.sortRows(rows)) || rows;
    const groups = typeof o.groupRows === 'function' ? o.groupRows(ordered) : null;
    const innerBody = o.cardMode === 'visual' ? 'arch-sub-body arch-sub-body--visual' : 'arch-sub-body';
    if (!groups || !groups.length) return { html: _cardsHtml(ordered, o), grouped: false };
    return {
      grouped: true,
      html: groups.map(g => {
        const qty = g.rows.reduce((s, r) => s + r.qty, 0);
        return _groupDrillHtml(g.label, qty, _cardsHtml(g.rows, o), innerBody);
      }).join(''),
    };
  }

  function _subSectionHtml(title, count, source, body, chrome, bodyClass, menuOpts) {
    const src = source === 'inferred'
      ? '' : '';  // Plan / Inferred pills retired with the Plan wizard
    const grouped = !!(body && typeof body === 'object' && body.grouped);
    const cardsHtml = body && typeof body === 'object' && 'html' in body ? body.html : body;
    const bodyCls = grouped ? 'arch-sub-body arch-sub-body--grouped' : (bodyClass || 'arch-sub-body');
    const c = chrome || { classes: '', dataAttrs: '' };
    const menu = (menuOpts && menuOpts.canEdit && menuOpts.category && menuOpts.subId)
      ? `<button type="button" class="btn btn-ghost btn-sm arch-sub-menu" data-arch-sub-menu data-arch-cat="${_esc(menuOpts.category)}" data-arch-sub="${_esc(menuOpts.subId)}" title="Subsection options" aria-label="Subsection options">⋮</button>`
      : '';
    const promote = (menuOpts && menuOpts.canEdit && menuOpts.promoteStrategyId)
      ? `<button type="button" class="btn btn-ghost btn-sm arch-sub-promote" data-arch-promote-strategy="${_esc(menuOpts.promoteStrategyId)}" title="Promote to a strategy" aria-label="Promote ${_esc(title)} to a strategy">Promote</button>`
      : '';
    const groupedCls = grouped ? 'arch-sub--grouped ' : '';
    const strongCls = (menuOpts && menuOpts.strong) ? 'arch-sub--strong ' : '';
    const openAttr = (menuOpts && menuOpts.startOpen === false) ? '' : ' open';
    return `<details class="arch-sub ${strongCls}${groupedCls}${c.classes}" ${c.dataAttrs}${openAttr}>
      <summary class="arch-sub-head"><span class="arch-sub-title">${_esc(title)}</span> ${src}<span class="arch-sub-head-end"><span class="arch-sub-count">${count}</span>${promote}${menu}</span></summary>
      <div class="${bodyCls}">${cardsHtml || '<div class="arch-empty">None yet</div>'}</div>
    </details>`;
  }

  /**
   * groupRows for the Interaction/Removal foundation subsection — drill-down
   * groups by interaction type (Counterspell, Creature/Artifact/Enchantment/…
   * Removal), sourced from row.interactionGroups. A card answering more than
   * one type (Withering Torment: creature or enchantment) appears in each
   * group it matches. Cards matching none of these (bounce, burn, or CardIR
   * coverage gaps) land in "Other Interaction".
   *
   * Renders grouped as soon as ANY card matches a recognized category — even
   * a deck whose interaction is entirely Counterspells (nothing left over for
   * "Other Interaction") still gets a labeled Counterspell group, since a
   * label naming what's there is the point. Only returns null — "render
   * flat, no groups" — when nothing at all was recognized (no CardIR
   * coverage for any interaction card in the deck), so a deck with no
   * groupable interaction renders exactly as it did before this existed.
   */
  function _interactionGroupRows(rows) {
    const buckets = new Map();
    const other = [];
    for (const r of rows || []) {
      const cats = r.interactionGroups || [];
      if (!cats.length) { other.push(r); continue; }
      for (const cat of cats) {
        if (!buckets.has(cat)) buckets.set(cat, []);
        buckets.get(cat).push(r);
      }
    }
    if (!buckets.size) return null;
    const groups = REMOVAL_GROUP_ORDER
      .filter(g => buckets.has(g.id))
      .map(g => ({ label: g.label, rows: buckets.get(g.id) }));
    if (other.length) groups.push({ label: 'Other Interaction', rows: other });
    return groups;
  }

  function architectureViewHtml(model, opts) {
    const o = opts || {};
    const panelLayout = o.panelLayout === 'vertical' ? 'vertical' : 'horizontal';
    const cardMode = o.cardMode === 'visual' ? 'visual' : 'text';
    const canEdit = !!o.canEdit;
    const viewCls = `arch-view--layout-${panelLayout} arch-view--cards-${cardMode}${canEdit ? ' arch-view--can-edit' : ''}`;
    const gridCls = panelLayout === 'vertical' ? 'arch-grid arch-grid--vertical' : 'arch-grid arch-grid--horizontal';
    const subBodyCls = cardMode === 'visual' ? 'arch-sub-body arch-sub-body--visual' : 'arch-sub-body';
    const stackedVisual = panelLayout === 'vertical' && cardMode === 'visual';
    const stackW = Number(o.stackContainerWidth) || 0;
    const maxSubs = architectureMaxSubCount(model);
    const sharedSize = o.archCardSize
      || (stackedVisual && stackW ? architectureStackFit(stackW, maxSubs).cardSize : 0);
    const stackOpts = (nSubs) => {
      if (!stackedVisual) return o;
      const cols = stackW
        ? architectureStacksAtSize(stackW, nSubs, sharedSize)
        : Math.max(1, o.visualStackCols || 1);
      return Object.assign({}, o, { visualStackCols: cols });
    };
    const counts = model.counts || {};
    const byFn = (fnId) => model.rows.filter(r => r.foundationFns.includes(fnId));
    const byStrat = (id) => model.rows.filter(r => r.strategySubs.includes(id));
    const byPay = (id) => model.rows.filter(r => r.payoffSubs.includes(id));
    const byMana = (id) => model.rows.filter(r => r.manabaseSubs.includes(id));
    const hidden = new Set(((model && model.hiddenSubs) || []).map(_memKey));
    const isHid = (cat, id) => hidden.has(cat + '::' + id);
    const menuFor = (cat, subId) => ({ canEdit, category: cat, subId });
    const placeOpts = (cat, subId, nSubs) => Object.assign({}, stackOpts(nSubs), { placeCat: cat, placeSub: subId });

    const foundationList = FOUNDATION_FNS.filter(fn => !isHid('foundation', fn.id));
    const foundationSubs = foundationList.map(fn => {
      const rows = byFn(fn.id);
      const label = fn.id === 'win_condition'
        ? `${fn.label} (${model.winConditionLabel || 'Not set'})`
        : fn.label;
      const fnOpts = placeOpts('foundation', fn.id, foundationList.length || 1);
      if (fn.id === 'interaction') fnOpts.groupRows = _interactionGroupRows;
      return _subSectionHtml(label, counts.foundationFns[fn.id] || 0, 'declared', _cardsBodyHtml(rows, fnOpts), _subsectionChrome('foundation', fn.id), subBodyCls, menuFor('foundation', fn.id));
    }).join('');

    const strategyList = model.strategySubs || [];
    const renderStratSub = (sub, nSubs, strong, promoteStrategyId, startOpen) => {
      const rows = byStrat(sub.id);
      const menu = Object.assign(menuFor('strategy', sub.id), { strong: !!strong, promoteStrategyId: promoteStrategyId || null, startOpen: startOpen !== false });
      return _subSectionHtml(sub.label, (counts.strategy && counts.strategy[sub.id]) || 0, sub.source, _cardsBodyHtml(rows, placeOpts('strategy', sub.id, nSubs)), _subsectionChrome('strategy', sub.id), subBodyCls, menu);
    };
    const bands = architectureStrategyBands(model);
    let strategyHtml;
    if (bands && bands.length) {
      strategyHtml = bands.map(band => {
        const nSubs = Math.max(1, band.subs.length);
        const qty = band.subs.reduce((s, sub) => s + ((counts.strategy && counts.strategy[sub.id]) || 0), 0);
        const chrome = _subsectionChrome('strategy', band.strategyId || ('other:' + band.role));
        // Single engine matching the band identity → cards under the strong band head.
        const only = band.subs.length === 1 ? band.subs[0] : null;
        const flatten = !band.collapsed && only && (
          _bandIdForSub(only) === (band.bandId || band.strategyId)
          || String(only.label || '').toLowerCase() === String(band.label || '').toLowerCase()
        );
        let kids;
        if (!band.subs.length) {
          kids = '<div class="arch-empty">None yet</div>';
        } else if (flatten) {
          kids = _cardsBodyHtml(byStrat(only.id), placeOpts('strategy', only.id, 1)).html
            || '<div class="arch-empty">None yet</div>';
        } else {
          const promoteBand = band.role === 'other';
          // Detected themes list collapsed (title only); the band head selects cards into view.
          kids = band.subs.map(sub => renderStratSub(sub, nSubs, false, promoteBand ? (_bandIdForSub(sub) || sub.strategyId) : null, !promoteBand)).join('');
        }
        const headMenu = (flatten && canEdit && only)
          ? `<button type="button" class="btn btn-ghost btn-sm arch-sub-menu" data-arch-sub-menu data-arch-cat="strategy" data-arch-sub="${_esc(only.id)}" title="Subsection options" aria-label="Subsection options">⋮</button>`
          : `<span class="arch-sub-menu-slot" aria-hidden="true"></span>`;
        const head = `<span class="arch-sub-title">${_esc(band.label)}</span><span class="arch-sub-head-end"><span class="arch-sub-count">${qty}</span>${headMenu}</span>`;
        const attrs = `class="arch-strategy-band arch-strategy-band--${band.role}${flatten ? ' arch-strategy-band--flat' : ''} ${chrome.classes}" data-arch-strategy-band="${band.role}" ${band.strategyId ? `data-arch-strategy-id="${_esc(band.strategyId)}"` : ''}${flatten && only ? ` data-arch-sub="${_esc(only.id)}"` : ''}`;
        // Every band title is selectable to collapse its cards. Detected
        // (off-identity) themes start collapsed so primary strategies stay
        // the focus; primary/secondary/promoted bands start open.
        const openAttr = band.collapsed ? '' : ' open';
        return `<details ${attrs}${openAttr}>
          <summary class="arch-sub-head arch-strategy-band-head">${head}</summary>
          <div class="arch-strategy-band-body">${kids}</div>
        </details>`;
      }).join('');
    } else {
      // Flat list: top-level strategy piles get strong chrome (same as Foundation).
      strategyHtml = strategyList.map(sub => renderStratSub(sub, strategyList.length || 1, true)).join('')
        || '<div class="arch-empty">No strategy engines stood out yet.</div>';
    }

    const payoffList = model.payoffSubs || [];
    const payoffHtml = payoffList.map(sub => {
      const rows = byPay(sub.id);
      return _subSectionHtml(sub.label, (counts.payoffs && counts.payoffs[sub.id]) || 0, sub.source, _cardsBodyHtml(rows, placeOpts('payoffs', sub.id, payoffList.length || 1)), _subsectionChrome('payoffs', sub.id), subBodyCls, menuFor('payoffs', sub.id));
    }).join('') || '<div class="arch-empty">No payoffs classified yet.</div>';

    const manaList = MANABASE_SUBS.filter(sub => !isHid('manabase', sub.id));
    const landHtml = manaList.map(sub => {
      const rows = byMana(sub.id);
      return _subSectionHtml(sub.label, (counts.manabase && counts.manabase[sub.id]) || 0, 'declared', _cardsBodyHtml(rows, placeOpts('manabase', sub.id, manaList.length || 1)), _subsectionChrome('manabase', sub.id), subBodyCls, menuFor('manabase', sub.id));
    }).join('');

    const compactChips = (cat) => {
      if (cat === 'foundation') {
        return foundationList.map(fn => _chipHtml('foundation', fn.id, fn.label, counts.foundationFns[fn.id] || 0)).join('');
      }
      if (cat === 'strategy') {
        return strategyList.map(s => _chipHtml('strategy', s.id, s.label, (counts.strategy && counts.strategy[s.id]) || 0)).join('');
      }
      if (cat === 'payoffs') {
        return payoffList.map(s => _chipHtml('payoffs', s.id, s.label, (counts.payoffs && counts.payoffs[s.id]) || 0)).join('');
      }
      return manaList.map(sub => _chipHtml('manabase', sub.id, sub.label, (counts.manabase && counts.manabase[sub.id]) || 0)).join('');
    };
    const compactTops = (cat) => {
      const pool = model.rows.filter(r => r.categories.includes(cat));
      return representativeCards(pool, model.plan, 5).map(r => _cardRowHtml(r, o)).join('');
    };
    const panel = (cat, body) => {
      const meta = CATEGORY_META[cat];
      const n = counts[cat + 'Unique'] || 0;
      const compact = o.compact
        ? `<div class="arch-compact-chips">${compactChips(cat)}</div><div class="arch-compact-tops">${compactTops(cat)}</div>
        <details class="arch-panel-details"><summary class="arch-expand">Show all cards</summary><div class="arch-panel-body">${body}</div></details>`
        : `<div class="arch-panel-body">${body}</div>`;
      const panelMenu = canEdit
        ? `<button type="button" class="btn btn-ghost btn-sm arch-panel-menu" data-arch-panel-menu data-arch-cat="${_esc(cat)}" title="Section options" aria-label="Section options">⋮</button>`
        : '';
      return `<section class="arch-panel arch-panel--${cat}" data-arch-cat="${cat}">
        <header class="arch-panel-head">
          <h3 class="arch-panel-title">${meta.label}</h3>
          <span class="arch-panel-head-end"><span class="arch-panel-count">${n} cards</span>${panelMenu}</span>
        </header>
        ${compact}
      </section>`;
    };

    const unBody = _cardsBodyHtml(model.unassigned || [], o);
    const un = unBody.html;
    const unBodyCls = unBody.grouped
      ? 'arch-unassigned-body arch-sub-body--grouped'
      : `arch-unassigned-body ${cardMode === 'visual' ? 'arch-sub-body--visual' : ''}`;

    return `<div class="arch-view ${viewCls}" id="deckArchitectureView">
      <div class="${gridCls}">
        ${panel('foundation', foundationSubs)}
        ${panel('strategy', strategyHtml)}
        ${panel('payoffs', payoffHtml)}
        ${panel('manabase', landHtml)}
      </div>
      <section class="arch-unassigned">
        <h3 class="arch-unassigned-title">Unassigned <span class="arch-panel-count">${(model.unassigned || []).reduce((s, r) => s + r.qty, 0)} cards</span></h3>
        <div class="${unBodyCls}">${un || '<div class="arch-empty">Every card found a place.</div>'}</div>
      </section>
      <footer class="arch-legend">
        <span><strong>Foundation</strong> ${CATEGORY_META.foundation.legend}</span>
        <span><strong>Strategy</strong> ${CATEGORY_META.strategy.legend}</span>
        <span><strong>Payoffs</strong> ${CATEGORY_META.payoffs.legend}</span>
        <span><strong>Mana Sources</strong> ${CATEGORY_META.manabase.legend}</span>
      </footer>
    </div>`;
  }

  /**
   * Ordered Group By buckets for the deck toolbar's "Architecture" option:
   * one band per category · subsection (panel reading order), then Unassigned.
   * Multi-role cards appear in every membership, same idea as Group By tag.
   * Empty subsections are omitted. Each entry: `{ id, label, keys }`.
   */
  function architectureGroupBuckets(model) {
    if (!model) return [];
    const rows = model.rows || [];
    const hidden = new Set(((model && model.hiddenSubs) || []).map(_memKey));
    const isHid = (cat, id) => hidden.has(cat + '::' + id);
    const labelOf = (cat, subId) => {
      const catLabel = (CATEGORY_META[cat] && CATEGORY_META[cat].label) || cat;
      let subLabel = subId;
      if (cat === 'foundation') {
        const fn = FOUNDATION_FNS.find(f => f.id === subId);
        if (fn) {
          subLabel = fn.id === 'win_condition' && model.winConditionLabel
            ? `${fn.label} (${model.winConditionLabel})`
            : fn.label;
        }
      } else if (cat === 'manabase') {
        const sub = MANABASE_SUBS.find(s => s.id === subId);
        if (sub) subLabel = sub.label;
      } else {
        const list = cat === 'strategy' ? (model.strategySubs || []) : (model.payoffSubs || []);
        const sub = list.find(s => s.id === subId);
        if (sub) subLabel = sub.label;
      }
      return `${catLabel} · ${subLabel}`;
    };
    const out = [];
    const push = (id, label, matched) => {
      if (!matched.length) return;
      out.push({ id, label, keys: matched.map(r => r.key) });
    };
    for (const fn of FOUNDATION_FNS) {
      if (isHid('foundation', fn.id)) continue;
      push(`foundation::${fn.id}`, labelOf('foundation', fn.id), rows.filter(r => r.foundationFns.includes(fn.id)));
    }
    for (const sub of model.strategySubs || []) {
      push(`strategy::${sub.id}`, labelOf('strategy', sub.id), rows.filter(r => r.strategySubs.includes(sub.id)));
    }
    for (const sub of model.payoffSubs || []) {
      push(`payoffs::${sub.id}`, labelOf('payoffs', sub.id), rows.filter(r => r.payoffSubs.includes(sub.id)));
    }
    for (const sub of MANABASE_SUBS) {
      if (isHid('manabase', sub.id)) continue;
      push(`manabase::${sub.id}`, labelOf('manabase', sub.id), rows.filter(r => r.manabaseSubs.includes(sub.id)));
    }
    push('unassigned', 'Unassigned', rows.filter(r => !(r.categories && r.categories.length)));
    return out;
  }

  function representativeCards(rows, plan, limit) {
    const n = Math.max(1, limit || 5);
    const keyNames = new Set(((plan && plan.keyCards) || []).map(k => String(k && (k.name || k) || '').trim().toLowerCase()));
    const scored = rows.map(r => {
      let s = 0;
      if (r.card && r.card.isCommander) s += 100;
      if (keyNames.has(String(r.name || '').trim().toLowerCase())) s += 50;
      s += (r.categories || []).length;
      return { r, s };
    });
    scored.sort((a, b) => b.s - a.s || String(a.r.name).localeCompare(String(b.r.name)));
    return scored.slice(0, n).map(x => x.r);
  }

  return {
    ARCH_CATEGORIES,
    FOUNDATION_FNS,
    MANABASE_SUBS,
    PAYOFF_FIXED_SUBS,
    CATEGORY_META,
    architectureCardKey,
    mappedRoleForPlacement,
    emptyArchitectureOverrides,
    normalizeArchitectureOverrides,
    hideArchitectureSubsection,
    showArchitectureSubsection,
    pinArchitectureSubsection,
    unpinArchitectureSubsection,
    isArchitectureSubsectionHidden,
    isArchitectureSubsectionPinned,
    architectureSubsectionCatalog,
    architectureInferredSubsectionOptions,
    applyHiddenArchitectureSubsections,
    classifyCardArchitecture,
    classifyDeckArchitecture,
    applyArchitectureOverrides,
    setArchitecturePrimary,
    moveArchitectureMembership,
    addArchitectureExtra,
    removeArchitectureMembership,
    resetArchitectureCard,
    unassignArchitectureCard,
    architectureViewHtml,
    architectureStackFit,
    architectureColWidth,
    architectureStacksAtSize,
    architectureMaxSubCount,
    architectureSplitRows,
    architectureGroupBuckets,
    architectureStrategyBands,
    resolveArchitectureIdentity,
    representativeCards,
    ARCH_SUB_TINT_STEPS,
    // Exported for the engine2 goal-key contract guard in test-deck-architecture.js.
    GOAL_ROLE_TAGS,
    GOAL_KEY_STRATEGY,
    _subsectionSlug,
    _subsectionTintIndex,
    _subsectionChrome,
  };
});
