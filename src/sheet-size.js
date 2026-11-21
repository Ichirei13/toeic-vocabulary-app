// 下から出るシート（アプリ共通のシートと、グラフの詳細シート）の高さを指で上下させるときの計算。
// DOM にも localStorage にも触れない純関数（ブラウザでは StudyCore.*、Node では require）。
// 高さは「シートが入っている容器の高さに対する割合」で覚える（画面の大きさや向きが変わっても同じ見え方になる）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const SHEET_SIZE = {
    minRatio: 0.25,     // これより低くはしない（容器の高さに対する割合）
    maxRatio: 0.9,      // これより高くはしない
    closeSlackPx: 48,   // 下限からさらにこれだけ引き下ろしたら閉じる
    flickVelocity: 0.8, // 下へこの速さ（px/ms）以上ではじいたら閉じる
    flickMinPx: 40,     // はじいて閉じるのに必要な、下への移動量
  };

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const clampRatio = r => Math.min(SHEET_SIZE.maxRatio, Math.max(SHEET_SIZE.minRatio, r));

  // つまみを動かし終えたとき（と動かしている間）の高さを決める。
  //   startPx: つかんだときのシートの高さ、dyPx: 指の縦の移動量（下が正）、containerPx: 容器の高さ、
  //   velocity: 離す直前の縦の速さ（px/ms、下が正）、minPx: 下限をこれ以上にする（見出しとボタンが隠れないように）
  // 返り値 { px, ratio, close }。close が true なら閉じる（px は下限のまま返す）
  function resolveSheetDrag(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    const container = num(opts.containerPx) > 0 ? opts.containerPx : 0;
    const startOk = num(opts.startPx) != null;
    const start = startOk ? opts.startPx : 0;
    const dy = num(opts.dyPx) != null ? opts.dyPx : 0;
    const velocity = num(opts.velocity) != null ? opts.velocity : 0;
    if (container <= 0) return { px: Math.max(0, start), ratio: 0, close: false };
    const maxPx = container * SHEET_SIZE.maxRatio;
    const minPx = Math.min(maxPx, Math.max(container * SHEET_SIZE.minRatio, num(opts.minPx) || 0));
    const raw = start - dy;
    const close = startOk && (raw < minPx - SHEET_SIZE.closeSlackPx
      || (velocity >= SHEET_SIZE.flickVelocity && dy >= SHEET_SIZE.flickMinPx)); // 元の高さが分からなければ閉じない
    const px = Math.min(maxPx, Math.max(minPx, raw));
    return { px, ratio: px / container, close };
  }

  // 覚えた割合の表 { [シートの名前]: 割合 } から、そのシートの割合を返す。無い・壊れているときは null（既定の高さで開く）
  function sheetHeightRatio(heights, key) {
    if (!heights || typeof heights !== 'object' || !Object.prototype.hasOwnProperty.call(heights, key)) return null;
    const r = num(heights[key]);
    return r == null ? null : clampRatio(r);
  }

  // 割合を覚えた新しい表を返す（元の表は変えない）。数でない割合は覚えない
  function withSheetHeight(heights, key, ratio) {
    const base = heights && typeof heights === 'object' && !Array.isArray(heights) ? heights : {};
    const out = {};
    for (const k of Object.keys(base)) out[k] = base[k];
    const r = num(ratio);
    if (r != null) out[key] = Math.round(clampRatio(r) * 1000) / 1000;
    return out;
  }

  return { SHEET_SIZE, resolveSheetDrag, sheetHeightRatio, withSheetHeight };
});
