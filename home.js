// ==================== 3ページ構成（ホーム・演習・設定） & ホーム画面制御 ====================

// src/*.js のどれかが読み込めなかったときでも、ホームと演習が止まらないようにする。
// 足りない関数だけ、目標・カレンダー・復習の集計なしの代わりで補う。
// 日別記録の検証と統合は代わりを作らず、呼ばれたら例外にする（空で上書きして記録を失わないため）
const STUDY_CORE_FALLBACK = {
  GOALS: [0, 5, 10, 20, 30],
  MAX_GOAL: 200,
  isGoal: v => Number.isInteger(v) && v >= 0 && v <= 200,
  normalizeGoal: v => (Number.isInteger(v) && v >= 0 && v <= 200 ? v : 10),
  clampGoal: () => null,
  goalChoices: () => [0, 5, 10, 20, 30],
  DEFAULT_PACE: { vocab: 5, grammar: 20 },
  PACE_RANGE: { vocab: { min: 1, max: 30, step: 0.5 }, grammar: { min: 5, max: 120, step: 1 } },
  normalizePace: kind => (kind === 'grammar' ? 20 : 5),
  clampPace: () => null,
  normalizePaceTarget: () => ({ vocab: 5, grammar: 20 }),
  paceTargetPatch: () => null,
  isFastAnswer: (sec, isCorrect, target) => Boolean(isCorrect) && sec <= target,
  paceTier: (kind, sec, isCorrect) => {
    if (!isCorrect) return 'none';
    const [top, ok] = kind === 'grammar' ? [10, 20] : [3.5, 6];
    return sec <= top ? 'top' : sec <= ok ? 'ok' : 'none';
  },
  goalProgress: () => ({ answered: 0, goal: 10, hasGoal: false, reached: false, ratio: 0 }),
  monthModel: (days, ym) => ({ ym, label: ym, leading: 0, cells: [], canNext: false }),
  shiftMonth: ym => ym,
  studiedDays: () => 0,
  sanitizeActivity: () => { throw new Error('src/activity.js を読み込めていません'); },
  mergeActivity: () => { throw new Error('src/activity.js を読み込めていません'); },
  filterCountLabel: () => ({ label: 'この条件で解く', empty: false }),
  formatElapsed: sec => (typeof sec === 'number' && sec > 0 ? (sec >= 60 ? '60+' : sec.toFixed(1)) : '0.0'),
  isOverTarget: (sec, target) => sec > target,
  normalizeLiveTimer: v => (typeof v === 'boolean' ? v : true),
  createSessionReview: () => ({ reviewed: 0, graduated: 0 }),
  noteReviewAnswer: counter => counter,
  reviewSummaryText: () => '',
};
window.StudyCore = Object.assign({}, STUDY_CORE_FALLBACK, window.StudyCore || {});

const HOME_PRESETS_KEY = 'toeic_home_presets_v1';
const BOOK_SESSIONS_KEY = 'toeic_book_sessions_v1';
const DAILY_ACTIVITY_KEY = 'toeic_daily_activity_v1';

// ==================== 日別学習ログ・連続日数（ストリーク） & 解答ペース計測 ====================

let questionShownAt = performance.now();
let paceSession = { vocab: [], grammar: [] }; // 今セッションの各問題の解答秒数
let lastAnswerPace = null; // { kind, sec, isCorrect }
let praiseRotationIndex = 0;
let lastRenderedDate = '';
let goalCalendarMonth = '';
let goalDialogTrigger = null;
// 今の演習で、苦手を復習・克服できた数。単語と文法で別に持ち、その種類の出題プールを作り直すときだけ戻す
let sessionReview = { vocab: StudyCore.createSessionReview(), grammar: StudyCore.createSessionReview() };

function localDateStr(ms = Date.now()) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadDailyActivity() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(DAILY_ACTIVITY_KEY));
  } catch (e) {}
  if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
    return raw;
  }
  // 初回のみ、既存の苦手データ等のタイムスタンプ（added / u）から学習日を推定してシードする
  const days = {};
  const seedTimestamp = ts => {
    if (typeof ts === 'number' && Number.isFinite(ts) && ts > 1600000000000 && ts <= Date.now() + 86400000) {
      const k = localDateStr(ts);
      if (!days[k]) days[k] = { a: 1, c: 0, fast: 0, sec: 0 };
    }
  };
  try {
    if (state.grammarWeakData) {
      Object.values(state.grammarWeakData).forEach(e => {
        if (e) { seedTimestamp(e.added); seedTimestamp(e.u); }
      });
    }
    if (state.weakByMode) {
      Object.values(state.weakByMode).forEach(dict => {
        if (dict && typeof dict === 'object') {
          Object.values(dict).forEach(e => {
            if (e) { seedTimestamp(e.added); seedTimestamp(e.u); }
          });
        }
      });
    }
  } catch (e) {}
  const initial = { days };
  try {
    localStorage.setItem(DAILY_ACTIVITY_KEY, JSON.stringify(initial));
  } catch (e) {}
  return initial;
}

let dailyActivity = loadDailyActivity();

// 表示設定（今日の目標）。壊れていても読めなくても、目標 10 問で動く
const PREFS_KEY = 'toeic_prefs_v1';
function loadPrefs() {
  const raw = loadJSON(PREFS_KEY, {});
  return {
    dailyGoal: StudyCore.normalizeGoal(raw.dailyGoal),
    paceTarget: StudyCore.normalizePaceTarget(raw.paceTarget), // 即答の目標タイム（秒）{ vocab, grammar }
    liveTimer: StudyCore.normalizeLiveTimer(raw.liveTimer), // 解いている間のカウントアップを表示するか
  };
}
let prefs = loadPrefs();
function savePrefs() {
  saveJSON(PREFS_KEY, prefs);
}
// バックアップの復元・取り消しのあとに、日別記録と表示設定を保存し直した内容で読み込み直す
function reloadHomeExtras() {
  dailyActivity = loadDailyActivity();
  prefs = loadPrefs();
  if (currentAppPage === 'home') renderHomePage();
}

// 回答のあとに呼ぶ。苦手だった問題に正解したら集計し、苦手から外れたらその日の克服数 gr も増やす
function noteSessionReview(kind, wasWeak, isWeakNow, isCorrect) {
  StudyCore.noteReviewAnswer(sessionReview[kind], { wasWeak, isWeakNow, isCorrect });
  if (wasWeak && !isWeakNow && isCorrect) {
    const entry = dailyActivity.days[localDateStr()];
    if (entry) {
      entry.gr = (entry.gr || 0) + 1;
      saveDailyActivity();
    }
  }
}

// 演習の完了画面に足す 1 行（復習できた問題が無ければ何も出さない）
function sessionReviewHtml(kind) {
  const text = StudyCore.reviewSummaryText(sessionReview[kind]);
  return text ? `<div class="review-result">${escapeHtml(text)}</div>` : '';
}

// 目標を変える。今日の分にも反映し、昨日以前の日には触れない
function setDailyGoal(goal) {
  prefs.dailyGoal = StudyCore.normalizeGoal(goal);
  savePrefs();
  const entry = dailyActivity.days[localDateStr()];
  if (entry) {
    entry.g = prefs.dailyGoal;
    saveDailyActivity();
  }
}

function saveDailyActivity() {
  try {
    localStorage.setItem(DAILY_ACTIVITY_KEY, JSON.stringify(dailyActivity));
  } catch (e) {}
}

function recordAnswerPaceAndActivity(kind, isCorrect) {
  const now = performance.now();
  const rawSec = (now - questionShownAt) / 1000;
  // 極端な放置（60秒超）は60秒でキャップ、最小0.2秒
  const sec = Math.min(60, Math.max(0.2, Number.isFinite(rawSec) ? rawSec : 5.0));

  paceSession[kind === 'grammar' ? 'grammar' : 'vocab'].push(sec);
  lastAnswerPace = { kind, sec, isCorrect };

  // 即答の判定（正解で、設定した目標タイム以内。初期値は単語 5 秒・文法 20 秒）
  const isFast = StudyCore.isFastAnswer(sec, isCorrect, prefs.paceTarget[kind === 'grammar' ? 'grammar' : 'vocab']);

  const today = localDateStr();
  if (!dailyActivity.days[today]) {
    dailyActivity.days[today] = { a: 0, c: 0, fast: 0, sec: 0 };
  }
  const entry = dailyActivity.days[today];
  entry.a = (entry.a || 0) + 1;
  if (isCorrect) entry.c = (entry.c || 0) + 1;
  if (isFast) entry.fast = (entry.fast || 0) + 1;
  entry.sec = Math.round(((entry.sec || 0) + sec) * 10) / 10;
  entry.g = prefs.dailyGoal;
  saveDailyActivity();

  // 今日の目標を初めて越えた回答の直後だけ知らせる（目標なしのときは何も出さない）
  if (prefs.dailyGoal > 0 && entry.a - 1 < prefs.dailyGoal && entry.a >= prefs.dailyGoal) {
    showToast('🎯 今日の目標を達成しました！');
  }

  renderPaceFeedback(kind, sec, isCorrect);
}

