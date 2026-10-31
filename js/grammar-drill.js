// ==================== GRAMMAR LOGIC ====================

function saveGrammarWeakData() {
  saveJSON('toeic_weak_grammar', state.grammarWeakData);
  updateGrammarWeakBadge();
}

function updateGrammarWeakBadge() {
  // 「苦手のみ」「要復習」を押したときに出る問題数（今の本・章・ルールの絞り込みを反映）
  const weak = RAW_GRAMMAR.filter(ex => state.grammarWeakData[ex.id] !== undefined && grammarMatchesBaseFilters(ex));
  setBadge('grammar-weak-badge', weak.length);
  setBadge('grammar-due-badge', weak.filter(ex => isDue(state.grammarWeakData[ex.id])).length);
}

function getBookBadge(b) {
  if (b === 'kin') return '<span class="grammar-book-badge badge-kin">👑 金の文法</span>';
  if (b === 'polaris2') return '<span class="grammar-book-badge badge-polaris">🧭 ポラリス2</span>';
  if (b === 'toplevel') return '<span class="grammar-book-badge badge-toplevel">🎓 トップレベル</span>';
  return '<span class="grammar-book-badge badge-sekai">📖 世界一</span>';
}

function getChapterLabel(b, ch, chTitle) {
  const prefix = b === 'polaris2' ? `Unit ${ch}` : (b === 'toplevel' ? `Lecture ${ch}` : `第${ch}章`);
  return chTitle ? `${prefix} ${chTitle}` : prefix;
}

function grammarChoiceLabel(idx) {
  return ['A', 'B', 'C', 'D', 'E'][idx] || String.fromCharCode(65 + idx);
}

// 本ごとの章の一覧。key は「本:章」（章の番号は本ごとに振られていて重なるので、本とセットで区別する）
function grammarChapterKey(ex) {
  return `${ex.b || 'sekai'}:${ex.ch}`;
}

function getGrammarChaptersList(b) {
  const book = b || state.grammarBook || 'all';
  const pool = book === 'all' ? RAW_GRAMMAR : RAW_GRAMMAR.filter(g => (g.b || 'sekai') === book);
  if (book === 'all') {
    // 「すべて」のときは、4 冊の章を本の名前つきで並べる（本をまたいで複数選べる）。key は「本:章」
    const BOOK_NAMES = { kin: '👑 金の文法', sekai: '📖 世界一', polaris2: '🧭 ポラリス2', toplevel: '🎓 トップレベル' };
    const all = [{ key: 'all', ch: 'all', title: `全問 (${pool.length}問)` }];
    Object.keys(BOOK_NAMES).forEach(bk => {
      const bookPool = RAW_GRAMMAR.filter(g => (g.b || 'sekai') === bk);
      const seenCh = new Set();
      bookPool.forEach(g => {
        if (seenCh.has(g.ch)) return;
        seenCh.add(g.ch);
        const count = bookPool.filter(x => x.ch === g.ch).length;
        all.push({ key: `${bk}:${g.ch}`, ch: g.ch, title: `${BOOK_NAMES[bk]} ${getChapterLabel(bk, g.ch, g.ch_title)} (${count}問)` });
      });
    });
    return all;
  }
  const chapters = [];
  const seen = new Set();
  pool.forEach(g => {
    if (seen.has(g.ch)) return;
    seen.add(g.ch);
    const count = pool.filter(x => x.ch === g.ch).length;
    const chapLabel = getChapterLabel(book, g.ch, g.ch_title);
    chapters.push({ key: `${book}:${g.ch}`, ch: g.ch, title: `${chapLabel} (${count}問)` });
  });
  const allTitle = book === 'kin' ? `金の文法 全${chapters.length}章 (${pool.length}問)`
    : book === 'sekai' ? `世界一 全${chapters.length}章 (${pool.length}問)`
    : book === 'polaris2' ? `ポラリス2 全${chapters.length}Unit (${pool.length}問)`
    : `トップレベル 全${chapters.length}Lecture (${pool.length}問)`;
  return [{ key: 'all', ch: 'all', title: allTitle }, ...chapters];
}
const getGrammarChapters = getGrammarChaptersList;

