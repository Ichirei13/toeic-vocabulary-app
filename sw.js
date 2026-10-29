// オフラインでも開けるようにするサービスワーカー。
// 毎回ネットワークから最新を取りに行き（取れたらキャッシュも更新）、つながらないときだけキャッシュを返す。
// ファイルを足したら ASSETS にも追加する。
const CACHE = 'toeic-drill-v1';
const ASSETS = [
  './',
  'index.html',
  'home.css',
  'home.js',
  'src/filter-count.js',
  'src/activity.js',
  'src/review.js',
  'data/words.js',
  'data/grammar.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return (await caches.match('./')) || Response.error();
        return Response.error();
      })
  );
});
