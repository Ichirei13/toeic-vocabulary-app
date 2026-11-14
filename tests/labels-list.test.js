// フッターの「ラベル」（一覧・中身・ラベルを外す）と「このラベルで解く」の絞り込みの検証。
// 実行: NODE_PATH=$(npm root -g) node tests/labels-list.test.js
const assert = require('assert');
const { test, withPage, openPage, run } = require('./labels-harness.cjs');

const label = (page, keys, id = 'default') => page.evaluate(([ks, lid]) => {
  let s = state.labels;
  ks.forEach((k, i) => { s = StudyCore.setLabel(s, lid, k, true, Date.now() + i); });
  applyLabelChange(s);
}, [keys, id]);
const firstWord = page => page.evaluate(() => RAW_WORDS[0].w);
const sheetText = page => page.textContent('#weak-list-content');
const pool = page => page.evaluate(() => state.grammarPool.map(e => e.id).sort((a, b) => a - b));
const openContents = async page => {
  await page.evaluate(() => toggleLabelList());
  await page.click('[data-label-open="default"]');
};

test('footer_link_opens_label_list', () => withPage({}, async page => {
  await page.click('.footer >> text=ラベル');
  assert.strictEqual(await page.textContent('#sheet-title'), 'ラベル');
  assert((await sheetText(page)).includes('あとで見る'));
}));

test('list_shows_counts_per_label', () => withPage({}, async page => {
  const w = await firstWord(page);
  await label(page, ['g:1001', 'g:1002', `w:${w}`, 'g:999999']); // 999999 はデータに無い問題（数えない）
  await page.evaluate(() => toggleLabelList());
  assert((await sheetText(page)).includes('文法 2問・単語 1語'), await sheetText(page));
}));

test('contents_show_question_answer_and_remove', () => withPage({}, async page => {
  await label(page, ['g:1001', 'g:1002']);
  await page.evaluate(() => { state.app = 'grammar'; });
  await openContents(page);
  const ex = await page.evaluate(() => { const e = GRAMMAR_BY_ID.get(1001); return { c: e.c[e.a] }; });
  const text = await sheetText(page);
  assert(text.includes(ex.c), text);
  assert(text.includes('このラベルで解く'));
  await page.click('[data-label-remove="g:1001"]');
  assert.deepStrictEqual(await page.evaluate(() => StudyCore.labelsOf(state.labels, 'g:1001')), []);
  assert.strictEqual(await page.locator('[data-label-remove]').count(), 1);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('toeic_weak_grammar')), null);
}));

test('contents_tabs_switch_between_grammar_and_words', () => withPage({}, async page => {
  const w = await firstWord(page);
  await label(page, ['g:1001', `w:${w}`]);
  await page.evaluate(() => { state.app = 'vocab'; });
  await openContents(page);
  assert((await sheetText(page)).includes(w));
  await page.click('[data-label-tab="grammar"]');
  assert.strictEqual(await page.locator('[data-label-remove="g:1001"]').count(), 1);
  await page.click('[data-label-back]');
  assert.strictEqual(await page.textContent('#sheet-title'), 'ラベル');
}));

test('solve_button_disabled_when_empty', () => withPage({}, async page => {
  await page.evaluate(() => { state.app = 'grammar'; });
  await openContents(page);
  assert.strictEqual(await page.locator('[data-label-solve]').isDisabled(), true);
}));

test('solve_this_label_resets_other_filters_and_serves_all_labeled', () => withPage({}, async page => {
  await label(page, ['g:1001', 'g:2005']);
  await page.evaluate(() => { setApp('grammar'); state.grammarBook = 'sekai'; state.grammarWeakFilter = 'weak_only'; applyGrammarFilters(); state.app = 'grammar'; });
  await openContents(page);
  await page.click('[data-label-solve]');
  assert.deepStrictEqual(await pool(page), [1001, 2005]);
  const r = await page.evaluate(() => ({ app: state.app, label: state.grammarLabel, book: state.grammarBook, weak: state.grammarWeakFilter, sheet: isSheetOpen(), saved: JSON.parse(localStorage.getItem('toeic_settings')).grammarLabel }));
  assert.deepStrictEqual(r, { app: 'grammar', label: 'default', book: 'all', weak: 'all', sheet: false, saved: 'default' });
}));

