const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../../src/graph-filter.js');
const M = require('../../src/mastery.js');

const KINDS = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];

// 手書きの小さなグラフ。nodes = [{ id, kind, members: [qid, ...] }]
function makeGraph(nodes, kinds = KINDS) {
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
  return {
    kinds,
    id: nodes.map(n => n.id),
    kind: nodes.map(n => kinds.indexOf(n.kind)),
    qids, memberStart, members,
  };
}

// 本 2 冊（kin: 問題 1-4、sekai: 問題 5-6）。概念は両方の本にまたがる。
//   idx: 0 book:kin / 1 ch:kin:1 / 2 rule:kin:1:1 / 3 q1 / 4 q2 / 5 ch:kin:2 / 6 q3 / 7 q4
//        8 book:sekai / 9 ch:sekai:1 / 10 q5 / 11 q6
//        12 concept:a (q1,q5) / 13 concept:b (q3) / 14 concept:c (q6) / 15 trap:t (q2,q6)
const SMALL = makeGraph([
  { id: 'book:kin', kind: 'book', members: [1, 2, 3, 4] },
  { id: 'ch:kin:1', kind: 'chapter', members: [1, 2] },
  { id: 'rule:kin:1:1', kind: 'rule', members: [1, 2] },
  { id: 'q:1', kind: 'question', members: [1] },
  { id: 'q:2', kind: 'question', members: [2] },
  { id: 'ch:kin:2', kind: 'chapter', members: [3, 4] },
  { id: 'q:3', kind: 'question', members: [3] },
  { id: 'q:4', kind: 'question', members: [4] },
  { id: 'book:sekai', kind: 'book', members: [5, 6] },
  { id: 'ch:sekai:1', kind: 'chapter', members: [5, 6] },
  { id: 'q:5', kind: 'question', members: [5] },
  { id: 'q:6', kind: 'question', members: [6] },
  { id: 'concept:a', kind: 'concept', members: [1, 5] },
  { id: 'concept:b', kind: 'concept', members: [3] },
  { id: 'concept:c', kind: 'concept', members: [6] },
  { id: 'trap:t', kind: 'trap', members: [2, 6] },
]);
const N = SMALL.id.length;
const idx = id => SMALL.id.indexOf(id);
const NEVER_DUE = () => false;
const emptyMastery = () => M.computeMastery(SMALL, {}, {}, NEVER_DUE);
const visible = mask => Array.from(mask).map((v, i) => (v ? SMALL.id[i] : null)).filter(Boolean);
const FULL = { book: 'all', weakOnly: false, lod: 2 };

// ---- lodForScale / LOD_SCALES / kindsAtLod ----

test('LOD_SCALES は昇順の 2 要素、lodForScale は境界で上の LOD になる', () => {
  assert.ok(Array.isArray(F.LOD_SCALES));
  assert.strictEqual(F.LOD_SCALES.length, 2);
  const [s1, s2] = F.LOD_SCALES;
  assert.ok(s1 > 0 && s1 < s2);
  assert.strictEqual(F.lodForScale(0), 0);
  assert.strictEqual(F.lodForScale(1), 0); // 全体が収まる初期倍率は遠景
  assert.strictEqual(F.lodForScale(s1 - 1e-9), 0);
  assert.strictEqual(F.lodForScale(s1), 1);
  assert.strictEqual(F.lodForScale(s2 - 1e-9), 1);
  assert.strictEqual(F.lodForScale(s2), 2);
  assert.strictEqual(F.lodForScale(1000), 2);
});

test('lodForScale は不正な値でも例外にならず 0|1|2 を返す', () => {
  for (const v of [NaN, undefined, null, -3, 'x', -Infinity]) assert.strictEqual(F.lodForScale(v), 0);
  assert.strictEqual(F.lodForScale(Infinity), 2);
});

