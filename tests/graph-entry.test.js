// 文法グラフの入口（復習ページのカード・PC のサイドバーのタブ・#graph）と、グラフ用ファイルの遅延読み込みの検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/graph-entry.test.js
// グラフ用の 13 ファイルは起動時には読まず、グラフの画面を開いたときに home.js の loadGraphAssets() が差し込む。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

// 起動時（ホームを開いてネットワークが落ち着き、さらに 2 秒待つまで）にページが出す同一オリジンのリクエスト数。
// このタスクの変更前（commit 894f69e）のコードで、幅 375×812 と 1280×800 の両方で測った値（どちらも 48、3 回とも同じ）。
// ラベル機能の統合（2026-11-20）で、起動時に読む src/labels.js・js/labels.js・js/labels-ui.js の 3 件が増えて 51。
// グラフの追加で起動のリクエストが 1 件でも増えたら失敗する。
// 注: Service Worker の install（初回と sw.js の更新時だけ）は ASSETS をまとめて取るので、そこにはグラフ用のファイルも
// 入る（オフラインで開くため）。ここで数えるのはページ自身のリクエストだけ。
const STARTUP_REQUESTS_BASELINE = 53; // 2026-11-21: シートの高さの計算（src/sheet-size.js）を足して 51 → 52
// 2026-11-23: 発音ボタン（src/speech.js。3f3434b で追加）の分を反映して 52 → 53

const GRAPH_FILES = [
  'css/graph.css',
  'data/grammar_graph.js',
  'src/mastery.js',
  'src/graph-filter.js',
  'src/graph-geometry.js',
  'src/graph-detail.js',
  'src/graph-near.js',
  'src/graph-report.js',
  'js/graph-view.js',
  // 力学用（読めなくてもグラフは開く）。graph-view.js の後に差し込まれる
  'vendor/d3-dispatch.min.js',
  'vendor/d3-quadtree.min.js',
  'vendor/d3-timer.min.js',
  'vendor/d3-force.min.js',
  'src/graph-force.js',
];
const PHONE = { width: 375, height: 812 };
const PC = { width: 1280, height: 800 };

let browser, base;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' }[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

// sw: true のときだけ Service Worker を使う（それ以外は page.route がすべてのリクエストを見られるよう止める）
async function open(t, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || PHONE, serviceWorkers: opts.sw ? 'allow' : 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  t.after(() => assert.deepEqual(errors.map(String), [], 'ページで例外が出た'));
  if (opts.init) await page.addInitScript(opts.init.fn, opts.init.arg);
  if (opts.beforeGoto) await opts.beforeGoto(page, context);
  await page.goto(base + '/index.html' + (opts.hash || '#home'));
  return { page, context };
}

async function waitFor(page, fn, arg, timeout = 6000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout: ' + fn.toString());
    await new Promise(r => setTimeout(r, 20));
  }
}
const drawn = page => waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.frames >= 1
  && document.querySelectorAll('#graph-page canvas').length === 1);
const activePage = page => page.evaluate(() => document.querySelector('.app-page-view.active')?.id);
const tagCounts = page => page.evaluate(files => files.map(f => f.endsWith('.css')
  ? document.querySelectorAll(`link[href="${f}"]`).length
  : document.querySelectorAll(`script[src="${f}"]`).length), GRAPH_FILES);

async function openReviewCard(page) {
  await page.getByRole('tab', { name: '復習', exact: true }).click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
}

