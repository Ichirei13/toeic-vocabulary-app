const test = require('node:test');
const assert = require('node:assert');
const W = require('../../src/wordbook.js');

const word = (w, m = '意味', p = '名詞') => ({ w, m, p });
const entry = (due, added = 0) => ({ streak: 0, added, due, u: 0 });

test('shortPos: 品詞を略す。知らない品詞はそのまま', () => {
  const cases = {
    名詞: '名', 動詞: '動', 形容詞: '形', 副詞: '副',
    動詞句: '動句', 名詞句: '名句', 形容詞句: '形句',
    表現: '句', '句・表現': '句', 前置詞: '前置詞',
  };
  Object.entries(cases).forEach(([p, short]) => assert.strictEqual(W.shortPos(p), short, p));
});

test('normalizeOptions: 真偽値以外はオン。片方だけでも読める', () => {
  assert.deepStrictEqual(W.normalizeOptions({ red: false, test: true }), { red: false, test: true });
  assert.deepStrictEqual(W.normalizeOptions({ red: 'no', test: null }), { red: true, test: true });
  assert.deepStrictEqual(W.normalizeOptions(undefined), { red: true, test: true });
  assert.deepStrictEqual(W.normalizeOptions('x'), { red: true, test: true });
  assert.deepStrictEqual(W.normalizeOptions({ test: false }), { red: true, test: false });
});

test('selectItems: 語データにないキーは捨てる', () => {
  const items = W.selectItems({ apple: entry(1), ghost: entry(2) }, [word('apple'), word('pear')]);
  assert.deepStrictEqual(items.map(x => x.key), ['apple']);
  assert.strictEqual(items[0].word.w, 'apple');
  assert.strictEqual(items[0].entry.due, 1);
});

test('selectItems: 見出し語が重複するときは最初の1件を使う（苦手リストの表示と同じ）', () => {
  const items = W.selectItems({ dup: entry(1) }, [word('dup', '最初の意味'), word('dup', '2番目の意味')]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].word.m, '最初の意味');
});

test('sortByDue: 復習日 → 追加日 → ABC順。元の配列は変えない', () => {
  const items = [
    { key: 'b', entry: entry(2, 5) },
    { key: 'a', entry: entry(2, 5) },
    { key: 'c', entry: entry(1, 9) },
    { key: 'd', entry: entry(2, 1) },
  ];
  const copy = [...items];
  assert.deepStrictEqual(W.sortByDue(items).map(x => x.key), ['c', 'd', 'a', 'b']);
  assert.deepStrictEqual(items, copy);
});

test('chunk: 30語ごとに分ける（0・29・30・31・60語）', () => {
  const lengths = n => W.chunk(Array.from({ length: n }, (_, i) => i)).map(g => g.length);
  assert.deepStrictEqual(lengths(0), []);
  assert.deepStrictEqual(lengths(29), [29]);
  assert.deepStrictEqual(lengths(30), [30]);
  assert.deepStrictEqual(lengths(31), [30, 1]);
  assert.deepStrictEqual(lengths(60), [30, 30]);
});

test('shuffle: 同じ語の組を保ち、元の配列は変えない。乱数を固定すると並びも決まる', () => {
  const src = [1, 2, 3, 4, 5];
  assert.deepStrictEqual(W.shuffle(src, () => 0), [2, 3, 4, 5, 1]);
  const out = W.shuffle(src);
  assert.deepStrictEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(src, [1, 2, 3, 4, 5]);
});

// ---- buildDocument ----
const mk = n => Array.from({ length: n }, (_, i) => ({ key: 'w' + i, entry: entry(i), word: word('w' + i, '意味' + i) }));
const build = (items, red = true, testOn = true) =>
  W.buildDocument({ items, modeLabel: '英→日', date: '2026-11-05', options: { red, test: testOn } });
