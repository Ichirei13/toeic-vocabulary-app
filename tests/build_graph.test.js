// 文法グラフのモデルと符号化（tools/lib/model.mjs, encode.mjs, books.mjs）の検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/build_graph.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lib = name => import(path.resolve(__dirname, '..', 'tools', 'lib', name));

// ---- ミニ入力: 金 2 章（ルール 7 は両章にまたがる）・世界一 1 章・トップレベル 2 章（rule.number が章ごとに 1 から）
const KIN = '金の文法';
function appQuestions() {
  const k = (id, ch, num, title) => ({
    id, b: 'kin', ch, ch_title: ch === 1 ? '品詞問題' : '時制', th_title: 'Q' + id, q: 'kin question ' + id,
    rule: { number: num, title, category: 'c' },
  });
  return [
    k(1, 1, 7, '主語には名詞を選ぶ（とても長いルール名で十四字を超える）'),
    k(2, 1, 7, '主語には名詞を選ぶ（とても長いルール名で十四字を超える）'),
    k(3, 2, 7, '現在形を使う'),
    k(4, 2, 8, '過去形を使う'),
    { id: 10, b: 'sekai', ch: 1, ch_title: '受動態', th_title: '受動態の変形', q: 'sekai question 10' },
    { id: 11, ch: 1, ch_title: '受動態', th_title: '受動態の変形', q: 'sekai question 11' }, // b なし = 世界一
    { id: 12, b: 'sekai', ch: 1, ch_title: '受動態', th_title: '受動態と群動詞', q: 'sekai question 12' },
    { id: 20, b: 'toplevel', ch: 1, ch_title: '時制⑴', th_title: 'p1', q: 'top question 20', rule: { number: 1, title: '時制⑴ ポイント【1】', category: 'x' } },
    { id: 21, b: 'toplevel', ch: 2, ch_title: '時制⑵', th_title: 'p1', q: 'top question 21', rule: { number: 1, title: '時制⑵ ポイント【1】', category: 'x' } },
  ];
}
const V = (practiceId, conceptIds, trapIds = []) => ({ practiceId, book: KIN, text: '', chapter: 1, conceptIds, trapIds });
const CONCEPTS = [
  { id: 'A概念', name: 'A概念', desc: 'A の説明' },
  { id: 'B概念', name: 'B概念', desc: 'B の説明' },
  { id: '未使用概念', name: '未使用概念', desc: '' },
];
const TRAPS = [{ id: 'Trap_01_罠', name: '罠', desc: '罠の説明', advice: '対処' }];

function buildInput(overrides = {}) {
  const app = appQuestions();
  const byApp = new Map([
    [1, V(1, ['A概念'], ['Trap_01_罠'])],
    [2, V(2, ['A概念', 'B概念'])],
    [3, V(3, ['B概念'])],
    [4, V(4, [])], // 一致したが概念リンクなし
    [10, V(10, ['A概念'])],
    [11, V(11, ['A概念', 'B概念'])],
    // 12 は未対応（Vault に対応するノートなし）
    [20, V(20, ['B概念'])],
    [21, V(21, ['A概念'])],
  ]);
  return { app, byApp, concepts: CONCEPTS, traps: TRAPS, ...overrides };
}

async function model(overrides) {
  const { buildModel } = await lib('model.mjs');
  return buildModel(buildInput(overrides));
}
const idx = (m, id) => m.id.indexOf(id);

test('本の名前は js/grammar-drill.js の GRAMMAR_BOOKS と一致する', async () => {
  const { GRAMMAR_BOOK_LABELS } = await lib('books.mjs');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'grammar-drill.js'), 'utf8');
  const block = src.slice(src.indexOf('const GRAMMAR_BOOKS = {'), src.indexOf('const GRAMMAR_BOOK_IDS'));
  const names = {};
  for (const m of block.matchAll(/^ {2}(\w+): \{\s*\n\s*name: '([^']+)'/gm)) names[m[1]] = m[2];
  assert.deepStrictEqual(Object.keys(names).sort(), ['kin', 'polaris2', 'sekai', 'toplevel']);
  assert.deepStrictEqual(GRAMMAR_BOOK_LABELS, names);
});