for (const vp of [PHONE, PC]) {
  test(`起動の不変（${vp.width}px）: 起動のリクエスト数が変更前と同じで、グラフ用のファイルを 1 つも取らない`, async t => {
    const context = await browser.newContext({ viewport: vp });
    t.after(() => context.close());
    const page = await context.newPage();
    const urls = [];
    page.on('request', r => { if (r.url().startsWith(base)) urls.push(r.url().slice(base.length + 1)); });
    await page.goto(base + '/index.html#home', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const graph = urls.filter(u => GRAPH_FILES.includes(u.split('?')[0]));
    assert.deepEqual(graph, [], 'グラフ用のファイルを起動時に取った');
    assert.equal(urls.length, STARTUP_REQUESTS_BASELINE, `起動のリクエスト数が変わった: ${urls.join(', ')}`);
  });
}

test('復習ページのカードでグラフが開き、戻ると復習ページに戻って何も残らない。3 回開いてもタグは 1 組', async t => {
  const { page } = await open(t);
  const requested = [];
  page.on('request', r => { const u = r.url().slice(base.length + 1); if (GRAPH_FILES.includes(u)) requested.push(u); });
  await page.getByRole('tab', { name: '復習', exact: true }).click();
  const card = page.locator('#review-page [data-home-action="open-graph"]');
  assert.ok(await card.isVisible(), '復習ページにグラフのカードがない');
  assert.match(await page.locator('#review-page').innerText(), /文法グラフ/);
  for (let i = 0; i < 3; i++) {
    await card.click();
    assert.equal(await activePage(page), 'graph-page');
    await drawn(page);
    await page.locator('#graph-page .graph-page-back').click();
    assert.equal(await activePage(page), 'review-page', `${i + 1} 回目: 戻るで復習ページに戻らない`);
    const r = await page.evaluate(() => ({ listeners: GraphView._debug.listeners, canvases: document.querySelectorAll('canvas').length }));
    assert.deepEqual(r, { listeners: 0, canvases: 0 }, `${i + 1} 回目: 戻ったあとにリスナーか canvas が残った`);
  }
  assert.deepEqual(await tagCounts(page), GRAPH_FILES.map(() => 1), 'タグが重複した');
  assert.deepEqual(requested.sort(), [...GRAPH_FILES].sort(), '2 回目以降も取り直した');
  // 差し込む順番（設計どおり、依存の順）
  const order = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => /grammar_graph|mastery|graph-|vendor\//.test(s)));
  assert.deepEqual(order, GRAPH_FILES.filter(f => f.endsWith('.js')));
});

test('読み込みの途中で別のページへ移ると、あとからマウントしない。もう一度開けば開く', async t => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { page } = await open(t, {
    beforeGoto: page => page.route('**/data/grammar_graph.js', async route => { await gate; await route.continue(); }),
  });
  await openReviewCard(page);
  assert.equal(await activePage(page), 'graph-page');
  assert.ok(await page.locator('#graph-page .graph-page-loading').isVisible(), '読み込み中の表示がない');
  await page.locator('#graph-page .graph-page-back').click();
  assert.equal(await activePage(page), 'review-page');
  release();
  await waitFor(page, () => typeof GraphView !== 'undefined');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ frames: GraphView._debug.frames, listeners: GraphView._debug.listeners, views: document.querySelectorAll('.graph-view').length }));
  assert.deepEqual(r, { frames: 0, listeners: 0, views: 0 }, '離れたあとにマウントされた');
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await drawn(page);
});

