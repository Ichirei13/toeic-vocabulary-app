const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp } = require('./helpers.cjs');

const TIME = '2026-10-21T10:00:00';
const LOG = {
  '2026-10-21': { v: [3, 2], g: [1, 1] },
  '2026-10-15': { v: [10, 8], g: [0, 0] },
  '2026-10-14': { v: [5, 5], g: [0, 0] },
};

test('statsSummary: 今日・直近7日・累計・14日分の棒', () => withApp({}, async page => {
  const r = await page.evaluate(log => statsSummary(log, '2026-10-21'), LOG);
  assert.deepEqual(r.today, { n: 4, c: 3 });
  assert.deepEqual(r.week, { n: 14, c: 11 }); // 10/15 は入り、10/14 は入らない
  assert.deepEqual(r.total, { n: 19, c: 16 });
  assert.equal(r.days.length, 14);
  assert.equal(r.days[0].key, '2026-10-08');
  assert.equal(r.days[13].key, '2026-10-21');
  assert.equal(r.days[13].n, 4);
}));

test('statsSummary: ログが空ならすべて 0 で例外なし', () => withApp({}, async page => {
  const r = await page.evaluate(() => statsSummary({}, '2026-10-21'));
  assert.deepEqual([r.today, r.week, r.total], [{ n: 0, c: 0 }, { n: 0, c: 0 }, { n: 0, c: 0 }]);
  assert.equal(r.days.length, 14);
  assert.ok(r.days.every(d => d.n === 0));
}));

test('learnedStats: 全モードをまとめて重複なしで数える', () => withApp({}, async page => {
  const r = await page.evaluate(() => {
    const [a, b, c] = [...new Set(RAW_WORDS.map(x => x.w))];
    const due = { streak: 0, added: 1, due: 0 };
    const later = { streak: 0, added: 1, due: Date.now() + 1e10 };
    state.seenByMode.e2j = new Set([a, b]);
    state.seenByMode.flash = new Set([b, c]);
    state.weakByMode.e2j = { [a]: { ...due }, [b]: { ...later } };
    state.weakByMode.j2e = { [a]: { ...due } }; // 同じ語は1つと数える
    state.grammarWeakData = { 1: { ...due }, 2: { ...later } };
    return { ...learnedStats(), unique: new Set(RAW_WORDS.map(x => x.w)).size };
  });
  assert.deepEqual(
    { learned: r.learned, weak: r.weak, due: r.due, gWeak: r.gWeak, gDue: r.gDue },
    { learned: 3, weak: 2, due: 1, gWeak: 2, gDue: 1 },
  );
  assert.equal(r.total, r.unique);
}));

test('画面: 「統計」でシートが開き、今日・直近7日・累計と棒グラフが出る。もう一度で閉じる', () =>
  withApp({ time: TIME, storage: { toeic_daily_log: JSON.stringify(LOG) } }, async page => {
    await page.click('.stats span:has-text("統計")');
    assert.equal(await page.evaluate(() => isSheetOpen()), true);
    assert.equal(await page.textContent('#sheet-title'), '学習統計');
    const rows = await page.$$eval('.stat-row', els => Object.fromEntries(els.map(e => [
      e.querySelector('.stat-label').textContent, e.querySelector('.stat-value').textContent,
    ])));
    assert.equal(rows['今日'], '4問 ・ 正答率 75%');
    assert.equal(rows['直近7日'], '14問 ・ 正答率 79%');
    assert.equal(rows['累計'], '19問 ・ 正答率 84%');
    assert.equal(await page.$$eval('.stat-bar', els => els.length), 14);
    assert.equal(await page.$$eval('.stat-bar-col', els => els[13].getAttribute('aria-label')), '10/21 4問');
    await page.evaluate(() => toggleStats());
    assert.equal(await page.evaluate(() => isSheetOpen()), false);
  }));

test('画面: 記録がなければ 0問 だけで正答率は出さず、学習済み・苦手の行が出る', () => withApp({ time: TIME }, async page => {
  await page.click('.stats span:has-text("統計")');
  const rows = await page.$$eval('.stat-row', els => Object.fromEntries(els.map(e => [
    e.querySelector('.stat-label').textContent, e.querySelector('.stat-value').textContent,
  ])));
  assert.equal(rows['今日'], '0問');
  assert.equal(rows['累計'], '0問');
  const total = await page.evaluate(() => learnedStats().total);
  assert.equal(rows['学習済み'], `0 / ${total}語（0%）`);
  assert.equal(rows['単語'], '苦手 0語 ・ 要復習 0語');
  assert.equal(rows['文法'], '苦手 0問 ・ 要復習 0問');
  assert.deepEqual(page.errors, []);
}));
