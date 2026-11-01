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
