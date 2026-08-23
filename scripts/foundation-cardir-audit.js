#!/usr/bin/env node
'use strict';
/**
 * CardIR + Foundation evidence audit.
 *
 * Kind B (model/evidence): what CardIR contains vs what Foundation actually uses.
 * Does not regenerate CardIR, edit engine2/, or tune coefficients.
 *
 *   node scripts/foundation-cardir-audit.js
 *   node scripts/foundation-cardir-audit.js --user-dir data/foundation-lab/user-decks --write
 */
const fs = require('fs');
const path = require('path');

const { loadFoundationLab } = require('../js/foundation-lab/load.js');
const { loadUserAccountFixtures, userDecksDir, summarizeFixtures } = require('../js/foundation-lab/account-source.js');
const { foundationCardIRInventory } = require('../js/foundation-lab/cardir-inventory.js');
const vocab = require('../engine2/vocab.js');
const irSchema = require('../engine2/ir-schema.js');

loadFoundationLab();

function parseArgs(argv) {
  const args = { write: false, userDir: null, out: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--write') args.write = true;
    else if (a === '--user-dir') args.userDir = rest[++i];
    else if (a === '--out') args.out = rest[++i];
  }
  return args;
}

function topN(freq, n) {
  return Object.entries(freq || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function runUserCoverage(dir) {
  const loaded = loadUserAccountFixtures(dir);
  if (!loaded.fixtures.length) return null;
  const { evaluateFoundationLab, FOUNDATION_CONFIG } = globalThis;
  const evidence = { role_tag: 0, oracle_heuristic: 0, unknown: 0 };
  let contribWithIr = 0;
  let contribIrWouldSupport = 0;
  let contribs = 0;
  const capStatus = {};
  for (const fixture of loaded.fixtures) {
    const result = evaluateFoundationLab(fixture, { source: 'account-audit' }, FOUNDATION_CONFIG);
    for (const id of Object.keys(result.capabilityCoverage || {})) {
      capStatus[id] = capStatus[id] || { weak: 0, adequate: 0, strong: 0 };
      const st = result.capabilityCoverage[id].status || 'weak';
      capStatus[id][st] = (capStatus[id][st] || 0) + 1;
    }
    for (const row of result.contributions || []) {
      contribs += 1;
      evidence[row.evidenceSource] = (evidence[row.evidenceSource] || 0) + 1;
      if (row.cardIRAvailable) contribWithIr += 1;
      if (row.cardIRWouldSupport) contribIrWouldSupport += 1;
    }
  }
  const coverage = loaded.coverage || summarizeFixtures(loaded.fixtures, loaded.email);
  return {
    email: loaded.email,
    pulledAt: loaded.pulledAt,
    deckCount: loaded.fixtures.length,
    coverage,
    evidence,
    contribs,
    contribWithIr,
    contribIrWouldSupport,
    capStatus,
    deckNamesOmitted: true,
  };
}

function formatMarkdown(user) {
  const inv = foundationCardIRInventory();
  const axes = Object.keys(vocab.AXES || {});
  const lines = [];
  lines.push('# Foundation CardIR evidence audit');
  lines.push('');
  lines.push('**Status:** Inventory only. Do not treat missing CardIR as a scoring bug to patch in this pass.');
  lines.push('');
  lines.push('**Kind B** (model / evidence). Kind A = golden/synthetics structural locks. Kind C = human recommendation ratings.');
  lines.push('');
  lines.push('This report does **not** include private decklists. Account coverage is aggregate only.');
  lines.push('');
  lines.push('## What CardIR actually stores');
  lines.push('');
  lines.push(`- Table: \`${inv.storedWhere}\``);
  lines.push(`- Schema: \`${inv.schemaModule}\` (IR_VERSION ${irSchema.IR_VERSION || irSchema.irVersion || 'see module'})`);
  lines.push(`- Vocab: \`${inv.vocabModule}\` (VOCAB_VERSION ${vocab.VOCAB_VERSION})`);
  lines.push(`- Top-level fields: ${inv.topLevelFields.map(f => '`' + f + '`').join(', ')}`);
  lines.push(`- \`provides\` / \`needs\` entry fields: ${inv.providesNeedsEntryFields.map(f => '`' + f + '`').join(', ')}`);
  lines.push(`- Distinct axis tokens in vocab: **${axes.length}**`);
  lines.push('');
  lines.push('Axes are dotted tokens (`mana.rock`, `card_advantage.draw`, `gy.recursion`, `removal.spot`, `control.counter`, `protection.single`, `wincon.alt`, …). Full list: `engine2/vocab.js` `AXES`.');
  lines.push('');
  lines.push('## What Foundation actually uses');
  lines.push('');
  lines.push(`- Mechanism detection: **${inv.productionMechanismDetection}**`);
  lines.push(`- \`cardMechanisms\`: ${inv.productionCardIRUses.cardMechanisms}`);
  lines.push(`- \`applySynergy\`: ${inv.productionCardIRUses.applySynergy}`);
  lines.push(`- Confidence: ${inv.productionCardIRUses.confidence}`);
  lines.push(`- Wizard plan roles (not Hybrid evaluator): ${inv.productionCardIRUses.wizardPlanRoles}`);
  lines.push('');
  lines.push('Lab `--config` / a passed config object is cloned onto the Lab run only. Production Hybrid calls `evaluateFoundation` without a config override and reads frozen `FOUNDATION_CONFIG`.');
  lines.push('');
  lines.push('## Per-capability detectability');
  lines.push('');
  lines.push('| Capability | Role tags | Oracle heuristics | CardIR if it were used | Currently unreliable |');
  lines.push('|---|---|---|---|---|');
  for (const [id, row] of Object.entries(inv.capabilities)) {
    lines.push(`| ${id} | ${(row.fromRoleTags || []).join(', ') || '—'} | ${(row.fromOracleHeuristics || []).join('; ') || '—'} | ${(row.fromCardIRIfUsed || []).join(', ')} | ${row.currentlyUnreliable} |`);
  }
  lines.push('');
  lines.push('## Account decks (not the 23 synthetics)');
  lines.push('');
  if (!user) {
    lines.push('Live `manfordf@gmail.com` decks were **not** available in this environment (no MySQL / no `SEMANTICS_PUSH_URL` + `SEMANTICS_INGEST_SECRET`).');
    lines.push('');
    lines.push('On the hosted app (admin): open Foundation Lab → source **Account decks**.');
    lines.push('From a machine with secrets:');
    lines.push('');
    lines.push('```bash');
    lines.push('npm run foundation:pull-user-decks');
    lines.push('npm run test:foundation:user');
    lines.push('node scripts/foundation-cardir-audit.js --write');
    lines.push('```');
    lines.push('');
    lines.push('Dump path `data/foundation-lab/user-decks/` is gitignored.');
    lines.push('');
  } else {
    const cov = user.coverage || {};
    lines.push(`- Account: \`${user.email}\``);
    lines.push(`- Pulled at: ${user.pulledAt || 'unknown'}`);
    lines.push(`- Decks: **${user.deckCount}** (names omitted)`);
    lines.push(`- Unique cards: ${cov.uniqueCards} · copies: ${cov.cardCopies}`);
    lines.push(`- Unique cards with CardIR provides/needs/roles: **${cov.uniqueWithIr}** (${Math.round((cov.irCoverage || 0) * 100)}%)`);
    lines.push(`- Contribution rows: ${user.contribs}`);
    lines.push(`- Evidence: role_tag ${user.evidence.role_tag || 0}, oracle_heuristic ${user.evidence.oracle_heuristic || 0}, unknown ${user.evidence.unknown || 0}`);
    lines.push(`- Contributions where CardIR was present (unused for detection): ${user.contribWithIr}`);
    lines.push(`- Contributions where stored IR *would* support that mechanism if detection used axes: ${user.contribIrWouldSupport}`);
    lines.push('');
    lines.push('Capability status counts across account decks:');
    lines.push('');
    lines.push('| Capability | strong | adequate | weak |');
    lines.push('|---|---:|---:|---:|');
    for (const [id, st] of Object.entries(user.capStatus || {})) {
      lines.push(`| ${id} | ${st.strong || 0} | ${st.adequate || 0} | ${st.weak || 0} |`);
    }
    lines.push('');
    const top = topN(cov.provideAxisFrequencies, 20);
    if (top.length) {
      lines.push('Top provide-axes on unique account cards that have IR (frequency = unique cards, not copies):');
      lines.push('');
      for (const [axis, n] of top) lines.push(`- \`${axis}\`: ${n}`);
      lines.push('');
    }
  }
  lines.push('');
  lines.push('## Stop');
  lines.push('');
  for (const d of inv.doNot) lines.push(`- ${d}`);
  lines.push('- Catalog-wide axis frequencies require the production `card_semantics` table; this VM cannot count them without DB access.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const dir = args.userDir || userDecksDir();
  let user = null;
  try { user = runUserCoverage(dir); }
  catch (err) {
    console.error('Account-deck coverage skipped:', err.message);
  }
  const md = formatMarkdown(user);
  const out = args.out || path.join(__dirname, '..', 'docs', '19-foundation-cardir-audit.md');
  if (args.write) {
    fs.writeFileSync(out, md + '\n', 'utf8');
    console.log('Wrote', path.relative(process.cwd(), out));
  }
  console.log(md);
  return 0;
}

process.exit(main());
