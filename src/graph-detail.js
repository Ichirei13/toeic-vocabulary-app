// 文法グラフのノード詳細（詳細シートの中身）の組み立て。DOM にも保存にも触れない純関数。
// HTML は作らない（画面側が escapeHtml を通して組む）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  // graph.kinds の順（book, chapter, rule, concept, trap, question）に対応する表示名
  const KIND_LABELS = ['本', '章', 'ルール', '概念', 'ひっかけ(Trap)', '問題'];
  // MASTERY_STATES の順（unseen, due, weak, few, mid, good）に対応する表示名
  const STATE_LABELS = ['未着手', '要復習', '苦手', '練習不足', 'もう少し', '定着'];
  const KIND_NAMES = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];

  const MAX_QUESTIONS = 200;
  const TEXT_LIMIT = 60;

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function clip(s) {
    s = String(s);
    return s.length > TEXT_LIMIT ? s.slice(0, TEXT_LIMIT) + '…' : s;
  }

  // 問題文（先頭 60 字）。取れなければ null。getQuestion が例外を出しても落とさない。
  function questionText(ctx, qid) {
    if (!ctx || typeof ctx.getQuestion !== 'function') return null;
    try {
      const q = ctx.getQuestion(qid);
      if (q && typeof q.q === 'string' && q.q) return clip(q.q);
    } catch (e) { /* 無視 */ }
    return null;
  }

  // ルールの全文名。グラフの label は 14 字に縮めてあるので、先頭メンバー問題の
  // rule.title（無ければ世界一スタイルの th_title）から復元する。取れなければ null。
  function ruleFullTitle(ctx, qid) {
    if (!ctx || typeof ctx.getQuestion !== 'function') return null;
    try {
      const q = ctx.getQuestion(qid);
      if (!q) return null;
      if (q.rule && typeof q.rule.title === 'string' && q.rule.title) return q.rule.title;
      if (typeof q.th_title === 'string' && q.th_title) return q.th_title;
    } catch (e) { /* 無視 */ }
    return null;
  }

  // 並びの優先度: weak(0) → wrong(1) → unseen(2) → correct(3)
  const STATUS_RANK = { weak: 0, wrong: 1, unseen: 2, correct: 3 };

  function statusOf(stats, weak, qid) {
    const key = String(qid);
    if (hasOwn(weak, key)) return 'weak';
    if (hasOwn(stats, key)) {
      const rec = stats[key];
      if (rec && typeof rec === 'object') {
        const a = Math.floor(Number(rec.a));
        if (Number.isFinite(a) && a >= 1) {
          const c = Math.floor(Number(rec.c));
          return c === a ? 'correct' : 'wrong';
        }
      }
    }
    return 'unseen';
  }

  // graph, mastery(computeMastery の結果), nodeIndex, ctx = { stats, weak, getQuestion } から詳細を返す。
  // nodeIndex が範囲外・非整数なら null。
  function buildDetail(graph, mastery, nodeIndex, ctx) {
    if (!graph || !mastery || !Number.isInteger(nodeIndex)) return null;
    const n = graph.id ? graph.id.length : 0;
    if (nodeIndex < 0 || nodeIndex >= n) return null;
    ctx = ctx && typeof ctx === 'object' ? ctx : {};
    const stats = ctx.stats && typeof ctx.stats === 'object' ? ctx.stats : {};
    const weak = ctx.weak && typeof ctx.weak === 'object' ? ctx.weak : {};

    const kindIdx = graph.kind[nodeIndex];
    const kindName = graph.kinds ? graph.kinds[kindIdx] : KIND_NAMES[kindIdx];
    const label = graph.label && graph.label[nodeIndex] != null ? String(graph.label[nodeIndex]) : String(graph.id[nodeIndex]);

    // 問題番号の一覧（ノード自身が問題なら自分だけ）
    let qidList;
    if (kindName === 'question') {
      qidList = [graph.qid[nodeIndex]];
    } else {
      const seen = new Set();
      qidList = [];
      for (let k = graph.memberStart[nodeIndex]; k < graph.memberStart[nodeIndex + 1]; k++) {
        const o = graph.members[k];
        if (!(o >= 0 && o < graph.qids.length) || seen.has(o)) continue;
        seen.add(o);
        qidList.push(graph.qids[o]);
      }
    }

    // title: 問題ノードは問題文、ルールは先頭メンバー問題から復元した全文、それ以外はグラフの label
    let title = label;
    if (kindName === 'question') {
      const t = questionText(ctx, graph.qid[nodeIndex]);
      if (t != null) title = t;
    } else if (kindName === 'rule' && qidList.length > 0) {
      const t = ruleFullTitle(ctx, qidList[0]);
      if (t != null) title = t;
    }

    const items = qidList.map(qid => ({ qid, status: statusOf(stats, weak, qid) }));
    items.sort((x, y) => STATUS_RANK[x.status] - STATUS_RANK[y.status] || x.qid - y.qid);
    const shown = items.slice(0, MAX_QUESTIONS).map(it => {
      const t = questionText(ctx, it.qid);
      return { qid: it.qid, text: t != null ? t : '#' + it.qid, status: it.status };
    });

    const answered = mastery.answered[nodeIndex];
    const detail = {
      title,
      kindLabel: KIND_LABELS[kindIdx] || String(kindName),
      stateLabel: STATE_LABELS[mastery.state[nodeIndex]] || STATE_LABELS[0],
      rate: answered > 0 ? mastery.rate[nodeIndex] : null,
      answered,
      weakCount: mastery.weak[nodeIndex],
    };

    if ((kindName === 'concept' || kindName === 'trap') && graph.text && hasOwn(graph.text, String(nodeIndex))) {
      const t = graph.text[nodeIndex];
      if (t && typeof t.desc === 'string') detail.desc = t.desc;
      if (t && typeof t.advice === 'string') detail.advice = t.advice;
    }

    detail.questions = shown;
    if (items.length > MAX_QUESTIONS) detail.moreCount = items.length - MAX_QUESTIONS;
    return detail;
  }

  return { buildDetail, KIND_LABELS, STATE_LABELS };
});
