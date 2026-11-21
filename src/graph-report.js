// 文法グラフの「レーダーチャート（模試結果風レポート）」用の集計・幾何計算。
// DOM にも localStorage にも触れない純関数（ブラウザでは StudyCore.*、Node では require）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mastery.js'));
  else Object.assign(root.StudyCore = root.StudyCore || {}, factory(root.StudyCore || {}));
})(typeof self !== 'undefined' ? self : this, function (M) {
  // 判定の規則と記録の読み方は src/mastery.js に一本化している（ネットワーク図・詳細シートと状態をそろえるため）。
  // ブラウザでは home.js の GRAPH_SCRIPTS で mastery.js が先に読み込まれている。
  const { MASTERY_STATES, MASTERY_THRESHOLDS, classifyMastery, readQuestionArrays } = M;
  // 得意・要強化を正答率で選ぶのに必要な、着手した問題の最小数（判定の「解答数が少なすぎる」と同じ値）
  const MIN_ATTEMPTED_FOR_HIGHLIGHT = MASTERY_THRESHOLDS.minAnswers;
  const KIND_NAMES = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
  // レーダーの中央揃えのラベルを左右へずらす量（viewBox の単位）
  const MIDDLE_LABEL_NUDGE = 8;

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
  // src/graph-force.js が未読み込み（オフライン・力学アセット失敗）でも 13 軸の順序を保つための既定順
  const DEFAULT_CONCEPT_ORDER = Object.keys(CONCEPT_SHORT_LABELS).map(k => 'con:' + k);

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function shortConceptLabel(label) {
    const s = String(label || '');
    if (hasOwn(CONCEPT_SHORT_LABELS, s)) return CONCEPT_SHORT_LABELS[s];
    const stripped = s.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim() || s;
    return stripped.length > 10 ? stripped.slice(0, 9) + '…' : stripped;
  }

  function aggregateOrdinals(ordList, arrays) {
    const { qa, qc, qw, qd } = arrays;
    const { minAnswers, goodFrom } = MASTERY_THRESHOLDS;
    let total = 0, attempted = 0, mastered = 0, answered = 0, correct = 0, weak = 0, due = 0;
    for (let idx = 0; idx < ordList.length; idx++) {
      const o = ordList[idx];
      const a = qa[o], c = qc[o], w = qw[o], d = qd[o];
      total++;
      if (a > 0) attempted++;
      if (a >= minAnswers && w === 0 && (c + 1) / (a + 2) >= goodFrom) mastered++;
      answered += a;
      correct += c;
      weak += w;
      due += d;
    }
    const accuracy = answered > 0 ? correct / answered : null; // 画面に出す正答率（詳細シートと同じ素の比率）
    const coverage = total > 0 ? attempted / total : 0;
    const state = MASTERY_STATES[classifyMastery(answered, correct, weak, due)];
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
      if (x.total === 0) return 4; // 選択教材に収録なし
      if (x.answered === 0 && x.weak === 0) return 3; // 完全未着手
      if (x.answered > 0 && x.weak === 0 && x.accuracy != null && x.accuracy >= MASTERY_THRESHOLDS.goodFrom) return 2; // 良好（80%以上・苦手0）
      if (x.answered === 0 && x.weak > 0) return 1; // 未解答だが苦手登録あり
      return 0; // 解答済みで 80% 未満または苦手あり
    };
    return list.sort((a, b) => {
      const aTier = tierOf(a), bTier = tierOf(b);
      if (aTier !== bTier) return aTier - bTier;
      if (aTier === 4) return 0;
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
    const conceptOrder = Array.isArray(opts.conceptOrder) && opts.conceptOrder.length
      ? opts.conceptOrder
      : DEFAULT_CONCEPT_ORDER;
    const kinds = graph.kinds || KIND_NAMES;
    const kBook = kinds.indexOf('book');
    const kConcept = kinds.indexOf('concept');
    const kTrap = kinds.indexOf('trap');
    const n = graph.id.length;
    const arrays = readQuestionArrays(graph, stats, weak, isDue);
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

    // 得意分野と要強化分野のハイライト。
    // 得意: 状態が good / mid（苦手・要復習・解答不足を含まない）で、着手した問題が MIN_ATTEMPTED_FOR_HIGHLIGHT 問以上
    // 要強化: 苦手登録がある、または着手 MIN_ATTEMPTED_FOR_HIGHLIGHT 問以上で正答率が goodFrom 未満
    // （1 問だけ解いて 100% や 0% になった分野を、得意・要強化と言い切らない）
    const strongCandidates = concepts.filter(
      c => (c.state === 'good' || c.state === 'mid') && c.attempted >= MIN_ATTEMPTED_FOR_HIGHLIGHT && c.accuracy != null
    );
    let strongest = null;
    if (strongCandidates.length > 0) {
      const sortedHigh = strongCandidates.slice().sort((a, b) => {
        if (Math.abs(b.accuracy - a.accuracy) > 1e-9) return b.accuracy - a.accuracy;
        return b.answered - a.answered;
      });
      strongest = sortedHigh[0];
    }
    const weakCandidates = sortReportItems(
      concepts.filter(c => c.total > 0 && (
        c.weak > 0 ||
        (c.attempted >= MIN_ATTEMPTED_FOR_HIGHLIGHT && c.accuracy != null && c.accuracy < MASTERY_THRESHOLDS.goodFrom)
      )),
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
      return { level: lv, isTarget: Math.abs(lv - MASTERY_THRESHOLDS.goodFrom) < 1e-6, points: pts };
    });

    const axes = list.map((item, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const acc = item.accuracy == null ? 0 : Math.max(0, Math.min(1, item.accuracy));
      const cov = item.coverage == null ? 0 : Math.max(0, Math.min(1, item.coverage));
      // 真上・真下に近い軸は中央揃え。13 軸では真下の左右 2 軸が |cos| ≈ 0.24 なので、0.3 未満を中央にする
      // （右揃え・左揃えにすると横へ伸びて、隣の軸のラベルに重なる。詰めた配置で「代名詞」と「形容詞・副詞」が重なっていた）
      const textAnchor = Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end';
      const dy = sin > 0.65 ? 10 : sin < -0.65 ? -4 : 4;
      // 中央揃えのうち真上・真下ちょうどでない軸（13 軸の真下の 2 軸など）は、左右へ少し外側にずらす。
      // 中央揃えのままだと隣どうし（「代名詞」と「名詞」）の中心が近く、「100%」の行どうしが重なるため
      const labelPos = pointAt(angle, radius + labelOffset);
      if (textAnchor === 'middle' && Math.abs(cos) > 0.05) labelPos.x += Math.sign(cos) * MIDDLE_LABEL_NUDGE;
      return {
        index: i,
        item,
        angle,
        outer: pointAt(angle, radius),
        labelPos,
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
    DEFAULT_CONCEPT_ORDER,
    shortConceptLabel,
    computeGraphReport,
    sortReportItems,
    computeRadarGeometry,
  };
});
