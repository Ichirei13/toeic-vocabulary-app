const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const R = require('../../src/graph-report.js');
const F = require('../../src/graph-force.js');
const M = require('../../src/mastery.js');

const KINDS = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
const NEVER_DUE = () => false;

function makeGraph(nodes) {
  const qids = [];
  const ord = new Map();
  const memberStart = [0];
  const members = [];
  for (const n of nodes) {
    for (const q of (n.members || [])) {
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
    qids,
    memberStart,
    members,
  };
}

const SAMPLE_GRAPH = makeGraph([
  { id: 'book:kin', kind: 'book', label: '金の文法', members: [1, 2, 3] },
  { id: 'book:sekai', kind: 'book', label: '世界一', members: [4, 5] },
  { id: 'con:SVOC（文の骨格）', kind: 'concept', label: 'SVOC（文の骨格）', members: [1, 2, 4] },
  { id: 'con:能動態と受動態', kind: 'concept', label: '能動態と受動態', members: [3, 5] },
  { id: 'trap:t1', kind: 'trap', label: '時制の罠', members: [2, 5] },
  { id: 'q:1', kind: 'question', label: '#1', members: [1], qid: 1 },
  { id: 'q:2', kind: 'question', label: '#2', members: [2], qid: 2 },
  { id: 'q:3', kind: 'question', label: '#3', members: [3], qid: 3 },
  { id: 'q:4', kind: 'question', label: '#4', members: [4], qid: 4 },
  { id: 'q:5', kind: 'question', label: '#5', members: [5], qid: 5 },
]);

test('shortConceptLabel: 既知の 13 概念と未知ラベルをすっきりした短縮名にする', () => {
  assert.equal(R.shortConceptLabel('SVOC（文の骨格）'), 'SVOC');
  assert.equal(R.shortConceptLabel('接続詞 vs 前置詞の識別'), '接続詞/前置詞');
  assert.equal(R.shortConceptLabel('未知のとても長い概念名（補足説明つき）'), '未知のとても長い概…');
});

test('computeGraphReport: 空の記録では NaN を出さず accuracy=null, coverage=0, unseen', () => {
  const rep = R.computeGraphReport(SAMPLE_GRAPH, {}, {}, NEVER_DUE);
  assert.equal(rep.summary.total, 5);
  assert.equal(rep.summary.attempted, 0);
  assert.equal(rep.summary.answered, 0);
  assert.equal(rep.summary.correct, 0);
  assert.equal(rep.summary.weak, 0);
  assert.equal(rep.summary.due, 0);
  assert.equal(rep.summary.accuracy, null);
  assert.equal(rep.summary.coverage, 0);
  assert.equal(rep.summary.state, 'unseen');
  assert.equal(rep.concepts.length, 2);
  assert.equal(rep.concepts[0].accuracy, null);
  assert.equal(rep.concepts[0].state, 'unseen');
});

test('computeGraphReport: 教材別フィルタが概念・ひっかけ・サマリーへ正確に反映される', () => {
  const stats = {
    1: { a: 4, c: 4 }, // kin / SVOC: 4/4
    2: { a: 4, c: 1 }, // kin / SVOC + trap: 1/4
    3: { a: 3, c: 3 }, // kin / 受動態: 3/3
    4: { a: 5, c: 0 }, // sekai / SVOC: 0/5
    // 5 は未着手 (sekai / 受動態 + trap)
  };
  const weak = {
    2: { due: 100 },
    4: { due: 9999999999999 },
  };
  const isDue = e => e.due === 100;

  // 全体
  const all = R.computeGraphReport(SAMPLE_GRAPH, stats, weak, isDue, {
    conceptOrder: F.GRAMMAR_CONCEPT_ORDER,
  });
  assert.equal(all.summary.total, 5);
  assert.equal(all.summary.attempted, 4);
  assert.equal(all.summary.answered, 16);
  assert.equal(all.summary.correct, 8);
  assert.equal(all.summary.accuracy, 0.5);
  assert.equal(all.summary.coverage, 0.8);
  assert.equal(all.summary.weak, 2);
  assert.equal(all.summary.due, 1);

  // 概念順が GRAMMAR_CONCEPT_ORDER に従う（SVOC -> 受動態）
  assert.deepEqual(all.concepts.map(c => c.id), ['con:SVOC（文の骨格）', 'con:能動態と受動態']);
  assert.equal(all.concepts[0].total, 3);
  assert.equal(all.concepts[0].answered, 13);
  assert.equal(all.concepts[0].correct, 5);
  assert.equal(all.concepts[0].weak, 2);
  assert.equal(all.concepts[0].due, 1);

  // 金の文法だけに絞る（問題 1, 2, 3 のみ）
  const kin = R.computeGraphReport(SAMPLE_GRAPH, stats, weak, isDue, {
    book: 'kin',
    conceptOrder: F.GRAMMAR_CONCEPT_ORDER,
  });
  assert.equal(kin.summary.total, 3);
  assert.equal(kin.summary.attempted, 3);
  assert.equal(kin.summary.answered, 11);
  assert.equal(kin.summary.correct, 8);
  assert.equal(kin.summary.weak, 1);
  assert.equal(kin.summary.due, 1);
  assert.equal(kin.concepts[0].total, 2); // q1, q2 のみ（q4 は除外）
  assert.equal(kin.concepts[0].correct, 5);
  assert.equal(kin.concepts[1].total, 1); // q3 のみ
  assert.equal(kin.concepts[1].accuracy, 1);
  assert.equal(kin.concepts[1].state, 'good'); // 3/3 → (3+1)/(3+2)=0.8 → good
  assert.equal(kin.concepts[0].state, 'due');  // 要復習 1 問を含む（computeMastery と同じく、正答率より要復習を優先）
  assert.equal(all.concepts[0].state, 'due');  // 要復習 1 問を含む
  assert.equal(kin.traps[0].total, 1); // q2 のみ

  // books 一覧は比較のため常に 4 冊（サンプルでは 2 冊）それぞれの総数を保つ
  assert.equal(kin.books.length, 2);
  assert.equal(kin.books[0].selected, true);
  assert.equal(kin.books[1].selected, false);
  assert.equal(kin.books[1].total, 2);
});

test('computeGraphReport: 不正値（NaN・__proto__・負数・範囲外 c>a）でも例外や NaN を出さない', () => {
  const stats = {
    1: { a: 'bad', c: 1 },
    2: { a: 2, c: 99 },
    3: { a: 2, c: -3 },
    __proto__: { a: 10, c: 10 },
  };
  const rep = R.computeGraphReport(SAMPLE_GRAPH, stats, null, () => { throw new Error('boom'); });
  assert.equal(rep.summary.answered, 4);
  assert.equal(rep.summary.correct, 2);
  assert.equal(Number.isFinite(rep.summary.accuracy), true);
  assert.equal(rep.summary.due, 0);
});

test('sortReportItems: weakness 順は解答済み・苦手ありの低正答率を先頭にし、完全未着手を末尾へ回す', () => {
  const items = [
    { id: 'unseen', answered: 0, weak: 0, accuracy: null, total: 50 },
    { id: 'strong', answered: 20, weak: 0, accuracy: 0.9, total: 20 },
    { id: 'weakLow', answered: 10, weak: 3, accuracy: 0.3, total: 30 },
    { id: 'weakSameLowMoreWeak', answered: 10, weak: 5, accuracy: 0.3, total: 30 },
    { id: 'onlyWeakUnanswered', answered: 0, weak: 2, accuracy: null, total: 10 },
  ];
  const sorted = R.sortReportItems(items, 'weakness');
  assert.deepEqual(
    sorted.map(x => x.id),
    ['weakSameLowMoreWeak', 'weakLow', 'onlyWeakUnanswered', 'strong', 'unseen']
  );
  // 元の配列は変更しない
  assert.equal(items[0].id, 'unseen');
});

test('computeRadarGeometry: 12 時から時計回りに配置し、値 0..1 が中心〜外周に収まる', () => {
  const items = [
    { id: 'a', label: 'A', shortLabel: 'A', accuracy: 1.0, coverage: 0.5, state: 'good', weak: 0 },
    { id: 'b', label: 'B', shortLabel: 'B', accuracy: 0.5, coverage: 1.0, state: 'mid', weak: 1 },
    { id: 'c', label: 'C', shortLabel: 'C', accuracy: null, coverage: 0.0, state: 'unseen', weak: 0 },
    { id: 'd', label: 'D', shortLabel: 'D', accuracy: 0.0, coverage: 0.25, state: 'weak', weak: 2 },
  ];
  const geo = R.computeRadarGeometry(items, { size: 300, radius: 100, labelOffset: 20 });
  assert.equal(geo.cx, 150);
  assert.equal(geo.cy, 150);
  assert.equal(geo.axes.length, 4);
  // 0 番目（12時方向）: accuracy 1.0 -> (150, 50)
  assert.ok(Math.abs(geo.axes[0].accPoint.x - 150) < 1e-6);
  assert.ok(Math.abs(geo.axes[0].accPoint.y - 50) < 1e-6);
  assert.equal(geo.axes[0].textAnchor, 'middle');
  // 1 番目（3時方向）: accuracy 0.5 -> (200, 150)
  assert.ok(Math.abs(geo.axes[1].accPoint.x - 200) < 1e-6);
  assert.ok(Math.abs(geo.axes[1].accPoint.y - 150) < 1e-6);
  assert.equal(geo.axes[1].textAnchor, 'start');
  // 2 番目（6時方向）: accuracy null -> 中心 (150, 150)
  assert.ok(Math.abs(geo.axes[2].accPoint.x - 150) < 1e-6);
  assert.ok(Math.abs(geo.axes[2].accPoint.y - 150) < 1e-6);
  // 3 番目（9時方向）: coverage 0.25 -> (125, 150)
  assert.ok(Math.abs(geo.axes[3].covPoint.x - 125) < 1e-6);
  assert.ok(Math.abs(geo.axes[3].covPoint.y - 150) < 1e-6);
  assert.equal(geo.axes[3].textAnchor, 'end');
  assert.equal(geo.rings.length, 5);
  assert.equal(geo.rings[3].isTarget, true); // 80% ライン
});

test('computeRadarGeometry: 13 軸のとき、真下に近い 2 軸（代名詞・名詞の位置）は中央揃えにして隣のラベルにかぶせない', () => {
  const items = Array.from({ length: 13 }, (_, i) => ({ id: 'c' + i, label: 'L' + i, shortLabel: 'L' + i, accuracy: 0.5, coverage: 0.5 }));
  const geo = R.computeRadarGeometry(items, { width: 420, height: 330, radius: 76, labelOffset: 16 });
  // 6 番目・7 番目は 6 時方向から左右に約 14 度（|cos| ≈ 0.24）。右揃え・左揃えにすると横へ伸びて隣の軸のラベルに重なる
  assert.equal(geo.axes[6].textAnchor, 'middle');
  assert.equal(geo.axes[7].textAnchor, 'middle');
  // 中央揃えの 2 軸は左右へ外側にずらし、中心どうしを 56 以上離す（「100%」の行どうしが重ならないように）
  assert.ok(geo.axes[6].labelPos.x - geo.axes[7].labelPos.x >= 56, `真下の 2 軸のラベルの間隔: ${geo.axes[6].labelPos.x - geo.axes[7].labelPos.x}`);
  // 真上ちょうどの軸はずらさない
  assert.ok(Math.abs(geo.axes[0].labelPos.x - 210) < 1e-6);
  // 真上（0 番）は中央、その隣（1 番・12 番、|cos| ≈ 0.46）は外向きのまま
  assert.equal(geo.axes[0].textAnchor, 'middle');
  assert.equal(geo.axes[1].textAnchor, 'start');
  assert.equal(geo.axes[12].textAnchor, 'end');
});

test('実グラフ (GRAMMAR_GRAPH): 13 概念・12 Trap・4 教材の集計と合計 983 問が一致する', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  const ctx = {};
  vm.runInNewContext(code + '; this.GRAMMAR_GRAPH = GRAMMAR_GRAPH;', ctx);
  const g = ctx.GRAMMAR_GRAPH;
  const rep = R.computeGraphReport(g, {}, {}, NEVER_DUE, {
    conceptOrder: F.GRAMMAR_CONCEPT_ORDER,
  });
  assert.equal(rep.summary.total, 983);
  assert.equal(rep.concepts.length, 13);
  assert.equal(rep.traps.length, 12);
  assert.equal(rep.books.length, 4);
  const bookTotal = rep.books.reduce((s, b) => s + b.total, 0);
  assert.equal(bookTotal, 983);
  // 先頭は SVOC
  assert.equal(rep.concepts[0].id, 'con:SVOC（文の骨格）');
});

