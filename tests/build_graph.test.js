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

// 既定は 1 問だけのルールを畳む。以下の model() は「全ルールをノードにする」経路（keep）で作る。
const KEEP = { collapseSingleRuleQuestions: false };
async function model(overrides, options = KEEP) {
  const { buildModel } = await lib('model.mjs');
  return buildModel(buildInput(overrides), options);
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
  const m = buildModel(input, KEEP);
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
  assert.deepStrictEqual(memberQids('q:1'), [1], '問題ノードは自分の序数だけを持つ');
  // 概念・Trap にリンクした問題でも、同じ概念の他の問題を拾わない
  assert.deepStrictEqual(memberQids('q:2'), [2]);
  assert.deepStrictEqual(memberQids('q:11'), [11]);
  assert.deepStrictEqual(memberQids('q:12'), [12], '未対応の問題も自分自身');
  const qi = g.id.indexOf('q:3');
  assert.deepStrictEqual(g.members.slice(g.memberStart[qi], g.memberStart[qi + 1]), [g.qids.indexOf(3)], '序数 = qids の添字');
  for (let i = 0; i < n; i++) if (g.kind[i] === qk) assert.strictEqual(g.memberStart[i + 1] - g.memberStart[i], 1, g.id[i]);
});

// ---- ルール層の畳み込み（collapseSingleRuleQuestions）
test('モデル: 既定は 1 問だけのルールを畳む（明示 true と同じ）。2 問以上のルールはノードを残す', async () => {
  const { buildModel } = await lib('model.mjs');
  const def = buildModel(buildInput());
  assert.deepStrictEqual(def, buildModel(buildInput(), { collapseSingleRuleQuestions: true }));
  assert.deepStrictEqual(def, buildModel(buildInput(), {}));
  assert.ok(idx(def, 'rule:kin:2:8') < 0, '1 問だけのルールにノードはない');
  assert.ok(idx(def, 'rule:kin:1:7') >= 0, '2 問のルールにはノードがある');
  assert.ok(def.edges.some(e => e[0] === idx(def, 'ch:kin:2') && e[1] === idx(def, 'q:4') && e[2] === 0), '問題 4 の親は章');
});

test('モデル: collapseSingleRuleQuestions=false（--keep-single-rules）は全ルールのノードを作る', async () => {
  const { buildModel } = await lib('model.mjs');
  const keep = buildModel(buildInput(), { collapseSingleRuleQuestions: false });
  const def = buildModel(buildInput());
  assert.ok(idx(keep, 'rule:kin:2:8') >= 0 && idx(keep, 'rule:sekai:1:2') >= 0 && idx(keep, 'rule:toplevel:2:1') >= 0);
  const rk = keep.kinds.indexOf('rule');
  assert.strictEqual(keep.kind.filter(k => k === rk).length, 7, 'ミニ入力のルール数は 7');
  assert.strictEqual(def.kind.filter(k => k === rk).length, 2, '畳むと 2（2 問以上の kin:1:7 と sekai:1:1）');
  assert.strictEqual(keep.id.length - def.id.length, 5);
});

test('モデル: 既定（collapse）は 1 問だけのルールを作らず、問題を章に直接つなぐ。members などの不変条件は保たれる', async () => {
  const { buildModel } = await lib('model.mjs');
  const { encodeGraph } = await lib('encode.mjs');
  const m = buildModel(buildInput());
  const has = (a, b, t) => m.edges.some(e => e[0] === idx(m, a) && e[1] === idx(m, b) && e[2] === t);
  // 1 問だけのルール: kin 2章のルール 7（q3）・ルール 8（q4）、sekai の 2 つ目（q12）、toplevel 各章（q20, q21）
  for (const rid of ['rule:kin:2:7', 'rule:kin:2:8', 'rule:sekai:1:2', 'rule:toplevel:1:1', 'rule:toplevel:2:1']) {
    assert.ok(idx(m, rid) < 0, rid + ' は作らない');
  }
  assert.ok(has('ch:kin:2', 'q:3', 0) && has('ch:kin:2', 'q:4', 0));
  assert.ok(has('ch:sekai:1', 'q:12', 0));
  assert.ok(has('ch:toplevel:1', 'q:20', 0) && has('ch:toplevel:2', 'q:21', 0));
  // 2 問以上のルールは残る
  assert.ok(idx(m, 'rule:kin:1:7') >= 0 && idx(m, 'rule:sekai:1:1') >= 0);
  assert.ok(has('rule:kin:1:7', 'q:1', 0) && has('rule:sekai:1:1', 'q:10', 0));
  // 問題の親は常に 1 つ、問題ノード数・概念エッジは変わらない
  const qk = m.kinds.indexOf('question');
  const qs = m.id.map((_, i) => i).filter(i => m.kind[i] === qk);
  assert.strictEqual(qs.length, 9);
  for (const i of qs) assert.strictEqual(m.edges.filter(e => e[1] === i && e[2] === 0).length, 1, m.id[i]);
  assert.strictEqual(m.edges.filter(e => e[2] === 1).length, 9);
  assert.deepStrictEqual([...m.unmatchedQids].sort((a, b) => a - b), [4, 12]);
  // 不変条件: members は本 > 章で過不足なく、question は自分だけ
  const n = m.id.length;
  const src = encodeGraph(m, new Array(n).fill(0), new Array(n).fill(0));
  const g = evalGraph(src);
  const memberQids = id => {
    const i = g.id.indexOf(id);
    return g.members.slice(g.memberStart[i], g.memberStart[i + 1]).map(o => g.qids[o]).sort((a, b) => a - b);
  };
  assert.deepStrictEqual(memberQids('book:kin'), [1, 2, 3, 4]);
  assert.deepStrictEqual(memberQids('ch:kin:2'), [3, 4]);
  assert.deepStrictEqual(memberQids('ch:sekai:1'), [10, 11, 12]);
  assert.deepStrictEqual(memberQids('q:12'), [12]);
});