test('label_combines_with_book_filter', () => withPage({}, async page => {
  await label(page, ['g:1001', 'g:2005']);
  await page.evaluate(() => { setApp('grammar'); startLabelDrill('grammar', 'default'); openFilterSheet(); });
  await page.click('#grammar-book-segments [data-gbook="kin"]');
  assert.deepStrictEqual(await pool(page), [1001]);
  assert.strictEqual(await page.evaluate(() => state.grammarLabel), 'default');
}));

test('label_combines_with_weak_filter_for_words', () => withPage({}, async page => {
  const words = await page.evaluate(() => [RAW_WORDS[0].w, RAW_WORDS[5].w]);
  await label(page, words.map(w => `w:${w}`));
  await page.evaluate(w => { setApp('vocab'); state.mode = 'e2j'; updateWeakEntry(wordWeak(), w, false, `w:e2j:${w}`); saveWeakData(); startLabelDrill('vocab', 'default'); }, words[0]);
  assert.strictEqual(await page.evaluate(() => state.pool.length), 2);
  await page.evaluate(() => openFilterSheet());
  await page.click('#weak-segments [data-weak="weak_only"]');
  assert.deepStrictEqual(await page.evaluate(() => state.pool.map(x => x.w)), [words[0]]);
}));

test('vocab_label_drill_uses_current_mode', () => withPage({}, async page => {
  const words = await page.evaluate(() => [RAW_WORDS[0].w, RAW_WORDS[5].w]);
  await label(page, words.map(w => `w:${w}`));
  await page.evaluate(() => { setApp('grammar'); state.mode = 'j2e'; });
  await page.evaluate(() => startLabelDrill('vocab', 'default'));
  const r = await page.evaluate(() => ({ app: state.app, mode: state.mode, pool: state.pool.map(x => x.w).sort() }));
  assert.deepStrictEqual(r, { app: 'vocab', mode: 'j2e', pool: words.slice().sort() });
}));

test('filter_sheet_label_row_selects_and_clears_label', () => withPage({}, async page => {
  await label(page, ['g:1001', 'g:1002']);
  await page.evaluate(() => { setApp('grammar'); state.grammarBook = 'kin'; applyGrammarFilters(); openFilterSheet(); });
  const row = await page.textContent('#label-filter-chip');
  assert(row.includes('ラベル') && row.includes('あとで見る'), row);
  await page.click('#label-filter-chip [data-label-filter="default"]');
  let r = await page.evaluate(() => ({ label: state.grammarLabel, book: state.grammarBook, saved: JSON.parse(localStorage.getItem('toeic_settings')).grammarLabel }));
  assert.deepStrictEqual(r, { label: 'default', book: 'kin', saved: 'default' });
  assert.deepStrictEqual(await pool(page), [1001, 1002]);
  assert.strictEqual(await page.evaluate(() => document.querySelector('#label-filter-chip [data-label-filter="default"]').classList.contains('active')), true);
  await page.click('#label-filter-chip [data-label-filter=""]');
  r = await page.evaluate(() => ({ label: state.grammarLabel, n: state.grammarPool.length }));
  assert.strictEqual(r.label, null);
  assert(r.n > 2, `プールが ${r.n} 問`);
}));

test('label_row_counts_follow_label_changes', () => withPage({}, async page => {
  await page.evaluate(() => { setApp('grammar'); state.grammarBook = 'kin'; applyGrammarFilters(); });
  const count = () => page.textContent('#label-filter-chip [data-label-filter="default"] .label-chip-count');
  assert.strictEqual(await count(), '0');
  await label(page, ['g:1001', 'g:1002']);
  assert.strictEqual(await count(), '2');
}));

test('nudge_condition_includes_label', () => withPage({}, async page => {
  const r = await page.evaluate(() => {
    setApp('grammar');
    const g0 = getFilterStateKey();
    state.grammarLabel = 'default';
    const g1 = getFilterStateKey();
    state.app = 'vocab';
    const v0 = getFilterStateKey();
    state.vocabLabel = 'default';
    const v1 = getFilterStateKey();
    return [g0 !== g1, v0 !== v1];
  });
  assert.deepStrictEqual(r, [true, true]);
}));

