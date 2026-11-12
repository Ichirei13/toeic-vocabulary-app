// 文法グラフの画面（Canvas 2D）。window.GraphView を 1 つだけ公開し、アプリの state などのグローバルには触れない。
// 必要なものは mount(container, deps) の deps で受け取る:
//   deps = { graph, getStats: ()=>object, getWeak: ()=>object, getQuestion: (qid)=>object|undefined, isDue: (entry)=>boolean, onStartDrill?: (ids, label) => void }
// 計算は src/ の純関数（StudyCore.computeMastery / visibleMask / lodForScale / createCamera / zoomAt / panBy /
// visibleIndices / buildGrid / hitTest / buildDetail）に任せ、ここは DOM・入力・描画だけを持つ。
//
// 軽さの約束（設計書 §2）:
//   - タイマーなし・常時ループなし。入力・絞り込み・refresh・リサイズ・テーマ変更で「汚れた」ときだけ
//     requestAnimationFrame を 1 回要求する（保留中は 1 つまで）。document.hidden のあいだは要求しない。
//     例外は 2 つで、どちらも終わったら必ず止まる: 開いたときの力学（決めた回数だけ）と、移動のアニメーション（約 0.3 秒）。
//   - 色は CSS 変数（css/graph.css）からマウント時とテーマ変更時にだけ読む。描画のたびに getComputedStyle を呼ばない。
//   - ラベルの幅はノードごとに 1 回だけ測ってキャッシュする。描画中に文字列を作り直さない。
//   - destroy() は保留中の rAF・すべてのリスナー／オブザーバー・DOM を解放する。
(function (root) {
  'use strict';

  const BOOKS = [['all', 'すべて'], ['kin', '金'], ['sekai', '世界一'], ['polaris2', 'ポラリス2'], ['toplevel', 'トップレベル']];
  const TAP_SLOP = 6;          // これ以下の移動（CSS px、経路の長さの合計）で、ピンチでなければタップ
  const HIT_MIN_PX = 14;       // 当たり判定の最小半径（CSS px）。見た目より大きめにとる
  const MAX_LABELS = 80;       // 1 フレームに描くラベルの上限
  const DPR_MAX = 2;
  const SETTLE_BUDGET_MS = 8;  // 力学: 1 フレームに使う計算時間の上限
  const ZOOM_MIN_REL = 0.8;    // 全体表示の倍率（fitScale）に対する下限・上限
  const ZOOM_MAX_REL = 14;
  const VIEW_MARGIN = 24;      // 画面外の間引きで四方に足す余白（CSS px）。ノードの半径より大きく
  const LABEL_CHARS = 15;      // これより長いラベルは 14 字 + … に縮める（Trap の名前は 40 字を超える）
  const R_REF = 0.6, R_FACTOR_MIN = 0.65, R_FACTOR_MAX = 2.2;
  const KIND_NAMES = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
  // 種類ごとの半径（全体表示のときの CSS px）。book > chapter > rule > question、概念・Trap は章くらい
  const BASE_R = { book: 12, chapter: 6.5, rule: 4.5, concept: 6.5, trap: 6.5, question: 3 };
  // ラベルを置く優先度（小さいほど先）と書体
  const LABEL_PRIORITY = { book: 0, concept: 1, trap: 1, chapter: 2, rule: 3, question: 4 };
  const FONT_FAMILY = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",system-ui,sans-serif';
  const LABEL_FONT = {
    book: { size: 13, font: '700 13px ' + FONT_FAMILY },
    concept: { size: 11, font: '600 11px ' + FONT_FAMILY },
    trap: { size: 11, font: '600 11px ' + FONT_FAMILY },
    chapter: { size: 11, font: '500 11px ' + FONT_FAMILY },
    rule: { size: 10.5, font: '400 10.5px ' + FONT_FAMILY },
    question: { size: 10, font: '400 10px ' + FONT_FAMILY },
  };
  // CSS 変数（css/graph.css で .graph-view に定義）。state の色は MASTERY_STATES の並び
  const STATE_VARS = ['--graph-unseen', '--graph-due', '--graph-weak', '--graph-few', '--graph-mid', '--graph-good'];
  const COLOR_VARS = {
    bg: '--graph-bg', edge: '--graph-edge', conceptEdge: '--graph-concept-edge', trapEdge: '--graph-trap-edge', trapLine: '--graph-trap-line',
    label: '--graph-label', halo: '--graph-label-halo', ring: '--graph-ring', dueRing: '--graph-due-ring',
    weakEdge: '--graph-weak-edge',
  };
  const FALLBACK = {
    bg: '#f6f7f9', edge: 'rgba(60,60,67,0.2)', conceptEdge: 'rgba(88,86,214,0.5)', trapEdge: '#e8890c', trapLine: 'rgba(232,137,12,0.5)',
    label: '#1c1c1e', halo: '#f6f7f9', ring: '#3a3a3c', dueRing: '#9f1d22',
    states: ['#b8bec7', '#e5484d', '#e5484d', '#7cc4f0', '#f2c94c', '#34c759'],
    weakEdge: 'rgba(229,72,77,0.8)', reds: ['#f29a9d', '#ec6f74', '#e5484d'],
  };
  const BUNDLE_MIN_Q = 2;                     // 苦手が 0 で問題数がこれ以下の束は、遠景・中景では描かない
  const BUNDLE_WIDTHS = [0.8, 1.3, 1.8, 2.4]; // 束の太さ: 苦手 0 / 1〜2 / 3〜5 / 6 以上（苦手が多いと中央に集まって塗りつぶしになるので細め）
  const BUNDLE_WEAK_ALPHA = 0.5;              // 苦手のある束の不透明度（線の向こうのノードとラベルを読めるように）
  const SIZE_BOOST_STEP = 0.25, SIZE_BOOST_MAX = 1.2; // 大きさ = 1 + min(上限, 段 × √苦手の数)
  const RED_VARS = ['--graph-weak-1', '--graph-weak-2', '--graph-weak']; // 赤の濃さ（苦手の割合 1 割未満 / 3 割未満 / それ以上）
  const FOCUS_NEAR = 30;         // 問題を選んだときに一緒に浮かび上がらせる、近い問題の数
  const DIM_NODE = 0.16;         // 選択中、つながらないノードの濃さ
  const DIM_EDGE = 0.08;         // 選択中、つながらない線の濃さ
  const FOCUS_EDGE_WIDTH = 1.8;  // 選択中、浮かび上がらせる線の太さ
  const FOCUS_EDGE_MANY = 60;    // 浮かび上がらせる線がこれより多いときは、扇状に重なって塗りつぶしになるので細く薄くする
  const FOCUS_EDGE_WIDTH_MANY = 1, FOCUS_EDGE_ALPHA_MANY = 0.5;
  const FOCUS_Q_LABELS = 6;      // 遠景・中景で、選択中に浮かび上がった問題に付ける番号ラベルの上限（選択したノード自身は別）
  const REVEAL_GAP = 40;         // タップで開いたシートの上端からこの距離以内にノードがあれば、見える範囲の中央へ動かす（CSS px）
  const JUMP_MS = 300;           // シートの問題をタップしたときの移動の長さ
  const JUMP_MIN_REL = 2.4;      // 移動先の倍率の下限（全体表示に対する比。ルールまで見える倍率）
  const STATUS_LABEL = { weak: '苦手', wrong: '誤答あり', unseen: '未解答', correct: '正解' };

  // テスト用の観測値。frames はマウントごとに 0 から数える。listeners は今登録中のリスナー・オブザーバーの数
  const debug = {
    frames: 0, listeners: 0, pending: false, lastFrameMs: 0, lastDrawnNodes: 0, lastDrawnEdges: 0, lastDrawnBundles: 0, lastLabels: 0, lastFarQuestionLabels: 0, focusEdges: 0, lastFocusEdgeWidth: 0,
    drawnKinds: [0, 0, 0, 0, 0, 0], lod: 0, book: 'all', weakOnly: false, lastTap: -1,
    settled: true, settleTicks: 0, settleMs: 0, settleMaxFrameMs: 0,
    focusNode: -1, focusCount: 0, animating: false,
  };
  let inst = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // エスケープ済みの文字列の **太字** だけを <strong> にする（エスケープの後なので安全）。残った ** は消す
  function richText(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*\*/g, '');
  }
  function safeObj(fn) {
    try { const v = typeof fn === 'function' ? fn() : null; return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function createInstance(container, deps) {
    const S = root.StudyCore;
    if (!S || typeof S.computeMastery !== 'function' || typeof S.createCamera !== 'function' || typeof S.buildDetail !== 'function' || typeof S.buildIndex !== 'function' || typeof S.focusSet !== 'function') {
      throw new Error('GraphView: StudyCore (src/mastery.js, graph-filter.js, graph-geometry.js, graph-detail.js) が読み込まれていない');
    }
    if (!container || !deps || !deps.graph) throw new Error('GraphView.mount: container と deps.graph が必要');
    const graph = deps.graph;
    const n = graph.id.length;
    const kinds = graph.kinds || KIND_NAMES;
    const kindName = i => kinds[graph.kind[i]];

    // ---- グラフの前処理（マウント時に 1 回） ----
    const xs = new Float64Array(n), ys = new Float64Array(n);
    const baseR = new Float32Array(n);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      xs[i] = +graph.x[i]; ys[i] = +graph.y[i];
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
      baseR[i] = BASE_R[kindName(i)] || 3;
    }
    let bounds = { minX, maxX, minY, maxY };
    const kConcept = kinds.indexOf('concept'), kTrap = kinds.indexOf('trap');
    const kQuestion = kinds.indexOf('question'), kChapter = kinds.indexOf('chapter'), kRule = kinds.indexOf('rule');
    // ラベル: 表示用の文字列は今ここで 1 回だけ作る。幅は初めて置くときに測ってキャッシュ（NaN = 未計測）
    const labelText = new Array(n);
    for (let i = 0; i < n; i++) {
      const s = graph.label && graph.label[i] != null ? String(graph.label[i]) : String(graph.id[i]);
      labelText[i] = s.length > LABEL_CHARS ? s.slice(0, LABEL_CHARS - 1) + '…' : s;
    }
    const labelW = new Float32Array(n).fill(NaN);
    const labelOrder = Int32Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => (LABEL_PRIORITY[kindName(a)] - LABEL_PRIORITY[kindName(b)]) || a - b);
    // 当たり判定の優先度（ほぼ同距離のときだけ使う）: 大きい種類を優先
    const hitOrder = new Int32Array(n);
    for (let i = 0; i < n; i++) hitOrder[i] = 10 - (LABEL_PRIORITY[kindName(i)] || 0);
    // エッジを種類ごとに分けておく（親子 0・概念 1・Trap 2）
    const edgeLists = [[], [], []];
    const E = graph.edges || [];
    for (let k = 0; k + 2 < E.length; k += 3) {
      const t = E[k + 2];
      if (t >= 0 && t <= 2 && E[k] >= 0 && E[k] < n && E[k + 1] >= 0 && E[k + 1] < n) edgeLists[t].push(E[k], E[k + 1]);
    }
    const edgesByType = edgeLists.map(a => Int32Array.from(a));

    // 索引と束ねた線（マウント時に 1 回）。bundles[0] = 章の単位（遠景）、[1] = ルールの単位（中景）
    const index = S.buildIndex(graph);
    const qidNode = new Map(); // 問題 id → ノード添字（シートの一覧から移動するため）
    for (let o = 0; o < index.nq; o++) if (index.qNode[o] >= 0) qidNode.set(graph.qids[o], index.qNode[o]);
    const bundles = [S.buildBundles(graph, index, 'chapter'), S.buildBundles(graph, index, 'rule')];
    let bundleWeakCnt = [new Int32Array(bundles[0].count), new Int32Array(bundles[1].count)];
    const sizeBoost = new Float32Array(n).fill(1); // 苦手の数に応じた大きさの倍率
    let maxBaseR = BASE_R.book;                    // 大きくなった分を含む、ノードの基準半径の最大（当たり判定の上限に使う）
    const fillClass = new Uint8Array(n);           // 0〜5 = 状態の色、6〜8 = 赤の濃さ
    const baseLabel = labelText.slice();           // 数を付ける前のラベル

    // 描画中に使い回す配列
    const inView = new Uint8Array(n);
    const sxs = new Float32Array(n), sys = new Float32Array(n), rs = new Float32Array(n);
    const drawList = new Int32Array(n);
    const placed = new Float32Array(MAX_LABELS * 4);
    const placedIdx = new Int32Array(MAX_LABELS);
    const hitXs = new Float64Array(n).fill(NaN); // 絞り込みで隠れたノードは NaN にして hitTest に当たらせない

    // ---- 状態 ----
    let alive = true;
    let rafId = 0, dirty = false;
    let width = 0, height = 0, dpr = 1;
    let cam = null, fitScale = 1, interacted = false;
    let book = 'all', weakOnly = false;
    let stats = {}, weak = {}, mastery = null, masteryVer = 0;
    let mask = null, maskKey = '';
    let colors = null;
    let sheetIndex = -1;
    let settle = null;          // 力学の実行中だけ { sim, nodes, left, t0, maxFrame, quiet }
    let focusEdges = 0;               // 浮かび上がらせる線の本数（両端が浮かび上がっているもの）
    let focus = null, focusNode = -1; // 選択中: 浮かび上がらせるノード（Uint8Array）と、選択したノード
    let anim = null;                  // 移動のアニメーション中だけ { from, to, t0 }
    let sheetWide = false;            // シートを広げているか（既定は半分の高さ）
    let sheetPick = null;             // 開いているシートの「近い問題」の選び（押したときにそのまま渡す）
    const pointers = new Map(); // pointerId -> { x, y }
    let gesture = null;         // { moved, pinched, lastDist, lastMid }
    const subs = [];

    // リスナー・オブザーバーの登録と解除を 1 か所で数える
    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      debug.listeners++;
      subs.push(() => { target.removeEventListener(type, fn, opts); debug.listeners--; });
    }
    function track(off) { debug.listeners++; subs.push(() => { off(); debug.listeners--; }); }

    // ---- DOM ----
    const rootEl = document.createElement('div');
    rootEl.className = 'graph-view';
    rootEl.innerHTML =
      '<div class="graph-filter" role="toolbar" aria-label="グラフの絞り込み">' +
        '<div class="graph-chips" role="group" aria-label="教材">' +
          BOOKS.map(([id, name]) => `<button type="button" class="graph-chip" data-book="${id}" aria-pressed="${id === 'all'}">${esc(name)}</button>`).join('') +
        '</div>' +
        '<button type="button" class="graph-weak-toggle" aria-pressed="false">苦手のみ</button>' +
      '</div>' +
      '<div class="graph-stage">' +
        '<canvas class="graph-canvas" aria-label="文法のつながりのグラフ。ノードをタップすると詳細が開きます"></canvas>' +
        '<div class="graph-legend" aria-hidden="true">' +
          '<span class="graph-legend-item"><i class="graph-legend-size"></i>大きさ・線の太さ = 苦手の数</span>' +
          '<span class="graph-legend-item"><i class="graph-legend-red"></i>赤の濃さ = 苦手の割合</span>' +
        '</div>' +
        '<div class="graph-zoom" role="group" aria-label="拡大と縮小">' +
          '<button type="button" data-zoom="in" aria-label="拡大">＋</button>' +
          '<button type="button" data-zoom="out" aria-label="縮小">－</button>' +
          '<button type="button" data-zoom="fit" aria-label="全体を表示">全体</button>' +
          '<button type="button" data-zoom="relayout" aria-label="配置し直す">再配置</button>' +
        '</div>' +
      '</div>' +
      '<section class="graph-sheet" role="dialog" aria-modal="false" aria-labelledby="graph-sheet-title" tabindex="-1" hidden>' +
        '<header class="graph-sheet-head">' +
          '<div class="graph-sheet-titles"><span class="graph-sheet-kind"></span><h2 class="graph-sheet-title" id="graph-sheet-title"></h2></div>' +
          '<button type="button" class="graph-sheet-expand" aria-pressed="false">広げる</button>' +
          '<button type="button" class="graph-sheet-close" aria-label="閉じる">×</button>' +
        '</header>' +
        '<div class="graph-sheet-body"></div>' +
      '</section>';
    // ここから先で例外が出たら（getContext が null、グラフが壊れているなど）、登録済みのリスナー・オブザーバーを
    // すべて外し、DOM も消してから投げ直す（失敗した mount が何も残さない）
    try {
    container.appendChild(rootEl);
    const filterEl = rootEl.querySelector('.graph-filter');
    const stage = rootEl.querySelector('.graph-stage');
    const canvas = rootEl.querySelector('canvas');
    const zoomEl = rootEl.querySelector('.graph-zoom');
    const sheet = rootEl.querySelector('.graph-sheet');
    const sheetKind = sheet.querySelector('.graph-sheet-kind');
    const sheetTitle = sheet.querySelector('.graph-sheet-title');
    const sheetBody = sheet.querySelector('.graph-sheet-body');
    const sheetExpand = sheet.querySelector('.graph-sheet-expand');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('GraphView: canvas 2D コンテキストを取得できない');

    // ---- 色（マウント時とテーマ変更時だけ読む） ----
    function readColors() {
      const cs = getComputedStyle(rootEl);
      const get = (name, fb) => { const v = cs.getPropertyValue(name).trim(); return v || fb; };
      const c = { states: STATE_VARS.map((v, k) => get(v, FALLBACK.states[k])) };
      for (const key in COLOR_VARS) c[key] = get(COLOR_VARS[key], FALLBACK[key]);
      c.reds = RED_VARS.map((v, k) => get(v, FALLBACK.reds[k]));
      colors = c;
    }

    // ---- 描画の要求（dirty + rAF 1 つだけ） ----
    function requestDraw() {
      dirty = true;
      if (!alive || rafId || document.hidden) return;
      rafId = requestAnimationFrame(onFrame);
      debug.pending = true;
    }
    function onFrame() {
      rafId = 0;
      debug.pending = false;
      if (!alive || document.hidden) return; // dirty は残し、見えるようになったら描く（力学の続きもそこから）
      if (settle) {
        const quiet = settle.quiet;
        stepSettle();
        if (settle) {
          // まだ続く。「視差効果を減らす」のときは途中を描かない
          if (!quiet) draw();
          requestDraw();
          return;
        }
      }
      if (anim) stepAnim();
      draw();
      if (anim) requestDraw(); // 動き終わったら（anim = null）要求しない
    }

    // ---- 理解度と絞り込み ----
    function recompute() {
      stats = safeObj(deps.getStats);
      weak = safeObj(deps.getWeak);
      mastery = S.computeMastery(graph, stats, weak, deps.isDue);
      masteryVer++;
      let mx = BASE_R.book;
      bundleWeakCnt = bundles.map(b => S.bundleWeak(b, mastery.weak));
      for (let i = 0; i < n; i++) {
        const w = mastery.weak[i], k = graph.kind[i], st = mastery.state[i];
        const grows = k === kConcept || k === kTrap || k === kChapter || k === kRule;
        sizeBoost[i] = grows && w > 0 ? 1 + Math.min(SIZE_BOOST_MAX, SIZE_BOOST_STEP * Math.sqrt(w)) : 1;
        const br = baseR[i] * sizeBoost[i];
        if (br > mx) mx = br;
        if (st === 1 || st === 2) {
          // 赤は、配下に占める苦手の割合で 3 段階。問題そのものはいちばん濃い
          const ratio = k === kQuestion ? 1 : mastery.total[i] > 0 ? w / mastery.total[i] : 0;
          fillClass[i] = ratio < 0.1 ? 6 : ratio < 0.3 ? 7 : 8;
        } else {
          fillClass[i] = st;
        }
        const text = w > 0 && k !== kQuestion ? baseLabel[i] + ' ' + w : baseLabel[i];
        if (text !== labelText[i]) { labelText[i] = text; labelW[i] = NaN; } // 幅は次に置くときに測り直す
      }
      if (mx !== maxBaseR) {
        maxBaseR = mx;
        if (grid && width > 0 && height > 0) buildGrid(); // 当たり半径の上限が変わったので格子を作り直す
      }
    }
    function ensureMask(lod) {
      const key = lod + '|' + book + '|' + (weakOnly ? 1 : 0) + '|' + masteryVer + '|' + focusNode;
      if (key === maskKey) return;
      maskKey = key;
      mask = S.visibleMask(graph, mastery, { book, weakOnly, lod, showWeakQuestions: true, forceShow: focus });
      for (let i = 0; i < n; i++) hitXs[i] = mask[i] ? xs[i] : NaN;
    }
    const relZoom = () => cam.scale / fitScale;
    const currentLod = () => S.lodForScale(relZoom());
    // ノードの画面上の大きさ = BASE_R × 係数。係数は「ワールド 1 単位の画面 px（cam.scale）」の 0.4 乗で、
    // R_REF（1280×800 の全体表示くらい）で 1。スマホ幅の全体表示では小さめ（0.65 まで）、寄るほど大きく（2.2 まで）。
    const radiusFactor = () => clamp(Math.pow(cam.scale / R_REF, 0.4), R_FACTOR_MIN, R_FACTOR_MAX);

    // 当たり判定の格子: マウント時に 1 回だけ作る。セルの一辺は「いちばん引いたとき（fitScale×0.8）の
    // 最大の当たり半径」をワールド単位にした値の 2 倍。引いたときでもタップ 1 回で見るセルが数個で済み、
    // 寄ったときは半径が小さいので 1〜4 セルしか見ない。8〜400 ワールド単位に収める。
    let grid = null;
    function buildGrid() {
      const maxHitPx = Math.max(HIT_MIN_PX, maxBaseR * R_FACTOR_MAX);
      const cell = clamp((2 * maxHitPx) / (fitScale * ZOOM_MIN_REL), 8, 400);
      grid = S.buildGrid(xs, ys, cell);
    }

    // ---- 力学（開いたときと「配置し直す」のときだけ。決めた回数で必ず止まる） ----
    function updateBounds() {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < n; i++) {
        if (xs[i] < a) a = xs[i];
        if (xs[i] > b) b = xs[i];
        if (ys[i] < c) c = ys[i];
        if (ys[i] > d) d = ys[i];
      }
      minX = a; maxX = b; minY = c; maxY = d;
      bounds = { minX, maxX, minY, maxY };
    }
    // 範囲が変わったら全体表示の倍率を取り直す。まだ触っていなければ、全体表示のまま追いかける
    function refit() {
      if (!(width > 0 && height > 0)) return;
      const fit = S.createCamera(width, height, bounds);
      fitScale = fit.scale;
      if (!interacted) cam = fit;
    }
    function resetPositions() {
      for (let i = 0; i < n; i++) { xs[i] = +graph.x[i]; ys[i] = +graph.y[i]; }
    }
    function canSettle() {
      const d3 = root.d3;
      return !!(d3 && typeof d3.forceSimulation === 'function' && typeof S.createSimulation === 'function');
    }
    function stopSettle() {
      if (!settle) return;
      settle.sim.stop();
      settle = null;
    }
    // 収まった（または回さなかった）後の後始末。fromFrame = onFrame の中から呼ばれた（直後に描くので要求しない）
    function finishSettle(fromFrame) {
      updateBounds();
      refit();
      maskKey = '';                 // 当たり判定用の座標（hitXs）を作り直させる
      if (width > 0 && height > 0) buildGrid();
      debug.settled = true;
      if (!fromFrame) requestDraw();
    }
    function startSettle() {
      stopSettle();
      stopAnim();
      resetPositions();
      debug.settleTicks = 0; debug.settleMs = 0; debug.settleMaxFrameMs = 0;
      const weakQ = new Uint8Array(n);
      let anyWeak = false;
      for (let i = 0; i < n; i++) if (graph.kind[i] === kQuestion && mastery.weak[i] > 0) { weakQ[i] = 1; anyWeak = true; }
      // 苦手が 1 問もなければ、力はビルド時と同じ。回しても揺れるだけなので、固定配置のまま出す
      if (!anyWeak || !canSettle()) { finishSettle(false); return; }
      const kn = new Array(n);
      for (let i = 0; i < n; i++) kn[i] = kindName(i);
      let made;
      try {
        made = S.createSimulation(root.d3, {
          kindName: kn, edges: E, bookOf: S.bookOfNodes(graph.id, kn, E), x: xs, y: ys, weakQ, hubWeak: mastery.weak,
        }, S.GRAPH_LAYOUT, S.GRAPH_RUNTIME);
      } catch (e) { finishSettle(false); return; } // 組み立てに失敗したら固定配置
      const mq = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      settle = { sim: made.sim, nodes: made.nodes, left: made.ticks, t0: performance.now(), maxFrame: 0, quiet: !!(mq && mq.matches) };
      debug.settled = false;
      requestDraw();
    }
    function stepSettle() {
      const t0 = performance.now();
      try {
        do { settle.sim.tick(); settle.left--; debug.settleTicks++; } while (settle.left > 0 && performance.now() - t0 < SETTLE_BUDGET_MS);
      } catch (e) {
        // 力学が例外を投げたら、座標が壊れたときと同じく固定配置に戻す（settle を残すとタップが永久に効かない）
        console.warn('graph-view: 力学の計算に失敗したため、固定配置に戻します', e);
        stopSettle(); resetPositions(); finishSettle(true);
        return;
      }
      const nodes = settle.nodes;
      let finite = true;
      for (let i = 0; i < n; i++) if (!Number.isFinite(nodes[i].x) || !Number.isFinite(nodes[i].y)) { finite = false; break; }
      if (!finite) { stopSettle(); resetPositions(); finishSettle(true); return; } // 壊れたら固定配置に戻す
      for (let i = 0; i < n; i++) { xs[i] = nodes[i].x; ys[i] = nodes[i].y; }
      const dt = performance.now() - t0;
      if (dt > settle.maxFrame) settle.maxFrame = dt;
      if (settle.left > 0) { updateBounds(); refit(); return; }
      debug.settleMs = performance.now() - settle.t0;
      debug.settleMaxFrameMs = settle.maxFrame;
      stopSettle();
      finishSettle(true);
    }

    // ---- 描画 ----
    function draw() {
      const t0 = performance.now();
      dirty = false;
      debug.frames++;
      if (!(width > 0 && height > 0) || !colors) { debug.lastFrameMs = performance.now() - t0; return; }
      const lod = currentLod();
      ensureMask(lod);
      const s = cam.scale, ox = cam.x, oy = cam.y;
      const rf = radiusFactor();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);

      // 画面内（余白つき）のノード
      inView.fill(0);
      const vis = S.visibleIndices(xs, ys, cam, width, height, VIEW_MARGIN);
      let m = 0;
      const kc = debug.drawnKinds;
      for (let k = 0; k < kc.length; k++) kc[k] = 0;
      for (let j = 0; j < vis.length; j++) {
        const i = vis[j];
        inView[i] = 1;
        if (!mask[i]) continue;
        drawList[m++] = i;
        sxs[i] = xs[i] * s + ox; sys[i] = ys[i] * s + oy; rs[i] = baseR[i] * sizeBoost[i] * rf;
        kc[graph.kind[i]]++;
      }

      // エッジ: 両端が絞り込みを通り（mask）、かつ少なくとも一端が画面内（余白つき）のときだけ描く。
      // 両端とも画面外で画面を横切るだけの長いエッジは描かない（間引きの規則。visibleIndices はノードだけを見るため）。
      // 種類ごとに 1 つの path にまとめ、1 回だけ stroke する。
      // 線。選択中は、まず全部を薄く描き、そのあと浮かび上がらせる線を通常の濃さで重ねる
      const lit = focus;
      const manyLit = !!lit && focusEdges > FOCUS_EDGE_MANY;
      const litWidth = manyLit ? FOCUS_EDGE_WIDTH_MANY : FOCUS_EDGE_WIDTH;
      debug.lastFocusEdgeWidth = lit ? litWidth : 0;
      ctx.globalAlpha = lit ? DIM_EDGE : 1;
      // 概念・ひっかけの線: 遠景・中景は束ねた線。そのうえで、見えている苦手の問題の線は下のループが描く
      const bundleCount = lod < 2 ? drawBundles(lod, s, ox, oy, lit ? DIM_EDGE : 1) : 0;
      let edgeCount = 0;
      const edgeStyle = [
        [colors.edge, 1, null],
        [colors.conceptEdge, 1, [1.5, 3]],
        [colors.trapLine, 1.2, [5, 4]],
      ];
      for (let pass = 0; pass < (lit ? 2 : 1); pass++) {
        // pass 0 = 全部（選択中は薄く）、pass 1 = 両端が浮かび上がっている線だけ
        for (let t = 0; t < 3; t++) {
          const list = edgesByType[t];
          ctx.beginPath();
          let any = false;
          for (let k = 0; k < list.length; k += 2) {
            const a = list[k], b = list[k + 1];
            if (!mask[a] || !mask[b] || !(inView[a] || inView[b])) continue;
            if (pass === 1 && !(lit[a] && lit[b])) continue;
            ctx.moveTo(xs[a] * s + ox, ys[a] * s + oy);
            ctx.lineTo(xs[b] * s + ox, ys[b] * s + oy);
            any = true;
            if (pass === 0) edgeCount++;
          }
          if (!any) continue;
          ctx.globalAlpha = pass === 0 && lit ? DIM_EDGE : pass === 1 && manyLit ? FOCUS_EDGE_ALPHA_MANY : 1;
          ctx.strokeStyle = edgeStyle[t][0];
          ctx.lineWidth = pass === 1 ? litWidth : edgeStyle[t][1];
          ctx.setLineDash(edgeStyle[t][2] || []);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      // ノード: 状態（色）ごとに 1 つの path で塗る。縁は背景色で細く描いて重なりを分ける
      const st = mastery.state;
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.bg;
      for (let pass = 0; pass < (lit ? 2 : 1); pass++) {
        // pass 0 = 選択中はつながらないノード（薄く）、選択していなければ全部。pass 1 = 浮かび上がらせるノード
        ctx.globalAlpha = lit && pass === 0 ? DIM_NODE : 1;
        for (let c = 0; c < 9; c++) {
          ctx.beginPath();
          let any = false;
          for (let j = 0; j < m; j++) {
            const i = drawList[j];
            if (fillClass[i] !== c) continue;
            if (lit && (lit[i] ? pass === 0 : pass === 1)) continue;
            ctx.moveTo(sxs[i] + rs[i], sys[i]);
            ctx.arc(sxs[i], sys[i], rs[i], 0, Math.PI * 2);
            any = true;
          }
          if (!any) continue;
          ctx.fillStyle = c < 6 ? colors.states[c] : colors.reds[c - 6];
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // 種類の印: 概念 = 二重リング（外側にもう 1 本）、Trap = 破線のリング、要復習 = 赤い外枠
      ringPath(m, i => (!lit || lit[i]) && graph.kind[i] === kConcept, 2.5);
      ctx.strokeStyle = colors.ring; ctx.lineWidth = 1.3; ctx.stroke();
      ringPath(m, i => (!lit || lit[i]) && graph.kind[i] === kTrap, 2.5);
      ctx.strokeStyle = colors.trapEdge; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2.5]); ctx.stroke();
      ctx.setLineDash([]);
      ringPath(m, i => (!lit || lit[i]) && st[i] === 1, 1.6, i => graph.kind[i] === kConcept || graph.kind[i] === kTrap ? 5 : 0);
      ctx.strokeStyle = colors.dueRing; ctx.lineWidth = 1.8; ctx.stroke();
      // 選択したノードの外枠
      if (lit && focusNode >= 0 && mask[focusNode] && inView[focusNode]) {
        ctx.beginPath();
        ctx.arc(sxs[focusNode], sys[focusNode], rs[focusNode] + 5, 0, Math.PI * 2);
        ctx.strokeStyle = colors.label; ctx.lineWidth = 2; ctx.stroke();
      }

      const labels = drawLabels(lod);

      debug.lastDrawnNodes = m;
      debug.lastDrawnEdges = edgeCount;
      debug.lastDrawnBundles = bundleCount;
      debug.lastLabels = labels;
      debug.lod = lod;
      debug.lastFrameMs = performance.now() - t0;
    }

    const bundleClass = w => (w <= 0 ? 0 : w <= 2 ? 1 : w <= 5 ? 2 : 3);
    // 束ねた線を、太さ（苦手の数）と種類（概念 / ひっかけ）ごとに 1 つの path にまとめて描く。描いた本数を返す
    function drawBundles(lod, s, ox, oy, alpha) {
      const B = bundles[lod], W = bundleWeakCnt[lod];
      let count = 0;
      for (let c = 0; c < 4; c++) {
        for (let t = 1; t <= 2; t++) {
          ctx.beginPath();
          let any = false;
          for (let j = 0; j < B.count; j++) {
            if (B.type[j] !== t || bundleClass(W[j]) !== c) continue;
            const a = B.a[j], b = B.b[j];
            if (!mask[a] || !mask[b] || !(inView[a] || inView[b])) continue;
            if (c === 0 && B.start[j + 1] - B.start[j] <= BUNDLE_MIN_Q) continue;
            ctx.moveTo(xs[a] * s + ox, ys[a] * s + oy);
            ctx.lineTo(xs[b] * s + ox, ys[b] * s + oy);
            any = true;
            count++;
          }
          if (!any) continue;
          ctx.strokeStyle = c === 0 ? (t === 1 ? colors.conceptEdge : colors.trapLine) : colors.weakEdge;
          ctx.globalAlpha = (c === 0 ? 0.5 : BUNDLE_WEAK_ALPHA) * alpha;
          ctx.lineWidth = BUNDLE_WIDTHS[c];
          ctx.setLineDash(t === 2 ? [5, 4] : []);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      return count;
    }

    function ringPath(m, pick, gap, extra) {
      ctx.beginPath();
      for (let j = 0; j < m; j++) {
        const i = drawList[j];
        if (!pick(i)) continue;
        const r = rs[i] + gap + (extra ? extra(i) : 0);
        ctx.moveTo(sxs[i] + r, sys[i]);
        ctx.arc(sxs[i], sys[i], r, 0, Math.PI * 2);
      }
    }

    // ラベル: 画面内・絞り込みを通ったノードを優先度順（本 > 概念・Trap > 章 > ルール > 問題）に見て、
    // 既に置いたラベルと重ならず、画面からはみ出さないものだけ、上限 MAX_LABELS 個まで置く（貪欲法）。
    function drawLabels(lod) {
      let count = 0, qLabels = 0;
      let curFont = '';
      for (let j = 0; j < n && count < MAX_LABELS; j++) {
        const i = labelOrder[j];
        if (!mask[i] || !inView[i] || (focus && !focus[i])) continue;
        // 問題の番号ラベルは近景だけ。遠景・中景では、選択中に浮かび上がった問題を数個まで（選択したノード自身は必ず）
        const isQ = graph.kind[i] === kQuestion;
        if (isQ && lod < 2 && i !== focusNode && (!focus || qLabels >= FOCUS_Q_LABELS)) continue;
        const sx = sxs[i], sy = sys[i];
        if (sx < 0 || sx > width || sy < 0 || sy > height) continue;
        const lf = LABEL_FONT[kindName(i)] || LABEL_FONT.question;
        let w = labelW[i];
        if (w !== w) { // NaN = まだ測っていない（同じラベルは 2 度測らない）
          if (curFont !== lf.font) { ctx.font = lf.font; curFont = lf.font; }
          w = labelW[i] = ctx.measureText(labelText[i]).width;
        }
        const x0 = sx - w / 2 - 2, y0 = sy + rs[i] + 2, x1 = sx + w / 2 + 2, y1 = y0 + lf.size + 3;
        if (x0 < 2 || x1 > width - 2 || y1 > height - 2) continue;
        let hit = false;
        for (let k = 0; k < count; k++) {
          const p = k * 4;
          if (x0 < placed[p + 2] && x1 > placed[p] && y0 < placed[p + 3] && y1 > placed[p + 1]) { hit = true; break; }
        }
        if (hit) continue;
        const p = count * 4;
        placed[p] = x0; placed[p + 1] = y0; placed[p + 2] = x1; placed[p + 3] = y1;
        placedIdx[count++] = i;
        if (isQ && lod < 2 && i !== focusNode) qLabels++;
      }
      debug.lastFarQuestionLabels = qLabels;
      // 描く（並びは優先度順なので書体の切り替えは種類の変わり目だけ）
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.halo;
      ctx.fillStyle = colors.label;
      curFont = '';
      for (let k = 0; k < count; k++) {
        const i = placedIdx[k];
        const lf = LABEL_FONT[kindName(i)] || LABEL_FONT.question;
        if (curFont !== lf.font) { ctx.font = lf.font; curFont = lf.font; }
        const y = placed[k * 4 + 1] + 1;
        ctx.strokeText(labelText[i], sxs[i], y);
        ctx.fillText(labelText[i], sxs[i], y);
      }
      return count;
    }

    // ---- カメラ ----
    function limits() { return { min: fitScale * ZOOM_MIN_REL, max: fitScale * ZOOM_MAX_REL }; }
    function resize(w, h) {
      const oldW = width, oldH = height;
      width = w; height = h;
      dpr = Math.min(DPR_MAX, root.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (!(w > 0 && h > 0)) { requestDraw(); return; }
      const fit = S.createCamera(w, h, bounds);
      const prevFit = fitScale;
      fitScale = fit.scale;
      if (!cam || !interacted) {
        cam = fit;
      } else {
        // 画面中央にあったワールド点を、新しい画面の中央に保つ（倍率は全体表示に対する比を保つ）
        const wx = (oldW / 2 - cam.x) / cam.scale, wy = (oldH / 2 - cam.y) / cam.scale;
        const lim = limits();
        const sc = clamp(cam.scale * (fitScale / prevFit), lim.min, lim.max);
        cam = { x: w / 2 - wx * sc, y: h / 2 - wy * sc, scale: sc };
      }
      if (!grid) buildGrid();
      requestDraw();
    }
    function setCam(next) {
      if (!next || !(next.scale > 0)) return;
      cam = next;
      interacted = true;
      requestDraw();
    }
    function zoomBy(sx, sy, factor) { setCam(S.zoomAt(cam, sx, sy, factor, limits())); }
    // シートの一覧から: その問題へ画面を動かし、選択を切り替える。シートに隠れない位置（上側の中央）に置く
    function jumpTo(i) {
      if (!(i >= 0 && i < n) || !cam || settle) return;
      setSheetWide(false);
      openSheet(i);
      const sc = Math.max(cam.scale, fitScale * JUMP_MIN_REL);
      const covered = sheet.hidden ? 0 : Math.min(height * 0.6, sheet.getBoundingClientRect().height);
      animateTo({ x: width / 2 - xs[i] * sc, y: Math.max(60, (height - covered) / 2) - ys[i] * sc, scale: sc });
    }
    // 移動のアニメーション（「視差効果を減らす」のときは即座に切り替える）。終わったら rAF を要求しない
    function animateTo(to) {
      const mq = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (mq && mq.matches) { anim = null; debug.animating = false; setCam(to); return; }
      anim = { from: cam, to, t0: performance.now() };
      debug.animating = true;
      interacted = true;
      requestDraw();
    }
    // タップでシートを開いたとき、選んだノードがシートに隠れる・シートの上端のすぐ上にあれば、倍率はそのまま、
    // シートの上の見える範囲の中央へ動かす。見えている位置なら動かさない
    function revealAboveSheet(i) {
      if (!cam || sheet.hidden) return;
      const cr = canvas.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
      const sx = xs[i] * cam.scale + cam.x, sy = ys[i] * cam.scale + cam.y;
      const top = sr.top - cr.top;
      if (!(sy > top - REVEAL_GAP && sx >= sr.left - cr.left && sx <= sr.right - cr.left)) return;
      const visible = Math.max(REVEAL_GAP, top);
      animateTo({ x: width / 2 - xs[i] * cam.scale, y: visible / 2 - ys[i] * cam.scale, scale: cam.scale });
    }
    function stepAnim() {
      const u = Math.min(1, (performance.now() - anim.t0) / JUMP_MS);
      const e = u * (2 - u); // だんだん遅くなる
      const a = anim.from, b = anim.to;
      cam = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, scale: a.scale + (b.scale - a.scale) * e };
      if (u >= 1) { anim = null; debug.animating = false; }
    }
    function stopAnim() { if (anim) { anim = null; debug.animating = false; } }

    // ---- 当たり判定 ----
    // 半径 = max(14 CSS px, いま描いている最大のノード半径) をワールド単位にしたもの。中心がいちばん近いノードを選ぶ。
    function hitIndex(lx, ly) {
      if (!cam || !grid) return -1;
      ensureMask(currentLod());
      const [wx, wy] = S.screenToWorld(cam, lx, ly);
      const maxR = maxBaseR * radiusFactor();
      const r = Math.max(HIT_MIN_PX, maxR) / cam.scale;
      return S.hitTest(grid, hitXs, ys, wx, wy, r, hitOrder);
    }
    function localXY(e) {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    // ---- 選択（周辺を浮かび上がらせる） ----
    function setFocus(i) {
      const nearQ = graph.kind[i] === index.kQ && typeof S.nearestQuestions === 'function'
        ? S.nearestQuestions(graph, index, i, FOCUS_NEAR) : null;
      focus = S.focusSet(graph, index, i, nearQ);
      focusNode = i;
      let c = 0;
      for (let k = 0; k < n; k++) c += focus[k];
      focusEdges = 0;
      for (let t = 0; t < 3; t++) {
        const list = edgesByType[t];
        for (let k = 0; k < list.length; k += 2) if (focus[list[k]] && focus[list[k + 1]]) focusEdges++;
      }
      debug.focusNode = i; debug.focusCount = c; debug.focusEdges = focusEdges;
      requestDraw();
    }
    function clearFocus() {
      if (!focus) return;
      focus = null; focusNode = -1; focusEdges = 0;
      debug.focusNode = -1; debug.focusCount = 0; debug.focusEdges = 0;
      requestDraw();
    }

    // ---- 詳細シート ----
    function renderSheet(i) {
      const d = S.buildDetail(graph, mastery, i, { stats, weak, getQuestion: deps.getQuestion });
      if (!d) return false;
      sheetKind.textContent = d.kindLabel;
      sheetTitle.textContent = d.title;
      const correct = mastery.correct[i];
      const pct = d.answered > 0 ? Math.round((100 * correct) / d.answered) + '%' : '—';
      let html =
        '<dl class="graph-stats">' +
          `<div><dt>状態</dt><dd>${esc(d.stateLabel)}</dd></div>` +
          `<div><dt>正答率</dt><dd>${esc(pct)}</dd></div>` +
          `<div><dt>解答数</dt><dd>${esc(d.answered)}</dd></div>` +
          `<div><dt>苦手</dt><dd>${esc(d.weakCount)}</dd></div>` +
        '</dl>';
      if (d.desc) html += `<p class="graph-desc">${richText(d.desc)}</p>`;
      if (d.advice) html += `<p class="graph-advice"><span class="graph-advice-label">対策</span>${richText(d.advice)}</p>`;
      sheetPick = null;
      if (typeof deps.onStartDrill === 'function' && typeof S.pickNear === 'function') {
        const pick = S.pickNear(graph, index, i, mastery, { random: Math.random });
        if (pick.ids.length > 0) {
          sheetPick = { ids: pick.ids, label: d.title };
          html += `<button type="button" class="graph-drill-btn">近い問題を ${esc(pick.ids.length)} 問解く</button>`;
        }
      }
      const total = d.questions.length + (d.moreCount || 0);
      html += `<h3 class="graph-qs-head">問題（${esc(total)}）</h3><ul class="graph-qs">`;
      for (const q of d.questions) {
        const node = qidNode.has(q.qid) ? qidNode.get(q.qid) : -1;
        html += `<li class="graph-q graph-q-${esc(q.status)}"${node >= 0 ? ` data-node="${node}" role="button" tabindex="0"` : ''}><span class="graph-q-status">${esc(STATUS_LABEL[q.status] || q.status)}</span>` +
          `<span class="graph-q-no">#${esc(q.qid)}</span><span class="graph-q-text">${q.text == null ? '' : esc(q.text)}</span></li>`;
      }
      html += '</ul>';
      if (d.moreCount) html += `<p class="graph-more">ほか ${esc(d.moreCount)} 問</p>`;
      sheetBody.innerHTML = html;
      return true;
    }
    function setSheetWide(wide) {
      sheetWide = !!wide;
      sheet.classList.toggle('graph-sheet-wide', sheetWide);
      sheetExpand.setAttribute('aria-pressed', String(sheetWide));
      sheetExpand.textContent = sheetWide ? '縮める' : '広げる';
    }
    function openSheet(i) {
      if (!renderSheet(i)) return;
      sheetIndex = i;
      debug.lastTap = i;
      sheetBody.scrollTop = 0;
      sheet.hidden = false;
      setFocus(i);
      try { sheet.focus({ preventScroll: true }); } catch (e) { /* 古いブラウザ */ }
    }
    function closeSheet() {
      if (sheetIndex < 0 && sheet.hidden) return;
      sheetIndex = -1;
      sheetPick = null;
      sheet.hidden = true;
      setSheetWide(false);
      clearFocus();
    }

    // ---- 入力 ----
    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      stopAnim();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベントなど、捕捉できないとき */ }
      const [x, y] = localXY(e);
      pointers.set(e.pointerId, { x, y });
      if (pointers.size === 1) {
        gesture = { moved: 0, pinched: false, lastDist: 0, lastMid: null };
      } else if (pointers.size === 2 && gesture) {
        gesture.pinched = true;
        const [a, b] = [...pointers.values()];
        gesture.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
        gesture.lastMid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      }
      e.preventDefault();
    }
    function onPointerMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p || !gesture) return;
      const [x, y] = localXY(e);
      const dx = x - p.x, dy = y - p.y;
      p.x = x; p.y = y;
      if (pointers.size === 1) {
        gesture.moved += Math.hypot(dx, dy);
        if (dx || dy) setCam(S.panBy(cam, dx, dy));
      } else if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        let next = cam;
        if (gesture.lastDist > 0 && dist > 0) next = S.zoomAt(next, mid[0], mid[1], dist / gesture.lastDist, limits());
        if (gesture.lastMid) next = S.panBy(next, mid[0] - gesture.lastMid[0], mid[1] - gesture.lastMid[1]);
        gesture.lastDist = dist;
        gesture.lastMid = mid;
        setCam(next);
      }
    }
    function endPointer(e, cancelled) {
      if (!pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      if (!gesture) return;
      if (pointers.size === 1) {
        // ピンチの片方が離れた: 残りの指でパンを続ける（タップにはしない）
        gesture.lastDist = 0; gesture.lastMid = null;
        return;
      }
      if (pointers.size > 0) return;
      const g = gesture;
      gesture = null;
      if (cancelled || g.pinched || g.moved > TAP_SLOP) return;
      if (settle) return; // 動いているノードを押し間違えないよう、収まるまでタップは受け付けない
      const i = hitIndex(p.x, p.y);
      if (i >= 0 && mask && mask[i]) { openSheet(i); if (sheetIndex === i) revealAboveSheet(i); }
      else closeSheet();
    }
    function onWheel(e) {
      e.preventDefault();
      stopAnim();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= height || 800;
      dy = clamp(dy, -300, 300);
      const k = e.ctrlKey ? 0.01 : 0.0015; // ctrl + ホイール = トラックパッドのピンチ（値が小さく来る）
      const [x, y] = localXY(e);
      if (cam) zoomBy(x, y, Math.exp(-dy * k));
    }
    function onFilterClick(e) {
      const chip = e.target.closest('.graph-chip');
      if (chip && chip.dataset.book && chip.dataset.book !== book) {
        book = chip.dataset.book;
        debug.book = book;
        filterEl.querySelectorAll('.graph-chip').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
        requestDraw();
        return;
      }
      const tog = e.target.closest('.graph-weak-toggle');
      if (tog) {
        weakOnly = !weakOnly;
        debug.weakOnly = weakOnly;
        tog.setAttribute('aria-pressed', String(weakOnly));
        requestDraw();
      }
    }
    function onZoomClick(e) {
      const b = e.target.closest('button[data-zoom]');
      if (!b || !cam) return;
      stopAnim();
      if (b.dataset.zoom === 'relayout') { closeSheet(); startSettle(); return; }
      if (b.dataset.zoom === 'fit') { cam = S.createCamera(width, height, bounds); interacted = false; requestDraw(); }
      else zoomBy(width / 2, height / 2, b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6);
    }
    function onSheetClick(e) {
      if (e.target.closest('.graph-sheet-close')) { closeSheet(); return; }
      if (e.target.closest('.graph-sheet-expand')) { setSheetWide(!sheetWide); return; }
      if (e.target.closest('.graph-drill-btn')) {
        const p = sheetPick;
        if (p) deps.onStartDrill(p.ids.slice(), p.label); // 呼び出し側が画面を切り替える（この後 destroy されうる）
        return;
      }
      const li = e.target.closest('.graph-q[data-node]');
      if (li) jumpTo(Number(li.dataset.node));
    }
    function onKeyDown(e) {
      if (e.key === 'Escape' && !sheet.hidden) { e.preventDefault(); closeSheet(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && sheet.contains(e.target)) {
        const li = e.target.closest('.graph-q[data-node]');
        if (li) { e.preventDefault(); jumpTo(Number(li.dataset.node)); }
      }
    }
    function onVisibility() {
      if (document.hidden) {
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; debug.pending = false; dirty = true; }
      } else if (dirty) {
        requestDraw();
      }
    }
    function onTheme() { readColors(); requestDraw(); }

    on(canvas, 'pointerdown', onPointerDown);
    on(canvas, 'pointermove', onPointerMove);
    on(canvas, 'pointerup', e => endPointer(e, false));
    on(canvas, 'pointercancel', e => endPointer(e, true));
    on(canvas, 'wheel', onWheel, { passive: false });
    on(filterEl, 'click', onFilterClick);
    on(zoomEl, 'click', onZoomClick);
    on(sheet, 'click', onSheetClick);
    on(document, 'keydown', onKeyDown);
    on(document, 'visibilitychange', onVisibility);
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(onTheme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      track(() => mo.disconnect());
    }
    if (typeof root.matchMedia === 'function') {
      const mq = root.matchMedia('(prefers-color-scheme: dark)');
      if (mq && typeof mq.addEventListener === 'function') on(mq, 'change', onTheme);
    }
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(entries => {
        const r = entries[entries.length - 1].contentRect;
        const w = Math.round(r.width), h = Math.round(r.height);
        if (w !== width || h !== height) resize(w, h); // 初回の通知（大きさが同じ）では描き直さない
      });
      ro.observe(stage);
      track(() => ro.disconnect());
    }

    // ---- 起動 ----
    readColors();
    recompute();
    const r0 = stage.getBoundingClientRect();
    resize(Math.round(r0.width), Math.round(r0.height)); // ここで最初の 1 フレームを要求する
    startSettle(); // 苦手があれば、ビルド済みの座標から続きを回す（なければ何もしない）

    return {
      refresh() {
        if (!alive) return;
        recompute();
        if (sheetIndex >= 0 && !renderSheet(sheetIndex)) closeSheet(); // ノードが無効になったら閉じる
        requestDraw();
      },
      destroy() {
        if (!alive) return;
        alive = false;
        stopSettle();
        stopAnim();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        debug.pending = false;
        while (subs.length) subs.pop()();
        pointers.clear();
        rootEl.remove();
        grid = null; mask = null; mastery = null; colors = null; cam = null;
      },
      // テスト用
      camera: () => (cam ? { x: cam.x, y: cam.y, scale: cam.scale, fitScale } : null),
      screenOf(id) {
        const i = typeof id === 'number' ? id : graph.id.indexOf(id);
        if (!(i >= 0 && i < n) || !cam) return null;
        const r = canvas.getBoundingClientRect();
        return [r.left + xs[i] * cam.scale + cam.x, r.top + ys[i] * cam.scale + cam.y];
      },
      hitAt(cx, cy) {
        const r = canvas.getBoundingClientRect();
        return hitIndex(cx - r.left, cy - r.top);
      },
      indexOf: id => graph.id.indexOf(id),
      isVisible(i) { if (!cam) return false; ensureMask(currentLod()); return !!mask[i]; },
      isFocused(i) { return !!(focus && focus[i]); },
      focus(id, rel) {
        if (!cam) return;
        const sc = clamp(fitScale * (rel > 0 ? rel : 1), fitScale * ZOOM_MIN_REL, fitScale * ZOOM_MAX_REL);
        const i = id == null ? -1 : typeof id === 'number' ? id : graph.id.indexOf(id);
        const wx = i >= 0 ? xs[i] : (minX + maxX) / 2, wy = i >= 0 ? ys[i] : (minY + maxY) / 2;
        setCam({ x: width / 2 - wx * sc, y: height / 2 - wy * sc, scale: sc });
      },
      forceDraw() { draw(); return debug.lastFrameMs; },
      radiusOf(i) { return i >= 0 && i < n ? baseR[i] * sizeBoost[i] : 0; },
      screenRadiusOf(i) { return i >= 0 && i < n && cam ? baseR[i] * sizeBoost[i] * radiusFactor() : 0; },
      worldOf(i) { return i >= 0 && i < n ? [xs[i], ys[i]] : null; },
    };
    } catch (err) {
      alive = false;
      if (settle) { try { settle.sim.stop(); } catch (e2) { /* 無視 */ } settle = null; }
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      debug.pending = false;
      while (subs.length) subs.pop()();
      rootEl.remove();
      throw err;
    }
  }

  function mount(container, deps) {
    if (inst) destroy();
    debug.frames = 0; debug.lastTap = -1; debug.lod = 0; debug.book = 'all'; debug.weakOnly = false;
    debug.settled = true; debug.settleTicks = 0; debug.settleMs = 0; debug.settleMaxFrameMs = 0;
    debug.focusNode = -1; debug.focusCount = 0; debug.animating = false;
    inst = createInstance(container, deps);
  }
  function refresh() { if (inst) inst.refresh(); }
  function destroy() {
    if (!inst) return;
    const i = inst;
    inst = null;
    i.destroy();
  }

  debug.camera = () => (inst ? inst.camera() : null);
  debug.screenOf = id => (inst ? inst.screenOf(id) : null);
  debug.hitAt = (x, y) => (inst ? inst.hitAt(x, y) : -1);
  debug.indexOf = id => (inst ? inst.indexOf(id) : -1);
  debug.isVisible = i => (inst ? inst.isVisible(i) : false);
  debug.isFocused = i => (inst ? inst.isFocused(i) : false);
  debug.focus = (id, rel) => { if (inst) inst.focus(id, rel); };
  debug.forceDraw = () => (inst ? inst.forceDraw() : 0);
  debug.radiusOf = i => (inst ? inst.radiusOf(i) : 0);
  debug.screenRadiusOf = i => (inst ? inst.screenRadiusOf(i) : 0);
  debug.worldOf = i => (inst ? inst.worldOf(i) : null);

  root.GraphView = { mount, refresh, destroy, _debug: debug };
})(typeof self !== 'undefined' ? self : this);
