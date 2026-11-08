// ==================== 起動 ====================

// 順序に意味がある: 保存した設定を state に戻す → 絞り込みシートの部品を作る → 表示を state に合わせる → 最初の問題を出す
restoreSettings();
initFilters();
syncFilterUI();
setApp(state.app);
checkGoogleDriveOnStartup();

// 保存に失敗したら（容量不足・プライベートモードなど）、記録が残っていないことを1度だけ知らせる。
// 失敗は1問ごとに続くので、2回目以降は出さない。学習はそのまま続けられる
let saveFailureNoticed = false;
onStorageSaveFailed(() => {
  if (saveFailureNoticed) return;
  saveFailureNoticed = true;
  showToast('⚠️ 保存できませんでした。空き容量やプライベートモードを確認してください。学習記録はバックアップから戻せます');
});

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
