// ==================== 単語の絞り込みと次の問題 ====================
// 単語の絞り込み条件から出題プールを作り、次の問題へ進める。アクションバーの表示（resetActionBar など）は文法ドリルとも共通。

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
  hideLabelButton();
}

function showNextButton(onNext) {
  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = 'block';
  nextBtn.onclick = onNext;
  refreshLabelButton(); // 回答のあとだけ 🏷 を出す（カードのめくる前などは出さない）
}

function nextWord() {
  hideDuoBanner();
  state.currentIndex++;
  renderCurrent();
}
