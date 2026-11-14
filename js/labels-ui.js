// ==================== ラベリング機能（画面） ====================
// 解答後の 🏷 ボタン（タップで最後に使ったラベルを付ける・付いていればラベルを選ぶ画面・長押しでも選ぶ画面）。
// 記録の変更は js/labels.js の applyLabelChange を通す。苦手の記録には触れない。
// 前提: js/labels.js と js/settings.js（openSheet）のあとに読み込む。最上位で実行するのはクリックの登録だけ

const LABEL_LONG_PRESS_MS = 500;

// ---- 🏷 ボタン ----

// ラベルを付ける対象（見直し中ならその問題）。出題が無ければ null
function currentLabelTarget() {
  const kind = state.app === 'grammar' ? 'grammar' : 'vocab';
  const pool = kind === 'grammar' ? state.grammarPool : state.pool;
  const index = state.reviewIndex !== null ? state.reviewIndex : (kind === 'grammar' ? state.currentGrammarIndex : state.currentIndex);
  const item = pool && pool[index];
  return item ? { kind, key: labelItemKey(kind, item) } : null;
}

// 回答のあと（見直し中・単語カードをめくったあとも）だけ出す
function labelButtonShouldShow() {
  if (!currentLabelTarget()) return false;
  if (state.reviewIndex !== null) return true;
  if (state.app === 'grammar') return !!state.grammarAnswered;
  if (state.answered) return true;
  const card = document.getElementById('flash-card');
  return state.mode === 'flash' && !!card && card.classList.contains('flipped');
}

function hideLabelButton() {
  const btn = document.getElementById('label-btn');
  if (btn) btn.style.display = 'none';
}

function refreshLabelButton() {
  const btn = document.getElementById('label-btn');
  if (!btn) return;
  if (!labelButtonShouldShow()) return hideLabelButton();
  const ids = StudyCore.labelsOf(state.labels, currentLabelTarget().key);
  const names = StudyCore.activeLabels(state.labels).filter(l => ids.includes(l.id)).map(l => l.name);
  btn.style.display = 'flex';
  btn.classList.toggle('on', ids.length > 0);
  document.getElementById('label-btn-text').textContent = ids.length === 1 ? names[0] : ids.length > 1 ? `${ids.length}件` : '';
  btn.setAttribute('aria-label', ids.length ? `ラベル（${names.join('、')}）` : 'ラベルを付ける');
}

function labelName(id) {
  const l = StudyCore.activeLabels(state.labels).find(x => x.id === id);
  return l ? l.name : '';
}

// 付けたラベルを、次のワンタップで付けるラベルにする
function rememberLastLabel(id) {
  if (state.lastLabelId === id) return;
  state.lastLabelId = id;
  saveSettings();
}

// タップ（と L キー）。付いていなければ最後に使ったラベルを付け、付いていれば選ぶ画面を開く（外さない）
function quickLabel() {
  const target = currentLabelTarget();
  if (!target) return;
  if (StudyCore.labelsOf(state.labels, target.key).length > 0) return openLabelPicker(target);
  const id = StudyCore.resolveLastUsed(state.labels, state.lastLabelId);
  if (!id) return openLabelPicker(target);
  applyLabelChange(StudyCore.setLabel(state.labels, id, target.key, true, Date.now()));
  rememberLastLabel(id);
  refreshLabelButton();
  showActionToast(`「${labelName(id)}」に追加しました`, '変更', () => openLabelPicker(target));
}

// 画面下のお知らせに、ボタンを1つ付けたもの（出し方・消え方は showToast と同じ）
function showActionToast(message, actionLabel, onAction) {
  document.querySelectorAll('.toast.action-toast').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = 'toast action-toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-action';
  btn.textContent = actionLabel;
  btn.onclick = () => { el.remove(); onAction(); };
  el.append(text, btn);
  document.getElementById('app').appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3500);
  setTimeout(() => el.remove(), 4000);
}

