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
      showMore: { wincon: false, strategy: false, secondary: false },
      stepIdx: 0,
      steps: _pwBuildSteps(deck),
    };
    document.getElementById('deckPlanWizardModal')?.classList.add('open');
    _pwRender();
  }

  function closeDeckPlanWizard() {
    document.getElementById('deckPlanWizardModal')?.classList.remove('open');
    _planWizard = null;
  }

  /** Same core sequence for every deck; commander only if missing. */
  function _pwBuildSteps(deck) {
    const steps = [];
    if (!deck.commander) steps.push('commander');
    steps.push('wincon', 'strategy', 'secondary', 'budget');
    return steps;
  }

  function _pwPersist() {
    const deck = _pwDeck();
    if (!deck || !_planWizard) return false;
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
          _pwNext();
        };
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
    _pwRender();
  }
  function _pwPickSecondary(id) {
    if (!_planWizard) return;
    _planWizard.draft.secondaryStrategyId = id;
    _planWizard.draft.fieldSources = _planWizard.draft.fieldSources || {};
    _planWizard.draft.fieldSources.secondaryStrategyId = 'formal';
    _pwRender();
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
  window._pwPickDeckBudget = _pwPickDeckBudget;
  window._pwPickCardBudget = _pwPickCardBudget;
  window._pwCustomDeckUsd = _pwCustomDeckUsd;
  window._pwCustomCardUsd = _pwCustomCardUsd;
  window._pwPickBusters = _pwPickBusters;
  window._pwSkipBudgetStep = _pwSkipBudgetStep;
})();
