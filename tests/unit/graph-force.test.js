const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GF = require('../../src/graph-force.js');
const { makeFixture } = require('./helpers/graph-fixture.js');

const D3_DIR = path.resolve(__dirname, '..', '..', 'tools', 'node_modules', 'd3-force');
const HAS_D3 = fs.existsSync(path.join(D3_DIR, 'package.json'));
const d3test = (name, fn) => (HAS_D3 ? test(name, fn) : test(name, { skip: 'tools/node_modules/d3-force がありません（cd tools && npm ci）' }, fn));
const loadD3 = () => import(path.join(D3_DIR, 'src', 'index.js'));

function inputOf(g, extra = {}) {
  const kindName = g.kind.map(k => g.kinds[k]);
  return { kindName, edges: g.edges, bookOf: GF.bookOfNodes(g.id, kindName, g.edges), x: g.x, y: g.y, ...extra };
}
function run(d3, g, runtime, extra) {
  const { sim, nodes, ticks } = GF.createSimulation(d3, inputOf(g, extra), GF.GRAPH_LAYOUT, runtime);
  for (let t = 0; t < ticks; t++) sim.tick();
  return nodes.map(nd => [nd.x, nd.y]);
}
const dist = (p, a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);

test('mulberry32: 同じ種から同じ列、[0,1) に収まる', () => {
  const a = GF.mulberry32(7), b = GF.mulberry32(7);
  for (let i = 0; i < 20; i++) { const v = a(); assert.strictEqual(v, b()); assert.ok(v >= 0 && v < 1); }
});

test('bookOfNodes: 親をたどった本。概念・Trap は空文字', () => {
  const g = makeFixture();
  const bookOf = GF.bookOfNodes(g.id, g.kind.map(k => g.kinds[k]), g.edges);
  assert.strictEqual(bookOf[3], 'kin');
  assert.strictEqual(bookOf[11], 'sekai');
  assert.strictEqual(bookOf[0], 'kin');
  assert.strictEqual(bookOf[12], '');
  assert.strictEqual(bookOf[15], '');
});

test('定数: 使われていなかった種類ごとの距離の設定は持たない', () => {
  assert.strictEqual(GF.GRAPH_LAYOUT.parentDistance, undefined);
  assert.strictEqual(GF.GRAPH_LAYOUT.linkDistance, undefined);
  assert.ok(GF.GRAPH_RUNTIME.ticks > 0 && GF.GRAPH_RUNTIME.alpha > 0);
});

d3test('ビルド時: ticks は config.ticks、同じ入力から同じ座標', async () => {
  const d3 = await loadD3();
  const g = makeFixture();
  const made = GF.createSimulation(d3, inputOf(g), GF.GRAPH_LAYOUT, null);
  assert.strictEqual(made.ticks, GF.GRAPH_LAYOUT.ticks);
  assert.deepStrictEqual(run(d3, g, null), run(d3, makeFixture(), null));
});

d3test('実行時: 同じ記録・同じ座標から同じ配置。座標はすべて有限', async () => {
  const d3 = await loadD3();
  const weakQ = new Uint8Array(16); weakQ[11] = 1;
  const hubWeak = new Int32Array(16); hubWeak[14] = 1; hubWeak[15] = 1;
  const a = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ, hubWeak });
  const b = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ, hubWeak });
  assert.deepStrictEqual(a, b);
  for (const [x, y] of a) assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

d3test('実行時: 苦手の問題は、苦手でないときより概念・ひっかけに近づく', async () => {
  const d3 = await loadD3();
  const none = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ: new Uint8Array(16), hubWeak: new Int32Array(16) });
  const weakQ = new Uint8Array(16); weakQ[11] = 1; // q:6（con:c と trap:t につながる）
  const hubWeak = new Int32Array(16); hubWeak[14] = 1; hubWeak[15] = 1;
  const weak = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ, hubWeak });
  assert.ok(dist(weak, 11, 15) < dist(none, 11, 15), 'ひっかけに近づいていない');
  assert.ok(dist(weak, 11, 14) < dist(none, 11, 14), '概念に近づいていない');
});

d3test('実行時: weakQ・hubWeak を渡さなくても落ちない（苦手なしと同じ扱い）', async () => {
  const d3 = await loadD3();
  const p = run(d3, makeFixture(), GF.GRAPH_RUNTIME);
  assert.strictEqual(p.length, 16);
});

