const test = require('node:test');
const assert = require('node:assert');
const R = require('../../src/review.js');

test('苦手だった問題に正解すると復習として数える', () => {
  const c = R.createSessionReview();
  R.noteReviewAnswer(c, { wasWeak: true, isWeakNow: true, isCorrect: true });
  assert.deepStrictEqual(c, { reviewed: 1, graduated: 0 });
});

test('苦手から外れたら克服としても数える', () => {
  const c = R.createSessionReview();
  R.noteReviewAnswer(c, { wasWeak: true, isWeakNow: false, isCorrect: true });
  assert.deepStrictEqual(c, { reviewed: 1, graduated: 1 });
});

test('不正解・もともと苦手でない問題は数えない', () => {
  const c = R.createSessionReview();
  R.noteReviewAnswer(c, { wasWeak: true, isWeakNow: true, isCorrect: false });
  R.noteReviewAnswer(c, { wasWeak: false, isWeakNow: false, isCorrect: true });
  R.noteReviewAnswer(c, { wasWeak: false, isWeakNow: true, isCorrect: false });
  assert.deepStrictEqual(c, { reviewed: 0, graduated: 0 });
});

test('文言: 0 件は空、克服が無ければ復習のみ、あれば両方', () => {
  assert.strictEqual(R.reviewSummaryText({ reviewed: 0, graduated: 0 }), '');
  assert.strictEqual(R.reviewSummaryText(undefined), '');
  assert.strictEqual(R.reviewSummaryText({ reviewed: 3, graduated: 0 }), '苦手を 3 問 復習できました。');
  assert.strictEqual(R.reviewSummaryText({ reviewed: 3, graduated: 1 }), '苦手を 3 問 復習できました。そのうち 1 問は克服しました！');
});
