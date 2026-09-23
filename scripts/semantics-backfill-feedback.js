#!/usr/bin/env node
'use strict';
/**
 * Class-level IR corrections from the 2026-09 suggestion-feedback review — no LLM
 * re-extraction: the faces layer (and, for rules 2/5, the oracle text ground truth)
 * already carries the deciding information; the capability roll-up dropped it.
 * Same contract as semantics-backfill-pump.js: writes BOTH stores the runtime reads
 * (ir_json + card_semantics_axes), bumps updated_at so `semantics:push` carries the
 * rows to prod, idempotent, dry-run first. Detectors are shared with the standing
 * validator lints (engine2/ir-lints.js) so the two can never drift apart.
 *
 * Rule 1 — opponent-scoped death appetite (feedback #53, Vren, the Relentless):
 *   a card whose needs include creatures_dying but whose every 'dies' trigger or
 *   replacement is scoped to OPPONENT creatures is fed by killing their creatures,
 *   not by sacrificing yours. The need becomes removal wants (spot w3 + wipe w2) so
 *   Disciple of Bolas stops "feeding Vren".
 *
 * Rule 2 — net-neutral draw (feedback #27/#47, Unexpected Windfall):
 *   an instant/sorcery with "as an additional cost to cast this spell, discard"
 *   that provides card_advantage.draw is filtering, not card advantage — the
 *   provide moves to card_advantage.loot at the same weight (the vocab defines
 *   loot as exactly this). If the IR already carries a loot provide, the draw
 *   provide folds into it (max weight) instead of duplicating it.
 *
 * Rule 3 — compensatory lifegain appetite (feedback #53, M.O.D.O.K. / Necrodominance):
 *   a lifegain.source `wants` on a card that itself PAYS life (ability cost.life,
 *   or a self lose_life engine) is an offset, not a build-around — demoted to
 *   `helps` w2, below the strong-feed bar.
 *
 * Rule 4 — model-authored synthesized provides (Gitrog / Wayta / Bebop & Rocksteady):
 *   provides on body.legendary / ability.activated are engine-synthesized from the
 *   type line and faces at scoring time; stored copies would double-count and are
 *   stripped. Needs on these axes are legitimate and untouched.
 *
 * Rule 5 — chosen-type payoffs vs type-changers (feedback #28):
 *   a param-null tribal.synergy provide is discounted by the deck's off-tribe share
 *   (a type-changer helps only creatures that aren't the tribe yet). Cards that
 *   CHOOSE a creature type as a payoff — Cavern of Souls, Shared Animosity,
 *   Descendants' Path — are at their best in a dense tribe: they get param
 *   "chosen type" (a wildcard the matchers serve to any tribe), escaping the
 *   discount. Actual type-changers keep param null.
 *
 * Usage:
 *   node scripts/semantics-backfill-feedback.js --dry-run   # report what would change
 *   node scripts/semantics-backfill-feedback.js             # apply
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const irLints = require('../engine2/ir-lints');
const { resyncAxes } = require('./lib/semantics-axes');

const DRY = process.argv.includes('--dry-run');

// Rule 5 text classes. A payoff CHOOSES/keys on a type; a changer MAKES things the
// type — the changer test looks for clauses that retype OTHER permanents (or the
// changeling reminder), so self-typing payoffs (Metallic Mimic, Roaming Throne:
// "is the chosen type in addition to its other types") stay in the payoff class.
const CHOSEN_PAYOFF = /choose a creature type|chosen type|shares? a creature type/i;
const TYPE_CHANGER = new RegExp([
  'is every creature type',            // changeling reminder, Runed Stalactite class
  'are every creature type',           // Maskwood Nexus
  'gains? all creature types',
  'creatures? you control (is|are)', // "are the chosen type" — Arcane Adaptation, Conspiracy, Xenograft
  'creatures? you own (is|are)',       // Rukarumel
  'becomes? that type',                // Standardize
].join('|'), 'i');

// ── rules: each returns a change note (string) or null, mutating ir in place ──
const RULES = [
  {
    key: 'opp-death-scope',
    select: `SELECT DISTINCT s.oracle_id FROM card_semantics s
             JOIN card_semantics_axes a ON a.oracle_id = s.oracle_id
             WHERE a.kind = 'needs' AND a.axis = 'creatures_dying'`,
    apply: (ir, card) => {
      const i = (ir.needs || []).findIndex(n => n.axis === 'creatures_dying');
      if (i === -1 || !irLints.opponentOnlyDeathScope(ir)) return null;
      const old = ir.needs[i];
      ir.needs.splice(i, 1);
      const additions = [
        { axis: 'removal.spot', param: null, criticality: 'wants', weight: 3 },
        { axis: 'removal.wipe', param: null, criticality: 'wants', weight: 2 },
      ].filter(add => !ir.needs.some(n => n.axis === add.axis));
      ir.needs.push(...additions);
      return `creatures_dying(${old.param || '*'}) → removal.spot w3 + removal.wipe w2 (all death scopes are opponent-only)`;
    },
  },
  {
    key: 'net-neutral-draw',
    select: `SELECT DISTINCT s.oracle_id FROM card_semantics s
             JOIN card_semantics_axes a ON a.oracle_id = s.oracle_id
             JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
             WHERE a.kind = 'provides' AND a.axis = 'card_advantage.draw'
               AND c.type_line REGEXP 'Instant|Sorcery'
               AND c.oracle_text LIKE '%additional cost to cast this spell%discard%'`,
    apply: (ir, card) => {
      if (!irLints.isAdditionalCostDiscard(card.oracle_text || '')) return null;
      const i = (ir.provides || []).findIndex(x => x.axis === 'card_advantage.draw');
      if (i === -1) return null;
      const p = ir.provides[i];
      const existing = ir.provides.find(x => x.axis === 'card_advantage.loot'
        && (x.param ?? null) === (p.param ?? null));
      if (existing) {
        // already loots: fold the draw provide in rather than duplicating the axis
        existing.weight = Math.max(existing.weight || 1, p.weight || 1);
        ir.provides.splice(i, 1);
        return `card_advantage.draw w${p.weight} folded into existing card_advantage.loot (additional-cost discard)`;
      }
      p.axis = 'card_advantage.loot';
      return `card_advantage.draw w${p.weight} → card_advantage.loot (additional-cost discard makes it filtering)`;
    },
  },
  {
    key: 'compensatory-lifegain',
    select: `SELECT DISTINCT s.oracle_id FROM card_semantics s
             JOIN card_semantics_axes a ON a.oracle_id = s.oracle_id
             WHERE a.kind = 'needs' AND a.axis = 'lifegain.source' AND a.weight >= 3`,
    apply: (ir, card) => {
      const n = (ir.needs || []).find(x => x.axis === 'lifegain.source'
        && x.criticality === 'wants' && (x.weight || 0) >= 3);
      if (!n || !irLints.paysLifeItself(ir)) return null;
      // A card PAID OFF by gaining life (Amalia's explore trigger, Licia's cost
      // reduction "for each 1 life you gained") wants lifegain as a build-around,
      // not an offset — even when it also pays life. Leave those alone.
      if (irLints.paidOffByLifegain(ir, card.oracle_text)) return null;
      n.criticality = 'helps';
      n.weight = 2;
      return `lifegain.source wants w3+ → helps w2 (the card pays the life itself)`;
    },
  },
  {
    key: 'synth-axis-provides',
    select: `SELECT DISTINCT s.oracle_id FROM card_semantics s
             JOIN card_semantics_axes a ON a.oracle_id = s.oracle_id
             WHERE a.kind = 'provides' AND a.axis IN ('body.legendary', 'ability.activated')`,
    apply: (ir, card) => {
      const before = (ir.provides || []).length;
      ir.provides = (ir.provides || []).filter(p =>
        p.axis !== 'body.legendary' && p.axis !== 'ability.activated');
      if (ir.provides.length === before) return null;
      return `${before - ir.provides.length} synthesized-axis provide(s) stripped (engine derives them from type line/faces)`;
    },
  },
  {
    // The axes table's UNIQUE key admits multiple NULL params, so an extraction that
    // emitted the same provide twice (Tormenting Voice: card_advantage.loot w2 ×2)
    // stands in both stores and scores twice. Collapse EXACT duplicates only —
    // same axis repeated with a different rate/weight can be a legitimate
    // two-faces encoding and is left alone.
    key: 'dup-capability-entries',
    select: `SELECT DISTINCT oracle_id FROM card_semantics_axes
             WHERE param IS NULL
             GROUP BY oracle_id, kind, axis HAVING COUNT(*) > 1`,
    apply: (ir, card) => {
      let dropped = 0;
      for (const key of ['provides', 'needs', 'anti']) {
        const list = ir[key];
        if (!Array.isArray(list)) continue;
        const seen = new Set();
        ir[key] = list.filter(a => {
          const sig = JSON.stringify([a?.axis, a?.param ?? null, a?.weight ?? null, a?.rate ?? null, a?.criticality ?? null, a?.scope ?? null]);
          if (seen.has(sig)) { dropped++; return false; }
          seen.add(sig);
          return true;
        });
      }
      if (!dropped) return null;
      return `${dropped} exact-duplicate capability entr${dropped === 1 ? 'y' : 'ies'} collapsed`;
    },
  },
  {
    key: 'chosen-type-payoffs',
    select: `SELECT DISTINCT s.oracle_id FROM card_semantics s
             JOIN card_semantics_axes a ON a.oracle_id = s.oracle_id
             WHERE a.kind = 'provides' AND a.axis = 'tribal.synergy' AND a.param IS NULL`,
    apply: (ir, card) => {
      const text = String(card.oracle_text || '');
      if (!CHOSEN_PAYOFF.test(text) || TYPE_CHANGER.test(text)) return null;
      const p = (ir.provides || []).find(x => x.axis === 'tribal.synergy' && x.param == null);
      if (!p) return null;
      p.param = 'chosen type';
      return `tribal.synergy param null → "chosen type" (choose-a-type payoff, not a type-changer)`;
    },
  },
];

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', charset: 'utf8mb4',
  });
  const now = Date.now();
  let changed = 0;
  for (const rule of RULES) {
    const [ids] = await db.query(rule.select);
    console.log(`\n── ${rule.key}: ${ids.length} candidate rows`);
    for (const { oracle_id } of ids) {
      const [[row]] = await db.query(
        `SELECT s.ir_json, s.status, c.name, c.oracle_text FROM card_semantics s
         JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id WHERE s.oracle_id = ?`, [oracle_id]);
      if (!row) continue;
      if (row.status === 'manual') continue; // hand-tuned rows outrank class rules
      const ir = JSON.parse(row.ir_json);
      const note = rule.apply(ir, row);
      if (!note) continue;
      changed++;
      console.log(`  ${DRY ? 'would fix' : '✓ fixed'}: ${row.name} — ${note}`);
      if (DRY) continue;
      await db.query(`UPDATE card_semantics SET ir_json = ?, updated_at = ? WHERE oracle_id = ?`,
        [JSON.stringify(ir), now, oracle_id]);
      await resyncAxes(db, oracle_id, ir);
    }
  }
  console.log(`\n${DRY ? 'dry-run: ' : ''}${changed} row(s) ${DRY ? 'would change' : 'changed'}.`);
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
