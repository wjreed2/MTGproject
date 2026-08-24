/**
 * Foundation → Adds / Cuts ranking and readout HTML.
 * Why-lines are one short deterministic sentence (F5-Q7).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  const CAP_ORDER = ['manaAccess', 'resources', 'interaction', 'keepGoing', 'closeGame'];

  function cfg() {
    return (root && root.FOUNDATION_CONFIG) || {};
  }

  function labels() {
    return (root && root.FOUNDATION_CAPABILITY_LABELS) || {};
  }

  function cardTags(card) {
    const raw = (card && (card.roleTags || card.tags || card.s && card.s.roles)) || [];
    return Array.isArray(raw) ? raw : [];
  }

  function mechanismsFor(card) {
    if (root && typeof root.cardFoundationMechanisms === 'function') {
      return root.cardFoundationMechanisms(card, cfg());
    }
    return [];
  }

  function fillsCapability(card, capId) {
    return mechanismsFor(card).some(m => (m.capabilities || []).includes(capId));
  }

  function openHoles(evaluation) {
    const holes = [];
    if (!evaluation || !evaluation.capabilities) return holes;
    for (const id of CAP_ORDER) {
      if (root && typeof root.foundationCapabilityHole === 'function' && root.foundationCapabilityHole(evaluation, id)) {
        holes.push(id);
      }
    }
    return holes;
  }

  function foundationAddWhy(card, evaluation) {
    const holes = openHoles(evaluation);
    const labs = labels();
    for (const id of holes) {
      if (fillsCapability(card, id)) {
        if (id === 'interaction') {
          return 'Adds interaction — threat-type coverage is short of what this plan needs.';
        }
        if (id === 'resources') {
          return 'Adds resource generation — any resource mechanism can fill this target.';
        }
        if (id === 'keepGoing') {
          return 'Helps the deck continue after disruption (protection, recursion, or another path).';
        }
        if (id === 'manaAccess') {
          return 'Helps access the mana needed to execute the plan (not a land-count quota).';
        }
        if (id === 'closeGame') {
          return 'Supports your declared win condition — does not replace it.';
        }
        return `Helps ${labs[id] || id}.`;
      }
    }
    return '';
  }

  function rankAddPick(pick, evaluation) {
    const c = cfg();
    const card = pick.card || pick;
    const holes = openHoles(evaluation);
    let boost = 0;
    const filled = [];
    for (const id of holes) {
      if (fillsCapability(card, id)) {
        boost += (c.addRankWeight || 1.15);
        filled.push(id);
      }
    }
    const tutorPref = evaluation && evaluation.needs && evaluation.needs.tutorPreference;
    if (tutorPref === 'never' && cardTags(card).includes('Tutor')) boost -= 3;
    if (tutorPref === 'rather_not' && cardTags(card).includes('Tutor')) boost -= 0.8;
    const why = foundationAddWhy(card, evaluation);
    return {
      ...pick,
      foundationBoost: boost,
      foundationFilled: filled,
      foundationWhy: why,
      s: pick.s ? { ...pick.s, score: (Number(pick.s.score) || 0) + boost, foundationWhy: why } : pick.s,
    };
  }

  function attachFoundationSwapNotes(addPicks, cutCards, evaluation) {
    const holes = openHoles(evaluation);
    const poorFits = (cutCards || []).filter(c => {
      const cls = c._foundationCut || classifyFoundationCut(c, evaluation, {}, {});
      return cls.swap && holes.some(id => fillsCapability(c, id));
    });
    return (addPicks || []).map(pick => {
      const card = pick.card || pick;
      const match = poorFits.find(cut => holes.some(id => fillsCapability(cut, id) && fillsCapability(card, id)));
      if (!match) return pick;
      const why = `Replaces ${match.name} as a better fit for the same Foundation job.`;
      const prev = (pick.s && pick.s.foundationWhy) || '';
      return {
        ...pick,
        foundationSwapFor: match.name,
        s: pick.s ? { ...pick.s, foundationWhy: prev ? `${why} ${prev}` : why } : pick.s,
      };
    });
  }

  function rankAddPicks(picks, evaluation) {
    return (picks || []).map(p => rankAddPick(p, evaluation))
      .sort((a, b) => (Number(b.s && b.s.score) || 0) - (Number(a.s && a.s.score) || 0));
  }

  /**
   * Classify a cut candidate.
   * surplus → cut, no swap
   * poor_fit + hole → swap required
   * hole-filler at/under target → do not cut unless swap attached
   */
  function classifyFoundationCut(card, evaluation, roleCount, thresholds) {
    const tags = cardTags(card);
    let surplus = false;
    for (const tag of tags) {
      const thr = thresholds && thresholds[tag];
      if (thr == null) continue;
      if ((roleCount && roleCount[tag] || 0) > thr) surplus = true;
    }
    const holes = openHoles(evaluation);
    const fillsHole = holes.some(id => fillsCapability(card, id));
    if (surplus && !fillsHole) {
      return { action: 'cut', swap: false, why: 'Surplus coverage — cut does not need a swap.' };
    }
    if (fillsHole) {
      return {
        action: 'keep_or_swap',
        swap: true,
        why: 'Fills an open Foundation need — do not cut unless a named replacement is attached.',
        holes,
      };
    }
    return { action: 'cut', swap: false, why: 'Poor fit for the plan and not holding up a Foundation hole.' };
  }

  function applyFoundationCuts(candidates, evaluation, roleCount, thresholds) {
    const penalty = (cfg().cutHolePenalty != null) ? cfg().cutHolePenalty : 4;
    const boost = (cfg().surplusCutBoost != null) ? cfg().surplusCutBoost : 1.4;
    return (candidates || []).map(card => {
      const cls = classifyFoundationCut(card, evaluation, roleCount, thresholds);
      let score = Number(card._cutScore) || 0;
      if (cls.action === 'keep_or_swap') score -= penalty;
      if (cls.action === 'cut' && !cls.swap) score += (cls.why.indexOf('Surplus') === 0 ? boost : 0.3);
      return Object.assign({}, card, {
        _cutScore: score,
        _foundationCut: cls,
        _cutReason: cls.why + (card._cutReason ? ` ${card._cutReason}` : ''),
      });
    }).sort((a, b) => (b._cutScore || 0) - (a._cutScore || 0));
  }

  function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
    ));
  }

  function statusIcon(status) {
    const wrap = (inner) =>
      `<svg class="foundation-readout-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:11px;height:11px;vertical-align:-1px;flex-shrink:0">${inner}</svg>`;
    if (status === 'strong') {
      return wrap('<path d="M3.5 8.5l3 3 6-6"/>');
    }
    if (status === 'adequate') {
      return wrap('<circle cx="8" cy="8" r="2.2"/>');
    }
    return wrap('<path d="M8 3.2l5.5 9.4H2.5z"/><line x1="8" y1="7" x2="8" y2="10"/><circle cx="8" cy="12.1" r="0.55" fill="currentColor" stroke="none"/>');
  }

  function compactFoundationReadoutHtml(evaluation, escapeHtml) {
    const esc = escapeHtml || htmlEscape;
    if (!evaluation || !evaluation.capabilities) return '';
    const labs = {
      manaAccess: 'Mana access',
      resources: 'Resources',
      interaction: 'Interaction',
      keepGoing: 'Keep Going',
      closeGame: 'Close the game',
    };
    const bits = CAP_ORDER.map(id => {
      const cap = evaluation.capabilities[id];
      if (!cap) return '';
      return `<span style="display:inline-flex;align-items:center;gap:.28rem;margin-right:.7rem;white-space:nowrap">${statusIcon(cap.status)} ${esc(labs[id])}</span>`;
    }).filter(Boolean);
    const n = evaluation.overall && evaluation.overall.belowProposalCount || 0;
    const warn = (evaluation.vulnerabilities || []).some(v => v.kind === 'user_target_below_proposal')
      ? ' User target below proposal — Adds stop at your number.'
      : '';
    return `<div class="foundation-readout foundation-readout--compact" data-foundation-readout="compact" style="padding:.5rem .85rem;font-size:.72rem;color:var(--text2);border-bottom:1px solid var(--border)">
      <div style="font-weight:600;margin-bottom:.2rem">Foundation</div>
      <div>${bits.join('')}</div>
      <div style="color:var(--text3);margin-top:.2rem">${n} ${n === 1 ? 'capability' : 'capabilities'} below proposal.${esc(warn)}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="padding:0;font-size:.7rem;margin-top:.15rem" onclick="toggleFoundationReadoutExpand(this)">Expand</button>
      <div class="foundation-readout--expand" hidden>${expandFoundationReadoutHtml(evaluation, escapeHtml)}</div>
    </div>`;
  }

  function expandFoundationReadoutHtml(evaluation, escapeHtml) {
    const esc = escapeHtml || htmlEscape;
    if (!evaluation) return '';
    const labs = labels();
    const rows = CAP_ORDER.map(id => {
      const cap = evaluation.capabilities[id];
      if (!cap) return '';
      const user = id === 'resources' ? cap.userTarget : null;
      const prop = id === 'resources' ? cap.proposedTarget : null;
      const cov = cap.coverage != null ? cap.coverage.toFixed(1) : (cap.overall != null ? `${Math.round(cap.overall * 100)}%` : '—');
      return `<div style="margin:.35rem 0"><strong>${esc(labs[id] || id)}</strong> · ${esc(cap.status)}
        ${prop != null ? ` · proposal ${prop}` : ''}
        ${user != null ? ` · you set ${user}` : ''}
        · coverage ${esc(cov)}<div style="color:var(--text3)">${esc(cap.explanation || '')}</div></div>`;
    }).join('');
    const vulns = (evaluation.vulnerabilities || []).map(v =>
      `<div style="display:flex;align-items:flex-start;gap:.35rem">${statusIcon('weak')}<span>${esc(v.text)}</span></div>`
    ).join('');
    const synth = evaluation.overall && evaluation.overall.synthesis ? esc(evaluation.overall.synthesis) : '';
    return `<div class="foundation-readout-full" style="margin-top:.4rem">
      <div style="margin-bottom:.35rem">${synth}</div>
      ${rows}
      <div style="margin-top:.4rem;color:var(--text3)">Mana Base · Strategy · Payoffs remain separate categories.</div>
      ${vulns}
    </div>`;
  }

  function toggleFoundationReadoutExpand(btn) {
    const wrap = btn && btn.parentElement && btn.parentElement.querySelector('.foundation-readout--expand');
    if (!wrap) return;
    const hidden = wrap.hasAttribute('hidden');
    wrap.toggleAttribute('hidden', !hidden);
    btn.textContent = hidden ? 'Collapse' : 'Expand';
  }

  return {
    rankFoundationAddPicks: rankAddPicks,
    attachFoundationSwapNotes,
    classifyFoundationCut,
    applyFoundationCuts,
    compactFoundationReadoutHtml,
    expandFoundationReadoutHtml,
    toggleFoundationReadoutExpand,
    foundationAddWhy,
    openFoundationHoles: openHoles,
  };
});
