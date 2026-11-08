// PC のサイドバー下部の「同期」ボタン（Google ドライブとワンタップ同期）の検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/sidebar-sync.test.js
// 実際の Google には一切通信しない（googleapis.com / accounts.google.com へのリクエストは abort し、1 件も出ていないことを確かめる）。
// 注: js/gdrive.js の `const saveToGoogleDrive = syncWithGoogleDrive` は const なので window のプロパティではなく、差し替えられない。
//     そこで一段下の getGoogleAccessToken(interactive)（function 宣言＝window のプロパティ）を数える関数に差し替える。
//     saveToGoogleDrive({interactive:true}) は必ず getGoogleAccessToken(true) を 1 回呼ぶので、これで「1 回・interactive:true」を確かめられる。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const PHONE = { width: 375, height: 812 };
const PC = { width: 1280, height: 800 };
const SHOTS = process.env.SIDEBAR_SYNC_SHOTS;

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

async function open(t, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  t.after(() => assert.deepEqual(errors.map(String), [], 'ページで例外が出た'));
  const google = [];
  await page.route(/(googleapis\.com|accounts\.google\.com)/, route => { google.push(route.request().url()); route.abort(); });
  t.after(() => {
    // 起動時の gsi/client の読み込みは index.html の既存の <script>（abort される）。同期ボタンが出した通信だけを見る
    assert.deepEqual(google.filter(u => !u.includes('/gsi/client')), [], 'Google への通信が出た');
  });
  await page.goto(base + '/index.html#home');
  await page.waitForSelector('.top-page-nav');
  return page;
}

// getGoogleAccessToken を、呼び出しの引数を記録して null を返す関数に差し替える（null ＝ 未ログインでトーストを出して終わる）
async function stubToken(page) {
  await page.evaluate(() => {
    window.__tokenCalls = [];
    window.getGoogleAccessToken = (interactive) => { window.__tokenCalls.push(interactive); return Promise.resolve(null); };
  });
}
const tokenCalls = page => page.evaluate(() => window.__tokenCalls);
const box = (page, sel) => page.locator(sel).boundingBox();

test('幅 1280 ではサイドバー内の最後のタブの下に出て、タブ列の外にある', async (t) => {
  const page = await open(t, PC);
  const btn = page.locator('.top-sync-btn');
  assert.equal(await btn.count(), 1);
  assert.ok(await btn.isVisible(), 'PC 幅で見える');
  assert.equal(await btn.getAttribute('aria-label'), 'Google ドライブと同期');
  assert.equal(await btn.getAttribute('type'), 'button');
  assert.equal(await btn.getAttribute('role'), null, 'タブではない');
  assert.equal(await page.locator('.top-page-tabs .top-sync-btn').count(), 0, 'タブ列の中にはない');
  assert.equal(await page.locator('.top-page-tabs [role="tab"]').count(), 6, 'タブの数は変わらない');
  assert.equal(await page.locator('.top-page-nav > .top-sync-btn').count(), 1, 'サイドバーの直下の子');
  const nav = await box(page, '.top-page-nav');
  const b = await box(page, '.top-sync-btn');
  const lastTab = await box(page, '.top-page-tab[data-page="settings"]');
  assert.ok(b.x >= nav.x && b.y >= nav.y && b.x + b.width <= nav.x + nav.width && b.y + b.height <= nav.y + nav.height, 'サイドバーの枠の中');
  assert.ok(b.y >= lastTab.y + lastTab.height, '最後のタブより下');
  assert.ok(nav.y + nav.height - (b.y + b.height) < 40, 'サイドバーの下端に寄っている');
  assert.ok(b.height >= 44, 'タップしやすい高さ');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'pc-light.png') });
});

test('幅 375 では表示されず、フォーカスもできない', async (t) => {
  const page = await open(t, PHONE);
  assert.equal(await page.locator('.top-sync-btn').count(), 1);
  assert.equal(await page.locator('.top-sync-btn').evaluate(el => getComputedStyle(el).display), 'none');
  assert.ok(!(await page.locator('.top-sync-btn').isVisible()));
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('top-sync-btn')), false);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone.png') });
});

