// 文法グラフの「レーダーチャート（模試結果風レポート）」用の集計・幾何計算。
// DOM にも localStorage にも触れない純関数（ブラウザでは StudyCore.*、Node では require）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const MASTERY_STATES = ['unseen', 'due', 'weak', 'few', 'mid', 'good'];
  const THRESHOLDS = { minAnswers: 3, weakBelow: 0.6, goodFrom: 0.8 };
  const MAX_ANSWERS = 1000000;
  const KIND_NAMES = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];

  const CONCEPT_SHORT_LABELS = {
    'SVOC（文の骨格）': 'SVOC',
    '能動態と受動態': '受動態',
    '分詞（現在分詞・過去分詞）': '分詞',
    '動詞の時制と相': '時制・相',
    '助動詞・仮定法': '助動詞・仮定法',
    '動名詞 vs 不定詞': '動名詞/不定詞',
    '名詞の役割（主語・目的語・補語）': '名詞',
    '代名詞の格と用法': '代名詞',
    '形容詞と副詞の修飾関係': '形容詞・副詞',
    '関係代名詞・関係副詞': '関係詞',
    '比較級・最上級': '比較',
    '接続詞 vs 前置詞の識別': '接続詞/前置詞',
    '倒置・強調・並列構造': '倒置・強調',
  };

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function shortConceptLabel(label) {
    const s = String(label || '');
    if (hasOwn(CONCEPT_SHORT_LABELS, s)) return CONCEPT_SHORT_LABELS[s];
    const stripped = s.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim() || s;
    return stripped.length > 10 ? stripped.slice(0, 9) + '…' : stripped;
  }

  function classifyState(answered, accuracy) {
    if (answered === 0 || accuracy == null) return 'unseen';
    if (answered < THRESHOLDS.minAnswers) return 'few';
    if (accuracy >= THRESHOLDS.goodFrom) return 'good';
    if (accuracy >= THRESHOLDS.weakBelow) return 'mid';
    return 'weak';
  }

  function buildQuestionArrays(graph, stats, weak, isDue) {
    const qids = graph.qids || [];
    const nq = qids.length;
    stats = stats && typeof stats === 'object' ? stats : {};
    weak = weak && typeof weak === 'object' ? weak : {};
    const dueFn = typeof isDue === 'function' ? isDue : null;

    const qa = new Int32Array(nq);
    const qc = new Int32Array(nq);
    const qw = new Int32Array(nq);
    const qd = new Int32Array(nq);

    for (let o = 0; o < nq; o++) {
      const key = String(qids[o]);
      if (hasOwn(stats, key)) {
        const rec = stats[key];
        if (rec && typeof rec === 'object') {
          const a = Math.floor(Number(rec.a));
          if (Number.isFinite(a) && a >= 1) {
            let c = Math.floor(Number(rec.c));
            if (!Number.isFinite(c) || c < 0) c = 0;
            const ca = Math.min(a, MAX_ANSWERS);
            qa[o] = ca;
            qc[o] = Math.min(c, ca);
          }
        }
      }
      if (hasOwn(weak, key)) {
        qw[o] = 1;
        if (dueFn) {
          let due = false;
          try { due = !!dueFn(weak[key]); } catch (e) { due = false; }
          if (due) qd[o] = 1;
        }
      }
    }
    return { qa, qc, qw, qd, nq };
  }

  function aggregateOrdinals(ordList, arrays) {
    const { qa, qc, qw, qd } = arrays;
    let total = 0, attempted = 0, mastered = 0, answered = 0, correct = 0, weak = 0, due = 0;
    for (let idx = 0; idx < ordList.length; idx++) {
      const o = ordList[idx];
      const a = qa[o], c = qc[o], w = qw[o], d = qd[o];
      total++;
      if (a > 0) attempted++;
      if (a >= THRESHOLDS.minAnswers && w === 0 && (c + 1) / (a + 2) >= THRESHOLDS.goodFrom) mastered++;
      answered += a;
      correct += c;
      weak += w;
      due += d;
    }
    const accuracy = answered > 0 ? correct / answered : null;
    const coverage = total > 0 ? attempted / total : 0;
    const state = classifyState(answered, accuracy);
    return { total, attempted, mastered, answered, correct, weak, due, accuracy, coverage, state };
  }

  function nodeOrdinals(graph, nodeIndex, nq, inBookMask) {
    const start = graph.memberStart[nodeIndex];
    const end = graph.memberStart[nodeIndex + 1];
    const seen = new Set();
    const out = [];
    for (let k = start; k < end; k++) {
      const o = graph.members[k];
      if (!(o >= 0 && o < nq) || seen.has(o)) continue;
      if (inBookMask && !inBookMask[o]) continue;
      seen.add(o);
      out.push(o);
    }
    return out;
  }

  function sortReportItems(items, sortMode) {
    const list = Array.isArray(items) ? items.slice() : [];
    if (sortMode !== 'weakness') return list;
    const tierOf = x => {
      if (x.answered === 0 && x.weak === 0) return 3; // 完全未着手
      if (x.answered > 0 && x.weak === 0 && x.accuracy != null && x.accuracy >= THRESHOLDS.goodFrom) return 2; // 良好（80%以上・苦手0）
      if (x.answered === 0 && x.weak > 0) return 1; // 未解答だが苦手登録あり
      return 0; // 解答済みで 80% 未満または苦手あり
    };
    return list.sort((a, b) => {
      const aTier = tierOf(a), bTier = tierOf(b);
      if (aTier !== bTier) return aTier - bTier;
      if (aTier === 3) return b.total - a.total;
      if (aTier === 1) return b.weak !== a.weak ? b.weak - a.weak : b.total - a.total;
      const accA = a.accuracy == null ? 0 : a.accuracy;
      const accB = b.accuracy == null ? 0 : b.accuracy;
      if (Math.abs(accA - accB) > 1e-9) return accA - accB;
      if (b.weak !== a.weak) return b.weak - a.weak;
      return b.total - a.total;
    });
  }

  function computeGraphReport(graph, stats, weak, isDue, opts) {
    if (!graph || !Array.isArray(graph.id)) {
      return {
        book: 'all',
        summary: { total: 0, attempted: 0, mastered: 0, answered: 0, correct: 0, weak: 0, due: 0, accuracy: null, coverage: 0, state: 'unseen', strongest: null, weakest: null },
        concepts: [], traps: [], books: [],
      };
    }
    opts = opts && typeof opts === 'object' ? opts : {};
    const book = typeof opts.book === 'string' && opts.book ? opts.book : 'all';
    const conceptOrder = Array.isArray(opts.conceptOrder) ? opts.conceptOrder : [];
    const kinds = graph.kinds || KIND_NAMES;
    const kBook = kinds.indexOf('book');
    const kConcept = kinds.indexOf('concept');
    const kTrap = kinds.indexOf('trap');
    const n = graph.id.length;
    const arrays = buildQuestionArrays(graph, stats, weak, isDue);
    const { nq } = arrays;

    // 対象教材のマスクを作る（'all' なら全問）
    let inBookMask = null;
    if (book !== 'all') {
      inBookMask = new Uint8Array(nq);
      const targetId = 'book:' + book;
      for (let i = 0; i < n; i++) {
        if (graph.kind[i] === kBook && graph.id[i] === targetId) {
          for (let k = graph.memberStart[i]; k < graph.memberStart[i + 1]; k++) {
            const o = graph.members[k];
            if (o >= 0 && o < nq) inBookMask[o] = 1;
          }
          break;
        }
      }
    }

    const activeOrds = [];
    for (let o = 0; o < nq; o++) {
      if (!inBookMask || inBookMask[o]) activeOrds.push(o);
    }
    const summary = aggregateOrdinals(activeOrds, arrays);

    const summarizeNode = (i, mask) => {
      const id = String(graph.id[i]);
      const label = graph.label && graph.label[i] != null ? String(graph.label[i]) : id;
      const ords = nodeOrdinals(graph, i, nq, mask);
      const agg = aggregateOrdinals(ords, arrays);
      return Object.assign({
        nodeIndex: i,
        id,
        label,
        shortLabel: graph.kind[i] === kConcept ? shortConceptLabel(label) : label,
      }, agg);
    };

    // 13 概念を既定順（なければグラフ順）に並べる
    const conceptRank = new Map();
    conceptOrder.forEach((id, idx) => conceptRank.set(id, idx));
    const conceptNodes = [];
    const trapNodes = [];
    const bookNodes = [];
    for (let i = 0; i < n; i++) {
      const k = graph.kind[i];
      if (k === kConcept) conceptNodes.push(i);
      else if (k === kTrap) trapNodes.push(i);
      else if (k === kBook) bookNodes.push(i);
    }
    conceptNodes.sort((a, b) => {
      const ra = conceptRank.has(graph.id[a]) ? conceptRank.get(graph.id[a]) : 10000 + a;
      const rb = conceptRank.has(graph.id[b]) ? conceptRank.get(graph.id[b]) : 10000 + b;
      return ra - rb;
    });

    const concepts = conceptNodes.map(i => summarizeNode(i, inBookMask));
    const traps = trapNodes.map(i => summarizeNode(i, inBookMask));
    // 教材別一覧は他教材と比較できるよう、常に各本ごとの全問題で集計し、選択中フラグを付ける
    const books = bookNodes.map(i => {
      const item = summarizeNode(i, null);
      const bid = item.id.startsWith('book:') ? item.id.slice(5) : item.id;
      item.bookId = bid;
      item.selected = book === 'all' || book === bid;
      return item;
    });

    // 得意分野と要強化分野のハイライト
    const answeredConcepts = concepts.filter(c => c.answered > 0 && c.accuracy != null);
    let strongest = null;
    if (answeredConcepts.length > 0) {
      const sortedHigh = answeredConcepts.slice().sort((a, b) => {
        if (Math.abs(b.accuracy - a.accuracy) > 1e-9) return b.accuracy - a.accuracy;
        return b.answered - a.answered;
      });
      if (sortedHigh[0].accuracy >= THRESHOLDS.weakBelow) strongest = sortedHigh[0];
    }
    const weakCandidates = sortReportItems(
      concepts.filter(c => (c.answered > 0 || c.weak > 0) && (c.weak > 0 || (c.accuracy != null && c.accuracy < THRESHOLDS.goodFrom))),
      'weakness'
    );
    let weakest = weakCandidates.length > 0 ? weakCandidates[0] : null;
    if (weakest && strongest && weakest.id === strongest.id) {
      weakest = weakCandidates.length > 1 ? weakCandidates[1] : null;
    }

    summary.strongest = strongest;
    summary.weakest = weakest;

    return { book, summary, concepts, traps, books };
  }

  function computeRadarGeometry(items, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    const size = Number(opts.size) > 0 ? Number(opts.size) : 340;
    const width = Number(opts.width) > 0 ? Number(opts.width) : size;
    const height = Number(opts.height) > 0 ? Number(opts.height) : size;
    const radius = Number(opts.radius) > 0 ? Number(opts.radius) : 108;
    const labelOffset = Number(opts.labelOffset) >= 0 ? Number(opts.labelOffset) : 22;
    const levels = Array.isArray(opts.levels) && opts.levels.length ? opts.levels : [0.2, 0.4, 0.6, 0.8, 1.0];
    const cx = Number.isFinite(opts.cx) ? Number(opts.cx) : width / 2;
    const cy = Number.isFinite(opts.cy) ? Number(opts.cy) : height / 2;
    const list = Array.isArray(items) ? items : [];
    const n = list.length;

    const pointAt = (angle, r) => ({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });

    const rings = levels.map(lv => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
        pts.push(pointAt(ang, radius * lv));
      }
      return { level: lv, isTarget: Math.abs(lv - THRESHOLDS.goodFrom) < 1e-6, points: pts };
    });

    const axes = list.map((item, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const acc = item.accuracy == null ? 0 : Math.max(0, Math.min(1, item.accuracy));
      const cov = item.coverage == null ? 0 : Math.max(0, Math.min(1, item.coverage));
      const textAnchor = Math.abs(cos) < 0.22 ? 'middle' : cos > 0 ? 'start' : 'end';
      const dy = sin > 0.65 ? 10 : sin < -0.65 ? -4 : 4;
      return {
        index: i,
        item,
        angle,
        outer: pointAt(angle, radius),
        labelPos: pointAt(angle, radius + labelOffset),
        textAnchor,
        dy,
        accPoint: pointAt(angle, radius * acc),
        covPoint: pointAt(angle, radius * cov),
      };
    });

    return {
      size,
      cx,
      cy,
      radius,
      rings,
      axes,
      accPolygon: axes.map(a => a.accPoint),
      covPolygon: axes.map(a => a.covPoint),
    };
  }

  return {
    MASTERY_STATES,
    CONCEPT_SHORT_LABELS,
    shortConceptLabel,
    computeGraphReport,
    sortReportItems,
    computeRadarGeometry,
  };
});
