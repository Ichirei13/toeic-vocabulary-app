// 日別の学習記録（toeic_daily_activity_v1）と表示設定（toeic_prefs_v1）のバックアップ・復元・取り消しの検証。
// 実行: NODE_PATH=$(npm root -g) node tests/backup-extras.test.js
// リポジトリ直下を自前の静的サーバで配信し、Playwright(Chromium)で index.html を操作する（grammar-seen.test.js と同じ作り）。
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

// storage の中身を localStorage に入れてから index.html を開く。再読み込みでは入れ直さない
async function withPage(storage, fn, { blockScripts = [], hash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
  await context.addInitScript(items => {
    try {
      if (sessionStorage.getItem('__test_init')) return;
      sessionStorage.setItem('__test_init', '1');
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) { /* 使えなければ何もしない */ }
  }, storage);
  for (const pattern of blockScripts) await context.route(pattern, route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(baseUrl + '/index.html' + hash);
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

const ACT_KEY = 'toeic_daily_activity_v1';
const PREFS_KEY = 'toeic_prefs_v1';
const day = (a, g, extra = {}) => ({ a, c: a, fast: 0, sec: a * 3, g, ...extra });
const seed = (days, prefs) => ({ [ACT_KEY]: JSON.stringify({ days }), [PREFS_KEY]: JSON.stringify(prefs) });
const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);

// 版5以前のファイル（日別記録・表示設定なし）にする
const asV5 = b => { const c = JSON.parse(JSON.stringify(b)); c.format = 5; delete c.data.activity; delete c.data.prefs; return c; };

// 復元を実行して、エラーがあればその文言を返す
async function restore(page, backup, mode) {
  return page.evaluate(([text, m]) => {
    backupView = { step: 'confirm', pending: parseBackup(text), restoreMode: m, fileName: 'test.json' };
    runRestore();
    return backupView.error || null;
  }, [JSON.stringify(backup), mode]);
}
const parse = (page, backup) => page.evaluate(t => JSON.parse(JSON.stringify(parseBackup(t))), JSON.stringify(backup));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const BASE_DAYS = { '2026-10-20': day(3, 20) };
const BASE_PREFS = { dailyGoal: 12, paceTarget: { vocab: 8 } };

// ==================== 書き出し ====================

test('file_backup_is_v6_and_drive_backup_stays_v5', () => withPage(seed(BASE_DAYS, BASE_PREFS), async page => {
  const r = await page.evaluate(() => {
    const file = buildBackup();
    const drive = buildBackup({ forDrive: true });
    return {
      file, drive,
      driveParse: JSON.parse(JSON.stringify(parseBackup(JSON.stringify(drive)))),
      inRecordKeys: ['toeic_daily_activity_v1', 'toeic_prefs_v1'].filter(k => RECORD_STORAGE_KEYS.includes(k)),
    };
  });
  assert.strictEqual(r.file.format, 6);
  assert.deepStrictEqual(r.file.data.activity, { days: BASE_DAYS });
  assert.deepStrictEqual(r.file.data.prefs, BASE_PREFS);
  assert.strictEqual(r.drive.format, 5);
  assert(!('activity' in r.drive.data) && !('prefs' in r.drive.data), 'Drive 用の書き出しに日別記録・表示設定が入っている');
  assert.strictEqual(r.driveParse.ok, true, r.driveParse.error);
  assert.strictEqual(r.driveParse.extras.activity, undefined);
  assert.deepStrictEqual(r.inRecordKeys, [], 'Drive 同期の対象に新しいキーが入っている');
}));

// ==================== 読み込みの検証 ====================

test('parse_rejects_bad_extras_and_future_format', () => withPage({}, async page => {
  const b = await page.evaluate(() => buildBackup());
  const badActivity = await parse(page, { ...b, data: { ...b.data, activity: [] } });
  assert.strictEqual(badActivity.ok, false);
  assert(/日別の学習記録/.test(badActivity.error), badActivity.error);
  const badPrefs = await parse(page, { ...b, data: { ...b.data, prefs: [] } });
  assert.strictEqual(badPrefs.ok, false);
  assert(/表示設定/.test(badPrefs.error), badPrefs.error);
  const future = await parse(page, { ...b, format: 7 });
  assert.strictEqual(future.ok, false);
  assert(/新しいバージョン/.test(future.error), future.error);
}));

test('parse_keeps_only_valid_prefs_items', () => withPage({}, async page => {
  const b = await page.evaluate(() => buildBackup());
  const r = await parse(page, { ...b, data: { ...b.data, prefs: { dailyGoal: 'x', paceTarget: { vocab: 6, grammar: 'y' } } } });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.extras.prefs, { paceTarget: { vocab: 6 } }); // 壊れた項目は「今のまま」にするため取り込まない
  const empty = await parse(page, { ...b, data: { ...b.data, prefs: {} } });
  assert.deepStrictEqual(empty.extras.prefs, {});
  const v5 = await parse(page, asV5(b));
  assert.strictEqual(v5.ok, true, v5.error);
  assert.strictEqual(v5.extras.activity, undefined);
  assert.strictEqual(v5.extras.prefs, undefined);
}));

// ==================== 復元 ====================

test('v5_file_restore_leaves_activity_and_prefs_alone', async () => {
  for (const mode of ['overwrite', 'merge']) {
    await withPage(seed(BASE_DAYS, BASE_PREFS), async page => {
      const v5 = asV5(await page.evaluate(() => buildBackup()));
      assert.strictEqual(await restore(page, v5, mode), null);
      assert.deepStrictEqual(await stored(page, ACT_KEY), { days: BASE_DAYS }, mode);
      assert.deepStrictEqual(await stored(page, PREFS_KEY), BASE_PREFS, mode);
    });
  }
});

test('v6_overwrite_replaces_extras_and_reloads_memory', () => withPage(seed(BASE_DAYS, BASE_PREFS), async page => {
  const b = await page.evaluate(() => buildBackup());
  b.data.activity = { days: { '2026-10-01': day(9, 10) } };
  b.data.prefs = { dailyGoal: 30, paceTarget: { vocab: 6 } };
  assert.strictEqual(await restore(page, b, 'overwrite'), null);
  assert.deepStrictEqual(Object.keys((await stored(page, ACT_KEY)).days), ['2026-10-01']);
  assert.deepStrictEqual(await stored(page, PREFS_KEY), { dailyGoal: 30, paceTarget: { vocab: 6 } });
  // 画面の元になるメモリも読み直されている（再読み込みなしで反映される）
  const mem = await page.evaluate(() => ({ goal: prefs.dailyGoal, pace: prefs.paceTarget.vocab, days: Object.keys(dailyActivity.days) }));
  assert.deepStrictEqual(mem, { goal: 30, pace: 6, days: ['2026-10-01'] });
}));

test('v6_merge_keeps_current_goal_and_larger_answer_count', () => withPage(seed(BASE_DAYS, BASE_PREFS), async page => {
  const b = await page.evaluate(() => buildBackup());
  b.data.activity = { days: { '2026-10-20': day(7, 5, { gr: 2 }), '2026-10-19': day(2, 10) } };
  b.data.prefs = { dailyGoal: 99, paceTarget: { vocab: 9, grammar: 50 } };
  assert.strictEqual(await restore(page, b, 'merge'), null);
  const a = (await stored(page, ACT_KEY)).days;
  assert.strictEqual(a['2026-10-20'].a, 7);
  assert.strictEqual(a['2026-10-20'].g, 20); // 目標は今の値を優先
  assert.strictEqual(a['2026-10-20'].gr, 2);
  assert(a['2026-10-19'], 'ファイルにだけある日が取り込まれていない');
  // 設定も今の値を優先し、無い項目だけファイルから補う
  assert.deepStrictEqual(await stored(page, PREFS_KEY), { dailyGoal: 12, paceTarget: { vocab: 8, grammar: 50 } });
}));

test('v6_overwrite_without_pace_keeps_current_pace', () => withPage(seed(BASE_DAYS, { dailyGoal: 12, paceTarget: { vocab: 8, grammar: 40 } }), async page => {
  const b = await page.evaluate(() => buildBackup());
  b.data.prefs = { dailyGoal: 30 }; // paceTarget の無い版6のファイル
  assert.strictEqual(await restore(page, b, 'overwrite'), null);
  assert.deepStrictEqual(await stored(page, PREFS_KEY), { dailyGoal: 30, paceTarget: { vocab: 8, grammar: 40 } });
}));

// ==================== 取り消し ====================

test('undo_after_v6_restore_brings_extras_back', () => withPage(seed(BASE_DAYS, BASE_PREFS), async page => {
  const b = await page.evaluate(() => buildBackup());
  b.data.activity = { days: { '2026-10-01': day(9, 10) } };
  b.data.prefs = { dailyGoal: 30 };
  assert.strictEqual(await restore(page, b, 'overwrite'), null);
  await page.evaluate(() => runUndo());
  assert.deepStrictEqual(await stored(page, ACT_KEY), { days: BASE_DAYS });
  assert.deepStrictEqual(await stored(page, PREFS_KEY), BASE_PREFS);
  assert.strictEqual(await page.evaluate(() => prefs.dailyGoal), 12, '取り消し後のメモリが古い');
}));

test('undo_of_v5_restore_does_not_roll_back_later_activity_or_goal', () => withPage(seed(BASE_DAYS, { dailyGoal: 20 }), async page => {
  const v5 = asV5(await page.evaluate(() => buildBackup()));
  assert.strictEqual(await restore(page, v5, 'merge'), null);
  // 取り消し用の記録には、復元が触っていない日別記録・表示設定を入れない
  const snapshotKeys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('toeic_backup_undo')).records));
  assert(!snapshotKeys.includes(ACT_KEY) && !snapshotKeys.includes(PREFS_KEY), snapshotKeys.join(','));
  // 復元のあとに学習して目標も変える
  await page.evaluate(() => { dailyActivity.days['2026-10-28'] = { a: 3, c: 3, fast: 0, sec: 4, g: 10 }; saveDailyActivity(); setDailyGoal(5); });
  await page.evaluate(() => runUndo());
  assert(Object.keys((await stored(page, ACT_KEY)).days).includes('2026-10-28'), '復元のあとの日別記録が巻き戻った');
  assert.strictEqual((await stored(page, PREFS_KEY)).dailyGoal, 5, '復元のあとの目標が巻き戻った');
}));