// 連続学習日数（ストリーク）と今日の統計を計算する
function getStreakSummary() {
  const days = dailyActivity?.days || {};
  const today = localDateStr();
  const todayData = days[today] || { a: 0, c: 0, fast: 0, sec: 0 };

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);

  // 今日まだ解いていない場合は、昨日から遡って連続日数を数える
  if (!days[localDateStr(cursor.getTime())]?.a) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (true) {
    const key = localDateStr(cursor.getTime());
    if (days[key] && days[key].a > 0) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  // 既存の通算解答があるのに日付記録が今日・昨日ともにない場合でも、最低1日と表示できるよう配慮
  const totalEver = summarizeStats(state.wordStats).totalA + summarizeStats(state.grammarStats).totalA;
  const activeDays = Object.keys(days).filter(k => days[k]?.a > 0).length;

  return {
    streak,
    todayAnswered: todayData.a || 0,
    todayCorrect: todayData.c || 0,
    todayFast: todayData.fast || 0,
    activeDays: Math.max(activeDays, totalEver > 0 ? 1 : 0),
    studiedToday: (todayData.a || 0) > 0,
  };
}

// 演習画面のペース表示（フッター＆問題カード内バッジ）を更新する
function getAveragePace(kind) {
  const arr = paceSession[kind === 'grammar' ? 'grammar' : 'vocab'];
  if (!arr || arr.length === 0) return null;
  const sum = arr.reduce((a, b) => a + b, 0);
  return sum / arr.length;
}

// フッターの解答時間の枠（なければ作る）。解いている間はカウントアップ、それ以外は平均ペースを出す
function ensureFooterPaceEl() {
  const statsBar = document.querySelector('#practice-page .footer .stats');
  if (!statsBar) return null;
  let paceEl = document.getElementById('pace-text');
  if (!paceEl) {
    paceEl = document.createElement('span');
    paceEl.id = 'pace-text';
    paceEl.className = 'pace-stat-pill';
    const scoreEl = document.getElementById('score-text');
    if (scoreEl && scoreEl.nextSibling) {
      statsBar.insertBefore(paceEl, scoreEl.nextSibling);
    } else {
      statsBar.appendChild(paceEl);
    }
  }
  return paceEl;
}

function updateFooterPaceDisplay() {
  const paceEl = ensureFooterPaceEl();
  if (!paceEl) return;
  // カウントアップ中はその表示を邪魔しない（止まったときに stopLiveTimer が平均ペースへ戻す）
  if (liveTimerId !== null) return;
  paceEl.classList.remove('live', 'over');
  const avg = getAveragePace(state.app);
  if (avg === null) {
    paceEl.textContent = '⏱ --s/問';
    paceEl.style.opacity = '0.65';
  } else {
    paceEl.textContent = `⏱ ${avg.toFixed(1)}s/問`;
    paceEl.style.opacity = '1';
  }
}

// カードの解答時間バッジ（なければ作る）。解いている間のカウントアップと、回答後の結果は同じバッジを使う
function ensurePaceBadge(card) {
  let el = card.querySelector('.card-pace-badge');
  if (!el) {
    el = document.createElement('span');
    el.className = 'card-pace-badge';
    const metaRow = card.querySelector('.grammar-meta') || card.querySelector('.pos-tag');
    if (metaRow && metaRow.classList.contains('grammar-meta')) {
      metaRow.appendChild(el);
    } else {
      card.insertAdjacentElement('afterbegin', el);
    }
  }
  return el;
}

// ==================== 解いている間のカウントアップ ====================
// 問題が出た瞬間（questionShownAt）から数える。記録される解答時間と同じ時計なので、画面の数字と記録はずれない
let liveTimerId = null;

// 止めて、フッターの枠を平均ペースの表示に戻す
function stopLiveTimer() {
  if (liveTimerId !== null) clearInterval(liveTimerId);
  liveTimerId = null;
  updateFooterPaceDisplay();
}

// 画面の下（フッター）に出す。出題の邪魔にならず、目に入りすぎない場所
function startLiveTimer(kind) {
  if (liveTimerId !== null) { clearInterval(liveTimerId); liveTimerId = null; }
  const el = prefs.liveTimer ? ensureFooterPaceEl() : null;
  if (!el) { updateFooterPaceDisplay(); return; }
  const target = prefs.paceTarget[kind];
  el.classList.add('live');
  el.style.opacity = '1';
  const tick = () => {
    if (!el.isConnected) { stopLiveTimer(); return; }
    const sec = (performance.now() - questionShownAt) / 1000;
    el.textContent = `⏱ ${StudyCore.formatElapsed(sec)}`;
    el.classList.toggle('over', StudyCore.isOverTarget(sec, target));
  };
  tick();
  liveTimerId = setInterval(tick, 100);
}

// 今の画面の状態に合わせて、数え始める・止める。演習画面で、見直し中でなく、未回答の問題があるときだけ数える
function syncLiveTimer() {
  const grammar = state.app === 'grammar';
  const answered = grammar ? state.grammarAnswered : state.answered;
  if (currentAppPage !== 'practice' || state.reviewIndex !== null || answered) {
    stopLiveTimer();
    return;
  }
  startLiveTimer(grammar ? 'grammar' : 'vocab');
}

function renderPaceFeedback(kind, sec, isCorrect) {
  stopLiveTimer();
  updateFooterPaceDisplay();
  const card = document.getElementById('main-card');
  if (!card) return;

  // バッジの段階は、設定した目標タイムからの割合で決まる（StudyCore.paceTier）
  const tier = StudyCore.paceTier(kind, sec, isCorrect, prefs.paceTarget[kind === 'grammar' ? 'grammar' : 'vocab']);
  const tierWord = kind === 'grammar' ? { top: '爆速！', ok: '本番ペース！' } : { top: '瞬殺！', ok: 'ナイスペース！' };
  const isFast = tier !== 'none';
  const badgeLabel = isFast ? `⚡ ${tierWord[tier]} ${sec.toFixed(1)}秒` : `⏱ ${sec.toFixed(1)}秒`;

  const existing = ensurePaceBadge(card);
  existing.className = `card-pace-badge${isFast ? ' fast' : ''}`;
  existing.textContent = badgeLabel;
}

// ホーム画面の「何日連続 ＆ ここがすごい！」メッセージ一覧を組み立てる
function buildHomePraiseMessages(kind, activeBook, mainProg, allProg) {
  const streakInfo = getStreakSummary();
  const wordSum = summarizeStats(state.wordStats);
  const gramSum = summarizeStats(state.grammarStats);
  const totalA = wordSum.totalA + gramSum.totalA;
  const totalC = wordSum.totalC + gramSum.totalC;
  const overallRate = totalA > 0 ? Math.round((totalC / totalA) * 100) : 0;
  const avgPace = getAveragePace(kind);

  const list = [];

  // 1. 連続学習＆今日の頑張り
  if (streakInfo.studiedToday) {
    const todayRate = Math.round((streakInfo.todayCorrect / streakInfo.todayAnswered) * 100);
    // 目標を設定しているときは、今日の解答数は目標行に出るので、ここでは連続日数と正答率だけにする
    const todayText = prefs.dailyGoal > 0
      ? `今日の正答率は <b>${todayRate}%</b>、すごい集中力です！`
      : `今日はすでに <b>${streakInfo.todayAnswered}問</b> 解答（正答率 ${todayRate}%）、すごい集中力です！`;
    list.push({
      icon: '🔥',
      html: `<b>${streakInfo.streak}日連続</b>で学習達成！${todayText}`,
    });
    if (prefs.dailyGoal > 0 && streakInfo.todayAnswered >= prefs.dailyGoal) {
      list.push({
        icon: '🎯',
        html: `今日の目標 <b>${prefs.dailyGoal}問</b> を達成しました！この調子です！`,
      });
    }
  } else if (streakInfo.streak >= 1) {
    list.push({
      icon: '🔥',
      html: `現在 <b>${streakInfo.streak}日連続</b>で継続中！今日も1問解いて記録を <b>${streakInfo.streak + 1}日</b> に伸ばしましょう！`,
    });
  }

  // 2. スピード・即答の褒めメッセージ
  if (streakInfo.todayFast >= 1) {
    list.push({
      icon: '⚡',
      html: `ここがすごい：今日は目標タイム以内の<b>即答が ${streakInfo.todayFast}回</b>！本番さながらの解答スピードです！`,
    });
  } else if (avgPace !== null) {
    list.push({
      icon: '⏱️',
      html: `ここがすごい：直近の平均解答ペースは <b>${avgPace.toFixed(1)}秒/問</b>！リズムよく解き進められています！`,
    });
  }

  // 3. 学習中の参考書の習得進捗
  if (mainProg.mastered > 0) {
    list.push({
      icon: '👑',
      html: `ここがすごい：<b>『${escapeHtml(activeBook.title)}』</b>の <b>${mainProg.masteredPct}%（${mainProg.mastered}${mainProg.unit}）</b> をすでに自分のものにしています！`,
    });
  }

  // 4. 累計解答数・正答率の褒めメッセージ
  if (totalA >= 5) {
    list.push({
      icon: '✨',
      html: `ここがすごい：これまでに累計 <b>${totalA.toLocaleString()}回</b> 解答し、通算正答率は <b>${overallRate}%</b>！着実に力がついています！`,
    });
  }

  // 5. 要復習の案内
  if (allProg.due > 0) {
    list.push({
      icon: '💡',
      html: `現在、${kind === 'grammar' ? '文法' : '単語'}の<b>要復習問題が ${allProg.due}${allProg.unit}</b>あります。<button type="button" class="home-inline-link" data-home-action="open-review">復習へ</button>`,
    });
  }

  if (list.length === 0) {
    list.push({
      icon: '💬',
      html: `ようこそ！<b>『${escapeHtml(activeBook.title)}』</b>から今日の演習をスタートしましょう！`,
    });
  }

  return { streakInfo, list };
}

