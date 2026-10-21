const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp } = require('./helpers.cjs');

// findBlank の結果で切り出した文字列（見つからなければ null）
const blankOf = (page, w, e) => page.evaluate(([w, e]) => {
  const b = findBlank({ w, e });
  return b ? e.slice(b.start, b.end) : null;
}, [w, e]);

test('findBlank: 見出し語がそのまま例文にあれば、その部分を空欄にする', () => withApp({}, async page => {
  assert.equal(await blankOf(page, 'cornerstone', 'Education is the cornerstone of a prosperous society.'), 'cornerstone');
}));

test('findBlank: 活用していれば語幹で一致させる', () => withApp({}, async page => {
  assert.equal(await blankOf(page, 'marinate', 'The chef marinated the chicken in herbs.'), 'marinated');
}));

test('findBlank: 大文字小文字は区別しない', () => withApp({}, async page => {
  assert.equal(await blankOf(page, 'update', 'Update the file'), 'Update');
}));

test('findBlank: 活用した句動詞のように一致しないものは null', () => withApp({}, async page => {
  assert.equal(await blankOf(page, 'opt for', 'Many employees opted for flexible hours.'), null);
}));

test('findBlank: 日本語訳（…）の中は対象外で、空欄の範囲もかからない', () => withApp({}, async page => {
  assert.equal(await blankOf(page, 'vacation', 'a paid vacation（有給休暇）'), 'vacation');
  assert.equal(await blankOf(page, 'abc', 'foo（abc）'), null);
}));

test('findBlank: 正規表現の記号を含む見出し語や空の例文でも例外が出ず null', () => withApp({}, async page => {
  for (const w of ['a (b)+', '[', '.*', 'x\\', '~を参照する', 'flyer/flier']) {
    assert.equal(await blankOf(page, w, 'x'), null, w);
  }
  assert.equal(await blankOf(page, 'word', ''), null);
  assert.equal(await page.evaluate(() => findBlank({ w: 'word' })), null);
}));

test('findBlank: 全データの97%以上は空欄にできる', () => withApp({}, async page => {
  const r = await page.evaluate(() => ({ ok: RAW_WORDS.filter(w => findBlank(w)).length, total: RAW_WORDS.length }));
  assert.ok(r.ok / r.total >= 0.97, `${r.ok} / ${r.total}`);
}));

test('clozeSentenceHtml: 回答前は空欄で日本語訳なし、回答後は活用形を mark で囲む', () => withApp({}, async page => {
  const r = await page.evaluate(() => {
    const word = { w: 'marinate', e: 'The chef marinated the chicken（シェフは鶏肉を漬け込んだ）' };
    return { hidden: clozeSentenceHtml(word, false), shown: clozeSentenceHtml(word, true) };
  });
  assert.equal(r.hidden, 'The chef ------- the chicken');
  assert.equal(r.shown, 'The chef <mark>marinated</mark> the chicken（シェフは鶏肉を漬け込んだ）');
}));

test('clozeSentenceHtml: 例文の HTML 記号は無害化される', () => withApp({}, async page => {
  const html = await page.evaluate(() => clozeSentenceHtml({ w: 'a', e: 'x < a & b' }, true));
  assert.equal(html, 'x &lt; <mark>a</mark> &amp; b');
}));

test('画面: 穴埋めモードに切り替えると、空欄にできる語だけが出題され、選択肢は4つ', () => withApp({}, async page => {
  await page.click('[data-mode="cloze"]');
  const r = await page.evaluate(() => ({ mode: state.mode, allBlank: state.pool.every(w => findBlank(w)), size: state.pool.length }));
  assert.equal(r.mode, 'cloze');
  assert.equal(r.allBlank, true);
  assert.ok(r.size > 0);
  assert.match(await page.textContent('.cloze-sentence'), /-------/);
  assert.equal(await page.locator('#choices-container .choice-btn').count(), 4);
}));

test('画面: 正解すると例文欄が現れて mark が入り、苦手には入らない', () => withApp({}, async page => {
  await page.click('[data-mode="cloze"]');
  const idx = await page.evaluate(() => state.currentOptions.findIndex(o => o.w === state.pool[state.currentIndex].w));
  await page.locator('#choices-container .choice-btn').nth(idx).click();
  assert.equal(await page.isVisible('#example-box'), true);
  assert.match(await page.innerHTML('#example-box'), /<mark>/);
  assert.deepEqual(await page.evaluate(() => state.weakByMode.cloze), {});
}));

test('画面: 不正解は穴埋めの苦手にだけ入り、英→日の苦手には入らない', () => withApp({}, async page => {
  await page.click('[data-mode="cloze"]');
  const r = await page.evaluate(() => {
    const word = state.pool[state.currentIndex].w;
    return { word, wrong: state.currentOptions.findIndex(o => o.w !== word) };
  });
  await page.locator('#choices-container .choice-btn').nth(r.wrong).click();
  const weak = await page.evaluate(() => ({ cloze: Object.keys(state.weakByMode.cloze), e2j: Object.keys(state.weakByMode.e2j) }));
  assert.deepEqual(weak, { cloze: [r.word], e2j: [] });
}));

