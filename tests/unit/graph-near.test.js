const test = require('node:test');
const assert = require('node:assert');
const F = require('../../src/graph-filter.js');
const N = require('../../src/graph-near.js');
const { makeFixture, makeMastery } = require('./helpers/graph-fixture.js');

const setup = () => { const g = makeFixture(); return { g, ix: F.buildIndex(g) }; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const LN4 = Math.log(4); // ln(1 + 6 / 2)。問題 2 問につながる概念の重み

test('nearScores: 起点が問題。同じひっかけだけの問題が、同じ概念と同じ章を持つ問題より上', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 11); // q:6（con:c・trap:t、ch:sekai:1）
  assert.ok(near(s[4], 2 * LN4), `q:2（ひっかけだけ）= ${s[4]}`);
  assert.ok(near(s[10], LN4 / Math.SQRT2 + 0.3), `q:5（概念 + 章）= ${s[10]}`);
  assert.ok(near(s[11], (LN4 + 2 * LN4) / Math.SQRT2 + 0.3), `q:6（自分）= ${s[11]}`);
  assert.ok(s[4] > s[10]);
  assert.strictEqual(s[3], 0);
  assert.strictEqual(s[6], 0);
  assert.strictEqual(s[14], 0, '問題ノード以外は 0');
});

test('nearScores: 同じルールと同じ章は、概念・ひっかけを共有しなくても点が付く', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 4); // q:2（trap:t、rule:kin:1:1、ch:kin:1）
  assert.ok(near(s[3], 1.5 + 0.3), `q:1（同じルール・章）= ${s[3]}`);
  assert.ok(s[11] > s[3], '同じひっかけの q:6 が、同じルールだけの q:1 より上');
});

test('nearScores: 起点が概念。配下の問題の特徴の割合で点が付く', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 14); // con:c（q:5・q:6）
  assert.ok(near(s[11], (LN4 + 2 * LN4 * 0.5) / Math.SQRT2 + 0.3));
  assert.ok(near(s[10], (LN4 * 0.5 + LN4) / Math.SQRT2 + 0.3));
  assert.ok(near(s[4], 2 * LN4 * 0.5));
  assert.ok(near(s[3], LN4 * 0.5));
  assert.strictEqual(s[6], 0);
});

test('nearScores: 概念もひっかけもない問題が起点でも落ちない（同じ章の問題に点が付く）', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 7); // q:4（つながりなし、ch:kin:2）
  assert.ok(near(s[6], 0.3));
  assert.ok(near(s[7], 0.3));
  assert.strictEqual(s[3], 0);
});

test('nearScores: 範囲外の起点は全部 0', () => {
  const { g, ix } = setup();
  assert.ok([...N.nearScores(g, ix, -1)].every(v => v === 0));
  assert.ok([...N.nearScores(g, ix, 999)].every(v => v === 0));
});

test('pickNear: 起点の問題が先頭。記録がなければ近い順', () => {
  const { g, ix } = setup();
  const r = N.pickNear(g, ix, 11, null);
  assert.deepStrictEqual(r.nodes, [11, 4, 10]);
  assert.deepStrictEqual(r.ids, [6, 2, 5]);
});

test('pickNear: 苦手 → 未解答 → 正解済みの順で埋める', () => {
  const { g, ix } = setup();
  // 起点 con:c。近い順は q:6(11) > q:5(10) > q:2(4) > q:1(3)
  const m = makeMastery(g, { 3: 1 }, { 3: 1, 10: 2 }); // q:1 が苦手、q:5 は正解済み、ほかは未解答
  const r = N.pickNear(g, ix, 14, m);
  assert.deepStrictEqual(r.nodes, [3, 11, 4, 10]);
  assert.deepStrictEqual(r.ids, [1, 6, 2, 5]);
  assert.deepStrictEqual(N.pickNear(g, ix, 14, m, { count: 2 }).nodes, [3, 11]);
});

test('pickNear: 遠い苦手は、近い未解答を押しのけない（候補は上位 count×3 と、起点の配下）', () => {
  const { g, ix } = setup();
  const m = makeMastery(g, { 3: 1 }, { 3: 1, 10: 2 });
  // count 1 → 上位 3 問（q:6・q:5・q:2）。苦手の q:1 は 4 番目なので候補に入らない
  assert.deepStrictEqual(N.pickNear(g, ix, 14, m, { count: 1 }).nodes, [11]);
});

test('pickNear: 起点の配下の問題は、上位に入らなくても候補に残る', () => {
  const { g, ix } = setup();
  // 起点 book:kin（q:1〜q:4）。count 1 → 上位 3 問だが、配下 4 問はすべて候補。苦手の q:4 が選ばれる
  const m = makeMastery(g, { 7: 1 }, { 7: 1 });
  assert.deepStrictEqual(N.pickNear(g, ix, 0, m, { count: 1 }).nodes, [7]);
});

test('pickNear: 候補が足りなければ、ある分だけ返す。範囲外の起点は空', () => {
  const { g, ix } = setup();
  assert.strictEqual(N.pickNear(g, ix, 11, null, { count: 30 }).ids.length, 3);
  assert.deepStrictEqual(N.pickNear(g, ix, -1, null).ids, []);
});

test('pickNear: random を渡すと、起点の問題を先頭に残して残りを混ぜる。同じ乱数なら同じ並び', () => {
  const { g, ix } = setup();
  const seq = () => { let k = 0; const v = [0.9, 0.1, 0.5, 0.3]; return () => v[k++ % v.length]; };
  const a = N.pickNear(g, ix, 11, null, { random: seq() });
  const b = N.pickNear(g, ix, 11, null, { random: seq() });
  assert.deepStrictEqual(a.nodes, b.nodes);
  assert.strictEqual(a.nodes[0], 11);
  assert.deepStrictEqual([...a.nodes].sort((x, y) => x - y), [4, 10, 11]);
});

test('nearestQuestions: 起点を除いて近い順。上限つき', () => {
  const { g, ix } = setup();
  assert.deepStrictEqual(N.nearestQuestions(g, ix, 11, 30), [4, 10]);
  assert.deepStrictEqual(N.nearestQuestions(g, ix, 11, 1), [4]);
  assert.deepStrictEqual(N.nearestQuestions(g, ix, 999, 30), []);
});

test('本物のグラフ: どの種類のノードを起点にしても落ちず、30 問以内で id は重複しない', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'data', 'grammar_graph.js'), 'utf8');
  const g = vm.runInNewContext(src + '; GRAMMAR_GRAPH');
  const ix = F.buildIndex(g);
  const seen = new Set();
  for (let i = 0; i < g.id.length; i++) {
    const k = g.kinds[g.kind[i]];
    if (seen.has(k) && i % 97 !== 0) continue; // 種類ごとの最初の 1 つと、97 個おき
    seen.add(k);
    const r = N.pickNear(g, ix, i, null);
    assert.ok(r.ids.length >= 1 && r.ids.length <= 30, `${g.id[i]}: ${r.ids.length} 問`);
    assert.strictEqual(new Set(r.ids).size, r.ids.length, `${g.id[i]}: id が重複`);
    assert.ok(r.ids.every(id => g.qids.includes(id)), `${g.id[i]}: グラフにない id`);
  }
  assert.strictEqual(seen.size, 6);
});
