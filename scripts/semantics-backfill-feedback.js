#!/usr/bin/env node
'use strict';
/**
 * Class-level IR corrections from the 2026-09 suggestion-feedback review — no LLM
 * re-extraction: the faces layer (and, for rule 2, the oracle text ground truth)
 * already carries the deciding information; the capability roll-up dropped it.
 * Same contract as semantics-backfill-pump.js: writes BOTH stores the runtime reads
 * (ir_json + card_semantics_axes), bumps updated_at so `semantics:push` carries the
 * rows to prod, idempotent, dry-run first.
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
 *   loot as exactly this).
 *
 * Rule 3 — compensatory lifegain appetite (feedback #53, M.O.D.O.K. / Necrodominance):
 *   a lifegain.source `wants` on a card that itself PAYS life (ability cost.life,
 *   or a self lose_life engine) is an offset, not a build-around — demoted to
 *   `helps` w2, below the strong-feed bar.
 *
 * Usage:
 *   node scripts/semantics-backfill-feedback.js --dry-run   # report what would change
 *   node scripts/semantics-backfill-feedback.js             # apply
 */

const { createRequire } = require('module');
const projRequire = createRequire('/Users/Will/dev/MTGproject/package.json');
const mysql = projRequire('mysql2/promise');
projRequire('dotenv').config({ path: '/Users/Will/dev/MTGproject/.env', quiet: true });

const DRY = process.argv.includes('--dry-run');

// ── detectors (exported shape mirrored in engine2/validator.js lints) ─────────
const abilities = (ir) => (ir.faces || []).flatMap(f => f.abilities || []);

function opponentOnlyDeathScope(ir) {
  const deathAbilities = abilities(ir).filter(a =>
    (a.trigger && a.trigger.event === 'dies') || (a.replaces && a.replaces.event === 'dies'));
  if (!deathAbilities.length) return false;
  return deathAbilities.every(a => {
    const scope = a.trigger ? a.trigger.controller_scope : a.replaces?.scope?.controller;
    return scope === 'opp' || scope === 'opponents';
  });
}

function paysLifeItself(ir) {
  return abilities(ir).some(a => (a.cost?.life || 0) >= 1
    || ((a.effects || []).some(e => e.op === 'lose_life') && (a.effects || []).some(e => e.op === 'draw')));
}

const ADDITIONAL_COST_DISCARD = /additional cost to cast this spell.*discard/is;

// ── rules: each returns a change note (string) or null, mutating ir in place ──
const RULES = [
  {
    key: 'opp-death-scope',
    select: `SELECT DISTINCT s.oracle_id FROM card_semantics s
             JOIN card_semantics_axes a ON a.oracle_id = s.oracle_id
             WHERE a.kind = 'needs' AND a.axis = 'creatures_dying'`,
    apply: (ir, card) => {
      const i = (ir.needs || []).findIndex(n => n.axis === 'creatures_dying');
      if (i === -1 || !opponentOnlyDeathScope(ir)) return null;
      const old = ir.needs[i];
      ir.needs.splice(i, 1,
        { axis: 'removal.spot', param: null, criticality: 'wants', weight: 3 },
        { axis: 'removal.wipe', param: null, criticality: 'wants', weight: 2 });
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
      if (!ADDITIONAL_COST_DISCARD.test(card.oracle_text || '')) return null;
      const p = (ir.provides || []).find(x => x.axis === 'card_advantage.draw');
      if (!p) return null;
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
      if (!n || !paysLifeItself(ir)) return null;
      // A card PAID OFF by gaining life (Amalia's explore trigger, Licia's cost
      // reduction "for each 1 life you gained") wants lifegain as a build-around,
      // not an offset — even when it also pays life. Leave those alone.
      if (abilities(ir).some(a => a.trigger?.event === 'lifegain')
        || /life you gained/i.test(card.oracle_text || '')) return null;
      n.criticality = 'helps';
      n.weight = 2;
      return `lifegain.source wants w3+ → helps w2 (the card pays the life itself)`;
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
      await db.query('DELETE FROM card_semantics_axes WHERE oracle_id = ?', [oracle_id]);
      const axisRows = [];
      for (const [kind, list] of [['provides', ir.provides], ['needs', ir.needs], ['anti', ir.anti]]) {
        for (const a of Array.isArray(list) ? list : []) {
          if (!a || typeof a.axis !== 'string') continue;
          axisRows.push([oracle_id, kind, a.axis.slice(0, 60), a.param ? String(a.param).slice(0, 60) : null,
            Math.min(Math.max(parseInt(a.weight) || 1, 1), 5), a.rate ? String(a.rate).slice(0, 12) : null]);
        }
      }
      if (axisRows.length) {
        await db.query('INSERT IGNORE INTO card_semantics_axes (oracle_id, kind, axis, param, weight, rate) VALUES ?', [axisRows]);
      }
    }
  }
  console.log(`\n${DRY ? 'dry-run: ' : ''}${changed} row(s) ${DRY ? 'would change' : 'changed'}.`);
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
