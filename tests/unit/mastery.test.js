const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../../src/mastery.js');

// 手書きの小さなグラフを作る。nodes = [{ id, members: [qid, ...] }]（members は問題 id）。
// qids は出現順に序数を振る（実データと同じく、1 つの問題が複数ノードに属してよい）。
function makeGraph(nodes) {
  const qids = [];
  const ord = new Map();
  const memberStart = [0];
  const members = [];
  for (const n of nodes) {
    for (const q of n.members) {
      if (!ord.has(q)) { ord.set(q, qids.length); qids.push(q); }
      members.push(ord.get(q));
    }
    memberStart.push(members.length);
  }
  return { id: nodes.map(n => n.id), qids, memberStart, members };
}

const NEVER_DUE = () => false;
const S = M.MASTERY_STATES;
const stateOf = (m, i) => S[m.state[i]];

// 1 ノード（問題 1 つ）に a/c を与えて、その状態を返す
function single(stats, weak = {}, isDue = NEVER_DUE) {
  const g = makeGraph([{ id: 'q1', members: [1] }]);
  const m = M.computeMastery(g, stats, weak, isDue);
  return { m, state: stateOf(m, 0) };
}

test('MASTERY_STATES と MASTERY_THRESHOLDS を公開する', () => {
  assert.deepStrictEqual(M.MASTERY_STATES, ['unseen', 'due', 'weak', 'few', 'mid', 'good']);
  assert.deepStrictEqual(M.MASTERY_THRESHOLDS, { minAnswers: 3, weakBelow: 0.6, goodFrom: 0.8 });
});

test('rate は (c+1)/(a+2)', () => {
  const { m } = single({ 1: { a: 8, c: 5 } });
  assert.strictEqual(m.rate[0], Math.fround(6 / 10));
  const { m: m2 } = single({ 1: { a: 3, c: 3 } });
  assert.strictEqual(m2.rate[0], Math.fround(4 / 5));
  assert.strictEqual(m2.answered[0], 3);
  assert.strictEqual(m2.correct[0], 3);
  assert.strictEqual(m2.total[0], 1);
});

test('境界: 解答数 0 は unseen、rate は (0+1)/(0+2)=0.5', () => {
  const { m, state } = single({});
  assert.strictEqual(state, 'unseen');
  assert.strictEqual(m.rate[0], 0.5);
});

test('境界: 解答数 2 は few（正解率が低くても）', () => {
  assert.strictEqual(single({ 1: { a: 2, c: 0 } }).state, 'few');
  assert.strictEqual(single({ 1: { a: 2, c: 2 } }).state, 'few');
});

test('境界: 解答数 3 以上で rate < 0.6 は weak（苦手に未登録でも）', () => {
  // a=3,c=1 -> 2/5 = 0.4
  assert.strictEqual(single({ 1: { a: 3, c: 1 } }).state, 'weak');
  // a=8,c=4 -> 5/10 = 0.5
  assert.strictEqual(single({ 1: { a: 8, c: 4 } }).state, 'weak');
});

test('境界: rate がちょうど 0.6 は weak ではなく mid', () => {
  // a=3,c=2 -> 3/5 = 0.6
  const { m, state } = single({ 1: { a: 3, c: 2 } });
  assert.strictEqual(m.rate[0], Math.fround(0.6));
  assert.strictEqual(state, 'mid');
});

test('境界: rate がちょうど 0.8 は good（苦手でなければ）', () => {
  // a=3,c=3 -> 4/5 = 0.8
  const { m, state } = single({ 1: { a: 3, c: 3 } });
  assert.strictEqual(m.rate[0], Math.fround(0.8));
  assert.strictEqual(state, 'good');
  // 0.8 未満は mid（a=8,c=6 -> 7/10 = 0.7）
  assert.strictEqual(single({ 1: { a: 8, c: 6 } }).state, 'mid');
});

test('優先: rate が高くても苦手に登録されていれば good にならない（weak）', () => {
  assert.strictEqual(single({ 1: { a: 10, c: 10 } }, { 1: {} }).state, 'weak');
});

