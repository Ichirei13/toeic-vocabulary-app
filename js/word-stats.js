// ==================== 単語の記録（モードごと） ====================
// 苦手と学習済みの単語は、英→日・日→英・カード・タイプのモードごとに別々に記録する

const VOCAB_MODES = ['e2j', 'j2e', 'flash', 'type'];
const MODE_LABELS = { e2j: '英→日', j2e: '日→英', flash: 'カード', type: 'タイプ' };
const WEAK_WORDS_KEY = 'toeic_weak_words_by_mode';
const SEEN_WORDS_KEY = 'toeic_seen_words_by_mode';
// モード共通だったころの記録。初めて開いたときに移し替え、元の記録は消さずに残す
const LEGACY_WEAK_WORDS_KEY = 'toeic_weak_words';
const LEGACY_SEEN_WORDS_KEY = 'toeic_seen_words';

// 問題ごとの正誤カウント { [key]: { a: 解答数, c: 正解数 } }
const WORD_STATS_KEY = 'toeic_word_stats';
const GRAMMAR_STATS_KEY = 'toeic_grammar_stats';

// 文法で出題済み（回答した）問題番号の配列
const GRAMMAR_SEEN_KEY = 'toeic_seen_grammar';

function isGrammarId(v) {
  return Number.isInteger(v) && v > 0 && v <= 999999999; // isGrammarKey と同じ 9 桁まで
}

// 渡したオブジェクト（成績・苦手など）のキーから、問題番号として読めるものを重複なしで集める
function grammarIdsFrom(...maps) {
  const ids = new Set();
  maps.forEach(m => {
    if (!isPlainObject(m)) return;
    Object.keys(m).forEach(k => {
      if (isGrammarKey(k)) ids.add(Number(k));
    });
  });
  return [...ids];
}

// 保存が無いとき（初回）だけ、通算正誤カウントと苦手リストにある問題を出題済みとして引き継ぐ。
// 保存が壊れているときは空で始め、上書きはしない
function loadGrammarSeen() {
  let saved; // 配列ならその中身、null なら保存なし、undefined なら読めない・壊れている（loadJSON は fallback が null だと配列を捨てるので使わない）
  try {
    saved = JSON.parse(localStorage.getItem(GRAMMAR_SEEN_KEY));
  } catch (e) {
    saved = undefined;
  }
  if (Array.isArray(saved)) return new Set(saved.filter(isGrammarId));
  if (saved !== null) return new Set();
  const seeded = new Set(grammarIdsFrom(state.grammarStats, state.grammarWeakData));
  saveJSON(GRAMMAR_SEEN_KEY, [...seeded]);
  return seeded;
}

function saveGrammarSeen() {
  saveJSON(GRAMMAR_SEEN_KEY, [...state.grammarSeen]);
}

// 苦手から外した（克服した・削除した）時刻の記録。同期で別の端末の古い苦手記録が戻ってくるのを防ぐ。
// キーは単語が "w:モード:綴り"、文法が "g:問題番号"
const WEAK_DELETED_KEY = 'toeic_weak_deleted';

function isWeakDeletedKey(k) {
  const m = /^w:([^:]+):(.+)$/.exec(k);
  if (m) return VOCAB_MODES.includes(m[1]) && isWordKey(m[2]);
  return /^g:[1-9]\d{0,8}$/.test(k);
}

// 形の正しい件だけを残し、未来の時刻は今に直す（別の端末の時計がずれていても、削除が永久に勝ち続けないように）
function sanitizeWeakDeleted(raw) {
  const data = {};
  let invalid = 0;
  if (!isPlainObject(raw)) return { data, invalid: 0 };
  Object.keys(raw).forEach(k => {
    const t = raw[k];
    if (isWeakDeletedKey(k) && typeof t === 'number' && Number.isFinite(t) && t > 0) data[k] = Math.min(t, Date.now());
    else invalid++;
  });
  return { data, invalid };
}

function loadWeakDeleted() {
  return sanitizeWeakDeleted(loadJSON(WEAK_DELETED_KEY, {})).data;
}

function markWeakDeleted(tombKey) {
  if (!tombKey) return;
  state.weakDeleted[tombKey] = Date.now();
  saveJSON(WEAK_DELETED_KEY, state.weakDeleted);
}

function loadStatsData(key) {
  const data = loadJSON(key, {});
  Object.keys(data).forEach(k => {
    const e = data[k];
    if (!e || typeof e !== 'object' || !Number.isFinite(e.a) || e.a <= 0) {
      delete data[k];
    } else {
      const a = Math.max(1, Math.floor(e.a));
      const c = Math.min(a, Math.max(0, Math.floor(Number(e.c) || 0)));
      data[k] = { a, c };
    }
  });
  return data;
}