// 長押しで選ぶ画面を開いたら、指を離したあとのクリックは1回だけ無視する
(function bindLabelButton() {
  const btn = document.getElementById('label-btn');
  if (!btn) return;
  let timer = null;
  let longPressed = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  btn.addEventListener('pointerdown', () => {
    longPressed = false;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      longPressed = true;
      openLabelPicker(currentLabelTarget());
    }, LABEL_LONG_PRESS_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => btn.addEventListener(type, cancel));
  btn.addEventListener('contextmenu', e => e.preventDefault());
  btn.addEventListener('click', () => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    quickLabel();
  });
})();

// ---- ラベルを選ぶ画面（下から出るシート） ----

let labelPickerTarget = null;
let labelPickerError = '';

function openLabelPicker(target = currentLabelTarget()) {
  if (!target) return;
  labelPickerTarget = target;
  labelPickerError = '';
  openSheet('ラベルを選ぶ', renderLabelPicker, false);
}

function renderLabelPicker() {
  const container = document.getElementById('weak-list-content');
  const on = new Set(StudyCore.labelsOf(state.labels, labelPickerTarget.key));
  const rows = StudyCore.activeLabels(state.labels).map(l => `
    <label class="label-check">
      <input type="checkbox" data-label-toggle="${escapeHtml(l.id)}"${on.has(l.id) ? ' checked' : ''}>
      <span>${escapeHtml(l.name)}</span>
    </label>`).join('');
  container.innerHTML = `
    <div class="label-picker">
      ${rows || '<p class="label-empty">ラベルがありません。下で作れます。</p>'}
      <div class="label-new">
        <input id="label-new-name" class="label-name-input" type="text" maxlength="40" placeholder="新しいラベル" autocomplete="off">
        <button type="button" class="chip" data-label-create>＋ 作成</button>
      </div>
      <p id="label-picker-error" class="label-error" role="alert">${escapeHtml(labelPickerError)}</p>
    </div>`;
}

function toggleLabelFromPicker(id, checked) {
  applyLabelChange(StudyCore.setLabel(state.labels, id, labelPickerTarget.key, checked, Date.now()));
  if (checked) rememberLastLabel(id);
  refreshLabelButton();
}

// 新しいラベルを作り、選んでいる問題に付ける（＝最後に使ったラベルになる）
function createLabelFromPicker() {
  const input = document.getElementById('label-new-name');
  const v = StudyCore.validateLabelName(state.labels, input ? input.value : '');
  if (!v.ok) {
    labelPickerError = v.reason;
    renderLabelPicker();
    document.getElementById('label-new-name').value = input ? input.value : '';
    return;
  }
  const id = newLabelId();
  const now = Date.now();
  applyLabelChange(StudyCore.setLabel(StudyCore.createLabel(state.labels, id, v.name, now), id, labelPickerTarget.key, true, now));
  rememberLastLabel(id);
  labelPickerError = '';
  renderLabelPicker();
  refreshLabelButton();
}

// シートの中身は苦手リストなどと共用。ラベルの部品だけ data-label-* で拾う（weak-list.js の委譲とは別）
document.getElementById('weak-list-content').addEventListener('click', e => {
  const toggle = e.target.closest('[data-label-toggle]');
  if (toggle) return toggleLabelFromPicker(toggle.dataset.labelToggle, toggle.checked);
  if (e.target.closest('[data-label-create]')) return createLabelFromPicker();
});
document.getElementById('weak-list-content').addEventListener('keydown', e => {
  if (e.target.id === 'label-new-name' && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    createLabelFromPicker();
  }
});

// ---- ラベル一覧（フッターの「ラベル」）とラベルの中身 ----

// labelId が null なら一覧、ラベル ID なら中身。tab は 'grammar' | 'vocab'、sort は 'added'（付けた順）| 'order'
let labelListView = { labelId: null, tab: 'grammar', sort: 'added' };

function toggleLabelList() {
  if (isSheetOpen() && activeSheetRender === renderLabelList) return closeSheet();
  labelListView = { labelId: null, tab: state.app === 'grammar' ? 'grammar' : 'vocab', sort: 'added' };
  openSheet('ラベル', renderLabelList, false);
}

