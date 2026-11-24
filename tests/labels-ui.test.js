// 演習中の 🏷 ボタン（回答前・回答後・見直し中、ワンタップで最後に使ったラベル・再タップと長押しで選ぶ画面・L キー）の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/labels-ui.test.js
const assert = require('assert');
const { test, withPage, openPage, run } = require('./labels-harness.cjs');

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

test('label_button_shown_before_and_after_answer_and_hidden_on_empty_or_complete', () => withPage({}, async page => {
  await startGrammar(page);
  assert.strictEqual(await visible(page, '#label-btn'), true);
  await answerFirst(page);
  assert.strictEqual(await visible(page, '#label-btn'), true);
  await page.click('#next-btn');
  assert.strictEqual(await visible(page, '#label-btn'), true);
  // 完了画面では非表示
  await page.evaluate(() => { state.currentGrammarIndex = state.grammarPool.length; renderCurrentGrammar(); });
  assert.strictEqual(await visible(page, '#label-btn'), false);
  // 0 件画面でも非表示
  await page.evaluate(() => { state.grammarPool = []; state.currentGrammarIndex = 0; renderCurrentGrammar(); });
  assert.strictEqual(await visible(page, '#label-btn'), false);
}));

test('labeling_before_answer_preserves_unanswered_grammar_state', () => withPage({}, async page => {
  await startGrammar(page);
  const key = await currentKey(page);
  await page.click('#label-btn');
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
  // ピッカーを開いて閉じた後も未回答状態のまま解答できる
  await page.click('#label-btn');
  assert.deepStrictEqual(await sheet(page), { open: true, title: 'ラベルを選ぶ' });
  await page.evaluate(() => closeSheet());
  assert.strictEqual(await page.evaluate(() => state.grammarAnswered), false);
  assert.strictEqual(await visible(page, '#dont-know-btn'), true);
  await answerFirst(page);
  assert.strictEqual(await page.evaluate(() => state.grammarAnswered), true);
  assert.strictEqual(await page.evaluate(() => document.getElementById('label-btn').classList.contains('on')), true);
}));