test('モデル: ノード id は一意、エッジの端点は存在し、kind は範囲内', async () => {
  const m = await model();
  assert.deepStrictEqual(m.kinds, ['book', 'chapter', 'rule', 'concept', 'trap', 'question']);
  const n = m.id.length;
  assert.strictEqual(new Set(m.id).size, n);
  assert.strictEqual(m.kind.length, n);
  assert.strictEqual(m.label.length, n);
  assert.strictEqual(m.qid.length, n);
  for (const k of m.kind) assert.ok(Number.isInteger(k) && k >= 0 && k < m.kinds.length);
  for (const [a, b, t] of m.edges) {
    assert.ok(Number.isInteger(a) && a >= 0 && a < n, 'from');
    assert.ok(Number.isInteger(b) && b >= 0 && b < n, 'to');
    assert.ok([0, 1, 2].includes(t));
  }
  assert.strictEqual(new Set(m.edges.map(e => e.join(','))).size, m.edges.length, 'エッジに重複なし');
});

test('モデル: question ノード数 = 入力の問題数で、qid は 1 回ずつ', async () => {
  const m = await model();
  const qk = m.kinds.indexOf('question');
  const qs = m.id.map((_, i) => i).filter(i => m.kind[i] === qk);
  assert.strictEqual(qs.length, 9);
  assert.deepStrictEqual(qs.map(i => m.qid[i]).sort((a, b) => a - b), [1, 2, 3, 4, 10, 11, 12, 20, 21]);
  for (const i of qs) assert.strictEqual(m.id[i], 'q:' + m.qid[i]);
  for (const i of qs) assert.strictEqual(m.label[i], '#' + m.qid[i]);
  assert.ok(m.id.every((_, i) => m.kind[i] === qk || m.qid[i] === 0));
});

test('モデル: ノード id の形とラベル', async () => {
  const m = await model();
  assert.ok(idx(m, 'book:kin') >= 0 && idx(m, 'book:sekai') >= 0 && idx(m, 'book:toplevel') >= 0);
  assert.strictEqual(m.label[idx(m, 'book:kin')], '金の文法');
  assert.strictEqual(m.label[idx(m, 'book:sekai')], '世界一');
  assert.strictEqual(m.label[idx(m, 'book:toplevel')], 'トップレベル');
  assert.strictEqual(m.label[idx(m, 'ch:kin:1')], '品詞問題');
  const longTitle = '主語には名詞を選ぶ（とても長いルール名で十四字を超える）';
  assert.strictEqual(m.label[idx(m, 'rule:kin:1:7')], longTitle.slice(0, 14) + '…', 'rule.title を 14 字で切って …');
  assert.strictEqual([...m.label[idx(m, 'rule:kin:1:7')]].length, 15);
  assert.strictEqual(m.label[idx(m, 'rule:kin:2:8')], '過去形を使う');
  assert.strictEqual(m.label[idx(m, 'rule:sekai:1:1')], '受動態の変形');
  assert.strictEqual(m.label[idx(m, 'rule:sekai:1:2')], '受動態と群動詞');
  assert.strictEqual(m.label[idx(m, 'con:A概念')], 'A概念');
  assert.strictEqual(m.label[idx(m, 'trap:Trap_01_罠')], '罠');
});

test('モデル: 同じ rule.number でも章が違えば別ルールノード（金・トップレベル）', async () => {
  const m = await model();
  assert.ok(idx(m, 'rule:kin:1:7') >= 0 && idx(m, 'rule:kin:2:7') >= 0);
  assert.notStrictEqual(idx(m, 'rule:kin:1:7'), idx(m, 'rule:kin:2:7'));
  assert.ok(idx(m, 'rule:toplevel:1:1') >= 0 && idx(m, 'rule:toplevel:2:1') >= 0);
  assert.ok(idx(m, 'rule:kin:7') < 0);
  // 各ルールノードの親は 1 つだけ（親が複数のエッジは作らない）
  const rk = m.kinds.indexOf('rule');
  for (let i = 0; i < m.id.length; i++) {
    if (m.kind[i] !== rk) continue;
    assert.strictEqual(m.edges.filter(e => e[1] === i && e[2] === 0).length, 1, m.id[i]);
  }
});

