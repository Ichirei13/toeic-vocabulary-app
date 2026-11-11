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
