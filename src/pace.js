// 即答の目標タイム（秒）と、解答ペースのバッジの段階の純粋ロジック。DOM にも保存にも触れない。
// ブラウザでは StudyCore.*、node では require で使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_PACE = { vocab: 5, grammar: 20 };
  // 範囲と刻み（単語は 0.5 秒刻み、文法は 1 秒刻み）
  const RANGE = { vocab: { min: 1, max: 30, step: 0.5 }, grammar: { min: 5, max: 120, step: 1 } };
  // バッジの段階の目標タイムに対する割合。既定値だと今までの境界（単語 3.5 / 6.0 秒、文法 10 / 20 秒）と一致する
  const TIER = { vocab: { top: 0.7, ok: 1.2 }, grammar: { top: 0.5, ok: 1 } };
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const round2 = n => Math.round(n * 100) / 100;
  const kindOf = kind => (kind === 'grammar' ? 'grammar' : 'vocab');

  function fit(kind, n) {
    const { min, max, step } = RANGE[kindOf(kind)];
    return Math.min(max, Math.max(min, Math.round(n / step) * step));
  }

  // 保存されていた値の読み込み用。数値でなければ既定値、範囲外は範囲内に直す
  function normalizePace(kind, v) {
    return typeof v === 'number' && Number.isFinite(v) ? fit(kind, v) : DEFAULT_PACE[kindOf(kind)];
  }

  // 入力欄の値（文字列も可）を範囲内に直す。数として読めなければ null
  function clampPace(kind, raw) {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? fit(kind, n) : null;
  }

  function normalizePaceTarget(raw) {
    const src = isObject(raw) ? raw : {};
    return { vocab: normalizePace('vocab', src.vocab), grammar: normalizePace('grammar', src.grammar) };
  }

  // バックアップ用。正しい項目だけを取り出す（無い項目は「今のまま」にするため）。何も無ければ null
  function paceTargetPatch(raw) {
    if (!isObject(raw)) return null;
    const out = {};
    ['vocab', 'grammar'].forEach(k => {
      if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = fit(k, raw[k]);
    });
    return Object.keys(out).length ? out : null;
  }

  // 正解で目標タイム以内なら即答
  function isFastAnswer(sec, isCorrect, target) {
    return Boolean(isCorrect) && sec <= target;
  }

  // バッジの段階: 'top'（いちばん速い）/ 'ok'（目標ペース）/ 'none'
  function paceTier(kind, sec, isCorrect, target) {
    if (!isCorrect) return 'none';
    const t = TIER[kindOf(kind)];
    if (sec <= round2(target * t.top)) return 'top';
    if (sec <= round2(target * t.ok)) return 'ok';
    return 'none';
  }

  // 解いている間のカウントアップ表示。0.1 秒刻みで、60 秒以上は「60+」（記録の上限に合わせる）
  function formatElapsed(sec) {
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '0.0';
    const tenth = Math.round(sec * 10) / 10;
    return sec >= 60 || tenth >= 60 ? '60+' : tenth.toFixed(1);
  }

  // 目標タイムを超えたら真（カウントアップの色を変えるのに使う）
  function isOverTarget(sec, target) {
    return sec > target;
  }

  // 解答中のタイマーを表示するかの設定。真偽値だけ通し、それ以外は表示する
  function normalizeLiveTimer(v) {
    return typeof v === 'boolean' ? v : true;
  }

  return { DEFAULT_PACE, PACE_RANGE: RANGE, normalizePace, clampPace, normalizePaceTarget, paceTargetPatch, isFastAnswer, paceTier, formatElapsed, isOverTarget, normalizeLiveTimer };
});
