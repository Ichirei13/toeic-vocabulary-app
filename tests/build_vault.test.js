// Vault の読み取り・問題の対応づけ（tools/lib/vault.mjs, match.mjs）の検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/build_vault.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const MINI = path.resolve(__dirname, 'fixtures', 'mini-vault');
const lib = name => import(path.resolve(__dirname, '..', 'tools', 'lib', name));

test('loadVault: 問題・概念・Trap をミニ Vault から読む', async () => {
  const { loadVault } = await lib('vault.mjs');
  const v = await loadVault(MINI);
  assert.strictEqual(v.questions.length, 4);
  assert.strictEqual(v.concepts.length, 2);
  assert.strictEqual(v.traps.length, 1);

  const kin1 = v.questions.find(q => q.practiceId === 1001);
  assert.ok(kin1, '金の 1 問目 (practice_id 1001)');
  assert.strictEqual(kin1.book, '金の文法');
  assert.strictEqual(kin1.chapter, 1, 'front matter の chapter を数値で持つ');
  assert.strictEqual(kin1.text, "The ------- of a new digital marketing strategy is on the agenda for this afternoon's meeting.");
  assert.deepStrictEqual(kin1.conceptIds, ['SVOC（文の骨格）', '名詞の役割（主語・目的語・補語）']);
  assert.deepStrictEqual(kin1.trapIds, []);

  const top = v.questions.find(q => q.practiceId === 2257);
  assert.strictEqual(top.book, 'トップレベル英語');
  assert.strictEqual(top.chapter, 10);
  assert.deepStrictEqual(top.trapIds, ['Trap_08_分子修飾の能動(-ing)と受動(-ed)の識別'], '同じ Trap への重複リンクは 1 件にまとめる');

  const svoc = v.concepts.find(c => c.id === 'SVOC（文の骨格）');
  assert.strictEqual(svoc.name, 'SVOC（文の骨格）');
  assert.ok(svoc.desc.includes('配置の言語'));
  const noun = v.concepts.find(c => c.id === '名詞の役割（主語・目的語・補語）');
  assert.ok(noun.desc.includes('S・O・C') && noun.desc.includes('役割を先に決める'), '複数行の本文を欠かさず持つ');

  const trap = v.traps[0];
  assert.strictEqual(trap.id, 'Trap_08_分子修飾の能動(-ing)と受動(-ed)の識別');
  assert.strictEqual(trap.name, '分詞修飾の能動(-ing)と受動(-ed)の識別');
  assert.ok(trap.desc.includes('逆にしてしまう罠'));
  assert.ok(trap.advice.length > 0);
  assert.ok(trap.advice.includes('-ed を最優先にする'), 'advice は複数行を切らずに持つ');
  assert.ok(!trap.advice.startsWith('>'));
});

test('normalizeText: 空白・記号・全角半角・大文字小文字を揃える', async () => {
  const { normalizeText } = await lib('match.mjs');
  const a = normalizeText('A  prize ------- for…');
  const b = normalizeText('a　prize －－－－－－－ for…');
  assert.strictEqual(a, b);
  assert.notStrictEqual(normalizeText('A prize'), normalizeText('A price'));
});

const vq = (practiceId, book, text) => ({ practiceId, book, text, conceptIds: [], trapIds: [] });

test('matchQuestions: ID 一致・本文一致・未対応', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const vault = [
    vq(1001, '金の文法', 'The ------- of a strategy is on the agenda.'),
    vq(2257, 'トップレベル英語', '“Hello,” said Tom, smiling.'),
  ];
  const app = [
    { id: 1001, b: 'kin', q: 'The ------- of a strategy is on the agenda.' },
    { id: 3011, b: 'toplevel', q: '"Hello,"  said Tom, smiling.' },
    { id: 3012, b: 'toplevel', q: 'Nothing like this exists in the Vault.' },
  ];
  const r = await matchQuestions(app, vault);
  assert.strictEqual(r.byApp.get(1001), vault[0]);
  assert.strictEqual(r.via.get(1001), 'id');
  assert.strictEqual(r.byApp.get(3011), vault[1]);
  assert.strictEqual(r.via.get(3011), 'text');
  assert.deepStrictEqual(r.unmatched, [3012]);
  assert.ok(!r.byApp.has(3012));
});

