const test = require('node:test');
const assert = require('node:assert');
const P = require('../../src/pomodoro.js');

test('既定値と範囲', () => {
  assert.deepStrictEqual(P.POMO_DEFAULT_SETTINGS, {
    work: 25,
    brk: 5,
    long: 15,
    every: 4,
    auto: true,
    subject: '',
  });
});

test('normalizePomoSettings: 範囲内に収め、欠損・不正値は既定値で補う', () => {
  assert.deepStrictEqual(P.normalizePomoSettings(undefined), P.POMO_DEFAULT_SETTINGS);
  assert.deepStrictEqual(P.normalizePomoSettings({ work: 50, brk: 10, long: 20, every: 3, auto: false, subject: ' 金の文法 ' }), {
    work: 50,
    brk: 10,
    long: 20,
    every: 3,
    auto: false,
    subject: '金の文法',
  });
  assert.strictEqual(P.normalizePomoSettings({ work: 0 }).work, 1);
  assert.strictEqual(P.normalizePomoSettings({ work: 999 }).work, 120);
  assert.strictEqual(P.normalizePomoSettings({ every: 1 }).every, 2);
  assert.strictEqual(P.normalizePomoSettings({ every: 99 }).every, 8);
});

test('pomoSettingsPatch: 正しい項目だけを取り出す', () => {
  assert.deepStrictEqual(P.pomoSettingsPatch({ work: 30, brk: 'x', auto: false }), { work: 30, auto: false });
  assert.strictEqual(P.pomoSettingsPatch({}), null);
  assert.strictEqual(P.pomoSettingsPatch(null), null);
});

test('pomoDurationSec: モードごとの秒数を返す', () => {
  const s = { work: 25, brk: 5, long: 15, every: 4, auto: true, subject: '' };
  assert.strictEqual(P.pomoDurationSec('work', s), 1500);
  assert.strictEqual(P.pomoDurationSec('short', s), 300);
  assert.strictEqual(P.pomoDurationSec('long', s), 900);
});

test('nextPomoPhase: 集中と短休憩・長休憩のサイクル遷移', () => {
  assert.deepStrictEqual(P.nextPomoPhase('work', 0, 4), { mode: 'short', cycle: 1 });
  assert.deepStrictEqual(P.nextPomoPhase('short', 1, 4), { mode: 'work', cycle: 1 });
  assert.deepStrictEqual(P.nextPomoPhase('work', 3, 4), { mode: 'long', cycle: 0 });
  assert.deepStrictEqual(P.nextPomoPhase('long', 0, 4), { mode: 'work', cycle: 0 });
});

test('formatPomoTime: MM:SS 形式に整形する', () => {
  assert.strictEqual(P.formatPomoTime(1500), '25:00');
  assert.strictEqual(P.formatPomoTime(65), '01:05');
  assert.strictEqual(P.formatPomoTime(0), '00:00');
  assert.strictEqual(P.formatPomoTime(-5), '00:00');
});

test('recordPomoSession & sanitizePomoLog & mergePomoLog: 日別記録の追加・検証・統合', () => {
  let log = {};
  log = P.recordPomoSession(log, '2026-11-05', 25, '金の文法');
  log = P.recordPomoSession(log, '2026-11-05', 25, 'TEPPAN英単語');
  assert.deepStrictEqual(log['2026-11-05'], {
    minutes: 50,
    sets: 2,
    subjects: { '金の文法': 25, 'TEPPAN英単語': 25 },
  });

  const { log: sanitized, invalid } = P.sanitizePomoLog({
    '2026-11-05': log['2026-11-05'],
    'bad-key': { minutes: 25, sets: 1 },
    '2026-11-04': { minutes: 0, sets: 0 },
  });
  assert.strictEqual(invalid, 2);
  assert.deepStrictEqual(Object.keys(sanitized), ['2026-11-05']);

  const merged = P.mergePomoLog(
    { '2026-11-05': { minutes: 25, sets: 1, subjects: { '金の文法': 25 } } },
    { '2026-11-05': { minutes: 50, sets: 2, subjects: { '金の文法': 50 } }, '2026-11-04': { minutes: 25, sets: 1, subjects: {} } }
  );
  assert.strictEqual(merged['2026-11-05'].minutes, 50);
  assert.strictEqual(merged['2026-11-04'].minutes, 25);
});