test('読み込みに失敗すると理由と「再試行」が出て、直ったあと再試行で開く', async t => {
  const { page } = await open(t, {
    beforeGoto: page => page.route('**/data/grammar_graph.js', route => route.fulfill({ status: 500, body: 'x' })),
  });
  await openReviewCard(page);
  const err = page.locator('#graph-page .graph-page-error');
  await err.waitFor({ state: 'visible' });
  assert.match(await err.innerText(), /グラフの読み込みに失敗しました（オフラインで未取得の可能性があります）/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#graph-page canvas').length), 0);
  await page.unroute('**/data/grammar_graph.js');
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await drawn(page);
  assert.equal(await err.isVisible(), false, '開いたのにエラーが残っている');
  assert.deepEqual(await tagCounts(page), GRAPH_FILES.map(() => 1), '再試行でタグが重複した');
});

test('オフライン: Service Worker 経由で一度開いたあと、オフラインで開き直しても開く', async t => {
  const { page, context } = await open(t, { sw: true });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await openReviewCard(page);
  await drawn(page);
  await page.waitForTimeout(800); // 取ったファイルをキャッシュに書き終えるまで
  await context.setOffline(true);
  // 今の URL は #graph なので、ホームから開き直す（ページの読み込みも Service Worker のキャッシュから）
  await page.evaluate(() => history.replaceState(null, '', '#home'));
  await page.reload();
  await page.waitForFunction(() => typeof switchAppPage === 'function');
  assert.equal(await activePage(page), 'home-page');
  assert.equal(await page.evaluate(() => typeof GraphView), 'undefined', '再読み込みでグラフ用のファイルが残っている');
  await openReviewCard(page);
  await drawn(page);
  await context.setOffline(false);
});

test('オフライン: オンラインで一度も開いていなくても、Service Worker の install（ASSETS）で取ってあるので開く', async t => {
  const { page, context } = await open(t, { sw: true });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async files => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find(k => k.startsWith('toeic-drill-')));
    return Promise.all(files.map(async f => !!(await c.match(f))));
  }, GRAPH_FILES);
  assert.deepEqual(cached, GRAPH_FILES.map(() => true), 'install でグラフ用のファイルがキャッシュに入っていない');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof switchAppPage === 'function');
  await openReviewCard(page);
  await drawn(page);
  await context.setOffline(false);
});

test('PC（1280px）: サイドバーの「グラフ」タブが見えて開き、タブの選択状態が正しい。ハッシュで出入りできる', async t => {
  const { page } = await open(t, { viewport: PC });
  const tab = page.getByRole('tab', { name: 'グラフ', exact: true });
  assert.ok(await tab.isVisible(), 'グラフのタブが見えない');
  const icon = await tab.evaluate(el => (getComputedStyle(el, '::before').webkitMaskImage || '').includes('svg'));
  assert.ok(icon, 'グラフのタブにアイコンがない');
  await tab.click();
  assert.equal(await activePage(page), 'graph-page');
  await drawn(page);
  const sel = await page.evaluate(() => [...document.querySelectorAll('.top-page-tab')].map(b => [b.dataset.page, b.classList.contains('active'), b.getAttribute('aria-selected')]));
  for (const [p, active, aria] of sel) {
    assert.equal(active, p === 'graph', `${p} の active`);
    assert.equal(aria, p === 'graph' ? 'true' : 'false', `${p} の aria-selected`);
  }
  // 本文はサイドバーの右に、画面の高さいっぱいに置く
  const box = await page.evaluate(() => {
    const nav = document.querySelector('.top-page-nav').getBoundingClientRect();
    const g = document.getElementById('graph-page').getBoundingClientRect();
    const c = document.querySelector('#graph-page canvas').getBoundingClientRect();
    return { navRight: nav.right, left: g.left, width: g.width, height: g.height, canvasH: c.height, vh: innerHeight };
  });
  assert.ok(box.left >= box.navRight - 1, `サイドバーに重なっている: ${JSON.stringify(box)}`);
  assert.ok(box.width > 700 && box.height > box.vh - 40 && box.canvasH > 400, `広さが足りない: ${JSON.stringify(box)}`);
  assert.equal(await page.evaluate(() => location.hash), '#graph');
  // ハッシュで別のページへ → 片付く
  await page.evaluate(() => { location.hash = '#home'; });
  await waitFor(page, () => document.querySelector('.app-page-view.active')?.id === 'home-page');
  assert.deepEqual(await page.evaluate(() => ({ l: GraphView._debug.listeners, c: document.querySelectorAll('canvas').length })), { l: 0, c: 0 });
  await page.evaluate(() => { location.hash = '#graph'; });
  await drawn(page);
});