test('画面: 穴埋めから英→日に戻すと出題が絞り込みなしの語数に戻り、署名もモードで変わる', () => withApp({}, async page => {
  const sigE2j = await page.evaluate(() => sessionSignature('vocab'));
  await page.click('[data-mode="cloze"]');
  assert.notEqual(await page.evaluate(() => sessionSignature('vocab')), sigE2j);
  await page.click('[data-mode="e2j"]');
  const r = await page.evaluate(() => ({ size: state.pool.length, all: dedupeWords(RAW_WORDS).length }));
  assert.equal(r.size, r.all);
  assert.equal(await page.evaluate(() => sessionSignature('vocab')), sigE2j);
}));

test('保存した設定の mode が cloze なら復元される', () => withApp({ storage: { toeic_settings: '{"mode":"cloze"}' } }, async page => {
  assert.equal(await page.evaluate(() => state.mode), 'cloze');
}));

test('cloze のキーがない古い苦手・学習済みの記録でも起動できる', () => withApp({
  storage: { toeic_weak_words_by_mode: '{"e2j":{}}', toeic_seen_words_by_mode: '{"e2j":[]}' },
}, async page => {
  const r = await page.evaluate(() => ({ weak: state.weakByMode.cloze, seen: [...state.seenByMode.cloze] }));
  assert.deepEqual(r, { weak: {}, seen: [] });
  assert.deepEqual(page.errors, []);
}));

test('cloze を含まない古いバックアップも読み込める', () => withApp({}, async page => {
  const ok = await page.evaluate(() => {
    const b = buildBackup();
    delete b.data.weakWords.cloze;
    delete b.data.seenWords.cloze;
    return parseBackup(JSON.stringify(b)).ok;
  });
  assert.equal(ok, true);
}));

test('苦手リストのモードのチップに「穴埋め」が出る', () => withApp({}, async page => {
  await page.evaluate(() => toggleWeakList());
  assert.equal(await page.locator('[data-weak-mode="cloze"]').count(), 1);
  assert.match(await page.textContent('[data-weak-mode="cloze"]'), /穴埋め/);
}));

// ---- 最終レビューの修正: 穴埋めに出入りしても、他のモードの出題の続きは失われない ----

test('英→日で2問解いて穴埋めを試して戻っても、出題の続きと並びが残る', () => withApp({}, async page => {
  for (let i = 0; i < 2; i++) {
    await page.click('#dont-know-btn');
    await page.click('#next-btn');
  }
  const before = await page.evaluate(() => ({ index: state.currentIndex, answered: state.answeredCount, head: state.pool.slice(0, 5).map(w => w.w) }));
  assert.equal(before.index, 2);
  await page.click('[data-mode="cloze"]');
  await page.click('[data-mode="e2j"]');
  const after = await page.evaluate(() => ({ index: state.currentIndex, answered: state.answeredCount, head: state.pool.slice(0, 5).map(w => w.w) }));
  assert.deepEqual(after, before);
}));

test('穴埋めの続きも、他のモードに寄り道して戻ると残る', () => withApp({}, async page => {
  await page.click('[data-mode="cloze"]');
  await page.click('#dont-know-btn');
  await page.click('#next-btn');
  const before = await page.evaluate(() => ({ index: state.currentIndex, head: state.pool.slice(0, 5).map(w => w.w) }));
  assert.equal(before.index, 1);
  await page.click('[data-mode="e2j"]');
  await page.click('[data-mode="cloze"]');
  assert.deepEqual(await page.evaluate(() => ({ index: state.currentIndex, head: state.pool.slice(0, 5).map(w => w.w) })), before);
}));

test('いま選んでいる穴埋めをもう一度押しても、進み具合は戻らない', () => withApp({}, async page => {
  await page.click('[data-mode="cloze"]');
  await page.click('#dont-know-btn');
  await page.click('#next-btn');
  await page.click('[data-mode="cloze"]');
  assert.equal(await page.evaluate(() => state.currentIndex), 1);
}));

test('穴埋めのまま開き直しても、穴埋めの続きから始まる（設定と出題の続きが合う）', () => withApp({}, async page => {
  await page.click('[data-mode="cloze"]');
  await page.click('#dont-know-btn');
  await page.click('#next-btn');
  const r = await page.evaluate(() => {
    const index = state.currentIndex;
    state.pool = [];
    state.currentIndex = 0;
    return { index, ok: restoreSession('vocab'), restored: state.currentIndex, allBlank: state.pool.every(w => findBlank(w)) };
  });
  assert.deepEqual(r, { index: 1, ok: true, restored: 1, allBlank: true });
}));
