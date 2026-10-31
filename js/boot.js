// ==================== 起動 ====================

restoreSettings();
initFilters();
syncFilterUI();
setApp(state.app);
checkGoogleDriveOnStartup();

// 別のタブで復元・取り消しをしたら、古い記録で上書きしないよう読み込み直す
window.addEventListener('storage', e => {
  if (e.key !== RESTORE_STAMP_KEY) return;
  try {
    sessionStorage.setItem(NOTICE_KEY, '別のタブで学習記録が復元されたため、読み込み直しました。');
  } catch (err) {
    // お知らせを出せなくても読み込み直しは行う
  }
  location.reload();
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