test('computeGraphReport: conceptOrder 省略時（graph-force.js 未読込時）も既定の 13 概念順を維持する', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  const ctx = {};
  vm.runInNewContext(code + '; this.GRAMMAR_GRAPH = GRAMMAR_GRAPH;', ctx);
  const g = ctx.GRAMMAR_GRAPH;
  const repNoOrder = R.computeGraphReport(g, {}, {}, NEVER_DUE);
  assert.deepEqual(repNoOrder.concepts.map(c => c.id), F.GRAMMAR_CONCEPT_ORDER);
});

test('sortReportItems & summary: total=0（収録なし）は最下位、苦手あり67%の単一概念は得意ではなく要強化になる', () => {
  const items = [
    { id: 'unavailable', total: 0, answered: 0, weak: 0, accuracy: null },
    { id: 'unseen', total: 10, answered: 0, weak: 0, accuracy: null },
    { id: 'weak', total: 10, answered: 3, weak: 1, accuracy: 0.5 },
  ];
  assert.deepEqual(R.sortReportItems(items, 'weakness').map(x => x.id), ['weak', 'unseen', 'unavailable']);

  const rep = R.computeGraphReport(
    SAMPLE_GRAPH,
    { 1: { a: 3, c: 2 } }, // SVOC: 67%, 苦手 1 問（唯一の解答済み概念）
    { 1: { due: 9999999999999 } },
    NEVER_DUE
  );
  assert.equal(rep.summary.strongest, null);
  assert.equal(rep.summary.weakest?.id, 'con:SVOC（文の骨格）');
});

