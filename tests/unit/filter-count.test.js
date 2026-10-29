const test = require('node:test');
const assert = require('node:assert');
const { filterCountLabel } = require('../../src/filter-count.js');

test('件数と単位をラベルに入れる', () => {
  assert.deepStrictEqual(filterCountLabel(160, '問'), { label: 'この条件で解く（対象 160 問）', empty: false });
  assert.deepStrictEqual(filterCountLabel(1635, '語'), { label: 'この条件で解く（対象 1,635 語）', empty: false });
});

test('0 件は empty を立てる', () => {
  assert.deepStrictEqual(filterCountLabel(0, '問'), { label: 'この条件で解く（対象 0 問）', empty: true });
});

test('数でない値・負の値・小数は安全に 0 または切り捨てにする', () => {
  assert.strictEqual(filterCountLabel(undefined, '問').empty, true);
  assert.strictEqual(filterCountLabel(NaN, '問').empty, true);
  assert.strictEqual(filterCountLabel(-3, '問').empty, true);
  assert.strictEqual(filterCountLabel(12.9, '問').label, 'この条件で解く（対象 12 問）');
});
