// オフラインでも開けるようにするサービスワーカー。
// 毎回ネットワークから最新を取りに行き（取れたらキャッシュも更新）、つながらないときだけキャッシュを返す。
// ファイルを足したら ASSETS にも追加する。
const CACHE = 'toeic-drill-v2';
const ASSETS = [
  './',
  'index.html',
  'home.css',
  'home.js',
  'src/filter-count.js',
  'src/activity.js',
  'src/review.js',
  'src/pace.js',
  'assets/pomeranian/encourage.svg',
  'assets/pomeranian/reflect.svg',
  'assets/pomeranian/neutral.svg',
  'assets/pomeranian/streak.svg',
  'assets/pomeranian/celebrate.svg',
  'assets/pomeranian/still/neutral.svg',
  'assets/pomeranian/still/encourage.svg',
  'assets/pomeranian/still/reflect.svg',
  'assets/pomeranian/still/celebrate.svg',
  'assets/pomeranian/still/streak.svg',
  'assets/pomeranian/course-kin.svg',
  'assets/pomeranian/course-sekaiichi.svg',
  'assets/pomeranian/course-polaris.svg',
  'assets/pomeranian/course-toplevel.svg',
  'assets/pomeranian/goal-target.svg',
  'assets/pomeranian/app-icon.svg',
  'assets/pomeranian/vocab-teppan.svg',
  'assets/pomeranian/vocab-daily.svg',
  'assets/pomeranian/vocab-flashcards.svg',
  'icons/pomeranian-192.png',
  'icons/pomeranian-512.png',
  'icons/pomeranian-maskable-512.png',
  'icons/pomeranian-apple-touch.png',
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
