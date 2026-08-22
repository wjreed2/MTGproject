// Voice card entry modal

// Hard-coded phonetic overrides for codes the recognizer consistently mishears.
// Applied before fuzzy matching so they fire regardless of allSets load state.
const PHONETIC_MAP = {
  'VAU': 'VOW',
  'VAW': 'VOW',
};

// Words that look like 3-char set codes but are never MTG set codes
const skipWords = new Set([
  'TWO','SIX','TEN','FOR',
  'THE','AND','BUT','NOT','ARE','WAS','HAS','GET','GOT','HAD',
  'DID','SAY','USE','MAY','ALL','OWN','ANY','OFF','TRY','ADD',
  'TOP','YES','ITS','OUT','WHO','WHY','HOW','CAN','SEE','NOW',
  'NEW','OLD','TOO','FEW','FAR','BIG','HER','HIM','HIS','OUR',
  'ITS','PUT','LET','SET','RUN','CUT','ACT','AGO','AGE','AID',
  'AIM','AIR','BAD','BAR','BIT','BOX','BOY','BUS','CAR','CAT',
  'DAD','DEN','DIG','DOG','DOT','DRY','DUE','EAR','EAT','END',
  'EYE','FAN','FAT','FIG','FIT','FIX','FLY','FOG','FOX','FUN',
  'FUR','GAS','GUY','HAT','HAY','HIT','HOP','HOT','HUG','HUT',
  'ICE','ILL','INK','JAM','JAR','JET','JOB','JOY','JUG','KID',
  'LAD','LAP','LAW','LAY','LEG','LID','LIT','LOG','LOT','LOW',
  'MAP','MAT','MEN','MIX','MOB','MOP','MUD','MUG','NAP','NET',
  'NOD','NOR','NUT','OAK','ODD','OIL','PAD','PAL','PAN','PAW',
  'PAY','PEA','PEN','PET','PIE','PIG','PIT','POD','POP','POT',
  'RAG','RAM','RAP','RAT','RAW','RAY','RED','RIB','RID','ROB',
  'ROD','ROT','ROW','RUB','RUG','RUM','SAP','SAT','SAW','SIN',
  'SIP','SIT','SKY','SOB','SON','SOW','SOY','SPA','SPY','SUB',
  'SUM','SUN','TAB','TAN','TAP','TAR','TAX','TEA','TIP','TOE',
  'TON','TOT','TOW','TOY','TUB','TUG','VAT','VEX','VIA',
  'WAD','WAG','WAR','WAX','WEB','WED','WET','WIN','WIT','WOK',
  'WON','WOO','YAM','YAP','YEP','YET','ZIP','ZOO'
]);

// Set-code shaped token: 3 alphanumerics with at least one letter (MH3, BLB, 2XM…)
const SET_CODE_TOKEN_SRC = '\\b([A-Z][A-Z0-9]{2}|[A-Z0-9][A-Z][A-Z0-9]|[A-Z0-9]{2}[A-Z])\\b';

// Spoken letter names → letters. The recognizer usually transcribes spelled-out codes as
// words ("em aitch three"), which the old single-char collapse never caught.
const LETTER_WORDS = {
  ay: 'A', aye: 'A', bee: 'B', be: 'B', cee: 'C', see: 'C', sea: 'C', si: 'C',
  dee: 'D', ee: 'E', ef: 'F', eff: 'F', gee: 'G', jee: 'G', aitch: 'H', haitch: 'H',
  eye: 'I', jay: 'J', kay: 'K', cay: 'K', el: 'L', ell: 'L', em: 'M', en: 'N',
  oh: 'O', owe: 'O', pee: 'P', pea: 'P', cue: 'Q', queue: 'Q', are: 'R', arr: 'R',
  es: 'S', ess: 'S', tee: 'T', tea: 'T', you: 'U', yew: 'U', ewe: 'U', vee: 'V',
  ex: 'X', why: 'Y', zee: 'Z', zed: 'Z',
};
const DIGIT_WORDS = {
  zero: '0', one: '1', two: '2', to: '2', too: '2', three: '3',
  four: '4', for: '4', fore: '4', five: '5', six: '6', seven: '7',
  eight: '8', ate: '8', nine: '9',
};

function _voiceCharToken(word) {
  const w = String(word || '').toLowerCase().replace(/[.,!?;]/g, '');
  if (/^[a-z0-9]$/.test(w)) return w.toUpperCase();
  if (LETTER_WORDS[w]) return LETTER_WORDS[w];
  if (DIGIT_WORDS[w] !== undefined) return DIGIT_WORDS[w];
  return null;
}

/**
 * Collapse runs of ≥3 spoken characters into a set code: "em aitch three" → "MH3",
 * "bee el bee 261" → "BLB 261". The first 3 chars must contain a letter (so digit-by-digit
 * collector numbers like "one two four" stay words for the number parser), and tokens past
 * the first 3 are left as-is so "bee el bee one two four" → "BLB one two four".
 */
function collapseSpokenLetterRuns(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    const chars = [];
    while (j < tokens.length && chars.length < 3) {
      const ch = _voiceCharToken(tokens[j]);
      if (!ch) break;
      chars.push(ch);
      j++;
    }
    if (chars.length === 3 && /[A-Z]/.test(chars.join(''))) {
      out.push(chars.join(''));
      i = j;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out.join(' ');
}

// Sound-alike letter groups (speech confusions): substitutions within a group cost 0.4
// instead of 1 so "DLB"→"BLB" beats an unrelated code at the same plain edit distance.
const VOICE_CONFUSION_GROUPS = ['BCDEGPTVZ', 'MN', 'SFX', 'AJK', 'IY', 'UQW'];
const VOICE_CONFUSION = (() => {
  const m = {};
  for (const g of VOICE_CONFUSION_GROUPS)
    for (const a of g) for (const b of g) if (a !== b) m[a + b] = true;
  return m;
})();

function voiceWeightedDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : (VOICE_CONFUSION[a[i - 1] + b[j - 1]] ? 0.4 : 1);
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
    }
  return d[m][n];
}

const VOICE_SET_PREFS_KEY = 'mtg_voice_set_prefs_v2';
const VOICE_SET_PREFS_V1_KEY = 'mtg_voice_set_prefs_v1';
const voiceSetPrefsDefault = {
  excludeTokenSets: true,
  excludeArtCardSets: true,
  filterOwnedSetsOnly: false,
  paperOnly: true,
};
let voiceSetPrefs = { ...voiceSetPrefsDefault };
_voiceLoadSetPrefs();