function recordItemStat(store, storageKey, itemKey, isCorrect) {
  const k = String(itemKey);
  const cur = store[k] || { a: 0, c: 0 };
  store[k] = { a: cur.a + 1, c: cur.c + (isCorrect ? 1 : 0) };
  saveJSON(storageKey, store);
}

function statLabelText(stat) {
  if (!stat || !stat.a) return '';
  return `過去 ${stat.c}/${stat.a} 正解`;
}

// 単語の成績はモードごとに `モード:単語` のキーで数える。モード分けする前の記録は単語だけのキーで残っていて、
// そのモードでまだ解いていないときは、その合算値を「全モード合算」として見せる
function wordStatKey(word, mode = state.mode) {
  return `${mode}:${word}`;
}

function wordStatLabel(word, mode = state.mode) {
  const own = statLabelText(state.wordStats[wordStatKey(word, mode)]);
  if (own) return own;
  const legacy = statLabelText(state.wordStats[word]);
  return legacy ? `${legacy}・全モード合算` : '';
}

function summarizeStats(statsObj) {
  let totalA = 0;
  let totalC = 0;
  let items = 0;
  if (statsObj && typeof statsObj === 'object') {
    Object.values(statsObj).forEach(st => {
      if (st && st.a > 0) {
        totalA += st.a;
        totalC += st.c;
        items++;
      }
    });
  }
  return { totalA, totalC, items, rate: totalA > 0 ? Math.round((totalC / totalA) * 100) : 0 };
}

// どのモードで間違えたか分からない記録は、4モード全部に（復習日と段階もそのまま）写す
function copyToAllModes(value) {
  return Object.fromEntries(VOCAB_MODES.map(m => [m, JSON.parse(JSON.stringify(value))]));
}

// { e2j: {綴り: 苦手1件}, … } を確かめる。知らないモード名や形の正しくない件は除いて数を返す
function sanitizeWeakByMode(raw) {
  const data = {};
  let invalid = Object.keys(raw).filter(k => !VOCAB_MODES.includes(k)).length;
  VOCAB_MODES.forEach(m => {
    if (raw[m] === undefined) {
      data[m] = {};
    } else if (isPlainObject(raw[m])) {
      const r = sanitizeWeakData(raw[m], isWordKey);
      data[m] = r.data;
      invalid += r.invalid;
    } else {
      data[m] = {};
      invalid++;
    }
  });
  return { data, invalid };
}

// { e2j: [綴り, …], … } を確かめる。文字列以外は除き、重複はまとめる
function sanitizeSeenByMode(raw) {
  const data = {};
  let invalid = Object.keys(raw).filter(k => !VOCAB_MODES.includes(k)).length;
  VOCAB_MODES.forEach(m => {
    const list = raw[m] === undefined ? [] : raw[m];
    if (!Array.isArray(list)) {
      data[m] = [];
      invalid++;
      return;
    }
    const valid = list.filter(w => typeof w === 'string' && isWordKey(w));
    invalid += list.length - valid.length;
    data[m] = [...new Set(valid)];
  });
  return { data, invalid };
}

function loadWeakByMode() {
  const saved = loadJSON(WEAK_WORDS_KEY, null);
  if (saved !== null) return sanitizeWeakByMode(saved).data;
  const byMode = copyToAllModes(loadWeakData(LEGACY_WEAK_WORDS_KEY, isWordKey));
  saveJSON(WEAK_WORDS_KEY, byMode);
  return byMode;
}

function loadSeenByMode() {
  const saved = loadJSON(SEEN_WORDS_KEY, null);
  const lists = saved !== null
    ? sanitizeSeenByMode(saved).data
    : copyToAllModes(loadJSON(LEGACY_SEEN_WORDS_KEY, []).filter(w => typeof w === 'string'));
  if (saved === null) saveJSON(SEEN_WORDS_KEY, lists);
  return Object.fromEntries(VOCAB_MODES.map(m => [m, new Set(lists[m])]));
}

