const test = require('node:test');
const assert = require('node:assert');
const A = require('../../src/activity.js');

test('normalizeGoal: 許可された数値だけ通し、それ以外は 10', () => {
  assert.strictEqual(A.normalizeGoal(0), 0);
  assert.strictEqual(A.normalizeGoal(5), 5);
  assert.strictEqual(A.normalizeGoal(30), 30);
  assert.strictEqual(A.normalizeGoal(undefined), 10);
  assert.strictEqual(A.normalizeGoal(null), 10);
  assert.strictEqual(A.normalizeGoal('5'), 10);
  assert.strictEqual(A.normalizeGoal(7), 10);
  assert.strictEqual(A.normalizeGoal(NaN), 10);
});

test('goalProgress: 達成・未達・目標なし', () => {
  assert.deepStrictEqual(A.goalProgress({ a: 3 }, 10), { answered: 3, goal: 10, hasGoal: true, reached: false, ratio: 0.3 });
  assert.strictEqual(A.goalProgress({ a: 10 }, 10).reached, true);
  assert.strictEqual(A.goalProgress({ a: 25 }, 10).ratio, 1);
  const none = A.goalProgress({ a: 40 }, 0);
  assert.strictEqual(none.hasGoal, false);
  assert.strictEqual(none.reached, false);
  assert.strictEqual(none.ratio, 0);
  assert.strictEqual(A.goalProgress(undefined, 10).answered, 0);
});

test('sanitizeActivity: 正しい日だけ残し、不正な日は数える', () => {
  const r = A.sanitizeActivity({ days: {
    '2026-10-28': { a: 5, c: 3, fast: 1, sec: 20.5, g: 10, gr: 2 },
    '2026-10-27': { a: 2, c: 9, fast: 9, sec: -4 },
    'bad-key': { a: 1 },
    '2026-10-26': { a: 0 },
    '2026-10-25': 'x',
  } });
  assert.deepStrictEqual(r.days['2026-10-28'], { a: 5, c: 3, fast: 1, sec: 20.5, g: 10, gr: 2 });
  assert.deepStrictEqual(r.days['2026-10-27'], { a: 2, c: 2, fast: 2, sec: 0 });
  assert.strictEqual(Object.keys(r.days).length, 2);
  assert.strictEqual(r.invalid, 3);
});

test('sanitizeActivity: 壊れた入力は空にする', () => {
  assert.deepStrictEqual(A.sanitizeActivity(null), { days: {}, invalid: 0 });
  assert.deepStrictEqual(A.sanitizeActivity([]), { days: {}, invalid: 0 });
  assert.deepStrictEqual(A.sanitizeActivity({ days: [] }), { days: {}, invalid: 0 });
  assert.deepStrictEqual(A.sanitizeActivity({ days: { '2026-10-28': { a: 1, g: 7 } } }).days['2026-10-28'].g, undefined);
});

test('mergeActivity: a の大きい方・g は現在優先・gr は大きい方', () => {
  const cur = { '2026-10-28': { a: 5, c: 3, fast: 0, sec: 10, g: 20 }, '2026-10-27': { a: 1, c: 1, fast: 0, sec: 1 } };
  const inc = { '2026-10-28': { a: 8, c: 6, fast: 2, sec: 30, g: 5, gr: 3 }, '2026-10-26': { a: 4, c: 2, fast: 0, sec: 9, g: 10 } };
  const out = A.mergeActivity(cur, inc);
  assert.strictEqual(out['2026-10-28'].a, 8);
  assert.strictEqual(out['2026-10-28'].c, 6);
  assert.strictEqual(out['2026-10-28'].g, 20);
  assert.strictEqual(out['2026-10-28'].gr, 3);
  assert.strictEqual(out['2026-10-27'].a, 1);
  assert.strictEqual(out['2026-10-26'].g, 10);
  assert.strictEqual(Object.keys(out).length, 3);
});

test('mergeActivity: 目標が現在側に無ければ取り込み側の値を使う', () => {
  const out = A.mergeActivity({ '2026-10-28': { a: 1, c: 0, fast: 0, sec: 1 } }, { '2026-10-28': { a: 1, c: 0, fast: 0, sec: 1, g: 5 } });
  assert.strictEqual(out['2026-10-28'].g, 5);
});

test('monthModel: 2026年10月（10/1 は木曜）', () => {
  const days = {
    '2026-10-27': { a: 3, c: 2, fast: 0, sec: 5, g: 10 },
    '2026-10-28': { a: 12, c: 9, fast: 0, sec: 50, g: 10 },
    '2026-10-26': { a: 4, c: 4, fast: 0, sec: 9, g: 0 },
  };
  const m = A.monthModel(days, '2026-10', '2026-10-29');
  assert.strictEqual(m.label, '2026年10月');
  assert.strictEqual(m.leading, 4);
  assert.strictEqual(m.cells.length, 31);
  assert.strictEqual(m.canNext, false);
  const c = key => m.cells.find(x => x.key === key);
  assert.strictEqual(c('2026-10-28').reached, true);
  assert.strictEqual(c('2026-10-27').studied, true);
  assert.strictEqual(c('2026-10-27').reached, false);
  assert.strictEqual(c('2026-10-26').reached, false); // 目標なしの日は達成にしない
  assert.strictEqual(c('2026-10-29').today, true);
  assert.strictEqual(c('2026-10-30').future, true);
  assert.strictEqual(c('2026-10-01').studied, false);
});

test('monthModel: 過去の月は次へ進める', () => {
  assert.strictEqual(A.monthModel({}, '2026-09', '2026-10-29').canNext, true);
});

test('shiftMonth: 年またぎ', () => {
  assert.strictEqual(A.shiftMonth('2026-01', -1), '2025-12');
  assert.strictEqual(A.shiftMonth('2026-12', 1), '2027-01');
  assert.strictEqual(A.shiftMonth('2026-10', 0), '2026-10');
});

test('studiedDays: 1 問以上答えた日の数', () => {
  assert.strictEqual(A.studiedDays({ '2026-10-28': { a: 1 }, '2026-10-27': { a: 0 }, x: { a: 5 } }), 1);
  assert.strictEqual(A.studiedDays(undefined), 0);
});
