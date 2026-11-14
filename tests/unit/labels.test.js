const test = require('node:test');
const assert = require('node:assert');
const L = require('../../src/labels.js');

const withLabel = (store, id, name, now) => L.createLabel(store, id, name, now);

test('empty_store_has_only_default', () => {
  assert.deepStrictEqual(L.activeLabels(L.emptyLabelStore()), [{ id: 'default', name: 'あとで見る', created: 0 }]);
  assert.strictEqual(L.DEFAULT_LABEL_ID, 'default');
  assert.strictEqual(L.LABEL_NAME_MAX, 20);
});

test('removed_label_does_not_come_back_from_old_record', () => {
  const a = L.setLabel(L.emptyLabelStore(), 'default', 'g:1023', true, 100);
  const b = L.setLabel(JSON.parse(JSON.stringify(a)), 'default', 'g:1023', false, 200);
  assert.deepStrictEqual(L.labelsOf(L.mergeLabelStores(a, b), 'g:1023'), []);
  assert.deepStrictEqual(L.labelsOf(L.mergeLabelStores(b, a), 'g:1023'), []);
});

test('labels_added_on_two_devices_both_remain', () => {
  const a = L.setLabel(L.emptyLabelStore(), 'default', 'g:1', true, 100);
  const b = L.setLabel(L.emptyLabelStore(), 'default', 'w:allocate', true, 150);
  const keys = L.itemsOf(L.mergeLabelStores(a, b), 'default').map(x => x.key);
  assert.deepStrictEqual(keys, ['w:allocate', 'g:1']);
});

test('newer_rename_wins', () => {
  const a = withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 100);
  const b = L.renameLabel(JSON.parse(JSON.stringify(a)), 'l_aaaaaa', '暗記カード', 200);
  assert.strictEqual(L.activeLabels(L.mergeLabelStores(a, b)).find(x => x.id === 'l_aaaaaa').name, '暗記カード');
  assert.strictEqual(L.activeLabels(L.mergeLabelStores(b, a)).find(x => x.id === 'l_aaaaaa').name, '暗記カード');
});

test('deleted_label_does_not_come_back', () => {
  const base = withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 100);
  const renamed = L.renameLabel(base, 'l_aaaaaa', '暗記2', 200);
  const deleted = L.deleteLabel(base, 'l_aaaaaa', 300);
  for (const m of [L.mergeLabelStores(renamed, deleted), L.mergeLabelStores(deleted, renamed)]) {
    assert.strictEqual(L.activeLabels(m).some(x => x.id === 'l_aaaaaa'), false);
  }
});

test('same_u_prefers_deleted_and_off', () => {
  const on = L.setLabel(L.emptyLabelStore(), 'default', 'g:1', true, 100);
  const off = L.setLabel(L.emptyLabelStore(), 'default', 'g:1', false, 100);
  assert.strictEqual(L.mergeLabelStores(on, off).items['default|g:1'].on, false);
  assert.strictEqual(L.mergeLabelStores(off, on).items['default|g:1'].on, false);
  const a = withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 100);
  const d = L.deleteLabel(withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 50), 'l_aaaaaa', 100);
  assert.strictEqual(L.mergeLabelStores(a, d).labels.l_aaaaaa.deleted, true);
  assert.strictEqual(L.mergeLabelStores(d, a).labels.l_aaaaaa.deleted, true);
});

test('two_fresh_devices_share_one_default', () => {
  assert.strictEqual(L.activeLabels(L.mergeLabelStores(L.emptyLabelStore(), L.emptyLabelStore())).length, 1);
});

test('merge_keeps_two_labels_with_the_same_name', () => {
  const a = L.setLabel(withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 100), 'l_aaaaaa', 'g:1', true, 110);
  const b = L.setLabel(withLabel(L.emptyLabelStore(), 'l_bbbbbb', '暗記', 100), 'l_bbbbbb', 'g:2', true, 120);
  const m = L.mergeLabelStores(a, b);
  assert.strictEqual(L.activeLabels(m).length, 3);
  assert.deepStrictEqual(L.itemsOf(m, 'l_aaaaaa').map(x => x.key), ['g:1']);
  assert.deepStrictEqual(L.itemsOf(m, 'l_bbbbbb').map(x => x.key), ['g:2']);
});

