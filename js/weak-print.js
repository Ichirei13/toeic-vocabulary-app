// ==================== 苦手単語帳PDF（印刷） ====================
// 苦手リストのシートの「単語帳PDF」から、選んでいるモードの苦手単語を印刷用のページにして別タブで開く。
// 中身の組み立ては src/wordbook.js（StudyCore）。ここは別タブを開いて印刷ダイアログを出すだけ。
// 前提: src/wordbook.js と js/weak-list.js のあとに読み込む。苦手の記録は読むだけで変えない。

// 今日の日付（現地時間）を 2026-11-05 の形で
function wordbookDate() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function openWordbook() {
  const mode = state.weakListMode;
  const items = StudyCore.sortByDue(StudyCore.selectItems(wordWeak(mode), RAW_WORDS));
  if (items.length === 0) return;
  // ポップアップのブロックを避けるため、クリックの中で同期的に開く
  const tab = window.open('', '_blank');
  if (!tab) {
    showToast('別タブを開けませんでした。ポップアップを許可してください');
    return;
  }
  const html = StudyCore.buildDocument({
    items,
    modeLabel: MODE_LABELS[mode],
    date: wordbookDate(),
    options: { red: state.wordbookRed, test: state.wordbookTest },
  });
  tab.document.open();
  tab.document.write(html);
  tab.document.close();
  tab.focus();
  setTimeout(() => tab.print(), 300);
}