test('文法軸: 定数（GRAMMAR_CONCEPT_ORDER は 13 概念、GRAPH_GRAMMAR は半径・tick 数を持つ）', () => {
  assert.strictEqual(GF.GRAMMAR_CONCEPT_ORDER.length, 13);
  assert.strictEqual(new Set(GF.GRAMMAR_CONCEPT_ORDER).size, 13);
  assert.strictEqual(GF.GRAMMAR_CONCEPT_ORDER[0], 'con:SVOC（文の骨格）');
  assert.strictEqual(GF.GRAPH_GRAMMAR.ringRadius > 0, true);
  assert.strictEqual(GF.GRAPH_GRAMMAR.ticks, 120);
  assert.ok(GF.GRAPH_GRAMMAR.alpha > 0);
});

test('文法軸: grammarInitialPositions は概念を円周上に均等配置し、同じ入力から同じ座標を返す', () => {
  const g = makeFixture();
  const kindName = g.kind.map(k => g.kinds[k]);
  const a = GF.grammarInitialPositions({ ids: g.id, kindName, edges: g.edges });
  const b = GF.grammarInitialPositions({ ids: g.id, kindName, edges: g.edges });
  assert.deepStrictEqual(a, b);
  const R = GF.GRAPH_GRAMMAR.ringRadius;
  // 概念 3 つ（12, 13, 14）は 12 時（-π/2）から時計回りに 120° 間隔
  const cons = [12, 13, 14];
  cons.forEach((ci, k) => {
    const th = -Math.PI / 2 + (2 * Math.PI * k) / 3;
    assert.ok(Math.abs(a.x[ci] - R * Math.cos(th)) < 1e-6, `x[${ci}]`);
    assert.ok(Math.abs(a.y[ci] - R * Math.sin(th)) < 1e-6, `y[${ci}]`);
    assert.strictEqual(a.pinned[ci], 1);
  });
  for (let i = 0; i < g.id.length; i++) {
    assert.ok(Number.isFinite(a.x[i]) && Number.isFinite(a.y[i]), `有限: ${i}`);
    if (kindName[i] !== 'concept') assert.strictEqual(a.pinned[i], 0);
  }
  // 2 概念につながる q:5(10) は con:a(12) と con:c(14) の中点付近（円の内側寄り）
  const midX = (a.x[12] + a.x[14]) / 2, midY = (a.y[12] + a.y[14]) / 2;
  assert.ok(Math.hypot(a.x[10] - midX, a.y[10] - midY) < 80, '複数概念の中点付近にない');
  // 戻り値に primaryConcept があり、既知の本はリング外の四隅に初期配置される
  assert.ok(a.primaryConcept && a.primaryConcept.length === g.id.length, 'primaryConcept がない');
  assert.strictEqual(a.primaryConcept[1], 12, 'ch:kin:1 の最多概念は con:a');
  const bc = GF.GRAPH_GRAMMAR.bookCorner;
  assert.ok(bc > 0 && GF.GRAPH_GRAMMAR.bookCorners, 'bookCorners の設定がない');
  const kinD = Math.hypot(a.x[0], a.y[0]), sekaiD = Math.hypot(a.x[8], a.y[8]);
  assert.ok(kinD > R && a.x[0] < 0 && a.y[0] < 0, `book:kin が左上リング外でない: (${a.x[0]}, ${a.y[0]})`);
  assert.ok(sekaiD > R && a.x[8] > 0 && a.y[8] < 0, `book:sekai が右上リング外でない: (${a.x[8]}, ${a.y[8]})`);
});

test('文法軸: grammarInitialPositions は GRAMMAR_CONCEPT_ORDER の順を優先し、未知の概念は末尾に足す', () => {
  const ids = ['con:未知', 'con:関係代名詞・関係副詞', 'con:SVOC（文の骨格）'];
  const kindName = ['concept', 'concept', 'concept'];
  const pos = GF.grammarInitialPositions({ ids, kindName, edges: [] });
  const R = GF.GRAPH_GRAMMAR.ringRadius;
  // SVOC が 0 番（12 時: x≈0, y≈-R）、関係代名詞が 1 番（4 時: x>0, y>0）、未知が 2 番（8 時: x<0, y>0）
  assert.ok(Math.abs(pos.x[2]) < 1e-6 && Math.abs(pos.y[2] + R) < 1e-6, 'SVOC が 12 時');
  assert.ok(pos.x[1] > 0 && pos.y[1] > 0, '関係詞が 4 時');
  assert.ok(pos.x[0] < 0 && pos.y[0] > 0, '未知概念が 8 時');
});