const HOME_BOOKS = {
  vocab: [
    { id: 'teppan', icon: '📘', title: 'TEPPAN英単語', sub: '頻出1,400語・目標スコア別' },
    { id: 'daily', icon: '📗', title: '日々の単語', sub: '日常学習・追加語彙コレクション' },
    { id: 'all', icon: '📚', title: 'すべての単語', sub: 'TEPPAN ＋ 日々の単語 横断' },
  ],
  grammar: [
    { id: 'kin', icon: '👑', title: '金の文法', sub: '全7章・金のルール対応 (160問)' },
    { id: 'sekai', icon: '📖', title: '世界一わかりやすい英文法', sub: '全14章・基礎〜実践 (141問)' },
    { id: 'polaris2', icon: '🧭', title: '英文法ポラリス2', sub: '全6 Unit・応用レベル (334問)' },
    { id: 'toplevel', icon: '🎓', title: '高3 トップレベル英語', sub: '全24 Lecture・実戦演習 (348問)' },
    { id: 'all', icon: '📚', title: 'すべての文法問題', sub: '全4冊 983問 横断演習' },
  ],
};

const WEAK_FILTER_LABELS = {
  all: 'すべて',
  weak_unlearned: '苦手＋未出題',
  weak_only: '苦手のみ',
  due: '要復習のみ',
};

const APP_PAGES = ['home', 'practice', 'review', 'settings'];
let currentAppPage = 'home'; // APP_PAGES のどれか
let homeCategory = 'vocab';  // ホーム画面上の切り替えスイッチ ('vocab' | 'grammar')
let pendingFilterJumpToPractice = false;

function loadHomePresets() {
  const raw = loadJSON(HOME_PRESETS_KEY, null);
  const initialVocab = (state.sourceFilter && ['teppan', 'daily', 'all'].includes(state.sourceFilter))
    ? (state.sourceFilter === 'all' ? 'teppan' : state.sourceFilter)
    : 'teppan';
  const initialGrammar = (state.grammarBook && ['kin', 'sekai', 'polaris2', 'toplevel', 'all'].includes(state.grammarBook))
    ? (state.grammarBook === 'all' ? 'kin' : state.grammarBook)
    : 'kin';

  if (!raw || typeof raw !== 'object') {
    return {
      lastBook: { vocab: initialVocab, grammar: initialGrammar },
      presets: {},
    };
  }
  const lastBook = {
    vocab: ['teppan', 'daily', 'all'].includes(raw.lastBook?.vocab) ? raw.lastBook.vocab : initialVocab,
    grammar: ['kin', 'sekai', 'polaris2', 'toplevel', 'all'].includes(raw.lastBook?.grammar) ? raw.lastBook.grammar : initialGrammar,
  };
  const presets = (raw.presets && typeof raw.presets === 'object' && !Array.isArray(raw.presets)) ? raw.presets : {};
  return { lastBook, presets };
}

let homeState = loadHomePresets();

function saveHomePresets() {
  saveJSON(HOME_PRESETS_KEY, homeState);
}

// 現在の state の絞り込み条件を、対応する参考書プリセットとして記憶する
function recordCurrentBookPreset(updateLastBook = false) {
  if (!homeState) return;
  if (state.app === 'grammar') {
    const b = state.grammarBook || 'kin';
    if (updateLastBook || b !== 'all') {
      homeState.lastBook.grammar = b;
    }
    homeState.presets[`grammar:${b}`] = {
      grammarChapter: Array.isArray(state.grammarChapter) ? [...state.grammarChapter] : [],
      grammarWeakFilter: state.grammarWeakFilter || 'all',
      grammarRule: state.grammarRule ?? null,
    };
  } else {
    const s = state.sourceFilter || 'teppan';
    if (updateLastBook || s !== 'all') {
      homeState.lastBook.vocab = s;
    }
    homeState.presets[`vocab:${s}`] = {
      mode: state.mode || 'e2j',
      rangeFilter: Array.isArray(state.rangeFilter) ? state.rangeFilter.map(r => ({ start: r.start, end: r.end })) : [],
      dateFilter: Array.isArray(state.dateFilter) ? [...state.dateFilter] : [],
      posFilter: Array.isArray(state.posFilter) ? [...state.posFilter] : [],
      weakFilter: state.weakFilter || 'weak_unlearned',
    };
  }
  saveHomePresets();
}

// 参考書ごとの途中セッション保存（他の参考書に行っても前の参考書の続きを保持できるようにする）
function saveBookSessionSnapshot() {
  const bookSessions = loadJSON(BOOK_SESSIONS_KEY, {});
  if (state.app === 'grammar') {
    const key = `grammar:${state.grammarBook || 'all'}`;
    bookSessions[key] = {
      sig: sessionSignature('grammar'),
      pool: state.grammarPool.map(g => g.id),
      index: Math.min(state.currentGrammarIndex + (state.grammarAnswered ? 1 : 0), state.grammarPool.length),
      score: state.grammarScore,
      answered: state.grammarAnsweredCount,
    };
  } else {
    const key = `vocab:${state.sourceFilter || 'all'}`;
    bookSessions[key] = {
      sig: sessionSignature('vocab'),
      pool: state.pool.map(w => WORD_INDEX.get(w)),
      index: Math.min(state.currentIndex + (state.answered ? 1 : 0), state.pool.length),
      score: state.score,
      answered: state.answeredCount,
    };
  }
  try {
    localStorage.setItem(BOOK_SESSIONS_KEY, JSON.stringify(bookSessions));
  } catch (e) {}
}

function restoreBookSessionSnapshot(kind, bookId) {
  const bookSessions = loadJSON(BOOK_SESSIONS_KEY, {});
  const saved = bookSessions[`${kind}:${bookId}`];
  if (!saved || saved.sig !== sessionSignature(kind) || !Array.isArray(saved.pool)) return false;
  const pool = saved.pool.map(k => (kind === 'grammar' ? GRAMMAR_BY_ID.get(k) : RAW_WORDS[k]));
  const index = Number.isInteger(saved.index) ? saved.index : 0;
  if (pool.length === 0 || pool.some(x => !x) || index < 0 || index >= pool.length) return false;
  const score = Number.isInteger(saved.score) ? saved.score : 0;
  const answered = Number.isInteger(saved.answered) ? saved.answered : 0;
  resetReview();
  if (kind === 'grammar') {
    Object.assign(state, { grammarPool: pool, currentGrammarIndex: index, grammarScore: score, grammarAnsweredCount: answered });
  } else {
    Object.assign(state, { pool, currentIndex: index, score, answeredCount: answered });
  }
  saveSession();
  return true;
}

// 指定した参考書の前回プリセットを state に適用する
function applySavedBookPresetToState(kind, bookId) {
  const preset = homeState.presets[`${kind}:${bookId}`];
  if (kind === 'grammar') {
    state.app = 'grammar';
    state.grammarBook = bookId;
    if (preset) {
      const validKeys = getGrammarChaptersList(bookId).map(c => c.key);
      state.grammarChapter = Array.isArray(preset.grammarChapter)
        ? preset.grammarChapter.filter(k => k !== 'all' && validKeys.includes(k))
        : [];
      state.grammarWeakFilter = ['all', 'weak_unlearned', 'weak_only', 'due'].includes(preset.grammarWeakFilter)
        ? preset.grammarWeakFilter
        : 'all';
      state.grammarRule = (bookId === 'kin' && KIN_RULES.some(r => r.number === preset.grammarRule))
        ? preset.grammarRule
        : null;
    } else {
      state.grammarChapter = [];
      state.grammarRule = null;
      state.grammarWeakFilter = 'all';
    }
  } else {
    state.app = 'vocab';
    state.sourceFilter = bookId;
    if (preset) {
      state.mode = ['e2j', 'j2e', 'flash', 'type'].includes(preset.mode) ? preset.mode : state.mode;
      state.rangeFilter = (bookId === 'teppan' && Array.isArray(preset.rangeFilter))
        ? TEPPAN_RANGES.filter(r => preset.rangeFilter.some(x => x && x.start === r.start && x.end === r.end))
        : [];
      state.dateFilter = (bookId !== 'teppan' && Array.isArray(preset.dateFilter))
        ? preset.dateFilter.filter(d => DATES.includes(d))
        : [];
      state.posFilter = (bookId !== 'teppan' && Array.isArray(preset.posFilter))
        ? POS_FILTERS.filter(p => preset.posFilter.includes(p))
        : [];
      state.weakFilter = ['all', 'weak_unlearned', 'weak_only', 'due'].includes(preset.weakFilter)
        ? preset.weakFilter
        : 'weak_unlearned';
    } else {
      state.rangeFilter = [];
      state.dateFilter = [];
      state.posFilter = [];
      state.weakFilter = 'weak_unlearned';
    }
  }
}