test('legacy_undo_snapshot_without_extra_keys_is_accepted_and_leaves_extras', () => withPage(seed(BASE_DAYS, BASE_PREFS), async page => {
  const b = await page.evaluate(() => buildBackup());
  b.data.activity = { days: { '2026-10-01': day(9, 10) } };
  assert.strictEqual(await restore(page, b, 'overwrite'), null);
  // 日別記録・表示設定の無い（以前の）取り消し用の記録にする
  await page.evaluate(() => {
    const snap = JSON.parse(localStorage.getItem('toeic_backup_undo'));
    delete snap.records['toeic_daily_activity_v1'];
    delete snap.records['toeic_prefs_v1'];
    localStorage.setItem('toeic_backup_undo', JSON.stringify(snap));
  });
  assert.strictEqual(await page.evaluate(() => loadUndo() !== null), true);
  await page.evaluate(() => { localStorage.setItem('toeic_daily_activity_v1', JSON.stringify({ days: { '2026-10-26': { a: 4, c: 4, fast: 0, sec: 5, g: 10 } } })); });
  await page.evaluate(() => runUndo());
  assert.deepStrictEqual(Object.keys((await stored(page, ACT_KEY)).days), ['2026-10-26'], '古い取り消し用の記録で今の日別記録が消えた');
}));