function renderGrammarChapterFilters() {
  const gcf = document.getElementById('grammar-chapter-filters');
  if (!gcf) return;
  
  const chapters = getGrammarChaptersList();
  let html = '';
  if (state.grammarRule !== null) {
    html += `<button class="chip active rule-filter-chip" data-clear-rule="1">金のルール ${state.grammarRule} で絞り込み中 ✕</button>`;
  }
  chapters.forEach(c => {
    const isActive = state.grammarRule === null && (c.key === 'all' ? state.grammarChapter.length === 0 : state.grammarChapter.includes(c.key));
    html += `<button class="chip ${isActive ? 'active' : ''}" data-gchapter="${c.key}">${c.title}</button>`;
  });
  gcf.innerHTML = html;

  gcf.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', e => {
      const val = e.currentTarget.dataset.gchapter;
      state.grammarRule = null;
      if (val === undefined || val === 'all') {
        state.grammarChapter = [];
      } else if (state.grammarChapter.includes(val)) {
        state.grammarChapter = state.grammarChapter.filter(k => k !== val);
      } else {
        const order = getGrammarChaptersList().map(c => c.key); // 一覧の並び順にそろえる
        state.grammarChapter = order.filter(k => k === val || state.grammarChapter.includes(k));
      }
      renderGrammarChapterFilters();
      applyGrammarFilters();
    });
  });
}

function initGrammarFilters() {
  // Book segments
  const gbs = document.getElementById('grammar-book-segments');
  if (gbs) {
    gbs.querySelectorAll('.segment').forEach(btn => {
      btn.addEventListener('click', e => {
        gbs.querySelectorAll('.segment').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget;
        target.classList.add('active');
        state.grammarBook = target.dataset.gbook;
        state.grammarChapter = [];
        state.grammarRule = null;
        renderGrammarChapterFilters();
        applyGrammarFilters();
      });
    });
  }

  renderGrammarChapterFilters();

  document.querySelectorAll('#grammar-weak-segments .segment').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#grammar-weak-segments .segment').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.grammarWeakFilter = e.currentTarget.dataset.gweak;
      applyGrammarFilters();
    });
  });
}

// 苦手フィルタ以外の絞り込み（本・章・ルール）
function grammarMatchesBaseFilters(ex) {
  const itemBook = ex.b || 'sekai';
  if (state.grammarBook !== 'all' && itemBook !== state.grammarBook) return false;
  if (state.grammarChapter.length > 0 && !state.grammarChapter.includes(grammarChapterKey(ex))) return false;
  if (state.grammarRule !== null && ex.rule?.number !== state.grammarRule) return false;
  return true;
}

// 今の絞り込みに合う文法問題（並べ替える前）
function filteredGrammar() {
  return RAW_GRAMMAR.filter(ex => {
    if (!grammarMatchesBaseFilters(ex)) return false;
    const entry = state.grammarWeakData[ex.id];
    if (state.grammarWeakFilter === 'weak_only' && !entry) return false;
    if (state.grammarWeakFilter === 'weak_unlearned' && !entry && state.grammarSeen.has(ex.id)) return false;
    if (state.grammarWeakFilter === 'due' && !(entry && isDue(entry))) return false;
    return true;
  });
}

function applyGrammarFilters() {
  state.grammarPool = shuffle(filteredGrammar());
  resetReview();
  state.currentGrammarIndex = 0;
  state.grammarScore = 0;
  state.grammarAnsweredCount = 0;
  updateGrammarWeakBadge();
  updateFilterSummary();
  checkFilterNudge();
  renderCurrentGrammar();
}