test('deleting_the_filtered_label_clears_the_filter', () => withPage({}, async page => {
  await page.evaluate(() => applyLabelChange(StudyCore.createLabel(state.labels, 'l_aaaaaa', '暗記', Date.now())));
  await label(page, ['g:1001'], 'l_aaaaaa');
  await page.evaluate(() => { setApp('grammar'); startLabelDrill('grammar', 'l_aaaaaa'); });
  assert.deepStrictEqual(await pool(page), [1001]);
  await page.evaluate(() => applyLabelChange(StudyCore.deleteLabel(state.labels, 'l_aaaaaa', Date.now())));
  const r = await page.evaluate(() => ({ label: state.grammarLabel, n: state.grammarPool.length }));
  assert.strictEqual(r.label, null);
  assert(r.n > 1, `プールが ${r.n} 問`);
}));

test('label_deleted_in_another_tab_clears_the_filter', () => withPage({}, async (page, context) => {
  await page.evaluate(() => applyLabelChange(StudyCore.createLabel(state.labels, 'l_aaaaaa', '暗記', Date.now())));
  await label(page, ['g:1001'], 'l_aaaaaa');
  await page.evaluate(() => { setApp('grammar'); startLabelDrill('grammar', 'l_aaaaaa'); });
  const other = await openPage(context);
  await other.evaluate(() => applyLabelChange(StudyCore.deleteLabel(state.labels, 'l_aaaaaa', Date.now())));
  await page.waitForFunction(() => !StudyCore.activeLabels(state.labels).some(l => l.id === 'l_aaaaaa'), null, { timeout: 5000 });
  const r = await page.evaluate(() => ({ label: state.grammarLabel, n: state.grammarPool.length }));
  assert.strictEqual(r.label, null);
  assert(r.n > 1, `プールが ${r.n} 問`);
}));

// ラベルで解いたあとに、ほかの「解く」入口（ルール・ホームの苦手・本のカード）を使うと、ラベルの絞り込みは外れる
for (const [name, start, kind] of [
  ['rule_drill', () => startRuleDrill(KIN_RULES[0].number), 'grammar'],
  ['home_weak_drill_grammar', () => startWeakDrillFromHome('grammar'), 'grammar'],
  ['home_weak_drill_vocab', () => startWeakDrillFromHome('vocab'), 'vocab'],
  ['home_book_card', () => startBookFromHome('grammar', 'kin'), 'grammar'],
]) {
  test(`other_entry_points_clear_label_filter_${name}`, () => withPage({}, async page => {
    await label(page, ['g:1001', `w:${await firstWord(page)}`]);
    await page.evaluate(k => startLabelDrill(k, 'default'), kind);
    await page.evaluate(`(${start})()`);
    const r = await page.evaluate(k => ({ label: state[k === 'grammar' ? 'grammarLabel' : 'vocabLabel'], saved: JSON.parse(localStorage.getItem('toeic_settings'))[k === 'grammar' ? 'grammarLabel' : 'vocabLabel'] }), kind);
    assert.deepStrictEqual(r, { label: null, saved: null });
  }));
}

test('session_signature_unchanged_without_label_filter', () => withPage({}, async page => {
  const r = await page.evaluate(() => {
    const oldGrammar = JSON.stringify([RAW_GRAMMAR.length, state.grammarBook, state.grammarChapter, state.grammarRule, state.grammarWeakFilter]);
    const oldVocab = JSON.stringify([RAW_WORDS.length, state.sourceFilter, state.rangeFilter, state.dateFilter, state.posFilter, state.weakFilter,
      ...(state.weakFilter !== 'all' ? [state.mode] : [])]);
    return [sessionSignature('grammar') === oldGrammar, sessionSignature('vocab') === oldVocab];
  });
  assert.deepStrictEqual(r, [true, true]);
}));

test('label_drill_survives_reload', () => withPage({}, async page => {
  await label(page, ['g:1001', 'g:1002']);
  await page.evaluate(() => { setApp('grammar'); startLabelDrill('grammar', 'default'); });
  await page.reload();
  const r = await page.evaluate(() => ({ app: state.app, label: state.grammarLabel }));
  assert.deepStrictEqual(r, { app: 'grammar', label: 'default' });
  assert.deepStrictEqual(await pool(page), [1001, 1002]);
}));

run();
