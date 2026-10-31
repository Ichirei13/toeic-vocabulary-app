// ---- 書き出し ----

// forDrive: Google ドライブ同期用。同期の対象を増やさず、まだ更新していない端末が読めるよう、
// 従来どおり版 5・日別記録と表示設定なしで作る。ファイルへの書き出しとコピーは版 6（日別記録・表示設定つき）
function buildBackup({ forDrive = false } = {}) {
  const data = {
    weakWords: state.weakByMode,
    weakGrammar: state.grammarWeakData,
    weakDeleted: state.weakDeleted,
    seenWords: seenSnapshot(),
    wordStats: state.wordStats,
    grammarStats: state.grammarStats,
    seenGrammar: [...state.grammarSeen],
    settings: settingsSnapshot(),
    session: sessionSnapshot(),
  };
  if (!forDrive) {
    data.activity = loadJSON(EXTRA_KEYS.activity, {});
    data.prefs = loadJSON(EXTRA_KEYS.prefs, {});
  }
  return {
    app: BACKUP_APP_ID,
    format: forDrive ? 5 : BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    appData: { words: RAW_WORDS.length, grammar: RAW_GRAMMAR.length },
    data,
  };
}

function backupFile() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return new File([JSON.stringify(buildBackup(), null, 2)], `toeic-drill-backup-${stamp}.json`, { type: 'application/json' });
}

function markExported() {
  saveJSON(BACKUP_META_KEY, { ...loadJSON(BACKUP_META_KEY, {}), lastExportAt: Date.now() });
}

function downloadBackup() {
  const file = backupFile();
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  markExported();
}

// スマホの共有シート（「ファイルに保存」や別の端末へ送る）でファイルを渡せる端末か
function canShareBackup() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'backup.json', { type: 'application/json' })] }));
  } catch (e) {
    return false;
  }
}

async function shareBackup() {
  try {
    await navigator.share({ files: [backupFile()], title: 'TOEIC Drill の学習記録' });
    markExported();
    backupView = { step: 'home', success: '共有しました。' };
  } catch (e) {
    if (e.name === 'AbortError') return; // 共有シートを閉じただけ
    backupView = { step: 'home', error: '共有できませんでした。「バックアップを書き出す」を使ってください。' };
  }
  refreshBackupSheet();
}

// ---- 読み込みと検証（ここでは何も書き込まない） ----

function fail(error) {
  return { ok: false, error };
}

// 別の端末の時計がずれていても、追加日が未来になったり復習日がずっと先になったりしないようにする
function clampImportedTimes(data) {
  const latestDue = startOfToday() + (REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1] + 1) * DAY_MS;
  Object.values(data).forEach(e => {
    e.added = Math.min(e.added, Date.now());
    e.due = Math.min(e.due, latestDue);
    if (e.u !== undefined) e.u = Math.min(e.u, Date.now());
  });
  return data;
}

// バックアップ・取り消し用の記録の成績と苦手リストから、出題済みの初期値を作る。
// 端末側（loadGrammarSeen）と同じく、形の正しくない記録は除いてから数える
function seedGrammarSeenFromRaw(stats, weak) {
  return grammarIdsFrom(sanitizeStatsMap(stats).data, isPlainObject(weak) ? sanitizeWeakData(weak, isGrammarKey).data : {});
}

// 文法の出題済み（問題番号の配列）から、番号として正しいものだけを重複なしで残す
function sanitizeSeenGrammar(raw) {
  if (!Array.isArray(raw)) return { data: [], invalid: 0 };
  const valid = raw.filter(isGrammarId);
  return { data: [...new Set(valid)], invalid: raw.length - valid.length }; // 重複は不正に数えない（単語側と同じ）
}

function sanitizeStatsMap(raw) {
  const data = {};
  let invalid = 0;
  if (!isPlainObject(raw)) return { data, invalid: 0 };
  Object.keys(raw).forEach(k => {
    const e = raw[k];
    if (e && typeof e === 'object' && Number.isFinite(Number(e.a)) && Number(e.a) > 0) {
      const a = Math.max(1, Math.floor(Number(e.a)));
      const c = Math.min(a, Math.max(0, Math.floor(Number(e.c) || 0)));
      data[String(k)] = { a, c };
    } else {
      invalid++;
    }
  });
  return { data, invalid };
}

