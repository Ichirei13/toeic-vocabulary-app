// 設定画面の「ラベル」セクション（作る・名前を変える・削除する）と、フッターの一覧からの移動の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/labels-settings.test.js
const assert = require('assert');
const { test, withPage, run } = require('./labels-harness.cjs');

const openSettings = page => page.evaluate(() => switchAppPage('settings'));
const section = '#label-settings-section';
const names = page => page.evaluate(() => StudyCore.activeLabels(state.labels).map(l => l.name));
const idOf = (page, name) => page.evaluate(n => StudyCore.activeLabels(state.labels).find(l => l.name === n).id, name);

// 名前が通らなかったときは入力欄が開いたままなので、そのまま入れ直す
async function create(page, name) {
  if (await page.locator(`${section} .label-name-input`).count() === 0) await page.click(`${section} [data-label-settings-new]`);
  await page.fill(`${section} .label-name-input`, name);
  await page.click(`${section} [data-label-settings-save]`);
}

test('settings_section_is_after_weak_settings', () => withPage({}, async page => {
  await openSettings(page);
  const r = await page.evaluate(() => {
    const sections = [...document.querySelectorAll('#settings-page-content .settings-section')];
    const weak = sections.findIndex(s => s.textContent.includes('苦手・復習の設定'));
    return { next: sections[weak + 1] && sections[weak + 1].id, text: document.getElementById('label-settings-section').textContent };
  });
  assert.strictEqual(r.next, 'label-settings-section');
  assert(r.text.includes('あとで見る'), r.text);
}));

test('create_rename_delete_label', () => withPage({}, async page => {
  await openSettings(page);
  const weakBefore = await page.evaluate(() => localStorage.getItem('toeic_weak_grammar'));
  await create(page, '暗記');
  assert.deepStrictEqual(await names(page), ['あとで見る', '暗記']);
  const id = await idOf(page, '暗記');
  await page.evaluate(i => applyLabelChange(StudyCore.setLabel(StudyCore.setLabel(state.labels, i, 'g:1001', true, Date.now()), i, 'g:1002', true, Date.now())), id);
  await page.evaluate(() => renderLabelSettingsSection());
  await page.click(`${section} [data-label-settings-rename="${id}"]`);
  await page.fill(`${section} .label-name-input`, '暗記カード');
  await page.click(`${section} [data-label-settings-save]`);
  assert.deepStrictEqual(await names(page), ['あとで見る', '暗記カード']);
  await page.click(`${section} [data-label-settings-delete="${id}"]`);
  const confirm = await page.textContent(section);
  assert(confirm.includes('『暗記カード』を削除します。付いている 2 件からこのラベルが外れます。'), confirm);
  await page.click(`${section} [data-label-settings-confirm-delete]`);
  assert.deepStrictEqual(await names(page), ['あとで見る']);
  assert.deepStrictEqual(await page.evaluate(() => StudyCore.labelsOf(state.labels, 'g:1001')), []);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('toeic_weak_grammar')), weakBefore);
}));

test('cancel_delete_keeps_label', () => withPage({}, async page => {
  await openSettings(page);
  await page.click(`${section} [data-label-settings-delete="default"]`);
  await page.click(`${section} [data-label-settings-cancel]`);
  assert.deepStrictEqual(await names(page), ['あとで見る']);
  assert(!(await page.textContent(section)).includes('を削除します'));
}));

test('invalid_names_show_reason', () => withPage({}, async page => {
  await openSettings(page);
  for (const [name, reason] of [['  ', '名前を入れてください。'], ['x'.repeat(21), '名前は20文字までです。'], ['あとで見る', '同じ名前のラベルがあります。']]) {
    await create(page, name);
    assert((await page.textContent(`${section} .label-error`)).includes(reason), name);
  }
  assert.deepStrictEqual(await names(page), ['あとで見る']);
}));

test('edit_link_from_footer_list_opens_settings_section', () => withPage({}, async page => {
  await page.evaluate(() => toggleLabelList());
  await page.click('[data-label-edit]');
  const r = await page.evaluate(() => ({ page: currentAppPage, sheet: isSheetOpen(), section: !!document.getElementById('label-settings-section') }));
  assert.deepStrictEqual(r, { page: 'settings', sheet: false, section: true });
}));

test('label_name_is_escaped', () => withPage({}, async page => {
  await openSettings(page);
  await create(page, '<b>x</b>');
  assert.deepStrictEqual(await names(page), ['あとで見る', '<b>x</b>']);
  const id = await idOf(page, '<b>x</b>');
  assert.strictEqual(await page.locator(`${section} b`).count(), 0);
  await page.evaluate(() => { switchAppPage('practice'); toggleLabelList(); });
  assert.strictEqual(await page.locator('#weak-list-content b').count(), 0);
  await page.evaluate(i => { setApp('grammar'); state.grammarBook = 'kin'; applyGrammarFilters(); state.lastLabelId = i; }, id);
  await page.evaluate(() => document.querySelector('#choices-container .choice-btn').click());
  await page.evaluate(() => openLabelPicker());
  assert.strictEqual(await page.locator('#weak-list-content b').count(), 0);
  assert.strictEqual(await page.locator('#label-btn b').count(), 0);
}));

run();
