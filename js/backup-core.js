// ==================== 学習記録のバックアップ・復元 ====================
// 苦手リスト（復習日を含む）・学習済みの単語・設定・出題の続きを1つの JSON ファイルに書き出し、別の端末などで復元する

const BACKUP_APP_ID = 'toeic-drill';
// ファイル形式の版。形式を変えたら上げて、BACKUP_MIGRATIONS に1つ前の版からの変換を足す
// 版1: 単語の苦手・学習済みがモード共通 / 版2: モードごと / 版3: 通算成績（問題別正誤カウント）を含む / 版4: 文法の出題済みを含む / 版5: 苦手から外した記録（weakDeleted）と苦手の最終更新時刻（u）を含む / 版6: 日別の学習記録（activity）と表示設定（prefs）を含む
const BACKUP_FORMAT = 6;
// 版 n のファイルを版 n+1 に直す変換
const BACKUP_MIGRATIONS = {
  // どのモードの記録か分からないので、4モード全部に写す。
  // 形の正しくない件は写す前に除いて数えておく（写したあとに数えると4倍になる）
  1: backup => {
    const d = backup.data;
    if (!isPlainObject(d)) return { ...backup, format: 2 };
    let invalid = 0;
    let weakWords = d.weakWords;
    let seenWords = d.seenWords;
    if (isPlainObject(weakWords)) {
      const r = sanitizeWeakData(weakWords, isWordKey);
      invalid += r.invalid;
      weakWords = copyToAllModes(r.data);
    }
    if (Array.isArray(seenWords)) {
      const valid = seenWords.filter(w => typeof w === 'string' && isWordKey(w));
      invalid += seenWords.length - valid.length;
      seenWords = copyToAllModes([...new Set(valid)]);
    }
    return { ...backup, format: 2, invalidBeforeMigration: invalid, data: { ...d, weakWords, seenWords } };
  },
  2: backup => {
    const d = backup.data;
    return {
      ...backup,
      format: 3,
      data: isPlainObject(d) ? {
        ...d,
        wordStats: isPlainObject(d.wordStats) ? d.wordStats : {},
        grammarStats: isPlainObject(d.grammarStats) ? d.grammarStats : {},
      } : d
    };
  },
  // 文法の出題済みは無かったので、成績と苦手リストにある問題から作る
  3: backup => {
    const d = backup.data;
    return {
      ...backup,
      format: 4,
      data: isPlainObject(d) ? {
        ...d,
        seenGrammar: Array.isArray(d.seenGrammar) ? d.seenGrammar : seedGrammarSeenFromRaw(d.grammarStats, d.weakGrammar),
      } : d
    };
  },
  // 苦手から外した記録は無かったので空で始める（最終更新時刻 u の無い苦手は、同期で従来どおり比べる）
  4: backup => {
    const d = backup.data;
    return {
      ...backup,
      format: 5,
      data: isPlainObject(d) ? { ...d, weakDeleted: isPlainObject(d.weakDeleted) ? d.weakDeleted : {} } : d
    };
  },
  // 日別の学習記録と表示設定は版5までに無かった。無いものは「今のまま」にしたいので、空で補わず版だけ上げる
  5: backup => ({ ...backup, format: 6 }),
};
const BACKUP_MAX_BYTES = 2 * 1024 * 1024;
// ファイルの中の名前 → この端末の保存先
const RECORD_KEYS = {
  weakWords: WEAK_WORDS_KEY,
  weakGrammar: 'toeic_weak_grammar',
  weakDeleted: WEAK_DELETED_KEY,
  seenWords: SEEN_WORDS_KEY,
  wordStats: WORD_STATS_KEY,
  grammarStats: GRAMMAR_STATS_KEY,
  seenGrammar: GRAMMAR_SEEN_KEY,
  settings: SETTINGS_KEY,
  session: SESSION_KEY,
};
const RECORD_STORAGE_KEYS = Object.values(RECORD_KEYS);
// 日別の学習記録と表示設定。バックアップと復元の取り消しには含めるが、
// Google ドライブ同期の対象（RECORD_KEYS / RECORD_STORAGE_KEYS）には含めない。
// 値は home.js の DAILY_ACTIVITY_KEY / PREFS_KEY と同じ文字列
const EXTRA_KEYS = { activity: 'toeic_daily_activity_v1', prefs: 'toeic_prefs_v1' };
const EXTRA_STORAGE_KEYS = Object.values(EXTRA_KEYS);
const LOCAL_BACKUP_KEYS = [...RECORD_STORAGE_KEYS, ...EXTRA_STORAGE_KEYS];
const BACKUP_UNDO_KEY = 'toeic_backup_undo';     // 直前の復元を取り消すための、復元する前の記録（1回分）
const BACKUP_META_KEY = 'toeic_backup_meta';     // 最後に書き出した日時
const RESTORE_STAMP_KEY = 'toeic_restore_stamp'; // 復元したことを別のタブに知らせる
const NOTICE_KEY = 'toeic_notice';               // 読み込み直したあとに出すお知らせ（sessionStorage）

