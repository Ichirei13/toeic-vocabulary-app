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

// ==================== Task 2: 「苦手+未」の絞り込み ====================

// localStorage を書き換えて読み込み直す(withPage の初期設定は再読み込みでは入れ直さない)
async function setStorageAndReload(page, items) {
  await page.evaluate(it => Object.entries(it).forEach(([k, v]) => localStorage.setItem(k, v)), items);
  await page.reload();
}

const allGrammarIds = page => page.evaluate(() => RAW_GRAMMAR.map(g => g.id));

test('filter_weak_unlearned_pool', () => withPage({}, async page => {
  const all = await allGrammarIds(page);
  const [a, b, c] = all;
  await setStorageAndReload(page, {
    toeic_seen_grammar: JSON.stringify([a, b, c]),
    toeic_weak_grammar: JSON.stringify({ [b]: JSON.parse(WEAK_ENTRY) }),
  });
  await openGrammar(page);
  await page.evaluate(() => { state.grammarWeakFilter = 'weak_unlearned'; applyGrammarFilters(); });
  const pool = await page.evaluate(() => state.grammarPool.map(g => g.id));
  assert.deepStrictEqual(sortedNums(pool), sortedNums(all.filter(i => i !== a && i !== c)));
}));

test('filter_segment_click', () => withPage({}, async page => {
  await openGrammar(page);
  await page.click('#filter-toggle');
  const order = await page.$$eval('#grammar-weak-segments .segment', els => els.map(e => e.dataset.gweak));
  assert.deepStrictEqual(order, ['all', 'weak_unlearned', 'weak_only', 'due']);
  await page.click('#grammar-weak-segments [data-gweak="weak_unlearned"]');
  assert.strictEqual(await page.evaluate(() => state.grammarWeakFilter), 'weak_unlearned');
  assert(await page.$eval('#grammar-weak-segments [data-gweak="weak_unlearned"]', e => e.classList.contains('active')));
}));

test('filter_empty_pool', () => withPage({}, async page => {
  const all = await allGrammarIds(page);
  await setStorageAndReload(page, { toeic_seen_grammar: JSON.stringify(all), toeic_weak_grammar: '{}' });
  await openGrammar(page);
  await page.evaluate(() => { state.grammarWeakFilter = 'weak_unlearned'; applyGrammarFilters(); });
  assert(/条件に合う文法問題がありません/.test(await page.innerText('#quiz-container')));
}));

test('filter_persists', () => withPage({}, async page => {
  await openGrammar(page);
  await page.evaluate(() => { state.grammarWeakFilter = 'weak_unlearned'; applyGrammarFilters(); });
  await page.reload();
  assert.strictEqual(await page.evaluate(() => state.grammarWeakFilter), 'weak_unlearned');
  await setStorageAndReload(page, { toeic_settings: JSON.stringify({ app: 'grammar', grammarWeakFilter: 'bogus' }) });
  assert.strictEqual(await page.evaluate(() => state.grammarWeakFilter), 'all');
}));

// ==================== Task 3: バックアップ(版4) ====================

// 版 format のバックアップファイルの中身を作る。data の項目は overrides で足す・消す(undefined で消す)
function backupText(format, overrides = {}, extra = {}) {
  const data = { weakWords: {}, weakGrammar: {}, seenWords: {}, wordStats: {}, grammarStats: {}, ...overrides };
  Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; });
  return JSON.stringify({ app: 'toeic-drill', format, exportedAt: '2026-10-26T00:00:00Z', data, ...extra });
}
const parse = (page, text) => page.evaluate(t => JSON.parse(JSON.stringify(parseBackup(t))), text);
const WEAK9 = { 9: JSON.parse(WEAK_ENTRY) };
const STATS5 = { 5: { a: 1, c: 1 } };

