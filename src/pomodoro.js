// ポモドーロタイマーの設定・フェーズ遷移・日別集中記録の純粋ロジック（DOM にも localStorage にも触れない）。
// ブラウザでは StudyCore.*、node では require で使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const POMO_DEFAULT_SETTINGS = {
    work: 25,
    brk: 5,
    long: 15,
    every: 4,
    auto: true,
    subject: '',
  };

  const POMO_RANGES = {
    work: { min: 1, max: 120 },
    brk: { min: 1, max: 60 },
    long: { min: 1, max: 60 },
    every: { min: 2, max: 8 },
  };

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const toInt = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

  function clampPomoInt(field, val) {
    const range = POMO_RANGES[field];
    if (!range) return null;
    if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) return null;
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    return Math.min(range.max, Math.max(range.min, Math.round(n)));
  }

  function normalizePomoSettings(raw) {
    const src = isObject(raw) ? raw : {};
    const work = clampPomoInt('work', src.work) ?? POMO_DEFAULT_SETTINGS.work;
    const brk = clampPomoInt('brk', src.brk) ?? POMO_DEFAULT_SETTINGS.brk;
    const long = clampPomoInt('long', src.long) ?? POMO_DEFAULT_SETTINGS.long;
    const every = clampPomoInt('every', src.every) ?? POMO_DEFAULT_SETTINGS.every;
    const auto = typeof src.auto === 'boolean' ? src.auto : POMO_DEFAULT_SETTINGS.auto;
    const subject = typeof src.subject === 'string' ? src.subject.trim().slice(0, 24) : POMO_DEFAULT_SETTINGS.subject;
    return { work, brk, long, every, auto, subject };
  }

  function pomoSettingsPatch(raw) {
    if (!isObject(raw)) return null;
    const out = {};
    ['work', 'brk', 'long', 'every'].forEach(k => {
      const v = clampPomoInt(k, raw[k]);
      if (v !== null) out[k] = v;
    });
    if (typeof raw.auto === 'boolean') out.auto = raw.auto;
    if (typeof raw.subject === 'string') out.subject = raw.subject.trim().slice(0, 24);
    return Object.keys(out).length ? out : null;
  }

  function pomoDurationSec(mode, settings) {
    const s = normalizePomoSettings(settings);
    if (mode === 'long') return s.long * 60;
    if (mode === 'short') return s.brk * 60;
    return s.work * 60;
  }

  function nextPomoPhase(mode, cycle, every) {
    const targetEvery = clampPomoInt('every', every) ?? POMO_DEFAULT_SETTINGS.every;
    const curCycle = Math.max(0, toInt(cycle));
    if (mode === 'work') {
      const nextCycle = curCycle + 1;
      if (nextCycle >= targetEvery) {
        return { mode: 'long', cycle: 0 };
      }
      return { mode: 'short', cycle: nextCycle };
    }
    return { mode: 'work', cycle: curCycle };
  }

  function formatPomoTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  function recordPomoSession(log, dateKey, minutes, subject) {
    const mins = toInt(minutes);
    if (mins <= 0 || !DATE_KEY.test(dateKey)) return log || {};
    const next = { ...(log || {}) };
    const prev = isObject(next[dateKey]) ? next[dateKey] : { minutes: 0, sets: 0, subjects: {} };
    const subjects = isObject(prev.subjects) ? { ...prev.subjects } : {};
    const label = (typeof subject === 'string' ? subject.trim().slice(0, 24) : '') || '未分類';
    subjects[label] = toInt(subjects[label]) + mins;
    next[dateKey] = {
      minutes: toInt(prev.minutes) + mins,
      sets: toInt(prev.sets) + 1,
      subjects,
    };
    return next;
  }

  function sanitizePomoLog(raw) {
    const log = {};
    let invalid = 0;
    if (!isObject(raw)) return { log, invalid: 0 };
    Object.keys(raw).forEach(k => {
      const e = raw[k];
      if (!DATE_KEY.test(k) || !isObject(e)) {
        invalid++;
        return;
      }
      const minutes = toInt(e.minutes);
      const sets = toInt(e.sets);
      if (minutes <= 0 && sets <= 0) {
        invalid++;
        return;
      }
      const subjects = {};
      if (isObject(e.subjects)) {
        Object.keys(e.subjects).forEach(sub => {
          const m = toInt(e.subjects[sub]);
          const cleanSub = String(sub).trim().slice(0, 24);
          if (cleanSub && m > 0) subjects[cleanSub] = m;
        });
      }
      log[k] = {
        minutes: Math.max(minutes, 1),
        sets: Math.max(sets, 1),
        subjects,
      };
    });
    return { log, invalid };
  }

  function mergePomoLog(cur, inc) {
    const out = {};
    const c = isObject(cur) ? cur : {};
    const i = isObject(inc) ? inc : {};
    new Set([...Object.keys(c), ...Object.keys(i)]).forEach(k => {
      const a = c[k];
      const b = i[k];
      if (!a) {
        out[k] = { minutes: b.minutes, sets: b.sets, subjects: { ...(b.subjects || {}) } };
      } else if (!b) {
        out[k] = { minutes: a.minutes, sets: a.sets, subjects: { ...(a.subjects || {}) } };
      } else {
        const pickB = b.minutes > a.minutes || (b.minutes === a.minutes && b.sets > a.sets);
        const chosen = pickB ? b : a;
        out[k] = { minutes: chosen.minutes, sets: chosen.sets, subjects: { ...(chosen.subjects || {}) } };
      }
    });
    return out;
  }

  return {
    POMO_DEFAULT_SETTINGS,
    POMO_RANGES,
    clampPomoInt,
    normalizePomoSettings,
    pomoSettingsPatch,
    pomoDurationSec,
    nextPomoPhase,
    formatPomoTime,
    recordPomoSession,
    sanitizePomoLog,
    mergePomoLog,
  };
});
