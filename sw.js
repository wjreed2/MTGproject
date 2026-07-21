// Card-image cache service worker.
//
// Scope is intentionally narrow: ONLY Scryfall image CDN responses (card art,
// mana/set symbol SVGs) are cached. The app shell (index.html, dist bundles,
// CSS) and every /api call are never intercepted, so deploys and account data
// always stay fresh — this worker cannot serve a stale app.
//
// Scryfall image URLs are immutable per printing, and their CDN only sends a
// 1-day max-age, so without this the browser re-downloads every card image a
// day later. Cache-first here makes deck/collection grids paint from disk on
// every visit.

const CACHE_NAME = 'mtg-img-cache-v1';
const IMG_HOSTS = ['cards.scryfall.io', 'svgs.scryfall.io'];
const MAX_ENTRIES = 4000; // ~4k images; trimmed oldest-first once exceeded
const TRIM_BATCH = 400;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('mtg-img-cache-') && n !== CACHE_NAME)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  let url;
  try {
    url = new URL(event.request.url);
  } catch (_) {
    return;
  }
  if (!IMG_HOSTS.includes(url.hostname)) return;
  event.respondWith(imgCacheFirst(event.request));
});

async function imgCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request.url);
  if (hit) return hit;

  // Prefer a CORS fetch: a non-opaque response can be cached without the huge
  // opaque-response quota padding browsers apply. Scryfall's CDN allows CORS;
  // fall back to the original (no-cors) request if that ever changes.
  let res = null;
  try {
    res = await fetch(request.url, { mode: 'cors' });
  } catch (_) {
    res = null;
  }
  if (!res || !(res.ok || res.type === 'opaque')) {
    res = await fetch(request); // let a real network error propagate to the <img>
  }
  if (res && (res.ok || res.type === 'opaque')) {
    cache
      .put(request.url, res.clone())
      .then(() => trimCache(cache))
      .catch(() => {}); // quota errors must never break the image response
  }
  return res;
}

let _trimming = false;
async function trimCache(cache) {
  if (_trimming) return;
  _trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_ENTRIES) return;
    // Cache keys return in insertion order — drop the oldest batch.
    await Promise.all(keys.slice(0, TRIM_BATCH).map(k => cache.delete(k)));
  } catch (_) {
    // best-effort
  } finally {
    _trimming = false;
  }
}
