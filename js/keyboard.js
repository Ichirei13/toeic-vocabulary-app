// ==================== キーボード操作（PC 向け） ====================
// 1〜5 (テンキー・全角・A〜E): 選択肢 / 0: わからない / Enter・スペース: 次へ
// カードモード: スペース: めくる / Enter: めくる・覚えた / 1・←: まだ / 2・→: 覚えた
// Esc: 下から出るシートを閉じる

function isShown(el) {
  return el && el.style.display !== 'none' && el.offsetParent !== null;
}

document.addEventListener('keydown', e => {
  // 修飾キー（Command, Ctrl, Alt）が押されている時はブラウザ操作を優先
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (document.getElementById('filter-nudge-modal') && document.getElementById('filter-nudge-modal').classList.contains('open')) {
    if (e.key === 'Escape') {
      dismissNudge();
      return;
    }
  }
  if (document.getElementById('filter-drawer') && document.getElementById('filter-drawer').classList.contains('open')) {
    if (e.key === 'Escape') closeFilterSheet();
    return;
  }
  if (document.getElementById('bottom-sheet').classList.contains('open')) {
    if (e.key === 'Escape') closeSheet();
    return;
  }
  const t = e.target;
  // テキスト入力中はキーボードショートカットを発火させない
  if ((t.tagName === 'INPUT' && !t.disabled) || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
  if (typeof currentAppPage !== 'undefined' && currentAppPage !== 'practice') return;

  const dk = document.getElementById('dont-know-btn');
  const nextBtn = document.getElementById('next-btn');
  const press = btn => {
    e.preventDefault();
    btn.click();
  };

  // 全角数字やテンキー対応のための正規化
  const fullToHalf = { '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '０': '0' };
  const rawKey = fullToHalf[e.key] || e.key;

  // 単語カードモード
  if (state.app === 'vocab' && state.mode === 'flash' && document.getElementById('flash-card')) {
    if (rawKey === ' ' || e.code === 'Space') return press(document.getElementById('flash-card'));
    if ((rawKey === '1' || e.code === 'Digit1' || e.code === 'Numpad1' || e.key === 'ArrowLeft') && isShown(dk)) return press(dk);
    if ((rawKey === '2' || e.code === 'Digit2' || e.code === 'Numpad2' || e.key === 'ArrowRight' || e.key === 'Enter') && isShown(nextBtn)) return press(nextBtn);
    return;
  }

  // 選択肢インデックス判定（1〜5, テンキー1〜5, A〜Eキー）
  let choiceIdx = -1;
  if (/^[1-5]$/.test(rawKey)) {
    choiceIdx = Number(rawKey) - 1;
  } else if (/^Digit[1-5]$/.test(e.code)) {
    choiceIdx = Number(e.code.replace('Digit', '')) - 1;
  } else if (/^Numpad[1-5]$/.test(e.code)) {
    choiceIdx = Number(e.code.replace('Numpad', '')) - 1;
  } else if (/^[a-eA-E]$/.test(rawKey)) {
    const map = { a: 0, b: 1, c: 2, d: 3, e: 4, A: 0, B: 1, C: 2, D: 3, E: 4 };
    choiceIdx = map[rawKey];
  }

  // 回答前かどうか判定（内部フラグまたは「わからない」ボタンの表示）
  const isAnswering = state.app === 'grammar'
    ? !state.grammarAnswered
    : (!state.answered && (state.mode === 'e2j' || state.mode === 'j2e'));

  if (choiceIdx >= 0) {
    const buttons = document.querySelectorAll('#choices-container .choice-btn');
    const btn = buttons[choiceIdx];
    if (btn && (isAnswering || isShown(dk))) {
      press(btn);
    }
  } else if ((rawKey === '0' || e.code === 'Digit0' || e.code === 'Numpad0') && (isAnswering || isShown(dk))) {
    if (isShown(dk)) press(dk);
  } else if ((e.key === 'Enter' || rawKey === ' ' || e.code === 'Space') && isShown(nextBtn)) {
    press(nextBtn);
  }
});

