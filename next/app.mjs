import { STORAGE_KEY, MODES, BOOKS, openStore, makeCatalog, weakMap, selectItems,
  choicesFor, startSession, validSession, recordAnswer } from './core.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arrow = '<span aria-hidden="true">→</span>';
const bookIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H3V4Zm18 0h-6a3 3 0 0 0-3 3v14a3 3 0 0 1 3-3h6V4Z"/></svg>';
const defaultConfig = () => ({ kind: 'grammar', source: 'kin', mode: 'e2j', filter: 'all', count: '10', chapters: [], pos: [], ranges: [], dates: [] });
let store;
try { store = openStore(window.localStorage); } catch { store = openStore(null); }
const data = store.data;
const catalog = makeCatalog(RAW_WORDS, RAW_GRAMMAR);
let draft = defaultConfig();
let reviewKind = 'grammar';
let reviewMode = 'e2j';
let reviewLimit = 20;
let flashRevealed = false;

const sourceName = (kind, source) => kind === 'grammar'
  ? BOOKS[source]?.title || 'すべての文法教材'
  : ({ daily: '日々の単語', teppan: 'TEPPAN', all: 'すべての単語' }[source]);
const option = (value, label, selected) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
const button = (label, action, secondary = false, extra = '') => `<button class="button${secondary ? ' secondary' : ''}" data-action="${action}" ${extra}>${label}</button>`;
const today = () => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
const currentSession = () => validSession(data.session, catalog) ? data.session : null;
const complete = s => s && s.ids.every(id => Object.hasOwn(s.answers, id));
function save() {
  const ok = store.save();
  $('#storage-notice').textContent = store.notice;
  $('#storage-notice').hidden = !store.notice;
  return ok;
}
function announce(text) { $('#announcement').textContent = text; }
function navigate(route) {
  if (location.hash === `#${route}`) render(true);
  else location.hash = route;
}
function applyTheme() {
  document.documentElement.dataset.theme = data.theme === 'dark' ? 'dark' : 'light';
}
function dueCount(kind, mode = 'e2j') {
  return selectItems(catalog, data.records, { ...defaultConfig(), kind, mode, source: 'all', filter: 'due' }).length;
}
function home() {
  const s = currentSession();
  const active = s && !complete(s);
  const due = dueCount('grammar') + dueCount('vocab');
  const imported = data.importedItems || 0;
  return `<div class="home-heading"><div><p class="eyebrow">Your daily study space</p><h1>おかえりなさい。</h1></div><span class="date-label">${today()}</span></div>
    <div class="hero-grid"><section class="study-card"><p class="eyebrow">${active ? 'Continue learning' : 'A little progress, every day'}</p>
      <h2>${active ? `${esc(sourceName(s.config.kind, s.config.source))}<br>前回の続きから。` : '今日の一問が、<br>明日の自信に。'}</h2>
      <p class="subtext">${active ? `${s.ids.length}問中 ${Object.keys(s.answers).length}問を解答済み` : '教材を開いて、まずは10問。自分のペースで始めよう。'}</p>
      ${button(active ? `続きから ${arrow}` : `10問から始める ${arrow}`, active ? 'resume' : 'quick-start')}</section>
      <section class="review-card"><h2>今日の復習</h2><div class="count">${due}<small>問</small></div>
        <p class="subtext">${due ? '復習のタイミングが来ています。' : '今、復習が必要な問題はありません。'}<br>文法と単語〈英 → 日〉</p><a class="text-link" href="#review">復習を確認する ${arrow}</a></section></div>
    <div class="section-heading"><h2>あなたの教材</h2><small>今日は、どこから始めよう。</small></div>
    <section class="bookshelf" aria-label="教材一覧">${[
      ...Object.entries(BOOKS).map(([source, book]) => ({ kind: 'grammar', source, ...book })),
      { kind: 'vocab', source: 'teppan', title: 'TEPPAN', subtitle: '頻出単語を、確かな語彙に。', color: 'blue' },
      { kind: 'vocab', source: 'daily', title: '日々の単語', subtitle: '出会った言葉を、自分のものに。', color: 'green' },
    ].filter(b => catalog.items.some(i => i.kind === b.kind && i.source === b.source)).map((b, index) => {
      const count = selectItems(catalog, data.records, { ...defaultConfig(), kind: b.kind, source: b.source }).length;
      return `<a class="book-card ${b.color}" href="#setup/${b.kind}/${b.source}"><span class="book-glyph" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><h3>${b.title}</h3><p>${b.subtitle}</p><span class="book-bottom"><span>${b.kind === 'grammar' ? '文法' : '単語'} · ${count.toLocaleString()}${b.kind === 'grammar' ? '問' : '語'}</span>${arrow}</span></a>`;
    }).join('')}</section>
    <aside class="trial-note">新しい学習スペースをお試しいただけます。${imported ? `従来版の成績 ${imported}項目をもとに始めています。` : ''}試用版での学習はこの端末に保存され、従来版やGoogle Driveには反映されません。<a href="../">従来版はいつでも使えます。</a></aside>`;
}

