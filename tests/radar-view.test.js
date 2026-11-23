// レーダーのページの中身（js/radar-view.js + js/graph-sheet.js + css/graph.css）の検証。アプリ全体は起動せず、
// レーダーに要るファイルだけを読む最小のページ（メモリ上の /__radar_test.html）で確かめる。
// グラフ本体（js/graph-view.js）・graph-filter / graph-geometry / graph-near・d3・graph-force.js は読まない（読まなくても動くことを確かめる）。
// 実行: NODE_PATH=$(npm root -g) node --test tests/radar-view.test.js
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
<script src="/src/graph-detail.js"></script>
<script src="/src/graph-report.js"></script>
<script src="/src/sheet-size.js"></script>
<script src="/js/graph-sheet.js"></script>
<script src="/js/radar-view.js"></script>
<script>
  window.__stats = {};
  window.__weak = {};
  window.__getQ = null;
  window.__opened = [];
  window.__deps = function () {
    return {
      graph: GRAMMAR_GRAPH,
      getStats: function () { return window.__stats; },
      getWeak: function () { return window.__weak; },
      getQuestion: function (qid) { return window.__getQ ? window.__getQ(qid) : { q: 'Question number ' + qid + ' text' }; },
      isDue: function (e) { return !!(e && typeof e.due === 'number' && e.due <= Date.now()); },
      onOpenQuestion: function (n) { window.__opened.push(n); },
    };
  };
  window.__mount = function () { RadarView.mount(document.getElementById('host'), window.__deps()); };
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
  if (pathname === '/__radar_test.html' || pathname === '/__graph_theme_test.html') {
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
  await page.goto(base + (opts.path || '/__radar_test.html'));
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
const ready = page => waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
const sheetOpen = page => page.evaluate(() => {
  const s = document.querySelector('#host .graph-sheet');
  return !!s && !s.hidden;
});

test('頂点・バータップで詳細シートが開き、問題をタップすると onOpenQuestion にその問題のノードが渡る', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__opened = [];
    window.__stats = { [GRAMMAR_GRAPH.qids[0]]: { a: 3, c: 1 } };
    window.__weak = { [GRAMMAR_GRAPH.qids[0]]: { due: Date.now() + 86400000 } };
    window.__mount();
  });
  await ready(page);
  await page.locator('#host .graph-bar-row').first().click();
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.locator('#host .graph-bar-row.is-active').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.locator('#host .graph-bar-row.is-active').count(), 0);
  await page.locator('#host .graph-radar-axis-btn[data-node]').first().click();
  assert.equal(await sheetOpen(page), true);
  const q = page.locator('#host .graph-q[data-node]').first();
  const node = Number(await q.getAttribute('data-node'));
  await q.click();
  assert.deepEqual(await page.evaluate(() => window.__opened), [node]);
  assert.equal(await page.evaluate(n => GRAMMAR_GRAPH.kinds[GRAMMAR_GRAPH.kind[n]], node), 'question');
  // キーボード（Enter）でも渡る
  await page.locator('#host .graph-q[data-node]').first().focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__opened), [node, node]);
});

test('軸ラベルはキーボード（Enter）でもシートを開く', async t => {
  const page = await open(t);
  await page.evaluate(() => window.__mount());
  await ready(page);
  await page.locator('#host .graph-radar-axis-btn[data-node]').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await sheetOpen(page), true);
});

test('destroy: DOM とリスナーが消え、2 回呼んでも落ちない。mount/destroy を 5 回繰り返してもリスナーは増えない', async t => {
  const page = await open(t);
  const r = await page.evaluate(() => {
    const counts = [];
    for (let k = 0; k < 5; k++) {
      window.__mount();
      counts.push(RadarView._debug.listeners);
      RadarView.destroy();
    }
    RadarView.destroy();
    return { counts, left: RadarView._debug.listeners, dom: document.querySelectorAll('#host *').length };
  });
  assert.ok(r.counts[0] > 0);
  assert.deepEqual(r.counts, Array(5).fill(r.counts[0]));
  assert.equal(r.left, 0);
  assert.equal(r.dom, 0);
});

