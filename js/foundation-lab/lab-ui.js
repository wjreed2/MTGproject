/**
 * Foundation Evaluation Lab UI (dev/calibration only).
 * Not a production Hybrid mode. Ratings stay in localStorage until exported.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'foundation-lab-ratings-v1';
  const CAP_ORDER = ['closeGame', 'manaAccess', 'resources', 'interaction', 'keepGoing'];
  const $ = (id) => document.getElementById(id);

  let index = [];
  let current = null;
  let currentId = null;
  let focusKind = 'add';
  let focusIndex = 0;

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

  async function loadIndex() {
    const res = await fetch('/fixtures/foundation/index.json');
    index = await res.json();
    const sel = $('deck');
    sel.innerHTML = index.map(d => `<option value="${esc(d.id)}">${esc(d.name)} (${esc(d.archetype)})</option>`).join('');
    if (index[0]) sel.value = index[0].id;
  }

  async function loadFixture(id) {
    const res = await fetch('/fixtures/foundation/' + encodeURIComponent(id) + '.json');
    return res.json();
  }

  async function runCurrent() {
    const id = $('deck').value;
    currentId = id;
    const fixture = await loadFixture(id);
    current = evaluateFoundationLab(fixture, { source: 'ui' }, window.FOUNDATION_CONFIG);
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
      <thead><tr><th>Card</th><th>Mechanism</th><th>Amount</th><th>Quality</th><th>Role</th><th>Why</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${esc(r.card)}</td><td>${esc(r.mechanism)}</td>
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
      · ${esc(current.archetype)} · health <span class="${current.health}">${esc(current.health)}</span>
      · ${esc(current.engineVersion)}
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
    const i = index.findIndex(d => d.id === currentId);
    const n = index[(i + delta + index.length) % index.length];
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
    if (rating === 'bad' && (itemType === 'add' || itemType === 'cut')) render();
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

  $('run').addEventListener('click', runCurrent);
  $('deck').addEventListener('change', runCurrent);
  $('next').addEventListener('click', () => nextDeck(1));
  $('prev').addEventListener('click', () => nextDeck(-1));
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ ratings: ratings() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'foundation-lab-ratings.json';
    a.click();
  });
  $('import').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const raw = JSON.parse(await file.text());
    const list = Array.isArray(raw) ? raw : (raw.ratings || []);
    saveRatings(list);
    if (current) render();
  });

  loadIndex().then(runCurrent).catch(err => {
    $('meta').textContent = 'Failed to load fixtures: ' + err;
  });
})();