test('kindsAtLod: LOD ごとの種類（graph.kinds の添字）', () => {
  assert.deepStrictEqual(F.kindsAtLod(0), [0, 1, 3, 4]);       // book, chapter, concept, trap
  assert.deepStrictEqual(F.kindsAtLod(1), [0, 1, 2, 3, 4]);    // + rule
  assert.deepStrictEqual(F.kindsAtLod(2), [0, 1, 2, 3, 4, 5]); // + question
  assert.deepStrictEqual(F.kindsAtLod(7), [0, 1, 2, 3, 4, 5]); // 範囲外は丸める
  assert.deepStrictEqual(F.kindsAtLod(-1), [0, 1, 3, 4]);
});

test('kindsAtLod: kinds の並びを渡せばその添字で返す', () => {
  const shuffled = ['question', 'trap', 'rule', 'book', 'chapter', 'concept'];
  assert.deepStrictEqual(F.kindsAtLod(0, shuffled), [1, 3, 4, 5]);
});

test('kindsAtLod は実グラフの kinds と一致する', () => {
  const g = loadReal();
  assert.deepStrictEqual(Array.from(g.kinds), KINDS);
  const names = F.kindsAtLod(2, g.kinds).map(i => g.kinds[i]);
  assert.deepStrictEqual(names, ['book', 'chapter', 'rule', 'concept', 'trap', 'question']);
  assert.deepStrictEqual(F.kindsAtLod(0, g.kinds).map(i => g.kinds[i]), ['book', 'chapter', 'concept', 'trap']);
});

// ---- visibleMask: LOD ----

test('LOD 別: 遠景に question・rule が出ない、中景に rule、近景に question', () => {
  const m = emptyMastery();
  const kindsOf = lod => new Set(visible(F.visibleMask(SMALL, m, { ...FULL, lod })).map(id => id.split(':')[0]));
  assert.deepStrictEqual([...kindsOf(0)].sort(), ['book', 'ch', 'concept', 'trap']);
  assert.deepStrictEqual([...kindsOf(1)].sort(), ['book', 'ch', 'concept', 'rule', 'trap']);
  assert.deepStrictEqual([...kindsOf(2)].sort(), ['book', 'ch', 'concept', 'q', 'rule', 'trap']);
});

test('戻り値は Uint8Array（長さ = ノード数）、opts 省略は「全部描く」', () => {
  const m = emptyMastery();
  const mask = F.visibleMask(SMALL, m, FULL);
  assert.ok(mask instanceof Uint8Array);
  assert.strictEqual(mask.length, N);
  assert.strictEqual(mask.reduce((a, b) => a + b, 0), N);
  assert.deepStrictEqual(F.visibleMask(SMALL, m), mask);
  assert.deepStrictEqual(F.visibleMask(SMALL, m, {}), mask);
});

// ---- visibleMask: 本別 ----

test('本別: kin を選ぶと sekai の本・章・問題は消え、概念は kin の問題とつながるものだけ残る', () => {
  const v = visible(F.visibleMask(SMALL, emptyMastery(), { ...FULL, book: 'kin' }));
  assert.deepStrictEqual(v, [
    'book:kin', 'ch:kin:1', 'rule:kin:1:1', 'q:1', 'q:2', 'ch:kin:2', 'q:3', 'q:4',
    'concept:a', 'concept:b', 'trap:t',
  ]);
  assert.ok(!v.includes('concept:c'));   // q6 は sekai だけ
  assert.ok(!v.includes('book:sekai'));
});

test('本別: sekai を選ぶと kin の本・章・問題が消え、またがる概念・Trap は残る', () => {
  const v = visible(F.visibleMask(SMALL, emptyMastery(), { ...FULL, book: 'sekai' }));
  assert.deepStrictEqual(v, [
    'book:sekai', 'ch:sekai:1', 'q:5', 'q:6', 'concept:a', 'concept:c', 'trap:t',
  ]);
});

