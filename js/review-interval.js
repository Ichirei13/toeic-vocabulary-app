// ==================== 苦手の間隔復習 ====================

const DAY_MS = 24 * 60 * 60 * 1000;
// 復習の間隔（日）。復習日以降に正解するたびに次の間隔へ進み、最後の間隔のあとも正解したら苦手から外れる
const REVIEW_INTERVALS = [1, 3, 7];

// 苦手1件の形を確かめる。前のバージョンの記録（復習日なし）は「今すぐ復習」からやり直し、直せないものは null
function normalizeWeakEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const added = Number.isFinite(e.added) && e.added > 0 ? e.added : Date.now();
  const u = Number.isFinite(e.u) && e.u > 0 ? { u: e.u } : {}; // 最終更新時刻。同期で新しい方を選ぶのに使う（古い記録には無い）
  if (e.due === undefined) return { streak: 0, added, due: 0, ...u };
  if (typeof e.due !== 'number' || !Number.isFinite(e.due) || e.due < 0) return null;
  if (!Number.isInteger(e.streak) || e.streak < 0 || e.streak > REVIEW_INTERVALS.length) return null;
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
  return entry.due <= Date.now();
}

// 回答結果を苦手データに反映する（単語・文法共通）。間違えたら今すぐ復習対象に戻す。
// 記録を変えたときは u（最終更新時刻）を付け、苦手から外したときは tombKey で削除を覚える（同期で復活させないため）
function updateWeakEntry(store, key, isCorrect, tombKey) {
  const entry = store[key];
  if (!isCorrect) {
    store[key] = { streak: 0, added: entry ? entry.added : Date.now(), due: Date.now(), u: Date.now() };
    return;
  }
  // 苦手でない問題や、復習日より前の正解では記録を進めない
  if (!entry || !isDue(entry)) return;
  if (entry.streak >= REVIEW_INTERVALS.length) {
    delete store[key];
    markWeakDeleted(tombKey);
  } else {
    entry.streak++;
    entry.due = startOfToday() + REVIEW_INTERVALS[entry.streak - 1] * DAY_MS;
    entry.u = Date.now();
  }
}

// 苦手リストに出す「次の復習」の表示
function dueLabel(entry) {
  if (isDue(entry)) return '<div class="weak-due now">要復習</div>';
  const days = Math.round((entry.due - startOfToday()) / DAY_MS);
  const d = new Date(entry.due);
  return `<div class="weak-due">次の復習 ${d.getMonth()+1}/${d.getDate()}（${days === 1 ? '明日' : `${days}日後`}）</div>`;
}

