// 下から出るシートの高さ（指で上下させる）の計算の単体テスト
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/sheet-size.js');

test('resolveSheetDrag: 指の移動ぶんだけ高さが変わり、上下の範囲に収まる', () => {
  const base = { startPx: 300, containerPx: 800, velocity: 0 };
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: -100 }).px, 400, '上へ 100 動かすと 100 高くなる');
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: 50 }).px, 250, '下へ 50 動かすと 50 低くなる');
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: -2000 }).px, 800 * S.SHEET_SIZE.maxRatio, '上限は容器の高さ × maxRatio');
  const low = S.resolveSheetDrag({ ...base, dyPx: 140 }); // 160px まで下げる（下限 200px の 48px 手前までは閉じない）
  assert.equal(low.close, false);
  assert.equal(low.px, 800 * S.SHEET_SIZE.minRatio, '下限は容器の高さ × minRatio（閉じるほどではない）');
  assert.ok(Math.abs(S.resolveSheetDrag({ ...base, dyPx: -100 }).ratio - 0.5) < 1e-9, 'ratio は容器の高さに対する割合');
});

test('resolveSheetDrag: 下限よりさらに引き下ろすか、素早く下へはじくと閉じる', () => {
  const base = { startPx: 300, containerPx: 800, velocity: 0 };
  const minPx = 800 * S.SHEET_SIZE.minRatio; // 200
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: 300 - minPx + S.SHEET_SIZE.closeSlackPx - 1 }).close, false);
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: 300 - minPx + S.SHEET_SIZE.closeSlackPx + 1 }).close, true);
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: 60, velocity: 1.2 }).close, true, '素早く下へはじいた');
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: 10, velocity: 1.2 }).close, false, '動いた量が小さいはじきでは閉じない');
  assert.equal(S.resolveSheetDrag({ ...base, dyPx: -60, velocity: -1.2 }).close, false, '上へはじいても閉じない');
});

test('resolveSheetDrag: minPx で下限を引き上げられる（見出しとボタンが隠れないように）', () => {
  const r = S.resolveSheetDrag({ startPx: 300, dyPx: 120, containerPx: 600, velocity: 0, minPx: 220 });
  assert.equal(r.px, 220);
  assert.equal(r.close, false);
});

test('resolveSheetDrag: 不正な値でも NaN を返さない', () => {
  for (const bad of [{}, { startPx: NaN, dyPx: 10, containerPx: 800 }, { startPx: 300, dyPx: 'x', containerPx: 0 }]) {
    const r = S.resolveSheetDrag(bad);
    assert.ok(Number.isFinite(r.px) && Number.isFinite(r.ratio), JSON.stringify(bad));
    assert.equal(r.close, false);
  }
});

test('sheetHeightRatio: 覚えた割合は範囲内の数だけを返し、それ以外は null（既定の高さで開く）', () => {
  const heights = { a: 0.5, b: 0.95, c: 0.1, d: 'x', e: NaN };
  assert.equal(S.sheetHeightRatio(heights, 'a'), 0.5);
  assert.equal(S.sheetHeightRatio(heights, 'b'), S.SHEET_SIZE.maxRatio, '上限を超える値は上限に丸める');
  assert.equal(S.sheetHeightRatio(heights, 'c'), S.SHEET_SIZE.minRatio, '下限より小さい値は下限に丸める');
  assert.equal(S.sheetHeightRatio(heights, 'd'), null);
  assert.equal(S.sheetHeightRatio(heights, 'e'), null);
  assert.equal(S.sheetHeightRatio(heights, 'none'), null);
  assert.equal(S.sheetHeightRatio(null, 'a'), null);
  assert.equal(S.sheetHeightRatio({ __proto__: { a: 0.5 } }, 'a'), null, '自分のキーだけを見る');
});

test('withSheetHeight: 覚えた割合を足した新しい表を返し、元の表は変えない。壊れた表は空として扱う', () => {
  const before = { a: 0.5 };
  const after = S.withSheetHeight(before, 'b', 0.6);
  assert.deepEqual(after, { a: 0.5, b: 0.6 });
  assert.deepEqual(before, { a: 0.5 });
  assert.deepEqual(S.withSheetHeight('broken', 'a', 0.4), { a: 0.4 });
  assert.deepEqual(S.withSheetHeight({}, 'a', 2), { a: S.SHEET_SIZE.maxRatio }, '範囲外は丸めて覚える');
  assert.deepEqual(S.withSheetHeight({ a: 0.5 }, 'a', NaN), { a: 0.5 }, '数でなければ覚えない');
});
