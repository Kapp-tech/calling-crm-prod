const CACHE_NAME = 'counselling-crm-v1';

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

  // ── All other requests (pages, fonts, icons): stale-while-revalidate ─────
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached ?? caches.match('/offline'));

      return cached ?? networkFetch;
    }),
  );
});
