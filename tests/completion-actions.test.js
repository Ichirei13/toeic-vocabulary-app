// 完了画面の「苦手を解く」「復習ページへ」ボタンの検証。
// 実行: NODE_PATH=$(npm root -g) node tests/completion-actions.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

let browser, baseUrl;
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
  try { await fn(page); } finally { await context.close(); }
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// 演習を最後まで解いたことにして、完了画面を出す
async function showCompletion(page, kind) {
  await page.evaluate(k => {
    switchAppPage('practice');
    if (k === 'grammar') {
      setApp('grammar');
      state.currentGrammarIndex = state.grammarPool.length;
      renderCurrentGrammar();
    } else {
      setApp('vocab');
      state.currentIndex = state.pool.length;
      renderCurrent();
    }
  }, kind);
  await page.waitForSelector('#quiz-container .completion-card');
}

for (const kind of ['vocab', 'grammar']) {

  test(`${kind}_completion_shows_solve_weak_and_review_buttons_when_weak_exist`, () => withPage({}, async page => {
    await page.evaluate(([k]) => {
      if (k === 'grammar') state.grammarWeakData[RAW_GRAMMAR[0].id] = { streak: 0, added: 1, due: 1 };
      else wordWeak()[RAW_WORDS[0].w] = { streak: 0, added: 1, due: 1 };
    }, [kind]);
    await showCompletion(page, kind);
    const solve = page.locator('#quiz-container [data-completion-action="solve-weak"]');
    assert.strictEqual(await solve.count(), 1, '苦手を解くボタンが出ていない');
    assert(/苦手を解く（\d+）/.test(await solve.innerText()));
    assert.strictEqual(await page.locator('#quiz-container [data-completion-action="open-review"]').count(), 1);
    // 主ボタンが先、副ボタンが後
    const order = await page.$$eval('#quiz-container [data-completion-action]', els => els.map(e => e.dataset.completionAction));
    assert.deepStrictEqual(order, ['solve-weak', 'open-review']);
  }));

  test(`${kind}_completion_shows_only_review_button_when_no_weak`, () => withPage({}, async page => {
    await showCompletion(page, kind);
    assert.strictEqual(await page.locator('#quiz-container [data-completion-action="solve-weak"]').count(), 0);
    assert.strictEqual(await page.locator('#quiz-container [data-completion-action="open-review"]').count(), 1);
  }));

  test(`${kind}_review_button_opens_the_review_page`, () => withPage({}, async page => {
    await showCompletion(page, kind);
    await page.click('#quiz-container [data-completion-action="open-review"]');
    assert.strictEqual(await page.evaluate(() => currentAppPage), 'review');
    assert(await page.locator('#review-page.active').count() === 1);
  }));

  test(`${kind}_solve_weak_button_starts_the_weak_drill`, () => withPage({}, async page => {
    await page.evaluate(([k]) => {
      if (k === 'grammar') state.grammarWeakData[RAW_GRAMMAR[0].id] = { streak: 0, added: 1, due: 1 };
      else wordWeak()[RAW_WORDS[0].w] = { streak: 0, added: 1, due: 1 };
    }, [kind]);
    await showCompletion(page, kind);
    await page.click('#quiz-container [data-completion-action="solve-weak"]');
    assert.strictEqual(await page.evaluate(() => currentAppPage), 'practice');
    assert.strictEqual(await page.locator('#quiz-container .completion-card').count(), 0, '完了画面のままになっている');
    const filter = await page.evaluate(k => (k === 'grammar' ? state.grammarWeakFilter : state.weakFilter), kind);
    assert.strictEqual(filter, 'weak_only');
  }));
}

(async () => {
  const server = await startServer();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`); }
  }
  if (pageErrors.length) { failed++; console.log(`FAIL page_errors\n     ${pageErrors.slice(0, 5).join('\n     ')}`); }
  await browser.close();
  server.close();
  console.log(`${failed ? 'FAILED' : 'all passed'} (${tests.length} tests)`);
  process.exit(failed ? 1 : 0);
})();
