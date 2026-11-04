// ==================== 単語ドリル（出題・回答・記録） ====================
// 単語の問題を 1 問ずつ表示し、4 つの答え方（英→日・日→英・カード・タイプ）の回答を受けて、苦手と出題済みを記録する。
// 文法ドリルは grammar-drill.js、前の問題の見直しは review-prev.js。

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

// 豆知識（data/tips.js）。無い単語は空文字。回答前は答えのヒントになるので隠し、showAnswerDetails で出す
function tipHtml(word, hidden) {
  const tip = typeof WORD_TIPS !== 'undefined' && WORD_TIPS[word.w];
  if (!tip) return '';
  return `<div class="tip-box" id="tip-box"${hidden ? ' hidden' : ''}><span class="tip-label">💡 豆知識</span>${escapeHtml(tip)}</div>`;
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
        ${tipHtml(word, true)}
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
            ${tipHtml(word, false)}
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
        ${tipHtml(word, true)}
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

// 回答後に品詞・例文・豆知識を見せて次へボタンを出す（4択・タイプ共通）
function showAnswerDetails() {
  revealPos();
  document.getElementById('example-box').style.display = 'block';
  const tip = document.getElementById('tip-box');
  if (tip) {
    tip.hidden = false;
    tip.scrollIntoView({ block: 'nearest' }); // カードの高さが足りない画面でも豆知識まで見えるようにする
  }
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

