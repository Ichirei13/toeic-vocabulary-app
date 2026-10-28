// This module is deliberately independent of the legacy application and Google APIs.
import { defaultPreferences, validatePreferences } from './preferences.mjs';
import { emptyActivity, validateActivity } from './activity.mjs';
import { legacyTheme } from './themes.mjs';
export const STORAGE_KEY = 'toeic_next_v1';
export const MODES = { e2j: '英 → 日', j2e: '日 → 英', flash: 'カード', type: 'タイプ' };
export const BOOKS = {
  kin: { title: '金の文法', subtitle: 'TOEIC 文法問題 でる1000問', color: 'gold' },
  sekai: { title: '世界一わかりやすい英文法', subtitle: '文のしくみを、一つずつ。', color: 'green' },
  polaris2: { title: '英文法ポラリス 2', subtitle: '応用レベルの英文法', color: 'blue' },
  toplevel: { title: 'トップレベル英語', subtitle: '講義ごとに、理解を深める。', color: 'clay' },
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = key => !['__proto__', 'constructor', 'prototype'].includes(key);
const read = (storage, key, fallback) => {
  const text = storage.getItem(key);
  if (text === null) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};
function stats(raw) {
  return Object.fromEntries(Object.entries(object(raw) ? raw : {}).filter(([k, v]) =>
    safeKey(k) && object(v) && Number.isInteger(v.a) && v.a > 0 && Number.isInteger(v.c) && v.c >= 0 && v.c <= v.a));
}
function weak(raw, tombs, prefix) {
  return Object.fromEntries(Object.entries(object(raw) ? raw : {}).flatMap(([k, v]) => {
    if (!safeKey(k) || !object(v) || (tombs[prefix + k] > 0 && (v.u || 0) <= tombs[prefix + k])) return [];
    if (v.due !== undefined && (!Number.isFinite(v.due) || v.due < 0)) return [];
    return [[k, { added: Number(v.added) || Date.now(), due: v.due ?? 0,
      streak: Number.isInteger(v.streak) ? Math.max(0, Math.min(3, v.streak)) : 0,
      u: Number.isFinite(v.u) ? v.u : 0 }]];
  }));
}
const strings = value => Array.isArray(value) ? [...new Set(value.filter(x => typeof x === 'string' && safeKey(x)))] : [];

export function seedFromLegacy(storage) {
  const rawTombs = read(storage, 'toeic_weak_deleted', {});
  const tombs = Object.fromEntries(Object.entries(object(rawTombs) ? rawTombs : {}).filter(([k, v]) => safeKey(k) && Number.isFinite(v) && v >= 0));
  const byMode = read(storage, 'toeic_weak_words_by_mode', null);
  const seenMode = read(storage, 'toeic_seen_words_by_mode', null);
  const oldWeak = read(storage, 'toeic_weak_words', {});
  const oldSeen = read(storage, 'toeic_seen_words', []);
  const grammarWeak = weak(read(storage, 'toeic_weak_grammar', {}), tombs, 'g:');
  const grammarStats = stats(read(storage, 'toeic_grammar_stats', {}));
  const wordStats = stats(read(storage, 'toeic_word_stats', {}));
  const grammarSeen = read(storage, 'toeic_seen_grammar', null);
  return {
    schema: 2, preferences: defaultPreferences(), activity: emptyActivity(), importedAt: Date.now(), importedItems: Object.keys(wordStats).length + Object.keys(grammarStats).length,
    theme: legacyTheme(storage.getItem('toeic_app_theme')), sound: true, session: null,
    records: {
      weakWords: Object.fromEntries(Object.keys(MODES).map(m => [m, weak(object(byMode) ? byMode[m] : oldWeak, tombs, `w:${m}:`)])),
      seenWords: Object.fromEntries(Object.keys(MODES).map(m => [m, strings(object(seenMode) ? seenMode[m] : oldSeen)])),
      wordStats, grammarWeak, grammarStats, weakDeleted: tombs,
      grammarSeen: [...new Set((Array.isArray(grammarSeen) ? grammarSeen : grammarSeen === null
        ? [...Object.keys(grammarStats), ...Object.keys(grammarWeak)].map(Number) : []).filter(x => Number.isInteger(x) && x > 0))],
    },
  };
}

function validSaved(value) {
  if (!object(value) || ![1, 2].includes(value.schema) || !object(value.records)) return false;
  const r = value.records;
  return object(r.weakWords) && object(r.seenWords) && object(r.wordStats) && object(r.grammarWeak) &&
    object(r.grammarStats) && Array.isArray(r.grammarSeen) && Object.keys(MODES).every(m => object(r.weakWords[m]) && Array.isArray(r.seenWords[m]));
}

export function migrateSaved(raw, now = new Date(), includeUndo = true) {
  if (!validSaved(raw)) throw new Error('unsupported');
  const data = structuredClone(raw);
  data.preferences = raw.schema === 1 ? defaultPreferences() : validatePreferences(raw.preferences);
  data.activity = raw.schema === 1 ? emptyActivity(now) : validateActivity(raw.activity);
  data.schema = 2;
  if (includeUndo && data.restoreUndo) {
    if (!object(data.restoreUndo) || !Number.isFinite(data.restoreUndo.at)) throw new Error('invalid undo');
    data.restoreUndo.before = migrateSaved(data.restoreUndo.before, now, false);
  } else if (!includeUndo) delete data.restoreUndo;
  return data;
}

export function openStore(storage) {
  const emptyStorage = { getItem: () => null };
  let lastRaw = null;
  let blocked = false;
  let notice = '';
  let data;
  try {
    lastRaw = storage.getItem(STORAGE_KEY);
    if (lastRaw !== null) {
      const parsed = JSON.parse(lastRaw);
      if (!validSaved(parsed)) throw new Error('unsupported');
      data = migrateSaved(parsed);
    } else data = seedFromLegacy(storage);
  } catch {
    blocked = true;
    notice = '保存済みの記録を読み込めませんでした。元の記録は保持しています。この画面での学習は保存されません。';
    data = seedFromLegacy(emptyStorage);
  }
  function persist(value) {
    if (blocked) return false;
    try {
      if (storage.getItem(STORAGE_KEY) !== lastRaw) {
        blocked = true;
        notice = '別のタブで試用版の記録が更新されました。上書きを防ぐため保存を停止しています。再読み込みしてください。';
        return false;
      }
      const nextRaw = JSON.stringify(value);
      storage.setItem(STORAGE_KEY, nextRaw);
      lastRaw = nextRaw;
      notice = '';
      return true;
    } catch {
      notice = '端末に記録を保存できません。空き容量やブラウザの設定を確認してください。今の記録は設定から書き出せます。';
      return false;
    }
  }
  return {
    data, get notice() { return notice; },
    save() { return persist(data); },
    replace(next) {
      try { next = migrateSaved(next); } catch { return false; }
      if (!persist(next)) return false;
      Object.keys(data).forEach(key => delete data[key]);
      Object.assign(data, next);
      return true;
    },
  };
}

export function makeCatalog(words, grammar) {
  const items = [
    ...words.map((w, i) => ({ id: `w:${i}`, key: w.w, kind: 'vocab', source: w.s, ...w })),
    ...grammar.map(g => ({ ...g, id: `g:${g.id}`, key: String(g.id), kind: 'grammar', source: g.b })),
  ];
  // Identifies changes to content as well as ordering; never resume against another dataset.
  let hash = 2166136261;
  for (const char of JSON.stringify([words, grammar])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { items, byId: new Map(items.map(i => [i.id, i])), fingerprint: String(hash >>> 0) };
}

export function weakMap(records, kind, mode = 'e2j') {
  return kind === 'grammar' ? records.grammarWeak : records.weakWords[mode];
}
export function selectItems(catalog, records, config, now = Date.now()) {
  const seen = new Set(config.kind === 'grammar' ? records.grammarSeen.map(String) : records.seenWords[config.mode]);
  const weakItems = weakMap(records, config.kind, config.mode);
  const deduped = new Set();
  return catalog.items.filter(item => {
    if (item.kind !== config.kind || (config.source !== 'all' && item.source !== config.source)) return false;
    if (config.chapters?.length && !config.chapters.includes(item.ch)) return false;
    if (config.pos?.length && !config.pos.includes(item.p)) return false;
    if (config.ranges?.length && !config.ranges.some(start => item.no >= start && item.no < start + 100)) return false;
    if (config.dates?.length && !config.dates.includes(item.d)) return false;
    const entry = weakItems[item.key];
    if (config.filter === 'due' && (!entry || entry.due > now)) return false;
    if (config.filter === 'weak' && !entry) return false;
    if (config.filter === 'unseen' && seen.has(item.key)) return false;
    if (config.filter === 'weak_unseen' && !entry && seen.has(item.key)) return false;
    if (deduped.has(item.key)) return false;
    deduped.add(item.key);
    return true;
  });
}
export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function choicesFor(item, catalog, mode, random = Math.random) {
  if (item.kind === 'grammar') return { labels: item.c, correct: item.a };
  const field = mode === 'j2e' ? 'w' : 'm';
  const candidates = shuffle(catalog.items.filter(i => i.kind === 'vocab' && i.key !== item.key), random);
  const labels = [item[field]];
  for (const candidate of [...candidates.filter(c => c.p === item.p), ...candidates]) {
    if (!labels.includes(candidate[field])) labels.push(candidate[field]);
    if (labels.length === 4) break;
  }
  return { labels: shuffle(labels, random), answer: item[field] };
}
export function startSession(items, config, catalog, random = Math.random) {
  const count = config.count === 'all' ? items.length : Number(config.count);
  return { config: structuredClone(config), fingerprint: catalog.fingerprint,
    ids: shuffle(items, random).slice(0, count).map(i => i.id), cursor: 0, answers: {}, choices: {}, startedAt: Date.now() };
}
export function validSession(s, catalog) {
  return object(s) && s.fingerprint === catalog.fingerprint && object(s.config) &&
    ['vocab', 'grammar'].includes(s.config.kind) && Object.hasOwn(MODES, s.config.mode) &&
    Array.isArray(s.ids) && s.ids.length > 0 && s.ids.every(id => catalog.byId.has(id)) &&
    Number.isInteger(s.cursor) && s.cursor >= 0 && s.cursor <= s.ids.length && object(s.answers) && object(s.choices);
}
export function recordAnswer(data, item, result, now = Date.now()) {
  const session = data.session;
  if (Object.hasOwn(session.answers, item.id)) return false;
  session.answers[item.id] = { ...result, at: now };
  const r = data.records;
  const statMap = item.kind === 'grammar' ? r.grammarStats : r.wordStats;
  const previous = statMap[item.key] || { a: 0, c: 0 };
  statMap[item.key] = { a: previous.a + 1, c: previous.c + Number(result.correct) };
  const seen = item.kind === 'grammar' ? r.grammarSeen : r.seenWords[session.config.mode];
  const seenKey = item.kind === 'grammar' ? Number(item.key) : item.key;
  if (!seen.includes(seenKey)) seen.push(seenKey);
  const map = weakMap(r, item.kind, session.config.mode);
  r.weakDeleted ??= {};
  const tombKey = item.kind === 'grammar' ? `g:${item.key}` : `w:${session.config.mode}:${item.key}`;
  const entry = map[item.key];
  if (!result.correct) {
    map[item.key] = { streak: 0, added: entry?.added || now, due: now, u: now };
    delete r.weakDeleted[tombKey];
  }
  else if (entry && entry.due <= now) {
    if (entry.streak >= 3) { delete map[item.key]; r.weakDeleted[tombKey] = now; }
    else {
      entry.streak++;
      entry.u = now;
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + [1, 3, 7][entry.streak - 1]);
      entry.due = date.getTime();
    }
  }
  return true;
}
