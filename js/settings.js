// ==================== 設定・進み具合の保存 ====================
// 絞り込みやモードと、出題中の問題の並び・何問目か・正答数を保存し、開き直しても続きから始める

const SETTINGS_KEY = 'toeic_settings';
const SESSION_KEY = 'toeic_session';
const WORD_INDEX = new Map(RAW_WORDS.map((w, i) => [w, i]));
const GRAMMAR_BY_ID = new Map(RAW_GRAMMAR.map(g => [g.id, g]));

function settingsSnapshot() {
  const keys = ['app', 'mode', 'sourceFilter', 'rangeFilter', 'dateFilter', 'posFilter', 'weakFilter',
                'grammarBook', 'grammarChapter', 'grammarWeakFilter', 'grammarRule', 'weakSort'];
  return Object.fromEntries(keys.map(k => [k, state[k]]));
}

function saveSettings() {
  saveJSON(SETTINGS_KEY, settingsSnapshot());
}

// 保存された値のうち、今のデータで有効なものだけを state に戻す
function restoreSettings() {
  const saved = loadJSON(SETTINGS_KEY, {});
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  state.app = pick(saved.app, ['vocab', 'grammar'], 'vocab');
  state.mode = pick(saved.mode, ['e2j', 'j2e', 'flash', 'type'], 'e2j');
  state.sourceFilter = pick(saved.sourceFilter, ['all', 'daily', 'teppan'], 'all');
  // 範囲・品詞・章は複数選択。前のバージョンは1つだけ（範囲は {start,end}、品詞は文字列、章は番号）で保存していたので、それも読める
  const savedRanges = Array.isArray(saved.rangeFilter) ? saved.rangeFilter : (saved.rangeFilter ? [saved.rangeFilter] : []);
  state.rangeFilter = TEPPAN_RANGES
    .filter(r => savedRanges.some(x => x && x.start === r.start && x.end === r.end))
    .map(r => ({ start: r.start, end: r.end }));
  state.dateFilter = Array.isArray(saved.dateFilter) ? saved.dateFilter.filter(d => DATES.includes(d)) : [];
  const savedPos = Array.isArray(saved.posFilter) ? saved.posFilter : [saved.posFilter];
  state.posFilter = POS_FILTERS.filter(p => savedPos.includes(p));
  state.weakFilter = pick(saved.weakFilter, ['all', 'weak_unlearned', 'weak_only', 'due'], 'weak_unlearned');

  // 既存ユーザー向けマイグレーション: 過去バージョンで 'all' のままだったユーザーも初回一度だけ 'weak_unlearned' に引き上げる
  const DEFAULT_UNLEARNED_KEY = 'toeic_default_unlearned_migrated_v2';
  try {
    if (!localStorage.getItem(DEFAULT_UNLEARNED_KEY)) {
      if (state.weakFilter === 'all') {
        state.weakFilter = 'weak_unlearned';
      }
      localStorage.setItem(DEFAULT_UNLEARNED_KEY, 'true');
      saveSettings();
    }
  } catch(e) {}
  state.grammarBook = pick(saved.grammarBook, ['all', 'kin', 'sekai', 'polaris2', 'toplevel'], 'all');
  // 章は「本:章」の配列。前のバージョンは番号1つだけだったので、本が決まっているときはその本の章として読む
  const savedChapters = Array.isArray(saved.grammarChapter) ? saved.grammarChapter
    : (Number.isInteger(saved.grammarChapter) && state.grammarBook !== 'all' ? [`${state.grammarBook}:${saved.grammarChapter}`] : []);
  state.grammarChapter = getGrammarChaptersList().map(c => c.key).filter(k => k !== 'all' && savedChapters.includes(k));
  state.grammarRule = KIN_RULES.some(r => r.number === saved.grammarRule) ? saved.grammarRule : null;
  state.grammarWeakFilter = pick(saved.grammarWeakFilter, ['all', 'weak_unlearned', 'weak_only', 'due'], 'all');
  state.weakSort = pick(saved.weakSort, ['new', 'old', 'due', 'order'], 'new');
}

// 今の絞り込みを表す値。保存した出題順はこれが一致するときだけ使う（データが増減したときも作り直す）
function sessionSignature(app) {
  return JSON.stringify(app === 'grammar'
    ? [RAW_GRAMMAR.length, state.grammarBook, state.grammarChapter, state.grammarRule, state.grammarWeakFilter]
    : [RAW_WORDS.length, state.sourceFilter, state.rangeFilter, state.dateFilter, state.posFilter, state.weakFilter,
       ...(state.weakFilter !== 'all' ? [state.mode] : [])]); // 苦手で絞るときは出題範囲がモードで変わる
}

