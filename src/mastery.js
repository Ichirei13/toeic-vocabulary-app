// 文法グラフの各ノードの「理解度」の計算。DOM にも保存にも触れない純関数。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  // state の値はこの配列の添字（Uint8Array に入れる）
  const MASTERY_STATES = ['unseen', 'due', 'weak', 'few', 'mid', 'good'];
  const UNSEEN = 0, DUE = 1, WEAK = 2, FEW = 3, MID = 4, GOOD = 5;

  // しきい値はここだけで定義する
  const MASTERY_THRESHOLDS = {
    minAnswers: 3,   // 解答数がこれ未満なら「few」（判定には少なすぎる）
    weakBelow: 0.6,  // 解答数が minAnswers 以上で rate がこれ未満なら「weak」
    goodFrom: 0.8,   // rate がこれ以上で苦手が 0 件なら「good」
  };

  // 異常に大きい a で Int32 の合計があふれないための上限（実データでは到達しない）
  const MAX_ANSWERS = 1000000;

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // グラフ・stats・weak・isDue から、ノードごとの集計と状態を返す。
  //   stats: { [qid]: { a, c } }  weak: { [qid]: entry }  isDue(entry) -> boolean
  // 不正な入力は無視し、例外も NaN も出さない。
  function computeMastery(graph, stats, weak, isDue) {
    const qids = graph.qids;
    const memberStart = graph.memberStart;
    const members = graph.members;
    const n = graph.id.length;
    const nq = qids.length;
    stats = stats && typeof stats === 'object' ? stats : {};
    weak = weak && typeof weak === 'object' ? weak : {};
    const dueFn = typeof isDue === 'function' ? isDue : null;

    // 問題ごとの値を序数順に 1 回だけ作る。グラフの qids から引くので、
    // グラフにない id や 'abc'・'__proto__' のようなキーは自然に対象外になる。
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

    const total = new Int32Array(n);
    const answered = new Int32Array(n);
    const correct = new Int32Array(n);
    const weakCnt = new Int32Array(n);
    const due = new Int32Array(n);
    const rate = new Float32Array(n);
    const state = new Uint8Array(n);
    // 1 つのノード内で同じ序数を 2 回数えないための印（ノード番号 + 1 を書く）
    const stamp = new Int32Array(nq);
    const { minAnswers, weakBelow, goodFrom } = MASTERY_THRESHOLDS;

    for (let i = 0; i < n; i++) {
      let t = 0, a = 0, c = 0, w = 0, d = 0;
      const end = memberStart[i + 1];
      for (let k = memberStart[i]; k < end; k++) {
        const o = members[k];
        if (!(o >= 0 && o < nq) || stamp[o] === i + 1) continue;
        stamp[o] = i + 1;
        t++; a += qa[o]; c += qc[o]; w += qw[o]; d += qd[o];
      }
      total[i] = t; answered[i] = a; correct[i] = c; weakCnt[i] = w; due[i] = d;
      const r = (c + 1) / (a + 2); // 倍精度のまま判定してから Float32 に入れる
      rate[i] = r;
      // 上から順に判定する（先に当たったものが勝つ）
      let s;
      // 苦手登録があっても解答数 0 なら unseen（weak/due の件数には数える。設計書 §6 の判定順どおり）
      if (a === 0) s = UNSEEN;
      else if (d > 0) s = DUE;
      else if (w > 0 || (a >= minAnswers && r < weakBelow)) s = WEAK;
      else if (a < minAnswers) s = FEW;
      else if (r >= goodFrom && w === 0) s = GOOD;
      else s = MID;
      state[i] = s;
    }

    return { total, answered, correct, weak: weakCnt, due, rate, state };
  }

  return { computeMastery, MASTERY_STATES, MASTERY_THRESHOLDS };
});
