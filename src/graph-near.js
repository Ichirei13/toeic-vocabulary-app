// 文法グラフの「近さ」。起点のノードに近い問題に点数を付け、出題する問題を選ぶ。DOM にも保存にも触れない純関数。
// 近さ = 起点と共有する特徴の重みの和。特徴は、概念・ひっかけ（つながる問題が少ないほど重い。ひっかけは概念の 2 倍）、
// 同じルール、同じ章。辺を辿る索引は src/graph-filter.js の buildIndex で作ったものを受け取る。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const NEAR = {
    count: 30,                 // 出題する問題数
    poolFactor: 3,             // 候補にする上位の数 = count × これ（遠い苦手が、近い未解答を押しのけないように）
    trapBase: 2.0,             // ひっかけの重み = これ × ln(1 + 全問題数 / つながる問題数)
    conceptBase: 1.2,          // 主概念の重み   = これ × 同じ式
    secondaryConceptBase: 0.4, // 副概念の重み   = これ × 同じ式
    ruleWeight: 1.5,           // 同じルール
    chapterWeight: 0.3,        // 同じ章
  };

  const inRange = (index, i) => Number.isInteger(i) && i >= 0 && i < index.n;

  // 起点の問題ノード。問題ならその 1 問、それ以外は配下の問題すべて
  function seedQuestions(graph, index, seed) {
    if (!inRange(index, seed)) return [];
    if (graph.kind[seed] === index.kQ) return [seed];
    const out = [];
    for (let m = graph.memberStart[seed]; m < graph.memberStart[seed + 1]; m++) {
      const q = index.qNode[graph.members[m]];
      if (q >= 0) out.push(q);
    }
    return out;
  }

  // 概念・ひっかけのノードごとの重み（ほかは 0）。w は主概念・ひっかけ用、wSec は副概念用
  function hubWeights(graph, index) {
    const w = new Float64Array(index.n);
    const wSec = new Float64Array(index.n);
    const nq = Math.max(1, index.nq);
    for (let i = 0; i < index.n; i++) {
      const k = graph.kind[i];
      if (k !== index.kCon && k !== index.kTrap) continue;
      const df = graph.memberStart[i + 1] - graph.memberStart[i];
      if (df > 0) {
        const idf = Math.log(1 + nq / df);
        w[i] = (k === index.kTrap ? NEAR.trapBase : NEAR.conceptBase) * idf;
        if (k === index.kCon) wSec[i] = NEAR.secondaryConceptBase * idf;
      }
    }
    return { w, wSec };
  }

  // 問題ノードごとの点数（ノード添字で引く。問題以外は 0）
  function nearScores(graph, index, seed) {
    const scores = new Float64Array(index.n);
    const seeds = seedQuestions(graph, index, seed);
    if (seeds.length === 0) return scores;
    const { w, wSec } = hubWeights(graph, index);
    const hasSec = !!(index.secStart && index.secHubs);
    // 特徴（主概念・ひっかけ・副概念・ルール・章のノード）ごとの、起点での割合
    const p = new Float64Array(index.n);
    const pSec = hasSec ? new Float64Array(index.n) : null;
    const inc = 1 / seeds.length;
    for (const q of seeds) {
      for (let k = index.hubStart[q]; k < index.hubStart[q + 1]; k++) p[index.hubs[k]] += inc;
      if (hasSec) {
        for (let k = index.secStart[q]; k < index.secStart[q + 1]; k++) pSec[index.secHubs[k]] += inc;
      }
      if (index.ruleOf[q] !== -1) p[index.ruleOf[q]] += inc;
      if (index.chapterOf[q] !== -1) p[index.chapterOf[q]] += inc;
    }
    for (let o = 0; o < index.nq; o++) {
      const q = index.qNode[o];
      if (q < 0) continue;
      let s = 0, cnt = 0;
      for (let k = index.hubStart[q]; k < index.hubStart[q + 1]; k++) {
        const h = index.hubs[k];
        cnt++;
        s += w[h] * p[h];
        if (hasSec && pSec[h] > 0) s += wSec[h] * pSec[h];
      }
      if (hasSec) {
        for (let k = index.secStart[q]; k < index.secStart[q + 1]; k++) {
          const h = index.secHubs[k];
          cnt++;
          s += wSec[h] * (p[h] + pSec[h]);
        }
      }
      s /= Math.sqrt(Math.max(1, cnt)); // 概念・ひっかけを多く持つ問題が有利になりすぎないように
      if (index.ruleOf[q] !== -1) s += NEAR.ruleWeight * p[index.ruleOf[q]];
      if (index.chapterOf[q] !== -1) s += NEAR.chapterWeight * p[index.chapterOf[q]];
      scores[q] = s;
    }
    return scores;
  }

  // 出題する問題を選ぶ。mastery は { weak, answered }（ノード添字で引く。null 可）。
  // opts.count（既定 30）、opts.random（渡すと、起点の問題を先頭に残して残りを混ぜる）
  function pickNear(graph, index, seed, mastery, opts) {
    opts = opts || {};
    const count = opts.count > 0 ? Math.floor(opts.count) : NEAR.count;
    const scores = nearScores(graph, index, seed);
    const seeds = seedQuestions(graph, index, seed);
    if (seeds.length === 0) return { nodes: [], ids: [], scores };
    const isSeed = new Uint8Array(index.n);
    for (const q of seeds) isSeed[q] = 1;

    const cand = [];
    for (let o = 0; o < index.nq; o++) {
      const q = index.qNode[o];
      if (q >= 0 && (scores[q] > 0 || isSeed[q])) cand.push(q);
    }
    cand.sort((a, b) => (scores[b] - scores[a]) || (a - b));
    const poolSize = count * NEAR.poolFactor;
    const pool = cand.filter((q, j) => j < poolSize || isSeed[q]); // 起点の配下は必ず候補に残す

    const weak = mastery && mastery.weak, answered = mastery && mastery.answered;
    const tier = q => (weak && weak[q] > 0 ? 0 : !(answered && answered[q] > 0) ? 1 : 2); // 苦手 → 未解答 → 正解済み
    const seedQ = graph.kind[seed] === index.kQ ? seed : -1;
    pool.sort((a, b) => ((b === seedQ) - (a === seedQ)) || (tier(a) - tier(b)) || (scores[b] - scores[a]) || (a - b));
    const nodes = pool.slice(0, count);

    if (typeof opts.random === 'function') {
      const from = seedQ >= 0 && nodes[0] === seedQ ? 1 : 0;
      for (let i = nodes.length - 1; i > from; i--) {
        const j = from + Math.floor(opts.random() * (i - from + 1));
        const t = nodes[i]; nodes[i] = nodes[j]; nodes[j] = t;
      }
    }
    return { nodes, ids: nodes.map(q => graph.qid[q]), scores };
  }

  // 起点を除いて、近い順の問題ノード（点数が正のものだけ）。グラフで周辺として光らせるのに使う
  function nearestQuestions(graph, index, seed, limit) {
    const scores = nearScores(graph, index, seed);
    const out = [];
    for (let o = 0; o < index.nq; o++) {
      const q = index.qNode[o];
      if (q >= 0 && q !== seed && scores[q] > 0) out.push(q);
    }
    out.sort((a, b) => (scores[b] - scores[a]) || (a - b));
    return out.slice(0, limit > 0 ? Math.floor(limit) : 0);
  }

  return { NEAR, nearScores, pickNear, nearestQuestions };
});