test('優先: due と weak が両方あるとき due', () => {
  const { m, state } = single({ 1: { a: 5, c: 1 } }, { 1: { t: 0 } }, () => true);
  assert.strictEqual(state, 'due');
  assert.strictEqual(m.weak[0], 1);
  assert.strictEqual(m.due[0], 1);
});

test('優先: 苦手登録があり解答数 2 のとき weak（few より先）', () => {
  assert.strictEqual(single({ 1: { a: 2, c: 2 } }, { 1: {} }).state, 'weak');
});

test('優先: 苦手に登録されていても解答数 0 なら unseen（unseen が最優先）', () => {
  const { m, state } = single({}, { 1: {} });
  assert.strictEqual(state, 'unseen');
  assert.strictEqual(m.weak[0], 1); // 件数としては数える
  const { state: s2 } = single({}, { 1: {} }, () => true);
  assert.strictEqual(s2, 'unseen');
});

test('isDue には苦手エントリが渡され、苦手でない問題には呼ばれない', () => {
  const seen = [];
  const entry = { id: 'e' };
  const g = makeGraph([{ id: 'n', members: [1, 2] }]);
  M.computeMastery(g, { 1: { a: 1, c: 1 }, 2: { a: 1, c: 1 } }, { 1: entry }, e => { seen.push(e); return false; });
  assert.deepStrictEqual(seen, [entry]);
});

test('集計: a/c は配下の問題の合計、weak/due は問題数', () => {
  const g = makeGraph([{ id: 'n', members: [1, 2, 3] }]);
  const stats = { 1: { a: 2, c: 1 }, 2: { a: 4, c: 4 }, 3: { a: 1, c: 0 } };
  const weak = { 1: { due: true }, 3: { due: false } };
  const m = M.computeMastery(g, stats, weak, e => e.due);
  assert.strictEqual(m.total[0], 3);
  assert.strictEqual(m.answered[0], 7);
  assert.strictEqual(m.correct[0], 5);
  assert.strictEqual(m.weak[0], 2);
  assert.strictEqual(m.due[0], 1);
  assert.strictEqual(m.rate[0], Math.fround(6 / 9));
  assert.strictEqual(stateOf(m, 0), 'due');
});

test('集計: 本をまたぐ 2 問をもつ概念は各問を 1 回ずつ数える（二重カウントなし）', () => {
  // 問題 1 は本 A、問題 2 は本 B。概念は両方を束ねる。章 A1 と概念の両方に 1 が属する。
  const g = makeGraph([
    { id: 'book:A', members: [1] },
    { id: 'book:B', members: [2] },
    { id: 'ch:A:1', members: [1] },
    { id: 'con:x', members: [1, 2] },
  ]);
  const m = M.computeMastery(g, { 1: { a: 4, c: 3 }, 2: { a: 2, c: 1 } }, { 1: {}, 2: {} }, NEVER_DUE);
  assert.deepStrictEqual(Array.from(m.total), [1, 1, 1, 2]);
  assert.deepStrictEqual(Array.from(m.answered), [4, 2, 4, 6]);
  assert.deepStrictEqual(Array.from(m.correct), [3, 1, 3, 4]);
  assert.deepStrictEqual(Array.from(m.weak), [1, 1, 1, 2]);
});

test('集計: members に同じ序数が重複していても 1 回だけ数える', () => {
  const g = { id: ['n'], qids: [1], memberStart: [0, 3], members: [0, 0, 0] };
  const m = M.computeMastery(g, { 1: { a: 2, c: 1 } }, { 1: {} }, NEVER_DUE);
  assert.strictEqual(m.total[0], 1);
  assert.strictEqual(m.answered[0], 2);
  assert.strictEqual(m.weak[0], 1);
});

test('Review Focus 1: 概念エッジのない問題だけの本でも計算できる', () => {
  const g = makeGraph([
    { id: 'book:solo', members: [10, 11] },
    { id: 'ch:solo:1', members: [10, 11] },
    { id: 'q:10', members: [10] },
    { id: 'q:11', members: [11] },
  ]);
  const m = M.computeMastery(g, { 10: { a: 3, c: 3 } }, {}, NEVER_DUE);
  assert.deepStrictEqual(S.length, 6);
  assert.deepStrictEqual(Array.from(m.state, v => S[v]), ['good', 'good', 'good', 'unseen']);
  assert.deepStrictEqual(Array.from(m.total), [2, 2, 1, 1]);
});

