'use strict';
/**
 * Streaming reader for MTGJSON's giant files, which are shaped:
 *   { "meta": {...}, "data": { "<key>": <objectValue>, ... } }
 * AllIdentifiers (~588 MB) and AllPrices (~1.1 GB) exceed Node's max string
 * length, so we cannot gunzip→toString→JSON.parse. This yields one
 * [key, parsedValue] at a time, keeping memory bounded (one entry's worth).
 *
 * Dependency-free; correctness is verified by scripts/test-mtgjson-stream.js
 * against AllPricesToday (which also fits a normal JSON.parse).
 */
const zlib = require('zlib');
const { Readable } = require('stream');

/** Yields [key, value] for each top-level entry of the `data` object. `src` is an
 *  async iterable of UTF-8 strings. */
async function* streamDataEntries(src) {
  let phase = 0;          // 0 seek-data, 1 between-entries, 2 key, 3 colon, 4 value
  let pre = '';           // accumulator while seeking "data":{
  let key = '', val = '';
  let depth = 0, inStr = false, esc = false, valStarted = false, valType = '';

  for await (const chunk of src) {
    let s = chunk, i = 0;

    if (phase === 0) {
      pre += s;
      const di = pre.indexOf('"data"');
      if (di === -1) { pre = pre.slice(-6); continue; }
      const bi = pre.indexOf('{', di);
      if (bi === -1) { pre = pre.slice(di); continue; }
      s = pre.slice(bi + 1); pre = ''; phase = 1; i = 0;
    }

    while (i < s.length) {
      if (phase === 1) {                    // between entries
        const c = s[i];
        if (c === '"') { phase = 2; key = ''; esc = false; i++; }
        else if (c === '}') { return; }     // end of data object
        else i++;                           // ws / commas
      } else if (phase === 2) {             // key string
        const c = s[i];
        if (esc) { key += c; esc = false; i++; }
        else if (c === '\\') { esc = true; i++; }
        else if (c === '"') { phase = 3; i++; }
        else { key += c; i++; }
      } else if (phase === 3) {             // expect ':'
        const c = s[i];
        if (c === ':') { phase = 4; val = ''; valStarted = false; depth = 0; inStr = false; esc = false; valType = ''; i++; }
        else i++;
      } else {                              // phase 4: value
        if (!valStarted) {
          const c = s[i];
          if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { i++; continue; }
          valStarted = true;
          if (c === '{' || c === '[') { valType = 'obj'; depth = 1; val = c; i++; }
          else if (c === '"') { valType = 'str'; inStr = true; val = c; i++; }
          else { valType = 'lit'; val = c; i++; }
        } else if (valType === 'obj') {
          if (inStr) {
            let j = i;
            while (j < s.length) { const ch = s[j]; if (esc) { esc = false; j++; } else if (ch === '\\') { esc = true; j++; } else if (ch === '"') { inStr = false; j++; break; } else j++; }
            val += s.slice(i, j); i = j;
          } else {
            let j = i;
            while (j < s.length) { const ch = s[j]; if (ch === '"' || ch === '{' || ch === '}' || ch === '[' || ch === ']') break; j++; }
            val += s.slice(i, j);
            if (j >= s.length) { i = j; continue; }
            const ch = s[j]; val += ch; i = j + 1;
            if (ch === '"') inStr = true;
            else if (ch === '{' || ch === '[') depth++;
            else { depth--; if (depth === 0) { yield [key, JSON.parse(val)]; phase = 1; } }
          }
        } else if (valType === 'str') {
          const c = s[i]; val += c;
          if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') { yield [key, JSON.parse(val)]; phase = 1; }
          i++;
        } else {                            // literal (number/true/false/null)
          const c = s[i];
          if (c === ',' || c === '}' || c === ' ' || c === '\n' || c === '\r' || c === '\t') { yield [key, JSON.parse(val)]; phase = 1; }
          else { val += c; i++; }
        }
      }
    }
  }
}

/** Fetch a (.gz) MTGJSON url and stream its data entries. */
async function* fetchDataEntries(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MTGproject mtgjson-stream' } });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  let stream = Readable.fromWeb(res.body);
  if (url.endsWith('.gz')) stream = stream.pipe(zlib.createGunzip());
  stream.setEncoding('utf8');
  yield* streamDataEntries(stream);
}

module.exports = { streamDataEntries, fetchDataEntries };