test('幅 999 は出ず、1000 で出る', async (t) => {
  const page = await open(t, { width: 999, height: 800 });
  assert.ok(!(await page.locator('.top-sync-btn').isVisible()));
  await page.setViewportSize({ width: 1000, height: 800 });
  assert.ok(await page.locator('.top-sync-btn').isVisible());
});

test('クリックで同期が 1 回、interactive:true で呼ばれる。保存の中身は変わらない', async (t) => {
  const page = await open(t, PC);
  await stubToken(page);
  const activeBefore = await page.evaluate(() => document.querySelector('.top-page-tab.active').dataset.page);
  const before = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await page.locator('.top-sync-btn').click();
  await page.waitForFunction(() => window.__tokenCalls.length >= 1);
  await page.waitForTimeout(200);
  assert.deepEqual(await tokenCalls(page), [true]);
  assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), before, 'localStorage は 1 バイトも変わらない');
  assert.equal(await page.evaluate(() => document.querySelector('.top-page-tab.active').dataset.page), activeBefore, 'ページは切り替わらない');
});

test('キーボード（Enter / Space）でも同じ呼び出しが 1 回ずつ', async (t) => {
  const page = await open(t, PC);
  await stubToken(page);
  await page.locator('.top-sync-btn').focus();
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('top-sync-btn')), true, 'フォーカスできる');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__tokenCalls.length === 1);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__tokenCalls.length === 2);
  await page.waitForTimeout(200);
  assert.deepEqual(await tokenCalls(page), [true, true]);
});

test('Tab キーで最後のタブの次にフォーカスが来る', async (t) => {
  const page = await open(t, PC);
  await page.locator('.top-page-tab[data-page="settings"]').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('top-sync-btn')), true);
});

test('連打: ボタンはクリックごとに呼ぶ（重複の除外は同期関数側）', async (t) => {
  const page = await open(t, PC);
  await stubToken(page);
  await page.locator('.top-sync-btn').dblclick();
  await page.waitForFunction(() => window.__tokenCalls.length === 2);
  assert.deepEqual(await tokenCalls(page), [true, true]);
});

test('本物の syncWithGoogleDrive: 1 回目が進行中の間は 2 回目が通信もログインも始めない', async (t) => {
  const page = await open(t, PC);
  await page.evaluate(() => {
    window.__tokenCalls = [];
    window.__fetches = [];
    window.getGoogleAccessToken = (interactive) => { window.__tokenCalls.push(interactive); return Promise.resolve('fake-token'); };
    // fetch はページの外へ出さない。最初の 1 回は止めたままにして、あとで失敗させて終わらせる
    window.__release = null;
    window.fetch = (url) => {
      window.__fetches.push(String(url));
      return new Promise((_, reject) => { window.__release = () => reject(new Error('stub')); });
    };
  });
  await page.locator('.top-sync-btn').click();
  await page.waitForFunction(() => window.__fetches.length === 1);
  assert.equal(await page.evaluate(() => gdriveIsSyncing), true, '進行中');
  await page.locator('.top-sync-btn').click();
  await page.locator('.top-sync-btn').click();
  await page.waitForTimeout(300);
  assert.deepEqual(await tokenCalls(page), [true], '進行中の 2 回目以降はトークンも取りに行かない');
  assert.equal(await page.evaluate(() => window.__fetches.length), 1, '通信は 1 回だけ');
  await page.evaluate(() => window.__release());
  await page.waitForFunction(() => gdriveIsSyncing === false);
  // 終わったら次の同期が通る
  await page.locator('.top-sync-btn').click();
  await page.waitForFunction(() => window.__fetches.length === 2);
  await page.evaluate(() => window.__release());
  await page.waitForFunction(() => gdriveIsSyncing === false);
});

test('どのテーマでも見える（スクリーンショット用）', async (t) => {
  const page = await open(t, PC);
  for (const theme of ['ios', 'ink', 'navy', 'forest', 'nordic', 'duolingo', 'quizlet', 'light']) {
    await page.evaluate((th) => { document.documentElement.setAttribute('data-theme', th); }, theme);
    assert.ok(await page.locator('.top-sync-btn').isVisible(), theme);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `pc-${theme}.png`), clip: { x: 0, y: 0, width: 420, height: 800 } });
  }
});
