// Voice card entry modal

async function openVoice() {
  document.getElementById('voiceModal').classList.add('open');
  pendingCard = null;
  voiceMode = 'scan';
  document.getElementById('voiceAddBtn').disabled = true;
  document.getElementById('voiceLookupResult').innerHTML = '';
  document.getElementById('voiceTranscript').textContent = 'Requesting microphone…';
  document.getElementById('voiceParsed').innerHTML = '';
  pendingFoil = false;
  const foilBtn = document.getElementById('foilToggleBtn');
  foilBtn.textContent = '◇ Foil';
  foilBtn.style.color = '';
  foilBtn.style.borderColor = '';
  renderPinnedSet();
  if (!micStream) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStorage.setItem('mtg_mic_granted', '1');
    } catch(e) {
      document.getElementById('voiceTranscript').textContent = 'Microphone permission denied.';
      document.getElementById('voiceStatus').textContent = 'Allow microphone in browser settings';
      return;
    }
  }
  document.getElementById('voiceTranscript').textContent = 'Waiting for speech…';
  voiceAutoRestart = true;
  startRecording();
}

function closeVoice() {
  voiceAutoRestart = false;
  voiceMode = 'scan';
  document.getElementById('voiceModal').classList.remove('open');
  if (isListening) stopRecording();
}

function toggleRecording() {
  if (isListening) {
    stopRecording();
  } else {
    voiceAutoRestart = true;
    startRecording();
  }
}

function startRecording() {
  if (isListening) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showNotif('Speech recognition not supported in this browser. Use Chrome.', true);
    return;
  }
  if (!recognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = e => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('');
      document.getElementById('voiceTranscript').textContent = t;
      if (e.results[e.results.length - 1].isFinal) {
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
        setTimeout(() => { if (voiceAutoRestart) startRecording(); }, 300);
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
  isListening = false;
  document.getElementById('voiceOrb').classList.remove('listening');
  document.getElementById('voiceStatus').textContent = 'Click orb to listen';
}

function handleVoiceConfirmation(text) {
  const lower = text.toLowerCase();
  const yesWords = ['yes','yeah','yep','yup','correct','add','confirm','right','sure','ok','okay','do it','add it','that one','perfect','great'];
  const noWords = ['no','nope','wrong','cancel','skip','next','redo','not that','not it','incorrect'];
  if (yesWords.some(w => lower.includes(w))) {
    confirmVoiceAdd();
  } else if (noWords.some(w => lower.includes(w))) {
    pendingCard = null;
    document.getElementById('voiceAddBtn').disabled = true;
    document.getElementById('voiceLookupResult').innerHTML = '';
    document.getElementById('voiceParsed').innerHTML = '';
    document.getElementById('manualSetCode').value = '';
    document.getElementById('manualCardNum').value = '';
    voiceMode = 'scan';
    document.getElementById('voiceTranscript').textContent = 'Skipped — say next card…';
  }
}

function toggleFoil() {
  pendingFoil = !pendingFoil;
  const btn = document.getElementById('foilToggleBtn');
  btn.textContent = pendingFoil ? '✦ Foil' : '◇ Foil';
  btn.style.color = pendingFoil ? 'var(--gold)' : '';
  btn.style.borderColor = pendingFoil ? 'var(--gold)' : '';
  if (pendingCard) {
    pendingCard.foil = pendingFoil;
    lookupManual();
  }
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
    badge.textContent = '📌 ' + pinnedSetCode;
    badge.style.display = 'inline';
    hint.style.display = 'inline';
    none.style.display = 'none';
    unpinBtn.style.display = '';
    pinBtn.textContent = '📌 Update';
  } else {
    badge.style.display = 'none';
    hint.style.display = 'none';
    none.style.display = '';
    unpinBtn.style.display = 'none';
    pinBtn.textContent = '📌 Pin';
  }
}

