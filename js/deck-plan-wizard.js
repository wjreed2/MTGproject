/**
 * Deck plan wizard UI (Entry 13 v1).
 * Same question sequence for all deck sizes. Path A/B only chooses the ranker
 * (commander vs deck); inference pre-selects suggestions and never skips questions.
 */
(function () {
  'use strict';

  let _planWizard = null; // { deckId, draft, steps, stepIdx, path, ranked, showMore }

  function _pwDeck() {
    if (typeof getActiveDeck !== 'function' || !_planWizard) return null;
    const d = getActiveDeck();
    if (!d || d.id !== _planWizard.deckId) return null;
    return d;
  }

  function _pwCommanderCard(deck) {
    if (!deck) return null;
    if (typeof _resolveCommanderContextForEdhrec === 'function') {
      const ctx = _resolveCommanderContextForEdhrec(deck);
      if (ctx?.primary) return ctx.primary;
    }
    return (deck.cards || []).find(c => c.isCommander || (deck.commander && c.name === deck.commander)) || null;
  }

  function _pwMinConfidence() {
    return typeof PLAN_INFERENCE_CONFIDENCE_MIN === 'number' ? PLAN_INFERENCE_CONFIDENCE_MIN : 0.35;
  }

  /** Top ranked option when trustworthy; otherwise null (no auto-pick). */
  function _pwSuggested(rankedList) {
    const top = rankedList && rankedList[0];
    if (!top || top.fallback) return null;
    if ((top.score || 0) < _pwMinConfidence()) return null;
    return top;
  }

  function openDeckPlanWizard() {
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (!deck) {
      if (typeof showNotif === 'function') showNotif('Open a deck first');
      return;
    }
    if (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared && typeof canEditActiveDeck === 'function' && !canEditActiveDeck()) {
      if (typeof showNotif === 'function') showNotif('View-only shared deck');
      return;
    }
    const count = typeof deckPlanCardCount === 'function' ? deckPlanCardCount(deck) : (deck.cards || []).reduce((s, c) => s + (c.qty || 1), 0);
    const path = count >= (typeof PLAN_WIZARD_ANALYZE_THRESHOLD === 'number' ? PLAN_WIZARD_ANALYZE_THRESHOLD : 80) ? 'B' : 'A';
    const draft = typeof getDeckPlan === 'function' ? getDeckPlan(deck) : (typeof emptyPlan === 'function' ? emptyPlan() : {});
    const cmd = _pwCommanderCard(deck);
    const ranked = {
      strategies: path === 'B'
        ? (typeof rankStrategiesForDeck === 'function' ? rankStrategiesForDeck(deck) : [])
        : (typeof rankStrategiesForCommander === 'function' ? rankStrategiesForCommander(cmd) : []),
      wincons: path === 'B'
        ? (typeof rankWinConditionsForDeck === 'function' ? rankWinConditionsForDeck(deck) : [])
        : (typeof rankWinConditionsForCommander === 'function' ? rankWinConditionsForCommander(cmd) : []),
    };
    if (typeof logDeckPlan === 'function') logDeckPlan('open-wizard', { path, count, ranked });

    // Pre-select suggestions only when fields are still empty (never skip questions).
    const nextDraft = JSON.parse(JSON.stringify(draft));
    const sugW = _pwSuggested(ranked.wincons);
    const sugS = _pwSuggested(ranked.strategies);
    if (!nextDraft.winConditionId && sugW) {
      nextDraft.winConditionId = sugW.id;
      nextDraft.fieldSources = nextDraft.fieldSources || {};
      if (!nextDraft.fieldSources.winConditionId) nextDraft.fieldSources.winConditionId = 'formal';
    }
    if (!nextDraft.primaryStrategyId && sugS) {
      nextDraft.primaryStrategyId = sugS.id;
      nextDraft.fieldSources = nextDraft.fieldSources || {};
      if (!nextDraft.fieldSources.primaryStrategyId) nextDraft.fieldSources.primaryStrategyId = 'formal';
    }

    _planWizard = {
      deckId: deck.id,
      draft: nextDraft,
      path,
      ranked,
      showMore: { wincon: false, strategy: false, secondary: false, subtags: false },
      stepIdx: 0,
      steps: null,
      typeSuggest: null,
      _typeFetchStarted: false,
    };
    _planWizard.steps = _pwBuildSteps(deck);
    document.getElementById('deckPlanWizardModal')?.classList.add('open');
    _pwRender();
  }

  function closeDeckPlanWizard() {
    document.getElementById('deckPlanWizardModal')?.classList.remove('open');
    _planWizard = null;
  }

  /** Same core sequence for every deck; commander only if missing. Plan envelope steps after themes. */
  function _pwBuildSteps(deck) {
    const steps = [];
    if (!deck.commander) steps.push('commander');
    steps.push('wincon', 'strategy', 'secondary', 'subtags');
    // Tribal creature-type picker when primary or secondary is tribal.
    const draft = _planWizard?.draft;
    const ids = [draft?.primaryStrategyId, draft?.secondaryStrategyId].filter(Boolean);
    if (ids.includes('strategy.tribal')) steps.push('tribaltypes');
    steps.push('budget');
    return steps;
  }

  function _pwRebuildStepsKeepIndex() {
    if (!_planWizard) return;
    const deck = _pwDeck();
    if (!deck) return;
    const cur = _planWizard.steps[_planWizard.stepIdx];
    _planWizard.steps = _pwBuildSteps(deck);
    const idx = _planWizard.steps.indexOf(cur);
    _planWizard.stepIdx = idx >= 0 ? idx : Math.min(_planWizard.stepIdx, _planWizard.steps.length - 1);
  }

  function _pwPersist() {
    const deck = _pwDeck();
    if (!deck || !_planWizard) return false;
    _planWizard.draft.planConfirmed = true;
    deck.plan = typeof normalizeDeckPlan === 'function'
      ? normalizeDeckPlan(_planWizard.draft)
      : _planWizard.draft;
    if (typeof logDeckPlan === 'function') logDeckPlan('persist', deck.plan);
    if (typeof saveActiveDeck === 'function') saveActiveDeck(deck);
    else if (typeof save === 'function') save('decks');
    // Invalidate any in-flight Adds render that snapped an empty plan, then refresh.
    if (typeof _addSuggestToken === 'number') _addSuggestToken++;
    if (typeof _renderAddSuggestions === 'function') _renderAddSuggestions(deck);
    return true;
  }

  function _pwOptionButtons(list, selectedId, onPickAttr) {
    return list.map(o => {
      const sel = o.id === selectedId ? ' plan-opt--selected' : '';
      return `<button type="button" class="plan-opt${sel}" data-plan-pick="${o.id}" ${onPickAttr}>${escapeHtml(o.label || o.id)}</button>`;
    }).join('');
  }

  function _pwSuggestHint(sug) {
    if (!sug) return '';
    const pct = Math.round((sug.score || 0) * 100);
    return `<p class="deck-tab-muted" style="margin-bottom:.65rem">Best guess: <strong>${escapeHtml(sug.label)}</strong>${pct ? ` (~${pct}% confidence)` : ''} - this is only a suggestion; change it if wrong.</p>`;
  }

  function _pwRender() {
    const body = document.getElementById('deckPlanWizardBody');
    const title = document.getElementById('deckPlanWizardTitle');
    const backBtn = document.getElementById('deckPlanWizardBackBtn');
    const primaryBtn = document.getElementById('deckPlanWizardPrimaryBtn');
    if (!body || !_planWizard) return;
    const step = _planWizard.steps[_planWizard.stepIdx];
    const draft = _planWizard.draft;
    const showAll = (kind) => _planWizard.showMore[kind];

    if (backBtn) backBtn.style.display = _planWizard.stepIdx > 0 ? '' : 'none';

    const skipBudgetBtn = document.getElementById('deckPlanWizardSkipBudgetBtn');
    if (skipBudgetBtn) skipBudgetBtn.style.display = step === 'budget' ? '' : 'none';

    if (step === 'commander') {
      if (title) title.textContent = 'Deck plan - Commander';
      body.innerHTML = `<p class="deck-tab-muted" style="margin-bottom:.75rem">This deck needs a commander before we can rank strategies.</p>
        <button type="button" class="btn btn-primary" id="planWizardPickCommanderBtn">Choose commander</button>`;
      document.getElementById('planWizardPickCommanderBtn')?.addEventListener('click', () => {
        closeDeckPlanWizard();
        if (typeof openCommanderEdit === 'function') openCommanderEdit();
      });
      if (primaryBtn) { primaryBtn.textContent = 'Skip for now'; primaryBtn.onclick = () => _pwNext(); }
      return;
    }

    if (step === 'wincon') {
      if (title) title.textContent = 'How does this deck usually win?';
      const sug = _pwSuggested(_planWizard.ranked.wincons);
      const top = showAll('wincon')
        ? (typeof PLAN_WINCONS !== 'undefined' ? PLAN_WINCONS : [])
        : _planWizard.ranked.wincons;
      body.innerHTML = `${_pwSuggestHint(sug)}
        <div class="plan-opt-grid">${_pwOptionButtons(top, draft.winConditionId, 'onclick="_pwPickWincon(this.dataset.planPick)"')}</div>
        <button type="button" class="btn btn-ghost btn-sm" style="margin-top:.5rem" onclick="_pwToggleMore('wincon')">${showAll('wincon') ? 'Show top suggestions' : 'Show more options'}</button>`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => {
          if (!draft.winConditionId) { if (typeof showNotif === 'function') showNotif('Pick a win condition or go back'); return; }
          draft.fieldSources = draft.fieldSources || {};
          if (!draft.fieldSources.winConditionId) draft.fieldSources.winConditionId = 'formal';
          _pwNext();
        };
      }
      return;
    }

    if (step === 'strategy') {
      if (title) title.textContent = 'What is the main strategy or theme?';
      const sug = _pwSuggested(_planWizard.ranked.strategies);
      const top = showAll('strategy')
        ? (typeof PLAN_STRATEGIES !== 'undefined' ? PLAN_STRATEGIES : [])
        : _planWizard.ranked.strategies;
      body.innerHTML = `${_pwSuggestHint(sug)}
        <div class="plan-opt-grid">${_pwOptionButtons(top, draft.primaryStrategyId, 'onclick="_pwPickStrategy(this.dataset.planPick)"')}</div>
        <button type="button" class="btn btn-ghost btn-sm" style="margin-top:.5rem" onclick="_pwToggleMore('strategy')">${showAll('strategy') ? 'Show top suggestions' : 'Show more options'}</button>`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => {
          if (!draft.primaryStrategyId) { if (typeof showNotif === 'function') showNotif('Pick a primary strategy'); return; }
          draft.fieldSources = draft.fieldSources || {};
          if (!draft.fieldSources.primaryStrategyId) draft.fieldSources.primaryStrategyId = 'formal';
          _pwNext();
        };
      }
      return;
    }

    if (step === 'secondary') {
      if (title) title.textContent = 'Any secondary theme? (optional)';
      const list = showAll('secondary')
        ? (typeof PLAN_STRATEGIES !== 'undefined' ? PLAN_STRATEGIES : [])
        : _planWizard.ranked.strategies.filter(s => s.id !== draft.primaryStrategyId);
      body.innerHTML = `<p class="deck-tab-muted" style="margin-bottom:.65rem">Optional - pick one or continue to skip.</p>
        <div class="plan-opt-grid">${_pwOptionButtons(list, draft.secondaryStrategyId, 'onclick="_pwPickSecondary(this.dataset.planPick)"')}</div>
        <button type="button" class="btn btn-ghost btn-sm" style="margin-top:.5rem" onclick="_pwToggleMore('secondary')">${showAll('secondary') ? 'Show fewer' : 'Show more options'}</button>`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => {
          draft.fieldSources = draft.fieldSources || {};
          if (draft.secondaryStrategyId) draft.fieldSources.secondaryStrategyId = draft.fieldSources.secondaryStrategyId || 'formal';
          else draft.fieldSources.secondaryStrategyId = 'skipped';
          _pwRebuildStepsKeepIndex();
          _pwNext();
        };
      }
      return;
    }

    if (step === 'subtags') {
      if (title) title.textContent = 'Plan theme pieces (optional)';
      const planThr = typeof PLAN_PARENT_DEFAULT_TARGET === 'number' ? PLAN_PARENT_DEFAULT_TARGET : 30;
      const defaults = typeof mergedPlanSubtagDefaults === 'function'
        ? mergedPlanSubtagDefaults(draft, planThr)
        : [];
      const expand = !!_planWizard.showMore.subtags;
      const shown = expand ? defaults : defaults.slice(0, Math.min(6, defaults.length));
      if (!draft.planSubTags) draft.planSubTags = {};
      for (const row of defaults) {
        if (!draft.planSubTags[row.id]) {
          draft.planSubTags[row.id] = { enabled: true, target: row.target };
        }
      }
      const rowsHtml = shown.length
        ? shown.map(row => {
          const st = draft.planSubTags[row.id] || { enabled: true, target: row.target };
          const checked = st.enabled !== false ? 'checked' : '';
          const tgt = Number.isFinite(Number(st.target)) ? Number(st.target) : row.target;
          return `<label class="plan-subtag-row" style="display:flex;align-items:center;gap:.5rem;margin:.35rem 0;font-size:.8rem">
            <input type="checkbox" ${checked} onchange="_pwToggleSubtag('${row.id}', this.checked)">
            <span style="flex:1">${escapeHtml(row.label)}</span>
            <input type="number" min="0" max="40" value="${tgt}" style="width:3.2rem" onchange="_pwSubtagTarget('${row.id}', this.value)" title="Target count">
          </label>`;
        }).join('')
        : '<p class="deck-tab-muted">No theme defaults for this strategy — continue.</p>';
      body.innerHTML = `<p class="deck-tab-muted" style="margin-bottom:.65rem">These sit inside Plan (cap ${planThr}). Uncheck pieces you do not want counted.</p>
        ${rowsHtml}
        ${defaults.length > 6
          ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:.5rem" onclick="_pwToggleMore('subtags')">${expand ? 'Show fewer' : 'Expand full list'}</button>`
          : ''}`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => { _pwRebuildStepsKeepIndex(); _pwNext(); };
      }
      return;
    }

    if (step === 'tribaltypes') {
      if (title) title.textContent = 'Which creature types matter?';
      const picks = Array.isArray(_planWizard.typeSuggest?.picks) ? _planWizard.typeSuggest.picks : [];
      const source = _planWizard.typeSuggest?.source || 'degraded';
      const selected = new Set((draft.typePicks || []).map(t => String(t).toLowerCase()));
      const topHtml = picks.length
        ? `<div class="plan-opt-grid">${picks.map(p => {
          const on = selected.has(p.id) ? ' plan-opt--selected' : '';
          return `<button type="button" class="plan-opt${on}" onclick="_pwToggleTypePick('${escapeHtml(p.id)}')">${escapeHtml(p.label)} <span class="deck-tab-muted" style="font-size:.65rem">(${p.bodies})</span></button>`;
        }).join('')}</div>
        <p class="deck-tab-muted" style="font-size:.7rem;margin-top:.4rem">Source: ${escapeHtml(source)}</p>`
        : `<p class="deck-tab-muted">No automatic type suggestions (offline or no tribal signal). Type a creature type below, or continue.</p>`;
      body.innerHTML = `${topHtml}
        <label class="plan-budget-label" style="margin-top:.75rem">Add creature type</label>
        <div style="display:flex;gap:.4rem">
          <input type="text" id="planTypePickInput" class="deck-select" style="flex:1" placeholder="e.g. Goblin" list="planTypePickList">
          <button type="button" class="btn btn-outline btn-sm" onclick="_pwAddTypePickFromInput()">Add</button>
        </div>
        <datalist id="planTypePickList">${picks.map(p => `<option value="${escapeHtml(p.label)}">`).join('')}</datalist>
        <p class="deck-tab-muted" style="margin-top:.5rem;font-size:.75rem">Selected: ${(draft.typePicks || []).map(t => escapeHtml(t)).join(', ') || 'none'}</p>`;
      if (!_planWizard._typeFetchStarted) {
        _planWizard._typeFetchStarted = true;
        _pwFetchTypeSuggestions();
      }
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => _pwNext();
      }
      return;
    }

    if (step === 'budget') {
      if (title) title.textContent = 'Budget preferences (optional)';
      const deckTiers = typeof PLAN_DECK_BUDGET_TIERS !== 'undefined' ? PLAN_DECK_BUDGET_TIERS : [];
      const cardTiers = typeof PLAN_CARD_BUDGET_TIERS !== 'undefined' ? PLAN_CARD_BUDGET_TIERS : [];
      body.innerHTML = `
        <label class="plan-budget-label">Rough max deck budget</label>
        <div class="plan-opt-grid plan-opt-grid--compact">${deckTiers.map(t =>
          `<button type="button" class="plan-opt${_pwDeckTierSelected(t) ? ' plan-opt--selected' : ''}" onclick="_pwPickDeckBudget('${t.id}')">${escapeHtml(t.label)}</button>`
        ).join('')}</div>
        <div id="planCustomDeckBudget" style="margin:.4rem 0 ${draft.fieldSources?.roughMaxDeckBudgetUsd === 'custom' ? '' : ';display:none'}">
          <input type="number" min="1" step="1" id="planCustomDeckUsd" class="deck-select" style="width:100%" placeholder="Custom USD" value="${draft.roughMaxDeckBudgetUsd || ''}" onchange="_pwCustomDeckUsd(this.value)">
        </div>
        <label class="plan-budget-label" style="margin-top:.85rem">Rough max per suggested card</label>
        <div class="plan-opt-grid plan-opt-grid--compact">${cardTiers.map(t =>
          `<button type="button" class="plan-opt${_pwCardTierSelected(t) ? ' plan-opt--selected' : ''}" onclick="_pwPickCardBudget('${t.id}')">${escapeHtml(t.label)}</button>`
        ).join('')}</div>
        <div id="planCustomCardBudget" style="margin:.4rem 0 ${draft.fieldSources?.roughMaxPerCardBudgetUsd === 'custom' ? '' : ';display:none'}">
          <input type="number" min="1" step="1" id="planCustomCardUsd" class="deck-select" style="width:100%" placeholder="Custom USD" value="${draft.roughMaxPerCardBudgetUsd || ''}" onchange="_pwCustomCardUsd(this.value)">
        </div>
        <label class="plan-budget-label" style="margin-top:.85rem">OK with a few over-budget "real winners"?</label>
        <div class="plan-opt-grid plan-opt-grid--compact">
          <button type="button" class="plan-opt${draft.allowBudgetBusters === true && draft.fieldSources?.allowBudgetBusters === 'budget.busters.yes' ? ' plan-opt--selected' : ''}" onclick="_pwPickBusters('yes')">Yes</button>
          <button type="button" class="plan-opt${draft.allowBudgetBusters === false && draft.fieldSources?.allowBudgetBusters === 'budget.busters.no' ? ' plan-opt--selected' : ''}" onclick="_pwPickBusters('no')">No</button>
          <button type="button" class="plan-opt${draft.fieldSources?.allowBudgetBusters === 'skipped' ? ' plan-opt--selected' : ''}" onclick="_pwPickBusters('skip')">Skip</button>
        </div>
        <p class="deck-tab-muted" style="margin-top:.75rem;font-size:.75rem">Skip the whole budget step with the button below - Adds ranking stays unchanged.</p>`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Save plan';
        primaryBtn.onclick = () => _pwFinishBudget(false);
      }
      return;
    }
  }

  function _pwDeckTierSelected(t) {
    const d = _planWizard?.draft;
    if (!d) return false;
    if (t.id === 'budget.deck.skip') return d.roughMaxDeckBudgetUsd == null && d.fieldSources?.roughMaxDeckBudgetUsd === 'skipped';
    if (t.id === 'budget.deck.custom') return d.fieldSources?.roughMaxDeckBudgetUsd === 'custom';
    return d.roughMaxDeckBudgetUsd === t.usd && d.fieldSources?.roughMaxDeckBudgetUsd === t.id;
  }
  function _pwCardTierSelected(t) {
    const d = _planWizard?.draft;
    if (!d) return false;
    if (t.id === 'budget.card.skip') return d.roughMaxPerCardBudgetUsd == null && (d.fieldSources?.roughMaxPerCardBudgetUsd === 'skipped' || d.fieldSources?.roughMaxPerCardBudgetUsd == null);
    if (t.id === 'budget.card.custom') return d.fieldSources?.roughMaxPerCardBudgetUsd === 'custom';
    return d.roughMaxPerCardBudgetUsd === t.usd && d.fieldSources?.roughMaxPerCardBudgetUsd === t.id;
  }

  function _pwNext() {
    if (!_planWizard) return;
    if (_planWizard.stepIdx < _planWizard.steps.length - 1) {
      _planWizard.stepIdx++;
      _pwRender();
    } else {
      _pwFinishBudget(true);
    }
  }

  function _pwBack() {
    if (!_planWizard || _planWizard.stepIdx <= 0) return;
    _planWizard.stepIdx--;
    _pwRender();
  }

  function _pwToggleMore(kind) {
    if (!_planWizard) return;
    _planWizard.showMore[kind] = !_planWizard.showMore[kind];
    _pwRender();
  }

  function _pwPickWincon(id) {
    if (!_planWizard) return;
    _planWizard.draft.winConditionId = id;
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    _planWizard.draft.fieldSources.winConditionId = 'formal';
    _pwRender();
  }
  function _pwPickStrategy(id) {
    if (!_planWizard) return;
    _planWizard.draft.primaryStrategyId = id;
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    _planWizard.draft.fieldSources.primaryStrategyId = 'formal';
    _planWizard._typeFetchStarted = false;
    _planWizard.typeSuggest = null;
    _pwRebuildStepsKeepIndex();
    _pwRender();
  }
  function _pwPickSecondary(id) {
    if (!_planWizard) return;
    _planWizard.draft.secondaryStrategyId = id;
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    _planWizard.draft.fieldSources.secondaryStrategyId = 'formal';
    _planWizard._typeFetchStarted = false;
    _planWizard.typeSuggest = null;
    _pwRebuildStepsKeepIndex();
    _pwRender();
  }

  function _pwToggleSubtag(id, enabled) {
    if (!_planWizard) return;
    _planWizard.draft.planSubTags = _planWizard.draft.planSubTags || {};
    const prev = _planWizard.draft.planSubTags[id] || { enabled: true, target: 1 };
    _planWizard.draft.planSubTags[id] = { ...prev, enabled: !!enabled };
  }
  function _pwSubtagTarget(id, value) {
    if (!_planWizard) return;
    _planWizard.draft.planSubTags = _planWizard.draft.planSubTags || {};
    const prev = _planWizard.draft.planSubTags[id] || { enabled: true, target: 1 };
    const n = parseInt(value, 10);
    _planWizard.draft.planSubTags[id] = { ...prev, target: Number.isFinite(n) && n >= 0 ? n : prev.target };
  }
  function _pwToggleTypePick(id) {
    if (!_planWizard || !id) return;
    const key = String(id).toLowerCase();
    const cur = Array.isArray(_planWizard.draft.typePicks) ? _planWizard.draft.typePicks.slice() : [];
    const i = cur.indexOf(key);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(key);
    _planWizard.draft.typePicks = cur;
    _pwRender();
  }
  function _pwAddTypePickFromInput() {
    const el = document.getElementById('planTypePickInput');
    const raw = String(el?.value || '').trim();
    if (!raw) return;
    _pwToggleTypePick(raw.toLowerCase());
    if (el) el.value = '';
  }
  async function _pwFetchTypeSuggestions() {
    const deck = _pwDeck();
    if (!deck || !_planWizard) return;
    try {
      const res = await fetch('/api/decks/suggest-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: (deck.cards || []).map(c => ({
            name: c.name, count: c.qty || 1, isCommander: !!c.isCommander,
            typeLine: c.type || c.typeLine || c.type_line || '',
          })),
          commander: deck.commander || null,
          limit: 4,
        }),
      });
      if (!res.ok) throw new Error('suggest-types ' + res.status);
      const data = await res.json();
      if (!_planWizard) return;
      _planWizard.typeSuggest = {
        picks: Array.isArray(data.picks) ? data.picks : [],
        source: data.source || 'degraded',
      };
    } catch (_) {
      if (!_planWizard) return;
      // Degraded: classic tribal types from deck heuristics if available
      const tribes = typeof _deckTribalTypes === 'function' ? (_deckTribalTypes(deck) || []) : [];
      _planWizard.typeSuggest = {
        picks: tribes.slice(0, 4).map((t, i) => ({
          id: String(t).toLowerCase(), label: t, score: 4 - i, bodies: 0, lords: 0, rank: i + 1,
        })),
        source: tribes.length ? 'type-line' : 'degraded',
      };
    }
    if (_planWizard.steps[_planWizard.stepIdx] === 'tribaltypes') _pwRender();
  }

  function _pwPickDeckBudget(tierId) {
    if (!_planWizard) return;
    const t = (typeof PLAN_DECK_BUDGET_TIERS !== 'undefined' ? PLAN_DECK_BUDGET_TIERS : []).find(x => x.id === tierId);
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    if (!t || tierId === 'budget.deck.skip') {
      _planWizard.draft.roughMaxDeckBudgetUsd = null;
      _planWizard.draft.fieldSources.roughMaxDeckBudgetUsd = 'skipped';
    } else if (tierId === 'budget.deck.custom') {
      _planWizard.draft.fieldSources.roughMaxDeckBudgetUsd = 'custom';
    } else {
      _planWizard.draft.roughMaxDeckBudgetUsd = t.usd;
      _planWizard.draft.fieldSources.roughMaxDeckBudgetUsd = tierId;
    }
    _pwRender();
  }
  function _pwPickCardBudget(tierId) {
    if (!_planWizard) return;
    const t = (typeof PLAN_CARD_BUDGET_TIERS !== 'undefined' ? PLAN_CARD_BUDGET_TIERS : []).find(x => x.id === tierId);
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    if (!t || tierId === 'budget.card.skip') {
      _planWizard.draft.roughMaxPerCardBudgetUsd = null;
      _planWizard.draft.fieldSources.roughMaxPerCardBudgetUsd = 'skipped';
      _planWizard.draft.allowBudgetBusters = false;
    } else if (tierId === 'budget.card.custom') {
      _planWizard.draft.fieldSources.roughMaxPerCardBudgetUsd = 'custom';
    } else {
      _planWizard.draft.roughMaxPerCardBudgetUsd = t.usd;
      _planWizard.draft.fieldSources.roughMaxPerCardBudgetUsd = tierId;
      if (_planWizard.draft.fieldSources.allowBudgetBusters == null || _planWizard.draft.fieldSources.allowBudgetBusters === 'skipped') {
        _planWizard.draft.allowBudgetBusters = false;
        _planWizard.draft.fieldSources.allowBudgetBusters = 'budget.busters.no';
      }
    }
    _pwRender();
  }
  function _pwCustomDeckUsd(v) {
    if (!_planWizard) return;
    const n = parseFloat(v);
    _planWizard.draft.roughMaxDeckBudgetUsd = Number.isFinite(n) && n > 0 ? n : null;
    _planWizard.draft.fieldSources.roughMaxDeckBudgetUsd = 'custom';
  }
  function _pwCustomCardUsd(v) {
    if (!_planWizard) return;
    const n = parseFloat(v);
    _planWizard.draft.roughMaxPerCardBudgetUsd = Number.isFinite(n) && n > 0 ? n : null;
    _planWizard.draft.fieldSources.roughMaxPerCardBudgetUsd = 'custom';
  }
  function _pwPickBusters(which) {
    if (!_planWizard) return;
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    if (which === 'yes') {
      _planWizard.draft.allowBudgetBusters = true;
      _planWizard.draft.fieldSources.allowBudgetBusters = 'budget.busters.yes';
    } else if (which === 'no') {
      _planWizard.draft.allowBudgetBusters = false;
      _planWizard.draft.fieldSources.allowBudgetBusters = 'budget.busters.no';
    } else {
      _planWizard.draft.allowBudgetBusters = false;
      _planWizard.draft.fieldSources.allowBudgetBusters = 'skipped';
    }
    _pwRender();
  }

  function _pwFinishBudget(fromSkipEntire) {
    if (!_planWizard) return;
    if (fromSkipEntire) {
      _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
      if (_planWizard.draft.fieldSources.roughMaxDeckBudgetUsd == null) {
        _planWizard.draft.roughMaxDeckBudgetUsd = null;
        _planWizard.draft.fieldSources.roughMaxDeckBudgetUsd = 'skipped';
      }
      if (_planWizard.draft.fieldSources.roughMaxPerCardBudgetUsd == null) {
        _planWizard.draft.roughMaxPerCardBudgetUsd = null;
        _planWizard.draft.fieldSources.roughMaxPerCardBudgetUsd = 'skipped';
        _planWizard.draft.fieldSources.allowBudgetBusters = 'skipped';
        _planWizard.draft.allowBudgetBusters = false;
      }
    }
    if (!_planWizard.draft.winConditionId || !_planWizard.draft.primaryStrategyId) {
      if (typeof showNotif === 'function') showNotif('Win condition and primary strategy are required for a complete plan');
      return;
    }
    const ok = _pwPersist();
    closeDeckPlanWizard();
    if (typeof showNotif === 'function') {
      showNotif(ok ? 'Deck plan saved' : 'Could not save deck plan — reopen the deck and try again');
    }
  }

  function _pwSkipBudgetStep() {
    if (!_planWizard) return;
    _planWizard.draft.roughMaxDeckBudgetUsd = null;
    _planWizard.draft.roughMaxPerCardBudgetUsd = null;
    _planWizard.draft.allowBudgetBusters = false;
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    _planWizard.draft.fieldSources.roughMaxDeckBudgetUsd = 'skipped';
    _planWizard.draft.fieldSources.roughMaxPerCardBudgetUsd = 'skipped';
    _planWizard.draft.fieldSources.allowBudgetBusters = 'skipped';
    _pwFinishBudget(false);
  }

  window.openDeckPlanWizard = openDeckPlanWizard;
  window.closeDeckPlanWizard = closeDeckPlanWizard;
  window._pwBack = _pwBack;
  window._pwToggleMore = _pwToggleMore;
  window._pwPickWincon = _pwPickWincon;
  window._pwPickStrategy = _pwPickStrategy;
  window._pwPickSecondary = _pwPickSecondary;
  window._pwToggleSubtag = _pwToggleSubtag;
  window._pwSubtagTarget = _pwSubtagTarget;
  window._pwToggleTypePick = _pwToggleTypePick;
  window._pwAddTypePickFromInput = _pwAddTypePickFromInput;
  window._pwPickDeckBudget = _pwPickDeckBudget;
  window._pwPickCardBudget = _pwPickCardBudget;
  window._pwCustomDeckUsd = _pwCustomDeckUsd;
  window._pwCustomCardUsd = _pwCustomCardUsd;
  window._pwPickBusters = _pwPickBusters;
  window._pwSkipBudgetStep = _pwSkipBudgetStep;
})();