// ---- 配置（d3-force が要る）
const HAS_D3 = fs.existsSync(path.resolve(__dirname, '..', 'tools', 'node_modules', 'd3-force', 'package.json'));
if (!HAS_D3) console.log('# SKIP: tools/node_modules に d3-force がないため、配置のテストを飛ばします（cd tools && npm ci で入ります）');
const d3test = (name, fn) => (HAS_D3 ? test(name, fn) : test(name, { skip: 'tools/node_modules/d3-force がありません' }, fn));

d3test('layout: 同じ入力から同じ座標（2 回）、整数で有限', async () => {
  const { layout } = await lib('layout.mjs');
  const m = await model();
  const a = layout(m);
  const b = layout(await model());
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.x.length, m.id.length);
  assert.strictEqual(a.y.length, m.id.length);
  for (const v of [...a.x, ...a.y]) assert.ok(Number.isFinite(v) && Number.isInteger(v), String(v));
});

d3test('layout: 衝突半径が効く（同じ座標なし・質問以外のノードどうしは最小距離を保つ）', async () => {
  const { layout } = await lib('layout.mjs');
  const m = await model();
  const { x, y } = layout(m);
  const qk = m.kinds.indexOf('question');
  let minAll = Infinity, minHub = Infinity;
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const d = Math.hypot(x[i] - x[j], y[i] - y[j]);
      assert.ok(d > 0, `${m.id[i]} と ${m.id[j]} が同じ座標`);
      minAll = Math.min(minAll, d);
      if (m.kind[i] !== qk && m.kind[j] !== qk) minHub = Math.min(minHub, d);
    }
  }
  // 問題以外（本・章・ルール・概念・Trap）の衝突半径はいちばん小さい rule で 7（二つで 14）。丸めと tick 数の誤差を見て 8 以上を要求する
  assert.ok(minHub >= 8, `問題以外の最小距離 ${minHub}`);
  assert.ok(minAll >= 2, `全体の最小距離 ${minAll}`);
});

d3test('layout: config の seed を変えると座標が変わる（種が効いている）', async () => {
  const { layout } = await lib('layout.mjs');
  const { LAYOUT } = await lib('layout-config.mjs');
  const m = await model();
  const a = layout(m);
  const b = layout(m, { ...LAYOUT, seed: LAYOUT.seed + 1 });
  assert.notDeepStrictEqual(a, b);
});

d3test('layout + encode: 生成される文字列が 2 回で一致する', async () => {
  const { layout } = await lib('layout.mjs');
  const { encodeGraph } = await lib('encode.mjs');
  const run = async () => { const m = await model(); const { x, y } = layout(m); return encodeGraph(m, x, y); };
  assert.strictEqual(await run(), await run());
});

d3test('layout: 既定（collapse）の入力でも動き、keep 版とは別のモデルになる', async () => {
  const { layout } = await lib('layout.mjs');
  const { buildModel } = await lib('model.mjs');
  const m = buildModel(buildInput());
  const { x, y } = layout(m);
  assert.strictEqual(x.length, m.id.length);
  assert.ok(m.id.length < (await model()).id.length);
});

