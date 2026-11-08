// 文法グラフの画面（Canvas 2D）。window.GraphView を 1 つだけ公開し、アプリの state などのグローバルには触れない。
// 必要なものは mount(container, deps) の deps で受け取る:
//   deps = { graph, getStats: ()=>object, getWeak: ()=>object, getQuestion: (qid)=>object|undefined, isDue: (entry)=>boolean }
// 計算は src/ の純関数（StudyCore.computeMastery / visibleMask / lodForScale / createCamera / zoomAt / panBy /
// visibleIndices / buildGrid / hitTest / buildDetail）に任せ、ここは DOM・入力・描画だけを持つ。
//
// 軽さの約束（設計書 §2）:
//   - タイマーなし・常時ループなし。入力・絞り込み・refresh・リサイズ・テーマ変更で「汚れた」ときだけ
//     requestAnimationFrame を 1 回要求する（保留中は 1 つまで）。document.hidden のあいだは要求しない。
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
  };
  const FALLBACK = {
    bg: '#f6f7f9', edge: 'rgba(60,60,67,0.2)', conceptEdge: 'rgba(88,86,214,0.5)', trapEdge: '#e8890c', trapLine: 'rgba(232,137,12,0.5)',
    label: '#1c1c1e', halo: '#f6f7f9', ring: '#3a3a3c', dueRing: '#9f1d22',
    states: ['#b8bec7', '#e5484d', '#e5484d', '#7cc4f0', '#f2c94c', '#34c759'],
  };
  const STATUS_LABEL = { weak: '苦手', wrong: '誤答あり', unseen: '未解答', correct: '正解' };

  // テスト用の観測値。frames はマウントごとに 0 から数える。listeners は今登録中のリスナー・オブザーバーの数
  const debug = {
    frames: 0, listeners: 0, pending: false, lastFrameMs: 0, lastDrawnNodes: 0, lastDrawnEdges: 0, lastLabels: 0,
    drawnKinds: [0, 0, 0, 0, 0, 0], lod: 0, book: 'all', weakOnly: false, lastTap: -1,
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
    if (!S || typeof S.computeMastery !== 'function' || typeof S.createCamera !== 'function' || typeof S.buildDetail !== 'function') {
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
    const bounds = { minX, maxX, minY, maxY };
    const kConcept = kinds.indexOf('concept'), kTrap = kinds.indexOf('trap');
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
    let backdropArmed = false; // 開いた後に覆いで pointerdown があったか
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
        '<div class="graph-zoom" role="group" aria-label="拡大と縮小">' +
          '<button type="button" data-zoom="in" aria-label="拡大">＋</button>' +
          '<button type="button" data-zoom="out" aria-label="縮小">－</button>' +
          '<button type="button" data-zoom="fit" aria-label="全体を表示">全体</button>' +
        '</div>' +
      '</div>' +
      '<div class="graph-sheet-backdrop" hidden></div>' +
      '<section class="graph-sheet" role="dialog" aria-modal="true" aria-labelledby="graph-sheet-title" tabindex="-1" hidden>' +
        '<header class="graph-sheet-head">' +
          '<div class="graph-sheet-titles"><span class="graph-sheet-kind"></span><h2 class="graph-sheet-title" id="graph-sheet-title"></h2></div>' +
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
    const backdrop = rootEl.querySelector('.graph-sheet-backdrop');
    const sheet = rootEl.querySelector('.graph-sheet');
    const sheetKind = sheet.querySelector('.graph-sheet-kind');
    const sheetTitle = sheet.querySelector('.graph-sheet-title');
    const sheetBody = sheet.querySelector('.graph-sheet-body');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('GraphView: canvas 2D コンテキストを取得できない');

    // ---- 色（マウント時とテーマ変更時だけ読む） ----
    function readColors() {
      const cs = getComputedStyle(rootEl);
      const get = (name, fb) => { const v = cs.getPropertyValue(name).trim(); return v || fb; };
      const c = { states: STATE_VARS.map((v, k) => get(v, FALLBACK.states[k])) };
      for (const key in COLOR_VARS) c[key] = get(COLOR_VARS[key], FALLBACK[key]);
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
      if (!alive || document.hidden) return; // dirty は残し、見えるようになったら描く
      draw();
    }

    // ---- 理解度と絞り込み ----
    function recompute() {
      stats = safeObj(deps.getStats);
      weak = safeObj(deps.getWeak);
      mastery = S.computeMastery(graph, stats, weak, deps.isDue);
      masteryVer++;
    }
    function ensureMask(lod) {
      const key = lod + '|' + book + '|' + (weakOnly ? 1 : 0) + '|' + masteryVer;
      if (key === maskKey) return;
      maskKey = key;
      mask = S.visibleMask(graph, mastery, { book, weakOnly, lod });
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
      const maxHitPx = Math.max(HIT_MIN_PX, BASE_R.book * R_FACTOR_MAX);
      const cell = clamp((2 * maxHitPx) / (fitScale * ZOOM_MIN_REL), 8, 400);
      grid = S.buildGrid(xs, ys, cell);
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
        sxs[i] = xs[i] * s + ox; sys[i] = ys[i] * s + oy; rs[i] = baseR[i] * rf;
        kc[graph.kind[i]]++;
      }

      // エッジ: 両端が絞り込みを通り（mask）、かつ少なくとも一端が画面内（余白つき）のときだけ描く。
      // 両端とも画面外で画面を横切るだけの長いエッジは描かない（間引きの規則。visibleIndices はノードだけを見るため）。
      // 種類ごとに 1 つの path にまとめ、1 回だけ stroke する。
      let edgeCount = 0;
      const edgeStyle = [
        [colors.edge, 1, null],
        [colors.conceptEdge, 1, [1.5, 3]],
        [colors.trapLine, 1.2, [5, 4]],
      ];
      for (let t = 0; t < 3; t++) {
        const list = edgesByType[t];
        ctx.beginPath();
        let any = false;
        for (let k = 0; k < list.length; k += 2) {
          const a = list[k], b = list[k + 1];
          if (!mask[a] || !mask[b] || !(inView[a] || inView[b])) continue;
          ctx.moveTo(xs[a] * s + ox, ys[a] * s + oy);
          ctx.lineTo(xs[b] * s + ox, ys[b] * s + oy);
          any = true;
          edgeCount++;
        }
        if (!any) continue;
        ctx.strokeStyle = edgeStyle[t][0];
        ctx.lineWidth = edgeStyle[t][1];
        ctx.setLineDash(edgeStyle[t][2] || []);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // ノード: 状態（色）ごとに 1 つの path で塗る。縁は背景色で細く描いて重なりを分ける
      const st = mastery.state;
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.bg;
      for (let c = 0; c < 6; c++) {
        ctx.beginPath();
        let any = false;
        for (let j = 0; j < m; j++) {
          const i = drawList[j];
          if (st[i] !== c) continue;
          ctx.moveTo(sxs[i] + rs[i], sys[i]);
          ctx.arc(sxs[i], sys[i], rs[i], 0, Math.PI * 2);
          any = true;
        }
        if (!any) continue;
        ctx.fillStyle = colors.states[c];
        ctx.fill();
        ctx.stroke();
      }
      // 種類の印: 概念 = 二重リング（外側にもう 1 本）、Trap = 破線のリング、要復習 = 赤い外枠
      ringPath(m, i => graph.kind[i] === kConcept, 2.5);
      ctx.strokeStyle = colors.ring; ctx.lineWidth = 1.3; ctx.stroke();
      ringPath(m, i => graph.kind[i] === kTrap, 2.5);
      ctx.strokeStyle = colors.trapEdge; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2.5]); ctx.stroke();
      ctx.setLineDash([]);
      ringPath(m, i => st[i] === 1, 1.6, i => graph.kind[i] === kConcept || graph.kind[i] === kTrap ? 5 : 0);
      ctx.strokeStyle = colors.dueRing; ctx.lineWidth = 1.8; ctx.stroke();

      const labels = drawLabels();

      debug.lastDrawnNodes = m;
      debug.lastDrawnEdges = edgeCount;
      debug.lastLabels = labels;
      debug.lod = lod;
      debug.lastFrameMs = performance.now() - t0;
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
    function drawLabels() {
      let count = 0;
      let curFont = '';
      for (let j = 0; j < n && count < MAX_LABELS; j++) {
        const i = labelOrder[j];
        if (!mask[i] || !inView[i]) continue;
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
      }
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

    // ---- 当たり判定 ----
    // 半径 = max(14 CSS px, いま描いている最大のノード半径) をワールド単位にしたもの。中心がいちばん近いノードを選ぶ。
    function hitIndex(lx, ly) {
      if (!cam || !grid) return -1;
      ensureMask(currentLod());
      const [wx, wy] = S.screenToWorld(cam, lx, ly);
      const maxR = BASE_R.book * radiusFactor();
      const r = Math.max(HIT_MIN_PX, maxR) / cam.scale;
      return S.hitTest(grid, hitXs, ys, wx, wy, r, hitOrder);
    }
    function localXY(e) {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
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
      const total = d.questions.length + (d.moreCount || 0);
      html += `<h3 class="graph-qs-head">問題（${esc(total)}）</h3><ul class="graph-qs">`;
      for (const q of d.questions) {
        html += `<li class="graph-q graph-q-${esc(q.status)}"><span class="graph-q-status">${esc(STATUS_LABEL[q.status] || q.status)}</span>` +
          `<span class="graph-q-no">#${esc(q.qid)}</span><span class="graph-q-text">${q.text == null ? '' : esc(q.text)}</span></li>`;
      }
      html += '</ul>';
      if (d.moreCount) html += `<p class="graph-more">ほか ${esc(d.moreCount)} 問</p>`;
      sheetBody.innerHTML = html;
      return true;
    }
    function openSheet(i) {
      if (!renderSheet(i)) return;
      sheetIndex = i;
      debug.lastTap = i;
      sheetBody.scrollTop = 0;
      backdropArmed = false;
      backdrop.hidden = false;
      sheet.hidden = false;
      try { sheet.focus({ preventScroll: true }); } catch (e) { /* 古いブラウザ */ }
    }
    function closeSheet() {
      if (sheetIndex < 0 && sheet.hidden) return;
      sheetIndex = -1;
      sheet.hidden = true;
      backdrop.hidden = true;
    }

    // ---- 入力 ----
    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
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
      const i = hitIndex(p.x, p.y);
      if (i >= 0 && mask && mask[i]) openSheet(i);
      else closeSheet();
    }
    function onWheel(e) {
      e.preventDefault();
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
      if (b.dataset.zoom === 'fit') { cam = S.createCamera(width, height, bounds); interacted = false; requestDraw(); }
      else zoomBy(width / 2, height / 2, b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6);
    }
    function onSheetClick(e) { if (e.target.closest('.graph-sheet-close')) closeSheet(); }
    function onKeyDown(e) {
      if (e.key === 'Escape' && !sheet.hidden) { e.preventDefault(); closeSheet(); }
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
    // 覆いは「開いた後に覆いの上で押された」ときだけ閉じる。シートを開いたタップの後に iOS が送る互換の click
    // （覆いの上に届くことがある）では閉じない。タイマーを使わずに済む。
    on(backdrop, 'pointerdown', () => { backdropArmed = true; });
    on(backdrop, 'click', () => { const armed = backdropArmed; backdropArmed = false; if (armed) closeSheet(); });
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
      focus(id, rel) {
        if (!cam) return;
        const sc = clamp(fitScale * (rel > 0 ? rel : 1), fitScale * ZOOM_MIN_REL, fitScale * ZOOM_MAX_REL);
        const i = id == null ? -1 : typeof id === 'number' ? id : graph.id.indexOf(id);
        const wx = i >= 0 ? xs[i] : (minX + maxX) / 2, wy = i >= 0 ? ys[i] : (minY + maxY) / 2;
        setCam({ x: width / 2 - wx * sc, y: height / 2 - wy * sc, scale: sc });
      },
      forceDraw() { draw(); return debug.lastFrameMs; },
    };
    } catch (err) {
      alive = false;
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
  debug.focus = (id, rel) => { if (inst) inst.focus(id, rel); };
  debug.forceDraw = () => (inst ? inst.forceDraw() : 0);

  root.GraphView = { mount, refresh, destroy, _debug: debug };
})(typeof self !== 'undefined' ? self : this);