const pages = html => (html.match(/<section class="page"/g) || []).length;
const sections = html => html.split('<section ').slice(1);
const kinds = html => [...html.matchAll(/data-kind="(\w+)"/g)].map(m => m[1]);
const wordsOf = sec => [...sec.matchAll(/data-w="([^"]*)"/g)].map(m => m[1]);
const rowsOf = sec => (sec.match(/class="row/g) || []).length;
const redCells = html => (html.match(/class="ja[^"]*\bja-red\b/g) || []).length;

test('buildDocument: ページ数は、確認テストありでセット数×3、なしでセット数×1', () => {
  [[0, 0, 0], [1, 3, 1], [30, 3, 1], [31, 6, 2], [60, 6, 2]].forEach(([n, withTest, without]) => {
    assert.strictEqual(pages(build(mk(n), true, true)), withTest, `${n}語・テストあり`);
    assert.strictEqual(pages(build(mk(n), true, false)), without, `${n}語・テストなし`);
  });
});

test('buildDocument: ページの種類の順は 暗記 → テスト → 答え（セットごと）', () => {
  assert.deepStrictEqual(kinds(build(mk(31))), ['study', 'test', 'answer', 'study', 'test', 'answer']);
  assert.deepStrictEqual(kinds(build(mk(31), true, false)), ['study', 'study']);
});

test('buildDocument: 各ページは30行（語の行＋空の行）', () => {
  const secs = sections(build(mk(31)));
  assert.deepStrictEqual(secs.map(rowsOf), [30, 30, 30, 30, 30, 30]);
  assert.deepStrictEqual(secs.map(s => wordsOf(s).length), [30, 30, 30, 1, 1, 1]);
});

test('buildDocument: テストと答えは同じ並びで、暗記と同じ30語', () => {
  const [study, quiz, answer] = sections(build(mk(30))).map(wordsOf);
  assert.deepStrictEqual(answer, quiz);
  assert.deepStrictEqual([...quiz].sort(), [...study].sort());
  assert.strictEqual(study.length, 30);
});

test('buildDocument: 赤字は暗記と答えの日本語だけ。確認テストの日本語は赤字にしない', () => {
  assert.strictEqual(redCells(build(mk(31), true, true)), 62);
  assert.strictEqual(redCells(build(mk(31), true, false)), 31);
  assert.strictEqual(redCells(build(mk(31), false, true)), 0);
  const quiz = sections(build(mk(30), true, true)).find(s => s.includes('data-kind="test"'));
  assert.strictEqual(redCells(quiz), 0);
});

test('buildDocument: 意味が20文字を超える語だけ long が付く', () => {
  const items = [
    { key: 'k20', entry: entry(1), word: word('k20', '意'.repeat(20)) },
    { key: 'k21', entry: entry(2), word: word('k21', '意'.repeat(21)) },
  ];
  const [k20, k21] = build(items, false, false).split('data-w="').slice(1);
  assert.ok(!/\blong\b/.test(k20), '20文字');
  assert.ok(/\blong\b/.test(k21), '21文字');
});

test('buildDocument: 見出し語・意味の特殊文字をエスケープする', () => {
  const items = [{ key: 'x', entry: entry(1), word: word('<b>&"x', "a'b") }];
  const html = build(items);
  assert.ok(!html.includes('<b>&"x'));
  assert.ok(html.includes('&lt;b&gt;&amp;&quot;x'));
  assert.ok(html.includes('a&#39;b'));
});

test('buildDocument: ヘッダーにセット・モード・日付・ページの種類を出す。テストなしなら種類は出さない', () => {
  const html = build(mk(31));
  ['セット 2/2', '英→日', '2026-11-05', '暗記', 'テスト', '答え'].forEach(s => assert.ok(html.includes(s), s));
  assert.ok(!build(mk(31), true, false).includes('class="kind"'));
});

test('buildDocument: 用紙・余白・色の強制印刷・朱赤を指定する', () => {
  const html = build(mk(1));
  ['size: A4 portrait', 'margin: 15mm 10mm 15mm 20mm', 'print-color-adjust: exact', '#e0301e']
    .forEach(s => assert.ok(html.includes(s), s));
});

const enClassOf = headword => {
  const piece = build([{ key: 'k', entry: entry(1), word: word(headword) }], true, false).split('data-w="')[1];
  return piece.match(/<span class="(en[^"]*)"/)[1];
};

test('buildDocument: 見出し語が長い行は英語の文字を小さくする（全体が16文字まで通常、17〜24文字 en-mid、25文字以上 en-small）', () => {
  const phrase = n => ('abcd ').repeat(10).slice(0, n).trim().padEnd(n, 'e'); // 空白で折り返せる n 文字
  assert.strictEqual(phrase(16).length, 16);
  assert.strictEqual(enClassOf(phrase(16)), 'en');
  assert.strictEqual(enClassOf(phrase(17)), 'en en-mid');
  assert.strictEqual(enClassOf(phrase(24)), 'en en-mid');
  assert.strictEqual(enClassOf(phrase(25)), 'en en-small');
});

test('buildDocument: 折り返せない長い1語は、全体が短くても小さくする（12文字まで通常、13〜16文字 en-mid、17文字以上 en-small）', () => {
  assert.strictEqual(enClassOf('a'.repeat(12)), 'en');
  assert.strictEqual(enClassOf('a'.repeat(13)), 'en en-mid');
  assert.strictEqual(enClassOf('a'.repeat(16)), 'en en-mid');
  assert.strictEqual(enClassOf('a'.repeat(17)), 'en en-small');
});
