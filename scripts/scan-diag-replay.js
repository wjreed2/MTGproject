#!/usr/bin/env node
/**
 * Replay the LIVE queries recorded in saved crops. Each Save-crop PNG carries a ScanDiag
 * tEXt chunk with the exact hashes and OCR text the phone sent, so this re-POSTs the real
 * request against a server and diffs the new verdict against what happened on the device.
 *
 *   node scripts/scan-diag-replay.js [baseURL] [dir]
 *
 * This is the fastest regression signal available: no re-OCR, no re-hashing, no guessing —
 * the identical query, judged by the current matcher.
 */
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // local self-signed HTTPS only
const BASE = process.argv[2] || "https://localhost:3101";
const DIR = process.argv[3] || path.join(__dirname, "..", "fixtures", "scan-photos");

function readScanDiag(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8;
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString("latin1", off + 4, off + 8);
      if (type === "tEXt") {
        const data = buf.subarray(off + 8, off + 8 + len);
        const nul = data.indexOf(0);
        if (nul > 0 && data.toString("latin1", 0, nul) === "ScanDiag") {
          return JSON.parse(Buffer.from(data.subarray(nul + 1)).toString("utf8"));
        }
      }
      off += 12 + len;
    }
  } catch (_) {}
  return null;
}

(async () => {
  const files = fs.readdirSync(DIR).filter(f => /\.png$/i.test(f)).sort();
  let withDiag = 0, changed = 0, nowMatched = 0, wasMatched = 0;
  for (const f of files) {
    const d = readScanDiag(path.join(DIR, f));
    if (!d || !d.phash) continue;
    withDiag++;
    if (d.matched) wasMatched++;
    const body = { phash: d.phash, artPhash: d.artPhash };
    if (d.ocrAll && d.ocrAll.length) body.titles = d.ocrAll;
    else if (d.ocr) body.title = d.ocr;
    let res;
    try {
      res = await (await fetch(BASE + "/api/scan/identify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })).json();
    } catch (e) {
      console.log(`${f}: replay failed — ${e.message}`);
      continue;
    }
    const best = res.best || (res.candidates || [])[0];
    const now = best ? `${best.name} [${best.set} #${best.collector_number}]` : "—";
    if (res.matched) nowMatched++;
    const differs = now !== (d.best || "—") || !!res.matched !== !!d.matched;
    if (differs) changed++;
    console.log(
      `${f.padEnd(30)} live:${(d.matched ? "MATCH" : "miss ")} ${(d.best || "—").slice(0, 34).padEnd(34)}`
      + ` | now:${(res.matched ? "MATCH" : "miss ")}${res.titleMatched ? "*" : " "} ${now.slice(0, 34)}`);
  }
  console.log(`\n${withDiag} diag-carrying captures — live matched ${wasMatched}, now matched ${nowMatched} (${changed} verdicts changed)`);
  console.log(`(* = decided by the title path)`);
})().catch(e => { console.error(e); process.exit(1); });
