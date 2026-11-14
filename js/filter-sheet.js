// ==================== 絞り込みシート・単語／文法の切り替え ====================
// 演習画面の出題対象（単語・文法）の切り替えと、絞り込みシートの初期化・表示の同期を受け持つ。
// 単語の絞り込み条件そのものは vocab-filter.js、文法の絞り込みは grammar-drill.js。

// 見出しの上の小さな文字に、今の出題モード（文法は Part 5）を出す。モード選択は絞り込みシートだけにあるため
function updatePracticeEyebrow() {
  const el = document.getElementById('practice-eyebrow');
  if (!el) return;
  el.textContent = state.app === 'grammar' ? 'Part 5' : (MODE_LABELS[state.mode] || MODE_LABELS.e2j);
}

// 単語／文法の切り替え。前回の続きが保存されていればそこから、なければ今の絞り込みで出題し直す
function setApp(app) {
  state.app = app;
  updatePracticeEyebrow();
  const isGrammar = app === 'grammar';
  document.querySelectorAll('.app-type-segments .segment').forEach(b => b.classList.toggle('active', b.dataset.app === app));
  document.querySelector('.header .title').innerText = isGrammar ? '文法ドリル (Part 5)' : '単語ドリル';
  document.getElementById('rule-guide-link').style.display = isGrammar ? 'inline' : 'none';
  document.querySelectorAll('.mode-segments').forEach(el => el.style.display = isGrammar ? 'none' : 'flex');
  const sheetModeGroup = document.getElementById('sheet-mode-group');
  if (sheetModeGroup) sheetModeGroup.style.display = isGrammar ? 'none' : 'block';
  document.getElementById('vocab-filters').style.display = isGrammar ? 'none' : 'block';
  document.getElementById('grammar-filters').style.display = isGrammar ? 'block' : 'none';
  document.getElementById('vocab-weak-group').style.display = isGrammar ? 'none' : 'block';
  document.getElementById('grammar-weak-group').style.display = isGrammar ? 'block' : 'none';
  resetActionBar();

  if (isGrammar) {
    // 近い問題の続きがあればそれを、なければ通常の続きを、どちらもなければ今のフィルターで出題し直す
    if (!restoreNearDrill() && !restoreSession('grammar')) return applyGrammarFilters();
    updateGrammarWeakBadge();
    updateFilterSummary();
    renderCurrentGrammar();
  } else {
    if (!restoreSession('vocab')) return applyFilters();
    updateWeakBadge();
    updateFilterSummary();
    renderCurrent();
  }
}

// TEPPAN は番号範囲で、それ以外は日付・品詞で絞る
function updateSourceRows() {
  const teppan = state.sourceFilter === 'teppan';
  document.getElementById('date-filters').style.display = teppan ? 'none' : 'flex';
  document.getElementById('pos-filters').style.display = teppan ? 'none' : 'flex';
  document.getElementById('range-filters').style.display = teppan ? 'flex' : 'none';
}

// ボタンの選択表示を state に合わせる（保存していた設定を復元したときなど）
function syncFilterUI() {
  updatePracticeEyebrow();
  const mark = (selector, isActive) =>
    document.querySelectorAll(selector).forEach(b => b.classList.toggle('active', isActive(b.dataset)));
  mark('.app-type-segments .segment', d => d.app === state.app);
  mark('.mode-segments .segment', d => d.mode === state.mode);
  mark('#source-segments .segment', d => d.source === state.sourceFilter);
  mark('#date-filters .chip', d => d.date === 'all' ? state.dateFilter.length === 0 : state.dateFilter.includes(d.date));
  mark('#pos-filters .chip', d => d.pos === 'all' ? state.posFilter.length === 0 : state.posFilter.includes(d.pos));
  mark('#range-filters .chip', d => d.range === 'all' ? state.rangeFilter.length === 0 : state.rangeFilter.some(r => `${r.start}-${r.end}` === d.range));
  mark('#weak-segments .segment', d => d.weak === state.weakFilter);
  mark('#grammar-book-segments .segment', d => d.gbook === state.grammarBook);
  mark('#grammar-weak-segments .segment', d => d.gweak === state.grammarWeakFilter);
  renderGrammarChapterFilters();
  updateSourceRows();
  if (typeof renderLabelFilterChip === 'function') renderLabelFilterChip(); // js/labels-ui.js（あとで読み込む）
}

