const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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
  assert.ok(GF.GRAPH_GRAMMAR.ringRadius > 0);
  assert.ok(GF.GRAPH_GRAMMAR.ticks > 0 && GF.GRAPH_GRAMMAR.alpha > 0);
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
