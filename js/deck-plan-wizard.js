/**
 * Deck plan wizard UI (Entry 13 v1) — Path A (<80) and Path B (>=80).
 * Depends on js/deck-plan.js globals and deck save helpers.
 */
(function () {
  'use strict';

  let _planWizard = null; // { deckId, draft, steps, stepIdx, path, ranked, chips, showMore }

  function _pwDeck() {
    if (typeof getActiveDeck !== 'function') return null;
    const d = getActiveDeck();
    if (!d || !_planWizard || d.id !== _planWizard.deckId) return d;
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

    const chips = [];
    const min = typeof PLAN_INFERENCE_CONFIDENCE_MIN === 'number' ? PLAN_INFERENCE_CONFIDENCE_MIN : 0.35;
    if (path === 'B') {
      const topW = ranked.wincons[0];
      const topS = ranked.strategies[0];
      if (topW && !topW.fallback && topW.score >= min) chips.push({ kind: 'wincon', id: topW.id, label: topW.label, score: topW.score });
      if (topS && !topS.fallback && topS.score >= min) chips.push({ kind: 'strategy', id: topS.id, label: topS.label, score: topS.score });
      // Optional archetype hint chip
      if (typeof _autoDetectArchetype === 'function' && typeof _archetypeLabel === 'function') {
        const arch = _autoDetectArchetype(deck);
        const label = _archetypeLabel(arch);
        if (label && label !== 'Goodstuff') chips.push({ kind: 'archetype', id: label, label: `Archetype: ${label}`, score: 0.5 });
      }
      while (chips.length > (typeof PLAN_CHIP_MAX === 'number' ? PLAN_CHIP_MAX : 3)) chips.pop();
    }

    _planWizard = {
      deckId: deck.id,
      draft: JSON.parse(JSON.stringify(draft)),
      path,
      ranked,
      chips,
      chipState: {}, // kind -> confirm|correct|skip
      showMore: { wincon: false, strategy: false, secondary: false },
      skipFormal: { wincon: false, strategy: false },
      stepIdx: 0,
      steps: _pwBuildSteps(path, deck, chips),
    };
    document.getElementById('deckPlanWizardModal')?.classList.add('open');
    _pwRender();
  }

  function closeDeckPlanWizard() {
    document.getElementById('deckPlanWizardModal')?.classList.remove('open');
    _planWizard = null;
  }

  function _pwBuildSteps(path, deck, chips) {
    const steps = [];
    if (path === 'A') {
      if (!deck.commander) steps.push('commander');
      steps.push('wincon', 'strategy', 'secondary', 'budget');
    } else {
      if (chips.length) steps.push('chips');
      steps.push('wincon', 'strategy', 'secondary', 'budget');
    }
    return steps;
  }

  function _pwPersist() {
    const deck = _pwDeck();
    if (!deck || !_planWizard) return;
    deck.plan = typeof normalizeDeckPlan === 'function'
      ? normalizeDeckPlan(_planWizard.draft)
      : _planWizard.draft;
    if (typeof logDeckPlan === 'function') logDeckPlan('persist', deck.plan);
    if (typeof saveActiveDeck === 'function') saveActiveDeck(deck);
    else if (typeof save === 'function') save('decks');
    if (typeof _renderAddSuggestions === 'function') _renderAddSuggestions(deck);
  }

  function _pwOptionButtons(list, selectedId, onPickAttr) {
    return list.map(o => {
      const sel = o.id === selectedId ? ' plan-opt--selected' : '';
      return `<button type="button" class="plan-opt${sel}" data-plan-pick="${o.id}" ${onPickAttr}>${escapeHtml(o.label || o.id)}</button>`;
    }).join('');
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
      if (title) title.textContent = 'Deck plan — Commander';
      body.innerHTML = `<p class="deck-tab-muted" style="margin-bottom:.75rem">This deck needs a commander before we can rank strategies.</p>
        <button type="button" class="btn btn-primary" id="planWizardPickCommanderBtn">Choose commander</button>`;
      document.getElementById('planWizardPickCommanderBtn')?.addEventListener('click', () => {
        closeDeckPlanWizard();
        if (typeof openCommanderEdit === 'function') openCommanderEdit();
      });
      if (primaryBtn) { primaryBtn.textContent = 'Skip for now'; primaryBtn.onclick = () => _pwNext(); }
      return;
    }

    if (step === 'chips') {
      if (title) title.textContent = 'Deck plan — Confirm observations';
      body.innerHTML = `<p class="deck-tab-muted" style="margin-bottom:.75rem">Based on your list (≥80 cards). Confirm, correct, or skip each chip.</p>`
        + _planWizard.chips.map((ch, i) => {
          const st = _planWizard.chipState[ch.kind] || '';
          return `<div class="plan-chip-row" data-chip-kind="${ch.kind}">
            <div class="plan-chip-label"><strong>${escapeHtml(ch.label)}</strong>${ch.score ? ` <span class="deck-tab-muted">(${(ch.score * 100).toFixed(0)}%)</span>` : ''}</div>
            <div class="plan-chip-actions">
              <button type="button" class="btn btn-sm ${st === 'confirm' ? 'btn-primary' : 'btn-outline'}" onclick="_pwChipAction('${ch.kind}','confirm',${i})">Confirm</button>
              <button type="button" class="btn btn-sm ${st === 'correct' ? 'btn-primary' : 'btn-outline'}" onclick="_pwChipAction('${ch.kind}','correct',${i})">Correct</button>
              <button type="button" class="btn btn-sm ${st === 'skip' ? 'btn-primary' : 'btn-outline'}" onclick="_pwChipAction('${ch.kind}','skip',${i})">Skip</button>
            </div>
          </div>`;
        }).join('')
        + `<div id="planChipCorrectPicker" style="margin-top:.75rem"></div>`;
      if (primaryBtn) { primaryBtn.textContent = 'Continue'; primaryBtn.onclick = () => _pwFinishChips(); }
      return;
    }

    if (step === 'wincon') {
      if (_planWizard.skipFormal.wincon && draft.winConditionId) {
        _pwNext();
        return;
      }
      if (title) title.textContent = 'How does this deck usually win?';
      const top = showAll('wincon')
        ? (typeof PLAN_WINCONS !== 'undefined' ? PLAN_WINCONS : [])
        : _planWizard.ranked.wincons;
      // Pre-fill hint
      const pref = !_planWizard.ranked.wincons[0]?.fallback && (_planWizard.ranked.wincons[0]?.score || 0) >= 0.35
        ? _planWizard.ranked.wincons[0].id : null;
      if (!draft.winConditionId && pref && !_planWizard.chipState.wincon) draft.winConditionId = draft.winConditionId || pref;
      body.innerHTML = `<div class="plan-opt-grid">${_pwOptionButtons(top, draft.winConditionId, 'onclick="_pwPickWincon(this.dataset.planPick)"')}</div>
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
      if (_planWizard.skipFormal.strategy && draft.primaryStrategyId) {
        _pwNext();
        return;
      }
      if (title) title.textContent = 'What is the main strategy or theme?';
      const top = showAll('strategy')
        ? (typeof PLAN_STRATEGIES !== 'undefined' ? PLAN_STRATEGIES : [])
        : _planWizard.ranked.strategies;
      const pref = !_planWizard.ranked.strategies[0]?.fallback && (_planWizard.ranked.strategies[0]?.score || 0) >= 0.35
        ? _planWizard.ranked.strategies[0].id : null;
      if (!draft.primaryStrategyId && pref && !_planWizard.chipState.strategy) draft.primaryStrategyId = draft.primaryStrategyId || pref;
      body.innerHTML = `<div class="plan-opt-grid">${_pwOptionButtons(top, draft.primaryStrategyId, 'onclick="_pwPickStrategy(this.dataset.planPick)"')}</div>
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
      body.innerHTML = `<div class="plan-opt-grid">${_pwOptionButtons(list, draft.secondaryStrategyId, 'onclick="_pwPickSecondary(this.dataset.planPick)"')}</div>
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
        <label class="plan-budget-label" style="margin-top:.85rem">OK with a few over-budget “real winners”?</label>
        <div class="plan-opt-grid plan-opt-grid--compact">
          <button type="button" class="plan-opt${draft.allowBudgetBusters === true && draft.fieldSources?.allowBudgetBusters === 'budget.busters.yes' ? ' plan-opt--selected' : ''}" onclick="_pwPickBusters('yes')">Yes</button>
          <button type="button" class="plan-opt${draft.allowBudgetBusters === false && draft.fieldSources?.allowBudgetBusters === 'budget.busters.no' ? ' plan-opt--selected' : ''}" onclick="_pwPickBusters('no')">No</button>
          <button type="button" class="plan-opt${draft.fieldSources?.allowBudgetBusters === 'skipped' ? ' plan-opt--selected' : ''}" onclick="_pwPickBusters('skip')">Skip</button>
        </div>
        <p class="deck-tab-muted" style="margin-top:.75rem;font-size:.75rem">Skip the whole budget step with the button below — Adds ranking stays unchanged.</p>`;
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
      // Skip formal steps already satisfied by chips
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

  function _pwChipAction(kind, action, idx) {
    if (!_planWizard) return;
    const ch = _planWizard.chips[idx];
    _planWizard.chipState[kind] = action;
    if (typeof logDeckPlan === 'function') logDeckPlan('chip', kind, action, ch?.id);
    if (kind === 'archetype') {
      _pwRender();
      return;
    }
    if (action === 'confirm' && ch) {
      if (kind === 'wincon') {
        _planWizard.draft.winConditionId = ch.id;
        _planWizard.draft.fieldSources.winConditionId = 'chip-confirmed';
        _planWizard.skipFormal.wincon = true;
      }
      if (kind === 'strategy') {
        _planWizard.draft.primaryStrategyId = ch.id;
        _planWizard.draft.fieldSources.primaryStrategyId = 'chip-confirmed';
        _planWizard.skipFormal.strategy = true;
      }
      document.getElementById('planChipCorrectPicker') && (document.getElementById('planChipCorrectPicker').innerHTML = '');
    } else if (action === 'skip') {
      if (kind === 'wincon') _planWizard.skipFormal.wincon = false;
      if (kind === 'strategy') _planWizard.skipFormal.strategy = false;
      document.getElementById('planChipCorrectPicker') && (document.getElementById('planChipCorrectPicker').innerHTML = '');
    } else if (action === 'correct') {
      const catalog = kind === 'wincon'
        ? (typeof PLAN_WINCONS !== 'undefined' ? PLAN_WINCONS : [])
        : (typeof PLAN_STRATEGIES !== 'undefined' ? PLAN_STRATEGIES : []);
      const el = document.getElementById('planChipCorrectPicker');
      if (el) {
        el.innerHTML = `<div class="plan-opt-grid">${catalog.map(o =>
          `<button type="button" class="plan-opt" onclick="_pwChipCorrectPick('${kind}','${o.id}')">${escapeHtml(o.label)}</button>`
        ).join('')}</div>`;
      }
    }
    _pwRender();
  }

  function _pwChipCorrectPick(kind, id) {
    if (!_planWizard) return;
    if (kind === 'wincon') {
      _planWizard.draft.winConditionId = id;
      _planWizard.draft.fieldSources.winConditionId = 'chip-corrected';
      _planWizard.skipFormal.wincon = true;
    }
    if (kind === 'strategy') {
      _planWizard.draft.primaryStrategyId = id;
      _planWizard.draft.fieldSources.primaryStrategyId = 'chip-corrected';
      _planWizard.skipFormal.strategy = true;
    }
    _planWizard.chipState[kind] = 'correct';
    const el = document.getElementById('planChipCorrectPicker');
    if (el) el.innerHTML = '';
    _pwRender();
  }

  function _pwFinishChips() {
    if (!_planWizard) return;
    // Rebuild steps: drop formal Qs that were confirmed/corrected
    const deck = _pwDeck();
    _planWizard.steps = _pwBuildSteps('B', deck, _planWizard.chips);
    // If wincon/strategy confirmed, remove those formal steps
    _planWizard.steps = _planWizard.steps.filter(s => {
      if (s === 'chips') return false;
      if (s === 'wincon' && _planWizard.skipFormal.wincon) return false;
      if (s === 'strategy' && _planWizard.skipFormal.strategy) return false;
      return true;
    });
    _planWizard.stepIdx = 0;
    if (!_planWizard.steps.length) {
      _pwPersist();
      closeDeckPlanWizard();
      if (typeof showNotif === 'function') showNotif('Deck plan saved');
      return;
    }
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
    _pwPersist();
    closeDeckPlanWizard();
    if (typeof showNotif === 'function') showNotif('Deck plan saved');
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

  // Expose
  window.openDeckPlanWizard = openDeckPlanWizard;
  window.closeDeckPlanWizard = closeDeckPlanWizard;
  window._pwBack = _pwBack;
  window._pwToggleMore = _pwToggleMore;
  window._pwPickWincon = _pwPickWincon;
  window._pwPickStrategy = _pwPickStrategy;
  window._pwPickSecondary = _pwPickSecondary;
  window._pwChipAction = _pwChipAction;
  window._pwChipCorrectPick = _pwChipCorrectPick;
  window._pwPickDeckBudget = _pwPickDeckBudget;
  window._pwPickCardBudget = _pwPickCardBudget;
  window._pwCustomDeckUsd = _pwCustomDeckUsd;
  window._pwCustomCardUsd = _pwCustomCardUsd;
  window._pwPickBusters = _pwPickBusters;
  window._pwSkipBudgetStep = _pwSkipBudgetStep;
  window._pwFinishChips = _pwFinishChips;
})();