test('XSS: 問題文に HTML が入っていても、シートに挿入も実行もされない', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__getQ = () => ({ q: '<img src=x onerror="window.__xss=1">' });
    window.__mount();
  });
  await ready(page);
  await page.locator('#host .graph-bar-row').first().click();
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.locator('#host .graph-sheet img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});

test('出題ボタン: テーマの全問と、苦手と未着手だけを選べ、テーマの演習（kind: theme）として渡る', async t => {
  const page = await open(t);
  const info = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH;
    const i = G.id.indexOf('con:SVOC（文の骨格）');
    const qs = [];
    for (let k = G.memberStart[i]; k < G.memberStart[i + 1]; k++) qs.push(G.qids[G.members[k]]);
    const uniq = [...new Set(qs)];
    window.__stats = {};
    window.__weak = {};
    uniq.slice(0, 10).forEach(q => { window.__stats[q] = { a: 2, c: 2 }; });   // 正解済み 10 問
    uniq.slice(10, 15).forEach(q => { window.__stats[q] = { a: 2, c: 1 }; });  // 間違えたが苦手でない（克服）5 問
    uniq.slice(15, 18).forEach(q => { window.__weak[q] = { due: Date.now() + 86400000 }; }); // 苦手 3 問
    window.__drill = null;
    const deps = window.__deps();
    deps.onStartDrill = (ids, label, opts) => { window.__drill = { ids, label, opts }; };
    RadarView.mount(document.getElementById('host'), deps);
    return { node: i, total: uniq.length, weakIds: uniq.slice(15, 18), correctIds: uniq.slice(0, 10), overcomeIds: uniq.slice(10, 15) };
  });
  await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
  await page.locator(`#host .graph-bar-row[data-node="${info.node}"]`).click();
  const allBtn = page.locator('#host .graph-drill-btn[data-drill="all"]');
  const restBtn = page.locator('#host .graph-drill-btn[data-drill="rest"]');
  assert.match(await allBtn.innerText(), new RegExp(`全 ${info.total} 問`));
  assert.match(await restBtn.innerText(), new RegExp(`苦手と未着手の ${info.total - 15} 問`));
  assert.equal(await page.locator('#host .graph-drill-btn[data-drill="near"]').count(), 0, 'レーダーでは近い問題のボタンを出さない');

  await allBtn.click();
  let d = await page.evaluate(() => window.__drill);
  assert.equal(d.ids.length, info.total, '全問が渡っていない');
  assert.equal(new Set(d.ids).size, d.ids.length);
  assert.deepEqual(d.ids.slice(0, 3).sort(), info.weakIds.slice().sort(), '苦手が先頭に来ていない');
  assert.deepEqual(d.ids.slice(-10).sort(), info.correctIds.slice().sort(), '正解済みが最後に来ていない');
  assert.equal(d.opts && d.opts.kind, 'theme');
  assert.match(d.label, /SVOC/);

  await page.evaluate(() => { window.__drill = null; });
  await restBtn.click();
  d = await page.evaluate(() => window.__drill);
  assert.equal(d.ids.length, info.total - 15);
  assert.ok(info.correctIds.every(q => !d.ids.includes(q)), '正解済みが混ざっている');
  assert.ok(info.overcomeIds.every(q => !d.ids.includes(q)), '克服した問題が混ざっている');
  assert.deepEqual(d.ids.slice(0, 3).sort(), info.weakIds.slice().sort(), '苦手が先頭に来ていない');
  assert.equal(d.opts && d.opts.kind, 'theme');
});

