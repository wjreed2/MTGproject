/**
 * Commander plan extensions (Ready Prompts 29–31).
 * Deterministic helpers for key cards → roles, cast-turn L* / R*, Protection.
 * Consumed by Classic + Hybrid (enriches deck.plan; does not replace Hybrid mode).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  const STAPLE_ROLES = Object.freeze(['Ramp', 'Card Draw', 'Removal']);
  const PROTECTION_IMPORTANCE = Object.freeze({
    'not_important': 0,
    low: 3,
    med: 6,
    high: 10,
  });
  const PROTECTION_TYPE_OPTIONS = Object.freeze([
    'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle',
  ]);

  /** CardIR role → project label (best-effort). */
  const IR_ROLE_TO_PROJECT = Object.freeze({
    ramp: 'Ramp', mana_rock: 'Ramp', mana_dork: 'Ramp',
    card_draw: 'Card Draw', wheel: 'Wheel',
    spot_removal: 'Removal', burn: 'Burn',
    board_wipe: 'Board Wipe',
    tutor: 'Tutor',
    counterspell: 'Counterspell',
    protection: 'Protection',
    recursion: 'Recursion', reanimator: 'Reanimate',
    sac_outlet: 'Sac Outlet',
    token_maker: 'Token Maker',
    anthem: 'Anthem',
    evasion: 'Evasion',
    stax: 'Stax',
    lifegain: 'Lifegain',
    blink: 'Blink',
    copy: 'Copy',
    combat_trick: 'Combat Trick',
    extra_combat: 'Extra Combat',
    mill: 'Mill',
    discard_outlet: 'Discard',
  });

  /** Axes that suggest feeder / payoff project roles. */
  const AXIS_TO_PROJECT = Object.freeze({
    'creatures_dying': 'Sac Outlet',
    'sac.outlet_free': 'Sac Outlet',
    'sac.outlet_cost': 'Sac Outlet',
    'trigger.death_payoff': 'Death Trigger',
    'token.creature': 'Token Maker',
    'token.creature_wide': 'Token Maker',
    'mana.ramp_land': 'Ramp',
    'mana.rock': 'Ramp',
    'mana.dork': 'Ramp',
    'mana.ritual': 'Ramp',
    'card_advantage.draw': 'Card Draw',
    'card_advantage.draw_engine': 'Card Draw',
    'protection.single': 'Protection',
    'protection.mass': 'Protection',
    'removal.spot': 'Removal',
    'removal.wipe': 'Board Wipe',
    'control.counter': 'Counterspell',
    'tutor.any': 'Tutor',
    'tutor.creature': 'Tutor',
    'landfall.enabler': 'Landfall',
    'landfall.payoff': 'Landfall',
    'lifegain.source': 'Lifegain',
    'drain.incremental': 'Drain',
    'blink.engine': 'Blink',
    'evasion.grant': 'Evasion',
    'anthem.global': 'Anthem',
    'pump.single': 'Pump',
  });

  function emptyCommanderPlanFields() {
    return {
      /** @type {{name:string, oracleId?:string}[]} */
      keyCards: [],
      /**
       * Confirmed roles-to-fill.
       * @type {{label:string, target:number, checked:boolean, source?:string}[]}
       */
      confirmedRoles: [],
      rolesDerivedAt: null,
      rolesStale: false,
      /** Target commander cast turn (integer). null → default to commander CMC */
      targetCastTurn: null,
      /** Consistency % in [50,99]; default 85 */
      consistencyPct: 85,
      /** Solved / editable land ideal */
      landIdeal: null,
      /** Solved early-ramp ideal (CMC ≤ T−1) */
      earlyRampIdeal: null,
      /** not_important | low | med | high */
      protectionImportance: null,
      /** @type {string[]} permanent types (matching hints) */
      protectionTypes: [],
      stapleWarningAck: false,
    };
  }

  function normalizeCommanderPlanFields(raw) {
    const base = emptyCommanderPlanFields();
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base };
    out.keyCards = Array.isArray(raw.keyCards)
      ? raw.keyCards.map(k => ({
        name: String(k?.name || '').trim(),
        oracleId: k?.oracleId ? String(k.oracleId) : undefined,
      })).filter(k => k.name)
      : [];
    out.confirmedRoles = Array.isArray(raw.confirmedRoles)
      ? raw.confirmedRoles.map(r => ({
        label: String(r?.label || '').trim(),
        target: Number.isFinite(Number(r?.target)) ? Math.max(0, Math.round(Number(r.target))) : 10,
        checked: r?.checked !== false,
        source: r?.source ? String(r.source) : 'user',
      })).filter(r => r.label)
      : [];
    out.rolesDerivedAt = raw.rolesDerivedAt ?? null;
    out.rolesStale = !!raw.rolesStale;
    const t = raw.targetCastTurn;
    out.targetCastTurn = (t == null || t === '') ? null : Math.max(1, Math.min(12, Math.round(Number(t)) || 1));
    const pct = Number(raw.consistencyPct);
    out.consistencyPct = Number.isFinite(pct) ? Math.max(50, Math.min(99, Math.round(pct))) : 85;
    out.landIdeal = raw.landIdeal == null ? null : Math.max(0, Math.round(Number(raw.landIdeal)) || 0);
    out.earlyRampIdeal = raw.earlyRampIdeal == null ? null : Math.max(0, Math.round(Number(raw.earlyRampIdeal)) || 0);
    const imp = raw.protectionImportance;
    out.protectionImportance = (imp && Object.prototype.hasOwnProperty.call(PROTECTION_IMPORTANCE, imp))
      ? imp : (imp === 'not important' ? 'not_important' : null);
    out.protectionTypes = Array.isArray(raw.protectionTypes)
      ? [...new Set(raw.protectionTypes.map(x => String(x || '')).filter(Boolean))]
      : [];
    out.stapleWarningAck = !!raw.stapleWarningAck;
    return out;
  }

  function projectLabelsFromCardIR(ir) {
    const labels = new Set();
    if (!ir || typeof ir !== 'object') return labels;
    for (const role of (ir.roles || [])) {
      const lab = IR_ROLE_TO_PROJECT[String(role)];
      if (lab) labels.add(lab);
    }
    for (const entry of (ir.provides || [])) {
      const axis = entry?.axis || entry;
      const lab = AXIS_TO_PROJECT[String(axis)];
      if (lab) labels.add(lab);
    }
    for (const entry of (ir.needs || [])) {
      const axis = entry?.axis || entry;
      const lab = AXIS_TO_PROJECT[String(axis)];
      if (lab) labels.add(lab);
    }
    return labels;
  }

  function projectLabelsFromTags(tags) {
    const labels = new Set();
    const list = Array.isArray(tags) ? tags : [];
    for (const t of list) {
      const s = String(t || '').trim();
      if (!s) continue;
      if (root && typeof root.isProjectRoleLabel === 'function') {
        if (root.isProjectRoleLabel(s)) labels.add(s);
      } else {
        labels.add(s);
      }
    }
    return labels;
  }

  /**
   * Derive suggested roles from key cards (tags + optional CardIR).
   * @param {{name:string, roleTags?:string[], ir?:object}[]} keyCardDetails
   */
  function deriveRolesFromKeyCards(keyCardDetails) {
    const labels = new Set();
    for (const card of (keyCardDetails || [])) {
      for (const lab of projectLabelsFromTags(card.roleTags || card.tags || [])) labels.add(lab);
      for (const lab of projectLabelsFromCardIR(card.ir)) labels.add(lab);
    }
    return [...labels].sort((a, b) => a.localeCompare(b));
  }

  function buildConfirmedRolesFromDerive(derivedLabels, prevRoles) {
    const prevMap = new Map((prevRoles || []).map(r => [r.label, r]));
    const out = [];
    const seen = new Set();
    for (const label of STAPLE_ROLES) {
      const prev = prevMap.get(label);
      out.push({
        label,
        target: prev?.target ?? 10,
        checked: prev ? prev.checked !== false : true,
        source: 'staple',
      });
      seen.add(label);
    }
    for (const label of (derivedLabels || [])) {
      if (seen.has(label)) continue;
      const prev = prevMap.get(label);
      out.push({
        label,
        target: prev?.target ?? 10,
        checked: prev ? prev.checked !== false : true,
        source: 'derived',
      });
      seen.add(label);
    }
    for (const r of (prevRoles || [])) {
      if (seen.has(r.label)) continue;
      if (r.source === 'user' || r.checked) {
        out.push({
          label: r.label,
          target: r.target ?? 10,
          checked: r.checked !== false,
          source: r.source || 'user',
        });
        seen.add(r.label);
      }
    }
    return out;
  }

  function uncheckedStaples(confirmedRoles) {
    const by = new Map((confirmedRoles || []).map(r => [r.label, r]));
    return STAPLE_ROLES.filter(lab => {
      const r = by.get(lab);
      return !r || r.checked === false;
    });
  }

  function activeConfirmedRoles(confirmedRoles) {
    return (confirmedRoles || []).filter(r => r && r.checked !== false && r.label);
  }

  /**
   * CP-Q31 Modified A: only confirmed roles get ideals (plus Plan kept for structure).
   * Protection ideal overridden by Theme C importance when set.
   */
  function thresholdsFromConfirmedPlan(plan, baseThresholds) {
    const p = plan || {};
    const base = { ...(baseThresholds || {}) };
    const active = activeConfirmedRoles(p.confirmedRoles);
    if (!active.length && !p.protectionImportance) return base;

    const next = { Plan: base.Plan != null ? base.Plan : 30 };
    for (const r of active) {
      next[r.label] = Number.isFinite(Number(r.target)) ? Math.max(0, Math.round(Number(r.target))) : 10;
    }
    if (p.protectionImportance && Object.prototype.hasOwnProperty.call(PROTECTION_IMPORTANCE, p.protectionImportance)) {
      const ideal = PROTECTION_IMPORTANCE[p.protectionImportance];
      if (ideal > 0 || p.protectionImportance === 'not_important') {
        next.Protection = ideal;
      }
      // High auto-confirm: ensure Protection present when high (caller also checks role list)
      if (p.protectionImportance === 'high' && next.Protection == null) next.Protection = 10;
    }
    return next;
  }

  function ensureProtectionRoleOnHigh(confirmedRoles, importance) {
    const roles = Array.isArray(confirmedRoles) ? confirmedRoles.map(r => ({ ...r })) : [];
    if (importance !== 'high') return roles;
    const existing = roles.find(r => r.label === 'Protection');
    if (existing) {
      existing.checked = true;
      if (!Number.isFinite(Number(existing.target)) || Number(existing.target) < 1) existing.target = 10;
      return roles;
    }
    roles.push({ label: 'Protection', target: 10, checked: true, source: 'protection-high' });
    return roles;
  }

  function defaultProtectionImportanceForStrategy(strategyId) {
    if (strategyId === 'strategy.voltron') return 'high';
    return null;
  }

  function protectionIdeal(importance) {
    if (!importance || !Object.prototype.hasOwnProperty.call(PROTECTION_IMPORTANCE, importance)) return null;
    return PROTECTION_IMPORTANCE[importance];
  }

  /** Hypergeometric P(X >= k) drawing n from N with K successes. */
  function hypergeoAtLeast(N, K, n, k) {
    N = Math.max(0, Math.round(N));
    K = Math.max(0, Math.min(N, Math.round(K)));
    n = Math.max(0, Math.min(N, Math.round(n)));
    k = Math.max(0, Math.round(k));
    if (k === 0) return 1;
    if (n < k || K < k) return 0;
    // Sum pmf via recursive ratio
    let p = 0;
    // Compute C(K,i)*C(N-K,n-i)/C(N,n) for i=k..min(n,K)
    const logFact = (function () {
      const cache = [0];
      return function lf(x) {
        while (cache.length <= x) {
          const i = cache.length;
          cache.push(cache[i - 1] + Math.log(i));
        }
        return cache[x];
      };
    })();
    function logC(a, b) {
      if (b < 0 || b > a) return -Infinity;
      return logFact(a) - logFact(b) - logFact(a - b);
    }
    const logDen = logC(N, n);
    const hi = Math.min(n, K);
    for (let i = k; i <= hi; i++) {
      const logP = logC(K, i) + logC(N - K, n - i) - logDen;
      p += Math.exp(logP);
    }
    return Math.min(1, Math.max(0, p));
  }

  /**
   * Free-mulligan style: keep if hand has >=1 land; else use second hand.
   * Approximate: P_keep = P(lands>=1 in 7); effective = P_keep*P_cast(hand ok) + (1-P_keep)*P_cast(mull)
   * Simplified: boost sample by treating consistency against best-of-two openers for land presence.
   * Practical v1: require P(sources >= need in n) >= pct, with K = L+R, need = T.
   */
  function castConsistency(N, L, R, T, afterMulligan) {
    const n = 7 + T;
    const K = Math.min(N, L + R);
    const need = Math.max(1, T);
    let p = hypergeoAtLeast(N, K, n, need);
    if (afterMulligan) {
      // Mild uplift: chance of shipping a 0-land opener then recovering
      const pLandOpen = hypergeoAtLeast(N, L, 7, 1);
      const p2 = hypergeoAtLeast(N, K, n, need);
      p = pLandOpen * p + (1 - pLandOpen) * p2;
    }
    return p;
  }

  function karstenLandIdeal(avgMV, R_est, T) {
    let L = Math.round(31.42 + 3.13 * Number(avgMV || 3) - 0.28 * Number(R_est || 8));
    const t = Number(T);
    const mv = Number(avgMV || 3);
    if (Number.isFinite(t) && Number.isFinite(mv) && t < mv) L += Math.round(mv - t);
    return Math.max(35, Math.min(40, L));
  }

  /**
   * CP-Q21: fix L* then solve R* for cast-on-T @ consistency%.
   */
  function solveLandAndEarlyRampIdeals({ avgMV, T, consistencyPct, N = 100, R_est = 8 }) {
    const pct = (Number(consistencyPct) || 85) / 100;
    const turn = Math.max(1, Math.round(Number(T) || Math.round(avgMV) || 4));
    let L = karstenLandIdeal(avgMV, R_est, turn);
    let R = 0;
    for (let cand = 0; cand <= 18; cand++) {
      if (castConsistency(N, L, cand, turn, true) + 1e-9 >= pct) {
        R = cand;
        break;
      }
      R = cand;
    }
    // Re-seat L once with solved R
    L = karstenLandIdeal(avgMV, R, turn);
    // Re-solve R with final L
    for (let cand = 0; cand <= 18; cand++) {
      if (castConsistency(N, L, cand, turn, true) + 1e-9 >= pct) {
        R = cand;
        break;
      }
      R = cand;
    }
    return { landIdeal: L, earlyRampIdeal: R, targetCastTurn: turn, cardsSeen: 7 + turn };
  }

  function effectiveCastTurn(plan, commanderCmc) {
    const p = plan || {};
    if (p.targetCastTurn != null) return Math.max(1, Math.round(Number(p.targetCastTurn)));
    const cmc = Math.round(Number(commanderCmc) || 0);
    return cmc >= 1 ? cmc : 4;
  }

  function earlyRampCmcCap(T) {
    return Math.max(0, Math.round(Number(T) || 1) - 1);
  }

  /** Soft matching score for protection Adds (CP-Q29 A). */
  function protectionMatchBoost(card, plan) {
    const p = plan || {};
    if (!p.protectionImportance || p.protectionImportance === 'not_important') return 0;
    const oracle = String(card?.oracleText || card?.oracle_text || '').toLowerCase();
    const typeLine = String(card?.type_line || card?.type || '').toLowerCase();
    let boost = 0;
    // Commander-preferring patterns
    if (/hexproof|indestructible|protection from|phase out|ward |shroud/.test(oracle)) boost += 1.5;
    if (/equipped creature|aura|target (permanent|creature) you control|commander/.test(oracle)) boost += 1.0;
    // Type secondary
    for (const typ of (p.protectionTypes || [])) {
      const t = String(typ).toLowerCase();
      if (t && oracle.includes(t.toLowerCase())) boost += 0.35;
      if (t && typeLine.includes(t.toLowerCase())) boost += 0.15;
    }
    return boost;
  }

  /**
   * Does this card count toward Protection have? (CP-Q26b union)
   * Classic tags + optional IR role/axes.
   */
  function cardCountsAsProtection(card) {
    const tags = card?.roleTags || card?.tags || [];
    if (Array.isArray(tags) && tags.includes('Protection')) return true;
    const ir = card?.ir;
    if (!ir) return false;
    if (Array.isArray(ir.roles) && ir.roles.includes('protection')) return true;
    for (const entry of (ir.provides || [])) {
      const axis = entry?.axis || entry;
      if (axis === 'protection.single' || axis === 'protection.mass') return true;
    }
    return false;
  }

  function avgNonLandMv(deck) {
    const cards = (deck?.cards || []).filter(c => {
      if (c.isCommander || (deck.commander && c.name === deck.commander)) return false;
      const tl = String(c.type_line || c.type || '');
      return !/\bLand\b/i.test(tl);
    });
    if (!cards.length) return 3.2;
    let sum = 0;
    let n = 0;
    for (const c of cards) {
      const q = c.qty || 1;
      sum += (Number(c.cmc) || 0) * q;
      n += q;
    }
    return n ? sum / n : 3.2;
  }

  return {
    STAPLE_ROLES,
    PROTECTION_IMPORTANCE,
    PROTECTION_TYPE_OPTIONS,
    IR_ROLE_TO_PROJECT,
    AXIS_TO_PROJECT,
    emptyCommanderPlanFields,
    normalizeCommanderPlanFields,
    projectLabelsFromCardIR,
    projectLabelsFromTags,
    deriveRolesFromKeyCards,
    buildConfirmedRolesFromDerive,
    uncheckedStaples,
    activeConfirmedRoles,
    thresholdsFromConfirmedPlan,
    ensureProtectionRoleOnHigh,
    defaultProtectionImportanceForStrategy,
    protectionIdeal,
    hypergeoAtLeast,
    castConsistency,
    karstenLandIdeal,
    solveLandAndEarlyRampIdeals,
    effectiveCastTurn,
    earlyRampCmcCap,
    protectionMatchBoost,
    cardCountsAsProtection,
    avgNonLandMv,
  };
});
