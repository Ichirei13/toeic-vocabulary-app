// ==================== 絞り込みの促し ====================
// 出題数が多いまま解き始めたときに、範囲を絞るよう促すモーダルを出す。同じ絞り込み条件では一度閉じたら出さない。

function getCurrentPoolCount() {
  return state.app === 'grammar'
    ? (state.grammarPool ? state.grammarPool.length : 0)
    : (state.pool ? state.pool.length : 0);
}

const NUDGE_DISMISSED_KEY = 'toeic_nudge_dismissed_condition';
// この問題数以上のときに絞り込みを促す
const NUDGE_MIN_POOL = 300;

function getFilterStateKey() {
  if (state.app === 'grammar') {
    return `g_${state.grammarBook}_${state.grammarChapter.join(',') || 'all'}_${state.grammarRule || 'none'}_${state.grammarWeakFilter}`;
  }
  const dates = (state.dateFilter || []).slice().sort().join(',');
  const range = state.rangeFilter.map(r => `${r.start}-${r.end}`).join(',') || 'none';
  return `v_${state.sourceFilter}_${dates}_${state.posFilter.join(',') || 'all'}_${range}_${state.weakFilter}`;
}

function checkFilterNudge() {
  const modal = document.getElementById('filter-nudge-modal');
  const toggleBtn = document.getElementById('filter-toggle');
  if (!modal) return;
  if (typeof currentAppPage !== 'undefined' && currentAppPage !== 'practice') {
    modal.classList.remove('open');
    return;
  }

  const poolCount = getCurrentPoolCount();

  // 促す問題数に満たなければ非表示＆消灯
  if (poolCount < NUDGE_MIN_POOL) {
    modal.classList.remove('open');
    if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
    return;
  }

  // 「このまま解く」を押した条件と同じなら、条件を変えるまで一切出さない（localStorage記憶）
  const currentKey = getFilterStateKey();
  let dismissedCondition = null;
  try {
    dismissedCondition = localStorage.getItem(NUDGE_DISMISSED_KEY);
  } catch (e) {}

  if (dismissedCondition === currentKey) {
    modal.classList.remove('open');
    if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
    return;
  }

  // まだ閉じていない、促す問題数以上の条件なら、絞り込みボタンを発光
  if (toggleBtn) toggleBtn.classList.add('pulse-glow');

  // 1問目を解いた直後にモーダルで案内
  const answered = state.app === 'grammar' ? (state.grammarAnsweredCount || 0) : (state.answeredCount || 0);
  if (answered >= 1) {
    const bodyEl = modal.querySelector('.nudge-card-body');
    if (bodyEl) {
      bodyEl.innerHTML = `現在の出題数は <b>${poolCount}問</b> あります。<br><br>一度にすべて解き続けるより、<br><b>100問ほどに絞って繰り返し周回する</b>のが<br>定着への一番のおすすめです！<br><br>「日々の単語」や「苦手＋未出題」などに<br>絞り込んでみませんか？`;
    }
    modal.classList.add('open');
  }
}

function dismissNudge() {
  const modal = document.getElementById('filter-nudge-modal');
  const toggleBtn = document.getElementById('filter-toggle');
  if (modal) modal.classList.remove('open');
  if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
  try {
    localStorage.setItem(NUDGE_DISMISSED_KEY, getFilterStateKey());
  } catch (e) {}
}

function openFilterSheetFromNudge() {
  const modal = document.getElementById('filter-nudge-modal');
  const toggleBtn = document.getElementById('filter-toggle');
  if (modal) modal.classList.remove('open');
  if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
  openFilterSheet();
}
