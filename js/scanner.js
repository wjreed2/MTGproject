// Card Scanner — camera + Tesseract OCR + Scryfall, integrated with main collection

const SCN_INTERVAL_MS  = 350;
const SCN_LOCK_MATCHES = 1;
const SCN_FALLBACK_LIM = 2;

let _scnStream        = null;
let _scnOcrActive     = false;
let _scnOcrRunning    = false;
let _scnOcrTimer      = null;
let _scnNameWorker    = null;
let _scnSetWorker     = null;
let _scnWorkerReady   = false;
let _scnFacingMode    = 'environment';
let _scnLastName      = '';
let _scnLastSetKey    = '';
let _scnConsecSet     = 0;
let _scnScansNoSet    = 0;
let _scnFallbackLast  = '';
let _scnPaused        = false;
let _scnZoomOk        = false;
let _scnZoomMin       = 1;
let _scnZoomMax       = 1;
let _scnZoomStep      = 0.1;
let _scnZoom          = 1;
let _scnSession       = [];
let _scnTessLoaded    = false;

const _SCN_IGNORE = new Set([
  'EN','JP','DE','FR','IT','ES','PT','KR','CN','TW','RU',
  'MT','OF','AT','IN','IS','THE','AND','WIZARDS',
]);

// ── Open / Close ──────────────────────────────────────────────────────────────

async function openScanner() {
  document.getElementById('scannerModal').classList.add('open');
  _scnRenderSession();
  if (!_scnTessLoaded) {
    if (window.Tesseract) {
      _scnTessLoaded = true;
      _scnInitWorkers();
    } else {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => { _scnTessLoaded = true; _scnInitWorkers(); };
      document.head.appendChild(s);
    }
  }
}

function closeScanner() {
  document.getElementById('scannerModal').classList.remove('open');
  _scnHardStop();
}

async function _scnInitWorkers() {
  if (_scnWorkerReady || !window.Tesseract) return;
  try {
    [_scnNameWorker, _scnSetWorker] = await Promise.all([
      Tesseract.createWorker('eng'),
      Tesseract.createWorker('eng'),
    ]);
    _scnWorkerReady = true;
  } catch(e) { console.warn('Tesseract init failed', e); }
}

// ── Camera ────────────────────────────────────────────────────────────────────

async function scnStartCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    _scnStatus('Camera requires HTTPS — use cap:device or ngrok', true); return;
  }
  try {
    if (_scnStream) _scnHardStop();
    _scnStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: _scnFacingMode }, width: { ideal: 1080 }, height: { ideal: 1440 } },
    });
    const v = document.getElementById('scnVideo');
    v.srcObject = _scnStream;
    await v.play();
    document.getElementById('scnCameraIdle').style.display  = 'none';
    v.style.display = 'block';
    document.getElementById('scnCameraWrap').classList.add('active', 'set-only-mode', 'scanning');
    document.getElementById('scnStartBtn').classList.add('hidden');
    document.getElementById('scnStopBtn').classList.remove('hidden');
    document.getElementById('scnFlipBtn').style.display = '';
    _scnSetDet('idle');
    _scnOcrActive = true;
    _scnTick();
    const devs = await navigator.mediaDevices.enumerateDevices();
    if (devs.filter(d => d.kind === 'videoinput').length <= 1)
      document.getElementById('scnFlipBtn').style.display = 'none';
    await _scnSetupZoom();
  } catch(err) {
    _scnStatus(err.name === 'NotAllowedError'
      ? 'Camera permission denied — allow in settings'
      : `Camera error: ${err.message}`, true);
  }
}

function scnStopCamera() { _scnHardStop(); }

function scnFlipCamera() {
  _scnFacingMode = _scnFacingMode === 'environment' ? 'user' : 'environment';
  _scnHardStop();
  scnStartCamera();
}