// バックアップの中身を確かめ、復元に使う記録と確認画面に出す件数を返す。全体の形が違えばファイルごと断る
function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch (e) {
    return fail('JSON として読めないファイルです。');
  }
  if (!isPlainObject(backup) || (backup.app !== BACKUP_APP_ID && backup.app !== 'toeic_practice_backup')) {
    return fail('TOEIC Drill のバックアップファイルではありません。');
  }

  // 独自形式や互換形式の変換
  if (backup.app === 'toeic_practice_backup') {
    const rawData = backup.data || {};
    backup = {
      app: BACKUP_APP_ID,
      format: BACKUP_FORMAT,
      exportedAt: backup.exportedAt || new Date().toISOString(),
      data: {
        weakWords: isPlainObject(rawData.weakWords) ? copyToAllModes(rawData.weakWords) : {},
        weakGrammar: rawData.weakGrammar || {},
        weakDeleted: {},
        seenWords: Array.isArray(rawData.seenWords) ? copyToAllModes(rawData.seenWords) : {},
        wordStats: rawData.wordStats || {},
        grammarStats: rawData.grammarStats || {},
        seenGrammar: seedGrammarSeenFromRaw(rawData.grammarStats, rawData.weakGrammar),
        settings: rawData.settings,
        session: rawData.session,
      }
    };
  }

  if (!Number.isInteger(backup.format) || backup.format < 1) return fail('ファイル形式の版が読み取れません。');
  if (backup.format > BACKUP_FORMAT) {
    return fail('新しいバージョンのアプリで書き出したファイルです。アプリを最新にしてから読み込んでください。');
  }
  let invalidBeforeMigration = 0; // 古い版を変換したときに除いた件数（変換を通ったときだけ数える）
  while (backup.format < BACKUP_FORMAT) {
    const migrate = BACKUP_MIGRATIONS[backup.format];
    if (!migrate) return fail('この古い形式のファイルには対応していません。');
    backup = migrate(backup);
    invalidBeforeMigration += Number.isInteger(backup.invalidBeforeMigration) ? backup.invalidBeforeMigration : 0;
  }

  const d = backup.data;
  if (!isPlainObject(d)) return fail('学習記録のデータが入っていません。');
  if (!isPlainObject(d.weakWords) || !isPlainObject(d.weakGrammar) || !isPlainObject(d.seenWords)) {
    return fail('苦手リストか学習済みの単語の記録が欠けているか、形が正しくありません。');
  }
  if (!Array.isArray(d.seenGrammar)) return fail('文法の出題済みの記録が欠けているか、形が正しくありません。');
  if (!isPlainObject(d.weakDeleted)) return fail('苦手から外した記録が欠けているか、形が正しくありません。');
  if (d.settings !== undefined && !isPlainObject(d.settings)) return fail('設定の記録の形が正しくありません。');
  if (d.session !== undefined && !isPlainObject(d.session)) return fail('出題の続きの記録の形が正しくありません。');
  if (d.activity !== undefined && !isPlainObject(d.activity)) return fail('日別の学習記録の形が正しくありません。');
  if (d.prefs !== undefined && !isPlainObject(d.prefs)) return fail('表示設定の形が正しくありません。');

  const words = sanitizeWeakByMode(d.weakWords);
  const grammar = sanitizeWeakData(d.weakGrammar, isGrammarKey);
  const seen = sanitizeSeenByMode(d.seenWords);
  const wordStats = sanitizeStatsMap(d.wordStats);
  const grammarStats = sanitizeStatsMap(d.grammarStats);
  const seenGrammar = sanitizeSeenGrammar(d.seenGrammar);
  const weakDeleted = sanitizeWeakDeleted(d.weakDeleted);
  const activity = d.activity === undefined ? null : StudyCore.sanitizeActivity(d.activity);
  const knownWords = new Set(RAW_WORDS.map(w => w.w));
  const weakWordKeys = new Set(VOCAB_MODES.flatMap(m => Object.keys(words.data[m])));
  const exportedAt = Date.parse(backup.exportedAt);

  return {
    ok: true,
    exportedAt: Number.isFinite(exportedAt) ? exportedAt : null,
    // 設定と出題の続きの中身は、読み込んだあとに restoreSettings / restoreSession が1項目ずつ確かめる
    records: {
      weakWords: Object.fromEntries(VOCAB_MODES.map(m => [m, clampImportedTimes(words.data[m])])),
      weakGrammar: clampImportedTimes(grammar.data),
      weakDeleted: weakDeleted.data,
      seenWords: seen.data,
      wordStats: wordStats.data,
      grammarStats: grammarStats.data,
      seenGrammar: seenGrammar.data,
      settings: d.settings,
      session: d.session,
    },
    // 日別の学習記録と表示設定。キーが無いファイル（版5以前など）は undefined のまま＝復元しても今のまま
    extras: {
      activity: activity ? { days: activity.days } : undefined,
      // 正しい項目だけ取り込む。ファイルに無い項目・壊れた項目は「今のまま」にする
      prefs: d.prefs === undefined ? undefined : {
        ...(StudyCore.isGoal(d.prefs.dailyGoal) ? { dailyGoal: d.prefs.dailyGoal } : {}),
        ...(StudyCore.paceTargetPatch(d.prefs.paceTarget) ? { paceTarget: StudyCore.paceTargetPatch(d.prefs.paceTarget) } : {}),
        ...(typeof d.prefs.liveTimer === 'boolean' ? { liveTimer: d.prefs.liveTimer } : {}),
      },
    },
    invalid: words.invalid + grammar.invalid + seen.invalid + wordStats.invalid + grammarStats.invalid + seenGrammar.invalid + weakDeleted.invalid + invalidBeforeMigration + (activity ? activity.invalid : 0),
    // 今のデータに無い単語・問題も、別の端末のほうがデータが新しい場合に備えて消さずに残す
    unknownWords: [...weakWordKeys].filter(k => !knownWords.has(k)).length,
    unknownGrammar: [...new Set([...Object.keys(grammar.data).map(Number), ...seenGrammar.data])].filter(id => !GRAMMAR_BY_ID.has(id)).length,
  };
}

