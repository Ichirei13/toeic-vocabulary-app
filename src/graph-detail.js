// 文法グラフのノード詳細（詳細シートの中身）の組み立て。DOM にも保存にも触れない純関数。
// HTML は作らない（画面側が escapeHtml を通して組む）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mastery.js'));
  else Object.assign(root.StudyCore = root.StudyCore || {}, factory(root.StudyCore || {}));
})(typeof self !== 'undefined' ? self : this, function (M) {
  // 教材で絞ったときの集計と判定は src/mastery.js の readQuestionArrays・classifyMastery を使う
  // （レーダーと同じ読み方・同じ判定にするため）。ブラウザでは home.js の GRAPH_SCRIPTS で mastery.js が先に読み込まれている。
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

  // 並びの優先度: weak(0) → unseen(1) → overcome(2) → correct(3)（苦手と未着手を先に解く）
  const STATUS_RANK = { weak: 0, unseen: 1, overcome: 2, correct: 3 };

  function statusOf(stats, weak, qid) {
    const key = String(qid);
    if (hasOwn(weak, key)) return 'weak';
    if (hasOwn(stats, key)) {
      const rec = stats[key];
      if (rec && typeof rec === 'object') {
        const a = Math.floor(Number(rec.a));
        if (Number.isFinite(a) && a >= 1) {
          const c = Math.floor(Number(rec.c));
          // 間違えた問題は必ず苦手リストに入り、復習で続けて正解すると外れる（js/review-interval.js の updateWeakEntry）。
          // だから、間違えたことがあって苦手リストに入っていない問題は「克服」した問題（手で苦手リストから消したものも含む）
          return c >= a ? 'correct' : 'overcome'; // c > a の壊れた記録は、集計（graph-report.js）と同じく a に丸めて正解扱い
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
    const bookFilter = typeof ctx.book === 'string' && ctx.book && ctx.book !== 'all' ? ctx.book : null;
    const dueFn = typeof ctx.isDue === 'function' ? ctx.isDue : null;

    const kindIdx = graph.kind[nodeIndex];
    const kindName = graph.kinds ? graph.kinds[kindIdx] : KIND_NAMES[kindIdx];
    const label = graph.label && graph.label[nodeIndex] != null ? String(graph.label[nodeIndex]) : String(graph.id[nodeIndex]);

    // 教材フィルタが指定されている場合（本ノード自身・問題ノード自身は対象外）
    let bookOrds = null;
    if (bookFilter && kindName !== 'book' && kindName !== 'question') {
      bookOrds = new Set();
      const targetBookId = 'book:' + bookFilter;
      const kBook = graph.kinds ? graph.kinds.indexOf('book') : 0;
      for (let i = 0; i < n; i++) {
        if (graph.kind[i] === kBook && graph.id[i] === targetBookId) {
          for (let k = graph.memberStart[i]; k < graph.memberStart[i + 1]; k++) {
            const o = graph.members[k];
            if (o >= 0 && o < graph.qids.length) bookOrds.add(o);
          }
          break;
        }
      }
    }

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
        if (bookOrds && !bookOrds.has(o)) continue;
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

    let answered, correct, weakCount, rate, stateLabel;
    if (bookOrds) {
      // 教材で絞ったときは、レーダー（graph-report.js）と同じ読み方・同じ判定で集計する
      const q = M.readQuestionArrays(graph, stats, weak, dueFn);
      let aSum = 0, cSum = 0, wSum = 0, dSum = 0;
      const counted = new Set();
      for (let k = graph.memberStart[nodeIndex]; k < graph.memberStart[nodeIndex + 1]; k++) {
        const o = graph.members[k];
        if (!(o >= 0 && o < q.nq) || counted.has(o) || !bookOrds.has(o)) continue;
        counted.add(o);
        aSum += q.qa[o]; cSum += q.qc[o]; wSum += q.qw[o]; dSum += q.qd[o];
      }
      answered = aSum;
      correct = cSum;
      weakCount = wSum;
      rate = aSum > 0 ? (cSum + 1) / (aSum + 2) : null;
      stateLabel = STATE_LABELS[M.classifyMastery(aSum, cSum, wSum, dSum)];
    } else {
      answered = mastery.answered[nodeIndex];
      correct = mastery.correct ? mastery.correct[nodeIndex] : 0;
      weakCount = mastery.weak[nodeIndex];
      rate = answered > 0 ? mastery.rate[nodeIndex] : null;
      stateLabel = STATE_LABELS[mastery.state[nodeIndex]] || STATE_LABELS[0];
    }
    const detail = {
      title,
      kindLabel: KIND_LABELS[kindIdx] || String(kindName),
      stateLabel,
      rate,
      answered,
      correct,
      weakCount,
      allQids: items.map(it => it.qid),
      // 苦手と未着手の問題だけ（克服・正解は除く）。苦手 → 未着手 の順（レーダーの「苦手と未着手を解く」用）
      restQids: items.filter(it => it.status === 'weak' || it.status === 'unseen').map(it => it.qid),
    };

    if ((kindName === 'concept' || kindName === 'trap') && graph.text && hasOwn(graph.text, String(nodeIndex))) {
      const t = graph.text[nodeIndex];
      if (t && typeof t.desc === 'string') detail.desc = t.desc;
      if (t && typeof t.advice === 'string') detail.advice = t.advice;
    }

    if (kindName === 'question') {
      const ord = graph.memberStart && graph.members && graph.memberStart[nodeIndex + 1] > graph.memberStart[nodeIndex]
        ? graph.members[graph.memberStart[nodeIndex]]
        : (Array.isArray(graph.qids) ? graph.qids.indexOf(graph.qid[nodeIndex]) : -1);
      if (ord >= 0) {
        if (Array.isArray(graph.solveTypes) && Array.isArray(graph.qSolveType)) {
          const stIdx = graph.qSolveType[ord];
          if (Number.isInteger(stIdx) && stIdx >= 0 && stIdx < graph.solveTypes.length && typeof graph.solveTypes[stIdx] === 'string' && graph.solveTypes[stIdx]) {
            detail.solveType = graph.solveTypes[stIdx];
          }
        }
        if (Array.isArray(graph.qPoint) && typeof graph.qPoint[ord] === 'string' && graph.qPoint[ord]) {
          detail.point = graph.qPoint[ord];
        }
      }
      if (Array.isArray(graph.edges)) {
        let primaryConcept = null;
        const secondaryConcepts = [];
        const traps = [];
        const makeRef = to => ({
          nodeIndex: to,
          id: String(graph.id[to]),
          label: graph.label && graph.label[to] != null ? String(graph.label[to]) : String(graph.id[to]),
        });
        for (let k = 0; k + 2 < graph.edges.length; k += 3) {
          if (graph.edges[k] !== nodeIndex) continue;
          const to = graph.edges[k + 1];
          const t = graph.edges[k + 2];
          if (!(to >= 0 && to < n)) continue;
          if (t === 1) {
            if (!primaryConcept) primaryConcept = makeRef(to);
            else secondaryConcepts.push(makeRef(to));
          } else if (t === 3) {
            secondaryConcepts.push(makeRef(to));
          } else if (t === 2) {
            traps.push(makeRef(to));
          }
        }
        if (primaryConcept) detail.primaryConcept = primaryConcept;
        if (secondaryConcepts.length > 0) detail.secondaryConcepts = secondaryConcepts;
        if (traps.length > 0) detail.traps = traps;
      }
    }

    detail.questions = shown;
    if (items.length > MAX_QUESTIONS) detail.moreCount = items.length - MAX_QUESTIONS;
    return detail;
  }

  return { buildDetail, KIND_LABELS, STATE_LABELS };
});
