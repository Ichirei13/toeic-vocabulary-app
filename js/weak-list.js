// ==================== 苦手リスト ====================

function renderWeakList() {
  if (state.app === 'grammar') renderGrammarWeakList();
  else renderWordWeakList();
  document.getElementById('weak-list-content').insertAdjacentHTML('afterbegin', backupEntryHtml());
}

// items は { entry } を持つ配列。order は「ABC順」「本・章順」の比べ方
function sortWeakItems(items, order) {
  const compare = {
    new: (a, b) => b.entry.added - a.entry.added,
    old: (a, b) => a.entry.added - b.entry.added,
    due: (a, b) => a.entry.due - b.entry.due,
    order,
  }[state.weakSort] || order;
  return items.sort(compare);
}

// 件数・要復習数と並び替えボタン（単語・文法共通）
function weakListHeader(items, orderLabel) {
  const due = items.filter(x => isDue(x.entry)).length;
  const sorts = [['new', '新しい順'], ['old', '古い順'], ['due', '復習日順'], ['order', orderLabel]];
  return `
    <div class="weak-list-summary">
      苦手 ${items.length}件 ・ 要復習 <strong>${due}</strong>件<br>
      復習日以降に正解するたびに ${REVIEW_INTERVALS.join('日→')}日後 と間隔が延び、最後も正解すると苦手から外れます
    </div>
    <div class="filter-row" style="flex-wrap:wrap;margin-bottom:4px;">
      ${sorts.map(([k, label]) => `<button class="chip ${state.weakSort === k ? 'active' : ''}" data-weak-sort="${k}">${label}</button>`).join('')}
    </div>`;
}

function renderWordWeakList() {
  const container = document.getElementById('weak-list-content');
  const mode = state.weakListMode;
  const data = wordWeak(mode);
  const items = Object.keys(data)
    .map(k => ({ key: k, entry: data[k], word: RAW_WORDS.find(x => x.w === k) }))
    .filter(x => x.word);
  document.getElementById('sheet-title').innerText = `苦手リスト ${MODE_LABELS[mode]}（${items.length}）`;
  // 苦手はモードごとに記録しているので、他のモードの記録も切り替えて見られるようにする
  let html = `<div class="filter-row weak-mode-row">
    ${VOCAB_MODES.map(m => `<button class="chip ${m === mode ? 'active' : ''}" data-weak-mode="${m}">${MODE_LABELS[m]} ${Object.keys(wordWeak(m)).length}</button>`).join('')}
  </div>`;
  if (items.length === 0) {
    container.innerHTML = html + `<p>${MODE_LABELS[mode]}の苦手な単語はありません。</p>`;
    return;
  }
  sortWeakItems(items, (a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));

  html += weakListHeader(items, 'ABC順');
  items.forEach(({ key, entry, word }) => {
    const stText = wordStatLabel(key, mode);
    html += `
      <div class="weak-item">
        <div>
          <div class="weak-word">${escapeHtml(word.w)}${stText ? ` <span style="font-family:sans-serif;font-size:11px;font-weight:normal;color:var(--muted);">（${stText}）</span>` : ''}</div>
          <div class="weak-meaning">${escapeHtml(word.m)}</div>
          ${dueLabel(entry)}
        </div>
        <button class="del-btn" data-remove-weak="${escapeHtml(key)}">削除</button>
      </div>
    `;
  });
  container.innerHTML = html;
}

function removeWeak(key) {
  if (state.app === 'grammar') {
    delete state.grammarWeakData[key];
    markWeakDeleted(`g:${key}`);
    saveGrammarWeakData();
  } else {
    delete wordWeak(state.weakListMode)[key];
    markWeakDeleted(`w:${state.weakListMode}:${key}`);
    saveWeakData();
  }
  renderWeakList();
}