// 参考書ごとの「習得 / 苦手 / 未出題」の件数と割合を計算する
function getBookProgress(kind, bookId) {
  if (kind === 'grammar') {
    const items = bookId === 'all'
      ? RAW_GRAMMAR
      : RAW_GRAMMAR.filter(g => (g.b || 'sekai') === bookId);
    const total = items.length;
    let mastered = 0;
    let weak = 0;
    let due = 0;
    items.forEach(g => {
      const wEntry = state.grammarWeakData[g.id];
      if (wEntry !== undefined) {
        weak++;
        if (isDue(wEntry)) due++;
      } else if (state.grammarSeen.has(g.id)) {
        mastered++;
      }
    });
    const unseen = Math.max(0, total - mastered - weak);
    const pct = n => (total > 0 ? Math.round((n / total) * 100) : 0);
    return {
      total,
      mastered,
      weak,
      unseen,
      due,
      unit: '問',
      masteredPct: pct(mastered),
      weakPct: pct(weak),
      unseenPct: Math.max(0, 100 - pct(mastered) - pct(weak)),
      masteredWidth: total > 0 ? (mastered / total) * 100 : 0,
      weakWidth: total > 0 ? (weak / total) * 100 : 0,
    };
  } else {
    const raw = bookId === 'all'
      ? RAW_WORDS
      : RAW_WORDS.filter(w => w.s === bookId);
    const items = dedupeWords(raw);
    const total = items.length;
    const mode = state.mode || 'e2j';
    const weakMap = wordWeak(mode) || {};
    const seenSet = wordSeen(mode) || new Set();
    let mastered = 0;
    let weak = 0;
    let due = 0;
    items.forEach(w => {
      const wEntry = weakMap[w.w];
      if (wEntry !== undefined) {
        weak++;
        if (isDue(wEntry)) due++;
      } else if (seenSet.has(w.w)) {
        mastered++;
      }
    });
    const unseen = Math.max(0, total - mastered - weak);
    const pct = n => (total > 0 ? Math.round((n / total) * 100) : 0);
    return {
      total,
      mastered,
      weak,
      unseen,
      due,
      unit: '語',
      masteredPct: pct(mastered),
      weakPct: pct(weak),
      unseenPct: Math.max(0, 100 - pct(mastered) - pct(weak)),
      masteredWidth: total > 0 ? (mastered / total) * 100 : 0,
      weakWidth: total > 0 ? (weak / total) * 100 : 0,
    };
  }
}

// 前回の絞り込み条件のわかりやすい要約テキストを作る
function getBookPresetSummaryText(kind, bookId) {
  const preset = homeState.presets[`${kind}:${bookId}`];
  if (kind === 'grammar') {
    if (!preset) {
      if (state.grammarBook === bookId) {
        return formatCurrentGrammarPreset();
      }
      return '全範囲 ・ すべて';
    }
    const parts = [];
    if (preset.grammarRule) {
      parts.push(`金のルール ${preset.grammarRule}`);
    } else if (Array.isArray(preset.grammarChapter) && preset.grammarChapter.length > 0) {
      const chNums = preset.grammarChapter.map(k => k.split(':')[1]).filter(Boolean);
      const prefix = bookId === 'polaris2' ? 'Unit ' : (bookId === 'toplevel' ? 'Lec.' : '第');
      const suffix = (bookId === 'polaris2' || bookId === 'toplevel') ? '' : '章';
      parts.push(chNums.length <= 3 ? chNums.map(n => `${prefix}${n}${suffix}`).join('・') : `${chNums.length}章選択中`);
    } else {
      parts.push('全章');
    }
    parts.push(WEAK_FILTER_LABELS[preset.grammarWeakFilter || 'all'] || 'すべて');
    return parts.join(' ・ ');
  } else {
    if (!preset) {
      if (state.sourceFilter === bookId) {
        return formatCurrentVocabPreset();
      }
      return `${MODE_LABELS[state.mode || 'e2j']} ・ 全範囲 ・ 苦手＋未出題`;
    }
    const parts = [MODE_LABELS[preset.mode || 'e2j'] || '英→日'];
    if (bookId === 'teppan') {
      if (Array.isArray(preset.rangeFilter) && preset.rangeFilter.length > 0) {
        parts.push(preset.rangeFilter.length <= 2
          ? preset.rangeFilter.map(r => `${r.start}〜${r.end}`).join(', ')
          : `番号 ${preset.rangeFilter.length}範囲`);
      } else {
        parts.push('全番号');
      }
    } else {
      if (Array.isArray(preset.dateFilter) && preset.dateFilter.length > 0) {
        parts.push(`日付 ${preset.dateFilter.length}週`);
      }
      if (Array.isArray(preset.posFilter) && preset.posFilter.length > 0) {
        parts.push(preset.posFilter.join('・'));
      }
      if (parts.length === 1) parts.push('全範囲');
    }
    parts.push(WEAK_FILTER_LABELS[preset.weakFilter || 'weak_unlearned'] || '苦手＋未出題');
    return parts.join(' ・ ');
  }
}

function formatCurrentGrammarPreset() {
  const parts = [];
  if (state.grammarRule) {
    parts.push(`金のルール ${state.grammarRule}`);
  } else if (state.grammarChapter && state.grammarChapter.length > 0) {
    const chNums = state.grammarChapter.map(k => k.split(':')[1]).filter(Boolean);
    parts.push(chNums.length <= 3 ? `章 ${chNums.join('・')}` : `${chNums.length}章選択中`);
  } else {
    parts.push('全章');
  }
  parts.push(WEAK_FILTER_LABELS[state.grammarWeakFilter || 'all']);
  return parts.join(' ・ ');
}

function formatCurrentVocabPreset() {
  const parts = [MODE_LABELS[state.mode || 'e2j']];
  if (state.sourceFilter === 'teppan') {
    if (state.rangeFilter && state.rangeFilter.length > 0) {
      parts.push(state.rangeFilter.length <= 2
        ? state.rangeFilter.map(r => `${r.start}〜${r.end}`).join(', ')
        : `番号 ${state.rangeFilter.length}範囲`);
    } else {
      parts.push('全番号');
    }
  } else {
    if (state.dateFilter && state.dateFilter.length > 0) parts.push(`日付 ${state.dateFilter.length}週`);
    if (state.posFilter && state.posFilter.length > 0) parts.push(state.posFilter.join('・'));
    if (parts.length === 1) parts.push('全範囲');
  }
  parts.push(WEAK_FILTER_LABELS[state.weakFilter || 'weak_unlearned']);
  return parts.join(' ・ ');
}

