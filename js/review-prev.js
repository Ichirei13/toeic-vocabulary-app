// ==================== 前の問題の見直し ====================
// 「前へ」で回答済みの問題を、結果と解説つきで見直す。見直しでは正答数・苦手・保存位置を一切変えない

function reviewContext() {
  return state.app === 'grammar'
    ? { log: state.grammarLog, cur: 'currentGrammarIndex', render: renderCurrentGrammar }
    : { log: state.wordLog, cur: 'currentIndex', render: renderCurrent };
}

// 出題し直したときなど、見直しの記録が今の問題と合わなくなるときに消す
function resetReview() {
  state.reviewIndex = null;
  state.wordLog = {};
  state.grammarLog = {};
}

// 見直し中ならその記録を返す。記録が無ければ見直しをやめる
function activeReview(log) {
  if (state.reviewIndex === null) return null;
  const entry = log[state.reviewIndex];
  if (!entry) state.reviewIndex = null;
  return entry || null;
}

function reviewBack() {
  const c = reviewContext();
  const from = state.reviewIndex === null ? state[c.cur] : state.reviewIndex;
  if (!c.log[from - 1]) return;
  hideDuoBanner();
  state.reviewIndex = from - 1;
  c.render();
}

// 見直しの「次へ」。今の問題まで戻ってきたら、回答済みなら次の問題へ、未回答ならそのまま続きから解く
function reviewNext() {
  const c = reviewContext();
  const i = state.reviewIndex;
  hideDuoBanner();
  state.reviewIndex = null;
  if (i === state[c.cur]) state[c.cur]++;
  else if (c.log[i + 1]) state.reviewIndex = i + 1;
  c.render();
}

function updateBackButton() {
  const c = reviewContext();
  const from = state.reviewIndex === null ? state[c.cur] : state.reviewIndex;
  document.getElementById('back-btn').style.display = c.log[from - 1] ? 'block' : 'none';
}

// 見直し中の問題カードの先頭に「正解・不正解」などのラベルを付ける
function addReviewBadge(label, kind) {
  const card = document.querySelector('#quiz-container .card');
  if (card) card.insertAdjacentHTML('afterbegin', `<div class="review-badge ${kind}">見直し ・ ${label}</div>`);
}

// 不正解のときにカードを揺らす。揺らしたカードそのものを戻すので、0.4秒以内に次へ進んでも問題ない
function shakeCard() {
  const card = document.getElementById('main-card');
  if (!card) return;
  card.classList.add('shake');
  setTimeout(() => card.classList.remove('shake'), 400);
}

// 品詞は答えの推測材料になるので回答前は隠す。No.や正誤履歴しか無いときは品詞だけ隠し、すべて無ければ枠ごと隠す
function posTagHtml(word, showPos) {
  const no = word.no ? `<span style="font-weight:700;color:var(--gold);">No.${word.no}</span>` : '';
  const stText = wordStatLabel(word.w);
  const statHtml = `<span id="item-stat-text" class="item-stat-inline"${stText ? '' : ' hidden'}>${stText}</span>`;
  const hasVisible = Boolean(no || showPos || stText);
  return `<div class="pos-tag" id="pos-tag"${hasVisible ? '' : ' hidden'}>${no}<span id="pos-text"${showPos ? '' : ' hidden'}>${word.p}</span>${statHtml}</div>`;
}

function revealPos() {
  const tag = document.getElementById('pos-tag');
  const text = document.getElementById('pos-text');
  if (tag) tag.hidden = false;
  if (text) text.hidden = false;
}

// 選択肢を選ぶときは「名詞」と「名詞句」などを同じ品詞として扱う
const POS_GROUPS = { '名詞句': '名詞', '動詞句': '動詞', '形容詞句': '形容詞', '副詞句': '副詞', '句・表現': '表現' };
function posGroup(p) {
  return POS_GROUPS[p] || p;
}

