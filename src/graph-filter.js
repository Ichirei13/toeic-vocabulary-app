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
      if (!kindOk[kind[i]]) continue;
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

  return { visibleMask, lodForScale, kindsAtLod, LOD_SCALES };
});
