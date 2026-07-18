/**
 * Suggested Adds scoring — pure deterministic terms (Prompt 1 / entries 7,9,10,11,12).
 *
 * Score = (D × M) + C_eff + L + E + B − P + V + T + K
 *
 * IDs in EFFICIENCY_MODE_PROJECT_TAGS / ADD_ROLE_SEMANTIC_MAP may change when partner
 * tag work renames labels — keep lookups centralized here; do not scatter hard-coded
 * tag strings across scorers.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  // ── Named constants (locked / calibrated) ─────────────────────────────────
  const D_SUBLINEAR_WEIGHTS = [1.0, 0.5, 0.25];
  const CMC_REF = 4;
  /**
   * L = K_L × max(0, CMC_REF − CMC). Each mana below 4 MV is worth K_L on
   * efficiency-mode cards (interaction/ramp/etc.); CMC ≥ 4 → L = 0.
   * Keep K_L near C_eff's scale (cap 1.5) so L stays secondary to D.
   * Do not retune K_L to force card matchups (TV>GS etc.) — those are soft
   * vignettes only.
   *
   * E is independent of K_L: after L was retuned down (2.0 → 0.2), the old
   * "K_E = 0.5 × K_L" rule left max E at 0.1 — smaller than B (0.55), so
   * unpopular creatures could beat staples on body bonus alone.
   * E = K_E × p_adjusted, where p_adjusted is the role EDHREC percentile in
   * [0, 1] after a small price-band tweak. K_E = 4.0 → an 80th-percentile
   * card gets E ≈ 3.2; a perfect percentile gets the full 4.0.
   */
  const K_L = 0.2;
  const K_E = 4.0; // max E at p_adjusted=1
  const K_B = 0.55;
  const K_P = 0.15;
  const V_PER_EXTRA_TAG = 0.15;
  const V_SECOND_PLUS_DAMPEN = 0.5;
  /** Raw score at/above this maps to a full 10 on the Suggested Adds badge (UI only). */
  const ADD_SCORE_RAW_CEILING = 12;
  const ADD_SCORE_DISPLAY_MAX = 10;
  const E_PRICE_BAND_DELTAS = [
    { max: 0.75, delta: -0.05 },
    { max: 5, delta: 0 },
    { max: 20, delta: 0.05 },
    { max: 50, delta: 0.1 },
    { max: Infinity, delta: 0.05 },
  ];

  /**
   * Semantic → project role-tag label map (transitional IDs).
   * Source: Archive-Suggestions/cuts-adds-backlog.md entry 11 + Ready Prompt Tier 3 lock
   * (Tutor + Bite in; Recursion/Reanimate/cantrip-draw out). IDs may change with partner
   * tag work — keep lookups centralized here.
   */
  const ADD_ROLE_SEMANTIC_MAP = Object.freeze({
    // Tier 1
    ramp: 'Ramp',
    removal: 'Removal',
    protection: 'Protection',
    combatTrick: 'Combat Trick',
    pump: 'Pump',
    // Tier 2
    counterspell: 'Counterspell',
    burn: 'Burn',
    bounce: 'Bounce',
    discard: 'Discard',
    // Tier 2 with no project tag yet: fog / silence — map when labels exist
    // Tier 3 subset (Ready Prompt locked in)
    tutor: 'Tutor',
    bite: 'Bite',
    fightBite: 'Bite',
    // Exclusions / other
    draw: 'Card Draw',
    boardWipe: 'Board Wipe',
    anthem: 'Anthem',
    groupSlug: 'Group Slug',
    recursion: 'Recursion',
    reanimate: 'Reanimate',
    control: 'Control',
    stax: 'Stax',
    hatebear: 'Hatebear',
  });

  /**
   * L on / C off — backlog Tier 1 + Tier 2, plus Ready Prompt locked Tier 3 (Tutor, Bite).
   * Project has no Fog/Silence tags yet (Tier 2 combat-fog / silence) — omit until mapped.
   * Lands never get L even if Ramp-tagged (land-ramp exclusion).
   */
  const EFFICIENCY_MODE_PROJECT_TAGS = Object.freeze(new Set([
    // Tier 1
    'Ramp',
    'Removal',
    'Protection',
    'Combat Trick',
    'Pump',
    // Tier 2
    'Counterspell',
    'Burn',
    'Bounce',
    'Discard',
    // Tier 3 subset (locked by Ready Prompt)
    'Tutor',
    'Bite',
  ]));

  /** Explicit normal-C roles from entry 11 exclusion table (+ Tier 3 out). */
  const EFFICIENCY_MODE_EXCLUSIONS = Object.freeze(new Set([
    'Board Wipe',
    'Card Draw',
    'Anthem',
    'Group Slug',
    'Recursion',
    'Reanimate',
    'Plan',
    // Not Tier 1/2 — keep normal C (listed for clarity; absence from EFFICIENCY set is enough)
    'Evasion',
    'Extra Combat',
    'Token Maker',
    'Blink',
    'Copy',
    'Treasure',
    'Lifegain',
    'Mill',
    'Wheel',
    'Landfall',
    'Graveyard Cast',
    'Self-Mill',
    'Sac Outlet',
    'Death Trigger',
    'Drain',
    'Sac Synergy',
    'Control',
    'Stax',
    'Hatebear',
  ]));

  function _clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function _isCreatureType(card) {
    const tl = String(card?.type || card?.typeLine || card?.type_line || '').toLowerCase();
    return /\bcreature\b/.test(tl);
  }

  function _isLandType(card) {
    const tl = String(card?.type || card?.typeLine || card?.type_line || '').toLowerCase();
    return /\bland\b/.test(tl);
  }

  /** Printed CMC for C_eff/L; {X} counts as 3. Prefer customCmc when set. */
  function scoringCmcForAdds(card) {
    if (card?.customCmc != null && Number.isFinite(card.customCmc)) return Number(card.customCmc);
    const mana = String(card?.mana || card?.mana_cost || '');
    const hasX = /\{X\}/i.test(mana);
    let cmc = Number(card?.cmc);
    if (!Number.isFinite(cmc) || cmc < 0) cmc = 0;
    if (hasX) cmc += 3;
    return cmc;
  }

  /**
   * Pip restrictiveness from mana cost (locked weights).
   * WUBRG 1.0 · hybrid 0.5 · Phyrexian −0.5 · C/generic/X 0.
   */
  function pipRestrictivenessScore(manaCost) {
    const tokens = String(manaCost || '').match(/\{[^}]+\}/g) || [];
    let score = 0;
    for (const tok of tokens) {
      const inner = tok.slice(1, -1).toUpperCase();
      if (/^\d+$/.test(inner) || inner === 'X' || inner === 'Y' || inner === 'Z' || inner === 'C' || inner === 'S') {
        continue;
      }
      if (/^[WUBRG]$/.test(inner)) {
        score += 1;
      } else if (/^[WUBRG]\/[WUBRG]$/.test(inner)) {
        score += 0.5;
      } else if (/^[WUBRG]\/P$/.test(inner)) {
        score -= 0.5;
      } else if (/^2\/[WUBRG]$/.test(inner)) {
        // Twobrid: flexible — treat like mild hybrid toward the color (0.5)
        score += 0.5;
      }
    }
    return score;
  }

  function priceBandDelta(usd) {
    const p = Number(usd);
    if (!Number.isFinite(p) || p < 0) return 0;
    for (const band of E_PRICE_BAND_DELTAS) {
      if (p < band.max) return band.delta;
    }
    return 0;
  }

  function cardUsdPrice(card) {
    const a = Number(card?.priceTCG);
    if (Number.isFinite(a) && a > 0) return a;
    const b = Number(card?.prices?.usd);
    if (Number.isFinite(b) && b > 0) return b;
    const c = Number(card?.priceCK);
    if (Number.isFinite(c) && c > 0) return c;
    return null;
  }

  function usesEfficiencyMode(roles, card) {
    if (_isLandType(card)) return false;
    return (roles || []).some(t => EFFICIENCY_MODE_PROJECT_TAGS.has(t));
  }

  /**
   * Sublinear multi-deficit D + topRole selection for E.
   * Returns { D, topRole, topVal, matched: [{role, deficit, weight}] }
   */
  function computeDeficitTermD(roles, deficits) {
    const real = (roles || []).filter(t => t !== 'Land' && t !== 'Commander');
    const matched = [];
    if (!real.length) {
      const plan = Math.min(deficits?.Plan || 0, 3);
      if (plan > 0) {
        matched.push({ role: 'Plan', deficit: plan, weight: 1 });
        return { D: plan, topRole: 'Plan', topVal: plan, matched };
      }
      return { D: 0, topRole: '', topVal: -1, matched };
    }
    for (const t of real) {
      const d = deficits?.[t] || 0;
      if (d > 0) matched.push({ role: t, deficit: d, weight: 1 });
    }
    matched.sort((a, b) => b.deficit - a.deficit || String(a.role).localeCompare(String(b.role)));
    let D = 0;
    matched.forEach((m, i) => {
      const w = i === 0 ? D_SUBLINEAR_WEIGHTS[0]
        : (i === 1 ? D_SUBLINEAR_WEIGHTS[1] : D_SUBLINEAR_WEIGHTS[2]);
      m.weight = w;
      D += m.deficit * w;
    });
    const topVal = matched.length ? matched[0].deficit : -1;
    const topRole = matched.length ? matched[0].role : '';
    return { D, topRole, topVal, matched };
  }

  /**
   * Preferred role label for E when no percentile map is available:
   * largest deck deficit among the candidate's roles (incl. zero), then
   * lexicographically smallest. Plan / Land / Commander are never used for E.
   */
  function pickERole(roles, deficits) {
    const real = (roles || []).filter(t => t !== 'Land' && t !== 'Commander' && t !== 'Plan');
    if (!real.length) return null;
    const ordered = real
      .map(role => ({ role, deficit: Number(deficits?.[role]) || 0 }))
      .sort((a, b) => b.deficit - a.deficit || a.role.localeCompare(b.role));
    return ordered[0].role;
  }

  function resolveEdhrecPercentile(card, role) {
    if (!role) return null;
    const map = card?.edhrecRolePct || card?.edhrecPercentiles || null;
    if (map && typeof map === 'object' && map[role] != null) {
      const p = Number(map[role]);
      return Number.isFinite(p) ? _clamp01(p) : null;
    }
    return null;
  }

  /**
   * Pick the E role + percentile for a candidate.
   * Order: candidate roles by largest deck deficit first (zeros allowed), then
   * name. Use the first role that has a stored percentile. E does not require
   * an active deficit — a filled role can still contribute EDHREC score.
   */
  function pickERoleWithPercentile(card, roles, deficits) {
    const real = (roles || []).filter(t => t !== 'Land' && t !== 'Commander' && t !== 'Plan');
    if (!real.length) return { role: null, p: null };
    const ordered = real
      .map(role => ({ role, deficit: Number(deficits?.[role]) || 0 }))
      .sort((a, b) => b.deficit - a.deficit || a.role.localeCompare(b.role));
    for (const { role } of ordered) {
      const p = resolveEdhrecPercentile(card, role);
      if (p != null) return { role, p };
    }
    return { role: ordered[0].role, p: null };
  }

  function computeETerm(card, roles, deficits) {
    const { role, p } = pickERoleWithPercentile(card, roles, deficits);
    if (!role || p == null) return { E: 0, eRole: role, p: null, pAdjusted: null };
    const usd = cardUsdPrice(card);
    const delta = usd == null ? 0 : priceBandDelta(usd);
    const pAdjusted = _clamp01(p + delta);
    return { E: K_E * pAdjusted, eRole: role, p, pAdjusted };
  }

  function computeBTerm(card, roles, deficits, opts) {
    // Temporary wiring: only gate when caller passes isSpellslinger === true.
    // Repo has no spellslinger archetype detection — callers leave this unset.
    if (opts && opts.isSpellslinger === true) return { B: 0, bReason: 'spellslinger' };
    if (!_isCreatureType(card)) return { B: 0, bReason: 'not-creature' };
    const real = (roles || []).filter(t => t !== 'Land' && t !== 'Commander');
    const fills = real.some(t => (deficits?.[t] || 0) > 0);
    if (!fills) return { B: 0, bReason: 'no-deficit' };
    return { B: K_B, bReason: 'creature-utility' };
  }

  function computeVTerm(roles) {
    const real = (roles || []).filter(t => t !== 'Land' && t !== 'Commander');
    const extra = Math.max(0, real.length - 1);
    if (extra <= 0) return 0;
    // First extra tag full V_PER_EXTRA_TAG; 2nd+ dampened ~50%.
    let V = 0;
    for (let i = 0; i < extra; i++) {
      V += V_PER_EXTRA_TAG * (i === 0 ? 1 : V_SECOND_PLUS_DAMPEN);
    }
    return V;
  }

  /**
   * Score one Adds candidate.
   * @param {object} card
   * @param {string[]} roles
   * @param {object} ctx — deficits, curveDeficit, tribes helpers optional
   * @param {object} [extras] — gate, tribal, tribe, theme, themeBonus, isSpellslinger
   */
  function scoreAddCandidateTerms(card, roles, ctx, extras) {
    const deficits = ctx?.deficits || {};
    const { D, topRole, topVal, matched } = computeDeficitTermD(roles, deficits);
    const real = (roles || []).filter(t => t !== 'Land' && t !== 'Commander');

    let M = 1;
    let gate = extras?.gate || { factor: 1 };
    if (D > 0 && gate && Number.isFinite(gate.factor)) M = gate.factor;

    const cmc = scoringCmcForAdds(card);
    const bucket = Math.min(Math.floor(cmc), 7);
    const curveRaw = Math.min((ctx?.curveDeficit?.[bucket] || 0) * 5, 1.5);
    const eff = usesEfficiencyMode(real, card);
    let C_eff = 0;
    let L = 0;
    if (eff) {
      C_eff = 0;
      L = K_L * Math.max(0, CMC_REF - cmc);
    } else {
      C_eff = curveRaw;
      L = 0;
    }

    const eTerm = computeETerm(card, real, deficits);
    const bTerm = computeBTerm(card, real, deficits, extras);
    const mana = card?.mana || card?.mana_cost || '';
    const pipScore = pipRestrictivenessScore(mana);
    const P = K_P * pipScore;
    const V = computeVTerm(real);
    const T = Number(extras?.tribal) || 0;
    const K = Number(extras?.themeBonus) || 0;

    const score = (D * M) + C_eff + L + eTerm.E + bTerm.B - P + V + T + K;

    const terms = {
      D, M, C_eff, L, E: eTerm.E, B: bTerm.B, P, V, T, K,
      eRole: eTerm.eRole, p: eTerm.p, pAdjusted: eTerm.pAdjusted,
      bReason: bTerm.bReason, efficiencyMode: eff, cmc, pipScore, matched,
    };

    return {
      score,
      topRole,
      topVal,
      bucket,
      roles: real,
      gate,
      tribal: T,
      tribe: extras?.tribe || '',
      theme: extras?.theme || null,
      // Back-compat fields used by "why" UI
      roleFit: D * M,
      curveBonus: C_eff,
      versatility: V,
      themeBonus: K,
      // New term surfaces
      terms,
      L,
      E: eTerm.E,
      B: bTerm.B,
      P,
      C_eff,
    };
  }

  function logAddScoreTerms(cardName, result, enabled) {
    if (!enabled || !result?.terms) return;
    const t = result.terms;
    // eslint-disable-next-line no-console
    console.log('[adds-score]', cardName, {
      score: result.score,
      D: t.D, M: t.M, C_eff: t.C_eff, L: t.L, E: t.E, B: t.B, P: t.P, V: t.V, T: t.T, K: t.K,
      eRole: t.eRole, efficiencyMode: t.efficiencyMode, cmc: t.cmc,
    });
  }

  function isAddsScoreDebugEnabled() {
    try {
      if (typeof window !== 'undefined' && window.__ADDS_SCORE_DEBUG) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('mtg_adds_score_debug') === '1') return true;
    } catch (_) { /* SSR / privacy mode */ }
    return false;
  }

  /** Scale a raw Adds score onto 0–10 for the UI. Ranking still uses the raw score. */
  function addDisplayScore(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(ADD_SCORE_DISPLAY_MAX, (n / ADD_SCORE_RAW_CEILING) * ADD_SCORE_DISPLAY_MAX);
  }

  function formatAddDisplayScore(raw) {
    return addDisplayScore(raw).toFixed(1);
  }

  return {
    D_SUBLINEAR_WEIGHTS,
    CMC_REF,
    K_L,
    K_E,
    K_B,
    K_P,
    ADD_SCORE_RAW_CEILING,
    ADD_SCORE_DISPLAY_MAX,
    E_PRICE_BAND_DELTAS,
    ADD_ROLE_SEMANTIC_MAP,
    EFFICIENCY_MODE_PROJECT_TAGS,
    EFFICIENCY_MODE_EXCLUSIONS,
    scoringCmcForAdds,
    pipRestrictivenessScore,
    priceBandDelta,
    cardUsdPrice,
    usesEfficiencyMode,
    computeDeficitTermD,
    pickERole,
    pickERoleWithPercentile,
    resolveEdhrecPercentile,
    scoreAddCandidateTerms,
    logAddScoreTerms,
    isAddsScoreDebugEnabled,
    addDisplayScore,
    formatAddDisplayScore,
  };
});
