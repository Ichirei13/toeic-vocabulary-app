// 苦手単語帳PDF（オプションの保存、苦手リストのシートのボタン、印刷用ページの紙面）の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js
// リポジトリ直下を自前の静的サーバで配信し、Playwright(Chromium)で index.html を操作する。
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' };

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

let browser;
let baseUrl;
const pageErrors = [];

async function withPage(storage, fn) {
  const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
  await context.addInitScript(items => {
    try {
      if (sessionStorage.getItem('__test_init')) return;
      sessionStorage.setItem('__test_init', '1');
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) { /* 使えなければ何もしない */ }
  }, storage);
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(baseUrl + '/index.html');
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('wordbook_options_default_to_on', () => withPage({}, async page => {
  const o = await page.evaluate(() => ({ red: state.wordbookRed, test: state.wordbookTest }));
  assert.deepStrictEqual(o, { red: true, test: true });
}));

test('wordbook_options_restore_booleans_and_ignore_garbage', async () => {
  await withPage({ toeic_settings: JSON.stringify({ wordbookRed: false, wordbookTest: 'x' }) }, async page => {
    const o = await page.evaluate(() => ({ red: state.wordbookRed, test: state.wordbookTest }));
    assert.deepStrictEqual(o, { red: false, test: true });
  });
  await withPage({ toeic_settings: JSON.stringify({ wordbookRed: null }) }, async page => {
    assert.strictEqual(await page.evaluate(() => state.wordbookRed), true);
  });
});

test('wordbook_options_are_saved_with_settings', () => withPage({}, async page => {
  await page.evaluate(() => { state.wordbookRed = false; saveSettings(); });
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_settings')).wordbookRed), false);
}));

// 苦手に 2 語を入れて、苦手リストのシートを開く
const seed = page => page.evaluate(() => {
  const t = Date.now();
  state.weakByMode.e2j.affordable = { streak: 0, added: t, due: t, u: t };
  state.weakByMode.e2j.announce = { streak: 0, added: t, due: t, u: t };
  state.weakListMode = 'e2j';
  toggleWeakList();
});
// window.open を、書き込まれた HTML と print() の呼び出しを覚えるものに差し替える
const stubOpen = page => page.evaluate(() => {
  window.__wb = { html: '', printed: false };
  window.open = () => ({
    document: { open() {}, write(h) { window.__wb.html += h; }, close() {} },
    focus() {},
    print() { window.__wb.printed = true; },
  });
});
const click = (page, selector) => page.evaluate(s => document.querySelector(s).click(), selector);
// セルの class 属性だけを見る（<style> には .ja-red のセレクタが常にある）
const hasRedCell = html => /class="ja[^"]*\bja-red\b/.test(html);
const sectionCount = html => (html.match(/<section class="page"/g) || []).length;

test('wordbook_controls_appear_only_when_there_are_weak_words', () => withPage({}, async page => {
  await page.evaluate(() => toggleWeakList());
  const none = await page.evaluate(() => [document.querySelectorAll('[data-wordbook-opt]').length, document.querySelectorAll('[data-wordbook-print]').length]);
  assert.deepStrictEqual(none, [0, 0]);
  await page.evaluate(() => closeSheet());
  await seed(page);
  const some = await page.evaluate(() => [document.querySelectorAll('[data-wordbook-opt]').length, document.querySelectorAll('[data-wordbook-print]').length]);
  assert.deepStrictEqual(some, [2, 1]);
}));

test('wordbook_chips_toggle_and_persist', () => withPage({}, async page => {
  await seed(page);
  for (const [opt, key] of [['red', 'wordbookRed'], ['test', 'wordbookTest']]) {
    await click(page, `[data-wordbook-opt="${opt}"]`);
    assert.strictEqual(await page.evaluate(k => state[k], key), false, `${opt}: state`);
    assert.strictEqual(await page.evaluate(o => document.querySelector(`[data-wordbook-opt="${o}"]`).classList.contains('active'), opt), false, `${opt}: chip`);
    assert.strictEqual(await page.evaluate(k => JSON.parse(localStorage.getItem('toeic_settings'))[k], key), false, `${opt}: saved`);
  }
}));