function renderCurrentGrammar() {
  resetActionBar();
  checkFilterNudge();
  document.getElementById('choices-container').classList.remove('compact');
  const container = document.getElementById('quiz-container');
  const choicesDiv = document.getElementById('choices-container');
  const nextBtn = document.getElementById('next-btn');
  const review = activeReview(state.grammarLog);

  if (state.grammarPool.length === 0) {
    container.innerHTML = `<div class="card"><div class="meaning-display">条件に合う文法問題がありません</div></div>`;
    choicesDiv.innerHTML = '';
    nextBtn.style.display = 'none';
    updateFooter();
    return;
  }

  if (!review && state.currentGrammarIndex >= state.grammarPool.length) {
    container.innerHTML = `<div class="card completion-card">${pomeranianImage('celebrate', 'completion-mascot', 96)}<div class="meaning-display">文法ドリル完了！</div><div style="font-size:14px;color:var(--muted);margin-top:8px;">正答: ${state.grammarScore} / ${state.grammarAnsweredCount}</div>${typeof sessionReviewHtml === 'function' ? sessionReviewHtml('grammar') : ''}</div>`;
    choicesDiv.innerHTML = '';
    nextBtn.style.display = 'none';
    updateFooter();
    return;
  }

  const ex = state.grammarPool[review ? state.reviewIndex : state.currentGrammarIndex];
  if (!review) state.grammarAnswered = false; // 見直し中は今の問題の回答状況に触れない
  choicesDiv.innerHTML = '';
  nextBtn.style.display = 'none';

  // Highlight blank in question
  const formattedQ = ex.q.replace(/-{3,}/g, '<span style="color:var(--seal);font-weight:bold;text-decoration:underline;">_______</span>');

  const isKin = ex.b === 'kin';
  const bookBadgeHtml = getBookBadge(ex.b);

  const ruleHtml = (ex.rule && ex.rule.number) ? `
    <div class="grammar-rule-card">
      <div class="grammar-rule-header">
        <span class="grammar-rule-icon">${isKin ? '👑' : (ex.b === 'polaris2' ? '🧭' : (ex.b === 'toplevel' ? '🎓' : '📌'))}</span>
        <span class="grammar-rule-badge-text">${isKin ? '金のルール ' + ex.rule.number : (ex.b === 'polaris2' ? 'Unit ' + ex.ch + ' ポイント' : (ex.b === 'toplevel' ? 'Lecture ' + ex.ch + ' ポイント' : 'ルール ' + ex.rule.number))}</span>
        ${ex.rule.category && ex.rule.category !== `第${ex.ch}章 ${ex.ch_title}` && ex.rule.category !== ex.ch_title ? `<span class="grammar-rule-cat">${ex.rule.category}</span>` : ''}
      </div>
      <div class="grammar-rule-title">${ex.rule.title}</div>
    </div>
  ` : '';

  const phaseInfo = isKin ? (typeof KIN_PHASES !== 'undefined' ? KIN_PHASES.find(p => p.chapter === ex.ch) : null) : null;
  const phaseHtml = (phaseInfo && phaseInfo.phases) ? `
    <details class="grammar-phase-details">
      <summary>💡 第${ex.ch}章 (${escapeHtml(phaseInfo.chapter_title)}) の解き方手順を見る</summary>
      ${renderPhaseSteps(phaseInfo.phases)}
    </details>
  ` : '';

  const gStat = state.grammarStats[String(ex.id)];
  const gStatHtml = `<span id="grammar-stat-badge" class="item-stat-badge"${gStat && gStat.a ? '' : ' hidden'}>${statLabelText(gStat)}</span>`;

  container.innerHTML = `
    <div class="card grammar-card" id="main-card">
      <div class="grammar-meta" style="width:100%;">
        <span class="grammar-badge">Part 5</span>
        ${bookBadgeHtml}
        ${gStatHtml}
      </div>
      <div class="grammar-question">${formattedQ}</div>
      <div class="grammar-exp-container" id="grammar-exp-box" style="display:none;">
        <div class="grammar-correct-ans">正解: (${grammarChoiceLabel(ex.a)}) ${ex.c[ex.a]}</div>
        <div class="grammar-your-ans" id="grammar-your-ans" style="display:none;"></div>
        <div class="grammar-theme-revealed">${getChapterLabel(ex.b, ex.ch, ex.ch_title)} ・${ex.th_title}</div>
        ${ruleHtml}
        ${phaseHtml}
        <div class="grammar-exp-text">${ex.exp}</div>
        ${ex.v && ex.v.length > 0 ? `
          <div class="grammar-vocab-list">
            <div class="grammar-vocab-title">📌 重要語彙</div>
            <div class="grammar-vocab-items">
              ${ex.v.map(v => `<span class="grammar-vocab-item"><strong>${v.word}</strong>: ${v.meaning}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  const labels = ['A', 'B', 'C', 'D', 'E'];
  ex.c.forEach((choice, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-key">${idx + 1}</span><span class="choice-label">${labels[idx] || String.fromCharCode(65 + idx)}</span><span class="choice-text">${choice}</span>`;
    if (!review) btn.onclick = () => handleGrammarAnswer(idx, btn);
    if (review && idx === review.sel && !review.ok) btn.classList.add('wrong');
    choicesDiv.appendChild(btn);
  });
  if (review) {
    if (review.sel !== null && !review.ok) showGrammarYourAnswer(ex, review.sel);
    markGrammarAnswer(ex);
    addReviewBadge(review.sel === null ? 'わからない' : (review.ok ? '正解' : '不正解'), review.ok ? 'ok' : 'ng');
    showDuoBanner(review.ok, `(${grammarChoiceLabel(ex.a)}) ${ex.c[ex.a]}`, { review: true, skipped: review.sel === null });
    showNextButton(reviewNext);
  } else {
    setDontKnowVisible(true);
    document.getElementById('dont-know-btn').onclick = handleGrammarDontKnow;
  }

  updateFooter();
}

