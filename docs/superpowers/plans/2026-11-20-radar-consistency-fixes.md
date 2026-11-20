# レーダーチャートモードの判定統一と読みやすさの修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-subagent-driven-development (recommended) or sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レーダーチャートモードの「状態」の判定をネットワーク図・詳細シートと同じ規則にそろえ、「得意／要強化」を解答の少ない分野で決めないようにし、スマホ幅でも軸ラベルを読める大きさにする。

**Architecture:** 判定の規則と記録の読み取りを `src/mastery.js` の 2 つの純関数（`readQuestionArrays`・`classifyMastery`）に集約し、`computeMastery`・`src/graph-report.js`・`src/graph-detail.js` の 3 か所がそれを使う（今はそれぞれが同じ処理を別々に持っていて、レーダーだけ規則が違う）。ラベルの大きさは、レーダーを描く幅が狭いときだけ「詰めた配置」（半径を小さくして文字を大きくする）で描き分ける。

**Tech Stack:** 素の JavaScript（ビルドなし、UMD 形式の `src/*.js`）、SVG、CSS、`node --test`（単体）、Playwright（ブラウザのテスト。グローバル導入済み）。

**Spec:** `docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md`（レーダーチャートモードの設計）。今回直す内容は、2026-11-20 の評価で見つけた次の 3 点（設計書に未記載なので、Task 2・4 で設計書に書き足す）:

1. レーダーの `classifyState`（`src/graph-report.js`）は正答率だけで判定し、苦手・要復習を見ない。`src/mastery.js` の `computeMastery` は苦手・要復習を優先する。例: 関係詞を正答率 90%・苦手 2 問にすると、棒グラフは緑「良好」、同じ項目の詳細シートは「状態: 苦手」、ネットワーク図は赤になる。
2. 「得意」の候補が解答 1 回からなれる。29 問ある倒置・強調を 1 問 1 回だけ正解すると「得意 倒置・強調 100%」になる。
3. 375px 幅で、レーダーの軸ラベルの実効文字サイズが約 6.9px（SVG の viewBox 幅 420 を 291px に縮小、`font-size: 10px`）。1280px 幅でも 10px。

## Global Constraints

- 作業ブランチ: `main` から `fix/radar-consistency` を切って作業する。`main` への統合は全タスク完了後に利用者が決める。
- 生成物 `data/grammar_graph.js` は手で直さない。
- 判定のしきい値は `src/mastery.js` の `MASTERY_THRESHOLDS`（`minAnswers: 3`・`weakBelow: 0.6`・`goodFrom: 0.8`）だけで定義する。ほかのファイルに数値を書き写さない。
- 判定に使う率は `computeMastery` と同じ `(correct + 1) / (answered + 2)`。画面に出す「正答率 %」は今までどおり `correct / answered`（詳細シートも同じ計算なので変えない）。
- `computeMastery` の結果（`total`・`answered`・`correct`・`weak`・`due`・`rate`・`state`）は 1 値も変えない（ネットワーク図の色が変わらないこと）。
- 新しいファイルは足さない（`index.html`・`sw.js` の `ASSETS`・`upload.py` の `FILES` の一覧は変えない）。`sw.js` の `CACHE` は手元で `toeic-drill-v22`（公開版は v21）なので上げない。
- 学習記録・バックアップ・同期・別タブ再読込の形式と対象は変えない。
- レーダー表示中に `requestAnimationFrame` を呼ばない（`CLAUDE.md` 約束 12）。
- `src/*.js` は DOM にも localStorage にも触れない。Node では `require`、ブラウザでは `StudyCore.*`。ブラウザでの読み込み順は `home.js` の `GRAPH_SCRIPTS`（`src/mastery.js` が `src/graph-detail.js`・`src/graph-report.js` より先）。
- コードのコメントは日本語。コミットメッセージは英語で `fix:` / `refactor:` / `test:` / `docs:` の形。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- テストは `python3 -m pytest` ではなく `pytest`。ブラウザのテストは `NODE_PATH=$(npm root -g) node tests/<名前>.test.js` で 1 ファイルずつ。

## Review Focus

1. 苦手を含むが正答率の高い概念（例: 90%・苦手 2 問）は、棒グラフの色・レーダーの点・詳細シート・ネットワーク図のどれでも「苦手」になる → Task 2 の「実グラフで computeMastery と一致する」テスト。
2. 要復習（期限切れ）の苦手を含む概念は `due` になり、点・棒・状態バッジが無色にならない → Task 2 の CSS と、`tests/graph-view.test.js` のコントラスト確認に `is-state-due` を足すステップ。
3. 教材チップで絞ったとき、レーダーの状態と詳細シートの状態が一致する → Task 3 のテスト。
4. 1 問を 3 回解いて全問正解（解答数 3・着手 1 問）でも「得意」にならない → Task 2 のテスト。
5. レーダー表示中に画面幅が広い⇔狭いと変わったら、配置が描き直される（スマホの回転・ウィンドウの幅変更） → Task 4 のテスト。

