import { MODES, validSession } from './core.mjs';
import { themeById } from './themes.mjs';

export const BACKUP_APP = 'toeic-study-desk-preview';
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => structuredClone(v);
const fail = message => { throw new Error(message); };
const assert = (condition, message = '学習記録の形が正しくありません。') => { if (!condition) fail(message); };
const keyOK = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(k);
const grammarKey = k => /^[1-9]\d{0,8}$/.test(k);

function mapValues(raw, checkKey, convert) {
  assert(object(raw));
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    assert(checkKey(key));
    return [key, convert(value)];
  }));
}
function cleanWeak(raw, checkKey) {
  return mapValues(raw, checkKey, value => {
    assert(object(value));
    const streak = value.due === undefined ? 0 : value.streak;
    assert(Number.isInteger(streak) && streak >= 0 && streak <= 3);
    assert(value.due === undefined || Number.isFinite(value.due) && value.due >= 0);
    const now = Date.now();
    return { streak, due: Math.min(value.due ?? 0, now + 8 * 86400000),
      added: Number.isFinite(value.added) && value.added > 0 ? Math.min(value.added, now) : now,
      u: Number.isFinite(value.u) && value.u >= 0 ? Math.min(value.u, now) : 0 };
  });
}
function cleanStats(raw, checkKey) {
  return mapValues(raw, checkKey, value => {
    assert(object(value) && Number.isSafeInteger(value.a) && value.a > 0 && Number.isSafeInteger(value.c) && value.c >= 0 && value.c <= value.a);
    return { a: value.a, c: value.c };
  });
}
function list(raw, check) {
  assert(Array.isArray(raw) && raw.every(check));
  return [...new Set(raw)];
}
function cleanRecords(raw) {
  assert(object(raw) && object(raw.weakWords) && object(raw.seenWords));
  const records = {
    weakWords: {}, seenWords: {},
    grammarWeak: cleanWeak(raw.grammarWeak, grammarKey),
    wordStats: cleanStats(raw.wordStats, keyOK), grammarStats: cleanStats(raw.grammarStats, grammarKey),
    grammarSeen: list(raw.grammarSeen, n => Number.isInteger(n) && n > 0 && n <= 999999999),
    weakDeleted: mapValues(raw.weakDeleted ?? {}, k => {
      const parts = /^w:([^:]+):(.+)$/.exec(k);
      return parts ? Object.hasOwn(MODES, parts[1]) && keyOK(parts[2]) : /^g:[1-9]\d{0,8}$/.test(k);
    }, time => { assert(Number.isFinite(time) && time >= 0); return Math.min(time, Date.now()); }),
  };
  for (const mode of Object.keys(MODES)) {
    records.weakWords[mode] = cleanWeak(raw.weakWords[mode] ?? {}, keyOK);
    records.seenWords[mode] = list(raw.seenWords[mode] ?? [], keyOK);
  }
  return applyTombstones(records);
}
function applyTombstones(records) {
  for (const [prefix, map] of [['g:', records.grammarWeak], ...Object.keys(MODES).map(m => [`w:${m}:`, records.weakWords[m]])]) {
    for (const [key, value] of Object.entries(map)) {
      const deletedAt = records.weakDeleted[prefix + key] || 0;
      if (deletedAt > 0 && deletedAt >= (value.u || 0)) delete map[key];
    }
  }
  return records;
}
function legacyRecords(backup) {
  const d = backup.data;
  assert(object(d));
  const singleMode = backup.app === 'toeic_practice_backup' || backup.format === 1;
  const copies = v => Object.fromEntries(Object.keys(MODES).map(m => [m, clone(v)]));
  const version = backup.app === 'toeic_practice_backup' ? 1 : backup.format;
  return cleanRecords({
    weakWords: singleMode ? copies(d.weakWords ?? {}) : d.weakWords,
    seenWords: singleMode ? copies(d.seenWords ?? []) : d.seenWords,
    grammarWeak: d.weakGrammar ?? {}, wordStats: d.wordStats ?? {}, grammarStats: d.grammarStats ?? {},
    grammarSeen: version < 4 ? [...new Set([...Object.keys(d.grammarStats || {}), ...Object.keys(d.weakGrammar || {})].map(Number))] : d.seenGrammar,
    weakDeleted: version < 5 ? {} : d.weakDeleted,
  });
}

function safeSession(s, catalog) {
  if (!validSession(s, catalog) || new Set(s.ids).size !== s.ids.length) return null;
  const c = s.config;
  if (!['10', '20', 'all'].includes(c.count) || !['all', 'due', 'weak', 'weak_unseen', 'unseen'].includes(c.filter) ||
    typeof c.source !== 'string' || !['chapters', 'pos', 'dates', 'ranges'].every(k => Array.isArray(c[k])) ||
    !c.chapters.every(Number.isInteger) || !c.ranges.every(Number.isInteger) || !c.pos.every(v => typeof v === 'string') || !c.dates.every(v => typeof v === 'string')) return null;
  if (s.ids.some(id => catalog.byId.get(id).kind !== c.kind)) return null;
  for (const [id, choice] of Object.entries(s.choices)) {
    if (!s.ids.includes(id) || !object(choice) || !Array.isArray(choice.labels) || choice.labels.length < 2 || choice.labels.length > 5 ||
      !choice.labels.every(x => typeof x === 'string') || !Number.isInteger(choice.correct) || choice.correct < 0 || choice.correct >= choice.labels.length) return null;
  }
  for (const [id, answer] of Object.entries(s.answers)) {
    if (!s.ids.includes(id) || !object(answer) || typeof answer.correct !== 'boolean' || !Number.isFinite(answer.at) ||
      (answer.typed !== undefined && typeof answer.typed !== 'string') ||
      (answer.selected !== undefined && (!s.choices[id] || !Number.isInteger(answer.selected) || answer.selected < 0 || answer.selected >= s.choices[id].labels.length))) return null;
  }
  return clone(s);
}
function warnUnknown(records, catalog, warnings) {
  const words = new Set(catalog.items.filter(i => i.kind === 'vocab').map(i => i.key));
  const grammar = new Set(catalog.items.filter(i => i.kind === 'grammar').map(i => i.key));
  const unknownWords = new Set([...Object.keys(records.wordStats), ...Object.values(records.weakWords).flatMap(Object.keys), ...Object.values(records.seenWords).flat()].filter(k => !words.has(k)));
  const unknownGrammar = new Set([...Object.keys(records.grammarStats), ...Object.keys(records.grammarWeak), ...records.grammarSeen.map(String)].filter(k => !grammar.has(k)));
  const count = unknownWords.size + unknownGrammar.size;
  if (count) warnings.push(`現在の教材にない${count}項目の記録も保存します。教材が対応するまで演習には表示されません。`);
}