// ホーム画面の描画
function renderHomePage() {
  const container = document.getElementById('home-page');
  if (!container) return;

  const kind = homeCategory;
  const books = HOME_BOOKS[kind];
  const activeBookId = homeState.lastBook[kind] || books[0].id;
  const activeBook = books.find(b => b.id === activeBookId) || books[0];
  const otherBooks = books.filter(b => b.id !== activeBook.id);

  const mainProg = getBookProgress(kind, activeBook.id);
  const allProg = getBookProgress(kind, 'all');
  const presetText = getBookPresetSummaryText(kind, activeBook.id);

  // メッセージ枠のテキスト生成（連続日数 ＆ ここがすごい！）
  const praiseModel = buildHomePraiseMessages(kind, activeBook, mainProg, allProg);
  const msgItem = praiseModel.list[praiseRotationIndex % praiseModel.list.length] || praiseModel.list[0];
  const streakCount = praiseModel.streakInfo.streak;
  const streakBadgeHtml = streakCount > 0
    ? `<span class="home-streak-badge" title="連続学習日数">🔥 ${streakCount}日連続</span>`
    : `<span class="home-message-icon">${msgItem.icon}</span>`;

  const goalInfo = StudyCore.goalProgress(dailyActivity.days[localDateStr()], prefs.dailyGoal);
  lastRenderedDate = localDateStr();
  const goalRowHtml = `
    <button type="button" class="home-goal-row" data-home-action="open-goal" aria-haspopup="dialog">
      <span class="home-goal-label">🎯 今日の目標</span>
      <span class="home-goal-count">${goalInfo.hasGoal ? `${goalInfo.answered} / ${goalInfo.goal}問` : `${goalInfo.answered}問（目標なし）`}</span>
      <span class="home-goal-track" aria-hidden="true"><i style="width:${Math.round(goalInfo.ratio * 100)}%"></i></span>
    </button>`;

  container.innerHTML = `
    <div class="home-layout">
    <div class="home-top">
    <!-- 1. メッセージ枠（タップで他の褒めポイントへ切り替え） -->
    <div class="home-message-bar" role="status" data-home-action="rotate-praise" title="タップで別のメッセージを表示">
      ${streakBadgeHtml}
      <div class="home-message-text">${msgItem.html}</div>
      ${praiseModel.list.length > 1 ? '<span class="home-message-next" aria-hidden="true">↻</span>' : ''}
    </div>
    ${goalRowHtml}

    <!-- 2. 単語 / 文法 切り替えスイッチ -->
    <div class="segments home-switch-segments" role="tablist" aria-label="単語と文法の切り替え">
      <div class="segment ${kind === 'vocab' ? 'active' : ''}" data-home-switch="vocab" role="tab" aria-selected="${kind === 'vocab'}">単語</div>
      <div class="segment ${kind === 'grammar' ? 'active' : ''}" data-home-switch="grammar" role="tab" aria-selected="${kind === 'grammar'}">文法</div>
    </div>

    </div>
    <div class="home-col-main">
    <!-- 3. 学習中の参考書（前回解いた1冊） -->
    <section class="home-main-book-card" aria-label="学習中の参考書">
      <div class="home-main-book-top">
        <div>
          <div class="home-main-book-eyebrow">📌 学習中の参考書（前回解いた1冊）</div>
          <h2 class="home-main-book-title">
            <span>${activeBook.icon}</span>
            <span>${escapeHtml(activeBook.title)}</span>
          </h2>
        </div>
        <span class="home-main-book-total">全 ${mainProg.total.toLocaleString()} ${mainProg.unit}</span>
      </div>

      <!-- 進行度バー（習得 / 苦手 / 未出題） -->
      <div class="home-progress-wrap">
        <div class="home-progress-bar" role="img" aria-label="進行度 習得 ${mainProg.masteredPct}% 苦手 ${mainProg.weakPct}% 未出題 ${mainProg.unseenPct}%">
          <div class="home-progress-seg mastered" style="width: ${mainProg.masteredWidth.toFixed(1)}%"></div>
          <div class="home-progress-seg weak" style="width: ${mainProg.weakWidth.toFixed(1)}%"></div>
          <div class="home-progress-seg unseen"></div>
        </div>
        <div class="home-progress-legend">
          <div class="home-legend-items">
            <span class="home-legend-item"><i class="home-legend-dot mastered"></i>習得 ${mainProg.masteredPct}% (${mainProg.mastered})</span>
            <span class="home-legend-item"><i class="home-legend-dot weak"></i>苦手 ${mainProg.weakPct}% (${mainProg.weak})</span>
            <span class="home-legend-item"><i class="home-legend-dot unseen"></i>未出題 ${mainProg.unseenPct}% (${mainProg.unseen})</span>
          </div>
        </div>
      </div>

      <div class="home-preset-summary">
        <span>🎯 前回のしぼりこみ: <strong>${escapeHtml(presetText)}</strong></span>
      </div>

      <div class="home-main-actions">
        <button type="button" class="home-btn-secondary" data-home-action="specify-range" data-kind="${kind}" data-book="${activeBook.id}">
          🎛️ 範囲を指定
        </button>
        <button type="button" class="home-btn-primary" data-home-action="continue-book" data-kind="${kind}" data-book="${activeBook.id}">
          ▶️ つづきから
        </button>
      </div>
    </section>

    <!-- 4. 苦手問題バー（[苦手を解く] + [一覧を見る]） -->
    <section class="home-weak-bar" aria-label="苦手問題">
      <div class="home-weak-info">
        <div class="home-weak-title">
          <span>🔥 苦手問題（${kind === 'grammar' ? '文法' : `単語・${MODE_LABELS[state.mode || 'e2j']}`}）</span>
        </div>
        <div class="home-weak-sub">
          登録 <strong>${allProg.weak}</strong> ${allProg.unit} ・ 今日の要復習 <strong>${allProg.due}</strong> ${allProg.unit}
        </div>
      </div>
      <div class="home-weak-actions">
        <button type="button" class="home-weak-btn solve" data-home-action="solve-weak" data-kind="${kind}" ${allProg.weak === 0 ? 'disabled' : ''}>
          苦手を解く
        </button>
        <button type="button" class="home-weak-btn" data-home-action="view-weak-list" data-kind="${kind}">
          一覧を見る
        </button>
      </div>
    </section>

    </div>
    <div class="home-col-side">
    <!-- 5. 他の参考書（スクロール可能ボックス） -->
    <section class="home-others-section" aria-label="他の参考書">
      <h3 class="home-others-heading">
        <span>他の参考書</span>
        <span style="font-weight:500;font-size:11px;">タップで切り替え・スクロール可能</span>
      </h3>
      <div class="home-others-scroll">
        ${otherBooks.map(b => {
          const p = getBookProgress(kind, b.id);
          return `
            <div class="home-other-card" data-home-select-book="${b.id}" data-kind="${kind}">
              <div class="home-other-top">
                <div class="home-other-title">
                  <span>${b.icon}</span>
                  <span>${escapeHtml(b.title)}</span>
                </div>
                <span class="home-other-meta">全 ${p.total.toLocaleString()} ${p.unit}</span>
              </div>
              <div class="home-other-bar">
                <div class="home-progress-seg mastered" style="width: ${p.masteredWidth.toFixed(1)}%"></div>
                <div class="home-progress-seg weak" style="width: ${p.weakWidth.toFixed(1)}%"></div>
                <div class="home-progress-seg unseen"></div>
              </div>
              <div class="home-other-bottom">
                <span>習得 ${p.masteredPct}% (${p.mastered}) ・ 苦手 ${p.weak} ・ 未 ${p.unseen}</span>
                <div class="home-other-actions">
                  <button type="button" class="home-other-btn" data-home-action="specify-range" data-kind="${kind}" data-book="${b.id}">範囲を指定</button>
                  <button type="button" class="home-other-btn primary" data-home-action="continue-book" data-kind="${kind}" data-book="${b.id}">つづきから</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
    </div>
    </div>
  `;
}

// 復習画面：今日の復習の件数、苦手ドリルと一覧への入口、今日克服できた数
function renderReviewPage() {
  const container = document.getElementById('review-page');
  if (!container) return;
  lastRenderedDate = localDateStr();
  const today = dailyActivity.days[localDateStr()] || {};
  const mastered = today.gr || 0;
  const block = (kind, title, sub) => {
    const p = getBookProgress(kind, 'all');
    return `
      <section class="review-block" aria-label="${title}の復習">
        <div class="review-block-head">
          <h3>${title}</h3>
          <span class="review-block-sub">${sub}</span>
        </div>
        <div class="review-block-stats">
          <div><b>${p.due}</b><small>今日の要復習（${p.unit}）</small></div>
          <div><b>${p.weak}</b><small>苦手に登録（${p.unit}）</small></div>
        </div>
        <div class="review-block-actions">
          <button type="button" class="home-weak-btn solve" data-home-action="solve-weak" data-kind="${kind}" ${p.weak === 0 ? 'disabled' : ''}>苦手を解く</button>
          <button type="button" class="home-weak-btn" data-home-action="view-weak-list" data-kind="${kind}">一覧を見る</button>
        </div>
      </section>`;
  };
  container.innerHTML = `
    <div class="review-page-inner">
      <h2 class="review-page-title">復習</h2>
      <p class="review-today">${mastered > 0
        ? `今日は苦手を <b>${mastered} 問</b> 克服しました！`
        : '苦手を正解して、間隔をあけた復習を最後まで終えると「克服」になります。'}</p>
      ${block('vocab', '単語', `モード：${MODE_LABELS[state.mode || 'e2j']}`)}
      ${block('grammar', '文法', '全 4 冊')}
    </div>`;
}

// 設定ページの描画（下から出る設定カードの内容をそのまま踏襲）
function renderSettingsPage() {
  const container = document.getElementById('settings-page-content');
  if (!container) return;

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'ink';
  const wordCount = getWeakWordCount();
  const grammarCount = getWeakGrammarCount();
  const wordSummary = summarizeStats(state.wordStats);
  const grammarSummary = summarizeStats(state.grammarStats);

  const themes = [
    { id: 'ink', name: '和モダン', color: '#d4a759', bg: '#181512' },
    { id: 'duolingo', name: 'Duolingo', icon: '🦉', color: '#58cc02', bg: '#131f24' },
    { id: 'navy', name: 'ネイビー', color: '#3b82f6', bg: '#0b1329' },
    { id: 'quizlet', name: 'Quizlet', color: '#4255ff', bg: '#0a092d' },
    { id: 'forest', name: 'フォレスト', color: '#10b981', bg: '#0a1713' },
    { id: 'nordic', name: 'チャコール', color: '#a1a1aa', bg: '#18181b' },
    { id: 'light', name: 'セピア', color: '#d97706', bg: '#f6f3ed' }
  ];

  container.innerHTML = `
    <div class="settings-wrap">
      <!-- カラーテーマ設定 -->
      <section class="settings-section">
        <div class="settings-section-header">
          <span class="settings-icon">🎨</span>
          <h3 class="settings-section-title">カラーテーマ</h3>
        </div>
        <p class="settings-desc">ドリルの配色・アクセントカラーを選択します。</p>
        <div class="settings-theme-grid">
          ${themes.map(t => `
            <button type="button" 
                    class="settings-theme-card ${currentTheme === t.id ? 'active' : ''}" 
                    onclick="handleSettingThemeChange('${t.id}'); renderSettingsPage(); renderHomePage();">
              <span class="settings-theme-dot" style="background: ${t.color}; box-shadow: 0 0 0 2px ${t.bg};"></span>
              <span class="settings-theme-name">${t.icon ? t.icon + ' ' : ''}${t.name}</span>
              ${currentTheme === t.id ? '<span class="settings-theme-check">✓</span>' : ''}
            </button>
          `).join('')}
        </div>
      </section>

      <!-- 学習の目標設定 -->
      <section class="settings-section">
        <div class="settings-section-header">
          <span class="settings-icon">🎯</span>
          <h3 class="settings-section-title">学習の目標</h3>
        </div>
        <p class="settings-desc">今日の目標問題数と、「即答」とみなす目標タイムを変更します。</p>
        <div class="settings-field">
          <label for="setting-goal">今日の目標（問）</label>
          <input id="setting-goal" class="settings-number" type="number" inputmode="numeric" min="0" max="${StudyCore.MAX_GOAL}" step="1" value="${prefs.dailyGoal}" onchange="handleGoalSetting(this)">
        </div>
        <div class="settings-chips" role="group" aria-label="目標のかんたん設定">
          ${StudyCore.GOALS.filter(g => g > 0).map(g => `<button type="button" class="settings-chip${prefs.dailyGoal === g ? ' active' : ''}" data-goal="${g}" onclick="setGoalFromChip(${g})">${g}問</button>`).join('')}
          <button type="button" class="settings-chip${prefs.dailyGoal === 0 ? ' active' : ''}" data-goal="0" onclick="setGoalFromChip(0)">目標なし</button>
        </div>
        <p class="settings-hint">0 のときは目標なしです（0〜${StudyCore.MAX_GOAL}）。</p>
        <div class="settings-field">
          <label for="setting-pace-vocab">単語の即答タイム（秒以内）</label>
          <input id="setting-pace-vocab" class="settings-number" type="number" inputmode="decimal" min="${StudyCore.PACE_RANGE.vocab.min}" max="${StudyCore.PACE_RANGE.vocab.max}" step="${StudyCore.PACE_RANGE.vocab.step}" value="${prefs.paceTarget.vocab}" onchange="handlePaceSetting('vocab', this)">
        </div>
        <div class="settings-field">
          <label for="setting-pace-grammar">文法の即答タイム（秒以内）</label>
          <input id="setting-pace-grammar" class="settings-number" type="number" inputmode="numeric" min="${StudyCore.PACE_RANGE.grammar.min}" max="${StudyCore.PACE_RANGE.grammar.max}" step="${StudyCore.PACE_RANGE.grammar.step}" value="${prefs.paceTarget.grammar}" onchange="handlePaceSetting('grammar', this)">
        </div>
        <p class="settings-hint">単語は ${StudyCore.PACE_RANGE.vocab.min}〜${StudyCore.PACE_RANGE.vocab.max} 秒、文法は ${StudyCore.PACE_RANGE.grammar.min}〜${StudyCore.PACE_RANGE.grammar.max} 秒。バッジ（瞬殺・爆速など）の境界もこのタイムに合わせて変わります。変更はこれからの回答に効きます。</p>
        <label class="settings-toggle" for="setting-live-timer">
          <input id="setting-live-timer" type="checkbox" ${prefs.liveTimer ? 'checked' : ''} onchange="handleLiveTimerSetting(this)">
          <span>解いている間、画面の下に経過時間を表示する（解き始めからのカウントアップ）</span>
        </label>
        <div class="settings-actions-row">
          <button type="button" class="settings-action-btn" onclick="resetLearningGoals()">標準に戻す</button>
        </div>
        <p class="settings-hint" id="setting-goal-msg" role="status" aria-live="polite"></p>
      </section>

      <!-- データ管理設定 -->
      <section class="settings-section">
        <div class="settings-section-header">
          <span class="settings-icon">💾</span>
          <h3 class="settings-section-title">データ管理</h3>
        </div>
        <p class="settings-desc">学習記録のバックアップ・復元や外部連携を行います。</p>

        <div class="settings-menu-list">
          <button type="button" class="settings-menu-item" onclick="openBackupFromSettings()">
            <div class="settings-menu-item-left">
              <div class="settings-menu-item-icon">💾</div>
              <div>
                <div class="settings-menu-item-title">学習記録のバックアップ・復元</div>
                <div class="settings-menu-item-subtitle">${(typeof isGoogleDriveLinked === 'function' && isGoogleDriveLinked()) ? '☁️ Google ドライブ自動同期中' : 'JSON書き出し・Google ドライブ自動同期'}</div>
              </div>
            </div>
            <span class="settings-menu-item-arrow">›</span>
          </button>
        </div>

        <div class="settings-subgroup">
          <div class="settings-subgroup-title">Obsidian 連携</div>
          <div class="settings-actions-row">
            <button type="button" class="settings-action-btn" onclick="exportObsidianGrammarSync()">
              📤 苦手データ出力
            </button>
            <button type="button" class="settings-action-btn" onclick="importObsidianGrammarSync()">
              📥 同期読込
            </button>
          </div>
        </div>

        <div class="settings-data-status">
          <div class="settings-status-title">現在の学習データ</div>
          <div class="settings-status-row" style="margin-bottom:4px;">
            <span>記録された苦手データ</span>
            <span class="settings-status-badge">単語 ${wordCount}件 / 文法 ${grammarCount}件</span>
          </div>
          <div class="settings-status-row">
            <span>累計回答数（正答率）</span>
            <span class="settings-status-badge">単語 ${wordSummary.totalA}回 (${wordSummary.rate}%) / 文法 ${grammarSummary.totalA}回 (${grammarSummary.rate}%)</span>
          </div>
        </div>
      </section>
    </div>
  `;
}

// ==================== 設定ページ：学習の目標 ====================

function showGoalSettingMessage(text) {
  const el = document.getElementById('setting-goal-msg');
  if (el) el.textContent = text;
}

function syncGoalChips() {
  document.querySelectorAll('.settings-chip[data-goal]').forEach(chip => {
    chip.classList.toggle('active', Number(chip.dataset.goal) === prefs.dailyGoal);
  });
}

// 今日の目標の入力欄。範囲外は範囲内に直し、数でなければ元の値に戻す
function handleGoalSetting(input) {
  const v = StudyCore.clampGoal(input.value);
  if (v === null) {
    input.value = prefs.dailyGoal;
    showGoalSettingMessage('数字で入力してください。');
    return;
  }
  const typed = Number(input.value);
  setDailyGoal(v);
  input.value = v;
  syncGoalChips();
  if (v !== typed) showGoalSettingMessage(`0〜${StudyCore.MAX_GOAL}問の範囲に直しました（${v}問）。`);
  else showGoalSettingMessage(v === 0 ? '今日の目標をなしにしました。' : `今日の目標を ${v}問 にしました。`);
}

function setGoalFromChip(goal) {
  const input = document.getElementById('setting-goal');
  if (!input) return;
  input.value = goal;
  handleGoalSetting(input);
}

// 即答の目標タイム（単語・文法）。範囲外は範囲内に直し、数でなければ元の値に戻す
function handlePaceSetting(kind, input) {
  const v = StudyCore.clampPace(kind, input.value);
  if (v === null) {
    input.value = prefs.paceTarget[kind];
    showGoalSettingMessage('数字で入力してください。');
    return;
  }
  const typed = Number(input.value);
  prefs.paceTarget[kind] = v;
  savePrefs();
  input.value = v;
  const range = StudyCore.PACE_RANGE[kind];
  const label = kind === 'grammar' ? '文法' : '単語';
  if (v !== typed) showGoalSettingMessage(`${v}秒に直しました（${range.min}〜${range.max}秒、${range.step}秒刻み）。`);
  else showGoalSettingMessage(`${label}の即答タイムを ${v}秒 にしました。`);
}

// 解いている間の経過時間の表示。オフにしても、回答後の結果バッジは今までどおり出る
function handleLiveTimerSetting(input) {
  prefs.liveTimer = input.checked;
  savePrefs();
  if (!prefs.liveTimer) stopLiveTimer();
  showGoalSettingMessage(prefs.liveTimer ? '経過時間を表示します（次の問題から）。' : '経過時間を非表示にしました。');
}

function resetLearningGoals() {
  setDailyGoal(StudyCore.normalizeGoal(undefined));
  prefs.paceTarget = StudyCore.normalizePaceTarget(undefined);
  savePrefs();
  renderSettingsPage();
  showGoalSettingMessage('目標を標準（10問・単語 5秒・文法 20秒）に戻しました。');
}

// 3ページの切り替え関数
function switchAppPage(page, options = {}) {
  if (!APP_PAGES.includes(page)) page = 'home';
  currentAppPage = page;
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.classList.toggle('page-home', page === 'home');
    appEl.classList.toggle('page-review', page === 'review');
  }

  // シートが開いていれば閉じる（オプションで維持指定がない場合）
  if (!options.keepSheets) {
    closeFilterSheet();
    closeSheet();
  }

  // ナッジモーダルはホーム・設定ページでは出さない
  if (page !== 'practice') {
    const nudge = document.getElementById('filter-nudge-modal');
    if (nudge) nudge.classList.remove('open');
  }

  document.querySelectorAll('.top-page-tab').forEach(btn => {
    const active = btn.dataset.page === page;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  document.querySelectorAll('.app-page-view').forEach(view => {
    view.classList.toggle('active', view.id === `${page}-page`);
  });

  if (page === 'home') {
    renderHomePage();
  } else if (page === 'review') {
    renderReviewPage();
  } else if (page === 'settings') {
    renderSettingsPage();
  } else if (page === 'practice') {
    checkFilterNudge();
  }

  // 演習画面にいるときだけ数える（戻ってきたときは、未回答の問題の経過時間を続きから表示する）
  syncLiveTimer();

  if (!options.skipHash) {
    const targetHash = `#${page}`;
    if (location.hash !== targetHash) {
      history.replaceState(null, '', targetHash);
    }
  }
}