test('sanitize_drops_broken_values_and_keeps_good_ones', () => {
  const raw = {
    labels: {
      default: { name: 'あとで見る', created: 0, u: 0 },
      l_aaaaaa: { name: 'x'.repeat(21), created: 1, u: 1 },
      l_bbbbbb: { name: 5, created: 1, u: 1 },
      l_cccccc: { name: 'ok', created: 1, u: -1 },
      bad_id: { name: 'ok', created: 1, u: 1 },
    },
    items: {
      'default|g:1': { on: true, u: 5 },
      'default|g:2': { on: 'yes', u: 5 },
      'l_aaaaaa|x:1': { on: true, u: 5 },
      'default|w:': { on: true, u: 5 },
      nope: { on: true, u: 5 },
    },
  };
  const r = L.sanitizeLabelStore(raw);
  assert.deepStrictEqual(Object.keys(r.data.labels), ['default']);
  assert.deepStrictEqual(Object.keys(r.data.items), ['default|g:1']);
  assert.strictEqual(r.invalid, 8);
  assert.deepStrictEqual(L.sanitizeLabelStore(null), { data: { labels: {}, items: {} }, invalid: 0 });
  assert.strictEqual(L.sanitizeLabelStore('x').invalid, 1);
  assert.strictEqual(L.sanitizeLabelStore({ labels: [], items: {} }).invalid, 1);
});

test('validate_name_rules', () => {
  const s = L.deleteLabel(withLabel(L.emptyLabelStore(), 'l_aaaaaa', '消した', 10), 'l_aaaaaa', 20);
  assert.deepStrictEqual(L.validateLabelName(s, '  '), { ok: false, reason: '名前を入れてください。' });
  assert.deepStrictEqual(L.validateLabelName(s, 'x'.repeat(21)), { ok: false, reason: '名前は20文字までです。' });
  assert.deepStrictEqual(L.validateLabelName(s, ' あとで見る '), { ok: false, reason: '同じ名前のラベルがあります。' });
  assert.deepStrictEqual(L.validateLabelName(s, 'あとで見る', 'default'), { ok: true, name: 'あとで見る' });
  assert.deepStrictEqual(L.validateLabelName(s, '消した'), { ok: true, name: '消した' });
  assert.deepStrictEqual(L.validateLabelName(s, ' 暗記 '), { ok: true, name: '暗記' });
  assert.deepStrictEqual(L.validateLabelName(s, 'x'.repeat(20)), { ok: true, name: 'x'.repeat(20) });
});

test('is_label_item_key', () => {
  assert.strictEqual(L.isLabelItemKey('g:1023'), true);
  assert.strictEqual(L.isLabelItemKey('w:allocate'), true);
  assert.strictEqual(L.isLabelItemKey('g:0'), false);
  assert.strictEqual(L.isLabelItemKey('g:1234567890'), false);
  assert.strictEqual(L.isLabelItemKey('w:'), false);
  assert.strictEqual(L.isLabelItemKey(5), false);
});

test('items_of_deleted_label_is_empty', () => {
  const s = L.setLabel(withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 10), 'l_aaaaaa', 'g:1', true, 20);
  const d = L.deleteLabel(s, 'l_aaaaaa', 30);
  assert.deepStrictEqual(L.itemsOf(d, 'l_aaaaaa'), []);
  assert.deepStrictEqual(L.itemsOf(d, 'l_missing'), []);
  assert.deepStrictEqual(L.labelsOf(d, 'g:1'), []);
});

test('resolve_last_used_falls_back', () => {
  let s = withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 10);
  s = withLabel(s, 'l_bbbbbb', '本番前', 20);
  assert.strictEqual(L.resolveLastUsed(s, 'l_aaaaaa'), 'l_aaaaaa');
  assert.strictEqual(L.resolveLastUsed(s, 'l_gone'), 'l_bbbbbb');
  assert.strictEqual(L.resolveLastUsed(s, null), 'l_bbbbbb');
  s = L.deleteLabel(s, 'l_bbbbbb', 30);
  assert.strictEqual(L.resolveLastUsed(s, 'l_bbbbbb'), 'l_aaaaaa');
  s = L.deleteLabel(L.deleteLabel(s, 'l_aaaaaa', 40), 'default', 40);
  assert.strictEqual(L.resolveLastUsed(s, 'default'), null);
});

test('labels_of_follows_active_labels_order', () => {
  let s = withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 10);
  s = L.setLabel(s, 'l_aaaaaa', 'g:1', true, 20);
  s = L.setLabel(s, 'default', 'g:1', true, 30);
  assert.deepStrictEqual(L.labelsOf(s, 'g:1'), ['default', 'l_aaaaaa']);
});

test('functions_do_not_mutate_input', () => {
  const s = L.setLabel(withLabel(L.emptyLabelStore(), 'l_aaaaaa', '暗記', 10), 'l_aaaaaa', 'g:1', true, 20);
  const before = JSON.stringify(s);
  L.setLabel(s, 'default', 'g:2', true, 30);
  L.createLabel(s, 'l_cccccc', 'x', 30);
  L.renameLabel(s, 'l_aaaaaa', 'y', 30);
  L.deleteLabel(s, 'l_aaaaaa', 30);
  L.mergeLabelStores(s, L.emptyLabelStore());
  L.sanitizeLabelStore(s);
  assert.strictEqual(JSON.stringify(s), before);
});
