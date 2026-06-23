#!/usr/bin/env node
// Verifies streamDataEntries against a normal JSON.parse of AllPricesToday.
'use strict';
const zlib = require('zlib');
const { fetchDataEntries } = require('./lib/mtgjson-stream');

(async () => {
  const URL = 'https://mtgjson.com/api/v5/AllPricesToday.json.gz';
  // Reference: normal parse (file is small enough)
  const res = await fetch(URL, { headers: { 'User-Agent': 'MTGproject test' } });
  const ref = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
  const refKeys = Object.keys(ref.data);
  const refSet = new Set(refKeys);

  // Streamed
  let n = 0, mismatches = 0, missing = 0, sampleOk = 0, sampleChecked = 0;
  for await (const [key, val] of fetchDataEntries(URL)) {
    n++;
    if (!refSet.has(key)) { missing++; continue; }
    if (sampleChecked < 2000) { // deep-compare a sample
      sampleChecked++;
      if (JSON.stringify(val) === JSON.stringify(ref.data[key])) sampleOk++;
      else mismatches++;
    }
  }
  console.log(`reference entries : ${refKeys.length.toLocaleString()}`);
  console.log(`streamed entries  : ${n.toLocaleString()}`);
  console.log(`keys not in ref   : ${missing}`);
  console.log(`sample deep-equal : ${sampleOk}/${sampleChecked} (mismatches ${mismatches})`);
  console.log(n === refKeys.length && missing === 0 && mismatches === 0 ? '✓ PASS' : '✗ FAIL');
})().catch(e => { console.error('test FAILED:', e); process.exit(1); });
