// 絞り込みシートの「この条件で解く」ボタンに出す文言と、0 件の判定。
// ブラウザでは StudyCore.filterCountLabel、node では require で使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  function filterCountLabel(count, unit) {
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    return {
      label: `この条件で解く（対象 ${n.toLocaleString('en-US')} ${unit}）`,
      empty: n === 0,
    };
  }
  return { filterCountLabel };
});