// 4択の選択肢。品詞だけで正解が分からないよう、出題範囲 → 全単語の順に同じ品詞の単語を優先して選ぶ
function buildOptions(word) {
  const options = [word];
  const samePos = w => posGroup(w.p) === posGroup(word.p);
  const candidateLists = [state.pool.filter(samePos), RAW_WORDS.filter(samePos), state.pool, RAW_WORDS];
  for (const list of candidateLists) {
    for (const w of shuffle([...list])) {
      if (options.length >= 4) return shuffle(options);
      if (!options.some(x => x.w === w.w || x.m === w.m)) options.push(w);
    }
  }
  return shuffle(options);
}


function getCurrentPoolCount() {
  return state.app === 'grammar'
    ? (state.grammarPool ? state.grammarPool.length : 0)
    : (state.pool ? state.pool.length : 0);
}

const NUDGE_DISMISSED_KEY = 'toeic_nudge_dismissed_condition';

function getFilterStateKey() {
  if (state.app === 'grammar') {
    return `g_${state.grammarBook}_${state.grammarChapter.join(',') || 'all'}_${state.grammarRule || 'none'}_${state.grammarWeakFilter}`;
  }
  const dates = (state.dateFilter || []).slice().sort().join(',');
  const range = state.rangeFilter.map(r => `${r.start}-${r.end}`).join(',') || 'none';
  return `v_${state.sourceFilter}_${dates}_${state.posFilter.join(',') || 'all'}_${range}_${state.weakFilter}`;
}

function checkFilterNudge() {
  const modal = document.getElementById('filter-nudge-modal');
  const toggleBtn = document.getElementById('filter-toggle');
  if (!modal) return;
  if (typeof currentAppPage !== 'undefined' && currentAppPage !== 'practice') {
    modal.classList.remove('open');
    return;
  }

  const poolCount = getCurrentPoolCount();

  // 300問未満なら非表示＆消灯
  if (poolCount < 300) {
    modal.classList.remove('open');
    if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
    return;
  }

  // 「このまま解く」を押した条件と同じなら、条件を変えるまで一切出さない（localStorage記憶）
  const currentKey = getFilterStateKey();
  let dismissedCondition = null;
  try {
    dismissedCondition = localStorage.getItem(NUDGE_DISMISSED_KEY);
  } catch (e) {}

  if (dismissedCondition === currentKey) {
    modal.classList.remove('open');
    if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
    return;
  }

  // まだ閉じていない300問以上の条件なら、絞り込みボタンを発光
  if (toggleBtn) toggleBtn.classList.add('pulse-glow');

  // 1問目を解いた直後にモーダルで案内
  const answered = state.app === 'grammar' ? (state.grammarAnsweredCount || 0) : (state.answeredCount || 0);
  if (answered >= 1) {
    const bodyEl = modal.querySelector('.nudge-card-body');
    if (bodyEl) {
      bodyEl.innerHTML = `現在の出題数は <b>${poolCount}問</b> あります。<br><br>一度にすべて解き続けるより、<br><b>100問ほどに絞って繰り返し周回する</b>のが<br>定着への一番のおすすめです！<br><br>「日々の単語」や「苦手＋未出題」などに<br>絞り込んでみませんか？`;
    }
    modal.classList.add('open');
  }
}

function dismissNudge() {
  const modal = document.getElementById('filter-nudge-modal');
  const toggleBtn = document.getElementById('filter-toggle');
  if (modal) modal.classList.remove('open');
  if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
  try {
    localStorage.setItem(NUDGE_DISMISSED_KEY, getFilterStateKey());
  } catch (e) {}
}

function openFilterSheetFromNudge() {
  const modal = document.getElementById('filter-nudge-modal');
  const toggleBtn = document.getElementById('filter-toggle');
  if (modal) modal.classList.remove('open');
  if (toggleBtn) toggleBtn.classList.remove('pulse-glow');
  openFilterSheet();
}