test('本別: all は全部、グラフにない本の指定は何も残らない', () => {
  const m = emptyMastery();
  assert.strictEqual(F.visibleMask(SMALL, m, { ...FULL, book: 'all' }).reduce((a, b) => a + b, 0), N);
  assert.strictEqual(F.visibleMask(SMALL, m, { ...FULL, book: 'polaris2' }).reduce((a, b) => a + b, 0), 0);
});

// ---- visibleMask: 苦手のみ ----

test('苦手のみ: weak の問題の親だけ残り、無関係な章は消える', () => {
  // q3 を苦手に登録 → q:3, ch:kin:2, book:kin, concept:b が残る。q1 などは消える
  const m = M.computeMastery(SMALL, {}, { 3: {} }, NEVER_DUE);
  const v = visible(F.visibleMask(SMALL, m, { ...FULL, weakOnly: true }));
  assert.deepStrictEqual(v, ['book:kin', 'ch:kin:2', 'q:3', 'concept:b']);
});

test('苦手のみ: 苦手に登録され期限が来ているもの（due）の親も残る。question は自分の分だけ', () => {
  const m = M.computeMastery(SMALL, {}, { 2: {} }, () => true);
  assert.strictEqual(m.due[idx('q:2')], 1);
  const v = visible(F.visibleMask(SMALL, m, { ...FULL, weakOnly: true }));
  assert.deepStrictEqual(v, ['book:kin', 'ch:kin:1', 'rule:kin:1:1', 'q:2', 'trap:t']);
  assert.ok(!v.includes('q:1'));
});

test('苦手のみ: 何も苦手でなければ全部消える。mastery が無くても例外にならない', () => {
  const m = emptyMastery();
  assert.strictEqual(F.visibleMask(SMALL, m, { ...FULL, weakOnly: true }).some(Boolean), false);
  assert.strictEqual(F.visibleMask(SMALL, null, { ...FULL, weakOnly: true }).some(Boolean), false);
  assert.strictEqual(F.visibleMask(SMALL, null, FULL).reduce((a, b) => a + b, 0), N);
});

test('苦手のみ + 本: 概念・Trap の苦手は全体で数える（他の本の苦手でも、その本の問題があれば残る）', () => {
  // ユーザー決定（2026-11-08）: 本で絞っても、concept / trap の苦手判定は全体（ノード自身の weak/due）のまま。
  // 苦手は sekai の q5 だけ。concept:a は q1(kin)・q5(sekai) にまたがるので、kin に絞っても残る。
  const m = M.computeMastery(SMALL, {}, { 5: {} }, NEVER_DUE);
  const v = visible(F.visibleMask(SMALL, m, { ...FULL, book: 'kin', weakOnly: true }));
  assert.deepStrictEqual(v, ['concept:a']);
  assert.ok(!v.includes('q:5') && !v.includes('book:sekai'));
});

test('opts.lod が null / undefined なら 2（全部の種類）。book: null が all になるのと同じ', () => {
  const m = emptyMastery();
  const full = F.visibleMask(SMALL, m, FULL);
  assert.deepStrictEqual(F.visibleMask(SMALL, m, { lod: null }), full);
  assert.deepStrictEqual(F.visibleMask(SMALL, m, { lod: undefined, book: null }), full);
});

// ---- 3 条件の組み合わせ ----