// ホームから「つづきから」で参考書を開始する
function startBookFromHome(kind, bookId) {
  // 今の参考書の状態を保存してから切り替える
  recordCurrentBookPreset();
  saveBookSessionSnapshot();

  homeCategory = kind;
  homeState.lastBook[kind] = bookId;
  applySavedBookPresetToState(kind, bookId);
  saveHomePresets();
  syncFilterUI();

  // セッションの復元を試み、なければその絞り込み条件で新規出題
  if (kind === 'grammar') {
    document.querySelector('.header .title').innerText = '文法ドリル (Part 5)';
    document.getElementById('rule-guide-link').style.display = 'inline';
    document.querySelectorAll('.mode-segments').forEach(el => el.style.display = 'none');
    const sheetModeGroup = document.getElementById('sheet-mode-group');
    if (sheetModeGroup) sheetModeGroup.style.display = 'none';
    document.getElementById('vocab-filters').style.display = 'none';
    document.getElementById('grammar-filters').style.display = 'block';
    resetActionBar();

    if (!restoreBookSessionSnapshot('grammar', bookId) && !restoreSession('grammar')) {
      applyGrammarFilters();
    } else {
      updateGrammarWeakBadge();
      updateFilterSummary();
      renderCurrentGrammar();
    }
  } else {
    document.querySelector('.header .title').innerText = '単語ドリル';
    document.getElementById('rule-guide-link').style.display = 'none';
    document.querySelectorAll('.mode-segments').forEach(el => el.style.display = 'flex');
    const sheetModeGroup = document.getElementById('sheet-mode-group');
    if (sheetModeGroup) sheetModeGroup.style.display = 'block';
    document.getElementById('vocab-filters').style.display = 'block';
    document.getElementById('grammar-filters').style.display = 'none';
    resetActionBar();

    if (!restoreBookSessionSnapshot('vocab', bookId) && !restoreSession('vocab')) {
      applyFilters();
    } else {
      updateWeakBadge();
      updateFilterSummary();
      renderCurrent();
    }
  }

  switchAppPage('practice');
}