test('Review Focus 2: グラフにない qid・不正なキー・不正な値でも例外にならず集計に入らない', () => {
  const g = makeGraph([{ id: 'n', members: [1, 2] }]);
  const stats = {
    1: { a: 2, c: 2 },
    999: { a: 5, c: 5 },       // グラフにない
    abc: { a: 5, c: 5 },       // 数字でないキー
    '01': { a: 5, c: 5 },      // 正規でない整数キー
    '-1': { a: 5, c: 5 },
    '1.0': { a: 5, c: 5 },
    2: { a: 0, c: 0 },         // a<1 は無視
  };
  Object.defineProperty(stats, '__proto__', { value: { a: 9, c: 9 }, enumerable: true });
  const weak = { 999: {}, abc: {}, '01': {} };
  Object.defineProperty(weak, '__proto__', { value: {}, enumerable: true });
  const m = M.computeMastery(g, stats, weak, () => true);
  assert.strictEqual(m.answered[0], 2);
  assert.strictEqual(m.correct[0], 2);
  assert.strictEqual(m.weak[0], 0);
  assert.strictEqual(m.due[0], 0);
  assert.strictEqual(m.total[0], 2);
});

test('Review Focus 2: c>a は a に丸め、c<0 は 0 に丸める', () => {
  const g = makeGraph([{ id: 'n1', members: [1] }, { id: 'n2', members: [2] }]);
  const m = M.computeMastery(g, { 1: { a: 3, c: 10 }, 2: { a: 3, c: -4 } }, {}, NEVER_DUE);
  assert.deepStrictEqual(Array.from(m.correct), [3, 0]);
  assert.deepStrictEqual(Array.from(m.state, v => S[v]), ['good', 'weak']);
});

test('Review Focus 2: a が数でない・1 未満・NaN・Infinity の記録は無視し、NaN を出さない', () => {
  const g = makeGraph([{ id: 'n', members: [1, 2, 3, 4, 5, 6] }]);
  const stats = {
    1: { a: 'x', c: 1 },
    2: { a: NaN, c: 1 },
    3: { a: Infinity, c: 1 },
    4: { a: 0.5, c: 0 },
    5: null,
    6: { a: 2, c: NaN },       // c が NaN は 0 扱い
  };
  const m = M.computeMastery(g, stats, {}, NEVER_DUE);
  assert.strictEqual(m.answered[0], 2);
  assert.strictEqual(m.correct[0], 0);
  assert.ok(Number.isFinite(m.rate[0]));
});

test('Review Focus 2: stats・weak が {} / null / undefined なら全ノード unseen で NaN なし', () => {
  const g = makeGraph([
    { id: 'a', members: [1, 2] }, { id: 'b', members: [2] }, { id: 'c', members: [] },
  ]);
  for (const [s, w] of [[{}, {}], [null, null], [undefined, undefined]]) {
    const m = M.computeMastery(g, s, w, NEVER_DUE);
    assert.deepStrictEqual(Array.from(m.state, v => S[v]), ['unseen', 'unseen', 'unseen']);
    for (const r of m.rate) assert.strictEqual(r, 0.5);
    assert.strictEqual(m.rate.length, 3);
  }
});

test('isDue が未指定・例外を投げても computeMastery は例外にならない', () => {
  const g = makeGraph([{ id: 'n', members: [1] }]);
  const stats = { 1: { a: 3, c: 3 } };
  assert.doesNotThrow(() => M.computeMastery(g, stats, { 1: {} }, undefined));
  const m = M.computeMastery(g, stats, { 1: null }, () => { throw new Error('boom'); });
  assert.strictEqual(m.due[0], 0);
  assert.strictEqual(m.weak[0], 1);
});

