import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, STORAGE_KEY, makeCatalog, startSession, recordAnswer } from '../next/core.mjs';
import { createBackup, parseBackup, prepareRestore, prepareUndo, MAX_BACKUP_BYTES } from '../next/backup.mjs';
import { sessionRewards, legacyTheme, THEMES } from '../next/themes.mjs';

function disk(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { values, writes: [], getItem: k => values.get(k) ?? null, setItem(k,v) { this.writes.push(k); values.set(k,v); } };
}
const catalog = makeCatalog([{ w: 'learn', m: '学ぶ', p: '動詞', s: 'daily' }], [{ id: 1, b: 'kin', ch: 1, q: 'A ---', c: ['one','two','three'], a: 1 }]);
const config = { kind: 'grammar', source: 'kin', mode: 'e2j', count: '10', filter: 'all', chapters: [], ranges: [], pos: [], dates: [] };
const makeData = () => openStore(disk()).data;
const parse = data => parseBackup(JSON.stringify(createBackup(data)), catalog);
const entry = { streak: 0, added: 1, due: 1, u: 1 };

test('all legacy theme choices map without colliding with Study Desk light', () => {
  for (const theme of ['ink','duolingo','navy','quizlet','forest','nordic','light']) {
    const store = openStore(disk({ toeic_app_theme: theme }));
    assert.equal(store.data.theme, theme === 'light' ? 'sepia' : theme);
  }
  assert.equal(legacyTheme('nonsense'),'light');
  assert.equal(THEMES.length,9);
});

test('preview roundtrip retains preferences, answers and safe session but excludes recursive undo', () => {
  const data = makeData();
  data.theme = 'duolingo'; data.sound = false;
  data.session = startSession([catalog.byId.get('g:1')], config, catalog);
  data.session.choices['g:1'] = { labels: ['one','two','three'], correct: 1 };
  recordAnswer(data, catalog.byId.get('g:1'), { correct: true, selected: 1 }, 1000);
  data.restoreUndo = { before: { secret: 'not exported' } };
  const backup = createBackup(data);
  assert.ok(!('restoreUndo' in backup.data));
  const restored = parseBackup(JSON.stringify(backup),catalog);
  assert.equal(restored.theme,'duolingo');
  assert.equal(restored.sound,false);
  assert.deepEqual(restored.session,data.session);
  assert.deepEqual(restored.records.grammarStats, data.records.grammarStats);
  const oldFormat = { ...backup }; delete oldFormat.format;
  assert.equal(parseBackup(JSON.stringify(oldFormat),catalog).theme, 'duolingo');
});

test('legacy versions 1 through 5 migrate into preview without carrying legacy session/settings', () => {
  for (let format=1; format<=5; format++) {
    const weakWords = format===1 ? { learn:entry } : { e2j:{learn:entry}, j2e:{}, flash:{}, type:{} };
    const seenWords = format===1 ? ['learn'] : { e2j:['learn'], j2e:[], flash:[], type:[] };
    const restored = parseBackup(JSON.stringify({ app:'toeic-drill',format,data:{weakWords,seenWords,weakGrammar:{1:entry},
      ...(format>=3 ? {wordStats:{learn:{a:3,c:1}},grammarStats:{1:{a:2,c:1}}}:{}),
      ...(format>=4 ? {seenGrammar:[1]}:{}), ...(format>=5 ? {weakDeleted:{}}:{}),
      settings:{app:'grammar'},session:{grammar:{pool:[1]}} } }),catalog);
    assert.equal(restored.source,'従来版');
    assert.equal(restored.session,null);
    assert.deepEqual(restored.records.grammarSeen,[1]);
    assert.equal(restored.records.weakWords.e2j.learn.streak,0);
    if(format===1) assert.deepEqual(restored.records.seenWords.type,['learn']);
  }
});

test('alternate legacy backup identifier is supported', () => {
  const restored=parseBackup(JSON.stringify({app:'toeic_practice_backup',data:{weakWords:{learn:entry},seenWords:['learn'],weakGrammar:{1:entry}}}),catalog);
  assert.deepEqual(restored.records.seenWords.flash,['learn']);
});

