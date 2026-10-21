const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp } = require('./helpers.cjs');

const TIME = '2026-10-21T10:00:00';
const BROKEN_LOG = {
  '2026-10-21': { v: [3, 2], g: [1, 1] },
  'bad': { v: [1, 1] },
  '2026-13-40': { v: [1, 1] },
  '2026-10-20': { v: [2, 5] },
  '2026-10-19': { v: [-1, 0] },
  '2026-10-18': 'x',
};

// 今の記録から書き出したバックアップの本文。mutate でファイルの中身を書き換えられる
const backupText = (page, mutate) => page.evaluate(m => {
  const b = buildBackup();
  if (m) new Function('b', m)(b);
  return JSON.stringify(b);
}, mutate || '');

test('buildBackup: data.dailyLog が state.dailyLog と同じ', () => withApp({ time: TIME }, async page => {
  await page.evaluate(() => recordActivity('vocab', true));
  const r = await page.evaluate(() => ({ log: buildBackup().data.dailyLog, mem: state.dailyLog }));
  assert.deepEqual(r.log, r.mem);
  assert.deepEqual(r.log['2026-10-21'], { v: [1, 1], g: [0, 0] });
}));

test('dailyLog のない古いファイルは ok で、復元しても今の学習ログは残る', () => withApp({ time: TIME }, async page => {
  await page.evaluate(() => recordActivity('vocab', true));
  const text = await backupText(page, 'delete b.data.dailyLog');
  const r = await page.evaluate(t => {
    const parsed = parseBackup(t);
    backupView = { step: 'confirm', pending: parsed };
    runRestore();
    return {
      ok: parsed.ok,
      hasRecord: 'dailyLog' in parsed.records,
      mem: state.dailyLog[dateKey()],
      saved: JSON.parse(localStorage.getItem('toeic_daily_log'))[dateKey()],
    };
  }, text);
  assert.equal(r.ok, true);
  assert.equal(r.hasRecord, false);
  assert.deepEqual(r.mem, { v: [1, 1], g: [0, 0] });
  assert.deepEqual(r.saved, { v: [1, 1], g: [0, 0] });
}));

test('壊れたログを含むファイルは ok で、invalid に足され、正しい日だけ残る', () => withApp({ time: TIME }, async page => {
  const text = await backupText(page, `b.data.dailyLog = ${JSON.stringify(BROKEN_LOG)}`);
  const noLog = await backupText(page, 'delete b.data.dailyLog');
  const base = await page.evaluate(t => parseBackup(t).invalid, noLog);
  const r = await page.evaluate(t => { const p = parseBackup(t); return { ok: p.ok, invalid: p.invalid, log: p.records.dailyLog }; }, text);
  assert.equal(r.ok, true);
  assert.equal(r.invalid - base, 5);
  assert.deepEqual(Object.keys(r.log), ['2026-10-21']);
}));

test('dailyLog が配列のファイルは断る', () => withApp({ time: TIME }, async page => {
  const text = await backupText(page, 'b.data.dailyLog = []');
  const r = await page.evaluate(t => parseBackup(t), text);
  assert.equal(r.ok, false);
}));

test('dailyLog ありのファイルを復元すると、state.dailyLog がファイルの中身になる', () => withApp({ time: TIME }, async page => {
  const text = await backupText(page, `b.data.dailyLog = { '2026-10-01': { v: [4, 3], g: [2, 2] } }`);
  const r = await page.evaluate(t => {
    backupView = { step: 'confirm', pending: parseBackup(t) };
    runRestore();
    return { mem: state.dailyLog, saved: JSON.parse(localStorage.getItem('toeic_daily_log')) };
  }, text);
  assert.deepEqual(r.mem, { '2026-10-01': { v: [4, 3], g: [2, 2] } });
  assert.deepEqual(r.saved, r.mem);
}));