test('3 条件の AND: 本 × 苦手 × LOD', () => {
  // q2 (kin) と q6 (sekai) が苦手
  const m = M.computeMastery(SMALL, {}, { 2: {}, 6: {} }, NEVER_DUE);
  const f = o => visible(F.visibleMask(SMALL, m, o));
  assert.deepStrictEqual(f({ book: 'all', weakOnly: true, lod: 2 }), [
    'book:kin', 'ch:kin:1', 'rule:kin:1:1', 'q:2', 'book:sekai', 'ch:sekai:1', 'q:6', 'concept:c', 'trap:t',
  ]);
  assert.deepStrictEqual(f({ book: 'kin', weakOnly: true, lod: 2 }), [
    'book:kin', 'ch:kin:1', 'rule:kin:1:1', 'q:2', 'trap:t',
  ]);
  assert.deepStrictEqual(f({ book: 'kin', weakOnly: true, lod: 1 }), [
    'book:kin', 'ch:kin:1', 'rule:kin:1:1', 'trap:t',
  ]);
  assert.deepStrictEqual(f({ book: 'kin', weakOnly: true, lod: 0 }), ['book:kin', 'ch:kin:1', 'trap:t']);
  // concept:a は q1(kin)・q5(sekai) と結ばれるが苦手はない → 消える
  assert.ok(!f({ book: 'kin', weakOnly: true, lod: 2 }).includes('concept:a'));
});

test('マスクに 0/1 以外が入らず、呼び出しで graph・mastery を変えない', () => {
  const m = M.computeMastery(SMALL, {}, { 2: {} }, NEVER_DUE);
  const snap = JSON.stringify(Array.from(m.weak));
  const mask = F.visibleMask(SMALL, m, { book: 'kin', weakOnly: true, lod: 1 });
  for (const v of mask) assert.ok(v === 0 || v === 1);
  assert.strictEqual(JSON.stringify(Array.from(m.weak)), snap);
});

// ---- 実データ ----

function loadReal() {
  const src = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  return vm.runInNewContext(src + ';GRAMMAR_GRAPH');
}
const REAL = loadReal();
const realMastery = (weak = {}) => M.computeMastery(REAL, {}, weak, NEVER_DUE);
const realMask = (m, o) => F.visibleMask(REAL, m, { book: 'all', weakOnly: false, lod: 2, ...o });
const kindName = i => REAL.kinds[REAL.kind[i]];
const count = (mask, kind) => {
  let c = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && kindName(i) === kind) c++;
  return c;
};
const BOOKS = ['kin', 'sekai', 'polaris2', 'toplevel'];

test('実データ: all/LOD2 は全ノード、LOD0 に rule・question はない', () => {
  const m = realMastery();
  const all = realMask(m, {});
  assert.strictEqual(all.length, REAL.id.length);
  assert.strictEqual(all.reduce((a, b) => a + b, 0), REAL.id.length);
  const l0 = realMask(m, { lod: 0 });
  assert.strictEqual(count(l0, 'rule'), 0);
  assert.strictEqual(count(l0, 'question'), 0);
  assert.strictEqual(count(l0, 'book'), 4);
  const l1 = realMask(m, { lod: 1 });
  assert.strictEqual(count(l1, 'rule'), 138);
  assert.strictEqual(count(l1, 'question'), 0);
});

test('実データ: 本で絞ると、その本の book ノードだけが残る', () => {
  const m = realMastery();
  for (const b of BOOKS) {
    const mask = realMask(m, { book: b });
    assert.strictEqual(count(mask, 'book'), 1, b);
    assert.ok(mask[REAL.id.indexOf('book:' + b)], b);
  }
});

test('実データ: polaris2 だけにすると sekai の章がない', () => {
  const mask = realMask(realMastery(), { book: 'polaris2' });
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && kindName(i) === 'chapter') assert.ok(!REAL.id[i].startsWith('ch:sekai:'), REAL.id[i]);
  }
  assert.ok(count(mask, 'chapter') > 0);
});

test('実データ: 本の絞り込みで残る概念は 13 以下で、どれもその本の問題を 1 問以上もつ', () => {
  const m = realMastery();
  for (const b of BOOKS) {
    const bi = REAL.id.indexOf('book:' + b);
    const inBook = new Set();
    for (let k = REAL.memberStart[bi]; k < REAL.memberStart[bi + 1]; k++) inBook.add(REAL.members[k]);
    const mask = realMask(m, { book: b });
    assert.ok(count(mask, 'concept') <= 13, `${b}: concept=${count(mask, 'concept')}`);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      let hit = false;
      for (let k = REAL.memberStart[i]; k < REAL.memberStart[i + 1] && !hit; k++) hit = inBook.has(REAL.members[k]);
      assert.ok(hit, `${b}: ${REAL.id[i]} has no question in the book`);
    }
  }
});