test('merge is idempotent, preserves current session/theme and unions learned items', () => {
  const current=makeData(), incoming=makeData();
  current.theme='navy'; current.records.grammarStats={1:{a:4,c:2}};
  incoming.theme='duolingo'; incoming.records.grammarStats={1:{a:5,c:4}}; incoming.records.grammarSeen=[1];
  const once=prepareRestore(current,parse(incoming),'merge');
  const twice=prepareRestore(once,parse(incoming),'merge');
  assert.equal(once.theme,'navy');
  assert.deepEqual(once.records,twice.records);
  assert.deepEqual(once.records.grammarStats[1],{a:6,c:4});
  assert.deepEqual(once.records.grammarSeen,[1]);
});

test('replace and persisted undo are reversible without writing legacy keys', () => {
  const storage=disk({toeic_gdrive_linked:'1',toeic_word_stats:'{"learn":{"a":8,"c":5}}'});
  const store=openStore(storage); store.save();
  const before=structuredClone(store.data);
  const incoming=makeData(); incoming.theme='duolingo'; incoming.records.grammarStats={1:{a:7,c:3}};
  assert.equal(store.replace(prepareRestore(store.data,parse(incoming),'replace')),true);
  assert.equal(store.data.theme,'duolingo');
  const reopened=openStore(storage);
  assert.equal(reopened.replace(prepareUndo(reopened.data)),true);
  const {restoreUndo,...after}=reopened.data;
  assert.deepEqual(after,before);
  assert.equal(storage.getItem('toeic_word_stats'),'{"learn":{"a":8,"c":5}}');
  assert.deepEqual([...new Set(storage.writes)],[STORAGE_KEY]);
});

test('failed restore leaves both memory and storage unchanged', () => {
  const storage=disk(); const store=openStore(storage); store.save();
  const before=JSON.stringify(store.data), raw=storage.getItem(STORAGE_KEY);
  storage.setItem=()=>{throw new Error('quota')};
  assert.equal(store.replace(prepareRestore(store.data,parse(makeData()),'replace')),false);
  assert.equal(JSON.stringify(store.data),before);
  assert.equal(storage.getItem(STORAGE_KEY),raw);
});

test('restore detects stale tab changes instead of overwriting them', () => {
  const storage=disk(); const first=openStore(storage); first.save(); const second=openStore(storage);
  first.data.theme='forest'; first.save();
  assert.equal(second.replace(prepareRestore(second.data,parse(makeData()),'replace')),false);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).theme,'forest');
});

test('graduation tombstone prevents old backup from restoring mastered weakness', () => {
  const current=makeData(), incoming=makeData();
  current.records.weakDeleted={'g:1':20};
  incoming.records.grammarWeak={1:entry};
  assert.deepEqual(prepareRestore(current,parse(incoming),'merge').records.grammarWeak,{});
  incoming.records.grammarWeak[1].u=30;
  assert.ok(prepareRestore(current,parse(incoming),'merge').records.grammarWeak[1]);
});

test('malformed, future, oversized, and unsafe backups are rejected without touching state', () => {
  const backup=createBackup(makeData());
  for(const text of ['not json','{}',JSON.stringify({...backup,format:2}),JSON.stringify({...backup,app:'another-app'}), ' '.repeat(MAX_BACKUP_BYTES+1)]) {
    assert.throws(()=>parseBackup(text,catalog));
  }
  backup.data.records.grammarStats={1:{a:2,c:5}};
  assert.throws(()=>parseBackup(JSON.stringify(backup),catalog));
  backup.data.records.grammarStats=JSON.parse('{"__proto__":{"a":1,"c":1}}');
  assert.throws(()=>parseBackup(JSON.stringify(backup),catalog));
  assert.equal({}.a,undefined);
});

test('incompatible or damaged saved session is omitted with an explanation', () => {
  const data=makeData(); data.session=startSession([catalog.byId.get('g:1')],config,catalog);
  data.session.choices={'g:1':{labels:['one','two'],correct:10}};
  const result=parse(data);
  assert.equal(result.session,null); assert.equal(result.warnings.length,1);
});

test('session XP and streak survive reload/review and count each answer once', () => {
  const session={answers:{a:{correct:true,at:1},b:{correct:true,at:2},c:{correct:false,at:3},d:{correct:true,at:4}}};
  assert.deepEqual(sessionRewards(session),{xp:30,streak:1,best:2});
  assert.deepEqual(sessionRewards(JSON.parse(JSON.stringify(session))),sessionRewards(session));
});
