// 解答後の 🏷 ボタン（ワンタップで最後に使ったラベル・再タップと長押しで選ぶ画面・L キー）の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/labels-ui.test.js
const assert = require('assert');
const { test, withPage, run } = require('./labels-harness.cjs');

// 300問以上だと絞り込みを促す画面が上に出るので、金の文法（160問）だけにして解く
const startGrammar = page => page.evaluate(() => { setApp('grammar'); state.grammarBook = 'kin'; applyGrammarFilters(); });
// 次の問題に進んだ直後は選択肢が動いていて page.click が待ち続けるので、DOM のクリックで答える
const answerFirst = page => page.evaluate(() => document.querySelector('#choices-container .choice-btn').click());
const currentKey = page => page.evaluate(() => `g:${state.grammarPool[state.currentGrammarIndex].id}`);
const labelsOf = (page, key) => page.evaluate(k => StudyCore.labelsOf(state.labels, k), key);
const visible = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && el.style.display !== 'none' && el.offsetParent !== null; }, sel);
const sheet = page => page.evaluate(() => ({ open: isSheetOpen(), title: document.getElementById('sheet-title').textContent }));

async function createInPicker(page, name) {
  await page.fill('#label-new-name', name);
  await page.click('[data-label-create]');
}

test('label_button_hidden_before_answer_and_shown_after', () => withPage({}, async page => {
  await startGrammar(page);
  assert.strictEqual(await visible(page, '#label-btn'), false);
  await answerFirst(page);
  assert.strictEqual(await visible(page, '#label-btn'), true);
  await page.click('#next-btn');
  assert.strictEqual(await visible(page, '#label-btn'), false);
}));

test('tap_adds_last_used_label_and_shows_toast', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  const key = await currentKey(page);
  await page.click('#label-btn');
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
  const toast = await page.textContent('.toast');
  assert(toast.includes('「あとで見る」に追加しました'), toast);
  assert(toast.includes('変更'), toast);
  assert.strictEqual(await page.evaluate(() => document.getElementById('label-btn').classList.contains('on')), true);
  assert.strictEqual(await page.textContent('#label-btn-text'), 'あとで見る');
  await page.click('.toast .toast-action');
  assert.strictEqual((await sheet(page)).title, 'ラベルを選ぶ');
}));

test('tap_when_labeled_opens_picker_and_keeps_label', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  const key = await currentKey(page);
  await page.click('#label-btn');
  await page.click('#label-btn');
  assert.deepStrictEqual(await sheet(page), { open: true, title: 'ラベルを選ぶ' });
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
}));

test('checking_another_label_makes_it_last_used', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  const first = await currentKey(page);
  await page.click('#label-btn');
  await page.click('#label-btn');
  await createInPicker(page, '自信なし');
  const id = await page.evaluate(() => StudyCore.activeLabels(state.labels).find(l => l.name === '自信なし').id);
  assert.deepStrictEqual(await labelsOf(page, first), ['default', id]);
  // チェックを外しても、最後に使ったラベルは変わらない
  await page.click('[data-label-toggle="default"]');
  assert.deepStrictEqual(await labelsOf(page, first), [id]);
  await page.evaluate(() => closeSheet());
  await page.click('#next-btn');
  await answerFirst(page);
  const second = await currentKey(page);
  await page.click('#label-btn');
  assert.deepStrictEqual(await labelsOf(page, second), [id]);
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_settings')).lastLabelId), id);
}));

test('picker_close_keeps_answered_state', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  await page.click('#label-btn');
  await page.click('#label-btn');
  await page.evaluate(() => closeSheet());
  const r = await page.evaluate(() => ({
    answered: state.grammarAnswered,
    correct: !!document.querySelector('#choices-container .choice-btn.correct'),
  }));
  assert.deepStrictEqual(r, { answered: true, correct: true });
  assert.strictEqual(await visible(page, '#next-btn'), true);
  assert.strictEqual(await visible(page, '#label-btn'), true);
}));

test('l_key_works_like_tap', () => withPage({}, async page => {
  await startGrammar(page);
  await page.keyboard.press('l');
  assert.strictEqual(await page.evaluate(() => Object.keys(state.labels.items).length), 0, '回答前に付いた');
  await answerFirst(page);
  const key = await currentKey(page);
  await page.keyboard.press('l');
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
  await page.keyboard.press('l'); // 付いているので選ぶ画面が開く
  assert.strictEqual((await sheet(page)).open, true);
  const before = JSON.stringify(await page.evaluate(() => state.labels));
  await page.keyboard.press('l'); // シートが開いている間は何もしない
  assert.strictEqual(JSON.stringify(await page.evaluate(() => state.labels)), before);
}));

test('long_press_opens_picker_without_adding', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  const key = await currentKey(page);
  await page.dispatchEvent('#label-btn', 'pointerdown');
  await page.waitForTimeout(650);
  await page.dispatchEvent('#label-btn', 'pointerup');
  await page.dispatchEvent('#label-btn', 'click'); // 指を離したあとのクリックは無視する
  assert.deepStrictEqual(await sheet(page), { open: true, title: 'ラベルを選ぶ' });
  assert.deepStrictEqual(await labelsOf(page, key), []);
}));

test('short_press_is_a_tap', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  const key = await currentKey(page);
  await page.dispatchEvent('#label-btn', 'pointerdown');
  await page.dispatchEvent('#label-btn', 'pointerup');
  await page.dispatchEvent('#label-btn', 'click');
  await page.waitForTimeout(650);
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
  assert.strictEqual((await sheet(page)).open, false);
}));

test('review_labels_the_reviewed_question', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  const first = await currentKey(page);
  await page.click('#next-btn');
  await answerFirst(page);
  await page.click('#back-btn');
  await page.click('#label-btn');
  assert.deepStrictEqual(await labelsOf(page, first), ['default']);
}));

test('vocab_choice_labels_the_word', () => withPage({}, async page => {
  await page.evaluate(() => { setApp('vocab'); state.mode = 'e2j'; applyFilters(); });
  const key = await page.evaluate(() => `w:${state.pool[state.currentIndex].w}`);
  await page.click('#choices-container .choice-btn');
  await page.click('#label-btn');
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
}));

test('flash_card_shows_button_after_flip', () => withPage({}, async page => {
  await page.evaluate(() => { setApp('vocab'); state.mode = 'flash'; applyFilters(); });
  assert.strictEqual(await visible(page, '#label-btn'), false);
  await page.click('#flash-card');
  assert.strictEqual(await visible(page, '#label-btn'), true);
}));

test('no_labels_left_opens_picker', () => withPage({}, async page => {
  await page.evaluate(() => applyLabelChange(StudyCore.deleteLabel(state.labels, 'default', Date.now())));
  await startGrammar(page);
  await answerFirst(page);
  const key = await currentKey(page);
  await page.click('#label-btn');
  assert.deepStrictEqual(await sheet(page), { open: true, title: 'ラベルを選ぶ' });
  assert.deepStrictEqual(await labelsOf(page, key), []);
}));

test('duplicate_name_is_rejected_in_picker', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  await page.evaluate(() => openLabelPicker());
  await createInPicker(page, 'あとで見る');
  assert((await page.textContent('#label-picker-error')).includes('同じ名前のラベルがあります。'));
  assert.strictEqual(await page.evaluate(() => StudyCore.activeLabels(state.labels).length), 1);
}));

run();
