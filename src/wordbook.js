// 苦手単語の単語帳（紙に印刷する PDF）の純粋ロジック。DOM にも保存にも触れない。
// ブラウザでは StudyCore.*、node では require で使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  // 1セットの語数（暗記ページ 1 枚 = 15 語 × 左右 2 ブロック）
  const SET_SIZE = 30;

  // 品詞の略記。ここにない品詞はそのまま出す
  const POS_SHORT = {
    名詞: '名', 動詞: '動', 形容詞: '形', 副詞: '副',
    動詞句: '動句', 名詞句: '名句', 形容詞句: '形句',
    表現: '句', '句・表現': '句',
  };

  function shortPos(p) {
    return Object.prototype.hasOwnProperty.call(POS_SHORT, p) ? POS_SHORT[p] : p;
  }

  // 保存されていた値の読み込み用。オプションごとに、真偽値でなければオン
  function normalizeOptions(v) {
    const o = v !== null && typeof v === 'object' ? v : {};
    return {
      red: typeof o.red === 'boolean' ? o.red : true,
      test: typeof o.test === 'boolean' ? o.test : true,
    };
  }

  // 苦手の記録（{見出し語: 記録}）と語データから、出力する語の配列を作る。語データにないキーは捨てる。
  // 語データには見出し語の重複がある（daily と TEPPAN）。苦手リストの表示（RAW_WORDS.find）と同じく最初の1件を使う
  function selectItems(weakData, words) {
    const byWord = new Map();
    words.forEach(x => { if (!byWord.has(x.w)) byWord.set(x.w, x); });
    return Object.keys(weakData)
      .filter(k => byWord.has(k))
      .map(k => ({ key: k, entry: weakData[k], word: byWord.get(k) }));
  }

  // 復習日が近い順。同じ日なら追加日の古い順、さらに同じなら見出し語のABC順
  function sortByDue(items) {
    return [...items].sort((a, b) =>
      a.entry.due - b.entry.due
      || a.entry.added - b.entry.added
      || a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));
  }

  function chunk(items, size = SET_SIZE) {
    const groups = [];
    for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
    return groups;
  }

  // フィッシャー–イェーツ。rng は 0 以上 1 未満を返す関数（テストで固定できる）
  function shuffle(items, rng = Math.random) {
    const out = [...items];
    for (let i = out.length - 1; i >= 1; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ---- 印刷用 HTML ----
  const ROWS_PER_BLOCK = SET_SIZE / 2; // 左右 2 ブロック
  const LONG_MEANING = 20; // 意味がこの文字数を超える行は、文字を小さくする
  // 見出し語が長いときの英語の文字サイズ。全体の文字数（語データの最長は 37 文字）と、折り返せない1語の最長の文字数の両方で決める
  const EN_MID = 17;
  const EN_SMALL = 25;
  const EN_TOKEN_MID = 13;
  const EN_TOKEN_SMALL = 17;
  const KIND_LABEL = { study: '暗記', test: 'テスト', answer: '答え' };
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ESCAPES[c]);

  // A4 縦。左の余白は穴あけ用に広く取る。ブロックの幅は 87mm（本文 180mm、間隔 6mm）。
  // 行の高さは暗記・テストが 15mm、答えは 9mm 以上。日本語の赤字は赤シートで消える朱赤
  const CSS = `
@page { size: A4 portrait; margin: 15mm 10mm 15mm 20mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif; color: #111; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 180mm; height: 266mm; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-of-type { break-after: auto; page-break-after: auto; }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; border-bottom: 0.4mm solid #333; padding-bottom: 1.5mm; margin-bottom: 3mm; font-size: 9pt; }
.title { font-weight: 700; font-size: 11pt; }
.kind { border: 0.3mm solid #333; border-radius: 1mm; padding: 0 2mm; }
.blocks { display: flex; gap: 6mm; }
.block { width: 87mm; }
.colhead { display: grid; grid-template-columns: 7mm 36mm 1fr; align-items: center; height: 7mm; font-size: 8pt; color: #555; border-bottom: 0.4mm solid #333; }
.row { display: grid; grid-template-columns: 7mm 36mm 1fr; grid-template-rows: 1fr auto; height: 15mm; border-bottom: 0.3mm solid #999; break-inside: avoid; }
.k-test .colhead, .k-test .row { grid-template-columns: 7mm 40mm 1fr; }
.k-answer .row { height: auto; min-height: 9mm; grid-template-rows: auto; }
.no { align-self: center; text-align: right; padding-right: 1.5mm; font-size: 8pt; color: #777; }
.en { align-self: center; font-weight: 700; font-size: 11pt; line-height: 1.15; border-right: 0.3mm dashed #999; padding: 0 1mm; }
.en-mid { font-size: 9pt; }
.en-small { font-size: 7pt; }
.pos { margin-left: 1mm; font-size: 7pt; font-weight: 400; color: #777; }
.ja { align-self: center; padding: 0 1.5mm; font-size: 9pt; line-height: 1.2; }
.k-test .ja { border-right: 0.3mm dashed #999; }
.ja.long { font-size: 6.5pt; line-height: 1.1; }
.ja-red { color: #e0301e; }
.checks { grid-column: 2; grid-row: 2; border-right: 0.3mm dashed #999; padding: 0 1mm 1mm; font-size: 8pt; color: #666; letter-spacing: 0.5mm; }
.memo { grid-column: 3; grid-row: 2; margin: 0 1.5mm 2mm; border-bottom: 0.2mm solid #bbb; }
`;

  function enCell(word) {
    const token = Math.max(...word.w.split(/\s+/).map(t => t.length));
    const cls = word.w.length >= EN_SMALL || token >= EN_TOKEN_SMALL ? 'en en-small'
      : word.w.length >= EN_MID || token >= EN_TOKEN_MID ? 'en en-mid' : 'en';
    return `<span class="${cls}">${esc(word.w)}<small class="pos">${esc(shortPos(word.p))}</small></span>`;
  }

  function jaCell(word, red) {
    const cls = ['ja'];
    if (red) cls.push('ja-red');
    if (word.m.length > LONG_MEANING) cls.push('long');
    return `<span class="${cls.join(' ')}">${esc(word.m)}</span>`;
  }

  const rowOpen = item => `<div class="row" data-w="${esc(item.word.w)}">`;

  const ROW = {
    study: (n, item, red) => `${rowOpen(item)}<span class="no">${n}</span>${enCell(item.word)}${jaCell(item.word, red)}`
      + '<span class="checks">□ □ □</span><span class="memo"></span></div>',
    test: (n, item) => `${rowOpen(item)}<span class="no">${n}</span>${jaCell(item.word, false)}<span class="blank"></span></div>`,
    answer: (n, item, red) => `${rowOpen(item)}<span class="no">${n}</span>${enCell(item.word)}${jaCell(item.word, red)}</div>`,
  };

  const COLHEAD = {
    study: ['No', '英語', '日本語'],
    test: ['No', '日本語', '英語を書く'],
    answer: ['No', '英語', '日本語'],
  };

  // 1 セット分の語（最大 30）を、30 行（語の行＋空の行）の 1 ページにする
  function pageHtml(kind, items, red, head) {
    const rows = Array.from({ length: SET_SIZE }, (_, i) =>
      (items[i] ? ROW[kind](i + 1, items[i], red) : '<div class="row empty"></div>'));
    const block = part => `<div class="block k-${kind}"><div class="colhead">${COLHEAD[kind].map(t => `<span>${t}</span>`).join('')}</div>${part.join('')}</div>`;
    return `<section class="page" data-kind="${kind}" data-set="${head.set}">`
      + `<header class="head"><span class="title">${head.title}</span><span>${esc(head.date)}</span>`
      + `<span>セット ${head.set}/${head.sets}</span>${head.showKind ? `<span class="kind">${KIND_LABEL[kind]}</span>` : ''}`
      + `<span>p. ${head.page}/${head.pages}</span></header>`
      + `<div class="blocks">${block(rows.slice(0, ROWS_PER_BLOCK))}${block(rows.slice(ROWS_PER_BLOCK))}</div></section>`;
  }

  // 並べ替え済みの items から、印刷用の HTML 全体を作る。options は { red, test }
  function buildDocument({ items, modeLabel, date, options }) {
    const { red, test } = normalizeOptions(options);
    const sets = chunk(items);
    const perSet = test ? 3 : 1;
    const title = esc(`TOEIC 苦手単語帳（${modeLabel}）`);
    const pages = [];
    sets.forEach((group, s) => {
      const quiz = test ? shuffle(group) : null;
      const kinds = test ? [['study', group], ['test', quiz], ['answer', quiz]] : [['study', group]];
      kinds.forEach(([kind, list], k) => {
        const head = { title, date, set: s + 1, sets: sets.length, showKind: test, page: s * perSet + k + 1, pages: sets.length * perSet };
        pages.push(pageHtml(kind, list, red, head));
      });
    });
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>${pages.join('')}</body></html>`;
  }

  return { SET_SIZE, shortPos, normalizeOptions, selectItems, sortByDue, chunk, shuffle, buildDocument };
});