test('スマホ（375px）: 「グラフ」タブは隠れていて（display:none）、下のバーは 5 タブのまま', async t => {
  const { page } = await open(t);
  const tab = page.locator('.top-page-tab[data-page="graph"]');
  assert.equal(await tab.count(), 1);
  assert.equal(await tab.isVisible(), false);
  assert.equal(await tab.evaluate(el => getComputedStyle(el).display), 'none');
  const visibleTabs = await page.evaluate(() => [...document.querySelectorAll('.top-page-tab')].filter(b => b.offsetParent !== null).map(b => b.dataset.page));
  assert.deepEqual(visibleTabs, ['home', 'practice', 'review', 'timer', 'settings']);
});

for (const vp of [PHONE, PC]) {
  test(`#graph で直接開き、戻るは復習ページへ（${vp.width}px）。スマホではバーに重ならない`, async t => {
    const { page } = await open(t, { viewport: vp, hash: '#graph' });
    assert.equal(await activePage(page), 'graph-page');
    await drawn(page);
    if (vp === PHONE) {
      const r = await page.evaluate(() => ({
        graphBottom: document.getElementById('graph-page').getBoundingClientRect().bottom,
        navTop: document.querySelector('.top-page-nav').getBoundingClientRect().top,
        canvasH: document.querySelector('#graph-page canvas').getBoundingClientRect().height,
      }));
      assert.ok(r.graphBottom <= r.navTop + 1, `グラフの画面が下のバーに重なる: ${JSON.stringify(r)}`);
      assert.ok(r.canvasH > 400, `キャンバスが低すぎる: ${JSON.stringify(r)}`);
    }
    await page.locator('#graph-page .graph-page-back').click();
    assert.equal(await activePage(page), 'review-page');
  });
}