function handleGrammarAnswer(selectedIdx, btn) {
  if (state.grammarAnswered) return;
  const ex = state.grammarPool[state.currentGrammarIndex];
  const isCorrect = selectedIdx === ex.a;
  playDuoSound(isCorrect);
  showDuoBanner(isCorrect, `(${grammarChoiceLabel(ex.a)}) ${ex.c[ex.a]}`);

  if (!isCorrect) {
    btn.classList.add('wrong');
    shakeCard();
    showGrammarYourAnswer(ex, selectedIdx);
    recordWeakGrammar(ex, false);
  } else {
    state.grammarScore++;
    recordWeakGrammar(ex, true);
  }
  state.grammarLog[state.currentGrammarIndex] = { ok: isCorrect, sel: selectedIdx };
  revealGrammarAnswer(ex);
}

function showGrammarYourAnswer(ex, selectedIdx) {
  const yours = document.getElementById('grammar-your-ans');
  yours.textContent = `あなたの回答: (${grammarChoiceLabel(selectedIdx)}) ${ex.c[selectedIdx]}`;
  yours.style.display = 'block';
}

// 「わからない」: 正解と解説を見せて苦手に登録。スコアは増やさず、赤表示や揺れは出さない
function handleGrammarDontKnow() {
  if (state.grammarAnswered) return;
  const ex = state.grammarPool[state.currentGrammarIndex];
  playDuoSound(false);
  showDuoBanner(false, `(${grammarChoiceLabel(ex.a)}) ${ex.c[ex.a]}`, { skipped: true });
  state.grammarLog[state.currentGrammarIndex] = { ok: false, sel: null };
  recordWeakGrammar(ex, false);
  revealGrammarAnswer(ex);
}

function revealGrammarAnswer(ex) {
  state.grammarAnswered = true;
  setDontKnowVisible(false);
  markGrammarAnswer(ex);

  showNextButton(() => {
    hideDuoBanner();
    state.currentGrammarIndex++;
    renderCurrentGrammar();
  });
  updateFooter();
}

// 正解の選択肢に印を付け、解説を開く。回答直後と見直しで共通
function markGrammarAnswer(ex) {
  const choicesDiv = document.getElementById('choices-container');
  choicesDiv.querySelectorAll('.choice-btn').forEach((b, i) => {
    if (i === ex.a) b.classList.add('correct');
    const mark = i === ex.a ? '✓' : (b.classList.contains('wrong') ? '✗' : '');
    if (mark) b.insertAdjacentHTML('beforeend', `<span class="choice-mark">${mark}</span>`);
    // 回答後は全文表示のまま。タップで記号だけの1行に縮めて解説を広く読める（再タップで戻る）
    b.onclick = () => choicesDiv.classList.toggle('compact');
  });

  const expBox = document.getElementById('grammar-exp-box');
  if (expBox) expBox.style.display = 'block';
}

