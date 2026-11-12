// ==================== 起動 ====================

// 順序に意味がある: 保存した設定を state に戻す → 絞り込みシートの部品を作る → 表示を state に合わせる → 最初の問題を出す
restoreSettings();
initFilters();
syncFilterUI();
setApp(state.app);
checkGoogleDriveOnStartup();

// 保存に失敗したら（容量不足・プライベートモードなど）、記録が残っていないことを知らせる。
// 失敗は1問ごとに続くので、保存できていないキーがある間は、2回目以降は出さない。学習はそのまま続けられる。
// 保存できていないキーを覚えておき、そのキーがまた保存できたら外す。全部外れたあとの失敗は、あらためて知らせる
const failedSaveKeys = new Set();
onStorageSaveFailed(key => {
  const alreadyNoticed = failedSaveKeys.size > 0;
  failedSaveKeys.add(key);
  if (alreadyNoticed) return;
  showToast('⚠️ 保存できませんでした。空き容量やプライベートモードを確認してください。学習記録はバックアップから戻せます');
});
onStorageSaved(key => failedSaveKeys.delete(key));

// 起動時に読めなかった記録があれば知らせる（元の文字列は word-stats.js の keepBrokenRecords が残している）
if (brokenRecordKeys.length > 0) {
  showToast('⚠️ 読み込めない学習記録がありました。その分は空から始めます。元のデータは消さずに残してあります');
}

// 別のタブが学習記録を保存したら、このタブのメモリを保存領域から読み込み直す。
// どのタブも、起動時に読んだ記録を丸ごと書き戻す。読み込み直さないと、次の保存で別のタブの回答を消してしまう。
// 設定と出題の続きはタブごとの画面の状態なので対象にしない。ポモドーロの設定も対象にしない（止めているタイマーの残り時間を戻さないため）
const CROSS_TAB_KEYS = [
  ...RECORD_STORAGE_KEYS.filter(k => k !== SETTINGS_KEY && k !== SESSION_KEY),
  EXTRA_KEYS.activity, EXTRA_KEYS.prefs, EXTRA_KEYS.pomoLog,
];
let crossTabReloadTimer = null;
function reloadRecordsSavedElsewhere() {
  clearTimeout(crossTabReloadTimer);
  crossTabReloadTimer = null;
  // 保存できていない記録があるタブは、メモリにしかない回答を持っている。読み込み直すとそれを捨ててしまうので、そのままにする
  if (failedSaveKeys.size > 0) return;
  // 同期のときと同じ読み込み直し。解いている最中の画面は作り直さない
  reloadRecordsFromStorage(false);
  if (typeof reloadActivityAndPrefs === 'function') reloadActivityAndPrefs();
  if (typeof reloadPomoLog === 'function') reloadPomoLog();
}

window.addEventListener('storage', e => {
  // 別のタブで復元・取り消しをしたら、設定と出題の続きも変わっているので、ページごと読み込み直す
  if (e.key === RESTORE_STAMP_KEY) {
    clearTimeout(crossTabReloadTimer);
    try {
      sessionStorage.setItem(NOTICE_KEY, '別のタブで学習記録が復元されたため、読み込み直しました。');
    } catch (err) {
      // お知らせを出せなくても読み込み直しは行う
    }
    location.reload();
    return;
  }
  // key が null なのは、保存領域がまるごと消されたとき
  if (e.key !== null && !CROSS_TAB_KEYS.includes(e.key)) return;
  // 1 回の回答でいくつものキーが変わるので、少し待ってまとめて 1 回だけ読み込み直す
  if (crossTabReloadTimer === null) crossTabReloadTimer = setTimeout(reloadRecordsSavedElsewhere, 50);
});
// 裏にいた間の通知を受け取れていないことがあるので、画面に戻ってきたときにも読み込み直す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reloadRecordsSavedElsewhere();
});
window.addEventListener('pageshow', e => {
  if (e.persisted) reloadRecordsSavedElsewhere();
});

try {
  const notice = sessionStorage.getItem(NOTICE_KEY);
  if (notice) {
    sessionStorage.removeItem(NOTICE_KEY);
    showToast(notice);
  }
} catch (e) {
  // sessionStorage が使えなければお知らせを出さないだけ
}

// オフラインでも開けるようにする（ファイルを直接開いたときは使えないので登録しない）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
