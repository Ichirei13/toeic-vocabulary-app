// アプリの文法問題（RAW_GRAMMAR）と Vault の問題ノートの対応づけ。
// 順序: ① ID 一致（アプリの id = Vault の practice_id、かつ同じ本）→ ② 正規化した本文の一致（同じ本）
//       → ③ 正規化した本文の包含（同じ本。Vault 側の OCR 由来の前置き・末尾のごみ、続きの行の違いを許す）。
//       → ④ 並び順（本の問題数がアプリと Vault で等しく、本文で結べた組が並び順と一致しているときだけ。
//          Vault の本文が「Polaris Question 4」のような仮の文字列で本文が使えない問題を拾う。
//          その本の全問を順位で結ぶ（同文の重複の取り違えも直る）。via は 'order'。
//          アプリの章 ch と Vault の章 chapter が 1 組でも食い違えば使わない）。
// 同じ本文が複数あるときは、同じ本の未使用の Vault 問題を practice_id 順に割り当てる。

// アプリの本コード → Vault の本名
export const BOOK_NAMES = {
  sekai: '世界一わかりやすい英文法',
  kin: '金の文法',
  polaris2: '英文法ポラリス2',
  toplevel: 'トップレベル英語',
};
const bookKey = b => BOOK_NAMES[b] || b;

// 空白・記号を除き、全角半角（NFKC）と大文字小文字を揃える。残るのは文字と数字だけ
export function normalizeText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// 包含の判定に使う最小の長さ（短い本文どうしの偶然の一致を避ける）
const MIN_CONTAIN = 16;
// 短いほうが長いほうの何割以上か（「次の文の間違いを…」のような共通の指示文だけの Vault 問題に結ばないため）
const MIN_RATIO = 0.5;

// アプリ側の本文。アプリが付けた【不適当なものを選択】のような見出しは Vault の本文にないので除く
const appText = q => normalizeText(String(q.q ?? '').replace(/【[^】]*】/g, ''));

export function matchQuestions(appQuestions, vaultQuestions) {
  const byApp = new Map();
  const via = new Map();
  const used = new Set();

  const byId = new Map();
  for (const v of vaultQuestions) if (!byId.has(v.practiceId)) byId.set(v.practiceId, v);

  // ① ID 一致（本が違えば practice_id が同じでも結ばない。本ごとに番号の付き方が違うため）
  for (const q of appQuestions) {
    const v = byId.get(q.id);
    if (v && !used.has(v) && bookKey(q.b) === bookKey(v.book)) {
      byApp.set(q.id, v);
      via.set(q.id, 'id');
      used.add(v);
    }
  }

  // ② 本文一致。(本, 正規化した本文) ごとに、未使用の Vault 問題を practice_id 順に並べる
  const pool = new Map();
  for (const v of [...vaultQuestions].sort((a, b) => a.practiceId - b.practiceId)) {
    if (used.has(v)) continue;
    const key = bookKey(v.book) + '\u0000' + normalizeText(v.text);
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(v);
  }
  // アプリが付けた【…】の見出しを除いた本文は、見出しを残した本文で結べなかった問題にだけ使う（同じ本文の問題を取り合わないため）
  let rest = appQuestions.filter(q => !byApp.has(q.id));
  for (const textOf of [q => normalizeText(q.q), appText]) {
    const next = [];
    for (const q of rest) {
      const norm = textOf(q);
      const list = norm ? pool.get(bookKey(q.b) + '\u0000' + norm) : null;
      const v = list && list.shift();
      if (v) {
        byApp.set(q.id, v);
        via.set(q.id, 'text');
        used.add(v);
      } else {
        next.push(q);
      }
    }
    rest = next;
  }

  // ③ 包含（どちらかがもう一方に含まれる）。長さの差が小さい候補を優先し、同じなら practice_id 順
  const unmatched = [];
  const remaining = vaultQuestions
    .filter(v => !used.has(v))
    .map(v => ({ v, norm: normalizeText(v.text) }))
    .sort((a, b) => a.v.practiceId - b.v.practiceId);
  for (const q of rest) {
    const norm = appText(q);
    const key = bookKey(q.b);
    let best = null;
    if (norm.length >= MIN_CONTAIN) {
      for (const r of remaining) {
        if (used.has(r.v) || bookKey(r.v.book) !== key || r.norm.length < MIN_CONTAIN) continue;
        if (!r.norm.includes(norm) && !norm.includes(r.norm)) continue;
        if (Math.min(r.norm.length, norm.length) / Math.max(r.norm.length, norm.length) < MIN_RATIO) continue;
        const gap = Math.abs(r.norm.length - norm.length);
        if (!best || gap < best.gap) best = { v: r.v, gap };
      }
    }
    if (best) {
      const v = best.v;
      byApp.set(q.id, v);
      via.set(q.id, 'text');
      used.add(v);
    } else {
      unmatched.push(q.id);
    }
  }

  // ④ 並び順。本ごとに、アプリと Vault の問題数が等しく、結べた組の 9 割以上（かつ 5 組以上）が同じ順位
  //    （アプリの id 順で何番目 = Vault の practice_id 順で何番目）のときだけ、その本の全問を順位で結ぶ。
  //    同文の重複を本文で取り違えた組も、順位で結び直す（ずれが後ろの問題に波及しないように）。
  //    ・ID 一致で結べた組は上書きしない。
  //    ・自己検証: 順位で結ぶ組のうち、アプリの章（ch）と Vault の章（chapter）が両方わかっていて食い違うものが
  //      1 組でもあれば、その本には並び順を使わない（本文で結べた分だけ残し、残りは未対応にして検証を失敗させる）。
  //      どちらかの章がわからない組は章では確かめられない（通す）。
  const reassigned = new Set();
  const chapterOf = v => (v.chapter === undefined || v.chapter === null ? null : Number(v.chapter));
  for (const key of new Set(appQuestions.map(q => bookKey(q.b)))) {
    const app = appQuestions.filter(q => bookKey(q.b) === key).sort((a, b) => a.id - b.id);
    const vs = vaultQuestions.filter(v => bookKey(v.book) === key).sort((a, b) => a.practiceId - b.practiceId);
    if (app.length === 0 || app.length !== vs.length) continue;
    let known = 0;
    let agree = 0;
    app.forEach((q, i) => {
      const v = byApp.get(q.id);
      if (v) { known++; if (v === vs[i]) agree++; }
    });
    if (known < 5 || agree < 0.9 * known) continue;
    const plan = [];
    let refuse = false;
    app.forEach((q, i) => {
      if (via.get(q.id) === 'id' || byApp.get(q.id) === vs[i]) return;
      const holder = app.find(o => o !== q && via.get(o.id) === 'id' && byApp.get(o.id) === vs[i]);
      const ca = q.ch === undefined || q.ch === null ? null : Number(q.ch);
      const cv = chapterOf(vs[i]);
      if (holder || (ca !== null && cv !== null && ca !== cv)) refuse = true;
      plan.push([q, vs[i]]);
    });
    if (refuse) continue;
    for (const [q, v] of plan) {
      byApp.set(q.id, v);
      via.set(q.id, 'order');
      reassigned.add(q.id);
    }
  }
  const stillUnmatched = unmatched.filter(id => !reassigned.has(id));
  return { byApp, via, unmatched: stillUnmatched };
}