function loadRealGraph() {
  const code = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  const ctx = {};
  vm.runInNewContext(code + '; this.GRAMMAR_GRAPH = GRAMMAR_GRAPH;', ctx);
  return ctx.GRAMMAR_GRAPH;
}

test('computeGraphReport: 概念・ひっかけ・教材の state は computeMastery と一致する（実グラフ、苦手・要復習あり）', () => {
  const g = loadRealGraph();
  const stats = {}, weak = {};
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.qids.forEach(q => {
    if (rnd() < 0.6) { const a = 1 + Math.floor(rnd() * 6); stats[q] = { a, c: Math.floor(a * rnd()) }; }
    if (rnd() < 0.08) weak[q] = { due: rnd() < 0.3 ? 1 : 2 };
  });
  const isDue = e => e.due === 1;
  const m = M.computeMastery(g, stats, weak, isDue);
  const rep = R.computeGraphReport(g, stats, weak, isDue, { conceptOrder: F.GRAMMAR_CONCEPT_ORDER });
  for (const it of [...rep.concepts, ...rep.traps, ...rep.books]) {
    assert.equal(it.state, M.MASTERY_STATES[m.state[it.nodeIndex]], `${it.id} の state がネットワーク図と違う`);
  }
});

test('computeGraphReport: 正答率 90% でも苦手があれば weak、要復習があれば due', () => {
  const stats = { 1: { a: 10, c: 9 }, 2: { a: 10, c: 9 }, 4: { a: 10, c: 9 }, 3: { a: 10, c: 9 }, 5: { a: 10, c: 9 } };
  const weakOnly = R.computeGraphReport(SAMPLE_GRAPH, stats, { 1: { due: 2 } }, () => false);
  assert.equal(weakOnly.concepts[0].state, 'weak'); // SVOC: 90%・苦手 1
  assert.equal(weakOnly.concepts[1].state, 'good'); // 受動態: 90%・苦手 0
  const due = R.computeGraphReport(SAMPLE_GRAPH, stats, { 1: { due: 1 } }, e => e.due === 1);
  assert.equal(due.concepts[0].state, 'due');
  assert.equal(due.summary.state, 'due');
});