async function readBackupFile(file) {
  if (file.size === 0) return fail('空のファイルです。');
  if (file.size > BACKUP_MAX_BYTES) return fail('ファイルが大きすぎます（2MB まで）。TOEIC Drill のバックアップファイルか確かめてください。');
  try {
    return parseBackup(await file.text());
  } catch (e) {
    return fail('ファイルを読み込めませんでした。');
  }
}

// ---- 復元と取り消し ----

function writeRaw(rawByKey) {
  Object.entries(rawByKey).forEach(([k, raw]) => {
    if (raw === null) localStorage.removeItem(k);
    else localStorage.setItem(k, raw);
  });
}

// 記録をまとめて書き換える。途中で失敗したら書き換える前に戻し、理由を Error で知らせる。
// saveUndo が true なら、書き換える前の記録を「直前の復元を取り消す」用に残す（残せなければ何も変えずに中止）
function replaceRecords(rawByKey, saveUndo, label) {
  let before;
  let undoBefore; // 前の復元で残した取り消し用の記録。失敗したときはこれも元に戻す
  try {
    // 日別記録・表示設定は、この復元が書き換えるときだけ取っておく（触らないものまで取り消しで巻き戻さない）
    const beforeKeys = [...RECORD_STORAGE_KEYS, ...EXTRA_STORAGE_KEYS.filter(k => Object.hasOwn(rawByKey, k))];
    before = Object.fromEntries(beforeKeys.map(k => [k, localStorage.getItem(k)]));
    undoBefore = localStorage.getItem(BACKUP_UNDO_KEY);
  } catch (e) {
    throw new Error(`このブラウザでは記録を読み書きできないため、${label}できません。`);
  }
  if (saveUndo) {
    try {
      localStorage.setItem(BACKUP_UNDO_KEY, JSON.stringify({ savedAt: Date.now(), records: before }));
    } catch (e) {
      throw new Error(`空き容量が足りないため、${label}を中止しました。記録は元のままです。`);
    }
  }
  try {
    writeRaw(rawByKey);
  } catch (e) {
    try {
      // 先に取り消し用の記録を外して空きを作ってから、元の記録を書き戻す
      if (saveUndo) localStorage.removeItem(BACKUP_UNDO_KEY);
      writeRaw(before);
      if (saveUndo) writeRaw({ [BACKUP_UNDO_KEY]: undoBefore });
    } catch (e2) {
      throw new Error(`${label}に失敗し、元の記録にも戻せませんでした。書き出しておいたバックアップファイルから、もう一度復元してください。`);
    }
    throw new Error(`保存できなかったため（空き容量不足など）、${label}を中止しました。記録は元のままです。`);
  }
}