test('出題ボタン: 全問を正解済みなら「苦手と未着手」は出さない。教材で絞ると、その教材の分だけになる', async t => {
  const page = await open(t);
  const info = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH;
    const i = G.id.indexOf('con:比較級・最上級');
    window.__stats = {};
    for (let k = G.memberStart[i]; k < G.memberStart[i + 1]; k++) window.__stats[G.qids[G.members[k]]] = { a: 1, c: 1 };
    const deps = window.__deps();
    deps.onStartDrill = (ids, label, opts) => { window.__drill = { ids, label, opts }; };
    RadarView.mount(document.getElementById('host'), deps);
    return { node: i };
  });
  await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
  await page.locator(`#host .graph-bar-row[data-node="${info.node}"]`).click();
  assert.equal(await page.locator('#host .graph-drill-btn[data-drill="all"]').count(), 1);
  assert.equal(await page.locator('#host .graph-drill-btn[data-drill="rest"]').count(), 0);
  await page.locator('#host .graph-sheet-close').click();

  await page.click('#host .graph-chip[data-book="kin"]');
  await page.locator(`#host .graph-bar-row[data-node="${info.node}"]`).click();
  const kinTotal = await page.evaluate(n => {
    const G = GRAMMAR_GRAPH;
    const kinBook = G.id.indexOf('book:kin');
    const kin = new Set();
    for (let k = G.memberStart[kinBook]; k < G.memberStart[kinBook + 1]; k++) kin.add(G.members[k]);
    const s = new Set();
    for (let k = G.memberStart[n]; k < G.memberStart[n + 1]; k++) if (kin.has(G.members[k])) s.add(G.members[k]);
    return s.size;
  }, info.node);
  assert.match(await page.locator('#host .graph-drill-btn[data-drill="all"]').innerText(), new RegExp(`全 ${kinTotal} 問`));
  await page.locator('#host .graph-drill-btn[data-drill="all"]').click();
  const d = await page.evaluate(() => window.__drill);
  assert.equal(d.ids.length, kinTotal, '30 問で打ち切らず、金の文法の分を全部渡す');
  assert.match(d.label, /金の文法/);
});

test('横棒: 正解・克服・苦手・未着手の色分けの内訳で描き、下に内訳の数と、上に凡例を出す', async t => {
  const page = await open(t);
  const info = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH;
    const i = G.id.indexOf('con:SVOC（文の骨格）');
    const qs = [];
    for (let k = G.memberStart[i]; k < G.memberStart[i + 1]; k++) qs.push(G.qids[G.members[k]]);
    const uniq = [...new Set(qs)];
    window.__stats = {};
    window.__weak = {};
    uniq.slice(0, 10).forEach(q => { window.__stats[q] = { a: 2, c: 2 }; });  // 正解 10
    uniq.slice(10, 16).forEach(q => { window.__stats[q] = { a: 2, c: 1 }; }); // 克服 6
    uniq.slice(16, 20).forEach(q => { window.__weak[q] = { due: Date.now() + 86400000 }; }); // 苦手 4
    const deps = window.__deps();
    RadarView.mount(document.getElementById('host'), deps);
    return { node: i, total: uniq.length };
  });
  await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
  const res = await page.evaluate(n => {
    const row = document.querySelector(`#host .graph-bar-row[data-node="${n}"]`);
    const track = row.querySelector('.graph-bar-track');
    const tw = track.getBoundingClientRect().width;
    const w = cls => { const el = track.querySelector('.graph-bar-seg.' + cls); return el ? el.getBoundingClientRect().width / tw : -1; };
    return {
      correct: w('is-correct'), overcome: w('is-overcome'), weak: w('is-weak'), unseen: w('is-unseen'),
      target: row.querySelectorAll('.graph-bar-target').length,
      sub: row.querySelector('.graph-bar-sub').textContent,
      legend: document.querySelector('#host .graph-bars-legend')?.textContent || '',
      colors: ['is-correct', 'is-overcome', 'is-weak', 'is-unseen'].map(c => getComputedStyle(track.querySelector('.graph-bar-seg.' + c)).backgroundColor),
    };
  }, info.node);
  const near = (a, b) => Math.abs(a - b) < 0.02;
  assert.ok(near(res.correct, 10 / info.total), `正解の幅 ${res.correct}`);
  assert.ok(near(res.overcome, 6 / info.total), `克服の幅 ${res.overcome}`);
  assert.ok(near(res.weak, 4 / info.total), `苦手の幅 ${res.weak}`);
  assert.ok(near(res.unseen, (info.total - 20) / info.total), `未着手の幅 ${res.unseen}`);
  assert.equal(res.target, 0, '内訳の棒には 80% の目標線を出さない');
  assert.match(res.sub, new RegExp(`正解 10 ・ 克服 6 ・ 苦手 4 ・ 未着手 ${info.total - 20}`));
  for (const word of ['正解', '克服', '苦手', '未着手']) assert.ok(res.legend.includes(word), `凡例に「${word}」がない: ${res.legend}`);
  assert.equal(new Set(res.colors).size, 4, `4 色が区別できない: ${JSON.stringify(res.colors)}`);
});