test('戻り値の型と長さ', () => {
  const g = makeGraph([{ id: 'a', members: [1] }, { id: 'b', members: [] }]);
  const m = M.computeMastery(g, {}, {}, NEVER_DUE);
  assert.ok(m.total instanceof Int32Array);
  assert.ok(m.answered instanceof Int32Array);
  assert.ok(m.correct instanceof Int32Array);
  assert.ok(m.weak instanceof Int32Array);
  assert.ok(m.due instanceof Int32Array);
  assert.ok(m.rate instanceof Float32Array);
  assert.ok(m.state instanceof Uint8Array);
  for (const k of ['total', 'answered', 'correct', 'weak', 'due', 'rate', 'state']) assert.strictEqual(m[k].length, 2);
  assert.strictEqual(stateOf(m, 1), 'unseen'); // 配下に問題がないノード
});

test('速さ: 983 問・約 1,600 ノードの合成グラフで 20ms 未満', () => {
  const Q = 983;
  const nodes = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let q = 1; q <= Q; q++) nodes.push({ id: 'q' + q, members: [q] });     // 983 問題ノード
  while (nodes.length < 1600) {                                               // 約 617 の集約ノード
    const k = 1 + Math.floor(rnd() * 12);
    const mem = [];
    for (let j = 0; j < k; j++) mem.push(1 + Math.floor(rnd() * Q));
    nodes.push({ id: 'agg' + nodes.length, members: mem });
  }
  const g = makeGraph(nodes);
  const stats = {};
  const weak = {};
  for (let q = 1; q <= Q; q++) {
    if (rnd() < 0.7) stats[q] = { a: 1 + Math.floor(rnd() * 6), c: 0 };
    stats[q] && (stats[q].c = Math.floor(rnd() * (stats[q].a + 1)));
    if (rnd() < 0.2) weak[q] = { t: q };
  }
  const isDue = e => e.t % 2 === 0;
  for (let i = 0; i < 50; i++) M.computeMastery(g, stats, weak, isDue); // ウォームアップ
  const runs = [];
  for (let i = 0; i < 20; i++) {
    const t0 = process.hrtime.bigint();
    M.computeMastery(g, stats, weak, isDue);
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  runs.sort((a, b) => a - b);
  const median = runs[runs.length >> 1];
  console.log(`computeMastery (${nodes.length} nodes, ${Q} questions): median ${median.toFixed(3)} ms, max ${runs[runs.length - 1].toFixed(3)} ms`);
  assert.ok(median < 20, `median ${median} ms`);
});

// ---- 実データ（data/grammar_graph.js）での検証。Vault には依存しない ----
function loadRealGraph() {
  const src = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  return vm.runInNewContext(src + ';GRAMMAR_GRAPH');
}

test('実グラフ: 空の stats/weak では全ノード unseen・NaN なし', () => {
  const g = loadRealGraph();
  const n = g.id.length;
  const m = M.computeMastery(g, {}, {}, NEVER_DUE);
  for (const k of ['total', 'answered', 'correct', 'weak', 'due', 'rate', 'state']) assert.strictEqual(m[k].length, n);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(m.state[i], 0, g.id[i]);
    assert.strictEqual(m.rate[i], 0.5);
    assert.ok(m.total[i] >= 0 && m.total[i] <= g.memberStart[i + 1] - g.memberStart[i]);
    assert.strictEqual(m.answered[i], 0);
    assert.ok(!Number.isNaN(m.rate[i]));
  }
});

