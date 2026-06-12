// engine-effects.js — pure oracle text parsing (no DOM)
// Parses spell/ability effects, triggers, and keywords from card oracle text.

const _GFE_WORD2NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function _gfeWord2Num(w) {
  if (!w) return null;
  const k = String(w).toLowerCase();
  if (_GFE_WORD2NUM[k] != null) return _GFE_WORD2NUM[k];
  const n = parseInt(k, 10);
  return Number.isFinite(n) ? n : null;
}

// Split an effect body into "sentences" — at periods that end a clause.
// Avoid splitting on "1.5" type decimals, mana symbols like "{T}.", etc.
function _gfeSplitSentences(text) {
  if (!text) return [];
  const cleaned = text
    .replace(/\r/g, '')
    .replace(/\(([^)]*)\)/g, '')   // strip reminder text
    .replace(/\s+/g, ' ')
    .trim();
  // Split on period+space or newline; keep non-empty
  return cleaned
    .split(/(?:\.\s+|\n+)/)
    .map(s => s.trim().replace(/\.$/, '').trim())
    .filter(Boolean);
}

// Strip a trigger prefix off a sentence. Returns { kind, body, subjectType? } where kind is one
// of 'cast' | 'etb' | 'upkeep' | 'endStep' | 'attack' | 'death' | 'anyCast'
// | 'landfall' | 'anyETB' | 'anyAttack' | 'anyDeath' | 'lifeGain' | 'body'.
function stripTriggerPrefix(sentence) {
  if (!sentence) return { kind: 'body', body: '' };
  const s = sentence;

  // Order matters: try most specific first.
  let m;

  m = s.match(/^when you cast this spell[,—\-]\s*(.*)$/i);
  if (m) return { kind: 'cast', body: m[1] };

  // "Whenever you cast a spell, ..." (or "a creature spell", etc.) — fires from
  // battlefield permanents when ANY spell is cast. Capture the subject clause
  // (e.g. "a spell with mana value 4 or greater") so a condition can be parsed.
  m = s.match(/^when(?:ever)?\s+you\s+cast\s+((?:a|an|another)\b[^,—\-]{0,70})[,—\-]\s*(.*)$/i);
  if (m) return { kind: 'anyCast', body: m[2], subject: m[1] };

  // "Whenever an opponent casts a spell, ..." (Rhystic Study / Smothering
  // Tithe) and "Whenever a player casts a spell, ..." (fires for both sides).
  m = s.match(/^when(?:ever)?\s+(an opponent|a player|each opponent)\s+casts?\s+((?:a|an)\b[^,—\-]{0,70})[,—\-]\s*(.*)$/i);
  if (m) {
    const who = m[1].toLowerCase();
    return { kind: who === 'a player' ? 'playerCast' : 'oppCast', body: m[3], subject: m[2] };
  }

  // "At the beginning of your/each (player's)/each opponent's upkeep, ..."
  m = s.match(/^at the beginning of (your|each player'?s?|each opponent'?s?|an opponent'?s?|each) upkeep[,—\-]\s*(.*)$/i);
  if (m) {
    const who = m[1].toLowerCase();
    const phaseScope = who === 'your' ? 'your' : /opponent/.test(who) ? 'opp' : 'each';
    return { kind: 'upkeep', body: m[2], phaseScope };
  }

  m = s.match(/^at the beginning of (your|each player'?s?|each opponent'?s?|each) end step[,—\-]\s*(.*)$/i);
  if (m) {
    const who = m[1].toLowerCase();
    const phaseScope = who === 'your' ? 'your' : /opponent/.test(who) ? 'opp' : 'each';
    return { kind: 'endStep', body: m[2], phaseScope };
  }

  // Landfall keyword: "Landfall — [effect]"
  m = s.match(/^landfall\s*[—\-]\s*(.*)$/i);
  if (m) return { kind: 'landfall', body: m[1], subjectType: 'land' };

  // "Whenever you gain life, ..."
  m = s.match(/^when(?:ever)?\s+you\s+gain(?:\s+\d+)?\s+life[,—\-]\s*(.*)$/i);
  if (m) return { kind: 'lifeGain', body: m[1] };

  // "Whenever a/another <type> enters (the battlefield) (under your control), ..."
  // → generic ETB trigger (Landfall is the special case for type=land)
  m = s.match(/^when(?:ever)?\s+(?:a|an|another)\s+([a-z][a-z\s]*?)\s+enters(?:\s+the\s+battlefield)?(\s+under your control)?[,—\-]\s*(.*)$/i);
  if (m) {
    const subject = m[1].trim().toLowerCase();
    const youControl = !!m[2] || /\byou control\b/.test(subject);
    if (/^land/.test(subject)) return { kind: 'landfall', body: m[3], subjectType: 'land' };
    return { kind: 'anyETB', body: m[3], subjectType: subject, subjectYouControl: youControl };
  }

  // "Whenever a/another <type> dies, ..."
  m = s.match(/^when(?:ever)?\s+(?:a|an|another)\s+([a-z][a-z\s]*?)\s+dies[,—\-]\s*(.*)$/i);
  if (m) {
    const subject = m[1].trim().toLowerCase();
    return { kind: 'anyDeath', body: m[2], subjectType: subject };
  }

  // "Whenever a/another <type> attacks, ..."
  m = s.match(/^when(?:ever)?\s+(?:a|an|another)\s+([a-z][a-z\s]*?)\s+attacks?[,—\-]\s*(.*)$/i);
  if (m) {
    const subject = m[1].trim().toLowerCase();
    return { kind: 'anyAttack', body: m[2], subjectType: subject };
  }

  // "Whenever a/another <type> deals combat damage to a player, ..."
  // Toski, Edric, Coastal Piracy, Reconnaissance Mission, etc.
  m = s.match(/^when(?:ever)?\s+(?:a|an|another)\s+([a-z][a-z\s]*?)\s+deals?\s+combat\s+damage\s+to\s+(?:a\s+player|an opponent|[^,—\-]+)[,—\-]\s*(.*)$/i);
  if (m) {
    const subject = m[1].trim().toLowerCase();
    return { kind: 'anyCombatDamage', body: m[2], subjectType: subject };
  }

  // Self-referential "Whenever ~ deals combat damage to a player, ..."
  m = s.match(/^when(?:ever)?\s+.{1,80}?\s+deals?\s+combat\s+damage\s+to\s+(?:a\s+player|an opponent|[^,—\-]+)[,—\-]\s*(.*)$/i);
  if (m) return { kind: 'combatDamage', body: m[1] };

  // Self-referential triggers (named subject: card name, "this", "it") fall through here.
  m = s.match(/^when(?:ever)?\s+.{1,80}?\s+enters(?:\s+the\s+battlefield)?[,—\-]\s*(.*)$/i);
  if (m) return { kind: 'etb', body: m[1] };

  m = s.match(/^when(?:ever)?\s+.{1,80}?\s+attacks[,—\-]\s*(.*)$/i);
  if (m) return { kind: 'attack', body: m[1] };

  m = s.match(/^when(?:ever)?\s+.{1,80}?\s+dies[,—\-]\s*(.*)$/i);
  if (m) return { kind: 'death', body: m[1] };

  return { kind: 'body', body: s };
}

// Parse a token descriptor from text like
// "create a 1/1 white Soldier creature token" → {count, power, toughness, color, subtype}
function parseTokenDesc(text) {
  const t = (text || '').toLowerCase();
  // Count — fixed, or resolved later from source power/toughness/cast X.
  let count = 1;
  let countFrom = null;
  if (/where x is (?:its |this creature'?s? )?power/i.test(t)
      || /equal to (?:its |this creature'?s? )?power/i.test(t)
      || /a number of [^.]* equal to (?:its )?power/i.test(t)) {
    countFrom = 'power';
  } else if (/where x is (?:its |this creature'?s? )?toughness/i.test(t)
      || /equal to (?:its |this creature'?s? )?toughness/i.test(t)) {
    countFrom = 'toughness';
  } else if (/\bcreate\s+x\b/.test(t) && countFrom == null) {
    countFrom = 'castX';
  } else {
    const countMatch = t.match(/create\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/);
    if (countMatch) {
      const w = countMatch[1];
      if (w === 'a' || w === 'an') count = 1;
      else count = _gfeWord2Num(w) || parseInt(w, 10) || 1;
    }
  }
  // P/T
  let power = 1, toughness = 1;
  const ptMatch = t.match(/(\d+)\/(\d+)/);
  if (ptMatch) { power = +ptMatch[1]; toughness = +ptMatch[2]; }

  // Color
  let color = null;
  for (const c of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    if (new RegExp('\\b' + c + '\\b').test(t)) { color = c; break; }
  }
  // Subtype — last capitalized noun before "creature" / "artifact" / "token"
  let subtype = null;
  const subMatch = (text || '').match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:creature|artifact|enchantment)?\s*tokens?/);
  if (subMatch) subtype = subMatch[1];

  const name = subtype === 'Treasure'
    ? 'Treasure'
    : (subtype
      ? `${subtype} ${power}/${toughness}`
      : `${power}/${toughness} ${color || ''} token`.trim());

  // Keywords on the token (e.g. "1/1 white Spirit creature token with flying").
  // We extract from the sentence and stash them so spawn code can populate
  // card.keywords directly (token cards have no oracleText for parseKeywords).
  const tk = (text || '').toLowerCase();
  const keywords = [];
  const KW = [
    'flying', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'trample',
    'reach', 'menace', 'first strike', 'double strike', 'defender',
    'flash', 'indestructible', 'hexproof', 'shroud',
  ];
  for (const k of KW) {
    const re = new RegExp('\\b' + k.replace(/\s+/g, '\\s+') + '\\b', 'i');
    if (re.test(tk)) keywords.push(k.replace(/\b\w/g, ch => ch.toUpperCase()));
  }

  return { count, countFrom, power, toughness, color, subtype, name, keywords };
}

// parseEffects(text) — break text into Effect descriptors.
function parseEffects(text) {
  if (!text) return [];
  const sentences = _gfeSplitSentences(text);
  const effects = [];
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    // Optional "You may [body]. If you do, [then]." — one descriptor that
    // prompts the player yes/no before firing.
    const may = _gfeTryParseMay(sentence, sentences[i + 1]);
    if (may) {
      effects.push(may.effect);
      if (may.consumedNext) i++;
      continue;
    }
    // Try conditional branch first ("If X, do Y. Otherwise, do Z.")
    const branch = _gfeTryParseBranch(sentence, sentences[i + 1]);
    if (branch) {
      effects.push(branch.effect);
      if (branch.consumedNext) i++;
      continue;
    }
    // Split each sentence on " and " / ", and " / ", then " to catch multi-effect
    // sentences ("you draw a card and you lose 1 life"). BUT don't split when
    // the next clause starts with "gain[s]" / "have" / "has" — that's the
    // tail of a pump verb ("creatures … get +1/+1 AND gain trample until EOT").
    const clauses = sentence.split(/,?\s+(?:and|then)\s+(?!gain[s]?\b|have\b|has\b)/i);
    for (const clause of clauses) {
      const fx = _gfeMatchEffect(clause);
      if (fx) {
        fx.source_text = clause;
        effects.push(fx);
      }
    }
  }
  return effects;
}

/** Detect "You may <body>. (If you do, <then>.)" patterns. */
function _gfeTryParseMay(sentence, nextSentence) {
  if (!sentence) return null;
  const m = sentence.match(/^you may\s+(.+?)\.?\s*$/i);
  if (!m) return null;
  const bodyText = m[1].trim();
  // Reject vacuous "You may." or "You may do so." — nothing to fire.
  if (!bodyText || /^do so\b/i.test(bodyText)) return null;
  const mayEffects = parseEffects(bodyText);
  if (!mayEffects.length) return null;
  let thenEffects = [];
  let consumedNext = false;
  if (nextSentence) {
    const em = nextSentence.match(/^if you do,?\s+(.+?)\.?\s*$/i);
    if (em) {
      thenEffects = parseEffects(em[1].trim());
      consumedNext = true;
    }
  }
  return {
    effect: {
      type: 'may',
      mayEffects,
      thenEffects,
      source_text: sentence + (consumedNext ? '. ' + nextSentence : ''),
    },
    consumedNext,
  };
}

/** Detect "If <cond>, <if>. Otherwise, <else>." patterns. Returns
 *  { effect: branch-fx, consumedNext: bool } or null. */
function _gfeTryParseBranch(sentence, nextSentence) {
  if (!sentence) return null;
  const m = sentence.match(/^if\s+([^,]+?),\s*(.+)$/i);
  if (!m) return null;
  const condText = m[1].trim();
  const ifText   = m[2].trim();
  const cond = parseBranchCondition(condText);
  if (!cond || cond.kind === 'unparsed') return null;   // no useful condition → fall through

  const ifEffects = parseEffects(ifText);
  if (!ifEffects.length) return null;

  let elseEffects = [];
  let consumedNext = false;
  if (nextSentence) {
    const em = nextSentence.match(/^otherwise,?\s*(.+)$/i);
    if (em) {
      elseEffects = parseEffects(em[1].trim());
      consumedNext = true;
    }
  }
  return {
    effect: {
      type: 'branch',
      condition: cond,
      ifEffects,
      elseEffects,
      source_text: sentence + (consumedNext ? '. ' + nextSentence : ''),
    },
    consumedNext,
  };
}

/** Parse a branch condition into a structured AST or null/`{kind:'unparsed'}`. */
function parseBranchCondition(text) {
  if (!text) return null;
  const raw = String(text);
  const s = raw.toLowerCase().trim();
  let m;

  // "you control [N|a|an] or more <filter>"
  m = s.match(/you control (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z\s]+?)$/);
  if (m) {
    const word = m[1];
    const n = (word === 'a' || word === 'an') ? 1 : (_gfeWord2Num(word) || parseInt(word, 10));
    return { kind: 'controlAtLeast', n, filter: m[2].trim() };
  }
  // "you control [N] <filter>" (without "or more")
  m = s.match(/you control (\d+|one|two|three|four|five) ([a-z\s]+?)$/);
  if (m) {
    const word = m[1];
    const n = _gfeWord2Num(word) || parseInt(word, 10);
    return { kind: 'controlAtLeast', n, filter: m[2].trim() };
  }
  // "you control a/an <filter>" / "you control at least one <filter>"
  m = s.match(/you control (?:a|an|at least one) ([a-z\s]+?)$/);
  if (m) {
    return { kind: 'controlAtLeast', n: 1, filter: m[1].trim() };
  }
  // "an opponent controls a/an <filter>"
  m = s.match(/(?:an opponent|opponents) controls? (?:a|an|at least one) ([a-z\s]+?)$/);
  if (m) {
    return { kind: 'oppControlAtLeast', n: 1, filter: m[1].trim() };
  }
  // "you have N or [less|more] life" / "your life total is N or [less|greater]"
  m = s.match(/(?:you have|your life total is) (\d+) or (less|fewer|more|greater)\b/);
  if (m) {
    const n = +m[1];
    const less = m[2] === 'less' || m[2] === 'fewer';
    return { kind: less ? 'lifeAtMost' : 'lifeAtLeast', n };
  }
  // "there are N or more cards in your graveyard"
  m = s.match(/there (?:are|is) (\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more (?:cards?) in (?:your|a) graveyard/);
  if (m) {
    const n = _gfeWord2Num(m[1]) || parseInt(m[1], 10);
    return { kind: 'gyAtLeast', n };
  }
  // "you've cast another spell this turn"
  if (/you(?:'ve| have) cast another spell this turn/.test(s)) {
    return { kind: 'castThisTurn', n: 2 };
  }
  // "it's your turn" / "it isn't your turn"
  if (/^it'?s your turn/.test(s)) return { kind: 'isYourTurn' };
  if (/^it isn'?t your turn|^it is not your turn/.test(s)) return { kind: 'notYourTurn' };

  return { kind: 'unparsed', text: raw };
}

// Try to identify the dominant effect of a single sentence.
function _gfeMatchEffect(sentence) {
  const s = sentence.toLowerCase();
  let m;

  // Draw — "draw a card", "draw two cards", "draw X cards"
  if (/\bdraw a card\b/i.test(s)) return { type: 'draw', n: 1 };
  m = s.match(/\bdraw (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\b/);
  if (m) return { type: 'draw', n: _gfeWord2Num(m[1]) };
  if (/\bdraw x cards?\b/.test(s)) return { type: 'draw', n: null };

  // Life gain — "you gain N life" / "gain N life" / "you gain X life"
  m = s.match(/(?:you )?gain (\d+) life\b/);
  if (m) return { type: 'life', n: +m[1] };
  if (/(?:you )?gain x life\b/.test(s)) return { type: 'life', n: null };
  // Life loss — "you lose N life" / "pay N life" / "lose N life" / "lose X life"
  m = s.match(/(?:you )?(?:lose|pay) (\d+) life\b/);
  if (m) return { type: 'life', n: -(+m[1]) };
  if (/(?:you )?(?:lose|pay) x life\b/.test(s)) return { type: 'life', n: null, neg: true };

  // Scry / Surveil / Mill (numeric or X)
  m = s.match(/\bscry (\d+)\b/);
  if (m) return { type: 'scry', n: +m[1] };
  if (/\bscry x\b/.test(s)) return { type: 'scry', n: null };
  m = s.match(/\bsurveil (\d+)\b/);
  if (m) return { type: 'surveil', n: +m[1] };
  if (/\bsurveil x\b/.test(s)) return { type: 'surveil', n: null };
  m = s.match(/\bmill (\d+) cards?\b/);
  if (m) return { type: 'mill', n: +m[1] };
  if (/\bmill a card\b/.test(s)) return { type: 'mill', n: 1 };
  if (/\bmill x cards?\b/.test(s)) return { type: 'mill', n: null };

  // Extra land plays this turn — "you may play an additional land this turn"
  if (/you may play any number of lands this turn/.test(s)) return { type: 'extraLand', n: 99 };
  if (/you may play two additional lands this turn/.test(s)) return { type: 'extraLand', n: 2 };
  if (/you may play three additional lands this turn/.test(s)) return { type: 'extraLand', n: 3 };
  if (/you may play (?:an|one) additional land this turn/.test(s)) return { type: 'extraLand', n: 1 };

  // Shuffle
  if (/^shuffle\.?$/i.test(s.trim()) || /\bshuffle (?:your library|it into your library)\b/.test(s)) {
    return { type: 'shuffle' };
  }

  // Search library — "search your library for..."
  if (/\bsearch your library for\b/.test(s)) {
    const filter = /\bbasic land\b/.test(s) ? 'basic'
                 : /\bland\b/.test(s)        ? 'land'
                 : /\bcreature\b/.test(s)    ? 'creature'
                 : /\binstant or sorcery\b/.test(s) ? 'instant_or_sorcery'
                 : /\binstant\b/.test(s) ? 'instant'
                 : /\bsorcery\b/.test(s) ? 'sorcery'
                 : /\bartifact\b/.test(s) ? 'artifact'
                 : /\benchantment\b/.test(s) ? 'enchantment'
                 : /\bplaneswalker\b/.test(s) ? 'planeswalker'
                 : 'any';
    // Extract bounded mana-value qualifier ("with mana value 3 or less" etc.)
    let cmcMax = null, cmcMin = null, cmcExact = null;
    let mm = s.match(/mana value (\d+) or less/);
    if (mm) cmcMax = +mm[1];
    mm = s.match(/mana value (\d+) or (?:more|greater)/);
    if (mm) cmcMin = +mm[1];
    mm = s.match(/mana value (?:of |equal to )?(\d+)\b/);
    if (mm && cmcMax == null && cmcMin == null) cmcExact = +mm[1];
    // "card named X" — name lookup
    let nameMatch = null;
    const nm = sentence.match(/card named ([A-Z][^.,]*?)(?:[.,]|$)/);
    if (nm) nameMatch = nm[1].trim();
    return {
      type: 'search',
      filter,
      cmcMax, cmcMin, cmcExact,
      nameMatch,
      shuffle: /shuffle/.test(s),
      putTapped: /\b(?:onto the battlefield tapped|enters (?:the battlefield )?tapped)\b/i.test(s),
      toBattlefield: /\b(?:put (?:it )?)?onto the battlefield\b/i.test(s),
    };
  }

  // Create token
  if (/\bcreate .{0,80}? tokens?\b/.test(s)) {
    return { type: 'token', extra: parseTokenDesc(sentence) };
  }

  // Counters — "put N <kind> counters on <target>" (N may be a number, "a", or "X").
  // Kind may be +1/+1, -1/-1, or a named counter (charge, lore, loyalty, time, ...).
  m = s.match(/\bput (a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) (\+1\/\+1|\-1\/\-1|[a-z]+(?:[ -][a-z]+)?) counters? on ([^.;]*)/i);
  if (m) {
    const word = m[1].toLowerCase();
    const n = (word === 'a' || word === 'an') ? 1
            : (word === 'x') ? null            // resolved from the spell's X at cast time
            : (_gfeWord2Num(word) || parseInt(word, 10) || 1);
    const kind = m[2].toLowerCase();
    // Reject grammatical fragments mis-captured as counter names
    // ("put a number of +1/+1 counters...", "put X of those counters...").
    if (!/^(?:\+1\/\+1|\-1\/\-1)$/.test(kind) && /\b(?:number|of|that|those|the|more|fewer|additional)\b/.test(kind)) {
      // fall through to other parsers / notify
    } else {
      const onText = (m[3] || '').toLowerCase();
      let target = 'self';
      if (/\beach\b|\ball\b/.test(onText)) target = 'all';
      else if (/\btarget\b/.test(onText) || /\banother\b/.test(onText)) target = 'choose';
      // "each creature you control" stays own-side; bare "each creature" hits both
      const bothSides = target === 'all' && !/you control/.test(onText);
      return { type: 'counter', n, counter: kind, target, bothSides };
    }
  }

  // Energy — "you get {E}{E}..." (count the symbols)
  m = s.match(/\byou get ((?:\{e\})+)/i);
  if (m) {
    const n = (m[1].match(/\{e\}/gi) || []).length;
    return { type: 'player_counter', counter: 'energy', n, target: 'self' };
  }

  // Player-scoped counters — "you/that player/each opponent gets N poison/energy/experience counters"
  m = s.match(/\b(you|each opponent|target player|target opponent|that player|each player) gets? (a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) (poison|energy|experience) counters?/i);
  if (m) {
    const word = m[2].toLowerCase();
    const n = (word === 'a' || word === 'an') ? 1
            : (word === 'x') ? null
            : (_gfeWord2Num(word) || parseInt(word, 10) || 1);
    const who = m[1].toLowerCase();
    return { type: 'player_counter', counter: m[3].toLowerCase(), n,
             target: who === 'you' ? 'self' : who === 'each player' ? 'each' : 'opp' };
  }

  // Proliferate (reminder text is already stripped with the parens)
  if (/\bproliferate\b/.test(s)) return { type: 'proliferate' };

  // Win / lose the game. Guarded against unparsed leading conditions
  // ("If you've cast another spell named X this game, you win") — those fall
  // through to the manual queue instead of auto-firing.
  if (!/^\s*if\b/.test(s)) {
    if (/\byou win the game\b/.test(s)) return { type: 'win_game' };
    if (/\byou lose the game\b/.test(s)) return { type: 'lose_game', target: 'self' };
    if (/\b(?:that player|each opponent|target player|target opponent|each other player|defending player) loses the game\b/.test(s)) {
      return { type: 'lose_game', target: 'opp' };
    }
  }

  // Damage to self — "you take N damage" / "deals N damage to you"
  m = s.match(/\byou take (\d+|x) damage\b/);
  if (m) return { type: 'damage', n: m[1].toLowerCase() === 'x' ? null : +m[1], target: 'self' };
  m = s.match(/\bdeals? (\d+|x) damage to you\b/);
  if (m) return { type: 'damage', n: m[1].toLowerCase() === 'x' ? null : +m[1], target: 'self' };

  // Divided damage — "deals N damage divided as you choose among any number of target X"
  // Captures: amount, "any number"/"two"/"three"/etc., target filter tail.
  m = s.match(/\bdeals? (\d+|x) damage divided as you choose among (any number of |up to (?:one|two|three|four|five|\d+) |one|two|three|four|five|\d+)?\s*([^.;]+)/i);
  if (m) {
    const raw = m[1].toLowerCase();
    const n = raw === 'x' ? null : +m[1];
    const countToken = (m[2] || '').trim().toLowerCase();
    const tail = m[3];
    let maxPicks = 99;
    if (countToken && !/any number/.test(countToken)) {
      const w = countToken.replace(/^up to\s+/, '').trim();
      maxPicks = _gfeWord2Num(w) || parseInt(w, 10) || 99;
    }
    const filter = /any target/i.test(tail)
      ? { typesAny: ['creature', 'planeswalker'], controller: 'any' }
      : parseTargetFilter('target ' + tail);
    return {
      type: 'damage_divided',
      n,
      maxPicks,
      allowPlayer: /any target|any number|player/i.test(tail) || /any target/i.test(countToken),
      filter,
    };
  }

  // Damage to a chosen target — "deals N damage to any target / target creature / target player ..."
  m = s.match(/\bdeals? (\d+|x) damage to ([^.;]+)/);
  if (m) {
    const raw = m[1].toLowerCase();
    const n = raw === 'x' ? null : +m[1];
    const tail = m[2];
    if (/any target/i.test(tail)) {
      return { type: 'damage', n, needsTarget: true, allowPlayer: true,
               filter: { typesAny: ['creature', 'planeswalker'], controller: 'any' } };
    }
    if (/target (?:player|opponent)/i.test(tail)) {
      return { type: 'damage', n, needsTarget: true, allowPlayer: true, playerOnly: true,
               filter: { kind: 'none' } };
    }
    if (/target/i.test(tail)) {
      return { type: 'damage', n, needsTarget: true, allowPlayer: false,
               filter: parseTargetFilter('target ' + tail) };
    }
    if (/each opponent/i.test(tail)) return { type: 'damage', n, target: 'opp' };
    if (/each player/i.test(tail))  return { type: 'damage', n, target: 'each_player' };
  }

  // Counter target spell — pops the top of the stack
  if (/\bcounter target spell\b/.test(s)) {
    return { type: 'counter_spell' };
  }

  // Copy target instant/sorcery — Twincast, Reverberate, Fork. Order
  // alternatives so "instant or sorcery" matches before the shorter
  // "instant" / "sorcery" alone.
  m = s.match(/\bcopy target (instant or sorcery|instant|sorcery|spell)\b/);
  if (m) {
    const filt = m[1] === 'instant or sorcery' ? 'instant_or_sorcery'
              : m[1] === 'instant' ? 'instant'
              : m[1] === 'sorcery' ? 'sorcery'
              : 'any';
    return { type: 'copy_spell', n: 1, filter: filt };
  }

  // Generic "copy this spell N times" / "copy it N times"
  m = s.match(/\bcopy (?:this spell|it) (one|two|three|four|five|\d+) times?\b/);
  if (m) {
    const n = _gfeWord2Num(m[1]) || parseInt(m[1], 10) || 1;
    return { type: 'copy_spell', n, selfCopy: true };
  }
  if (/\bcopy (?:this spell|it)\b/.test(s)) {
    return { type: 'copy_spell', n: 1, selfCopy: true };
  }

  // Discover N — parameterized cascade ("exile cards from the top of your
  // library until you exile a nonland card with mana value N or less; you
  // may cast that card without paying its mana cost or put it into your hand").
  m = s.match(/\bdiscover\s+(\d+)\b/);
  if (m) return { type: 'discover', n: +m[1] };

  // Discard
  if (/\bdiscard (a|one) card\b/.test(s)) return { type: 'discard', n: 1 };
  m = s.match(/\bdiscard (\d+) cards?\b/);
  if (m) return { type: 'discard', n: +m[1] };

  // Untap target — check BEFORE tap (since `\btap\b` doesn't match inside "untap"
  // anyway, but be explicit for clarity)
  if (/\buntap target\b/.test(s)) {
    return { type: 'untap', n: 1, needsTarget: true, filter: parseTargetFilter(s) };
  }
  if (/\btap target\b/.test(s)) {
    return { type: 'tap', n: 1, needsTarget: true, filter: parseTargetFilter(s) };
  }

  // ── PUMP / GRANT-KEYWORD (until end of turn) ─────────────────────────────
  // Order: mass first (so the "creatures you control" branch wins over the
  // single-target one, which matches "creature").
  //
  // Mass pump: "[Other] [color/subtype]? creatures you control get +N/+N
  //             (and gain <kw>)? until end of turn"
  m = sentence.match(/^(other\s+)?([\w\-]+\s+)?creatures?\s+you control\s+get\s+([+\-]\d+)\/([+\-]\d+)(?:\s+and\s+gain[s]?\s+([^.]+?))?\s+until end of turn/i);
  if (m) {
    const otherOnly = !!m[1];
    const adj = (m[2] || '').trim().toLowerCase();
    const dP = parseInt(m[3], 10) || 0;
    const dT = parseInt(m[4], 10) || 0;
    const tail = (m[5] || '').toLowerCase();
    const kws = typeof _extractGrantedKeywords === 'function' ? _extractGrantedKeywords(tail) : [];
    const scope = _pumpScopeFromAdj(adj, 'you', otherOnly);
    return { type: 'pump', mass: true, power: dP, toughness: dT, grantKeywords: kws, duration: 'eot', scope };
  }
  // Mass grant keyword: "[Other] [color/subtype]? creatures you control gain <kw> until end of turn"
  m = sentence.match(/^(other\s+)?([\w\-]+\s+)?creatures?\s+you control\s+gain[s]?\s+([^.]+?)\s+until end of turn/i);
  if (m) {
    const otherOnly = !!m[1];
    const adj = (m[2] || '').trim().toLowerCase();
    const tail = (m[3] || '').toLowerCase();
    const kws = typeof _extractGrantedKeywords === 'function' ? _extractGrantedKeywords(tail) : [];
    if (kws.length) {
      const scope = _pumpScopeFromAdj(adj, 'you', otherOnly);
      return { type: 'pump', mass: true, power: 0, toughness: 0, grantKeywords: kws, duration: 'eot', scope };
    }
  }
  // Target pump: "[Up to N] target [filter] gets +N/+N (and gains <kw>)? until end of turn"
  m = sentence.match(/(?:up to\s+\w+\s+)?target\s+([^.]+?)\s+gets\s+([+\-]\d+)\/([+\-]\d+)(?:\s+and\s+gain[s]?\s+([^.]+?))?\s+until end of turn/i);
  if (m) {
    const dP = parseInt(m[2], 10) || 0;
    const dT = parseInt(m[3], 10) || 0;
    const tail = (m[4] || '').toLowerCase();
    const kws = typeof _extractGrantedKeywords === 'function' ? _extractGrantedKeywords(tail) : [];
    return { type: 'pump', power: dP, toughness: dT, grantKeywords: kws, duration: 'eot',
             needsTarget: true, filter: parseTargetFilter('target ' + m[1]) };
  }
  // Target grant keyword: "target [filter] gains <kw> until end of turn"
  m = sentence.match(/target\s+([^.]+?)\s+gain[s]?\s+([^.]+?)\s+until end of turn/i);
  if (m) {
    const tail = (m[2] || '').toLowerCase();
    const kws = typeof _extractGrantedKeywords === 'function' ? _extractGrantedKeywords(tail) : [];
    if (kws.length) {
      return { type: 'pump', power: 0, toughness: 0, grantKeywords: kws, duration: 'eot',
               needsTarget: true, filter: parseTargetFilter('target ' + m[1]) };
    }
  }

  // Bounce — "return [up to N] [target] <thing> to its/their owner's hand(s)"
  if (/\breturn\b[^.]*\bto (?:its|their) owner.?s?\s+hands?/i.test(s)
      || /\breturn\b[^.]*\bto (?:your|the) owner.?s?\s+hands?/i.test(s)) {
    let n = 1;
    const nm = s.match(/return (?:up to )?(a|an|one|two|three|four|five|\d+)\b/i);
    if (nm) {
      const w = nm[1].toLowerCase();
      n = (w === 'a' || w === 'an') ? 1 : (_gfeWord2Num(w) || parseInt(w, 10) || 1);
    }
    const needsTarget = /\btarget\b/.test(s);
    return { type: 'bounce', n, filter: parseTargetFilter(s), upTo: /up to/i.test(s), needsTarget };
  }

  // Fight — "target creature fights target creature" / "it fights target creature"
  const fightFx = parseFightEffect(s);
  if (fightFx) return fightFx;

  // Mass destroy / exile (no target selection)
  if (/\bdestroy all creatures\b/.test(s)) {
    return { type: 'destroy', n: 99, filter: { types: ['creature'], controller: 'any' }, autoAll: true };
  }
  if (/\bexile all creatures\b/.test(s)) {
    return { type: 'exile', n: 99, filter: { types: ['creature'], controller: 'any' }, autoAll: true };
  }

  // Destroy — "destroy [up to N] target ..."
  if (/\bdestroy\b/.test(s) && /\btarget\b/.test(s)) {
    let n = 1;
    const nm = s.match(/destroy (?:up to )?(a|an|one|two|three|four|five|\d+)\b/i);
    if (nm) {
      const w = nm[1].toLowerCase();
      n = (w === 'a' || w === 'an') ? 1 : (_gfeWord2Num(w) || parseInt(w, 10) || 1);
    }
    return { type: 'destroy', n, filter: parseTargetFilter(s), upTo: /up to/i.test(s), needsTarget: true };
  }

  // Exile — "exile [up to N] target ..."
  if (/\bexile\b/.test(s) && /\btarget\b/.test(s)) {
    let n = 1;
    const nm = s.match(/exile (?:up to )?(a|an|one|two|three|four|five|\d+)\b/i);
    if (nm) {
      const w = nm[1].toLowerCase();
      n = (w === 'a' || w === 'an') ? 1 : (_gfeWord2Num(w) || parseInt(w, 10) || 1);
    }
    return { type: 'exile', n, filter: parseTargetFilter(s), upTo: /up to/i.test(s), needsTarget: true };
  }

  // Otherwise — flag for manual resolution if the sentence looks like a game effect
  if (_gfeLooksLikeEffect(s)) {
    return { type: 'notify', extra: sentence };
  }
  return null;
}

function _gfeLooksLikeEffect(sentence) {
  // Heuristic: sentence mentions a game noun/verb so we should at least surface it
  return /\b(damage|target|exile|destroy|return|tap|untap|counter|sacrifice|choose|reveal|put|cast|search|draw|gain|lose|fight)\b/i.test(sentence);
}

/** Build a static-effect scope from an optional adjective word (color or
 *  creature subtype). Used by mass-pump / mass-grant-keyword parsing. */
const _PUMP_COLOR = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
function _pumpScopeFromAdj(adjWord, controller, otherOnly) {
  const scope = { types: ['creature'], subtype: null, colors: null, controller, otherOnly };
  if (!adjWord) return scope;
  const w = adjWord.toLowerCase().trim();
  if (!w) return scope;
  if (_PUMP_COLOR[w]) {
    scope.colors = [_PUMP_COLOR[w]];
  } else {
    // Treat as subtype (Goblin, Elf, etc.). Strip trailing 's'.
    scope.subtype = w.replace(/s$/, '');
  }
  return scope;
}

/** Parse "target creature", "target nonland permanent you don't control", etc. */
function parseTargetFilter(s) {
  const lower = String(s || '').toLowerCase();
  const filter = { controller: 'any' };

  if (/you don't control|an opponent controls|opponent controls|your opponents control/.test(lower)) {
    filter.controller = 'opp';
  } else if (/you control/.test(lower)) {
    filter.controller = 'you';
  }

  if (/nonland permanent/.test(lower)) {
    filter.notTypes = ['land'];
    filter.kind = 'permanent';
  } else if (/noncreature permanent/.test(lower)) {
    filter.notTypes = ['creature'];
    filter.kind = 'permanent';
  } else if (/artifact or enchantment|enchantment or artifact/.test(lower)) {
    filter.typesAny = ['artifact', 'enchantment'];
  } else if (/artifact, creature, or planeswalker|creature, artifact, or planeswalker|planeswalker, artifact, or creature/.test(lower)) {
    filter.typesAny = ['artifact', 'creature', 'planeswalker'];
  } else {
    const types = [];
    const notTypes = [];
    for (const t of ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle']) {
      if (new RegExp('non' + t).test(lower)) notTypes.push(t);
      else if (new RegExp('\\b' + t + '\\b').test(lower)) types.push(t);
    }
    if (types.length) filter.types = types;
    if (notTypes.length) filter.notTypes = notTypes;
  }

  if (/\btarget untapped\b/.test(lower)) filter.tapped = false;
  else if (/\btarget tapped\b/.test(lower)) filter.tapped = true;

  if (!filter.types && !filter.typesAny && !filter.notTypes?.length && /\btarget permanent\b/.test(lower)) {
    filter.kind = 'permanent';
  }

  return filter;
}

/** Parse fight clauses from oracle text. */
function parseFightEffect(s) {
  const lower = String(s || '').toLowerCase();
  if (!/\bfights?\b/.test(lower)) return null;

  if (/target creature you control fights target creature/.test(lower)) {
    const tail = s.slice(lower.indexOf('fights') + 5);
    return {
      type: 'fight',
      sourceFilter: parseTargetFilter('target creature you control'),
      targetFilter: parseTargetFilter(tail),
    };
  }
  if (/target creature fights (?:with )?(?:another )?target creature/.test(lower)) {
    return { type: 'fight', mode: 'pickBoth', filter: { types: ['creature'] } };
  }
  if (/equipped creature fights (?:with )?(?:target )?creature/.test(lower)) {
    return { type: 'fight', srcSelf: true, equipped: true, filter: parseTargetFilter(s) };
  }
  if (/\b(?:it|this creature|this permanent|~)\s+fights (?:with )?(?:target )?creature/.test(lower)) {
    return { type: 'fight', srcSelf: true, filter: parseTargetFilter(s) };
  }
  if (/\bfights (?:with )?(?:target )?creature/.test(lower)) {
    return { type: 'fight', srcSelf: true, filter: parseTargetFilter(s) };
  }
  return null;
}

// parseCastCondition(subjectText) — parse the qualifier on a "whenever you cast
// <subject>" trigger (or a mana-spend restriction) into a structured condition.
// Returns null when the subject is unqualified ("a spell" → fires for anything).
function parseCastCondition(subject) {
  if (!subject) return null;
  const s = String(subject).toLowerCase();
  const cond = {};
  let m;
  m = s.match(/mana value (\d+) or greater/);
  if (m) cond.minMv = +m[1];
  m = s.match(/mana value (\d+) or less/);
  if (m) cond.maxMv = +m[1];
  if (cond.minMv == null && cond.maxMv == null) {
    m = s.match(/mana value (?:of\s+)?(?:exactly\s+)?(\d+)\b/);
    if (m) cond.exactMv = +m[1];
  }
  const typeWords = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle'];
  const types = [], notTypes = [];
  for (const t of typeWords) {
    if (new RegExp('non' + t).test(s)) notTypes.push(t);
    else if (new RegExp('\\b' + t + '\\b').test(s)) types.push(t);
  }
  if (types.length) cond.types = types;
  if (notTypes.length) cond.notTypes = notTypes;
  const colorMap = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const colors = [];
  for (const [w, c] of Object.entries(colorMap)) {
    if (new RegExp('\\b' + w + '\\b').test(s)) colors.push(c);
  }
  if (colors.length) cond.colors = colors;
  if (/\bmulticolored\b/.test(s)) cond.multicolored = true;
  if (/with \{x\}/.test(s) || /\bwith x in\b/.test(s) || /\{x\} in (?:their|its) mana cost/.test(s)) cond.hasX = true;
  // State counter: "your <ordinal> spell each turn" — Veyran, Storm-the-Vault.
  // Captured as cond.nthSpell. The current cast must be the Nth (castThisTurn.length === N).
  const ord = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  for (const [w, n] of Object.entries(ord)) {
    if (new RegExp('\\byour ' + w + '\\b').test(s)) cond.nthSpell = n;
  }
  return Object.keys(cond).length ? cond : null;
}

// castSpellMatchesCondition(cond, ctx) — does a cast spell satisfy a condition?
// ctx = { mv, types:[lowercased type words], colors:['W'...], hasX,
//         castCount: number of spells cast this turn (including this one) }.
function castSpellMatchesCondition(cond, ctx) {
  if (!cond) return true;
  if (!ctx) return false;
  if (cond.anyOf) return cond.anyOf.some(c => castSpellMatchesCondition(c, ctx));
  const mv = ctx.mv || 0;
  if (cond.minMv != null && mv < cond.minMv) return false;
  if (cond.maxMv != null && mv > cond.maxMv) return false;
  if (cond.exactMv != null && mv !== cond.exactMv) return false;
  const types = ctx.types || [];
  if (cond.types && !cond.types.some(t => types.includes(t))) return false;
  if (cond.notTypes && cond.notTypes.some(t => types.includes(t))) return false;
  if (cond.colors) {
    const cc = ctx.colors || [];
    if (!cond.colors.some(c => cc.includes(c))) return false;
  }
  if (cond.multicolored && (ctx.colors || []).length < 2) return false;
  if (cond.hasX && !ctx.hasX) return false;
  if (cond.nthSpell != null) {
    const cnt = ctx.castCount || 0;
    if (cnt !== cond.nthSpell) return false;
  }
  return true;
}

// parseTriggers(oracleText, cardName) → TriggerMap
function parseTriggers(oracleText, cardName) {
  const result = {
    spellBody:    [],
    onCast:       [],   // "When you cast this spell, ..." (fires for the card itself)
    onAnyCast:    [],   // "Whenever you cast a spell, ..." (fires on the bf permanent for ANY cast)
    onETB:        [],   // "When ~ enters the battlefield" (self)
    onAnyETB:     [],   // "Whenever a/another creature enters" (any-creature-ETB)
    onLandfall:   [],   // "Landfall — ..." / "Whenever a land enters under your control"
    onUpkeep:     [],
    onEndStep:    [],
    onAttack:     [],   // self-attack
    onAnyAttack:  [],   // any creature attack
    onCombatDamage:    [], // "Whenever ~ deals combat damage to a player" (self)
    onAnyCombatDamage: [], // "Whenever a creature you control deals combat damage to a player"
    onDeath:      [],   // self-death
    onAnyDeath:   [],   // any creature death
    onLifeGain:   [],   // "Whenever you gain life, ..."
    onOppCast:    [],   // "Whenever an opponent casts a spell, ..." (Rhystic Study)
  };
  if (!oracleText) return result;

  const sentences = _gfeSplitSentences(oracleText);
  for (const sentence of sentences) {
    const stripped = stripTriggerPrefix(sentence);
    const { kind, body, subject } = stripped;
    const effects = parseEffects(body);
    if (!effects.length) continue;
    if (kind === 'anyCast' || kind === 'oppCast' || kind === 'playerCast') {
      // Stamp the cast condition (if any) on each effect so firing can gate it.
      const cond = parseCastCondition(subject);
      if (cond) effects.forEach(fx => { fx._castCondition = cond; });
    }
    // Event triggers: stamp the subject type ("creature", "elf", ...) and its
    // controller scope so the firing side can filter by event card + side.
    if (kind === 'anyETB' || kind === 'anyDeath' || kind === 'anyAttack' || kind === 'anyCombatDamage') {
      let st = String(stripped.subjectType || '').toLowerCase().trim();
      const scope = (stripped.subjectYouControl || /\byou control\b/.test(st)) ? 'you' : 'any';
      st = st.replace(/\s*\byou control\b\s*/, ' ').replace(/\s+/g, ' ').trim();
      effects.forEach(fx => { fx._subjectType = st || null; fx._eventScope = scope; });
    }
    // Phase triggers: remember whose phase ("your" / "each" / "opp") so they
    // can also fire on the opponent's turn when appropriate.
    if (kind === 'upkeep' || kind === 'endStep') {
      const ps = stripped.phaseScope || 'your';
      effects.forEach(fx => { fx._phaseScope = ps; });
    }
    if (kind === 'cast')         result.onCast.push(...effects);
    else if (kind === 'anyCast') result.onAnyCast.push(...effects);
    else if (kind === 'oppCast') result.onOppCast.push(...effects);
    else if (kind === 'playerCast') {
      // "Whenever a player casts ..." fires for both your casts and theirs.
      result.onAnyCast.push(...effects);
      result.onOppCast.push(...effects);
    }
    else if (kind === 'etb')     result.onETB.push(...effects);
    else if (kind === 'anyETB')  result.onAnyETB.push(...effects);
    else if (kind === 'landfall')result.onLandfall.push(...effects);
    else if (kind === 'upkeep')  result.onUpkeep.push(...effects);
    else if (kind === 'endStep') result.onEndStep.push(...effects);
    else if (kind === 'attack')  result.onAttack.push(...effects);
    else if (kind === 'anyAttack') result.onAnyAttack.push(...effects);
    else if (kind === 'combatDamage')    result.onCombatDamage.push(...effects);
    else if (kind === 'anyCombatDamage') result.onAnyCombatDamage.push(...effects);
    else if (kind === 'death')   result.onDeath.push(...effects);
    else if (kind === 'anyDeath')result.onAnyDeath.push(...effects);
    else if (kind === 'lifeGain')result.onLifeGain.push(...effects);
    else result.spellBody.push(...effects);
  }

  // Replacement effect: "~ enters the battlefield with N (or X) +1/+1 counters on it."
  // Modeled as a self-counter ETB so the creature actually arrives with counters.
  const entersM = oracleText.match(
    /enters(?: the battlefield)? with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) (\+1\/\+1|\-1\/\-1|[a-z]+) counters? on (?:it|him|her|them|itself)\b/i);
  if (entersM) {
    const word = entersM[1].toLowerCase();
    const n = (word === 'a' || word === 'an') ? 1
            : (word === 'x') ? null
            : (_gfeWord2Num(word) || parseInt(word, 10) || 1);
    const kindRaw = entersM[2].toLowerCase();
    const kind = /\+1\/\+1/.test(kindRaw) ? '+1/+1'
               : /\-1\/\-1/.test(kindRaw) ? '-1/-1'
               : kindRaw;
    result.onETB.push({ type: 'counter', n, counter: kind, target: 'self', enters: true });
  }
  return result;
}

// ── Sagas (A10) ──────────────────────────────────────────────────────────────
// parseSagaChapters(oracleText) → { maxChapter, entries: [{chapters:[1,2], body, effects}] } | null
// Matches chapter lines like "I — Draw a card." or "I, II — Create a 1/1 ...".
const _GFE_ROMAN_NUM = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
function parseSagaChapters(oracleText) {
  if (!oracleText) return null;
  const lines = String(oracleText).replace(/\r/g, '').split('\n');
  const entries = [];
  let maxChapter = 0;
  for (const line of lines) {
    const m = line.match(/^\s*((?:I{1,3}|IV|V|VI)(?:\s*,\s*(?:I{1,3}|IV|V|VI))*)\s*[—–-]\s*(.+)$/);
    if (!m) continue;
    const chapters = m[1].split(/\s*,\s*/)
      .map(r => _GFE_ROMAN_NUM[r.trim().toLowerCase()] || 0)
      .filter(Boolean);
    if (!chapters.length) continue;
    const body = m[2].trim();
    entries.push({ chapters, body, effects: parseEffects(body) });
    maxChapter = Math.max(maxChapter, ...chapters);
  }
  if (!entries.length) return null;
  return { maxChapter, entries };
}

// parseLoyaltyAbilities(oracleText) — returns Array<{cost, effects, effectStr, source_text}>.
// Cost is a signed integer (+1, -3, 0). Planeswalkers use "+N:" / "-N:" / "0:"
// at the start of each ability line (with a real minus sign or hyphen).
function parseLoyaltyAbilities(oracleText) {
  if (!oracleText) return [];
  const out = [];
  const lines = String(oracleText).replace(/\r/g, '').split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([+\-−])?(\d+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const sign = m[1];
    const mag  = parseInt(m[2], 10);
    let cost;
    if (sign === '+') cost = mag;
    else if (sign === '-' || sign === '−') cost = -mag;
    else cost = 0;
    const effectStr = m[3];
    const effects = parseEffects(effectStr);
    out.push({ cost, effects, effectStr, source_text: line.trim() });
  }
  return out;
}

// parseActivatedAbilities(oracleText) — returns Array<{cost, effects, costStr, effectStr}>
// Matches "[cost]: [effect]" sentences. Skips mana abilities ({T}: Add ...)
// and planeswalker loyalty abilities (+N: / -N:).
function parseActivatedAbilities(oracleText) {
  if (!oracleText) return [];
  const abilities = [];
  const sentences = _gfeSplitSentences(oracleText);
  for (const sentence of sentences) {
    // Match "X: Y" — cost is everything before the first colon. Be defensive:
    // the colon must be followed by a space + capital letter or word, not part
    // of a non-cost phrase.
    const m = sentence.match(/^([^:]+?):\s+(.+)$/);
    if (!m) continue;
    const costStr = m[1].trim();
    const effectStr = m[2].trim();

    // Skip mana abilities (handled by engine-mana.parseManaProduction)
    if (/^add\s+/i.test(effectStr)) continue;
    // Skip planeswalker loyalty abilities — different cost model
    if (/^[+\-−]\d+$/.test(costStr) || /^0$/.test(costStr)) continue;
    // Skip lines that look like restrictions ("Activate this ability only as a sorcery")
    if (/^activate this ability/i.test(effectStr)) continue;

    const cost = parseAbilityCost(costStr);
    if (!cost) continue;

    const effects = parseEffects(effectStr);
    if (!effects.length) continue;

    abilities.push({ cost, effects, costStr, effectStr, source_text: sentence });
  }
  return abilities;
}

// parseAbilityCost(costStr) — returns
//   { tap, mana, sacrificeSelf, sacrificeOther, discard, life, removeCounters }
function parseAbilityCost(costStr) {
  const cost = {
    tap: false,
    mana: '',
    sacrificeSelf: false,   // "Sacrifice ~" / "Sacrifice this creature"
    sacrificeOther: null,   // descriptor like "a creature" / "another Goblin" — user picks
    discard: 0,
    life: 0,
    removeCounters: null,   // { kind: 'charge'|'+1/+1'|..., n } — removed from the source
    raw: costStr,
  };
  const parts = costStr.split(',').map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (/^\{t\}$/i.test(part)) { cost.tap = true; continue; }
    if (/^tap\b/i.test(part))   { cost.tap = true; continue; }
    // "Sacrifice ~" / "Sacrifice this …" / "Sacrifice [this card's name]"
    const sacOther = part.match(/^sacrifice\s+(?:a|an|another|one|two|three|four|five|\d+)\s+/i);
    if (sacOther) { cost.sacrificeOther = part.replace(/^sacrifice\s+/i, '').trim(); continue; }
    if (/^sacrifice\b/i.test(part)) { cost.sacrificeSelf = true; continue; }
    const dm = part.match(/^discard\s+(a|one|two|three|four|five|\d+)\s*(?:cards?)?$/i);
    if (dm) {
      cost.discard = dm[1].toLowerCase() === 'a' ? 1 : (_gfeWord2Num(dm[1]) || 1);
      continue;
    }
    // "Remove a/N <kind> counter(s) from ~ / this <type>"
    const rm = part.match(/^remove\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(\+1\/\+1|\-1\/\-1|[a-z]+(?:[ -][a-z]+)?)\s+counters?\s+from\b/i);
    if (rm) {
      const w = rm[1].toLowerCase();
      cost.removeCounters = {
        n: (w === 'a' || w === 'an') ? 1 : (_gfeWord2Num(w) || parseInt(w, 10) || 1),
        kind: rm[2].toLowerCase(),
      };
      continue;
    }
    const lm = part.match(/^pay\s+(\d+)\s+life/i);
    if (lm) { cost.life = +lm[1]; continue; }
    // Mana symbol cluster
    if (/^(?:\{[^}]+\})+$/.test(part)) { cost.mana += part; continue; }
    // Unknown cost component — can't auto-pay, return null
    return null;
  }
  return cost;
}

// parseModalChoices(oracleText) — parses any "Choose [N] —" modal pattern.
// Returns null if not modal; otherwise:
//   { picks: number|Infinity, minPicks: number, options: [{label, effects}, ...] }
function parseModalChoices(oracleText) {
  if (!oracleText) return null;
  const text = oracleText.replace(/\r/g, '').replace(/\(([^)]*)\)/g, '').trim();
  // Patterns:
  //   "Choose one —"
  //   "Choose two —" / "Choose three —" / etc. (numeric)
  //   "Choose one or both —" (Cryptic Command-style)
  //   "Choose one or more —"
  //   "Choose any number —"
  //   "Choose up to two —" / "Choose up to N —"
  const m = text.match(/choose\s+(any number|one or both|one or more|up to (?:one|two|three|four|five|\d+)|one|two|three|four|five|\d+)\s*[—\-]\s*([\s\S]+?)(?:\.\s*$|$)/i);
  if (!m) return null;

  const picksStr = m[1].toLowerCase().trim();
  let picks = 1;
  let minPicks = 1;
  if (picksStr === 'one or both') { picks = 2; minPicks = 1; }
  else if (picksStr === 'one or more') { picks = Infinity; minPicks = 1; }
  else if (picksStr === 'any number')  { picks = Infinity; minPicks = 0; }
  else if (picksStr.startsWith('up to ')) {
    const n = _gfeWord2Num(picksStr.slice(6)) || parseInt(picksStr.slice(6), 10) || 1;
    picks = n; minPicks = 0;
  } else {
    picks = _gfeWord2Num(picksStr) || parseInt(picksStr, 10) || 1;
    minPicks = picks;
  }

  // Options separated by "; or " / "; "
  const rest = m[2].trim();
  const rawOpts = rest.split(/;\s*(?:or\s+)?/i).map(s => s.trim()).filter(Boolean);
  if (rawOpts.length < 2) return null;
  // Cap unbounded "any number" / "one or more" at the option count.
  if (!Number.isFinite(picks)) picks = rawOpts.length;

  const options = rawOpts.map(label => {
    // Optional per-option condition: "If <cond>, <body>" — when present,
    // the option is only legal when the condition is met.
    let condition = null;
    let body = label;
    const cm = label.match(/^if\s+([^,]+?),\s*(.+)$/i);
    if (cm) {
      const parsed = parseBranchCondition(cm[1].trim());
      if (parsed && parsed.kind && parsed.kind !== 'unparsed') {
        condition = parsed;
        body = cm[2].trim();
      }
    }
    return {
      label,
      condition,
      effects: parseEffects(body),
    };
  });
  return { picks, minPicks, options };
}

// parseSpendRestriction(text) — parse "Spend this mana only to cast <X> or <Y>"
// into a condition, OR-ing alternative spell-type clauses.
function parseSpendRestriction(text) {
  if (!text) return null;
  const clauses = String(text)
    .split(/\s+or\s+(?=(?:a |an |another )?(?:creature|noncreature|artifact|enchantment|instant|sorcery|planeswalker|land|multicolored|colorless|spell))/i)
    .map(c => c.trim()).filter(Boolean);
  const anyOf = clauses.map(parseCastCondition).filter(Boolean);
  if (!anyOf.length) return null;
  return anyOf.length === 1 ? anyOf[0] : { anyOf };
}

// parseManaAbilities(oracleText) — returns Array of mana-ability descriptors:
//   { costTap, costSacSelf, costSacOther, amount: number|'var',
//     varKind:'power'|'toughness', colors:'any'|['W',...],
//     chooseColor, restriction, source_text }
function parseManaAbilities(oracleText) {
  if (!oracleText) return [];
  const out = [];
  const restrMatch = oracleText.match(/spend this mana only to cast ([^.]+)/i);
  let restriction = restrMatch ? parseSpendRestriction(restrMatch[1]) : null;
  // Powerstone-style negative phrasing: "This mana can't be spent to cast a
  // nonartifact spell." → equivalent to "spend only to cast artifact spells".
  if (!restriction) {
    const cantMatch = oracleText.match(/this mana can't be spent to cast a non(\w+) spell/i);
    if (cantMatch) restriction = parseSpendRestriction(`${cantMatch[1]} spells`);
  }
  for (const sentence of _gfeSplitSentences(oracleText)) {
    const m = sentence.match(/^([^:]+?):\s*(add\s+.+)$/i);
    if (!m) continue;
    const costStr = m[1];
    const addStr = m[2];
    const costTap = /\{t\}/i.test(costStr) || /\btap\b/i.test(costStr);
    // Sacrifice in the cost: "Sacrifice this artifact" / "Sacrifice ~" → self;
    // "Sacrifice a creature" (Ashnod's Altar) → other, user picks.
    let costSacSelf = false, costSacOther = null;
    const sacM = costStr.match(/\bsacrifice\s+(?:(a|an|another|one|two|three|four|five|\d+)\s+)?([^,:{]*)/i);
    if (sacM) {
      if (sacM[1]) costSacOther = `${sacM[1]} ${sacM[2]}`.trim();
      else costSacSelf = true;
    }
    const ab = _gfeParseAddClause(addStr);
    if (!ab) continue;
    ab.costTap = costTap;
    ab.costSacSelf = costSacSelf;
    ab.costSacOther = costSacOther;
    ab.restriction = restriction;
    ab.source_text = sentence;
    out.push(ab);
  }
  return out;
}

function _gfeParseAddClause(addStr) {
  const s = addStr.toLowerCase();
  let varKind = null;
  const isVar = /\badd x mana\b/.test(s);
  if (isVar) varKind = /toughness/.test(s) ? 'toughness' : 'power';

  if (/any (?:one )?color/.test(s)) {
    let n = isVar ? 'var' : 1;
    if (!isVar) {
      const nm = s.match(/add (one|two|three|four|five|\d+) mana of any/);
      if (nm) n = _gfeWord2Num(nm[1]) || 1;
    }
    return { amount: n, varKind, colors: 'any', chooseColor: true };
  }

  const syms = (addStr.match(/\{([wubrgc])\}/gi) || []).map(x => x.slice(1, -1).toUpperCase());
  if (/\bor\b/.test(s) && syms.length >= 2) {
    return { amount: 1, colors: [...new Set(syms)], chooseColor: true };
  }
  if (syms.length) {
    return { amount: syms.length, colors: syms, chooseColor: false };
  }
  if (isVar) {
    return { amount: 'var', varKind, colors: 'any', chooseColor: true };
  }
  return null;
}

// parseKeywords(card) → KeywordSet
const _GFE_KEYWORDS = [
  'haste', 'vigilance', 'lifelink', 'deathtouch',
  'first strike', 'double strike', 'trample',
  'flying', 'reach', 'menace', 'defender', 'flash',
  'indestructible', 'hexproof', 'shroud',
];

function parseKeywords(card) {
  const result = {
    haste: false, vigilance: false, lifelink: false, deathtouch: false,
    firstStrike: false, doubleStrike: false, trample: false,
    flying: false, reach: false, menace: false, defender: false, flash: false,
    indestructible: false, hexproof: false, shroud: false, ward: null,
  };
  if (!card) return result;

  const has = (kw) => {
    // 1. Scryfall structured keywords array
    if (Array.isArray(card.keywords)) {
      for (const k of card.keywords) {
        if (String(k).toLowerCase() === kw) return true;
      }
    }
    // 2. Manual markers added by user
    if (Array.isArray(card.markers)) {
      for (const m of card.markers) {
        if (String(m).toLowerCase() === kw) return true;
      }
    }
    // 3. Oracle text — check at start of a line to avoid reminder text matches
    const oracle = (card.oracleText || card.oracle_text || '');
    if (oracle) {
      const re = new RegExp('(?:^|\\n|, )' + kw.replace(/\s+/g, '\\s+') + '(?:\\b|[,.\\n])', 'i');
      if (re.test(oracle)) return true;
    }
    return false;
  };

  for (const kw of _GFE_KEYWORDS) {
    const key = kw.replace(/\s+(.)/g, (_, c) => c.toUpperCase()); // "first strike" → "firstStrike"
    result[key] = has(kw);
  }

  // Ward N
  const oracle = card.oracleText || card.oracle_text || '';
  const wardMatch = oracle.match(/\bward\s*\{(\d+)\}/i) || oracle.match(/\bward (\d+)\b/i);
  if (wardMatch) result.ward = +wardMatch[1];

  return result;
}

/** Extract "Protection from <X>" entries from a card's oracle text.
 *  Returns Array<{kind:'color'|'type'|'all', value:'W'|'creature'|...}>. */
function parseProtections(card) {
  if (!card) return [];
  const oracle = String(card.oracleText || card.oracle_text || '')
    .replace(/\(([^)]*)\)/g, '');   // strip reminder text
  if (!oracle) return [];
  const lower = oracle.toLowerCase();
  const out = [];
  if (/\bprotection from everything\b/.test(lower)) {
    out.push({ kind: 'all', value: 'all' });
  }
  const colorMap = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  // "Protection from <colors> (and from <colors>) (and from <type>)"
  // Pull every "(protection )?from <word>" clause that follows a "protection" anchor.
  // Approach: find each "protection from …" run and scan inside it.
  const runs = lower.match(/protection from [^.;\n]+/g) || [];
  for (const run of runs) {
    for (const [w, c] of Object.entries(colorMap)) {
      if (new RegExp('\\b' + w + '\\b').test(run)) out.push({ kind: 'color', value: c });
    }
    if (/\bmulticolored\b/.test(run))         out.push({ kind: 'multicolored', value: true });
    if (/\bmonocolored\b/.test(run))          out.push({ kind: 'monocolored', value: true });
    if (/\bcolorless\b/.test(run))            out.push({ kind: 'colorless', value: true });
    for (const type of ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land']) {
      if (new RegExp('\\b' + type + 's?\\b').test(run)) out.push({ kind: 'type', value: type });
    }
  }
  return out;
}

/** Best-effort color list for a card. Scryfall's `colors` array, else parses
 *  the mana cost. Used as the "source colors" when checking protections. */
function cardColorIdentitySimple(card) {
  if (!card) return [];
  if (Array.isArray(card.colors) && card.colors.length) return card.colors;
  if (typeof parseMana === 'function' && (card.mana || card.mana_cost)) {
    const m = parseMana(card.mana || card.mana_cost);
    const out = [];
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      if (m.colored?.[c] > 0) out.push(c);
    }
    return out;
  }
  return [];
}

/** Bestow cost string e.g. "{2}{U}" from "Bestow {2}{U}", or null. */
function parseBestowCost(oracleText) {
  const m = String(oracleText || '').match(/\bbestow\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Reconfigure cost string e.g. "{2}{U}" from "Reconfigure {2}{U}", or null. */
function parseReconfigureCost(oracleText) {
  const m = String(oracleText || '').match(/\breconfigure\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Foretell cost string e.g. "{1}{U}" from "Foretell {1}{U}", or null. */
function parseForetellCost(oracleText) {
  const m = String(oracleText || '').match(/\bforetell\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Flashback cost string from "Flashback {cost}". */
function parseFlashbackCost(oracleText) {
  const m = String(oracleText || '').match(/\bflashback\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Jump-start has no mana cost (uses card's printed cost); detect presence. */
function hasJumpStart(oracleText) {
  return /\bjump[- ]start\b/i.test(String(oracleText || ''));
}

/** Disturb cost (flips to back face on cast from gy, exile on resolve). */
function parseDisturbCost(oracleText) {
  const m = String(oracleText || '').match(/\bdisturb\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Buyback cost ("Buyback {cost}" — pay to return to hand on resolve instead of gy). */
function parseBuybackCost(oracleText) {
  const m = String(oracleText || '').match(/\bbuyback\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Evoke cost ("Evoke {cost}" — cast for alt cost, sacrifice on ETB). */
function parseEvokeCost(oracleText) {
  const m = String(oracleText || '').match(/\bevoke\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Spectacle cost ("Spectacle {cost}" — alt cost if an opp lost life this turn). */
function parseSpectacleCost(oracleText) {
  const m = String(oracleText || '').match(/\bspectacle\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/** Madness cost ("Madness {cost}" — when discarded, exile and may cast for cost). */
function parseMadnessCost(oracleText) {
  const m = String(oracleText || '').match(/\bmadness\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/**
 * Escape cost — "Escape—{cost}, Exile N other cards from your graveyard."
 * Returns { mana: '{1}{B}', exileN: 3 } or null.
 */
function parseEscapeCost(oracleText) {
  const text = String(oracleText || '');
  const m = text.match(/\bescape\s*[—\-]\s*((?:\{[^}]+\})+)\s*,\s*exile\s+(\w+)\s+other cards from your graveyard/i);
  if (!m) return null;
  const mana = m[1].trim();
  const exileN = _gfeWord2Num(m[2].toLowerCase()) || parseInt(m[2], 10) || 0;
  if (exileN <= 0) return null;
  return { mana, exileN };
}

/**
 * Emerge cost — "Emerge {cost} (You may cast this spell by sacrificing a
 * creature and paying the emerge cost reduced by that creature's mana value.)"
 * Returns the printed emerge mana cost (we reduce it by sacced CMC at cast time).
 */
function parseEmergeCost(oracleText) {
  const m = String(oracleText || '').match(/\bemerge\s+((?:\{[^}]+\})+)/i);
  return m ? m[1].trim() : null;
}

/**
 * Suspend cost — "Suspend N—{cost}" — pays cost to exile from hand with N
 * time counters; auto-tick one per upkeep; cast for free when last is removed.
 * Returns { n, mana } or null.
 */
function parseSuspendCost(oracleText) {
  const text = String(oracleText || '');
  // "Suspend 3—{R}" or "Suspend 3 — {R}"
  let m = text.match(/\bsuspend\s+(\d+)\s*[—\-]\s*((?:\{[^}]+\})+)/i);
  if (!m) return null;
  return { n: parseInt(m[1], 10), mana: m[2].trim() };
}

/**
 * Storm — keyword that fires "copy this spell for each spell cast before it
 * this turn" when the spell is cast. Detect via standalone keyword or
 * reminder-text form ("Storm" on its own line is reliable since the rest is
 * always reminder text inside parens which the parser strips).
 */
function hasStorm(oracleText) {
  const text = String(oracleText || '');
  // Match "Storm" at start of a line OR followed by a period/end-of-line.
  return /(?:^|[\.\n])\s*storm\b/i.test(text);
}

/**
 * Parse cost-modification static effects. Returns an array of
 *   { kind:'reduce'|'increase'|'floor', amount, filter, side }
 * where filter is { types?, notTypes?, controller? } and side is
 * 'you'|'opp'|'any'.
 *
 *   "Instant and sorcery spells you cast cost {1} less to cast"
 *   "Noncreature spells cost {1} more to cast"
 *   "Each spell costs at least {3} to cast"  (Trinisphere — floor)
 *
 * Detection is per-sentence and conservative — unmatched sentences are
 * ignored. Only generic mana is adjusted at cast time; colored pips are
 * never reduced.
 */
function parseCostModifiers(oracleText) {
  const out = [];
  const text = String(oracleText || '');
  for (const raw of _gfeSplitSentences(text)) {
    const s = raw.toLowerCase();

    // "Each spell costs at least {N} to cast" — Trinisphere floor
    let m = s.match(/each spell costs at least \{(\d+)\}/i);
    if (m) {
      out.push({ kind: 'floor', amount: parseInt(m[1], 10), filter: { types: ['spell'] }, side: 'any' });
      continue;
    }

    // "<filter> spells [you cast|<player> cast] cost {N} (less|more) to cast"
    m = s.match(/^([a-z][a-z\s,-]*?)spells?\s+(you cast|your opponents cast|each opponent casts)?\s*cost\s*\{(\d+)\}\s*(less|more)\b/);
    if (!m) {
      // also catch "Spells you cast cost {N} less"
      m = s.match(/^spells?\s+(you cast|your opponents cast|each opponent casts)\s+cost\s*\{(\d+)\}\s*(less|more)\b/);
      if (m) {
        const side = /opponent/.test(m[1]) ? 'opp' : 'you';
        out.push({
          kind: m[3] === 'less' ? 'reduce' : 'increase',
          amount: parseInt(m[2], 10),
          filter: { types: ['spell'] },
          side,
        });
        continue;
      }
    }
    if (m) {
      const filterText = (m[1] || '').trim();
      const side = m[2] && /opponent/.test(m[2]) ? 'opp'
                  : (m[2] && /you/.test(m[2])) ? 'you' : 'any';
      out.push({
        kind: m[4] === 'less' ? 'reduce' : 'increase',
        amount: parseInt(m[3], 10),
        filter: _gfeParseCostModFilter(filterText),
        side,
      });
      continue;
    }
  }
  return out;
}

function _gfeParseCostModFilter(text) {
  if (!text) return { types: ['spell'] };
  const t = text.toLowerCase().trim();
  const notTypes = [];
  const types = [];
  // "noncreature" / "nonland"
  const nonRe = /\bnon([a-z]+)/g;
  let nm;
  while ((nm = nonRe.exec(t)) !== null) notTypes.push(nm[1]);
  for (const type of ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'tribal']) {
    if (new RegExp(`\\b${type}\\b`).test(t) && !notTypes.includes(type)) types.push(type);
  }
  if (/\binstant and sorcery\b/.test(t) || /\binstant or sorcery\b/.test(t)) {
    if (!types.includes('instant')) types.push('instant');
    if (!types.includes('sorcery')) types.push('sorcery');
  }
  const filter = {};
  if (types.length) filter.types = types;
  if (notTypes.length) filter.notTypes = notTypes;
  return filter;
}

/**
 * Parse Kicker / Multikicker costs from oracle text. Returns
 *   { costs: ['{R}', '{2}{W}'], multikicker: '{1}' | null }
 * or null when no kicker.
 *
 * Multikicker can be paid any number of times. Plain Kicker can list multiple
 * separate costs, each independently chosen.
 */
function parseKickerCosts(oracleText) {
  const text = String(oracleText || '');
  let multikicker = null;
  const mk = text.match(/\bmultikicker\s+((?:\{[^}]+\})+)/i);
  if (mk) multikicker = mk[1].trim();
  const costs = [];
  const re = /\bkicker\s+((?:\{[^}]+\})+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Skip multikicker matches (they have "multi" prefix already consumed)
    const start = m.index;
    if (start >= 5 && /multi/i.test(text.slice(start - 5, start))) continue;
    costs.push(m[1].trim());
  }
  if (!costs.length && !multikicker) return null;
  return { costs, multikicker };
}

/**
 * Detects Bolas's Citadel-style "play from top of library" with a life-cost
 * alt for casting spells. Returns { lifeAsMv: true } or null. Narrow scope:
 * we don't model arbitrary "play the top card" permission cards yet.
 */
function parseTopOfLibraryPlay(oracleText) {
  const t = String(oracleText || '').toLowerCase();
  const playsTop = /play (?:lands? and )?(?:cast )?(?:the top card|spells?) (?:from |of |off )?the top/i.test(t)
    || /you may play (?:lands?|spells?|the top card|cards?) (?:from |off )?the top of your library/i.test(t)
    || /play (?:lands? and (?:cast )?spells? )?from the top of your library/i.test(t);
  if (!playsTop) return null;
  const lifeAsMv = /pay (?:\d+ )?life equal to its (?:converted )?mana (?:value|cost)/i.test(t)
    || /rather than (?:pay|paying) (?:its )?mana cost/i.test(t);
  return { lifeAsMv };
}

/** Equip costs from oracle — [{ mana: '{2}', label: '' }, { mana: '{1}', label: 'Dwarf' }]. */
function parseEquipAbilities(oracleText) {
  const out = [];
  const re = /\bequip\b(?:\s+([^{][\w\s]*?))?\s+((?:\{[^}]+\})+)/gi;
  let m;
  const text = String(oracleText || '');
  while ((m = re.exec(text)) !== null) {
    out.push({ mana: m[2].trim(), label: (m[1] || '').trim() });
  }
  return out;
}

// matchesFilter(card, filter, ctx) — does the card match the structured filter?
// `ctx.controller` is the player who's choosing (default 'you'). Used to resolve
// "you control" / "an opponent controls" predicates against card.controller.
function matchesFilter(card, filter, ctx) {
  if (!card) return false;
  if (!filter) return true;
  const typeLine = String(card.type || card.typeLine || '').toLowerCase();
  const cardCtrl = card.controller || 'you';
  const youCtrl  = (ctx && ctx.controller) || 'you';

  // Controller constraint
  if (filter.controller === 'you' && cardCtrl !== youCtrl) return false;
  if (filter.controller === 'opp') {
    if (cardCtrl === youCtrl) return false;
  }

  // Type sets
  const hasType = (t) => new RegExp('\\b' + t + '\\b', 'i').test(typeLine);
  if (filter.types && filter.types.length) {
    if (!filter.types.every(t => hasType(t))) return false;
  }
  if (filter.typesAny && filter.typesAny.length) {
    if (!filter.typesAny.some(t => hasType(t))) return false;
  }
  if (filter.notTypes && filter.notTypes.length) {
    if (filter.notTypes.some(t => hasType(t))) return false;
  }

  // Tapped state
  if (filter.tapped === true && !card.tapped) return false;
  if (filter.tapped === false && card.tapped) return false;

  // 'permanent' kind — any battlefield card matches (we only test bf cards anyway)
  if (filter.kind === 'permanent') {
    // No restriction beyond above
  }

  return true;
}