function recordWeakGrammar(ex, isCorrect) {
  state.grammarAnsweredCount++;
  recordItemStat(state.grammarStats, GRAMMAR_STATS_KEY, ex.id, isCorrect);
  const badge = document.getElementById('grammar-stat-badge');
  if (badge) {
    badge.textContent = statLabelText(state.grammarStats[String(ex.id)]);
    badge.hidden = false;
  }
  updateWeakEntry(state.grammarWeakData, ex.id, isCorrect, `g:${ex.id}`);
  saveGrammarWeakData();
  if (!state.grammarSeen.has(ex.id)) {
    state.grammarSeen.add(ex.id);
    saveGrammarSeen();
  }
}

function obsidianSyncBarHtml() {
  return `
    <div class="filter-row" style="flex-wrap:wrap;margin-bottom:8px;">
      <button class="chip" data-obsidian-export="1">📤 Obsidianへ苦手出力</button>
      <button class="chip" data-obsidian-import="1">📥 Obsidianから同期読込</button>
    </div>`;
}

function renderGrammarWeakList() {
  const container = document.getElementById('weak-list-content');
  const items = Object.keys(state.grammarWeakData)
    .map(id => ({ key: id, entry: state.grammarWeakData[id], ex: RAW_GRAMMAR.find(g => g.id === Number(id)) }))
    .filter(x => x.ex);
  document.getElementById('sheet-title').innerText = `苦手リスト（${items.length}）`;
  if (items.length === 0) {
    container.innerHTML = obsidianSyncBarHtml() + '<div style="color:var(--muted);text-align:center;padding:20px;">文法の苦手問題はありません</div>';
    return;
  }
  const bookOrder = ex => ({ kin: 0, sekai: 1, polaris2: 2, toplevel: 3 }[ex.b || 'sekai'] ?? 99);
  sortWeakItems(items, (a, b) => bookOrder(a.ex) - bookOrder(b.ex) || a.ex.ch - b.ex.ch || a.ex.id - b.ex.id);

  let html = obsidianSyncBarHtml() + weakListHeader(items, '本・章順');
  items.forEach(({ key, entry, ex }) => {
    const stText = statLabelText(state.grammarStats[String(ex.id)]);
    html += `
      <div class="weak-item" style="flex-direction:column;align-items:flex-start;gap:6px;">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
          <span style="font-size:11px;color:var(--muted);font-weight:bold;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${getBookBadge(ex.b)} ${getChapterLabel(ex.b, ex.ch, ex.ch_title)}
            ${stText ? `<span style="font-weight:normal;">（${stText}）</span>` : ''}
          </span>
          <button class="del-btn" data-remove-weak="${key}">削除</button>
        </div>
        ${ex.rule ? (
          ex.b === 'kin'
            ? `<div style="font-size:11px;color:#b45309;font-weight:bold;background:rgba(234,179,8,0.15);padding:2px 6px;border-radius:4px;border:1px solid rgba(234,179,8,0.4);">👑 金のルール ${ex.rule.number}: ${ex.rule.title}</div>`
            : (ex.b === 'polaris2'
                ? `<div style="font-size:11px;color:#7c3aed;font-weight:bold;background:rgba(124,58,237,0.12);padding:2px 6px;border-radius:4px;border:1px solid rgba(124,58,237,0.35);">🧭 ${ex.rule.title}</div>`
                : (ex.b === 'toplevel'
                    ? `<div style="font-size:11px;color:#059669;font-weight:bold;background:rgba(5,150,105,0.12);padding:2px 6px;border-radius:4px;border:1px solid rgba(5,150,105,0.35);">🎓 ${ex.rule.title}</div>`
                    : `<div style="font-size:11px;color:var(--muted);font-weight:bold;padding:2px 6px;">${ex.rule.title}</div>`))
        ) : ''}
        <div style="font-size:13px;font-weight:600;color:var(--ink);">${ex.q}</div>
        <div style="font-size:12px;color:var(--jade);">正解: (${grammarChoiceLabel(ex.a)}) ${ex.c[ex.a]}</div>
        ${dueLabel(entry)}
      </div>
    `;
  });
  container.innerHTML = html;
}

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
    if (!restoreSession('grammar')) return applyGrammarFilters();
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
  } else {
    if (state.sourceFilter !== 'all') n++;
    if (state.sourceFilter === 'teppan') {
      n += state.rangeFilter.length;
    } else {
      n += state.dateFilter.length;
      n += state.posFilter.length;
    }
    if (state.weakFilter !== 'all') n++;
  }
  const el = document.getElementById('filter-count');
  if (!el) return;
  el.style.display = n > 0 ? 'inline-block' : 'none';
  el.innerText = n;
}

