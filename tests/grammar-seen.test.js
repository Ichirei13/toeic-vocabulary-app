// 文法の出題済み記録・「苦手+未」絞り込み・バックアップ(版4)の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js
// リポジトリ直下を自前の静的サーバで配信し、Playwright(Chromium)で index.html を操作する。
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' };

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
const consoleErrors = [];

// storage の中身を localStorage に入れてから index.html を開く。再読み込みでは入れ直さない
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
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(baseUrl + '/index.html');
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

// 「300問以上」のナッジが開いていたら閉じる
async function dismissNudge(page) {
  await page.evaluate(() => {
    const m = document.getElementById('filter-nudge-modal');
    if (m && m.classList.contains('open')) dismissNudge();
  });
}

async function openGrammar(page) {
  await dismissNudge(page);
  await page.click('.app-type-segments .segment[data-app="grammar"]');
  await dismissNudge(page);
}

const sortedNums = arr => [...arr].map(Number).sort((a, b) => a - b);
const WEAK_ENTRY = '{"streak":0,"added":1,"due":1}';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ==================== Task 1: 出題済みの記録 ====================

test('seed_from_stats_and_weak', () => withPage({
  toeic_grammar_stats: '{"5":{"a":2,"c":1}}',
  toeic_weak_grammar: `{"9":${WEAK_ENTRY}}`,
}, async page => {
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_seen_grammar')));
  assert.deepStrictEqual(sortedNums(saved), [5, 9]);
  assert.strictEqual(await page.evaluate(() => state.grammarSeen.size), 2);
}));

test('no_reseed_when_present', () => withPage({
  toeic_seen_grammar: '[]',
  toeic_grammar_stats: '{"5":{"a":2,"c":1}}',
  toeic_weak_grammar: `{"9":${WEAK_ENTRY}}`,
}, async page => {
  assert.strictEqual(await page.evaluate(() => state.grammarSeen.size), 0);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('toeic_seen_grammar')), '[]');
}));

test('no_seed_when_corrupt', () => withPage({
  toeic_seen_grammar: '{"a":1}',
  toeic_grammar_stats: '{"5":{"a":2,"c":1}}',
}, async page => {
  assert.strictEqual(await page.evaluate(() => state.grammarSeen.size), 0);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('toeic_seen_grammar')), '{"a":1}');
}));

test('record_on_answer', () => withPage({}, async page => {
  await openGrammar(page);
  const id = await page.evaluate(() => state.grammarPool[state.currentGrammarIndex].id);
  assert.strictEqual(await page.evaluate(i => state.grammarSeen.has(i), id), false);
  await page.click('#choices-container .choice-btn >> nth=0');
  assert.strictEqual(await page.evaluate(i => state.grammarSeen.has(i), id), true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_seen_grammar')));
  assert(saved.includes(id), 'saved list has the answered id');
}));

test('record_on_dont_know', () => withPage({}, async page => {
  await openGrammar(page);
  const id = await page.evaluate(() => state.grammarPool[state.currentGrammarIndex].id);
  await page.click('#dont-know-btn');
  assert.strictEqual(await page.evaluate(i => state.grammarSeen.has(i), id), true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_seen_grammar')));
  assert(saved.includes(id));
}));

// ==================== 実行 ====================

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
  if (consoleErrors.length) {
    failed++;
    console.log(`FAIL console_errors\n     ${consoleErrors.slice(0, 5).join('\n     ')}`);
  }
  await browser.close();
  server.close();
  console.log(`${tests.length - (failed - (consoleErrors.length ? 1 : 0))}/${tests.length} tests passed${consoleErrors.length ? ', console errors present' : ''}`);
  process.exit(failed ? 1 : 0);
})();