function _scnHardStop() {
  _scnOcrActive = false;
  clearTimeout(_scnOcrTimer);
  if (_scnStream) { _scnStream.getTracks().forEach(t => t.stop()); _scnStream = null; }
  const v = document.getElementById('scnVideo');
  if (v) { v.srcObject = null; v.style.display = 'none'; }
  const idle = document.getElementById('scnCameraIdle');
  if (idle) idle.style.display = '';
  document.getElementById('scnCameraWrap')?.classList.remove('active', 'scanning', 'locked', 'set-only-mode');
  document.getElementById('scnStartBtn')?.classList.remove('hidden');
  document.getElementById('scnStopBtn')?.classList.add('hidden');
  const flip = document.getElementById('scnFlipBtn');
  if (flip) flip.style.display = 'none';
  _scnZoomOk = false; _scnZoom = 1; _scnZoomMin = 1; _scnZoomMax = 1;
  _scnRefreshZoomUI();
  _scnSetDet('off');
}

async function _scnSetupZoom() {
  const t = _scnStream?.getVideoTracks?.()[0];
  if (!t) { _scnRefreshZoomUI(); return; }
  const caps = t.getCapabilities?.() ?? {};
  if (typeof caps.zoom !== 'object') { _scnRefreshZoomUI(); return; }
  _scnZoomOk  = true;
  _scnZoomMin = Number(caps.zoom.min ?? 1);
  _scnZoomMax = Number(caps.zoom.max ?? 1);
  _scnZoomStep = Number(caps.zoom.step ?? 0.1);
  _scnZoom    = Number((t.getSettings?.() ?? {}).zoom ?? _scnZoomMin);
  _scnRefreshZoomUI();
}

function _scnRefreshZoomUI() {
  const sl = document.getElementById('scnZoomSlider');
  if (!sl) return;
  sl.min = _scnZoomMin; sl.max = _scnZoomMax; sl.step = _scnZoomStep;
  sl.value = _scnZoom; sl.disabled = !_scnZoomOk;
  const zi = document.getElementById('scnZoomInBtn');
  const zo = document.getElementById('scnZoomOutBtn');
  if (zi) zi.disabled = !_scnZoomOk;
  if (zo) zo.disabled = !_scnZoomOk;
  const vl = document.getElementById('scnZoomVal');
  if (vl) vl.textContent = `${Number(_scnZoom).toFixed(1)}×`;
  const wz = document.getElementById('scnZoomControls');
  if (wz) wz.style.opacity = _scnZoomOk ? '1' : '0.45';
}

async function _scnApplyZoom(z) {
  const t = _scnStream?.getVideoTracks?.()[0];
  if (!t || !_scnZoomOk) return;
  const cz = Math.max(_scnZoomMin, Math.min(_scnZoomMax, z));
  try { await t.applyConstraints({ advanced: [{ zoom: cz }] }); _scnZoom = cz; _scnRefreshZoomUI(); } catch(_) {}
}

function scnZoomIn()  { _scnApplyZoom(_scnZoom + _scnZoomStep); }
function scnZoomOut() { _scnApplyZoom(_scnZoom - _scnZoomStep); }

// ── OCR Loop ──────────────────────────────────────────────────────────────────

async function _scnTick() {
  if (!_scnOcrActive) return;
  const v = document.getElementById('scnVideo');
  if (!_scnOcrRunning && v?.readyState >= 2 && !_scnPaused) {
    _scnOcrRunning = true;
    try {
      const bot = _scnCaptureFooter(v);
      if (bot) {
        const res = await _scnRunOCR(_scnSetWorker, bot, '11');
        _scnProcessOCR(res.text);
      }
    } catch(e) { console.warn('SCN OCR', e); }
    finally { _scnOcrRunning = false; }
  }
  if (_scnOcrActive) _scnOcrTimer = setTimeout(_scnTick, SCN_INTERVAL_MS);
}

