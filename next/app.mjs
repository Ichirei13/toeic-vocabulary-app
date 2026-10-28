import { STORAGE_KEY, MODES, BOOKS, openStore, makeCatalog, weakMap, selectItems,
  choicesFor, startSession, validSession, recordAnswer } from './core.mjs';
import { companionVisible, feedbackModel, companionMarkup } from './companion.mjs';
import { activitySummary, monthModel, setDailyGoal, localDateKey } from './activity.mjs';
import { goalMarkup, calendarMarkup, learningSettingsMarkup } from './learning-ui.mjs';
import { bookProgress, reviewSummary } from './progress.mjs';
import { rememberPreset, resolvePreset, presetKey } from './preferences.mjs';
import { THEMES, themeById, sessionRewards, playAnswerSound } from './themes.mjs';
import { createBackup, parseBackup, recordCounts, prepareRestore, prepareUndo, MAX_BACKUP_BYTES } from './backup.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arrow = '<span aria-hidden="true">→</span>';
const bookIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H3V4Zm18 0h-6a3 3 0 0 0-3 3v14a3 3 0 0 1 3-3h6V4Z"/></svg>';
const starIcon = '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="m32 5 8 17 19 3-14 14 3 19-16-9-16 9 3-19L5 25l19-3Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="m23 33 6 6 13-14" stroke="var(--bg)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
let pendingBackup = null;
let restoreMode = 'merge';
let undoPreview = false;
let backupMessage = '';
let fileReadVersion = 0;
let filterDraft = null;
let themeGalleryOpen = false;
let calendarMonth = localDateKey(new Date()).slice(0,7);
let goalReached = false;
let lastDate = localDateKey(new Date());
let dayTimer;
let calendarTrigger;
let setupRoute = '';
let presetNotice = '';
let pendingSetupNotice = '';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const dockObserver = new ResizeObserver(entries => {
  const dock = entries[0]?.target;
  if (dock?.isConnected) document.body.style.setProperty('--exercise-dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
});
const compactLayout = window.matchMedia('(max-width: 768px)');
const FILTERS = [['all', 'すべて'], ['due', '今日の復習'], ['weak', '苦手のみ'], ['weak_unseen', '苦手 ＋ 未学習'], ['unseen', '未学習のみ']];

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
  const theme = themeById(data.theme);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.scheme = theme.scheme;
  $('meta[name="theme-color"]').content = theme.bg;
}
const paletteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>';
const flameIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3c1 5-5 5-5 9 0 2 1 3 2 3-1-4 4-4 4-7 3 3 5 6 5 9a6 6 0 0 1-12 0C4 12 8 8 12 3Z"/></svg>';
const diamondIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 9 4-5h10l4 5-9 12L3 9ZM3 9h18M7 4l5 17 5-17"/></svg>';
function rewards(s) {
  const reward = sessionRewards(s);
  return `<div class="duo-rewards" aria-label="今回の演習の記録"><span class="reward-pill">${flameIcon}<span>${reward.streak} 連続正解</span></span><span class="reward-pill xp">${diamondIcon}<span>${reward.xp} XP</span></span></div>`;
}
function themePicker() {
  return `<div class="theme-grid" aria-label="テーマ一覧">${THEMES.map(theme => `<button class="theme-option" data-theme-id="${theme.id}" aria-pressed="${themeById(data.theme).id === theme.id}" style="--sample-bg:${theme.bg};--sample-surface:${theme.surface};--sample-accent:${theme.accent}"><span class="theme-preview" aria-hidden="true"><span class="sample-line"></span><span class="sample-card"><i></i><i></i></span><span class="sample-button"></span></span><span class="theme-name">${theme.name}<span class="theme-check" aria-hidden="true">${themeById(data.theme).id === theme.id ? '✓' : ''}</span></span><span class="theme-note">${theme.note}</span></button>`).join('')}</div>`;
}
function dueCount(kind, mode = 'e2j') {
  return selectItems(catalog, data.records, { ...defaultConfig(), kind, mode, source: 'all', filter: 'due' }).length;
}
function home() {
  const s = currentSession();
  const active = s && !complete(s);
  const previous = data.preferences.recentPreset ? data.preferences.presets[data.preferences.recentPreset] : null;
  const due = dueCount('grammar') + dueCount('vocab');
  const imported = data.importedItems || 0;
  const counts = recordCounts(data.records);
  const totalCorrect = [...Object.values(data.records.wordStats), ...Object.values(data.records.grammarStats)].reduce((n, x) => n + x.c, 0);
  return `<div class="home-heading"><div><p class="eyebrow">${today()} · Your study space</p><h1>おかえりなさい。</h1></div><button class="theme-trigger" data-action="open-themes">${paletteIcon}<span>${themeById(data.theme).name}</span></button></div>
    <div id="daily-goal-strip">${goalMarkup(activitySummary(data.activity,data.preferences.dailyGoal))}</div>
    <div class="hero-grid"><section class="study-card"><p class="eyebrow">${active ? 'Continue learning' : 'A little progress, every day'}</p>
      <h2>${active ? `${esc(sourceName(s.config.kind, s.config.source))}<br>前回の続きから。` : previous ? `${esc(sourceName(previous.kind, previous.source))}<br>いつもの条件で。` : '今日も、10問から。'}</h2>
      <p class="subtext">${active ? `${s.ids.length}問中 ${Object.keys(s.answers).length}問を解答済み` : previous ? esc(filterSummary(previous) + ' · ' + (previous.count === 'all' ? '対象すべて' : previous.count + '問')) : '金の文法からランダムに出題します。'}</p>
      ${button(active ? `続きから ${arrow}` : previous ? `前回の条件で開始 ${arrow}` : `10問から始める ${arrow}`, active ? 'resume' : previous ? 'previous-start' : 'quick-start')}</section>
      <section class="review-card"><h2>今日の復習</h2><div class="count">${due}<small>問</small></div>
        <p class="subtext">${due ? '復習のタイミングが来ています。' : '今、復習が必要な問題はありません。'}<br>文法と単語〈英 → 日〉</p><a class="text-link" href="#review">復習を確認する ${arrow}</a></section></div>
    ${[['vocab', '単語'], ['grammar', '文法']].map(([kind, title]) => {
      const books = (kind === 'grammar'
        ? Object.entries(BOOKS).map(([source, book]) => ({ kind, source, ...book }))
        : [
          { kind, source: 'teppan', title: 'TEPPAN', subtitle: '頻出単語を、確かな語彙に。', color: 'blue' },
          { kind, source: 'daily', title: '日々の単語', subtitle: '出会った言葉を、自分のものに。', color: 'green' },
        ]).filter(b => catalog.items.some(i => i.kind === kind && i.source === b.source));
      if (!books.length) return '';
      return `<section aria-labelledby="library-${kind}"><div class="section-heading"><h2 id="library-${kind}">${title}</h2></div>
        <div class="bookshelf">${books.map((b, index) => {
          const progress = bookProgress(catalog,data.records,kind,b.source);
          const unit = kind === 'grammar' ? '問' : '語';
          return `<a class="book-card ${b.color}" href="#setup/${kind}/${b.source}"><span class="book-glyph" aria-hidden="true"><span>${String(index + 1).padStart(2, '0')}</span>${bookIcon}</span><span class="book-info"><small class="book-kind">${kind === 'grammar' ? 'GRAMMAR' : 'VOCABULARY'}</small><h3>${b.title}</h3><p>${b.subtitle}</p><span class="book-bottom"><span>学習済み ${progress.seen} / ${progress.total}${unit}</span><span class="book-arrow" aria-hidden="true">↗</span></span><span class="book-progress" role="progressbar" aria-label="${esc(b.title)}の学習済み" aria-valuemin="0" aria-valuemax="${progress.total || 1}" aria-valuenow="${progress.seen}"><i style="width:${progress.total ? progress.seen / progress.total * 100 : 0}%"></i></span><span class="book-unseen">未学習 ${progress.unseen}${unit}${kind === 'vocab' ? ' · いずれかのモードで回答済み' : ''}</span></span></a>`;
        }).join('')}</div></section>`;
    }).join('')}
    <dl class="study-overview"><div><dt>これまでの回答</dt><dd>${counts.answers.toLocaleString()}<small> 回</small></dd></div><div><dt>正答率</dt><dd>${counts.answers ? Math.round(totalCorrect / counts.answers * 100) + '<small> %</small>' : '—'}</dd></div><div><dt>学習済みの文法</dt><dd>${counts.seenGrammar.toLocaleString()}<small> 問</small></dd></div></dl>
    <aside class="trial-note">新しい学習スペースをお試しいただけます。${imported ? `従来版の成績 ${imported}項目をもとに始めています。` : ''}試用版での学習はこの端末に保存され、従来版やGoogle Driveには反映されません。<a href="../">従来版はいつでも使えます。</a></aside>`;
}