function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

// 品詞の絞り込みの選択肢（チップの data-pos と同じ）
const POS_FILTERS = ['名詞', '動詞', '形容詞', '副詞', '句・表現'];

// 品詞「句・表現」に含める品詞（TEPPAN はそのまま「句・表現」で登録されている）
const PHRASE_POS = ['名詞句', '動詞句', '形容詞句', '副詞句', '表現', '句・表現'];

// 苦手フィルタ以外の絞り込み（出典・範囲・日付・品詞）
function wordMatchesBaseFilters(w) {
  // source
  if (state.sourceFilter !== 'all' && w.s !== state.sourceFilter) return false;

  // range filter (for TEPPAN)
  if (state.sourceFilter === 'teppan' && state.rangeFilter.length > 0) {
    if (!w.no || !state.rangeFilter.some(r => w.no >= r.start && w.no <= r.end)) return false;
  }

  // date (for daily words or all)
  if (state.sourceFilter !== 'teppan' && state.dateFilter.length > 0) {
    if (!w.d || !state.dateFilter.includes(getWeekLabel(w.d))) return false;
  }

  // pos (for daily words or all)
  if (state.sourceFilter !== 'teppan' && state.posFilter.length > 0) {
    if (!state.posFilter.some(p => (p === '句・表現' ? PHRASE_POS.includes(w.p) : w.p === p))) return false;
  }
  return true;
}

// 日々の単語と TEPPAN の両方にある単語は1問にまとめる（苦手記録は綴りで共通なので）
function dedupeWords(words) {
  const seen = new Set();
  return words.filter(w => {
    if (seen.has(w.w)) return false;
    seen.add(w.w);
    return true;
  });
}

// 今の絞り込みに合う単語（並べ替える前）
function filteredWords() {
  const filtered = RAW_WORDS.filter(w => {
    if (!wordMatchesBaseFilters(w)) return false;

    // weak
    const entry = wordWeak()[w.w];
    if (state.weakFilter === 'weak_only' && !entry) return false;
    if (state.weakFilter === 'weak_unlearned' && !entry && wordSeen().has(w.w)) return false;
    if (state.weakFilter === 'due' && !(entry && isDue(entry))) return false;

    return true;
  });
  return dedupeWords(filtered);
}

function applyFilters() {
  state.pool = shuffle(filteredWords());
  resetReview();
  state.currentIndex = 0;
  state.score = 0;
  state.answeredCount = 0;
  updateWeakBadge();
  updateFilterSummary();
  checkFilterNudge();
  renderCurrent();
}

// 4択の「わからない」ボタン。次へボタンと同じ枠を回答前だけ使う
function setDontKnowVisible(visible) {
  const dk = document.getElementById('dont-know-btn');
  if (dk) dk.style.display = visible ? 'block' : 'none';
}

// 下のボタンを両方隠し、カードモードで書き換えた文言を元に戻す
function resetActionBar() {
  hideDuoBanner();
  const dk = document.getElementById('dont-know-btn');
  const nextBtn = document.getElementById('next-btn');
  dk.style.display = 'none';
  dk.innerText = 'わからない';
  nextBtn.style.display = 'none';
  nextBtn.innerText = '次へ';
}

function showNextButton(onNext) {
  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = 'block';
  nextBtn.onclick = onNext;
}

function nextWord() {
  hideDuoBanner();
  state.currentIndex++;
  renderCurrent();
}