function _voiceLoadSetPrefs() {
  try {
    let raw = localStorage.getItem(VOICE_SET_PREFS_KEY);
    if (!raw) {
      raw = localStorage.getItem(VOICE_SET_PREFS_V1_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        voiceSetPrefs = {
          ...voiceSetPrefsDefault,
          excludeTokenSets: parsed?.excludeTokenSets !== false,
          excludeArtCardSets: parsed?.excludeArtCardSets !== false,
          filterOwnedSetsOnly: false,
        };
        _voiceSaveSetPrefs();
        try {
          localStorage.removeItem(VOICE_SET_PREFS_V1_KEY);
        } catch (_) {}
      }
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    voiceSetPrefs = {
      ...voiceSetPrefsDefault,
      ...parsed,
      filterOwnedSetsOnly: !!(parsed.filterOwnedSetsOnly || parsed.allowListEnabled),
    };
  } catch (_) {}
}

function _voiceSaveSetPrefs() {
  const payload = {
    excludeTokenSets: !!voiceSetPrefs.excludeTokenSets,
    excludeArtCardSets: !!voiceSetPrefs.excludeArtCardSets,
    filterOwnedSetsOnly: !!voiceSetPrefs.filterOwnedSetsOnly,
    paperOnly: voiceSetPrefs.paperOnly !== false,
  };
  localStorage.setItem(VOICE_SET_PREFS_KEY, JSON.stringify(payload));
}

function _voiceSetMeta(code) {
  const u = String(code || '').toUpperCase();
  if (!u || !Array.isArray(allSets)) return null;
  return allSets.find(s => String(s.code || '').toUpperCase() === u) || null;
}

function _voiceIsTokenSet(code, card) {
  const m = _voiceSetMeta(code);
  const setType = String(m?.set_type || m?.type || card?.set_type || '').toLowerCase();
  return setType === 'token' || /\btoken\b/i.test(String(m?.name || ''));
}

function _voiceIsArtCardSet(code, card) {
  const m = _voiceSetMeta(code);
  const setType = String(m?.set_type || m?.type || card?.set_type || '').toLowerCase();
  if (setType === 'memorabilia') return true;
  const name = String(card?.set_name || m?.name || '').toLowerCase();
  return /\bart series\b/.test(name);
}

function _voiceSetPassesTypeFilters(setCode) {
  if (!setCode) return false;
  if (voiceSetPrefs.excludeTokenSets && _voiceIsTokenSet(setCode, null)) return false;
  if (voiceSetPrefs.excludeArtCardSets && _voiceIsArtCardSet(setCode, null)) return false;
  return true;
}

/** Set codes present in the collection that pass current token/art exclusions (for “my sets” voice scope). */
function _voiceOwnedSetCodes() {
  const out = new Set();
  for (const c of Array.isArray(collection) ? collection : []) {
    const code = String(c?.set || '').toUpperCase();
    if (!code || !_voiceSetPassesTypeFilters(code)) continue;
    out.add(code);
  }
  return out;
}

let _voiceOwnedCache = { key: '', set: new Set() };
function _voiceOwnedSetCodesCached() {
  const key = [
    Array.isArray(collection) ? collection.length : 0,
    voiceSetPrefs.excludeTokenSets, voiceSetPrefs.excludeArtCardSets,
  ].join('|');
  if (_voiceOwnedCache.key === key) return _voiceOwnedCache.set;
  _voiceOwnedCache = { key, set: _voiceOwnedSetCodes() };
  return _voiceOwnedCache.set;
}

/** Set codes eligible as voice-match candidates: allSets minus the user's token/art/owned-only exclusions. */
let _voiceEligibleSetCache = { key: '', entries: [] };
function _voiceEligibleSetEntries() {
  if (!Array.isArray(allSets) || !allSets.length) return [];
  const key = [
    allSets.length, voiceSetPrefs.excludeTokenSets, voiceSetPrefs.excludeArtCardSets,
    voiceSetPrefs.filterOwnedSetsOnly,
    voiceSetPrefs.filterOwnedSetsOnly && Array.isArray(collection) ? collection.length : 0,
  ].join('|');
  if (_voiceEligibleSetCache.key === key) return _voiceEligibleSetCache.entries;
  const owned = voiceSetPrefs.filterOwnedSetsOnly ? _voiceOwnedSetCodesCached() : null;
  const entries = [];
  for (const s of allSets) {
    const code = String(s.code || '').toUpperCase();
    if (!code) continue;
    const setType = String(s.set_type || s.type || '').toLowerCase();
    if (voiceSetPrefs.excludeTokenSets && (setType === 'token' || /\btoken\b/i.test(String(s.name || '')))) continue;
    if (voiceSetPrefs.excludeArtCardSets && (setType === 'memorabilia' || /\bart series\b/i.test(String(s.name || '')))) continue;
    if (owned && !owned.has(code)) continue;
    entries.push({ code, releasedAt: s.released_at ? Date.parse(s.released_at) : 0 });
  }
  _voiceEligibleSetCache = { key, entries };
  return entries;
}

/** Sets confirmed (card added) this modal session — a strong prior for what's being entered. */
const voiceSessionConfirmedSets = new Set();

/**
 * Rank plausible set codes for a spoken candidate: confusion-weighted distance ≤ 2 against
 * pref-filtered sets, minus priors (pinned/last-heard, confirmed this session, owned, recent).
 * An exact code match always outranks fuzzy candidates.
 */
function matchVoiceSetCodeCandidates(candidate, k = 3) {
  if (!candidate) return [];
  const entries = _voiceEligibleSetEntries();
  if (!entries.length) return [];
  const owned = _voiceOwnedSetCodesCached();
  const nowMs = Date.now();
  const scored = [];
  for (const ent of entries) {
    const dist = ent.code === candidate ? 0 : voiceWeightedDistance(candidate, ent.code);
    if (dist > 2) continue;
    let bonus = 0;
    if (ent.code === pinnedSetCode) bonus += 0.4;
    if (ent.code === lastHeardSetCode) bonus += 0.2;
    if (voiceSessionConfirmedSets.has(ent.code)) bonus += 0.3;
    if (owned.has(ent.code)) bonus += 0.25;
    if (ent.releasedAt && nowMs - ent.releasedAt < 3 * 365 * 86400000) bonus += 0.2;
    scored.push({ code: ent.code, dist, score: dist - Math.min(bonus, 0.75) });
  }
  scored.sort((x, y) => (x.dist === 0 ? -1 : 0) - (y.dist === 0 ? -1 : 0) || x.score - y.score);
  return scored.slice(0, k);
}

function matchVoiceSetCode(candidate) {
  const cands = matchVoiceSetCodeCandidates(candidate, 1);
  return cands.length ? cands[0].code : candidate;
}

// ── Session card-lookup cache + speculative prefetch from interim transcripts ──

const voiceCardFetchCache = new Map();
/** fetchCard with per-session dedupe; failures aren't cached so retries stay possible. */
function fetchVoiceCardCached(setCode, num) {
  const key = `${String(setCode).toUpperCase()}|${String(num).trim()}`;
  if (voiceCardFetchCache.has(key)) return voiceCardFetchCache.get(key);
  const p = fetchCard(setCode, num)
    .catch(() => null)
    .then(card => {
      if (!card) voiceCardFetchCache.delete(key);
      return card;
    });
  voiceCardFetchCache.set(key, p);
  return p;
}

let _voicePrefetchLastKey = '';
/** Kick off the card fetch as soon as an interim transcript already carries a known set + number. */
function maybePrefetchFromInterim(text) {
  if (!Array.isArray(allSets) || !allSets.length) return;
  const t = collapseSpokenLetterRuns(normalizeVoiceTranscript(text));
  const upper = t.toUpperCase();
  const codes = [...upper.matchAll(new RegExp(SET_CODE_TOKEN_SRC, 'g'))]
    .map(m => m[1]).filter(c => !skipWords.has(c));
  let code = codes[0] || '';
  code = PHONETIC_MAP[code] || code;
  code = voiceCorrections[code] || code;
  // Only prefetch exact known codes — no fuzzy guessing on unstable interim text
  if (code && !_voiceEligibleSetEntries().some(e => e.code === code)) code = '';
  if (!code) {
    if (pinnedSetCode) code = pinnedSetCode;
    else if (lastHeardSetCode && Date.now() - lastHeardSetTime < 8000) code = lastHeardSetCode;
  }
  const numMatch = upper.match(/\b(\d{1,4})\b/);
  if (!code || !numMatch) return;
  const key = `${code}|${numMatch[1]}`;
  if (key === _voicePrefetchLastKey) return;
  _voicePrefetchLastKey = key;
  void fetchVoiceCardCached(code, numMatch[1]);
}

function voiceCardAllowedBySetPrefs(card) {
  const setCode = String(card?.set || card?.setCode || card?.code || '').toUpperCase();
  if (!setCode) return true;
  if (voiceSetPrefs.filterOwnedSetsOnly) {
    const owned = _voiceOwnedSetCodes();
    if (!owned.has(setCode)) return false;
  }
  if (voiceSetPrefs.excludeTokenSets && _voiceIsTokenSet(setCode, card)) return false;
  if (voiceSetPrefs.excludeArtCardSets && _voiceIsArtCardSet(setCode, card)) return false;
  return true;
}

function getVoiceSearchSetFilterPredicate() {
  const modalOpen = document.getElementById('voiceModal')?.classList.contains('open');
  if (!modalOpen) return null;
  return card => voiceCardAllowedBySetPrefs(card);
}
globalThis.getVoiceSearchSetFilterPredicate = getVoiceSearchSetFilterPredicate;

function toggleVoiceSearchSettings(forceOpen) {
  const panel = document.getElementById('voiceSearchSettingsPanel');
  const gear = document.getElementById('voiceSettingsGearBtn');
  if (!panel || !gear) return;
  voiceSetSettingsOpen = typeof forceOpen === 'boolean' ? forceOpen : !voiceSetSettingsOpen;
  panel.classList.toggle('hidden', !voiceSetSettingsOpen);
  panel.setAttribute('aria-hidden', voiceSetSettingsOpen ? 'false' : 'true');
  gear.setAttribute('aria-expanded', voiceSetSettingsOpen ? 'true' : 'false');
}

function renderVoiceSetSearchSettings() {
  const tokenChk = document.getElementById('voiceExcludeTokenSetsChk');
  const artChk = document.getElementById('voiceExcludeArtSetsChk');
  const mySetsChk = document.getElementById('voiceFilterMyCollectionSetsChk');
  const paperChk = document.getElementById('findCardPaperOnlyChk');
  if (tokenChk) tokenChk.checked = !!voiceSetPrefs.excludeTokenSets;
  if (artChk) artChk.checked = !!voiceSetPrefs.excludeArtCardSets;
  if (mySetsChk) mySetsChk.checked = !!voiceSetPrefs.filterOwnedSetsOnly;
  if (paperChk) paperChk.checked = voiceSetPrefs.paperOnly !== false;
}

function onVoiceSearchSettingsChanged() {
  voiceSetPrefs.excludeTokenSets = !!document.getElementById('voiceExcludeTokenSetsChk')?.checked;
  voiceSetPrefs.excludeArtCardSets = !!document.getElementById('voiceExcludeArtSetsChk')?.checked;
  voiceSetPrefs.filterOwnedSetsOnly = !!document.getElementById('voiceFilterMyCollectionSetsChk')?.checked;
  _voiceSaveSetPrefs();
  renderVoiceSetSearchSettings();
  const q = String(document.getElementById('findCardInput')?.value || '').trim();
  if (q.length >= 2 && typeof runFindCard === 'function') runFindCard(q);
}

function onFindPaperOnlyChanged() {
  voiceSetPrefs.paperOnly = !!document.getElementById('findCardPaperOnlyChk')?.checked;
  _voiceSaveSetPrefs();
  const q = String(document.getElementById('findCardInput')?.value || '').trim();
  if (q.length >= 2 && typeof runFindCard === 'function') runFindCard(q);
}

/** Strip colons so STT “times” (e.g. 12:34) don’t swallow collector numbers. */
function normalizeVoiceTranscript(raw) {
  return String(raw || '').replace(/:/g, '');
}

/** Soft two-note chime after voice “yes” adds a card (Web Audio — no file). */
function playVoiceAddDing() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!window.__mtgVoiceDingCtx) window.__mtgVoiceDingCtx = new AC();
    const ctx = window.__mtgVoiceDingCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const t0 = ctx.currentTime;
    const ring = (freq, tStart, tEnd, peak) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, tStart);
      g.gain.setValueAtTime(0.0001, tStart);
      g.gain.exponentialRampToValueAtTime(peak, tStart + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(tStart);
      osc.stop(tEnd + 0.015);
    };
    ring(784, t0, t0 + 0.2, 0.085);
    ring(1047, t0 + 0.05, t0 + 0.24, 0.055);
  } catch (_) { /* ignore */ }
}

