/**
 * By Architecture deck visualization — deterministic classification layer.
 *
 * Visualization Foundation functions (Card Advantage, Ramp, Interaction /
 * Removal, Board Wipes, Win Condition) are NOT the five-capability evaluator
 * in js/foundation/. Manabase is lands only; Ramp lives in Foundation.
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
  if (typeof require === 'function') {
    try { if (!planApi || !planApi.getDeckPlan) planApi = require('./deck-plan.js'); } catch (_) { /* bundled */ }
    try { if (!themesApi || !themesApi.analyzeDeckThemes) themesApi = require('./deck-themes.js'); } catch (_) { /* bundled */ }
  }

  const ARCH_CATEGORIES = Object.freeze(['foundation', 'strategy', 'payoffs', 'manabase']);

  const FOUNDATION_FNS = Object.freeze([
    Object.freeze({ id: 'card_advantage', label: 'Card Advantage', blurb: 'Ways the deck generates extra cards or resources.' }),
    Object.freeze({ id: 'ramp', label: 'Ramp', blurb: 'Ways the deck accelerates mana.' }),
    Object.freeze({ id: 'interaction', label: 'Interaction / Removal', blurb: 'Answers to opposing threats.' }),
    Object.freeze({ id: 'board_wipes', label: 'Board Wipes', blurb: 'Multiplayer board resets, kept distinct from spot interaction.' }),
    Object.freeze({ id: 'win_condition', label: 'Win Condition', blurb: 'Whether the deck has a way to close games. Specific finishers live in Payoffs.' }),
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
      label: 'Manabase',
      blurb: 'Lands. The mana that supports everything else. Ramp is a Foundation function, not Manabase.',
      legend: 'Power everything',
    }),
  });

  const PAYOFF_SUBTAG_RE = /\.(payoffs|finish|finishers)$|^(ss\.finish|tribal\.finishers)$/;
  const STAPLE_ONLY = Object.freeze(['Ramp', 'Card Draw', 'Removal', 'Board Wipe', 'Land', 'Commander', 'Wheel']);
  const INTERACTION_TAGS = Object.freeze(['Removal', 'Counterspell', 'Bounce', 'Bite', 'Burn']);
  const DRAW_TAGS = Object.freeze(['Card Draw', 'Wheel']);
  const LIGHT_MIN = 5;

  function _plan() {
    return planApi || root || {};
  }
  function _themes() {
    return themesApi || root || {};
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

  function _cmc(card) {
    const n = Number(card && (card.cmc != null ? card.cmc : card.manaValue));
    return Number.isFinite(n) ? n : 0;
  }

  function emptyArchitectureOverrides() {
    return { byKey: {} };
  }

  function normalizeArchitectureOverrides(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const byKey = src.byKey && typeof src.byKey === 'object' ? src.byKey : src;
    const out = { byKey: {} };
    for (const [k, v] of Object.entries(byKey || {})) {
      if (!k || !v || typeof v !== 'object') continue;
      out.byKey[k] = {
        primary: v.primary && v.primary.category ? {
          category: String(v.primary.category),
          subsection: String(v.primary.subsection || ''),
        } : null,
        extrasRemoved: Array.isArray(v.extrasRemoved) ? v.extrasRemoved.map(_normMem).filter(Boolean) : [],
        extrasAdded: Array.isArray(v.extrasAdded) ? v.extrasAdded.map(_normMem).filter(Boolean) : [],
        unassigned: !!v.unassigned,
        writtenRole: v.writtenRole || null,
        prevPrimaryTag: v.prevPrimaryTag || null,
      };
    }
    return out;
  }

  function _normMem(m) {
    if (!m || !m.category) return null;
    return { category: String(m.category), subsection: String(m.subsection || '') };
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
    if (category === 'manabase') return 'Land';
    if (category === 'foundation') {
      if (subsection === 'card_advantage') return 'Card Draw';
      if (subsection === 'ramp') return 'Ramp';
      if (subsection === 'board_wipes') return 'Board Wipe';
      if (subsection === 'interaction') {
        const tags = new Set(_roles(card, deck));
        for (const t of INTERACTION_TAGS) {
          if (t !== 'Removal' && tags.has(t)) return t;
        }
        return 'Removal';
      }
      if (subsection === 'win_condition') return null;
    }
    return null;
  }

  function _cardHasWinconSignal(card, plan, deck) {
    const ir = _ir(card);
    if (ir && ir.wincon) return true;
    if (ir && Array.isArray(ir.roles) && ir.roles.includes('wincon')) return true;
    const text = _oracle(card);
    if (/\byou win the game\b/.test(text) || /\ban opponent loses the game\b/.test(text)) return true;
    const winId = plan && plan.winConditionId;
    if (card && card.isCommander && (winId === 'wincon.commander_damage' || winId === 'wincon.combat')) return true;
    const api = _plan();
    if (winId && typeof api.winconMatch === 'function' && api.winconMatch(card, winId, deck)) return true;
    const keys = (plan && plan.keyCards) || [];
    const name = String(card && card.name || '').trim().toLowerCase();
    if (name && keys.some(k => String(k && (k.name || k) || '').trim().toLowerCase() === name)) {
      if (typeof api.winconMatch === 'function' && api.winconMatch(card, winId, deck)) return true;
      if (ir && ir.wincon) return true;
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
    if (tagSet.has('Ramp') || (_ir(card) && Array.isArray(_ir(card).roles) && (
      _ir(card).roles.includes('ramp') || _ir(card).roles.includes('mana_rock') || _ir(card).roles.includes('mana_dork')
    ))) {
      fns.push('ramp');
      reasons.push('tag:Ramp');
    }
    if (INTERACTION_TAGS.some(t => tagSet.has(t))) {
      fns.push('interaction');
      reasons.push('tag:interaction');
    }
    if (tagSet.has('Board Wipe')) {
      fns.push('board_wipes');
      reasons.push('tag:Board Wipe');
    }
    if (_cardHasWinconSignal(card, plan, deck)) {
      fns.push('win_condition');
      reasons.push('wincon');
    }
    return { fns, reasons };
  }

  function _buildStrategySubs(plan, themeAnalysis, declaredIds) {
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
      subs.push({
        id,
        label: t.label || t.id,
        source: 'inferred',
        projectTags: [],
        themeId: t.id,
        subtagId: null,
      });
    }
    return subs;
  }

  function _buildPayoffSubs(plan, themeAnalysis, declaredIds) {
    const winId = plan && plan.winConditionId;
    const api = _plan();
    const parentTarget = (api.PLAN_PARENT_DEFAULT_TARGET) || 30;
    const rows = typeof api.activePlanSubTags === 'function'
      ? api.activePlanSubTags(plan, parentTarget)
      : [];
    const themeIds = new Set(((themeAnalysis && themeAnalysis.themes) || []).map(t => t.id));
    const hasTokens = declaredIds.has('strategy.tokens') || declaredIds.has('strategy.tribal')
      || [...themeIds].some(id => id === 'strategy.tokens' || String(id).startsWith('tribal:'));
    const out = [];
    out.push({ id: 'wincon_payoffs', label: 'Win Condition Payoffs', source: winId ? 'declared' : 'inferred' });
    if (winId === 'wincon.combo') out.push({ id: 'combo', label: 'Combo Pieces', source: 'declared' });
    if (hasTokens) out.push({ id: 'token_swarm', label: 'Token / Swarm Payoffs', source: declaredIds.has('strategy.tokens') || declaredIds.has('strategy.tribal') ? 'declared' : 'inferred' });
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

  function _cardPayoffSubs(card, deck, plan, payoffSubs, tags, strategyHit) {
    const hit = [];
    const reasons = [];
    const tagSet = new Set(tags);
    const th = _themes();
    const api = _plan();
    const winId = plan && plan.winConditionId;
    const parentTarget = (api.PLAN_PARENT_DEFAULT_TARGET) || 30;
    const rows = typeof api.activePlanSubTags === 'function' ? api.activePlanSubTags(plan, parentTarget) : [];

    for (const sub of payoffSubs) {
      if (sub.id === 'wincon_payoffs' && _cardHasWinconSignal(card, plan, deck)) {
        hit.push(sub.id);
        reasons.push('payoff:wincon');
      } else if (sub.id === 'combo' && (_cardHasWinconSignal(card, plan, deck) || tagSet.has('Tutor'))) {
        if (_ir(card) && _ir(card).wincon && _ir(card).wincon.kind === 'combo_piece') {
          hit.push(sub.id);
          reasons.push('ir:combo');
        } else if (/\binfinite\b/.test(_oracle(card))) {
          hit.push(sub.id);
          reasons.push('oracle:combo');
        }
      } else if (sub.id === 'token_swarm') {
        const payoffRows = rows.filter(r => _isPayoffSubtag(r.id, winId) && /token|tribal|type/i.test(r.id + r.label));
        const tagHit = payoffRows.some(r => (r.projectTags || []).some(t => tagSet.has(t)));
        const themeHit = typeof th.cardSupportsTheme === 'function'
          && (th.cardSupportsTheme(card, 'strategy.tokens') || tagSet.has('Anthem') || tagSet.has('Drain'));
        if ((tagHit || themeHit) && (tagSet.has('Anthem') || tagSet.has('Drain') || tagSet.has('Board Wipe') || _cardHasWinconSignal(card, plan, deck) || tagSet.has('Token Maker') && strategyHit.length)) {
          if (tagSet.has('Anthem') || tagSet.has('Drain') || tagSet.has('Board Wipe') || _cardHasWinconSignal(card, plan, deck)) {
            hit.push(sub.id);
            reasons.push('payoff:tokens');
          }
        }
      } else if (sub.id === 'value_finishers') {
        const payoffRows = rows.filter(r => _isPayoffSubtag(r.id, winId));
        if (payoffRows.some(r => (r.projectTags || []).some(t => tagSet.has(t))) && !_isLand(card)) {
          hit.push(sub.id);
          reasons.push('planSubtag:payoff');
        }
      } else if (sub.id === 'threats' && _isThreatBomb(card, plan, deck)) {
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

    const f = _foundationFnsForCard(card, plan, deck, tags);
    f.reasons.forEach(r => reasons.push(r));
    if (f.fns.length) categories.add('foundation');

    const s = _cardStrategySubs(card, deck, plan, strategySubs, tags);
    s.reasons.forEach(r => reasons.push(r));
    if (s.hit.length) categories.add('strategy');

    const p = _cardPayoffSubs(card, deck, plan, payoffSubs, tags, s.hit);
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

    return {
      key: architectureCardKey(card),
      name: card && card.name || '',
      qty: _qty(card),
      card,
      categories: [...categories],
      foundationFns: f.fns.slice(),
      strategySubs: s.hit.slice(),
      payoffSubs: p.hit.slice(),
      manabaseSubs,
      reasons,
      ambiguous,
      primary: null,
      source: 'inferred',
    };
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
    const manabase = {
      basics: unique(r => r.manabaseSubs.includes('basics')),
      nonbasics: unique(r => r.manabaseSubs.includes('nonbasics')),
    };
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

    let strategySubs = _buildStrategySubs(resolvedPlan, themeAnalysis, declaredIds);
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
        }];
      }
    }

    const payoffSubsAll = _buildPayoffSubs(resolvedPlan, themeAnalysis, declaredIds);
    const ctx = { deck, plan: resolvedPlan, strategySubs, payoffSubs: payoffSubsAll };
    let rows = cards.map(c => classifyCardArchitecture(c, ctx));
    rows = applyArchitectureOverrides(rows, (opts && opts.overrides) || (deck && deck.architectureOverrides));

    const usedPayoff = new Set();
    rows.forEach(r => r.payoffSubs.forEach(id => usedPayoff.add(id)));
    const payoffSubs = payoffSubsAll.filter(s => usedPayoff.has(s.id));

    const counts = _counts(rows, strategySubs, payoffSubs);
    const winLabel = (typeof api.winconLabel === 'function' && resolvedPlan.winConditionId)
      ? api.winconLabel(resolvedPlan.winConditionId)
      : (resolvedPlan.winConditionId ? resolvedPlan.winConditionId : 'Not set');

    return {
      plan: resolvedPlan,
      winConditionLabel: winLabel,
      rows,
      strategySubs,
      payoffSubs,
      foundationFns: FOUNDATION_FNS,
      counts,
      unassigned: rows.filter(r => !r.categories.length),
      multiRole: rows.filter(r => r.categories.length >= 2),
      themeAnalysis,
    };
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _cardRowHtml(row, opts) {
    const c = row.card || {};
    const key = _esc(row.key);
    const name = _esc(row.name);
    const qty = row.qty;
    const primaryMark = row.primary ? ' is-arch-primary' : '';
    const src = row.source === 'override' ? ' <span class="arch-pill arch-pill--override">Set</span>' : '';
    let badge = '';
    if (opts && typeof opts.badgeHtml === 'function') badge = opts.badgeHtml(c) || '';
    let pips = '';
    if (opts && typeof opts.pipsHtml === 'function') pips = opts.pipsHtml(c) || '';
    const menu = (opts && opts.canEdit)
      ? `<button type="button" class="btn btn-ghost btn-sm arch-card-menu" data-arch-menu="${key}" title="Architecture placement">⋯</button>`
      : '';
    return `<div class="arch-card-row deck-card-row${primaryMark}" data-arch-key="${key}" data-card-name-key="${_esc(String(c.name || '').trim().toLowerCase())}" data-uid="${_esc(c.uid || c.scryfallId || '')}">
      <span class="deck-card-name">${name}</span>${src}${badge}${pips}
      <span class="deck-list-qty">${qty}</span>${menu}
    </div>`;
  }

  function _subSectionHtml(title, count, source, cardsHtml, extraClass) {
    const src = source === 'inferred'
      ? '<span class="arch-pill arch-pill--inferred" title="Detected from the list, not set in Plan">Inferred</span>'
      : (source === 'declared' ? '<span class="arch-pill arch-pill--declared" title="From your confirmed or declared Plan">Plan</span>' : '');
    return `<details class="arch-sub ${extraClass || ''}" open>
      <summary class="arch-sub-head"><span class="arch-sub-title">${_esc(title)}</span> ${src}<span class="arch-sub-count">${count}</span></summary>
      <div class="arch-sub-body">${cardsHtml || '<div class="arch-empty">None yet</div>'}</div>
    </details>`;
  }

  function architectureViewHtml(model, opts) {
    const o = opts || {};
    const counts = model.counts || {};
    const byFn = (fnId) => model.rows.filter(r => r.foundationFns.includes(fnId));
    const byStrat = (id) => model.rows.filter(r => r.strategySubs.includes(id));
    const byPay = (id) => model.rows.filter(r => r.payoffSubs.includes(id));
    const basics = model.rows.filter(r => r.manabaseSubs.includes('basics'));
    const nonbasics = model.rows.filter(r => r.manabaseSubs.includes('nonbasics'));

    const foundationSubs = FOUNDATION_FNS.map(fn => {
      const rows = byFn(fn.id);
      const label = fn.id === 'win_condition'
        ? `${fn.label} (${model.winConditionLabel || 'Not set'})`
        : fn.label;
      return _subSectionHtml(label, counts.foundationFns[fn.id] || 0, 'declared', rows.map(r => _cardRowHtml(r, o)).join(''));
    }).join('');

    const strategyHtml = (model.strategySubs || []).map(sub => {
      const rows = byStrat(sub.id);
      return _subSectionHtml(sub.label, (counts.strategy && counts.strategy[sub.id]) || 0, sub.source, rows.map(r => _cardRowHtml(r, o)).join(''));
    }).join('') || '<div class="arch-empty">No strategy engines stood out yet. Set a Plan to name them.</div>';

    const payoffHtml = (model.payoffSubs || []).map(sub => {
      const rows = byPay(sub.id);
      return _subSectionHtml(sub.label, (counts.payoffs && counts.payoffs[sub.id]) || 0, sub.source, rows.map(r => _cardRowHtml(r, o)).join(''));
    }).join('') || '<div class="arch-empty">No payoffs classified yet.</div>';

    const landHtml = _subSectionHtml('Basics', counts.manabase.basics || 0, 'declared', basics.map(r => _cardRowHtml(r, o)).join(''))
      + _subSectionHtml('Nonbasics', counts.manabase.nonbasics || 0, 'declared', nonbasics.map(r => _cardRowHtml(r, o)).join(''));

    const compactChips = (cat) => {
      if (cat === 'foundation') {
        return FOUNDATION_FNS.map(fn => `<span class="arch-chip">${_esc(fn.label)} ${counts.foundationFns[fn.id] || 0}</span>`).join('');
      }
      if (cat === 'strategy') {
        return (model.strategySubs || []).map(s => `<span class="arch-chip">${_esc(s.label)} ${(counts.strategy && counts.strategy[s.id]) || 0}</span>`).join('');
      }
      if (cat === 'payoffs') {
        return (model.payoffSubs || []).map(s => `<span class="arch-chip">${_esc(s.label)} ${(counts.payoffs && counts.payoffs[s.id]) || 0}</span>`).join('');
      }
      return `<span class="arch-chip">Basics ${counts.manabase.basics || 0}</span><span class="arch-chip">Nonbasics ${counts.manabase.nonbasics || 0}</span>`;
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
      return `<section class="arch-panel arch-panel--${cat}" data-arch-cat="${cat}">
        <header class="arch-panel-head">
          <h3 class="arch-panel-title">${meta.label}</h3>
          <span class="arch-panel-count">${n} cards</span>
        </header>
        <p class="arch-panel-blurb">${_esc(meta.blurb)}</p>
        ${compact}
      </section>`;
    };

    const multi = (model.multiRole || []).map(r => {
      const badges = r.categories.map(c => CATEGORY_META[c].label).join(' / ');
      return `<div class="arch-multi-item" data-arch-key="${_esc(r.key)}"><span class="arch-multi-name">${_esc(r.name)}</span><span class="arch-multi-badges">${_esc(badges)}</span></div>`;
    }).join('');

    const un = (model.unassigned || []).map(r => _cardRowHtml(r, o)).join('');

    return `<div class="arch-view" id="deckArchitectureView">
      <p class="arch-note">Cards can appear in more than one area. Panel counts are unique cards; subsection counts are memberships, not a second deck total. Visualization Foundation functions are not the Hybrid capability scores.</p>
      <div class="arch-grid">
        ${panel('foundation', foundationSubs)}
        ${panel('strategy', strategyHtml)}
        ${panel('payoffs', payoffHtml)}
        ${panel('manabase', landHtml)}
      </div>
      <section class="arch-multi">
        <h3 class="arch-multi-title">Cards that serve multiple roles</h3>
        <div class="arch-multi-list">${multi || '<div class="arch-empty">No multi-role cards in this list.</div>'}</div>
      </section>
      <section class="arch-unassigned">
        <h3 class="arch-multi-title">Unassigned <span class="arch-panel-count">${(model.unassigned || []).reduce((s, r) => s + r.qty, 0)} cards</span></h3>
        <p class="arch-panel-blurb">No Foundation, Strategy, Payoffs, or Manabase rule matched these cards. Not a fifth category.</p>
        <div class="arch-unassigned-body">${un || '<div class="arch-empty">Every card found a place.</div>'}</div>
      </section>
      <footer class="arch-legend">
        <span><strong>Foundation</strong> ${CATEGORY_META.foundation.legend}</span>
        <span><strong>Strategy</strong> ${CATEGORY_META.strategy.legend}</span>
        <span><strong>Payoffs</strong> ${CATEGORY_META.payoffs.legend}</span>
        <span><strong>Manabase</strong> ${CATEGORY_META.manabase.legend}</span>
        <span class="arch-legend-multi">Multi-role</span>
      </footer>
    </div>`;
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
    CATEGORY_META,
    architectureCardKey,
    mappedRoleForPlacement,
    emptyArchitectureOverrides,
    normalizeArchitectureOverrides,
    classifyCardArchitecture,
    classifyDeckArchitecture,
    applyArchitectureOverrides,
    setArchitecturePrimary,
    addArchitectureExtra,
    removeArchitectureMembership,
    resetArchitectureCard,
    unassignArchitectureCard,
    architectureViewHtml,
    representativeCards,
  };
});