function renderCurrent() {
  resetActionBar();
  checkFilterNudge();
  document.getElementById('choices-container').classList.remove('compact');
  const container = document.getElementById('quiz-container');
  const choicesDiv = document.getElementById('choices-container');
  const review = activeReview(state.wordLog);

  if (state.pool.length === 0) {
    container.innerHTML = `<div class="card"><div class="meaning-display">条件に合う単語がありません</div></div>`;
    choicesDiv.innerHTML = '';
    updateFooter();
    return;
  }

  if (!review && state.currentIndex >= state.pool.length) {
    container.innerHTML = `<div class="card completion-card">${pomeranianImage('celebrate', 'completion-mascot', 96)}<div class="meaning-display">完了！</div><div style="font-size:14px;color:var(--muted);margin-top:8px;">正答: ${state.score} / ${state.answeredCount}</div>${typeof sessionReviewHtml === 'function' ? sessionReviewHtml('vocab') : ''}</div>`;
    choicesDiv.innerHTML = '';
    updateFooter();
    return;
  }

  const word = state.pool[review ? state.reviewIndex : state.currentIndex];
  if (!review) state.answered = false; // 見直し中は今の問題の回答状況に触れない
  choicesDiv.innerHTML = '';

  if (state.mode === 'e2j' || state.mode === 'j2e') {
    container.innerHTML = `
      <div class="card" id="main-card">
        ${posTagHtml(word, false)}
        <div class="${state.mode === 'e2j' ? 'word-display' : 'meaning-display'}">${state.mode === 'e2j' ? word.w : word.m}</div>
        <div class="example-display" id="example-box">${word.e ? word.e : '<span style="opacity:0.45; font-style:italic;">（例文なし）</span>'}<br><br>${state.mode === 'e2j' ? word.m : word.w}</div>
      </div>
    `;

    const options = review ? review.opts : buildOptions(word);
    if (!review) state.currentOptions = options;

    options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerHTML = `<span class="choice-key">${idx + 1}</span><span class="choice-text">${state.mode === 'e2j' ? opt.m : opt.w}</span>`;
      if (!review) btn.onclick = () => handleAnswer(opt, btn);
      if (review) {
        if (opt.w === word.w) btn.classList.add('correct');
        else if (idx === review.sel) btn.classList.add('wrong');
      }
      choicesDiv.appendChild(btn);
    });
    if (review) {
      addReviewBadge(review.dk ? 'わからない' : (review.ok ? '正解' : '不正解'), review.ok ? 'ok' : 'ng');
      showDuoBanner(review.ok, `${word.w} : ${word.m}`, { review: true, skipped: review.dk });
      showAnswerDetails();
    } else {
      setDontKnowVisible(true);
      document.getElementById('dont-know-btn').onclick = handleDontKnow;
    }
  } else if (state.mode === 'flash') {
    container.innerHTML = `
      <div class="card flash-mode" id="flash-card">
        <div class="flip-card-inner">
          <div class="card-face">
            ${posTagHtml(word, false)}
            <div class="word-display">${word.w}</div>
          </div>
          <div class="card-face card-back">
            <div class="pos-tag">${word.p}</div>
            <div class="meaning-display">${word.m}</div>
            <div style="font-size: 14px; line-height: 1.5; color: ${word.e ? '#555' : 'var(--muted)'}; font-style: ${word.e ? 'normal' : 'italic'};">${word.e || '（例文なし）'}</div>
          </div>
        </div>
      </div>
    `;
    if (review) {
      // 見直しでは答えの面を先に出し、カードはタップでめくり返せるだけにする
      const flash = document.getElementById('flash-card');
      flash.classList.add('flipped');
      flash.onclick = () => flash.classList.toggle('flipped');
      addReviewBadge(review.ok ? '覚えた' : 'まだ', review.ok ? 'ok' : 'ng');
      showDuoBanner(review.ok, `${word.w} : ${word.m}`, { review: true, flash: true });
      showNextButton(reviewNext);
    } else {
      document.getElementById('flash-card').onclick = flipCard;
      document.getElementById('next-btn').innerText = 'めくる';
      showNextButton(flipCard);
    }
  } else if (state.mode === 'type') {
    container.innerHTML = `
      <div class="card" id="main-card">
        ${posTagHtml(word, false)}
        <div class="meaning-display">${word.m}</div>
        <div class="type-input-container">
          <input type="text" id="type-input" class="type-input" placeholder="英語で入力" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          <button class="type-check-btn" id="type-check-btn">答え合わせ</button>
        </div>
        <div class="type-result" id="type-result" style="display:none;"></div>
        <div class="example-display" id="example-box">${word.e ? word.e : '<span style="opacity:0.45; font-style:italic;">（例文なし）</span>'}</div>
      </div>
    `;
    const input = document.getElementById('type-input');
    if (!review) input.focus();
    input.addEventListener('keydown', e => {
      // 日本語入力の変換確定の Enter では答え合わせしない
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || state.answered) return;
      e.preventDefault();
      e.stopPropagation(); // 同じ Enter でキーボード操作の「次へ」まで進まないようにする
      handleTypeAnswer(input.value);
    });
    document.getElementById('type-check-btn').onclick = () => handleTypeAnswer(input.value);
    if (review) {
      input.value = review.typed;
      showTypeResult(word, review.ok, review.typed);
      addReviewBadge(review.dk ? 'わからない' : (review.ok ? '正解' : '不正解'), review.ok ? 'ok' : 'ng');
      showDuoBanner(review.ok, `${word.w} : ${word.m}`, { review: true, skipped: review.dk });
      showAnswerDetails();
    } else {
      setDontKnowVisible(true);
      document.getElementById('dont-know-btn').onclick = handleTypeDontKnow;
    }
  }

  updateFooter();
}