test('summary.strongest / weakest: 着手した問題が 3 問未満の分野は、正答率だけでは得意にも要強化にもならない', () => {
  const g = makeGraph([
    { id: 'con:SVOC（文の骨格）', kind: 'concept', label: 'SVOC（文の骨格）', members: [1, 2, 3, 4] },
    { id: 'con:能動態と受動態', kind: 'concept', label: '能動態と受動態', members: [5, 6, 7, 8] },
    { id: 'con:分詞（現在分詞・過去分詞）', kind: 'concept', label: '分詞（現在分詞・過去分詞）', members: [9, 10, 11] },
  ]);
  const stats = {
    1: { a: 3, c: 3 },                                    // SVOC: 1 問を 3 回解いて全問正解（着手 1 問）
    5: { a: 2, c: 2 }, 6: { a: 2, c: 2 }, 7: { a: 2, c: 1 }, // 受動態: 着手 3 問・5/6 = 83%
    9: { a: 1, c: 0 },                                    // 分詞: 1 問 1 回だけ不正解（着手 1 問）
  };
  const rep = R.computeGraphReport(g, stats, {}, () => false);
  assert.equal(rep.summary.strongest?.id, 'con:能動態と受動態', '着手 1 問・100% の SVOC は得意にしない');
  assert.equal(rep.summary.weakest, null, '着手 1 問・0% の分詞は、苦手登録がなければ要強化にしない');

  const withWeak = R.computeGraphReport(g, stats, { 9: { due: 2 } }, () => false);
  assert.equal(withWeak.summary.weakest?.id, 'con:分詞（現在分詞・過去分詞）', '苦手登録があれば着手数に関係なく要強化の候補');
});

