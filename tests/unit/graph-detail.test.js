const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../../src/graph-detail.js');
const M = require('../../src/mastery.js');

const KINDS = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
const NEVER_DUE = () => false;

// nodes = [{ id, kind, label, members: [qid, ...], qid? }]
function makeGraph(nodes, text = {}) {
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
    kinds: KINDS,
    id: nodes.map(n => n.id),
    kind: nodes.map(n => KINDS.indexOf(n.kind)),
    label: nodes.map(n => n.label || n.id),
    qid: nodes.map(n => n.qid || 0),
    qids, memberStart, members, text,
  };
}

// 0 book / 1 chapter / 2 rule / 3 concept / 4 trap / 5 question(qid 7)
const G = makeGraph([
  { id: 'book:a', kind: 'book', label: '世界一', members: [1, 2, 3, 4, 5] },
  { id: 'ch:a:1', kind: 'chapter', label: '受動態', members: [1, 2] },
  { id: 'rule:a:1:1', kind: 'rule', label: '短いルール…', members: [1, 2] },
  { id: 'concept:x', kind: 'concept', label: '分詞', members: [1, 3] },
  { id: 'trap:y', kind: 'trap', label: '時制の罠', members: [2, 4] },
  { id: 'q:7', kind: 'question', label: '#7', members: [7], qid: 7 },
], {
  3: { desc: '概念の説明' },
  4: { desc: '罠の説明', advice: '対策の助言' },
});
const mastery = (stats = {}, weak = {}) => M.computeMastery(G, stats, weak, NEVER_DUE);
const Q = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 7: 'Seven' };
const ctx = (stats = {}, weak = {}) => ({ stats, weak, getQuestion: id => (Q[id] ? { q: Q[id] } : undefined) });
const detail = (i, stats, weak) => D.buildDetail(G, mastery(stats, weak), i, ctx(stats, weak));

test('種類と状態の日本語ラベルを公開する', () => {
  assert.deepStrictEqual(D.KIND_LABELS, ['本', '章', 'ルール', '概念', 'ひっかけ(Trap)', '問題']);
  assert.deepStrictEqual(D.STATE_LABELS, ['未着手', '要復習', '苦手', '練習不足', 'もう少し', '定着']);
});

test('基本の形: title / kindLabel / stateLabel / rate / answered / weakCount', () => {
  const d = detail(1, { 1: { a: 3, c: 3 }, 2: { a: 2, c: 1 } });
  assert.strictEqual(d.title, '受動態');
  assert.strictEqual(d.kindLabel, '章');
  assert.strictEqual(d.answered, 5);
  assert.strictEqual(d.weakCount, 0);
  assert.strictEqual(d.rate, Math.fround((4 + 1) / (5 + 2)));
  assert.strictEqual(d.stateLabel, 'もう少し'); // a=5, rate 5/7≈0.71 → mid
  assert.strictEqual(d.moreCount, undefined);
  assert.ok(!('moreCount' in d));
});

test('未着手: rate は null、stateLabel は 未着手', () => {
  const d = detail(0);
  assert.strictEqual(d.rate, null);
  assert.strictEqual(d.answered, 0);
  assert.strictEqual(d.stateLabel, '未着手');
});

test('stateLabel は mastery.state に対応（苦手あり → 苦手）、weakCount は mastery.weak', () => {
  const d = detail(0, { 1: { a: 1, c: 0 } }, { 1: {} });
  assert.strictEqual(d.weakCount, 1);
  assert.strictEqual(d.stateLabel, '苦手');
});

test('概念と Trap は desc/advice を返し、ほかの種類は持たない', () => {
  const c = detail(3);
  assert.strictEqual(c.desc, '概念の説明');
  assert.ok(!('advice' in c));
  assert.strictEqual(c.kindLabel, '概念');
  const t = detail(4);
  assert.strictEqual(t.desc, '罠の説明');
  assert.strictEqual(t.advice, '対策の助言');
  assert.strictEqual(t.kindLabel, 'ひっかけ(Trap)');
  for (const i of [0, 1, 2, 5]) {
    const d = detail(i);
    assert.ok(!('desc' in d), 'desc @' + i);
    assert.ok(!('advice' in d), 'advice @' + i);
  }
});