test('build_has_seen_grammar', () => withPage({}, async page => {
  const b = await page.evaluate(() => { state.grammarSeen = new Set([4, 7]); return buildBackup(); });
  assert.strictEqual(b.format, 4);
  assert.deepStrictEqual(sortedNums(b.data.seenGrammar), [4, 7]);
}));

test('migrate_v3', () => withPage({}, async page => {
  const r = await parse(page, backupText(3, { weakGrammar: WEAK9, grammarStats: STATS5 }));
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(sortedNums(r.records.seenGrammar), [5, 9]);
}));

test('migrate_v3_partial', () => withPage({}, async page => {
  const variants = [
    { weakGrammar: WEAK9, grammarStats: undefined },
    { weakGrammar: {}, grammarStats: STATS5 },
    { weakGrammar: {}, grammarStats: {} },
  ];
  for (const v of variants) {
    const r = await parse(page, backupText(3, v));
    assert.strictEqual(r.ok, true, `${JSON.stringify(v)}: ${r.error}`);
  }
  const r = await parse(page, backupText(3, { weakGrammar: WEAK9, grammarStats: undefined }));
  assert.deepStrictEqual(sortedNums(r.records.seenGrammar), [9]);
}));

test('compat_toeic_practice_backup', () => withPage({}, async page => {
  const text = JSON.stringify({
    app: 'toeic_practice_backup',
    data: { weakWords: {}, weakGrammar: WEAK9, seenWords: [], wordStats: {}, grammarStats: STATS5 },
  });
  const r = await parse(page, text);
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(sortedNums(r.records.seenGrammar), [5, 9]);
}));

test('v4_requires_array', () => withPage({}, async page => {
  for (const seenGrammar of [undefined, 'x', { a: 1 }]) {
    const r = await parse(page, backupText(4, { seenGrammar }));
    assert.strictEqual(r.ok, false, `seenGrammar=${JSON.stringify(seenGrammar)} should be rejected`);
    assert(/文法の出題済み/.test(r.error), r.error);
  }
}));

test('v4_sanitize', () => withPage({}, async page => {
  const r = await parse(page, backupText(4, { seenGrammar: [3, 3, '4', -1, 2.5, {}, 8] }));
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(sortedNums(r.records.seenGrammar), [3, 8]);
  assert.strictEqual(r.invalid, 5);
}));

test('roundtrip_v4', () => withPage({}, async page => {
  const text = await page.evaluate(() => { state.grammarSeen = new Set([2, 11, 40]); return JSON.stringify(buildBackup()); });
  const r = await parse(page, text);
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(sortedNums(r.records.seenGrammar), [2, 11, 40]);
}));

test('v5_rejected', () => withPage({}, async page => {
  const r = await parse(page, backupText(5, { seenGrammar: [] }));
  assert.strictEqual(r.ok, false);
  assert(/新しいバージョン/.test(r.error), r.error);
}));

// ==================== Task 4: 復元・取り消し・件数の表示 ====================

// 復元を実行する。text は版4/版3のバックアップ本文、mode は 'merge' か 'overwrite'
async function restoreText(page, text, mode) {
  await page.evaluate(([t, m]) => {
    backupView = { step: 'confirm', pending: parseBackup(t), restoreMode: m, fileName: 'test' };
    runRestore();
  }, [text, mode]);
}
const seenNow = page => page.evaluate(() => [...state.grammarSeen]);
const seenSaved = page => page.evaluate(() => JSON.parse(localStorage.getItem('toeic_seen_grammar')));
const setSeen = (page, ids) => page.evaluate(i => { state.grammarSeen = new Set(i); saveGrammarSeen(); }, ids);

test('merge_union', () => withPage({}, async page => {
  const r = await page.evaluate(() => mergeSeenGrammar([1, 2], [2, 3]));
  assert.deepStrictEqual(sortedNums(r), [1, 2, 3]);
}));