function _scnCaptureFooter(v) {
  if (!v?.videoWidth) return null;
  const vw = v.videoWidth, vh = v.videoHeight;
  const ix = Math.floor(vw * 0.03), iy = Math.floor(vh * 0.02);
  const sw = Math.max(80, Math.floor(vw * 0.44) - ix);
  const sh = Math.max(40, Math.floor(vh * 0.18) - iy);
  const c = document.createElement('canvas');
  c.width = Math.floor(sw * 2); c.height = Math.floor(sh * 2);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(v, ix, Math.max(0, vh - sh - iy), sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

async function _scnRunOCR(worker, url, psm) {
  if (!_scnWorkerReady || !worker) return { text: '', confidence: 0 };
  try {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const raw = await worker.recognize(url);
    const text = (raw?.data?.text || '').trim();
    const conf = Math.round(raw?.data?.confidence || 0);
    if (text && conf >= 58) return { text, confidence: conf };
    for (const variant of await _scnVariants(url)) {
      if (variant.label === 'raw') continue;
      try {
        const r = await worker.recognize(variant.url);
        const t = (r?.data?.text || '').trim();
        const c = Math.round(r?.data?.confidence || 0);
        if (c > conf && t) return { text: t, confidence: c };
      } catch(_) {}
    }
    return { text, confidence: conf };
  } catch(_) { return { text: '', confidence: 0 }; }
}

async function _scnVariants(dataUrl) {
  const vs = [{ label: 'raw', url: dataUrl }];
  const img = await new Promise(r => {
    const i = new Image();
    i.onload = () => r(i); i.onerror = () => r(null); i.src = dataUrl;
  });
  if (!img?.naturalWidth) return vs;
  const mk = mode => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height); const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
      const v = mode === 'bw' ? (y > 140 ? 255 : 0) : (y > 120 ? 0 : 255);
      d[i] = d[i+1] = d[i+2] = v;
    }
    ctx.putImageData(id, 0, 0); return c.toDataURL('image/png');
  };
  vs.push({ label: 'bw', url: mk('bw') });
  vs.push({ label: 'invbw', url: mk('invbw') });
  return vs;
}

// ── OCR Parsing ───────────────────────────────────────────────────────────────