test('実データ: 4 冊の問題は重ならず、本ごとの question 数の合計は全問', () => {
  const m = realMastery();
  let sum = 0;
  for (const b of BOOKS) sum += count(realMask(m, { book: b }), 'question');
  assert.strictEqual(sum, REAL.qids.length);
});

test('実データ: 苦手のみ — 苦手な問題の親は残り、無関係な章は消える', () => {
  // 序数 0 と、別の章に属する問題 1 つを苦手にする
  const chapterOf = new Map(); // 問題の序数 -> 章ノード番号
  for (let i = 0; i < REAL.id.length; i++) {
    if (kindName(i) !== 'chapter') continue;
    for (let k = REAL.memberStart[i]; k < REAL.memberStart[i + 1]; k++) chapterOf.set(REAL.members[k], i);
  }
  const o1 = 0;
  let o2 = -1;
  for (let o = 1; o < REAL.qids.length; o++) if (chapterOf.get(o) !== chapterOf.get(o1)) { o2 = o; break; }
  assert.ok(o2 > 0);
  const weak = { [REAL.qids[o1]]: {}, [REAL.qids[o2]]: {} };
  const m = realMastery(weak);
  const mask = realMask(m, { weakOnly: true });
  // 問題ノードは自分の序数だけをメンバーにもつ
  const findQuestionNode = o => {
    for (let i = 0; i < REAL.id.length; i++) {
      if (kindName(i) === 'question' && REAL.memberStart[i + 1] - REAL.memberStart[i] === 1 && REAL.members[REAL.memberStart[i]] === o) return i;
    }
    return -1;
  };
  for (const o of [o1, o2]) {
    const q = findQuestionNode(o);
    assert.ok(q >= 0 && mask[q], 'question node kept');
    assert.ok(mask[chapterOf.get(o)], 'parent chapter kept');
  }
  assert.strictEqual(count(mask, 'question'), 2);
  assert.ok(count(mask, 'chapter') <= 2);
  assert.ok(count(mask, 'chapter') >= 1);
  // 苦手を含まない章は消える
  for (let i = 0; i < REAL.id.length; i++) {
    if (kindName(i) === 'chapter' && i !== chapterOf.get(o1) && i !== chapterOf.get(o2)) assert.strictEqual(mask[i], 0, REAL.id[i]);
  }
  // 苦手がなければ空
  assert.strictEqual(realMask(realMastery(), { weakOnly: true }).some(Boolean), false);
});

test('実データ: 3 条件の組み合わせ — 苦手の問題を含む本に絞ると、他の本のノードが残らない', () => {
  const m = realMastery({ [REAL.qids[0]]: {} });
  // 序数 0 の本を探す
  let owner = null;
  for (const b of BOOKS) {
    const bi = REAL.id.indexOf('book:' + b);
    for (let k = REAL.memberStart[bi]; k < REAL.memberStart[bi + 1]; k++) if (REAL.members[k] === 0) owner = b;
  }
  assert.ok(owner);
  const other = BOOKS.find(b => b !== owner);
  const mine = realMask(m, { book: owner, weakOnly: true, lod: 2 });
  const theirs = realMask(m, { book: other, weakOnly: true, lod: 2 });
  assert.ok(count(mine, 'question') === 1);
  assert.strictEqual(count(theirs, 'question'), 0);
  assert.strictEqual(count(theirs, 'book'), 0);
  const lod0 = realMask(m, { book: owner, weakOnly: true, lod: 0 });
  assert.strictEqual(count(lod0, 'question'), 0);
  assert.strictEqual(count(lod0, 'rule'), 0);
  assert.strictEqual(count(lod0, 'book'), 1);
});