test('text に該当エントリが無い概念でも落ちない（desc/advice キー無し）', () => {
  const g = makeGraph([{ id: 'c', kind: 'concept', label: '概念', members: [1] }], {});
  const d = D.buildDetail(g, M.computeMastery(g, {}, {}, NEVER_DUE), 0, ctx());
  assert.ok(!('desc' in d));
  const g2 = makeGraph([{ id: 'c', kind: 'concept', label: '概念', members: [1] }]);
  assert.doesNotThrow(() => D.buildDetail(g2, M.computeMastery(g2, {}, {}, NEVER_DUE), 0, ctx()));
});

test('questions の status: weak が最優先、未解答は unseen、全問正解は correct、それ以外は wrong', () => {
  const stats = { 1: { a: 2, c: 2 }, 2: { a: 2, c: 1 }, 3: { a: 1, c: 1 } };
  const weak = { 3: {}, 4: {} }; // 3 は正解でも weak、4 は未解答でも weak
  const d = detail(0, stats, weak);
  const st = Object.fromEntries(d.questions.map(q => [q.qid, q.status]));
  assert.deepStrictEqual(st, { 1: 'correct', 2: 'wrong', 3: 'weak', 4: 'weak', 5: 'unseen' });
});

test('questions の並び: weak → wrong → unseen → correct、同順位は qid 昇順', () => {
  const stats = { 1: { a: 1, c: 1 }, 2: { a: 1, c: 0 }, 3: { a: 1, c: 1 }, 5: { a: 2, c: 0 } };
  const weak = { 4: {} };
  const d = detail(0, stats, weak);
  assert.deepStrictEqual(d.questions.map(q => [q.qid, q.status]), [
    [4, 'weak'], [2, 'wrong'], [5, 'wrong'], [1, 'correct'], [3, 'correct'],
  ]);
  // unseen は wrong の後・correct の前
  const d2 = detail(0, { 1: { a: 1, c: 1 }, 2: { a: 1, c: 0 } }, {});
  assert.deepStrictEqual(d2.questions.map(q => q.status), ['wrong', 'unseen', 'unseen', 'unseen', 'correct']);
  assert.deepStrictEqual(d2.questions.map(q => q.qid), [2, 3, 4, 5, 1]);
});