// ── Voice session accuracy / throughput metrics (in-memory per modal open) ──
let voiceAcc = null;
let voiceAccTimer = null;
/** “Yes” finals while the same preview is up, until a full add completes (for extra-yes metric). */
let voicePendingYesCount = 0;

function _voiceAccVoiceTabActive() {
  return document.getElementById('voiceModal')?.classList.contains('open') &&
    document.getElementById('voiceTabBtn')?.classList.contains('active');
}

function initVoiceAccSession() {
  voiceAcc = {
    t0: Date.now(),
    finalsAtCycleStart: 0,
    finalUtterances: 0,
    noSkips: 0,
    failedLookups: 0,
    voiceParseLookups: 0,
    manualLookups: 0,
    samePrintReheard: 0,
    confirmReparses: 0,
    cardsAddedSpeech: 0,
    cardsAddedButton: 0,
    extraYesBeforeAdd: 0,
    lastCardFinalCost: null,
  };
}

function voiceAccNoteCardResolved() {
  if (!voiceAcc) return;
  const spent = voiceAcc.finalUtterances - voiceAcc.finalsAtCycleStart;
  voiceAcc.lastCardFinalCost = spent;
  voiceAcc.finalsAtCycleStart = voiceAcc.finalUtterances;
  renderVoiceAccPanel();
}

function bumpVoiceAccFinalUtterance() {
  if (!voiceAcc || !_voiceAccVoiceTabActive()) return;
  voiceAcc.finalUtterances++;
  renderVoiceAccPanel();
}

function formatVoiceAccDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Single 0–100 score (needs ≥1 card added). Blends utterance efficiency vs ~2 finals per card
 * with deductions for skips, failed lookups, re-speech, confirm reparses, extra yes, manual lookup.
 */
function computeVoiceSessionAccuracy(va) {
  const cards = va.cardsAddedSpeech + va.cardsAddedButton;
  if (cards < 1) {
    return {
      score: null,
      title: 'Overall accuracy appears after you add at least one card this session.',
    };
  }
  const finals = Math.max(va.finalUtterances, 1);
  const idealFinals = 2 * cards;
  const efficiencyPts = Math.min(100, (100 * idealFinals) / finals);

  const penaltyRaw =
    va.noSkips * 6 +
    va.failedLookups * 5 +
    va.samePrintReheard * 4 +
    va.confirmReparses * 3 +
    va.extraYesBeforeAdd * 3 +
    va.manualLookups * 2;
  const smoothPts = Math.max(0, 100 - Math.min(72, penaltyRaw));

  const combined = efficiencyPts * 0.55 + smoothPts * 0.45;
  const score = Math.max(0, Math.min(100, Math.round(combined)));

  const title =
    `Overall ≈ 55% “efficiency” (${Math.round(efficiencyPts)}% of ideal: ${idealFinals} finals for ${cards} card(s), you used ${va.finalUtterances})` +
    ` + 45% “smooth” (${Math.round(smoothPts)}% after penalties for skips, not-found, repeats, reparses, extra yes, manual Look Up).`;

  return { score, title };
}

function renderVoiceAccPanel() {
  const el = document.getElementById('voiceAccPanel');
  if (!el || !voiceAcc) return;
  const prevDetails = document.getElementById('voiceAccDetails');
  const wasOpen = prevDetails ? prevDetails.open : false;
  const cards = voiceAcc.cardsAddedSpeech + voiceAcc.cardsAddedButton;
  const avg = cards ? (voiceAcc.finalUtterances / cards).toFixed(1) : '—';
  const last = voiceAcc.lastCardFinalCost != null ? String(voiceAcc.lastCardFinalCost) : '—';
  const elapsed = formatVoiceAccDuration(Date.now() - voiceAcc.t0);
  const acc = computeVoiceSessionAccuracy(voiceAcc);
  const scoreShort = acc.score == null ? '—' : `${acc.score}%`;
  const overallHtml = acc.score == null
    ? `<div class="voice-acc-overall" title="${acc.title.replace(/"/g, '&quot;')}">
         <span class="voice-acc-overall-label">Overall accuracy</span>
         <span class="voice-acc-overall-val voice-acc-overall-na">—</span>
       </div>`
    : `<div class="voice-acc-overall" title="${acc.title.replace(/"/g, '&quot;')}">
         <span class="voice-acc-overall-label">Overall accuracy</span>
         <span class="voice-acc-overall-val">${acc.score}%</span>
       </div>`;
  el.innerHTML = `
    <details id="voiceAccDetails" class="voice-acc-details"${wasOpen ? ' open' : ''}>
      <summary class="voice-acc-summary">
        <span class="voice-acc-summary-main">
          <span class="voice-acc-title">Session accuracy</span>
          <span class="voice-acc-summary-score${acc.score == null ? ' voice-acc-summary-na' : ''}" title="${acc.title.replace(/"/g, '&quot;')}">${scoreShort}</span>
        </span>
        <span class="voice-acc-summary-meta">
          <span id="voiceAccElapsed" class="voice-acc-summary-time">${elapsed}</span>
          <span class="voice-acc-chevron" aria-hidden="true"></span>
        </span>
      </summary>
      <div class="voice-acc-details-body">
        <div class="voice-acc-head">
          <span class="voice-acc-title-sub">Metrics</span>
          <button type="button" class="btn btn-ghost btn-sm voice-acc-reset" onclick="resetVoiceAccSession()">Reset</button>
        </div>
        ${overallHtml}
        <div class="voice-acc-grid">
          <span>Time</span><span>${elapsed}</span>
          <span>Cards added</span><span>${cards} <span class="voice-acc-sub">(${voiceAcc.cardsAddedSpeech} voice · ${voiceAcc.cardsAddedButton} button)</span></span>
          <span>“No” / skip</span><span>${voiceAcc.noSkips}</span>
          <span>Final utterances</span><span>${voiceAcc.finalUtterances} <span class="voice-acc-sub">(each time the mic finishes a phrase)</span></span>
          <span>Avg utterances / card</span><span>${avg}</span>
          <span>Last card (utterances)</span><span>${last} <span class="voice-acc-sub">(this card’s cycle)</span></span>
          <span>Voice set+number lookups</span><span>${voiceAcc.voiceParseLookups}</span>
          <span>Manual Look Up taps</span><span>${voiceAcc.manualLookups}</span>
          <span>Not found</span><span>${voiceAcc.failedLookups}</span>
          <span>Same print again</span><span>${voiceAcc.samePrintReheard} <span class="voice-acc-sub">(re-spoke same set·# while preview up)</span></span>
          <span>Confirm → new parse</span><span>${voiceAcc.confirmReparses} <span class="voice-acc-sub">(changed card without saying “no”)</span></span>
          <span>Extra “yes”</span><span>${voiceAcc.extraYesBeforeAdd} <span class="voice-acc-sub">(more than one yes before add stuck)</span></span>
        </div>
        <p class="voice-acc-hint">Rough goal: <strong>2</strong> finals per card (set + number, then yes). <strong>Overall accuracy</strong> blends that efficiency (55%) with a penalty-based “smooth” score (45%) for skips, not-found, repeating the same print, reparsing from confirm, extra yes, and manual Look Up.</p>
      </div>
    </details>`;
}