// クラウド同期で苦手・出題済みの記録が変わると、苦手の絞り込み（苦手のみ・苦手+未・要復習）に合う問題も変わる。
// まだ1問も解いていないときだけ、合う問題が変わっていれば出題し直す。
// 解いている最中の画面は作り直さない（同期は回答のたびに走るので、進み具合が消えてしまう）
function refreshPoolAfterRecordSync() {
  const isGrammar = state.app === 'grammar';
  if (isGrammar ? state.grammarWeakFilter === 'all' : state.weakFilter === 'all') return;
  const untouched = isGrammar
    ? state.grammarAnsweredCount === 0 && state.currentGrammarIndex === 0
    : state.answeredCount === 0 && state.currentIndex === 0;
  if (!untouched || state.reviewIndex !== null) return;

  const pool = isGrammar ? state.grammarPool : state.pool;
  const next = isGrammar ? filteredGrammar() : filteredWords();
  const key = item => (isGrammar ? item.id : item.w);
  const current = new Set(pool.map(key));
  if (next.length === current.size && next.every(item => current.has(key(item)))) return;
  if (isGrammar) applyGrammarFilters(); else applyFilters();
}

// 書き換えた記録を読み込み直して画面に反映し、別のタブにも知らせる。
// 復元ではなくクラウド同期のとき（isRestore が false）は、設定と出題の続きは変わらないので、
// 解いている最中の画面を作り直さず、別のタブも読み込み直させない
function reloadRecordsFromStorage(isRestore = true) {
  state.weakByMode = loadWeakByMode();
  state.grammarWeakData = loadWeakData('toeic_weak_grammar', isGrammarKey);
  state.weakDeleted = loadWeakDeleted();
  state.seenByMode = loadSeenByMode();
  state.wordStats = loadStatsData(WORD_STATS_KEY);
  state.grammarStats = loadStatsData(GRAMMAR_STATS_KEY);
  state.grammarSeen = loadGrammarSeen();
  if (isRestore) {
    restoreSettings();
    syncFilterUI();
    setApp(state.app);
    if (typeof reloadHomeExtras === 'function') reloadHomeExtras();
  }
  updateWeakBadge();
  updateGrammarWeakBadge();
  if (!isRestore) {
    refreshPoolAfterRecordSync();
    return;
  }
  try {
    localStorage.setItem(RESTORE_STAMP_KEY, String(Date.now()));
  } catch (e) {
    // 別のタブに知らせられなくても、この画面の復元は終わっている
  }
}