export function createBackup(data) {
  const { restoreUndo, ...snapshot } = data;
  return { app: BACKUP_APP, format: 1, exportedAt: new Date().toISOString(), data: clone(snapshot) };
}
export function parseBackup(text, catalog) {
  assert(new TextEncoder().encode(text).length <= MAX_BACKUP_BYTES, 'ファイルは2MBまでです。');
  let backup;
  try { backup = JSON.parse(text); } catch { fail('JSONとして読み込めませんでした。バックアップファイルを選んでください。'); }
  assert(object(backup), 'バックアップファイルではありません。');
  const warnings = [];
  if (backup.app === BACKUP_APP) {
    assert(backup.format === undefined || backup.format === 1, 'このバックアップの版には対応していません。');
    assert(object(backup.data) && backup.data.schema === 1, 'この保存形式には対応していません。');
    const data = backup.data;
    const records = cleanRecords(data.records);
    warnUnknown(records, catalog, warnings);
    const session = data.session ? safeSession(data.session, catalog) : null;
    if (data.session && !session) warnings.push('教材または形式が一致しないため、演習の続きは取り込みません。');
    return { source: '試用版', records, session, theme: themeById(data.theme).id,
      sound: data.sound !== false, exportedAt: backup.exportedAt, warnings };
  }
  assert(['toeic-drill', 'toeic_practice_backup'].includes(backup.app), 'TOEIC Drillのバックアップではありません。');
  if (backup.app === 'toeic-drill') assert(Number.isInteger(backup.format) && backup.format >= 1 && backup.format <= 5, 'この従来版バックアップの版には対応していません。');
  warnings.push('従来版の出題設定と演習の続きは取り込みません。');
  const records = legacyRecords(backup);
  warnUnknown(records, catalog, warnings);
  return { source: '従来版', records, session: null, exportedAt: backup.exportedAt, warnings };
}
export function recordCounts(records) {
  return {
    weakWords: Object.values(records.weakWords).reduce((n, m) => n + Object.keys(m).length, 0),
    weakGrammar: Object.keys(records.grammarWeak).length,
    seenWords: Object.values(records.seenWords).reduce((n, list) => n + list.length, 0),
    seenGrammar: records.grammarSeen.length,
    answers: [...Object.values(records.wordStats), ...Object.values(records.grammarStats)].reduce((n, x) => n + x.a, 0),
  };
}
export function mergeRecords(current, incoming) {
  const out = clone(current);
  out.weakDeleted = { ...current.weakDeleted };
  for (const [key, time] of Object.entries(incoming.weakDeleted || {})) out.weakDeleted[key] = Math.max(out.weakDeleted[key] || 0, time);
  const mergeWeak = (a, b) => {
    const merged = clone(a);
    for (const [key, value] of Object.entries(b)) {
      const prev = merged[key];
      if (!prev || (value.u || 0) > (prev.u || 0) || (value.u || 0) === (prev.u || 0) &&
        (value.streak > prev.streak || value.streak === prev.streak && value.due > prev.due)) merged[key] = clone(value);
    }
    return merged;
  };
  for (const mode of Object.keys(MODES)) {
    out.weakWords[mode] = mergeWeak(out.weakWords[mode], incoming.weakWords[mode]);
    out.seenWords[mode] = [...new Set([...out.seenWords[mode], ...incoming.seenWords[mode]])];
  }
  out.grammarWeak = mergeWeak(out.grammarWeak, incoming.grammarWeak);
  out.grammarSeen = [...new Set([...out.grammarSeen, ...incoming.grammarSeen])];
  // Count successes/failures independently; importing the same file twice is idempotent.
  for (const field of ['wordStats', 'grammarStats']) for (const [key, value] of Object.entries(incoming[field])) {
    const prev = out[field][key] || { a: 0, c: 0 };
    const c = Math.max(prev.c, value.c);
    out[field][key] = { a: c + Math.max(prev.a - prev.c, value.a - value.c), c };
  }
  return applyTombstones(out);
}
export function prepareRestore(current, parsed, mode) {
  assert(['merge', 'replace'].includes(mode));
  const next = clone(current);
  next.records = mode === 'merge' ? mergeRecords(current.records, parsed.records) : clone(parsed.records);
  if (mode === 'replace') {
    next.session = clone(parsed.session);
    if (parsed.theme) next.theme = parsed.theme;
    if (typeof parsed.sound === 'boolean') next.sound = parsed.sound;
  }
  const { restoreUndo, ...before } = current;
  next.restoreUndo = { before: clone(before), at: Date.now() };
  return next;
}
export function prepareUndo(current) {
  assert(object(current.restoreUndo?.before), '取り消せる復元がありません。');
  return { ...clone(current.restoreUndo.before), restoreUndo: null };
}