// ラベルに付いている項目のうち、今の問題データにあるもの（無くなった問題・単語は出さない）
function labelEntries(labelId) {
  const grammar = [];
  const words = [];
  StudyCore.itemsOf(state.labels, labelId).forEach(({ key }) => {
    if (key.startsWith('g:')) {
      const ex = GRAMMAR_BY_ID.get(Number(key.slice(2)));
      if (ex) grammar.push({ key, ex });
    } else {
      const word = WORD_BY_HEADWORD.get(key.slice(2));
      if (word) words.push({ key, word });
    }
  });
  return { grammar, words };
}

function renderLabelList() {
  if (labelListView.labelId !== null) {
    if (StudyCore.activeLabels(state.labels).some(l => l.id === labelListView.labelId)) return renderLabelContents(labelListView.labelId);
    labelListView.labelId = null; // 開いていたラベルが（別のタブなどで）削除された
  }
  document.getElementById('sheet-title').innerText = 'ラベル';
  const rows = StudyCore.activeLabels(state.labels).map(l => {
    const { grammar, words } = labelEntries(l.id);
    return `
      <button type="button" class="label-row" data-label-open="${escapeHtml(l.id)}">
        <span class="label-row-name">🏷 ${escapeHtml(l.name)}</span>
        <span class="label-row-count">文法 ${grammar.length}問・単語 ${words.length}語</span>
      </button>`;
  }).join('');
  document.getElementById('weak-list-content').innerHTML = `
    <div class="label-list">
      ${rows || '<p class="label-empty">ラベルがありません。</p>'}
      ${typeof openLabelSettings === 'function' ? '<button type="button" class="label-edit-link" data-label-edit>ラベルを編集 →</button>' : ''}
    </div>`;
}

function renderLabelContents(labelId) {
  const name = StudyCore.activeLabels(state.labels).find(l => l.id === labelId).name;
  document.getElementById('sheet-title').innerText = `ラベル: ${name}`;
  const { grammar, words } = labelEntries(labelId);
  const isGrammar = labelListView.tab === 'grammar';
  if (labelListView.sort === 'order') {
    const bookOrder = ex => { const i = GRAMMAR_BOOK_IDS.indexOf(bookOf(ex)); return i >= 0 ? i : 99; };
    grammar.sort((a, b) => bookOrder(a.ex) - bookOrder(b.ex) || a.ex.ch - b.ex.ch || a.ex.id - b.ex.id);
    words.sort((a, b) => a.word.w.localeCompare(b.word.w, 'en', { sensitivity: 'base' }));
  }
  const list = isGrammar ? grammar : words;
  const chip = (attr, value, on, text) => `<button type="button" class="chip ${on ? 'active' : ''}" ${attr}="${value}">${text}</button>`;
  const remove = key => `<button type="button" class="del-btn" data-label-remove="${escapeHtml(key)}">ラベルを外す</button>`;
  const items = list.map(isGrammar
    ? ({ key, ex }) => `
      <div class="weak-item label-item">
        <div class="label-item-head">
          <span class="label-item-book">${getBookBadge(ex.b)} ${getChapterLabel(ex.b, ex.ch, ex.ch_title)}</span>
          ${remove(key)}
        </div>
        <div class="label-item-q">${ex.q}</div>
        <div class="label-item-answer">正解: (${grammarChoiceLabel(ex.a)}) ${ex.c[ex.a]}</div>
        ${ex.exp ? `<details class="label-item-exp"><summary>解説</summary><div class="grammar-exp-text">${ex.exp}</div></details>` : ''}
      </div>`
    : ({ key, word }) => `
      <div class="weak-item label-item">
        <div class="label-item-head">
          <span class="weak-word">${escapeHtml(word.w)}</span>
          ${remove(key)}
        </div>
        <div class="weak-meaning">${escapeHtml(word.m)}</div>
        ${word.e ? `<div class="label-item-example">${word.e}</div>` : ''}
      </div>`).join('');
  document.getElementById('weak-list-content').innerHTML = `
    <button type="button" class="label-back" data-label-back>← ラベル一覧</button>
    <div class="filter-row" style="flex-wrap:wrap;margin-bottom:4px;">
      ${chip('data-label-tab', 'grammar', isGrammar, `文法 ${grammar.length}`)}
      ${chip('data-label-tab', 'vocab', !isGrammar, `単語 ${words.length}`)}
    </div>
    <button type="button" class="filter-apply-btn label-solve-btn" data-label-solve${list.length ? '' : ' disabled'}>このラベルで解く（${isGrammar ? '文法' : '単語'} ${list.length}）</button>
    <div class="filter-row" style="flex-wrap:wrap;margin:8px 0 4px;">
      ${chip('data-label-sort', 'added', labelListView.sort === 'added', '付けた順')}
      ${chip('data-label-sort', 'order', labelListView.sort === 'order', isGrammar ? '本・章順' : 'ABC順')}
    </div>
    ${items || `<p class="label-empty">このラベルの${isGrammar ? '文法の問題' : '単語'}はありません。</p>`}`;
}