test('restore_merge', () => withPage({}, async page => {
  await setSeen(page, [1]);
  await restoreText(page, backupText(4, { seenGrammar: [2] }), 'merge');
  assert.deepStrictEqual(sortedNums(await seenNow(page)), [1, 2]);
  assert.deepStrictEqual(sortedNums(await seenSaved(page)), [1, 2]);
}));

test('restore_overwrite', () => withPage({}, async page => {
  await setSeen(page, [1]);
  await restoreText(page, backupText(4, { seenGrammar: [2] }), 'overwrite');
  assert.deepStrictEqual(sortedNums(await seenNow(page)), [2]);
  // ファイルが空の記録なら空のまま。成績があっても初期値を作り直さない
  await page.evaluate(() => { state.grammarStats = { 5: { a: 1, c: 1 } }; saveJSON(GRAMMAR_STATS_KEY, state.grammarStats); });
  await restoreText(page, backupText(4, { seenGrammar: [] }), 'overwrite');
  assert.deepStrictEqual(await seenNow(page), []);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('toeic_seen_grammar')), '[]');
}));

test('restore_v3_file', () => withPage({}, async page => {
  const v3 = backupText(3, { weakGrammar: WEAK9, grammarStats: STATS5 });
  await setSeen(page, [1]);
  await restoreText(page, v3, 'merge');
  assert.deepStrictEqual(sortedNums(await seenNow(page)), [1, 5, 9]);
  await restoreText(page, v3, 'overwrite');
  assert.deepStrictEqual(sortedNums(await seenNow(page)), [5, 9]);
}));

test('undo_restores_absent_key', () => withPage({ toeic_grammar_stats: JSON.stringify(STATS5) }, async page => {
  await page.evaluate(() => localStorage.removeItem('toeic_seen_grammar'));
  await restoreText(page, backupText(4, { seenGrammar: [2] }), 'overwrite');
  assert.deepStrictEqual(await seenNow(page), [2]);
  await page.evaluate(() => runUndo());
  // 復元前は保存が無かったので、読み込み時に成績から初期値が作り直される
  assert.deepStrictEqual(sortedNums(await seenNow(page)), [5]);
  assert.deepStrictEqual(sortedNums(await seenSaved(page)), [5]);
}));

test('undo_legacy_record_without_seen_key', () => withPage({ toeic_grammar_stats: JSON.stringify(STATS5) }, async page => {
  // この機能より前に残した取り消し用の記録には、出題済みのキーが無い
  await page.evaluate(() => {
    const records = Object.fromEntries(RECORD_STORAGE_KEYS.filter(k => k !== GRAMMAR_SEEN_KEY).map(k => [k, null]));
    records[GRAMMAR_STATS_KEY] = JSON.stringify({ 5: { a: 1, c: 1 } });
    localStorage.setItem('toeic_backup_undo', JSON.stringify({ savedAt: Date.now(), records }));
    state.grammarSeen = new Set([2]);
    saveGrammarSeen();
    runUndo();
  });
  assert.notStrictEqual(await page.evaluate(() => localStorage.getItem('toeic_seen_grammar')), 'undefined');
  assert.deepStrictEqual(sortedNums(await seenNow(page)), [5]);
}));

test('counts_and_table', () => withPage({}, async page => {
  await setSeen(page, [1, 2, 3]);
  const r = await page.evaluate(() => ({
    now: currentCounts().grammarSeen,
    missing: countsFromRaw({}).grammarSeen,
    corrupt: countsFromRaw({ toeic_seen_grammar: '{{' }).grammarSeen,
    raw: countsFromRaw({ toeic_seen_grammar: '[4,5]' }).grammarSeen,
    html: backupConfirmHtml({ pending: parseBackup(JSON.stringify(buildBackup())), fileName: 'x', restoreMode: 'merge' }),
  }));
  assert.deepStrictEqual([r.now, r.missing, r.corrupt, r.raw], [3, 0, 0, 2]);
  assert(/出題済みの文法<\/td><td>3問<\/td><td>3問/.test(r.html), 'table row with both counts');
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