test('苦手を入れた記録（本物の保存キー）で、その問題の概念・Trap のノードが赤い。復習のカードもそのまま使える', async t => {
  // 1 回目: グラフのデータから、概念と Trap の両方につながる問題を 1 問選ぶ
  const first = await open(t);
  await openReviewCard(first.page);
  await drawn(first.page);
  const pick = await first.page.evaluate(() => {
    const G = GRAMMAR_GRAPH, e = G.edges, links = new Map();
    for (let k = 0; k < e.length; k += 3) {
      if (e[k + 2] === 0) continue;
      const [a, b] = [e[k], e[k + 1]];
      const q = G.kind[a] === 5 ? a : b, other = q === a ? b : a;
      if (!links.has(q)) links.set(q, {});
      links.get(q)[e[k + 2] === 1 ? 'concept' : 'trap'] = other;
    }
    for (const [q, l] of links) if (l.concept != null && l.trap != null && GRAMMAR_BY_ID.has(G.qid[q])) return { qid: G.qid[q], concept: l.concept, trap: l.trap };
    return null;
  });
  assert.ok(pick, '概念と Trap の両方につながる問題がある前提');
  // 2 回目: その問題を苦手（期限前）・正答率 0 として保存した状態で起動する
  const { page } = await open(t, {
    init: {
      fn: p => {
        if (sessionStorage.getItem('__seeded')) return;
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('toeic_grammar_stats', JSON.stringify({ [p.qid]: { a: 2, c: 0 } }));
        localStorage.setItem('toeic_weak_grammar', JSON.stringify({ [p.qid]: { streak: 0, added: Date.now() - 3600000, due: Date.now() + 86400000 } }));
      },
      arg: pick,
    },
  });
  assert.equal(await page.evaluate(q => !!state.grammarWeakData[q], pick.qid), true, '苦手が読み込まれていない');
  await page.getByRole('tab', { name: '復習', exact: true }).click();
  assert.match(await page.locator('#review-page').innerText(), /文法グラフ/);
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await drawn(page);
  for (const i of [pick.concept, pick.trap]) {
    const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), i);
    const px = await page.evaluate(([x, y]) => {
      const c = document.querySelector('#graph-page canvas');
      const r = c.getBoundingClientRect(), dpr = c.width / r.width;
      const d = c.getContext('2d').getImageData(Math.floor((x - r.left) * dpr), Math.floor((y - r.top) * dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [x, y]);
    const [r, g, b] = px;
    assert.ok(r > 150 && r - g > 60 && r - b > 60, `ノード ${i} が赤くない: ${px}`);
  }
});

// ノードの中心の 1 ピクセルの色を返す
const nodePixel = (page, i) => page.evaluate(idx => {
  const [x, y] = GraphView._debug.screenOf(idx);
  const c = document.querySelector('#graph-page canvas');
  const r = c.getBoundingClientRect(), dpr = c.width / r.width;
  const d = c.getContext('2d').getImageData(Math.floor((x - r.left) * dpr), Math.floor((y - r.top) * dpr), 1, 1).data;
  return [d[0], d[1], d[2]];
}, i);

test('記録が読み込み直されると（同期・復元と同じ reloadRecordsFromStorage）、開いているグラフの色が更新される', async t => {
  const { page } = await open(t);
  await openReviewCard(page);
  await drawn(page);
  const pick = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, e = G.edges;
    for (let k = 0; k < e.length; k += 3) {
      if (e[k + 2] !== 1) continue;
      const q = e[k], concept = e[k + 1];
      if (G.kind[q] === 5 && GRAMMAR_BY_ID.has(G.qid[q])) return { qid: G.qid[q], concept };
    }
    return null;
  });
  assert.ok(pick, '概念につながる問題がある前提');
  const before = await nodePixel(page, pick.concept);
  assert.ok(!(before[0] > 150 && before[0] - before[1] > 60), `最初から赤い: ${before}`);
  // 同期（applyMergedRecordsToLocal）がやるのと同じく、保存を書き換えてから reloadRecordsFromStorage(false) を呼ぶ。
  // 同期のコード（gdrive.js / backup-io.js）には触れず、アプリが実際に使う入口をそのまま呼ぶ
  const frames0 = await page.evaluate(({ qid }) => {
    localStorage.setItem('toeic_grammar_stats', JSON.stringify({ [qid]: { a: 2, c: 0 } }));
    localStorage.setItem('toeic_weak_grammar', JSON.stringify({ [qid]: { streak: 0, added: Date.now() - 3600000, due: Date.now() + 86400000 } }));
    const f = GraphView._debug.frames;
    reloadRecordsFromStorage(false);
    return f;
  }, pick);
  await waitFor(page, f0 => GraphView._debug.frames > f0 && !GraphView._debug.pending, frames0);
  const after = await nodePixel(page, pick.concept);
  assert.ok(after[0] > 150 && after[0] - after[1] > 60 && after[0] - after[2] > 60, `読み込み直しのあとも赤くない: ${after}`);
});

test('PC: グラフの画面で「グラフ」タブをもう一度押しても、作り直さず、カメラも変わらない', async t => {
  const { page } = await open(t, { viewport: PC });
  const tab = page.getByRole('tab', { name: 'グラフ', exact: true });
  await tab.click();
  await drawn(page);
  await page.evaluate(() => GraphView._debug.focus(null, 3));
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  const fit = await page.evaluate(() => GraphView._debug.camera().fitScale);
  assert.ok(cam0.scale > fit * 1.5, `ズームできていない: ${JSON.stringify(cam0)}`);
  const marker = await page.evaluate(() => { const c = document.querySelector('#graph-page canvas'); c.dataset.mark = 'same'; return GraphView._debug.listeners; });
  await tab.click();
  await page.waitForTimeout(300);
  const cam1 = await page.evaluate(() => GraphView._debug.camera());
  assert.deepEqual(cam1, cam0, 'カメラが変わった');
  assert.equal(await page.evaluate(() => document.querySelector('#graph-page canvas')?.dataset.mark), 'same', 'Canvas が作り直された');
  assert.equal(await page.evaluate(() => GraphView._debug.listeners), marker, 'リスナー数が変わった');
  assert.equal(await activePage(page), 'graph-page');
  assert.equal(await tab.getAttribute('aria-selected'), 'true');
});