function checks(name, values, selected) {
  return `<div class="checkboxes">${values.map(([value, label]) => `<label class="check-label"><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div>`;
}
function setup() {
  const grammar = draft.kind === 'grammar';
  const pool = selectItems(catalog, data.records, draft);
  const chapters = [...new Map(catalog.items.filter(i => i.kind === 'grammar' && i.source === draft.source).map(i => [i.ch, i.ch_title])).entries()];
  const sources = grammar ? Object.entries(BOOKS).filter(([id]) => catalog.items.some(i => i.kind === 'grammar' && i.source === id)).map(([id, b]) => [id, b.title]) : [['teppan', 'TEPPAN'], ['daily', '日々の単語']];
  const dates = [...new Set(RAW_WORDS.filter(w => w.s === 'daily').map(w => w.d))].filter(Boolean).sort().reverse();
  const maxNo = Math.max(...RAW_WORDS.filter(w => w.s === 'teppan').map(w => w.no));
  return `<div class="narrow"><a class="back-link" href="#home">← ホームに戻る</a><div class="page-title"><p class="eyebrow">Set your pace</p><h1>${esc(sourceName(draft.kind, draft.source))}</h1><p>範囲と問題数を選んで、学習を始めましょう。</p></div>
    <form id="setup-form" class="panel"><div class="form-grid">
      <div class="field"><label for="source">教材</label><select id="source" name="source">${option('all', 'すべて', draft.source)}${sources.map(([v, l]) => option(v, l, draft.source)).join('')}</select></div>
      <div class="field"><label for="count">今回の問題数</label><select id="count" name="count">${[['10', '10問'], ['20', '20問'], ['all', '条件に合う問題すべて']].map(([v, l]) => option(v, l, draft.count)).join('')}</select></div>
      ${!grammar ? `<div class="field"><label for="mode">答え方</label><select id="mode" name="mode">${Object.entries(MODES).map(([v, l]) => option(v, l, draft.mode)).join('')}</select></div>` : ''}
      <div class="field"><label for="filter">出題する問題</label><select id="filter" name="filter">${[['all', 'すべて'], ['due', '今日の復習'], ['weak', '苦手のみ'], ['weak_unseen', '苦手 ＋ 未学習'], ['unseen', '未学習のみ']].map(([v, l]) => option(v, l, draft.filter)).join('')}</select></div>
    </div>
    ${grammar && chapters.length ? `<fieldset><legend>章・ユニット（複数選択可）</legend>${checks('chapters', chapters.map(([n, title]) => [n, `${n}. ${title}`]), draft.chapters)}<p class="help">未選択なら、この教材の全範囲から出題します。</p></fieldset>` : ''}
    ${!grammar ? `<details><summary>範囲・品詞を詳しく選ぶ</summary><fieldset><legend>品詞</legend>${checks('pos', [...new Set(RAW_WORDS.map(w => w.p))].map(p => [p, p]), draft.pos)}</fieldset>
      ${draft.source === 'teppan' ? `<fieldset><legend>単語番号</legend>${checks('ranges', Array.from({ length: Math.ceil(maxNo / 100) }, (_, i) => [i * 100 + 1, `${i * 100 + 1}–${Math.min((i + 1) * 100, maxNo)}`]), draft.ranges)}</fieldset>` : ''}
      ${draft.source === 'daily' ? `<fieldset><legend>追加日</legend>${checks('dates', dates.map(d => [d, d]), draft.dates)}</fieldset>` : ''}<p class="help">各項目は複数選択できます。未選択なら全範囲です。</p></details>` : ''}
    <div class="form-footer"><p id="pool-count" role="status">対象 <strong>${pool.length}</strong> 問</p><button class="button" type="submit" ${pool.length ? '' : 'disabled'}>${pool.length ? `${draft.count === 'all' ? pool.length : Math.min(Number(draft.count), pool.length)}問を始める ${arrow}` : '条件に合う問題がありません'}</button></div>
    ${currentSession() && !complete(currentSession()) ? '<p class="help">新しく始めると、途中の演習は置き換わります。これまでの成績と苦手記録は残ります。</p>' : ''}</form></div>`;
}

function prepareChoices(item, session) {
  if (!session.choices[item.id]) {
    const value = choicesFor(item, catalog, session.config.mode);
    value.correct ??= value.labels.indexOf(value.answer);
    session.choices[item.id] = value;
    save();
  }
  return session.choices[item.id];
}
function explanation(item, result) {
  const grammar = item.kind === 'grammar';
  const correct = grammar ? item.c[item.a] : item.w;
  return `<aside class="answer-panel ${result.correct ? '' : 'is-wrong'}" aria-label="解答と解説"><h2>${result.correct ? '✓ 正解です' : result.dontKnow ? '答えを確認しましょう' : 'もう一度、確認しましょう'}</h2>
    <p class="answer-label">正解</p><p class="answer-value">${esc(correct)}</p>
    ${result.typed && !result.correct ? `<p class="answer-label">あなたの回答</p><p>${esc(result.typed)}</p>` : ''}
    ${grammar ? `<p class="answer-label">${esc(item.ch_title)}${item.th_title ? ` · ${esc(item.th_title)}` : ''}</p><p class="explanation">${esc(item.exp || 'この問題には詳しい解説がまだ収録されていません。教材と照らし合わせて確認してください。')}</p>
      ${item.rule?.title ? `<details><summary>関連するルール</summary><p class="explanation">${esc(item.rule.title)}</p></details>` : ''}
      ${item.v?.length ? `<details><summary>重要語彙</summary><ul>${item.v.map(v => `<li><strong>${esc(v.word)}</strong> — ${esc(v.meaning)}</li>`).join('')}</ul></details>` : ''}`
      : `<p class="explanation">${esc(item.m)}</p><p class="answer-label">例文</p><p class="explanation" lang="en">${esc(item.e || 'この単語の例文はまだありません。')}</p>`}
    <p class="help">${result.correct ? '「次へ」で続けられます。' : '苦手として記録しました。復習からもう一度取り組めます。'}</p></aside>`;
}
function exercise() {
  const s = currentSession();
  if (!s) return '<div class="empty"><h1>学習する教材を選びましょう</h1><p class="subtext">前回の演習がないか、教材が更新されています。成績と苦手記録は残っています。</p><a class="text-link" href="#home">ホームへ →</a></div>';
  if (s.cursor >= s.ids.length) return summary(s);
  const item = catalog.byId.get(s.ids[s.cursor]);
  const result = s.answers[item.id];
  const mode = s.config.mode;
  const grammar = item.kind === 'grammar';
  let interaction = '';
  if (grammar || ['e2j', 'j2e'].includes(mode)) {
    const choices = prepareChoices(item, s);
    interaction = `<div class="choices" aria-label="選択肢">${choices.labels.map((label, i) => {
      const correct = result && i === choices.correct;
      const wrong = result && !result.correct && result.selected === i;
      return `<button class="choice ${correct ? 'correct' : wrong ? 'wrong' : ''}" data-action="answer" data-index="${i}" ${result ? 'disabled' : ''}><span class="choice-key">${String.fromCharCode(65 + i)}</span><span class="choice-text">${esc(label)}</span>${correct || wrong ? `<span class="choice-state">${correct ? '正解' : 'あなたの回答'}</span>` : ''}</button>`;
    }).join('')}</div>`;
  } else if (mode === 'type') {
    interaction = `<form id="type-form" class="type-form"><label for="typed-answer">英単語を入力</label><input id="typed-answer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(result?.typed || '')}" ${result ? 'disabled' : ''}><button class="button" ${result ? 'disabled' : ''}>答え合わせ</button></form>`;
  } else {
    interaction = flashRevealed || result
      ? `<div class="flash-answer"><p class="answer-value">${esc(item.m)}</p><p class="explanation">${esc(item.e)}</p></div>${!result ? `<div class="flash-actions">${button('まだ覚えていない', 'flash-wrong', true)}${button('覚えていた', 'flash-correct')}</div>` : ''}`
      : `<div class="flash-actions">${button('意味を見る', 'reveal', true)}</div>`;
  }
  let prompt = grammar ? esc(item.q).replace(/-{3,}/g, '<span class="blank">_______</span>') : esc(['j2e', 'type'].includes(mode) ? item.m : item.w);
  return `<div class="exercise-top"><a class="back-link" href="#home">← 中断してホームへ</a><div class="progress-row"><span>${esc(sourceName(s.config.kind, s.config.source))}</span><span>${s.cursor + 1} / ${s.ids.length} 問</span></div><progress value="${Object.keys(s.answers).length}" max="${s.ids.length}" aria-label="解答済みの問題数"></progress></div>
    <div class="exercise-layout"><section class="panel question-panel"><div class="question-meta"><span>${grammar ? `文法 · No. ${esc(item.key)}` : `単語 · ${MODES[mode]}`}</span><span>${esc(sourceName(item.kind, item.source))}</span></div>
      <h1 class="question-text ${grammar ? '' : 'word-text'}" id="question-heading" tabindex="-1">${prompt}</h1>${interaction}</section>
      ${result ? explanation(item, result) : `<aside class="answer-placeholder">${bookIcon}<p>まずは、自分の力で。</p><p class="subtext">回答すると、正解と解説がここに表示されます。わからないときは、そのまま答えを確認できます。</p></aside>`}</div>
    <div class="exercise-actions">${button('← 前の問題', 'previous', true, s.cursor === 0 ? 'disabled' : '')}<div>${result ? button(s.cursor === s.ids.length - 1 ? '結果を見る →' : '次へ →', 'next') : button('わからない', 'dont-know', true)}</div></div>
    <p class="shortcut-help">${grammar || ['e2j', 'j2e'].includes(mode) ? 'A–E / 1–5：回答　 ·　 ' : ''}0：わからない　 ·　 Enter：次へ</p>`;
}
function summary(s) {
  const answers = Object.values(s.answers);
  const correct = answers.filter(a => a.correct).length;
  const wrong = answers.filter(a => !a.correct).length;
  return `<section class="narrow panel summary-card"><p class="eyebrow">Session complete</p><h1>おつかれさまでした。</h1><p class="subtext">${esc(sourceName(s.config.kind, s.config.source))} · ${s.ids.length}問の演習</p><div class="summary-score">${correct}<small> / ${s.ids.length}</small></div><p>${wrong ? `${wrong}問を苦手リストに記録しました。もう一度解いて、理解を確かめましょう。` : 'すべて正解です。次の学習も、自分のペースで。'}</p><div class="summary-actions">${wrong ? button(`間違えた${wrong}問をもう一度`, 'retry') : button('同じ条件で新しく解く', 'repeat')}<a class="button secondary" href="#home">ホームへ</a></div><p class="help">この結果は試用版の記録として保存されます。</p></section>`;
}
function review() {
  const config = { ...defaultConfig(), kind: reviewKind, source: 'all', mode: reviewMode, filter: 'weak' };
  const map = weakMap(data.records, reviewKind, reviewMode);
  const items = selectItems(catalog, data.records, config).sort((a, b) => map[a.key].due - map[b.key].due);
  const due = dueCount(reviewKind, reviewMode);
  return `<div class="narrow"><div class="page-title"><p class="eyebrow">Review notebook</p><h1>もう一度が、力になる。</h1><p>苦手な問題を、復習のタイミングに合わせて。</p></div><div class="review-tools"><div class="field"><label for="review-kind">学習対象</label><select id="review-kind">${option('grammar', '文法', reviewKind)}${option('vocab', '単語', reviewKind)}</select></div>${reviewKind === 'vocab' ? `<div class="field"><label for="review-mode">答え方</label><select id="review-mode">${Object.entries(MODES).map(([v, l]) => option(v, l, reviewMode)).join('')}</select></div>` : ''}</div>
      <div class="form-footer" style="margin:0 0 24px;border-top:0;padding-top:0"><p>苦手 ${items.length}問 · 今日の復習 ${due}問</p>${button('今日の復習を始める →', 'review-due', false, due ? '' : 'disabled')}</div>
      <div class="review-list">${items.slice(0, reviewLimit).map(item => `<details class="review-item"><summary>${esc(reviewKind === 'grammar' ? item.q : item.w)}</summary><p class="review-meta">${esc(sourceName(item.kind, item.source))} · ${map[item.key].due <= Date.now() ? '今日の復習' : `次の復習 ${new Date(map[item.key].due).toLocaleDateString('ja-JP')}`}</p><p class="answer-value">${esc(reviewKind === 'grammar' ? item.c[item.a] : item.m)}</p><p class="explanation">${esc(reviewKind === 'grammar' ? item.exp || '詳しい解説は教材で確認してください。' : item.e)}</p>${button('この問題を解く', 'review-one', true, `data-id="${esc(item.id)}"`)}</details>`).join('') || '<div class="empty"><h2>苦手リストは空です。</h2><p class="subtext">演習で間違えた問題や「わからない」を選んだ問題が、ここに並びます。</p><a class="text-link" href="#home">教材を選ぶ →</a></div>'}</div>
      ${items.length > reviewLimit ? `<div class="summary-actions">${button('さらに20問を見る', 'more-review', true)}</div>` : ''}</div>`;
}
function settings() {
  return `<div class="narrow"><a class="back-link" href="#home">← ホームに戻る</a><div class="page-title"><p class="eyebrow">Your preferences</p><h1>試用版の設定</h1></div>
    <section class="panel settings-section"><h2>Study Desk の表示</h2><p>落ち着いた紙の色と、夜に使いやすいダーク表示。</p><div class="setting-buttons">${button('ライト', 'light', data.theme !== 'light', `aria-pressed="${data.theme !== 'dark'}"`)}${button('ダーク', 'dark', data.theme !== 'dark', `aria-pressed="${data.theme === 'dark'}"`)}</div></section>
    <section class="panel settings-section"><h2>学習記録について</h2><p>初回に、このブラウザにある従来版の成績・苦手・学習済み記録をコピーしています。その後は試用版専用の記録として、この端末内に保存します。従来版の途中の演習や出題設定は引き継ぎません。</p><p>試用版からGoogle DriveやObsidianへの同期は行いません。別の端末への自動同期もありません。従来版へ戻っても、試用版で解いた結果は従来版に反映されません。</p><p>コピー日時：${new Date(data.importedAt).toLocaleString('ja-JP')}</p>${button('試用版の記録を書き出す', 'export', true)}<p class="help">JSONファイルとして保存します。従来版の復元用ファイルとは形式が異なります。試用版への取り込み機能は今後追加予定です。</p></section>
    <section class="panel settings-section"><h2>いつでも、いつもの学習へ</h2><p>従来版はこれまでと同じURLで使えます。</p><a class="button secondary" href="../">従来版を開く ↗</a></section></div>`;
}

function render(focus = false) {
  const route = location.hash.slice(1) || 'home';
  const section = route.split('/')[0];
  if (section === 'setup') {
    const [, kind, source] = route.split('/');
    if (['grammar', 'vocab'].includes(kind) && ['all', ...Object.keys(BOOKS), 'teppan', 'daily'].includes(source) &&
      (draft.kind !== kind || draft.source !== source)) draft = { ...defaultConfig(), kind, source };
  }
  $('#main').innerHTML = section === 'setup' ? setup() : section === 'exercise' ? exercise() : section === 'review' ? review() : section === 'settings' ? settings() : home();
  document.querySelectorAll('[data-nav]').forEach(a => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${({ home: 'ホーム', setup: '出題設定', exercise: '演習', review: '復習', settings: '設定' }[section] || 'ホーム')} — Study Desk 試用版`;
  if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
function begin(config, items) {
  if (!items.length) return;
  data.session = startSession(items, config, catalog);
  flashRevealed = false;
  save();
  navigate('exercise');
}
function answer(result) {
  const s = currentSession();
  if (!s || s.cursor >= s.ids.length) return;
  const item = catalog.byId.get(s.ids[s.cursor]);
  if (recordAnswer(data, item, result)) {
    save();
    render();
    $('[data-action="next"]')?.focus({ preventScroll: true });
    announce(result.correct ? '正解です。解説を確認して、次の問題へ進めます。' : '答えと解説を表示しました。苦手として記録しました。');
  }
}
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'toeic-study-desk-preview', exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `study-desk-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  const s = currentSession();
  if (action === 'quick-start') { draft = defaultConfig(); navigate('setup/grammar/kin'); }
  if (action === 'resume') navigate('exercise');
  if (action === 'answer' && s) {
    const item = catalog.byId.get(s.ids[s.cursor]);
    const selected = Number(target.dataset.index);
    answer({ correct: selected === prepareChoices(item, s).correct, selected });
  }
  if (action === 'dont-know') answer({ correct: false, dontKnow: true });
  if (action === 'reveal') { flashRevealed = true; render(); $('[data-action="flash-correct"]')?.focus({ preventScroll: true }); }
  if (action === 'flash-correct' || action === 'flash-wrong') answer({ correct: action === 'flash-correct' });
  if (action === 'next' && s && s.answers[s.ids[s.cursor]]) {
    s.cursor++; flashRevealed = false; save(); render(true);
  }
  if (action === 'previous' && s && s.cursor > 0) { s.cursor--; flashRevealed = false; save(); render(true); }
  if (action === 'retry' && s) begin({ ...s.config, count: 'all' }, s.ids.filter(id => s.answers[id] && !s.answers[id].correct).map(id => catalog.byId.get(id)));
  if (action === 'repeat' && s) {
    const items = selectItems(catalog, data.records, s.config);
    if (items.length) begin(s.config, items);
    else { draft = structuredClone(s.config); navigate(`setup/${draft.kind}/${draft.source}`); }
  }
  if (action === 'review-due') {
    const config = { ...defaultConfig(), kind: reviewKind, mode: reviewMode, source: 'all', filter: 'due', count: '20' };
    begin(config, selectItems(catalog, data.records, config));
  }
  if (action === 'review-one') {
    const item = catalog.byId.get(target.dataset.id);
    begin({ ...defaultConfig(), kind: reviewKind, mode: reviewMode, source: item.source, count: 'all' }, [item]);
  }
  if (action === 'more-review') { reviewLimit += 20; render(); $('[data-action="more-review"]')?.focus({ preventScroll: true }); }
  if (action === 'light' || action === 'dark') { data.theme = action; save(); applyTheme(); render(); $(`[data-action="${action}"]`)?.focus({ preventScroll: true }); }
  if (action === 'export') exportData();
});
document.addEventListener('submit', event => {
  if (event.target.id === 'setup-form') {
    event.preventDefault();
    begin(draft, selectItems(catalog, data.records, draft));
  }
  if (event.target.id === 'type-form') {
    event.preventDefault();
    const s = currentSession();
    if (!s || s.answers[s.ids[s.cursor]]) return;
    const typed = $('#typed-answer').value.trim();
    if (!typed) { $('#typed-answer').focus(); return; }
    const normalized = text => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    answer({ correct: normalized(typed) === normalized(catalog.byId.get(s.ids[s.cursor]).w), typed });
  }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.closest('#setup-form')) {
    const form = new FormData($('#setup-form'));
    const changedSource = draft.source !== form.get('source');
    draft = { ...draft, source: form.get('source'), count: form.get('count'), mode: form.get('mode') || 'e2j', filter: form.get('filter'),
      chapters: changedSource ? [] : form.getAll('chapters').map(Number), pos: form.getAll('pos'),
      ranges: changedSource ? [] : form.getAll('ranges').map(Number), dates: changedSource ? [] : form.getAll('dates') };
    if (changedSource) history.replaceState(null, '', `#setup/${draft.kind}/${draft.source}`);
    const detailsOpen = $('#setup-form details')?.open;
    const name = el.name, value = el.value;
    render();
    if (detailsOpen && $('#setup-form details')) $('#setup-form details').open = true;
    [...document.querySelectorAll('#setup-form input, #setup-form select')].find(x => x.name === name && x.value === value)?.focus({ preventScroll: true });
  }
  if (el.id === 'review-kind') { reviewKind = el.value; reviewLimit = 20; render(); $('#review-kind').focus(); }
  if (el.id === 'review-mode') { reviewMode = el.value; reviewLimit = 20; render(); $('#review-mode').focus(); }
});
document.addEventListener('keydown', event => {
  if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || location.hash !== '#exercise') return;
  const s = currentSession();
  if (!s || s.cursor >= s.ids.length) return;
  if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('button, a, summary')) return;
  const key = event.key.toLowerCase();
  const index = /^[1-5]$/.test(key) ? Number(key) - 1 : /^[a-e]$/.test(key) ? key.charCodeAt(0) - 97 : -1;
  const target = index >= 0 ? document.querySelectorAll('.choice')[index] : key === '0' ? $('[data-action="dont-know"]') :
    ['Enter', ' '].includes(event.key) ? $('[data-action="next"]') || $('[data-action="reveal"]') : null;
  if (target && !target.disabled) { event.preventDefault(); target.click(); }
});
window.addEventListener('hashchange', () => { flashRevealed = false; render(true); });
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) {
    $('#storage-notice').textContent = '別のタブで試用版の記録が更新されました。続ける前に、この画面を再読み込みしてください。';
    $('#storage-notice').hidden = false;
  }
});
const connection = () => { $('#offline-notice').hidden = navigator.onLine; };
window.addEventListener('online', connection);
window.addEventListener('offline', connection);
applyTheme();
save();
render();
connection();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
    // Online study remains available; do not touch any existing registration.
  });
}
