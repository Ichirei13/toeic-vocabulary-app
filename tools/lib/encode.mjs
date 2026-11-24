// モデル + 座標 → data/grammar_graph.js の JS ソース（列ごとの配列）。
// members: 各ノード配下の問題の序数（qids の添字）。本・章・ルール・概念・Trap が対象で、問題ノード自身は自分の序数だけを持つ（理解度の集計を全ノード同じ経路で行うため）。

export function encodeGraph(model, xs, ys) {
  const n = model.id.length;
  if (xs.length !== n || ys.length !== n) throw new Error(`座標の長さがノード数と違います: ${xs.length}/${ys.length} vs ${n}`);
  const round = (v, name, i) => {
    if (!Number.isFinite(v)) throw new Error(`${name}[${i}] が数値ではありません`);
    return Math.round(v);
  };
  const x = xs.map((v, i) => round(v, 'x', i));
  const y = ys.map((v, i) => round(v, 'y', i));

  const qk = model.kinds.indexOf('question');
  const qids = [];
  const ordinal = new Map(); // ノード添字 → 問題の序数
  for (let i = 0; i < n; i++) if (model.kind[i] === qk) { ordinal.set(i, qids.length); qids.push(model.qid[i]); }

  // 配下の問題 = 親エッジの子孫 + 主概念(1)/Trap(2) エッジの逆向き（副概念(3)は members に含めない）。重複なし・昇順
  const children = Array.from({ length: n }, () => []);
  const linked = Array.from({ length: n }, () => []);
  for (const [a, b, t] of model.edges) {
    if (t === 0) children[a].push(b);
    else if (t === 1 || t === 2) linked[b].push(a);
  }
  const memo = new Map();
  const questionsUnder = i => {
    if (ordinal.has(i)) return [ordinal.get(i)]; // 問題ノード: 自分だけ（概念・Trap のエッジは辿らない）
    if (memo.has(i)) return memo.get(i);
    const set = new Set();
    for (const c of children[i]) {
      if (ordinal.has(c)) set.add(ordinal.get(c));
      else for (const o of questionsUnder(c)) set.add(o);
    }
    for (const q of linked[i]) if (ordinal.has(q)) set.add(ordinal.get(q));
    const out = [...set].sort((p, q) => p - q);
    memo.set(i, out);
    return out;
  };
  const memberStart = [0];
  const members = [];
  for (let i = 0; i < n; i++) {
    for (const o of questionsUnder(i)) members.push(o);
    memberStart.push(members.length);
  }

  const solveTypes = [];
  const solveTypeIdx = new Map();
  const qSolveType = [];
  const qPoint = [];
  const qMeta = model.qMeta instanceof Map ? model.qMeta : new Map();
  for (const qid of qids) {
    const meta = qMeta.get(qid);
    const st = meta && typeof meta.solveType === 'string' ? meta.solveType : '';
    if (st) {
      if (!solveTypeIdx.has(st)) { solveTypeIdx.set(st, solveTypes.length); solveTypes.push(st); }
      qSolveType.push(solveTypeIdx.get(st));
    } else {
      qSolveType.push(-1);
    }
    qPoint.push(meta && typeof meta.point === 'string' ? meta.point : '');
  }

  const graph = {
    version: 4,
    kinds: model.kinds,
    id: model.id,
    kind: model.kind,
    label: model.label,
    x, y,
    qid: model.qid,
    edges: model.edges.flat(),
    text: model.text,
    qids,
    memberStart,
    members,
    solveTypes,
    qSolveType,
    qPoint,
  };
  return 'const GRAMMAR_GRAPH = ' + JSON.stringify(graph) + ';\n';
}
