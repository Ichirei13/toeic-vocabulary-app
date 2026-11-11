// 文法グラフの配置の力（d3-force）。ビルド（tools/lib/layout.mjs、Node）とアプリ（js/graph-view.js、ブラウザ）の両方が使う。
// d3-force の関数は引数 d3 で受け取る（forceSimulation / forceLink / forceManyBody / forceCollide / forceX / forceY / forceCenter）。
// DOM にも保存にも触れない純関数。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  // ビルド時の調整値（data/grammar_graph.js の座標はこの値で作る。変えると生成物が変わる）。
  // 座標系: 原点が中央、x は右、y は下。単位は任意（描画側で拡大縮小する）。
  const GRAPH_LAYOUT = {
    seed: 20261108,
    ticks: 400,            // 固定の tick 数（収束を待たない。同じ入力から同じ出力にするため）
    // リンクの強さ（forceLink）。親子は強く、概念・Trap は弱く
    parentStrength: 0.9,
    conceptStrength: 0.02,
    trapStrength: 0.02,
    // 反発（forceManyBody）の強さ（負の値）。種類ごと
    charge: { book: -600, chapter: -260, rule: -34, concept: -700, trap: -700, question: -7 },
    chargeDistanceMax: 500,
    // 衝突半径（forceCollide）。種類ごと
    collideRadius: { book: 30, chapter: 20, rule: 7, concept: 30, trap: 28, question: 3.4 },
    collideStrength: 0.9,
    // 本ごとの塊の中心。概念・Trap は原点（本の間）に引き寄せる
    anchors: { kin: [-480, -280], sekai: [480, -280], polaris2: [-480, 320], toplevel: [480, 320] },
    anchorStrength: 0.13,  // 本の配下のノードを本の中心へ引く強さ
    hubStrength: 0.10,     // 概念・Trap を原点へ引く強さ
    startRadius: 150,      // 初期位置のばらつき（本の中心のまわり）
    hubStartRadius: 60,    // 概念・Trap の初期位置のばらつき（原点のまわり）
  };
  // リンクの目標距離。2026-11-11 まで種類ごとの設定（parentDistance・linkDistance）があったが、d3-force は
  // リンクの端をノードのオブジェクトに置き換えてから距離の関数を呼ぶため、その設定は一度も効いておらず、
  // 常にこの値で計算されていた。座標を変えないため、効いていた値をそのまま定数にしている。
  const PARENT_DISTANCE = 30;
  const HUB_DISTANCE = 200;

  // 実行時（記録あり）にだけ足す調整値。苦手・復習期限の問題を、概念・Trap のまわりに集める。
  const GRAPH_RUNTIME = {
    ticks: 120,                // ビルド済みの座標から続きを回す回数
    alpha: 0.3,                // 始めの勢い（ビルドは 1 から。続きなので小さく始める）
    weakParentFactor: 0.25,    // 苦手の問題: 親（章・ルール）への結びつきに掛ける
    weakAnchorFactor: 0.2,     // 苦手の問題: 本の中心へ引く強さに掛ける
    weakConceptStrength: 0.5,  // 苦手の問題 → 概念
    weakTrapStrength: 0.8,     // 苦手の問題 → Trap（概念より強く）
    weakLinkDistance: 46,      // 苦手の問題と概念・Trap の目標距離
    hubCollidePerWeak: 3,      // 概念・Trap の衝突半径に足す値 = これ × √(配下の苦手の数)
  };
  const ORIGIN = [0, 0];

  // 32bit の種から [0,1) の乱数列を作る（mulberry32）。
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 各ノードの本（親エッジをたどる）。概念・Trap は本を持たない（'' = 本の間のハブ）。
  // edges は [始点, 終点, 種類(0 親子 / 1 概念 / 2 Trap), …] の平らな配列。
  function bookOfNodes(ids, kindName, edges) {
    const n = ids.length;
    const parent = new Int32Array(n).fill(-1);
    for (let k = 0; k + 2 < edges.length; k += 3) if (edges[k + 2] === 0) parent[edges[k + 1]] = edges[k];
    const out = new Array(n).fill('');
    for (let i = 0; i < n; i++) {
      if (kindName[i] === 'concept' || kindName[i] === 'trap') continue;
      let j = i;
      while (parent[j] !== -1) j = parent[j];
      const id = String(ids[j]);
      out[i] = id.startsWith('book:') ? id.slice(5) : '';
    }
    return out;
  }

  // シミュレーションを組み立てて返す（止めた状態）。呼び出し側が sim.tick() を ticks 回呼ぶ。
  //   input: { kindName, edges, bookOf, x, y, weakQ?, hubWeak? }
  //     weakQ[i]   = 1 なら、ノード i は苦手・復習期限の問題
  //     hubWeak[i] = 概念・Trap のノード i の配下にある苦手の数
  //   runtime: null ならビルド時の力（weakQ・hubWeak は見ない）。GRAPH_RUNTIME を渡すと実行時の力。
  // 力の登録順・乱数の使い方はビルドの出力に効くので、順番を変えないこと。
  function createSimulation(d3, input, config, runtime) {
    config = config || GRAPH_LAYOUT;
    const kindName = input.kindName, edges = input.edges, bookOf = input.bookOf;
    const n = kindName.length;
    const weakQ = runtime && input.weakQ ? input.weakQ : null;
    const hubWeak = runtime && input.hubWeak ? input.hubWeak : null;
    const isWeak = i => !!(weakQ && weakQ[i]);

    const nodes = new Array(n);
    for (let i = 0; i < n; i++) nodes[i] = { index: i, x: +input.x[i], y: +input.y[i] };
    const anchorOf = i => (bookOf[i] ? (config.anchors[bookOf[i]] || ORIGIN) : ORIGIN);

    // q = そのリンクの問題側（親子は子）。d3-force が source / target をオブジェクトに置き換えるので、添字で持っておく
    const links = [];
    for (let k = 0; k + 2 < edges.length; k += 3) {
      const t = edges[k + 2];
      links.push({ source: edges[k], target: edges[k + 1], type: t, q: t === 0 ? edges[k + 1] : edges[k] });
    }
    const linkForce = d3.forceLink(links)
      .id(d => d.index)
      .strength(l => {
        const w = isWeak(l.q);
        if (l.type === 0) return w ? config.parentStrength * runtime.weakParentFactor : config.parentStrength;
        if (l.type === 1) return w ? runtime.weakConceptStrength : config.conceptStrength;
        return w ? runtime.weakTrapStrength : config.trapStrength;
      })
      .distance(l => (l.type === 0 ? PARENT_DISTANCE : isWeak(l.q) ? runtime.weakLinkDistance : HUB_DISTANCE));

    const pull = d => {
      const i = d.index;
      if (!bookOf[i]) return config.hubStrength;
      return isWeak(i) ? config.anchorStrength * runtime.weakAnchorFactor : config.anchorStrength;
    };
    const pullX = d3.forceX(d => anchorOf(d.index)[0]).strength(pull);
    const pullY = d3.forceY(d => anchorOf(d.index)[1]).strength(pull);
    const collide = d => {
      const i = d.index, k = kindName[i];
      const base = config.collideRadius[k];
      if (hubWeak && (k === 'concept' || k === 'trap') && hubWeak[i] > 0) return base + runtime.hubCollidePerWeak * Math.sqrt(hubWeak[i]);
      return base;
    };

    const ticks = runtime ? runtime.ticks : config.ticks;
    const sim = d3.forceSimulation(nodes)
      .randomSource(mulberry32(config.seed + 1))
      .stop()
      .alphaMin(0.001);
    if (runtime) sim.alpha(runtime.alpha).alphaDecay(1 - Math.pow(0.001 / runtime.alpha, 1 / ticks));
    else sim.alphaDecay(1 - Math.pow(0.001, 1 / ticks));
    sim
      .force('link', linkForce)
      .force('charge', d3.forceManyBody().strength(d => config.charge[kindName[d.index]]).distanceMax(config.chargeDistanceMax))
      .force('x', pullX)
      .force('y', pullY)
      .force('collide', d3.forceCollide(collide).strength(config.collideStrength).iterations(2))
      .force('center', d3.forceCenter(0, 0));
    return { sim, nodes, ticks };
  }

  return { GRAPH_LAYOUT, GRAPH_RUNTIME, mulberry32, bookOfNodes, createSimulation };
});
