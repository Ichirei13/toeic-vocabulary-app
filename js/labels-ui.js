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
