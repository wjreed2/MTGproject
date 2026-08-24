/**
 * Deck theme readout — themes running through the list, plus how they jive
 * or clash with the user's Plan strategies.
 *
 * Deterministic. Uses project role tags, Oracle text, type line, and CardIR
 * provides when present. Does not call Scryfall or EDHREC. Band numbers live
 * in DECK_THEME_CONFIG so they can be retuned without rewriting detection.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  /**
   * Support quality bands. Thresholds are starting values (10 = decent, 30 =
   * very focused) and may be retuned later.
   */
  const DECK_THEME_CONFIG = Object.freeze({
    bands: Object.freeze([
      Object.freeze({ id: 'none', min: 0, label: 'None' }),
      Object.freeze({ id: 'trace', min: 1, label: 'Trace' }),
      Object.freeze({ id: 'light', min: 5, label: 'Light' }),
      Object.freeze({ id: 'decent', min: 10, label: 'Decent' }),
      Object.freeze({ id: 'focused', min: 18, label: 'Focused' }),
      Object.freeze({ id: 'very_focused', min: 30, label: 'Very focused' }),
    ]),
    /** Hide detected themes weaker than this unless the user set them. */
    minListCount: 5,
    /** Bar fills relative to this count (very-focused mark). */
    barCap: 30,
    tribalMinBodies: 8,
    /** Both themes must be at least this band to count as a clash. */
    clashMinBand: 'focused',
    maxShownCards: 12,
  });

  const THEME_CATALOG = Object.freeze([
    { id: 'strategy.tokens', label: 'Tokens / Go-wide' },
    { id: 'strategy.sacrifice', label: 'Sacrifice / Aristocrats' },
    { id: 'strategy.spellslinger', label: 'Spellslinger' },
    { id: 'strategy.reanimator', label: 'Reanimator / Graveyard' },
    { id: 'strategy.voltron', label: 'Voltron / Commander damage' },
    { id: 'strategy.counters', label: '+1/+1 Counters' },
    { id: 'strategy.landfall', label: 'Landfall' },
    { id: 'strategy.tribal', label: 'Tribal' },
    { id: 'strategy.artifacts', label: 'Artifacts' },
    { id: 'strategy.enchantress', label: 'Enchantress' },
    { id: 'strategy.control', label: 'Control / Value grind' },
    { id: 'strategy.blink', label: 'Blink / ETB value' },
    { id: 'strategy.superfriends', label: 'Superfriends' },
    { id: 'strategy.theft', label: 'Theft / Steal' },
    { id: 'strategy.stax', label: 'Stax / Resource denial' },
    { id: 'strategy.mill', label: 'Mill' },
    { id: 'strategy.goodstuff', label: 'Goodstuff / High power' },
    { id: 'theme.lifegain', label: 'Lifegain' },
  ]);

  const THEME_BY_ID = Object.fromEntries(THEME_CATALOG.map(t => [t.id, t]));

  /**
   * Distinctive tags only. Generic Ramp / Card Draw / Removal / Pump are
   * omitted so every Commander deck does not read as Control + Voltron.
   */
  const THEME_TAGS = Object.freeze({
    'strategy.tokens': Object.freeze(['Token Maker']),
    'strategy.sacrifice': Object.freeze(['Sac Outlet', 'Death Trigger', 'Sac Synergy', 'Drain']),
    'strategy.spellslinger': Object.freeze(['Copy']),
    'strategy.reanimator': Object.freeze(['Recursion', 'Reanimate', 'Graveyard Cast', 'Self-Mill']),
    'strategy.voltron': Object.freeze(['Evasion']),
    'strategy.counters': Object.freeze([]),
    'strategy.landfall': Object.freeze(['Landfall']),
    'strategy.tribal': Object.freeze([]),
    'strategy.artifacts': Object.freeze([]),
    'strategy.enchantress': Object.freeze([]),
    'strategy.control': Object.freeze(['Counterspell', 'Board Wipe']),
    'strategy.blink': Object.freeze(['Blink']),
    'strategy.superfriends': Object.freeze([]),
    'strategy.theft': Object.freeze(['Control']),
    'strategy.stax': Object.freeze(['Stax', 'Hatebear']),
    'strategy.mill': Object.freeze(['Mill']),
    'strategy.goodstuff': Object.freeze([]),
    'theme.lifegain': Object.freeze(['Lifegain', 'Drain']),
  });

  const THEME_ORACLE = Object.freeze({
    'strategy.tokens': Object.freeze([
      /\bcreate[s]?\b.{0,50}\btokens?\b/i,
      /\btoken[s]?\b.{0,30}\b(you control|enter)/i,
    ]),
    'strategy.sacrifice': Object.freeze([
      /\bwhenever you sacrifice\b/i,
      /\bsacrifice (another|a |target )/i,
      /\bwhenever .{0,40}\bdies\b/i,
    ]),
    'strategy.spellslinger': Object.freeze([
      /\bmagecraft\b/i,
      /\bwhenever you (cast|copy) (an? )?(instant|sorcery|spell)\b/i,
      /\bprowess\b/i,
      /\bstorm\b/i,
    ]),
    'strategy.reanimator': Object.freeze([
      /\breturn .{0,50} from (your )?graveyard\b/i,
      /\breanimate/i,
      /\bcast .{0,30} from (your )?graveyard\b/i,
    ]),
    'strategy.voltron': Object.freeze([
      /\bequip\b/i,
      /\bcommander damage\b/i,
      /\benchant (creature|permanent)\b/i,
    ]),
    'strategy.counters': Object.freeze([
      /\+1\/\+1 counter/i,
      /\bproliferate\b/i,
    ]),
    'strategy.landfall': Object.freeze([
      /\blandfall\b/i,
      /\bwhenever a land (you control )?enters\b/i,
      /\byou may play (an extra land|two additional lands)\b/i,
    ]),
    'strategy.artifacts': Object.freeze([
      /\bartifacts? you control\b/i,
      /\baffinity for artifacts\b/i,
      /\bmetalcraft\b/i,
      /\bwhenever (an? )?artifact\b/i,
    ]),
    'strategy.enchantress': Object.freeze([
      /\benchantments? you control\b/i,
      /\bconstellation\b/i,
      /\bwhenever (an? )?enchantment\b/i,
      /\bdraw a card.{0,20}enchantment\b/i,
    ]),
    'strategy.control': Object.freeze([
      /\bcounter target (spell|ability)\b/i,
      /\bdestroy all (creatures|permanents)\b/i,
    ]),
    'strategy.blink': Object.freeze([
      /\bexile .{0,40}return .{0,30}battlefield\b/i,
      /\bflicker\b/i,
    ]),
    'strategy.theft': Object.freeze([
      /\bgain control of\b/i,
      /\bexchange control\b/i,
    ]),
    'strategy.stax': Object.freeze([
      /\bplayers? can'?t\b/i,
      /\bcosts \{[0-9wubrg]+\}\b more/i,
      /\bskip (your |their )?(untap|draw|combat)/i,
    ]),
    'strategy.mill': Object.freeze([
      /\bmill(s|ed|ing)?\b/i,
    ]),
    'theme.lifegain': Object.freeze([
      /\bgain(s)? (life|\d+ life)\b/i,
      /\blifelink\b/i,
    ]),
  });

  /** CardIR provide axis prefix / exact axis → theme. Additive when IR is present. */
  const IR_AXIS_THEME = Object.freeze([
    { re: /^token\./, id: 'strategy.tokens' },
    { re: /^(sac\.|creatures_dying|trigger\.death|drain\.|lifeloss\.)/, id: 'strategy.sacrifice' },
    { re: /^(cast\.|copy\.spell|storm\.|trigger\.cast_payoff)/, id: 'strategy.spellslinger' },
    { re: /^(gy\.|loop\.death_recursion)/, id: 'strategy.reanimator' },
    { re: /^(voltron\.|evasion\.)/, id: 'strategy.voltron' },
    { re: /^counters\./, id: 'strategy.counters' },
    { re: /^(landfall\.|lands\.|mana\.extra_land_drop)/, id: 'strategy.landfall' },
    { re: /^tribal\./, id: 'strategy.tribal' },
    { re: /^(artifacts\.|token\.treasure)/, id: 'strategy.artifacts' },
    { re: /^enchantments\./, id: 'strategy.enchantress' },
    { re: /^(control\.counter|removal\.wipe)/, id: 'strategy.control' },
    { re: /^(blink\.|etb_value|trigger\.etb_payoff)/, id: 'strategy.blink' },
    { re: /^theft\./, id: 'strategy.theft' },
    { re: /^(control\.tax|hate\.|politics\.deterrent)/, id: 'strategy.stax' },
    { re: /^mill/, id: 'strategy.mill' },
    { re: /^lifegain\./, id: 'theme.lifegain' },
  ]);

  /** Pairs that pull in opposite directions when both are focused. */
  const CLASH_PAIRS = Object.freeze([
    Object.freeze(['strategy.voltron', 'strategy.tokens']),
    Object.freeze(['strategy.voltron', 'strategy.sacrifice']),
    Object.freeze(['strategy.stax', 'strategy.tokens']),
    Object.freeze(['strategy.stax', 'strategy.spellslinger']),
    Object.freeze(['strategy.voltron', 'strategy.mill']),
    Object.freeze(['strategy.control', 'strategy.tokens']),
  ]);

  /** Pairs that naturally cooperate — never reported as clash. */
  const JIVE_PAIRS = Object.freeze([
    Object.freeze(['strategy.tokens', 'strategy.sacrifice']),
    Object.freeze(['strategy.tokens', 'strategy.tribal']),
    Object.freeze(['strategy.tokens', 'strategy.counters']),
    Object.freeze(['strategy.tokens', 'strategy.landfall']),
    Object.freeze(['strategy.sacrifice', 'strategy.reanimator']),
    Object.freeze(['strategy.artifacts', 'strategy.voltron']),
    Object.freeze(['strategy.enchantress', 'strategy.voltron']),
    Object.freeze(['strategy.artifacts', 'strategy.tokens']),
    Object.freeze(['strategy.blink', 'strategy.control']),
    Object.freeze(['strategy.control', 'strategy.stax']),
    Object.freeze(['strategy.mill', 'strategy.reanimator']),
    Object.freeze(['strategy.counters', 'strategy.superfriends']),
    Object.freeze(['strategy.sacrifice', 'theme.lifegain']),
  ]);

  const NON_TRIBES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Land']);
  const GENERIC_TRIBES = new Set([
    'Human', 'Wizard', 'Warrior', 'Soldier', 'Shaman', 'Cleric', 'Rogue', 'Druid',
    'Advisor', 'Scout', 'Noble', 'Phyrexian', 'Spirit', 'Construct', 'Ally',
  ]);

  const BAND_RANK = Object.fromEntries(
    DECK_THEME_CONFIG.bands.map((b, i) => [b.id, i])
  );

  function themeLabel(id) {
    if (THEME_BY_ID[id]) return THEME_BY_ID[id].label;
    if (String(id).startsWith('tribal:')) {
      const tribe = id.slice(7);
      return `${tribe} tribal`;
    }
    return id;
  }

  function tribalThemeId(type) {
    const raw = String(type || '').trim();
    if (!raw) return '';
    const tribe = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    return `tribal:${tribe}`;
  }

  function supportBand(count) {
    const n = Math.max(0, Number(count) || 0);
    let band = DECK_THEME_CONFIG.bands[0];
    for (const b of DECK_THEME_CONFIG.bands) {
      if (n >= b.min) band = b;
    }
    return { id: band.id, label: band.label, count: n };
  }

  function bandAtLeast(bandId, minId) {
    return (BAND_RANK[bandId] || 0) >= (BAND_RANK[minId] || 0);
  }

  function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  const CLASH_SET = new Set(CLASH_PAIRS.map(([a, b]) => pairKey(a, b)));
  const JIVE_SET = new Set(JIVE_PAIRS.map(([a, b]) => pairKey(a, b)));

  function _oracle(card) {
    if (root && typeof root.resolveCardOracleText === 'function') {
      return String(root.resolveCardOracleText(card) || '').toLowerCase();
    }
    const faces = card && (card.cardFaces || card.card_faces) || [];
    const extra = faces.map(f => f && (f.oracle_text || f.oracleText) || '').join(' ');
    return String(card && (card.oracleText || card.oracle_text) || '').toLowerCase() + ' ' + extra.toLowerCase();
  }

  function _typeLine(card) {
    if (root && typeof root.resolveCardTypeLine === 'function') {
      return String(root.resolveCardTypeLine(card) || '').toLowerCase();
    }
    return String(card && (card.type || card.typeLine || card.type_line) || '').toLowerCase();
  }

  function _roles(card, deck) {
    if (root && typeof root._probTagsOnCard === 'function') {
      try { return root._probTagsOnCard(card, deck) || []; } catch (_) { /* fall through */ }
    }
    if (Array.isArray(card && card.roleTags) && card.roleTags.length) return card.roleTags;
    if (Array.isArray(card && card.customTags)) return card.customTags;
    return [];
  }

  function _isLand(card) {
    const tl = _typeLine(card);
    return tl.includes('land') && !tl.includes('creature');
  }

  function _qty(card) {
    const n = Number(card && card.qty);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function _irThemes(card) {
    const ir = card && (card.ir || card.cardIR);
    const out = new Set();
    if (!ir || !Array.isArray(ir.provides)) return out;
    for (const p of ir.provides) {
      const axis = String(p && p.axis || '');
      if (!axis) continue;
      for (const row of IR_AXIS_THEME) {
        if (row.re.test(axis)) out.add(row.id);
      }
    }
    return out;
  }

  function _creatureSubtypes(card) {
    const raw = String(card && (card.type || card.typeLine || card.type_line) || '');
    if (!/\b[Cc]reature\b/.test(raw)) return [];
    const dash = raw.split(/[—–-]/);
    if (dash.length < 2) return [];
    return dash[dash.length - 1].split(/\s+/).map(s => s.trim()).filter(Boolean);
  }

  function cardSupportsTheme(card, themeId, ctx) {
    if (!card || !themeId || themeId === 'strategy.goodstuff' || themeId === 'strategy.other') return false;
    const tags = ctx && ctx.tags || _roles(card);
    const tagSet = ctx && ctx.tagSet || new Set(tags);
    const text = ctx && ctx.text != null ? ctx.text : _oracle(card);
    const tl = ctx && ctx.typeLine != null ? ctx.typeLine : _typeLine(card);
    const land = ctx && ctx.isLand != null ? ctx.isLand : _isLand(card);

    if (themeId.startsWith('tribal:')) {
      return _creatureSubtypes(card).some(t => tribalThemeId(t) === themeId);
    }

    if (land && themeId !== 'strategy.landfall') {
      // Token-making lands (Castle Ardenvale) still count for tokens.
      if (themeId !== 'strategy.tokens') return false;
    }

    const wantTags = THEME_TAGS[themeId] || [];
    if (wantTags.some(t => tagSet.has(t))) return true;

    const patterns = THEME_ORACLE[themeId] || [];
    if (patterns.some(re => re.test(text))) return true;

    const ir = ctx && ctx.irThemes || _irThemes(card);
    if (ir.has(themeId)) return true;

    if (themeId === 'strategy.superfriends' && tl.includes('planeswalker')) return true;
    if (themeId === 'strategy.voltron' && (/\bequipment\b/.test(tl) || /\baura\b/.test(tl))) return true;
    if (themeId === 'strategy.spellslinger' && (tl.includes('instant') || tl.includes('sorcery'))) {
      // Instants/sorceries count only when the deck already has cast-payoff density,
      // decided by the caller via ctx.spellslingerPayoffs.
      if (ctx && ctx.spellslingerPayoffs) return true;
    }
    if (themeId === 'strategy.artifacts' && tl.includes('artifact') && !land) {
      if (ctx && ctx.artifactPayoffs) return true;
    }
    if (themeId === 'strategy.enchantress' && tl.includes('enchantment')) {
      if (ctx && ctx.enchantPayoffs) return true;
    }
    return false;
  }

  function _cardCtx(card, deck) {
    const tags = _roles(card, deck);
    return {
      tags,
      tagSet: new Set(tags),
      text: _oracle(card),
      typeLine: _typeLine(card),
      isLand: _isLand(card),
      irThemes: _irThemes(card),
    };
  }

  function detectTribes(cards) {
    const bodies = Object.create(null);
    for (const card of cards) {
      if (_isLand(card)) continue;
      const q = _qty(card);
      for (const t of _creatureSubtypes(card)) {
        if (NON_TRIBES.has(t)) continue;
        bodies[t] = (bodies[t] || 0) + q;
      }
    }
    return Object.entries(bodies)
      .filter(([type, n]) => n >= DECK_THEME_CONFIG.tribalMinBodies && (!GENERIC_TRIBES.has(type) || n >= 16))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, n]) => ({ type, bodies: n, id: tribalThemeId(type) }));
  }

  function _payoffCount(cards, themeId) {
    let n = 0;
    for (const card of cards) {
      const ctx = _cardCtx(card);
      ctx.spellslingerPayoffs = false;
      ctx.artifactPayoffs = false;
      ctx.enchantPayoffs = false;
      if (cardSupportsTheme(card, themeId, ctx)) n += _qty(card);
    }
    return n;
  }

  function userThemesFromPlan(plan) {
    const p = plan && typeof plan === 'object' ? plan : {};
    const out = [];
    const seen = new Set();
    const push = (id, role) => {
      if (!id || seen.has(id) || id === 'strategy.other') return;
      seen.add(id);
      out.push({ id, label: themeLabel(id), role });
    };
    push(p.primaryStrategyId, 'primary');
    push(p.secondaryStrategyId, 'secondary');
    const win = p.winConditionId;
    if (win === 'wincon.mill') push('strategy.mill', 'wincon');
    if (win === 'wincon.commander_damage') push('strategy.voltron', 'wincon');
    if (win === 'wincon.lock') push('strategy.stax', 'wincon');
    if (win === 'wincon.life_drain') push('theme.lifegain', 'wincon');
    const typePicks = Array.isArray(p.typePicks) ? p.typePicks
      : ((p.planTypePicks && p.planTypePicks['strategy.tribal']) || []);
    for (const t of typePicks) {
      const tribe = String(t || '').trim();
      if (tribe) push(tribalThemeId(tribe), 'type');
    }
    return out;
  }

  function analyzeDeckThemes(deck, plan) {
    const cards = (deck && deck.cards) || [];
    const resolvedPlan = plan || (root && typeof root.getDeckPlan === 'function' ? root.getDeckPlan(deck) : (deck && deck.plan)) || {};
    const userThemes = userThemesFromPlan(resolvedPlan);
    const userIds = new Set(userThemes.map(t => t.id));

    const spellPayoffs = _payoffCount(cards, 'strategy.spellslinger');
    const artPayoffs = _payoffCount(cards, 'strategy.artifacts');
    const enchPayoffs = _payoffCount(cards, 'strategy.enchantress');

    const detected = [];
    for (const theme of THEME_CATALOG) {
      if (theme.id === 'strategy.goodstuff' || theme.id === 'strategy.other') continue;
      const supporters = [];
      let count = 0;
      for (const card of cards) {
        const ctx = _cardCtx(card, deck);
        ctx.spellslingerPayoffs = spellPayoffs >= 3;
        ctx.artifactPayoffs = artPayoffs >= 3;
        ctx.enchantPayoffs = enchPayoffs >= 3;
        if (!cardSupportsTheme(card, theme.id, ctx)) continue;
        count += _qty(card);
        supporters.push(card.name);
      }
      const band = supportBand(count);
      const userSet = userIds.has(theme.id);
      if (count < DECK_THEME_CONFIG.minListCount && !userSet) continue;
      detected.push({
        id: theme.id,
        label: theme.label,
        supportCount: count,
        supportLevel: band,
        cardNames: supporters,
        userSet,
      });
    }

    const tribes = detectTribes(cards);
    for (const hit of tribes) {
      if (detected.some(t => t.id === hit.id)) continue;
      const supporters = [];
      let count = 0;
      for (const card of cards) {
        if (!cardSupportsTheme(card, hit.id, _cardCtx(card, deck))) continue;
        count += _qty(card);
        supporters.push(card.name);
      }
      const userSet = userIds.has(hit.id) || userIds.has('strategy.tribal');
      detected.push({
        id: hit.id,
        label: themeLabel(hit.id),
        supportCount: count,
        supportLevel: supportBand(count),
        cardNames: supporters,
        userSet,
      });
    }

    // Always surface user-set themes, even at 0 support.
    for (const u of userThemes) {
      if (detected.some(t => t.id === u.id)) continue;
      if (u.id === 'strategy.goodstuff') {
        detected.push({
          id: u.id,
          label: u.label,
          supportCount: 0,
          supportLevel: supportBand(0),
          cardNames: [],
          userSet: true,
        });
        continue;
      }
      const supporters = [];
      let count = 0;
      for (const card of cards) {
        if (!cardSupportsTheme(card, u.id, _cardCtx(card, deck))) continue;
        count += _qty(card);
        supporters.push(card.name);
      }
      detected.push({
        id: u.id,
        label: u.label,
        supportCount: count,
        supportLevel: supportBand(count),
        cardNames: supporters,
        userSet: true,
      });
    }

    detected.sort((a, b) => {
      if (b.supportCount !== a.supportCount) return b.supportCount - a.supportCount;
      return a.label.localeCompare(b.label);
    });

    const fit = buildThemeFit(detected, userThemes);
    return {
      themes: detected,
      userThemes,
      fit,
      planDeclared: !!(resolvedPlan.primaryStrategyId && resolvedPlan.winConditionId),
      planConfirmed: !!resolvedPlan.planConfirmed,
    };
  }

  function buildThemeFit(themes, userThemes) {
    const byId = Object.fromEntries(themes.map(t => [t.id, t]));
    const notes = [];
    const userIds = userThemes.map(u => u.id);
    const focused = themes.filter(t => bandAtLeast(t.supportLevel.id, DECK_THEME_CONFIG.clashMinBand)
      && t.id !== 'strategy.goodstuff');

    for (const u of userThemes) {
      if (u.id === 'strategy.goodstuff') {
        const very = themes.find(t => t.supportLevel.id === 'very_focused');
        if (very) {
          notes.push({
            kind: 'clash',
            themeIds: [u.id, very.id],
            text: `You set Goodstuff, but the list is very focused on ${very.label} (${very.supportCount} cards).`,
          });
        } else if (!focused.length) {
          notes.push({
            kind: 'jive',
            themeIds: [u.id],
            text: 'You set Goodstuff, and no single theme is running at focused density — that matches.',
          });
        }
        continue;
      }
      const row = byId[u.id];
      const count = row ? row.supportCount : 0;
      const band = supportBand(count);
      const role = u.role === 'primary' ? 'primary theme' : u.role === 'secondary' ? 'secondary theme' : 'plan theme';
      if (bandAtLeast(band.id, 'decent')) {
        notes.push({
          kind: 'jive',
          themeIds: [u.id],
          text: `Your ${role} ${u.label} has ${band.label.toLowerCase()} support (${count} cards).`,
        });
      } else {
        notes.push({
          kind: 'thin',
          themeIds: [u.id],
          text: `Your ${role} ${u.label} is thin in the list (${count} card${count === 1 ? '' : 's'} — ${band.label.toLowerCase()}).`,
        });
      }
    }

    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        const a = userIds[i];
        const b = userIds[j];
        const key = pairKey(a, b);
        if (JIVE_SET.has(key)) {
          notes.push({
            kind: 'jive',
            themeIds: [a, b],
            text: `${themeLabel(a)} and ${themeLabel(b)} usually cooperate.`,
          });
        } else if (CLASH_SET.has(key)) {
          notes.push({
            kind: 'clash',
            themeIds: [a, b],
            text: `${themeLabel(a)} and ${themeLabel(b)} pull in opposite directions — go-tall vs go-wide, or restriction vs volume.`,
          });
        }
      }
    }

    for (const t of focused) {
      if (userIds.includes(t.id)) continue;
      if (t.id.startsWith('tribal:') && userIds.includes('strategy.tribal')) continue;
      const clashWith = userIds.find(uid => CLASH_SET.has(pairKey(uid, t.id)) && !JIVE_SET.has(pairKey(uid, t.id)));
      if (clashWith) {
        notes.push({
          kind: 'clash',
          themeIds: [clashWith, t.id],
          text: `The list is ${t.supportLevel.label.toLowerCase()} on ${t.label} (${t.supportCount} cards), which clashes with your ${themeLabel(clashWith)} plan.`,
        });
      } else {
        notes.push({
          kind: 'also_running',
          themeIds: [t.id],
          text: `Also running: ${t.label} (${t.supportCount} cards, ${t.supportLevel.label.toLowerCase()}) — not in your set plan.`,
        });
      }
    }

    // Deduplicate similar notes (same kind + same theme set).
    const seen = new Set();
    return notes.filter(n => {
      const k = `${n.kind}:${(n.themeIds || []).slice().sort().join(',')}:${n.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function _esc(escapeHtml, s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function deckThemesHtml(analysis, escapeHtml) {
    const esc = s => _esc(escapeHtml, s);
    if (!analysis || !(analysis.themes || []).length) {
      return `<div class="deck-themes-empty">No named themes stood out yet. Add more on-theme cards, or set a plan to track a theme you intend.</div>`;
    }
    const cap = DECK_THEME_CONFIG.barCap;
    const fitHtml = (analysis.fit || []).map(n => {
      const cls = n.kind === 'clash' ? 'clash' : n.kind === 'thin' ? 'thin' : n.kind === 'also_running' ? 'also' : 'jive';
      return `<div class="deck-themes-fit deck-themes-fit--${cls}">${esc(n.text)}</div>`;
    }).join('');
    const userBit = (analysis.userThemes || []).length
      ? `<div class="deck-themes-plan">Your plan: ${(analysis.userThemes || []).map(u =>
        `<span class="deck-themes-plan-chip">${esc(u.label)}${u.role === 'primary' ? '' : ` <span class="deck-themes-plan-role">${esc(u.role)}</span>`}</span>`
      ).join('')}${analysis.planConfirmed ? '' : (analysis.planDeclared ? ' <span class="deck-themes-plan-note">declared, not confirmed</span>' : '')}</div>`
      : `<div class="deck-themes-plan deck-themes-plan--unset">No plan theme set yet — open Plan to say what you intend. The list below is what the cards are already doing.</div>`;

    const rows = analysis.themes.map(t => {
      const pct = Math.max(4, Math.min(100, Math.round((t.supportCount / cap) * 100)));
      const bandCls = t.supportLevel.id;
      const userMark = t.userSet ? '<span class="deck-themes-yours">your plan</span>' : '';
      const safeId = encodeURIComponent(t.id);
      const names = (t.cardNames || []).slice(0, DECK_THEME_CONFIG.maxShownCards);
      const extra = Math.max(0, (t.cardNames || []).length - names.length);
      const cards = names.map(nm => {
        const safe = String(nm).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<button type="button" class="deck-themes-card" onclick="openCardDetailByName('${safe}')">${esc(nm)}</button>`;
      }).join('');
      const more = extra ? `<span class="deck-themes-more">+${extra} more</span>` : '';
      return `<div class="deck-themes-row" data-theme-id="${esc(t.id)}">
        <button type="button" class="deck-themes-toggle" aria-expanded="false" onclick="toggleDeckThemeCards(this)" data-theme="${esc(safeId)}">
          <span class="deck-themes-name">${esc(t.label)} ${userMark}</span>
          <span class="deck-themes-count">${t.supportCount}</span>
          <span class="deck-themes-band deck-themes-band--${esc(bandCls)}">${esc(t.supportLevel.label)}</span>
          <span class="deck-themes-caret" aria-hidden="true">⌄</span>
        </button>
        <div class="deck-themes-bar" aria-hidden="true"><span class="deck-themes-bar-fill deck-themes-band--${esc(bandCls)}" style="width:${pct}%"></span></div>
        <div class="deck-themes-cards" hidden>${cards || '<span class="deck-themes-more">No supporting cards detected.</span>'}${more}</div>
      </div>`;
    }).join('');

    return `${userBit}${fitHtml ? `<div class="deck-themes-fits">${fitHtml}</div>` : ''}
      <div class="deck-themes-kicker">Themes running through your deck</div>
      <div class="deck-themes-list">${rows}</div>
      <div class="deck-themes-legend">Support: 10 is decent · 18 focused · 30 very focused. Click a theme to see its cards.</div>`;
  }

  function toggleDeckThemeCards(btn) {
    const row = btn && btn.closest && btn.closest('.deck-themes-row');
    if (!row) return;
    const body = row.querySelector('.deck-themes-cards');
    if (!body) return;
    const hidden = body.hasAttribute('hidden');
    body.toggleAttribute('hidden', !hidden);
    btn.setAttribute('aria-expanded', String(hidden));
    btn.classList.toggle('is-open', hidden);
  }

  function renderDeckThemesPanel(deck) {
    const panel = (typeof document !== 'undefined') ? document.getElementById('deckThemesPanel') : null;
    const body = (typeof document !== 'undefined') ? document.getElementById('deckThemesBody') : null;
    if (!panel || !body) return null;
    if (!deck || !((deck.cards || []).length)) {
      panel.style.display = 'none';
      body.innerHTML = '';
      return null;
    }
    const analysis = analyzeDeckThemes(deck);
    const escFn = (root && typeof root.escapeHtml === 'function')
      ? root.escapeHtml
      : (typeof globalThis !== 'undefined' && typeof globalThis.escapeHtml === 'function'
        ? globalThis.escapeHtml
        : null);
    panel.style.display = '';
    body.innerHTML = deckThemesHtml(analysis, escFn);
    return analysis;
  }

  return {
    DECK_THEME_CONFIG,
    THEME_CATALOG,
    supportBand,
    cardSupportsTheme,
    detectTribes,
    userThemesFromPlan,
    analyzeDeckThemes,
    buildThemeFit,
    deckThemesHtml,
    toggleDeckThemeCards,
    renderDeckThemesPanel,
    themeLabel,
    tribalThemeId,
  };
});
