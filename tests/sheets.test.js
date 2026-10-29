// 下から出るシート（バックアップ・苦手リスト）の行き来と、廃止した旧い設定シートの検証。
// 実行: NODE_PATH=$(npm root -g) node tests/sheets.test.js
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

const sheetState = page => page.evaluate(() => ({
  open: document.getElementById('bottom-sheet').classList.contains('open'),
  overlay: document.getElementById('sheet-overlay').classList.contains('open'),
  title: document.getElementById('sheet-title').textContent,
  page: currentAppPage,
}));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('backup_back_from_the_settings_page_returns_to_the_settings_page', () => withPage({}, async page => {
  await page.evaluate(() => { switchAppPage('settings'); openBackupFromSettings(); });
  const opened = await sheetState(page);
  assert.strictEqual(opened.open, true);
  assert.strictEqual(opened.title, '学習記録のバックアップ');
  await page.evaluate(() => document.querySelector('#weak-list-content .backup-back').click());
  const after = await sheetState(page);
  assert.strictEqual(after.open, false, 'シートが閉じていない（別のシートが開いた）: ' + after.title);
  assert.strictEqual(after.overlay, false);
  assert.strictEqual(after.page, 'settings');
  assert.strictEqual(await page.evaluate(() => !!document.getElementById('setting-goal') && document.getElementById('settings-page').classList.contains('active')), true, '設定ページが見えている');
}));

test('backup_back_from_the_weak_list_still_returns_to_the_weak_list', () => withPage({}, async page => {
  await page.evaluate(() => { backupSource = 'weak'; handleBackupAction('open'); });
  assert.strictEqual((await sheetState(page)).title, '学習記録のバックアップ');
  await page.evaluate(() => handleBackupAction('back'));
  const after = await sheetState(page);
  assert.strictEqual(after.open, true);
  assert(/苦手リスト/.test(after.title), after.title);
}));

test('backup_sheet_can_be_reopened_after_going_back', () => withPage({}, async page => {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => { switchAppPage('settings'); openBackupFromSettings(); });
    assert.strictEqual((await sheetState(page)).open, true, `${i + 1} 回目に開かない`);
    await page.evaluate(() => handleBackupAction('back'));
    assert.strictEqual((await sheetState(page)).open, false);
  }
}));

test('old_settings_sheet_is_gone', () => withPage({}, async page => {
  const r = await page.evaluate(() => ({
    toggleSettings: typeof toggleSettings,
    toggleDataManager: typeof toggleDataManager,
    renderSettingsSheet: typeof renderSettingsSheet,
  }));
  assert.deepStrictEqual(r, { toggleSettings: 'undefined', toggleDataManager: 'undefined', renderSettingsSheet: 'undefined' });
}));

test('theme_change_on_the_settings_page_still_works', () => withPage({}, async page => {
  await page.evaluate(() => switchAppPage('settings'));
  await page.evaluate(() => { document.querySelectorAll('.settings-theme-card')[4].click(); }); // フォレスト
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'forest');
  // 選んだテーマが、設定ページの印とホームにも反映される
  assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.settings-theme-card.active').length), 1);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('toeic_app_theme')), 'forest');
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
