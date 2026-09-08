// ── Lazy feature chunks ───────────────────────────────────────────────────────
// The app bundle used to carry every feature (~2.5 MB source) into the boot
// parse. Rarely-used features now build into separate classic scripts
// (dist/chunk-<name>.js — see scripts/build-bundle.js CHUNKS) loaded on first
// use. Chunks MUST load as classic <script src> tags (never type="module" or
// eval): inline handlers in index.html read top-level let/const bindings (e.g.
// `_gf?.commandZone`), which only reach the global lexical environment from
// classic scripts.
//
// Stub mechanics: each entry point reachable from static markup gets a stub on
// window. The chunk declares the real implementation as a top-level `function`
// declaration, which overwrites the window property when the script executes;
// the stub then re-dispatches the original call. Loading is promise-cached —
// a chunk script must never be injected twice (its top-level const/let would
// throw "already been declared").

const _lazyChunkLoads = new Map();

function loadAppChunk(name) {
  if (_lazyChunkLoads.has(name)) return _lazyChunkLoads.get(name);
  const p = new Promise((resolve, reject) => {
    // Reuse the bundle's ?v= stamp so chunks get the same immutable caching
    // and cache-busting-on-deploy as the bundle itself.
    let stamp = '';
    try {
      const src = document.querySelector('script[src^="/dist/bundle.js"]')?.getAttribute('src') || '';
      const q = src.split('?')[1];
      if (q) stamp = '?' + q;
    } catch (_) {}
    const s = document.createElement('script');
    s.src = `/dist/chunk-${name}.js${stamp}`;
    s.onload = () => resolve();
    s.onerror = () => {
      _lazyChunkLoads.delete(name); // allow retry on the next attempt
      reject(new Error(`chunk ${name} failed to load`));
    };
    document.head.appendChild(s);
  });
  _lazyChunkLoads.set(name, p);
  return p;
}

function _lazyChunkStub(chunks, fnName) {
  const list = Array.isArray(chunks) ? chunks : [chunks];
  const stub = async function (...args) {
    try {
      await Promise.all(list.map(loadAppChunk));
    } catch (e) {
      console.error('[chunks]', e);
      if (typeof showNotif === 'function') {
        showNotif('Could not load this part of the app — check your connection and try again.', true);
      }
      return;
    }
    const real = window[fnName];
    if (typeof real === 'function' && real !== stub) return real.apply(this, args);
    console.error(`[chunks] ${fnName} still missing after loading: ${list.join(', ')}`);
  };
  window[fnName] = stub;
}

// Entry points reachable from static markup while their chunk is not loaded.
// Everything else in these features lives inside modals/overlays that can only
// be opened through one of these, so it is unreachable until the chunk arrives.
_lazyChunkStub('voice', 'openVoice');
_lazyChunkStub('voice', 'toggleAutoPin');           // settings dropdown
_lazyChunkStub('voice', 'clearVoiceCorrections');   // settings dropdown
_lazyChunkStub('import', 'openImport');
_lazyChunkStub('import', 'downloadCSV');
_lazyChunkStub('import', 'toggleDeckImportDropdown');
_lazyChunkStub('import', 'openTextImport');
_lazyChunkStub('import', 'openArchidektImport');
_lazyChunkStub('import', 'openMoxfieldImport');
_lazyChunkStub('import', 'openPreconImport');
// Scanner's set-code fuzzy correction calls voice's matchToSetCode/levenshtein
// (guarded) — load both so behavior matches the old single bundle.
_lazyChunkStub(['scanner', 'voice'], 'openScanner');
_lazyChunkStub('goldfish', 'openGoldfish');
_lazyChunkStub('goldfish', 'openGoldfishEngine');
