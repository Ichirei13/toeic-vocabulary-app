// The legacy worker deletes every cache except toeic-drill-v1 on activation.
// Reuse that cache, but keep ALL trial entries (including data) under /next/__offline__/.
// Never overwrite the legacy worker's URLs, delete caches, or claim its scope.
const CACHE = 'toeic-drill-v1';
const ASSETS = ['./', './index.html', './styles.css', './app.mjs', './core.mjs', '../data/words.js', '../data/grammar.js'];
function cacheKey(input) {
  const url = new URL(typeof input === 'string' ? input : input.url, self.registration.scope);
  return new URL(`__offline__/${encodeURIComponent(url.pathname)}`, self.registration.scope).href;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async asset => {
      const response = await fetch(new URL(asset, self.registration.scope));
      if (!response.ok) throw new Error(`Unable to cache ${asset}`);
      await cache.put(cacheKey(asset), response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        event.waitUntil(cache.put(cacheKey(event.request), response.clone()));
      }
      return response;
    } catch {
      return await cache.match(cacheKey(event.request)) ||
        (event.request.mode === 'navigate' ? await cache.match(cacheKey('./index.html')) : null) || Response.error();
    }
  })());
});