function parseVoiceInput(text) {
  const upper = text.toUpperCase();

  const isFoil = /\bfoil\b/i.test(text);
  if (isFoil !== pendingFoil) {
    pendingFoil = isFoil;
    const foilBtn = document.getElementById('foilToggleBtn');
    foilBtn.textContent = pendingFoil ? '✦ Foil' : '◇ Foil';
    foilBtn.style.color = pendingFoil ? 'var(--gold)' : '';
    foilBtn.style.borderColor = pendingFoil ? 'var(--gold)' : '';
  }

  // Common English 3-letter words that should never be treated as set codes
  const skipWords = new Set([
    'ONE','TWO','SIX','TEN','FOR',
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
    'TON','TOT','TOW','TOY','TUB','TUG','VAT','VEX','VIA','VOW',
    'WAD','WAG','WAR','WAX','WEB','WED','WET','WIN','WIT','WOK',
    'WON','WOO','WOW','YAM','YAP','YEP','YET','ZIP','ZOO'
  ]);

  const allCodes = [...upper.matchAll(/\b([A-Z]{3})\b/g)]
    .map(m => m[1])
    .filter(c => !skipWords.has(c));
  const spokenCode = allCodes[0] || '';

  let setCode = '';
  let usingOverride = false;

  if (pinnedSetCode) {
    if (spokenCode && spokenCode !== pinnedSetCode) {
      setCode = spokenCode;
      usingOverride = true;
    } else {
      setCode = pinnedSetCode;
    }
  } else {
    setCode = spokenCode;
  }

  const numMatch = text.match(/\b(\d{1,4})\b/);
  const wordMap = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
    ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
    eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,
    eighty:80,ninety:90,hundred:100};
  let spokenNum = null;
  const excludePattern = new RegExp(`\\b(foil${setCode ? '|' + setCode : ''})\\b`, 'gi');
  const words = text.replace(excludePattern, '').toLowerCase().split(/\s+/);
  let acc = 0, last = 0;
  words.forEach(w => {
    if (wordMap[w] !== undefined) {
      if (wordMap[w] === 100) { acc = (acc || 1) * 100; }
      else if (wordMap[w] >= 20) { last = wordMap[w]; }
      else { acc += last + wordMap[w]; last = 0; }
    }
  });
  if (acc + last > 0) spokenNum = acc + last;
  const num = numMatch ? numMatch[1] : (spokenNum ? String(spokenNum) : '');

  const parsedEl = document.getElementById('voiceParsed');
  parsedEl.innerHTML = '';
  if (usingOverride) {
    parsedEl.innerHTML += `<div class="voice-tag" style="border-color:var(--teal);color:var(--teal)"><span>↺ Override</span>${setCode}</div>`;
  } else if (pinnedSetCode) {
    parsedEl.innerHTML += `<div class="voice-tag" style="border-color:var(--gold)"><span>📌 Set</span>${pinnedSetCode}</div>`;
  } else if (setCode) {
    parsedEl.innerHTML += `<div class="voice-tag"><span>Set</span>${setCode}</div>`;
  }
  if (num) parsedEl.innerHTML += `<div class="voice-tag"><span>#</span>${num}</div>`;
  if (isFoil) parsedEl.innerHTML += `<div class="voice-tag" style="color:var(--gold);border-color:var(--gold)"><span>✦</span>Foil</div>`;

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

  const el = document.getElementById('voiceLookupResult');
  el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--text2)"><div class="spinner"></div> Looking up card…</div>';

  const card = await fetchCard(setCode, num);
  if (!card) {
    el.innerHTML = `<div style="color:var(--red);font-size:0.85rem">Card not found: ${setCode} #${num}</div>`;
    document.getElementById('voiceAddBtn').disabled = true;
    pendingCard = null;
    return;
  }

  pendingCard = cardToEntry(card, parseInt(document.getElementById('manualQty').value) || 1);
  pendingCard.foil = pendingFoil;
  pendingCard.uid = pendingCard.scryfallId + (pendingCard.foil ? '_f' : '_n');
  const displayPrice = getTCGPriceForCard(pendingCard);
  const displayCKPrice = getCKPriceForCard(pendingCard);
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:160px 1fr;gap:16px;background:var(--bg3);border:1px solid ${pendingCard.foil ? 'var(--gold)' : 'var(--border2)'};border-radius:var(--radius2);padding:14px;align-items:start">
      <div style="position:relative">
        ${pendingCard.image ? `<img src="${pendingCard.image}" style="width:100%;border-radius:8px;display:block;${pendingCard.foil ? 'filter:drop-shadow(0 0 8px gold)' : ''}">` : ''}
        ${pendingCard.foil ? `<div style="position:absolute;bottom:5px;left:0;right:0;text-align:center;font-size:0.62rem;font-weight:700;color:#0e0b00;background:var(--gold);border-radius:0 0 6px 6px;padding:2px 0;letter-spacing:0.06em">✦ FOIL</div>` : ''}
      </div>
      <div style="padding-top:4px">
        <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:1rem;margin-bottom:5px;line-height:1.2">${pendingCard.name}</div>
        <div style="font-size:0.82rem;color:var(--text2);margin-bottom:4px;font-style:italic">${pendingCard.set.toUpperCase()} · #${pendingCard.number}</div>
        <div style="font-size:0.8rem;color:var(--text2);margin-bottom:10px">${pendingCard.type}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="price-badge price-tcg">${pendingCard.foil && pendingCard.priceTCGFoil > 0 ? 'Foil' : 'TCG'} $${displayPrice.toFixed(2)}</span>
          <span class="price-badge price-ck">${pendingCard.foil ? 'CK Foil' : 'CK'} $${displayCKPrice.toFixed(2)}</span>
        </div>
      </div>
    </div>`;
  document.getElementById('voiceAddBtn').disabled = false;
  voiceMode = 'confirm';
  document.getElementById('voiceStatus').textContent = '🔴 Say "yes" to add or "no" to skip…';
  if (!isListening && voiceAutoRestart) startRecording();
}

function confirmVoiceAdd() {
  if (!pendingCard) return;
  const existing = collection.find(c => c.uid === pendingCard.uid);
  if (existing) {
    existing.qty += pendingCard.qty;
  } else {
    collection.push(pendingCard);
  }
  save();
  renderCollection();
  updateStats();
  showNotif(`Added ${pendingCard.qty}x ${pendingCard.name}`);
  pendingCard = null;
  document.getElementById('voiceAddBtn').disabled = true;
  document.getElementById('voiceLookupResult').innerHTML = '';
  document.getElementById('voiceTranscript').textContent = 'Waiting for speech…';
  document.getElementById('voiceParsed').innerHTML = '';
  document.getElementById('manualSetCode').value = '';
  document.getElementById('manualCardNum').value = '';
  pendingFoil = false;
  const foilBtn = document.getElementById('foilToggleBtn');
  if (foilBtn) { foilBtn.textContent = '◇ Foil'; foilBtn.style.color = ''; foilBtn.style.borderColor = ''; }
  voiceMode = 'scan';
  voiceAutoRestart = true;
  if (!isListening) startRecording();
}
