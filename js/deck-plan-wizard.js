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

  /** Same core sequence for every deck; commander only if missing. Plan envelope steps after themes.
   * CP-Q34: one pass — key cards → roles → wincon/strategy… → cast turn → protection → budget. */
  function _pwBuildSteps(deck) {
    const steps = [];
    if (!deck.commander) steps.push('commander');
    steps.push('keycards', 'roles', 'wincon', 'strategy', 'secondary', 'subtags');
    // Tribal creature-type picker when primary or secondary is tribal.
    const draft = _planWizard?.draft;
    const ids = [draft?.primaryStrategyId, draft?.secondaryStrategyId].filter(Boolean);
    if (ids.includes('strategy.tribal')) steps.push('tribaltypes');
    steps.push('castturn', 'protection', 'budget');
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

    if (step === 'keycards') {
      if (title) title.textContent = 'Key cards that drive your plan';
      const keys = Array.isArray(draft.keyCards) ? draft.keyCards : [];
      const n = keys.length;
      const bandHint = n < 2 || n > 5
        ? `<p class="deck-tab-muted" style="color:var(--warn, #b8860b)">Soft target is 2–5 key cards (you have ${n}). You can continue anyway.</p>`
        : `<p class="deck-tab-muted">Soft target: 2–5 cards (${n} selected).</p>`;
      body.innerHTML = `${bandHint}
        <label class="plan-budget-label">Search cards</label>
        <input type="text" id="planKeyCardSearch" class="deck-select" style="width:100%" placeholder="Type a card name…" autocomplete="off">
        <div id="planKeyCardSuggest" class="plan-opt-grid" style="margin-top:.4rem"></div>
        <p class="deck-tab-muted" style="margin-top:.65rem;font-size:.75rem">Selected</p>
        <div id="planKeyCardList">${keys.map((k, i) =>
          `<div style="display:flex;align-items:center;gap:.4rem;margin:.25rem 0;font-size:.8rem">
            <span style="flex:1">${escapeHtml(k.name)}</span>
            <button type="button" class="btn btn-ghost btn-sm" onclick="_pwRemoveKeyCard(${i})">Remove</button>
          </div>`).join('') || '<p class="deck-tab-muted">None yet — search above.</p>'}</div>`;
      const search = document.getElementById('planKeyCardSearch');
      let _kcTimer = null;
      search?.addEventListener('input', () => {
        clearTimeout(_kcTimer);
        _kcTimer = setTimeout(() => _pwKeyCardAutocomplete(search.value), 180);
      });
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => {
          draft.rolesStale = true;
          _pwNext();
        };
      }
      return;
    }

    if (step === 'roles') {
      if (title) title.textContent = 'Roles this deck should fill';
      if (!Array.isArray(draft.confirmedRoles) || draft.rolesStale || !draft.confirmedRoles.length) {
        _pwDeriveRolesIntoDraft();
      }
      const roles = draft.confirmedRoles || [];
      const missing = typeof uncheckedStaples === 'function' ? uncheckedStaples(roles) : [];
      const warn = missing.length
        ? `<p class="deck-tab-muted" style="color:var(--warn, #b8860b)">Unchecked staples: ${missing.map(escapeHtml).join(', ')}. Confirm to continue without them.</p>
           <label style="display:flex;gap:.4rem;align-items:center;font-size:.8rem;margin:.35rem 0">
             <input type="checkbox" id="planStapleAck" ${draft.stapleWarningAck ? 'checked' : ''} onchange="_planWizard.draft.stapleWarningAck=this.checked">
             I understand — continue without ${missing.map(escapeHtml).join(' / ')}
           </label>`
        : '';
      const roleRows = roles.map((r, i) => {
        const checked = r.checked !== false ? 'checked' : '';
        const t = Number(r.target) || 10;
        const soft = (t < 8 || t > 12)
          ? '<span class="deck-tab-muted" style="font-size:.65rem;color:var(--warn,#b8860b)" title="Soft guidance 8–12">outside 8–12</span>'
          : '';
        return `<label class="plan-subtag-row" style="display:flex;align-items:center;gap:.5rem;margin:.3rem 0;font-size:.8rem">
          <input type="checkbox" ${checked} onchange="_pwToggleRole(${i}, this.checked)">
          <span style="flex:1">${escapeHtml(r.label)} <span class="deck-tab-muted" style="font-size:.65rem">(${escapeHtml(r.source || 'user')})</span> ${soft}</span>
          <input type="number" min="0" max="40" value="${t}" style="width:3.2rem"
            onchange="_pwRoleTarget(${i}, this.value)" title="Target count">
        </label>`;
      }).join('');
      body.innerHTML = `<p class="deck-tab-muted" style="margin-bottom:.5rem">Derived roles start checked. Uncheck to reject. Add any project role via search.</p>
        ${warn}
        <div style="max-height:14rem;overflow:auto;margin:.4rem 0">${roleRows || '<p class="deck-tab-muted">No roles yet.</p>'}</div>
        <label class="plan-budget-label">Add role</label>
        <input type="text" id="planRoleSearch" class="deck-select" style="width:100%" placeholder="Search roles…" autocomplete="off" list="planRoleList">
        <datalist id="planRoleList">${_pwAllRoleLabels().map(l => `<option value="${escapeHtml(l)}">`).join('')}</datalist>
        <button type="button" class="btn btn-outline btn-sm" style="margin-top:.35rem" onclick="_pwAddRoleFromSearch()">Add role</button>
        ${draft.rolesStale ? '<p class="deck-tab-muted" style="margin-top:.5rem">Key cards changed — roles were re-derived.</p>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" style="margin-top:.35rem" onclick="_pwDeriveRolesIntoDraft();_pwRender()">Re-derive from key cards</button>`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => {
          const miss = typeof uncheckedStaples === 'function' ? uncheckedStaples(draft.confirmedRoles) : [];
          if (miss.length && !draft.stapleWarningAck) {
            if (typeof showNotif === 'function') showNotif('Confirm the staple warning to continue without Ramp / Draw / Removal');
            return;
          }
          draft.rolesStale = false;
          _pwSeedStrategyFromKeys();
          _pwNext();
        };
      }
      return;
    }

    if (step === 'castturn') {
      if (title) title.textContent = 'When do you want to cast your commander?';
      const deck = _pwDeck();
      const cmd = _pwCommanderCard(deck);
      const cmc = Math.round(cmd?.cmc || 0);
      const effT = typeof effectiveCastTurn === 'function'
        ? effectiveCastTurn(draft, cmc)
        : (draft.targetCastTurn != null ? draft.targetCastTurn : (cmc || 4));
      if (draft.consistencyPct == null) draft.consistencyPct = 85;
      _pwRefreshLandRampIdeals(deck, cmd);
      body.innerHTML = `<p class="deck-tab-muted">Commander CMC: <strong>${cmc || '—'}</strong>. Default turn is on-curve (CMC).</p>
        <label class="plan-budget-label">Target cast turn</label>
        <input type="number" id="planCastTurn" class="deck-select" min="1" max="12" value="${effT}"
          onchange="_pwSetCastTurn(this.value)" style="width:6rem">
        <label class="plan-budget-label" style="margin-top:.5rem">Consistency %</label>
        <input type="number" id="planConsistency" class="deck-select" min="50" max="99" value="${draft.consistencyPct || 85}"
          onchange="_pwSetConsistency(this.value)" style="width:6rem">
        <p class="deck-tab-muted" style="margin-top:.65rem;font-size:.78rem">
          Early ramp CMC ≤ <strong>${Math.max(0, effT - 1)}</strong> ·
          Cards seen n = <strong>${7 + effT}</strong> ·
          Land ideal L* = <strong>${draft.landIdeal ?? '—'}</strong> ·
          Early ramp R* = <strong>${draft.earlyRampIdeal ?? '—'}</strong>
        </p>
        <label class="plan-budget-label">Edit L* (lands)</label>
        <input type="number" class="deck-select" min="30" max="45" value="${draft.landIdeal ?? 37}"
          onchange="_pwSetLandIdeal(this.value)" style="width:6rem">`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Continue';
        primaryBtn.onclick = () => _pwNext();
      }
      return;
    }

    if (step === 'protection') {
      if (title) title.textContent = 'How important is Protection?';
      if (draft.protectionImportance == null) {
        const sug = typeof defaultProtectionImportanceForStrategy === 'function'
          ? defaultProtectionImportanceForStrategy(draft.primaryStrategyId)
          : null;
        if (sug) {
          draft.protectionImportance = sug;
          draft.confirmedRoles = typeof ensureProtectionRoleOnHigh === 'function'
            ? ensureProtectionRoleOnHigh(draft.confirmedRoles, sug)
            : draft.confirmedRoles;
        }
      }
      const imp = draft.protectionImportance || '';
      const ideal = typeof protectionIdeal === 'function' ? protectionIdeal(imp) : null;
      const types = typeof PROTECTION_TYPE_OPTIONS !== 'undefined' ? PROTECTION_TYPE_OPTIONS : ['Creature', 'Artifact', 'Enchantment'];
      const selected = new Set(draft.protectionTypes || []);
      const voltronNote = draft.primaryStrategyId === 'strategy.voltron' && imp === 'high'
        ? '<p class="deck-tab-muted">Voltron decks usually want High protection — prechecked.</p>'
        : '';
      body.innerHTML = `${voltronNote}
        <p class="deck-tab-muted">Protects the commander (optional types are matching hints only).</p>
        <div class="plan-opt-grid">
          ${[
            ['not_important', 'Not important (0)'],
            ['low', 'Low (3)'],
            ['med', 'Med (6)'],
            ['high', 'High (10)'],
          ].map(([id, lab]) =>
            `<button type="button" class="plan-opt${imp === id ? ' plan-opt--selected' : ''}" onclick="_pwSetProtectionImportance('${id}')">${lab}</button>`
          ).join('')}
        </div>
        <p class="deck-tab-muted" style="margin-top:.5rem;font-size:.75rem">Ideal target: <strong>${ideal == null ? '—' : ideal}</strong></p>
        <label class="plan-budget-label" style="margin-top:.5rem">Also protect these types (optional)</label>
        <div style="display:flex;flex-wrap:wrap;gap:.35rem">
          ${types.map(t =>
            `<label style="font-size:.75rem"><input type="checkbox" ${selected.has(t) ? 'checked' : ''} onchange="_pwToggleProtType('${t}', this.checked)"> ${escapeHtml(t)}</label>`
          ).join('')}
        </div>`;
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
    const miss = typeof uncheckedStaples === 'function'
      ? uncheckedStaples(_planWizard.draft.confirmedRoles) : [];
    if (miss.length && !_planWizard.draft.stapleWarningAck) {
      if (typeof showNotif === 'function') {
        showNotif('Confirm skipping staples (' + miss.join(', ') + ') on the Roles step before finishing');
      }
      const rolesIdx = (_planWizard.steps || []).indexOf('roles');
      if (rolesIdx >= 0) {
        _planWizard.stepIdx = rolesIdx;
        _pwRender();
      }
      return;
    }
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
    // Ensure L*/R* filled before persist
    const deck = _pwDeck();
    _pwRefreshLandRampIdeals(deck, _pwCommanderCard(deck));
    if (_planWizard.draft.protectionImportance === 'high') {
      _planWizard.draft.confirmedRoles = typeof ensureProtectionRoleOnHigh === 'function'
        ? ensureProtectionRoleOnHigh(_planWizard.draft.confirmedRoles, 'high')
        : _planWizard.draft.confirmedRoles;
    }
    const ok = _pwPersist();
    closeDeckPlanWizard();
    if (typeof showNotif === 'function') {
      showNotif(ok ? 'Deck plan saved' : 'Could not save deck plan — reopen the deck and try again');
    }
    if (ok && deck && typeof renderCommanderGameplan === 'function') renderCommanderGameplan(deck);
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

  function _pwAllRoleLabels() {
    if (typeof PROJECT_ROLE_TAGS !== 'undefined' && Array.isArray(PROJECT_ROLE_TAGS)) {
      return PROJECT_ROLE_TAGS.map(t => t.label);
    }
    return ['Ramp', 'Card Draw', 'Removal', 'Protection', 'Tutor', 'Ping'];
  }

  async function _pwKeyCardAutocomplete(q) {
    const box = document.getElementById('planKeyCardSuggest');
    if (!box) return;
    const query = String(q || '').trim();
    if (query.length < 2) { box.innerHTML = ''; return; }
    try {
      const res = await fetch(`/api/cards/autocomplete?q=${encodeURIComponent(query)}`);
      if (!res.ok) { box.innerHTML = ''; return; }
      const data = await res.json();
      const names = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      box.innerHTML = names.slice(0, 8).map(n => {
        const name = typeof n === 'string' ? n : (n.name || '');
        return `<button type="button" class="plan-opt" data-key-card-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
      }).join('');
    } catch (_) {
      box.innerHTML = '';
    }
  }

  function _pwAddKeyCard(name) {
    if (!_planWizard || !name) return;
    const draft = _planWizard.draft;
    draft.keyCards = Array.isArray(draft.keyCards) ? draft.keyCards : [];
    if (draft.keyCards.some(k => k.name.toLowerCase() === String(name).toLowerCase())) return;
    draft.keyCards.push({ name: String(name) });
    draft.rolesStale = true;
    draft.stapleWarningAck = false;
    _pwRender();
  }

  function _pwRemoveKeyCard(idx) {
    if (!_planWizard) return;
    const draft = _planWizard.draft;
    draft.keyCards = (draft.keyCards || []).filter((_, i) => i !== idx);
    draft.rolesStale = true;
    draft.stapleWarningAck = false;
    _pwRender();
  }

  function _pwCardDetailsForKeys(deck, keyCards) {
    const byName = new Map();
    for (const c of (deck?.cards || [])) byName.set(String(c.name || '').toLowerCase(), c);
    return (keyCards || []).map(k => {
      const hit = byName.get(String(k.name || '').toLowerCase());
      return {
        name: k.name,
        roleTags: hit?.roleTags || hit?.tags || [],
        ir: hit?.ir || null,
      };
    });
  }

  function _pwDeriveRolesIntoDraft() {
    if (!_planWizard) return;
    const draft = _planWizard.draft;
    const deck = _pwDeck();
    const details = _pwCardDetailsForKeys(deck, draft.keyCards);
    const derived = typeof deriveRolesFromKeyCards === 'function'
      ? deriveRolesFromKeyCards(details)
      : [];
    draft.confirmedRoles = typeof buildConfirmedRolesFromDerive === 'function'
      ? buildConfirmedRolesFromDerive(derived, draft.confirmedRoles)
      : derived.map(label => ({ label, target: 10, checked: true, source: 'derived' }));
    if (draft.protectionImportance === 'high' && typeof ensureProtectionRoleOnHigh === 'function') {
      draft.confirmedRoles = ensureProtectionRoleOnHigh(draft.confirmedRoles, 'high');
    }
    draft.rolesDerivedAt = Date.now();
    draft.rolesStale = false;
    draft.stapleWarningAck = false;
  }

  /** CP-Q12: seed strategy/wincon from key cards + confirmed roles when still empty. */
  function _pwSeedStrategyFromKeys() {
    if (!_planWizard) return;
    const draft = _planWizard.draft;
    const deck = _pwDeck();
    const cmd = _pwCommanderCard(deck);
    const details = _pwCardDetailsForKeys(deck, draft.keyCards);
    // Synthetic mini-deck from key cards (tags) + commander for ranking
    const synCards = details.map(d => ({
      name: d.name,
      qty: 1,
      roleTags: d.roleTags || [],
      type_line: 'Creature',
    }));
    if (cmd) synCards.push({ ...cmd, isCommander: true, qty: 1 });
    // Pad so path-B threshold isn't required — use commander rankers with key-card oracle blob boost
    const keyBlob = details.map(d => {
      const hit = (deck?.cards || []).find(c => String(c.name || '').toLowerCase() === String(d.name || '').toLowerCase());
      return String(hit?.oracleText || hit?.oracle_text || '').toLowerCase();
    }).join(' ');
    const roleLabels = (draft.confirmedRoles || []).filter(r => r.checked !== false).map(r => r.label);
    const boostId = (id) => {
      let b = 0;
      const lab = String(id || '').toLowerCase();
      if (lab.includes('sacrifice') && (keyBlob.includes('sacrifice') || roleLabels.includes('Sac Outlet'))) b += 0.25;
      if (lab.includes('token') && (keyBlob.includes('token') || roleLabels.includes('Token Maker'))) b += 0.25;
      if (lab.includes('voltron') && (keyBlob.includes('equip') || keyBlob.includes('aura') || roleLabels.includes('Protection'))) b += 0.2;
      if (lab.includes('lifegain') && (keyBlob.includes('life') || roleLabels.includes('Lifegain'))) b += 0.2;
      if (lab.includes('reanimator') && (keyBlob.includes('return') || roleLabels.includes('Reanimate'))) b += 0.2;
      if (lab.includes('spellslinger') && (roleLabels.includes('Prowess') || keyBlob.includes('instant') || keyBlob.includes('sorcery'))) b += 0.15;
      if (lab.includes('landfall') && roleLabels.includes('Landfall')) b += 0.25;
      if (lab.includes('drain') && roleLabels.includes('Drain')) b += 0.2;
      return b;
    };
    if (typeof rankStrategiesForCommander === 'function' || typeof rankStrategiesForDeck === 'function') {
      let ranked = _planWizard.path === 'B' && synCards.length >= 3 && typeof rankStrategiesForDeck === 'function'
        ? rankStrategiesForDeck({ cards: synCards.concat(Array.from({ length: 80 }, (_, i) => ({ name: `Pad ${i}`, qty: 1, roleTags: [], type_line: 'Creature' }))) })
        : (typeof rankStrategiesForCommander === 'function' ? rankStrategiesForCommander(cmd) : []);
      ranked = (ranked || []).map(r => ({ ...r, score: (r.score || 0) + boostId(r.id) }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      _planWizard.ranked.strategies = ranked;
      const sugS = _pwSuggested(ranked);
      if (!draft.primaryStrategyId && sugS) {
        draft.primaryStrategyId = sugS.id;
        draft.fieldSources = draft.fieldSources || {};
        draft.fieldSources.primaryStrategyId = 'formal';
      }
    }
    if (typeof rankWinConditionsForCommander === 'function' || typeof rankWinConditionsForDeck === 'function') {
      let ranked = _planWizard.path === 'B' && typeof rankWinConditionsForDeck === 'function'
        ? rankWinConditionsForDeck({ cards: synCards })
        : (typeof rankWinConditionsForCommander === 'function' ? rankWinConditionsForCommander(cmd) : []);
      ranked = (ranked || []).map(r => ({ ...r, score: (r.score || 0) + boostId(r.id) }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      _planWizard.ranked.wincons = ranked;
      const sugW = _pwSuggested(ranked);
      if (!draft.winConditionId && sugW) {
        draft.winConditionId = sugW.id;
        draft.fieldSources = draft.fieldSources || {};
        draft.fieldSources.winConditionId = 'formal';
      }
    }
  }

  function _pwToggleRole(idx, checked) {
    if (!_planWizard?.draft?.confirmedRoles?.[idx]) return;
    _planWizard.draft.confirmedRoles[idx].checked = !!checked;
    _planWizard.draft.stapleWarningAck = false;
    _pwRender();
  }

  function _pwRoleTarget(idx, val) {
    if (!_planWizard?.draft?.confirmedRoles?.[idx]) return;
    const n = parseInt(val, 10);
    _planWizard.draft.confirmedRoles[idx].target = Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : 10;
  }

  function _pwAddRoleFromSearch() {
    if (!_planWizard) return;
    const inp = document.getElementById('planRoleSearch');
    const label = String(inp?.value || '').trim();
    if (!label) return;
    const known = _pwAllRoleLabels();
    const match = known.find(l => l.toLowerCase() === label.toLowerCase())
      || known.find(l => l.toLowerCase().startsWith(label.toLowerCase()));
    if (!match) {
      if (typeof showNotif === 'function') showNotif('Pick a project role from the list');
      return;
    }
    draftEnsureRole(_planWizard.draft, match, 'user');
    if (inp) inp.value = '';
    _pwRender();
  }

  function draftEnsureRole(draft, label, source) {
    draft.confirmedRoles = Array.isArray(draft.confirmedRoles) ? draft.confirmedRoles : [];
    const hit = draft.confirmedRoles.find(r => r.label === label);
    if (hit) { hit.checked = true; return; }
    draft.confirmedRoles.push({ label, target: 10, checked: true, source: source || 'user' });
  }

  function _pwRefreshLandRampIdeals(deck, cmd) {
    if (!_planWizard) return;
    const draft = _planWizard.draft;
    const cmc = Math.round(cmd?.cmc || 0);
    const T = typeof effectiveCastTurn === 'function' ? effectiveCastTurn(draft, cmc) : (draft.targetCastTurn || cmc || 4);
    const avgMV = typeof avgNonLandMv === 'function' ? avgNonLandMv(deck) : 3.2;
    if (typeof solveLandAndEarlyRampIdeals === 'function') {
      const solved = solveLandAndEarlyRampIdeals({
        avgMV,
        T,
        consistencyPct: draft.consistencyPct || 85,
        R_est: draft.earlyRampIdeal != null ? draft.earlyRampIdeal : 8,
      });
      if (draft.landIdeal == null) draft.landIdeal = solved.landIdeal;
      draft.earlyRampIdeal = solved.earlyRampIdeal;
      if (draft.targetCastTurn == null) draft.targetCastTurn = solved.targetCastTurn;
    }
  }

  function _pwSetCastTurn(v) {
    if (!_planWizard) return;
    const n = parseInt(v, 10);
    _planWizard.draft.targetCastTurn = Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : null;
    _planWizard.draft.landIdeal = null; // recompute
    const deck = _pwDeck();
    _pwRefreshLandRampIdeals(deck, _pwCommanderCard(deck));
    _pwRender();
  }

  function _pwSetConsistency(v) {
    if (!_planWizard) return;
    const n = parseInt(v, 10);
    _planWizard.draft.consistencyPct = Number.isFinite(n) ? Math.max(50, Math.min(99, n)) : 85;
    _planWizard.draft.landIdeal = null;
    const deck = _pwDeck();
    _pwRefreshLandRampIdeals(deck, _pwCommanderCard(deck));
    _pwRender();
  }

  function _pwSetLandIdeal(v) {
    if (!_planWizard) return;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return;
    _planWizard.draft.landIdeal = Math.max(30, Math.min(45, n));
    // Re-solve R* with fixed L*
    const deck = _pwDeck();
    const cmd = _pwCommanderCard(deck);
    const cmc = Math.round(cmd?.cmc || 0);
    const T = typeof effectiveCastTurn === 'function' ? effectiveCastTurn(_planWizard.draft, cmc) : (_planWizard.draft.targetCastTurn || cmc || 4);
    const avgMV = typeof avgNonLandMv === 'function' ? avgNonLandMv(deck) : 3.2;
    if (typeof solveLandAndEarlyRampIdeals === 'function') {
      const solved = solveLandAndEarlyRampIdeals({
        avgMV, T, consistencyPct: _planWizard.draft.consistencyPct || 85,
        R_est: 8,
      });
      // Keep user L*; take R* from a solve that respects user L via castConsistency loop
      let R = 0;
      const pct = (_planWizard.draft.consistencyPct || 85) / 100;
      const L = _planWizard.draft.landIdeal;
      if (typeof castConsistency === 'function') {
        for (let cand = 0; cand <= 18; cand++) {
          if (castConsistency(100, L, cand, T, true) + 1e-9 >= pct) { R = cand; break; }
          R = cand;
        }
      } else {
        R = solved.earlyRampIdeal;
      }
      _planWizard.draft.earlyRampIdeal = R;
    }
    _pwRender();
  }

  function _pwSetProtectionImportance(id) {
    if (!_planWizard) return;
    _planWizard.draft.protectionImportance = id;
    _planWizard.draft.confirmedRoles = typeof ensureProtectionRoleOnHigh === 'function'
      ? ensureProtectionRoleOnHigh(_planWizard.draft.confirmedRoles, id)
      : _planWizard.draft.confirmedRoles;
    _pwRender();
  }

  function _pwToggleProtType(typ, on) {
    if (!_planWizard) return;
    const set = new Set(_planWizard.draft.protectionTypes || []);
    if (on) set.add(typ); else set.delete(typ);
    _planWizard.draft.protectionTypes = [...set];
  }

  (function _pwBindKeyCardSuggestDelegation() {
    const modal = document.getElementById('deckPlanWizardModal');
    if (!modal || modal.dataset.keyCardDelegation) return;
    modal.dataset.keyCardDelegation = '1';
    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-key-card-name]');
      if (!btn) return;
      _pwAddKeyCard(btn.getAttribute('data-key-card-name'));
    });
  })();

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
  window._pwAddKeyCard = _pwAddKeyCard;
  window._pwRemoveKeyCard = _pwRemoveKeyCard;
  window._pwToggleRole = _pwToggleRole;
  window._pwRoleTarget = _pwRoleTarget;
  window._pwAddRoleFromSearch = _pwAddRoleFromSearch;
  window._pwDeriveRolesIntoDraft = _pwDeriveRolesIntoDraft;
  window._pwSetCastTurn = _pwSetCastTurn;
  window._pwSetConsistency = _pwSetConsistency;
  window._pwSetLandIdeal = _pwSetLandIdeal;
  window._pwSetProtectionImportance = _pwSetProtectionImportance;
  window._pwToggleProtType = _pwToggleProtType;
})();