test('実データ: マスク計算の速さ（実測を出力し、緩い上限だけ見る）', () => {
  const m = realMastery({ [REAL.qids[0]]: {}, [REAL.qids[5]]: {} });
  const opts = { book: 'kin', weakOnly: true, lod: 2 };
  for (let i = 0; i < 20; i++) F.visibleMask(REAL, m, opts); // ウォームアップ
  const runs = 200;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) F.visibleMask(REAL, m, opts);
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  console.log(`visibleMask on real graph: ${per.toFixed(3)} ms/call`);
  assert.ok(per < 50, `too slow: ${per} ms`);
});

const { makeFixture, makeMastery } = require('./helpers/graph-fixture.js');

test('buildIndex: 親・概念/ひっかけ・章・ルール・序数→ノード', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.strictEqual(ix.n, 16);
  assert.strictEqual(ix.nq, 6);
  assert.deepStrictEqual([...ix.qNode], [3, 4, 6, 7, 10, 11]);
  assert.strictEqual(ix.parent[3], 2);
  assert.strictEqual(ix.parent[0], -1);
  assert.strictEqual(ix.chapterOf[3], 1);
  assert.strictEqual(ix.ruleOf[3], 2);
  assert.strictEqual(ix.chapterOf[6], 5);
  assert.strictEqual(ix.ruleOf[6], -1);
  const hubsOf = q => [...ix.hubs.slice(ix.hubStart[q], ix.hubStart[q + 1])].sort((a, b) => a - b);
  assert.deepStrictEqual(hubsOf(10), [12, 14]);
  assert.deepStrictEqual(hubsOf(11), [14, 15]);
  assert.deepStrictEqual(hubsOf(7), []);
  assert.deepStrictEqual(hubsOf(0), []);
});

test('buildIndex: 範囲外の端点を持つエッジは無視する', () => {
  const g = makeFixture();
  g.edges.push(99, 3, 0, 3, 99, 1);
  const ix = F.buildIndex(g);
  assert.strictEqual(ix.parent[3], 2);
  assert.strictEqual(ix.hubStart[4] - ix.hubStart[3], 1);
});

test('buildBundles: 章の単位で束ねる', () => {
  const g = makeFixture();
  const b = F.buildBundles(g, F.buildIndex(g), 'chapter');
  assert.strictEqual(b.count, 6);
  assert.deepStrictEqual([...b.a], [1, 1, 5, 9, 9, 9]);
  assert.deepStrictEqual([...b.b], [12, 15, 13, 12, 14, 15]);
  assert.deepStrictEqual([...b.type], [1, 2, 1, 1, 1, 2]);
  const qs = j => [...b.questions.slice(b.start[j], b.start[j + 1])];
  assert.deepStrictEqual(qs(0), [3]);
  assert.deepStrictEqual(qs(4), [10, 11]);
  assert.deepStrictEqual(qs(5), [11]);
});

test('buildBundles: ルールの単位。ルールを持たない問題は章の束に入る', () => {
  const g = makeFixture();
  const b = F.buildBundles(g, F.buildIndex(g), 'rule');
  assert.deepStrictEqual([...b.a], [2, 2, 5, 9, 9, 9]);
  assert.deepStrictEqual([...b.b], [12, 15, 13, 12, 14, 15]);
});

test('bundleWeak: 束ごとの苦手の問題数', () => {
  const g = makeFixture();
  const b = F.buildBundles(g, F.buildIndex(g), 'chapter');
  const m = makeMastery(g, { 10: 1, 11: 1, 3: 1 });
  assert.deepStrictEqual([...F.bundleWeak(b, m.weak)], [1, 0, 0, 1, 2, 1]);
  assert.deepStrictEqual([...F.bundleWeak(b, new Int32Array(16))], [0, 0, 0, 0, 0, 0]);
});

