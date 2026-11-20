// 文法グラフの画面（js/graph-view.js + css/graph.css）の検証。アプリ全体は起動せず、
// グラフ用のファイルだけを読む最小のページ（メモリ上の /__graph_test.html）で確かめる。
// 実行: NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js
// スクリーンショット: GRAPH_SHOTS=<出力先ディレクトリ> を付けると、最後のテストが画像を書き出す（リポジトリの外に出すこと）。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
// extraHead: テーマのテスト用に、アプリの本物の CSS を足したページも作る
const testPage = (extraHead = '') => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${extraHead}
<link rel="stylesheet" href="/css/graph.css">
<style>html,body{margin:0;height:100%;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}#host{position:fixed;inset:0}</style>
</head><body><div id="host"></div>
<script src="/data/grammar_graph.js"></script>
<script src="/src/mastery.js"></script>
<script src="/src/graph-filter.js"></script>
<script src="/src/graph-geometry.js"></script>
<script src="/src/graph-detail.js"></script>
<script src="/src/graph-near.js"></script>
<script src="/src/graph-report.js"></script>
<script src="/vendor/d3-dispatch.min.js"></script>
<script src="/vendor/d3-quadtree.min.js"></script>
<script src="/vendor/d3-timer.min.js"></script>
<script src="/vendor/d3-force.min.js"></script>
<script src="/src/graph-force.js"></script>
<script src="/js/graph-view.js"></script>
<script>
  window.__stats = {};
  window.__weak = {};
  window.__getQ = null;
  window.__deps = function () {
    return {
      graph: GRAMMAR_GRAPH,
      getStats: function () { return window.__stats; },
      getWeak: function () { return window.__weak; },
      getQuestion: function (qid) { return window.__getQ ? window.__getQ(qid) : { q: 'Question number ' + qid + ' text' }; },
      isDue: function (e) { return !!(e && typeof e.due === 'number' && e.due <= Date.now()); },
    };
  };
  window.__mount = function () { GraphView.mount(document.getElementById('host'), window.__deps()); };
  window.__px = function (x, y) {
    var c = document.querySelector('#host canvas');
    var r = c.getBoundingClientRect(), dpr = c.width / r.width;
    // x, y はページ（ビューポート）の座標。screenOf と同じ
    var d = c.getContext('2d').getImageData(Math.floor((x - r.left) * dpr), Math.floor((y - r.top) * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
</script>
</body></html>`;

// rAF とタイマーの呼び出しを、ページのスクリプトより前に包んで数える
const COUNT_SCRIPT = `
  window.__cnt = { raf: 0, timeout: 0, interval: 0 };
  (function () {
    var raf = window.requestAnimationFrame, st = window.setTimeout, si = window.setInterval;
    window.requestAnimationFrame = function (f) { window.__cnt.raf++; return raf.call(window, f); };
    window.setTimeout = function () { window.__cnt.timeout++; return st.apply(window, arguments); };
    window.setInterval = function () { window.__cnt.interval++; return si.apply(window, arguments); };
  })();
`;

let browser, base;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  if (pathname === '/__graph_test.html' || pathname === '/__graph_theme_test.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const extra = pathname === '/__graph_theme_test.html' ? '<link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/theme-ios.css">' : '';
    return res.end(testPage(extra));
  }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

async function open(t, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 375, height: 812 }, colorScheme: opts.colorScheme || 'light' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  t.after(() => assert.deepEqual(errors.map(String), [], 'ページで例外が出た'));
  await page.addInitScript(COUNT_SCRIPT);
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(base + (opts.path || '/__graph_test.html'));
  return page;
}

// ページ側のタイマーや rAF を使わずに、Node 側から条件を待つ
async function waitFor(page, fn, arg, timeout = 3000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout: ' + fn.toString());
    await new Promise(r => setTimeout(r, 15));
  }
}
const frames = page => page.evaluate(() => GraphView._debug.frames);
async function mountAndWait(page) {
  await page.evaluate(() => window.__mount());
  await waitFor(page, () => GraphView._debug.frames >= 1);
}
// 苦手を count 問入れる（グラフの問題を先頭から）。期限は未来（復習期限ではない）
async function seedWeak(page, count) {
  return page.evaluate(c => {
    const G = GRAMMAR_GRAPH, stats = {}, weak = {}, picked = [];
    for (let i = 0; i < G.id.length && picked.length < c; i++) {
      if (G.kinds[G.kind[i]] !== 'question') continue;
      stats[G.qid[i]] = { a: 2, c: 0 };
      weak[G.qid[i]] = { streak: 0, due: Date.now() + 86400000 };
      picked.push(i);
    }
    window.__stats = stats; window.__weak = weak;
    return picked;
  }, count);
}
const settled = page => waitFor(page, () => GraphView._debug.settled === true && GraphView._debug.frames >= 1, undefined, 15000);

// 新しいフレームが描かれるのを待つ（before = 待つ前のフレーム数）
const nextFrame = (page, before) => waitFor(page, b => GraphView._debug.frames > b, before);
const sheetOpen = page => page.evaluate(() => {
  const s = document.querySelector('#host .graph-sheet');
  return !!s && !s.hidden;
});
const isRed = ([r, g, b]) => r > 150 && r - g > 60 && r - b > 60;
const isGrey = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 24;

// 概念と Trap の両方につながる問題を 1 問探す（概念・Trap のエッジは 問題 -> 概念/Trap）
async function pickLinkedQuestion(page) {
  return page.evaluate(() => {
    const G = GRAMMAR_GRAPH, e = G.edges, links = new Map();
    for (let k = 0; k < e.length; k += 3) {
      if (e[k + 2] === 0) continue;
      const [a, b] = [e[k], e[k + 1]];
      const q = G.kind[a] === 5 ? a : b, other = q === a ? b : a;
      if (!links.has(q)) links.set(q, {});
      links.get(q)[e[k + 2] === 1 ? 'concept' : 'trap'] = other;
    }
    for (const [q, l] of links) if (l.concept != null && l.trap != null) return { q, qid: G.qid[q], concept: l.concept, trap: l.trap };
    return null;
  });
}

test('マウントすると canvas が 1 枚でき、1 回だけ描かれ、その後 1 秒は rAF もタイマーも呼ばれない', async t => {
  const page = await open(t);
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; window.__mount(); });
  await waitFor(page, () => GraphView._debug.frames >= 1);
  await new Promise(r => setTimeout(r, 1100));
  const r = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    frames: GraphView._debug.frames, cnt: window.__cnt, listeners: GraphView._debug.listeners,
  }));
  assert.equal(r.canvases, 1);
  assert.equal(r.frames, 1);
  assert.deepEqual(r.cnt, { raf: 1, timeout: 0, interval: 0 });
  assert.ok(r.listeners > 0);
});

test('苦手（概念と Trap につながる問題 1 問）を渡すと、概念・Trap・その問題が赤く描かれる', async t => {
  const page = await open(t);
  const pick = await pickLinkedQuestion(page);
  assert.ok(pick, '概念と Trap の両方につながる問題がある前提');
  await page.evaluate(p => {
    window.__stats = { [p.qid]: { a: 2, c: 0 } };
    window.__weak = { [p.qid]: { streak: 0, due: Date.now() + 86400000 } };
  }, pick);
  await mountAndWait(page);
  await settled(page); // 苦手があるので力学が回る。色は収まってから読む
  for (const i of [pick.concept, pick.trap]) {
    const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), i);
    const px = await page.evaluate(([x, y]) => window.__px(x, y), [x, y]);
    assert.ok(isRed(px), `ノード ${i} が赤くない: ${px}`);
  }
  // 近景で問題そのものも赤い
  const f = await frames(page);
  await page.evaluate(q => GraphView._debug.focus(q, 9), pick.q);
  await nextFrame(page, f);
  assert.equal(await page.evaluate(() => GraphView._debug.lod), 2);
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), pick.q);
  const px = await page.evaluate(([x, y]) => window.__px(x, y), [x, y]);
  assert.ok(isRed(px), `問題ノードが赤くない: ${px}`);
});

test('力学: 苦手があると数フレームかけて収まり、その後 1 秒は rAF もタイマーも呼ばれない', async t => {
  const page = await open(t);
  const picked = await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  const d = await page.evaluate(() => ({ ticks: GraphView._debug.settleTicks, ms: GraphView._debug.settleMs, frames: GraphView._debug.frames }));
  assert.equal(d.ticks, 120, '決めた回数だけ回っていない');
  assert.ok(d.frames >= 2, '途中の様子が描かれていない');
  await new Promise(r => setTimeout(r, 300)); // 収まった後の最後の 1 フレームを待つ
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; });
  await new Promise(r => setTimeout(r, 1100));
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 });
  // 苦手の問題は、つながる概念・ひっかけに近づいている（ビルド済みの座標との比較）
  const moved = await page.evaluate(picked => {
    const G = GRAMMAR_GRAPH, e = G.edges, D = GraphView._debug;
    let nearer = 0, total = 0;
    for (let k = 0; k < e.length; k += 3) {
      if (e[k + 2] === 0 || !picked.includes(e[k])) continue;
      const q = e[k], h = e[k + 1];
      const before = Math.hypot(G.x[q] - G.x[h], G.y[q] - G.y[h]);
      const a = D.worldOf(q), b = D.worldOf(h);
      total++;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < before) nearer++;
    }
    return { nearer, total };
  }, picked);
  assert.ok(moved.total > 0);
  assert.ok(moved.nearer / moved.total > 0.8, `概念・ひっかけに近づいた線が少ない: ${moved.nearer}/${moved.total}`);
});

test('力学: 収まるまでタップは無視され、収まった後は新しい位置でタップできる', async t => {
  const page = await open(t);
  const picked = await seedWeak(page, 40);
  // マウントと同じ同期の中で、全体表示で見えている本ノードを押す（この間は必ず力学の途中）
  const during = await page.evaluate(() => {
    window.__mount();
    const D = GraphView._debug, G = GRAMMAR_GRAPH;
    const book = G.kinds.indexOf('book');
    let b = -1;
    for (let i = 0; i < G.id.length; i++) if (G.kind[i] === book) { b = i; break; }
    const [x, y] = D.screenOf(b);
    const cv = document.querySelector('#host canvas');
    const ev = type => cv.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const hit = D.hitAt(x, y);
    ev('pointerdown'); ev('pointerup');
    const s = document.querySelector('#host .graph-sheet');
    return { settled: D.settled, hit, b, opened: !!s && !s.hidden, lastTap: D.lastTap };
  });
  assert.equal(during.settled, false, '力学の途中で押せていない');
  assert.equal(during.hit, during.b, '本ノードに当たっていない（ガードなしなら開くはずの位置）');
  assert.equal(during.opened, false, '力学の途中でシートが開いた');
  assert.equal(during.lastTap, -1);
  await settled(page);
  // 収まった後は、同じノードの新しい位置で開く
  const [bx, by] = await page.evaluate(i => GraphView._debug.screenOf(i), during.b);
  await page.mouse.click(bx, by);
  assert.equal(await sheetOpen(page), true, '収まった後にタップしてもシートが開かない');
  assert.equal(await page.evaluate(() => GraphView._debug.lastTap), during.b);
  // 苦手の問題は近景でしか描かれない。新しい位置に寄ってから当たることも確かめる
  await page.evaluate(i => GraphView._debug.focus(i, 10), picked[0]);
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), picked[0]);
  assert.equal(await page.evaluate(([x, y]) => GraphView._debug.hitAt(x, y), [x, y]), picked[0], '苦手の問題が新しい位置で当たらない');
});

test('力学: 苦手が 300 問以上でも収まり、座標はすべて有限', async t => {
  const page = await open(t);
  await seedWeak(page, 320);
  await page.evaluate(() => window.__mount());
  await settled(page);
  const ok = await page.evaluate(() => {
    const D = GraphView._debug;
    for (let i = 0; i < GRAMMAR_GRAPH.id.length; i++) { const p = D.worldOf(i); if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false; }
    return true;
  });
  assert.equal(ok, true);
  console.log('# 力学（苦手 320 問、375×812）', await page.evaluate(() => ({ ms: Math.round(GraphView._debug.settleMs), maxFrameMs: Math.round(GraphView._debug.settleMaxFrameMs) })));
});

test('力学: 途中で destroy しても、rAF もリスナーも残らず例外も出ない', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  await page.evaluate(() => { window.__mount(); GraphView.destroy(); window.__cnt.raf = 0; });
  await new Promise(r => setTimeout(r, 500));
  const r = await page.evaluate(() => ({ raf: window.__cnt.raf, listeners: GraphView._debug.listeners, canvases: document.querySelectorAll('canvas').length }));
  assert.deepEqual(r, { raf: 0, listeners: 0, canvases: 0 });
});

test('力学: d3 がなくても固定配置で開く（settled は最初から true、1 回だけ描く）', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  await page.evaluate(() => { window.d3 = undefined; window.__cnt.raf = 0; window.__mount(); });
  await waitFor(page, () => GraphView._debug.frames >= 1);
  await new Promise(r => setTimeout(r, 400));
  const r = await page.evaluate(() => ({ settled: GraphView._debug.settled, ticks: GraphView._debug.settleTicks, frames: GraphView._debug.frames, raf: window.__cnt.raf }));
  assert.deepEqual(r, { settled: true, ticks: 0, frames: 1, raf: 1 });
});

test('力学: 「視差効果を減らす」では途中を描かず、完成形だけ描く', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.addInitScript(COUNT_SCRIPT);
  await page.goto(base + '/__graph_test.html');
  await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  await new Promise(r => setTimeout(r, 300));
  const frames = await page.evaluate(() => GraphView._debug.frames);
  assert.ok(frames <= 2, `途中のフレームを描いている: ${frames}`);
});

test('力学: 「配置し直す」でもう一度回り、収まると止まる', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  await page.locator('#host button[data-zoom="relayout"]').click();
  assert.equal(await page.evaluate(() => GraphView._debug.settled), false);
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), 120);
});

test('束ねた線: 記録が空でも、全体表示で章と概念・ひっかけの間に線が出る', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const d = await page.evaluate(() => ({ lod: GraphView._debug.lod, bundles: GraphView._debug.lastDrawnBundles }));
  assert.equal(d.lod, 0);
  assert.ok(d.bundles >= 50, `束ねた線が少ない: ${d.bundles}`);
  assert.ok(d.bundles <= 248, `章の束の総数（248）を超えている: ${d.bundles}`);
});

test('束ねた線: 近景では描かず、問題ごとの線になる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const f = await frames(page);
  await page.evaluate(() => GraphView._debug.focus(null, 9));
  await nextFrame(page, f);
  assert.equal(await page.evaluate(() => GraphView._debug.lod), 2);
  assert.equal(await page.evaluate(() => GraphView._debug.lastDrawnBundles), 0);
});

test('苦手の量: 苦手の問題は全体表示でも描かれ、苦手のある概念は大きく、苦手のない概念は基準のまま', async t => {
  const page = await open(t);
  const picked = await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  await new Promise(r => setTimeout(r, 200));
  const d = await page.evaluate(picked => ({
    lod: GraphView._debug.lod,
    questions: GraphView._debug.drawnKinds[5],
    visible: picked.filter(i => GraphView._debug.isVisible(i)).length,
  }), picked);
  assert.equal(d.lod, 0);
  assert.equal(d.visible, 40, '苦手の問題が全体表示で隠れている');
  assert.ok(d.questions >= 1 && d.questions <= 40);
  // 苦手の問題につながる概念・ひっかけ（edges の type 1・2）と、つながらないもの
  const r = await page.evaluate(picked => {
    const G = GRAMMAR_GRAPH, D = GraphView._debug, E = G.edges, set = new Set(picked), hubs = new Set();
    for (let k = 0; k + 2 < E.length; k += 3) if ((E[k + 2] === 1 || E[k + 2] === 2) && set.has(E[k])) hubs.add(E[k + 1]);
    const touched = [...hubs].map(i => D.radiusOf(i));
    const untouched = [];
    for (let i = 0; i < G.id.length; i++) {
      const k = G.kinds[G.kind[i]];
      if ((k === 'concept' || k === 'trap') && !hubs.has(i)) untouched.push(D.radiusOf(i));
    }
    return { touched, untouched };
  }, picked);
  assert.ok(r.touched.length >= 1, '苦手の問題がつながる概念・ひっかけがない');
  assert.ok(r.touched.every(v => v > 6.5), `苦手のある概念・ひっかけが基準の大きさのまま: ${r.touched}`);
  assert.ok(r.untouched.length >= 1, '苦手のつながらない概念・ひっかけがない');
  assert.ok(r.untouched.every(v => Math.abs(v - 6.5) < 1e-6), `苦手のない概念・ひっかけの大きさが変わっている: ${r.untouched}`);
});

test('凡例が出ている', async t => {
  const page = await open(t);
  await mountAndWait(page);
  assert.match(await page.locator('#host .graph-legend').innerText(), /苦手/);
});

test('記録が空（{}）や壊れた記録でも例外なく、描いたノードはすべて灰色', async t => {
  const page = await open(t);
  await page.evaluate(() => { window.__stats = { 1: null, 2: 'x', 3: { a: 'NaN' } }; window.__weak = {}; });
  await mountAndWait(page);
  const r = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, out = [];
    for (let i = 0; i < G.id.length && out.length < 12; i++) {
      if (G.kind[i] !== 1 && G.kind[i] !== 3) continue;
      const [x, y] = GraphView._debug.screenOf(i);
      if (x < 5 || y < 60 || x > innerWidth - 5 || y > innerHeight - 5) continue;
      out.push({ i, px: window.__px(x, y) });
    }
    return { out, drawn: GraphView._debug.lastDrawnNodes, ms: GraphView._debug.lastFrameMs };
  });
  assert.ok(r.out.length >= 6);
  for (const o of r.out) assert.ok(isGrey(o.px), `ノード ${o.i} が灰色でない: ${o.px}`);
  assert.ok(r.drawn > 0);
  assert.ok(Number.isFinite(r.ms));
});

test('ドラッグ 1 回の移動でパンし 1 回だけ描く。6px を超えて動かした指を離してもシートは開かない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  // ノードの真上から始めてドラッグする
  const ci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), ci);
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  const f0 = await frames(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 10);
  await page.mouse.up();
  await nextFrame(page, f0);
  await new Promise(r => setTimeout(r, 150));
  const cam1 = await page.evaluate(() => GraphView._debug.camera());
  assert.equal(await frames(page), f0 + 1);
  assert.ok(Math.abs(cam1.x - cam0.x - 40) < 0.01 && Math.abs(cam1.y - cam0.y - 10) < 0.01, JSON.stringify([cam0, cam1]));
  assert.equal(await sheetOpen(page), false);
  // 7px だけ動かしてもタップではない
  await page.mouse.move(x + 40, y + 10);
  await page.mouse.down();
  await page.mouse.move(x + 47, y + 10);
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await sheetOpen(page), false);
});

test('ホイールでズームすると LOD が上がり、近景で問題が描かれる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const d0 = await page.evaluate(() => ({ lod: GraphView._debug.lod, kinds: GraphView._debug.drawnKinds.slice() }));
  assert.equal(d0.lod, 0);
  assert.equal(d0.kinds[2], 0, '遠景でルールを描いた');
  assert.equal(d0.kinds[5], 0, '遠景で問題を描いた');
  const seen = new Set([0]);
  // 問題 q:1 の上でズームする（画面の中央は空き地のことがある）
  const [qx, qy] = await page.evaluate(() => GraphView._debug.screenOf('q:1'));
  await page.mouse.move(qx, qy);
  for (let k = 0; k < 40 && !seen.has(2); k++) {
    const f = await frames(page);
    await page.mouse.wheel(0, -120);
    await nextFrame(page, f);
    seen.add(await page.evaluate(() => GraphView._debug.lod));
  }
  assert.ok(seen.has(1), '中景を通らなかった');
  assert.ok(seen.has(2), '近景にならなかった');
  const kinds = await page.evaluate(() => GraphView._debug.drawnKinds.slice());
  assert.ok(kinds[5] > 0, '近景で問題が描かれていない');
  // ズームの上限で止まる
  const rel = await page.evaluate(() => { const c = GraphView._debug.camera(); return c.scale / c.fitScale; });
  assert.ok(rel <= 14.0001);
});

test('ピンチ（2 本指の Pointer Events）でズームし、シートは開かない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const c0 = await page.evaluate(() => GraphView._debug.camera());
  const f0 = await frames(page);
  await page.evaluate(() => {
    const cv = document.querySelector('#host canvas');
    const r = cv.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
    }));
    ev('pointerdown', 11, cx - 30, cy);
    ev('pointerdown', 12, cx + 30, cy);
    for (let k = 1; k <= 6; k++) { ev('pointermove', 11, cx - 30 - k * 10, cy); ev('pointermove', 12, cx + 30 + k * 10, cy); }
    ev('pointerup', 11, cx - 90, cy);
    ev('pointerup', 12, cx + 90, cy);
  });
  await nextFrame(page, f0);
  const c1 = await page.evaluate(() => GraphView._debug.camera());
  const ratio = c1.scale / c0.scale;
  assert.ok(Math.abs(ratio - 3) < 0.01, 'ピンチの倍率: ' + ratio);
  assert.equal(await sheetOpen(page), false);
});

test('ノードをタップするとシートが開く（概念は desc、Trap は advice、問題一覧）。Esc・何もない場所のタップ・閉じるボタンで閉じる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const ci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
  let [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), ci);
  await page.mouse.click(x, y);
  await waitFor(page, () => { const s = document.querySelector('#host .graph-sheet'); return s && !s.hidden; });
  let r = await page.evaluate(() => {
    const s = document.querySelector('#host .graph-sheet');
    return { text: s.textContent, html: s.innerHTML, items: s.querySelectorAll('.graph-q').length, tap: GraphView._debug.lastTap };
  });
  assert.equal(r.tap, ci);
  assert.ok(r.text.includes('SVOC'), r.text.slice(0, 200));
  assert.ok(r.text.includes('英語は『配置の言語』'), '概念の desc が出ていない');
  assert.ok(!r.text.includes('**'), 'Markdown の ** がそのまま出ている');
  assert.ok(r.items > 0, '問題一覧が空');
  await page.keyboard.press('Escape');
  assert.equal(await sheetOpen(page), false);

  // Trap は advice
  const ti = await page.evaluate(() => GRAMMAR_GRAPH.kind.indexOf(4));
  [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), ti);
  await page.mouse.click(x, y);
  await waitFor(page, () => { const s = document.querySelector('#host .graph-sheet'); return s && !s.hidden; });
  r = await page.evaluate(() => ({ text: document.querySelector('#host .graph-sheet').textContent, tap: GraphView._debug.lastTap }));
  assert.equal(r.tap, ti);
  const advice = await page.evaluate(i => GRAMMAR_GRAPH.text[i].advice, ti);
  assert.ok(r.text.includes(advice.slice(0, 20)), 'Trap の advice が出ていない');
  // 外側（Canvas の何もない場所）をタップすると閉じる
  const blank = await emptyPoint(page);
  await page.mouse.click(blank[0], blank[1]);
  assert.equal(await sheetOpen(page), false);
  // 閉じるボタン
  await page.mouse.click(x, y);
  await waitFor(page, () => { const s = document.querySelector('#host .graph-sheet'); return s && !s.hidden; });
  await page.click('#host .graph-sheet-close');
  assert.equal(await sheetOpen(page), false);
});

test('何もない場所のタップではシートが開かない。重なったら中心が近い方、隠れたノードは当たらない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  // 何もない場所（当たり判定が -1 の点）を探してタップ
  const empty = await page.evaluate(() => {
    const c = document.querySelector('#host canvas').getBoundingClientRect();
    for (let y = c.top + 10; y < c.bottom; y += 10) for (let x = c.left + 10; x < c.right; x += 10) if (GraphView._debug.hitAt(x, y) === -1) return [x, y];
    return null;
  });
  assert.ok(empty);
  await page.mouse.click(empty[0], empty[1]);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(await sheetOpen(page), false);

  // 重なり: 近景で、互いに近い 2 つの描画中ノードの間の、片方寄りの点をタップする
  await page.evaluate(() => GraphView._debug.focus('q:1', 10));
  await waitFor(page, () => GraphView._debug.lod === 2);
  await new Promise(r => setTimeout(r, 50));
  const pair = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, d = GraphView._debug, vis = [];
    const c = document.querySelector('#host canvas').getBoundingClientRect();
    for (let i = 0; i < G.id.length; i++) {
      if (!d.isVisible(i)) continue;
      const [x, y] = d.screenOf(i);
      if (x > c.left + 30 && x < c.right - 30 && y > c.top + 30 && y < c.bottom - 30) vis.push([i, x, y]);
    }
    let best = null;
    for (let a = 0; a < vis.length; a++) for (let b = a + 1; b < vis.length; b++) {
      const dist = Math.hypot(vis[a][1] - vis[b][1], vis[a][2] - vis[b][2]);
      if (dist > 4 && dist < 22 && (!best || dist < best.dist)) best = { a: vis[a], b: vis[b], dist };
    }
    return best;
  });
  assert.ok(pair, '近いノードの組が見つからない');
  const px = pair.a[1] + (pair.b[1] - pair.a[1]) * 0.3, py = pair.a[2] + (pair.b[2] - pair.a[2]) * 0.3;
  await page.mouse.click(px, py);
  await waitFor(page, () => { const s = document.querySelector('#host .graph-sheet'); return s && !s.hidden; });
  assert.equal(await page.evaluate(() => GraphView._debug.lastTap), pair.a[0]);
  await page.keyboard.press('Escape');

  // LOD で隠れたノード: 全体表示に戻し、ルールの真上をタップしてもそのルールは開かない
  await page.evaluate(() => GraphView._debug.focus(null, 1));
  await waitFor(page, () => GraphView._debug.lod === 0);
  const rule = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, d = GraphView._debug;
    const c = document.querySelector('#host canvas').getBoundingClientRect();
    for (let i = 0; i < G.id.length; i++) {
      if (G.kind[i] !== 2) continue;
      const [x, y] = d.screenOf(i);
      if (x > c.left + 20 && x < c.right - 20 && y > c.top + 20 && y < c.bottom - 20) return { i, x, y };
    }
    return null;
  });
  assert.equal(await page.evaluate(r => GraphView._debug.hitAt(r.x, r.y) === r.i, rule), false);
  await page.mouse.click(rule.x, rule.y);
  await new Promise(r => setTimeout(r, 80));
  const tapped = await page.evaluate(() => GraphView._debug.lastTap);
  assert.notEqual(tapped, rule.i);
  if (await sheetOpen(page)) {
    assert.equal(await page.evaluate(i => GraphView._debug.isVisible(i), tapped), true);
    await page.keyboard.press('Escape');
  }

  // 本の絞り込みで隠れたノード: 「金」にして、世界一の章の真上をタップしても開かない
  await page.click('#host .graph-chip[data-book="kin"]');
  await waitFor(page, () => GraphView._debug.book === 'kin');
  const sek = await page.evaluate(() => {
    const i = GraphView._debug.indexOf('ch:sekai:1');
    const [x, y] = GraphView._debug.screenOf(i);
    return { i, x, y, vis: GraphView._debug.isVisible(i) };
  });
  assert.equal(sek.vis, false);
  await page.evaluate(() => { GraphView._debug.lastTap = -1; });
  await page.mouse.click(sek.x, sek.y);
  await new Promise(r => setTimeout(r, 80));
  assert.notEqual(await page.evaluate(() => GraphView._debug.lastTap), sek.i);
});

test('絞り込み（本・苦手のみ）で描くノード数が変わり、aria-pressed が付く', async t => {
  const page = await open(t);
  const pick = await pickLinkedQuestion(page);
  await page.evaluate(p => {
    window.__stats = { [p.qid]: { a: 2, c: 0 } };
    window.__weak = { [p.qid]: { streak: 0, due: Date.now() + 86400000 } };
  }, pick);
  await mountAndWait(page);
  await settled(page); // 苦手があるので開いたとき力学が回る。絞り込みの確認は収まってから
  const all = await page.evaluate(() => GraphView._debug.lastDrawnNodes);
  let f = await frames(page);
  await page.click('#host .graph-chip[data-book="kin"]');
  await nextFrame(page, f);
  const kin = await page.evaluate(() => ({
    n: GraphView._debug.lastDrawnNodes,
    pressed: [...document.querySelectorAll('#host .graph-chip[data-book]')].map(b => b.dataset.book + ':' + b.getAttribute('aria-pressed')),
  }));
  assert.ok(kin.n > 0 && kin.n < all, `all=${all} kin=${kin.n}`);
  assert.ok(kin.pressed.includes('kin:true') && kin.pressed.includes('all:false'), kin.pressed.join());
  f = await frames(page);
  await page.click('#host .graph-chip[data-book="all"]');
  await nextFrame(page, f);
  assert.equal(await page.evaluate(() => GraphView._debug.lastDrawnNodes), all);
  f = await frames(page);
  await page.click('#host .graph-weak-toggle');
  await nextFrame(page, f);
  const weak = await page.evaluate(() => ({ n: GraphView._debug.lastDrawnNodes, p: document.querySelector('#host .graph-weak-toggle').getAttribute('aria-pressed') }));
  assert.equal(weak.p, 'true');
  // 遠景の苦手のみ: その問題につながる 本・章・概念・Trap（ルールと問題は遠景では描かない）
  assert.ok(weak.n >= 3 && weak.n < 10, 'weakOnly n=' + weak.n);
});

test('refresh() は記録を読み直して色を変え、再描画を 1 回だけ要求する', async t => {
  const page = await open(t);
  const pick = await pickLinkedQuestion(page);
  await mountAndWait(page);
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), pick.concept);
  assert.ok(isGrey(await page.evaluate(([x, y]) => window.__px(x, y), [x, y])));
  await page.evaluate(p => {
    window.__stats = { [p.qid]: { a: 2, c: 0 } };
    window.__weak = { [p.qid]: { streak: 0, due: Date.now() + 86400000 } };
    window.__cnt.raf = 0;
    GraphView.refresh(); GraphView.refresh();
  }, pick);
  await waitFor(page, () => GraphView._debug.frames === 2);
  assert.equal(await page.evaluate(() => window.__cnt.raf), 1);
  assert.ok(isRed(await page.evaluate(([x, y]) => window.__px(x, y), [x, y])));
});

test('destroy: canvas・シート・リスナーが消え、2 回呼んでも落ちない。mount/destroy を 5 回繰り返してもリスナーは増えない', async t => {
  const page = await open(t);
  const r = await page.evaluate(async () => {
    const host = document.getElementById('host');
    const counts = [];
    for (let k = 0; k < 5; k++) {
      window.__mount();
      counts.push(GraphView._debug.listeners);
      GraphView.destroy();
      counts.push(GraphView._debug.listeners);
    }
    GraphView.destroy();
    // mount 中にもう一度 mount すると、前のものを壊してから作る
    window.__mount();
    window.__mount();
    const twice = { canvases: document.querySelectorAll('canvas').length, listeners: GraphView._debug.listeners };
    GraphView.destroy();
    return { counts, twice, children: host.children.length, canvases: document.querySelectorAll('canvas').length, pending: GraphView._debug.pending, listeners: GraphView._debug.listeners };
  });
  const mounted = r.counts.filter((_, i) => i % 2 === 0), destroyed = r.counts.filter((_, i) => i % 2 === 1);
  assert.ok(mounted.every(n => n === mounted[0] && n > 0), r.counts.join());
  assert.ok(destroyed.every(n => n === 0), r.counts.join());
  assert.equal(r.twice.canvases, 1);
  assert.equal(r.twice.listeners, mounted[0]);
  assert.equal(r.children, 0);
  assert.equal(r.canvases, 0);
  assert.equal(r.pending, false);
  assert.equal(r.listeners, 0);
});

test('入力の直後（描画の保留中）に destroy しても、そのフレームは描かれない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const f = await frames(page);
  const pending = await page.evaluate(() => {
    const cv = document.querySelector('#host canvas');
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 100, clientY: 300, bubbles: true, cancelable: true }));
    const p = GraphView._debug.pending;
    GraphView.destroy();
    return { p, after: GraphView._debug.pending };
  });
  assert.equal(pending.p, true);
  assert.equal(pending.after, false);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(await frames(page), f);
});

const setHidden = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

async function hiddenCase(t) {
  const page = await open(t);
  await mountAndWait(page);
  const f = await frames(page);
  const r = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__cnt.raf = 0;
    const cv = document.querySelector('#host canvas');
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 100, clientY: 300, bubbles: true, cancelable: true }));
    GraphView.refresh();
    return { raf: window.__cnt.raf, pending: GraphView._debug.pending };
  });
  assert.deepEqual(r, { raf: 0, pending: false });
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await frames(page), f);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await nextFrame(page, f);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await frames(page), f + 1);
  assert.equal(await page.evaluate(() => window.__cnt.raf), 1);
}
test('document.hidden のあいだは rAF を要求せず、見えるようになったら 1 回描く', hiddenCase);

test('document.hidden のあいだは力学も進まず、見えるようになったら最後まで進んで収まる', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  // マウントと同じ同期の中で隠す（最初のフレームの前）。保留中の rAF は取り消され、力学は 1 tick も進まない
  const r = await page.evaluate(() => {
    window.__mount();
    window.__cnt.raf = 0;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return { pending: GraphView._debug.pending, settled: GraphView._debug.settled };
  });
  assert.deepEqual(r, { pending: false, settled: false });
  await new Promise(r => setTimeout(r, 200));
  const hidden = await page.evaluate(() => ({ raf: window.__cnt.raf, ticks: GraphView._debug.settleTicks, frames: GraphView._debug.frames, settled: GraphView._debug.settled }));
  assert.deepEqual(hidden, { raf: 0, ticks: 0, frames: 0, settled: false });
  await setHidden(page, false);
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), 120);
});

test('テーマ（data-theme・端末のダークモード）を切り替えると色を読み直す', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const corner = [5, await page.evaluate(() => innerHeight - 5)];
  const bg0 = await page.evaluate(([x, y]) => window.__px(x, y), corner);
  let f = await frames(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'duolingo'));
  await nextFrame(page, f);
  const bg1 = await page.evaluate(([x, y]) => window.__px(x, y), corner);
  assert.notDeepEqual(bg1, bg0);
  assert.ok(bg1[0] + bg1[1] + bg1[2] < bg0[0] + bg0[1] + bg0[2], `ダークで背景が暗くならない ${bg0} -> ${bg1}`);
  // 端末のダークモード（data-theme なし）
  f = await frames(page);
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await nextFrame(page, f);
  assert.deepEqual(await page.evaluate(([x, y]) => window.__px(x, y), corner), bg0);
  f = await frames(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await nextFrame(page, f);
  const bg2 = await page.evaluate(([x, y]) => window.__px(x, y), corner);
  assert.ok(bg2[0] + bg2[1] + bg2[2] < bg0[0] + bg0[1] + bg0[2], `端末のダークで背景が暗くならない ${bg0} -> ${bg2}`);
});

test('XSS: 問題文やルール名に HTML が入っていても実行も挿入もされない', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const bad = '<img src=x onerror="window.__xss=1"><b>x</b>';
    window.__getQ = () => ({ q: bad, rule: { title: bad } });
  });
  await mountAndWait(page);
  const ci = await page.evaluate(() => GraphView._debug.indexOf('ch:sekai:1'));
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), ci);
  await page.mouse.click(x, y);
  await waitFor(page, () => { const s = document.querySelector('#host .graph-sheet'); return s && !s.hidden; });
  await new Promise(r => setTimeout(r, 100));
  const r = await page.evaluate(() => {
    const s = document.querySelector('#host .graph-sheet');
    return { imgs: s.querySelectorAll('img, b').length, xss: window.__xss, text: s.textContent.includes('<img src=x') };
  });
  assert.deepEqual(r, { imgs: 0, xss: undefined, text: true });
});

test('性能: 全体表示の 1 フレームの描画時間（375×812・1280×800）、パン中に長いタスクがない', async t => {
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    await page.evaluate(() => {
      window.__long = [];
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch (e) { window.__long = null; }
    });
    await mountAndWait(page);
    // performance.now は 0.1ms に丸められ、Canvas の命令は遅れて実行されるので、40 回描いて getImageData で
    // 描画を確定させた合計を回数で割る
    const ms = await page.evaluate(() => {
      const c = document.querySelector('#host canvas').getContext('2d');
      const run = k => { const t = performance.now(); for (let j = 0; j < k; j++) GraphView._debug.forceDraw(); c.getImageData(0, 0, 1, 1); return (performance.now() - t) / k; };
      run(5);
      const a = [run(40), run(40), run(40)].sort((x, y) => x - y);
      return { median: a[1], max: a[2] };
    });
    // パンの連続
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.mouse.down();
    for (let k = 0; k < 30; k++) await page.mouse.move(vp.width / 2 + k * 5, vp.height / 2 + k * 3);
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 100));
    const long = await page.evaluate(() => window.__long);
    console.log(`  [perf] ${vp.width}x${vp.height} forced full-view frame median=${ms.median.toFixed(2)}ms max=${ms.max.toFixed(2)}ms longtasks=${JSON.stringify(long)}`);
    assert.ok(ms.median < 50, 'frame ' + ms.median);
    if (long) assert.equal(long.length, 0, 'long tasks: ' + long);
  }
});

test('性能（CPU 4 倍スロットル、記録用）', async t => {
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    await mountAndWait(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await page.evaluate(() => {
      const c = document.querySelector('#host canvas').getContext('2d');
      const run = () => { const t = performance.now(); for (let j = 0; j < 20; j++) GraphView._debug.forceDraw(); c.getImageData(0, 0, 1, 1); return (performance.now() - t) / 20; };
      const full = run();
      GraphView._debug.focus('q:1', 3);
      const mid = run();
      GraphView._debug.focus('q:1', 7);
      const near = run();
      return { full, mid, near };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log(`  [perf 4x] ${vp.width}x${vp.height} full=${r.full.toFixed(2)}ms mid=${r.mid.toFixed(2)}ms near=${r.near.toFixed(2)}ms`);
    assert.ok(r.full < 200);
  }
});

test('性能: 力学（CPU 4 倍スロットル、記録用。苦手 110 問 = 全体の約 1/9）', async t => {
  const out = {};
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await seedWeak(page, 110);
    await page.evaluate(() => window.__mount());
    await settled(page);
    out[vp.width] = await page.evaluate(() => ({
      settleMs: Math.round(GraphView._debug.settleMs),
      maxFrameMs: Math.round(GraphView._debug.settleMaxFrameMs),
      ticks: GraphView._debug.settleTicks,
      drawMs: Math.round(GraphView._debug.forceDraw() * 10) / 10,
    }));
    assert.equal(out[vp.width].ticks, 120);
    assert.ok(out[vp.width].settleMs < 8000, `収まるまでが長すぎる: ${out[vp.width].settleMs}ms`);
  }
  console.log('# 力学（CPU 4 倍）', JSON.stringify(out));
});

// アプリの本物のテーマの一覧と、暗い / 明るいの分類（css/app.css の --bg-page で決めた）。
// テーマを足したら、ここと css/graph.css の両方を直す（下のテストで CSS の一覧と照合するので、足し忘れると落ちる）
const APP_THEMES = { ink: 'dark', duolingo: 'dark', navy: 'dark', forest: 'dark', nordic: 'dark', quizlet: 'dark', light: 'light', ios: 'light' };
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

test('アプリの全テーマで、グラフの背景が暗いテーマでは暗く、明るいテーマでは明るい（本物の app.css・theme-ios.css）', async t => {
  const found = new Set();
  for (const f of ['css/app.css', 'css/theme-ios.css']) {
    for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/\[data-theme="([^"]+)"\]/g)) found.add(m[1]);
  }
  assert.deepEqual([...found].sort(), Object.keys(APP_THEMES).sort(), 'CSS のテーマ一覧とテストの一覧が食い違う');
  const page = await open(t, { path: '/__graph_theme_test.html' });
  await mountAndWait(page);
  const corner = [5, await page.evaluate(() => innerHeight - 5)];
  const results = {};
  for (const [id, kind] of Object.entries(APP_THEMES)) {
    const f = await frames(page);
    await page.evaluate(id => document.documentElement.setAttribute('data-theme', id), id);
    await nextFrame(page, f); // MutationObserver -> 色の読み直し -> 1 回描く
    const px = await page.evaluate(([x, y]) => window.__px(x, y), corner);
    results[id] = lum(px).toFixed(2);
    if (kind === 'dark') assert.ok(lum(px) < 0.25, `${id} は暗いはず: ${px}`);
    else assert.ok(lum(px) > 0.6, `${id} は明るいはず: ${px}`);
  }
  // ios は端末の設定に従う
  const f = await frames(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await nextFrame(page, f);
  const px = await page.evaluate(([x, y]) => window.__px(x, y), corner);
  assert.ok(lum(px) < 0.25, `ios（端末ダーク）は暗いはず: ${px}`);
  console.log('  [themes] luminance ' + JSON.stringify(results) + ' ios-dark=' + lum(px).toFixed(2));
});

// addEventListener / removeEventListener とオブザーバーを、ビューとは別に数える（Review Focus 3）
const SPY_SCRIPT = `
  window.__spy = { on: false, list: [], obs: new Set() };
  (function () {
    var add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
    var cap = function (o) { return typeof o === 'boolean' ? o : !!(o && o.capture); };
    EventTarget.prototype.addEventListener = function (type, fn, o) {
      var S = window.__spy, self = this, c = cap(o);
      if (S.on && !S.list.some(function (e) { return e.t === self && e.type === type && e.fn === fn && e.cap === c; })) S.list.push({ t: self, type: type, fn: fn, cap: c });
      return add.call(this, type, fn, o);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, o) {
      var S = window.__spy, self = this, c = cap(o);
      if (S.on) S.list = S.list.filter(function (e) { return !(e.t === self && e.type === type && e.fn === fn && e.cap === c); });
      return rem.call(this, type, fn, o);
    };
    ['MutationObserver', 'ResizeObserver'].forEach(function (name) {
      var Base = window[name];
      window[name] = class extends Base {
        observe() { if (window.__spy.on) window.__spy.obs.add(this); return super.observe.apply(this, arguments); }
        disconnect() { window.__spy.obs.delete(this); return super.disconnect(); }
      };
    });
  })();
`;

test('リスナーとオブザーバーを別に数えても、destroy ですべて外れ、_debug.listeners と一致する', async t => {
  const page = await open(t, { init: SPY_SCRIPT });
  const r = await page.evaluate(() => {
    const S = window.__spy;
    S.on = true;
    window.__mount();
    const mounted = { spy: S.list.length + S.obs.size, debug: GraphView._debug.listeners, types: S.list.map(e => e.type).sort(), obs: S.obs.size };
    GraphView.destroy();
    const after = { list: S.list.map(e => e.type), obs: S.obs.size, debug: GraphView._debug.listeners };
    S.on = false;
    return { mounted, after };
  });
  assert.equal(r.mounted.debug, r.mounted.spy, JSON.stringify(r.mounted));
  assert.equal(r.mounted.obs, 2, 'MutationObserver と ResizeObserver');
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'visibilitychange', 'change', 'click']) {
    assert.ok(r.mounted.types.includes(type), 'リスナーがない: ' + type);
  }
  assert.deepEqual(r.after, { list: [], obs: 0, debug: 0 });
});

test('mount の途中で失敗しても（getContext が null・壊れたグラフ）、リスナーも DOM も残さず例外を投げ直す', async t => {
  const page = await open(t, { init: SPY_SCRIPT });
  const r = await page.evaluate(() => {
    const S = window.__spy, host = document.getElementById('host'), out = {};
    const check = () => ({ debug: GraphView._debug.listeners, spy: S.list.length + S.obs.size, children: host.children.length, pending: GraphView._debug.pending });
    S.on = true;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => null;
    try { window.__mount(); out.ctxThrew = false; } catch (e) { out.ctxThrew = true; }
    HTMLCanvasElement.prototype.getContext = orig;
    out.afterCtx = check();
    const deps = window.__deps();
    deps.graph = Object.assign({}, GRAMMAR_GRAPH, { qids: undefined });
    try { GraphView.mount(host, deps); out.graphThrew = false; } catch (e) { out.graphThrew = true; }
    out.afterGraph = check();
    // isDue が例外を出しても computeMastery が握りつぶすので、mount は成功する
    const deps2 = window.__deps();
    window.__weak = { 1: { due: 0 } };
    deps2.isDue = () => { throw new Error('boom'); };
    GraphView.mount(host, deps2);
    out.isDueMounted = { canvases: host.querySelectorAll('canvas').length, listeners: GraphView._debug.listeners > 0 };
    GraphView.destroy();
    out.final = check();
    S.on = false;
    return out;
  });
  const clean = { debug: 0, spy: 0, children: 0, pending: false };
  assert.equal(r.ctxThrew, true);
  assert.deepEqual(r.afterCtx, clean);
  assert.equal(r.graphThrew, true);
  assert.deepEqual(r.afterGraph, clean);
  assert.deepEqual(r.isDueMounted, { canvases: 1, listeners: true });
  assert.deepEqual(r.final, clean);
  // 失敗の後でも普通に mount できる
  await mountAndWait(page);
});

test('ピンチの片方の指を離して残りの指を動かすと、カメラは飛ばずにパンし、タップにもならない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const r = await page.evaluate(() => {
    const cv = document.querySelector('#host canvas');
    const rc = cv.getBoundingClientRect();
    const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
    }));
    const cam = () => GraphView._debug.camera();
    ev('pointerdown', 11, cx - 30, cy);
    ev('pointerdown', 12, cx + 30, cy);
    ev('pointermove', 11, cx - 60, cy);
    ev('pointermove', 12, cx + 60, cy);
    ev('pointerup', 11, cx - 60, cy);
    const c1 = cam();
    ev('pointermove', 12, cx + 65, cy + 3);
    const c2 = cam();
    ev('pointermove', 12, cx + 66, cy + 3); // 合計の移動は小さいが、ピンチの後なのでタップにはしない
    ev('pointerup', 12, cx + 66, cy + 3);
    const c3 = cam();
    const s = document.querySelector('#host .graph-sheet');
    return { c1, c2, c3, open: !s.hidden, tap: GraphView._debug.lastTap };
  });
  assert.ok(Math.abs(r.c2.x - r.c1.x - 5) < 1e-6 && Math.abs(r.c2.y - r.c1.y - 3) < 1e-6, '離した直後の移動が飛んだ: ' + JSON.stringify(r));
  assert.equal(r.c2.scale, r.c1.scale);
  assert.ok(Math.abs(r.c3.x - r.c2.x - 1) < 1e-6);
  assert.equal(r.open, false);
  assert.equal(r.tap, -1);
});

test('開いているシートのノードが refresh で無効になったら、シートを閉じる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const ci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), ci);
  await page.mouse.click(x, y);
  await waitFor(page, () => { const s = document.querySelector('#host .graph-sheet'); return s && !s.hidden; });
  // 記録が変わっただけなら開いたまま
  await page.evaluate(() => GraphView.refresh());
  assert.equal(await sheetOpen(page), true);
  await page.evaluate(() => {
    const orig = StudyCore.buildDetail;
    StudyCore.buildDetail = () => null;
    try { GraphView.refresh(); } finally { StudyCore.buildDetail = orig; }
  });
  assert.equal(await sheetOpen(page), false);
});

test('シートを開いた直後の互換 click（pointer イベントのない click）では閉じない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const [x, y] = await page.evaluate(() => GraphView._debug.screenOf(GRAMMAR_GRAPH.id.findIndex(s => s.startsWith('con:'))));
  await page.mouse.click(x, y);
  assert.equal(await sheetOpen(page), true);
  await page.evaluate(() => document.querySelector('#host canvas').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })));
  assert.equal(await sheetOpen(page), true);
});

// Canvas の中で、何のノードにも帯にも当たらない点（hitAt が -1）
const emptyPoint = page => page.evaluate(() => {
  const c = document.querySelector('#host canvas').getBoundingClientRect();
  for (let y = c.top + 120; y < c.bottom - 20; y += 10) for (let x = c.left + 4; x < c.right - 4; x += 10) if (GraphView._debug.hitAt(x, y) === -1) return [x, y];
  return null;
});
const firstOf = (page, prefix) => page.evaluate(p => GRAMMAR_GRAPH.id.findIndex(s => s.startsWith(p)), prefix);
async function tapNode(page, i) {
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), i);
  await page.mouse.click(x, y);
}

test('周辺: 概念をタップすると、配下の問題が全体表示でも出て、ほかのノードは薄くなる。何もない場所のタップで戻る', async t => {
  const page = await open(t, { viewport: { width: 1280, height: 800 } });
  await mountAndWait(page);
  const con = await firstOf(page, 'con:');
  const before = await page.evaluate(() => GraphView._debug.drawnKinds[5]);
  assert.equal(before, 0, '記録が空なら、全体表示に問題は出ない');
  const f = await frames(page);
  await tapNode(page, con);
  await nextFrame(page, f);
  const d = await page.evaluate(() => ({ node: GraphView._debug.focusNode, count: GraphView._debug.focusCount, questions: GraphView._debug.drawnKinds[5], lod: GraphView._debug.lod }));
  assert.equal(d.node, con);
  assert.equal(d.lod, 0);
  assert.ok(d.questions > 0, '配下の問題が出ていない');
  assert.ok(d.count > d.questions, '概念と章も含まれるはず');
  // つながらない本のノードは、背景に近い色になる（薄い）
  const other = await page.evaluate(con => {
    const G = GRAMMAR_GRAPH, D = GraphView._debug;
    for (let i = 0; i < G.id.length; i++) if (G.kinds[G.kind[i]] === 'book' && !D.isFocused(i)) return i;
    return -1;
  }, con);
  assert.ok(other >= 0);
  const [ox, oy] = await page.evaluate(i => GraphView._debug.screenOf(i), other);
  const px = await page.evaluate(([x, y]) => window.__px(x, y), [ox, oy]);
  const blank = await emptyPoint(page);
  const bg = await page.evaluate(([x, y]) => window.__px(x, y), blank);
  assert.ok(Math.abs(px[0] - bg[0]) < 40 && Math.abs(px[1] - bg[1]) < 40 && Math.abs(px[2] - bg[2]) < 40, `薄くなっていない: ${px} / 背景 ${bg}`);
  // パンできる（覆いがない）
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  await page.mouse.move(blank[0], blank[1]); await page.mouse.down(); await page.mouse.move(blank[0] + 60, blank[1] + 40, { steps: 4 }); await page.mouse.up();
  const cam1 = await page.evaluate(() => GraphView._debug.camera());
  assert.notEqual(cam1.x, cam0.x, 'シートを開いたままパンできない');
  assert.equal(await sheetOpen(page), true, 'ドラッグでシートが閉じた');
  // 何もない場所のタップで閉じて、元に戻る
  const blank2 = await emptyPoint(page);
  await page.mouse.click(blank2[0], blank2[1]);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.evaluate(() => GraphView._debug.focusNode), -1);
});

test('周辺: 問題をタップすると、近い問題（最大 30 問）も浮かび上がる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const pick = await pickLinkedQuestion(page);
  let f = await frames(page);
  await page.evaluate(q => GraphView._debug.focus(q, 9), pick.q);
  await nextFrame(page, f);
  f = await frames(page);
  await tapNode(page, pick.q);
  await nextFrame(page, f);
  const d = await page.evaluate(p => ({
    node: GraphView._debug.focusNode,
    concept: GraphView._debug.isFocused(p.concept), trap: GraphView._debug.isFocused(p.trap),
    questions: GRAMMAR_GRAPH.id.filter((s, i) => s.startsWith('q:') && GraphView._debug.isFocused(i)).length,
  }), pick);
  assert.equal(d.node, pick.q);
  assert.equal(d.concept, true);
  assert.equal(d.trap, true);
  assert.ok(d.questions >= 2 && d.questions <= 31, `自分 + 近い問題（最大 30）: ${d.questions}`);
});

test('シート: 半分の高さで開き、「広げる」で広がる。問題をタップすると、その場所へ動いて選択が切り替わり、動き終わると止まる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const con = await firstOf(page, 'con:');
  await tapNode(page, con);
  const h0 = await page.evaluate(() => document.querySelector('#host .graph-sheet').getBoundingClientRect().height);
  assert.ok(h0 <= 812 * 0.45, `半分より高い: ${h0}`);
  await page.locator('#host .graph-sheet-expand').click();
  const h1 = await page.evaluate(() => document.querySelector('#host .graph-sheet').getBoundingClientRect().height);
  assert.ok(h1 > h0, '広がっていない');
  await page.locator('#host .graph-sheet-expand').click();
  const target = Number(await page.locator('#host .graph-q[data-node]').first().getAttribute('data-node'));
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  await page.locator('#host .graph-q[data-node]').first().click();
  await waitFor(page, () => GraphView._debug.animating === false && GraphView._debug.pending === false);
  const d = await page.evaluate(() => ({ node: GraphView._debug.focusNode, cam: GraphView._debug.camera() }));
  assert.equal(d.node, target, '選択が問題に切り替わっていない');
  assert.ok(d.cam.x !== cam0.x || d.cam.y !== cam0.y, '画面が動いていない');
  const [sx, sy] = await page.evaluate(i => GraphView._debug.screenOf(i), target);
  assert.ok(sx > 100 && sx < 275, `横の中央に来ていない: ${sx}`);
  assert.ok(sy > 60 && sy < 812 * 0.6, `シートに隠れている: ${sy}`);
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; });
  await new Promise(r => setTimeout(r, 900));
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 }, '動き終わった後も描き続けている');
});

test('シート: 「視差効果を減らす」では、アニメーションなしで切り替わる', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.addInitScript(COUNT_SCRIPT);
  await page.goto(base + '/__graph_test.html');
  await mountAndWait(page);
  await tapNode(page, await firstOf(page, 'con:'));
  await page.locator('#host .graph-q[data-node]').first().click();
  assert.equal(await page.evaluate(() => GraphView._debug.animating), false);
});

// 画面の縦位置（canvas の上端からの距離）で、タップできるノードを探す
const findTappable = (page, minFrac, maxFrac) => page.evaluate(([lo, hi]) => {
  const G = GRAMMAR_GRAPH, D = GraphView._debug, c = document.querySelector('#host canvas').getBoundingClientRect();
  for (let i = 0; i < G.id.length; i++) {
    if (G.kinds[G.kind[i]] === 'question' || !D.isVisible(i)) continue;
    const p = D.screenOf(i);
    if (!p || p[0] < 40 || p[0] > c.width - 40) continue;
    const f = (p[1] - c.top) / c.height;
    if (f >= lo && f <= hi && D.hitAt(p[0], p[1]) === i) return i;
  }
  return -1;
}, [minFrac, maxFrac]);

test('シート: タップしたノードがシートに隠れるなら、倍率を変えずに上の見える範囲の中央へ動き、動き終わると止まる', async t => {
  const page = await open(t);
  await seedWeak(page, 110);
  await page.evaluate(() => window.__mount());
  await settled(page);
  const i = await findTappable(page, 0.56, 0.95);
  assert.ok(i >= 0, '下寄りのノードが見つからない');
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  await tapNode(page, i);
  await waitFor(page, () => GraphView._debug.animating === false && GraphView._debug.pending === false);
  assert.equal(await page.evaluate(() => GraphView._debug.focusNode), i);
  const d = await page.evaluate(i => {
    const c = document.querySelector('#host canvas').getBoundingClientRect(), s = document.querySelector('#host .graph-sheet').getBoundingClientRect();
    return { cam: GraphView._debug.camera(), p: GraphView._debug.screenOf(i), top: s.top - c.top, ctop: c.top };
  }, i);
  assert.equal(d.cam.scale, cam0.scale, '倍率が変わった');
  assert.ok(Math.abs(d.p[0] - 187.5) < 2, `横の中央に来ていない: ${d.p[0]}`);
  assert.ok(Math.abs(d.p[1] - d.ctop - d.top / 2) < 2, `シートの上の中央に来ていない: ${d.p[1] - d.ctop} / シートの上端 ${d.top}`);
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; });
  await new Promise(r => setTimeout(r, 900));
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 }, '動き終わった後も描き続けている');
});

test('シート: タップしたノードが見えている位置なら、カメラは動かない', async t => {
  const page = await open(t);
  await seedWeak(page, 110);
  await page.evaluate(() => window.__mount());
  await settled(page);
  const i = await findTappable(page, 0.1, 0.45);
  assert.ok(i >= 0, '上寄りのノードが見つからない');
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  await tapNode(page, i);
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.evaluate(() => GraphView._debug.animating), false);
  await new Promise(r => setTimeout(r, 400));
  assert.deepEqual(await page.evaluate(() => GraphView._debug.camera()), cam0, 'カメラが動いた');
});

test('ラベル: 遠景・中景では問題の番号ラベルを置かず、選択中も数個（6 個）まで', async t => {
  const page = await open(t, { viewport: { width: 1280, height: 800 } });
  await seedWeak(page, 110);
  await page.evaluate(() => window.__mount());
  await settled(page);
  const far = await page.evaluate(() => ({ lod: GraphView._debug.lod, q: GraphView._debug.lastFarQuestionLabels, drawn: GraphView._debug.drawnKinds[5] }));
  assert.equal(far.lod, 0);
  assert.ok(far.drawn > 0, '苦手の問題ノードは全体表示でも描かれる');
  assert.equal(far.q, 0, '遠景で問題のラベルが出ている');
  const con = await page.evaluate(() => GRAMMAR_GRAPH.id.indexOf('con:名詞の役割（主語・目的語・補語）'));
  const f = await frames(page);
  await tapNode(page, con);
  await nextFrame(page, f);
  const sel = await page.evaluate(() => ({ lod: GraphView._debug.lod, q: GraphView._debug.lastFarQuestionLabels, node: GraphView._debug.focusNode }));
  assert.equal(sel.node, con);
  assert.equal(sel.lod, 0);
  assert.ok(sel.q > 0 && sel.q <= 6, `選択中の問題ラベルの数: ${sel.q}`);
});

test('選択: 浮かび上がらせる線が多い（60 本超）ときは太さ 1、少ないときは 1.8', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const pick = id => page.evaluate(id => GRAMMAR_GRAPH.id.indexOf(id), id);
  const res = {};
  for (const id of ['con:SVOC（文の骨格）', 'ch:sekai:1']) {
    const i = await pick(id);
    await page.evaluate(i => GraphView._debug.focus(i, 3), i);
    await waitFor(page, i => GraphView._debug.camera().scale > 0 && GraphView._debug.screenOf(i)[0] > 100, i);
    const f = await frames(page);
    await tapNode(page, i);
    await nextFrame(page, f);
    res[id] = await page.evaluate(() => ({ node: GraphView._debug.focusNode, edges: GraphView._debug.focusEdges, width: GraphView._debug.lastFocusEdgeWidth }));
    assert.equal(res[id].node, i, id + ' を選べていない');
    await page.mouse.click(2, 100); // 何もない場所のタップで閉じる
  }
  assert.ok(res['con:SVOC（文の骨格）'].edges > 60);
  assert.equal(res['con:SVOC（文の骨格）'].width, 1);
  assert.ok(res['ch:sekai:1'].edges <= 60);
  assert.equal(res['ch:sekai:1'].width, 1.8);
});

test('スクリーンショット（GRAPH_SHOTS があるときだけ）', async t => {
  const dir = process.env.GRAPH_SHOTS;
  if (!dir) return t.skip('GRAPH_SHOTS なし');
  fs.mkdirSync(dir, { recursive: true });
  for (const vp of [{ width: 375, height: 812, tag: '375' }, { width: 1280, height: 800, tag: '1280' }]) {
    for (const scheme of ['light', 'dark']) {
      const page = await open(t, { viewport: vp, colorScheme: scheme });
      // 合成の記録: いくつかの問題に解答・苦手を付ける
      await page.evaluate(() => {
        const G = GRAMMAR_GRAPH, stats = {}, weak = {};
        for (let o = 0; o < G.qids.length; o++) {
          const qid = G.qids[o];
          if (o % 3 === 0) stats[qid] = { a: 4, c: 4 };
          else if (o % 5 === 0) stats[qid] = { a: 3, c: 2 };
          else if (o % 7 === 0) stats[qid] = { a: 1, c: 1 };
          if (o % 23 === 0) { stats[qid] = { a: 3, c: 0 }; weak[qid] = { streak: 0, due: Date.now() + (o % 46 === 0 ? -1 : 1) * 86400000 }; }
        }
        window.__stats = stats; window.__weak = weak;
      });
      await mountAndWait(page);
      const shot = async name => {
        await new Promise(r => setTimeout(r, 60));
        await page.screenshot({ path: path.join(dir, `${vp.tag}-${scheme}-${name}.png`) });
      };
      await shot('fit');
      if (scheme === 'dark') {
        await page.click('#host .graph-weak-toggle');
        await shot('weakonly');
        continue;
      }
      await page.evaluate(() => GraphView._debug.focus('ch:kin:1', 2.4));
      await shot('mid');
      await page.evaluate(() => GraphView._debug.focus('q:1', 6));
      await shot('near');
      await page.evaluate(() => GraphView._debug.focus(null, 1));
      await new Promise(r => setTimeout(r, 60));
      const ci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
      const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), ci);
      await page.mouse.click(x, y);
      await shot('sheet');
      await page.evaluate(() => { const b = document.querySelector('#host .graph-sheet-body'); b.scrollTop = b.scrollHeight; });
      await shot('sheet-scrolled');
      await page.keyboard.press('Escape');
      await page.click('#host .graph-chip[data-book="polaris2"]');
      await shot('polaris2');
      await page.click('#host .graph-chip[data-book="all"]');
      await page.click('#host .graph-mode-btn[data-mode="grammar"]');
      await settled(page);
      await shot('grammar-fit');
      await page.click('#host .graph-mode-btn[data-mode="radar"]');
      await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));
      await shot('radar');
      await page.click('#host .graph-mode-btn[data-mode="grammar"]');
      await settled(page);
      const gci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
      const [gx, gy] = await page.evaluate(i => GraphView._debug.screenOf(i), gci);
      await page.mouse.click(gx, gy);
      await shot('grammar-sheet');
      await page.keyboard.press('Escape');
    }
  }
});

test('出題ボタン: onStartDrill を渡したときだけ出て、押すと問題 id（30 以内・重複なし）と名前が渡る', async t => {
  const page = await open(t);
  await mountAndWait(page);
  await tapNode(page, await firstOf(page, 'con:'));
  assert.equal(await page.locator('#host .graph-drill-btn').count(), 0, 'onStartDrill がないのにボタンが出た');
  await page.evaluate(() => {
    GraphView.destroy();
    window.__drill = null;
    const deps = window.__deps();
    deps.onStartDrill = (ids, label) => { window.__drill = { ids, label }; };
    GraphView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => GraphView._debug.frames >= 1);
  await tapNode(page, await firstOf(page, 'con:'));
  await page.locator('#host .graph-drill-btn').click();
  const d = await page.evaluate(() => window.__drill);
  assert.ok(d && d.ids.length >= 1 && d.ids.length <= 30);
  assert.equal(new Set(d.ids).size, d.ids.length);
  assert.equal(typeof d.label, 'string');
  assert.ok(d.label.length > 0);
});

test('力学: tick が例外を投げたら固定配置に戻り、タップが受け付けられる（警告は出てよい）', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  await page.evaluate(() => {
    const orig = StudyCore.createSimulation;
    StudyCore.createSimulation = function () {
      const made = orig.apply(this, arguments);
      let calls = 0;
      const tick = made.sim.tick;
      made.sim.tick = function () { if (++calls === 2) throw new Error('boom'); return tick.apply(this, arguments); };
      return made;
    };
    console.warn = function () {};
    window.__mount();
  });
  await settled(page);
  const r = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, D = GraphView._debug;
    let same = true;
    for (let i = 0; i < G.id.length; i++) { const w = D.worldOf(i); if (w[0] !== G.x[i] || w[1] !== G.y[i]) { same = false; break; } }
    return { settled: D.settled, same };
  });
  assert.equal(r.settled, true);
  assert.equal(r.same, true, '座標がビルド済みの値に戻っていない');
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; });
  await new Promise(r => setTimeout(r, 1000));
  assert.equal(await page.evaluate(() => window.__cnt.raf), 0, '収まった後も rAF が呼ばれている');
  await tapNode(page, await firstOf(page, 'book:'));
  assert.equal(await sheetOpen(page), true, '例外の後にタップしてもシートが開かない');
});

test('当たり判定: 苦手で大きくなった概念は、見た目の円の内側（半径の 0.9 倍）で当たる', async t => {
  const page = await open(t);
  const c = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, e = G.edges, by = new Map(), stats = {}, weak = {};
    for (let k = 0; k < e.length; k += 3) {
      if (e[k + 2] !== 1) continue;
      const q = G.kind[e[k]] === G.kinds.indexOf('question') ? e[k] : e[k + 1], h = q === e[k] ? e[k + 1] : e[k];
      if (!by.has(h)) by.set(h, []);
      by.get(h).push(q);
    }
    let best = -1, qs = [];
    for (const [h, l] of by) if (l.length > qs.length) { best = h; qs = l; }
    for (const q of qs) { stats[G.qid[q]] = { a: 2, c: 0 }; weak[G.qid[q]] = { streak: 0, due: Date.now() + 86400000 }; }
    window.__stats = stats; window.__weak = weak;
    return { best, count: qs.length };
  });
  assert.ok(c.count >= 20, `苦手を集められる概念がない: ${c.count}`);
  await page.evaluate(() => window.__mount());
  await settled(page);
  await page.evaluate(i => GraphView._debug.focus(i, 9), c.best);
  const r = await page.evaluate(i => {
    const D = GraphView._debug, G = GRAMMAR_GRAPH;
    const [cx, cy] = D.screenOf(i), rad = D.screenRadiusOf(i) * 0.9;
    let tried = 0, hit = 0;
    for (let a = 0; a < 16; a++) {
      const x = cx + Math.cos(a * Math.PI / 8) * rad, y = cy + Math.sin(a * Math.PI / 8) * rad;
      let closer = false;
      for (let j = 0; j < G.id.length; j++) {
        if (j === i || !D.isVisible(j)) continue;
        const s = D.screenOf(j);
        if (Math.hypot(s[0] - x, s[1] - y) <= rad) { closer = true; break; }
      }
      if (closer) continue;
      tried++;
      if (D.hitAt(x, y) === i) hit++;
    }
    return { tried, hit, rad: D.screenRadiusOf(i), radius: D.radiusOf(i) };
  }, c.best);
  assert.ok(r.radius > 12, `概念が大きくなっていない: ${r.radius}`);
  assert.ok(r.tried > 0, '試せる方向がない');
  assert.equal(r.hit, r.tried, `外周で当たらない方向がある: ${JSON.stringify(r)}`);
});

test('文法軸モード: 切り替えると 13 概念が円周上に固定され、収束後は 1 秒間 rAF もタイマーも呼ばれない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  assert.equal(await page.evaluate(() => GraphView._debug.mode), 'book');
  await page.click('#host .graph-mode-btn[data-mode="grammar"]');
  await settled(page);
  const res = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, D = GraphView._debug, R = StudyCore.GRAPH_GRAMMAR.ringRadius;
    const kCon = G.kinds.indexOf('concept'), kBook = G.kinds.indexOf('book');
    const cons = [], books = [];
    for (let i = 0; i < G.id.length; i++) {
      if (G.kind[i] === kCon) {
        const [x, y] = D.worldOf(i);
        cons.push({ id: G.id[i], r: Math.hypot(x, y), x, y });
      } else if (G.kind[i] === kBook) {
        const [x, y] = D.worldOf(i);
        books.push({ id: G.id[i], r: Math.hypot(x, y) });
      }
    }
    const ch = D.worldOf(D.indexOf('ch:kin:6'));
    const rel = D.worldOf(D.indexOf('con:関係代名詞・関係副詞'));
    const adj = D.worldOf(D.indexOf('con:形容詞と副詞の修飾関係'));
    const dRel = Math.hypot(ch[0] - rel[0], ch[1] - rel[1]);
    const dAdj = Math.hypot(ch[0] - adj[0], ch[1] - adj[1]);
    const pressed = [...document.querySelectorAll('#host .graph-mode-btn')].map(b => b.dataset.mode + ':' + b.getAttribute('aria-pressed'));
    return { mode: D.mode, ticks: D.settleTicks, expectedTicks: StudyCore.GRAPH_GRAMMAR.ticks, R, cons, books, dRel, dAdj, pressed };
  });
  assert.equal(res.mode, 'grammar');
  assert.equal(res.ticks, res.expectedTicks);
  assert.deepEqual(res.pressed, ['book:false', 'grammar:true', 'radar:false']);
  assert.equal(res.cons.length, 13);
  for (const c of res.cons) assert.ok(Math.abs(c.r - res.R) < 1e-3, `${c.id} の半径が円周上にない: ${c.r}`);
  assert.equal(res.books.length, 4);
  for (const b of res.books) assert.ok(b.r > res.R, `${b.id} がリング外にない: r=${b.r}`);
  assert.ok(res.dRel < res.dAdj, `ch:kin:6 が関係詞より形容詞・副詞に近い: ${res.dRel} >= ${res.dAdj}`);
  const svoc = res.cons.find(c => c.id === 'con:SVOC（文の骨格）');
  assert.ok(Math.abs(svoc.x) < 1e-3 && Math.abs(svoc.y + res.R) < 1e-3, `SVOC が 12 時にない: ${JSON.stringify(svoc)}`);
  // 収束後は rAF・タイマーが止まる
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; });
  await new Promise(r => setTimeout(r, 1100));
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 });
});

test('文法軸モード: 教材軸との往復はキャッシュが効いて再計算なしで即座に切り替わり、「再配置」で回し直す', async t => {
  const page = await open(t);
  await mountAndWait(page);
  await page.click('#host .graph-mode-btn[data-mode="grammar"]');
  await settled(page);
  const firstPos = await page.evaluate(() => GraphView._debug.worldOf(GraphView._debug.indexOf('ch:kin:1')));
  await page.click('#host .graph-mode-btn[data-mode="book"]');
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), 0);
  await page.click('#host .graph-mode-btn[data-mode="grammar"]');
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), 0, '2 回目の文法軸で再計算が走った');
  const cachedPos = await page.evaluate(() => GraphView._debug.worldOf(GraphView._debug.indexOf('ch:kin:1')));
  assert.deepEqual(cachedPos, firstPos, 'キャッシュ座標が一致しない');
  // 再配置で現在の文法軸を回し直す
  await page.locator('#host button[data-zoom="relayout"]').click();
  assert.equal(await page.evaluate(() => GraphView._debug.settled), false);
  await settled(page);
  const expectedTicks = await page.evaluate(() => StudyCore.GRAPH_GRAMMAR.ticks);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), expectedTicks);
});

test('文法軸モード: d3 がなくても概念リングの初期配置で切り替わり、例外を出さない', async t => {
  const page = await open(t);
  await page.evaluate(() => { window.d3 = undefined; window.__mount(); });
  await waitFor(page, () => GraphView._debug.frames >= 1);
  await page.click('#host .graph-mode-btn[data-mode="grammar"]');
  await settled(page);
  const r = await page.evaluate(() => {
    const D = GraphView._debug, R = StudyCore.GRAPH_GRAMMAR.ringRadius;
    const svoc = D.worldOf(D.indexOf('con:SVOC（文の骨格）'));
    return { mode: D.mode, settled: D.settled, ticks: D.settleTicks, dist: Math.hypot(svoc[0], svoc[1]), R };
  });
  assert.equal(r.mode, 'grammar');
  assert.equal(r.settled, true);
  assert.equal(r.ticks, 0);
  assert.ok(Math.abs(r.dist - r.R) < 1e-3);
});

test('文法軸モード: initialMode で初期モードを指定でき、切替時に onModeChange が呼ばれる（不正値は book 扱い）', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__changes = [];
    const d1 = window.__deps();
    d1.initialMode = 'bogus';
    GraphView.mount(document.getElementById('host'), d1);
  });
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.mode), 'book');
  await page.evaluate(() => {
    const d2 = window.__deps();
    d2.initialMode = 'grammar';
    d2.onModeChange = m => window.__changes.push(m);
    GraphView.mount(document.getElementById('host'), d2);
  });
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.mode), 'grammar');
  await page.click('#host .graph-mode-btn[data-mode="book"]');
  await settled(page);
  await page.click('#host .graph-mode-btn[data-mode="grammar"]');
  await settled(page);
  assert.deepEqual(await page.evaluate(() => window.__changes), ['book', 'grammar']);
});

test('文法軸モード: 絞り込み・詳細シート・ハイライト・tick 例外リカバリが動作する', async t => {
  const page = await open(t);
  await seedWeak(page, 30);
  await mountAndWait(page);
  await settled(page);
  await page.click('#host .graph-mode-btn[data-mode="grammar"]');
  await settled(page);
  // 絞り込みとタップ詳細シート
  const ci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
  await tapNode(page, ci);
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.evaluate(() => GraphView._debug.focusNode), ci);
  await page.click('#host .graph-chip[data-book="kin"]');
  assert.equal(await page.evaluate(() => GraphView._debug.book), 'kin');
  await page.click('#host .graph-weak-toggle');
  assert.equal(await page.evaluate(() => GraphView._debug.weakOnly), true);
  await page.keyboard.press('Escape');
  // 力学 tick が例外を投げた場合は文法軸のベース配置（円周）に戻ってタップできる
  await page.evaluate(() => {
    const orig = StudyCore.createGrammarSimulation;
    StudyCore.createGrammarSimulation = function () {
      const made = orig.apply(this, arguments);
      let calls = 0;
      const tick = made.sim.tick;
      made.sim.tick = function () { if (++calls === 2) throw new Error('boom-grammar'); return tick.apply(this, arguments); };
      return made;
    };
    console.warn = function () {};
  });
  await page.locator('#host button[data-zoom="relayout"]').click();
  await settled(page);
  const recovered = await page.evaluate(i => {
    const [x, y] = GraphView._debug.worldOf(i);
    return { settled: GraphView._debug.settled, r: Math.hypot(x, y), R: StudyCore.GRAPH_GRAMMAR.ringRadius };
  }, ci);
  assert.equal(recovered.settled, true);
  assert.ok(Math.abs(recovered.r - recovered.R) < 1e-3, '文法軸のベース配置に戻っていない');
});

test('性能: 文法軸モードの力学（CPU 4 倍スロットル、記録用。苦手 110 問）', async t => {
  const out = {};
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    await seedWeak(page, 110);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => {
      const deps = window.__deps();
      deps.initialMode = 'grammar';
      GraphView.mount(document.getElementById('host'), deps);
    });
    await settled(page);
    out[vp.width] = await page.evaluate(() => ({
      settleMs: Math.round(GraphView._debug.settleMs),
      maxFrameMs: Math.round(GraphView._debug.settleMaxFrameMs),
      ticks: GraphView._debug.settleTicks,
      drawMs: Math.round(GraphView._debug.forceDraw() * 10) / 10,
    }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    assert.ok(out[vp.width].settleMs < 10000, `文法軸の収束が長すぎる: ${out[vp.width].settleMs}ms`);
  }
  console.log('# 文法軸 力学（CPU 4 倍）', JSON.stringify(out));
});

test('文法軸モード: getLayoutCache / setLayoutCache によるキャッシュ命中・再配置更新・破損・d3 なしフォールバック', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__cacheStore = {};
    window.__cacheReads = [];
    window.__cacheWrites = [];
    window.__mountCached = function (initialMode) {
      const deps = window.__deps();
      deps.initialMode = initialMode || 'grammar';
      deps.getLayoutCache = function (mode, sig) {
        window.__cacheReads.push({ mode, sig });
        return window.__cacheStore[mode + ':' + sig] || null;
      };
      deps.setLayoutCache = function (mode, sig, coords) {
        window.__cacheWrites.push({ mode, sig, len: coords.x.length });
        window.__cacheStore[mode + ':' + sig] = coords;
      };
      GraphView.mount(document.getElementById('host'), deps);
    };
  });
  // 1. d3 なしの初期配置フォールバックではキャッシュ保存しない
  await page.evaluate(() => { window.__origD3 = window.d3; window.d3 = undefined; window.__mountCached('grammar'); });
  await settled(page);
  assert.equal(await page.evaluate(() => window.__cacheWrites.length), 0, 'd3 なしでキャッシュ保存してはならない');
  // 2. d3 あり初回マウント → 120 tick 計算し、概念は高精度・その他は小数1位のキャッシュを 1 回保存
  await page.evaluate(() => { window.d3 = window.__origD3; window.__mountCached('grammar'); });
  await settled(page);
  const first = await page.evaluate(() => ({
    ticks: GraphView._debug.settleTicks,
    expected: StudyCore.GRAPH_GRAMMAR.ticks,
    writes: window.__cacheWrites.length,
    sig: window.__cacheWrites[0]?.sig,
    len: window.__cacheWrites[0]?.len,
    svoc: GraphView._debug.worldOf(GraphView._debug.indexOf('con:SVOC（文の骨格）')),
  }));
  assert.equal(first.ticks, first.expected);
  assert.equal(first.writes, 1);
  assert.equal(typeof first.sig, 'string');
  assert.equal(first.len, 1201);
  // 3. 同じ条件で再マウント → キャッシュ命中により 0 tick で即表示し、再保存しない
  await page.evaluate(() => { window.__mountCached('grammar'); });
  await settled(page);
  const second = await page.evaluate(() => {
    const D = GraphView._debug, R = StudyCore.GRAPH_GRAMMAR.ringRadius;
    const svoc = D.worldOf(D.indexOf('con:SVOC（文の骨格）'));
    return {
      ticks: D.settleTicks,
      writes: window.__cacheWrites.length,
      rDiff: Math.abs(Math.hypot(svoc[0], svoc[1]) - R),
    };
  });
  assert.equal(second.ticks, 0, 'キャッシュ命中時は 0 tick であるべき');
  assert.equal(second.writes, 1, 'キャッシュ命中時は再書き込みしない');
  assert.ok(second.rDiff < 1e-3, `概念ノードの半径誤差が大きい: ${second.rDiff}`);
  // 4. 再配置ボタンを押すとキャッシュがあっても再計算し、上書き保存する
  await page.locator('#host button[data-zoom="relayout"]').click();
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), first.expected);
  assert.equal(await page.evaluate(() => window.__cacheWrites.length), 2);
  // 5. 壊れたキャッシュ値が入っていた場合は無視して再計算する
  await page.evaluate(() => {
    const key = 'grammar:' + window.__cacheWrites[0].sig;
    window.__cacheStore[key] = { x: [NaN], y: [0] };
    window.__mountCached('grammar');
  });
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), first.expected);
  assert.equal(await page.evaluate(() => window.__cacheWrites.length), 3);
  // 6. 苦手が変わると sig が変わりキャッシュミスで再計算される
  await seedWeak(page, 5);
  await page.evaluate(() => { window.__mountCached('grammar'); });
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), first.expected);
  assert.equal(await page.evaluate(() => window.__cacheWrites.length), 4);
  assert.notEqual(await page.evaluate(() => window.__cacheWrites[3].sig), first.sig);
});

test('レーダーチャートモード: 切り替えで SVG レーダー(13軸)と横棒グラフが出て rAF は 0 回、教材・苦手・カテゴリ・ソートが連動する', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    // 合成の記録: 複数教材・複数概念に正誤と苦手を混ぜる
    window.__stats = {};
    window.__weak = {};
    for (let i = 0; i < 60; i++) {
      const qid = GRAMMAR_GRAPH.qids[i];
      window.__stats[qid] = { a: 4, c: i % 3 === 0 ? 1 : 4 };
      if (i % 5 === 0) window.__weak[qid] = { due: i === 0 ? Date.now() - 1000 : Date.now() + 86400000 };
    }
    window.__mount();
  });
  await settled(page);
  await page.click('#host .graph-mode-btn[data-mode="radar"]');
  await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));

  const initial = await page.evaluate(() => ({
    mode: GraphView._debug.mode,
    canvasHidden: document.querySelector('#host canvas').hidden,
    radarHidden: document.querySelector('#host .graph-radar-panel').hidden,
    axes: document.querySelectorAll('#host .graph-radar-axis-btn').length,
    bars: document.querySelectorAll('#host .graph-bar-row').length,
    scoreNum: document.querySelector('#host .graph-radar-score-num')?.textContent,
    pressed: [...document.querySelectorAll('#host .graph-mode-btn')].map(b => b.dataset.mode + ':' + b.getAttribute('aria-pressed')),
  }));
  assert.equal(initial.mode, 'radar');
  assert.equal(initial.canvasHidden, true);
  assert.equal(initial.radarHidden, false);
  assert.equal(initial.axes, 13);
  assert.equal(initial.bars, 13);
  assert.match(initial.scoreNum, /^\d+%$/);
  assert.deepEqual(initial.pressed, ['book:false', 'grammar:false', 'radar:true']);

  // レーダーチャート中は rAF・タイマーが 0 回
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; });
  await new Promise(r => setTimeout(r, 500));
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 });

  // 教材チップで絞るとサマリーの問題数が変わる
  await page.click('#host .graph-chip[data-book="kin"]');
  const kinScope = await page.locator('#host .graph-radar-scope').innerText();
  assert.match(kinScope, /金の文法/);
  assert.match(kinScope, /160問/);

  // すべてに戻してカテゴリ切替（ひっかけ -> 教材別）とソート（弱い順）
  await page.click('#host .graph-chip[data-book="all"]');
  await page.click('#host .graph-bars-tab[data-radar-cat="trap"]');
  assert.equal(await page.locator('#host .graph-bar-row').count(), 12);
  await page.click('#host .graph-bars-tab[data-radar-cat="book"]');
  assert.equal(await page.locator('#host .graph-bar-row').count(), 4);
  await page.click('#host .graph-bars-tab[data-radar-cat="concept"]');
  await page.click('#host .graph-bars-sort[data-radar-sort="weakness"]');
  assert.equal(await page.locator('#host .graph-bars-sort[data-radar-sort="weakness"]').getAttribute('aria-pressed'), 'true');

  // 苦手のみトグルで苦手 0 問の概念を絞れる
  await page.click('#host .graph-weak-toggle');
  const weakBarsCount = await page.locator('#host .graph-bar-row').count();
  assert.ok(weakBarsCount > 0 && weakBarsCount <= 13);
  await page.click('#host .graph-weak-toggle');

  // 着手率オーバーレイトグル
  assert.equal(await page.locator('#host .graph-radar-poly-cov').count(), 1);
  await page.click('#host [data-radar-cov]');
  assert.equal(await page.locator('#host .graph-radar-poly-cov').count(), 0);
});

test('レーダーチャートモード: 頂点・バータップで詳細シートが開き、問題タップでネットワーク図へ移動する', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__stats = { [GRAMMAR_GRAPH.qids[0]]: { a: 3, c: 1 } };
    window.__weak = { [GRAMMAR_GRAPH.qids[0]]: { due: Date.now() + 86400000 } };
    const deps = window.__deps();
    deps.initialMode = 'radar';
    window.__changes = [];
    deps.onModeChange = m => window.__changes.push(m);
    GraphView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));

  // 1. 棒グラフ行タップで詳細シートが開く
  await page.locator('#host .graph-bar-row').first().click();
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.locator('#host .graph-bar-row.is-active').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await sheetOpen(page), false);

  // 2. レーダー軸タップで詳細シートが開き、中の問題行タップで book モードへ飛ぶ
  await page.locator('#host .graph-radar-axis-btn').first().click();
  assert.equal(await sheetOpen(page), true);
  const firstQ = page.locator('#host .graph-q[data-node]').first();
  if (await firstQ.count()) {
    await firstQ.click();
    await settled(page);
    assert.equal(await page.evaluate(() => GraphView._debug.mode), 'book');
    assert.equal(await page.evaluate(() => document.querySelector('#host canvas').hidden), false);
    assert.equal(await sheetOpen(page), true);
    assert.deepEqual(await page.evaluate(() => window.__changes), ['book']);
  }
});

test('レーダーチャートモード: スマホ(375px)とPC(1280px)で横はみ出しがない', async t => {
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    await page.evaluate(() => {
      const deps = window.__deps();
      deps.initialMode = 'radar';
      GraphView.mount(document.getElementById('host'), deps);
    });
    await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));
    const overflow = await page.evaluate(() => {
      const p = document.querySelector('#host .graph-radar-panel');
      return p.scrollWidth - p.clientWidth;
    });
    assert.ok(overflow <= 1, `vp=${vp.width} で横スクロールが発生した: overflow=${overflow}`);
  }
});

test('レーダーチャートモード: 教材フィルタと詳細シート・0問項目・問題ジャンプのフィルタ解除・refresh が整合する', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__stats = {};
    window.__weak = {};
    // kin (1001〜) と sekai (1〜) の両方に SVOC の解答を入れる
    const g = GRAMMAR_GRAPH;
    const svocIdx = g.id.indexOf('con:SVOC（文の骨格）');
    const qids = [];
    for (let k = g.memberStart[svocIdx]; k < g.memberStart[svocIdx + 1]; k++) qids.push(g.qids[g.members[k]]);
    const kinQ = qids.find(q => q >= 1001 && q < 2000);
    const sekaiQ = qids.find(q => q >= 1 && q < 1000);
    window.__stats[kinQ] = { a: 4, c: 3 }; // 75%
    window.__stats[sekaiQ] = { a: 4, c: 0 }; // 0%
    window.__weak[sekaiQ] = { due: Date.now() - 1000 };
    window.__testQids = { kinQ, sekaiQ };
    const deps = window.__deps();
    deps.initialMode = 'radar';
    GraphView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));

  // 1. 金の文法に絞り込み → SVOC の詳細シートは金の文法だけの成績（75%, 解答数 4, 苦手 0）になる
  await page.click('#host .graph-chip[data-book="kin"]');
  await page.locator('#host .graph-bar-row').first().click();
  assert.equal(await sheetOpen(page), true);
  const kinSheet = await page.evaluate(() => {
    const dds = [...document.querySelectorAll('#host .graph-stats dd')].map(el => el.textContent);
    const qNos = [...document.querySelectorAll('#host .graph-q-no')].map(el => Number(el.textContent.slice(1)));
    return { kind: document.querySelector('#host .graph-sheet-kind').textContent, dds, qNos };
  });
  assert.match(kinSheet.kind, /金の文法/);
  assert.equal(kinSheet.dds[1], '75%');
  assert.equal(kinSheet.dds[2], '4');
  assert.equal(kinSheet.dds[3], '0');
  assert.ok(kinSheet.qNos.every(q => q >= 1001 && q < 2000), '他教材の問題が混ざっている');

  // 2. シートを開いたまま教材を「すべて」に切り替えるとシートの成績も合算（38%, 解答数 8, 苦手 1）へ更新される
  await page.click('#host .graph-chip[data-book="all"]');
  const allSheet = await page.evaluate(() => [...document.querySelectorAll('#host .graph-stats dd')].map(el => el.textContent));
  assert.equal(allSheet[1], '38%');
  assert.equal(allSheet[2], '8');
  assert.equal(allSheet[3], '1');

  // 3. 空白クリックでシートが閉じる
  await page.locator('#host .graph-radar-summary').click({ position: { x: 8, y: 8 } });
  assert.equal(await sheetOpen(page), false);

  // 4. トップレベルのひっかけタブでは収録 0 問項目が disabled かつ「収録なし」表示になる
  await page.click('#host .graph-chip[data-book="toplevel"]');
  await page.click('#host .graph-bars-tab[data-radar-cat="trap"]');
  const unavail = await page.evaluate(() => ({
    disabled: document.querySelectorAll('#host .graph-bar-row.is-unavailable:disabled').length,
    text: document.querySelector('#host .graph-bar-row.is-unavailable')?.textContent || '',
  }));
  assert.ok(unavail.disabled >= 10, `トップレベルの収録なしひっかけが不足: ${unavail.disabled}`);
  assert.match(unavail.text, /収録なし/);

  // 5. refresh() で記録更新がレーダーのスコアに反映される
  await page.click('#host .graph-chip[data-book="kin"]');
  await page.click('#host .graph-bars-tab[data-radar-cat="concept"]');
  await page.evaluate(() => {
    window.__stats[window.__testQids.kinQ] = { a: 4, c: 4 };
    GraphView.refresh();
  });
  assert.equal(await page.locator('#host .graph-radar-score-num').innerText(), '100%');

  // 6. weakOnly ON で非苦手問題へジャンプしてもフィルタが解除され対象ノードが可視になる
  await page.click('#host .graph-chip[data-book="all"]');
  await page.click('#host .graph-weak-toggle');
  await page.locator('#host .graph-bar-row').first().click();
  const nonWeakQ = page.locator('#host .graph-q:not(.graph-q-weak)[data-node]').first();
  const jumpTarget = Number(await nonWeakQ.getAttribute('data-node'));
  await nonWeakQ.click();
  await settled(page);
  const afterJump = await page.evaluate(idx => ({
    mode: GraphView._debug.mode,
    weakOnly: GraphView._debug.weakOnly,
    visible: GraphView._debug.isVisible(idx),
  }), jumpTarget);
  assert.equal(afterJump.mode, 'book');
  assert.equal(afterJump.weakOnly, false);
  assert.equal(afterJump.visible, true);
});

test('レーダーチャートモード: シート展開中の book→radar 切替で残留 rAF 描画が起きず、graph-force 欠落でも 13 軸順を保つ', async t => {
  const page = await open(t);
  await mountAndWait(page);
  // book モードで概念シートを開く
  const ci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
  await tapNode(page, ci);
  assert.equal(await sheetOpen(page), true);
  // radar へ切り替え直後に保留中 rAF がなく、追加の Canvas draw() が走らない
  const beforeFrames = await page.evaluate(() => GraphView._debug.frames);
  await page.click('#host .graph-mode-btn[data-mode="radar"]');
  const rightAfter = await page.evaluate(() => ({ mode: GraphView._debug.mode, pending: GraphView._debug.pending }));
  await new Promise(r => setTimeout(r, 300));
  const afterFrames = await page.evaluate(() => GraphView._debug.frames);
  assert.equal(rightAfter.mode, 'radar');
  assert.equal(rightAfter.pending, false);
  assert.equal(afterFrames, beforeFrames, 'radar 切替後に非表示 Canvas が追加描画された');

  // graph-force.js（GRAMMAR_CONCEPT_ORDER）が欠落しても 13 軸の順序は既定順を保つ
  const orderRes = await page.evaluate(() => {
    const expected = StudyCore.GRAMMAR_CONCEPT_ORDER.slice();
    const orig = StudyCore.GRAMMAR_CONCEPT_ORDER;
    StudyCore.GRAMMAR_CONCEPT_ORDER = undefined;
    try {
      const deps = window.__deps();
      deps.initialMode = 'radar';
      GraphView.mount(document.getElementById('host'), deps);
      const labels = [...document.querySelectorAll('#host .graph-radar-axis-btn')].map(el => el.getAttribute('aria-label'));
      return { first: labels[0], second: labels[1], count: labels.length, expectedLen: expected.length };
    } finally {
      StudyCore.GRAMMAR_CONCEPT_ORDER = orig;
    }
  });
  assert.equal(orderRes.count, orderRes.expectedLen);
  assert.match(orderRes.first, /^SVOC/);
  assert.match(orderRes.second, /^能動態と受動態/);
});

test('レーダーチャートモード: 1280px・375px で全軸 100% でもラベルがカード枠内に収まり、全 8 テーマでバッジコントラスト 4.5 以上', async t => {
  // 1. 1280px / 375px でのラベル枠内収まり（全問 100% 正解）
  for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
    const page = await open(t, { viewport: vp });
    await page.evaluate(() => {
      window.__stats = {};
      for (const qid of GRAMMAR_GRAPH.qids) window.__stats[qid] = { a: 4, c: 4 };
      const deps = window.__deps();
      deps.initialMode = 'radar';
      GraphView.mount(document.getElementById('host'), deps);
    });
    await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));
    const clipped = await page.evaluate(() => {
      const card = document.querySelector('#host .graph-radar-chart-card').getBoundingClientRect();
      const out = [];
      for (const el of document.querySelectorAll('#host .graph-radar-axis-label')) {
        const r = el.getBoundingClientRect();
        if (r.left < card.left - 1 || r.right > card.right + 1) {
          out.push({ text: el.textContent, left: Math.round(r.left - card.left), right: Math.round(card.right - r.right) });
        }
      }
      return out;
    });
    assert.deepEqual(clipped, [], `vp=${vp.width} でレーダーラベルがカード枠外にはみ出した: ${JSON.stringify(clipped)}`);
  }

  // 2. 全 8 テーマ + ios dark でバッジコントラスト比 >= 4.5（WCAG AA）
  const page = await open(t, { path: '/__graph_theme_test.html', viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => {
    window.__stats = {};
    window.__weak = {};
    for (let i = 0; i < 40; i++) {
      const qid = GRAMMAR_GRAPH.qids[i];
      window.__stats[qid] = { a: 4, c: 4 };
      if (i < 5) window.__weak[qid] = { due: Date.now() - 1000 };
    }
    const deps = window.__deps();
    deps.initialMode = 'radar';
    GraphView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-bar-badge.is-due'));

  const themes = ['ink', 'duolingo', 'navy', 'forest', 'nordic', 'quizlet', 'light', 'ios'];
  const checkContrast = () => page.evaluate(() => {
    const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (c1, c2) => {
      const l1 = lum(parse(c1)), l2 = lum(parse(c2));
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const selectors = ['.graph-radar-state.is-state-good', '.graph-bar-badge.is-due', '.graph-bar-badge.is-weak'];
    const res = {};
    for (const sel of selectors) {
      const el = document.querySelector('#host ' + sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      res[sel] = Math.round(ratio(cs.backgroundColor, cs.color) * 100) / 100;
    }
    return res;
  });

  for (const id of themes) {
    await page.evaluate(tid => document.documentElement.setAttribute('data-theme', tid), id);
    const ratios = await checkContrast();
    for (const [sel, r] of Object.entries(ratios)) {
      assert.ok(r >= 4.5, `theme=${id} ${sel} のコントラスト比が 4.5 未満: ${r}`);
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'ios'));
  const iosDarkRatios = await checkContrast();
  for (const [sel, r] of Object.entries(iosDarkRatios)) {
    assert.ok(r >= 4.5, `theme=ios(dark) ${sel} のコントラスト比が 4.5 未満: ${r}`);
  }
});