test('ホーム（文法）の文法グラフのカード: 正答率と苦手の数を出し、押すと前回のモードによらずレーダーで開く', async t => {
  const { page } = await open(t, {
    init: {
      fn: () => {
        if (sessionStorage.getItem('__seeded')) return;
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('toeic_grammar_stats', JSON.stringify({ 1: { a: 4, c: 3 }, 2: { a: 4, c: 2 } }));
        localStorage.setItem('toeic_weak_grammar', JSON.stringify({ 2: { streak: 0, added: 1, due: 1, u: 1 } }));
        localStorage.setItem('toeic_graph_mode_v1', JSON.stringify('book'));
      },
    },
  });
  await page.locator('#home-page [data-home-switch="grammar"]').click();
  const card = page.locator('#home-page .home-graph-bar');
  await card.waitFor();
  const text = await card.innerText();
  assert.match(text, /正答率 63%/); // 5/8 = 62.5% → 63%
  assert.match(text, /苦手 1 問/);
  assert.equal(await page.evaluate(() => typeof GraphView), 'undefined', 'カードを出すだけでグラフのファイルを読んだ');
  await card.locator('[data-home-action="open-graph-radar"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'radar' && !!document.querySelector('#graph-page .graph-radar-svg'), undefined, 15000);
  assert.equal(await activePage(page), 'graph-page');
  // 単語のときはカードを出さない（グラフは文法だけ）
  await page.evaluate(() => switchAppPage('home'));
  await page.locator('#home-page [data-home-switch="vocab"]').click();
  assert.equal(await page.locator('#home-page .home-graph-bar').count(), 0);
});

test('力学用のファイルが読めなくても、グラフは固定配置で開く', async t => {
  const { page } = await open(t, {
    beforeGoto: async page => { await page.route('**/vendor/**', route => route.abort()); },
  });
  await openReviewCard(page);
  await drawn(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settled), true);
  assert.equal(await page.evaluate(() => typeof d3), 'undefined');
});

test('文法軸モードの選択がこの端末に記憶され、再訪・リロード後も引き継がれる（壊れた値は教材軸に戻る）', async t => {
  const { page } = await open(t);
  await openReviewCard(page);
  await drawn(page);
  assert.equal(await page.evaluate(() => GraphView._debug.mode), 'book');
  await page.click('#graph-page .graph-mode-btn[data-mode="grammar"]');
  await waitFor(page, () => GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_graph_mode_v1'))), 'grammar');
  // 一度別ページへ離れて開き直す
  await page.locator('#graph-page .graph-page-back').click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  // リロードしても引き継がれる
  await page.reload();
  await page.getByRole('tab', { name: '復習', exact: true }).click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  // 壊れた値が入っていれば教材軸にフォールバック
  await page.evaluate(() => { localStorage.setItem('toeic_graph_mode_v1', '{broken'); });
  await page.locator('#graph-page .graph-page-back').click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await drawn(page);
  assert.equal(await page.evaluate(() => GraphView._debug.mode), 'book');
  // レーダーチャートモードも記憶され、リロード後も開く
  await page.click('#graph-page .graph-mode-btn[data-mode="radar"]');
  await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#graph-page .graph-radar-svg'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_graph_mode_v1'))), 'radar');
  await page.reload();
  await page.getByRole('tab', { name: '復習', exact: true }).click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'radar' && !!document.querySelector('#graph-page .graph-radar-svg'));
});