function runRestore() {
  const pending = backupView.pending;
  if (!pending) return;
  const preExport = document.getElementById('backup-pre-export');
  if (preExport && preExport.checked) downloadBackup();

  const isOverwrite = backupView.restoreMode === 'overwrite';
  const targetRecords = isOverwrite
    ? pending.records
    : mergeBackupRecords(getCurrentLocalRecords(), pending.records);

  const rawByKey = {};
  Object.entries(RECORD_KEYS).forEach(([name, key]) => {
    if (targetRecords[name] !== undefined) rawByKey[key] = JSON.stringify(targetRecords[name]);
  });
  // 日別の学習記録と表示設定。ファイルに無ければ今のまま。統合では同じ日の回答数の大きい方・目標は今の値を優先
  const extras = pending.extras || {};
  if (extras.activity !== undefined) {
    const curDays = StudyCore.sanitizeActivity(loadJSON(EXTRA_KEYS.activity, {})).days;
    const days = isOverwrite ? extras.activity.days : StudyCore.mergeActivity(curDays, extras.activity.days);
    rawByKey[EXTRA_KEYS.activity] = JSON.stringify({ days });
  }
  if (extras.prefs !== undefined) {
    // ファイルに無い項目は今のまま。同じ項目は、上書きならファイルの値、統合なら今の値を使う
    const curPrefs = loadJSON(EXTRA_KEYS.prefs, {});
    const mergedPrefs = isOverwrite ? { ...curPrefs, ...extras.prefs } : { ...extras.prefs, ...curPrefs };
    if (extras.prefs.paceTarget && curPrefs.paceTarget) {
      mergedPrefs.paceTarget = isOverwrite ? { ...curPrefs.paceTarget, ...extras.prefs.paceTarget } : { ...extras.prefs.paceTarget, ...curPrefs.paceTarget };
    }
    rawByKey[EXTRA_KEYS.prefs] = JSON.stringify(mergedPrefs);
  }
  try {
    replaceRecords(rawByKey, true, isOverwrite ? '上書き復元' : '統合復元');
  } catch (e) {
    backupView = { step: 'home', error: e.message };
    renderBackupSheet();
    return;
  }
  reloadRecordsFromStorage();
  backupView = { step: 'home', success: isOverwrite ? 'バックアップから上書き復元しました。' : 'バックアップデータを統合して復元しました。' };
  renderBackupSheet();
}

function loadUndo() {
  const undo = loadJSON(BACKUP_UNDO_KEY, {});
  if (!Number.isFinite(undo.savedAt) || !isPlainObject(undo.records)) return null;
  // 文法の出題済みを足す前に残した記録には、このキーが無い（復元前に保存が無かったのと同じ扱いにする）
  const valid = RECORD_STORAGE_KEYS.every(k => undo.records[k] === null || typeof undo.records[k] === 'string'
    || ((k === GRAMMAR_SEEN_KEY || k === WEAK_DELETED_KEY) && undo.records[k] === undefined));
  // 日別の学習記録・表示設定は、以前の取り消し用の記録には無い（undefined なら取り消しでも触らない）
  const extrasValid = EXTRA_STORAGE_KEYS.every(k => undo.records[k] === undefined || undo.records[k] === null || typeof undo.records[k] === 'string');
  return valid && extrasValid ? undo : null;
}

function runUndo() {
  const undo = loadUndo();
  if (!undo) {
    backupView = { step: 'home', error: '取り消せる復元がありません。' };
    return renderBackupSheet();
  }
  try {
    // 本体の記録は、無ければ「保存が無かった」として外す。日別記録・表示設定は、取り消し用の記録に無ければ触らない
    const restoreKeys = [...RECORD_STORAGE_KEYS, ...EXTRA_STORAGE_KEYS.filter(k => undo.records[k] !== undefined)];
    replaceRecords(Object.fromEntries(restoreKeys.map(k => [k, undo.records[k] === undefined ? null : undo.records[k]])), false, '取り消し');
  } catch (e) {
    backupView = { step: 'home', error: e.message };
    return renderBackupSheet();
  }
  try {
    localStorage.removeItem(BACKUP_UNDO_KEY);
  } catch (e) {
    // 消せなくても、もう一度取り消すと同じ記録に戻るだけ
  }
  reloadRecordsFromStorage();
  backupView = { step: 'home', success: '復元する前の記録に戻しました。' };
  renderBackupSheet();
}