---

### Task 1: 記録の読み取りと状態の判定を `src/mastery.js` の関数にする

**Files:**
- Modify: `src/mastery.js`（`computeMastery` の問題ごとの読み取りと判定の部分。今の 35〜100 行目付近）
- Test: `tests/unit/mastery.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `readQuestionArrays(graph, stats, weak, isDue) -> { qa: Int32Array, qc: Int32Array, qw: Int32Array, qd: Int32Array, nq: number }`。添字は問題の序数（`graph.qids` の添字）。`qa` 解答数・`qc` 正解数・`qw` 苦手なら 1・`qd` 要復習なら 1。今の `computeMastery` 内の読み取りと同じ規則（不正値は無視、`a` は 1 以上の整数のみ、`c` は 0〜`a` に丸める、上限 `MAX_ANSWERS`、`isDue` の例外は false 扱い）。
  - `classifyMastery(answered, correct, weak, due) -> number`。`MASTERY_STATES` の添字（0 unseen, 1 due, 2 weak, 3 few, 4 mid, 5 good）を返す。
  - どちらも `module.exports` / `StudyCore` に足す（既存の `computeMastery`・`MASTERY_STATES`・`MASTERY_THRESHOLDS` はそのまま）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/mastery.test.js` の末尾に足す:

```js
test('classifyMastery: computeMastery と同じ判定順（unseen → due → weak → few → good → mid）', () => {
  const S = M.MASTERY_STATES;
  const name = (a, c, w, d) => S[M.classifyMastery(a, c, w, d)];
  assert.strictEqual(name(0, 0, 0, 0), 'unseen');
  assert.strictEqual(name(0, 0, 1, 1), 'unseen', '解答 0 なら苦手登録があっても unseen');
  assert.strictEqual(name(10, 9, 1, 1), 'due', '要復習は正答率より優先');
  assert.strictEqual(name(10, 9, 2, 0), 'weak', '苦手があれば正答率 90% でも weak');
  assert.strictEqual(name(3, 0, 0, 0), 'weak', '(0+1)/(3+2)=0.2 < 0.6');
  assert.strictEqual(name(2, 2, 0, 0), 'few', '解答 3 未満');
  assert.strictEqual(name(3, 3, 0, 0), 'good', '(3+1)/(3+2)=0.8');
  assert.strictEqual(name(4, 3, 0, 0), 'mid', '(3+1)/(4+2)=0.667');
});

test('readQuestionArrays: 不正値を無視し、序数ごとの解答・正解・苦手・要復習を返す', () => {
  const g = makeGraph([{ id: 'q1', members: [1] }, { id: 'q2', members: [2] }, { id: 'q3', members: [3] }]);
  const r = M.readQuestionArrays(g,
    { 1: { a: 4, c: 9 }, 2: { a: 'x', c: 1 }, __proto__: { a: 5, c: 5 } },
    { 2: { due: 1 }, 3: { due: 2 } },
    e => { if (e.due === 2) throw new Error('boom'); return e.due === 1; });
  assert.strictEqual(r.nq, 3);
  assert.deepStrictEqual([...r.qa], [4, 0, 0]);
  assert.deepStrictEqual([...r.qc], [4, 0, 0], 'c は a までに丸める');
  assert.deepStrictEqual([...r.qw], [0, 1, 1]);
  assert.deepStrictEqual([...r.qd], [0, 1, 0], 'isDue の例外は要復習にしない');
});
```

