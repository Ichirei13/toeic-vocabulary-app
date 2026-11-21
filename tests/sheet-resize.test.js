// 下から出るアプリ共通のシート（苦手リストなど）を、つまみで上下させて高さを変える検証。
// 実行: NODE_PATH=$(npm root -g) node tests/sheet-resize.test.js
const assert = require('assert');
const { test, withPage, run } = require('./labels-harness.cjs');

const KEY = 'toeic_sheet_heights_v1';
const sheetBox = page => page.evaluate(() => {
  const s = document.getElementById('bottom-sheet');
  const g = s.querySelector('.sheet-grab').getBoundingClientRect();
  return { h: s.getBoundingClientRect().height, box: s.parentElement.getBoundingClientRect().height, gx: g.left + g.width / 2, gy: g.top + g.height / 2, open: s.classList.contains('open') };
});
const openWeak = async page => {
  await page.evaluate(() => toggleWeakList());
  await page.waitForTimeout(450); // 開くアニメーション
};
// つまみを dy だけ動かす（steps 回に分けて、ゆっくり）
async function dragGrab(page, dy, steps = 8) {
  const b = await sheetBox(page);
  await page.mouse.move(b.gx, b.gy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(b.gx, b.gy + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150); // 止めてから離す（はじいたことにしない）
  await page.mouse.up();
}

test('dragging_the_grab_up_makes_the_sheet_taller_and_is_remembered_per_sheet', () => withPage({}, async page => {
  await openWeak(page);
  const b0 = await sheetBox(page);
  await dragGrab(page, -150);
  const b1 = await sheetBox(page);
  assert(Math.abs(b1.h - Math.min(b0.h + 150, b0.box * 0.9)) <= 3, `高さ ${b0.h} → ${b1.h}`);
  const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
  assert(saved && Math.abs(saved['苦手リスト'] - b1.h / b1.box) < 0.01, JSON.stringify(saved));
  // 閉じて開き直しても、同じ高さで開く
  await page.evaluate(() => closeSheet());
  await openWeak(page);
  const b2 = await sheetBox(page);
  assert(Math.abs(b2.h - b1.h) <= 3, `開き直した高さ ${b2.h}（覚えた高さ ${b1.h}）`);
  // 別の種類のシートは、覚えた高さを使わない（中身の高さで開く）
  await page.evaluate(() => { closeSheet(); toggleLabelList(); });
  await page.waitForTimeout(450);
  const other = await page.evaluate(() => document.getElementById('bottom-sheet').style.height);
  assert.strictEqual(other, '', 'ラベルのシートに苦手リストの高さが使われた');
}));

test('the_height_stays_within_the_limits', () => withPage({}, async page => {
  await openWeak(page);
  await dragGrab(page, -2000);
  let b = await sheetBox(page);
  assert(b.h <= b.box * 0.9 + 2, `上限を超えた: ${b.h} / ${b.box}`);
  await dragGrab(page, b.h - b.box * 0.25 + 20); // 下限の少し下（閉じるほどではない）まで下げる
  b = await sheetBox(page);
  assert.strictEqual(b.open, true, '下限の近くで閉じてしまった');
  assert(Math.abs(b.h - b.box * 0.25) <= 3, `下限で止まらない: ${b.h} / ${b.box}`);
}));

test('pulling_far_below_the_bottom_limit_closes_without_remembering', () => withPage({}, async page => {
  await openWeak(page);
  const b0 = await sheetBox(page);
  await dragGrab(page, b0.h); // 画面の下まで引き下ろす
  assert.strictEqual((await sheetBox(page)).open, false, '閉じない');
  assert.strictEqual(await page.evaluate(k => localStorage.getItem(k), KEY), null, '閉じたときの高さを覚えた');
}));

test('a_fast_downward_flick_closes', () => withPage({}, async page => {
  await openWeak(page);
  const b = await sheetBox(page);
  await page.mouse.move(b.gx, b.gy);
  await page.mouse.down();
  await page.mouse.move(b.gx, b.gy + 30);
  await page.mouse.move(b.gx, b.gy + 90);
  await page.mouse.up();
  assert.strictEqual((await sheetBox(page)).open, false, '素早く下へはじいても閉じない');
}));

test('tapping_the_grab_without_moving_changes_nothing', () => withPage({}, async page => {
  await openWeak(page);
  const b0 = await sheetBox(page);
  await page.mouse.click(b0.gx, b0.gy);
  const b1 = await sheetBox(page);
  assert.strictEqual(b1.open, true);
  assert(Math.abs(b1.h - b0.h) <= 1);
  assert.strictEqual(await page.evaluate(k => localStorage.getItem(k), KEY), null);
}));

test('the_grab_stays_visible_after_scrolling_the_contents', () => withPage({}, async page => {
  await page.evaluate(() => {
    for (let i = 1001; i < 1041; i++) state.grammarWeakData[i] = { streak: 0, added: Date.now(), due: Date.now(), u: Date.now() };
    setApp('grammar');
  });
  await openWeak(page);
  await page.evaluate(() => { document.getElementById('bottom-sheet').scrollTop = 400; });
  const r = await page.evaluate(() => {
    const s = document.getElementById('bottom-sheet').getBoundingClientRect();
    const g = document.querySelector('#bottom-sheet .sheet-grab').getBoundingClientRect();
    return { scrolled: document.getElementById('bottom-sheet').scrollTop, top: g.top - s.top };
  });
  assert(r.scrolled > 0, '中身がスクロールできる前提');
  assert(Math.abs(r.top) <= 1, `スクロールするとつまみが隠れる: ${JSON.stringify(r)}`);
}));

test('a_broken_saved_value_opens_at_the_default_height', () => withPage({ [KEY]: '{broken' }, async page => {
  await openWeak(page);
  assert.strictEqual(await page.evaluate(() => document.getElementById('bottom-sheet').style.height), '');
}));

run();
