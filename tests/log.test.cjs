const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp } = require('./helpers.cjs');

const TIME = '2026-10-21T10:00:00';

test('dateKey: ローカル日付を0埋めの YYYY-MM-DD にする', () => withApp({}, async page => {
  assert.equal(await page.evaluate(() => dateKey(new Date(2026, 0, 5))), '2026-01-05');
}));

test('sanitizeDailyLog: 形の正しくない日を捨てて件数を返す', () => withApp({}, async page => {
  const r = await page.evaluate(() => sanitizeDailyLog({
    '2026-10-21': { v: [3, 2], g: [1, 1] },
    'bad': { v: [1, 1] },
    '2026-13-40': { v: [1, 1] },
    '2026-10-20': { v: [2, 5] },
    '2026-10-19': { v: [-1, 0] },
    '2026-10-18': 'x',
  }));
  assert.deepEqual(Object.keys(r.data), ['2026-10-21']);
  assert.equal(r.invalid, 5);
  assert.deepEqual(r.data['2026-10-21'], { v: [3, 2], g: [1, 1] });
}));

test('sanitizeDailyLog: g が無い日は g:[0,0] になる', () => withApp({}, async page => {
  const r = await page.evaluate(() => sanitizeDailyLog({ '2026-10-21': { v: [3, 2] } }));
  assert.deepEqual(r.data['2026-10-21'], { v: [3, 2], g: [0, 0] });
  assert.equal(r.invalid, 0);
}));

test('sanitizeDailyLog: 450日分を渡すと新しい400日分だけ残り、古い分は invalid に数えない', () => withApp({}, async page => {
  const r = await page.evaluate(() => {
    const raw = {};
    for (let i = 0; i < 450; i++) raw[dateKey(new Date(2025, 0, 1 + i))] = { v: [1, 1] };
    const out = sanitizeDailyLog(raw);
    return { keys: Object.keys(out.data).sort(), invalid: out.invalid, newest: dateKey(new Date(2025, 0, 450)), oldest: '2025-01-01' };
  });
  assert.equal(r.keys.length, 400);
  assert.equal(r.invalid, 0);
  assert.ok(r.keys.includes(r.newest));
  assert.ok(!r.keys.includes(r.oldest));
}));

for (const [name, value] of [['配列', '[]'], ['文字列', '"abc"'], ['壊れたJSON', '{oops']]) {
  test(`起動: toeic_daily_log が${name}でも起動でき、state.dailyLog は空`, () =>
    withApp({ storage: { toeic_daily_log: value } }, async page => {
      assert.deepEqual(await page.evaluate(() => state.dailyLog), {});
      assert.deepEqual(page.errors, []);
    }));
}

test('recordActivity: 単語と文法の回答を日ごとに数えて保存する', () => withApp({ time: TIME }, async page => {
  const r = await page.evaluate(() => {
    recordActivity('vocab', true);
    recordActivity('vocab', false);
    recordActivity('grammar', true);
    const key = dateKey();
    return { key, mem: state.dailyLog[key], saved: JSON.parse(localStorage.getItem('toeic_daily_log'))[key] };
  });
  assert.equal(r.key, '2026-10-21');
  assert.deepEqual(r.mem, { v: [2, 1], g: [1, 1] });
  assert.deepEqual(r.saved, { v: [2, 1], g: [1, 1] });
}));

test('画面: 「わからない」で今日の単語が [1,0]、文法の回答で g の回答数が 1 になる', () => withApp({ time: TIME }, async page => {
  await page.click('#dont-know-btn');
  assert.deepEqual(await page.evaluate(() => state.dailyLog[dateKey()].v), [1, 0]);
  await page.click('[data-app="grammar"]');
  await page.click('#choices-container .choice-btn');
  const day = await page.evaluate(() => state.dailyLog[dateKey()]);
  assert.equal(day.g[0], 1);
  assert.deepEqual(day.v, [1, 0]);
}));

test('streakDays: 空は0、今日だけは1', () => withApp({}, async page => {
  assert.equal(await page.evaluate(() => streakDays({}, '2026-10-21')), 0);
  assert.equal(await page.evaluate(() => streakDays({ '2026-10-21': { v: [1, 1], g: [0, 0] } }, '2026-10-21')), 1);
}));

test('streakDays: 今日がなくても昨日からの連続を数える。1日抜けるとそこで止まる', () => withApp({}, async page => {
  const day = { v: [1, 1], g: [0, 0] };
  const r = await page.evaluate(d => ({
    fromYesterday: streakDays({ '2026-10-20': d, '2026-10-19': d }, '2026-10-21'),
    gap: streakDays({ '2026-10-21': d, '2026-10-19': d }, '2026-10-21'),
    zeroDay: streakDays({ '2026-10-21': d, '2026-10-20': { v: [0, 0], g: [0, 0] }, '2026-10-19': d }, '2026-10-21'),
  }), day);
  assert.deepEqual(r, { fromYesterday: 2, gap: 1, zeroDay: 1 });
}));

test('streakDays: 月またぎ・年またぎで途切れない', () => withApp({}, async page => {
  const d = { v: [1, 1], g: [0, 0] };
  const r = await page.evaluate(d => ({
    month: streakDays({ '2026-02-27': d, '2026-02-28': d, '2026-03-01': d }, '2026-03-01'),
    year: streakDays({ '2025-12-31': d, '2026-01-01': d }, '2026-01-01'),
  }), d);
  assert.deepEqual(r, { month: 3, year: 2 });
}));

test('保存できない環境でも、回答でき state には記録される', () => withApp({
  time: TIME,
  init: "Storage.prototype.setItem = function () { throw new Error('quota'); };",
}, async page => {
  await page.click('#dont-know-btn');
  assert.deepEqual(page.errors, []);
  assert.deepEqual(await page.evaluate(() => state.dailyLog[dateKey()].v), [1, 0]);
}));