function checks(name, values, selected) {
  return `<div class="checkboxes">${values.map(([value, label]) => `<label class="check-label"><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div>`;
}
function filterFields(config) {
  const grammar = config.kind === 'grammar';
  const chapters = [...new Map(catalog.items.filter(i => i.kind === 'grammar' && i.source === config.source).map(i => [i.ch, i.ch_title])).entries()];
  const dates = [...new Set(RAW_WORDS.filter(w => w.s === 'daily').map(w => w.d))].filter(Boolean).sort().reverse();
  const maxNo = Math.max(...RAW_WORDS.filter(w => w.s === 'teppan').map(w => w.no));
  return `<div class="filter-fields"><div class="field"><label for="filter">出題する問題</label><select id="filter" name="filter">${FILTERS.map(([v, l]) => option(v, l, config.filter)).join('')}</select></div>
    ${grammar && chapters.length ? `<fieldset><legend>章・ユニット</legend>${checks('chapters', chapters.map(([n, title]) => [n, `${n}. ${title}`]), config.chapters)}</fieldset>` : ''}
    ${!grammar ? `<fieldset><legend>品詞</legend>${checks('pos', [...new Set(RAW_WORDS.map(w => w.p))].map(p => [p, p]), config.pos)}</fieldset>
      ${config.source === 'teppan' ? `<fieldset><legend>単語番号</legend>${checks('ranges', Array.from({ length: Math.ceil(maxNo / 100) }, (_, i) => [i * 100 + 1, `${i * 100 + 1}–${Math.min((i + 1) * 100, maxNo)}`]), config.ranges)}</fieldset>` : ''}
      ${config.source === 'daily' ? `<fieldset><legend>追加日</legend>${checks('dates', dates.map(d => [d, d]), config.dates)}</fieldset>` : ''}` : ''}
    <p class="help">複数選択できます。未選択の項目は全範囲から出題します。</p></div>`;
}
function filterSummary(config) {
  return [FILTERS.find(([v]) => v === config.filter)?.[1],
    config.chapters.length ? `章 ${config.chapters.join('・')}` : '',
    config.pos.length ? config.pos.join('・') : '',
    config.ranges.length ? `番号 ${config.ranges.length}範囲` : '',
    config.dates.length ? `追加日 ${config.dates.length}件` : ''].filter(Boolean).join(' / ');
}
function setup() {
  const grammar = draft.kind === 'grammar';
  const pool = selectItems(catalog, data.records, draft);
  const sources = grammar ? Object.entries(BOOKS).filter(([id]) => catalog.items.some(i => i.kind === 'grammar' && i.source === id)).map(([id, b]) => [id, b.title]) : [['teppan', 'TEPPAN'], ['daily', '日々の単語']];
  return `<div class="setup-page"><a class="back-link" href="#home">← 教材を選び直す</a><div class="page-title"><p class="eyebrow">Set your pace</p><h1>${esc(sourceName(draft.kind, draft.source))}</h1><p>自分に合う範囲で、始めよう。</p></div>
    <form id="setup-form"><div class="setup-columns"><section class="panel setup-basics" aria-label="基本設定"><div class="filter-title"><h2>今回の学習</h2><button class="button quiet" type="button" data-action="default-settings">標準に戻す</button></div>${presetNotice ? `<p class="help" role="status">${esc(presetNotice)}</p>` : ''}<div class="form-grid">
      <div class="field source-field"><label for="source">教材</label><select id="source" name="source">${option('all', 'すべて', draft.source)}${sources.map(([v, l]) => option(v, l, draft.source)).join('')}</select></div>
      <div class="field"><label for="count">今回の問題数</label><select id="count" name="count">${[['10', '10問'], ['20', '20問'], ['all', '対象すべて']].map(([v, l]) => option(v, l, draft.count)).join('')}</select></div>
      ${!grammar ? `<div class="field"><label for="mode">答え方</label><select id="mode" name="mode">${Object.entries(MODES).map(([v, l]) => option(v, l, draft.mode)).join('')}</select></div>` : ''}
    </div><div class="filter-summary"><div><strong>出題範囲</strong><p>${esc(filterSummary(draft))}</p></div><button class="button secondary filter-trigger" type="button" data-action="open-filters" aria-haspopup="dialog">絞り込み</button></div>
    ${currentSession() && !complete(currentSession()) ? '<p class="help">新しく始めると途中の演習は置き換わります。成績と苦手記録は残ります。</p>' : ''}</section>
    <section id="filter-inline" class="panel" aria-label="絞り込み条件"><div class="filter-title"><h2>絞り込み</h2><button type="button" class="button quiet" data-action="reset-filters">解除</button></div>${filterDraft ? '' : filterFields(draft)}</section></div>
    <div class="form-footer setup-start"><p id="pool-count" role="status">対象 <strong>${pool.length}</strong> 問</p><button class="button" type="submit" ${pool.length ? '' : 'disabled'}>${pool.length ? `${draft.count === 'all' ? pool.length : Math.min(Number(draft.count), pool.length)}問を始める ${arrow}` : '対象なし'}</button></div>
    ${!pool.length ? '<p class="help" role="status">条件に合う問題がありません。絞り込みを変更または解除してください。</p>' : ''}</form></div>`;
}
function readFilters(container, config) {
  const selected = name => [...container.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
  return { ...config, filter: container.querySelector('[name="filter"]').value,
    chapters: selected('chapters').map(Number), pos: selected('pos'),
    ranges: selected('ranges').map(Number), dates: selected('dates') };
}
function refreshFilterCount() {
  $('#filter-count').textContent = `対象 ${selectItems(catalog, data.records, filterDraft).length} 問`;
}
function closeFilters(apply = false) {
  if (!filterDraft) return;
  if (apply) draft = filterDraft;
  filterDraft = null;
  $('#filter-dialog').close();
  $('#filter-body').replaceChildren();
  render();
  const target = compactLayout.matches ? $('[data-action="open-filters"]') : $('#filter');
  target?.focus({ preventScroll: true });
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
  return `<div class="exercise-top"><div class="exercise-heading"><a class="back-link" href="#home">← 中断してホームへ</a><button class="theme-trigger" data-action="open-themes" aria-label="演習のテーマを選ぶ">${paletteIcon}<span>テーマ</span></button></div><div class="progress-row"><span>${esc(sourceName(s.config.kind, s.config.source))}</span><span>${s.cursor + 1} / ${s.ids.length} 問</span></div><progress value="${Object.keys(s.answers).length}" max="${s.ids.length}" aria-label="解答済みの問題数"></progress><div class="duo-progress" aria-hidden="true"><span class="duo-progress-fill" style="transform:scaleX(${Object.keys(s.answers).length / s.ids.length})"></span></div>${rewards(s)}</div>
    <div class="exercise-layout"><section class="panel question-panel"><div class="question-meta"><span>${grammar ? `文法 · No. ${esc(item.key)}` : `単語 · ${MODES[mode]}`}</span><span>${esc(sourceName(item.kind, item.source))}</span></div>
      <h1 class="question-text ${grammar ? '' : 'word-text'}" id="question-heading" tabindex="-1">${prompt}</h1>${interaction}</section>
      ${result ? explanation(item, result) : `<aside class="answer-placeholder">${bookIcon}<p>まずは、自分の力で。</p><p class="subtext">回答すると、正解と解説がここに表示されます。わからないときは、そのまま答えを確認できます。</p></aside>`}</div>
    <div class="exercise-actions">${goalReached && data.theme !== 'duolingo' && !companionVisible(data.preferences,data.theme) ? '<p class="goal-celebration" role="status">今日の目標達成！</p>' : ''}${result ? resultBanner(s, item, result) : ''}<div class="action-buttons">${button('← 前の問題', 'previous', true, s.cursor === 0 ? 'disabled' : '')}<div>${result ? button(s.cursor === s.ids.length - 1 ? '結果を見る →' : '次へ →', 'next') : button('わからない', 'dont-know', true)}</div></div></div>
    <p class="shortcut-help">${grammar || ['e2j', 'j2e'].includes(mode) ? 'A–E / 1–5：回答　 ·　 ' : ''}0：わからない　 ·　 Enter：次へ</p>`;
}
function resultBanner(s, item, result) {
  const { streak, xp } = sessionRewards(s);
  const model = feedbackModel({ correct: result.correct, goalReached, streak });
  const milestone = model.state === 'celebrate';
  const correctAnswer = item.kind === 'grammar' ? item.c[item.a] : ['e2j','flash'].includes(s.config.mode) ? item.m : item.w;
  const shown = companionVisible(data.preferences,data.theme);
  return `<div class="result-banner ${result.correct ? '' : 'wrong'} ${milestone ? 'milestone' : ''}">${shown ? companionMarkup(model.state) : `<span class="result-mark" aria-hidden="true">${milestone ? flameIcon : result.correct ? '✓' : '↻'}</span>`}<div class="result-copy"><strong>${model.message}</strong>${result.correct ? `<small>${model.detail} · 今回 ${xp} XP</small>` : `<p class="result-answer">正解：${esc(correctAnswer)}</p>${model.detail ? `<small>${model.detail}</small>` : ''}`}</div></div>`;
}

function animateAnswer(s, correct) {
  if (data.theme !== 'duolingo' || reducedMotion.matches) return;
  const answered = Object.keys(s.answers).length;
  $('.duo-progress-fill')?.animate([
    { transform: `scaleX(${(answered - 1) / s.ids.length})` },
    { transform: `scaleX(${answered / s.ids.length})` },
  ], { duration: 320, easing: 'ease-out' });
  const feedback = correct ? $('.choice.correct') || $('.result-banner') : $('.result-banner');
  feedback?.animate(correct ? [
    { transform: 'translateY(0)' }, { transform: 'translateY(-4px)', offset: .45 }, { transform: 'translateY(0)' },
  ] : [{ opacity: .3 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
}
function summary(s) {
  const answers = Object.values(s.answers);
  const correct = answers.filter(a => a.correct).length;
  const wrong = answers.filter(a => !a.correct).length;
  const reward = sessionRewards(s);
  const review = reviewSummary(s);
  return `<section class="narrow panel summary-card"><div class="duo-completion" aria-hidden="true">${companionVisible(data.preferences,data.theme) ? companionMarkup('celebrate') : starIcon}<span>LESSON COMPLETE</span></div>${data.theme !== 'duolingo' && companionVisible(data.preferences,data.theme) ? `<div class="completion-companion">${companionMarkup('celebrate')}</div>` : ''}<p class="eyebrow">Session complete</p><h1>おつかれさまでした。</h1><p class="subtext">${esc(sourceName(s.config.kind, s.config.source))} · ${s.ids.length}問の演習</p><div class="summary-score">${correct}<small> / ${s.ids.length}</small></div>${rewards(s)}<dl class="duo-summary-stats"><div class="stat-score"><dt>正答数</dt><dd>${correct}<small> / ${s.ids.length}</small></dd></div><div class="stat-xp"><dt>獲得XP</dt><dd>${reward.xp}<small> XP</small></dd></div><div class="stat-streak"><dt>最高連続正解</dt><dd>${reward.best}<small> 問</small></dd></div></dl>${review.reviewed ? `<p class="review-result">苦手を${review.reviewed}問復習できました。${review.graduated ? ` ${review.graduated}問を克服しました。` : ''}</p>` : ''}<p>${wrong ? `${wrong}問を苦手リストに記録しました。もう一度解いて、理解を確かめましょう。` : 'すべて正解です。次の学習も、自分のペースで。'}</p><div class="summary-actions">${wrong ? button(`間違えた${wrong}問をもう一度`, 'retry') : button('同じ条件で新しく解く', 'repeat')}<a class="button secondary" href="#home">ホームへ</a></div><p class="help">この結果は試用版の記録として保存されます。</p></section>`;
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
  return `<div class="settings-page"><div class="page-title"><p class="eyebrow">Make it yours</p><h1>あなたの学びやすさに。</h1><p>いつものテーマも、新しい見た目も。気分に合わせて選べます。</p></div>
    <section class="panel settings-section"><div class="section-intro"><div><h2>テーマを選ぶ</h2><p>従来の7テーマと、Study Deskの2つの表情。</p></div><span class="selected-theme">選択中：${themeById(data.theme).name}</span></div><details class="theme-disclosure" ${themeGalleryOpen ? 'open' : ''}><summary>テーマの見本から選ぶ</summary>${themePicker()}</details>
      <label class="sound-setting"><span><strong>Duolingoの効果音</strong><small>正解・不正解を音でもお知らせします。</small></span><input type="checkbox" id="sound-enabled" ${data.sound !== false ? 'checked' : ''}></label></section>
    <section class="panel settings-section" id="backup-section"><div class="section-intro"><div><p class="eyebrow">Keep your progress</p><h2>記録のバックアップ・復元</h2><p>学習の積み重ねを、ファイルとして手元に残せます。</p></div><span class="local-badge">この端末に保存</span></div>
      <div class="backup-actions"><div><h3>記録を書き出す</h3><p>成績・苦手・学習済み・テーマ・演習の続きを保存します。</p>${button('バックアップを書き出す', 'export', true)}</div><div><h3>ファイルから復元する</h3><p>試用版と従来版のJSONに対応。内容を確認してから反映します。</p>${button('ファイルを選ぶ', 'import', true)}</div></div>
      <p id="backup-message" role="status" tabindex="-1">${esc(backupMessage)}</p>
      ${pendingBackup || undoPreview ? restorePreview() : ''}
      ${data.restoreUndo && !pendingBackup && !undoPreview ? `<div class="undo-row"><p>直前の復元：${new Date(data.restoreUndo.at).toLocaleString('ja-JP')}</p>${button('直前の復元を取り消す', 'preview-undo', true)}</div>` : ''}
      <details class="backup-details"><summary>保存先と互換性について</summary><p>復元先は試用版だけです。従来版の記録やGoogle Driveのデータは変更しません。試用版のバックアップは試用版へ、従来版のバックアップはどちらへも復元できます。</p><p>Google Driveへの自動同期とObsidian連携は、試用版ではまだ利用できません。必要な場合は従来版を使えます。</p><p>初回コピー日時：${new Date(data.importedAt).toLocaleString('ja-JP')}</p></details></section>
    ${learningSettingsMarkup(data.preferences)}
    <div class="legacy-note"><div><h2>いつもの学習も、そのまま。</h2><p>従来版のテーマ・記録・同期機能は引き続き使えます。</p></div><a class="button secondary" href="../">従来版を開く ↗</a></div></div>`;
}

function restorePreview() {
  const candidate = undoPreview ? prepareUndo(data) : prepareRestore(data, pendingBackup.parsed, restoreMode);
  const before = recordCounts(data.records), after = recordCounts(candidate.records);
  const labels = { answers: '通算の回答数', weakWords: '苦手な単語（モード別）', weakGrammar: '苦手な文法', seenWords: '学習済み単語（モード別）', seenGrammar: '学習済み文法' };
  return `<div class="restore-preview"><h3 id="restore-title" tabindex="-1">${undoPreview ? '復元前の状態に戻します' : '取り込む内容を確認'}</h3>
    ${!undoPreview ? `<p class="file-name">${esc(pendingBackup.name)} · ${pendingBackup.parsed.source}</p><fieldset class="restore-modes"><legend>復元方法</legend><label class="check-label"><input type="radio" name="restore-mode" value="merge" ${restoreMode === 'merge' ? 'checked' : ''}>今の記録に統合</label><label class="check-label"><input type="radio" name="restore-mode" value="replace" ${restoreMode === 'replace' ? 'checked' : ''}>ファイルの記録で置き換え</label></fieldset>` : ''}
    <table class="restore-table"><caption class="sr-only">現在と反映後の記録の比較</caption><thead><tr><th>項目</th><th>現在</th><th>反映後</th></tr></thead><tbody>${Object.entries(labels).map(([key, label]) => `<tr><th scope="row">${label}</th><td>${before[key].toLocaleString()}</td><td>${after[key].toLocaleString()}</td></tr>`).join('')}</tbody></table>
    <p class="help">${!undoPreview && restoreMode === 'replace' ? pendingBackup.parsed.activity ? '学習設定と日別記録も置き換えます。' : '学習設定は保ち、日別記録は空にします。' : !undoPreview ? '日別記録は同日の大きい件数を採用します。端末間の回答数の合算ではありません。' : '学習設定と日別記録も復元前に戻します。'}</p><p class="restore-explanation">${undoPreview ? '復元後の学習や設定変更も取り消し、復元直前の状態へ戻します。' : restoreMode === 'merge' ? '学習済みをまとめ、同じ成績は重複加算しません。今のテーマと演習の続きは保ちます。' : '試用版の学習記録を置き換えます。試用版のファイルならテーマと演習の続きも復元します。'}</p>
    ${!undoPreview ? pendingBackup.parsed.warnings.map(w => `<p class="help">${esc(w)}</p>`).join('') : ''}
    <p class="help">従来版とGoogle Driveの記録には影響しません。</p>
    <div class="setting-buttons">${button(undoPreview ? '復元前に戻す' : 'この内容で復元する', 'confirm-restore')}${button('キャンセル', 'cancel-restore', true)}</div></div>`;
}

function render(focus = false) {
  const route = location.hash.slice(1) || 'home';
  const section = route.split('/')[0];
  document.body.dataset.page = section;
  document.body.dataset.companion = String(companionVisible(data.preferences,data.theme));
  if (section === 'setup') {
    const [, kind, source] = route.split('/');
    if (setupRoute !== route && ['grammar','vocab'].includes(kind) && ['all', ...Object.keys(BOOKS), 'teppan', 'daily'].includes(source)) {
      const previous = resolvePreset(data.preferences, `${kind}:${source}`, catalog);
      draft = previous.config || { ...defaultConfig(), kind, source };
      presetNotice = pendingSetupNotice || previous.message; pendingSetupNotice = '';
      setupRoute = route;
    }
  } else setupRoute = '';

  $('#main').innerHTML = section === 'setup' ? setup() : section === 'exercise' ? exercise() : section === 'review' ? review() : section === 'settings' ? settings() : home();
  dockObserver.disconnect();
  document.body.style.removeProperty('--exercise-dock-height');
  if ($('.exercise-actions')) dockObserver.observe($('.exercise-actions'));
  document.querySelectorAll('[data-nav]').forEach(a => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${({ home: 'ホーム', setup: '出題設定', exercise: '演習', review: '復習', settings: '設定' }[section] || 'ホーム')} — Study Desk 試用版`;
  if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
function begin(config, items, { remember = true } = {}) {
  if (!items.length) return;
  data.session = startSession(items, config, catalog);
  data.session.reviewOnly = !remember;
  if (remember) data.preferences = rememberPreset(data.preferences, config);
  flashRevealed = false; goalReached = false;
  save();
  navigate('exercise');
}
function answer(result) {
  const s = currentSession();
  if (!s || s.cursor >= s.ids.length) return;
  const item = catalog.byId.get(s.ids[s.cursor]);
  const beforeGoal = activitySummary(data.activity,data.preferences.dailyGoal).achieved;
  if (recordAnswer(data, item, result)) {
    goalReached = !beforeGoal && activitySummary(data.activity,data.preferences.dailyGoal).achieved;
    if (data.theme === 'duolingo' && data.sound !== false) playAnswerSound(result.correct);
    save();
    render();
    animateAnswer(s, result.correct);
    $('[data-action="next"]')?.focus({ preventScroll: true });
    announce(result.correct ? '正解です。解説を確認して、次の問題へ進めます。' : '答えと解説を表示しました。苦手として記録しました。');
  }
}
function exportData() {
  const blob = new Blob([JSON.stringify(createBackup(data), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `study-desk-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', event => {
  const themeOption = event.target.closest('[data-theme-id]');
  if (themeOption) {
    data.theme = themeOption.dataset.themeId; save(); applyTheme();
    const inDialog = $('#theme-dialog').open;
    render();
    if (inDialog) $('#dialog-themes').innerHTML = themePicker();
    const container = inDialog ? $('#dialog-themes') : $('#main');
    container.querySelector(`[data-theme-id="${data.theme}"]`)?.focus({ preventScroll: true });
    announce(`${themeById(data.theme).name}に切り替えました。`);
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  const s = currentSession();
  if (action === 'open-calendar') { calendarTrigger = target; calendarMonth = localDateKey(new Date()).slice(0,7); refreshCalendar(); $('#calendar-dialog').showModal(); }
  if (action === 'close-calendar') $('#calendar-dialog').close();
  if (action === 'calendar-prev' || action === 'calendar-next') {
    const model = monthModel(data.activity,calendarMonth);
    if (action === 'calendar-prev' || model.canGoNext) calendarMonth = action === 'calendar-prev' ? model.previousMonth : model.nextMonth;
    refreshCalendar(); $(`[data-action="${action}"]`)?.focus({ preventScroll: true });
  }
  if (action === 'open-themes') { $('#dialog-themes').innerHTML = themePicker(); $('#theme-dialog').showModal(); }
  if (action === 'close-themes') $('#theme-dialog').close();
  if (action === 'quick-start') { draft = defaultConfig(); begin(draft, selectItems(catalog, data.records, draft)); }
  if (action === 'open-filters') {
    filterDraft = structuredClone(draft);
    $('#filter-inline').querySelector('.filter-fields')?.remove();
    $('#filter-body').innerHTML = filterFields(filterDraft);
    refreshFilterCount();
    $('#filter-dialog').showModal();
    $('#filter').focus({ preventScroll: true });
  }
  if (action === 'close-filters') closeFilters();
  if (action === 'apply-filters') closeFilters(true);
  if (action === 'reset-filters') {
    const reset = config => ({ ...config, filter: 'all', chapters: [], pos: [], ranges: [], dates: [] });
    if (filterDraft) {
      filterDraft = reset(filterDraft);
      $('#filter-body').innerHTML = filterFields(filterDraft); refreshFilterCount();
    } else { draft = reset(draft); render(); $('[data-action="reset-filters"]')?.focus({ preventScroll: true }); }
  }
  if (action === 'default-settings') { draft = { ...defaultConfig(), kind: draft.kind, source: draft.source }; presetNotice = ''; render(); $('[data-action="default-settings"]').focus({ preventScroll: true }); }
  if (action === 'previous-start') {
    const previous = resolvePreset(data.preferences, data.preferences.recentPreset, catalog);
    if (previous.config && !previous.needsConfirmation && selectItems(catalog,data.records,previous.config).length) begin(previous.config,selectItems(catalog,data.records,previous.config));
    else {
      const original = data.preferences.presets[data.preferences.recentPreset];
      const preferredSource = original.kind === 'grammar' ? 'kin' : 'teppan';
      const fallbackSource = catalog.items.some(i => i.kind === original.kind && i.source === preferredSource) ? preferredSource : catalog.items.find(i => i.kind === original.kind)?.source || 'all';
      const config = previous.config || { ...defaultConfig(), kind: original.kind, source: fallbackSource };
      pendingSetupNotice = previous.message || '条件に合う問題がありません。絞り込みを見直してください。';
      navigate(`setup/${config.kind}/${config.source}`);
    }
  }
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
    s.cursor++; flashRevealed = false; goalReached = false; save(); render(true);
  }
  if (action === 'previous' && s && s.cursor > 0) { s.cursor--; flashRevealed = false; goalReached = false; save(); render(true); }
  if (action === 'retry' && s) begin({ ...s.config, count: 'all' }, s.ids.filter(id => s.answers[id] && !s.answers[id].correct).map(id => catalog.byId.get(id)), { remember: false });
  if (action === 'repeat' && s) {
    const items = selectItems(catalog, data.records, s.config);
    if (items.length) begin(s.config, items, { remember: !s.reviewOnly });
    else { draft = structuredClone(s.config); navigate(`setup/${draft.kind}/${draft.source}`); }
  }
  if (action === 'review-due') {
    const config = { ...defaultConfig(), kind: reviewKind, mode: reviewMode, source: 'all', filter: 'due', count: '20' };
    begin(config, selectItems(catalog, data.records, config), { remember: false });
  }
  if (action === 'review-one') {
    const item = catalog.byId.get(target.dataset.id);
    begin({ ...defaultConfig(), kind: reviewKind, mode: reviewMode, source: item.source, count: 'all' }, [item], { remember: false });
  }
  if (action === 'more-review') { reviewLimit += 20; render(); $('[data-action="more-review"]')?.focus({ preventScroll: true }); }
  if (action === 'export') exportData();
  if (action === 'import') { $('#backup-file').value = ''; $('#backup-file').click(); }
  if (action === 'cancel-restore') { pendingBackup = null; undoPreview = false; render(); $('[data-action="import"]').focus(); }
  if (action === 'preview-undo') { undoPreview = true; pendingBackup = null; render(); $('#restore-title').focus(); }
  if (action === 'confirm-restore' && (pendingBackup || undoPreview)) {
    const next = undoPreview ? prepareUndo(data) : prepareRestore(data, pendingBackup.parsed, restoreMode);
    if (store.replace(next)) {
      backupMessage = undoPreview ? '復元前の状態に戻しました。' : '試用版の記録を復元しました。';
      pendingBackup = null; undoPreview = false; flashRevealed = false; goalReached = false; applyTheme();
      $('#storage-notice').hidden = true;
    } else {
      backupMessage = `復元できませんでした。記録は元のままです。${store.notice}`;
    }
    render(); $('#backup-message').focus();
  }
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
  if (['daily-goal','calendar-goal','companion-setting'].includes(el.id)) {
    const next = el.id !== 'companion-setting' ? setDailyGoal(data,Number(el.value)) : structuredClone(data);
    if (el.id === 'companion-setting') next.preferences.companion = el.value;
    goalReached = false;
    store.replace(next); $('#storage-notice').textContent = store.notice; $('#storage-notice').hidden = !store.notice;
    if (el.id === 'calendar-goal') {
      if ($('#daily-goal-strip')) $('#daily-goal-strip').innerHTML = goalMarkup(activitySummary(data.activity,data.preferences.dailyGoal));
      refreshCalendar();
    } else render();
    $(`#${el.id}`)?.focus({ preventScroll: true });
  }
  if (el.id === 'sound-enabled') { data.sound = el.checked; save(); }
  if (el.name === 'restore-mode') {
    restoreMode = el.value; render(); $(`[name="restore-mode"][value="${restoreMode}"]`).focus({ preventScroll: true });
  }
  if (el.closest('#filter-body') && filterDraft) {
    filterDraft = readFilters($('#filter-body'), filterDraft); refreshFilterCount();
  }
  if (el.closest('#setup-form')) {
    const name = el.name, value = el.value;
    const filterScroll = $('#filter-inline .filter-fields')?.scrollTop || 0;
    if (el.closest('.filter-fields')) draft = readFilters($('#filter-inline'), draft);
    else {
      const form = new FormData($('#setup-form'));
      const changedSource = draft.source !== form.get('source');
      draft = { ...draft, source: form.get('source'), count: form.get('count'), mode: form.get('mode') || 'e2j',
        chapters: changedSource ? [] : draft.chapters, ranges: changedSource ? [] : draft.ranges, dates: changedSource ? [] : draft.dates };
      if (changedSource) { history.replaceState(null, '', `#setup/${draft.kind}/${draft.source}`); setupRoute = `setup/${draft.kind}/${draft.source}`; presetNotice = ''; }
    }
    render();
    if ($('#filter-inline .filter-fields')) $('#filter-inline .filter-fields').scrollTop = name === 'source' ? 0 : filterScroll;
    [...document.querySelectorAll('#setup-form input, #setup-form select')].find(x => x.name === name && x.value === value)?.focus({ preventScroll: true });
  }
  if (el.id === 'review-kind') { reviewKind = el.value; reviewLimit = 20; render(); $('#review-kind').focus(); }
  if (el.id === 'review-mode') { reviewMode = el.value; reviewLimit = 20; render(); $('#review-mode').focus(); }
});
document.addEventListener('keydown', event => {
  if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || $('#theme-dialog').open || location.hash !== '#exercise') return;
  const s = currentSession();
  if (!s || s.cursor >= s.ids.length) return;
  if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('button, a, summary')) return;
  const key = event.key.toLowerCase();
  const index = /^[1-5]$/.test(key) ? Number(key) - 1 : /^[a-e]$/.test(key) ? key.charCodeAt(0) - 97 : -1;
  const target = index >= 0 ? document.querySelectorAll('.choice')[index] : key === '0' ? $('[data-action="dont-know"]') :
    ['Enter', ' '].includes(event.key) ? $('[data-action="next"]') || $('[data-action="reveal"]') : null;
  if (target && !target.disabled) { event.preventDefault(); target.click(); }
});
window.addEventListener('hashchange', () => {
  closeFilters();
  goalReached = false;
  if ($('#calendar-dialog').open) $('#calendar-dialog').close();
  if ($('#theme-dialog').open) $('#theme-dialog').close();
  flashRevealed = false;
  if (location.hash !== '#settings') { pendingBackup = null; undoPreview = false; fileReadVersion++; }
  render(true);
});
$('#filter-dialog').addEventListener('cancel', event => { event.preventDefault(); closeFilters(); });
// All modal dismissal paths discard pending edits unless Apply was pressed.
$('#filter-dialog').addEventListener('close', () => { if (filterDraft) closeFilters(); });
document.addEventListener('toggle', event => {
  if (event.target.matches('.theme-disclosure')) themeGalleryOpen = event.target.open;
}, true);
$('#theme-dialog').addEventListener('close', () => $('[data-action="open-themes"]')?.focus({ preventScroll: true }));
$('#backup-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const version = ++fileReadVersion;
  pendingBackup = null; undoPreview = false; backupMessage = '';
  try {
    if (!file.size || file.size > MAX_BACKUP_BYTES) throw new Error('空でない、2MB以下のJSONファイルを選んでください。');
    const text = await file.text();
    if (version !== fileReadVersion) return;
    pendingBackup = { name: file.name, parsed: parseBackup(text, catalog) };
    restoreMode = 'merge';
  } catch (error) { if (version === fileReadVersion) backupMessage = error.message; }
  if (version !== fileReadVersion) return;
  render(); (pendingBackup ? $('#restore-title') : $('#backup-message'))?.focus();
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) {
    $('#storage-notice').textContent = '別のタブで試用版の記録が更新されました。続ける前に、この画面を再読み込みしてください。';
    $('#storage-notice').hidden = false;
  }
});
function refreshCalendar() {
  const summary = activitySummary(data.activity,data.preferences.dailyGoal);
  $('#calendar-goal').value = String(data.preferences.dailyGoal);
  $('#calendar-overview').textContent = `累計 ${summary.activeDays}日 · ${summary.streak}日連続`;
  $('#calendar-body').innerHTML = calendarMarkup(monthModel(data.activity,calendarMonth));
}
$('#calendar-dialog').addEventListener('close', () => { (calendarTrigger?.isConnected ? calendarTrigger : $('[data-action="open-calendar"]'))?.focus({ preventScroll: true }); });
function refreshDay() {
  const now = new Date(), date = localDateKey(now);
  if (date !== lastDate) {
    lastDate = date; goalReached = false;
    if ($('#daily-goal-strip')) $('#daily-goal-strip').innerHTML = goalMarkup(activitySummary(data.activity,data.preferences.dailyGoal,now));
    if ($('#calendar-dialog').open) { calendarMonth = date.slice(0,7); refreshCalendar(); }
  }
  clearTimeout(dayTimer);
  const next = new Date(now); next.setHours(24,0,1,0);
  dayTimer = setTimeout(refreshDay,Math.max(1000,next-now));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
refreshDay();
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