function resetVoiceAccSession() {
  initVoiceAccSession();
  voicePendingYesCount = 0;
  renderVoiceAccPanel();
}

function clearCardPanel() {
  document.getElementById('voiceLookupResult').innerHTML = '';
  document.getElementById('voiceAddBtn').disabled = true;
}

function _formatVoiceDeckName() {
  const base = 'Untitled Deck';
  const names = new Set((decks || []).map(d => String(d.name || '').trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let n = 1;
  while (names.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

function _getVoiceDeckTarget() {
  if (!voiceDeckTargetId) return null;
  return decks.find(d => d.id === voiceDeckTargetId) || null;
}

function _ensureVoiceDeckTarget() {
  let deck = _getVoiceDeckTarget();
  if (deck) return deck;
  const id = `${Date.now()}_voice`;
  deck = {
    id,
    name: _formatVoiceDeckName(),
    format: 'Casual',
    commander: null,
    commanderColorIdentity: [],
    commanderImage: null,
    notes: 'Created from Voice Deck mode',
    cards: [],
    sideboard: [],
    colors: [],
  };
  decks.push(deck);
  voiceDeckTargetId = id;
  localStorage.setItem('mtg_voice_deck_target_id', id);
  if (document.getElementById('tab-decks')?.classList.contains('active') && typeof renderDecks === 'function') {
    renderDecks();
  }
  return deck;
}

function renderVoiceDeckModeControls() {
  const btn = document.getElementById('voiceNewDeckToggleBtn');
  if (!btn) return;
  btn.classList.toggle('active', !!voiceDeckModeEnabled);
  btn.textContent = voiceDeckModeEnabled ? 'New Deck On' : 'New Deck';
}

// Single source of truth for "add scanned/looked-up cards to my collection".
// Controlled by the always-visible toggle (default on). Applies to every voice/search
// entry — plain collection capture, adding to the active deck, and New Deck mode.
function voiceShouldAddCollectionInDeckMode() {
  return !!voiceDeckAddToCollectionEnabled;
}
globalThis.voiceShouldAddCollectionInDeckMode = voiceShouldAddCollectionInDeckMode;

function renderVoiceDeckCollectionToggle() {
  const wrap = document.getElementById('voiceDeckCollectionToggleWrap');
  const chk = document.getElementById('voiceDeckAddCollectionChk');
  if (!wrap || !chk) return;
  const show = !!voiceAddToActiveDeckMode && (
    typeof isDeckOwnershipEnabled === 'function'
      ? isDeckOwnershipEnabled()
      : (typeof deckOwnershipEnabled === 'undefined' || deckOwnershipEnabled !== false)
  );
  wrap.style.display = show ? '' : 'none';
  chk.checked = !!voiceDeckAddToCollectionEnabled;

  // Pool toggle: all collections shared with me (not used when editing a shared deck — owner collection is automatic)
  const poolWrap = document.getElementById('deckPoolSourceWrap');
  if (poolWrap) {
    const onSharedDeck = typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared;
    const hasShared = typeof sharedCollections !== 'undefined' && sharedCollections.length > 0;
    // Show the pool toggle whenever adding to a (non-shared) deck so "My Collection" /
    // "All Cards" is always available; "Shared With Me" only when shared collections exist.
    poolWrap.style.display = !!voiceAddToActiveDeckMode && !onSharedDeck ? '' : 'none';
    const sharedBtn = document.getElementById('deckPoolSharedBtn');
    if (sharedBtn) sharedBtn.style.display = hasShared ? '' : 'none';
    // Sync button active states with current pool source
    const src = typeof _deckPoolSource !== 'undefined' ? _deckPoolSource : 'mine';
    document.getElementById('deckPoolMineBtn')?.classList.toggle('active', src === 'mine');
    document.getElementById('deckPoolAllBtn')?.classList.toggle('active', src === 'all');
    document.getElementById('deckPoolSharedBtn')?.classList.toggle('active', src === 'sharedWith');
  }
}

function toggleVoiceDeckAddCollection() {
  const chk = document.getElementById('voiceDeckAddCollectionChk');
  voiceDeckAddToCollectionEnabled = !!chk?.checked;
  localStorage.setItem('mtg_voice_deck_add_collection', voiceDeckAddToCollectionEnabled ? '1' : '0');
}

// ── Deck vs planned-adds destination (shown only when the deck's Adds & Cuts toggle is on) ──

function voiceDeckAddTargetIsAdds() {
  if (voiceDeckAddTarget !== 'adds' || !voiceAddToActiveDeckMode) return false;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  return !!(deck && typeof _deckSwapsEnabled === 'function' && _deckSwapsEnabled(deck));
}
globalThis.voiceDeckAddTargetIsAdds = voiceDeckAddTargetIsAdds;

function renderVoiceDeckTargetBar() {
  const bar = document.getElementById('voiceDeckTargetBar');
  if (!bar) return;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  const show = !!voiceAddToActiveDeckMode && !!deck
    && typeof _deckSwapsEnabled === 'function' && _deckSwapsEnabled(deck)
    && (typeof canEditActiveDeck !== 'function' || canEditActiveDeck());
  bar.style.display = show ? 'flex' : 'none';
  if (!show) { voiceDeckAddTarget = 'deck'; return; }
  document.getElementById('voiceTargetDeckBtn')?.classList.toggle('active', voiceDeckAddTarget !== 'adds');
  document.getElementById('voiceTargetAddsBtn')?.classList.toggle('active', voiceDeckAddTarget === 'adds');
}

function setVoiceDeckAddTarget(target) {
  voiceDeckAddTarget = target === 'adds' ? 'adds' : 'deck';
  renderVoiceDeckTargetBar();
}

function toggleVoiceNewDeckMode() {
  if (voiceDeckModeEnabled) {
    voiceDeckModeEnabled = false;
    localStorage.setItem('mtg_voice_deck_mode', '0');
    voiceDeckTargetId = '';
    localStorage.removeItem('mtg_voice_deck_target_id');
    renderVoiceDeckModeControls();
    showNotif('Voice deck capture off');
    return;
  }
  voiceDeckModeEnabled = true;
  localStorage.setItem('mtg_voice_deck_mode', '1');
  voiceDeckTargetId = '';
  localStorage.removeItem('mtg_voice_deck_target_id');
  const deck = _ensureVoiceDeckTarget();
  save('decks');
  renderVoiceDeckModeControls();
  if (deck) showNotif(`Capturing into "${deck.name}"`);
}

function switchVoiceTab(tab) {
  const isVoice = tab === 'voice';
  document.getElementById('voiceTabContent').style.display = isVoice ? '' : 'none';
  document.getElementById('searchTabContent').style.display = isVoice ? 'none' : '';
  document.getElementById('voiceTabBtn').classList.toggle('active', isVoice);
  document.getElementById('searchTabBtn').classList.toggle('active', !isVoice);
  const modal = document.getElementById('voiceModal');
  const modalEl = modal?.querySelector('.modal');
  modal?.classList.toggle('search-mode', !isVoice);
  if (modalEl) modalEl.style.width = isVoice ? 'min(960px,96vw)' : '';
  if (!isVoice) {
    if (isListening) stopRecording();
    if (typeof _updateFindPaperOnlyState === 'function') _updateFindPaperOnlyState();
    setTimeout(() => document.getElementById('findCardInput')?.focus(), 60);
  } else if (modal?.classList.contains('open') && !isListening) {
    voiceAutoRestart = true;
    startRecording();
  }
}

function openVoice(options) {
  const opts = options && typeof options === 'object' ? options : {};
  voiceAddToActiveDeckMode = !!opts.addToActiveDeck;
  if (voiceAddToActiveDeckMode) {
    if (typeof getActiveDeck !== 'function' || !getActiveDeck()) {
      voiceAddToActiveDeckMode = false;
      showNotif('Select a deck first.', true);
      return;
    }
    if (typeof canEditActiveDeck === 'function' && !canEditActiveDeck()) {
      voiceAddToActiveDeckMode = false;
      showNotif('You have view-only access to this deck.', true);
      return;
    }
  }
  document.getElementById('voiceModal').classList.add('open');
  // Fuzzy set matching is a no-op until allSets loads — make sure it's loading now
  if ((!Array.isArray(allSets) || !allSets.length) && typeof loadSets === 'function') {
    loadSets().catch(() => {});
  }
  voiceCardFetchCache.clear();
  _voicePrefetchLastKey = '';
  voiceSessionConfirmedSets.clear();
  lastSetCodeCandidates = [];
  lastParseSpokenCode = '';
  toggleVoiceSearchSettings(false);
  renderVoiceSetSearchSettings();
  switchVoiceTab(voiceAddToActiveDeckMode ? 'search' : 'voice');
  pendingCard = null;
  voiceMode = 'scan';
  voiceAutoRestart = true;
  clearCardPanel();
  document.getElementById('voiceTranscript').textContent = 'Listening… say set code and number';
  document.getElementById('voiceParsed').innerHTML = '';
  document.getElementById('voiceStatus').textContent = '🔴 Listening… say set code and number';
  pendingFoil = false;
  const foilBtn = document.getElementById('foilToggleBtn');
  foilBtn.innerHTML = SVG_DIAMOND + ' Foil';
  foilBtn.style.color = '';
  foilBtn.style.borderColor = '';
  renderPinnedSet();
  renderAutoPinBtn();
  renderVoiceDeckModeControls();
  renderVoiceDeckCollectionToggle();
  voiceDeckAddTarget = 'deck';
  renderVoiceDeckTargetBar();
  if (voiceAddToActiveDeckMode && typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared) {
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (deck && typeof loadDeckOwnerCollectionLookup === 'function') {
      loadDeckOwnerCollectionLookup(deck);
    }
  }
  initVoiceAccSession();
  voicePendingYesCount = 0;
  renderVoiceAccPanel();
  if (voiceAccTimer) clearInterval(voiceAccTimer);
  voiceAccTimer = setInterval(() => renderVoiceAccPanel(), 1000);
  // Mic is tab-driven: switchVoiceTab() above starts recording only when the Voice tab is
  // active, so opening "Add cards" (Search tab) no longer turns the microphone on.
}

function closeVoice() {
  voiceAddToActiveDeckMode = false;
  voiceAutoRestart = false;
  voiceMode = 'scan';
  toggleVoiceSearchSettings(false);
  document.getElementById('voiceModal').classList.remove('open');
  if (isListening) stopRecording();
  const inp = document.getElementById('findCardInput');
  const res = document.getElementById('findCardResults');
  const ac  = document.getElementById('findCardAutocomplete');
  if (inp) inp.value = '';
  if (res) res.innerHTML = '';
  if (ac)  ac.style.display = 'none';
  if (typeof clearFindColorFilters === 'function') clearFindColorFilters();
  if (typeof clearDeckOwnerCollectionLookup === 'function') clearDeckOwnerCollectionLookup();
  if (voiceAccTimer) {
    clearInterval(voiceAccTimer);
    voiceAccTimer = null;
  }
  renderVoiceDeckCollectionToggle();
}

function toggleRecording() {
  if (isListening) {
    stopRecording();
  } else {
    voiceAutoRestart = true;
    startRecording();
  }
}

async function startRecording() {
  if (isListening) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showNotif('Speech recognition not supported in this browser. Use Chrome.', true);
    return;
  }
  if (!mtgIsSecureMediaContext()) {
    showNotif(
      'Microphone needs HTTPS on this device (same as camera). Run npm run setup:https, trust the CA on your phone, then npm run cap:device.',
      true,
    );
    voiceAutoRestart = false;
    return;
  }
  if (!micStream) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStorage.setItem('mtg_mic_granted', '1');
    } catch(e) {
      document.getElementById('voiceTranscript').textContent = 'Microphone permission denied.';
      document.getElementById('voiceStatus').textContent = 'Allow microphone in browser settings';
      voiceAutoRestart = false;
      return;
    }
  }
  if (!recognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    // Continuous: one long-lived session across utterances. Non-continuous mode killed the
    // session after every final (incl. "yes"), and the teardown + restart + warm-up gap
    // clipped the first words of the next card.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    let lastFinalText = '';
    let lastFinalAt = 0;
    recognition.onresult = e => {
      const transcriptEl = document.getElementById('voiceTranscript');
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res.isFinal) { interim += res[0].transcript; continue; }
        const raw = voiceMode === 'scan'
          ? pickBestAlternative(Array.from({ length: res.length }, (_, k) => res[k].transcript))
          : res[0].transcript;
        const t = normalizeVoiceTranscript(raw).trim();
        if (!t) continue;
        // Android Chrome can duplicate finals in continuous mode — drop immediate repeats
        if (t === lastFinalText && Date.now() - lastFinalAt < 1500) continue;
        lastFinalText = t;
        lastFinalAt = Date.now();
        transcriptEl.textContent = t;
        bumpVoiceAccFinalUtterance();
        if (voiceMode === 'confirm') {
          handleVoiceConfirmation(t);
        } else {
          parseVoiceInput(t);
        }
      }
      if (interim.trim()) {
        transcriptEl.textContent = normalizeVoiceTranscript(interim);
        maybePrefetchFromInterim(interim);
      }
    };
    recognition.onerror = e => {
      isListening = false;
      document.getElementById('voiceOrb').classList.remove('listening');
      if (e.error === 'no-speech') {
        if (voiceAutoRestart && document.getElementById('voiceModal').classList.contains('open')) {
          setTimeout(() => { if (voiceAutoRestart) startRecording(); }, 100);
        }
      } else if (e.error === 'not-allowed') {
        voiceAutoRestart = false;
        micStream = null;
        localStorage.removeItem('mtg_mic_granted');
        document.getElementById('voiceStatus').textContent = 'Microphone blocked — check browser site settings';
      } else {
        document.getElementById('voiceStatus').textContent = 'Error: ' + e.error;
      }
    };
    recognition.onend = () => {
      isListening = false;
      document.getElementById('voiceOrb').classList.remove('listening');
      if (voiceAutoRestart && document.getElementById('voiceModal').classList.contains('open')) {
        // Continuous sessions still end on silence timeouts / network blips — restart fast
        setTimeout(() => { if (voiceAutoRestart) startRecording(); }, 100);
      } else {
        document.getElementById('voiceStatus').textContent = 'Click orb to listen';
      }
    };
  }
  try {
    recognition.start();
    isListening = true;
    document.getElementById('voiceOrb').classList.add('listening');
    document.getElementById('voiceStatus').textContent =
      voiceMode === 'confirm' ? '🔴 Say "yes" to add or "no" to skip…' : '🔴 Listening… say set code and number';
  } catch(e) {
    // recognition.start() throws if already started — safe to ignore
  }
}

