const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp } = require('./helpers.cjs');

const TIME = '2026-10-21T10:00:00';
const day = n => ({ v: [n, n], g: [0, 0] });
const LOG = JSON.stringify({ '2026-10-19': day(5), '2026-10-20': day(8) });

const barText = page => page.evaluate(() => document.getElementById('streak-bar').textContent.trim());

test('起動直後は昨日までの連続日数と 今日 0/20 を出す', () => withApp({ time: TIME, storage: { toeic_daily_log: LOG } }, async page => {
  assert.equal(await barText(page), '🔥2日連続 ・ 今日 0/20');
}));

test('1問回答すると連続日数と今日の数が増える', () => withApp({ time: TIME, storage: { toeic_daily_log: LOG } }, async page => {
  await page.click('#dont-know-btn');
  assert.equal(await barText(page), '🔥3日連続 ・ 今日 1/20');
}));

test('バーを押すと目標が 20→50 になり、トーストが出て、保存され読み戻せる', () => withApp({ time: TIME, storage: { toeic_daily_log: LOG } }, async page => {
  await page.click('#streak-bar');
  assert.equal(await page.evaluate(() => state.goal), 50);
  assert.equal(await barText(page), '🔥2日連続 ・ 今日 0/50');
  assert.match(await page.textContent('.toast'), /50/);
  // 書いた直後のリロードは file:// だと反映が間に合わないことがあるので、保存した値と読み戻す処理を直接確かめる
  const r = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('toeic_settings')).goal;
    state.goal = 20;
    restoreSettings();
    return { saved, restored: state.goal };
  });
  assert.deepEqual(r, { saved: 50, restored: 50 });
}));

test('目標は 100 の次に 10 へ戻る。Enter キーでも変えられる', () => withApp({ time: TIME }, async page => {
  await page.evaluate(() => { state.goal = 100; cycleGoal(); });
  assert.equal(await page.evaluate(() => state.goal), 10);
  await page.focus('#streak-bar');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => state.goal), 20);
}));

test('目標に届いた日だけ done クラスが付く', () => withApp({
  time: TIME,
  storage: { toeic_daily_log: JSON.stringify({ '2026-10-21': { v: [20, 10], g: [0, 0] } }) },
}, async page => {
  assert.equal(await page.evaluate(() => document.getElementById('streak-bar').classList.contains('done')), true);
  await page.evaluate(() => { state.goal = 50; updateStreakBar(); });
  assert.equal(await page.evaluate(() => document.getElementById('streak-bar').classList.contains('done')), false);
}));

for (const bad of ['{"goal":7}', '{"goal":"x"}', '{}']) {
  test(`toeic_settings が ${bad} でも目標は 20`, () => withApp({ storage: { toeic_settings: bad } }, async page => {
    assert.equal(await page.evaluate(() => state.goal), 20);
  }));
}

// ---- 最終レビューの修正: 目標バーで押した Enter・Space が、次へ／採点まで実行しない ----

test('回答後に目標バーで Enter を押しても、次の問題へ進まない', () => withApp({ time: TIME }, async page => {
  await page.click('#dont-know-btn');
  await page.focus('#streak-bar');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => ({ goal: state.goal, index: state.currentIndex })), { goal: 50, index: 0 });
}));

test('カードをめくったあと目標バーで Enter を押しても、「覚えた」と採点されない', () => withApp({ time: TIME }, async page => {
  await page.click('[data-mode="flash"]');
  await page.click('#flash-card');
  await page.focus('#streak-bar');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => ({ goal: state.goal, answered: state.answered, count: state.answeredCount })), { goal: 50, answered: false, count: 0 });
}));

test('目標バーでは Space でも目標が変わる', () => withApp({ time: TIME }, async page => {
  await page.focus('#streak-bar');
  await page.keyboard.press(' ');
  assert.equal(await page.evaluate(() => state.goal), 50);
}));