test('開くと SVG レーダー(13軸)と横棒グラフが出て rAF・タイマーは 0 回、グラフ本体は無い。教材・苦手・カテゴリ・ソートが連動する', async t => {
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
  await ready(page);

  const initial = await page.evaluate(() => ({
    canvas: document.querySelectorAll('#host canvas').length,
    graphView: typeof GraphView,
    radarHidden: document.querySelector('#host .graph-radar-panel').hidden,
    modeBtns: document.querySelectorAll('#host .graph-mode-btn').length,
    firstAxes: [...document.querySelectorAll('#host .graph-radar-axis-btn')].slice(0, 2).map(el => el.getAttribute('aria-label')),
    axes: document.querySelectorAll('#host .graph-radar-axis-btn').length,
    bars: document.querySelectorAll('#host .graph-bar-row').length,
    scoreNum: document.querySelector('#host .graph-radar-score-num')?.textContent,
  }));
  assert.equal(initial.canvas, 0);
  assert.equal(initial.graphView, 'undefined');
  assert.equal(initial.modeBtns, 0);
  // graph-force.js（GRAMMAR_CONCEPT_ORDER）を読まないページでも、軸は文法軸と同じ順（12 時から SVOC → 能動態と受動態）
  assert.match(initial.firstAxes[0], /^SVOC/);
  assert.match(initial.firstAxes[1], /^能動態と受動態/);
  assert.equal(initial.radarHidden, false);
  assert.equal(initial.axes, 13);
  assert.equal(initial.bars, 13);
  assert.match(initial.scoreNum, /^\d+%$/);

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

test('スマホ(375px)とPC(1280px)で横はみ出しがない', async t => {
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    await page.evaluate(() => {
      const deps = window.__deps();
        RadarView.mount(document.getElementById('host'), deps);
    });
    await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
    const overflow = await page.evaluate(() => {
      const p = document.querySelector('#host .graph-radar-panel');
      return p.scrollWidth - p.clientWidth;
    });
    assert.ok(overflow <= 1, `vp=${vp.width} で横スクロールが発生した: overflow=${overflow}`);
  }
});

test('教材フィルタと詳細シート・0問項目・refresh が整合し、苦手のみでも問題のタップは onOpenQuestion に渡る', async t => {
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
    RadarView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));

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
    RadarView.refresh();
  });
  assert.equal(await page.locator('#host .graph-radar-score-num').innerText(), '100%');

  // 6. 苦手のみ ON でも、苦手でない問題をタップすると onOpenQuestion にそのノードが渡る（グラフのページは絞り込みなしで開く）
  await page.click('#host .graph-chip[data-book="all"]');
  await page.click('#host .graph-weak-toggle');
  await page.locator('#host .graph-bar-row').first().click();
  const nonWeakQ = page.locator('#host .graph-q:not(.graph-q-weak)[data-node]').first();
  const jumpTarget = Number(await nonWeakQ.getAttribute('data-node'));
  await nonWeakQ.click();
  assert.deepEqual(await page.evaluate(() => window.__opened), [jumpTarget]);
});