d3test('文法軸: createGrammarSimulation は収束後も概念を円周上に固定し、同じ入力から同じ配置になる', async () => {
  const d3 = await loadD3();
  const g = makeFixture();
  const kindName = g.kind.map(k => g.kinds[k]);
  const runG = (extra = {}) => {
    const made = GF.createGrammarSimulation(d3, { ids: g.id, kindName, edges: g.edges, ...extra }, GF.GRAPH_GRAMMAR);
    for (let t = 0; t < made.ticks; t++) made.sim.tick();
    return made.nodes.map(nd => [nd.x, nd.y]);
  };
  const a = runG();
  const b = runG();
  assert.deepStrictEqual(a, b);
  const init = GF.grammarInitialPositions({ ids: g.id, kindName, edges: g.edges });
  for (const ci of [12, 13, 14]) {
    assert.ok(Math.abs(a[ci][0] - init.x[ci]) < 1e-6, `概念 ${ci} の x が動いた`);
    assert.ok(Math.abs(a[ci][1] - init.y[ci]) < 1e-6, `概念 ${ci} の y が動いた`);
  }
  for (const [x, y] of a) assert.ok(Number.isFinite(x) && Number.isFinite(y));
  // 単一概念 q:1(3) は con:a(12) に、他の概念 con:b(13) より圧倒的に近い
  assert.ok(dist(a, 3, 12) < dist(a, 3, 13));
  // 苦手にした q:6(11) は、非苦手時より trap:t(15) と con:c(14) に近づく
  const weakQ = new Uint8Array(16); weakQ[11] = 1;
  const hubWeak = new Int32Array(16); hubWeak[14] = 1; hubWeak[15] = 1;
  const w = runG({ weakQ, hubWeak });
  assert.ok(dist(w, 11, 15) < dist(a, 11, 15), '苦手問題が Trap に近づいていない');
  assert.ok(dist(w, 11, 14) < dist(a, 11, 14), '苦手問題が概念に近づいていない');
});

d3test('文法軸: 実データで概念はリングに固定され、本はリング外の四隅、章は最多概念の近くへ集まる', async () => {
  const d3 = await loadD3();
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'data', 'grammar_graph.js'), 'utf8');
  const g = vm.runInNewContext(src + ';GRAMMAR_GRAPH');
  const n = g.id.length;
  const kindName = g.kind.map(k => g.kinds[k]);
  const E = g.edges;
  const made = GF.createGrammarSimulation(d3, { ids: g.id, kindName, edges: E }, GF.GRAPH_GRAMMAR);
  for (let t = 0; t < made.ticks; t++) made.sim.tick();
  const P = made.nodes.map(nd => [nd.x, nd.y]);
  const R = GF.GRAPH_GRAMMAR.ringRadius;

  const cons = [];
  for (let i = 0; i < n; i++) if (kindName[i] === 'concept') cons.push(i);
  assert.strictEqual(cons.length, 13);
  for (const ci of cons) {
    assert.ok(Math.abs(Math.hypot(P[ci][0], P[ci][1]) - R) < 1e-6, `概念 ${g.id[ci]} がリングから動いた`);
  }

  const parent = new Int32Array(n).fill(-1);
  const qCons = Array.from({ length: n }, () => []);
  for (let k = 0; k + 2 < E.length; k += 3) {
    if (E[k + 2] === 0) parent[E[k + 1]] = E[k];
    else if (E[k + 2] === 1) qCons[E[k]].push(E[k + 1]);
  }
  const nearest = i => cons.reduce((b, c) => (dist(P, i, c) < dist(P, i, b) ? c : b), cons[0]);

  let qOk = 0, qN = 0, s1 = 0, s1n = 0;
  for (let i = 0; i < n; i++) {
    if (kindName[i] !== 'question' || !qCons[i].length) continue;
    qN++;
    if (qCons[i].includes(nearest(i))) qOk++;
    if (qCons[i].length === 1) {
      s1n++;
      if (qCons[i][0] === nearest(i)) s1++;
    }
  }
  assert.strictEqual(s1n, 468);
  assert.strictEqual(s1, 468, `単一概念の問題: ${s1}/${s1n}`);
  assert.ok(qOk / qN >= 0.88, `問題全体の最寄り概念一致率: ${qOk}/${qN}`);

  let top1 = 0, top2 = 0, chN = 0;
  for (let i = 0; i < n; i++) {
    if (kindName[i] !== 'chapter') continue;
    const cnt = new Map();
    for (let q = 0; q < n; q++) {
      if (kindName[q] !== 'question') continue;
      let p = parent[q], guard = 0;
      while (p !== -1 && p !== i && guard++ < 8) p = parent[p];
      if (p === i) for (const c of qCons[q]) cnt.set(c, (cnt.get(c) || 0) + 1);
    }
    const rank = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
    const nc = nearest(i);
    const ncCount = cnt.get(nc) || 0;
    const top1Count = rank[0][1];
    const top2Count = rank[Math.min(1, rank.length - 1)][1];
    chN++;
    if (ncCount === top1Count) top1++;
    if (ncCount >= top2Count) top2++;
  }
  assert.strictEqual(chN, 51);
  assert.ok(top1 >= 48, `章の最多概念一致数: ${top1}/${chN}`);
  assert.strictEqual(top2, 51, `章の上位2概念一致数: ${top2}/${chN}`);

  const kin6 = g.id.indexOf('ch:kin:6');
  const relCon = g.id.indexOf('con:関係代名詞・関係副詞');
  assert.strictEqual(nearest(kin6), relCon, `ch:kin:6 の最寄り概念が関係詞でない: ${g.id[nearest(kin6)]}`);

  const expectCorner = {
    'book:kin': [-1, -1],
    'book:sekai': [1, -1],
    'book:polaris2': [-1, 1],
    'book:toplevel': [1, 1],
  };
  let bookCount = 0;
  for (let i = 0; i < n; i++) {
    if (kindName[i] !== 'book') continue;
    bookCount++;
    const r = Math.hypot(P[i][0], P[i][1]);
    assert.ok(r > R, `${g.id[i]} がリング外でない: r=${r}`);
    const c = expectCorner[g.id[i]];
    assert.ok(P[i][0] * c[0] > 0 && P[i][1] * c[1] > 0, `${g.id[i]} の四隅向きが合わない: (${P[i][0]}, ${P[i][1]})`);
  }
  assert.strictEqual(bookCount, 4);
});