（`makeGraph` はこのファイルの 10 行目にある既存の関数。`members` は問題 id の配列で、`qids` は出てきた順に序数が振られる。）

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test tests/unit/mastery.test.js`
Expected: FAIL（`M.classifyMastery is not a function` / `M.readQuestionArrays is not a function`）

- [ ] **Step 3: 実装する**

`src/mastery.js` の `computeMastery` の前に 2 つの関数を置き、`computeMastery` から使う。`computeMastery` 内の「問題ごとの値を序数順に 1 回だけ作る」ループ（`const qa = new Int32Array(nq);` から `for (let o = 0; o < nq; o++) { ... }` の終わりまで）を `readQuestionArrays` に移し、状態判定の `let s; if (a === 0) ... state[i] = s;` を `classifyMastery` の呼び出しに置き換える:

```js
  // 問題ごとの解答数・正解数・苦手・要復習を、グラフの序数順の配列にして返す。
  // グラフの qids から引くので、グラフにない id や 'abc'・'__proto__' のようなキーは自然に対象外になる。
  // computeMastery・graph-report.js・graph-detail.js が同じ読み方をするための共通の入口。
  function readQuestionArrays(graph, stats, weak, isDue) {
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

  // 集計値から状態（MASTERY_STATES の添字）を決める。判定の規則はここだけに置く。
  // 上から順に判定する（先に当たったものが勝つ）。苦手登録があっても解答数 0 なら unseen（設計書 §6 の判定順どおり）
  function classifyMastery(answered, correct, weak, due) {
    const a = answered > 0 ? answered : 0;
    if (a === 0) return UNSEEN;
    if (due > 0) return DUE;
    const { minAnswers, weakBelow, goodFrom } = MASTERY_THRESHOLDS;
    const r = (correct + 1) / (a + 2);
    if (weak > 0 || (a >= minAnswers && r < weakBelow)) return WEAK;
    if (a < minAnswers) return FEW;
    if (r >= goodFrom && weak === 0) return GOOD;
    return MID;
  }
```

`computeMastery` の中は次のようになる（`rate[i] = r` は今のまま残す）:

```js
  function computeMastery(graph, stats, weak, isDue) {
    const memberStart = graph.memberStart;
    const members = graph.members;
    const n = graph.id.length;
    const { qa, qc, qw, qd, nq } = readQuestionArrays(graph, stats, weak, isDue);

    const total = new Int32Array(n);
    // …（answered・correct・weakCnt・due・rate・state・stamp の宣言は今のまま）…
    for (let i = 0; i < n; i++) {
      // …（t, a, c, w, d を数えるループは今のまま）…
      total[i] = t; answered[i] = a; correct[i] = c; weakCnt[i] = w; due[i] = d;
      rate[i] = (c + 1) / (a + 2); // 倍精度のまま判定してから Float32 に入れる
      state[i] = classifyMastery(a, c, w, d);
    }
    return { total, answered, correct, weak: weakCnt, due, rate, state };
  }
```

末尾の `return` に 2 つ足す:

```js
  return { computeMastery, readQuestionArrays, classifyMastery, MASTERY_STATES, MASTERY_THRESHOLDS };
```

- [ ] **Step 4: テストが通ることを確かめる（既存の判定が変わっていないことも）**

Run: `node --test tests/unit/`
Expected: PASS（全件。`tests/unit/mastery.test.js` の既存テストが 1 件も変わらず通ることで、`computeMastery` の結果が同一であることを確かめる）

Run: `NODE_PATH=$(npm root -g) node tests/graph-view.test.js`
Expected: PASS（ネットワーク図の色が変わらない）

- [ ] **Step 5: コミット**

```bash
git add src/mastery.js tests/unit/mastery.test.js
git commit -m "refactor(graph): expose readQuestionArrays and classifyMastery from mastery.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: レーダーの状態を共通の判定にそろえ、「得意／要強化」に最小着手数を設ける

**Files:**
- Modify: `src/graph-report.js`（UMD の頭、`MASTERY_STATES`・`THRESHOLDS`・`MAX_ANSWERS`・`classifyState`・`buildQuestionArrays` の削除、`aggregateOrdinals`、`computeGraphReport` の得意・要強化の選び方、末尾の `return`）
- Modify: `css/graph.css`（973〜989 行目付近の `is-state-*` の並び）
- Modify: `tests/unit/graph-report.test.js`（122〜124 行目の期待値、テストの追加）
- Modify: `tests/graph-view.test.js`（1940 行目付近のコントラスト確認のセレクター）
- Modify: `docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md`（§3 に判定の節を足す）

**Interfaces:**
- Consumes: Task 1 の `readQuestionArrays(graph, stats, weak, isDue)`・`classifyMastery(answered, correct, weak, due)`・`MASTERY_STATES`・`MASTERY_THRESHOLDS`（`src/mastery.js`）
- Produces: `computeGraphReport` の戻り値の形は変えない（`summary`・`concepts[]`・`traps[]`・`books[]` の各項目に `state`（`MASTERY_STATES` の名前）・`attempted`・`accuracy` など今と同じフィールド）。`state` の値が `computeMastery` と同じ規則になり、`'due'` も出るようになる。`summary.strongest` / `summary.weakest` の選び方が変わる。
  - 互換のため、`src/graph-report.js` の exports に `MASTERY_STATES` を残す（中身は mastery.js のものを渡す）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/graph-report.test.js` の先頭の `require` に足す:

```js
const M = require('../../src/mastery.js');
```

末尾に足す:

```js
function loadRealGraph() {
  const code = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  const ctx = {};
  vm.runInNewContext(code + '; this.GRAMMAR_GRAPH = GRAMMAR_GRAPH;', ctx);
  return ctx.GRAMMAR_GRAPH;
}

test('computeGraphReport: 概念・ひっかけ・教材の state は computeMastery と一致する（実グラフ、苦手・要復習あり）', () => {
  const g = loadRealGraph();
  const stats = {}, weak = {};
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.qids.forEach(q => {
    if (rnd() < 0.6) { const a = 1 + Math.floor(rnd() * 6); stats[q] = { a, c: Math.floor(a * rnd()) }; }
    if (rnd() < 0.08) weak[q] = { due: rnd() < 0.3 ? 1 : 2 };
  });
  const isDue = e => e.due === 1;
  const m = M.computeMastery(g, stats, weak, isDue);
  const rep = R.computeGraphReport(g, stats, weak, isDue, { conceptOrder: F.GRAMMAR_CONCEPT_ORDER });
  for (const it of [...rep.concepts, ...rep.traps, ...rep.books]) {
    assert.equal(it.state, M.MASTERY_STATES[m.state[it.nodeIndex]], `${it.id} の state がネットワーク図と違う`);
  }
});

test('computeGraphReport: 正答率 90% でも苦手があれば weak、要復習があれば due', () => {
  const stats = { 1: { a: 10, c: 9 }, 2: { a: 10, c: 9 }, 4: { a: 10, c: 9 }, 3: { a: 10, c: 9 }, 5: { a: 10, c: 9 } };
  const weakOnly = R.computeGraphReport(SAMPLE_GRAPH, stats, { 1: { due: 2 } }, () => false);
  assert.equal(weakOnly.concepts[0].state, 'weak'); // SVOC: 90%・苦手 1
  assert.equal(weakOnly.concepts[1].state, 'good'); // 受動態: 90%・苦手 0
  const due = R.computeGraphReport(SAMPLE_GRAPH, stats, { 1: { due: 1 } }, e => e.due === 1);
  assert.equal(due.concepts[0].state, 'due');
  assert.equal(due.summary.state, 'due');
});

test('summary.strongest / weakest: 着手した問題が 3 問未満の分野は、正答率だけでは得意にも要強化にもならない', () => {
  const g = makeGraph([
    { id: 'con:SVOC（文の骨格）', kind: 'concept', label: 'SVOC（文の骨格）', members: [1, 2, 3, 4] },
    { id: 'con:能動態と受動態', kind: 'concept', label: '能動態と受動態', members: [5, 6, 7, 8] },
    { id: 'con:分詞（現在分詞・過去分詞）', kind: 'concept', label: '分詞（現在分詞・過去分詞）', members: [9, 10, 11] },
  ]);
  const stats = {
    1: { a: 3, c: 3 },                                    // SVOC: 1 問を 3 回解いて全問正解（着手 1 問）
    5: { a: 2, c: 2 }, 6: { a: 2, c: 2 }, 7: { a: 2, c: 1 }, // 受動態: 着手 3 問・5/6 = 83%
    9: { a: 1, c: 0 },                                    // 分詞: 1 問 1 回だけ不正解（着手 1 問）
  };
  const rep = R.computeGraphReport(g, stats, {}, () => false);
  assert.equal(rep.summary.strongest?.id, 'con:能動態と受動態', '着手 1 問・100% の SVOC は得意にしない');
  assert.equal(rep.summary.weakest, null, '着手 1 問・0% の分詞は、苦手登録がなければ要強化にしない');

  const withWeak = R.computeGraphReport(g, stats, { 9: { due: 2 } }, () => false);
  assert.equal(withWeak.summary.weakest?.id, 'con:分詞（現在分詞・過去分詞）', '苦手登録があれば着手数に関係なく要強化の候補');
});
```

既存の期待値を新しい規則に合わせて直す（122〜124 行目付近。苦手 `2` は `due: 100` で `isDue` が true なので、SVOC は要復習が優先される）:

```js
  assert.equal(kin.concepts[1].state, 'good'); // 3/3 → (3+1)/(3+2)=0.8 → good
  assert.equal(kin.concepts[0].state, 'due');  // 要復習 1 問を含む（computeMastery と同じく、正答率より要復習を優先）
  assert.equal(all.concepts[0].state, 'due');  // 要復習 1 問を含む
```

`tests/graph-view.test.js` のバッジのコントラスト確認（1940 行目付近）のセレクターに要復習の状態バッジを足す:

```js
    const selectors = ['.graph-radar-state.is-state-good', '.graph-radar-state.is-state-due', '.graph-bar-badge.is-due', '.graph-bar-badge.is-weak'];
```

（このテストのデータは 5 問が期限切れの苦手なので、サマリーの状態は `due` になる。今の CSS には `.graph-radar-state.is-state-due` がないので、背景が透明のままコントラストが 4.5 を下回るか、色が付かない。）

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test tests/unit/graph-report.test.js`
Expected: FAIL（state の一致テストで「〜の state がネットワーク図と違う」、90% のテストで `'good' !== 'weak'`、得意のテストで `'con:SVOC（文の骨格）' !== 'con:能動態と受動態'`、122〜124 行目で `'mid' !== 'due'` など）

- [ ] **Step 3: `src/graph-report.js` を直す**

UMD の頭を、mastery.js に依存する形にする:

```js
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
```

削除するもの: 自前の `MASTERY_STATES`・`THRESHOLDS`・`MAX_ANSWERS`・`classifyState`・`buildQuestionArrays`。`computeGraphReport` 内の `buildQuestionArrays(graph, stats, weak, isDue)` は `readQuestionArrays(graph, stats, weak, isDue)` に置き換える（戻り値の形は同じ `{ qa, qc, qw, qd, nq }`）。

`aggregateOrdinals` の判定を置き換える:

```js
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
```

`sortReportItems` の中の `THRESHOLDS.goodFrom` は `MASTERY_THRESHOLDS.goodFrom` に置き換える（並び順の規則そのものは変えない）。`computeRadarGeometry` の `THRESHOLDS.goodFrom` も同様。

`computeGraphReport` の得意・要強化の選び方（今の「得意分野と要強化分野のハイライト」のブロック）を置き換える:

```js
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
```

末尾の `return` から自前の定数を外し、`MASTERY_STATES` は mastery.js のものを渡す:

```js
  return {
    MASTERY_STATES,
    CONCEPT_SHORT_LABELS,
    DEFAULT_CONCEPT_ORDER,
    shortConceptLabel,
    computeGraphReport,
    sortReportItems,
    computeRadarGeometry,
  };
```

- [ ] **Step 4: `css/graph.css` に要復習の色を足す**

973〜989 行目付近の `is-state-weak` の各行の直後に、要復習（`due`）の行を足す（ネットワーク図と同じ `--graph-due` / 苦手と同じバッジ色）:

```css
.graph-radar-dot.is-state-due { fill: var(--graph-due); }
.graph-bar-fill.is-state-due { background: var(--graph-due); }
.graph-bar-pct.is-state-due { color: var(--graph-weak); }
.graph-radar-state.is-state-due { background: var(--graph-badge-weak-bg); color: var(--graph-badge-weak-fg); }
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `node --test tests/unit/`
Expected: PASS（全件）

Run: `NODE_PATH=$(npm root -g) node tests/graph-view.test.js`
Expected: PASS（全件。レーダーのテストとコントラスト確認を含む）

Run: `NODE_PATH=$(npm root -g) node tests/graph-entry.test.js`
Expected: PASS

- [ ] **Step 6: 設計書に判定の節を足す**

`docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md` の §3 の末尾に足す:

```markdown
- **状態の判定（2026-11-20 改訂）**: 概念・ひっかけ・教材・総合の状態（色・バッジ）は、ネットワーク図・詳細シートと同じ `src/mastery.js` の `classifyMastery` で決める（判定順: 未着手 → 要復習 → 苦手 → 練習不足 → 定着 → もう少し。判定に使う率は `(正解 + 1) / (解答 + 2)`）。当初はレーダーだけ正答率のみで判定していたため、正答率 90%・苦手 2 問の分野が、棒グラフでは「良好」、詳細シートでは「苦手」と食い違っていた。画面に出す「正答率 %」は今までどおり `正解 / 解答`（詳細シートと同じ）。
- **得意・要強化の選び方（2026-11-20 改訂）**: 得意は、状態が「定着」か「もう少し」で、着手した問題が 3 問（`MASTERY_THRESHOLDS.minAnswers`）以上の分野から正答率が最も高いもの。要強化は、苦手登録がある分野か、着手 3 問以上で正答率 80% 未満の分野から、弱い順の先頭。1 問だけ解いて 100%（または 0%）になった分野を言い切らないため。
```

- [ ] **Step 7: コミット**

```bash
git add src/graph-report.js css/graph.css tests/unit/graph-report.test.js tests/graph-view.test.js docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md
git commit -m "fix(graph): judge radar states with the shared mastery rules and require 3 attempted questions for highlights

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 教材で絞った詳細シートも共通の読み取りと判定を使う

**Files:**
- Modify: `src/graph-detail.js`（UMD の頭、`buildDetail` の `if (bookOrds) { ... }` の集計と判定。今の 132〜170 行目付近）
- Test: `tests/unit/graph-detail.test.js`

**Interfaces:**
- Consumes: Task 1 の `readQuestionArrays`・`classifyMastery`（`src/mastery.js`）。Task 2 の `computeGraphReport`（テストでの比較にだけ使う）。
- Produces: `buildDetail` の戻り値の形は変えない（`stateLabel`・`rate`・`answered`・`correct`・`weakCount` など）。教材で絞ったときの `stateLabel` が、レーダーの同じ項目の状態と必ず一致する。

- [ ] **Step 1: 失敗しにくいが守りたいことを固定するテストを書く**

（今の `graph-detail.js` の絞り込み時の判定は、たまたま mastery.js と同じ規則の書き写しなので、このテストは今も通る可能性が高い。書き写しを消しても結果が同じであることを固定するのが目的。Step 2 で通っても先へ進んでよい。）

`tests/unit/graph-detail.test.js` の末尾に足す:

```js
test('book フィルタ: 詳細シートの状態は、同じ教材で絞ったレーダーの状態と一致する（実グラフ）', () => {
  const R = require('../../src/graph-report.js');
  const g = loadRealGraph();
  const stats = {}, weak = {};
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.qids.forEach(q => {
    if (rnd() < 0.6) { const a = 1 + Math.floor(rnd() * 6); stats[q] = { a, c: Math.floor(a * rnd()) }; }
    if (rnd() < 0.08) weak[q] = { due: rnd() < 0.3 ? 1 : 2 };
  });
  const isDue = e => e.due === 1;
  const m = M.computeMastery(g, stats, weak, isDue);
  const STATE_LABELS = ['未着手', '要復習', '苦手', '練習不足', 'もう少し', '定着'];
  for (const book of ['kin', 'sekai', 'polaris2', 'toplevel']) {
    const rep = R.computeGraphReport(g, stats, weak, isDue, { book });
    for (const it of [...rep.concepts, ...rep.traps]) {
      if (it.total === 0) continue;
      const d = D.buildDetail(g, m, it.nodeIndex, { stats, weak, isDue, book, getQuestion: () => undefined });
      assert.strictEqual(d.stateLabel, STATE_LABELS[M.MASTERY_STATES.indexOf(it.state)], `${book} / ${it.id}`);
      assert.strictEqual(d.answered, it.answered, `${book} / ${it.id} の解答数`);
      assert.strictEqual(d.correct, it.correct, `${book} / ${it.id} の正解数`);
      assert.strictEqual(d.weakCount, it.weak, `${book} / ${it.id} の苦手数`);
    }
  }
});
```

（`loadRealGraph` はこのファイルの 197 行目付近にある既存の関数。`MASTERY_STATES` の順と `STATE_LABELS` の順は `src/graph-detail.js` の 10〜11 行目の対応どおり。）

- [ ] **Step 2: テストを実行する**

Run: `node --test tests/unit/graph-detail.test.js`
Expected: PASS か FAIL のどちらか。FAIL なら、どの教材・どの項目で食い違ったかを報告に書く（今の書き写しに差があったことになる）。

- [ ] **Step 3: 書き写しを共通の関数に置き換える**

UMD の頭を mastery.js に依存する形にする:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mastery.js'));
  else Object.assign(root.StudyCore = root.StudyCore || {}, factory(root.StudyCore || {}));
})(typeof self !== 'undefined' ? self : this, function (M) {
```

`buildDetail` の `if (bookOrds) { ... }` の中身を、序数で集計して `classifyMastery` で判定する形に置き換える。`bookOrds`（教材に属する問題の序数の Set）とノードのメンバー序数の両方に入る序数だけを数える:

```js
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
```

（`else` 側は今のまま。`qidList` の作り方と、問題の並び・表示（`items` / `shown`）は変えない。）

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test tests/unit/`
Expected: PASS（全件。既存の「book フィルタ: 指定教材に属する問題・成績・苦手だけを集計して返す」も通る）

Run: `NODE_PATH=$(npm root -g) node tests/graph-view.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/graph-detail.js tests/unit/graph-detail.test.js
git commit -m "refactor(graph): use the shared mastery helpers for the book-filtered detail sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: レーダーの軸ラベルを 375px 幅・1280px 幅とも 11px 以上にする

**Files:**
- Modify: `js/graph-view.js`（`renderRadarReport` の `computeRadarGeometry` の呼び出しと `<svg>` の組み立て。今の 546 行目と 599〜600 行目付近。`ResizeObserver` のコールバック。今の 1381〜1388 行目付近）
- Modify: `css/graph.css`（`.graph-radar-axis-label`。今の 774〜778 行目付近）
- Test: `tests/graph-view.test.js`
- Modify: `docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md`（§3 に 1 行足す）

**Interfaces:**
- Consumes: 既存の `S.computeRadarGeometry(items, { width, height, radius, labelOffset })`（`src/graph-report.js`。変更しない）
- Produces: レーダーの `<svg>` に、狭いとき `is-compact` クラスが付く。`GraphView._debug.radarCompact`（真偽値）をテスト用の観測値として足す。

方針: viewBox（`0 0 420 330`）は変えない。実効の文字サイズは「文字サイズ × SVG の描画幅 ÷ 420」。
- 通常の配置: 半径 96・ラベル距離 20 のまま、文字を 12 にする。SVG の描画幅が 385px 以上なら実効 11px 以上（12 × 385 ÷ 420 = 11.0）。
- 詰めた配置: 半径 76・ラベル距離 16、文字 16。SVG の描画幅が 289px 以上なら実効 11px 以上（375px 幅では約 291px）。
- どちらにするかは、パネル全体の幅ではなく **SVG を入れる枠（`.graph-radar-svg-wrap`）の実際の幅**で決める（幅 900px 以上ではレーダーが左の列（最大 430px）に入るため、パネルの幅では判断できない）。枠の幅が 385px 未満なら詰めた配置。枠はレーダーの HTML と一緒に作られるので、描いた後に枠の幅を測り、判断が変わったら 1 回だけ描き直す（DOM の組み立てだけで rAF は使わない）。枠がまだ無いとき（最初の描画）はパネルの幅で仮に判断する。
- どちらの配置でも、いちばん長いラベル（「接続詞/前置詞」7 文字）が viewBox の左右に収まる計算（左側のラベルの右端 x = 210 − 半径 − ラベル距離、左端 = そこから 7 × 文字サイズ）: 通常 94 − 84 = 10、詰めた配置 118 − 112 = 6。

- [ ] **Step 1: 失敗するテストを書く**

`tests/graph-view.test.js` の「レーダーチャートモード: 1280px・375px で全軸 100% でもラベルがカード枠内に収まり…」のテストの後ろに足す:

```js
test('レーダーチャートモード: 軸ラベルの実効文字サイズが 375px・768px・900px・1280px で 11px 以上で、viewBox からはみ出さない', async t => {
  // 900px は 2 列になる最小の幅（レーダーが左の列に入る）。768px は 1 列でパネルは広い
  for (const vp of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 900, height: 800 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    await page.evaluate(() => {
      window.__stats = {};
      for (const qid of GRAMMAR_GRAPH.qids) window.__stats[qid] = { a: 4, c: 4 };
      const deps = window.__deps();
      deps.initialMode = 'radar';
      GraphView.mount(document.getElementById('host'), deps);
    });
    await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));
    const res = await page.evaluate(() => {
      const svg = document.querySelector('#host .graph-radar-svg');
      const scale = svg.getBoundingClientRect().width / 420;
      const out = { minPx: Infinity, outside: [] };
      for (const el of svg.querySelectorAll('.graph-radar-axis-label')) {
        out.minPx = Math.min(out.minPx, parseFloat(getComputedStyle(el).fontSize) * scale);
        const b = el.getBBox();
        if (b.x < 0 || b.x + b.width > 420 || b.y < 0 || b.y + b.height > 330) out.outside.push(el.textContent);
      }
      out.minPx = Math.round(out.minPx * 10) / 10;
      return out;
    });
    assert.ok(res.minPx >= 11, `vp=${vp.width} で軸ラベルの実効文字サイズが ${res.minPx}px（11px 未満）`);
    assert.deepEqual(res.outside, [], `vp=${vp.width} で viewBox からはみ出したラベル: ${JSON.stringify(res.outside)}`);
  }
});

