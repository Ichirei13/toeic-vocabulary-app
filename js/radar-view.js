// レーダーのページの中身（SVG と HTML だけ。Canvas・力学なし）。window.RadarView を 1 つだけ公開し、アプリの state などのグローバルには触れない。
// 必要なものは mount(container, deps) の deps で受け取る:
//   deps = { graph, getStats: ()=>object, getWeak: ()=>object, getQuestion: (qid)=>object|undefined, isDue: (entry)=>boolean,
//            onStartDrill?: (ids, label, opts) => void, onOpenQuestion?: (node) => void,
//            getSheetHeight?: () => 割合|null, setSheetHeight?: (割合) => void }
//   onStartDrill の opts.kind は 'theme'（テーマの問題をまとめて解く）。onOpenQuestion はシートの問題を押したとき（home.js がグラフのページをその問題で開く）
// 集計は src/ の純関数（computeMastery / buildDetail / computeGraphReport / computeRadarGeometry / sortReportItems）に任せ、
// 詳細シートは js/graph-sheet.js。グラフ本体（js/graph-view.js）・graph-filter.js・d3・graph-force.js は読まない
// （概念の並び順は graph-force.js の GRAMMAR_CONCEPT_ORDER があればそれ、なければ graph-report.js の DEFAULT_CONCEPT_ORDER。同じ並び）。
//
// 軽さの約束: requestAnimationFrame もタイマーも使わない。描き直すのは、入力・refresh・SVG の枠の幅の区分が変わったときだけ。
// destroy() はすべてのリスナー／オブザーバー・DOM を解放する。
(function (root) {
  'use strict';

  const BOOKS = [['all', 'すべて'], ['kin', '金'], ['sekai', '世界一'], ['polaris2', 'ポラリス2'], ['toplevel', 'トップレベル']];
  const BOOK_NAMES = { all: '全教材', kin: '金の文法', sekai: '世界一', polaris2: 'ポラリス2', toplevel: 'トップレベル' };
  const REPORT_STATE_LABELS = { unseen: '未着手', due: '要復習', weak: '苦手', few: '練習不足', mid: 'もう少し', good: '定着' };
  // 横棒の内訳（左から）。key は computeGraphReport の項目のフィールド名
  const BAR_SEGMENTS = [['neverMissed', 'is-correct', '正解'], ['overcome', 'is-overcome', '克服'], ['weak', 'is-weak', '苦手'], ['untouched', 'is-unseen', '未着手']];
  // SVG を入れる枠の幅がこれ未満なら詰めた配置にする。通常の配置（文字 12・viewBox 幅 420）で実効 11px を保てる最小の幅（12 × 385 ÷ 420 = 11.0）
  const RADAR_COMPACT_BELOW_PX = 385;
  const KIND_NAMES = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];

  // テスト用の観測値。listeners は今登録中のリスナー・オブザーバーの数
  const debug = { listeners: 0, book: 'all', weakOnly: false, compact: false, lastTap: -1, mounted: false };
  let inst = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function safeObj(fn) {
    try { const v = typeof fn === 'function' ? fn() : null; return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }

  function createInstance(container, deps) {
    const S = root.StudyCore;
    if (!S || typeof S.computeMastery !== 'function' || typeof S.buildDetail !== 'function' || typeof S.computeGraphReport !== 'function' || typeof S.computeRadarGeometry !== 'function') {
      throw new Error('RadarView: StudyCore (src/mastery.js, graph-detail.js, graph-report.js) が読み込まれていない');
    }
    if (!root.GraphSheet || typeof root.GraphSheet.create !== 'function') throw new Error('RadarView: 詳細シート（js/graph-sheet.js）が読み込まれていない');
    if (!container || !deps || !deps.graph) throw new Error('RadarView.mount: container と deps.graph が必要');
    const graph = deps.graph;
    const n = graph.id.length;
    const kinds = graph.kinds || KIND_NAMES;
    const kBook = kinds.indexOf('book'), kQuestion = kinds.indexOf('question');
    // 問題 id → ノード添字（シートの一覧から、グラフのページのその問題へ行くため。graph-filter.js の buildIndex は読まない）
    const qidNode = new Map();
    for (let i = 0; i < n; i++) if (graph.kind[i] === kQuestion && graph.qid && graph.qid[i] != null) qidNode.set(graph.qid[i], i);
    const conceptOrder = Array.isArray(S.GRAMMAR_CONCEPT_ORDER) ? S.GRAMMAR_CONCEPT_ORDER : S.DEFAULT_CONCEPT_ORDER;

    // ---- 状態 ----
    let alive = true;
    let book = 'all', weakOnly = false;
    let category = 'concept';   // 横棒の集計の軸: concept / trap / book
    let sort = 'default';       // default / weakness
    let showCoverage = true;    // 着手率を重ねるか
    let compact = false;        // 詰めた配置（狭い画面用）で描いたか
    let stats = {}, weak = {}, mastery = null;
    let sheetIndex = -1;
    const subs = [];

    // リスナー・オブザーバーの登録と解除を 1 か所で数える
    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      debug.listeners++;
      subs.push(() => { target.removeEventListener(type, fn, opts); debug.listeners--; });
    }
    function track(off) { debug.listeners++; subs.push(() => { off(); debug.listeners--; }); }

    // ---- DOM ----（見た目は css/graph.css の .graph-view と、レーダーの部分をそのまま使う）
    const rootEl = document.createElement('div');
    rootEl.className = 'graph-view radar-view';
    rootEl.innerHTML =
      '<div class="graph-filter" role="toolbar" aria-label="レーダーの絞り込み">' +
        '<div class="graph-chips" role="group" aria-label="教材">' +
          BOOKS.map(([id, name]) => `<button type="button" class="graph-chip" data-book="${id}" aria-pressed="${id === 'all'}">${esc(name)}</button>`).join('') +
        '</div>' +
        '<button type="button" class="graph-weak-toggle" aria-pressed="false">苦手のみ</button>' +
      '</div>' +
      '<div class="graph-stage">' +
        '<div class="graph-radar-panel" aria-label="レーダーチャートと項目別スコア"></div>' +
      '</div>';
    // ここから先で例外が出たら、登録済みのリスナー・オブザーバーをすべて外し、DOM も消してから投げ直す
    try {
      container.appendChild(rootEl);
      const filterEl = rootEl.querySelector('.graph-filter');
      const panel = rootEl.querySelector('.graph-radar-panel');
      // 詳細シート（js/graph-sheet.js）。リスナーはここの on で数え、destroy でまとめて外す
      const sheetUI = root.GraphSheet.create(rootEl, {
        on, S,
        getSheetHeight: deps.getSheetHeight, setSheetHeight: deps.setSheetHeight,
        questionNode: qid => (qidNode.has(qid) ? qidNode.get(qid) : -1),
        // 呼び出し側が画面を切り替える（この後 destroy されうる）
        onQuestion: node => { if (typeof deps.onOpenQuestion === 'function') deps.onOpenQuestion(node); },
        onDrill: p => { if (typeof deps.onStartDrill === 'function') deps.onStartDrill(p.ids, p.label, { kind: p.kind }); },
        onClose: () => { sheetIndex = -1; syncSelection(); },
      });

      // ---- 記録の読み込み ----
      function recompute() {
        stats = safeObj(deps.getStats);
        weak = safeObj(deps.getWeak);
        mastery = S.computeMastery(graph, stats, weak, deps.isDue);
      }

      // ---- レポート（サマリー・レーダー・横棒） ----
      function pctText(ratio) {
        return ratio == null ? '—' : Math.round(ratio * 100) + '%';
      }
      // レーダーを詰めた配置にするか。枠（.graph-radar-svg-wrap）の実際の幅で決める。枠がまだ無い最初の描画では、パネルの幅で仮に決める
      // （panel は try ブロックの中で作るので、この関数もブロックの中に置く）
      function wantCompact() {
        const wrap = panel.querySelector('.graph-radar-svg-wrap');
        const px = wrap ? wrap.clientWidth : panel.clientWidth;
        return px > 0 && px < RADAR_COMPACT_BELOW_PX;
      }
      function renderReport(recheck = true) {
        if (typeof S.computeGraphReport !== 'function' || typeof S.computeRadarGeometry !== 'function') {
          panel.innerHTML = '<div class="graph-radar-empty">レポートを読み込めませんでした。</div>';
          return;
        }
        const rep = S.computeGraphReport(graph, stats, weak, deps.isDue, {
          book,
          conceptOrder: conceptOrder,
        });
        const sum = rep.summary;
        const scopeName = BOOK_NAMES[book] || '全教材';
        const covPct = Math.round(sum.coverage * 100);
        const stateText = REPORT_STATE_LABELS[sum.state] || REPORT_STATE_LABELS.unseen;
        const fmtPts = pts => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

        // 1. サマリーカード
        let highlightsHtml = '';
        if (sum.strongest || sum.weakest) {
          highlightsHtml = '<div class="graph-radar-highlights">';
          if (sum.strongest) {
            highlightsHtml += `<button type="button" class="graph-radar-hl is-strong" data-node="${sum.strongest.nodeIndex}">` +
              `<span class="graph-radar-hl-tag">得意</span>` +
              `<span class="graph-radar-hl-name">${esc(sum.strongest.shortLabel)}</span>` +
              `<span class="graph-radar-hl-val">${esc(pctText(sum.strongest.accuracy))}</span>` +
            `</button>`;
          }
          if (sum.weakest) {
            highlightsHtml += `<button type="button" class="graph-radar-hl is-weak" data-node="${sum.weakest.nodeIndex}">` +
              `<span class="graph-radar-hl-tag">要強化</span>` +
              `<span class="graph-radar-hl-name">${esc(sum.weakest.shortLabel)}</span>` +
              `<span class="graph-radar-hl-val">${esc(pctText(sum.weakest.accuracy))}</span>` +
            `</button>`;
          }
          highlightsHtml += '</div>';
        }

        const summaryHtml =
          `<section class="graph-radar-card graph-radar-summary" aria-label="総合スコア">` +
            `<div class="graph-radar-summary-head">` +
              `<div>` +
                `<span class="graph-radar-kicker">SCORE REPORT</span>` +
                `<h3 class="graph-radar-scope">${esc(scopeName)}<span class="graph-radar-scope-sub">（${esc(sum.total)}問）</span></h3>` +
              `</div>` +
              `<div class="graph-radar-score-box">` +
                `<span class="graph-radar-state is-state-${esc(sum.state)}">${esc(stateText)}</span>` +
                `<div class="graph-radar-score-main">` +
                  `<span class="graph-radar-score-num">${esc(pctText(sum.accuracy))}</span>` +
                  `<span class="graph-radar-score-sub">${sum.answered > 0 ? `${esc(sum.correct)}/${esc(sum.answered)} 正解` : '未解答'}</span>` +
                `</div>` +
              `</div>` +
            `</div>` +
            `<dl class="graph-radar-metrics">` +
              `<div><dt>着手済み</dt><dd>${esc(sum.attempted)}<small>/${esc(sum.total)} (${esc(covPct)}%)</small></dd></div>` +
              `<div><dt>定着</dt><dd>${esc(sum.mastered)}<small>問</small></dd></div>` +
              `<div><dt>苦手</dt><dd class="${sum.weak > 0 ? 'is-alert' : ''}">${esc(sum.weak)}<small>問</small></dd></div>` +
              `<div><dt>要復習</dt><dd class="${sum.due > 0 ? 'is-alert' : ''}">${esc(sum.due)}<small>問</small></dd></div>` +
            `</dl>` +
            highlightsHtml +
          `</section>`;

        // 2. 13 概念レーダーチャート（SVG）。狭い枠では半径を小さくして文字を大きくする（viewBox は共通）
        compact = wantCompact();
        debug.compact = compact;
        const geo = S.computeRadarGeometry(rep.concepts, compact
          ? { width: 420, height: 330, radius: 76, labelOffset: 16 }
          : { width: 420, height: 330, radius: 96, labelOffset: 20 });
        const ringsSvg = geo.rings.map(r =>
          `<polygon class="graph-radar-ring${r.isTarget ? ' is-target' : ''}" points="${fmtPts(r.points)}"></polygon>`
        ).join('');
        const axesSvg = geo.axes.map(ax =>
          `<line class="graph-radar-axis-line" x1="${geo.cx}" y1="${geo.cy}" x2="${ax.outer.x.toFixed(1)}" y2="${ax.outer.y.toFixed(1)}"></line>`
        ).join('');
        const targetRing = geo.rings.find(r => r.isTarget);
        const targetNoteSvg = targetRing && targetRing.points[0] && targetRing.points[1]
          ? `<text class="graph-radar-scale-label" x="${(((targetRing.points[0].x + targetRing.points[1].x) / 2) + 2).toFixed(1)}" y="${(((targetRing.points[0].y + targetRing.points[1].y) / 2) - 3).toFixed(1)}" text-anchor="middle">80%</text>`
          : '';
        const covPolySvg = showCoverage && geo.covPolygon.length >= 3
          ? `<polygon class="graph-radar-poly-cov" points="${fmtPts(geo.covPolygon)}"></polygon>`
          : '';
        const accPolySvg = geo.accPolygon.length >= 3
          ? `<polygon class="graph-radar-poly-acc" points="${fmtPts(geo.accPolygon)}"></polygon>`
          : '';
        const dotsSvg = geo.axes.map(ax => {
          const it = ax.item;
          if (it.total === 0) return '';
          const dimCls = weakOnly && it.weak === 0 ? ' is-dim' : '';
          const actCls = sheetIndex === it.nodeIndex ? ' is-active' : '';
          return (
            `<g class="graph-radar-dot-group${dimCls}${actCls}" data-node="${it.nodeIndex}">` +
              `<circle class="graph-radar-hit" cx="${ax.accPoint.x.toFixed(1)}" cy="${ax.accPoint.y.toFixed(1)}" r="12"></circle>` +
              `<circle class="graph-radar-dot is-state-${esc(it.state)}${it.weak > 0 ? ' has-weak' : ''}" cx="${ax.accPoint.x.toFixed(1)}" cy="${ax.accPoint.y.toFixed(1)}" r="4.5"></circle>` +
            `</g>`
          );
        }).join('');
        const nodesSvg = geo.axes.map(ax => {
          const it = ax.item;
          const unavailable = it.total === 0;
          const pct = unavailable ? '収録なし' : pctText(it.accuracy);
          const dimCls = unavailable ? ' is-unavailable' : (weakOnly && it.weak === 0 ? ' is-dim' : '');
          const actCls = !unavailable && sheetIndex === it.nodeIndex ? ' is-active' : '';
          const sin = Math.sin(ax.angle);
          const labelDy = sin < -0.65 ? -10 : sin > 0.65 ? 5 : -2;
          const lx = ax.labelPos.x.toFixed(1);
          const ly = (ax.labelPos.y + labelDy).toFixed(1);
          const interactiveAttrs = unavailable
            ? ` aria-disabled="true" aria-label="${esc(it.label)} この教材には収録なし"`
            : ` data-node="${it.nodeIndex}" role="button" tabindex="0" aria-label="${esc(it.label)} 正答率 ${esc(pct)}"`;
          return (
            `<g class="graph-radar-axis-btn${dimCls}${actCls}"${interactiveAttrs}>` +
              (unavailable ? '' : `<circle class="graph-radar-hit" cx="${lx}" cy="${ax.labelPos.y.toFixed(1)}" r="22"></circle>`) +
              `<text class="graph-radar-axis-label" x="${lx}" y="${ly}" text-anchor="${ax.textAnchor}">` +
                `<tspan x="${lx}">${esc(it.shortLabel)}</tspan>` +
                `<tspan class="graph-radar-axis-pct" x="${lx}" dy="1.2em">${esc(pct)}</tspan>` +
              `</text>` +
            `</g>`
          );
        }).join('');

        const conceptCount = rep.concepts.length;
        const radarSvg =
          `<svg class="graph-radar-svg${compact ? ' is-compact' : ''}" viewBox="0 0 420 330" role="img" aria-label="${esc(conceptCount)}文法概念のレーダーチャート">` +
            ringsSvg +
            axesSvg +
            covPolySvg +
            accPolySvg +
            targetNoteSvg +
            dotsSvg +
            nodesSvg +
          `</svg>`;

        const radarCardHtml =
          `<section class="graph-radar-card graph-radar-chart-card" aria-label="文法概念レーダーチャート">` +
            `<div class="graph-radar-card-head">` +
              `<h3>${esc(conceptCount)} 文法概念バランス</h3>` +
              `<button type="button" class="graph-radar-mini-toggle" data-radar-cov="1" aria-pressed="${showCoverage}">着手率を重ねる</button>` +
            `</div>` +
            `<div class="graph-radar-svg-wrap">${radarSvg}</div>` +
            `<div class="graph-radar-legend">` +
              `<span><i class="graph-radar-swatch is-acc"></i>正答率</span>` +
              (showCoverage ? `<span><i class="graph-radar-swatch is-cov"></i>着手率</span>` : '') +
              `<span><i class="graph-radar-swatch is-target"></i>80% 定着目標</span>` +
            `</div>` +
          `</section>`;

        // 3. アビメ風横棒グラフ
        const rawItems = category === 'trap' ? rep.traps : category === 'book' ? rep.books : rep.concepts;
        const filteredItems = weakOnly ? rawItems.filter(it => it.weak > 0) : rawItems;
        const items = S.sortReportItems(filteredItems, sort);

        const barsListHtml = items.length === 0
          ? '<p class="graph-radar-empty">該当する項目がありません。</p>'
          : items.map(it => {
              const unavailable = it.total === 0;
              const acc = unavailable ? '—' : pctText(it.accuracy);
              const isSelBook = category === 'book' && book !== 'all' && it.selected;
              const badges = unavailable
                ? '<span class="graph-bar-badge is-muted">収録なし</span>'
                : (isSelBook ? '<span class="graph-bar-badge is-sel">選択中</span>' : '') +
                  (it.weak > 0 ? `<span class="graph-bar-badge is-weak">苦手 ${esc(it.weak)}</span>` : '') +
                  (it.due > 0 ? `<span class="graph-bar-badge is-due">復習 ${esc(it.due)}</span>` : '');
              // 内訳の数（色だけに頼らず数でも分かるように）。棒は同じ内訳を問題数に対する割合で塗り分ける
              const subText = unavailable
                ? 'この教材には収録なし'
                : BAR_SEGMENTS.map(([key, , name]) => `${name} ${esc(it[key] || 0)}`).join(' ・ ');
              const segsHtml = unavailable ? '' : BAR_SEGMENTS.map(([key, cls]) => {
                const v = it[key] || 0;
                return v > 0 ? `<span class="graph-bar-seg ${cls}" style="width:${(100 * v / it.total).toFixed(2)}%"></span>` : '';
              }).join('');
              return (
                `<button type="button" class="graph-bar-row${unavailable ? ' is-unavailable' : ''}${!unavailable && sheetIndex === it.nodeIndex ? ' is-active' : ''}"${unavailable ? ' disabled' : ` data-node="${it.nodeIndex}" aria-pressed="${sheetIndex === it.nodeIndex}"`}>` +
                  `<div class="graph-bar-top">` +
                    `<span class="graph-bar-name">${esc(it.label)}</span>` +
                    `<span class="graph-bar-badges">${badges}</span>` +
                    `<span class="graph-bar-pct is-state-${esc(it.state)}">${esc(acc)}</span>` +
                  `</div>` +
                  `<div class="graph-bar-track" aria-hidden="true">${segsHtml}</div>` +
                  `<div class="graph-bar-sub">${subText}</div>` +
                `</button>`
              );
            }).join('');

        const barsCardHtml =
          `<section class="graph-radar-card graph-bars-card" aria-label="項目別スコア">` +
            `<div class="graph-bars-controls">` +
              `<div class="graph-bars-tabs" role="tablist" aria-label="集計の軸">` +
                `<button type="button" role="tab" class="graph-bars-tab" data-radar-cat="concept" aria-selected="${category === 'concept'}">文法概念 (${esc(rep.concepts.length)})</button>` +
                `<button type="button" role="tab" class="graph-bars-tab" data-radar-cat="trap" aria-selected="${category === 'trap'}">ひっかけ (${esc(rep.traps.length)})</button>` +
                `<button type="button" role="tab" class="graph-bars-tab" data-radar-cat="book" aria-selected="${category === 'book'}">教材別 (${esc(rep.books.length)})</button>` +
              `</div>` +
              `<div class="graph-bars-sorts" role="group" aria-label="並び順">` +
                `<button type="button" class="graph-bars-sort" data-radar-sort="default" aria-pressed="${sort === 'default'}">標準順</button>` +
                `<button type="button" class="graph-bars-sort" data-radar-sort="weakness" aria-pressed="${sort === 'weakness'}">弱い順</button>` +
              `</div>` +
            `</div>` +
            `<div class="graph-bars-legend" aria-hidden="true">` +
              BAR_SEGMENTS.map(([, cls, name]) => `<span><i class="graph-bar-seg-swatch ${cls}"></i>${name}</span>`).join('') +
            `</div>` +
            `<div class="graph-bars-list">${barsListHtml}</div>` +
          `</section>`;

        panel.innerHTML =
          `<div class="graph-radar-grid">` +
            `<div class="graph-radar-col-main">${summaryHtml}${radarCardHtml}</div>` +
            `<div class="graph-radar-col-bars">${barsCardHtml}</div>` +
          `</div>`;
        // 枠の幅は描いてみないと分からない（列の幅で決まる）。仮の判断が外れていたら 1 回だけ描き直す
        if (recheck && wantCompact() !== compact) renderReport(false);
      }

      // ---- 詳細シート ----
      // 中身を描く。ノードが無効か、教材で絞って 0 問になったら false
      function renderSheet(i) {
        const sheetBook = book !== 'all' ? book : null;
        const d = S.buildDetail(graph, mastery, i, {
          stats, weak, getQuestion: deps.getQuestion, book: sheetBook, isDue: deps.isDue,
        });
        if (!d) return false;
        const isBookFiltered = !!(sheetBook && graph.kind[i] !== kBook && graph.kind[i] !== kQuestion);
        const total = d.questions.length + (d.moreCount || 0);
        if (isBookFiltered && total === 0) return false;
        const correct = typeof d.correct === 'number' ? d.correct : mastery.correct[i];
        const picks = [];
        if (typeof deps.onStartDrill === 'function' && Array.isArray(d.allQids) && d.allQids.length > 0) {
          // そのテーマの問題だけを、打ち切らずにまとめて解く（苦手を潰すため）。
          // 全問（苦手 → 未着手 → 克服 → 正解）か、苦手と未着手だけかを選べる。教材で絞っていればその教材の分だけ
          const label = isBookFiltered ? `${d.title}（${BOOK_NAMES[sheetBook] || sheetBook}）` : d.title;
          const rest = Array.isArray(d.restQids) ? d.restQids : [];
          picks.push({ key: 'all', text: `このテーマの全 ${d.allQids.length} 問を解く`, ids: d.allQids.slice(), label, kind: 'theme' });
          // 苦手も未着手もなければ出さない。克服・正解が 1 問もなければ「全問」と同じなので出さない
          if (rest.length > 0 && rest.length < d.allQids.length) {
            picks.push({ key: 'rest', text: `苦手と未着手の ${rest.length} 問を解く`, sub: true, ids: rest.slice(), label, kind: 'theme' });
          }
        }
        sheetUI.render({
          kindText: isBookFiltered ? `${d.kindLabel}・${BOOK_NAMES[sheetBook] || sheetBook}` : d.kindLabel,
          title: d.title, detail: d, correct, picks, group: true,
        });
        return true;
      }
      function syncSelection() {
        panel.querySelectorAll('[data-node]').forEach(el => {
          const active = Number(el.dataset.node) === sheetIndex;
          el.classList.toggle('is-active', active);
          if (el.classList.contains('graph-bar-row')) el.setAttribute('aria-pressed', String(active));
        });
      }
      function openSheet(i) {
        if (!(Number.isInteger(i) && i >= 0 && i < n)) return;
        if (!renderSheet(i)) return;
        sheetIndex = i;
        debug.lastTap = i;
        sheetUI.open();
        syncSelection();
      }

      // ---- 入力 ----
      function onFilterClick(e) {
        const chip = e.target.closest('.graph-chip');
        if (chip && chip.dataset.book && chip.dataset.book !== book) {
          book = chip.dataset.book;
          debug.book = book;
          filterEl.querySelectorAll('.graph-chip').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
          if (sheetIndex >= 0 && !renderSheet(sheetIndex)) sheetUI.close();
          renderReport();
          return;
        }
        const tog = e.target.closest('.graph-weak-toggle');
        if (tog) {
          weakOnly = !weakOnly;
          debug.weakOnly = weakOnly;
          tog.setAttribute('aria-pressed', String(weakOnly));
          renderReport();
        }
      }
      function focusControl(selector) {
        const el = panel.querySelector(selector);
        if (el && typeof el.focus === 'function') {
          try { el.focus({ preventScroll: true }); } catch (e) { /* 古いブラウザ */ }
        }
      }
      function onPanelClick(e) {
        const cat = e.target.closest('[data-radar-cat]');
        if (cat && cat.dataset.radarCat) {
          category = cat.dataset.radarCat;
          renderReport();
          focusControl(`[data-radar-cat="${category}"]`);
          return;
        }
        const sortBtn = e.target.closest('[data-radar-sort]');
        if (sortBtn && sortBtn.dataset.radarSort) {
          sort = sortBtn.dataset.radarSort;
          renderReport();
          focusControl(`[data-radar-sort="${sort}"]`);
          return;
        }
        if (e.target.closest('[data-radar-cov]')) {
          showCoverage = !showCoverage;
          renderReport();
          focusControl('[data-radar-cov]');
          return;
        }
        const nodeEl = e.target.closest('[data-node]');
        if (nodeEl) {
          openSheet(Number(nodeEl.dataset.node));
          return;
        }
        if (sheetUI.isOpen() && !e.target.closest('button')) sheetUI.close();
      }
      // レーダーの軸のラベル（SVG の g）は button ではないので、Enter / Space で開けるようにする
      function onKeyDown(e) {
        if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.closest || !panel.contains(e.target)) return;
        const axisBtn = e.target.closest('.graph-radar-axis-btn[data-node]');
        if (!axisBtn) return;
        e.preventDefault();
        openSheet(Number(axisBtn.dataset.node));
      }

      on(filterEl, 'click', onFilterClick);
      on(panel, 'click', onPanelClick);
      on(document, 'keydown', onKeyDown);
      if (typeof ResizeObserver === 'function') {
        // 幅の区分が変わったときだけ描き直す（DOM の組み立てだけで rAF は使わない）
        const ro = new ResizeObserver(() => { if (alive && wantCompact() !== compact) renderReport(); });
        ro.observe(panel);
        track(() => ro.disconnect());
      }

      // ---- 起動 ----
      recompute();
      renderReport();

      return {
        refresh() {
          if (!alive) return;
          recompute();
          if (sheetIndex >= 0 && !renderSheet(sheetIndex)) sheetUI.close(); // 項目が無効になったら閉じる
          renderReport();
        },
        destroy() {
          if (!alive) return;
          alive = false;
          while (subs.length) subs.pop()();
          rootEl.remove();
          mastery = null;
        },
      };
    } catch (err) {
      alive = false;
      while (subs.length) subs.pop()();
      rootEl.remove();
      throw err;
    }
  }

  function mount(container, deps) {
    if (inst) destroy();
    debug.book = 'all'; debug.weakOnly = false; debug.compact = false; debug.lastTap = -1;
    inst = createInstance(container, deps);
    debug.mounted = true;
  }
  function refresh() { if (inst) inst.refresh(); }
  function destroy() {
    if (!inst) return;
    const i = inst;
    inst = null;
    debug.mounted = false;
    i.destroy();
  }

  root.RadarView = { mount, refresh, destroy, _debug: debug };
})(typeof self !== 'undefined' ? self : this);
