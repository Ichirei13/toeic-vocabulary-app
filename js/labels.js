// ==================== ラベリング機能（保存と state） ====================
// ラベルの記録（src/labels.js の形）を state.labels に持ち、toeic_labels_v1 に保存する。苦手リストとは別の記録。
// 前提: src/labels.js（StudyCore）と js/word-stats.js（state）のあとに読み込む。画面は js/labels-ui.js
const LABELS_KEY = 'toeic_labels_v1';

// まだ保存していなければ「あとで見る」だけの記録で始める。壊れた値は形の正しい分だけ残す
function loadLabels() {
  const raw = loadJSON(LABELS_KEY, null);
  return raw === null ? StudyCore.emptyLabelStore() : StudyCore.sanitizeLabelStore(raw).data;
}

function saveLabels() {
  saveJSON(LABELS_KEY, state.labels);
}

// ラベル ID（2台で同時に作っても重ならない長さ）
function newLabelId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return 'l_' + Array.from(bytes, b => chars[b % chars.length]).join('');
}

// 問題・単語のラベル用のキー。単語はモードに関係なく1つ
function labelItemKey(kind, item) {
  return kind === 'grammar' ? `g:${item.id}` : `w:${item.w}`;
}

// 削除されたラベルを指している設定を外す。外したものがあれば true
function dropStaleLabelSettings() {
  const ids = new Set(StudyCore.activeLabels(state.labels).map(l => l.id));
  let changed = false;
  ['lastLabelId', 'grammarLabel', 'vocabLabel'].forEach(k => {
    if (state[k] !== null && !ids.has(state[k])) {
      state[k] = null;
      changed = true;
    }
  });
  return changed;
}

// ラベルの変更はすべてここを通す（保存と、無くなったラベルを指す設定の後始末）
function applyLabelChange(nextStore) {
  state.labels = nextStore;
  saveLabels();
  if (dropStaleLabelSettings()) {
    saveSettings();
    if (typeof onLabelFilterDropped === 'function') onLabelFilterDropped();
  }
}

state.labels = loadLabels();