d3test('layout: コミット済みの data/grammar_graph.js の座標を、同じモデルから再現できる（力の定義を動かしても変わらない）', async () => {
  const { layout } = await lib('layout.mjs');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'grammar_graph.js'), 'utf8');
  const g = vm.runInNewContext(src + '; GRAMMAR_GRAPH');
  const edges = [];
  for (let i = 0; i < g.edges.length; i += 3) edges.push([g.edges[i], g.edges[i + 1], g.edges[i + 2]]);
  const { x, y } = layout({ id: [...g.id], kind: [...g.kind], kinds: [...g.kinds], edges });
  let diff = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== g.x[i] || y[i] !== g.y[i]) diff++;
  assert.strictEqual(diff, 0, `座標が変わったノードが ${diff} 個ある`);
});

// ---- 生成コマンド（純粋関数の部分）
test('build: 未対応の問題・dangling があれば problems に出る', async () => {
  const { assemble } = await import(path.resolve(__dirname, '..', 'tools', 'build_grammar_graph.mjs'));
  assert.strictEqual(typeof assemble, 'function');
  const input = buildInput();
  const fake = { questions: [], concepts: CONCEPTS, traps: TRAPS };
  const { problems } = assemble(input.app, fake, { byApp: input.byApp, unmatched: [12] }, {});
  assert.ok(problems.some(p => /12/.test(p)), '未対応 12 を報告');
  const ok = assemble(input.app, fake, { byApp: input.byApp, unmatched: [] }, {});
  assert.deepStrictEqual(ok.problems, []);
  input.byApp.set(3, V(3, ['幽霊概念']));
  const dang = assemble(input.app, fake, { byApp: input.byApp, unmatched: [] }, {});
  assert.ok(dang.problems.some(p => /幽霊概念/.test(p)));
});

test('CLI: --out に値がなければ使い方エラー（終了コード 2）で、ファイルは書かない', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'tools', 'build_grammar_graph.mjs'), '/nonexistent-vault', '--out'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /--out/);
  const r2 = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'tools', 'build_grammar_graph.mjs'), '--keep-single-rules', '--bogus'], { encoding: 'utf8' });
  assert.strictEqual(r2.status, 2);
});

// ---- 生成物の契約（実データ。Vault は不要）
function loadArtifact() {
  const root = path.resolve(__dirname, '..');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'data', 'grammar_graph.js'), 'utf8') + '\n;this.__G = GRAMMAR_GRAPH;', ctx);
  const ctx2 = {};
  vm.createContext(ctx2);
  vm.runInContext(fs.readFileSync(path.join(root, 'data', 'grammar.js'), 'utf8') + '\n;this.__R = RAW_GRAMMAR;', ctx2);
  return { g: JSON.parse(JSON.stringify(ctx.__G)), raw: ctx2.__R };
}

test('生成物: version 3、列の長さが揃い、座標は整数、kinds の範囲', () => {
  const { g } = loadArtifact();
  assert.strictEqual(g.version, 3);
  assert.deepStrictEqual(g.kinds, ['book', 'chapter', 'rule', 'concept', 'trap', 'question']);
  const n = g.id.length;
  for (const col of ['kind', 'label', 'x', 'y', 'qid']) assert.strictEqual(g[col].length, n, col);
  assert.ok(g.x.every(Number.isInteger) && g.y.every(Number.isInteger));
  assert.ok(g.kind.every(k => Number.isInteger(k) && k >= 0 && k < g.kinds.length));
  assert.strictEqual(new Set(g.id).size, n, 'id は一意');
});

test('生成物: qids が RAW_GRAMMAR の全問と過不足なく一致', () => {
  const { g, raw } = loadArtifact();
  assert.strictEqual(raw.length, 983);
  assert.strictEqual(g.qids.length, 983);
  assert.strictEqual(new Set(g.qids).size, 983);
  assert.deepStrictEqual([...g.qids].sort((a, b) => a - b), Array.from(raw, q => q.id).sort((a, b) => a - b));
  const qk = g.kinds.indexOf('question');
  g.id.forEach((id, i) => {
    if (g.kind[i] === qk) assert.strictEqual(id, 'q:' + g.qid[i]);
    else assert.strictEqual(g.qid[i], 0);
  });
});

test('生成物: ノード数（book 4・chapter 51・rule 138・concept 13・trap 12・question 983）と総数', () => {
  const { g } = loadArtifact();
  const count = k => g.kind.filter(v => v === g.kinds.indexOf(k)).length;
  assert.strictEqual(count('book'), 4);
  // 1 問だけのルールは作らない既定（2026-11-08 決定）。全ルールを作ると 521 になる
  assert.strictEqual(count('rule'), 138);
  assert.strictEqual(g.id.length, 1201, 'ノード総数');
  assert.strictEqual(g.edges.length / 3, 3180, 'エッジ総数');
  assert.strictEqual(count('chapter'), 51);
  assert.strictEqual(count('concept'), 13);
  assert.strictEqual(count('trap'), 12);
  assert.strictEqual(count('question'), 983);
});

