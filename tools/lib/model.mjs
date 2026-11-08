// 文法グラフのモデル（ノードとエッジ。座標なし）。
// 入力: アプリの問題（RAW_GRAMMAR）、matchQuestions の byApp、Vault の概念・Trap。
// ノード id: book:<本> / ch:<本>:<ch> / rule:<本>:<ch>:<rule.number> / con:<概念 id> / trap:<Trap id> / q:<問題 id>
// 世界一は rule を持たないので rule:sekai:<ch>:<その章で th_title が初めて出た順の連番>。
// ルールの鍵は (本, ch, rule.number)。同じ rule.number が複数の章に出ても章ごとに別ノードにする（親は常に 1 つ）。
import { GRAMMAR_BOOK_LABELS } from './books.mjs';

export const KINDS = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
const [BOOK, CHAPTER, RULE, CONCEPT, TRAP, QUESTION] = KINDS.map((_, i) => i);
const PARENT = 0, CONCEPT_EDGE = 1, TRAP_EDGE = 2;
const LABEL_MAX = 14;

const cut = s => {
  const chars = [...String(s ?? '')];
  return chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX).join('') + '…' : chars.join('');
};
const bookOf = q => q.b || 'sekai';

// options.collapseSingleRuleQuestions（既定 false）: true のとき、問題が 1 つだけのルールはノードを作らず、
// その問題を章に直接つなぐ（ポラリス2 のように 1 問 1 ルールの本で、ルール層が図を重くするのを避ける案）。
export function buildModel({ app, byApp, concepts, traps }, { collapseSingleRuleQuestions = false } = {}) {
  const id = [], kind = [], label = [], qid = [];
  const edges = [];
  const text = {};
  const index = new Map(); // ノード id → 添字
  const edgeSeen = new Set();

  const addNode = (nodeId, k, lab, q = 0) => {
    const i = id.length;
    id.push(nodeId); kind.push(k); label.push(lab); qid.push(q);
    index.set(nodeId, i);
    return i;
  };
  const getNode = (nodeId, k, lab) => index.has(nodeId) ? index.get(nodeId) : addNode(nodeId, k, lab);
  const addEdge = (from, to, type) => {
    const key = from + ',' + to + ',' + type;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push([from, to, type]);
  };

  const seenQ = new Set();
  for (const q of app) {
    if (seenQ.has(q.id)) throw new Error('アプリの問題 id が重複しています: ' + q.id);
    seenQ.add(q.id);
  }

  // 階層（本 → 章 → ルール）。問題の並び順（アプリの順）で最初に出た順にノードを作る。
  // 種類ごとにまとめるため、先に階層だけ作り、概念・Trap、問題の順に足す。
  const sekaiTitles = new Map(); // 'ch' → Map(th_title → 連番)
  // 先に各問題のルール（鍵とラベル）を決める。1 問だけのルールを畳むかどうかの判断に問題数が要る。
  const ruleOf = new Map();       // 問題 id → { ruleId, ruleLabel }
  const ruleCount = new Map();    // ルール id → 問題数
  for (const q of app) {
    const b = bookOf(q);
    let ruleId, ruleLabel;
    if (q.rule) {
      ruleId = `rule:${b}:${q.ch}:${q.rule.number}`;
      ruleLabel = cut(q.rule.title);
    } else {
      const key = `${b}:${q.ch}`;
      if (!sekaiTitles.has(key)) sekaiTitles.set(key, new Map());
      const titles = sekaiTitles.get(key);
      if (!titles.has(q.th_title)) titles.set(q.th_title, titles.size + 1);
      ruleId = `rule:${b}:${q.ch}:${titles.get(q.th_title)}`;
      ruleLabel = cut(q.th_title);
    }
    ruleOf.set(q.id, { ruleId, ruleLabel });
    ruleCount.set(ruleId, (ruleCount.get(ruleId) || 0) + 1);
  }
  const parentOf = new Map();    // 問題 id → 親ノード（ルール、畳んだときは章）の添字
  for (const q of app) {
    const b = bookOf(q);
    const bi = getNode('book:' + b, BOOK, GRAMMAR_BOOK_LABELS[b] || b);
    const ci = getNode(`ch:${b}:${q.ch}`, CHAPTER, String(q.ch_title ?? ''));
    addEdge(bi, ci, PARENT);
    const { ruleId, ruleLabel } = ruleOf.get(q.id);
    if (collapseSingleRuleQuestions && ruleCount.get(ruleId) === 1) {
      parentOf.set(q.id, ci);
      continue;
    }
    const ri = getNode(ruleId, RULE, ruleLabel);
    addEdge(ci, ri, PARENT);
    parentOf.set(q.id, ri);
  }

  // 概念・Trap（Vault にあるものは使われなくても全部ノードにする）
  for (const c of concepts) {
    const i = getNode('con:' + c.id, CONCEPT, c.name);
    text[i] = { desc: c.desc };
  }
  for (const t of traps) {
    const i = getNode('trap:' + t.id, TRAP, t.name);
    text[i] = { desc: t.desc, advice: t.advice };
  }

  // 問題。概念・Trap のリンク先が無ければ dangling に報告する（黙って落とさない）
  const unmatchedQids = [];
  const dangling = new Set();
  for (const q of app) {
    const qi = addNode('q:' + q.id, QUESTION, '#' + q.id, q.id);
    addEdge(parentOf.get(q.id), qi, PARENT);
    const v = byApp.get(q.id);
    let links = 0;
    if (v) {
      for (const c of v.conceptIds) {
        if (index.has('con:' + c)) { addEdge(qi, index.get('con:' + c), CONCEPT_EDGE); links++; }
        else dangling.add('00_Concepts/' + c);
      }
      for (const t of v.trapIds) {
        if (index.has('trap:' + t)) addEdge(qi, index.get('trap:' + t), TRAP_EDGE);
        else dangling.add('04_Traps/' + t);
      }
    }
    if (links === 0) unmatchedQids.push(q.id); // Vault に対応がない、または概念リンクがない
  }

  return { kinds: [...KINDS], id, kind, label, qid, edges, text, unmatchedQids, dangling: [...dangling] };
}