test('文法軸: grammarLayoutSignature は決定論的で、データ・設定・苦手集合の違いを検知する', () => {
  const g = makeFixture();
  const kindName = g.kind.map(k => g.kinds[k]);
  const zero = new Uint8Array(g.id.length);
  const s0 = GF.grammarLayoutSignature(g, null, GF.GRAPH_GRAMMAR);
  const sZero = GF.grammarLayoutSignature({ ids: g.id, kindName, edges: g.edges }, zero, GF.GRAPH_GRAMMAR);
  assert.strictEqual(typeof s0, 'string');
  assert.ok(s0.length > 0);
  assert.strictEqual(s0, sZero, 'graph 形式と input 形式、および null と全ゼロ weakQ は同じ署名');

  const w1 = new Uint8Array(g.id.length); w1[3] = 1;
  const w2 = new Uint8Array(g.id.length); w2[4] = 1;
  const s1 = GF.grammarLayoutSignature(g, w1, GF.GRAPH_GRAMMAR);
  const s2 = GF.grammarLayoutSignature(g, w2, GF.GRAPH_GRAMMAR);
  assert.notStrictEqual(s1, s0, '苦手 1 問で署名が変わる');
  assert.notStrictEqual(s1, s2, '別の問題が苦手なら署名が変わる');

  const sCfg = GF.grammarLayoutSignature(g, w1, { ...GF.GRAPH_GRAMMAR, ticks: GF.GRAPH_GRAMMAR.ticks + 1 });
  assert.notStrictEqual(sCfg, s1, '設定変更で署名が変わる');
  const sLen = GF.grammarLayoutSignature({ id: g.id, edges: g.edges.slice(0, -3) }, w1, GF.GRAPH_GRAMMAR);
  assert.notStrictEqual(sLen, s1, 'エッジ変更で署名が変わる');

  // 件数が同じでも中身が変われば署名が変わる（グラフを作り直して概念タグを付け替えたとき、古い座標を出さない）
  const conceptIdx = g.kind.map((k, i) => (g.kinds[k] === 'concept' ? i : -1)).filter(i => i >= 0);
  assert.ok(conceptIdx.length >= 2, 'フィクスチャに概念が 2 つ以上ある');
  const retarget = g.edges.slice();
  let moved = false;
  for (let k = 0; k + 2 < retarget.length; k += 3) {
    if (retarget[k + 2] !== 1) continue;
    retarget[k + 1] = conceptIdx.find(c => c !== retarget[k + 1]);
    moved = true;
    break;
  }
  assert.ok(moved, 'フィクスチャに概念リンクがある');
  const sRetarget = GF.grammarLayoutSignature({ id: g.id, edges: retarget }, w1, GF.GRAPH_GRAMMAR);
  assert.notStrictEqual(sRetarget, s1, '件数が同じでも、概念リンクの行き先が変われば署名が変わる');
  const renamed = g.id.slice();
  renamed[0] = renamed[0] + ':renamed';
  const sRenamed = GF.grammarLayoutSignature({ id: renamed, edges: g.edges }, w1, GF.GRAPH_GRAMMAR);
  assert.notStrictEqual(sRenamed, s1, '件数が同じでも、ノードの id が変われば署名が変わる');
  assert.ok(s1.startsWith('g2:'), '中身を含める形式に変えたので版は g2');
});