function stopRecording() {
  voiceAutoRestart = false;
  if (recognition) { try { recognition.stop(); } catch(e) {} }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  isListening = false;
  document.getElementById('voiceOrb').classList.remove('listening');
  document.getElementById('voiceStatus').textContent = 'Click orb to listen';
}

function handleVoiceConfirmation(text) {
  text = normalizeVoiceTranscript(text);
  const lower = text.toLowerCase();
  // Word-boundary matching so "know"/"number nine" don't read as "no", "broken" as "ok", etc.
  const noRe = /\b(no|nope|wrong|cancel|skip|next|redo|not\s+(that|it)|incorrect)\b/;
  const yesRe = /\b(yes|yeah|yep|yup|correct|confirm|right|sure|ok|okay|do\s+it|add(\s+it)?|that\s+one|perfect|great)\b/;
  if (!pendingCard) return;
  const collapsed = collapseSpokenLetterRuns(text);
  const hasDigits = /\b\d{1,4}\b/.test(collapsed);
  const hasPotentialSet = new RegExp(
    '\\b([A-Za-z0-9])\\s([A-Za-z0-9])\\s([A-Za-z0-9])\\b|' + SET_CODE_TOKEN_SRC, 'i',
  ).test(collapsed);
  const canUseBufferedOrPinned = !!(pinnedSetCode || (lastHeardSetCode && (Date.now() - lastHeardSetTime) < 8000));
  if (noRe.test(lower)) {
    voicePendingYesCount = 0;
    if (voiceAcc) {
      voiceAcc.noSkips++;
      voiceAccNoteCardResolved();
    }
    lastRejectedCode = pendingCard ? pendingCard.set.toUpperCase() : '';
    lastParseSpokenCode = '';
    pendingCard = null;
    clearCardPanel();
    document.getElementById('voiceParsed').innerHTML = '';
    document.getElementById('manualSetCode').value = '';
    document.getElementById('manualCardNum').value = '';
    voiceMode = 'scan';
    document.getElementById('voiceTranscript').textContent = 'Skipped — say next card…';
  } else if (hasDigits && (hasPotentialSet || canUseBufferedOrPinned)) {
    // Re-search wins over yes-words: "add BLB 42" means a new card, not "add this one".
    // Speaking another set/number replaces the candidate without an explicit "no" first.
    if (voiceAcc) {
      voiceAcc.confirmReparses++;
      renderVoiceAccPanel();
    }
    voiceMode = 'scan';
    parseVoiceInput(text);
  } else if (yesRe.test(lower)) {
    voicePendingYesCount++;
    confirmVoiceAdd(true);
  }
}

function toggleFoil() {
  pendingFoil = !pendingFoil;
  const btn = document.getElementById('foilToggleBtn');
  btn.innerHTML = pendingFoil ? SVG_DIAMOND_ON + ' Foil' : SVG_DIAMOND + ' Foil';
  btn.style.color = pendingFoil ? 'var(--gold)' : '';
  btn.style.borderColor = pendingFoil ? 'var(--gold)' : '';
  if (pendingCard) {
    pendingCard.foil = pendingFoil;
    lookupManual('foil');
  }
}