test('生成物: どのルールノードにも問題が 2 問以上ある（1 問だけのルールは章に直接つなぐ）', () => {
  const { g } = loadArtifact();
  const rk = g.kinds.indexOf('rule');
  g.id.forEach((id, i) => {
    if (g.kind[i] === rk) assert.ok(g.memberStart[i + 1] - g.memberStart[i] >= 2, id);
  });
});

test('生成物: 全エッジの端点が存在し、種類と向きが正しい', () => {
  const { g } = loadArtifact();
  const n = g.id.length;
  assert.strictEqual(g.edges.length % 3, 0);
  const K = g.kinds;
  const parents = new Array(n).fill(0);
  for (let e = 0; e < g.edges.length; e += 3) {
    const a = g.edges[e], b = g.edges[e + 1], t = g.edges[e + 2];
    assert.ok(Number.isInteger(a) && a >= 0 && a < n && Number.isInteger(b) && b >= 0 && b < n, 'endpoint ' + e);
    assert.ok([0, 1, 2].includes(t));
    if (t === 0) {
      parents[b]++;
      const ka = K[g.kind[a]], kb = K[g.kind[b]];
      assert.ok(
        (ka === 'book' && kb === 'chapter') || (ka === 'chapter' && (kb === 'rule' || kb === 'question')) || (ka === 'rule' && kb === 'question'),
        `親子の種類 ${g.id[a]} -> ${g.id[b]}`);
    } else {
      assert.strictEqual(K[g.kind[a]], 'question');
      assert.strictEqual(K[g.kind[b]], t === 1 ? 'concept' : 'trap');
    }
  }
  for (let i = 0; i < n; i++) {
    assert.strictEqual(parents[i], g.kind[i] === 0 || g.kind[i] === 3 || g.kind[i] === 4 ? 0 : 1, g.id[i] + ' の親の数');
  }
});

test('生成物: members / memberStart の整合', () => {
  const { g } = loadArtifact();
  const n = g.id.length;
  assert.strictEqual(g.memberStart.length, n + 1);
  assert.strictEqual(g.memberStart[0], 0);
  assert.strictEqual(g.memberStart[n], g.members.length);
  const slice = i => g.members.slice(g.memberStart[i], g.memberStart[i + 1]);
  for (let i = 0; i < n; i++) {
    assert.ok(g.memberStart[i + 1] >= g.memberStart[i]);
    const s = slice(i);
    assert.strictEqual(new Set(s).size, s.length, g.id[i]);
    assert.ok(s.every(o => Number.isInteger(o) && o >= 0 && o < g.qids.length));
  }
  const qk = g.kinds.indexOf('question');
  const bk = g.kinds.indexOf('book');
  let total = 0;
  const kids = Array.from({ length: n }, () => []);
  for (let e = 0; e < g.edges.length; e += 3) if (g.edges[e + 2] === 0) kids[g.edges[e]].push(g.edges[e + 1]);
  for (let i = 0; i < n; i++) {
    if (g.kind[i] === qk) assert.deepStrictEqual(slice(i), [g.qids.indexOf(g.qid[i])], g.id[i] + ' は自分だけ');
    else if (kids[i].length && g.kind[i] !== bk) {
      // 章・ルール: 子の members の和集合
      const u = new Set();
      for (const c of kids[i]) for (const o of slice(c)) u.add(o);
      assert.deepStrictEqual([...slice(i)].sort((a, b) => a - b), [...u].sort((a, b) => a - b), g.id[i]);
    }
    if (g.kind[i] === bk) total += slice(i).length;
  }
  assert.strictEqual(total, 983, '4 冊で全問を過不足なく分け合う');
  // 概念・Trap の members = その概念へリンクした問題
  const linked = new Map();
  for (let e = 0; e < g.edges.length; e += 3) if (g.edges[e + 2] !== 0) {
    if (!linked.has(g.edges[e + 1])) linked.set(g.edges[e + 1], new Set());
    linked.get(g.edges[e + 1]).add(g.qids.indexOf(g.qid[g.edges[e]]));
  }
  for (let i = 0; i < n; i++) if (g.kind[i] === 3 || g.kind[i] === 4) {
    assert.deepStrictEqual([...slice(i)].sort((a, b) => a - b), [...(linked.get(i) || [])].sort((a, b) => a - b), g.id[i]);
  }
});

test('生成物: 概念・Trap にだけ text があり、座標は有限の範囲に収まる', () => {
  const { g } = loadArtifact();
  for (const key of Object.keys(g.text)) assert.ok([3, 4].includes(g.kind[Number(key)]), g.id[Number(key)]);
  assert.ok(Math.max(...g.x.map(Math.abs)) < 20000 && Math.max(...g.y.map(Math.abs)) < 20000);
});