function handleAnswer(selectedOpt, btn) {
  const word = state.pool[state.currentIndex];
  answerChoice(selectedOpt.w === word.w, btn);
}

// 「わからない」: 正解を見せて苦手に登録。スコアは増やさず、赤表示や揺れは出さない
function handleDontKnow() {
  answerChoice(false, null);
}

function answerChoice(isCorrect, selectedBtn) {
  if (state.answered) return;
  state.answered = true;
  setDontKnowVisible(false);

  const word = state.pool[state.currentIndex];
  playDuoSound(isCorrect);
  showDuoBanner(isCorrect, `${word.w} : ${word.m}`, { skipped: !selectedBtn });

  document.querySelectorAll('#choices-container .choice-btn').forEach((b, i) => {
    if (state.currentOptions[i] && state.currentOptions[i].w === word.w) {
      b.classList.add('correct');
    }
  });

  if (isCorrect) {
    state.score++;
  } else if (selectedBtn) {
    selectedBtn.classList.add('wrong');
    shakeCard();
  }
  state.wordLog[state.currentIndex] = {
    ok: isCorrect,
    dk: !selectedBtn,
    sel: selectedBtn ? [...document.querySelectorAll('#choices-container .choice-btn')].indexOf(selectedBtn) : -1,
    opts: state.currentOptions,
  };
  recordWeak(word, isCorrect);
  showAnswerDetails();
}

// 回答後に品詞と例文を見せて次へボタンを出す（4択・タイプ共通）
function showAnswerDetails() {
  revealPos();
  document.getElementById('example-box').style.display = 'block';
  showNextButton(state.reviewIndex === null ? nextWord : reviewNext);
  updateFooter();
}

// カードモード: めくって答えを確かめてから「覚えた／まだ」で自己採点する
function flipCard() {
  const card = document.getElementById('flash-card');
  if (!card) return;
  card.classList.toggle('flipped');
  if (state.answered || state.reviewIndex !== null) return;
  const dk = document.getElementById('dont-know-btn');
  dk.innerText = 'まだ';
  dk.onclick = () => gradeFlash(false);
  setDontKnowVisible(true);
  document.getElementById('next-btn').innerText = '覚えた';
  showNextButton(() => gradeFlash(true));
}

function gradeFlash(known) {
  if (state.answered) return;
  state.answered = true;
  playDuoSound(known);
  if (known) state.score++;
  state.wordLog[state.currentIndex] = { ok: known };
  const word = state.pool[state.currentIndex];
  recordWeak(word, known);
  showDuoBanner(known, `${word.w} : ${word.m}`, { flash: true });
  setDontKnowVisible(false);
  document.getElementById('next-btn').innerText = '次へ';
  showNextButton(nextWord);
  updateFooter();
}