// ==================== 画面側 ====================

test('home_still_works_when_one_src_script_fails_to_load', () => withPage(seed(BASE_DAYS, BASE_PREFS), async page => {
  const r = await page.evaluate(() => ({
    homeKids: document.getElementById('home-page').children.length,
    goalRow: !!document.querySelector('.home-goal-row'),
    stub: typeof StudyCore.createSessionReview,
  }));
  assert(r.homeKids > 0, 'ホームが空（home.js が起動時に止まった）');
  assert.strictEqual(r.goalRow, true);
  assert.strictEqual(r.stub, 'function');
}, { blockScripts: ['**/src/review.js'], hash: '#home' }));

test('settings_goal_input_clamps_and_saves', () => withPage({}, async page => {
  const r = await page.evaluate(() => {
    switchAppPage('settings');
    const input = document.getElementById('setting-goal');
    input.value = '999';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const pace = document.getElementById('setting-pace-grammar');
    pace.value = '500';
    pace.dispatchEvent(new Event('change', { bubbles: true }));
    return { stored: JSON.parse(localStorage.getItem('toeic_prefs_v1')), shown: input.value };
  });
  assert.strictEqual(r.stored.dailyGoal, 200);
  assert.strictEqual(r.shown, '200');
  assert.strictEqual(r.stored.paceTarget.grammar, 120);
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
  if (pageErrors.length) {
    failed++;
    console.log(`FAIL page_errors\n     ${pageErrors.slice(0, 5).join('\n     ')}`);
  }
  await browser.close();
  server.close();
  console.log(`${tests.length - (failed - (pageErrors.length ? 1 : 0))}/${tests.length} tests passed${pageErrors.length ? ', page errors present' : ''}`);
  process.exit(failed ? 1 : 0);
})();
