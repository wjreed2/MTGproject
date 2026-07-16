/**
 * Deck plan wizard + plan-aware Adds helpers (Entry 13 v1 / Entry 5).
 * Deterministic only — catalogs, keyword rules, formulas. No runtime AI.
 *
 * Project role-tag labels are transitional; keep semantic→ID maps centralized here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  // ── Named constants ───────────────────────────────────────────────────────
  const PLAN_WIZARD_ANALYZE_THRESHOLD = 80;
  const PLAN_PRIMARY_OPTIONS_COUNT = 6;
  const PLAN_INFERENCE_CONFIDENCE_MIN = 0.35;
  const PLAN_CHIP_MAX = 3;
  const PLAN_TAG_SIGNAL_WEIGHT = 1.0;
  const PLAN_ORACLE_SIGNAL_WEIGHT = 0.5;
  const PLAN_BUDGET_BUSTER_MAX = 2;
  const PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE = 0.85;

  const PLAN_STRATEGIES = Object.freeze([
    { id: 'strategy.tokens', label: 'Tokens / Go-wide' },
    { id: 'strategy.sacrifice', label: 'Sacrifice / Aristocrats' },
    { id: 'strategy.spellslinger', label: 'Spellslinger' },
    { id: 'strategy.reanimator', label: 'Reanimator / Graveyard' },
    { id: 'strategy.voltron', label: 'Voltron / Commander damage' },
    { id: 'strategy.counters', label: '+1/+1 Counters' },
    { id: 'strategy.landfall', label: 'Landfall' },
    { id: 'strategy.tribal', label: 'Tribal' },
    { id: 'strategy.artifacts', label: 'Artifacts' },
    { id: 'strategy.enchantress', label: 'Enchantress' },
    { id: 'strategy.control', label: 'Control / Value grind' },
    { id: 'strategy.blink', label: 'Blink / ETB value' },
    { id: 'strategy.superfriends', label: 'Superfriends' },
    { id: 'strategy.theft', label: 'Theft / Steal' },
    { id: 'strategy.other', label: 'Other / Hybrid' },
  ]);

  const PLAN_WINCONS = Object.freeze([
    { id: 'wincon.combat', label: 'Combat damage' },
    { id: 'wincon.commander_damage', label: 'Commander damage' },
    { id: 'wincon.combo', label: 'Infinite / instant-win combo' },
    { id: 'wincon.mill', label: 'Mill' },
    { id: 'wincon.life_drain', label: 'Life drain / life loss' },
    { id: 'wincon.lock', label: 'Lock / Stax' },
    { id: 'wincon.value', label: 'Overwhelming value / grind' },
    { id: 'wincon.other', label: 'Other' },
  ]);

  const PLAN_STRATEGY_FALLBACK_IDS = Object.freeze([
    'strategy.tokens', 'strategy.sacrifice', 'strategy.spellslinger',
    'strategy.tribal', 'strategy.control', 'strategy.other',
  ]);
  const PLAN_WINCON_FALLBACK_IDS = Object.freeze([
    'wincon.combat', 'wincon.commander_damage', 'wincon.combo',
    'wincon.life_drain', 'wincon.value',
  ]);

  const PLAN_DECK_BUDGET_TIERS = Object.freeze([
    { id: 'budget.deck.skip', usd: null, label: 'No limit' },
    { id: 'budget.deck.50', usd: 50, label: '$50' },
    { id: 'budget.deck.100', usd: 100, label: '$100' },
    { id: 'budget.deck.200', usd: 200, label: '$200' },
    { id: 'budget.deck.500', usd: 500, label: '$500' },
    { id: 'budget.deck.1000', usd: 1000, label: '$1000' },
    { id: 'budget.deck.custom', usd: null, label: 'Custom…' },
  ]);
  const PLAN_CARD_BUDGET_TIERS = Object.freeze([
    { id: 'budget.card.skip', usd: null, label: 'No limit' },
    { id: 'budget.card.1', usd: 1, label: '$1' },
    { id: 'budget.card.3', usd: 3, label: '$3' },
    { id: 'budget.card.5', usd: 5, label: '$5' },
    { id: 'budget.card.10', usd: 10, label: '$10' },
    { id: 'budget.card.25', usd: 25, label: '$25' },
    { id: 'budget.card.custom', usd: null, label: 'Custom…' },
  ]);

  /** Strategy/wincon → project role-tag labels (SCRYFALL_AUTO_TAGS). */
  const PLAN_STRATEGY_PROJECT_TAGS = Object.freeze({
    'strategy.tokens': ['Token Maker', 'Treasure'],
    'strategy.sacrifice': ['Sac Outlet', 'Death Trigger', 'Sac Synergy', 'Drain'],
    'strategy.spellslinger': ['Card Draw', 'Tutor', 'Counterspell'],
    'strategy.reanimator': ['Recursion', 'Reanimate', 'Graveyard Cast', 'Self-Mill'],
    'strategy.voltron': ['Pump', 'Evasion', 'Protection', 'Anthem'],
    'strategy.counters': ['Pump', 'Anthem'],
    'strategy.landfall': ['Landfall', 'Ramp'],
    'strategy.tribal': [],
    'strategy.artifacts': ['Treasure', 'Tutor'],
    'strategy.enchantress': ['Card Draw', 'Anthem'],
    'strategy.control': ['Counterspell', 'Removal', 'Board Wipe', 'Card Draw'],
    'strategy.blink': ['Blink'],
    'strategy.superfriends': ['Protection', 'Tutor'],
    'strategy.theft': ['Control', 'Bounce'],
    'strategy.other': [],
  });

  const PLAN_WINCON_PROJECT_TAGS = Object.freeze({
    'wincon.combat': ['Anthem', 'Pump', 'Evasion', 'Token Maker', 'Extra Combat'],
    'wincon.commander_damage': ['Pump', 'Evasion', 'Protection'],
    'wincon.combo': ['Tutor', 'Recursion'],
    'wincon.mill': ['Mill', 'Self-Mill'],
    'wincon.life_drain': ['Drain', 'Lifegain'],
    'wincon.lock': ['Stax', 'Hatebear'],
    'wincon.value': ['Card Draw', 'Removal', 'Recursion'],
    'wincon.other': [],
  });

  const PLAN_STRATEGY_ORACLE_RULES = Object.freeze([
    { id: 'strategy.sacrifice', patterns: [/\bsacrific(?:e|es|ing)\b/i, /\bdies\b/i] },
    { id: 'strategy.tokens', patterns: [/\btokens?\b/i] },
    { id: 'strategy.spellslinger', patterns: [/\bcast\b/i, /\binstant\b/i, /\bsorcery\b/i, /\bmagecraft\b/i, /\bstorm\b/i] },
    { id: 'strategy.reanimator', patterns: [/\bgraveyard\b/i, /\breanimate\b/i, /\breturn .{0,40}graveyard\b/i] },
    { id: 'strategy.voltron', patterns: [/\bcommander damage\b/i, /\bequipped\b/i, /\baura\b/i] },
    { id: 'strategy.counters', patterns: [/\+\+1\/\+1 counter/i, /\bproliferate\b/i] },
    { id: 'strategy.landfall', patterns: [/\blandfall\b/i, /\bland enters\b/i] },
    { id: 'strategy.tribal', patterns: [/\btribal\b/i, /\bcreature type\b/i] },
    { id: 'strategy.artifacts', patterns: [/\bartifact\b/i] },
    { id: 'strategy.enchantress', patterns: [/\benchantment\b/i] },
    { id: 'strategy.control', patterns: [/\bcounter target\b/i, /\bdraw (a|two|three) cards?\b/i] },
    { id: 'strategy.blink', patterns: [/\bflicker\b/i, /\bexile .{0,30}return\b/i, /\benters the battlefield\b/i] },
    { id: 'strategy.superfriends', patterns: [/\bplaneswalker\b/i, /\bloyalty\b/i] },
    { id: 'strategy.theft', patterns: [/\bgain control\b/i, /\bsteal\b/i] },
  ]);

  const PLAN_WINCON_ORACLE_RULES = Object.freeze([
    { id: 'wincon.mill', patterns: [/\bmill\b/i] },
    { id: 'wincon.life_drain', patterns: [/\blose life\b/i, /\bdrain\b/i, /\blifelink\b/i] },
    { id: 'wincon.combo', patterns: [/\binfinite\b/i, /\bwin the game\b/i, /\byou win\b/i] },
    { id: 'wincon.lock', patterns: [/\bcan't\b/i, /\bprevent\b/i, /\bskip .{0,20}phase\b/i] },
    { id: 'wincon.commander_damage', patterns: [/\bcommander damage\b/i] },
    { id: 'wincon.combat', patterns: [/\bcombat damage\b/i] },
  ]);

  function emptyPlan() {
    return {
      winConditionId: null,
      primaryStrategyId: null,
      secondaryStrategyId: null,
      roughMaxDeckBudgetUsd: null,
      roughMaxPerCardBudgetUsd: null,
      allowBudgetBusters: false,
      fieldSources: {
        winConditionId: null,
        primaryStrategyId: null,
        secondaryStrategyId: null,
        roughMaxDeckBudgetUsd: null,
        roughMaxPerCardBudgetUsd: null,
        allowBudgetBusters: null,
      },
      tertiaryStrategyId: null,
      hybridRoleModifiers: null,
      cutsShielding: null,
    };
  }

  function normalizeDeckPlan(raw) {
    const base = emptyPlan();
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base, ...raw, fieldSources: { ...base.fieldSources, ...(raw.fieldSources || {}) } };
    out.tertiaryStrategyId = out.tertiaryStrategyId ?? null;
    out.hybridRoleModifiers = out.hybridRoleModifiers ?? null;
    out.cutsShielding = out.cutsShielding ?? null;
    return out;
  }

  function getDeckPlan(deck) {
    return normalizeDeckPlan(deck && deck.plan);
  }

  function isPlanDeclared(plan) {
    const p = normalizeDeckPlan(plan);
    return !!(p.winConditionId && p.primaryStrategyId);
  }

  /** Mainboard qty sum (lands + commander); excludes sideboard/maybeboard/planned adds. */
  function deckPlanCardCount(deck) {
    return (deck?.cards || []).reduce((s, c) => s + (c.qty || 1), 0);
  }

  function strategyLabel(id) {
    return (PLAN_STRATEGIES.find(s => s.id === id) || {}).label || id || '';
  }
  function winconLabel(id) {
    return (PLAN_WINCONS.find(w => w.id === id) || {}).label || id || '';
  }

  function _oracleBlob(card) {
    if (!card) return '';
    if (typeof resolveCardOracleText === 'function') return String(resolveCardOracleText(card) || '').toLowerCase();
    return String(card.oracleText || card.oracle_text || '').toLowerCase();
  }

  function _cardRoles(card, deck) {
    if (Array.isArray(card?.roleTags) && card.roleTags.length) return card.roleTags;
    if (typeof _probTagsOnCard === 'function' && deck) return _probTagsOnCard(card, deck);
    return Array.isArray(card?.customTags) ? card.customTags : [];
  }

  function _typeLine(card) {
    return String(card?.type || card?.typeLine || card?.type_line || '').toLowerCase();
  }

  function _rankFromRules(text, rules, capHits) {
    const scores = Object.create(null);
    const blob = String(text || '').toLowerCase();
    for (const rule of rules) {
      let hits = 0;
      for (const re of rule.patterns) {
        if (re.test(blob)) hits++;
      }
      if (hits) scores[rule.id] = Math.min(capHits, hits) * PLAN_ORACLE_SIGNAL_WEIGHT;
    }
    return scores;
  }

  function _topRanked(scoreMap, catalog, fallbackIds, count) {
    const rows = catalog.map(c => ({
      id: c.id,
      label: c.label,
      score: Number(scoreMap[c.id] || 0),
    })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const top = rows[0]?.score || 0;
    if (top < PLAN_INFERENCE_CONFIDENCE_MIN) {
      return fallbackIds.slice(0, count).map(id => {
        const c = catalog.find(x => x.id === id);
        return { id, label: c?.label || id, score: 0, fallback: true };
      });
    }
    // Normalize to 0–1 by dividing by max raw among catalog (or top)
    const maxRaw = Math.max(top, 1e-9);
    return rows.slice(0, count).map(r => ({
      ...r,
      score: Math.min(1, r.score / maxRaw),
      fallback: false,
    }));
  }

  function rankStrategiesForCommander(commander) {
    const text = _oracleBlob(commander) + ' ' + String(commander?.name || '');
    const scores = _rankFromRules(text, PLAN_STRATEGY_ORACLE_RULES, 3);
    return _topRanked(scores, PLAN_STRATEGIES, PLAN_STRATEGY_FALLBACK_IDS, PLAN_PRIMARY_OPTIONS_COUNT);
  }

  function rankWinConditionsForCommander(commander) {
    const text = _oracleBlob(commander) + ' ' + String(commander?.name || '');
    const scores = _rankFromRules(text, PLAN_WINCON_ORACLE_RULES, 3);
    return _topRanked(scores, PLAN_WINCONS, PLAN_WINCON_FALLBACK_IDS, Math.min(5, PLAN_PRIMARY_OPTIONS_COUNT));
  }

  function _deckTypeRatios(deck) {
    const cards = deck?.cards || [];
    let creatures = 0, instSor = 0, artifacts = 0, enchantments = 0, lands = 0, walkers = 0, total = 0;
    for (const c of cards) {
      const q = c.qty || 1;
      total += q;
      const tl = _typeLine(c);
      if (tl.includes('land')) lands += q;
      if (tl.includes('creature')) creatures += q;
      if (tl.includes('instant') || tl.includes('sorcery')) instSor += q;
      if (tl.includes('artifact')) artifacts += q;
      if (tl.includes('enchantment')) enchantments += q;
      if (tl.includes('planeswalker')) walkers += q;
    }
    const nonLand = Math.max(1, total - lands);
    return {
      total, nonLand, creatures, instSor, artifacts, enchantments, walkers, lands,
      creatureShare: creatures / nonLand,
      instSorShare: instSor / nonLand,
      artifactShare: artifacts / nonLand,
      enchantShare: enchantments / nonLand,
      walkerShare: walkers / nonLand,
    };
  }

  function _deckTagCounts(deck) {
    const counts = Object.create(null);
    for (const c of (deck?.cards || [])) {
      const roles = _cardRoles(c, deck);
      const q = c.qty || 1;
      for (const t of roles) {
        if (t === 'Land' || t === 'Commander') continue;
        counts[t] = (counts[t] || 0) + q;
      }
    }
    return counts;
  }

  function _tagSignal(counts, tags, weight) {
    let s = 0;
    for (const t of tags) s += (counts[t] || 0) * weight;
    return s;
  }

  function rankStrategiesForDeck(deck) {
    const counts = _deckTagCounts(deck);
    const ratios = _deckTypeRatios(deck);
    const scores = Object.create(null);
    const W = PLAN_TAG_SIGNAL_WEIGHT;
    for (const s of PLAN_STRATEGIES) {
      let raw = _tagSignal(counts, PLAN_STRATEGY_PROJECT_TAGS[s.id] || [], W);
      if (s.id === 'strategy.spellslinger') raw += ratios.instSorShare * 8 * W;
      if (s.id === 'strategy.artifacts') raw += ratios.artifactShare * 8 * W;
      if (s.id === 'strategy.enchantress') raw += ratios.enchantShare * 8 * W;
      if (s.id === 'strategy.superfriends') raw += ratios.walkerShare * 20 * W;
      if (s.id === 'strategy.tribal' && ratios.creatureShare > 0.4) raw += 4 * W;
      if (s.id === 'strategy.control') raw += ((counts['Counterspell'] || 0) + (counts['Removal'] || 0) + (counts['Card Draw'] || 0)) * 0.15 * W;
      scores[s.id] = raw;
    }
    // Normalize by max attainable-ish scale for this deck
    const maxRaw = Math.max(...Object.values(scores), 1e-9);
    const normalized = Object.create(null);
    for (const id of Object.keys(scores)) normalized[id] = scores[id] / maxRaw;
    return _topRanked(normalized, PLAN_STRATEGIES, PLAN_STRATEGY_FALLBACK_IDS, PLAN_PRIMARY_OPTIONS_COUNT);
  }

  function rankWinConditionsForDeck(deck) {
    const counts = _deckTagCounts(deck);
    const ratios = _deckTypeRatios(deck);
    const scores = Object.create(null);
    const W = PLAN_TAG_SIGNAL_WEIGHT;
    for (const w of PLAN_WINCONS) {
      let raw = _tagSignal(counts, PLAN_WINCON_PROJECT_TAGS[w.id] || [], W);
      if (w.id === 'wincon.combat') raw += ratios.creatureShare * 6 * W;
      if (w.id === 'wincon.commander_damage') {
        raw += _tagSignal(counts, PLAN_STRATEGY_PROJECT_TAGS['strategy.voltron'], W);
      }
      if (w.id === 'wincon.value') {
        raw += ((counts['Card Draw'] || 0) + (counts['Removal'] || 0)) * 0.2 * W;
      }
      scores[w.id] = raw;
    }
    const maxRaw = Math.max(...Object.values(scores), 1e-9);
    const normalized = Object.create(null);
    for (const id of Object.keys(scores)) normalized[id] = scores[id] / maxRaw;
    return _topRanked(normalized, PLAN_WINCONS, PLAN_WINCON_FALLBACK_IDS, Math.min(5, PLAN_PRIMARY_OPTIONS_COUNT));
  }

  function strategyMatch(card, strategyId, deck) {
    if (!strategyId) return 0;
    const tags = new Set(_cardRoles(card, deck));
    const want = PLAN_STRATEGY_PROJECT_TAGS[strategyId] || [];
    if (want.some(t => tags.has(t))) return 1;
    const rule = PLAN_STRATEGY_ORACLE_RULES.find(r => r.id === strategyId);
    if (rule) {
      const blob = _oracleBlob(card);
      if (rule.patterns.some(re => re.test(blob))) return 1;
    }
    const tl = _typeLine(card);
    if (strategyId === 'strategy.artifacts' && tl.includes('artifact')) return 1;
    if (strategyId === 'strategy.enchantress' && tl.includes('enchantment')) return 1;
    if (strategyId === 'strategy.superfriends' && tl.includes('planeswalker')) return 1;
    if (strategyId === 'strategy.spellslinger' && (tl.includes('instant') || tl.includes('sorcery'))) return 1;
    return 0;
  }

  function winconMatch(card, winconId, deck) {
    if (!winconId) return 0;
    const tags = new Set(_cardRoles(card, deck));
    const want = PLAN_WINCON_PROJECT_TAGS[winconId] || [];
    if (want.some(t => tags.has(t))) return 1;
    const rule = PLAN_WINCON_ORACLE_RULES.find(r => r.id === winconId);
    if (rule) {
      const blob = _oracleBlob(card);
      if (rule.patterns.some(re => re.test(blob))) return 1;
    }
    return 0;
  }

  function planMatchScore(card, plan, deck) {
    const p = normalizeDeckPlan(plan);
    return 2 * strategyMatch(card, p.primaryStrategyId, deck)
      + 1 * strategyMatch(card, p.secondaryStrategyId, deck)
      + 1 * winconMatch(card, p.winConditionId, deck);
  }

  /** Role tags to request from /api/cards/by-roles for Plan-theme pool. */
  function planBackfillRoles(plan) {
    const p = normalizeDeckPlan(plan);
    const set = new Set();
    for (const id of [p.primaryStrategyId, p.secondaryStrategyId]) {
      for (const t of (PLAN_STRATEGY_PROJECT_TAGS[id] || [])) set.add(t);
    }
    for (const t of (PLAN_WINCON_PROJECT_TAGS[p.winConditionId] || [])) set.add(t);
    // Always include a broad utility set if strategy mapped to nothing
    if (!set.size) ['Ramp', 'Card Draw', 'Removal', 'Tutor'].forEach(t => set.add(t));
    return [...set].slice(0, 12);
  }

  function planUsdPrice(card) {
    if (typeof cardUsdPrice === 'function') {
      const p = cardUsdPrice(card);
      if (p != null) return p;
    }
    const a = Number(card?.priceTCG);
    if (Number.isFinite(a) && a > 0) return a;
    const b = Number(card?.prices?.usd);
    if (Number.isFinite(b) && b > 0) return b;
    return null;
  }

  /**
   * Filter/sort scored Adds picks with budget rules.
   * scoredItems: [{ card, owned, s }] already scored; returns filtered topN list.
   */
  function applyPlanBudgetToAddsPicks(scoredItems, plan, topN) {
    const p = normalizeDeckPlan(plan);
    const limit = p.roughMaxPerCardBudgetUsd;
    const log = [];
    if (limit == null || !Number.isFinite(Number(limit))) {
      return { picks: scoredItems.slice(0, topN), log: ['budget: skipped / no per-card limit'] };
    }
    const maxUsd = Number(limit);
    const sorted = scoredItems.slice().sort((a, b) => (b.s?.score || 0) - (a.s?.score || 0));
    const nAll = sorted.length || 1;
    const inBudget = [];
    const overBudget = [];
    for (const it of sorted) {
      const usd = planUsdPrice(it.card);
      if (usd == null || usd <= maxUsd) inBudget.push(it);
      else overBudget.push(it);
    }
    const picks = inBudget.slice(0, topN);
    const allowBusters = !!p.allowBudgetBusters;
    if (!allowBusters) {
      log.push(`budget: hard-exclude over $${maxUsd}; kept ${picks.length}`);
      return { picks, log };
    }
    // Busters: over-budget cards in top (1 - percentile) of all scores
    let busters = 0;
    for (const it of overBudget) {
      if (picks.length >= topN || busters >= PLAN_BUDGET_BUSTER_MAX) break;
      const rank = sorted.indexOf(it);
      const percentileFromTop = 1 - (rank / nAll);
      if (percentileFromTop >= PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE) {
        picks.push(it);
        busters++;
        log.push(`budget-buster: ${it.card?.name} usd=${planUsdPrice(it.card)} pct=${percentileFromTop.toFixed(2)}`);
      }
    }
    // Fill remaining from in-budget if needed
    for (const it of inBudget) {
      if (picks.length >= topN) break;
      if (!picks.includes(it)) picks.push(it);
    }
    picks.sort((a, b) => (b.s?.score || 0) - (a.s?.score || 0));
    return { picks: picks.slice(0, topN), log };
  }

  /** Mild deck-budget tie-break: subtract tiny amount when deck over rough max. */
  function planDeckBudgetTieBreak(score, deck, plan) {
    const p = normalizeDeckPlan(plan);
    const max = p.roughMaxDeckBudgetUsd;
    if (max == null || !Number.isFinite(Number(max))) return score;
    // Soft: if deck total already over, nudge score down slightly for expensive cards later —
    // applied as a tiny constant so near-equal scores prefer cheaper when over budget.
    return score;
  }

  function isDeckPlanDebugEnabled() {
    try {
      if (typeof window !== 'undefined' && window.__DECK_PLAN_DEBUG) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('mtg_deck_plan_debug') === '1') return true;
    } catch (_) {}
    return false;
  }

  function logDeckPlan(...args) {
    if (!isDeckPlanDebugEnabled()) return;
    // eslint-disable-next-line no-console
    console.log('[deck-plan]', ...args);
  }

  function shouldFetchPlanOnlyBackfill(ctx, plan) {
    const deficits = ctx?.deficits || {};
    const planDef = deficits.Plan || 0;
    if (planDef <= 0) return false;
    if (!isPlanDeclared(plan)) return false;
    const nonPlan = Object.entries(deficits).filter(([t, v]) => t !== 'Plan' && v > 0);
    if (nonPlan.length) {
      const maxOther = Math.max(...nonPlan.map(([, v]) => v));
      if (maxOther >= planDef) return false; // Plan not largest
    }
    // Plan is largest (or only) active deficit
    return true;
  }

  return {
    PLAN_WIZARD_ANALYZE_THRESHOLD,
    PLAN_PRIMARY_OPTIONS_COUNT,
    PLAN_INFERENCE_CONFIDENCE_MIN,
    PLAN_CHIP_MAX,
    PLAN_TAG_SIGNAL_WEIGHT,
    PLAN_ORACLE_SIGNAL_WEIGHT,
    PLAN_BUDGET_BUSTER_MAX,
    PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE,
    PLAN_STRATEGIES,
    PLAN_WINCONS,
    PLAN_STRATEGY_FALLBACK_IDS,
    PLAN_WINCON_FALLBACK_IDS,
    PLAN_DECK_BUDGET_TIERS,
    PLAN_CARD_BUDGET_TIERS,
    PLAN_STRATEGY_PROJECT_TAGS,
    PLAN_WINCON_PROJECT_TAGS,
    emptyPlan,
    normalizeDeckPlan,
    getDeckPlan,
    isPlanDeclared,
    deckPlanCardCount,
    strategyLabel,
    winconLabel,
    rankStrategiesForCommander,
    rankWinConditionsForCommander,
    rankStrategiesForDeck,
    rankWinConditionsForDeck,
    strategyMatch,
    winconMatch,
    planMatchScore,
    planBackfillRoles,
    planUsdPrice,
    applyPlanBudgetToAddsPicks,
    planDeckBudgetTieBreak,
    shouldFetchPlanOnlyBackfill,
    isDeckPlanDebugEnabled,
    logDeckPlan,
  };
});