// 見出し語の「~」は入力不要、空白の揺れは無視して比較する
function normalizeTyped(str) {
  return str.replace(/[~～]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function handleTypeAnswer(val) {
  if (state.answered) return;
  if (!val.trim()) return; // 空のまま送信しても不正解にしない

  const word = state.pool[state.currentIndex];
  const isCorrect = word.w.split('/').map(normalizeTyped).includes(normalizeTyped(val));

  if (isCorrect) {
    state.score++;
  } else {
    shakeCard();
  }
  recordWeak(word, isCorrect);
  revealTypeAnswer(word, isCorrect, val);
}

function handleTypeDontKnow() {
  if (state.answered) return;
  const word = state.pool[state.currentIndex];
  recordWeak(word, false);
  revealTypeAnswer(word, false, '');
}

function revealTypeAnswer(word, isCorrect, typed) {
  state.answered = true;
  setDontKnowVisible(false);
  playDuoSound(isCorrect);
  showDuoBanner(isCorrect, `${word.w} : ${word.m}`, { skipped: !typed });
  state.wordLog[state.currentIndex] = { ok: isCorrect, dk: !typed, typed };
  showTypeResult(word, isCorrect, typed);
  showAnswerDetails();
}

// タイプ回答の結果（入力欄を固めて、あなたの回答と正解を出す）。回答直後と見直しで共通
function showTypeResult(word, isCorrect, typed) {
  const input = document.getElementById('type-input');
  input.disabled = true;
  input.blur();
  document.getElementById('type-check-btn').style.display = 'none';

  const result = document.getElementById('type-result');
  result.className = `type-result ${isCorrect ? 'ok' : 'ng'}`;
  result.innerHTML = isCorrect
    ? `<span class="type-result-label">正解</span><span class="type-result-answer">${escapeHtml(word.w)}</span>`
    : `${typed ? `<div><span class="type-result-label">あなた</span><span class="type-result-yours">${escapeHtml(typed)}</span></div>` : ''}
       <div><span class="type-result-label">正解</span><span class="type-result-answer">${escapeHtml(word.w)}</span></div>`;
  result.style.display = 'block';
}

function recordWeak(word, isCorrect) {
  state.answeredCount++;
  recordItemStat(state.wordStats, WORD_STATS_KEY, wordStatKey(word.w), isCorrect);
  const statEl = document.getElementById('item-stat-text');
  const tagEl = document.getElementById('pos-tag');
  if (statEl) {
    statEl.textContent = wordStatLabel(word.w);
    statEl.hidden = false;
  }
  if (tagEl) tagEl.hidden = false;
  updateWeakEntry(wordWeak(), word.w, isCorrect, `w:${state.mode}:${word.w}`);
  if (!wordSeen().has(word.w)) {
    wordSeen().add(word.w);
    saveJSON(SEEN_WORDS_KEY, seenSnapshot());
  }
  saveWeakData();
}

function updateFooter() {
  const isGrammar = state.app === 'grammar';
  const pool = isGrammar ? state.grammarPool : state.pool;
  const index = isGrammar ? state.currentGrammarIndex : state.currentIndex;
  const score = isGrammar ? state.grammarScore : state.score;
  const answered = isGrammar ? state.grammarAnsweredCount : state.answeredCount;
  const shown = state.reviewIndex === null ? index : state.reviewIndex; // 見直し中は見ている問題の番号を出す
  document.getElementById('progress-text').innerText = pool.length > 0 ? `${Math.min(shown + 1, pool.length)} / ${pool.length}` : '0 / 0';
  const rate = answered > 0 ? `（${Math.round(score / answered * 100)}%）` : '';
  document.getElementById('score-text').innerText = `正答 ${score} / ${answered}${rate}`;
  // 進捗バーは「回答済み（次へ進んだ）問題数 / プール全体」
  const done = Math.min(index, pool.length);
  document.getElementById('progress-fill').style.width = pool.length > 0 ? `${done / pool.length * 100}%` : '0';

  updateBackButton();

  // 表示が変わるたびに呼ばれるので、ここで設定と進み具合を保存しておく
  saveSettings();
  saveSession();
}

