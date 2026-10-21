const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp } = require('./helpers.cjs');

const DUE = { streak: 0, added: 1, due: 0 };
const DUE_WORDS = ['cornerstone', 'substantial', 'moderation'];
const WEAK_STORE = JSON.stringify({ e2j: Object.fromEntries(DUE_WORDS.map(w => [w, DUE])) });

test('orderByDue: 期限の来たものが先頭に来て、要素は変わらず、入力は変えない', () => withApp({}, async page => {
  const r = await page.evaluate(() => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const copy = [...items];
    const out = orderByDue(items, x => x < 5);
    return { head: out.slice(0, 5), all: [...out].sort((a, b) => a - b), untouched: JSON.stringify(items) === JSON.stringify(copy), copy };
  });
  assert.deepEqual([...r.head].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.deepEqual(r.all, r.copy);
  assert.equal(r.untouched, true);
}));

test('orderByDue: 期限切れが0個でも全部が期限切れでも全要素が残る', () => withApp({}, async page => {
  const r = await page.evaluate(() => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    return [orderByDue(items, () => false), orderByDue(items, () => true)].map(o => [...o].sort((a, b) => a - b));
  });
  assert.deepEqual(r[0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(r[1], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
}));

test('単語: 要復習の3語が出題の先頭に並ぶ', () => withApp({ storage: { toeic_weak_words_by_mode: WEAK_STORE } }, async page => {
  const head = await page.evaluate(() => state.pool.slice(0, 3).map(w => w.w).sort());
  assert.deepEqual(head, [...DUE_WORDS].sort());
}));

test('単語: 「ランダム」に切り替えられ、苦手のみのときは設定によらず同じ語の集合', () =>
  withApp({ storage: { toeic_weak_words_by_mode: WEAK_STORE } }, async page => {
    await page.click('#filter-toggle');
    await page.click('[data-weak="weak_only"]');
    const poolWords = () => page.evaluate(() => state.pool.map(w => w.w).sort());
    const dueFirst = await poolWords();
    await page.click('[data-priority="random"]');
    assert.equal(await page.evaluate(() => state.priority), 'random');
    assert.deepEqual(await poolWords(), dueFirst);
    assert.deepEqual(dueFirst, [...DUE_WORDS].sort());
    assert.deepEqual(page.errors, []);
  }));

test('文法: 要復習の問題が先頭に来る', () =>
  withApp({ storage: { toeic_weak_grammar: JSON.stringify({ 1: DUE }) } }, async page => {
    await page.click('[data-app="grammar"]');
    assert.equal(await page.evaluate(() => state.grammarPool[0].id), 1);
  }));

for (const [settings, expected] of [['{}', 'due_first'], ['{"priority":"x"}', 'due_first'], ['{"priority":"random"}', 'random']]) {
  test(`toeic_settings が ${settings} のとき priority は ${expected}`, () =>
    withApp({ storage: { toeic_settings: settings } }, async page => {
      assert.equal(await page.evaluate(() => state.priority), expected);
    }));
}

test('出題の続き: 初期設定では署名の形が変わらず、回答のあとも続きから復元できる', () => withApp({}, async page => {
  const sig = await page.evaluate(() => sessionSignature('vocab'));
  assert.equal(sig, JSON.stringify([await page.evaluate(() => RAW_WORDS.length), 'all', null, [], 'all', 'all']));
  await page.click('#dont-know-btn');
  await page.click('#next-btn');
  const r = await page.evaluate(() => {
    const index = state.currentIndex;
    state.pool = [];
    state.currentIndex = 0;
    return { index, ok: restoreSession('vocab'), restored: state.currentIndex };
  });
  assert.deepEqual(r, { index: 1, ok: true, restored: 1 });
}));

test('出題の続き: 「ランダム」のときは署名が変わり、そのときの続きも復元できる', () => withApp({}, async page => {
  const before = await page.evaluate(() => sessionSignature('vocab'));
  await page.click('#filter-toggle');
  await page.click('[data-priority="random"]');
  const after = await page.evaluate(() => sessionSignature('vocab'));
  assert.notEqual(after, before);
  assert.ok(after.endsWith(',"random"]'));
  await page.click('#dont-know-btn');
  await page.click('#next-btn');
  const r = await page.evaluate(() => {
    state.pool = [];
    state.currentIndex = 0;
    return { ok: restoreSession('vocab'), restored: state.currentIndex };
  });
  assert.deepEqual(r, { ok: true, restored: 1 });
}));