let state = {
  app: 'vocab', // 'vocab' or 'grammar'

  // Vocab state
  mode: 'e2j',
  sourceFilter: 'all',
  rangeFilter: [], // 選んだ TEPPAN の番号範囲 [{start, end}]。空なら全番号
  dateFilter: [],
  posFilter: [], // 選んだ品詞。空なら全品詞
  weakFilter: 'weak_unlearned',
  pool: [],
  currentIndex: 0,
  score: 0,
  answeredCount: 0,
  weakByMode: loadWeakByMode(), // { e2j: {綴り: 苦手1件}, … }
  seenByMode: loadSeenByMode(), // { e2j: Set(綴り), … }
  wordStats: loadStatsData(WORD_STATS_KEY),
  currentOptions: [],
  answered: false,
  wordLog: {}, // 今回答えた単語問題の結果（出題順の番号 → 見直し用の記録）

  // Grammar state
  grammarBook: 'all',
  grammarChapter: [], // 選んだ章 ['kin:2', 'sekai:3']（本:章）。空なら全章
  grammarWeakFilter: 'all',
  grammarRule: null, // 金のルール番号で絞り込み中なら数値
  guideChapter: 'all',
  grammarPool: [],
  currentGrammarIndex: 0,
  grammarScore: 0,
  grammarAnsweredCount: 0,
  grammarWeakData: loadWeakData('toeic_weak_grammar', isGrammarKey),
  grammarStats: loadStatsData(GRAMMAR_STATS_KEY),
  grammarAnswered: false,
  grammarLog: {}, // 今回答えた文法問題の結果（出題順の番号 → 見直し用の記録）

  reviewIndex: null, // 「前へ」で見直し中の問題の番号。null なら今の問題を出している

  weakSort: 'new', // 苦手リストの並び順
  weakListMode: 'e2j' // 単語の苦手リストで表示しているモード
};
// 初期値の作成に grammarStats と grammarWeakData を使うので、state ができたあとで読み込む
state.grammarSeen = loadGrammarSeen();
state.weakDeleted = loadWeakDeleted();

// 今のモード（または指定したモード）の単語の苦手・学習済み
function wordWeak(mode = state.mode) {
  return state.weakByMode[mode];
}

function wordSeen(mode = state.mode) {
  return state.seenByMode[mode];
}

// "2026-06-22" を現地時間の日付として読む（new Date("2026-06-22") は UTC 扱いで、日本より西の地域では前日になる）
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getWeekLabel(dateStr) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // その週の月曜
  return `${d.getMonth()+1}/${d.getDate()}〜`;
}

// ラベルのまま並べると "7/13〜" が "7/6〜" より前に来るので、元の日付順に並べてからラベルにする
const DATES = [...new Set(RAW_WORDS.filter(x => x.d).map(x => x.d).sort().map(getWeekLabel))];

function saveWeakData() {
  saveJSON(WEAK_WORDS_KEY, state.weakByMode);
  updateWeakBadge();
}

function seenSnapshot() {
  return Object.fromEntries(VOCAB_MODES.map(m => [m, [...state.seenByMode[m]]]));
}

function setBadge(id, count) {
  const badge = document.getElementById(id);
  if (!badge) return;
  badge.style.display = count > 0 ? 'inline-block' : 'none';
  badge.innerText = count;
}

function updateWeakBadge() {
  // 「苦手のみ」「要復習」を押したときに出る問題数（今のモードの記録で、出典・日付・品詞・範囲の絞り込みを反映）
  const data = wordWeak();
  const weak = dedupeWords(RAW_WORDS.filter(w => data[w.w] !== undefined && wordMatchesBaseFilters(w)));
  setBadge('weak-badge', weak.length);
  setBadge('due-badge', weak.filter(w => isDue(data[w.w])).length);
}

// TEPPAN の番号を100語ずつに区切った範囲
const TEPPAN_MAX_NO = RAW_WORDS.reduce((max, w) => (w.s === 'teppan' && w.no ? Math.max(max, w.no) : max), 0);
const TEPPAN_RANGES = [];
for (let start = 1; start <= TEPPAN_MAX_NO; start += 100) {
  TEPPAN_RANGES.push({ start, end: Math.min(start + 99, TEPPAN_MAX_NO) });
}

function initRangeFilters() {
  const rf = document.getElementById('range-filters');
  if (!rf) return;
  let html = `<button class="chip active" data-range="all">全番号 (1〜${TEPPAN_MAX_NO})</button>`;
  TEPPAN_RANGES.forEach(({ start, end }) => {
    html += `<button class="chip" data-range="${start}-${end}">${start}〜${end}</button>`;
  });
  rf.innerHTML = html;

  rf.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', e => {
      const val = e.currentTarget.dataset.range;
      if (val === 'all') {
        state.rangeFilter = [];
      } else {
        const [start, end] = val.split('-').map(Number);
        const picked = state.rangeFilter.some(r => r.start === start);
        state.rangeFilter = picked
          ? state.rangeFilter.filter(r => r.start !== start)
          : [...state.rangeFilter, { start, end }].sort((a, b) => a.start - b.start);
      }
      syncFilterUI();
      applyFilters();
    });
  });
}


