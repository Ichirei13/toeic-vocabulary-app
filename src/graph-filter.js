// 文法グラフの絞り込み（本・苦手のみ）と LOD（段階表示）。DOM にも保存にも触れない純関数。
// 苦手のみ（weakOnly）は本の絞り込みと併用しても、概念・Trap の苦手は全体で数える（ノード自身の weak/due で決める。他の本の苦手でも残る）。
// グラフの辺は辿らず、ノードの members（問題の序数）だけを使う。1 回の計算は O(ノード数 + members)。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  // LOD ごとに描く種類（種類名。添字は graph.kinds の並びで引く）
  //   0 遠景 = book, concept, trap, chapter / 1 中景 = + rule / 2 近景 = + question
  const KINDS_BY_LOD = [
    ['book', 'chapter', 'concept', 'trap'],
    ['book', 'chapter', 'rule', 'concept', 'trap'],
    ['book', 'chapter', 'rule', 'concept', 'trap', 'question'],
  ];
  // graph.kinds を渡さないときの既定の並び（data/grammar_graph.js の kinds と同じ。テストで一致を確認する）
  const DEFAULT_KINDS = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];

  // カメラの倍率 -> LOD のしきい値 [中景に入る倍率, 近景に入る倍率]。
  // 前提: グラフ全体が画面に収まる初期倍率を 1 とする。
  //   scale < 2 は遠景（全体〜ほぼ全体）、2 以上 5 未満は中景（章の中身が見え始める）、5 以上は近景（問題まで）。
  // 倍率ちょうどがしきい値のときは上の LOD になる。
  // 2026-11-08 graph-view で確認: 倍率は「いまの scale / 全体表示の scale」（相対）で渡す。375×812 と 1280×800 の
  // スクリーンショットで、全体 = 本・章・概念・Trap、約 2.4 倍 = ルールまで、約 6 倍 = 問題まで、が読める密度だったので 2 / 5 のまま。
  const LOD_SCALES = [2, 5];

  function clampLod(lod) {
    lod = Math.floor(Number(lod));
    if (!(lod >= 0)) return 0; // NaN・負は遠景
    return Math.min(lod, 2);
  }

  function lodForScale(scale) {
    const s = Number(scale);
    if (!(s >= 0)) return 0; // NaN・負・数でない
    if (s >= LOD_SCALES[1]) return 2;
    if (s >= LOD_SCALES[0]) return 1;
    return 0;
  }

  // その LOD で描く種類の添字（graph.kinds の並び順に従う）
  function kindsAtLod(lod, kinds) {
    const names = KINDS_BY_LOD[clampLod(lod)];
    const list = Array.isArray(kinds) ? kinds : DEFAULT_KINDS;
    const out = [];
    for (let i = 0; i < list.length; i++) if (names.indexOf(list[i]) !== -1) out.push(i);
    return out;
  }

  // 描くノードを 1、描かないノードを 0 にした Uint8Array を返す。3 条件は AND。
  //   opts.book: 'all'（既定）| 'kin' | 'sekai' | 'polaris2' | 'toplevel'（graph に無い本は何も残らない）
  //   opts.weakOnly: true なら weak>0 または due>0 のノードだけ（mastery が無ければ何も残らない）
  //   opts.lod: 0|1|2（既定 2 = 全部の種類）
  function visibleMask(graph, mastery, opts) {
    opts = opts || {};
    const n = graph.id.length;
    const nq = graph.qids.length;
    const memberStart = graph.memberStart;
    const members = graph.members;
    const kind = graph.kind;
    const mask = new Uint8Array(n);

    // 種類による除外（LOD）
    const kinds = graph.kinds || DEFAULT_KINDS;
    const kindOk = new Uint8Array(kinds.length);
    const visibleKinds = kindsAtLod(opts.lod == null ? 2 : opts.lod, kinds);
    for (let j = 0; j < visibleKinds.length; j++) kindOk[visibleKinds[j]] = 1;
    const bookKind = kinds.indexOf('book');
    // LOD の例外: 苦手の問題（showWeakQuestions）と、指定されたノード（forceShow）は、種類が LOD の外でも残す
    const qKind = kinds.indexOf('question');
    const forceShow = opts.forceShow && opts.forceShow.length >= n ? opts.forceShow : null;
    const showWeakQ = !!opts.showWeakQuestions;

    // 本の絞り込み: 選んだ本の book ノードのメンバー = その本の問題。
    // inBook[序数] = 1 の問題を 1 問以上もつノードだけが残る（他の本の book ノードはメンバーが重ならず落ちる）。
    const book = opts.book == null ? 'all' : String(opts.book);
    const filterBook = book !== 'all';
    let inBook = null;
    if (filterBook) {
      inBook = new Uint8Array(nq);
      const bi = bookKind === -1 ? -1 : graph.id.indexOf('book:' + book);
      if (bi === -1 || kind[bi] !== bookKind) return mask; // その本がグラフに無い
      for (let k = memberStart[bi]; k < memberStart[bi + 1]; k++) {
        const o = members[k];
        if (o >= 0 && o < nq) inBook[o] = 1;
      }
    }

    const weakOnly = !!opts.weakOnly;
    const weakCnt = mastery && mastery.weak;
    const dueCnt = mastery && mastery.due;

    for (let i = 0; i < n; i++) {
      if (!kindOk[kind[i]]) {
        const forced = (forceShow && forceShow[i]) || (showWeakQ && kind[i] === qKind && weakCnt && weakCnt[i] > 0);
        if (!forced) continue;
      }
      if (weakOnly && !(weakCnt && dueCnt && (weakCnt[i] > 0 || dueCnt[i] > 0))) continue;
      if (filterBook) {
        let hit = false;
        const end = memberStart[i + 1];
        for (let k = memberStart[i]; k < end; k++) {
          const o = members[k];
          if (o >= 0 && o < nq && inBook[o]) { hit = true; break; }
        }
        if (!hit) continue;
      }
      mask[i] = 1;
    }
    return mask;
  }

  // グラフの索引（マウント時に 1 回作る）。辺を辿る計算（束ねた線・周辺・近さ）はすべてこれを使う。
  function buildIndex(graph) {
    const n = graph.id.length, nq = graph.qids.length;
    const kinds = graph.kinds || DEFAULT_KINDS;
    const K = name => kinds.indexOf(name);
    const kQ = K('question'), kCh = K('chapter'), kRule = K('rule'), kCon = K('concept'), kTrap = K('trap'), kBook = K('book');
    const kind = graph.kind;
    const E = graph.edges || [];
    const ok = (a, b) => a >= 0 && a < n && b >= 0 && b < n;

    const parent = new Int32Array(n).fill(-1);
    const hubStart = new Int32Array(n + 1);
    for (let k = 0; k + 2 < E.length; k += 3) {
      const a = E[k], b = E[k + 1], t = E[k + 2];
      if (!ok(a, b)) continue;
      if (t === 0) parent[b] = a;
      else if (t === 1 || t === 2) hubStart[a + 1]++;
    }
    for (let i = 0; i < n; i++) hubStart[i + 1] += hubStart[i];
    const hubs = new Int32Array(hubStart[n]);
    const fill = hubStart.slice(0, n);
    for (let k = 0; k + 2 < E.length; k += 3) {
      const a = E[k], b = E[k + 1], t = E[k + 2];
      if (ok(a, b) && (t === 1 || t === 2)) hubs[fill[a]++] = b;
    }

    // 序数 → 問題ノード（問題ノードの members は自分の序数だけ）と、問題ノードの章・ルール
    const qNode = new Int32Array(nq).fill(-1);
    const chapterOf = new Int32Array(n).fill(-1), ruleOf = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (kind[i] !== kQ) continue;
      const o = graph.members[graph.memberStart[i]];
      if (o >= 0 && o < nq && qNode[o] === -1) qNode[o] = i;
      let j = parent[i], guard = 0;
      while (j !== -1 && guard++ < 8) {
        if (kind[j] === kRule && ruleOf[i] === -1) ruleOf[i] = j;
        if (kind[j] === kCh) { chapterOf[i] = j; break; }
        j = parent[j];
      }
    }
    return { n, nq, parent, hubStart, hubs, qNode, chapterOf, ruleOf, kQ, kCh, kRule, kCon, kTrap, kBook };
  }

  // 概念・ひっかけへの線を、章（level = 'chapter'）またはルール（'rule'）の単位で束ねる。
  // ルールを持たない問題は、'rule' でも章の束に入る。束は (a, b) の昇順。
  function buildBundles(graph, index, level) {
    const n = index.n;
    const map = new Map(); // a * n + b → 問題ノードの配列
    for (let o = 0; o < index.nq; o++) {
      const q = index.qNode[o];
      if (q < 0) continue;
      const g = level === 'rule' && index.ruleOf[q] !== -1 ? index.ruleOf[q] : index.chapterOf[q];
      if (g < 0) continue;
      for (let k = index.hubStart[q]; k < index.hubStart[q + 1]; k++) {
        const key = g * n + index.hubs[k];
        let list = map.get(key);
        if (!list) map.set(key, list = []);
        list.push(q);
      }
    }
    const keys = [...map.keys()].sort((x, y) => x - y);
    const count = keys.length;
    const a = new Int32Array(count), b = new Int32Array(count), type = new Uint8Array(count), start = new Int32Array(count + 1);
    const qs = [];
    for (let j = 0; j < count; j++) {
      a[j] = Math.floor(keys[j] / n);
      b[j] = keys[j] % n;
      type[j] = graph.kind[b[j]] === index.kTrap ? 2 : 1;
      for (const q of map.get(keys[j])) qs.push(q);
      start[j + 1] = qs.length;
    }
    return { count, a, b, type, start, questions: Int32Array.from(qs) };
  }

  // 束ごとの、苦手の問題の数。nodeWeak はノード添字で引く（mastery.weak）
  function bundleWeak(bundles, nodeWeak) {
    const out = new Int32Array(bundles.count);
    if (!nodeWeak) return out;
    for (let j = 0; j < bundles.count; j++) {
      let w = 0;
      for (let k = bundles.start[j]; k < bundles.start[j + 1]; k++) if (nodeWeak[bundles.questions[k]] > 0) w++;
      out[j] = w;
    }
    return out;
  }

  // ノード i をタップしたときに浮かび上がらせる集合（1 のノードを通常の濃さで描き、ほかを薄くする）。
  //   問題: 自分・概念・ひっかけ・ルール・章 ＋ extraQuestionNodes（近い問題。呼び出し側が渡す）
  //   概念・ひっかけ: 自分・配下の問題・それらの章
  //   ルール・章・本: 自分・配下の問題・それらの概念とひっかけ
  function focusSet(graph, index, i, extraQuestionNodes) {
    const f = new Uint8Array(index.n);
    if (!(Number.isInteger(i) && i >= 0 && i < index.n)) return f;
    f[i] = 1;
    const k = graph.kind[i];
    const addHubs = q => { for (let h = index.hubStart[q]; h < index.hubStart[q + 1]; h++) f[index.hubs[h]] = 1; };
    if (k === index.kQ) {
      addHubs(i);
      if (index.ruleOf[i] !== -1) f[index.ruleOf[i]] = 1;
      if (index.chapterOf[i] !== -1) f[index.chapterOf[i]] = 1;
      if (extraQuestionNodes) for (const q of extraQuestionNodes) if (Number.isInteger(q) && q >= 0 && q < index.n) f[q] = 1;
      return f;
    }
    const hub = k === index.kCon || k === index.kTrap;
    for (let m = graph.memberStart[i]; m < graph.memberStart[i + 1]; m++) {
      const q = index.qNode[graph.members[m]];
      if (!(q >= 0)) continue;
      f[q] = 1;
      if (hub) { if (index.chapterOf[q] !== -1) f[index.chapterOf[q]] = 1; }
      else addHubs(q);
    }
    return f;
  }

  return { visibleMask, lodForScale, kindsAtLod, LOD_SCALES, buildIndex, buildBundles, bundleWeak, focusSet };
});
