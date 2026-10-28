const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const safe = k => !['__proto__', 'prototype', 'constructor'].includes(k);
export const GOALS = [0, 5, 10, 20, 30];
export function defaultPreferences() { return { dailyGoal: 10, companion: 'auto', recentPreset: null, presets: {} }; }
export function validateConfig(raw) {
  if (!object(raw) || !['grammar','vocab'].includes(raw.kind) || typeof raw.source !== 'string' || !/^[a-z0-9_]+$/.test(raw.source) || !safe(raw.source) ||
    !['e2j','j2e','flash','type'].includes(raw.mode) || !['all','due','weak','weak_unseen','unseen'].includes(raw.filter) || !['10','20','all'].includes(raw.count)) throw new Error('出題設定が正しくありません。');
  const out = { kind: raw.kind, source: raw.source, mode: raw.mode, filter: raw.filter, count: raw.count };
  for (const key of ['chapters','pos','ranges','dates']) {
    if (!Array.isArray(raw[key]) || raw[key].length > 2000 || !raw[key].every(v => ['chapters','ranges'].includes(key) ? Number.isSafeInteger(v) && v > 0 : typeof v === 'string' && v.length < 200 && safe(v))) throw new Error('出題範囲が正しくありません。');
    out[key] = [...new Set(raw[key])];
  }
  return out;
}
export function validatePreferences(raw) {
  if (!object(raw) || !GOALS.includes(raw.dailyGoal) || !['auto','on','off'].includes(raw.companion) || !object(raw.presets)) throw new Error('学習設定が正しくありません。');
  const presets = Object.fromEntries(Object.entries(raw.presets).map(([key, config]) => {
    const clean = validateConfig(config);
    if (!safe(key) || key !== `${clean.kind}:${clean.source}`) throw new Error('教材設定が正しくありません。');
    return [key, clean];
  }));
  if (raw.recentPreset !== null && (typeof raw.recentPreset !== 'string' || !Object.hasOwn(presets, raw.recentPreset))) throw new Error('前回の教材設定が正しくありません。');
  return { dailyGoal: raw.dailyGoal, companion: raw.companion, recentPreset: raw.recentPreset, presets };
}
export const presetKey = config => `${config.kind}:${config.source}`;
export function rememberPreset(preferences, config) {
  const out = structuredClone(preferences), clean = validateConfig(config), key = presetKey(clean);
  out.presets[key] = clean; out.recentPreset = key; return out;
}
export function resolvePreset(preferences, key, catalog) {
  if (!key || !Object.hasOwn(preferences.presets,key)) return { config: null, needsConfirmation: false, message: '' };
  const config = structuredClone(preferences.presets[key]);
  const items = catalog.items.filter(i => i.kind === config.kind && (config.source === 'all' || i.source === config.source));
  const message = '教材更新により一部の条件を見直してください。';
  if (!items.length) return { config: null, needsConfirmation: true, message };
  let changed = false;
  const available = {
    chapters: new Set(items.map(i => i.ch)), pos: new Set(items.map(i => i.p)), dates: new Set(items.map(i => i.d)),
    ranges: new Set(items.filter(i => Number.isFinite(i.no)).map(i => Math.floor((i.no - 1) / 100) * 100 + 1)),
  };
  for (const field of ['chapters','pos','dates','ranges']) {
    const kept = config[field].filter(value => available[field].has(value));
    changed ||= kept.length !== config[field].length; config[field] = kept;
  }
  return { config, needsConfirmation: changed, message: changed ? message : '' };
}
