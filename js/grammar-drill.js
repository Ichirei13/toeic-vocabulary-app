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

// 文法の教材（本）ごとの違いは、ここに 1 か所で定義する。教材を足すときは、ここに 1 件足し、
// CSS の .badge-* と home.js のコース一覧（教材の説明）を足す。データ（data/grammar.js）の ex.b が id。
// 並びは「すべて」の章一覧と苦手リストの本の順になる。ex.b が無い問題は 'sekai'（世界一）として扱う
const GRAMMAR_BOOKS = {
  kin: {
    name: '金の文法', icon: '👑', badgeClass: 'badge-kin',
    chapterUnit: '章', chapterPrefix: ch => `第${ch}章`,
    ruleIcon: '👑', ruleBadgeText: ex => '金のルール ' + ex.rule.number,
    weakRule: { color: '#b45309', bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.4)', text: ex => `👑 金のルール ${ex.rule.number}: ${ex.rule.title}` }
  },
  sekai: {
    name: '世界一', icon: '📖', badgeClass: 'badge-sekai',
    chapterUnit: '章', chapterPrefix: ch => `第${ch}章`,
    ruleIcon: '📌', ruleBadgeText: ex => 'ルール ' + ex.rule.number,
    weakRule: null // 苦手リストでは、色なしでルール名だけを出す
  },
  polaris2: {
    name: 'ポラリス2', icon: '🧭', badgeClass: 'badge-polaris',
    chapterUnit: 'Unit', chapterPrefix: ch => `Unit ${ch}`,
    ruleIcon: '🧭', ruleBadgeText: ex => 'Unit ' + ex.ch + ' ポイント',
    weakRule: { color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.35)', text: ex => `🧭 ${ex.rule.title}` }
  },
  toplevel: {
    name: 'トップレベル', icon: '🎓', badgeClass: 'badge-toplevel',
    chapterUnit: 'Lecture', chapterPrefix: ch => `Lecture ${ch}`,
    ruleIcon: '🎓', ruleBadgeText: ex => 'Lecture ' + ex.ch + ' ポイント',
    weakRule: { color: '#059669', bg: 'rgba(5,150,105,0.12)', border: 'rgba(5,150,105,0.35)', text: ex => `🎓 ${ex.rule.title}` }
  }
};
const GRAMMAR_BOOK_IDS = Object.keys(GRAMMAR_BOOKS);

// 問題がどの本のものか。ex.b が無ければ世界一
function bookOf(ex) {
  return ex.b || 'sekai';
}

// 本の設定。知らない本は世界一として扱う（本ごとの表示が揃わない問題でも落ちないように）
function grammarBook(b) {
  return GRAMMAR_BOOKS[b] || GRAMMAR_BOOKS.sekai;
}

// 「👑 金の文法」のような、アイコンつきの本の名前
function grammarBookTitle(b) {
  const book = grammarBook(b);
  return `${book.icon} ${book.name}`;
}

function getBookBadge(b) {
  const book = grammarBook(b);
  return `<span class="grammar-book-badge ${book.badgeClass}">${grammarBookTitle(b)}</span>`;
}

function getChapterLabel(b, ch, chTitle) {
  const prefix = grammarBook(b).chapterPrefix(ch);
  return chTitle ? `${prefix} ${chTitle}` : prefix;
}

function grammarChoiceLabel(idx) {
  return ['A', 'B', 'C', 'D', 'E'][idx] || String.fromCharCode(65 + idx);
}

// 本ごとの章の一覧。key は「本:章」（章の番号は本ごとに振られていて重なるので、本とセットで区別する）
function grammarChapterKey(ex) {
  return `${bookOf(ex)}:${ex.ch}`;
}

function getGrammarChaptersList(b) {
  const book = b || state.grammarBook || 'all';
  const pool = book === 'all' ? RAW_GRAMMAR : RAW_GRAMMAR.filter(g => bookOf(g) === book);
  if (book === 'all') {
    // 「すべて」のときは、4 冊の章を本の名前つきで並べる（本をまたいで複数選べる）。key は「本:章」
    const all = [{ key: 'all', ch: 'all', title: `全問 (${pool.length}問)` }];
    GRAMMAR_BOOK_IDS.forEach(bk => {
      const bookPool = RAW_GRAMMAR.filter(g => bookOf(g) === bk);
      const seenCh = new Set();
      bookPool.forEach(g => {
        if (seenCh.has(g.ch)) return;
        seenCh.add(g.ch);
        const count = bookPool.filter(x => x.ch === g.ch).length;
        all.push({ key: `${bk}:${g.ch}`, ch: g.ch, title: `${grammarBookTitle(bk)} ${getChapterLabel(bk, g.ch, g.ch_title)} (${count}問)` });
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
  const info = grammarBook(book);
  const allTitle = `${info.name} 全${chapters.length}${info.chapterUnit} (${pool.length}問)`;
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
  const itemBook = bookOf(ex);
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
        <span class="grammar-rule-icon">${grammarBook(ex.b).ruleIcon}</span>
        <span class="grammar-rule-badge-text">${grammarBook(ex.b).ruleBadgeText(ex)}</span>
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

// 苦手リストの 1 件に出す、金のルール／ポイントの小さな見出し
function weakRuleHtml(ex) {
  const style = grammarBook(ex.b).weakRule;
  if (!style) return `<div style="font-size:11px;color:var(--muted);font-weight:bold;padding:2px 6px;">${ex.rule.title}</div>`;
  return `<div style="font-size:11px;color:${style.color};font-weight:bold;background:${style.bg};padding:2px 6px;border-radius:4px;border:1px solid ${style.border};">${style.text(ex)}</div>`;
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
  const bookOrder = ex => { const i = GRAMMAR_BOOK_IDS.indexOf(bookOf(ex)); return i >= 0 ? i : 99; };
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
        ${ex.rule ? weakRuleHtml(ex) : ''}
        <div style="font-size:13px;font-weight:600;color:var(--ink);">${ex.q}</div>
        <div style="font-size:12px;color:var(--jade);">正解: (${grammarChoiceLabel(ex.a)}) ${ex.c[ex.a]}</div>
        ${dueLabel(entry)}
      </div>
    `;
  });
  container.innerHTML = html;
}
