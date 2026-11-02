'use strict';
// power_tier: a card's strength in Commander on its own merits, per bracket.
//
// One rubric, two readers: the extraction prompt (engine2/prompt.js) asks for it on every
// new card, and scripts/semantics-backfill-power-tier.js tiers the existing corpus with
// the same words and the same anchors, so the two can never drift apart.
//
// Shape: { b2, b3, b4 } — 1–10 at each table. Brackets 2–4 are the ones a decklist can
// tell apart (docs/bracket-estimation-plan.md: 1 is intent, 5 is metagame), so b2 serves
// brackets 1–2 and b4 serves 4–5. The same card moves between them: fast mana and free
// interaction climb toward b4; slow value engines and splashy finishers fall.
//
// Why it exists: power_level_hint (1–5) can't tell Demonic Tutor from The One Ring —
// 1,385 of 20.8k cards sit at hint 4–5, and blind judges split exactly those into "great
// add" and "fine" (eval cycle 16, engine2/eval/README.md). engine2/quality.js cardPower
// reads tierFor(ir, bracket) and falls back to the hint for untiered cards.

const BRACKETS = ['b2', 'b3', 'b4'];

// Anchors: widely agreed reference points across jobs and brackets, so a batch of ramp and
// a batch of removal land on the same scale. Exported so the backfill can check its drift.
const ANCHORS = [
  { name: 'Sol Ring', b2: 10, b3: 10, b4: 10 },
  { name: 'Demonic Tutor', b2: 9, b3: 10, b4: 10 },
  { name: 'Rhystic Study', b2: 9, b3: 10, b4: 9 },
  { name: 'Swords to Plowshares', b2: 9, b3: 9, b4: 9 },
  { name: 'Cyclonic Rift', b2: 9, b3: 9, b4: 8 },
  { name: 'Smothering Tithe', b2: 9, b3: 9, b4: 8 },
  { name: 'Mana Vault', b2: 6, b3: 8, b4: 10 },
  { name: 'Fierce Guardianship', b2: 6, b3: 8, b4: 10 },
  { name: 'Doubling Season', b2: 8, b3: 8, b4: 6 },
  { name: 'Craterhoof Behemoth', b2: 8, b3: 8, b4: 7 },
  { name: 'Reanimate', b2: 7, b3: 8, b4: 9 },
  { name: 'Counterspell', b2: 7, b3: 7, b4: 7 },
  { name: 'Beast Within', b2: 7, b3: 7, b4: 6 },
  { name: 'Arcane Signet', b2: 7, b3: 7, b4: 6 },
  { name: 'Cultivate', b2: 7, b3: 6, b4: 3 },
  { name: 'Mind Stone', b2: 6, b3: 6, b4: 5 },
  { name: 'Wrath of God', b2: 7, b3: 6, b4: 4 },
  { name: 'Rampant Growth', b2: 5, b3: 5, b4: 4 },
  { name: 'Lightning Bolt', b2: 5, b3: 5, b4: 4 },
  { name: 'Murder', b2: 5, b3: 5, b4: 3 },
  { name: 'Glorious Anthem', b2: 5, b3: 4, b4: 2 },
  { name: 'Divination', b2: 4, b3: 4, b4: 2 },
  { name: 'Delver of Secrets', b2: 3, b3: 3, b4: 2 },
  { name: 'Cancel', b2: 3, b3: 3, b4: 1 },
  { name: 'Serra Angel', b2: 3, b3: 2, b4: 1 },
  { name: 'Grizzly Bears', b2: 1, b3: 1, b4: 1 },
];

function anchorLine() {
  return ANCHORS.map(a => `${a.name} ${a.b2}/${a.b3}/${a.b4}`).join(' · ');
}

const RUBRIC = `power_tier { b2, b3, b4 }: how strong the card is in Commander on its own merits, 1–10, at three tables — b2 casual/precon-level (slow games, few tutors, no fast mana arms race), b3 focused upgraded decks (four players, 40 life, a few Game Changers, no early combos), b4 optimized and competitive (fast mana, free interaction, compact combos, games often decided by turn 5). Judge what the card does for its mana compared with every other card that does the same job AT THAT TABLE. NOT popularity, price, or fit with any particular deck; a narrow build-around is tiered by how strong it is in the deck it belongs in. The same card moves between tables: fast mana, free spells and cheap tutors climb toward b4; slow value engines, seven-drops, sorcery-speed ramp and big splashy finishers fall. Conditions count against it everywhere: mana that needs a land card in a graveyard, metalcraft, "if you control a Wizard", a one-shot effect where peers repeat. Use the whole scale — most cards are 2–5, only format-defining staples are 9–10. Anchors (b2/b3/b4): ${anchorLine()}.`;

// The tier for a deck's bracket. A legacy single-number tier (pilot rows) is the b3 read.
function tierFor(ir, bracket) {
  const t = ir?.power_tier;
  if (t == null) return null;
  if (typeof t === 'number') return t;
  const b = Number(bracket) || 3;
  const key = b <= 2 ? 'b2' : b >= 4 ? 'b4' : 'b3';
  return Number(t[key]) || Number(t.b3) || null;
}

module.exports = { RUBRIC, ANCHORS, BRACKETS, tierFor };