function _scnParseSet(text) {
  if (!text) return null;
  const src = String(text).toUpperCase()
    .replace(/\n+/g, ' ').replace(/\s+/g, ' ').replace(/[|]/g, 'I').trim();
  const isOk = (raw, slash = false) => {
    const m = String(raw || '').match(/^(\d{1,4})([A-Z]?)$/);
    if (!m) return false;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 && (slash || n < 1900 || n > 2099);
  };
  const normC = raw => {
    const m = String(raw || '').match(/^(\d{1,4})([A-Z]?)$/);
    return m ? `${Number(m[1])}${m[2] || ''}` : null;
  };
  const normS = raw => {
    let t = String(raw || '').toUpperCase();
    if (/[A-Z]/.test(t)) t = t.replace(/0/g, 'O');
    if (/\d/.test(t)) t = t.replace(/O(?=\d)/g, '0').replace(/(?<=\d)O/g, '0');
    return t;
  };

  let directSet = null, directNum = null, directIdx = -1;
  const dMatch = src.match(/\b([A-Z0-9]{2,6})\s*[:;.,-]?\s*0*([0-9]{1,4}[A-Z]?)\b/);
  if (dMatch) {
    const cs = normS(dMatch[1]), cn = normC(dMatch[2]);
    if (cn && isOk(cn) && /[A-Z]/.test(cs) && !_SCN_IGNORE.has(cs)) {
      directSet = cs; directNum = cn; directIdx = dMatch.index ?? -1;
    }
  }

  let num = null, numIdx = -1;
  let m = src.match(/\b(\d{1,4}[A-Z]?)\s*[★*◆]?\s*\/\s*\d{1,4}\b/);
  if (m && isOk(m[1], true)) { num = normC(m[1]); numIdx = m.index ?? -1; }
  if (!num) {
    m = src.match(/\b#\s*(\d{1,4}[A-Z]?)\b/);
    if (m && isOk(m[1])) { num = normC(m[1]); numIdx = m.index ?? -1; }
  }
  if (!num) {
    const toks = [...src.matchAll(/\b(\d{1,4}[A-Z]?)\b/g)]
      .map(x => ({ v: x[1], i: x.index ?? -1 }))
      .filter(x => isOk(x.v));
    if (toks.length) {
      const best = toks.sort((a, b) =>
        (Number((a.v.match(/\d+/) || ['0'])[0]) <= 999 ? 0 : 1) -
        (Number((b.v.match(/\d+/) || ['0'])[0]) <= 999 ? 0 : 1)
      )[0];
      num = normC(best.v); numIdx = best.i;
    }
  }

  const codes = [...src.matchAll(/\b[A-Z0-9]{2,6}\b/g)]
    .map(x => ({ v: normS(x[0]), i: x.index ?? -1 }))
    .filter(x => /[A-Z]/.test(x.v) && !_SCN_IGNORE.has(x.v));

  let setCode = null;
  if (directSet && directNum) { setCode = directSet; num = num || directNum; if (numIdx < 0) numIdx = directIdx; }
  if (codes.length) {
    const sc = c => {
      let s = 0; const v = c.v;
      s += /^[A-Z]{3}$/.test(v) ? -16 : 0;
      s += v.length === 3 ? -10 : 0;
      s += /^[A-Z]{4}$/.test(v) ? -4 : 0;
      s += /^[A-Z]{2}$/.test(v) ? 10 : 0;
      s += /\d/.test(v) ? 2 : 0;
      if (numIdx >= 0) {
        const dist = Math.abs(c.i - numIdx);
        if (dist <= 10) s -= 4; else if (dist <= 24) s -= 2; else if (dist > 70) s += 1;
      }
      return s;
    };
    codes.sort((a, b) => sc(a) - sc(b));
    setCode = codes[0].v;
  }

  if (!num && !setCode) return null;
  return { num, setCode };
}

function _scnProcessOCR(rawSetText) {
  const setInfo = _scnParseSet(rawSetText);
  if (!setInfo) {
    _scnScansNoSet++;
    if (_scnScansNoSet >= SCN_FALLBACK_LIM) {
      _scnScansNoSet = 0;
      const tc = _scnTitleFallback('');
      if (tc) _scnDoFallback(tc);
    }
    _scnSetDet('idle');
    return;
  }
  _scnScansNoSet = 0;
  _scnSetDet('detecting', `${setInfo.setCode||''} #${setInfo.num||''}`, 80, setInfo);
  const key = `${setInfo.setCode}#${setInfo.num}`;
  if (key === _scnLastSetKey) {
    _scnConsecSet++;
  } else {
    _scnLastSetKey = key; _scnConsecSet = 1;
  }
  if (_scnConsecSet >= SCN_LOCK_MATCHES) {
    _scnConsecSet = 0;
    _scnLockSearch('', setInfo);
  }
}

function _scnNorm(raw) {
  const s = String(raw || '').replace(/[^A-Za-z ',\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.replace(/^(TR|TM|MTG|MAG|A|AN)\b\s*/i, '').trim()
    .split(' ').filter(Boolean)
    .filter((w, i) => i === 0 ? w.length >= 2 : w.length >= 2 || /^(of|to|in|on|at|a|an|the)$/i.test(w))
    .join(' ').slice(0, 80).trim();
}

function _scnTitleFallback(current) {
  const ni = document.getElementById('scnNameInput');
  return [_scnNorm(ni?.value || ''), _scnNorm(current), _scnNorm(_scnLastName)]
    .find(v => v && v.length >= 3) || '';
}

async function _scnDoFallback(title) {
  if (!title || _scnPaused) return;
  const norm = _scnNorm(title);
  if (!norm || norm.length < 3 || norm.toLowerCase() === _scnFallbackLast.toLowerCase()) return;
  _scnFallbackLast = norm; _scnPaused = true;
  document.getElementById('scnCameraWrap')?.classList.remove('scanning');
  _scnSetDet('locked', norm, 60, null);
  _scnStatus('<span class="scn-spin"></span>Searching by name…');
  await _scnSearch(norm);
}

// ── Detection UI ──────────────────────────────────────────────────────────────

function _scnSetDet(state, name, conf, setInfo) {
  const bar  = document.getElementById('scnDetBar');
  const icon = document.getElementById('scnDetIcon');
  const nm   = document.getElementById('scnDetName');
  const meta = document.getElementById('scnDetMeta');
  const fill = document.getElementById('scnConfFill');
  if (!bar) return;
  bar.className = 'scn-det-bar';
  const disp = setInfo?.setCode && setInfo?.num
    ? `${setInfo.setCode.toUpperCase()} #${setInfo.num}` : name;
  switch (state) {
    case 'off':
      icon.textContent = '👁'; nm.textContent = 'Camera off';
      meta.textContent = ''; fill.style.width = '0%'; break;
    case 'idle':
      icon.textContent = '⬜'; nm.textContent = 'Scanning…';
      meta.textContent = 'Point at card footer — set code + number'; fill.style.width = '0%'; break;
    case 'detecting':
      icon.textContent = '🔍'; nm.textContent = disp || 'Detecting…';
      meta.textContent = 'Hold steady…'; _scnFill(conf, fill); break;
    case 'locked':
      bar.classList.add('locked');
      document.getElementById('scnCameraWrap')?.classList.add('locked');
      document.getElementById('scnCameraWrap')?.classList.remove('scanning');
      icon.textContent = '✓'; nm.textContent = disp || 'Locked!';
      meta.textContent = setInfo?.num ? 'Exact lookup…' : 'Name search…';
      _scnFill(conf ?? 90, fill); break;
    case 'paused':
      icon.textContent = '⏸'; nm.textContent = name || 'Select a card'; meta.textContent = ''; break;
  }
}

function _scnFill(conf, el) {
  el.style.width = conf + '%';
  el.className = 'scn-conf-fill' + (conf < 45 ? ' low' : conf < 65 ? ' mid' : '');
}

function _scnStatus(html, isErr = false) {
  const el = document.getElementById('scnStatusLine');
  if (!el) return;
  el.innerHTML = html;
  el.className = 'scn-status-line' + (isErr ? ' err' : '');
}

// ── Scryfall Search ───────────────────────────────────────────────────────────

async function _scnLockSearch(name, setInfo) {
  _scnSetDet('locked', name, 90, setInfo);
  _scnPaused = true;
  document.getElementById('scnCameraWrap')?.classList.remove('scanning');
  if (setInfo?.setCode && setInfo?.num) {
    _scnStatus(`<span class="scn-spin"></span>Looking up ${setInfo.setCode.toUpperCase()} #${setInfo.num}…`);
    try {
      const r = await fetch(`${mtgApiRoot()}/scryfall/card/${setInfo.setCode.toLowerCase()}/${setInfo.num}`);
      if (r.ok) { _scnStatus(''); _scnShowCands([await r.json()], name); return; }
    } catch(_) {}
    try {
      const q = `e:${setInfo.setCode.toLowerCase()} cn:${setInfo.num}`;
      const r = await fetch(`${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(q)}&unique=prints&order=set`);
      if (r.ok) {
        const d = await r.json();
        const cs = (d.data || []).slice(0, 3);
        if (cs.length) { _scnStatus(''); _scnShowCands(cs, name); return; }
      }
    } catch(_) {}
    _scnStatus(`No match for ${setInfo.setCode.toUpperCase()} #${setInfo.num}`, true);
    _scnResume(); return;
  }
  await _scnSearch(name);
}

async function scnSearchManual() {
  const name = document.getElementById('scnNameInput')?.value?.trim();
  if (!name) return;
  _scnPaused = true;
  await _scnSearch(name);
}

async function _scnSearch(name) {
  const clean = _scnNorm(name) || String(name || '').trim();
  if (!clean) { _scnStatus('Enter a card name to search', true); _scnResume(); return; }
  _scnStatus('<span class="scn-spin"></span>Searching…');
  document.getElementById('scnCandGrid').innerHTML = '';
  try {
    const r1 = await fetch(`${mtgApiRoot()}/scryfall/named?fuzzy=${encodeURIComponent(clean)}`);
    if (r1.ok) { _scnShowCands([await r1.json()], clean); _scnStatus(''); return; }
    const r2 = await fetch(`${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(`name:"${clean}"`)}&unique=cards&order=name`);
    if (r2.ok) {
      const d = await r2.json();
      const cs = (d.data || []).slice(0, 4);
      if (cs.length) { _scnShowCands(cs, clean); _scnStatus(''); return; }
    }
    _scnStatus(`Not found: "${clean}"`, true); _scnResume();
  } catch(_) { _scnStatus('Network error — check server', true); _scnResume(); }
}

function _scnShowCands(cards, query) {
  const label = document.getElementById('scnCandLabel');
  const grid  = document.getElementById('scnCandGrid');
  const wrap  = document.getElementById('scnCandidates');
  if (!grid) return;
  label.textContent = cards.length === 1 ? 'Confirm this card' : `${cards.length} results for "${query}"`;
  grid.innerHTML = '';
  cards.forEach(card => {
    const img   = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
    const price = card.prices?.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : '';
    const tile  = document.createElement('div');
    tile.className = 'scn-cand-tile';
    tile.innerHTML = `
      <img src="${img}" alt="${card.name}" loading="lazy">
      <div class="scn-tile-info">
        <div class="scn-tile-name">${card.name}</div>
        <div class="scn-tile-set">${(card.set || '').toUpperCase()} · #${card.collector_number || ''}</div>
        ${price ? `<div class="scn-tile-price">${price}</div>` : ''}
      </div>
      <div class="scn-tile-add-btn">+ Add</div>`;
    tile.querySelector('.scn-tile-add-btn').addEventListener('click', () => _scnAdd(card));
    grid.appendChild(tile);
  });
  wrap.classList.remove('hidden');
  _scnSetDet('paused', query);
}

function scnDismiss() {
  document.getElementById('scnCandidates')?.classList.add('hidden');
  const tc = _scnTitleFallback(document.getElementById('scnNameInput')?.value || '');
  if (tc) { _scnDoFallback(tc); return; }
  _scnResume();
}

function _scnResume() {
  _scnPaused = false; _scnLastName = ''; _scnLastSetKey = '';
  _scnConsecSet = 0; _scnScansNoSet = 0; _scnFallbackLast = '';
  document.getElementById('scnCandidates')?.classList.add('hidden');
  document.getElementById('scnCameraWrap')?.classList.remove('locked');
  if (_scnStream) {
    document.getElementById('scnCameraWrap')?.classList.add('scanning');
    _scnSetDet('idle');
  }
}

// ── Add to collection ─────────────────────────────────────────────────────────

function _scnAdd(scryfallCard) {
  const entry = cardToEntry(scryfallCard, 1);
  const existing = collection.find(c => c.uid === entry.uid);
  if (existing) {
    existing.qty += 1;
    existing.addedAt = Date.now();
    recordCollectionEvent('add', existing, 1);
  } else {
    collection.push(entry);
    recordCollectionEvent('add', entry, 1);
  }
  save('collection');
  renderCollection();
  updateStats();
  _scnSession.push(entry);
  _scnRenderSession();
  showNotif(`Added ${entry.name}`);
  document.getElementById('scnCandidates')?.classList.add('hidden');
  _scnResume();
}

// ── Session list ──────────────────────────────────────────────────────────────

function _scnRenderSession() {
  const el = document.getElementById('scnSessionList');
  if (!el) return;
  if (!_scnSession.length) {
    el.innerHTML = '<div class="scn-session-empty">Cards you scan will appear here</div>';
    return;
  }
  el.innerHTML = `
    <div class="scn-session-header">
      <span>Scanned this session (${_scnSession.length})</span>
      <button class="btn btn-ghost btn-sm" onclick="_scnClearSession()">Clear</button>
    </div>
    ${[..._scnSession].reverse().map(c => `
      <div class="scn-session-row">
        <img src="${c.image || ''}" alt="${c.name}">
        <div class="scn-session-info">
          <div class="scn-session-name">${c.name}</div>
          <div class="scn-session-meta">${(c.set || '').toUpperCase()} · ${c.rarity || ''}</div>
        </div>
      </div>`).join('')}`;
}

function _scnClearSession() { _scnSession = []; _scnRenderSession(); }

// ── DOM event wiring (after load) ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scnZoomSlider')?.addEventListener('input', e => {
    _scnApplyZoom(Number(e.target.value));
  });
  document.getElementById('scnNameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') scnSearchManual();
  });
});