// ---- ラベルで絞り込んで解く ----

const labelFilterKey = kind => (kind === 'grammar' ? 'grammarLabel' : 'vocabLabel');

// ラベルの付いた問題だけを出す。ほかの絞り込み（本・章・苦手）は使わない
function startLabelDrill(kind, labelId) {
  if (state.app !== kind) setApp(kind);
  state[labelFilterKey(kind)] = labelId;
  saveSettings();
  syncFilterUI();
  if (kind === 'grammar') applyGrammarFilters();
  else applyFilters();
  closeSheet();
  if (typeof currentAppPage !== 'undefined' && currentAppPage !== 'practice' && typeof switchAppPage === 'function') switchAppPage('practice');
}

function clearLabelFilter(kind) {
  state[labelFilterKey(kind)] = null;
  saveSettings();
  syncFilterUI();
  if (state.app !== kind) return;
  if (kind === 'grammar') applyGrammarFilters();
  else applyFilters();
}

// 絞り込みシートの「ラベル: 〇〇 ✕」
function renderLabelFilterChip() {
  const el = document.getElementById('label-filter-chip');
  if (!el) return;
  const id = state[labelFilterKey(state.app === 'grammar' ? 'grammar' : 'vocab')];
  el.hidden = !id;
  el.innerHTML = id ? `
    <button type="button" class="chip active" data-clear-label-filter>ラベル: ${escapeHtml(labelName(id))} ✕</button>
    <p class="label-filter-note">ラベルで絞り込み中は、ほかの条件は使われません。</p>` : '';
}

// js/labels.js の applyLabelChange から呼ばれる。絞り込み中のラベルが削除されたら、ふつうの条件で出題し直す
function onLabelFilterDropped(prev) {
  renderLabelFilterChip();
  updateFilterSummary();
  const kind = state.app === 'grammar' ? 'grammar' : 'vocab';
  if (prev && prev[labelFilterKey(kind)] && !state[labelFilterKey(kind)]) {
    if (kind === 'grammar') applyGrammarFilters();
    else applyFilters();
  }
}

document.getElementById('weak-list-content').addEventListener('click', e => {
  const open = e.target.closest('[data-label-open]');
  if (open) {
    labelListView = { ...labelListView, labelId: open.dataset.labelOpen, sort: 'added' };
    return renderLabelList();
  }
  if (e.target.closest('[data-label-back]')) {
    labelListView.labelId = null;
    return renderLabelList();
  }
  const tab = e.target.closest('[data-label-tab]');
  if (tab) {
    labelListView.tab = tab.dataset.labelTab;
    return renderLabelList();
  }
  const sort = e.target.closest('[data-label-sort]');
  if (sort) {
    labelListView.sort = sort.dataset.labelSort;
    return renderLabelList();
  }
  const remove = e.target.closest('[data-label-remove]');
  if (remove) {
    applyLabelChange(StudyCore.setLabel(state.labels, labelListView.labelId, remove.dataset.labelRemove, false, Date.now()));
    refreshLabelButton();
    return renderLabelList();
  }
  const solve = e.target.closest('[data-label-solve]');
  if (solve && !solve.disabled) return startLabelDrill(labelListView.tab, labelListView.labelId);
  if (e.target.closest('[data-label-edit]')) return openLabelSettings();
});

document.getElementById('label-filter-chip')?.addEventListener('click', e => {
  if (e.target.closest('[data-clear-label-filter]')) clearLabelFilter(state.app === 'grammar' ? 'grammar' : 'vocab');
});