test('matchQuestions: 同じ本文が複数あるときは同じ本の未使用の Vault 問題を順に割り当てる', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const same = 'A prize ------- for the idea.';
  const vault = [
    vq(2010, 'トップレベル英語', same),
    vq(2020, 'トップレベル英語', same),
    vq(1002, '金の文法', same),
  ];
  const app = [
    { id: 3001, b: 'toplevel', q: same },
    { id: 3002, b: 'toplevel', q: same },
    { id: 3003, b: 'toplevel', q: same },
  ];
  const r = await matchQuestions(app, vault);
  assert.strictEqual(r.byApp.get(3001), vault[0]);
  assert.strictEqual(r.byApp.get(3002), vault[1]);
  assert.deepStrictEqual(r.unmatched, [3003], '同じ本の候補が尽きたら、別の本の同文は使わず未対応にする');
  assert.strictEqual(new Set(r.byApp.values()).size, r.byApp.size, '同じ Vault 問題を二重に使わない');
});

test('matchQuestions: practice_id が同じでも本が違えば ID 一致にしない', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const vault = [vq(2001, 'トップレベル英語', 'Completely different sentence.')];
  const app = [{ id: 2001, b: 'polaris2', q: 'Polaris question text here.' }];
  const r = await matchQuestions(app, vault);
  assert.deepStrictEqual(r.unmatched, [2001]);
});

test('matchQuestions: ID 一致を先に確定し、本文一致が奪わない', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const same = 'Same words ------- here.';
  const vault = [vq(1001, '金の文法', same), vq(1002, '金の文法', same)];
  const app = [
    { id: 9999, b: 'kin', q: same },   // 本文一致（先に並ぶが ID 一致の後に処理される）
    { id: 1001, b: 'kin', q: same },
  ];
  const r = await matchQuestions(app, vault);
  assert.strictEqual(r.byApp.get(1001), vault[0]);
  assert.strictEqual(r.via.get(1001), 'id');
  assert.strictEqual(r.byApp.get(9999), vault[1]);
  assert.strictEqual(r.via.get(9999), 'text');
});

// ---- 実 Vault で見つかった書式のゆれ（OCR 由来の本文・仮の本文・番号の付き替え） ----

test('questionText: 引用ブロックの次の行に続く英文を含め、定型の指示文・選択肢の 1 行表記・フッターは除く', async () => {
  const { questionText } = await lib('vault.mjs');
  const body = [
    '## 問題文', '',
    '> 空欄 に 入る 最も 適切 な も の を 選び な さい 。',
    'In------- 1930s there was a lot of unemployment.',
    '1.a 2. an 3. the 4. 無冠 詞',
    '© RECRUIT HOLDINGS ー70 一',
    '本 サー ビス に 関す る 知 的 財産 権',
    '', '### 選択肢', '- (A) a',
  ].join('\n');
  assert.strictEqual(questionText(body), 'In------- 1930s there was a lot of unemployment.');
  const kin = '## 問題文\n\n> One line.\n\n### 選択肢\n- (A) x\n';
  assert.strictEqual(questionText(kin), 'One line.');
});

test('matchQuestions: 本文が包含関係なら結ぶが、共通の短い指示文だけの Vault 問題には結ばない', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const vault = [
    vq(2001, 'トップレベル英語', 'ia        ) the problem?” asked the teacher, but nobody answered.            '),
    vq(2002, 'トップレベル英語', '日本語の意味になるように、[  ]内の語句を並べ替えなさい。'),
  ];
  const app = [
    { id: 3001, b: 'toplevel', q: '*{ ) the problem?” asked the teacher, but nobody answered.' },
    { id: 3002, b: 'toplevel', q: '日本語の意味になるように、[ ]内の語句を並べ替えなさい。 伯父の経済的な援助がなければ、ローラは大学を卒業できなかった。' },
  ];
  const r = await matchQuestions(app, vault);
  assert.strictEqual(r.byApp.get(3001), vault[0]);
  assert.strictEqual(r.via.get(3001), 'text');
  assert.deepStrictEqual(r.unmatched, [3002]);
});

test('matchQuestions: アプリが付けた【…】の見出しは、見出しなしの同文を取り合わないよう後回しにする', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const vault = [
    vq(2457, 'トップレベル英語', '応答として不適当なものを1つ選べ。\nA: Do you have the time?\nB:-------'),
    vq(2474, 'トップレベル英語', 'A: Do you have the time?\nB:-------'),
  ];
  const app = [
    { id: 3245, b: 'toplevel', q: '【不適当なものを選択】\nA: Do you have the time?\nB:-------' },
    { id: 3260, b: 'toplevel', q: 'A: Do you have the time?\nB:-------' },
  ];
  const r = await matchQuestions(app, vault);
  assert.strictEqual(r.byApp.get(3260), vault[1]);
  assert.strictEqual(r.byApp.get(3245), vault[0]);
  assert.deepStrictEqual(r.unmatched, []);
});