let backupView = { step: 'home', restoreMode: 'merge' }; // home / confirm（復元の確認）/ undo（取り消しの確認）

function formatDateTime(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- レコードの合算・統合（マージ）ヘルパー ----

// 同じ問題の苦手記録が両側にあるときの選び方。最終更新が新しい方、同じ（または両方とも古い記録で無い）なら streak が大きい方
function pickWeakEntry(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ua = a.u || 0;
  const ub = b.u || 0;
  if (ua !== ub) return ua > ub ? a : b;
  return b.streak > a.streak || (b.streak === a.streak && b.due > a.due) ? b : a;
}

// 苦手の統合。苦手から外した記録（tombs）が最終更新より新しければ、その問題は苦手に戻さない
function mergeWeakStore(cur, inc, tombs, tombPrefix) {
  const out = {};
  new Set([...Object.keys(cur || {}), ...Object.keys(inc || {})]).forEach(k => {
    const picked = pickWeakEntry((cur || {})[k], (inc || {})[k]);
    const deletedAt = tombs[tombPrefix + k] || 0;
    if (deletedAt > 0 && (picked.u || 0) <= deletedAt) return;
    out[k] = picked;
  });
  return out;
}

function mergeWeakByMode(cur, inc, tombs = {}) {
  const out = {};
  VOCAB_MODES.forEach(m => {
    out[m] = mergeWeakStore(cur[m], inc[m], tombs, `w:${m}:`);
  });
  return out;
}

function mergeWeakDeleted(cur, inc) {
  const out = { ...(cur || {}) };
  Object.entries(inc || {}).forEach(([k, t]) => {
    if (!(out[k] >= t)) out[k] = t;
  });
  return out;
}

function mergeSeenByMode(cur, inc) {
  const out = {};
  VOCAB_MODES.forEach(m => {
    const curList = cur[m] ? [...cur[m]] : [];
    const incList = inc[m] || [];
    out[m] = [...new Set([...curList, ...incList])];
  });
  return out;
}

function mergeSeenGrammar(cur, inc) {
  return [...new Set([...(cur || []), ...(inc || [])])];
}

function mergeStatsMap(cur, inc) {
  const out = { ...(cur || {}) };
  Object.entries(inc || {}).forEach(([k, st]) => {
    const c = out[k];
    if (!c || st.a > c.a || (st.a === c.a && st.c > c.c)) {
      out[k] = { a: st.a, c: st.c };
    }
  });
  return out;
}

function getCurrentLocalRecords() {
  return {
    weakWords: state.weakByMode,
    weakGrammar: state.grammarWeakData,
    weakDeleted: state.weakDeleted,
    seenWords: seenSnapshot(),
    wordStats: state.wordStats,
    grammarStats: state.grammarStats,
    seenGrammar: [...state.grammarSeen],
    settings: loadJSON(SETTINGS_KEY, {}),
    session: loadJSON(SESSION_KEY, {}),
  };
}

function mergeBackupRecords(localRec, remoteRec) {
  const mergedWeakDeleted = mergeWeakDeleted(localRec.weakDeleted, remoteRec.weakDeleted);
  const mergedWeakWords = mergeWeakByMode(localRec.weakWords || {}, remoteRec.weakWords || {}, mergedWeakDeleted);
  const mergedSeenWords = mergeSeenByMode(localRec.seenWords || {}, remoteRec.seenWords || {});
  
  const mergedWeakGrammar = mergeWeakStore(localRec.weakGrammar, remoteRec.weakGrammar, mergedWeakDeleted, 'g:');

  const mergedWordStats = mergeStatsMap(localRec.wordStats || {}, remoteRec.wordStats || {});
  const mergedGrammarStats = mergeStatsMap(localRec.grammarStats || {}, remoteRec.grammarStats || {});
  const mergedSeenGrammar = mergeSeenGrammar(localRec.seenGrammar || [], remoteRec.seenGrammar || []);

  return {
    ...remoteRec,
    weakWords: mergedWeakWords,
    weakGrammar: mergedWeakGrammar,
    weakDeleted: mergedWeakDeleted,
    seenWords: mergedSeenWords,
    wordStats: mergedWordStats,
    grammarStats: mergedGrammarStats,
    seenGrammar: mergedSeenGrammar,
    settings: localRec.settings || remoteRec.settings || {},
    session: localRec.session || remoteRec.session || {},
  };
}

function applyMergedRecordsToLocal(mergedRecords) {
  const rawByKey = {};
  Object.entries(RECORD_KEYS).forEach(([name, key]) => {
    if (mergedRecords[name] !== undefined) {
      rawByKey[key] = JSON.stringify(mergedRecords[name]);
    }
  });
  replaceRecords(rawByKey, false, 'クラウド自動同期');
  reloadRecordsFromStorage(false);
}

