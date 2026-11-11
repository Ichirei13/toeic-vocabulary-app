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

test('ノードをタップするとシートが開く（概念は desc、Trap は advice、問題一覧）。Esc・外側タップ・閉じるボタンで閉じる', async t => {
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
  // 外側（背景の覆い）をタップすると閉じる
  await page.mouse.click(187, 120);
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

test('シートを開いた直後の互換 click（覆いの上で pointerdown がない click）では閉じない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const ci = await page.evaluate(() => GraphView._debug.indexOf('con:SVOC（文の骨格）'));
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), ci);
  await page.mouse.click(x, y);
  await waitFor(page, () => { const s = document.querySelector('#host .graph-sheet'); return s && !s.hidden; });
  await page.evaluate(() => document.querySelector('#host .graph-sheet-backdrop').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 187, clientY: 120 })));
  assert.equal(await sheetOpen(page), true, 'pointerdown なしの click で閉じた');
  await page.mouse.click(187, 120); // 本当に覆いを押したら閉じる
  assert.equal(await sheetOpen(page), false);
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
    }
  }
});
