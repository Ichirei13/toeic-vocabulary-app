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

  // 文法軸モード: 13 概念を 12 時から時計回りに並べる既定の順序（学習の流れ＋共起の多い概念同士が隣り合う順）。
  // 一覧にない概念が将来増えても、末尾に添字順で追加して等分する。
  const GRAMMAR_CONCEPT_ORDER = [
    'con:SVOC（文の骨格）',
    'con:能動態と受動態',
    'con:分詞（現在分詞・過去分詞）',
    'con:動詞の時制と相',
    'con:助動詞・仮定法',
    'con:動名詞 vs 不定詞',
    'con:名詞の役割（主語・目的語・補語）',
    'con:代名詞の格と用法',
    'con:形容詞と副詞の修飾関係',
    'con:関係代名詞・関係副詞',
    'con:比較級・最上級',
    'con:接続詞 vs 前置詞の識別',
    'con:倒置・強調・並列構造',
  ];

  // 文法軸モードの配置の調整値（実行時のみ。data/grammar_graph.js には影響しない）。
  const GRAPH_GRAMMAR = {
    seed: 20261119,
    ringRadius: 600,
    ticks: 140,
    alpha: 0.7,
    singleOutward: 70,         // 概念が 1 つだけの問題の初期位置を、円の外側へずらす距離
    jitter: 40,                // 初期位置のばらつき
    centerPull: 0.01,          // 非固定ノードを原点へごく弱く引く強さ（孤立ノードの発散防止）
    bookCorners: { kin: [-1, -1], sekai: [1, -1], polaris2: [-1, 1], toplevel: [1, 1] },
    bookCorner: 0.95,          // 本ノードを寄せる四隅の位置（ringRadius に対する縦横の倍率）
    bookPull: 0.25,            // 本ノードを四隅へ引く強さ
    chapterPull: 0.55,         // 章ノードを最多概念へ引く強さ
    rulePull: 0.15,            // ルールノードを最多概念へ引く強さ
    chapterRadiusFactor: 0.86, // 章・ルールの目標位置（最多概念の座標に対する比＝少し内側）
    conceptStrength: 0.45,
    conceptDistance: 65,
    weakConceptStrength: 0.7,
    parentStrength: 0.25,
    parentDistance: 32,
    weakParentFactor: 0.4,
    bookChapterStrength: 0.01,
    bookChapterDistance: 180,
    trapStrength: 0.15,
    trapDistance: 70,
    weakTrapStrength: 0.8,
    weakLinkDistance: 44,
    charge: { book: -320, chapter: -140, rule: -28, concept: -420, trap: -260, question: -6 },
    chargeDistanceMax: 420,
    collideRadius: GRAPH_LAYOUT.collideRadius,
    collideStrength: 0.9,
    hubCollidePerWeak: GRAPH_RUNTIME.hubCollidePerWeak,
  };

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

  // 既知の本（book:kin 等）ならリング外の四隅座標を返し、それ以外は null を返す。
  function grammarBookCorner(id, config) {
    if (id == null || !config.bookCorners) return null;
    const s = String(id);
    if (!s.startsWith('book:')) return null;
    const c = config.bookCorners[s.slice(5)];
    return c ? [c[0] * config.ringRadius * config.bookCorner, c[1] * config.ringRadius * config.bookCorner] : null;
  }

  // 文法軸モードの初期位置（d3-force の出発点兼、d3 未ロード・計算失敗時のフォールバック）。
  // 概念ノードを半径 ringRadius の円周上に均等配置し、既知の本はリング外の四隅、章・ルールは配下で最多の概念の近く、
  // 問題は紐づく概念の重心、ひっかけは関連問題の平均位置に置く。
  function grammarInitialPositions(input, config) {
    config = config || GRAPH_GRAMMAR;
    const ids = input.ids || [], kindName = input.kindName, edges = input.edges || [];
    const n = kindName.length;
    const x = new Float64Array(n), y = new Float64Array(n);
    const pinned = new Uint8Array(n);
    const primaryConcept = new Int32Array(n).fill(-1);
    const order = new Map();
    for (let k = 0; k < GRAMMAR_CONCEPT_ORDER.length; k++) order.set(GRAMMAR_CONCEPT_ORDER[k], k);

    const concepts = [];
    for (let i = 0; i < n; i++) if (kindName[i] === 'concept') concepts.push(i);
    concepts.sort((a, b) => {
      const oa = order.has(String(ids[a])) ? order.get(String(ids[a])) : GRAMMAR_CONCEPT_ORDER.length;
      const ob = order.has(String(ids[b])) ? order.get(String(ids[b])) : GRAMMAR_CONCEPT_ORDER.length;
      return (oa - ob) || (a - b);
    });
    const m = concepts.length, R = config.ringRadius;
    for (let k = 0; k < m; k++) {
      const ci = concepts[k];
      const th = -Math.PI / 2 + (2 * Math.PI * k) / m;
      x[ci] = R * Math.cos(th);
      y[ci] = R * Math.sin(th);
      pinned[ci] = 1;
    }

    const parent = new Int32Array(n).fill(-1);
    const qSumX = new Float64Array(n), qSumY = new Float64Array(n), qCnt = new Int32Array(n);
    const conTotal = new Int32Array(n);
    for (let k = 0; k + 2 < edges.length; k += 3) {
      const a = edges[k], b = edges[k + 1], t = edges[k + 2];
      if (t === 0) parent[b] = a;
      else if (t === 1 && pinned[b]) { qSumX[a] += x[b]; qSumY[a] += y[b]; qCnt[a]++; conTotal[b]++; }
    }

    // 章・ルールごとに配下の問題が最も多く紐づく概念を 1 つ選ぶ（同数なら総問題数が少ない限定的な概念を優先）
    const groupCounts = new Map();
    for (let k = 0; k + 2 < edges.length; k += 3) {
      if (edges[k + 2] !== 1) continue;
      const q = edges[k], c = edges[k + 1];
      if (!pinned[c]) continue;
      let p = parent[q], guard = 0;
      while (p !== -1 && guard++ < 8) {
        if (kindName[p] === 'chapter' || kindName[p] === 'rule') {
          let cnt = groupCounts.get(p);
          if (!cnt) groupCounts.set(p, cnt = new Map());
          cnt.set(c, (cnt.get(c) || 0) + 1);
        }
        p = parent[p];
      }
    }
    for (const [i, cnt] of groupCounts) {
      let best = -1, bestCount = -1;
      for (const [c, v] of cnt) {
        if (v > bestCount || (v === bestCount && (conTotal[c] < conTotal[best] || (conTotal[c] === conTotal[best] && c < best)))) {
          best = c;
          bestCount = v;
        }
      }
      primaryConcept[i] = best;
    }

    const rand = mulberry32(config.seed);
    const addJitter = (scale) => {
      const r = scale * Math.sqrt(rand());
      const th = rand() * 2 * Math.PI;
      return [r * Math.cos(th), r * Math.sin(th)];
    };

    for (let i = 0; i < n; i++) {
      if (kindName[i] !== 'question') continue;
      let px = 0, py = 0;
      if (qCnt[i] > 0) {
        px = qSumX[i] / qCnt[i];
        py = qSumY[i] / qCnt[i];
        if (qCnt[i] === 1) {
          const len = Math.hypot(px, py);
          if (len > 0) { px += (px / len) * config.singleOutward; py += (py / len) * config.singleOutward; }
        }
      }
      const [jx, jy] = addJitter(config.jitter);
      x[i] = px + jx; y[i] = py + jy;
    }

    const gSumX = new Float64Array(n), gSumY = new Float64Array(n), gCnt = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      if (kindName[i] !== 'question') continue;
      let p = parent[i], guard = 0;
      while (p !== -1 && guard++ < 8) {
        gSumX[p] += x[i]; gSumY[p] += y[i]; gCnt[p]++;
        p = parent[p];
      }
    }
    for (let k = 0; k + 2 < edges.length; k += 3) {
      if (edges[k + 2] === 2) {
        const q = edges[k], tr = edges[k + 1];
        gSumX[tr] += x[q]; gSumY[tr] += y[q]; gCnt[tr]++;
      }
    }
    for (let i = 0; i < n; i++) {
      if (pinned[i] || kindName[i] === 'question') continue;
      const corner = kindName[i] === 'book' ? grammarBookCorner(ids[i], config) : null;
      if (corner) {
        x[i] = corner[0]; y[i] = corner[1];
        continue;
      }
      const pc = (kindName[i] === 'chapter' || kindName[i] === 'rule') ? primaryConcept[i] : -1;
      if (pc !== -1) {
        const [jx, jy] = addJitter(config.jitter * 0.4);
        x[i] = x[pc] * config.chapterRadiusFactor + jx;
        y[i] = y[pc] * config.chapterRadiusFactor + jy;
        continue;
      }
      const px = gCnt[i] > 0 ? gSumX[i] / gCnt[i] : 0;
      const py = gCnt[i] > 0 ? gSumY[i] / gCnt[i] : 0;
      const [jx, jy] = addJitter(config.jitter * 0.6);
      x[i] = px + jx; y[i] = py + jy;
    }
    return { x, y, pinned, primaryConcept };
  }

  // 文法軸モードの力学シミュレーションを組み立てて返す（止めた状態）。
  // 概念ノードは fx / fy で円周上に固定し、それ以外のノードはリンクと反発・衝突で自然に配置する。
  function createGrammarSimulation(d3, input, config) {
    config = config || GRAPH_GRAMMAR;
    const ids = input.ids || [], kindName = input.kindName, edges = input.edges || [];
    const n = kindName.length;
    const weakQ = input.weakQ || null;
    const hubWeak = input.hubWeak || null;
    const isWeak = i => !!(weakQ && weakQ[i]);

    const init = grammarInitialPositions(input, config);
    const primaryConcept = init.primaryConcept;
    const nodes = new Array(n);
    const targetX = new Float64Array(n), targetY = new Float64Array(n), pullStrength = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const nd = { index: i, x: init.x[i], y: init.y[i] };
      if (init.pinned[i]) {
        nd.fx = init.x[i]; nd.fy = init.y[i];
      } else {
        const corner = kindName[i] === 'book' ? grammarBookCorner(ids[i], config) : null;
        if (corner) {
          targetX[i] = corner[0]; targetY[i] = corner[1]; pullStrength[i] = config.bookPull;
        } else if ((kindName[i] === 'chapter' || kindName[i] === 'rule') && primaryConcept[i] !== -1) {
          const pc = primaryConcept[i];
          targetX[i] = init.x[pc] * config.chapterRadiusFactor;
          targetY[i] = init.y[pc] * config.chapterRadiusFactor;
          pullStrength[i] = kindName[i] === 'chapter' ? config.chapterPull : config.rulePull;
        } else {
          pullStrength[i] = config.centerPull;
        }
      }
      nodes[i] = nd;
    }

    const links = [];
    for (let k = 0; k + 2 < edges.length; k += 3) {
      const a = edges[k], b = edges[k + 1], t = edges[k + 2];
      links.push({
        source: a, target: b, type: t,
        q: t === 0 ? b : a,
        isBookCh: t === 0 && kindName[a] === 'book',
      });
    }
    const linkForce = d3.forceLink(links)
      .id(d => d.index)
      .strength(l => {
        const w = isWeak(l.q);
        if (l.type === 1) return w ? config.weakConceptStrength : config.conceptStrength;
        if (l.type === 2) return w ? config.weakTrapStrength : config.trapStrength;
        if (l.isBookCh) return config.bookChapterStrength;
        return w ? config.parentStrength * config.weakParentFactor : config.parentStrength;
      })
      .distance(l => {
        const w = isWeak(l.q);
        if (l.type === 1) return w ? config.weakLinkDistance : config.conceptDistance;
        if (l.type === 2) return w ? config.weakLinkDistance : config.trapDistance;
        if (l.isBookCh) return config.bookChapterDistance;
        return config.parentDistance;
      });

    const collide = d => {
      const i = d.index, k = kindName[i];
      const base = config.collideRadius[k];
      if (hubWeak && (k === 'concept' || k === 'trap') && hubWeak[i] > 0) return base + config.hubCollidePerWeak * Math.sqrt(hubWeak[i]);
      return base;
    };

    const ticks = config.ticks;
    const sim = d3.forceSimulation(nodes)
      .randomSource(mulberry32(config.seed + 1))
      .stop()
      .alphaMin(0.001)
      .alpha(config.alpha)
      .alphaDecay(1 - Math.pow(0.001 / config.alpha, 1 / ticks));
    sim
      .force('link', linkForce)
      .force('charge', d3.forceManyBody().strength(d => config.charge[kindName[d.index]]).distanceMax(config.chargeDistanceMax))
      .force('x', d3.forceX(d => targetX[d.index]).strength(d => pullStrength[d.index]))
      .force('y', d3.forceY(d => targetY[d.index]).strength(d => pullStrength[d.index]))
      .force('collide', d3.forceCollide(collide).strength(config.collideStrength).iterations(2));
    return { sim, nodes, ticks, init };
  }

  return {
    GRAPH_LAYOUT, GRAPH_RUNTIME, GRAMMAR_CONCEPT_ORDER, GRAPH_GRAMMAR,
    mulberry32, bookOfNodes, createSimulation, grammarInitialPositions, createGrammarSimulation,
  };
});
