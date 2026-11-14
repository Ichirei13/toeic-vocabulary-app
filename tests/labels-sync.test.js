// ラベルの保存・バックアップ（版7）・統合復元・別タブへの反映の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/labels-sync.test.js
const assert = require('assert');
const { test, withPage, openPage, run } = require('./labels-harness.cjs');

const addLabel = (page, key) => page.evaluate(k => applyLabelChange(StudyCore.setLabel(state.labels, 'default', k, true, Date.now())), key);
const labelsOf = (page, key) => page.evaluate(k => StudyCore.labelsOf(state.labels, k), key);

async function restore(page, backup, mode) {
  return page.evaluate(([text, m]) => {
    backupView = { step: 'confirm', pending: parseBackup(text), restoreMode: m, fileName: 'test.json' };
    runRestore();
    return backupView.error || null;
  }, [JSON.stringify(backup), mode]);
}

test('labels_survive_reload', () => withPage({}, async page => {
  await addLabel(page, 'g:1001');
  await page.reload();
  assert.deepStrictEqual(await labelsOf(page, 'g:1001'), ['default']);
}));

test('backup_file_includes_labels_and_is_format_7', () => withPage({}, async page => {
  await addLabel(page, 'g:1001');
  const r = await page.evaluate(() => ({ file: buildBackup(), drive: buildBackup({ forDrive: true }) }));
  assert.strictEqual(r.file.format, 7);
  assert.strictEqual(r.file.data.labels.items['default|g:1001'].on, true);
  assert.strictEqual(r.drive.format, 5);
  assert.strictEqual(r.drive.data.labels.items['default|g:1001'].on, true);
}));

test('merge_restore_combines_labels', () => withPage({}, async page => {
  const file = await page.evaluate(() => {
    const b = buildBackup();
    b.data.labels = StudyCore.setLabel(StudyCore.emptyLabelStore(), 'default', 'g:2', true, Date.now());
    return b;
  });
  await addLabel(page, 'g:1');
  assert.strictEqual(await restore(page, file, 'merge'), null);
  assert.deepStrictEqual(await labelsOf(page, 'g:1'), ['default']);
  assert.deepStrictEqual(await labelsOf(page, 'g:2'), ['default']);
}));

test('drive_merge_keeps_local_labels_when_remote_has_none', () => withPage({}, async page => {
  await addLabel(page, 'g:1');
  const merged = await page.evaluate(() => {
    const remote = parseBackup(JSON.stringify((b => { delete b.data.labels; return b; })(buildBackup({ forDrive: true })))).records;
    return mergeBackupRecords(getCurrentLocalRecords(), remote).labels;
  });
  assert.strictEqual(merged.items['default|g:1'].on, true);
}));

test('restore_old_backup_keeps_labels', () => withPage({}, async page => {
  const old = await page.evaluate(() => { const b = buildBackup(); delete b.data.labels; b.format = 6; return b; });
  await addLabel(page, 'g:1');
  assert.strictEqual(await restore(page, old, 'overwrite'), null);
  assert.deepStrictEqual(await labelsOf(page, 'g:1'), ['default']);
}));

test('parse_rejects_bad_labels_shape', () => withPage({}, async page => {
  const r = await page.evaluate(() => { const b = buildBackup(); b.data.labels = []; return parseBackup(JSON.stringify(b)); });
  assert.strictEqual(r.ok, false);
  assert(/ラベル/.test(r.error), r.error);
}));

test('broken_labels_record_is_kept_aside', () => withPage({ toeic_labels_v1: '{broken' }, async page => {
  const r = await page.evaluate(() => ({
    kept: localStorage.getItem('toeic_labels_v1.broken'),
    labels: StudyCore.activeLabels(state.labels).map(l => l.id),
  }));
  assert.strictEqual(r.kept, '{broken');
  assert.deepStrictEqual(r.labels, ['default']);
}));

test('other_tab_change_is_picked_up', () => withPage({}, async (page, context) => {
  const other = await openPage(context);
  await addLabel(other, 'g:1001');
  await page.waitForFunction(() => StudyCore.labelsOf(state.labels, 'g:1001').length === 1, null, { timeout: 5000 });
}));

test('labels_do_not_touch_weak_records', () => withPage({}, async page => {
  const snap = () => page.evaluate(() => [localStorage.getItem('toeic_weak_grammar'), localStorage.getItem('toeic_weak_deleted'), JSON.stringify(state.grammarWeakData)]);
  const before = await snap();
  await addLabel(page, 'g:1001');
  await page.evaluate(() => applyLabelChange(StudyCore.setLabel(state.labels, 'default', 'g:1001', false, Date.now())));
  assert.deepStrictEqual(await snap(), before);
}));

test('last_label_and_filters_are_validated_on_restore', () => withPage({
  toeic_settings: JSON.stringify({ lastLabelId: 'l_gone00', grammarLabel: 'default', vocabLabel: 5 }),
}, async page => {
  const r = await page.evaluate(() => [state.lastLabelId, state.grammarLabel, state.vocabLabel]);
  assert.deepStrictEqual(r, [null, 'default', null]);
}));

run();