test('モデル: 親子エッジ book → chapter → rule → question', async () => {
  const m = await model();
  const has = (a, b, t) => m.edges.some(e => e[0] === idx(m, a) && e[1] === idx(m, b) && e[2] === t);
  assert.ok(has('book:kin', 'ch:kin:1', 0));
  assert.ok(has('ch:kin:1', 'rule:kin:1:7', 0));
  assert.ok(has('rule:kin:1:7', 'q:1', 0));
  assert.ok(has('rule:kin:1:7', 'q:2', 0));
  assert.ok(has('rule:kin:2:7', 'q:3', 0));
  assert.ok(has('rule:sekai:1:1', 'q:10', 0) && has('rule:sekai:1:1', 'q:11', 0), 'b なしは世界一');
  assert.ok(has('rule:sekai:1:2', 'q:12', 0));
  assert.ok(has('book:toplevel', 'ch:toplevel:2', 0));
});

test('モデル: 概念・Trap エッジは question → concept / trap', async () => {
  const m = await model();
  const has = (a, b, t) => m.edges.some(e => e[0] === idx(m, a) && e[1] === idx(m, b) && e[2] === t);
  assert.ok(has('q:1', 'con:A概念', 1));
  assert.ok(has('q:2', 'con:B概念', 1));
  assert.ok(has('q:1', 'trap:Trap_01_罠', 2));
  assert.ok(!has('q:3', 'con:A概念', 1));
  assert.strictEqual(m.edges.filter(e => e[2] === 1).length, 9);
  assert.strictEqual(m.edges.filter(e => e[2] === 2).length, 1);
  // 使われない概念もノードにはある
  assert.ok(idx(m, 'con:未使用概念') >= 0);
  assert.deepStrictEqual(m.text[idx(m, 'con:A概念')], { desc: 'A の説明' });
  assert.deepStrictEqual(m.text[idx(m, 'trap:Trap_01_罠')], { desc: '罠の説明', advice: '対処' });
});

test('Review Focus 1: 概念リンクのない問題は unmatchedQids に入り、親エッジはあるが概念エッジはない', async () => {
  const m = await model();
  assert.deepStrictEqual([...m.unmatchedQids].sort((a, b) => a - b), [4, 12]);
  for (const id of [4, 12]) {
    const q = idx(m, 'q:' + id);
    assert.strictEqual(m.edges.filter(e => e[1] === q && e[2] === 0).length, 1, '親エッジ');
    assert.strictEqual(m.edges.filter(e => e[0] === q && e[2] !== 0).length, 0, '概念・Trap エッジなし');
  }
});

test('モデル: 存在しない概念・Trap へのリンクは dangling に報告し、エッジは作らない', async () => {
  const input = buildInput();
  input.byApp.set(3, V(3, ['B概念', '幽霊概念'], ['Trap_99_幽霊']));
  const { buildModel } = await lib('model.mjs');
  const m = buildModel(input);
  assert.deepStrictEqual([...m.dangling].sort(), ['00_Concepts/幽霊概念', '04_Traps/Trap_99_幽霊']);
  assert.ok(idx(m, 'con:幽霊概念') < 0);
  const clean = await model();
  assert.deepStrictEqual(clean.dangling, []);
});

test('モデル: アプリの問題 id の重複は例外', async () => {
  const { buildModel } = await lib('model.mjs');
  const input = buildInput();
  input.app.push({ ...input.app[0] });
  assert.throws(() => buildModel(input), /重複|duplicate/i);
});

// ---- encode
function evalGraph(src) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.__G = GRAMMAR_GRAPH;', ctx);
  return JSON.parse(JSON.stringify(ctx.__G));
}

