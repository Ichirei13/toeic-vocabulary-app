// グラフの「近い問題を解く」の検証（アプリ全体を起動する）。
// 実行: NODE_PATH=$(npm root -g) node --test tests/graph-drill.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const NEAR_KEY = 'toeic_near_drill_v1';
const SESSION_KEY = 'toeic_session';
const BOOK_SESSIONS_KEY = 'toeic_book_sessions_v1';

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

async function open(t, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  t.after(() => assert.deepEqual(errors.map(String), [], 'ページで例外が出た'));
  if (opts.init) await page.addInitScript(opts.init.fn, opts.init.arg);
  await page.goto(base + '/index.html' + (opts.hash || '#home'));
  return { page, context };
}
async function waitFor(page, fn, arg, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout: ' + fn.toString());
    await new Promise(r => setTimeout(r, 20));
  }
}
const graphReady = page => waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.frames >= 1 && GraphView._debug.settled === true);
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const poolIds = page => page.evaluate(() => state.grammarPool.map(g => g.id));

// 文法の通常の出題を 1 問進めてから、グラフを開く（通常の続きがある状態にする）
async function openGraphWithNormalSession(page) {
  await page.evaluate(() => { setApp('grammar'); applyGrammarFilters(); switchAppPage('practice'); });
  await page.locator('#choices-container button').first().click();
  await page.evaluate(() => switchAppPage('graph'));
  await graphReady(page);
}
// ノードをタップしてシートを開き、「近い問題を解く」を押す。押す前のボタンの文字を返す
async function startNearDrill(page, prefix) {
  const [x, y] = await page.evaluate(p => GraphView._debug.screenOf(GRAMMAR_GRAPH.id.findIndex(s => s.startsWith(p))), prefix);
  await page.mouse.click(x, y);
  const btn = page.locator('#graph-page .graph-drill-btn');
  const text = await btn.innerText();
  await btn.click();
  await waitFor(page, () => currentAppPage === 'practice');
  return text;
}

test('概念から「近い問題を解く」: 演習ページへ移り、問題数がボタンと合い、通常の続きは変わらない', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = await stored(page, SESSION_KEY);
  const books0 = await stored(page, BOOK_SESSIONS_KEY);
  assert.ok(session0, '通常の続きが保存されている前提');
  const text = await startNearDrill(page, 'con:');
  const m = text.match(/(\d+) 問/);
  assert.ok(m, `ボタンの文字: ${text}`);
  const ids = await poolIds(page);
  assert.equal(ids.length, Number(m[1]));
  assert.ok(ids.length >= 1 && ids.length <= 30);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(await page.evaluate(() => state.app), 'grammar');
  assert.match(await page.locator('#near-drill-banner').innerText(), /に近い \d+ 問/);
  assert.equal(await stored(page, SESSION_KEY), session0, '通常の続きが書き換わった');
  assert.equal(await stored(page, BOOK_SESSIONS_KEY), books0, '本ごとの続きが書き換わった');
  const near = JSON.parse(await stored(page, NEAR_KEY));
  assert.deepEqual(near.ids, ids);
  assert.equal(near.index, 0);
});

test('回答すると、苦手の記録が通常と同じ形で保存され、通常の続きは変わらないまま。再読み込みしても続きから解ける', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = await stored(page, SESSION_KEY);
  await startNearDrill(page, 'con:');
  const ids = await poolIds(page);
  const stats0 = JSON.parse((await stored(page, 'toeic_grammar_stats')) || '{}');
  await page.locator('#choices-container button').first().click();
  const stats1 = JSON.parse(await stored(page, 'toeic_grammar_stats'));
  assert.equal(stats1[ids[0]].a, ((stats0[ids[0]] || {}).a || 0) + 1, '解答数が増えていない');
  assert.equal(await stored(page, SESSION_KEY), session0);
  assert.equal(JSON.parse(await stored(page, NEAR_KEY)).index, 1, '回答済みの問題の次から再開する');
  // バックアップに入る「出題の続き」も、通常の続きのまま
  assert.deepEqual(await page.evaluate(() => sessionSnapshot()), JSON.parse(session0));
  await page.reload();
  await waitFor(page, () => typeof state !== 'undefined' && state.grammarPool.length > 0);
  await page.evaluate(() => switchAppPage('practice'));
  assert.deepEqual(await poolIds(page), ids, '再読み込みで 30 問が戻らない');
  assert.equal(await page.evaluate(() => state.currentGrammarIndex), 1);
  assert.equal(await page.locator('#near-drill-banner').isVisible(), true);
});

test('解除すると、表示が消え、続きのキーも消え、通常の出題の続きに戻る', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = JSON.parse(await stored(page, SESSION_KEY));
  await startNearDrill(page, 'trap:');
  await page.locator('#near-drill-banner .near-drill-exit').click();
  assert.equal(await page.locator('#near-drill-banner').isVisible(), false);
  assert.equal(await stored(page, NEAR_KEY), null);
  assert.equal(await page.evaluate(() => state.nearDrill), null);
  assert.deepEqual(await poolIds(page), session0.grammar.pool, '通常の続きの問題に戻っていない');
  assert.equal(await page.evaluate(() => state.currentGrammarIndex), session0.grammar.index);
});