function toggleAutoPin() {
  autoPinEnabled = !autoPinEnabled;
  localStorage.setItem('mtg_auto_pin', autoPinEnabled ? '1' : '0');
  autoPin_lastSet = ''; autoPin_setStreak = 0; autoPin_ovStreak = 0;
  renderAutoPinBtn();
  showNotif(`Auto-pin ${autoPinEnabled ? 'enabled' : 'disabled'}`);
}

function renderAutoPinBtn() {
  [document.getElementById('autoPinToggleBtn'), document.getElementById('settingsAutoPinBtn')]
    .filter(Boolean).forEach(btn => {
      btn.innerHTML = SVG_PIN + (autoPinEnabled ? ' Auto-pin: on' : ' Auto-pin');
      btn.style.color = autoPinEnabled ? 'var(--teal)' : '';
      btn.style.borderColor = autoPinEnabled ? 'var(--teal)' : '';
    });
}

function clearVoiceCorrections() {
  voiceCorrections = {};
  localStorage.removeItem('mtg_voice_corrections');
  showNotif('Voice corrections cleared');
}

function pinCurrentSet() {
  const input = document.getElementById('manualSetCode').value.trim().toUpperCase();
  const code = input.length === 3 ? input : pinnedSetCode;
  if (!code) { showNotif('Enter or say a set code first', true); return; }
  pinnedSetCode = code;
  localStorage.setItem('mtg_pinned_set', code);
  renderPinnedSet();
  showNotif(`Set ${code} pinned — just say the number now`);
}

function unpinSet() {
  pinnedSetCode = '';
  localStorage.removeItem('mtg_pinned_set');
  renderPinnedSet();
}

function renderPinnedSet() {
  const badge = document.getElementById('pinnedSetBadge');
  const hint = document.getElementById('pinnedSetHint');
  const none = document.getElementById('pinnedSetNone');
  const pinBtn = document.getElementById('pinSetBtn');
  const unpinBtn = document.getElementById('unpinSetBtn');
  if (pinnedSetCode) {
    badge.innerHTML = SVG_PIN + ' ' + pinnedSetCode;
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '3px';
    hint.style.display = 'inline';
    none.style.display = 'none';
    unpinBtn.style.display = 'inline-flex';
    pinBtn.innerHTML = SVG_PIN + ' Update';
  } else {
    badge.style.display = 'none';
    hint.style.display = 'none';
    none.style.display = '';
    unpinBtn.style.display = 'none';
    pinBtn.innerHTML = SVG_PIN + ' Pin';
  }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({length: m + 1}, (_, i) => Array.from({length: n + 1}, (_, j) => i ? (j ? 0 : i) : j));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1] : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
  return d[m][n];
}

function matchToSetCode(candidate) {
  if (!candidate || !allSets.length) return candidate;
  const known = allSets.map(s => s.code.toUpperCase());
  if (known.includes(candidate)) return candidate;
  let best = null, bestDist = Infinity;
  for (const code of known) {
    const dist = levenshtein(candidate, code);
    if (dist < bestDist) { bestDist = dist; best = code; }
  }
  return bestDist <= 2 ? best : candidate;
}

// Pick the recognition alternative whose candidate set code is closest to a real set code.
// Falls back to alternative[0] when the set is already known (pinned/buffered) or no set data.
function pickBestAlternative(alternatives) {
  if (alternatives.length <= 1 || !allSets.length) return normalizeVoiceTranscript(alternatives[0]);
  const entries = _voiceEligibleSetEntries();
  if (!entries.length) return normalizeVoiceTranscript(alternatives[0]);
  const knownCodes = new Set(entries.map(e => e.code));
  const codeRe = new RegExp(SET_CODE_TOKEN_SRC, 'g');
  let best = alternatives[0], bestScore = Infinity;
  for (const alt of alternatives) {
    const norm = collapseSpokenLetterRuns(normalizeVoiceTranscript(alt));
    const codes = [...norm.toUpperCase().matchAll(codeRe)]
      .map(m => m[1]).filter(c => !skipWords.has(c));
    if (!codes.length) continue;
    let score = Math.min(...codes.map(c => {
      if (knownCodes.has(c)) return 0;
      let min = Infinity;
      for (const e of entries) { const d = voiceWeightedDistance(c, e.code); if (d < min) min = d; }
      return min;
    }));
    if (/\d/.test(norm)) score -= 0.05; // slight preference for alternatives that also carry a number
    if (score < bestScore) { bestScore = score; best = alt; }
  }
  return normalizeVoiceTranscript(best);
}

/** Ranked fuzzy candidates from the last voice parse (for auto-retry when the top pick 404s). */
let lastSetCodeCandidates = [];
/** Raw code heard on the last voice parse (pre-correction) — learning source for confirm/manual fixes. */
let lastParseSpokenCode = '';

function parseVoiceInput(text) {
  text = normalizeVoiceTranscript(text);
  // Collapse spelled-out codes: "em aitch three" → "MH3", "D M R" → "DMR"
  text = collapseSpokenLetterRuns(text);
  text = text.replace(/\b([A-Za-z0-9])\s([A-Za-z0-9])\s([A-Za-z0-9])\b/g, (m, a, b, c) =>
    /[A-Za-z]/.test(a + b + c) ? a + b + c : m);

  const upper = text.toUpperCase();

  const isFoil = /\bfoil\b/i.test(text);
  if (isFoil !== pendingFoil) {
    pendingFoil = isFoil;
    const foilBtn = document.getElementById('foilToggleBtn');
    foilBtn.innerHTML = pendingFoil ? SVG_DIAMOND_ON + ' Foil' : SVG_DIAMOND + ' Foil';
    foilBtn.style.color = pendingFoil ? 'var(--gold)' : '';
    foilBtn.style.borderColor = pendingFoil ? 'var(--gold)' : '';
  }

  const allCodes = [...upper.matchAll(new RegExp(SET_CODE_TOKEN_SRC, 'g'))]
    .map(m => m[1])
    .filter(c => !skipWords.has(c));
  const spokenCode = allCodes[0] || '';

  // Apply phonetic map first, then check learned corrections, then weighted fuzzy-match
  // against pref-filtered sets (keep runners-up so a 404 can auto-retry them)
  const phonetic = PHONETIC_MAP[spokenCode] || spokenCode;
  const learned = phonetic && voiceCorrections[phonetic];         // key = what was heard
  // An exact real set code always wins — even one the prefs exclude (the lookup will show
  // the "filtered" message rather than silently remapping to a different set)
  const exactAnySet = !!phonetic && Array.isArray(allSets) &&
    allSets.some(s => String(s.code || '').toUpperCase() === phonetic);
  const fuzzyCands = phonetic && !exactAnySet ? matchVoiceSetCodeCandidates(phonetic, 4) : [];
  const fuzzyBest = fuzzyCands.length ? fuzzyCands[0].code : '';
  const matchedCode = learned ? learned : (exactAnySet ? phonetic : (fuzzyBest || phonetic));
  lastSetCodeCandidates = learned
    ? [learned, ...fuzzyCands.map(c => c.code).filter(c => c !== learned)]
    : fuzzyCands.map(c => c.code);
  if (spokenCode) lastParseSpokenCode = spokenCode;
  const validatedCode = matchedCode;
  const fuzzyFixed = !!(phonetic && matchedCode && matchedCode !== phonetic && !learned);
  // Only record for auto-learning when fuzzy matching actually changed something
  if (fuzzyFixed) lastRawSpokenCode = spokenCode;
  else lastRawSpokenCode = '';

  // Buffer: remember a recently heard set code so user can pause between set and number
  const now = Date.now();
  const bufferedCode = (!validatedCode && lastHeardSetCode && (now - lastHeardSetTime) < 8000)
    ? lastHeardSetCode : '';
  if (validatedCode) { lastHeardSetCode = validatedCode; lastHeardSetTime = now; }
  const effectiveCode = validatedCode || bufferedCode;

  let setCode = '';
  let usingOverride = false;

  if (pinnedSetCode) {
    if (effectiveCode && effectiveCode !== pinnedSetCode) {
      setCode = effectiveCode;
      usingOverride = true;
    } else {
      setCode = pinnedSetCode;
    }
  } else {
    setCode = effectiveCode;
  }

  const numMatch = text.match(/\b(\d{1,4})\b/);
  const wordMap = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
    ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
    eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,
    eighty:80,ninety:90,hundred:100};
  let spokenNum = null;
  const excludePattern = new RegExp(`\\b(foil${setCode ? '|' + setCode : ''})\\b`, 'gi');
  const words = text.replace(excludePattern, '').toLowerCase().split(/\s+/).filter(Boolean);
  const numWords = words.filter(w => wordMap[w] !== undefined);
  if (numWords.length > 1 && numWords.every(w => wordMap[w] <= 9)) {
    // Digit-by-digit: "two four" → 24, "one two four" → 124
    spokenNum = parseInt(numWords.map(w => wordMap[w]).join(''));
  } else {
    let acc = 0, last = 0;
    words.forEach(w => {
      if (wordMap[w] !== undefined) {
        if (wordMap[w] === 100) { acc = (acc || 1) * 100; }
        else if (wordMap[w] >= 20) { last = wordMap[w]; }
        else { acc += last + wordMap[w]; last = 0; }
      }
    });
    if (acc + last > 0) spokenNum = acc + last;
  }
  const num = numMatch ? numMatch[1] : (spokenNum ? String(spokenNum) : '');

  const parsedEl = document.getElementById('voiceParsed');
  parsedEl.innerHTML = '';
  if (usingOverride) {
    parsedEl.innerHTML += `<div class="voice-tag" style="border-color:var(--teal);color:var(--teal)"><span>↺ Override</span>${setCode}</div>`;
  } else if (pinnedSetCode) {
    parsedEl.innerHTML += `<div class="voice-tag" style="border-color:var(--gold)"><span>${SVG_PIN} Set</span>${pinnedSetCode}</div>`;
  } else if (setCode) {
    if (learned)
      parsedEl.innerHTML += `<div class="voice-tag" style="border-color:var(--purple,#a78bfa);color:var(--purple,#a78bfa)"><span>${SVG_MIC_X} learned</span>${setCode}</div>`;
    else if (fuzzyFixed)
      parsedEl.innerHTML += `<div class="voice-tag" style="border-color:var(--teal);color:var(--teal)"><span>~ fixed</span>${setCode}</div>`;
    else
      parsedEl.innerHTML += `<div class="voice-tag"><span>Set</span>${setCode}</div>`;
  }
  if (num) parsedEl.innerHTML += `<div class="voice-tag"><span>#</span>${num}</div>`;
  if (isFoil) parsedEl.innerHTML += `<div class="voice-tag" style="color:var(--gold);border-color:var(--gold)"><span>${SVG_DIAMOND_ON}</span>Foil</div>`;

  if (setCode && num) {
    document.getElementById('manualSetCode').value = setCode;
    document.getElementById('manualCardNum').value = num;
    lookupManual('parse');
  }
}