test('encodeGraph: vm で評価でき、列の長さが揃い、座標は整数', async () => {
  const { encodeGraph } = await lib('encode.mjs');
  const m = await model();
  const n = m.id.length;
  const xs = m.id.map((_, i) => i * 1.4 - 3.6);
  const ys = m.id.map((_, i) => 100.5 - i * 0.7);
  const src = encodeGraph(m, xs, ys);
  assert.ok(src.startsWith('const GRAMMAR_GRAPH = {') && src.trimEnd().endsWith('};'));
  const g = evalGraph(src);
  assert.strictEqual(g.version, 3);
  assert.deepStrictEqual(g.kinds, m.kinds);
  for (const col of ['id', 'kind', 'label', 'x', 'y', 'qid']) assert.strictEqual(g[col].length, n, col);
  assert.ok(g.x.every(Number.isInteger) && g.y.every(Number.isInteger));
  assert.strictEqual(g.x[2], Math.round(xs[2]));
  assert.strictEqual(g.edges.length, m.edges.length * 3, 'エッジは平ら');
  assert.deepStrictEqual(g.edges.slice(0, 3), m.edges[0]);
  assert.deepStrictEqual(g.text, JSON.parse(JSON.stringify(m.text)));
  assert.deepStrictEqual(g.id, m.id);
});

test('encodeGraph: 座標の長さが違えば例外', async () => {
  const { encodeGraph } = await lib('encode.mjs');
  const m = await model();
  assert.throws(() => encodeGraph(m, [0], [0]));
});

test('encodeGraph: qids と members / memberStart', async () => {
  const { encodeGraph } = await lib('encode.mjs');
  const m = await model();
  const n = m.id.length;
  const g = evalGraph(encodeGraph(m, new Array(n).fill(0), new Array(n).fill(0)));

  // qids: question ノードの並び順に、全問が 1 回ずつ
  const qk = g.kinds.indexOf('question');
  const expectQids = g.id.map((_, i) => i).filter(i => g.kind[i] === qk).map(i => g.qid[i]);
  assert.deepStrictEqual(g.qids, expectQids);
  assert.strictEqual(new Set(g.qids).size, 9);

  // memberStart: 長さ n+1、単調、最後は members.length
  assert.strictEqual(g.memberStart.length, n + 1);
  assert.strictEqual(g.memberStart[0], 0);
  for (let i = 0; i < n; i++) assert.ok(g.memberStart[i + 1] >= g.memberStart[i]);
  assert.strictEqual(g.memberStart[n], g.members.length);

  const memberQids = id => {
    const i = g.id.indexOf(id);
    return g.members.slice(g.memberStart[i], g.memberStart[i + 1]).map(o => g.qids[o]).sort((a, b) => a - b);
  };
  // どのノードでも重複なし
  for (let i = 0; i < n; i++) {
    const s = g.members.slice(g.memberStart[i], g.memberStart[i + 1]);
    assert.strictEqual(new Set(s).size, s.length, g.id[i]);
    assert.ok(s.every(o => Number.isInteger(o) && o >= 0 && o < g.qids.length));
  }
  assert.deepStrictEqual(memberQids('con:A概念'), [1, 2, 10, 11, 21], '概念の配下 = その概念にリンクした問題');
  assert.deepStrictEqual(memberQids('con:B概念'), [2, 3, 11, 20]);
  assert.deepStrictEqual(memberQids('con:未使用概念'), []);
  assert.deepStrictEqual(memberQids('trap:Trap_01_罠'), [1]);
  assert.deepStrictEqual(memberQids('book:kin'), [1, 2, 3, 4], '本の配下 = 本の全問');
  assert.deepStrictEqual(memberQids('book:sekai'), [10, 11, 12]);
  assert.deepStrictEqual(memberQids('ch:kin:1'), [1, 2]);
  assert.deepStrictEqual(memberQids('rule:kin:2:7'), [3]);
  assert.deepStrictEqual(memberQids('rule:sekai:1:1'), [10, 11]);
  assert.deepStrictEqual(memberQids('q:1'), [], '問題ノード自身の配下は空');
});
