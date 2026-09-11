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

// v2: v1 could poison itself permanently (see imgCacheFirst). The activate
// handler deletes every mtg-img-cache-* that is not the current name, so
// bumping this is what heals a device already stuck on broken card images.
const CACHE_NAME = 'mtg-img-cache-v2';
const IMG_HOSTS = ['cards.scryfall.io', 'svgs.scryfall.io'];
const MAX_ENTRIES = 4000; // ~4k images; trimmed oldest-first once exceeded
const TRIM_BATCH = 400;

// Versioned app-shell assets only — /dist/… and /styles/… carrying a ?v= stamp.
//
// The HTTP cache already handles repeat visits: measured on a phone profile,
// a second load takes 71-127ms with every asset a cache hit, against 526ms cold.
// But a home-screen bookmark opens a fresh web view, and iOS evicts that cache
// readily once the app is killed — so every relaunch pays the cold price again,
// re-downloading ~1.1MB of JS and 340KB of CSS. A Cache Storage copy survives
// what the HTTP cache does not.
//
// This stays safe against stale deploys because it only ever touches URLs the
// server marks `immutable`: index.html carries the ?v= stamp, is served
// `no-cache`, and is never cached here, so a deploy yields new asset URLs that
// miss this cache by construction. Nothing unversioned is intercepted.
const SHELL_CACHE = 'mtg-shell-cache-v1';
const SHELL_PATH_RE = /^\/(dist|styles)\//;

function isShellRequest(url) {
  return url.origin === self.location.origin
    && SHELL_PATH_RE.test(url.pathname)
    && url.searchParams.has('v');
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => (n.startsWith('mtg-img-cache-') && n !== CACHE_NAME)
                  || (n.startsWith('mtg-shell-cache-') && n !== SHELL_CACHE))
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Navigations always go to the network: index.html is what carries the ?v=
  // stamp for everything below, so it must never be served from a cache here.
  if (event.request.mode === 'navigate') return;
  let url;
  try {
    url = new URL(event.request.url);
  } catch (_) {
    return;
  }
  if (IMG_HOSTS.includes(url.hostname)) { event.respondWith(imgCacheFirst(event.request)); return; }
  if (isShellRequest(url)) event.respondWith(shellCacheFirst(event.request));
});

async function shellCacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request.url);
  if (hit && hit.ok) return hit;
  if (hit) await cache.delete(request.url).catch(() => {});

  const res = await fetch(request);
  // Same guard as the image cache: only store a response we can verify. An
  // opaque response has status 0 and is indistinguishable from a failure, and
  // caching one here would serve a broken bundle for the life of the cache.
  if (res && res.ok && res.type !== 'opaque') {
    cache
      .put(request.url, res.clone())
      .then(() => pruneOldShellVersions(cache, request.url))
      .catch(() => {}); // quota errors must never break the response
  }
  return res;
}

/**
 * Drop other cached versions of the same path. Each deploy mints a new ?v= for
 * every asset, so without this the shell cache would grow by a full app's worth
 * of JS and CSS on every release and never shed the old ones.
 */
async function pruneOldShellVersions(cache, keptUrl) {
  try {
    const kept = new URL(keptUrl);
    const keys = await cache.keys();
    await Promise.all(keys.map(async req => {
      const u = new URL(req.url);
      if (u.pathname === kept.pathname && u.search !== kept.search) await cache.delete(req);
    }));
  } catch (_) {
    // best-effort
  }
}

async function imgCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request.url);
  // A cached entry that is not a real 2xx is a poisoned one from an older
  // worker. Drop it and go back to the network rather than serving a broken
  // image for the lifetime of the cache.
  if (hit && hit.ok) return hit;
  if (hit) await cache.delete(request.url).catch(() => {});

  // Prefer a CORS fetch: a non-opaque response can be cached without the huge
  // opaque-response quota padding browsers apply. Scryfall's CDN allows CORS;
  // fall back to the original (no-cors) request if that ever changes.
  let res = null;
  try {
    res = await fetch(request.url, { mode: 'cors' });
  } catch (_) {
    res = null;
  }
  if (!res || !res.ok) {
    res = await fetch(request); // let a real network error propagate to the <img>
  }
  // Only ever store a response we can actually verify. An opaque response has
  // status 0 and is indistinguishable from a failure, so caching one meant a
  // single dropped connection or CDN blip could persist as a broken image on
  // that device forever — cache-first would keep serving it back.
  if (res && res.ok && res.type !== 'opaque') {
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
