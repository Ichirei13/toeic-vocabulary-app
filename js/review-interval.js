// ==================== 苦手の復習・克服管理 ====================

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_INTERVALS = [1, 3];

function getWeakSettings() {
  const mode = (typeof state !== 'undefined' && state.weakReviewMode) || 'interval';
  const days = (typeof state !== 'undefined' && Number.isInteger(state.weakIntervalDays) && state.weakIntervalDays > 0)
    ? state.weakIntervalDays : 1;
  const graduateStreak = (typeof state !== 'undefined' && Number.isInteger(state.weakGraduateStreak) && state.weakGraduateStreak > 0)
    ? state.weakGraduateStreak : 2;
  return { mode, days, graduateStreak };
}

// 苦手1件の形を確かめる。前のバージョンの記録（復習日なし）は「今すぐ復習」からやり直し、直せないものは null
function normalizeWeakEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const { graduateStreak } = getWeakSettings();
  const added = Number.isFinite(e.added) && e.added > 0 ? e.added : Date.now();
  const u = Number.isFinite(e.u) && e.u > 0 ? { u: e.u } : {}; // 最終更新時刻。同期で新しい方を選ぶのに使う（古い記録には無い）
  if (e.due === undefined) return { streak: 0, added, due: 0, ...u };
  if (typeof e.due !== 'number' || !Number.isFinite(e.due) || e.due < 0) return null;
  if (!Number.isInteger(e.streak) || e.streak < 0 || e.streak > graduateStreak) return null;
  return { streak: e.streak, added, due: e.due, ...u };
}

// 苦手データのキー: 単語は綴り、文法は問題番号
function isWordKey(k) {
  return k !== '' && k.length <= 200 && k !== '__proto__';
}

function isGrammarKey(k) {
  return /^[1-9]\d{0,8}$/.test(k);
}

// 苦手データ全体を確かめ、形の正しくない件は除いて数を返す（起動時の読み込みとバックアップの復元で共通）
function sanitizeWeakData(raw, isValidKey) {
  const data = {};
  let invalid = 0;
  Object.keys(raw).forEach(k => {
    const entry = isValidKey(k) ? normalizeWeakEntry(raw[k]) : null;
    if (entry) data[k] = entry;
    else invalid++;
  });
  return { data, invalid };
}

function loadWeakData(key, isValidKey) {
  return sanitizeWeakData(loadJSON(key, {}), isValidKey).data;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isDue(entry) {
  if (!entry) return false;
  const { mode } = getWeakSettings();
  if (mode === 'immediate') return true;
  return entry.due <= Date.now();
}

// 回答結果を苦手データに反映する（単語・文法共通）。間違えたら今すぐ復習対象に戻す。
// 記録を変えたときは u（最終更新時刻）を付け、苦手から外したときは tombKey で削除を覚える（同期で復活させないため）
function updateWeakEntry(store, key, isCorrect, tombKey) {
  const entry = store[key];
  const { mode, days, graduateStreak } = getWeakSettings();
  if (!isCorrect) {
    store[key] = { streak: 0, added: entry ? entry.added : Date.now(), due: Date.now(), u: Date.now() };
    return;
  }
  // 苦手でない問題や、復習日より前の正解では記録を進めない
  if (!entry || (mode === 'interval' && !isDue(entry))) return;

  entry.streak++;
  if (entry.streak >= graduateStreak) {
    delete store[key];
    markWeakDeleted(tombKey);
  } else {
    if (mode === 'interval') {
      entry.due = startOfToday() + days * DAY_MS;
    } else {
      entry.due = Date.now();
    }
    entry.u = Date.now();
  }
}

// 苦手リストに出す「次の復習」の表示（アイデア3: ドットゲージ ＋ 状態カラー ＋ 次回予定 ＋ 残り回数）
function dueLabel(entry) {
  const { mode, graduateStreak } = getWeakSettings();
  const streak = entry ? entry.streak : 0;
  const remaining = Math.max(0, graduateStreak - streak);
  const due = isDue(entry);

  let dots = '';
  for (let i = 0; i < graduateStreak; i++) {
    dots += `<span class="weak-dot${i < streak ? ' filled' : ''}"></span>`;
  }
  const dotsHtml = `<span class="weak-dots">${dots}</span>`;

  if (mode === 'immediate') {
    if (streak <= 0) {
      return `<div class="weak-due now">
        ${dotsHtml}
        <span>要復習（あと${remaining}回正解で脱却）</span>
      </div>`;
    }
    return `<div class="weak-due streak-ready">
      ${dotsHtml}
      <span>あと${remaining}回正解で脱却！</span>
    </div>`;
  }

  // 間隔復習モード (mode === 'interval')
  if (streak <= 0) {
    return `<div class="weak-due now">
      ${dotsHtml}
      <span>要復習（あと${remaining}回）</span>
    </div>`;
  }

  if (due) {
    return `<div class="weak-due now">
      ${dotsHtml}
      <span>要復習（${remaining === 1 ? 'あと1回で克服！' : `あと${remaining}回`}）</span>
    </div>`;
  }

  const days = Math.round((entry.due - startOfToday()) / DAY_MS);
  const d = new Date(entry.due);
  const dayText = days === 1 ? '明日' : `${days}日後`;
  return `<div class="weak-due waiting">
    ${dotsHtml}
    <span>次の復習 ${d.getMonth()+1}/${d.getDate()}（${dayText}・${remaining === 1 ? '次で克服！' : `あと${remaining}回`}）</span>
  </div>`;
}

