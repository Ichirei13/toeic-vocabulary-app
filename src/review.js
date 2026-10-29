// 演習 1 回分の「苦手を復習できた数・克服できた数」の集計。DOM にも保存にも触れない。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  function createSessionReview() {
    return { reviewed: 0, graduated: 0 };
  }

  // 回答の前に苦手だった問題に正解したら「復習できた」。その回答で苦手から外れたら「克服」。
  // 不正解や、もともと苦手でない問題は数えない
  function noteReviewAnswer(counter, { wasWeak, isWeakNow, isCorrect }) {
    if (!wasWeak || !isCorrect) return counter;
    counter.reviewed++;
    if (!isWeakNow) counter.graduated++;
    return counter;
  }

  function reviewSummaryText(counter) {
    if (!counter || counter.reviewed <= 0) return '';
    const base = `苦手を ${counter.reviewed} 問 復習できました。`;
    return counter.graduated > 0 ? `${base}そのうち ${counter.graduated} 問は克服しました！` : base;
  }

  return { createSessionReview, noteReviewAnswer, reviewSummaryText };
});