function initFilters() {
  document.querySelectorAll('.app-type-segments .segment').forEach(btn => {
    btn.addEventListener('click', e => setApp(e.currentTarget.dataset.app));
  });

  initGrammarFilters();
  initRangeFilters();

  document.querySelectorAll('#source-segments .segment').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#source-segments .segment').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.sourceFilter = e.currentTarget.dataset.source;
      updateSourceRows();
      applyFilters();
    });
  });

  const df = document.getElementById('date-filters');
  df.innerHTML = `<button class="chip active" data-date="all">すべて</button>`;
  DATES.forEach(d => {
    df.innerHTML += `<button class="chip" data-date="${d}">${d}</button>`;
  });
  
  document.querySelectorAll('#date-filters .chip').forEach(btn => {
    btn.addEventListener('click', e => {
      const val = e.currentTarget.dataset.date;
      if (val === 'all') {
        state.dateFilter = [];
      } else if (state.dateFilter.includes(val)) {
        state.dateFilter = state.dateFilter.filter(x => x !== val);
      } else {
        state.dateFilter.push(val);
      }
      syncFilterUI();
      applyFilters();
    });
  });

  document.querySelectorAll('#pos-filters .chip').forEach(btn => {
    btn.addEventListener('click', e => {
      const val = e.currentTarget.dataset.pos;
      if (val === 'all') {
        state.posFilter = [];
      } else if (state.posFilter.includes(val)) {
        state.posFilter = state.posFilter.filter(x => x !== val);
      } else {
        state.posFilter = POS_FILTERS.filter(p => p === val || state.posFilter.includes(p)); // チップの並び順にそろえる
      }
      syncFilterUI();
      applyFilters();
    });
  });

  document.querySelectorAll('#weak-segments .segment').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#weak-segments .segment').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.weakFilter = e.currentTarget.dataset.weak;
      applyFilters();
    });
  });

  document.querySelectorAll('.mode-segments .segment').forEach(btn => {
    btn.addEventListener('click', e => {
      state.mode = e.currentTarget.dataset.mode;
      updatePracticeEyebrow();
      resetReview(); // 見直しの記録はモードごとの出題内容なので、モードを変えたら消す
      document.querySelectorAll('.mode-segments .segment').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === state.mode);
      });
      updateWeakBadge();
      // 苦手・未学習で絞っているときはモードごとに出題範囲が変わるので出題し直す。「すべて」なら並びはそのまま
      if (state.weakFilter !== 'all') applyFilters();
      else renderCurrent();
    });
  });

  const toggle = document.getElementById('filter-toggle');
  toggle.addEventListener('click', () => {
    toggleFilterSheet();
  });
}

// 絞り込みシートのボタンに、今の出題プールの件数を出す
function refreshFilterApplyLabel() {
  const btn = document.getElementById('filter-apply-btn');
  if (!btn || !window.StudyCore) return;
  const { label, empty } = StudyCore.filterCountLabel(getCurrentPoolCount(), state.app === 'grammar' ? '問' : '語');
  btn.textContent = label;
  const note = document.getElementById('filter-zero-note');
  if (note) note.hidden = !empty;
}

function updateFilterSummary() {
  refreshFilterApplyLabel();
  let n = 0;
  if (state.app === 'grammar') {
    if (state.grammarBook !== 'all') n++;
    n += state.grammarChapter.length;
    if (state.grammarRule !== null) n++;
    if (state.grammarWeakFilter !== 'all') n++;
    if (state.grammarLabel) n++;
  } else {
    if (state.sourceFilter !== 'all') n++;
    if (state.sourceFilter === 'teppan') {
      n += state.rangeFilter.length;
    } else {
      n += state.dateFilter.length;
      n += state.posFilter.length;
    }
    if (state.weakFilter !== 'all') n++;
    if (state.vocabLabel) n++;
  }
  const el = document.getElementById('filter-count');
  if (!el) return;
  el.style.display = n > 0 ? 'inline-block' : 'none';
  el.innerText = n;
}