// ホームから「範囲を指定」で絞り込みシートを開く
function specifyBookRangeFromHome(kind, bookId) {
  recordCurrentBookPreset();
  saveBookSessionSnapshot();

  homeCategory = kind;
  homeState.lastBook[kind] = bookId;
  applySavedBookPresetToState(kind, bookId);
  saveHomePresets();
  setApp(kind);
  syncFilterUI();

  pendingFilterJumpToPractice = true;
  openFilterSheet();
}

// ホームから「苦手を解く」を開始する
function startWeakDrillFromHome(kind) {
  recordCurrentBookPreset();
  saveBookSessionSnapshot();

  homeCategory = kind;
  if (kind === 'grammar') {
    state.app = 'grammar';
    state.grammarBook = 'all';
    state.grammarChapter = [];
    state.grammarRule = null;
    state.grammarWeakFilter = 'weak_only';
    syncFilterUI();
    setApp('grammar');
    applyGrammarFilters();
  } else {
    state.app = 'vocab';
    state.sourceFilter = 'all';
    state.rangeFilter = [];
    state.dateFilter = [];
    state.posFilter = [];
    state.weakFilter = 'weak_only';
    syncFilterUI();
    setApp('vocab');
    applyFilters();
  }
  switchAppPage('practice');
}

// ホームから「苦手一覧を見る」を開く
function openWeakListFromHome(kind) {
  state.app = kind;
  state.weakListMode = state.mode || 'e2j';
  openSheet('苦手リスト', renderWeakList, false);
}

// ==================== 今日の目標・学習カレンダー（ダイアログ） ====================

function ensureGoalDialog() {
  let dlg = document.getElementById('goal-dialog');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'goal-dialog';
  dlg.className = 'goal-dialog';
  dlg.setAttribute('aria-labelledby', 'goal-dialog-title');
  dlg.addEventListener('click', e => {
    if (e.target === dlg) {
      // dialog の余白（padding）や段落の間をタップしても e.target は dialog 自身になるので、枠の外（背景）のときだけ閉じる
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    }
    const act = e.target.closest('[data-goal-action]');
    if (!act) return;
    const name = act.dataset.goalAction;
    if (name === 'close') dlg.close();
    if (name === 'prev') { goalCalendarMonth = StudyCore.shiftMonth(goalCalendarMonth, -1); renderGoalDialog(); }
    if (name === 'next') { goalCalendarMonth = StudyCore.shiftMonth(goalCalendarMonth, 1); renderGoalDialog(); }
  });
  dlg.addEventListener('change', e => {
    if (e.target.id !== 'goal-select') return;
    setDailyGoal(Number(e.target.value));
    renderGoalDialog();
    if (currentAppPage === 'home') renderHomePage();
  });
  dlg.addEventListener('close', () => {
    // 目標を変えるとホームが描き直され、開いたときのボタンが置き換わるので、今ある目標行に戻す
    const target = goalDialogTrigger && goalDialogTrigger.isConnected ? goalDialogTrigger : document.querySelector('.home-goal-row');
    if (target) target.focus();
    goalDialogTrigger = null;
  });
  document.body.appendChild(dlg);
  return dlg;
}

function renderGoalDialog() {
  const dlg = ensureGoalDialog();
  const today = localDateStr();
  const model = StudyCore.monthModel(dailyActivity.days, goalCalendarMonth, today);
  const streak = getStreakSummary();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  // 作り直すとフォーカスが外れるので、今フォーカスのあるボタン・選択欄を覚えておいて、描き直したあとに戻す
  const active = document.activeElement;
  const focusSelector = dlg.contains(active)
    ? (active.dataset.goalAction ? `[data-goal-action="${active.dataset.goalAction}"]` : (active.id ? `#${active.id}` : ''))
    : '';
  const cells = [
    ...Array.from({ length: model.leading }, () => '<span class="goal-cal-cell empty"></span>'),
    ...model.cells.map(c => {
      const mark = c.reached ? '✓' : c.studied ? '●' : '';
      const state = c.reached ? '目標達成' : c.studied ? '学習した' : '';
      const label = `${model.ym.slice(5).replace(/^0/, '')}月${c.day}日${c.studied ? ` ${c.answered}問` : ''}${state ? ` ${state}` : ''}`;
      return `<span class="goal-cal-cell${c.studied ? ' studied' : ''}${c.reached ? ' reached' : ''}${c.today ? ' today' : ''}${c.future ? ' future' : ''}" role="img" aria-label="${label}"><span class="goal-cal-day">${c.day}</span><span class="goal-cal-mark" aria-hidden="true">${mark}</span></span>`;
    }),
  ].join('');
  dlg.innerHTML = `
    <div class="goal-dialog-head">
      <h2 id="goal-dialog-title">学習カレンダー</h2>
      <button type="button" class="goal-dialog-close" data-goal-action="close" aria-label="閉じる">✕</button>
    </div>
    <p class="goal-dialog-overview">累計 <b>${StudyCore.studiedDays(dailyActivity.days)}日</b> 学習 ・ 連続 <b>${streak.streak}日</b></p>
    <div class="goal-dialog-field">
      <label for="goal-select">今日の目標</label>
      <select id="goal-select">
        ${StudyCore.goalChoices(prefs.dailyGoal).map(g => `<option value="${g}" ${g === prefs.dailyGoal ? 'selected' : ''}>${g === 0 ? '目標なし' : `${g}問`}</option>`).join('')}
      </select>
    </div>
    <div class="goal-cal-nav">
      <button type="button" data-goal-action="prev" aria-label="前の月">‹</button>
      <strong>${model.label}</strong>
      <button type="button" data-goal-action="next" aria-label="次の月" ${model.canNext ? '' : 'disabled'}>›</button>
    </div>
    <div class="goal-cal-grid" role="group" aria-label="${model.label}の学習日">
      ${weekdays.map(w => `<span class="goal-cal-week" aria-hidden="true">${w}</span>`).join('')}
      ${cells}
    </div>
    <p class="goal-dialog-legend"><span>● 学習した日</span><span>✓ 目標達成の日</span></p>
    <p class="goal-dialog-note">日別の記録は、この機能を入れた日から残ります。</p>`;
  if (focusSelector) {
    let target = dlg.querySelector(focusSelector);
    if (target && target.disabled) target = dlg.querySelector('[data-goal-action="prev"]'); // 最後の月で「›」が使えなくなったとき
    if (target) target.focus();
  }
}

