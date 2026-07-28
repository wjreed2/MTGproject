#!/usr/bin/env node
// Diagnose WHY printings lack prices, by joining card_price_daily to mtgjson_printing.
'use strict';
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 2,
  });
}
const n = x => Number(x).toLocaleString();

async function main() {
  const db = pool();
  try {
    const [[{ d }]] = await db.query(`SELECT MAX(snapshot_date) d FROM card_price_daily`);
    const date = d.toISOString ? d.toISOString().slice(0, 10) : String(d);
    const J = `mtgjson_printing p LEFT JOIN card_price_daily c ON c.uuid=p.uuid AND c.snapshot_date='${date}'`;
    console.log(`\n=== WHY ARE PRICES MISSING? (snapshot ${date}) ===\n`);

    const [[u]] = await db.query(`
      SELECT COUNT(*) total,
        SUM(available=1) paper, SUM(available=0) online,
        SUM(c.uuid IS NOT NULL) priced,
        SUM(available=1 AND c.uuid IS NOT NULL) paper_priced,
        SUM(available=1 AND c.uuid IS NULL) paper_unpriced,
        SUM(available=0 AND c.uuid IS NOT NULL) online_priced
      FROM ${J}`);
    console.log('UNIVERSE (mtgjson_printing):');
    console.log(`  total printings ........ ${n(u.total)}`);
    console.log(`  paper-available ........ ${n(u.paper)}   online-only ........ ${n(u.online)}`);
    console.log(`  have a price today ..... ${n(u.priced)}`);
    console.log(`  PAPER priced ........... ${n(u.paper_priced)}`);
    console.log(`  PAPER but NO price ..... ${n(u.paper_unpriced)}   <-- the genuinely-missing paper cards`);
    console.log(`  online-only with price . ${n(u.online_priced)}\n`);

    console.log('PAPER-but-unpriced — top sets:');
    const [sets] = await db.query(`SELECT p.set_code, COUNT(*) k FROM ${J} WHERE p.available=1 AND c.uuid IS NULL GROUP BY p.set_code ORDER BY k DESC LIMIT 12`);
    sets.forEach(r => console.log(`  ${(r.set_code || '?').padEnd(8)} ${n(r.k)}`));

    console.log('\nPAPER-but-unpriced — by rarity:');
    const [rar] = await db.query(`SELECT p.rarity, COUNT(*) k FROM ${J} WHERE p.available=1 AND c.uuid IS NULL GROUP BY p.rarity ORDER BY k DESC`);
    rar.forEach(r => console.log(`  ${(r.rarity || '?').padEnd(12)} ${n(r.k)}`));

    console.log('\nPAPER-but-unpriced — sample names:');
    const [smp] = await db.query(`SELECT p.name, p.set_code, p.rarity, p.promo_types FROM ${J} WHERE p.available=1 AND c.uuid IS NULL ORDER BY RAND() LIMIT 15`);
    smp.forEach(r => console.log(`  ${(r.name || '').slice(0, 34).padEnd(35)} ${r.set_code}  ${r.rarity}  ${r.promo_types || ''}`));

    console.log('\nPRICED but MISSING TCGplayer — who carries them instead:');
    const [[mt]] = await db.query(`
      SELECT COUNT(*) total,
        SUM(ck_normal IS NOT NULL OR ck_foil IS NOT NULL) has_ck,
        SUM(cm_normal IS NOT NULL OR cm_foil IS NOT NULL) has_cm,
        SUM((ck_normal IS NULL AND ck_foil IS NULL) AND (cm_normal IS NOT NULL OR cm_foil IS NOT NULL)) only_cm
      FROM card_price_daily WHERE snapshot_date='${date}' AND tcg_normal IS NULL AND tcg_foil IS NULL AND tcg_etched IS NULL`);
    console.log(`  missing TCG: ${n(mt.total)}  | of those have CK: ${n(mt.has_ck)}  have Cardmarket(EU): ${n(mt.has_cm)}  | Cardmarket-only: ${n(mt.only_cm)}`);
    const [mtSets] = await db.query(`
      SELECT p.set_code, COUNT(*) k FROM card_price_daily c JOIN mtgjson_printing p ON p.uuid=c.uuid
      WHERE c.snapshot_date='${date}' AND c.tcg_normal IS NULL AND c.tcg_foil IS NULL AND c.tcg_etched IS NULL
      GROUP BY p.set_code ORDER BY k DESC LIMIT 8`);
    console.log('  top sets missing TCG: ' + mtSets.map(r => `${r.set_code}(${r.k})`).join(', '));

    console.log('');
  } finally { await db.end(); }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
