// 文法の出題済み記録・「苦手+未」絞り込み・バックアップ(版4)の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js
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
  assert.strictEqual(b.format, 6); // 版6: 日別の学習記録・表示設定つき（Drive 用の書き出しだけ版5のまま）
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
  assert.strictEqual(r.invalid, 4); // 重複は形の不正に数えない(単語側と同じ)
}));

test('dup_not_invalid', () => withPage({}, async page => {
  const r = await parse(page, backupText(4, { seenGrammar: [3, 3] }));
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.records.seenGrammar, [3]);
  assert.strictEqual(r.invalid, 0);
}));

test('roundtrip_v4', () => withPage({}, async page => {
  const text = await page.evaluate(() => { state.grammarSeen = new Set([2, 11, 40]); return JSON.stringify(buildBackup()); });
  const r = await parse(page, text);
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(sortedNums(r.records.seenGrammar), [2, 11, 40]);
}));

test('v7_future_rejected', () => withPage({}, async page => {
  const r = await parse(page, backupText(7, { seenGrammar: [] }));
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
  // ファイルが空の記録なら空のまま。ファイルに成績があっても初期値を作り直さない
  await restoreText(page, backupText(4, { seenGrammar: [], grammarStats: STATS5 }), 'overwrite');
  assert.deepStrictEqual(Object.keys(await page.evaluate(() => state.grammarStats)), ['5']);
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

// ==================== Minor の修正 ====================

// Minor 1: 取り消し用の記録に出題済みが無いとき、比較表には取り消し後に作り直される件数を出す
test('undo_table_estimates_reseed', () => withPage({}, async page => {
  const counts = await page.evaluate(([stats, weak]) => {
    const base = { [RECORD_KEYS.grammarStats]: JSON.stringify(stats), [RECORD_KEYS.weakGrammar]: JSON.stringify(weak) };
    return {
      absent: countsFromRaw(base).grammarSeen,
      nulled: countsFromRaw({ ...base, [RECORD_KEYS.seenGrammar]: null }).grammarSeen,
      empty: countsFromRaw({ ...base, [RECORD_KEYS.seenGrammar]: '[]' }).grammarSeen,
      listed: countsFromRaw({ ...base, [RECORD_KEYS.seenGrammar]: '[4,5,6]' }).grammarSeen,
    };
  }, [STATS5, WEAK9]);
  assert.deepStrictEqual(counts, { absent: 2, nulled: 2, empty: 0, listed: 3 });
}));

// Minor 2: 版3以前・互換形式の初期値は、形の正しくない成績・苦手を除いたものから作る
test('migrate_seed_ignores_malformed', () => withPage({}, async page => {
  const stats = { 5: { a: 0 }, 6: { a: 1, c: 1 } };
  const weak = { 9: 'junk', 10: JSON.parse(WEAK_ENTRY) };
  const r3 = await parse(page, backupText(3, { grammarStats: stats, weakGrammar: weak }));
  assert.deepStrictEqual(sortedNums(r3.records.seenGrammar), [6, 10]);
  const compat = await parse(page, JSON.stringify({
    app: 'toeic_practice_backup', data: { weakWords: {}, weakGrammar: weak, seenWords: [], wordStats: {}, grammarStats: stats },
  }));
  assert.deepStrictEqual(sortedNums(compat.records.seenGrammar), [6, 10]);
}));

// Minor 3: 番号の基準は苦手リストのキー(9桁まで)と同じにそろえる
test('seen_id_bounds', () => withPage({ toeic_seen_grammar: '[1e300, 1000000000, 7]' }, async page => {
  assert.deepStrictEqual(await seenNow(page), [7]);
  const r = await parse(page, backupText(4, { seenGrammar: [1e15, 999999999, 7] }));
  assert.deepStrictEqual(sortedNums(r.records.seenGrammar), [7, 999999999]);
  assert.strictEqual(r.invalid, 1);
}));

// Minor 5: バックアップのホーム画面に出題済みの文法を出す
test('home_shows_seen', () => withPage({}, async page => {
  await setSeen(page, [1, 2, 3]);
  const html = await page.evaluate(() => backupHomeHtml({}));
  assert(/出題済みの文法<\/td><td>3問<\/td>/.test(html), 'table row on home');
  assert(/出題済みの文法/.test(html.split('保存します')[0].split('<div class="backup-note">').pop()), 'description mentions it');
}));

// Minor 6: 今のデータに無い番号の注記に、出題済みの分も含める(苦手と重なる番号は1件と数える)
test('unknown_note_counts_seen', () => withPage({}, async page => {
  const known = (await allGrammarIds(page))[0];
  const r = await parse(page, backupText(4, {
    seenGrammar: [known, 999999998, 999999999],
    weakGrammar: { 999999999: JSON.parse(WEAK_ENTRY) },
  }));
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.unknownGrammar, 2);
}));

// ==================== 同期: 苦手の削除・新旧の判定・再描画ループ(版5) ====================

const DAY = 86400000;
// 同期の統合の単体テスト用。local/remote の記録を渡して mergeBackupRecords の結果を返す
const mergeRecords = (page, local, remote) => page.evaluate(([l, r]) => {
  const base = { weakWords: { e2j: {}, j2e: {}, flash: {}, type: {} }, weakGrammar: {}, seenWords: {}, wordStats: {}, grammarStats: {}, seenGrammar: [], weakDeleted: {} };
  return JSON.parse(JSON.stringify(mergeBackupRecords({ ...base, ...l }, { ...base, ...r })));
}, [local, remote]);
const entry = (streak, due, u) => ({ streak, added: 1, due, ...(u === undefined ? {} : { u }) });

test('sync_mastered_word_stays_deleted', () => withPage({}, async page => {
  const now = Date.now();
  const m = await mergeRecords(page,
    { weakDeleted: { 'w:e2j:margin': now } },
    { weakWords: { e2j: { margin: entry(2, now - 1000) } } }); // クラウドは古い版(u なし)
  assert.strictEqual(m.weakWords.e2j.margin, undefined);
  assert.strictEqual(m.weakDeleted['w:e2j:margin'], now);
}));

test('sync_mastered_grammar_stays_deleted', () => withPage({}, async page => {
  const now = Date.now();
  const m = await mergeRecords(page,
    { weakDeleted: { 'g:9': now } },
    { weakGrammar: { 9: entry(1, now, now - 5000) } });
  assert.strictEqual(m.weakGrammar[9], undefined);
}));

test('sync_deletion_propagates_from_remote', () => withPage({}, async page => {
  const now = Date.now();
  const m = await mergeRecords(page,
    { weakWords: { e2j: { margin: entry(1, now, now - 5000) } } },
    { weakDeleted: { 'w:e2j:margin': now } });
  assert.strictEqual(m.weakWords.e2j.margin, undefined);
}));

test('sync_relearned_after_delete_wins', () => withPage({}, async page => {
  const now = Date.now();
  const m = await mergeRecords(page,
    { weakWords: { e2j: { margin: entry(0, now, now) } } }, // 削除のあとに間違えて苦手に戻した
    { weakDeleted: { 'w:e2j:margin': now - 5000 } });
  assert.strictEqual(m.weakWords.e2j.margin.streak, 0);
}));

test('sync_deletion_is_per_mode', () => withPage({}, async page => {
  const now = Date.now();
  const m = await mergeRecords(page,
    { weakDeleted: { 'w:e2j:margin': now } },
    { weakWords: { e2j: { margin: entry(1, now) }, j2e: { margin: entry(1, now) } } });
  assert.strictEqual(m.weakWords.e2j.margin, undefined);
  assert.notStrictEqual(m.weakWords.j2e.margin, undefined);
}));

test('sync_newer_wrong_answer_beats_cloud_streak', () => withPage({}, async page => {
  const now = Date.now();
  const m = await mergeRecords(page,
    { weakGrammar: { 9: entry(0, now, now) } }, // 手元: たった今間違えた
    { weakGrammar: { 9: entry(2, now + 5 * DAY, now - 3 * DAY) } }); // クラウド: 3日前に進んだ記録
  assert.strictEqual(m.weakGrammar[9].streak, 0);
  const m2 = await mergeRecords(page,
    { weakGrammar: { 9: entry(2, now + 5 * DAY, now - 3 * DAY) } },
    { weakGrammar: { 9: entry(0, now, now) } });
  assert.strictEqual(m2.weakGrammar[9].streak, 0); // 向きを逆にしても同じ
}));

test('sync_legacy_entries_keep_old_rule', () => withPage({}, async page => {
  const now = Date.now();
  const m = await mergeRecords(page,
    { weakGrammar: { 9: entry(1, now) } },
    { weakGrammar: { 9: entry(2, now) } }); // どちらも u なし → 従来どおり streak が大きい方
  assert.strictEqual(m.weakGrammar[9].streak, 2);
}));

test('weak_entry_records_updated_at_and_tombstone', () => withPage({}, async page => {
  const r = await page.evaluate(() => {
    const w = RAW_WORDS[0].w;
    state.mode = 'e2j';
    state.weakByMode.e2j[w] = { streak: 3, added: 1, due: 1 };
    recordWeak(RAW_WORDS[0], true); // 3回目のあとの正解 → 苦手から外れる
    const gone = w in state.weakByMode.e2j;
    const tomb = state.weakDeleted['w:e2j:' + w];
    recordWeak(RAW_WORDS[0], false); // 間違えて苦手に戻る
    return { gone, tomb, u: state.weakByMode.e2j[w].u, saved: JSON.parse(localStorage.getItem('toeic_weak_deleted')) };
  });
  assert.strictEqual(r.gone, false);
  assert(r.tomb > 0, 'tombstone recorded');
  assert(r.u >= r.tomb, 'updatedAt set on wrong answer');
  assert.strictEqual(Object.values(r.saved)[0], r.tomb);
}));

test('manual_remove_records_tombstone', () => withPage({}, async page => {
  const r = await page.evaluate(() => {
    state.app = 'grammar';
    state.grammarWeakData[9] = { streak: 0, added: 1, due: 1 };
    removeWeak('9');
    return { has: 9 in state.grammarWeakData, tomb: state.weakDeleted['g:9'] };
  });
  assert.strictEqual(r.has, false);
  assert(r.tomb > 0);
}));

test('build_v6_roundtrip_and_migrate_v4', () => withPage({}, async page => {
  const now = Date.now();
  const b = await page.evaluate(n => { state.weakDeleted = { 'w:j2e:margin': n, 'g:9': n }; return buildBackup(); }, now);
  assert.strictEqual(b.format, 6);
  const r = await parse(page, JSON.stringify(b));
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.records.weakDeleted, { 'w:j2e:margin': now, 'g:9': now });
  const r4 = await parse(page, backupText(4, { seenGrammar: [] })); // 版4には weakDeleted が無い
  assert.strictEqual(r4.ok, true, r4.error);
  assert.deepStrictEqual(r4.records.weakDeleted, {});
  const bad = await parse(page, backupText(5, { seenGrammar: [], weakDeleted: [] }));
  assert.strictEqual(bad.ok, false);
}));

test('weak_deleted_sanitize_and_clamp', () => withPage({}, async page => {
  const future = Date.now() + 30 * DAY;
  const r = await parse(page, backupText(5, { seenGrammar: [], weakDeleted: {
    'w:e2j:ok': future, 'g:5': 1000, 'x:1': 1000, 'w:bogus:a': 1000, 'g:0': 1000, 'g:6': 'z',
  }, weakGrammar: { 9: { ...WEAK9[9], u: future } } }));
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(Object.keys(r.records.weakDeleted).sort(), ['g:5', 'w:e2j:ok']);
  assert(r.records.weakDeleted['w:e2j:ok'] <= Date.now(), 'future deletion time is clamped');
  assert(r.records.weakGrammar[9].u <= Date.now(), 'future updatedAt is clamped');
  assert.strictEqual(r.invalid, 4);
}));

test('restore_undo_with_weak_deleted', () => withPage({}, async page => {
  const now = Date.now();
  await restoreText(page, backupText(5, { seenGrammar: [], weakDeleted: { 'g:9': now } }), 'overwrite');
  assert.deepStrictEqual(await page.evaluate(() => state.weakDeleted), { 'g:9': now });
  await page.evaluate(() => runUndo());
  assert.deepStrictEqual(await page.evaluate(() => state.weakDeleted), {});
  // 取り消し用の記録が weakDeleted を持たない(版4時代の)ものでも取り消せる
  await page.evaluate(() => {
    const records = Object.fromEntries(RECORD_STORAGE_KEYS.filter(k => k !== 'toeic_weak_deleted').map(k => [k, localStorage.getItem(k)]));
    localStorage.setItem('toeic_backup_undo', JSON.stringify({ savedAt: Date.now(), records }));
  });
  assert.notStrictEqual(await page.evaluate(() => loadUndo()), null);
}));

// ---- 同期ループ: Drive をスタブにして、同期が自分で次の同期や再描画を呼ばないことを確かめる ----

async function stubDrive(page) {
  await page.evaluate(() => {
    localStorage.setItem(GDRIVE_LINKED_KEY, '1');
    gdriveAccessToken = 'x';
    gdriveTokenExpiresAt = Date.now() + 3600e3;
    window.__patches = 0;
    const store = { text: JSON.stringify(buildBackup()) };
    window.fetch = async (url, opt = {}) => {
      const u = String(url);
      const json = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
      if (u.includes('spaces=appDataFolder')) return json({ files: [{ id: 'f1' }] });
      if (u.includes('alt=media')) return { ok: true, status: 200, text: async () => store.text };
      if ((opt.method || '') === 'PATCH') { window.__patches++; store.text = opt.body; return json({ modifiedTime: 't' }); }
      return json({});
    };
  });
}

test('sync_does_not_retrigger_itself', () => withPage({}, async page => {
  await dismissNudge(page);
  await stubDrive(page);
  await page.evaluate(async () => {
    window.__renders = 0;
    const orig = renderCurrent;
    renderCurrent = function () { window.__renders++; return orig.apply(this, arguments); };
    await syncWithGoogleDrive({ interactive: false, silent: true });
  });
  await page.waitForTimeout(9000); // 4秒おきに再同期していれば 2 回以上になる
  const r = await page.evaluate(() => ({ patches: window.__patches, renders: window.__renders }));
  assert.strictEqual(r.patches, 1);
  assert.strictEqual(r.renders, 0);
}));

test('sync_keeps_answered_question', () => withPage({}, async page => {
  await dismissNudge(page);
  await stubDrive(page);
  const r = await page.evaluate(async () => {
    state.weakFilter = 'all'; applyFilters();
    document.querySelector('#choices-container .choice-btn').click();
    const before = { idx: state.currentIndex, answered: state.answered, html: document.getElementById('quiz-container').innerHTML };
    await syncWithGoogleDrive({ interactive: false, silent: true });
    return { before, idx: state.currentIndex, answered: state.answered, html: document.getElementById('quiz-container').innerHTML, sessionIdx: JSON.parse(localStorage.getItem('toeic_session')).vocab.index };
  });
  assert.strictEqual(r.before.answered, true);
  assert.strictEqual(r.answered, true);
  assert.strictEqual(r.idx, r.before.idx);
  assert.strictEqual(r.html, r.before.html);
}));

test('sync_does_not_notify_other_tabs', () => withPage({}, async page => {
  await dismissNudge(page);
  await stubDrive(page);
  const stamp = await page.evaluate(async () => {
    await syncWithGoogleDrive({ interactive: false, silent: true });
    return localStorage.getItem('toeic_restore_stamp');
  });
  assert.strictEqual(stamp, null); // 同期は「復元」ではないので、別のタブを読み込み直させない
}));

test('session_save_does_not_schedule_sync', () => withPage({}, async page => {
  await stubDrive(page);
  const r = await page.evaluate(() => {
    localStorage.setItem(GDRIVE_AUTOSYNC_KEY, '1');
    gdriveSyncTimer = null;
    saveJSON(SESSION_KEY, {});
    const afterSession = gdriveSyncTimer;
    saveJSON(WORD_STATS_KEY, {});
    return { afterSession, afterStats: gdriveSyncTimer !== null };
  });
  assert.strictEqual(r.afterSession, null);
  assert.strictEqual(r.afterStats, true);
}));

// ==================== 絞り込みの複数選択(範囲・品詞・文法の章) ====================

// 起動時の移行(苦手の「すべて」を「苦手+未」に引き上げる)を済ませた印も付けて、苦手の絞り込みを「すべて」にしておく
const settings = o => ({ toeic_default_unlearned_migrated_v2: 'true', toeic_settings: JSON.stringify({ weakFilter: 'all', ...o }) });
const openFilters = async page => { await dismissNudge(page); await page.click('#filter-toggle'); };
const chipActive = (page, sel) => page.$eval(sel, e => e.classList.contains('active'));

test('range_multi_select', () => withPage(settings({ sourceFilter: 'teppan' }), async page => {
  await openFilters(page);
  await page.click('#range-filters [data-range="1-100"]');
  await page.click('#range-filters [data-range="101-200"]');
  assert.deepStrictEqual(await page.evaluate(() => state.rangeFilter), [{ start: 1, end: 100 }, { start: 101, end: 200 }]);
  const r = await page.evaluate(() => {
    const nos = state.pool.map(w => w.no);
    return { min: Math.min(...nos), max: Math.max(...nos), has1: nos.some(n => n <= 100), has2: nos.some(n => n > 100), inGap: nos.some(n => n > 200) };
  });
  assert(r.has1 && r.has2 && !r.inGap, JSON.stringify(r));
  assert(await chipActive(page, '#range-filters [data-range="1-100"]'));
  assert(await chipActive(page, '#range-filters [data-range="101-200"]'));
  assert(!(await chipActive(page, '#range-filters [data-range="all"]')));
  assert.strictEqual(await page.$eval('#filter-count', e => e.innerText), '3'); // 出典1 + 範囲2
}));

test('range_toggle_off_and_all', () => withPage(settings({ sourceFilter: 'teppan' }), async page => {
  await openFilters(page);
  await page.click('#range-filters [data-range="1-100"]');
  await page.click('#range-filters [data-range="1-100"]'); // もう一度押すと外れる
  assert.deepStrictEqual(await page.evaluate(() => state.rangeFilter), []);
  assert(await chipActive(page, '#range-filters [data-range="all"]'));
  await page.click('#range-filters [data-range="1-100"]');
  await page.click('#range-filters [data-range="101-200"]');
  await page.click('#range-filters [data-range="all"]');
  assert.deepStrictEqual(await page.evaluate(() => state.rangeFilter), []);
}));

test('pos_multi_select', () => withPage(settings({ sourceFilter: 'daily' }), async page => {
  await openFilters(page);
  await page.click('#pos-filters [data-pos="名詞"]');
  await page.click('#pos-filters [data-pos="動詞"]');
  assert.deepStrictEqual(await page.evaluate(() => state.posFilter), ['名詞', '動詞']);
  const ps = await page.evaluate(() => [...new Set(state.pool.map(w => w.p))]);
  assert(ps.includes('名詞') && ps.includes('動詞') && ps.length === 2, JSON.stringify(ps));
  assert(!(await chipActive(page, '#pos-filters [data-pos="all"]')));
  await page.click('#pos-filters [data-pos="名詞"]');
  await page.click('#pos-filters [data-pos="動詞"]');
  assert(await chipActive(page, '#pos-filters [data-pos="all"]')); // 全部外すと「すべて」に戻る
  assert.deepStrictEqual(await page.evaluate(() => state.posFilter), []);
}));

test('pos_phrase_group_with_other', () => withPage(settings({ sourceFilter: 'daily', posFilter: ['句・表現', '副詞'] }), async page => {
  const r = await page.evaluate(() => {
    const ps = [...new Set(state.pool.map(w => w.p))];
    return { ps, onlyAllowed: ps.every(p => p === '副詞' || PHRASE_POS.includes(p)), hasAdverb: ps.includes('副詞'), hasPhrase: ps.some(p => PHRASE_POS.includes(p)) };
  });
  assert(r.onlyAllowed && r.hasAdverb && r.hasPhrase, JSON.stringify(r));
}));

test('grammar_chapters_across_books', () => withPage({}, async page => {
  await openGrammar(page);
  await openFilters(page);
  const keys = await page.$$eval('#grammar-chapter-filters [data-gchapter]', els => els.map(e => e.dataset.gchapter));
  assert(keys.includes('kin:2') && keys.includes('sekai:2'), keys.join(','));
  await page.click('#grammar-chapter-filters [data-gchapter="kin:2"]');
  await page.click('#grammar-chapter-filters [data-gchapter="sekai:2"]');
  assert.deepStrictEqual(await page.evaluate(() => state.grammarChapter), ['kin:2', 'sekai:2']);
  const r = await page.evaluate(() => ({
    n: state.grammarPool.length,
    expected: RAW_GRAMMAR.filter(g => g.ch === 2).length,
    books: [...new Set(state.grammarPool.map(g => g.b || 'sekai'))].sort(),
    chs: [...new Set(state.grammarPool.map(g => g.ch))],
  }));
  assert.strictEqual(r.n, r.expected);
  assert.deepStrictEqual(r.books, ['kin', 'sekai']);
  assert.deepStrictEqual(r.chs, [2]);
  await page.click('#grammar-chapter-filters [data-gchapter="kin:2"]'); // 外すと世界一の第2章だけ
  assert.deepStrictEqual(await page.evaluate(() => [...new Set(state.grammarPool.map(g => g.b || 'sekai'))]), ['sekai']);
  await page.click('#grammar-chapter-filters [data-gchapter="all"]');
  assert.deepStrictEqual(await page.evaluate(() => state.grammarChapter), []);
}));

test('grammar_book_change_resets_chapters', () => withPage(settings({ app: 'grammar', grammarChapter: ['kin:2', 'sekai:2'] }), async page => {
  assert.deepStrictEqual(await page.evaluate(() => state.grammarChapter), ['kin:2', 'sekai:2']);
  await openFilters(page);
  await page.click('#grammar-book-segments [data-gbook="kin"]');
  assert.deepStrictEqual(await page.evaluate(() => state.grammarChapter), []);
  await page.click('#grammar-chapter-filters [data-gchapter="kin:3"]');
  assert.deepStrictEqual(await page.evaluate(() => [...new Set(state.grammarPool.map(g => g.ch))]), [3]);
}));

test('grammar_rule_drill_clears_chapters', () => withPage(settings({ app: 'grammar', grammarChapter: ['sekai:2'] }), async page => {
  const r = await page.evaluate(() => { startRuleDrill(KIN_RULES[0].number); return { ch: state.grammarChapter, rule: state.grammarRule, book: state.grammarBook, n: state.grammarPool.length }; });
  assert.deepStrictEqual(r.ch, []);
  assert.strictEqual(r.book, 'kin');
  assert(r.n > 0);
}));

test('multi_filters_persist_and_count', () => withPage(settings({ sourceFilter: 'teppan' }), async page => {
  await openFilters(page);
  await page.click('#range-filters [data-range="1-100"]');
  await page.click('#range-filters [data-range="201-300"]');
  await page.reload();
  assert.deepStrictEqual(await page.evaluate(() => state.rangeFilter), [{ start: 1, end: 100 }, { start: 201, end: 300 }]);
  await dismissNudge(page);
  assert.strictEqual(await page.$eval('#filter-count', e => e.innerText), '3'); // 出典1 + 範囲2
}));

test('legacy_single_filters_migrate', () => withPage({}, async page => {
  await setStorageAndReload(page, settings({ sourceFilter: 'teppan', rangeFilter: { start: 1, end: 100 }, posFilter: '名詞' }));
  assert.deepStrictEqual(await page.evaluate(() => state.rangeFilter), [{ start: 1, end: 100 }]);
  assert.deepStrictEqual(await page.evaluate(() => state.posFilter), ['名詞']);
  await setStorageAndReload(page, settings({ app: 'grammar', grammarBook: 'kin', grammarChapter: 2 }));
  assert.deepStrictEqual(await page.evaluate(() => state.grammarChapter), ['kin:2']);
  // 本が「すべて」のときの番号だけでは、どの本の章か決まらないので外す
  await setStorageAndReload(page, settings({ app: 'grammar', grammarBook: 'all', grammarChapter: 2 }));
  assert.deepStrictEqual(await page.evaluate(() => state.grammarChapter), []);
  await setStorageAndReload(page, settings({ app: 'grammar', grammarChapter: 'all', rangeFilter: null, posFilter: 'all' }));
  assert.deepStrictEqual(await page.evaluate(() => [state.grammarChapter, state.rangeFilter, state.posFilter]), [[], [], []]);
}));

test('multi_filters_reject_invalid_saved_values', () => withPage({}, async page => {
  await setStorageAndReload(page, settings({
    sourceFilter: 'teppan', app: 'grammar', grammarBook: 'kin',
    rangeFilter: [{ start: 1, end: 100 }, { start: 5, end: 6 }, 'x', { start: 1, end: 100 }],
    posFilter: ['名詞', '存在しない', '名詞'],
    grammarChapter: ['kin:2', 'sekai:2', 'kin:99', 'bogus', 7],
  }));
  assert.deepStrictEqual(await page.evaluate(() => state.rangeFilter), [{ start: 1, end: 100 }]);
  assert.deepStrictEqual(await page.evaluate(() => state.posFilter), ['名詞']);
  assert.deepStrictEqual(await page.evaluate(() => state.grammarChapter), ['kin:2']); // 選んでいる本の章だけ残す
}));

test('past_records_untouched_by_filter_change', () => withPage({
  toeic_grammar_stats: JSON.stringify(STATS5),
  toeic_weak_grammar: JSON.stringify(WEAK9),
  toeic_settings: JSON.stringify({ rangeFilter: { start: 1, end: 100 }, grammarChapter: 3 }),
}, async page => {
  const r = await page.evaluate(() => ({ stats: state.grammarStats, weak: Object.keys(state.grammarWeakData), seen: [...state.grammarSeen].sort() }));
  assert.deepStrictEqual(r.stats, STATS5);
  assert.deepStrictEqual(r.weak, ['9']);
  assert.deepStrictEqual(r.seen.map(Number), [5, 9]);
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