function sessionSnapshot() {
  const sessions = loadJSON(SESSION_KEY, {});
  // 回答済みの問題は開き直したときに出し直さないよう、次の問題から再開する
  if (state.app === 'grammar') {
    sessions.grammar = {
      sig: sessionSignature('grammar'),
      pool: state.grammarPool.map(g => g.id),
      index: Math.min(state.currentGrammarIndex + (state.grammarAnswered ? 1 : 0), state.grammarPool.length),
      score: state.grammarScore,
      answered: state.grammarAnsweredCount,
    };
  } else {
    sessions.vocab = {
      sig: sessionSignature('vocab'),
      pool: state.pool.map(w => WORD_INDEX.get(w)),
      index: Math.min(state.currentIndex + (state.answered ? 1 : 0), state.pool.length),
      score: state.score,
      answered: state.answeredCount,
    };
  }
  return sessions;
}

function saveSession() {
  saveJSON(SESSION_KEY, sessionSnapshot());
}

// 保存した続きを戻せたら true。絞り込みが変わっていたり、最後まで解き終えていたら false（新しく出題し直す）
function restoreSession(app) {
  const saved = loadJSON(SESSION_KEY, {})[app];
  if (!saved || saved.sig !== sessionSignature(app) || !Array.isArray(saved.pool)) return false;
  const pool = saved.pool.map(k => (app === 'grammar' ? GRAMMAR_BY_ID.get(k) : RAW_WORDS[k]));
  const index = Number.isInteger(saved.index) ? saved.index : 0;
  if (pool.length === 0 || pool.some(x => !x) || index < 0 || index >= pool.length) return false;
  const score = Number.isInteger(saved.score) ? saved.score : 0;
  const answered = Number.isInteger(saved.answered) ? saved.answered : 0;
  resetReview();
  if (app === 'grammar') {
    Object.assign(state, { grammarPool: pool, currentGrammarIndex: index, grammarScore: score, grammarAnsweredCount: answered });
  } else {
    Object.assign(state, { pool, currentIndex: index, score, answeredCount: answered });
  }
  return true;
}

let activeSheetRender = null; // 今シートに出している画面の描画関数

function isSheetOpen() {
  return document.getElementById('bottom-sheet').classList.contains('open');
}

let backupSource = 'settings';

function closeSheet() {
  const sheet = document.getElementById('bottom-sheet');
  sheet.classList.remove('open');
  sheet.classList.remove('sheet-fixed-dark');
  document.getElementById('sheet-overlay').classList.remove('open');
}

function openFilterSheet() {
  closeSheet();
  refreshFilterApplyLabel();
  const drawer = document.getElementById('filter-drawer');
  const toggle = document.getElementById('filter-toggle');
  if (drawer) drawer.classList.add('open');
  if (toggle) {
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
  }
  document.getElementById('sheet-overlay').classList.add('open');
}

function closeFilterSheet() {
  const drawer = document.getElementById('filter-drawer');
  const toggle = document.getElementById('filter-toggle');
  if (drawer) drawer.classList.remove('open');
  if (toggle) {
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
  }
  const bottomSheet = document.getElementById('bottom-sheet');
  if (!bottomSheet || !bottomSheet.classList.contains('open')) {
    document.getElementById('sheet-overlay').classList.remove('open');
  }
}

function toggleFilterSheet() {
  const drawer = document.getElementById('filter-drawer');
  if (drawer && drawer.classList.contains('open')) {
    closeFilterSheet();
  } else {
    openFilterSheet();
  }
}

function handleOverlayClick() {
  closeSheet();
  closeFilterSheet();
}

function openSheet(title, render, isFixedTheme = false) {
  closeFilterSheet();
  document.getElementById('sheet-title').innerText = title;
  activeSheetRender = render;
  const sheet = document.getElementById('bottom-sheet');
  if (isFixedTheme) {
    sheet.classList.add('sheet-fixed-dark');
  } else {
    sheet.classList.remove('sheet-fixed-dark');
  }
  render();
  sheet.scrollTop = 0;
  sheet.classList.add('open');
  document.getElementById('sheet-overlay').classList.add('open');
}

function toggleWeakList() {
  if (document.getElementById('bottom-sheet').classList.contains('open')) return closeSheet();
  state.weakListMode = state.mode; // 単語の苦手リストは、まず今のモードの記録を見せる
  openSheet('苦手リスト', renderWeakList, false);
}

function toggleRuleGuide() {
  if (isSheetOpen() && activeSheetRender === renderRuleGuide) return closeSheet();
  openSheet('金の文法 章ガイド', renderRuleGuide, false);
}

function getWeakWordCount() {
  if (!state.weakByMode) return 0;
  const set = new Set();
  Object.values(state.weakByMode).forEach(dict => {
    if (dict && typeof dict === 'object') {
      Object.keys(dict).forEach(k => set.add(k));
    }
  });
  return set.size;
}

function getWeakGrammarCount() {
  if (!state.grammarWeakData) return 0;
  return Object.keys(state.grammarWeakData).length;
}

function handleSettingThemeChange(theme) {
  setAppTheme(theme);
}

function openBackupFromSettings() {
  backupSource = 'settings';
  backupView = { step: 'home', restoreMode: 'merge' };
  openSheet('学習記録のバックアップ', renderBackupSheet, true);
}