test('1280px・375px で全軸 100% でもラベルがカード枠内に収まり、全 8 テーマでバッジコントラスト 4.5 以上', async t => {
  // 1. 1280px / 375px でのラベル枠内収まり（全問 100% 正解）
  for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
    const page = await open(t, { viewport: vp });
    await page.evaluate(() => {
      window.__stats = {};
      for (const qid of GRAMMAR_GRAPH.qids) window.__stats[qid] = { a: 4, c: 4 };
      const deps = window.__deps();
        RadarView.mount(document.getElementById('host'), deps);
    });
    await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
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
    RadarView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => !!document.querySelector('#host .graph-bar-badge.is-due'));

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
    const selectors = ['.graph-radar-state.is-state-good', '.graph-radar-state.is-state-due', '.graph-bar-badge.is-due', '.graph-bar-badge.is-weak'];
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

test('軸ラベルの実効文字サイズが 375px・768px・900px・1280px で 11px 以上で、viewBox からはみ出さず、ラベルどうしが重ならない', async t => {
  // 900px は 2 列になる最小の幅（レーダーが左の列に入る）。768px は 1 列でパネルは広い
  for (const vp of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 900, height: 800 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    await page.evaluate(() => {
      window.__stats = {};
      for (const qid of GRAMMAR_GRAPH.qids) window.__stats[qid] = { a: 4, c: 4 };
      const deps = window.__deps();
        RadarView.mount(document.getElementById('host'), deps);
    });
    await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
    const res = await page.evaluate(() => {
      const svg = document.querySelector('#host .graph-radar-svg');
      const scale = svg.getBoundingClientRect().width / 420;
      const out = { minPx: Infinity, outside: [], overlaps: [] };
      const boxes = [];
      for (const el of svg.querySelectorAll('.graph-radar-axis-label')) {
        out.minPx = Math.min(out.minPx, parseFloat(getComputedStyle(el).fontSize) * scale);
        const b = el.getBBox();
        if (b.x < 0 || b.x + b.width > 420 || b.y < 0 || b.y + b.height > 330) out.outside.push(el.textContent);
        boxes.push({ name: el.querySelector('tspan').textContent, b });
      }
      // ラベル（分野名＋%）どうしの重なり。行間ぶんの 2 単位以下の接触は許す
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].b, c = boxes[j].b;
          const ox = Math.min(a.x + a.width, c.x + c.width) - Math.max(a.x, c.x);
          const oy = Math.min(a.y + a.height, c.y + c.height) - Math.max(a.y, c.y);
          if (ox > 2 && oy > 2) out.overlaps.push(`${boxes[i].name}×${boxes[j].name}`);
        }
      }
      out.minPx = Math.round(out.minPx * 10) / 10;
      return out;
    });
    assert.ok(res.minPx >= 11, `vp=${vp.width} で軸ラベルの実効文字サイズが ${res.minPx}px（11px 未満）`);
    assert.deepEqual(res.outside, [], `vp=${vp.width} で viewBox からはみ出したラベル: ${JSON.stringify(res.outside)}`);
    assert.deepEqual(res.overlaps, [], `vp=${vp.width} で重なったラベル: ${JSON.stringify(res.overlaps)}`);
  }
});

test('表示中に画面幅が狭い⇔広いと変わると、詰めた配置へ描き直す', async t => {
  const page = await open(t, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => {
    const deps = window.__deps();
    RadarView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));
  assert.equal(await page.evaluate(() => RadarView._debug.compact), false);
  assert.equal(await page.locator('#host .graph-radar-svg.is-compact').count(), 0);
  await page.setViewportSize({ width: 375, height: 812 });
  await waitFor(page, () => RadarView._debug.compact === true && !!document.querySelector('#host .graph-radar-svg.is-compact'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitFor(page, () => RadarView._debug.compact === false && !document.querySelector('#host .graph-radar-svg.is-compact'));
  // 描き直しでも rAF もタイマーも使わない
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 });
});