test('matchQuestions: 本文が仮の文字列の問題は、問題数が等しく並び順が一致している本に限り並び順で結ぶ', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const texts = i => `Sentence number ${i} of the Polaris book ------- here.`;
  const vault = [];
  const app = [];
  for (let i = 1; i <= 8; i++) {
    // Vault 側の ID は 3000 台、アプリ側は 2000 台（番号の付き方が違う）。3 と 6 は Vault の本文が仮の文字列
    vault.push(vq(3000 + i, '英文法ポラリス2', i === 3 || i === 6 ? `Polaris Question ${i}` : texts(i)));
    app.push({ id: 2000 + i, b: 'polaris2', q: texts(i) });
  }
  const r = await matchQuestions(app, vault);
  assert.deepStrictEqual(r.unmatched, []);
  app.forEach((q, i) => assert.strictEqual(r.byApp.get(q.id), vault[i]));
  assert.strictEqual(r.via.get(2003), 'order');
  assert.strictEqual(r.via.get(2001), 'text');

  // 問題数が違う本には使わない
  const r2 = await matchQuestions(app, vault.slice(0, 7));
  assert.ok(r2.unmatched.length > 0);
  // 並び順が一致していない本には使わない
  const reversed = vault.map((v, i) => vq(3009 - (i + 1), v.book, v.text));
  const r3 = await matchQuestions(app, reversed);
  assert.ok(![...r3.via.values()].includes('order'));
  assert.ok(r3.unmatched.includes(2003));
});

// ---- 並び順（order）の段階: 章の自己検証・ID 一致の保護・しきい値 ----

// 本 polaris2 の n 問。placeholders に含む番号（0 始まり）は Vault の本文が仮の文字列。
// swap=[i,j] は、アプリ側の i 番目と j 番目の本文を入れ替える（並び順とのずれを作る）。
function orderedBook({ n, placeholders = [], swap = null, chapterOf = i => 1 + Math.floor(i / 5) }) {
  const vault = [];
  const app = [];
  for (let i = 0; i < n; i++) {
    const text = `Unique sentence number ${i} for the ordered book ------- here.`;
    vault.push({ ...vq(3001 + i, '英文法ポラリス2', placeholders.includes(i) ? `Polaris Question ${i}` : text), chapter: chapterOf(i) });
    app.push({ id: 2001 + i, b: 'polaris2', ch: chapterOf(i), q: text });
  }
  if (swap) { const t = app[swap[0]].q; app[swap[0]].q = app[swap[1]].q; app[swap[1]].q = t; }
  return { vault, app };
}

test('order: 章がすべて一致していれば並び順で結ぶ', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const { vault, app } = orderedBook({ n: 14, placeholders: [10, 11, 12, 13] });
  const r = await matchQuestions(app, vault);
  assert.deepStrictEqual(r.unmatched, []);
  assert.strictEqual(r.via.get(2011), 'order');
  assert.strictEqual(r.byApp.get(2014), vault[13]);
});

test('order: 結ぶ組の章が 1 組でも食い違えば、その本には並び順を使わず黙って結ばない', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const { vault, app } = orderedBook({ n: 14, placeholders: [10, 11, 12, 13] });
  app[12].ch = 99; // 並び順で結ぶと Vault の章 (1 + floor(12/5) = 3) と食い違う
  const r = await matchQuestions(app, vault);
  assert.ok(![...r.via.values()].includes('order'), 'order は 1 組も使わない');
  assert.deepStrictEqual(r.unmatched, [2011, 2012, 2013, 2014]);
  assert.strictEqual(r.byApp.get(2001), vault[0], '本文で結べた分は残る');
});

test('order: 章が不明(null)の組は章では確かめられないので通す', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const { vault, app } = orderedBook({ n: 14, placeholders: [10, 11, 12, 13] });
  vault[12].chapter = null;
  const r = await matchQuestions(app, vault);
  assert.strictEqual(r.via.get(2013), 'order');
});

