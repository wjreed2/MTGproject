/**
 * Foundation Evaluation Lab UI (dev/calibration only).
 * Not a production Hybrid mode. Ratings stay in localStorage until exported.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'foundation-lab-ratings-v1';
  const CAP_ORDER = ['closeGame', 'manaAccess', 'resources', 'interaction', 'keepGoing'];
  const DEFAULT_EMAIL = String(window.FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL || '').trim();
  const CONFIG_KEY = 'foundation-lab-experimental-config-v1';
  const $ = (id) => document.getElementById(id);

  let index = [];
  let accountFixtures = [];
  let source = 'account';
  let current = null;
  let currentId = null;
  let focusKind = 'add';
  let focusIndex = 0;
  let experimentalConfig = null;
  let loadGen = 0;

  function applyInjectedAccountDefault() {
    const emailEl = $('email');
    if (emailEl && DEFAULT_EMAIL && !emailEl.value) emailEl.value = DEFAULT_EMAIL;
    const opt = $('source') && $('source').querySelector('option[value="account"]');
    if (opt) opt.textContent = DEFAULT_EMAIL ? ('Account decks (' + DEFAULT_EMAIL + ')') : 'Account decks';
  }

  function ratings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function saveRatings(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function upsert(partial) {
    const fn = window.upsertFoundationLabRating;
    saveRatings(fn(ratings(), {
      ...partial,
      deck: currentId,
      engineVersion: current && current.engineVersion,
      configVersion: current && current.configVersion,
    }));
    renderRatingsHints();
  }

  function ratingFor(itemType, extra) {
    const keyBits = {
      deck: currentId,
      itemType,
      capability: extra && extra.capability || '',
      card: extra && extra.card || '',
      field: extra && extra.field || '',
    };
    const k = window.foundationLabRatingKey(keyBits);
    return ratings().find(r => window.foundationLabRatingKey(r) === k) || null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
    ));
  }

  function fmt(n) {
    if (n == null || n === '') return '—';
    if (typeof n === 'number') return Number.isInteger(n) ? String(n) : n.toFixed(2);
    return String(n);
  }

  function statusClass(s) {
    if (s === 'strong') return 'ok';
    if (s === 'adequate') return 'warn';
    return 'bad';
  }

  function fillDeckSelect(rows) {
    const sel = $('deck');
    sel.innerHTML = rows.map(d => `<option value="${esc(d.id)}">${esc(d.name)} (${esc(d.archetype || d.commander || '')})</option>`).join('');
    if (rows[0]) sel.value = rows[0].id;
  }

  async function loadSyntheticIndex() {
    const res = await fetch('/fixtures/foundation/index.json', { credentials: 'include' });
    if (!res.ok) throw new Error(res.status === 404 || res.status === 401 ? 'Sign in as admin to load fixtures' : ('HTTP ' + res.status));
    index = await res.json();
    fillDeckSelect(index);
  }

  async function loadAccountIndex() {
    const email = ($('email') && $('email').value.trim()) || DEFAULT_EMAIL;
    const res = await fetch('/api/foundation-lab/user-fixtures?email=' + encodeURIComponent(email), { credentials: 'include' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(res.status === 401 || res.status === 403
        ? 'Admin session required for account decks'
        : ('Account decks HTTP ' + res.status + ' ' + text.slice(0, 120)));
    }
    const data = await res.json();
    if (data.error && !data.fixtures?.length) throw new Error(data.error);
    accountFixtures = data.fixtures || [];
    index = accountFixtures.map(f => ({ id: f.id, name: f.name, archetype: f.commander || f.archetype || 'account' }));
    fillDeckSelect(index);
    const cov = data.coverage || {};
    $('meta').innerHTML = `<span class="muted">${esc(data.email || email)} · ${accountFixtures.length} decks · CardIR ${fmt(cov.uniqueWithIr)}/${fmt(cov.uniqueCards)} unique (${cov.irCoverage != null ? Math.round(cov.irCoverage * 100) + '%' : '—'})</span>`;
  }

  async function loadIndex() {
    const gen = ++loadGen;
    source = ($('source') && $('source').value) || 'account';
    if (source === 'account') {
      try {
        await loadAccountIndex();
        if (gen !== loadGen) return;
        return;
      } catch (err) {
        if (gen !== loadGen) return;
        $('meta').textContent = String(err && err.message || err) + ' — falling back to synthetic fixtures.';
        if ($('source')) $('source').value = 'synthetic';
        source = 'synthetic';
      }
    }
    await loadSyntheticIndex();
    if (gen !== loadGen) return;
  }

  async function loadFixture(id) {
    if (source === 'account') {
      const hit = accountFixtures.find(f => f.id === id);
      if (!hit) throw new Error('Unknown account deck ' + id);
      return hit;
    }
    const res = await fetch('/fixtures/foundation/' + encodeURIComponent(id) + '.json', { credentials: 'include' });
    if (!res.ok) throw new Error('Could not load fixture ' + id);
    return res.json();
  }

  function loadExperimentalPatch() {
    try { return localStorage.getItem(CONFIG_KEY) || ''; }
    catch (_) { return ''; }
  }

  function saveExperimentalPatch(text) {
    try { localStorage.setItem(CONFIG_KEY, text || ''); }
    catch (_) { /* ignore */ }
  }

  function activeConfig() {
    const use = $('use-exp-config') && $('use-exp-config').checked;
    if (!use) return window.FOUNDATION_CONFIG;
    if (experimentalConfig) return experimentalConfig;
    const raw = $('exp-config') && $('exp-config').value.trim();
    if (!raw) return window.FOUNDATION_CONFIG;
    const patch = JSON.parse(raw);
    if (typeof window.cloneFoundationConfig === 'function') {
      experimentalConfig = window.cloneFoundationConfig(patch);
    } else {
      experimentalConfig = Object.assign(structuredClone(window.FOUNDATION_CONFIG), patch);
    }
    return experimentalConfig;
  }

  function configStatus(text, ok) {
    if (!$('config-status')) return;
    $('config-status').textContent = text || '';
    $('config-status').className = ok === false ? 'bad' : 'muted';
  }

  async function runCurrent() {
    const id = $('deck').value;
    if (!id) {
      current = null;
      $('meta').textContent = 'No decks in this source.';
      return;
    }
    currentId = id;
    let cfg;
    try {
      cfg = activeConfig();
    } catch (err) {
      configStatus('Invalid experimental JSON: ' + (err && err.message), false);
      return;
    }
    const fixture = await loadFixture(id);
    current = evaluateFoundationLab(fixture, { source }, cfg);
    focusKind = 'add';
    focusIndex = 0;
    render();
  }

  function qualityBtns(itemType, capability, field) {
    const rec = ratingFor(itemType, { capability, field });
    const val = rec && rec.rating;
    const mk = (label, rating) =>
      `<button type="button" class="rate ${val === rating ? 'on' : ''}" data-item="${itemType}" data-cap="${esc(capability)}" data-field="${esc(field || '')}" data-rating="${rating}">${label}</button>`;
    return mk('Too Low', 'too_low') + mk('About Right', 'about_right') + mk('Too High', 'too_high');
  }

  function recBtns(itemType, card, kind) {
    const rec = ratingFor(itemType, { card });
    const val = rec && rec.rating;
    const mk = (label, rating, key) =>
      `<button type="button" class="rate ${val === rating ? 'on' : ''}" data-item="${itemType}" data-card="${esc(card)}" data-rating="${rating}" data-key="${key}">${label}</button>`;
    return mk('GOOD', 'good', 'G') + mk('OK / DEBATABLE', 'ok', 'O') + mk('BAD', 'bad', 'B');
  }

  function reasonBox(itemType, card) {
    const rec = ratingFor(itemType, { card });
    const reasons = itemType === 'cut' ? window.FOUNDATION_LAB_CUT_BAD_REASONS : window.FOUNDATION_LAB_ADD_BAD_REASONS;
    const selected = new Set((rec && rec.reasons) || []);
    const shown = (rec && rec.rating === 'bad') || selected.size;
    if (!shown && !(rec && rec.rating === 'bad')) {
      return `<div class="reasons" data-card="${esc(card)}" data-item="${itemType}" hidden></div>`;
    }
    return `<div class="reasons" data-card="${esc(card)}" data-item="${itemType}">
      ${reasons.map(r => `<label><input type="checkbox" data-reason="${esc(r)}" ${selected.has(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}
    </div>`;
  }

  function contribTable(rows) {
    if (!rows || !rows.length) return '<p class="muted">No contributing cards.</p>';
    return `<table>
      <thead><tr><th>Card</th><th>Mechanism</th><th>Evidence</th><th>Amount</th><th>Quality</th><th>Role</th><th>Why</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${esc(r.card)}</td><td>${esc(r.mechanism)}</td>
        <td>${esc(r.evidenceSource || '—')}${r.evidenceSources && r.evidenceSources.length > 1 ? ' (' + r.evidenceSources.join(' + ') + ')' : ''}</td>
        <td>${fmt(r.amount)}</td><td>${fmt(r.quality)}</td>
        <td>${esc(r.role)}</td><td>${esc(r.explanation)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  function renderCap(id, cap) {
    const open = id === 'resources' || id === 'keepGoing' ? ' open' : '';
    return `<details class="cap"${open}>
      <summary><strong>${esc(cap.label)}</strong> <span class="${statusClass(cap.status)}">${esc(cap.status)}</span></summary>
      <div class="grid">
        <div>Proposed target: <b>${fmt(cap.proposedTarget)}</b></div>
        <div>User target: <b>${fmt(cap.userTarget)}</b></div>
        <div>Coverage: <b>${fmt(cap.coverage)}</b></div>
        <div>Model: <code>${esc(cap.model)}</code></div>
      </div>
      <p>${esc(cap.explanation)}</p>
      <div class="review-row">
        <span>Target quality</span>
        ${qualityBtns('target', id, 'target')}
        <label>My target <input type="number" step="0.1" class="override" data-cap="${esc(id)}" value="${esc((ratingFor('target', { capability: id, field: 'target' }) || {}).suggestedTarget || '')}"></label>
      </div>
      <div class="review-row">
        <span>Coverage quality</span>
        ${qualityBtns('coverage', id, 'coverage')}
      </div>
      <label>Notes <input type="text" class="note" data-item="coverage" data-cap="${esc(id)}" value="${esc((ratingFor('coverage', { capability: id, field: 'coverage' }) || {}).notes || '')}"></label>
      <h4>Contributors</h4>
      ${contribTable(cap.contributors)}
    </details>`;
  }

  function renderAdds() {
    const rows = current.adds || [];
    return rows.map((a, i) => `<article class="rec ${focusKind === 'add' && focusIndex === i ? 'focus' : ''}" data-kind="add" data-i="${i}">
      <header><strong>${esc(a.card)}</strong> ${recBtns('add', a.card)}</header>
      <div class="meta">
        <div>Capabilities: ${esc((a.capabilities || []).join(', ') || '—')}</div>
        <div>Mechanism: ${esc(a.mechanism || '—')}</div>
        <div>Why: ${esc(a.why || '—')}</div>
        <div>Deficit: ${esc((a.deficit || []).join(', ') || '—')}</div>
        <div>Expected: ${esc(a.expectedContribution || '—')}</div>
        <div>Synergy: ${esc(a.synergy || '—')}</div>
        <div>Replacement: ${esc(a.replacementFor || '—')}</div>
      </div>
      ${reasonBox('add', a.card)}
      <label>Notes <input type="text" class="note" data-item="add" data-card="${esc(a.card)}" value="${esc((ratingFor('add', { card: a.card }) || {}).notes || '')}"></label>
    </article>`).join('') || '<p class="muted">No suggested adds.</p>';
  }

  function renderCuts() {
    const rows = current.cuts || [];
    return rows.map((a, i) => `<article class="rec ${focusKind === 'cut' && focusIndex === i ? 'focus' : ''}" data-kind="cut" data-i="${i}">
      <header><strong>${esc(a.card)}</strong> ${recBtns('cut', a.card)}</header>
      <div class="meta">
        <div>Reason: ${esc(a.reason || '—')}</div>
        <div>Capability: ${esc(a.capability || '—')}</div>
        <div>Mechanism: ${esc(a.mechanism || '—')}</div>
        <div>Contribution: ${fmt(a.currentContribution)}</div>
        <div>Direct swap: ${a.directSwap ? 'yes' : 'no'}</div>
        <div>Replacement: ${esc(a.replacement || '—')}</div>
      </div>
      ${reasonBox('cut', a.card)}
      <label>Notes <input type="text" class="note" data-item="cut" data-card="${esc(a.card)}" value="${esc((ratingFor('cut', { card: a.card }) || {}).notes || '')}"></label>
    </article>`).join('') || '<p class="muted">No suggested cuts.</p>';
  }

  function render() {
    if (!current) return;
    $('meta').innerHTML = `<b>${esc(current.name)}</b> — ${esc(current.commander)}
      · ${esc(current.archetype)} · ${esc(current.source || source)} · health <span class="${current.health}">${esc(current.health)}</span>
      · ${esc(current.engineVersion)} · config ${esc(current.configVersion)}${current.experimentalConfig ? ' (experimental)' : ''}
      <div class="muted">${esc(current.explanations.overall || '')}</div>
      <div class="muted">${esc(current.notes || '')}</div>`;

    $('caps').innerHTML = CAP_ORDER.map(id => renderCap(id, current.capabilityCoverage[id] || { id, label: id })).join('');

    $('threats').innerHTML = `<table>
      <thead><tr><th>Threat</th><th>Need</th><th>In-color</th><th>Coverage</th><th>Status</th></tr></thead>
      <tbody>${(current.interactionThreats || []).map(t => `<tr>
        <td>${esc(t.threat)}</td><td>${fmt(t.need)}</td><td>${t.inColor ? 'yes' : 'no'}</td>
        <td>${fmt(t.coverage)}</td><td>${esc(t.status)}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${(current.vulnerabilities || []).map(v => `<p class="muted">${esc(v.kind || '')}: ${esc(v.text)}</p>`).join('')}`;

    const m = current.manaAccess || {};
    $('mana').innerHTML = `<ul>
      <li>Commander on target turn: ${fmt(m.commanderOnTargetTurn)}</li>
      <li>Key-card mana: ${fmt(m.keyCardMana)}</li>
      <li>Wincon mana: ${fmt(m.winconMana)}</li>
      <li>Casting pattern: ${esc(m.castingPattern)}</li>
      <li>Lands / ramp (diagnostics only): ${fmt(m.landCount)} / ${fmt(m.rampCount)}</li>
      <li>Target turn: ${fmt(m.targetCastTurn)}</li>
    </ul><p>${esc(m.explanation || '')}</p><p class="muted">${esc(m.note || '')}</p>`;

    const k = current.keepGoing || {};
    const parts = k.parts || {};
    $('keep').innerHTML = `<p>Outcome ${fmt(k.overall)} (${esc(k.status)}) vs need ${fmt(k.vsNeed)} — not a resilience quota.</p>
      <ul>
        <li>Protection: ${fmt(parts.protection)}</li>
        <li>Recursion: ${fmt(parts.recursion)}</li>
        <li>Resources: ${fmt(parts.resources)}</li>
        <li>Alternate paths: ${fmt(parts.alternate)}</li>
        <li>Redundancy: ${fmt(parts.redundancy)}</li>
      </ul><p>${esc(k.explanation || '')}</p>`;

    $('mechs').innerHTML = `<table>
      <thead><tr><th>Mechanism</th><th>Coverage / evidence</th><th>Cards</th></tr></thead>
      <tbody>${(current.mechanisms || []).map(row => `<tr>
        <td>${esc(row.mechanism)}</td><td>${fmt(row.coverage)}</td><td>${esc((row.cards || []).join(', '))}</td>
      </tr>`).join('')}</tbody>
    </table>
    <p class="muted">Mechanisms are diagnostic. They are not Foundation capability quotas.</p>`;

    if ($('pipeline')) {
      const rows = (current.pipeline || []).filter(r => r.card);
      $('pipeline').innerHTML = rows.length ? `<table>
        <thead><tr><th>Need</th><th>Mechanism</th><th>Card</th><th>Evidence</th><th>Coverage</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${esc(r.need)}</td>
          <td>${esc(r.mechanism)}</td>
          <td>${esc(r.card)}</td>
          <td>${esc(r.evidenceSource || '—')}${r.evidenceSources && r.evidenceSources.length > 1 ? ' (' + r.evidenceSources.join(' + ') + ')' : ''}</td>
          <td>${fmt(r.coverageContribution)}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<p class="muted">No contributing cards for this evaluation.</p>';
    }

    if ($('cards')) {
      $('cards').innerHTML = `<table>
        <thead><tr><th>Card</th><th>Need (caps)</th><th>Mechanisms</th><th>Evidence</th><th>Contribution</th><th>Final</th><th>CardIR</th></tr></thead>
        <tbody>${(current.cardDiagnostics || []).map(r => `<tr>
          <td>${esc(r.card)}</td>
          <td>${esc((r.need || []).join(', ') || '—')}</td>
          <td>${esc((r.mechanisms || []).join(', ') || '—')}</td>
          <td>${esc((r.evidenceSources || []).join(', ') || '—')}</td>
          <td>${esc((r.coverageContribution || []).map(c => c.capability + ' ' + fmt(c.amount)).join('; ') || '—')}</td>
          <td>${esc((r.finalEvaluation || []).map(c => c.capability + ' ' + (c.status || '')).join('; ') || '—')}</td>
          <td>${r.cardIRUsedForMechanisms ? 'used' : (r.cardIRAvailable ? 'present, unused for this card' : 'none')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }

    $('synergy').innerHTML = (current.synergy || []).map(s => `<article class="rec">
      <header><strong>${esc(s.card)}</strong> overlap ${esc(s.planOverlap)}</header>
      <div class="meta">
        <div>Independent: ${esc(JSON.stringify(s.independent))}</div>
        <div>Synergy: ${esc(JSON.stringify(s.synergy))}</div>
        <div>CardIR: ${s.cardIR ? 'yes' : 'no'} · Combo: ${s.combo ? 'yes' : 'no'}</div>
        <div>${esc(s.reason)}</div>
      </div>
      ${recBtns('synergy', s.card)}
    </article>`).join('') || '<p class="muted">No measurable synergy rows.</p>';

    $('adds').innerHTML = renderAdds();
    $('cuts').innerHTML = renderCuts();
    $('findings').innerHTML = `
      <h4>Strengths</h4>${(current.strengths || []).map(s => `<p>${esc(s.text)}</p>`).join('') || '<p class="muted">None</p>'}
      <h4>Deficiencies</h4>${(current.deficiencies || []).map(s => `<p>${esc(s.text)}</p>`).join('') || '<p class="muted">None</p>'}
      <h4>Vulnerabilities</h4>${(current.vulnerabilities || []).map(s => `<p>${esc(s.kind || '')}: ${esc(s.text)}</p>`).join('') || '<p class="muted">None</p>'}`;
    renderRatingsHints();
  }

  function renderRatingsHints() {
    $('saved').textContent = ratings().filter(r => r.deck === currentId).length + ' ratings for this deck (local only; not fed into the engine)';
  }

  function focusedList() {
    return focusKind === 'cut' ? (current.cuts || []) : (current.adds || []);
  }

  function rateFocused(rating) {
    const list = focusedList();
    const item = list[focusIndex];
    if (!item) return;
    upsert({ itemType: focusKind, card: item.card, rating });
    render();
  }

  function nextDeck(delta) {
    if (!index.length) return;
    const i = index.findIndex(d => d.id === currentId);
    const start = i < 0 ? 0 : i;
    const n = index[(start + delta + index.length) % index.length];
    if (!n) return;
    $('deck').value = n.id;
    runCurrent();
  }

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button.rate');
    if (!btn || !current) return;
    const itemType = btn.getAttribute('data-item');
    const rating = btn.getAttribute('data-rating');
    upsert({
      itemType,
      rating,
      capability: btn.getAttribute('data-cap') || null,
      card: btn.getAttribute('data-card') || null,
      field: btn.getAttribute('data-field') || null,
    });
    render();
  });

  document.addEventListener('change', (ev) => {
    if (!current) return;
    if (ev.target.matches('input[data-reason]')) {
      const box = ev.target.closest('.reasons');
      const itemType = box.getAttribute('data-item');
      const card = box.getAttribute('data-card');
      const rec = ratingFor(itemType, { card }) || { itemType, card, rating: 'bad' };
      const reasons = [...box.querySelectorAll('input[data-reason]:checked')].map(i => i.getAttribute('data-reason'));
      upsert({ ...rec, reasons, rating: rec.rating || 'bad' });
    }
    if (ev.target.matches('input.override')) {
      const cap = ev.target.getAttribute('data-cap');
      const rec = ratingFor('target', { capability: cap, field: 'target' }) || { itemType: 'target', capability: cap, field: 'target' };
      upsert({ ...rec, suggestedTarget: ev.target.value === '' ? null : Number(ev.target.value) });
    }
  });

  document.addEventListener('blur', (ev) => {
    if (!current || !ev.target.matches('input.note')) return;
    const itemType = ev.target.getAttribute('data-item');
    const cap = ev.target.getAttribute('data-cap');
    const card = ev.target.getAttribute('data-card');
    const rec = ratingFor(itemType, { capability: cap, card, field: cap ? itemType : null }) || { itemType, capability: cap, card };
    upsert({ ...rec, notes: ev.target.value });
  }, true);

  document.addEventListener('keydown', (ev) => {
    if (!current) return;
    if (ev.target.matches('input, textarea')) return;
    const k = ev.key.toLowerCase();
    if (k === 'g') rateFocused('good');
    else if (k === 'o') rateFocused('ok');
    else if (k === 'b') rateFocused('bad');
    else if (k === 'n') nextDeck(1);
    else if (k === 'p') nextDeck(-1);
    else if (k === 'a') { focusKind = 'add'; focusIndex = 0; render(); }
    else if (k === 'c') { focusKind = 'cut'; focusIndex = 0; render(); }
    else if (k === 'j') { focusIndex = Math.min(focusedList().length - 1, focusIndex + 1); render(); }
    else if (k === 'k') { focusIndex = Math.max(0, focusIndex - 1); render(); }
  });

  function ratingsJson() {
    return JSON.stringify({ ratings: ratings() }, null, 2);
  }

  async function exportRatings() {
    const text = ratingsJson();
    const blob = new Blob([text], { type: 'application/json' });
    const file = new File([blob], 'foundation-lab-ratings.json', { type: 'application/json' });
    if (navigator.share) {
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Foundation Lab ratings' });
          return;
        }
        await navigator.share({ text, title: 'Foundation Lab ratings' });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'foundation-lab-ratings.json';
    a.click();
  }

  async function copyRatings() {
    const text = ratingsJson();
    try {
      await navigator.clipboard.writeText(text);
      $('saved').textContent = 'Copied ratings JSON';
    } catch (_) {
      $('saved').textContent = 'Copy failed — use Export';
    }
  }

  $('run').addEventListener('click', runCurrent);
  $('deck').addEventListener('change', runCurrent);
  if ($('exp-config')) $('exp-config').value = loadExperimentalPatch();
  if ($('apply-config')) {
    $('apply-config').addEventListener('click', () => {
      try {
        const raw = ($('exp-config') && $('exp-config').value.trim()) || '';
        saveExperimentalPatch(raw);
        experimentalConfig = null;
        if ($('use-exp-config')) $('use-exp-config').checked = true;
        const cfg = activeConfig();
        configStatus(cfg === window.FOUNDATION_CONFIG
          ? 'Using production config (empty patch)'
          : 'Using experimental clone · ' + (cfg.version || 'patched'), true);
        runCurrent();
      } catch (err) {
        configStatus('Invalid experimental JSON: ' + (err && err.message), false);
      }
    });
  }
  if ($('reset-config')) {
    $('reset-config').addEventListener('click', () => {
      experimentalConfig = null;
      if ($('use-exp-config')) $('use-exp-config').checked = false;
      configStatus('Production FOUNDATION_CONFIG', true);
      runCurrent();
    });
  }
  if ($('use-exp-config')) {
    $('use-exp-config').addEventListener('change', () => {
      experimentalConfig = null;
      runCurrent();
    });
  }
  if ($('source')) {
    $('source').addEventListener('change', () => {
      loadIndex().then(runCurrent).catch(err => { $('meta').textContent = String(err && err.message || err); });
    });
  }
  if ($('email')) {
    $('email').addEventListener('change', () => {
      if (($('source') && $('source').value) === 'account') {
        loadIndex().then(runCurrent).catch(err => { $('meta').textContent = String(err && err.message || err); });
      }
    });
  }
  $('next').addEventListener('click', () => nextDeck(1));
  $('prev').addEventListener('click', () => nextDeck(-1));
  $('export').addEventListener('click', () => { exportRatings(); });
  $('copy').addEventListener('click', () => { copyRatings(); });
  $('import').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch (_) {
      $('saved').textContent = 'Import failed: invalid JSON';
      return;
    }
    const list = Array.isArray(raw) ? raw : (raw && raw.ratings);
    if (!Array.isArray(list)) {
      $('saved').textContent = 'Import failed: expected an array or { ratings: [] }';
      return;
    }
    const existing = ratings();
    if (existing.length && !window.confirm(
      'Replace all ' + existing.length + ' local ratings with this file? Unexported ratings will be lost.'
    )) {
      return;
    }
    saveRatings(list);
    if (current) render();
    else renderRatingsHints();
  });

  applyInjectedAccountDefault();
  loadIndex().then(runCurrent).catch(err => {
    $('meta').textContent = 'Failed to load fixtures: ' + err;
  });
})();