async function lookupManual(source = 'manual') {
  const setCode = document.getElementById('manualSetCode').value.trim();
  const num = document.getElementById('manualCardNum').value.trim();
  if (!setCode || !num) return;

  if (voiceAcc && document.getElementById('voiceModal')?.classList.contains('open')) {
    const key = `${setCode.toUpperCase()}|${String(num).trim()}|${!!pendingFoil}`;
    if (pendingCard && source === 'parse') {
      const pkey = `${String(pendingCard.set).toUpperCase()}|${String(pendingCard.number).trim()}|${!!pendingCard.foil}`;
      if (pkey === key) voiceAcc.samePrintReheard++;
    }
    if (source === 'parse') voiceAcc.voiceParseLookups++;
    else if (source === 'manual') voiceAcc.manualLookups++;
  }

  // Manual set-code edits are a learning signal: the user heard something the recognizer
  // garbled into a non-set, then typed the real code. Only learn when the spoken code
  // wasn't itself a real set (so switching cards manually doesn't create bogus mappings).
  if (source === 'manual' && lastParseSpokenCode) {
    const manualUpper = setCode.toUpperCase();
    const spokenWasRealSet = Array.isArray(allSets) &&
      allSets.some(s => String(s.code || '').toUpperCase() === lastParseSpokenCode);
    if (!spokenWasRealSet && manualUpper !== lastParseSpokenCode) {
      lastRawSpokenCode = lastParseSpokenCode;
    }
  }

  voiceMode = 'confirm'; // lock before fetch so yes/no during load don't hit parseVoiceInput
  pendingCard = null;
  const el = document.getElementById('voiceLookupResult');
  el.innerHTML = '<div style="aspect-ratio:5/7;display:flex;align-items:center;justify-content:center;color:var(--text2);gap:8px"><div class="spinner"></div></div>';

  let card = await fetchVoiceCardCached(setCode, num);
  if (!card && source === 'parse' && Array.isArray(lastSetCodeCandidates) && lastSetCodeCandidates.length) {
    // Top fuzzy pick 404'd — try the runner-up candidates before giving up
    const numInt = parseInt(num, 10);
    for (const alt of lastSetCodeCandidates) {
      if (!alt || alt.toUpperCase() === setCode.toUpperCase()) continue;
      const meta = _voiceSetMeta(alt);
      if (meta && meta.card_count && Number.isFinite(numInt) && numInt > meta.card_count) continue;
      const altCard = await fetchVoiceCardCached(alt, num);
      if (!altCard) continue;
      card = altCard;
      document.getElementById('manualSetCode').value = alt;
      lastHeardSetCode = alt;
      lastHeardSetTime = Date.now();
      if (lastParseSpokenCode && lastParseSpokenCode !== alt) lastRawSpokenCode = lastParseSpokenCode;
      const parsedEl = document.getElementById('voiceParsed');
      if (parsedEl) parsedEl.innerHTML += `<div class="voice-tag" style="border-color:var(--teal);color:var(--teal)"><span>~ retried</span>${alt}</div>`;
      break;
    }
  }
  if (!card) {
    if (voiceAcc) voiceAcc.failedLookups++;
    el.innerHTML = `<div style="aspect-ratio:5/7;display:flex;align-items:center;justify-content:center;border:1px dashed var(--red);border-radius:8px;color:var(--red);font-size:0.8rem;text-align:center;padding:8px">Not found:<br>${setCode} #${num}</div>`;
    document.getElementById('voiceAddBtn').disabled = true;
    pendingCard = null;
    voiceMode = 'scan';
    voicePendingYesCount = 0;
    renderVoiceAccPanel();
    return;
  }
  if (!voiceCardAllowedBySetPrefs(card)) {
    const setLabel = String(card.set || setCode || '').toUpperCase();
    el.innerHTML = `<div style="aspect-ratio:5/7;display:flex;align-items:center;justify-content:center;border:1px dashed var(--text3);border-radius:8px;color:var(--text2);font-size:0.8rem;text-align:center;padding:8px">Filtered by voice set settings:<br>${setLabel} #${num}</div>`;
    document.getElementById('voiceAddBtn').disabled = true;
    pendingCard = null;
    voiceMode = 'scan';
    voicePendingYesCount = 0;
    renderVoiceAccPanel();
    return;
  }

  voicePendingYesCount = 0;
  pendingCard = cardToEntry(card, parseInt(document.getElementById('manualQty').value) || 1);
  pendingCard.foil = pendingFoil;
  pendingCard.uid = pendingCard.scryfallId + (pendingCard.foil ? '_f' : '_n');
  const ownedEntry = collection.find(c => c.uid === pendingCard.uid);
  const vendors = typeof getPriceVendorEnabled === 'function'
    ? getPriceVendorEnabled()
    : { tcg: true, ck: true };
  const displayPrice = vendors.tcg ? getTCGPriceForCard(pendingCard) : 0;
  const displayCKPrice = vendors.ck ? getCKPriceForCard(pendingCard) : 0;
  const collectionStatusHtml = ownedEntry
    ? `<span class="voice-owned-print-badge" title="This set · number · foil is already in your collection">In collection ×${ownedEntry.qty}</span>`
    : `<span class="voice-new-to-collection-badge" title="No copy of this printing in your collection yet">New to collection</span>`;
  const priceBadgesHtml = [
    displayPrice > 0
      ? `<span class="price-badge price-tcg" style="font-size:0.68rem">${pendingCard.foil && pendingCard.priceTCGFoil > 0 ? 'Foil' : 'TCG'} $${displayPrice.toFixed(2)}</span>`
      : '',
    displayCKPrice > 0
      ? `<span class="price-badge price-ck" style="font-size:0.68rem">${pendingCard.foil ? 'CK Foil' : 'CK'} $${displayCKPrice.toFixed(2)}</span>`
      : '',
  ].filter(Boolean).join('');
  el.innerHTML = `
    <div style="background:var(--bg3);border:1px solid ${pendingCard.foil ? 'var(--gold)' : 'var(--border2)'};border-radius:var(--radius2);padding:10px">
      <div style="position:relative;overflow:hidden;border-radius:6px;margin-bottom:8px">
        ${pendingCard.image ? `<img src="${pendingCard.image}" style="width:100%;display:block;border-radius:6px">` : ''}
        ${pendingCard.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
      </div>
      <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:0.82rem;margin-bottom:3px;line-height:1.2">${pendingCard.name}</div>
      <div style="font-size:0.72rem;color:var(--text2);margin-bottom:2px;font-style:italic">${pendingCard.set.toUpperCase()} · #${pendingCard.number}</div>
      <div style="margin-bottom:6px">${collectionStatusHtml}</div>
      <div style="font-size:0.7rem;color:var(--text2);margin-bottom:8px">${pendingCard.type}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
        ${priceBadgesHtml}
      </div>
      ${typeof _htmlPurchasePriceOptIn === 'function' ? _htmlPurchasePriceOptIn('voicePurchase') : ''}
    </div>`;
  document.getElementById('voiceAddBtn').disabled = false;
  voiceMode = 'confirm';
  document.getElementById('voiceStatus').textContent = '🔴 Say "yes" to add or "no" to skip…';
  if (!isListening && voiceAutoRestart) startRecording();
}