test('labeling_before_answer_in_type_mode_keeps_input_and_respects_l_key_in_input', () => withPage({}, async page => {
  await page.evaluate(() => { setApp('vocab'); state.mode = 'type'; applyFilters(); });
  const key = await page.evaluate(() => `w:${state.pool[state.currentIndex].w}`);
  assert.strictEqual(await visible(page, '#label-btn'), true);
  await page.fill('#type-input', 'hello');
  // 入力欄フォーカス中の L キーは文字入力を優先し、ラベルは付けない
  await page.keyboard.press('l');
  assert.strictEqual(await page.inputValue('#type-input'), 'hellol');
  assert.deepStrictEqual(await labelsOf(page, key), []);
  // ボタン押下＆ピッカー開閉しても未回答のまま入力値を保持する
  await page.click('#label-btn');
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
  await page.click('#label-btn');
  await page.evaluate(() => closeSheet());
  assert.strictEqual(await page.evaluate(() => state.answered), false);
  assert.strictEqual(await page.inputValue('#type-input'), 'hellol');
  assert.strictEqual(await page.evaluate(() => document.getElementById('label-btn').classList.contains('on')), true);
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
  const key = await currentKey(page);
  await page.keyboard.press('l'); // 回答前でも L キーで付く
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
  await page.keyboard.press('l'); // 付いているので選ぶ画面が開く
  assert.strictEqual((await sheet(page)).open, true);
  const before = JSON.stringify(await page.evaluate(() => state.labels));
  await page.keyboard.press('l'); // シートが開いている間は何もしない
  assert.strictEqual(JSON.stringify(await page.evaluate(() => state.labels)), before);
  await page.evaluate(() => closeSheet());
  // 完了画面では L キーを押しても何も起きない
  await page.evaluate(() => { state.currentGrammarIndex = state.grammarPool.length; renderCurrentGrammar(); });
  await page.keyboard.press('l');
  assert.strictEqual(JSON.stringify(await page.evaluate(() => state.labels)), before);
  assert.strictEqual((await sheet(page)).open, false);
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

test('flash_card_shows_button_before_flip_and_keeps_label', () => withPage({}, async page => {
  await page.evaluate(() => { setApp('vocab'); state.mode = 'flash'; applyFilters(); });
  const key = await page.evaluate(() => `w:${state.pool[state.currentIndex].w}`);
  assert.strictEqual(await visible(page, '#label-btn'), true);
  await page.click('#label-btn');
  assert.deepStrictEqual(await labelsOf(page, key), ['default']);
  assert.strictEqual(await page.evaluate(() => document.getElementById('flash-card').classList.contains('flipped')), false);
  await page.click('#flash-card');
  assert.strictEqual(await visible(page, '#label-btn'), true);
  assert.strictEqual(await page.evaluate(() => document.getElementById('label-btn').classList.contains('on')), true);
}));

test('phone_action_bar_fits_back_label_and_dont_know_without_overlap', () => withPage({}, async page => {
  const longName = 'あ'.repeat(20);
  await page.evaluate(n => applyLabelChange(StudyCore.createLabel(state.labels, 'l_long20', n, Date.now())), longName);
  await startGrammar(page);
  await answerFirst(page);
  await page.click('#next-btn');
  const secondKey = await currentKey(page);
  await page.evaluate(k => applyLabelChange(StudyCore.setLabel(state.labels, 'l_long20', k, true, Date.now())), secondKey);
  await page.evaluate(() => refreshLabelButton());
  const layout = await page.evaluate(() => {
    const bar = document.querySelector('.action-bar').getBoundingClientRect();
    const back = document.getElementById('back-btn').getBoundingClientRect();
    const label = document.getElementById('label-btn').getBoundingClientRect();
    const dk = document.getElementById('dont-know-btn').getBoundingClientRect();
    return { bar, back, label, dk, docOverflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  assert.strictEqual(layout.docOverflow, false, '横スクロールが出ている');
  assert(layout.back.right <= layout.label.left + 1, `back(${layout.back.right}) > label(${layout.label.left})`);
  assert(layout.label.right <= layout.dk.left + 1, `label(${layout.label.right}) > dk(${layout.dk.left})`);
  for (const [name, r] of [['back', layout.back], ['label', layout.label], ['dk', layout.dk]]) {
    assert(r.left >= layout.bar.left - 1 && r.right <= layout.bar.right + 1, `${name} が横にはみ出している`);
    assert(r.height <= layout.bar.height + 1, `${name} の高さ(${r.height})が action-bar(${layout.bar.height})を超えている`);
  }
}, { viewport: { width: 375, height: 812 } }));

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

test('other_tab_label_change_refreshes_button_and_open_sheet', () => withPage({}, async (page, context) => {
  await startGrammar(page);
  await answerFirst(page);
  const key = await currentKey(page);
  await page.evaluate(() => toggleLabelList());
  const other = await openPage(context);
  await other.evaluate(k => applyLabelChange(StudyCore.setLabel(state.labels, 'default', k, true, Date.now())), key);
  await page.waitForFunction(() => document.getElementById('label-btn').classList.contains('on'), null, { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('weak-list-content').textContent.includes('文法 1問'), null, { timeout: 5000 });
}));

test('other_tab_change_refreshes_settings_section', () => withPage({}, async (page, context) => {
  await page.evaluate(() => switchAppPage('settings'));
  const other = await openPage(context);
  await other.evaluate(() => applyLabelChange(StudyCore.createLabel(state.labels, 'l_aaaaaa', '別タブ', Date.now())));
  await page.waitForFunction(() => document.getElementById('label-settings-section').textContent.includes('別タブ'), null, { timeout: 5000 });
}));

test('long_emoji_name_can_be_created_in_picker', () => withPage({}, async page => {
  await startGrammar(page);
  await answerFirst(page);
  await page.evaluate(() => openLabelPicker());
  const name = '👨‍👩‍👧'.repeat(20);
  await createInPicker(page, name);
  assert.strictEqual(await page.evaluate(n => StudyCore.activeLabels(state.labels).some(l => l.name === n), name), true);
}));

run();