test('実グラフ: 複数の本にまたがる概念は配下の各問を 1 回ずつ数える', () => {
  const g = loadRealGraph();
  const n = g.id.length;
  const ranges = i => Array.from(g.members.slice(g.memberStart[i], g.memberStart[i + 1]));
  // 問題ノードの序数 -> そのノードの index。qid の本は book ノードの members から判定する
  const bookIdx = [];
  for (let i = 0; i < n; i++) if (g.kinds[g.kind[i]] === 'book') bookIdx.push(i);
  const bookOf = new Map();
  bookIdx.forEach(b => ranges(b).forEach(o => bookOf.set(o, b)));
  // 2 冊以上にまたがる concept を探す
  let target = -1;
  for (let i = 0; i < n && target < 0; i++) {
    if (g.kinds[g.kind[i]] !== 'concept') continue;
    const books = new Set(ranges(i).map(o => bookOf.get(o)));
    if (books.size >= 2) target = i;
  }
  assert.ok(target >= 0, '複数の本にまたがる概念が実データにある');

  const ords = ranges(target);
  assert.strictEqual(new Set(ords).size, ords.length, 'members に重複なし');
  // 本ごとに 1 問ずつ選び、a/c/weak を与える
  const picked = [];
  const seenBook = new Set();
  for (const o of ords) {
    const b = bookOf.get(o);
    if (!seenBook.has(b)) { seenBook.add(b); picked.push(o); }
  }
  const stats = {};
  const weak = {};
  picked.forEach((o, k) => { stats[g.qids[o]] = { a: 4 + k, c: 3 }; weak[g.qids[o]] = { t: 0 }; });
  stats[999999] = { a: 7, c: 7 }; // グラフにない問題は無視される

  const m = M.computeMastery(g, stats, weak, () => true);
  const expectA = picked.reduce((s, _, k) => s + 4 + k, 0);
  assert.strictEqual(m.total[target], ords.length);
  assert.strictEqual(m.answered[target], expectA);
  assert.strictEqual(m.correct[target], 3 * picked.length);
  assert.strictEqual(m.weak[target], picked.length);
  assert.strictEqual(m.due[target], picked.length);
  assert.strictEqual(stateOf(m, target), 'due');

  // その問題の本ノードにも同じ問題が 1 回ずつ入る
  for (const o of picked) {
    const b = bookOf.get(o);
    const inBook = ranges(b).filter(x => stats[g.qids[x]]);
    assert.strictEqual(m.answered[b], inBook.reduce((s, x) => s + stats[g.qids[x]].a, 0));
  }
  // 問題ノード自身（id は 'q:<qid>'、members は自分の序数のみ）
  const qNode = g.id.indexOf('q:' + g.qids[picked[0]]);
  assert.ok(qNode >= 0);
  assert.strictEqual(m.total[qNode], 1);
  assert.strictEqual(m.answered[qNode], stats[g.qids[picked[0]]].a);
});

test('classifyMastery: computeMastery と同じ判定順（unseen → due → weak → few → good → mid）', () => {
  const S = M.MASTERY_STATES;
  const name = (a, c, w, d) => S[M.classifyMastery(a, c, w, d)];
  assert.strictEqual(name(0, 0, 0, 0), 'unseen');
  assert.strictEqual(name(0, 0, 1, 1), 'unseen', '解答 0 なら苦手登録があっても unseen');
  assert.strictEqual(name(10, 9, 1, 1), 'due', '要復習は正答率より優先');
  assert.strictEqual(name(10, 9, 2, 0), 'weak', '苦手があれば正答率 90% でも weak');
  assert.strictEqual(name(3, 0, 0, 0), 'weak', '(0+1)/(3+2)=0.2 < 0.6');
  assert.strictEqual(name(2, 2, 0, 0), 'few', '解答 3 未満');
  assert.strictEqual(name(3, 3, 0, 0), 'good', '(3+1)/(3+2)=0.8');
  assert.strictEqual(name(4, 3, 0, 0), 'mid', '(3+1)/(4+2)=0.667');
});

test('readQuestionArrays: 不正値を無視し、序数ごとの解答・正解・苦手・要復習を返す', () => {
  const g = makeGraph([{ id: 'q1', members: [1] }, { id: 'q2', members: [2] }, { id: 'q3', members: [3] }]);
  const r = M.readQuestionArrays(g,
    { 1: { a: 4, c: 9 }, 2: { a: 'x', c: 1 }, __proto__: { a: 5, c: 5 } },
    { 2: { due: 1 }, 3: { due: 2 } },
    e => { if (e.due === 2) throw new Error('boom'); return e.due === 1; });
  assert.strictEqual(r.nq, 3);
  assert.deepStrictEqual([...r.qa], [4, 0, 0]);
  assert.deepStrictEqual([...r.qc], [4, 0, 0], 'c は a までに丸める');
  assert.deepStrictEqual([...r.qw], [0, 1, 1]);
  assert.deepStrictEqual([...r.qd], [0, 1, 0], 'isDue の例外は要復習にしない');
});