test('computeGraphReport: 問題の内訳（正解・克服・苦手・未着手）は合計が問題数になり、詳細シートの状態の数と一致する（実グラフ）', () => {
  const D = require('../../src/graph-detail.js');
  const g = loadRealGraph();
  const stats = {}, weak = {};
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.qids.forEach(q => {
    if (rnd() < 0.6) { const a = 1 + Math.floor(rnd() * 4); stats[q] = { a, c: rnd() < 0.5 ? a : Math.floor(a * rnd()) }; }
    if (rnd() < 0.1) weak[q] = { due: 2 };
  });
  const m = M.computeMastery(g, stats, weak, () => false);
  for (const book of ['all', 'kin']) {
    const rep = R.computeGraphReport(g, stats, weak, () => false, { book });
    for (const it of [...rep.concepts, ...rep.traps]) {
      assert.equal(it.neverMissed + it.overcome + it.weak + it.untouched, it.total, `${book} / ${it.id} の内訳の合計`);
      if (it.total === 0) continue;
      const d = D.buildDetail(g, m, it.nodeIndex, { stats, weak, book: book === 'all' ? null : book });
      const count = s => d.allQids.length && d.questions.length === d.allQids.length
        ? d.questions.filter(q => q.status === s).length : null;
      if (count('weak') === null) continue; // 一覧が 200 問で打ち切られる項目は数えない
      assert.equal(it.neverMissed, count('correct'), `${book} / ${it.id} の正解`);
      assert.equal(it.overcome, count('overcome'), `${book} / ${it.id} の克服`);
      assert.equal(it.weak, count('weak'), `${book} / ${it.id} の苦手`);
      assert.equal(it.untouched, count('unseen'), `${book} / ${it.id} の未着手`);
    }
  }
});

test('computeGraphReport: 内訳の例（苦手は解答の有無によらず苦手、苦手でない解答済みは全問正解なら正解・それ以外は克服）', () => {
  const stats = { 1: { a: 2, c: 2 }, 2: { a: 3, c: 1 }, 4: { a: 1, c: 1 } };
  const weak = { 2: { due: 2 }, 5: { due: 2 } };
  const rep = R.computeGraphReport(SAMPLE_GRAPH, { ...stats, 3: { a: 2, c: 1 } }, weak, () => false);
  // SVOC: 1 正解 / 2 苦手 / 4 正解
  assert.deepEqual(['neverMissed', 'overcome', 'weak', 'untouched'].map(k => rep.concepts[0][k]), [2, 0, 1, 0]);
  // 受動態: 3 克服（2 回中 1 回正解・苦手でない） / 5 苦手（未解答でも苦手）
  assert.deepEqual(['neverMissed', 'overcome', 'weak', 'untouched'].map(k => rep.concepts[1][k]), [0, 1, 1, 0]);
});