test('フィルターを変える（出題し直す）と解除される。単語に切り替えて戻ると、近い問題の続きに戻る', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  await startNearDrill(page, 'ch:');
  const ids = await poolIds(page);
  await page.evaluate(() => setApp('vocab'));
  assert.equal(await page.locator('#near-drill-banner').isVisible(), false, '単語では表示しない');
  await page.evaluate(() => setApp('grammar'));
  assert.deepEqual(await poolIds(page), ids);
  assert.equal(await page.locator('#near-drill-banner').isVisible(), true);
  await page.evaluate(() => applyGrammarFilters());
  assert.equal(await stored(page, NEAR_KEY), null);
  assert.equal(await page.locator('#near-drill-banner').isVisible(), false);
});

test('最後まで解くと「グラフに戻る」が出て、押すとグラフが開き、通常の続きに戻っている', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = JSON.parse(await stored(page, SESSION_KEY));
  await startNearDrill(page, 'con:');
  // 残りを飛ばして最後へ（描画は本物の関数に任せる）
  await page.evaluate(() => { state.currentGrammarIndex = state.grammarPool.length; renderCurrentGrammar(); });
  await page.locator('.near-drill-back').click();
  await waitFor(page, () => currentAppPage === 'graph');
  assert.equal(await stored(page, NEAR_KEY), null);
  assert.deepEqual(await poolIds(page), session0.grammar.pool);
  assert.deepEqual(JSON.parse(await stored(page, SESSION_KEY)).grammar.pool, session0.grammar.pool, '通常の続きが 30 問で上書きされた');
});

for (const [name, raw] of [
  ['JSON が壊れている', '{'],
  ['ids が配列でない', '{"ids":5}'],
  ['存在しない問題 id', '{"ids":[1,99999999],"index":0}'],
  ['index が範囲の外', '{"ids":[1],"index":7}'],
  ['空の ids', '{"ids":[],"index":0}'],
]) {
  test(`壊れた続き（${name}）でも、通常の出題で始まり、例外は出ない`, async t => {
    const { page } = await open(t, {
      init: { fn: ([k, v]) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem(k, v); } }, arg: [NEAR_KEY, raw] },
    });
    await page.evaluate(() => { setApp('grammar'); switchAppPage('practice'); });
    assert.equal(await page.evaluate(() => state.nearDrill), null);
    assert.ok((await poolIds(page)).length > 1, '通常の出題になっていない');
    assert.equal(await page.locator('#near-drill-banner').count() === 0 || !(await page.locator('#near-drill-banner').isVisible()), true);
  });
}

test('問題・ルール・本のノードからも出題できる（どの種類でも）', async t => {
  const { page } = await open(t);
  for (const prefix of ['book:', 'rule:']) {
    await page.evaluate(() => switchAppPage('graph'));
    await graphReady(page);
    // ルールは中くらいのズームで出る
    if (prefix === 'rule:') await page.evaluate(p => GraphView._debug.focus(GRAMMAR_GRAPH.id.findIndex(s => s.startsWith(p)), 3), prefix);
    await waitFor(page, () => GraphView._debug.pending === false);
    const text = await startNearDrill(page, prefix);
    assert.match(text, /\d+ 問/);
    assert.ok((await poolIds(page)).length >= 1);
  }
});

test('記録の読み込み直し（別のタブの保存・同期・画面に戻る）が、近い問題の出題と通常の続きを変えない（苦手の絞り込み中・未回答）', async t => {
  const { page } = await open(t);
  await page.evaluate(() => { setApp('grammar'); state.grammarWeakFilter = 'weak_unlearned'; applyGrammarFilters(); switchAppPage('practice'); });
  await page.locator('#choices-container button').first().click();
  await page.evaluate(() => switchAppPage('graph'));
  await graphReady(page);
  const session0 = await stored(page, SESSION_KEY);
  const books0 = await stored(page, BOOK_SESSIONS_KEY);
  await startNearDrill(page, 'con:');
  const near0 = await stored(page, NEAR_KEY);
  const ids = await poolIds(page);
  // 実際に読み込み直しが走ったことを確かめる（グラフの更新が、読み込み直しの関数の後に呼ばれる）
  await page.evaluate(() => { window.__reloaded = 0; const f = window.reloadRecordsFromStorage; window.reloadRecordsFromStorage = function () { const r = f.apply(this, arguments); window.__reloaded++; return r; }; });
  await page.evaluate(() => reloadRecordsSavedElsewhere());
  assert.equal(await page.evaluate(() => window.__reloaded), 1, '読み込み直しが走っていない');
  assert.equal(await page.evaluate(() => state.grammarWeakFilter), 'weak_unlearned');
  assert.notEqual(await page.evaluate(() => state.nearDrill), null, '近い問題が捨てられた');
  assert.deepEqual(await poolIds(page), ids);
  assert.equal(await stored(page, NEAR_KEY), near0);
  assert.equal(await stored(page, SESSION_KEY), session0, '通常の続きが書き換わった');
  assert.equal(await stored(page, BOOK_SESSIONS_KEY), books0, '本ごとの続きが書き換わった');
});
