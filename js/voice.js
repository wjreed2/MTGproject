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

function clearCardPanel() {
  document.getElementById('voiceLookupResult').innerHTML = '';
  document.getElementById('voiceAddBtn').disabled = true;
}

function switchVoiceTab(tab) {
  const isVoice = tab === 'voice';
  document.getElementById('voiceTabContent').style.display = isVoice ? '' : 'none';
  document.getElementById('searchTabContent').style.display = isVoice ? 'none' : '';
  document.getElementById('voiceTabBtn').classList.toggle('active', isVoice);
  document.getElementById('searchTabBtn').classList.toggle('active', !isVoice);
  if (!isVoice) {
    if (isListening) stopRecording();
    setTimeout(() => document.getElementById('findCardInput')?.focus(), 60);
  } else if (document.getElementById('voiceModal').classList.contains('open') && !isListening) {
    voiceAutoRestart = true;
    startRecording();
  }
}

function openVoice() {
  document.getElementById('voiceModal').classList.add('open');
  switchVoiceTab('voice');
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
  if (!isListening) startRecording();
}

function closeVoice() {
  voiceAutoRestart = false;
  voiceMode = 'scan';
  document.getElementById('voiceModal').classList.remove('open');
  if (isListening) stopRecording();
  const inp = document.getElementById('findCardInput');
  const res = document.getElementById('findCardResults');
  const ac  = document.getElementById('findCardAutocomplete');
  if (inp) inp.value = '';
  if (res) res.innerHTML = '';
  if (ac)  ac.style.display = 'none';
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
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.onresult = e => {
      const lastResult = e.results[e.results.length - 1];
      const priorText = Array.from(e.results).slice(0, -1).map(r => r[0].transcript).join('');
      const chosen = (lastResult.isFinal && voiceMode === 'scan')
        ? pickBestAlternative(Array.from({length: lastResult.length}, (_, i) => lastResult[i].transcript))
        : lastResult[0].transcript;
      const t = priorText + chosen;
      document.getElementById('voiceTranscript').textContent = t;
      if (lastResult.isFinal) {
        if (voiceMode === 'confirm') {
          handleVoiceConfirmation(t);
        } else {
          parseVoiceInput(t);
        }
      }
    };
    recognition.onerror = e => {
      isListening = false;
      document.getElementById('voiceOrb').classList.remove('listening');
      if (e.error === 'no-speech') {
        if (voiceAutoRestart && document.getElementById('voiceModal').classList.contains('open')) {
          setTimeout(() => { if (voiceAutoRestart) startRecording(); }, 300);
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
        const awaitingNumber = lastHeardSetCode && (Date.now() - lastHeardSetTime) < 8000;
        setTimeout(() => { if (voiceAutoRestart) startRecording(); }, awaitingNumber ? 800 : 300);
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
  if (!pendingCard) return; // still fetching — ignore until card is ready
  const lower = text.toLowerCase();
  const yesWords = ['yes','yeah','yep','yup','correct','add','confirm','right','sure','ok','okay','do it','add it','that one','perfect','great'];
  const noWords = ['no','nope','wrong','cancel','skip','next','redo','not that','not it','incorrect'];
  if (yesWords.some(w => lower.includes(w))) {
    confirmVoiceAdd();
  } else if (noWords.some(w => lower.includes(w))) {
    lastRejectedCode = pendingCard ? pendingCard.set.toUpperCase() : '';
    pendingCard = null;
    clearCardPanel();
    document.getElementById('voiceParsed').innerHTML = '';
    document.getElementById('manualSetCode').value = '';
    document.getElementById('manualCardNum').value = '';
    voiceMode = 'scan';
    document.getElementById('voiceTranscript').textContent = 'Skipped — say next card…';
  } else {
    // Allow immediate re-search while in confirm mode:
    // speaking another set/number should replace the current candidate
    // without requiring an explicit "no" first.
    const hasDigits = /\b\d{1,4}\b/.test(text);
    const hasPotentialSet = /\b([A-Za-z0-9])\s([A-Za-z0-9])\s([A-Za-z0-9])\b|\b([A-Z][A-Z0-9]{2}|[A-Z0-9][A-Z][A-Z0-9]|[A-Z0-9]{2}[A-Z])\b/i.test(text);
    const canUseBufferedOrPinned = !!(pinnedSetCode || (lastHeardSetCode && (Date.now() - lastHeardSetTime) < 8000));
    if (hasDigits && (hasPotentialSet || canUseBufferedOrPinned)) {
      voiceMode = 'scan';
      parseVoiceInput(text);
    }
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
    lookupManual();
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
  if (alternatives.length <= 1 || !allSets.length) return alternatives[0];
  const knownCodes = new Set(allSets.map(s => s.code.toUpperCase()));
  let best = alternatives[0], bestScore = Infinity;
  for (const alt of alternatives) {
    const norm = alt.replace(/\b([A-Za-z0-9])\s([A-Za-z0-9])\s([A-Za-z0-9])\b/g,
      (m, a, b, c) => /[A-Za-z]/.test(a + b + c) ? a + b + c : m);
    const codes = [...norm.toUpperCase().matchAll(/\b([A-Z][A-Z0-9]{2}|[A-Z0-9][A-Z][A-Z0-9]|[A-Z0-9]{2}[A-Z])\b/g)]
      .map(m => m[1]).filter(c => !skipWords.has(c));
    if (!codes.length) continue;
    const score = Math.min(...codes.map(c => {
      if (knownCodes.has(c)) return 0;
      let min = Infinity;
      for (const k of knownCodes) { const d = levenshtein(c, k); if (d < min) min = d; }
      return min;
    }));
    if (score < bestScore) { bestScore = score; best = alt; }
  }
  return best;
}

function parseVoiceInput(text) {
  // Collapse spaced chars from speech recognition: "D M R" → "DMR", "M H 3" → "MH3"
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

  const allCodes = [...upper.matchAll(/\b([A-Z][A-Z0-9]{2}|[A-Z0-9][A-Z][A-Z0-9]|[A-Z0-9]{2}[A-Z])\b/g)]
    .map(m => m[1])
    .filter(c => !skipWords.has(c));
  const spokenCode = allCodes[0] || '';

  // Apply phonetic map first, then check learned corrections, then fuzzy-match
  const phonetic = PHONETIC_MAP[spokenCode] || spokenCode;
  const learned = phonetic && voiceCorrections[phonetic];         // key = what was heard
  const matchedCode = learned ? learned : matchToSetCode(phonetic);
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
    lookupManual();
  }
}

async function lookupManual() {
  const setCode = document.getElementById('manualSetCode').value.trim();
  const num = document.getElementById('manualCardNum').value.trim();
  if (!setCode || !num) return;

  voiceMode = 'confirm'; // lock before fetch so yes/no during load don't hit parseVoiceInput
  pendingCard = null;
  const el = document.getElementById('voiceLookupResult');
  el.innerHTML = '<div style="aspect-ratio:5/7;display:flex;align-items:center;justify-content:center;color:var(--text2);gap:8px"><div class="spinner"></div></div>';

  const card = await fetchCard(setCode, num);
  if (!card) {
    el.innerHTML = `<div style="aspect-ratio:5/7;display:flex;align-items:center;justify-content:center;border:1px dashed var(--red);border-radius:8px;color:var(--red);font-size:0.8rem;text-align:center;padding:8px">Not found:<br>${setCode} #${num}</div>`;
    document.getElementById('voiceAddBtn').disabled = true;
    pendingCard = null;
    voiceMode = 'scan';
    return;
  }

  pendingCard = cardToEntry(card, parseInt(document.getElementById('manualQty').value) || 1);
  pendingCard.foil = pendingFoil;
  pendingCard.uid = pendingCard.scryfallId + (pendingCard.foil ? '_f' : '_n');
  const displayPrice = getTCGPriceForCard(pendingCard);
  const displayCKPrice = getCKPriceForCard(pendingCard);
  el.innerHTML = `
    <div style="background:var(--bg3);border:1px solid ${pendingCard.foil ? 'var(--gold)' : 'var(--border2)'};border-radius:var(--radius2);padding:10px">
      <div style="position:relative;overflow:hidden;border-radius:6px;margin-bottom:8px">
        ${pendingCard.image ? `<img src="${pendingCard.image}" style="width:100%;display:block;border-radius:6px">` : ''}
        ${pendingCard.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
      </div>
      <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:0.82rem;margin-bottom:3px;line-height:1.2">${pendingCard.name}</div>
      <div style="font-size:0.72rem;color:var(--text2);margin-bottom:2px;font-style:italic">${pendingCard.set.toUpperCase()} · #${pendingCard.number}</div>
      <div style="font-size:0.7rem;color:var(--text2);margin-bottom:8px">${pendingCard.type}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <span class="price-badge price-tcg" style="font-size:0.68rem">${pendingCard.foil && pendingCard.priceTCGFoil > 0 ? 'Foil' : 'TCG'} $${displayPrice.toFixed(2)}</span>
        <span class="price-badge price-ck" style="font-size:0.68rem">${pendingCard.foil ? 'CK Foil' : 'CK'} $${displayCKPrice.toFixed(2)}</span>
      </div>
    </div>`;
  document.getElementById('voiceAddBtn').disabled = false;
  voiceMode = 'confirm';
  document.getElementById('voiceStatus').textContent = '🔴 Say "yes" to add or "no" to skip…';
  if (!isListening && voiceAutoRestart) startRecording();
}

function confirmVoiceAdd() {
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
  lastRejectedCode = '';

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

  const existing = collection.find(c => c.uid === pendingCard.uid);
  if (existing) {
    existing.qty += pendingCard.qty;
    existing.addedAt = Date.now();
  } else {
    collection.push(pendingCard);
  }
  save();
  renderCollection();
  updateStats();
  showNotif(`Added ${pendingCard.qty}x ${pendingCard.name}`);
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