test('wordbook_print_writes_the_document_and_prints', () => withPage({}, async page => {
  await seed(page);
  await stubOpen(page);
  await click(page, '[data-wordbook-print]');
  await page.waitForTimeout(400);
  const on = await page.evaluate(() => window.__wb);
  assert.ok(on.html.includes('affordable') && on.html.includes('announce'), '語が入っている');
  assert.ok(hasRedCell(on.html), '赤字');
  assert.strictEqual(sectionCount(on.html), 3, '暗記・テスト・答え');
  assert.strictEqual(on.printed, true, 'print() を呼んだ');

  await click(page, '[data-wordbook-opt="test"]');
  await stubOpen(page);
  await click(page, '[data-wordbook-print]');
  await page.waitForTimeout(400);
  assert.strictEqual(sectionCount(await page.evaluate(() => window.__wb.html)), 1, '確認テストなしは1ページ');

  await click(page, '[data-wordbook-opt="red"]');
  await stubOpen(page);
  await click(page, '[data-wordbook-print]');
  await page.waitForTimeout(400);
  assert.ok(!hasRedCell(await page.evaluate(() => window.__wb.html)), '赤字オフ');
}));

test('wordbook_popup_blocked_shows_a_message', () => withPage({}, async page => {
  await seed(page);
  await page.evaluate(() => { window.open = () => null; window.showToast = m => { window.__toast = m; }; });
  await click(page, '[data-wordbook-print]');
  assert.ok((await page.evaluate(() => window.__toast || '')).includes('ポップアップ'));
}));

// 印刷用の HTML を実際に PDF にして、ページ数を数える。あわせて、溢れて切り取られたページ・行の数を測る
// （.page は overflow: hidden なので、溢れてもページは増えず、中身が切り取られる）
const measure = async (page, html) => {
  const sheet = await page.context().newPage();
  try {
    await sheet.emulateMedia({ media: 'print' });
    await sheet.setContent(html);
    const overflow = await sheet.evaluate(() => [
      ...[...document.querySelectorAll('.page, .row')].filter(el => el.scrollHeight > el.clientHeight + 1),
      // 英語が折り返せずに折り線（右の境目）を越えるのも溢れ
      ...[...document.querySelectorAll('.en')].filter(el => el.scrollWidth > el.clientWidth + 1),
    ].length);
    const buf = await sheet.pdf({ preferCSSPageSize: true, printBackground: true });
    return { pages: (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, overflow };
  } finally {
    await sheet.close();
  }
};
const buildHtml = (page, items, options) => page.evaluate(
  ([its, opts]) => StudyCore.buildDocument({ items: its, modeLabel: '英→日', date: '2026-11-05', options: opts }),
  [items, options]);
// 意味が 65 文字（語データの最長）の語を n 個。見出し語も、短いもの・18文字・折り返せない長い1語（14文字）・語データ最長の37文字を混ぜる
const HEADWORDS = ['longword', 'fierce competition', 'recommendation', 'accommodations', 'correspondence', 'Thank you for your inquiry about ...', 'I am pleased to confirm that ...'];
const longItems = n => Array.from({ length: n }, (_, i) => ({
  key: 'longword' + i, entry: { due: i, added: 0 }, word: { w: HEADWORDS[i % HEADWORDS.length], m: '意'.repeat(65), p: '形容詞句' },
}));

test('wordbook_30_long_words_fit_on_exact_pages_without_clipping', () => withPage({}, async page => {
  const cases = [
    [30, { red: true, test: true }, 3, '確認テストあり'],
    [30, { red: true, test: false }, 1, '確認テストなし'],
    [1, { red: true, test: true }, 3, '1語でも3ページ'],
    [31, { red: false, test: true }, 6, '31語は2セット'],
  ];
  for (const [n, options, pages, label] of cases) {
    const r = await measure(page, await buildHtml(page, longItems(n), options));
    assert.deepStrictEqual(r, { pages, overflow: 0 }, label);
  }
}));

test('wordbook_overflow_check_detects_a_broken_layout', () => withPage({}, async page => {
  const broken = (await buildHtml(page, longItems(30), { red: true, test: true })).replace('height: 15mm;', 'height: 40mm;');
  assert.ok((await measure(page, broken)).overflow > 0, '行を高くすると溢れが検出される');
}));

(async () => {
  const server = await startServer();
  baseUrl = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
  if (pageErrors.length) {
    failed++;
    console.log(`FAIL page_errors\n     ${pageErrors.slice(0, 5).join('\n     ')}`);
  }
  await browser.close();
  server.close();
  console.log(`${tests.length - (failed - (pageErrors.length ? 1 : 0))}/${tests.length} tests passed${pageErrors.length ? ', page errors present' : ''}`);
  process.exit(failed ? 1 : 0);
})();