test('レーダーチャートモード: 表示中に画面幅が狭い⇔広いと変わると、詰めた配置へ描き直す', async t => {
  const page = await open(t, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => {
    const deps = window.__deps();
    deps.initialMode = 'radar';
    GraphView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => GraphView._debug.mode === 'radar' && !!document.querySelector('#host .graph-radar-svg'));
  assert.equal(await page.evaluate(() => GraphView._debug.radarCompact), false);
  assert.equal(await page.locator('#host .graph-radar-svg.is-compact').count(), 0);
  await page.setViewportSize({ width: 375, height: 812 });
  await waitFor(page, () => GraphView._debug.radarCompact === true && !!document.querySelector('#host .graph-radar-svg.is-compact'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitFor(page, () => GraphView._debug.radarCompact === false && !document.querySelector('#host .graph-radar-svg.is-compact'));
  // 描き直しでも rAF は使わない
  assert.equal(await page.evaluate(() => GraphView._debug.pending), false);
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `NODE_PATH=$(npm root -g) node --test --test-name-pattern="軸ラベルの実効文字サイズ|詰めた配置へ描き直す" tests/graph-view.test.js`
Expected: FAIL（「vp=375 で軸ラベルの実効文字サイズが 〜px（11px 未満）」。今は文字 10 なので 1280px でも 11px 未満。2 件目は `radarCompact` が `undefined` で待ちがタイムアウト）

- [ ] **Step 3: 実装する**

`js/graph-view.js` の `debug` の初期値（73 行目付近の `const debug = { ... }`）に `radarCompact: false` を足す。`mount()` のリセット（`debug.mode = 'book'; ...` の行）にも `debug.radarCompact = false;` を足す。

`createInstance` 内、`let radarShowCoverage = true;` の次に足す:

```js
    let radarCompact = false;   // レーダーを詰めた配置（狭い画面用）で描いたか
    // SVG を入れる枠の幅がこれ未満なら詰めた配置にする。通常の配置（文字 12・viewBox 幅 420）で実効 11px を保てる最小の幅（12 × 385 ÷ 420 = 11.0）
    const RADAR_COMPACT_BELOW_PX = 385;
    // 枠（.graph-radar-svg-wrap）の実際の幅で決める。枠がまだ無い最初の描画では、パネルの幅で仮に決める
    function wantRadarCompact() {
      const wrap = radarPanel.querySelector('.graph-radar-svg-wrap');
      const px = wrap ? wrap.clientWidth : radarPanel.clientWidth;
      return px > 0 && px < RADAR_COMPACT_BELOW_PX;
    }
```

`renderRadarReport` に引数を足し（`function renderRadarReport(recheck = true) {`）、`computeRadarGeometry` の呼び出しを置き換える:

```js
      // 2. 13 概念レーダーチャート（SVG）。狭い枠では半径を小さくして文字を大きくする（viewBox は共通）
      radarCompact = wantRadarCompact();
      debug.radarCompact = radarCompact;
      const geo = S.computeRadarGeometry(rep.concepts, radarCompact
        ? { width: 420, height: 330, radius: 76, labelOffset: 16 }
        : { width: 420, height: 330, radius: 96, labelOffset: 20 });
```

`renderRadarReport` の最後（`radarPanel.innerHTML = ...;` の直後）に足す:

```js
      // 枠の幅は描いてみないと分からない（列の幅で決まる）。仮の判断が外れていたら 1 回だけ描き直す
      if (recheck && wantRadarCompact() !== radarCompact) renderRadarReport(false);
```

`<svg>` の開始タグに `is-compact` を付ける:

```js
        `<svg class="graph-radar-svg${radarCompact ? ' is-compact' : ''}" viewBox="0 0 420 330" role="img" aria-label="13文法概念のレーダーチャート">` +
```

`ResizeObserver` のコールバックの `if (mode === 'radar') return;` を置き換える（幅の区分が変わったときだけ描き直す。DOM の組み立てだけで rAF は使わない）:

```js
        if (mode === 'radar') {
          if (wantRadarCompact() !== radarCompact) renderRadarReport();
          return;
        }
```

`css/graph.css` の `.graph-radar-axis-label` の `font-size: 10px;` を `font-size: 12px;` にし、直後に詰めた配置の規則を足す:

```css
.graph-radar-svg.is-compact .graph-radar-axis-label {
  font-size: 16px;
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `NODE_PATH=$(npm root -g) node tests/graph-view.test.js`
Expected: PASS（全件。新しい 2 件と、既存の「ラベルがカード枠内に収まり」も通る）

もし「viewBox からはみ出したラベル」が出たら、はみ出したラベルの名前と配置（通常／詰めた）を報告に書き、詰めた配置の `radius` を 4 ずつ小さくして（最小 64）再実行する。文字サイズは下げない。

- [ ] **Step 5: 全体の回帰テストを流す**

Run: `node --test tests/unit/`
Expected: PASS

Run: `pytest tests -q`
Expected: PASS

Run（1 つずつ）:
`NODE_PATH=$(npm root -g) node tests/graph-entry.test.js`、`tests/graph-drill.test.js`、`tests/build_graph.test.js`、`tests/data-safety.test.js`、`tests/storage-writes.test.js`、`tests/storage-subscribe.test.js`
Expected: すべて終了コード 0

- [ ] **Step 6: 設計書に 1 行足す**

`docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md` の §3 の「13 概念レーダーチャート」の項目の直後に足す:

```markdown
- **軸ラベルの大きさ（2026-11-20 改訂）**: 実効 11px 以上にする。通常は半径 96・文字 12、SVG を入れる枠の幅が 385px 未満のときは詰めた配置（半径 76・文字 16、SVG に `is-compact`）。表示中に幅の区分が変わったら描き直す。当初は文字 10 のままで、375px 幅では実効約 6.9px だった。320px 幅の端末では実効約 9.5px になる（未対応）。
```

- [ ] **Step 7: コミット**

```bash
git add js/graph-view.js css/graph.css tests/graph-view.test.js docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md
git commit -m "fix(graph): keep radar axis labels at 11px or larger on phone and desktop widths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
