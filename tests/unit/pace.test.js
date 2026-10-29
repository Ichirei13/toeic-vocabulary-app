const test = require('node:test');
const assert = require('node:assert');
const P = require('../../src/pace.js');

test('既定値は単語 5 秒・文法 20 秒', () => {
  assert.deepStrictEqual(P.DEFAULT_PACE, { vocab: 5, grammar: 20 });
});

test('normalizePace: 範囲に収め、刻みに丸める。数でなければ既定値', () => {
  assert.strictEqual(P.normalizePace('vocab', 7), 7);
  assert.strictEqual(P.normalizePace('vocab', 4.3), 4.5);
  assert.strictEqual(P.normalizePace('vocab', 0), 1);
  assert.strictEqual(P.normalizePace('vocab', 99), 30);
  assert.strictEqual(P.normalizePace('grammar', 25.4), 25);
  assert.strictEqual(P.normalizePace('grammar', 1), 5);
  assert.strictEqual(P.normalizePace('grammar', 500), 120);
  assert.strictEqual(P.normalizePace('vocab', undefined), 5);
  assert.strictEqual(P.normalizePace('grammar', null), 20);
  assert.strictEqual(P.normalizePace('vocab', '8'), 5);
  assert.strictEqual(P.normalizePace('vocab', NaN), 5);
});

test('clampPace: 入力値（文字列も可）を範囲に直す。数でなければ null', () => {
  assert.strictEqual(P.clampPace('vocab', '8'), 8);
  assert.strictEqual(P.clampPace('vocab', 0.2), 1);
  assert.strictEqual(P.clampPace('grammar', '30'), 30);
  assert.strictEqual(P.clampPace('grammar', ''), null);
  assert.strictEqual(P.clampPace('grammar', 'x'), null);
});

test('normalizePaceTarget: 欠けた・壊れた値は既定値で補う', () => {
  assert.deepStrictEqual(P.normalizePaceTarget(undefined), { vocab: 5, grammar: 20 });
  assert.deepStrictEqual(P.normalizePaceTarget({ vocab: 8 }), { vocab: 8, grammar: 20 });
  assert.deepStrictEqual(P.normalizePaceTarget({ vocab: 'x', grammar: 40 }), { vocab: 5, grammar: 40 });
  assert.deepStrictEqual(P.normalizePaceTarget([]), { vocab: 5, grammar: 20 });
});

test('paceTargetPatch: 正しい項目だけを返す。何も無ければ null', () => {
  assert.deepStrictEqual(P.paceTargetPatch({ vocab: 8, grammar: 'x' }), { vocab: 8 });
  assert.deepStrictEqual(P.paceTargetPatch({ grammar: 45 }), { grammar: 45 });
  assert.strictEqual(P.paceTargetPatch({}), null);
  assert.strictEqual(P.paceTargetPatch(undefined), null);
  assert.strictEqual(P.paceTargetPatch('x'), null);
});

test('paceTier: 既定値では今までのバッジの境界と同じ（単語 3.5 / 6.0 秒、文法 10 / 20 秒）', () => {
  assert.strictEqual(P.paceTier('vocab', 3.5, true, 5), 'top');
  assert.strictEqual(P.paceTier('vocab', 3.6, true, 5), 'ok');
  assert.strictEqual(P.paceTier('vocab', 6.0, true, 5), 'ok');
  assert.strictEqual(P.paceTier('vocab', 6.1, true, 5), 'none');
  assert.strictEqual(P.paceTier('grammar', 10, true, 20), 'top');
  assert.strictEqual(P.paceTier('grammar', 10.1, true, 20), 'ok');
  assert.strictEqual(P.paceTier('grammar', 20, true, 20), 'ok');
  assert.strictEqual(P.paceTier('grammar', 20.1, true, 20), 'none');
});

test('paceTier: 目標タイムを変えると境界が割合でずれる。不正解は常に none', () => {
  assert.strictEqual(P.paceTier('vocab', 7, true, 10), 'top');
  assert.strictEqual(P.paceTier('vocab', 12, true, 10), 'ok');
  assert.strictEqual(P.paceTier('vocab', 12.1, true, 10), 'none');
  assert.strictEqual(P.paceTier('grammar', 15, true, 30), 'top');
  assert.strictEqual(P.paceTier('grammar', 30, true, 30), 'ok');
  assert.strictEqual(P.paceTier('vocab', 1, false, 5), 'none');
});

test('isFastAnswer: 正解で目標タイム以内なら即答', () => {
  assert.strictEqual(P.isFastAnswer(5, true, 5), true);
  assert.strictEqual(P.isFastAnswer(5.1, true, 5), false);
  assert.strictEqual(P.isFastAnswer(1, false, 5), false);
});
