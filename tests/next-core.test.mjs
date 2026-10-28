import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, STORAGE_KEY, makeCatalog, selectItems, startSession, recordAnswer, validSession } from '../next/core.mjs';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, writes: [], getItem: key => values.get(key) ?? null,
    setItem(key, value) { this.writes.push(key); values.set(key, value); } };
}
const entry = { added: 1, due: 1, streak: 0, u: 10 };
const words = [{ w: 'test', m: '試験', p: '名詞', s: 'daily', d: '2026-10-27' }, { w: 'test', m: '試験', p: '名詞', s: 'teppan', no: 1 }];
const grammar = [{ id: 1, b: 'kin', ch: 1, q: 'A -------.', c: ['a', 'b', 'c'], a: 1 }];
const config = { kind: 'grammar', source: 'kin', mode: 'e2j', count: '10', filter: 'all', chapters: [] };

test('imports learning data once, preserves legacy keys and ignores credentials', () => {
  const initial = {
    toeic_weak_words_by_mode: JSON.stringify({ e2j: { test: entry }, j2e: {}, flash: {}, type: {} }),
    toeic_grammar_stats: JSON.stringify({ 1: { a: 2, c: 1 } }),
    toeic_weak_grammar: JSON.stringify({ 1: entry }),
    toeic_gdrive_linked: '1', toeic_gdrive_autosync: '1', toeic_settings: '{"app":"vocab"}',
  };
  const disk = storage(initial);
  const store = openStore(disk);
  assert.equal(store.data.records.grammarWeak['1'].streak, 0);
  assert.deepEqual(store.data.records.grammarSeen, [1]);
  store.save();
  assert.deepEqual(disk.writes, [STORAGE_KEY]);
  for (const [key, value] of Object.entries(initial)) assert.equal(disk.getItem(key), value);
  assert.ok(!disk.getItem(STORAGE_KEY).includes('gdrive'));
  disk.values.set('toeic_grammar_stats', '{"1":{"a":99,"c":99}}');
  assert.equal(openStore(disk).data.records.grammarStats['1'].a, 2);
});

test('legacy tombstones prevent importing resurrected weak records', () => {
  const store = openStore(storage({ toeic_weak_grammar: JSON.stringify({ 1: entry }), toeic_weak_deleted: '{"g:1":11}' }));
  assert.deepEqual(store.data.records.grammarWeak, {});
});

test('corrupt/unknown trial records are never overwritten', () => {
  for (const raw of ['broken', '{"schema":3}', '{"schema":1,"records":{}}']) {
    const disk = storage({ [STORAGE_KEY]: raw });
    const store = openStore(disk);
    assert.equal(store.save(), false);
    assert.equal(disk.getItem(STORAGE_KEY), raw);
    assert.ok(store.notice);
  }
});

test('failed storage is visible, and a later successful write can recover', () => {
  const disk = storage();
  const store = openStore(disk);
  const write = disk.setItem;
  disk.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(store.save(), false);
  assert.ok(store.notice.includes('保存できません'));
  disk.setItem = write;
  assert.equal(store.save(), true);
  assert.equal(store.notice, '');
});

test('stale tab cannot overwrite another tab or a cleared store', () => {
  const disk = storage();
  const first = openStore(disk);
  first.save();
  const second = openStore(disk);
  first.data.theme = 'dark'; first.save();
  assert.equal(second.save(), false);
  assert.equal(JSON.parse(disk.getItem(STORAGE_KEY)).theme, 'dark');
  disk.values.delete(STORAGE_KEY);
  assert.equal(first.save(), false);
});

test('filters combine chapters and weak/unseen; vocabulary deduplicates after source filtering', () => {
  const catalog = makeCatalog(words, grammar);
  const r = openStore(storage()).data.records;
  assert.equal(selectItems(catalog, r, { ...config, kind: 'vocab', source: 'all' }).length, 1);
  assert.equal(selectItems(catalog, r, { ...config, kind: 'vocab', source: 'teppan' })[0].source, 'teppan');
  r.grammarSeen = [1];
  assert.equal(selectItems(catalog, r, { ...config, filter: 'weak_unseen' }).length, 0);
  r.grammarWeak['1'] = { ...entry };
  assert.equal(selectItems(catalog, r, { ...config, filter: 'weak_unseen' }).length, 1);
  assert.equal(selectItems(catalog, r, { ...config, chapters: [2] }).length, 0);
});

test('session roundtrips and answering twice never double-counts', () => {
  const catalog = makeCatalog(words, grammar);
  const store = openStore(storage());
  const data = store.data;
  const item = catalog.byId.get('g:1');
  data.session = startSession([item], config, catalog);
  assert.ok(validSession(JSON.parse(JSON.stringify(data.session)), catalog));
  assert.equal(recordAnswer(data, item, { correct: false }, 1000), true);
  assert.equal(recordAnswer(data, item, { correct: true }, 1001), false);
  assert.deepEqual(data.records.grammarStats['1'], { a: 1, c: 0 });
  assert.equal(data.records.grammarWeak['1'].due, 1000);
  assert.deepEqual(data.records.grammarSeen, [1]);
  assert.ok(!validSession(data.session, makeCatalog(words, [{ ...grammar[0], q: 'Changed' }])));
});

test('spaced review advances only when due and eventually graduates', () => {
  const catalog = makeCatalog(words, grammar);
  const data = openStore(storage()).data;
  const item = catalog.byId.get('g:1');
  data.records.grammarWeak['1'] = { added: 1, due: 2000, streak: 0 };
  data.session = startSession([item], config, catalog);
  recordAnswer(data, item, { correct: true }, 1000);
  assert.equal(data.records.grammarWeak['1'].streak, 0);
  for (let i = 0; i < 4; i++) {
    const now = data.records.grammarWeak['1'].due;
    data.session = startSession([item], config, catalog);
    recordAnswer(data, item, { correct: true }, now);
    if (i < 3) assert.equal(data.records.grammarWeak['1'].streak, i + 1);
  }
  assert.equal(data.records.grammarWeak['1'], undefined);
});

test('only a new answer increments the activity day',()=>{
 const catalog=makeCatalog(words,grammar);
 const store=openStore(storage()),data=store.data;
 data.session=startSession([catalog.byId.get('g:1')],config,catalog);
 const now=new Date(2026,9,28,23,59).getTime();
 recordAnswer(data,catalog.byId.get('g:1'),{correct:false},now);
 recordAnswer(data,catalog.byId.get('g:1'),{correct:true},now);
 assert.equal(data.activity.days['2026-10-28'].answers,1);
});
test('same-day review is not graduation but a due final review is',()=>{
 const data=openStore(storage()).data,catalog=makeCatalog(words,grammar),item=catalog.byId.get('g:1'),now=Date.now();
 data.records.grammarWeak['1']={added:1,due:now+10000,streak:3};
 data.session=startSession([item],config,catalog);recordAnswer(data,item,{correct:true},now);
 assert.equal(data.session.answers['g:1'].wasWeak,true);assert.equal(data.session.answers['g:1'].graduated,false);
 data.session=startSession([item],config,catalog);recordAnswer(data,item,{correct:true},now+20000);
 assert.equal(data.session.answers['g:1'].graduated,true);assert.equal(data.records.grammarWeak['1'],undefined);
});
