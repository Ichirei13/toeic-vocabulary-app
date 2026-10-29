// 今日の目標・日別記録・月カレンダーの純粋ロジック（DOM にも localStorage にも触れない）。
// ブラウザでは StudyCore.*、node では require で使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const GOALS = [0, 5, 10, 20, 30]; // ワンタップの選択肢。保存できる目標は 0〜MAX_GOAL の整数
  const MAX_GOAL = 200;
  const DEFAULT_GOAL = 10;
  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const toInt = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

  // 0〜200 の整数（0 は目標なし）だけ通す。文字列や範囲外の値は初期値の 10 問
  function isGoal(v) {
    return Number.isInteger(v) && v >= 0 && v <= MAX_GOAL;
  }

  function normalizeGoal(v) {
    return isGoal(v) ? v : DEFAULT_GOAL;
  }

  // 入力欄の値（文字列も可）を 0〜200 の整数に直す。数として読めなければ null
  function clampGoal(raw) {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX_GOAL, Math.max(0, Math.round(n)));
  }

  // 目標の選択肢（既定の選択肢に今の値を足して昇順）
  function goalChoices(current) {
    return [...new Set([...GOALS, ...(isGoal(current) ? [current] : [])])].sort((a, b) => a - b);
  }

  function goalProgress(day, goal) {
    const answered = toInt(day && day.a);
    const g = normalizeGoal(goal);
    return {
      answered,
      goal: g,
      hasGoal: g > 0,
      reached: g > 0 && answered >= g,
      ratio: g > 0 ? Math.min(1, answered / g) : 0,
    };
  }

  // raw は { days: { 'YYYY-MM-DD': { a, c, fast, sec, g?, gr? } } }。形の正しい日だけ残し、除いた数を返す
  function sanitizeActivity(raw) {
    const days = {};
    let invalid = 0;
    if (!isObject(raw) || !isObject(raw.days)) return { days, invalid: 0 };
    Object.keys(raw.days).forEach(k => {
      const e = raw.days[k];
      if (!DATE_KEY.test(k) || !isObject(e) || toInt(e.a) <= 0) {
        invalid++;
        return;
      }
      const a = toInt(e.a);
      const entry = {
        a,
        c: Math.min(a, toInt(e.c)),
        fast: Math.min(a, toInt(e.fast)),
        sec: Math.max(0, Number(e.sec) || 0),
      };
      if (isGoal(e.g)) entry.g = e.g;
      if (toInt(e.gr) > 0) entry.gr = toInt(e.gr);
      days[k] = entry;
    });
    return { days, invalid };
  }

  // 同じ日は回答数 a の大きい方を採用（端末間の厳密な合算ではない）。目標 g は現在（cur）を優先
  function mergeActivity(cur, inc) {
    const out = {};
    const c = cur || {};
    const i = inc || {};
    new Set([...Object.keys(c), ...Object.keys(i)]).forEach(k => {
      const a = c[k];
      const b = i[k];
      const picked = !a ? b : !b ? a : (b.a > a.a ? b : a);
      const entry = { ...picked };
      const g = a && a.g !== undefined ? a.g : (b ? b.g : undefined);
      if (g !== undefined) entry.g = g;
      else delete entry.g;
      const gr = Math.max(toInt(a && a.gr), toInt(b && b.gr));
      if (gr > 0) entry.gr = gr;
      else delete entry.gr;
      out[k] = entry;
    });
    return out;
  }

  // 月カレンダー。leading は 1 日の曜日（日曜 = 0）＝先頭の空きマス数。未来の月へは進めない（canNext）
  function monthModel(days, ym, todayKey) {
    const [y, m] = ym.split('-').map(Number);
    const leading = new Date(y, m - 1, 1).getDay();
    const count = new Date(y, m, 0).getDate();
    const cells = [];
    for (let d = 1; d <= count; d++) {
      const key = `${ym}-${String(d).padStart(2, '0')}`;
      const day = (days || {})[key];
      const answered = toInt(day && day.a);
      const goal = day && isGoal(day.g) ? day.g : 0;
      cells.push({
        day: d,
        key,
        answered,
        goal,
        studied: answered > 0,
        reached: goal > 0 && answered >= goal,
        future: key > todayKey,
        today: key === todayKey,
      });
    }
    return { ym, label: `${y}年${m}月`, leading, cells, canNext: ym < todayKey.slice(0, 7) };
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function studiedDays(days) {
    return Object.keys(days || {}).filter(k => DATE_KEY.test(k) && toInt(days[k] && days[k].a) > 0).length;
  }

  return { GOALS, MAX_GOAL, isGoal, clampGoal, goalChoices, normalizeGoal, goalProgress, sanitizeActivity, mergeActivity, monthModel, shiftMonth, studiedDays };
});
