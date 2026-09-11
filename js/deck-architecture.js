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
  if (typeof require === 'function') {
    try { if (!planApi || !planApi.getDeckPlan) planApi = require('./deck-plan.js'); } catch (_) { /* bundled */ }
    try { if (!themesApi || !themesApi.analyzeDeckThemes) themesApi = require('./deck-themes.js'); } catch (_) { /* bundled */ }
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
  const INTERACTION_TAGS = Object.freeze(['Removal', 'Counterspell', 'Bounce', 'Bite', 'Burn']);
  const DRAW_TAGS = Object.freeze(['Card Draw', 'Wheel']);
  const LIGHT_MIN = 5;
  // Below this the engine is guessing; fall back to detected themes instead.
  const GOAL_MIN_CONFIDENCE = 0.35;
  const GOAL_MAX_SUBS = 3;
  const ARCH_SUB_TINT_STEPS = 5;

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
        primary: v.primary && v.primary.category ? _normMem(v.primary) : null,
        extrasRemoved: Array.isArray(v.extrasRemoved) ? _dedupeMems(v.extrasRemoved) : [],
        extrasAdded: Array.isArray(v.extrasAdded) ? _dedupeMems(v.extrasAdded) : [],
        unassigned: !!v.unassigned,
        writtenRole: v.writtenRole || null,
        prevPrimaryTag: v.prevPrimaryTag || null,
      };
    }
    return out;
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
  const COMBAT_GOALS = Object.freeze(['voltron', 'stompy', 'counters', 'tokens', 'equipment', 'aristocrats', 'combo']);

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
    if (INTERACTION_TAGS.some(t => tagSet.has(t))) {
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
  const GOAL_ROLE_TAGS = Object.freeze({
    aristocrats: ['Sac Outlet', 'Death Trigger', 'Sac Synergy', 'Token Maker', 'Recursion', 'Reanimate', 'Lifegain', 'Drain'],
    tokens: ['Token Maker', 'Anthem', 'Copy'],
    spellslinger: ['Counterspell', 'Burn', 'Copy', 'Card Draw'],
    reanimator: ['Reanimate', 'Recursion', 'Self-Mill', 'Mill', 'Discard'],
    blink: ['Blink', 'Copy', 'Card Draw'],
    lifegain: ['Lifegain', 'Drain'],
    stompy: ['Pump', 'Bite', 'Combat Trick', 'Evasion', 'Extra Combat', 'Ramp'],
    counters: ['Pump', 'Anthem', 'Combat Trick', 'Bite'],
    landfall: ['Landfall', 'Ramp'],
    enchantress: ['Card Draw', 'Recursion'],
    artifacts: ['Treasure', 'Copy', 'Recursion'],
    control: ['Counterspell', 'Removal', 'Board Wipe', 'Bounce', 'Card Draw'],
    stax: ['Stax', 'Hatebear', 'Tax'],
    voltron: ['Protection', 'Evasion', 'Pump', 'Extra Combat'],
    equipment: ['Protection', 'Evasion', 'Pump'],
    pump: ['Ramp', 'Treasure'],
    wheels: ['Wheel', 'Discard', 'Card Draw'],
    graveyard: ['Recursion', 'Reanimate', 'Self-Mill', 'Graveyard Cast', 'Mill'],
    group_slug: ['Group Slug', 'Burn', 'Ping'],
    combo: ['Tutor', 'Copy', 'Recursion'],
  });

  // A lower-confidence goal whose tag list mostly restates a higher one's is
  // the same pile twice under a second name (Lifegain inside Aristocrats,
  // Graveyard beside Reanimator) — drop it at this overlap or above.
  const GOAL_SUB_OVERLAP_DROP = 0.75;

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
      out.push({
        id,
        label: g.label || key,
        source: 'goal',
        projectTags: tags,
        goalKey: key,
        themeId: null,
        subtagId: null,
      });
      if (out.length >= GOAL_MAX_SUBS) break;
    }
    return out;
  }

  function _buildStrategySubs(plan, themeAnalysis, declaredIds, goals) {
    // The semantic engine's goal is a better statement of what the deck is
    // trying to do than the generic theme vocabulary, so it wins when present.
    const goalSubs = _buildGoalSubs(goals);
    if (goalSubs.length) return goalSubs;
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
    // Each pile answers a distinct question ("Win Condition Payoffs" was a
    // literal duplicate of Win Condition — same predicate — and is gone).
    const out = [];
    out.push({ id: 'win_condition', label: 'Win Condition', source: winId ? 'declared' : 'inferred' });
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
    // Token-flavored payoff subtags feed Token / Swarm; the rest feed Value
    // Finishers — one plan row never justifies two piles. 'Token Maker' is
    // excluded even where a plan payoff row lists it (tokens.payoffs does, for
    // plan-progress counting): a maker is the engine's supply and already
    // defines a Strategy pile — payoff-ness needs a conversion tag.
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
      if (sub.id === 'win_condition' && isWincon && !comboReason) {
        hit.push(sub.id);
        reasons.push('wincon');
      } else if (sub.id === 'combo' && comboReason) {
        hit.push(sub.id);
        reasons.push(comboReason);
      } else if (sub.id === 'token_swarm' && !isWincon && !_isLand(card)
          && (tagSet.has('Anthem') || tagSet.has('Drain') || rowMatch(tokenRows))) {
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

  /** True for Plains/Island/.../Wastes, including snow-covered printings. */
  function _isBasicLandCard(card) {
    const t = _typeLine(card);
    return t.includes('basic') && t.includes('land');
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

    let strategySubs = _buildStrategySubs(resolvedPlan, themeAnalysis, declaredIds, (opts && opts.goals) || null);
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
    const ctx = { deck, plan: resolvedPlan, strategySubs, payoffSubs: payoffSubsAll, goals: (opts && opts.goals) || null };
    let rows = cards.map(c => classifyCardArchitecture(c, ctx));
    rows = applyArchitectureOverrides(rows, (opts && opts.overrides) || (deck && deck.architectureOverrides));
    rows = _mergeBasicLandRows(rows);

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
    if (opts && typeof opts.cardHtml === 'function') {
      const custom = opts.cardHtml(row, opts);
      if (custom) return custom;
    }
    const c = row.card || {};
    const key = _esc(row.key);
    const name = _esc(row.name);
    const qty = row.qty;
    const primaryMark = row.primary ? ' is-arch-primary' : '';
    const src = row.source === 'override' ? ' <span class="arch-pill arch-pill--override">Set</span>' : '';
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
    const badges = `${src}${badge}${qtyHtml}`.trim();
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
    return Math.max(
      FOUNDATION_FNS.length,
      ((model && model.strategySubs) || []).length || 1,
      ((model && model.payoffSubs) || []).length || 1,
      MANABASE_SUBS.length,
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

  // Card order and any group headers inside a subsection come from the caller,
  // so the deck toolbar's Sort / Group By controls apply here too. Group labels
  // are siblings of the cards: they stack in the text body and span the full row
  // in the visual grid. Stacked + card-image mode wraps piles in Visual-view
  // overlapping stacks (`visualStackCols` 1 or 2).
  function _cardsBodyHtml(rows, opts) {
    const o = opts || {};
    const ordered = (typeof o.sortRows === 'function' && o.sortRows(rows)) || rows;
    const groups = typeof o.groupRows === 'function' ? o.groupRows(ordered) : null;
    const stackCols = o.visualStackCols > 0 ? Math.max(1, Math.min(2, o.visualStackCols | 0)) : 0;
    if (!stackCols) {
      if (!groups || !groups.length) return ordered.map(r => _cardRowHtml(r, o)).join('');
      return groups.map(g => {
        const qty = g.rows.reduce((s, r) => s + r.qty, 0);
        return `<div class="arch-sub-group-label">${_esc(g.label)}<span class="arch-sub-group-count">${qty}</span></div>`
          + g.rows.map(r => _cardRowHtml(r, o)).join('');
      }).join('');
    }
    if (!groups || !groups.length) {
      return _archStacksWrapHtml(
        architectureSplitRows(ordered, stackCols).map(col => _archPileHtml(col, o)),
      );
    }
    return _archStacksWrapHtml(_packGroupsIntoStacks(groups, stackCols).map(col =>
      col.map(g => {
        const qty = g.rows.reduce((s, r) => s + r.qty, 0);
        return `<div class="arch-sub-group-label">${_esc(g.label)}<span class="arch-sub-group-count">${qty}</span></div>`
          + _archPileHtml(g.rows, o);
      }).join(''),
    ));
  }

  function _subSectionHtml(title, count, source, cardsHtml, chrome, bodyClass) {
    const src = source === 'inferred'
      ? '' : '';  // Plan / Inferred pills retired with the Plan wizard
    const bodyCls = bodyClass || 'arch-sub-body';
    const c = chrome || { classes: '', dataAttrs: '' };
    return `<details class="arch-sub ${c.classes}" ${c.dataAttrs} open>
      <summary class="arch-sub-head"><span class="arch-sub-title">${_esc(title)}</span> ${src}<span class="arch-sub-count">${count}</span></summary>
      <div class="${bodyCls}">${cardsHtml || '<div class="arch-empty">None yet</div>'}</div>
    </details>`;
  }

  function architectureViewHtml(model, opts) {
    const o = opts || {};
    const panelLayout = o.panelLayout === 'vertical' ? 'vertical' : 'horizontal';
    const cardMode = o.cardMode === 'visual' ? 'visual' : 'text';
    const viewCls = `arch-view--layout-${panelLayout} arch-view--cards-${cardMode}`;
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

    const foundationSubs = FOUNDATION_FNS.map(fn => {
      const rows = byFn(fn.id);
      const label = fn.id === 'win_condition'
        ? `${fn.label} (${model.winConditionLabel || 'Not set'})`
        : fn.label;
      return _subSectionHtml(label, counts.foundationFns[fn.id] || 0, 'declared', _cardsBodyHtml(rows, stackOpts(FOUNDATION_FNS.length)), _subsectionChrome('foundation', fn.id), subBodyCls);
    }).join('');

    const strategyHtml = (model.strategySubs || []).map(sub => {
      const rows = byStrat(sub.id);
      return _subSectionHtml(sub.label, (counts.strategy && counts.strategy[sub.id]) || 0, sub.source, _cardsBodyHtml(rows, stackOpts((model.strategySubs || []).length || 1)), _subsectionChrome('strategy', sub.id), subBodyCls);
    }).join('') || '<div class="arch-empty">No strategy engines stood out yet. Set a Plan to name them.</div>';

    const payoffHtml = (model.payoffSubs || []).map(sub => {
      const rows = byPay(sub.id);
      return _subSectionHtml(sub.label, (counts.payoffs && counts.payoffs[sub.id]) || 0, sub.source, _cardsBodyHtml(rows, stackOpts((model.payoffSubs || []).length || 1)), _subsectionChrome('payoffs', sub.id), subBodyCls);
    }).join('') || '<div class="arch-empty">No payoffs classified yet.</div>';

    const landHtml = MANABASE_SUBS.map(sub => {
      const rows = byMana(sub.id);
      return _subSectionHtml(sub.label, (counts.manabase && counts.manabase[sub.id]) || 0, 'declared', _cardsBodyHtml(rows, stackOpts(MANABASE_SUBS.length)), _subsectionChrome('manabase', sub.id), subBodyCls);
    }).join('');

    const compactChips = (cat) => {
      if (cat === 'foundation') {
        return FOUNDATION_FNS.map(fn => _chipHtml('foundation', fn.id, fn.label, counts.foundationFns[fn.id] || 0)).join('');
      }
      if (cat === 'strategy') {
        return (model.strategySubs || []).map(s => _chipHtml('strategy', s.id, s.label, (counts.strategy && counts.strategy[s.id]) || 0)).join('');
      }
      if (cat === 'payoffs') {
        return (model.payoffSubs || []).map(s => _chipHtml('payoffs', s.id, s.label, (counts.payoffs && counts.payoffs[s.id]) || 0)).join('');
      }
      return MANABASE_SUBS.map(sub => _chipHtml('manabase', sub.id, sub.label, (counts.manabase && counts.manabase[sub.id]) || 0)).join('');
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
        ${compact}
      </section>`;
    };

    const un = _cardsBodyHtml(model.unassigned || [], o);

    return `<div class="arch-view ${viewCls}" id="deckArchitectureView">
      <div class="${gridCls}">
        ${panel('foundation', foundationSubs)}
        ${panel('strategy', strategyHtml)}
        ${panel('payoffs', payoffHtml)}
        ${panel('manabase', landHtml)}
      </div>
      <section class="arch-unassigned">
        <h3 class="arch-unassigned-title">Unassigned <span class="arch-panel-count">${(model.unassigned || []).reduce((s, r) => s + r.qty, 0)} cards</span></h3>
        <div class="arch-unassigned-body ${cardMode === 'visual' ? 'arch-sub-body--visual' : ''}">${un || '<div class="arch-empty">Every card found a place.</div>'}</div>
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
      push(`foundation::${fn.id}`, labelOf('foundation', fn.id), rows.filter(r => r.foundationFns.includes(fn.id)));
    }
    for (const sub of model.strategySubs || []) {
      push(`strategy::${sub.id}`, labelOf('strategy', sub.id), rows.filter(r => r.strategySubs.includes(sub.id)));
    }
    for (const sub of model.payoffSubs || []) {
      push(`payoffs::${sub.id}`, labelOf('payoffs', sub.id), rows.filter(r => r.payoffSubs.includes(sub.id)));
    }
    for (const sub of MANABASE_SUBS) {
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
    architectureStackFit,
    architectureColWidth,
    architectureStacksAtSize,
    architectureMaxSubCount,
    architectureSplitRows,
    architectureGroupBuckets,
    representativeCards,
    ARCH_SUB_TINT_STEPS,
    _subsectionSlug,
    _subsectionTintIndex,
    _subsectionChrome,
  };
});
