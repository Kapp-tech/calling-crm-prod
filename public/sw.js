// Bump this on any change to this file's caching logic — it's what makes
// the activate handler below actually purge the old cache. There's no build
// pipeline for this static file, so the version has to be tracked by hand.
const CACHE_NAME = 'counselling-crm-v2';

// Static Next.js chunks — safe to cache indefinitely (content-hashed filenames)
const STATIC_RE = /^\/_next\/static\//;
// Dynamic pages and API — always network first
const API_RE    = /^\/api\//;

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/',
        '/offline',
      ]).catch(() => {
        // Non-fatal: offline shell may not be accessible at install time
      }),
    ),
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // ── API routes: network-only (never serve stale data) ────────────────────
  if (API_RE.test(url.pathname)) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'You are offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    return;
  }

  // ── Next.js static chunks: cache-first (content-hashed, safe forever) ────
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(request, response.clone()),
            );
          }
          return response;
        });
      }),
    );
    return;
  }

  // ── Pages (navigations, fonts, icons): network-first ──────────────────────
  // Every deploy ships new Server Action IDs baked into the page. Serving a
  // *cached* page after a redeploy means the browser runs JS that calls
  // actions the (now-rebuilt) server no longer recognizes — it fails with
  // "Failed to find Server Action" and the page silently never renders.
  // Always prefer the network while online; cache is strictly the
  // last-resort offline fallback, not a performance shortcut.
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    }).catch(() =>
      caches.open(CACHE_NAME)
        .then((cache) => cache.match(request))
        .then((cached) => cached ?? caches.match('/offline')),
    ),
  );
});
