// 単体テスト用の小さなグラフ（本 2 冊・問題 6 問・概念 3・ひっかけ 1）。形は data/grammar_graph.js と同じ列の配列。
// 添字: 0 book:kin / 1 ch:kin:1 / 2 rule:kin:1:1 / 3 q:1 / 4 q:2 / 5 ch:kin:2 / 6 q:3 / 7 q:4
//       8 book:sekai / 9 ch:sekai:1 / 10 q:5 / 11 q:6 / 12 con:a / 13 con:b / 14 con:c / 15 trap:t
const KINDS = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
const NODES = [
  ['book:kin', 'book', [1, 2, 3, 4]], ['ch:kin:1', 'chapter', [1, 2]], ['rule:kin:1:1', 'rule', [1, 2]],
  ['q:1', 'question', [1]], ['q:2', 'question', [2]], ['ch:kin:2', 'chapter', [3, 4]],
  ['q:3', 'question', [3]], ['q:4', 'question', [4]],
  ['book:sekai', 'book', [5, 6]], ['ch:sekai:1', 'chapter', [5, 6]], ['q:5', 'question', [5]], ['q:6', 'question', [6]],
  ['con:a', 'concept', [1, 5]], ['con:b', 'concept', [3]], ['con:c', 'concept', [5, 6]], ['trap:t', 'trap', [2, 6]],
];
const EDGES = [
  0, 1, 0, 1, 2, 0, 2, 3, 0, 2, 4, 0, 0, 5, 0, 5, 6, 0, 5, 7, 0, 8, 9, 0, 9, 10, 0, 9, 11, 0,
  3, 12, 1, 10, 12, 1, 6, 13, 1, 10, 14, 1, 11, 14, 1,
  4, 15, 2, 11, 15, 2,
];

function makeFixture() {
  const qids = [1, 2, 3, 4, 5, 6];
  const memberStart = [0];
  const members = [];
  for (const [, , ms] of NODES) {
    for (const q of ms) members.push(qids.indexOf(q));
    memberStart.push(members.length);
  }
  return {
    version: 3,
    kinds: [...KINDS],
    id: NODES.map(n => n[0]),
    kind: NODES.map(n => KINDS.indexOf(n[1])),
    label: NODES.map(n => n[0]),
    x: NODES.map((_, i) => (i % 4) * 100),
    y: NODES.map((_, i) => Math.floor(i / 4) * 100),
    qid: NODES.map(n => (n[1] === 'question' ? n[2][0] : 0)),
    qids, memberStart, members,
    edges: [...EDGES],
    text: {},
  };
}

// ノード添字で引く理解度の代用（mastery.weak / mastery.answered と同じ形）。weak・answered は { ノード添字: 値 }
function makeMastery(graph, weak = {}, answered = {}) {
  const n = graph.id.length;
  const w = new Int32Array(n), a = new Int32Array(n);
  for (const k of Object.keys(weak)) w[k] = weak[k];
  for (const k of Object.keys(answered)) a[k] = answered[k];
  return { weak: w, answered: a };
}

module.exports = { makeFixture, makeMastery, KINDS };