test('文法軸の座標キャッシュ（toeic_graph_grammar_cache_v1）が再訪・リロードで効き、苦手変化で再計算、破損や容量超過でもエラーを出さない', async t => {
  const { page } = await open(t);
  await openReviewCard(page);
  await drawn(page);
  await page.click('#graph-page .graph-mode-btn[data-mode="grammar"]');
  await waitFor(page, () => GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  const firstTicks = await page.evaluate(() => GraphView._debug.settleTicks);
  const expectedTicks = await page.evaluate(() => StudyCore.GRAPH_GRAMMAR.ticks);
  assert.equal(firstTicks, expectedTicks);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_graph_grammar_cache_v1')));
  assert.ok(saved && typeof saved.sig === 'string' && Array.isArray(saved.x) && saved.x.length === 1201, 'キャッシュが保存されていない');

  // 1. ページ移動後の再訪は 0 tick で開く
  await page.locator('#graph-page .graph-page-back').click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), 0);

  // 2. リロード後も 0 tick で開き、概念は円周上にある
  await page.reload();
  await page.getByRole('tab', { name: '復習', exact: true }).click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  const reloadRes = await page.evaluate(() => {
    const D = GraphView._debug, R = StudyCore.GRAPH_GRAMMAR.ringRadius;
    const svoc = D.worldOf(D.indexOf('con:SVOC（文の骨格）'));
    return { ticks: D.settleTicks, rDiff: Math.abs(Math.hypot(svoc[0], svoc[1]) - R) };
  });
  assert.equal(reloadRes.ticks, 0);
  assert.ok(reloadRes.rDiff < 1e-3);

  // 3. 苦手が変化すると自動で再計算される
  await page.evaluate(() => {
    const qid = GRAMMAR_GRAPH.qids[0];
    localStorage.setItem('toeic_weak_grammar', JSON.stringify({ [qid]: { streak: 0, added: Date.now() - 1000, due: Date.now() + 86400000 } }));
    reloadRecordsFromStorage(false);
  });
  await page.locator('#graph-page .graph-page-back').click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), expectedTicks);

  // 4. キャッシュ破損 ＋ 容量不足エラーでもグラフが開き、学習エラー警告トーストを出さない（リロードでメモリキャッシュも空にする）
  await page.evaluate(() => { localStorage.setItem('toeic_graph_grammar_cache_v1', '{broken'); });
  await page.reload();
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'toeic_graph_grammar_cache_v1') throw new DOMException('quota', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await page.getByRole('tab', { name: '復習', exact: true }).click();
  await page.locator('#review-page [data-home-action="open-graph"]').click();
  await waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), expectedTicks);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(el => el.textContent));
  assert.equal(toasts.some(t => t.includes('保存できませんでした')), false, `キャッシュ保存失敗で学習エラー警告が出た: ${JSON.stringify(toasts)}`);
});

test('配置軸の保存に失敗しても、学習記録の保存エラーとして扱わず、別タブの保存の読み込み直しを止めない', async t => {
  const { page } = await open(t);
  await openReviewCard(page);
  await drawn(page);
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'toeic_graph_mode_v1') throw new DOMException('quota', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await page.click('#graph-page .graph-mode-btn[data-mode="grammar"]');
  await waitFor(page, () => GraphView._debug.mode === 'grammar' && GraphView._debug.settled === true, undefined, 15000);
  const res = await page.evaluate(() => ({
    failed: [...failedSaveKeys],
    toasts: [...document.querySelectorAll('.toast')].map(el => el.textContent),
  }));
  assert.deepEqual(res.failed, [], '配置軸のキーが保存失敗として残ると、このタブは別タブの保存を読み込み直さなくなる');
  assert.equal(res.toasts.some(s => s.includes('保存できませんでした')), false, `配置軸の保存失敗で学習エラー警告が出た: ${JSON.stringify(res.toasts)}`);
  // 別タブが苦手リストを保存したら、このタブも読み込み直す
  const qid = await page.evaluate(() => GRAMMAR_GRAPH.qids[0]);
  await page.evaluate(q => {
    const raw = JSON.stringify({ [q]: { streak: 0, added: Date.now() - 1000, due: Date.now() + 86400000, u: Date.now() } });
    localStorage.setItem('toeic_weak_grammar', raw);
    reloadRecordsSavedElsewhere();
  }, qid);
  await waitFor(page, q => !!(state.grammarWeakData && state.grammarWeakData[q]), qid);
});