test('questions の text は getQuestion(qid).q、無ければ #qid（落ちない）', () => {
  const d = D.buildDetail(G, mastery(), 3, { stats: {}, weak: {}, getQuestion: id => (id === 1 ? { q: 'Hello' } : undefined) });
  assert.deepStrictEqual(d.questions.map(q => [q.qid, q.text]), [[1, 'Hello'], [3, '#3']]);
  const d2 = D.buildDetail(G, mastery(), 3, { stats: {}, weak: {}, getQuestion: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(d2.questions.map(q => q.text), ['#1', '#3']);
  const d3 = D.buildDetail(G, mastery(), 3, { stats: {}, weak: {}, getQuestion: () => ({}) });
  assert.deepStrictEqual(d3.questions.map(q => q.text), ['#1', '#3']);
});

test('問題文は先頭 60 字、超えたら … を付ける（60 字ちょうどはそのまま）', () => {
  const s60 = 'a'.repeat(60);
  const s61 = 'b'.repeat(61);
  const g = makeGraph([{ id: 'c', kind: 'concept', label: '概念', members: [1, 2] }], { 0: { desc: 'd' } });
  const c = { stats: {}, weak: {}, getQuestion: id => ({ q: id === 1 ? s60 : s61 }) };
  const d = D.buildDetail(g, M.computeMastery(g, {}, {}, NEVER_DUE), 0, c);
  assert.strictEqual(d.questions[0].text, s60);
  assert.strictEqual(d.questions[1].text, 'b'.repeat(60) + '…');
});

test('question ノード: title は問題文（60 字 + …）、questions は自分自身だけ', () => {
  const d = detail(5, { 7: { a: 2, c: 1 } });
  assert.strictEqual(d.title, 'Seven');
  assert.strictEqual(d.kindLabel, '問題');
  assert.deepStrictEqual(d.questions, [{ qid: 7, text: 'Seven', status: 'wrong' }]);
  const long = 'x'.repeat(70);
  const d2 = D.buildDetail(G, mastery(), 5, { stats: {}, weak: {}, getQuestion: () => ({ q: long }) });
  assert.strictEqual(d2.title, 'x'.repeat(60) + '…');
  // 問題文が無ければグラフの label（#7）
  const d3 = D.buildDetail(G, mastery(), 5, { stats: {}, weak: {}, getQuestion: () => undefined });
  assert.strictEqual(d3.title, '#7');
});

test('200 件の上限と moreCount（ちょうど 200 件なら moreCount 無し）', () => {
  const mk = n => {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const g = makeGraph([{ id: 'c', kind: 'concept', label: '概念', members: ids }], { 0: { desc: 'd' } });
    return D.buildDetail(g, M.computeMastery(g, {}, {}, NEVER_DUE), 0, ctx());
  };
  const d = mk(250);
  assert.strictEqual(d.questions.length, 200);
  assert.strictEqual(d.moreCount, 50);
  const e = mk(200);
  assert.strictEqual(e.questions.length, 200);
  assert.ok(!('moreCount' in e));
});

test('上限で切る前に並べ替える（苦手は 200 件目より後ろにあっても残る）', () => {
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const g = makeGraph([{ id: 'c', kind: 'concept', label: '概念', members: ids }], { 0: { desc: 'd' } });
  const weak = { 250: {} };
  const d = D.buildDetail(g, M.computeMastery(g, {}, weak, NEVER_DUE), 0, { stats: {}, weak, getQuestion: () => undefined });
  assert.strictEqual(d.questions[0].qid, 250);
  assert.strictEqual(d.questions[0].status, 'weak');
});

test('不正な nodeIndex は null（例外を出さない）', () => {
  const m = mastery();
  for (const bad of [-1, 6, 999, 1.5, NaN, undefined, null, '3', Infinity]) {
    assert.strictEqual(D.buildDetail(G, m, bad, ctx()), null, String(bad));
  }
});

test('ctx が欠けていても落ちない', () => {
  const m = mastery();
  assert.doesNotThrow(() => D.buildDetail(G, m, 0, undefined));
  assert.doesNotThrow(() => D.buildDetail(G, m, 0, {}));
  const d = D.buildDetail(G, m, 0, {});
  assert.deepStrictEqual(d.questions.map(q => q.text), ['#1', '#2', '#3', '#4', '#5']);
});

// ---- 実グラフ ----
function loadRealGraph() {
  const ctxv = {};
  vm.createContext(ctxv);
  const src = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  vm.runInContext(src + ';this.G = GRAMMAR_GRAPH', ctxv);
  return ctxv.G;
}

test('実グラフ: 概念の配下の問題がメンバーと一致し、件数が総数と合う', () => {
  const g = loadRealGraph();
  const m = M.computeMastery(g, {}, {}, NEVER_DUE);
  const c = { stats: {}, weak: {}, getQuestion: () => undefined };
  const concept = g.kinds.indexOf('concept');
  const i = g.kind.findIndex((k, idx) => k === concept && g.text[idx]);
  assert.ok(i >= 0);
  const d = D.buildDetail(g, m, i, c);
  assert.strictEqual(d.kindLabel, '概念');
  assert.ok(d.desc && d.desc.length > 0);
  const own = new Set();
  for (let k = g.memberStart[i]; k < g.memberStart[i + 1]; k++) own.add(g.qids[g.members[k]]);
  for (const q of d.questions) assert.ok(own.has(q.qid), 'qid ' + q.qid);
  assert.strictEqual(d.questions.length + (d.moreCount || 0), own.size);
  assert.strictEqual(own.size, m.total[i]);
});

test('実グラフ: Trap ノードは advice を持つ', () => {
  const g = loadRealGraph();
  const m = M.computeMastery(g, {}, {}, NEVER_DUE);
  const trap = g.kinds.indexOf('trap');
  const i = g.kind.findIndex(k => k === trap);
  assert.ok(i >= 0);
  const d = D.buildDetail(g, m, i, { stats: {}, weak: {}, getQuestion: () => undefined });
  assert.ok(typeof d.advice === 'string' && d.advice.length > 0);
  assert.ok(typeof d.desc === 'string' && d.desc.length > 0);
});
