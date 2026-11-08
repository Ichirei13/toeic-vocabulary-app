// 苦手リストの引き当て（見出し語・問題番号）と描画の検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/weak-list-lookup.test.js
// 速さのために線形探索（find）を索引（Map）に替えても、表示される中身は変わらないことを固定する。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let browser, base;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

async function open(t) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.on('pageerror', e => { throw e; });
  await page.goto(base + '/index.html#home');
  return page;
}

test('見出し語の索引は、RAW_WORDS.find と同じく重複した見出し語の先頭の1件を返す', async t => {
  const page = await open(t);
  const r = await page.evaluate(() => {
    const index = typeof WORD_BY_HEADWORD !== 'undefined' ? WORD_BY_HEADWORD : null;
    if (!index) return { missing: true };
    const mismatches = RAW_WORDS.filter(w => index.get(w.w) !== RAW_WORDS.find(x => x.w === w.w)).map(w => w.w);
    const dupWithDifferentMeaning = RAW_WORDS.filter(w => RAW_WORDS.find(x => x.w === w.w) !== w && RAW_WORDS.find(x => x.w === w.w).m !== w.m).length;
    return { size: index.size, mismatches: mismatches.slice(0, 5), dupWithDifferentMeaning };
  });
  assert.ok(!r.missing, 'WORD_BY_HEADWORD がない');
  assert.deepEqual(r.mismatches, []);
  assert.ok(r.dupWithDifferentMeaning > 0, '意味が違う重複がデータにある前提（先頭を取る意味がある）');
});

test('単語の苦手リストは、重複した見出し語でも先頭の1件の意味を出し、並びも変わらない', async t => {
  const page = await open(t);
  const r = await page.evaluate(() => {
    state.app = 'vocab';
    state.weakListMode = 'e2j';
    state.weakSort = 'order';
    const now = Date.now();
    // 意味が違う重複を数件、重複のない語を数件、データにない語を1件入れる
    const dups = [...new Set(RAW_WORDS.filter(w => RAW_WORDS.find(x => x.w === w.w) !== w).map(w => w.w))].slice(0, 5);
    const singles = RAW_WORDS.filter(w => RAW_WORDS.filter(x => x.w === w.w).length === 1).slice(0, 5).map(w => w.w);
    const keys = [...dups, ...singles, '__not_in_data__'];
    const data = wordWeak('e2j');
    Object.keys(data).forEach(k => delete data[k]);
    keys.forEach((k, i) => { data[k] = { streak: i % 2, added: now - i * 1000, due: now - 1000, u: now }; });
    renderWeakList();
    const shown = [...document.querySelectorAll('#weak-list-content .weak-item')].map(el => ({
      word: el.querySelector('.weak-word').firstChild.textContent.trim(),
      meaning: el.querySelector('.weak-meaning').textContent,
    }));
    const expected = keys
      .map(k => ({ k, word: RAW_WORDS.find(x => x.w === k) }))
      .filter(x => x.word)
      .sort((a, b) => a.k.localeCompare(b.k, 'en', { sensitivity: 'base' }))
      .map(x => ({ word: x.word.w, meaning: x.word.m }));
    return { shown, expected };
  });
  assert.equal(r.expected.length, 10);
  assert.deepEqual(r.shown, r.expected);
});

test('文法の苦手リストは、問題番号の順と中身が変わらない', async t => {
  const page = await open(t);
  const r = await page.evaluate(() => {
    state.app = 'grammar';
    state.weakSort = 'order';
    const now = Date.now();
    const picks = RAW_GRAMMAR.filter((_, i) => i % 97 === 0).slice(0, 8);
    Object.keys(state.grammarWeakData).forEach(k => delete state.grammarWeakData[k]);
    picks.forEach((g, i) => { state.grammarWeakData[g.id] = { streak: 0, added: now - i * 1000, due: now - 1000, u: now }; });
    state.grammarWeakData['999999'] = { streak: 0, added: now, due: now, u: now }; // データにない番号
    renderWeakList();
    const shownIds = [...document.querySelectorAll('#weak-list-content [data-remove-weak]')].map(el => Number(el.dataset.removeWeak));
    const expectedIds = picks.map(g => g.id).sort((a, b) => {
      const ga = RAW_GRAMMAR.find(g => g.id === a), gb = RAW_GRAMMAR.find(g => g.id === b);
      const order = ex => { const i = GRAMMAR_BOOK_IDS.indexOf(bookOf(ex)); return i >= 0 ? i : 99; };
      return order(ga) - order(gb) || ga.ch - gb.ch || ga.id - gb.id;
    });
    return { shownIds, expectedIds, hasUnknown: shownIds.includes(999999) };
  });
  assert.deepEqual(r.shownIds, r.expectedIds);
  assert.equal(r.hasUnknown, false);
});

test('苦手リストの項目は、画面の外を後回しにして描画する（content-visibility）', async t => {
  const page = await open(t);
  const r = await page.evaluate(() => {
    state.app = 'vocab';
    state.weakListMode = 'e2j';
    const now = Date.now();
    const data = wordWeak('e2j');
    Object.keys(data).forEach(k => delete data[k]);
    RAW_WORDS.slice(0, 30).forEach((w, i) => { data[w.w] = { streak: 0, added: now - i, due: now, u: now }; });
    renderWeakList();
    const el = document.querySelector('#weak-list-content .weak-item');
    const cs = getComputedStyle(el);
    return { cv: cs.contentVisibility, intrinsic: cs.containIntrinsicSize };
  });
  assert.equal(r.cv, 'auto');
  assert.notEqual(r.intrinsic, 'none');
});