test('visibleMask: showWeakQuestions は、苦手の問題だけを LOD に関係なく残す', () => {
  const g = makeFixture();
  const stats = { 6: { a: 2, c: 0 } };
  const weak = { 6: { due: Date.now() + 1e9 } };
  const m = M.computeMastery(g, stats, weak, () => false);
  const far = F.visibleMask(g, m, { lod: 0, showWeakQuestions: true });
  assert.strictEqual(far[11], 1, '苦手の q:6 が遠景で残っていない');
  assert.strictEqual(far[10], 0, '苦手でない q:5 が遠景で残っている');
  assert.strictEqual(far[2], 0, 'ルールは遠景では出ない');
  assert.strictEqual(F.visibleMask(g, m, { lod: 0 })[11], 0, '既定では残さない');
  // 本の絞り込みは通す（別の本の苦手は残さない）
  assert.strictEqual(F.visibleMask(g, m, { lod: 0, showWeakQuestions: true, book: 'kin' })[11], 0);
});

test('visibleMask: forceShow のノードは LOD に関係なく残す。本の絞り込みは通す', () => {
  const g = makeFixture();
  const m = M.computeMastery(g, {}, {}, () => false);
  const force = new Uint8Array(16); force[3] = 1; force[10] = 1;
  const far = F.visibleMask(g, m, { lod: 0, forceShow: force });
  assert.strictEqual(far[3], 1);
  assert.strictEqual(far[10], 1);
  assert.strictEqual(far[4], 0);
  assert.strictEqual(F.visibleMask(g, m, { lod: 0, forceShow: force, book: 'kin' })[10], 0);
});

const on = mask => [...mask].map((v, i) => (v ? i : -1)).filter(i => i >= 0);

test('focusSet: 問題 → 自分・概念・ひっかけ・ルール・章と、渡された近い問題', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 3)), [1, 2, 3, 12]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 11, [4, 10])), [4, 9, 10, 11, 14, 15]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 7)), [5, 7], 'つながりのない問題は自分と章だけ');
});

test('focusSet: 概念・ひっかけ → 自分・配下の問題・その章', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 14)), [9, 10, 11, 14]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 15)), [1, 4, 9, 11, 15]);
});

test('focusSet: ルール・章・本 → 自分・配下の問題・それらの概念とひっかけ', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 2)), [2, 3, 4, 12, 15]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 9)), [9, 10, 11, 12, 14, 15]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 0)), [0, 3, 4, 6, 7, 12, 13, 15]);
});

test('focusSet: 範囲外の添字・範囲外の近い問題でも落ちず、何も立てない', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, -1)), []);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 99)), []);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 3, [99, -1, 4])), [1, 2, 3, 4, 12]);
});

test('buildIndex & focusSet: 副概念エッジ（type 3）は secStart/secHubs に分離され、問題選択時に浮かび上がる', () => {
  const g = makeFixture();
  // q:1(3) に con:b(13) を副概念（type 3）として追加
  g.edges.push(3, 13, 3);
  const ix = F.buildIndex(g);
  const hubsOf = q => [...ix.hubs.slice(ix.hubStart[q], ix.hubStart[q + 1])];
  const secsOf = q => [...ix.secHubs.slice(ix.secStart[q], ix.secStart[q + 1])];
  assert.deepStrictEqual(hubsOf(3), [12], '主概念は hubs に入る');
  assert.deepStrictEqual(secsOf(3), [13], '副概念は secHubs に分離される');
  assert.deepStrictEqual(secsOf(10), [], '副概念のない問題は空');
  // 問題 q:1(3) を選択すると副概念 con:b(13) も浮かび上がる
  assert.deepStrictEqual(on(F.focusSet(g, ix, 3)), [1, 2, 3, 12, 13]);
});