test('order: ID 一致で結んだ組は上書きしない', async () => {
  const { matchQuestions } = await lib('match.mjs');
  // 20 問。Vault の practice_id は 1〜18, 20, 25。アプリの 20 番は ID で practice_id 20（順位 18）に結ばれるが、
  // 並び順では 19 番目（順位 19 = practice_id 25）にあたる。アプリの 19 番は本文で practice_id 25 に結ばれる。
  const pids = [...Array.from({ length: 18 }, (_, i) => i + 1), 20, 25];
  const vault = pids.map(p => ({ ...vq(p, '世界一わかりやすい英文法', `Distinct sentence ${p} for the id test ------- here.`), chapter: null }));
  const app = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, b: 'sekai', q: `Distinct sentence ${pids[i]} for the id test ------- here.` }));
  app[18].q = vault[19].text; // アプリ 19 番 → 本文で practice_id 25
  app[19].q = 'completely different words that appear nowhere in the vault';
  const r = await matchQuestions(app, vault);
  assert.strictEqual(r.via.get(20), 'id');
  assert.strictEqual(r.byApp.get(20), vault[18], 'ID 一致の組は並び順で奪われない');
  assert.strictEqual(r.byApp.get(19), vault[19]);
  assert.strictEqual(new Set(r.byApp.values()).size, r.byApp.size);
});

test('order: 順位の一致率が 8 割なら使わない（9 割以上なら使う）', async () => {
  const { matchQuestions } = await lib('match.mjs');
  // 14 問のうち 10 問が本文で結べる。入れ替え 1 組 = 2 問がずれるので 8/10 = 80%
  const bad = orderedBook({ n: 14, placeholders: [10, 11, 12, 13], swap: [1, 2] });
  const r = await matchQuestions(bad.app, bad.vault);
  assert.ok(![...r.via.values()].includes('order'));
  assert.deepStrictEqual(r.unmatched, [2011, 2012, 2013, 2014]);
  // 20 問のうち 18 問が本文で結べ、すべて順位どおり（18/18）なら使う
  const good = orderedBook({ n: 20, placeholders: [18, 19] });
  const r2 = await matchQuestions(good.app, good.vault);
  assert.strictEqual(r2.via.get(2019), 'order');
});

test('order: 本文で結べた組が 5 組に満たなければ使わない', async () => {
  const { matchQuestions } = await lib('match.mjs');
  const few = orderedBook({ n: 10, placeholders: [4, 5, 6, 7, 8, 9] }); // 本文で結べるのは 4 問
  const r = await matchQuestions(few.app, few.vault);
  assert.ok(![...r.via.values()].includes('order'));
  assert.deepStrictEqual(r.unmatched, [2005, 2006, 2007, 2008, 2009, 2010]);
  const enough = orderedBook({ n: 10, placeholders: [5, 6, 7, 8, 9] }); // ちょうど 5 問
  const r2 = await matchQuestions(enough.app, enough.vault);
  assert.strictEqual(r2.via.get(2010), 'order');
});

test('loadVault: v4 形式の問題ノートから主概念・副概念・solve_type・point を読む', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { loadVault } = await lib('vault.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-v4-'));
  try {
    const qDir = path.join(tmp, '03_Questions', '金の文法');
    fs.mkdirSync(qDir, { recursive: true });
    fs.writeFileSync(path.join(qDir, 'kin_001_Q001.md'), `---
practice_id: 1001
book: 金の文法
chapter: 1
solve_type: 文構造
point: "主語と動詞の対応を確認する"
---
## 問題文
> The manager ------- the report yesterday.

### 主な文法概念（コアハブ）
- [[00_Concepts/SVOC（文の骨格）|SVOC（文の骨格）]]

### 関連する文法概念（補助ハブ）
- [[00_Concepts/動詞の時制と相|動詞の時制と相]]

### ⚠️ 注意すべきひっかけ・トラップ
- [[04_Traps/Trap_05_自動詞・他動詞の混同と前置詞の有無|自動詞・他動詞]]
`);
    const v = await loadVault(tmp);
    assert.strictEqual(v.questions.length, 1);
    const q = v.questions[0];
    assert.strictEqual(q.primaryConceptId, 'SVOC（文の骨格）');
    assert.deepStrictEqual(q.secondaryConceptIds, ['動詞の時制と相']);
    assert.strictEqual(q.solveType, '文構造');
    assert.strictEqual(q.point, '主語と動詞の対応を確認する');
    assert.deepStrictEqual(q.trapIds, ['Trap_05_自動詞・他動詞の混同と前置詞の有無']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
