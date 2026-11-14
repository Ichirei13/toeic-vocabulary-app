// オフラインでも開けるようにするサービスワーカー。
// 毎回ネットワークから最新を取りに行き（取れて、版が変わっていればキャッシュも更新）、つながらないときだけキャッシュを返す。
// ファイルを足したら ASSETS にも追加する。
const CACHE = 'toeic-drill-v18';
const ASSETS = [
  './',
  'index.html',
  'home.css',
  'home.js',
  'css/app.css',
  'css/theme-ios.css',
  'css/shell.css',
  'js/util.js',
  'js/theme-audio.js',
  'js/review-interval.js',
  'js/word-stats.js',
  'js/labels.js',
  'js/labels-ui.js',
  'js/grammar-drill.js',
  'js/filter-sheet.js',
  'js/vocab-filter.js',
  'js/review-prev.js',
  'js/vocab-drill.js',
  'js/filter-nudge.js',
  'js/settings.js',
  'js/rules-guide.js',
  'js/weak-list.js',
  'js/weak-print.js',
  'js/backup-core.js',
  'js/gdrive.js',
  'js/backup-io.js',
  'js/backup-ui.js',
  'js/keyboard.js',
  'js/boot.js',
  'js/pomodoro.js',
  'js/shell-chrome.js',
  'js/wide-layout.js',
  'src/filter-count.js',
  'src/activity.js',
  'src/review.js',
  'src/pace.js',
  'src/wordbook.js',
  'src/pomodoro.js',
  'src/labels.js',
  'assets/pomeranian/encourage.svg',
  'assets/pomeranian/reflect.svg',
  'assets/pomeranian/neutral.svg',
  'assets/pomeranian/streak.svg',
  'assets/pomeranian/celebrate.svg',
  'assets/pomeranian/course-kin.svg',
  'assets/pomeranian/course-sekaiichi.svg',
  'assets/pomeranian/course-polaris.svg',
  'assets/pomeranian/course-toplevel.svg',
  'assets/pomeranian/goal-target.svg',
  'assets/pomeranian/goal-0-relaxed.svg',
  'assets/pomeranian/goal-5-casual.svg',
  'assets/pomeranian/goal-20-active.svg',
  'assets/pomeranian/goal-30-intense.svg',
  'assets/pomeranian/goal-calendar.svg',
  'assets/pomeranian/app-icon.svg',
  'assets/pomeranian/vocab-teppan.svg',
  'assets/pomeranian/vocab-daily.svg',
  'assets/pomeranian/vocab-flashcards.svg',
  'assets/pomeranian/vocab-type.svg',
  'assets/pomeranian/praise-clap.svg',
  'assets/pomeranian/praise-heart.svg',
  'assets/pomeranian/praise-highfive.svg',
  'assets/pomeranian/praise-star-eyes.svg',
  'assets/pomeranian/praise-trophy.svg',
  'assets/pomeranian/praise-dance.svg',
  'assets/pomeranian/praise-party.svg',
  'assets/pomeranian/praise-medal.svg',
  'assets/pomeranian/praise-flower.svg',
  'assets/pomeranian/sad-tears.svg',
  'assets/pomeranian/sad-cry.svg',
  'assets/pomeranian/sad-sweat.svg',
  'assets/pomeranian/sad-rain.svg',
  'assets/pomeranian/sad-bandage.svg',
  'assets/pomeranian/sad-dizzy.svg',
  'assets/pomeranian/sad-shock.svg',
  'assets/pomeranian/sad-ghost.svg',
  'assets/pomeranian/cheer-pompoms.svg',
  'assets/pomeranian/status-sleep.svg',
  'assets/pomeranian/status-search.svg',
  'assets/pomeranian/status-listening.svg',
  'assets/pomeranian/status-timer.svg',
  'assets/pomeranian/status-idea.svg',
  'assets/pomeranian/status-night.svg',
  'assets/pomeranian/speed-bolt.svg',
  'assets/pomeranian/pomo-tomato.svg',
  'assets/pomeranian/cloud-sync.svg',
  'assets/pomeranian/master-cape.svg',
  'assets/pomeranian/still/app-icon.svg',
  'assets/pomeranian/still/celebrate.svg',
  'assets/pomeranian/still/cheer-pompoms.svg',
  'assets/pomeranian/still/cloud-sync.svg',
  'assets/pomeranian/still/course-kin.svg',
  'assets/pomeranian/still/course-polaris.svg',
  'assets/pomeranian/still/course-sekaiichi.svg',
  'assets/pomeranian/still/course-toplevel.svg',
  'assets/pomeranian/still/encourage.svg',
  'assets/pomeranian/still/goal-0-relaxed.svg',
  'assets/pomeranian/still/goal-20-active.svg',
  'assets/pomeranian/still/goal-30-intense.svg',
  'assets/pomeranian/still/goal-5-casual.svg',
  'assets/pomeranian/still/goal-calendar.svg',
  'assets/pomeranian/still/goal-target.svg',
  'assets/pomeranian/still/master-cape.svg',
  'assets/pomeranian/still/neutral.svg',
  'assets/pomeranian/still/pomo-tomato.svg',
  'assets/pomeranian/still/praise-clap.svg',
  'assets/pomeranian/still/praise-dance.svg',
  'assets/pomeranian/still/praise-flower.svg',
  'assets/pomeranian/still/praise-heart.svg',
  'assets/pomeranian/still/praise-highfive.svg',
  'assets/pomeranian/still/praise-medal.svg',
  'assets/pomeranian/still/praise-party.svg',
  'assets/pomeranian/still/praise-star-eyes.svg',
  'assets/pomeranian/still/praise-trophy.svg',
  'assets/pomeranian/still/reflect.svg',
  'assets/pomeranian/still/sad-bandage.svg',
  'assets/pomeranian/still/sad-cry.svg',
  'assets/pomeranian/still/sad-dizzy.svg',
  'assets/pomeranian/still/sad-ghost.svg',
  'assets/pomeranian/still/sad-rain.svg',
  'assets/pomeranian/still/sad-shock.svg',
  'assets/pomeranian/still/sad-sweat.svg',
  'assets/pomeranian/still/sad-tears.svg',
  'assets/pomeranian/still/speed-bolt.svg',
  'assets/pomeranian/still/status-idea.svg',
  'assets/pomeranian/still/status-listening.svg',
  'assets/pomeranian/still/status-night.svg',
  'assets/pomeranian/still/status-search.svg',
  'assets/pomeranian/still/status-sleep.svg',
  'assets/pomeranian/still/status-timer.svg',
  'assets/pomeranian/still/streak.svg',
  'assets/pomeranian/still/vocab-daily.svg',
  'assets/pomeranian/still/vocab-flashcards.svg',
  'assets/pomeranian/still/vocab-teppan.svg',
  'assets/pomeranian/still/vocab-type.svg',
  'icons/pomeranian-192.png',
  'icons/pomeranian-512.png',
  'icons/pomeranian-maskable-512.png',
  'icons/pomeranian-apple-touch.png',
  'data/words.js',
  'data/tips.js',
  'data/grammar.js',
  // 文法グラフ（起動時には読まず、グラフを開いたときに home.js の loadGraphAssets が差し込む）
  'data/grammar_graph.js',
  'src/mastery.js',
  'src/graph-filter.js',
  'src/graph-geometry.js',
  'src/graph-detail.js',
  'src/graph-near.js',
  'js/graph-view.js',
  'css/graph.css',
  'vendor/d3-dispatch.min.js',
  'vendor/d3-quadtree.min.js',
  'vendor/d3-timer.min.js',
  'vendor/d3-force.min.js',
  'src/graph-force.js',
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

// 取ってきた応答が、キャッシュに入っているものと同じ版か。ETag があればそれで、なければ Last-Modified で比べる。
// どちらも無ければ（確かめようがない）違う版として扱い、必ず書く。
function isSameVersion(cached, fresh) {
  if (!cached) return false;
  const etag = fresh.headers.get('ETag');
  if (etag) return etag === cached.headers.get('ETag');
  const modified = fresh.headers.get('Last-Modified');
  return Boolean(modified) && modified === cached.headers.get('Last-Modified');
}

// 版が変わったときだけキャッシュに書く。起動のたびに全ファイル（約1MB）を書き直さないため
async function updateCache(req, copy) {
  const cache = await caches.open(CACHE);
  if (isSameVersion(await cache.match(req), copy)) {
    if (copy.body) await copy.body.cancel(); // 使わない写しは捨てる
    return;
  }
  await cache.put(req, copy);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // waitUntil で待つので、書き込みの途中で Service Worker が止まらない
        if (res.ok) event.waitUntil(updateCache(req, res.clone()).catch(() => {}));
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