function confirmVoiceAdd(fromSpeech) {
  if (!pendingCard) return;
  // If the user rejected a card and then confirmed one with a different set, learn the correction
  const confirmedCode = pendingCard.set.toUpperCase();
  // Auto-learn only from fuzzy-match corrections the user confirmed — not from rejections,
  // which can't tell the difference between a pronunciation fix and just picking a different card
  if (lastRawSpokenCode && lastRawSpokenCode !== confirmedCode) {
    voiceCorrections[lastRawSpokenCode] = confirmedCode;
    localStorage.setItem('mtg_voice_corrections', JSON.stringify(voiceCorrections));
  }
  lastRawSpokenCode = '';
  lastParseSpokenCode = '';
  lastRejectedCode = '';
  voiceSessionConfirmedSets.add(confirmedCode); // prior for fuzzy matching this session

  if (autoPinEnabled) {
    const cSet = confirmedCode;
    if (pinnedSetCode) {
      if (cSet !== pinnedSetCode) {
        // Override: different set used while one is pinned
        autoPin_ovStreak++;
        autoPin_lastSet = cSet;
        autoPin_setStreak = 1;
        if (autoPin_ovStreak >= 2) {
          pinnedSetCode = '';
          localStorage.removeItem('mtg_pinned_set');
          renderPinnedSet();
          autoPin_ovStreak = 0;
          showNotif(`Auto-unpinned — ${cSet} overrode twice in a row`);
        }
      } else {
        autoPin_ovStreak = 0;
      }
    } else {
      if (cSet === autoPin_lastSet) {
        autoPin_setStreak++;
        if (autoPin_setStreak >= 2) {
          pinnedSetCode = cSet;
          localStorage.setItem('mtg_pinned_set', cSet);
          renderPinnedSet();
          autoPin_setStreak = 0;
          showNotif(`Auto-pinned set ${cSet}`);
        }
      } else {
        autoPin_lastSet = cSet;
        autoPin_setStreak = 1;
      }
      autoPin_ovStreak = 0;
    }
  }

  const addToCollectionThisRun = voiceShouldAddCollectionInDeckMode();
  if (addToCollectionThisRun) {
    const existingCollection = collection.find(c => c.uid === pendingCard.uid);
    const opt = typeof readPurchasePriceOptIn === 'function' ? readPurchasePriceOptIn('voicePurchase') : { price: null, manual: false };
    if (typeof applyCollectionQtyAdd === 'function') {
      if (existingCollection) {
        applyCollectionQtyAdd(existingCollection, existingCollection, pendingCard.qty, { purchasePrice: opt.price, manual: opt.manual });
      } else {
        applyCollectionQtyAdd(null, pendingCard, pendingCard.qty, { purchasePrice: opt.price, manual: opt.manual });
      }
    } else if (existingCollection) {
      existingCollection.qty += pendingCard.qty;
      existingCollection.addedAt = Date.now();
      recordCollectionEvent('add', existingCollection, pendingCard.qty);
    } else {
      collection.push(pendingCard);
      recordCollectionEvent('add', pendingCard, pendingCard.qty);
    }
  }
  if (voiceAddToActiveDeckMode) {
    if (typeof canEditActiveDeck === 'function' && !canEditActiveDeck()) {
      if (addToCollectionThisRun) {
        save('collection');
        showNotif(`Added ${pendingCard.qty}x ${pendingCard.name} to collection (view-only deck)`, true);
      } else {
        showNotif('You have view-only access to this deck.', true);
      }
    } else {
      const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
      if (!deck) {
        if (addToCollectionThisRun) {
          save('collection');
          showNotif(`Added ${pendingCard.qty}x ${pendingCard.name} to collection only`, true);
        } else {
          showNotif('No active deck selected', true);
        }
      } else if (voiceDeckAddTargetIsAdds()) {
        // Planned adds — no deck history (planning only)
        const pool = _deckPlannedAdds(deck);
        const uid = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(pendingCard) : pendingCard.uid;
        const slot = pool.find(c => getCardInventoryKey(c) === uid);
        if (slot) slot.qty = (slot.qty || 1) + pendingCard.qty;
        else pool.push({ ...pendingCard, uid, qty: pendingCard.qty });
        save(...(addToCollectionThisRun ? ['collection', 'decks'] : ['decks']));
        showNotif(
          addToCollectionThisRun
            ? `Added ${pendingCard.qty}x ${pendingCard.name} to collection + planned adds of "${deck.name}"`
            : `Added ${pendingCard.qty}x ${pendingCard.name} to planned adds of "${deck.name}"`,
        );
        if (typeof renderActiveDeck === 'function') renderActiveDeck();
        if (typeof _renderDeckSearchGrid === 'function') _renderDeckSearchGrid();
      } else {
        const slot = typeof findDeckCardSlot === 'function' ? findDeckCardSlot(deck, pendingCard) : null;
        if (slot) {
          slot.qty += pendingCard.qty;
          recordDeckEvent('add', slot, null, deck.id);
        } else {
          const uid = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(pendingCard) : pendingCard.uid;
          deck.cards.push({ ...pendingCard, uid, qty: pendingCard.qty });
          recordDeckEvent('add', pendingCard, null, deck.id);
        }
        save(...(addToCollectionThisRun ? ['collection', 'decks'] : ['decks']));
        showNotif(
          addToCollectionThisRun
            ? `Added ${pendingCard.qty}x ${pendingCard.name} to collection + "${deck.name}"`
            : `Added ${pendingCard.qty}x ${pendingCard.name} to "${deck.name}"`,
        );
        if (typeof renderActiveDeck === 'function') renderActiveDeck();
        if (typeof _renderDeckSearchGrid === 'function') _renderDeckSearchGrid();
        if (typeof scheduleEDHRECRefresh === 'function') scheduleEDHRECRefresh();
      }
    }
  } else if (voiceDeckModeEnabled) {
    const deck = _ensureVoiceDeckTarget();
    if (!deck) {
      showNotif('Could not create voice deck', true);
      if (voiceAcc) {
        if (fromSpeech) {
          if (voicePendingYesCount > 1) voiceAcc.extraYesBeforeAdd += voicePendingYesCount - 1;
          voiceAcc.cardsAddedSpeech++;
        } else voiceAcc.cardsAddedButton++;
        voiceAccNoteCardResolved();
      }
      return;
    }
    const existingDeck = (deck.cards || []).find(c => c.uid === pendingCard.uid);
    if (existingDeck) {
      existingDeck.qty += pendingCard.qty;
      recordDeckEvent('add', existingDeck, null, deck.id);
    } else {
      deck.cards.push({ ...pendingCard });
      recordDeckEvent('add', pendingCard, null, deck.id);
    }
    save(...(addToCollectionThisRun ? ['collection', 'decks'] : ['decks']));
    showNotif(`Added ${pendingCard.qty}x ${pendingCard.name} to ${addToCollectionThisRun ? 'collection + ' : ''}"${deck.name}"`);
  } else if (addToCollectionThisRun) {
    save('collection');
    showNotif(`Added ${pendingCard.qty}x ${pendingCard.name} to collection`);
  } else {
    showNotif(`"Add to collection" is off — turn it on (or use New Deck) to capture "${pendingCard.name}"`, true);
  }
  if (voiceAcc) {
    if (fromSpeech) {
      if (voicePendingYesCount > 1) voiceAcc.extraYesBeforeAdd += voicePendingYesCount - 1;
      voiceAcc.cardsAddedSpeech++;
    } else voiceAcc.cardsAddedButton++;
    voiceAccNoteCardResolved();
  }
  voicePendingYesCount = 0;
  if (fromSpeech) playVoiceAddDing();
  if (addToCollectionThisRun) {
    renderCollection();
    updateStats();
  }
  renderVoiceDeckModeControls();
  renderVoiceDeckCollectionToggle();
  renderVoiceDeckTargetBar();
  pendingCard = null;
  clearCardPanel();
  document.getElementById('voiceTranscript').textContent = 'Waiting for speech…';
  document.getElementById('voiceParsed').innerHTML = '';
  document.getElementById('manualSetCode').value = '';
  document.getElementById('manualCardNum').value = '';
  pendingFoil = false;
  const foilBtn = document.getElementById('foilToggleBtn');
  if (foilBtn) { foilBtn.innerHTML = SVG_DIAMOND + ' Foil'; foilBtn.style.color = ''; foilBtn.style.borderColor = ''; }
  voiceMode = 'scan';
  if (voiceAutoRestart && !isListening) startRecording();
}