function openGoalDialog(trigger) {
  goalDialogTrigger = trigger || null;
  goalCalendarMonth = localDateStr().slice(0, 7);
  const dlg = ensureGoalDialog();
  renderGoalDialog();
  if (!dlg.open) dlg.showModal();
}

// アプリを開いたまま日付が変わったとき、ホームの「今日 N / M問」を作り直す
function refreshForNewDay() {
  if (!lastRenderedDate || lastRenderedDate === localDateStr()) return;
  if (currentAppPage === 'home') renderHomePage();
  else if (currentAppPage === 'review') renderReviewPage();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshForNewDay();
});
setInterval(refreshForNewDay, 60 * 1000);

// 初期化＆イベント登録
function initHomeAndPages() {
  homeCategory = state.app || 'vocab';
  homeState = loadHomePresets();

  // 既存の saveSettings / saveSession にフックして、参考書別プリセット＆セッションも自動保存
  const origSaveSettings = window.saveSettings;
  if (typeof origSaveSettings === 'function') {
    window.saveSettings = function () {
      origSaveSettings.apply(this, arguments);
      recordCurrentBookPreset();
    };
  }

  const origSaveSession = window.saveSession;
  if (typeof origSaveSession === 'function') {
    window.saveSession = function () {
      origSaveSession.apply(this, arguments);
      saveBookSessionSnapshot();
    };
  }

  // 問題表示時と回答時にフックして解答ペース（秒/問）と日別アクティビティを記録・表示する
  const origRenderCurrent = window.renderCurrent;
  if (typeof origRenderCurrent === 'function') {
    window.renderCurrent = function () {
      const res = origRenderCurrent.apply(this, arguments);
      if (state.reviewIndex === null && !state.answered) {
        questionShownAt = performance.now();
      }
      updateFooterPaceDisplay();
      syncLiveTimer();
      return res;
    };
  }

  const origRenderCurrentGrammar = window.renderCurrentGrammar;
  if (typeof origRenderCurrentGrammar === 'function') {
    window.renderCurrentGrammar = function () {
      const res = origRenderCurrentGrammar.apply(this, arguments);
      if (state.reviewIndex === null && !state.grammarAnswered) {
        questionShownAt = performance.now();
      }
      updateFooterPaceDisplay();
      syncLiveTimer();
      return res;
    };
  }

  const origRecordWeak = window.recordWeak;
  if (typeof origRecordWeak === 'function') {
    window.recordWeak = function (word, isCorrect) {
      const wasWeak = Boolean(wordWeak()[word.w]);
      const res = origRecordWeak.apply(this, arguments);
      recordAnswerPaceAndActivity('vocab', isCorrect);
      noteSessionReview('vocab', wasWeak, Boolean(wordWeak()[word.w]), isCorrect);
      return res;
    };
  }

  const origRecordWeakGrammar = window.recordWeakGrammar;
  if (typeof origRecordWeakGrammar === 'function') {
    window.recordWeakGrammar = function (ex, isCorrect) {
      const wasWeak = Boolean(state.grammarWeakData[ex.id]);
      const res = origRecordWeakGrammar.apply(this, arguments);
      recordAnswerPaceAndActivity('grammar', isCorrect);
      noteSessionReview('grammar', wasWeak, Boolean(state.grammarWeakData[ex.id]), isCorrect);
      return res;
    };
  }

  // 出題プールを作り直す（絞り込み・モード変更・苦手ドリルなど）たびに、その種類の集計だけやり直す。
  // 単語 ⇄ 文法の切り替えや、保存した続きの復元では作り直さないので、戻ったときに続きから数えられる
  const origApplyFilters = window.applyFilters;
  if (typeof origApplyFilters === 'function') {
    window.applyFilters = function () {
      sessionReview.vocab = StudyCore.createSessionReview();
      return origApplyFilters.apply(this, arguments);
    };
  }
  const origApplyGrammarFilters = window.applyGrammarFilters;
  if (typeof origApplyGrammarFilters === 'function') {
    window.applyGrammarFilters = function () {
      sessionReview.grammar = StudyCore.createSessionReview();
      return origApplyGrammarFilters.apply(this, arguments);
    };
  }

  // 苦手一覧のシートを閉じたとき、復習画面にいたら件数を描き直す（シートの中で苦手を外せるため）
  const origCloseSheet = window.closeSheet;
  if (typeof origCloseSheet === 'function') {
    window.closeSheet = function () {
      const res = origCloseSheet.apply(this, arguments);
      if (currentAppPage === 'review') renderReviewPage();
      return res;
    };
  }

  updateFooterPaceDisplay();

  // 絞り込みシートの「この条件で解く」ボタンが押されたときだけ演習ページへ遷移し、✕や背景タップではホームに留まる
  const applyBtn = document.querySelector('.filter-apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      recordCurrentBookPreset();
      if (pendingFilterJumpToPractice) {
        pendingFilterJumpToPractice = false;
        switchAppPage('practice');
      }
    });
  }

  const origCloseFilterSheet = window.closeFilterSheet;
  if (typeof origCloseFilterSheet === 'function') {
    window.closeFilterSheet = function () {
      origCloseFilterSheet.apply(this, arguments);
      recordCurrentBookPreset();
      if (currentAppPage === 'home') {
        renderHomePage();
      }
    };
  }

  // 上部ナビゲーションのクリックイベント
  document.querySelectorAll('.top-page-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingFilterJumpToPractice = false;
      switchAppPage(btn.dataset.page);
    });
  });

  const brandEl = document.querySelector('.top-page-brand');
  if (brandEl) {
    brandEl.addEventListener('click', () => {
      pendingFilterJumpToPractice = false;
      switchAppPage('home');
    });
  }

  // ホーム画面内のクリックイベント委譲
  const homeEl = document.getElementById('home-page');
  if (homeEl) {
    homeEl.addEventListener('click', e => {
      const switchBtn = e.target.closest('[data-home-switch]');
      if (switchBtn) {
        homeCategory = switchBtn.dataset.homeSwitch;
        renderHomePage();
        return;
      }

      const actionBtn = e.target.closest('[data-home-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.homeAction;
        if (action === 'rotate-praise') {
          praiseRotationIndex++;
          renderHomePage();
          return;
        }
        if (action === 'open-goal') {
          openGoalDialog(actionBtn);
          return;
        }
        if (action === 'open-review') {
          switchAppPage('review');
          return;
        }
        const kind = actionBtn.dataset.kind || homeCategory;
        const bookId = actionBtn.dataset.book || homeState.lastBook[kind];
        if (action === 'continue-book') {
          startBookFromHome(kind, bookId);
        } else if (action === 'specify-range') {
          specifyBookRangeFromHome(kind, bookId);
        } else if (action === 'solve-weak') {
          startWeakDrillFromHome(kind);
        } else if (action === 'view-weak-list') {
          openWeakListFromHome(kind);
        }
        return;
      }

      const selectCard = e.target.closest('[data-home-select-book]');
      if (selectCard) {
        const kind = selectCard.dataset.kind || homeCategory;
        const bookId = selectCard.dataset.homeSelectBook;
        homeState.lastBook[kind] = bookId;
        saveHomePresets();
        renderHomePage();
      }
    });
  }

  // 復習画面のボタン（苦手ドリル・苦手一覧）
  const reviewEl = document.getElementById('review-page');
  if (reviewEl) {
    reviewEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-home-action]');
      if (!btn || btn.disabled) return;
      const kind = btn.dataset.kind || homeCategory;
      if (btn.dataset.homeAction === 'solve-weak') startWeakDrillFromHome(kind);
      else if (btn.dataset.homeAction === 'view-weak-list') openWeakListFromHome(kind);
    });
  }

  // URLハッシュに応じた初期ページ決定（自動テスト実行時は practice を維持）
  const isAutomatedTest = (() => {
    try { return sessionStorage.getItem('__test_init') === '1'; } catch (e) { return false; }
  })();
  const hash = location.hash.replace('#', '');
  const initialPage = APP_PAGES.includes(hash)
    ? hash
    : (isAutomatedTest ? 'practice' : 'home');

  switchAppPage(initialPage, { skipHash: isAutomatedTest && !hash });

  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#', '');
    if (APP_PAGES.includes(h) && h !== currentAppPage) {
      switchAppPage(h, { skipHash: true });
    }
  });
}

initHomeAndPages();
