# 文法グラフビュー v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-subagent-driven-development (recommended) or sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文法グラフを、苦手が位置・大きさ・線の太さで読め、タップで周辺が浮かび上がり、どのノードからでも「近い問題を 30 問」解ける画面にする。

**Architecture:** 力の定義を純粋関数 `src/graph-force.js` に移し、ビルド（Node）とアプリ（ブラウザ）で共有する。アプリは d3-force を `vendor/` から遅延読み込みし、グラフを開いたときにビルド済みの座標から 120 回だけ回して止める。束ねた線・周辺の集合（`src/graph-filter.js`）と近さの計算（`src/graph-near.js`）も純粋関数にして Node でテストし、`js/graph-view.js` は描画と入力だけを持つ。出題は `state.grammarPool` に問題の配列を入れ、続きは端末だけのキーに保存する。

**Tech Stack:** 素の JavaScript（ビルドなし）、Canvas 2D、d3-force 3.0.0（UMD、同梱）、`node --test`、Playwright（グローバル導入済み）、pytest（Homebrew）。

**Spec:** `docs/superpowers/specs/2026-11-11-grammar-graph-view-v3-design.md`（v2: `docs/superpowers/specs/2026-11-08-grammar-graph-view-v2-design.md`）

## Global Constraints

- 起動のリクエスト数は 48 件のまま。追加ファイルはグラフを開いたときだけ読む（`tests/graph-entry.test.js` の `STARTUP_REQUESTS_BASELINE`）。
- `data/grammar_graph.js` は 1 バイトも変えない（生成物。手で直さない）。
- 学習記録・バックアップ・Google ドライブ同期の形式を変えない。`BACKUP_FORMAT`（6）・`BACKUP_FORMAT_DRIVE`（5）・`RECORD_KEYS`・`EXTRA_KEYS`・`CROSS_TAB_KEYS` に手を入れない。
- 通常の出題での保存内容を変えない（`tests/storage-writes.test.js` の比較用ファイルが同一）。
- 力学が収まった後・移動のアニメーションが終わった後は、`requestAnimationFrame` もタイマーも呼ばない。
- 保存は `saveJSON` / `loadJSON`（`js/util.js`）経由。
- ファイルを足したら `sw.js` の `ASSETS` と `upload.py` の `FILES` に足す（グラフ用は `index.html` には書かず、`home.js` の読み込みリストに書く）。`sw.js` の `CACHE` を `toeic-drill-v15` に上げる。
- `next/`・`archive/` は触らない。公開（`python3 upload.py`）はしない（利用者の許可が要る）。
- コードのコメントとドキュメントは日本語。コミットメッセージは英語で `feat:` / `fix:` / `docs:` / `perf:`。末尾に `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`。
- 作業は `feat/graph-view-v3` ブランチ（実行時に `sp-using-git-worktrees` で作る）。各タスクの終わりでスクリーンショットを利用者に見せて確認を取る。
- テストの実行（リポジトリの直下で）:
  - `node --test tests/unit/`
  - `node --test tests/build_graph.test.js`
  - `NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js`（ほかのブラウザのテストも同じ形）
  - `pytest tests -q`
- 既知の失敗: `tests/next-browser.cjs`（この作業と無関係。直さない）。

## 設計書からの変更点（プランを書く中で決めたこと。利用者のレビュー対象）

1. **詳細シートは、背景を覆わない下部パネルにする。** v2 のシートは覆い（`.graph-sheet-backdrop`）がグラフ全体を塞ぐので、開いている間はパンもズームもできず、周辺を浮かび上がらせても見て回れない。覆いをやめ、シートは既定で半分の高さ（画面の 42%）で開き、「広げる」ボタンで 72% にする。閉じ方は、×ボタン・Esc・何もない場所のタップ。設計書 §5 の「移動のときは半分に縮める」は、この形に含まれる。
2. **苦手が 1 問もないときは力学を回さない。** 記録なしの力はビルド時と同じなので、回しても位置が少し揺れるだけ。固定配置のまま出す。
3. **近い問題の候補には、起点の配下の問題を必ず入れる。** 設計書 §6 は「近い順の上位 90 問から選ぶ」としているが、概念（最大 300 問）や本（最大 348 問）が起点のとき、配下の苦手が 90 問の外に落ちる。候補は「上位 90 問 ∪ 起点の配下の問題」とする。
4. **重みの具体値**: ひっかけ = 2 × ln(1 + 全問題数 / つながる問題数)、概念 = 1 × 同じ式、同じルール = 1.5、同じ章 = 0.3。概念・ひっかけの点数は、候補が持つ概念・ひっかけの数の平方根で割る。
5. **既存の不具合を、挙動を変えずに明記する。** `tools/lib/layout.mjs` のリンクの目標距離は、種類ごとの設定（`parentDistance`・`linkDistance`）が効いておらず、常に親子 30・概念/ひっかけ 200 で計算されている（d3-force が `l.target` をノードのオブジェクトに置き換えた後に関数を呼ぶため、`kindName[l.target]` が `undefined` になる）。座標を変えないため、この値を定数として書き、使われていない設定を消す。

## Review Focus

1. **苦手が 0 件・記録が空・記録が壊れている**: 力学を回さず、固定配置で 1 回だけ描く（Task 2 のテスト）。
2. **苦手が非常に多い（300 問以上）**: 収まるまでの時間と 1 フレームの長さが記録され、収まった後に座標がすべて有限（Task 2・Task 7 のテスト）。
3. **力学の途中で、画面を離れる・タブが隠れる・配置し直すを押す・タップする**: 何も残らず、例外も出ず、タップは無視される（Task 2 のテスト）。
4. **近い問題の出題中に、バックアップの書き出し・単語への切り替え・再読み込み・フィルターの変更**: 通常の出題の続きと `BOOK_SESSIONS_KEY` が変わらない。壊れた続き（JSON が壊れている、存在しない id）でも通常の出題で始まる（Task 6 のテスト）。
5. **起点に概念もひっかけもない問題、候補が 30 問に届かない起点**: 例外なく、ある分だけ返す。0 問ならボタンを出さない（Task 4・Task 6 のテスト）。

## File Structure

| ファイル | 責務 |
|---|---|
| `src/graph-force.js`（新規） | 力の定数（`GRAPH_LAYOUT`・`GRAPH_RUNTIME`）、`mulberry32`、`bookOfNodes`、`createSimulation` |
| `src/graph-near.js`（新規） | `nearScores`・`pickNear`・`nearestQuestions` |
| `src/graph-filter.js`（変更） | `buildIndex`・`buildBundles`・`bundleWeak`・`focusSet` を足す。`visibleMask` に 2 つのオプションを足す |
| `tools/lib/layout.mjs`・`layout-config.mjs`（変更） | `src/graph-force.js` を使う形にする |
| `vendor/`（新規） | d3-force とその依存（UMD、無改変）とライセンス |
| `js/graph-view.js`（変更） | 力学の実行、束ねた線、苦手の量、周辺の表示、移動、出題ボタン |
| `css/graph.css`（変更） | 色の変数、凡例、半分の高さのシート、ボタン |
| `js/settings.js`・`js/grammar-drill.js`・`js/vocab-drill.js`・`js/filter-sheet.js`・`js/word-stats.js`・`home.js`・`css/app.css`（変更） | 近い問題の出題と、その続きの保存 |
| `tests/unit/helpers/graph-fixture.js`（新規） | 単体テスト用の小さなグラフ |

テスト用の小さなグラフ（Task 1・3・4・5 で使う）:

```
 0 book:kin        1 ch:kin:1       2 rule:kin:1:1   3 q:1    4 q:2
 5 ch:kin:2        6 q:3            7 q:4
 8 book:sekai      9 ch:sekai:1    10 q:5           11 q:6
12 con:a (q1,q5)  13 con:b (q3)    14 con:c (q5,q6) 15 trap:t (q2,q6)
親子: 0→1 1→2 2→3 2→4 0→5 5→6 5→7 8→9 9→10 9→11
概念: 3→12 10→12 6→13 10→14 11→14      ひっかけ: 4→15 11→15
```

---

### Task 1: 力の定義を `src/graph-force.js` に移す

**Files:**
- Create: `src/graph-force.js`
- Create: `tests/unit/helpers/graph-fixture.js`
- Create: `tests/unit/graph-force.test.js`
- Modify: `tools/lib/layout.mjs`（全体を置き換え）
- Modify: `tools/lib/layout-config.mjs`（全体を置き換え）
- Modify: `tests/build_graph.test.js`（テストを 1 つ足す）

**Interfaces:**
- Produces（`require('src/graph-force.js')` と、ブラウザでは `StudyCore.*`）:
  - `GRAPH_LAYOUT`: ビルド時の定数（今の `LAYOUT` から `parentDistance`・`linkDistance` を除いたもの）
  - `GRAPH_RUNTIME`: `{ ticks, alpha, weakParentFactor, weakAnchorFactor, weakConceptStrength, weakTrapStrength, weakLinkDistance, hubCollidePerWeak }`
  - `mulberry32(seed: number): () => number`
  - `bookOfNodes(ids: string[], kindName: string[], edges: number[]): string[]`（`edges` は `[始点, 終点, 種類, …]` の平らな配列）
  - `createSimulation(d3, input, config, runtime): { sim, nodes, ticks }`
    - `input = { kindName: string[], edges: number[], bookOf: string[], x: ArrayLike<number>, y: ArrayLike<number>, weakQ?: Uint8Array, hubWeak?: ArrayLike<number> }`
    - `runtime` が `null` ならビルド時の力（今と同じ）。`GRAPH_RUNTIME` を渡すと実行時の力。
    - `nodes[i] = { index, x, y }`。呼び出し側が `sim.tick()` を `ticks` 回呼ぶ。

- [ ] **Step 1: 変更前に、コミット済みの座標が今の配置計算から再現できることを確かめるテストを足す**

`tests/build_graph.test.js` の `d3test('layout: 既定（collapse）の入力でも動き…` の後に足す。

```js
d3test('layout: コミット済みの data/grammar_graph.js の座標を、同じモデルから再現できる（力の定義を動かしても変わらない）', async () => {
  const { layout } = await lib('layout.mjs');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'grammar_graph.js'), 'utf8');
  const g = vm.runInNewContext(src + '; GRAMMAR_GRAPH');
  const edges = [];
  for (let i = 0; i < g.edges.length; i += 3) edges.push([g.edges[i], g.edges[i + 1], g.edges[i + 2]]);
  const { x, y } = layout({ id: [...g.id], kind: [...g.kind], kinds: [...g.kinds], edges });
  let diff = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== g.x[i] || y[i] !== g.y[i]) diff++;
  assert.strictEqual(diff, 0, `座標が変わったノードが ${diff} 個ある`);
});
```

- [ ] **Step 2: 今のコードで通ることを確かめる**

Run: `node --test tests/build_graph.test.js`
Expected: すべて PASS（このテストは変更前から通る。2026-11-11 に手で確かめた結果は「1,201 ノード中 0 個が相違」）。

- [ ] **Step 3: テスト用の小さなグラフを作る**

`tests/unit/helpers/graph-fixture.js`:

```js
// 単体テスト用の小さなグラフ（本 2 冊・問題 6 問・概念 3・ひっかけ 1）。形は data/grammar_graph.js と同じ列の配列。
// 添字: 0 book:kin / 1 ch:kin:1 / 2 rule:kin:1:1 / 3 q:1 / 4 q:2 / 5 ch:kin:2 / 6 q:3 / 7 q:4
//       8 book:sekai / 9 ch:sekai:1 / 10 q:5 / 11 q:6 / 12 con:a / 13 con:b / 14 con:c / 15 trap:t
const KINDS = ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
const NODES = [
  ['book:kin', 'book', [1, 2, 3, 4]], ['ch:kin:1', 'chapter', [1, 2]], ['rule:kin:1:1', 'rule', [1, 2]],
  ['q:1', 'question', [1]], ['q:2', 'question', [2]], ['ch:kin:2', 'chapter', [3, 4]],
  ['q:3', 'question', [3]], ['q:4', 'question', [4]],
  ['book:sekai', 'book', [5, 6]], ['ch:sekai:1', 'chapter', [5, 6]], ['q:5', 'question', [5]], ['q:6', 'question', [6]],
  ['con:a', 'concept', [1, 5]], ['con:b', 'concept', [3]], ['con:c', 'concept', [5, 6]], ['trap:t', 'trap', [2, 6]],
];
const EDGES = [
  0, 1, 0, 1, 2, 0, 2, 3, 0, 2, 4, 0, 0, 5, 0, 5, 6, 0, 5, 7, 0, 8, 9, 0, 9, 10, 0, 9, 11, 0,
  3, 12, 1, 10, 12, 1, 6, 13, 1, 10, 14, 1, 11, 14, 1,
  4, 15, 2, 11, 15, 2,
];

function makeFixture() {
  const qids = [1, 2, 3, 4, 5, 6];
  const memberStart = [0];
  const members = [];
  for (const [, , ms] of NODES) {
    for (const q of ms) members.push(qids.indexOf(q));
    memberStart.push(members.length);
  }
  return {
    version: 3,
    kinds: [...KINDS],
    id: NODES.map(n => n[0]),
    kind: NODES.map(n => KINDS.indexOf(n[1])),
    label: NODES.map(n => n[0]),
    x: NODES.map((_, i) => (i % 4) * 100),
    y: NODES.map((_, i) => Math.floor(i / 4) * 100),
    qid: NODES.map(n => (n[1] === 'question' ? n[2][0] : 0)),
    qids, memberStart, members,
    edges: [...EDGES],
    text: {},
  };
}

// ノード添字で引く理解度の代用（mastery.weak / mastery.answered と同じ形）。weak・answered は { ノード添字: 値 }
function makeMastery(graph, weak = {}, answered = {}) {
  const n = graph.id.length;
  const w = new Int32Array(n), a = new Int32Array(n);
  for (const k of Object.keys(weak)) w[k] = weak[k];
  for (const k of Object.keys(answered)) a[k] = answered[k];
  return { weak: w, answered: a };
}

module.exports = { makeFixture, makeMastery, KINDS };
```

- [ ] **Step 4: 失敗するテストを書く**

`tests/unit/graph-force.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const GF = require('../../src/graph-force.js');
const { makeFixture } = require('./helpers/graph-fixture.js');

const D3_DIR = path.resolve(__dirname, '..', '..', 'tools', 'node_modules', 'd3-force');
const HAS_D3 = fs.existsSync(path.join(D3_DIR, 'package.json'));
const d3test = (name, fn) => (HAS_D3 ? test(name, fn) : test(name, { skip: 'tools/node_modules/d3-force がありません（cd tools && npm ci）' }, fn));
const loadD3 = () => import(path.join(D3_DIR, 'src', 'index.js'));

function inputOf(g, extra = {}) {
  const kindName = g.kind.map(k => g.kinds[k]);
  return { kindName, edges: g.edges, bookOf: GF.bookOfNodes(g.id, kindName, g.edges), x: g.x, y: g.y, ...extra };
}
function run(d3, g, runtime, extra) {
  const { sim, nodes, ticks } = GF.createSimulation(d3, inputOf(g, extra), GF.GRAPH_LAYOUT, runtime);
  for (let t = 0; t < ticks; t++) sim.tick();
  return nodes.map(nd => [nd.x, nd.y]);
}
const dist = (p, a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);

test('mulberry32: 同じ種から同じ列、[0,1) に収まる', () => {
  const a = GF.mulberry32(7), b = GF.mulberry32(7);
  for (let i = 0; i < 20; i++) { const v = a(); assert.strictEqual(v, b()); assert.ok(v >= 0 && v < 1); }
});

test('bookOfNodes: 親をたどった本。概念・ひっかけは空文字', () => {
  const g = makeFixture();
  const bookOf = GF.bookOfNodes(g.id, g.kind.map(k => g.kinds[k]), g.edges);
  assert.strictEqual(bookOf[3], 'kin');
  assert.strictEqual(bookOf[11], 'sekai');
  assert.strictEqual(bookOf[0], 'kin');
  assert.strictEqual(bookOf[12], '');
  assert.strictEqual(bookOf[15], '');
});

test('定数: 使われていなかった種類ごとの距離の設定は持たない', () => {
  assert.strictEqual(GF.GRAPH_LAYOUT.parentDistance, undefined);
  assert.strictEqual(GF.GRAPH_LAYOUT.linkDistance, undefined);
  assert.ok(GF.GRAPH_RUNTIME.ticks > 0 && GF.GRAPH_RUNTIME.alpha > 0);
});

d3test('ビルド時: ticks は config.ticks、同じ入力から同じ座標', async () => {
  const d3 = await loadD3();
  const g = makeFixture();
  const made = GF.createSimulation(d3, inputOf(g), GF.GRAPH_LAYOUT, null);
  assert.strictEqual(made.ticks, GF.GRAPH_LAYOUT.ticks);
  assert.deepStrictEqual(run(d3, g, null), run(d3, makeFixture(), null));
});

d3test('実行時: 同じ記録・同じ座標から同じ配置。座標はすべて有限', async () => {
  const d3 = await loadD3();
  const weakQ = new Uint8Array(16); weakQ[11] = 1;
  const hubWeak = new Int32Array(16); hubWeak[14] = 1; hubWeak[15] = 1;
  const a = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ, hubWeak });
  const b = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ, hubWeak });
  assert.deepStrictEqual(a, b);
  for (const [x, y] of a) assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

d3test('実行時: 苦手の問題は、苦手でないときより概念・ひっかけに近づく', async () => {
  const d3 = await loadD3();
  const none = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ: new Uint8Array(16), hubWeak: new Int32Array(16) });
  const weakQ = new Uint8Array(16); weakQ[11] = 1; // q:6（con:c と trap:t につながる）
  const hubWeak = new Int32Array(16); hubWeak[14] = 1; hubWeak[15] = 1;
  const weak = run(d3, makeFixture(), GF.GRAPH_RUNTIME, { weakQ, hubWeak });
  assert.ok(dist(weak, 11, 15) < dist(none, 11, 15), 'ひっかけに近づいていない');
  assert.ok(dist(weak, 11, 14) < dist(none, 11, 14), '概念に近づいていない');
});

d3test('実行時: weakQ・hubWeak を渡さなくても落ちない（苦手なしと同じ扱い）', async () => {
  const d3 = await loadD3();
  const p = run(d3, makeFixture(), GF.GRAPH_RUNTIME);
  assert.strictEqual(p.length, 16);
});
```

- [ ] **Step 5: 失敗を確かめる**

Run: `node --test tests/unit/graph-force.test.js`
Expected: FAIL（`Cannot find module '../../src/graph-force.js'`）

- [ ] **Step 6: `src/graph-force.js` を書く**

```js
// 文法グラフの配置の力（d3-force）。ビルド（tools/lib/layout.mjs、Node）とアプリ（js/graph-view.js、ブラウザ）の両方が使う。
// d3-force の関数は引数 d3 で受け取る（forceSimulation / forceLink / forceManyBody / forceCollide / forceX / forceY / forceCenter）。
// DOM にも保存にも触れない純関数。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  // ビルド時の調整値（data/grammar_graph.js の座標はこの値で作る。変えると生成物が変わる）。
  // 座標系: 原点が中央、x は右、y は下。単位は任意（描画側で拡大縮小する）。
  const GRAPH_LAYOUT = {
    seed: 20261108,
    ticks: 400,            // 固定の tick 数（収束を待たない。同じ入力から同じ出力にするため）
    // リンクの強さ（forceLink）。親子は強く、概念・Trap は弱く
    parentStrength: 0.9,
    conceptStrength: 0.02,
    trapStrength: 0.02,
    // 反発（forceManyBody）の強さ（負の値）。種類ごと
    charge: { book: -600, chapter: -260, rule: -34, concept: -700, trap: -700, question: -7 },
    chargeDistanceMax: 500,
    // 衝突半径（forceCollide）。種類ごと
    collideRadius: { book: 30, chapter: 20, rule: 7, concept: 30, trap: 28, question: 3.4 },
    collideStrength: 0.9,
    // 本ごとの塊の中心。概念・Trap は原点（本の間）に引き寄せる
    anchors: { kin: [-480, -280], sekai: [480, -280], polaris2: [-480, 320], toplevel: [480, 320] },
    anchorStrength: 0.13,  // 本の配下のノードを本の中心へ引く強さ
    hubStrength: 0.10,     // 概念・Trap を原点へ引く強さ
    startRadius: 150,      // 初期位置のばらつき（本の中心のまわり）
    hubStartRadius: 60,    // 概念・Trap の初期位置のばらつき（原点のまわり）
  };
  // リンクの目標距離。2026-11-11 まで種類ごとの設定（parentDistance・linkDistance）があったが、d3-force は
  // リンクの端をノードのオブジェクトに置き換えてから距離の関数を呼ぶため、その設定は一度も効いておらず、
  // 常にこの値で計算されていた。座標を変えないため、効いていた値をそのまま定数にしている。
  const PARENT_DISTANCE = 30;
  const HUB_DISTANCE = 200;

  // 実行時（記録あり）にだけ足す調整値。苦手・復習期限の問題を、概念・Trap のまわりに集める。
  const GRAPH_RUNTIME = {
    ticks: 120,                // ビルド済みの座標から続きを回す回数
    alpha: 0.3,                // 始めの勢い（ビルドは 1 から。続きなので小さく始める）
    weakParentFactor: 0.25,    // 苦手の問題: 親（章・ルール）への結びつきに掛ける
    weakAnchorFactor: 0.2,     // 苦手の問題: 本の中心へ引く強さに掛ける
    weakConceptStrength: 0.5,  // 苦手の問題 → 概念
    weakTrapStrength: 0.8,     // 苦手の問題 → Trap（概念より強く）
    weakLinkDistance: 46,      // 苦手の問題と概念・Trap の目標距離
    hubCollidePerWeak: 3,      // 概念・Trap の衝突半径に足す値 = これ × √(配下の苦手の数)
  };
  const ORIGIN = [0, 0];

  // 32bit の種から [0,1) の乱数列を作る（mulberry32）。
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 各ノードの本（親エッジをたどる）。概念・Trap は本を持たない（'' = 本の間のハブ）。
  // edges は [始点, 終点, 種類(0 親子 / 1 概念 / 2 Trap), …] の平らな配列。
  function bookOfNodes(ids, kindName, edges) {
    const n = ids.length;
    const parent = new Int32Array(n).fill(-1);
    for (let k = 0; k + 2 < edges.length; k += 3) if (edges[k + 2] === 0) parent[edges[k + 1]] = edges[k];
    const out = new Array(n).fill('');
    for (let i = 0; i < n; i++) {
      if (kindName[i] === 'concept' || kindName[i] === 'trap') continue;
      let j = i;
      while (parent[j] !== -1) j = parent[j];
      const id = String(ids[j]);
      out[i] = id.startsWith('book:') ? id.slice(5) : '';
    }
    return out;
  }

  // シミュレーションを組み立てて返す（止めた状態）。呼び出し側が sim.tick() を ticks 回呼ぶ。
  //   input: { kindName, edges, bookOf, x, y, weakQ?, hubWeak? }
  //     weakQ[i]   = 1 なら、ノード i は苦手・復習期限の問題
  //     hubWeak[i] = 概念・Trap のノード i の配下にある苦手の数
  //   runtime: null ならビルド時の力（weakQ・hubWeak は見ない）。GRAPH_RUNTIME を渡すと実行時の力。
  // 力の登録順・乱数の使い方はビルドの出力に効くので、順番を変えないこと。
  function createSimulation(d3, input, config, runtime) {
    config = config || GRAPH_LAYOUT;
    const kindName = input.kindName, edges = input.edges, bookOf = input.bookOf;
    const n = kindName.length;
    const weakQ = runtime && input.weakQ ? input.weakQ : null;
    const hubWeak = runtime && input.hubWeak ? input.hubWeak : null;
    const isWeak = i => !!(weakQ && weakQ[i]);

    const nodes = new Array(n);
    for (let i = 0; i < n; i++) nodes[i] = { index: i, x: +input.x[i], y: +input.y[i] };
    const anchorOf = i => (bookOf[i] ? (config.anchors[bookOf[i]] || ORIGIN) : ORIGIN);

    // q = そのリンクの問題側（親子は子）。d3-force が source / target をオブジェクトに置き換えるので、添字で持っておく
    const links = [];
    for (let k = 0; k + 2 < edges.length; k += 3) {
      const t = edges[k + 2];
      links.push({ source: edges[k], target: edges[k + 1], type: t, q: t === 0 ? edges[k + 1] : edges[k] });
    }
    const linkForce = d3.forceLink(links)
      .id(d => d.index)
      .strength(l => {
        const w = isWeak(l.q);
        if (l.type === 0) return w ? config.parentStrength * runtime.weakParentFactor : config.parentStrength;
        if (l.type === 1) return w ? runtime.weakConceptStrength : config.conceptStrength;
        return w ? runtime.weakTrapStrength : config.trapStrength;
      })
      .distance(l => (l.type === 0 ? PARENT_DISTANCE : isWeak(l.q) ? runtime.weakLinkDistance : HUB_DISTANCE));

    const pull = d => {
      const i = d.index;
      if (!bookOf[i]) return config.hubStrength;
      return isWeak(i) ? config.anchorStrength * runtime.weakAnchorFactor : config.anchorStrength;
    };
    const pullX = d3.forceX(d => anchorOf(d.index)[0]).strength(pull);
    const pullY = d3.forceY(d => anchorOf(d.index)[1]).strength(pull);
    const collide = d => {
      const i = d.index, k = kindName[i];
      const base = config.collideRadius[k];
      if (hubWeak && (k === 'concept' || k === 'trap') && hubWeak[i] > 0) return base + runtime.hubCollidePerWeak * Math.sqrt(hubWeak[i]);
      return base;
    };

    const ticks = runtime ? runtime.ticks : config.ticks;
    const sim = d3.forceSimulation(nodes)
      .randomSource(mulberry32(config.seed + 1))
      .stop()
      .alphaMin(0.001);
    if (runtime) sim.alpha(runtime.alpha).alphaDecay(1 - Math.pow(0.001 / runtime.alpha, 1 / ticks));
    else sim.alphaDecay(1 - Math.pow(0.001, 1 / ticks));
    sim
      .force('link', linkForce)
      .force('charge', d3.forceManyBody().strength(d => config.charge[kindName[d.index]]).distanceMax(config.chargeDistanceMax))
      .force('x', pullX)
      .force('y', pullY)
      .force('collide', d3.forceCollide(collide).strength(config.collideStrength).iterations(2))
      .force('center', d3.forceCenter(0, 0));
    return { sim, nodes, ticks };
  }

  return { GRAPH_LAYOUT, GRAPH_RUNTIME, mulberry32, bookOfNodes, createSimulation };
});
```

- [ ] **Step 7: `tools/lib/layout-config.mjs` と `tools/lib/layout.mjs` を置き換える**

`tools/lib/layout-config.mjs`:

```js
// 配置の調整値。実体は src/graph-force.js（アプリの実行時の力学と共有するため）。調整はそちらで行う。
import { createRequire } from 'node:module';

export const LAYOUT = createRequire(import.meta.url)('../../src/graph-force.js').GRAPH_LAYOUT;
```

`tools/lib/layout.mjs`:

```js
// モデル（座標なし）→ 座標。Node 上の d3-force で、種つき乱数と固定の tick 数により、
// 同じ入力から同じ出力になる。出力は整数に丸めた { x: number[], y: number[] }。
// 力の定義は src/graph-force.js（アプリの実行時の力学と共有）。d3-force は tools/node_modules にある。
import * as d3 from 'd3-force';
import { createRequire } from 'node:module';
import { LAYOUT } from './layout-config.mjs';

const GF = createRequire(import.meta.url)('../../src/graph-force.js');
export const mulberry32 = GF.mulberry32;

export function layout(model, config = LAYOUT) {
  const n = model.id.length;
  const kindName = model.kind.map(k => model.kinds[k]);
  const edges = model.edges.flat();
  const bookOf = GF.bookOfNodes(model.id, kindName, edges);

  // 初期位置: 本の中心（概念・Trap は原点）のまわりに、種つきの乱数でばらまく
  const rand = GF.mulberry32(config.seed);
  const x0 = new Array(n), y0 = new Array(n);
  for (let i = 0; i < n; i++) {
    const anchor = bookOf[i] ? (config.anchors[bookOf[i]] || [0, 0]) : [0, 0];
    const r = (bookOf[i] ? config.startRadius : config.hubStartRadius) * Math.sqrt(rand());
    const th = rand() * 2 * Math.PI;
    x0[i] = anchor[0] + r * Math.cos(th);
    y0[i] = anchor[1] + r * Math.sin(th);
  }

  const { sim, nodes } = GF.createSimulation(d3, { kindName, edges, bookOf, x: x0, y: y0 }, config, null);
  for (let t = 0; t < config.ticks; t++) sim.tick();

  // 整数に丸める。丸めで同じ座標になった組は、決まった順に 1 ずつずらして重ならないようにする
  const x = new Array(n), y = new Array(n);
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let px = Math.round(nodes[i].x) + 0, py = Math.round(nodes[i].y) + 0; // + 0 で -0 を 0 にする
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('座標が有限ではありません: ' + model.id[i]);
    while (used.has(px + ',' + py)) px += 1;
    used.add(px + ',' + py);
    x[i] = px; y[i] = py;
  }
  return { x, y };
}
```

- [ ] **Step 8: テストを通す**

Run: `node --test tests/unit/graph-force.test.js && node --test tests/build_graph.test.js`
Expected: すべて PASS。とくに Step 1 のテスト（コミット済みの座標の再現）と、`layout: config の seed を変えると座標が変わる` が通ること。
通らないとき: 力の登録順・`alphaDecay` の式・初期位置の乱数の順（`r` → `th`）を、変更前の `layout.mjs`（`git show HEAD:tools/lib/layout.mjs`）と 1 行ずつ見比べる。**座標が変わる直し方は採らない。**

- [ ] **Step 9: 全体のテストとコミット**

Run: `node --test tests/unit/ && pytest tests -q`
Expected: PASS

```bash
git add src/graph-force.js tools/lib/layout.mjs tools/lib/layout-config.mjs tests/unit/helpers/graph-fixture.js tests/unit/graph-force.test.js tests/build_graph.test.js
git commit -m "feat(graph): share force definition between build and runtime (output unchanged)"
```

---

### Task 2: d3-force を同梱し、開いたときに力学を回す

**Files:**
- Create: `vendor/d3-dispatch.min.js`・`vendor/d3-quadtree.min.js`・`vendor/d3-timer.min.js`・`vendor/d3-force.min.js`・`vendor/LICENSE-d3.txt`
- Modify: `home.js`（`GRAPH_SCRIPTS` の近く、`loadGraphAssets`）
- Modify: `sw.js`（`CACHE`・`ASSETS`）、`upload.py`（`FILES`）
- Modify: `js/graph-view.js`
- Modify: `css/graph.css`
- Modify: `tests/graph-view.test.js`・`tests/graph-entry.test.js`

**Interfaces:**
- Consumes: `StudyCore.createSimulation` / `bookOfNodes` / `GRAPH_LAYOUT` / `GRAPH_RUNTIME`（Task 1）。ブラウザの `window.d3`（UMD の d3-force）。
- Produces:
  - `GraphView._debug.settled: boolean`（力学が動いていなければ true）、`settleTicks: number`、`settleMs: number`、`settleMaxFrameMs: number`
  - 画面のボタン `button[data-zoom="relayout"]`（配置し直す）
  - `home.js`: `GRAPH_FORCE_SCRIPTS`（読めなくてもグラフは開く 5 本）

- [ ] **Step 1: 同梱するファイルを置く**

```bash
mkdir -p vendor
cp tools/node_modules/d3-dispatch/dist/d3-dispatch.min.js tools/node_modules/d3-quadtree/dist/d3-quadtree.min.js tools/node_modules/d3-timer/dist/d3-timer.min.js tools/node_modules/d3-force/dist/d3-force.min.js vendor/
{ for p in d3-dispatch d3-quadtree d3-timer d3-force; do echo "===== $p ====="; cat tools/node_modules/$p/LICENSE; echo; done; } > vendor/LICENSE-d3.txt
ls -la vendor
```

Expected: 5 ファイル。`.min.js` の合計は約 17KB。中身には手を加えない。`tools/node_modules` がなければ `cd tools && npm ci`（依存は `tools/package.json` の `d3-force 3.0.0`）。

- [ ] **Step 2: テストのページに、同梱ファイルと力の定義を読ませる**

`tests/graph-view.test.js` の `testPage` の `<script src="/src/graph-detail.js"></script>` の次の行に足す。

```html
<script src="/vendor/d3-dispatch.min.js"></script>
<script src="/vendor/d3-quadtree.min.js"></script>
<script src="/vendor/d3-timer.min.js"></script>
<script src="/vendor/d3-force.min.js"></script>
<script src="/src/graph-force.js"></script>
```

同じファイルの `mountAndWait` の下に、補助関数を足す。

```js
// 苦手を count 問入れる（グラフの問題を先頭から）。期限は未来（復習期限ではない）
async function seedWeak(page, count) {
  return page.evaluate(c => {
    const G = GRAMMAR_GRAPH, stats = {}, weak = {}, picked = [];
    for (let i = 0; i < G.id.length && picked.length < c; i++) {
      if (G.kinds[G.kind[i]] !== 'question') continue;
      stats[G.qid[i]] = { a: 2, c: 0 };
      weak[G.qid[i]] = { streak: 0, due: Date.now() + 86400000 };
      picked.push(i);
    }
    window.__stats = stats; window.__weak = weak;
    return picked;
  }, count);
}
const settled = page => waitFor(page, () => GraphView._debug.settled === true && GraphView._debug.frames >= 1, undefined, 15000);
```

- [ ] **Step 3: 失敗するテストを書く**

`tests/graph-view.test.js` の `test('記録が空（{}）や壊れた記録でも…` の前に足す。

```js
test('力学: 苦手があると数フレームかけて収まり、その後 1 秒は rAF もタイマーも呼ばれない', async t => {
  const page = await open(t);
  const picked = await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  const d = await page.evaluate(() => ({ ticks: GraphView._debug.settleTicks, ms: GraphView._debug.settleMs, frames: GraphView._debug.frames }));
  assert.equal(d.ticks, 120, '決めた回数だけ回っていない');
  assert.ok(d.frames >= 2, '途中の様子が描かれていない');
  await new Promise(r => setTimeout(r, 300)); // 収まった後の最後の 1 フレームを待つ
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; });
  await new Promise(r => setTimeout(r, 1100));
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 });
  // 苦手の問題は、つながる概念・ひっかけに近づいている（ビルド済みの座標との比較）
  const moved = await page.evaluate(picked => {
    const G = GRAMMAR_GRAPH, e = G.edges, D = GraphView._debug;
    let nearer = 0, total = 0;
    for (let k = 0; k < e.length; k += 3) {
      if (e[k + 2] === 0 || !picked.includes(e[k])) continue;
      const q = e[k], h = e[k + 1];
      const before = Math.hypot(G.x[q] - G.x[h], G.y[q] - G.y[h]);
      const a = D.worldOf(q), b = D.worldOf(h);
      total++;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < before) nearer++;
    }
    return { nearer, total };
  }, picked);
  assert.ok(moved.total > 0);
  assert.ok(moved.nearer / moved.total > 0.8, `概念・ひっかけに近づいた線が少ない: ${moved.nearer}/${moved.total}`);
});

test('力学: 収まるまでタップは無視され、収まった後は新しい位置でタップできる', async t => {
  const page = await open(t);
  const picked = await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  // 収まる前: 画面の中央をタップしてもシートは開かない
  const settledAtTap = await page.evaluate(() => GraphView._debug.settled);
  if (!settledAtTap) {
    await page.mouse.click(187, 400);
    assert.equal(await sheetOpen(page), false, '力学の途中でシートが開いた');
  }
  await settled(page);
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), picked[0]);
  assert.equal(await page.evaluate(([x, y]) => GraphView._debug.hitAt(x, y), [x, y]), picked[0], '苦手の問題が新しい位置で当たらない');
});

test('力学: 苦手が 300 問以上でも収まり、座標はすべて有限', async t => {
  const page = await open(t);
  await seedWeak(page, 320);
  await page.evaluate(() => window.__mount());
  await settled(page);
  const ok = await page.evaluate(() => {
    const D = GraphView._debug;
    for (let i = 0; i < GRAMMAR_GRAPH.id.length; i++) { const p = D.worldOf(i); if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false; }
    return true;
  });
  assert.equal(ok, true);
  console.log('# 力学（苦手 320 問、375×812）', await page.evaluate(() => ({ ms: Math.round(GraphView._debug.settleMs), maxFrameMs: Math.round(GraphView._debug.settleMaxFrameMs) })));
});

test('力学: 途中で destroy しても、rAF もリスナーも残らず例外も出ない', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  await page.evaluate(() => { window.__mount(); GraphView.destroy(); window.__cnt.raf = 0; });
  await new Promise(r => setTimeout(r, 500));
  const r = await page.evaluate(() => ({ raf: window.__cnt.raf, listeners: GraphView._debug.listeners, canvases: document.querySelectorAll('canvas').length }));
  assert.deepEqual(r, { raf: 0, listeners: 0, canvases: 0 });
});

test('力学: d3 がなくても固定配置で開く（settled は最初から true、1 回だけ描く）', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  await page.evaluate(() => { window.d3 = undefined; window.__cnt.raf = 0; window.__mount(); });
  await waitFor(page, () => GraphView._debug.frames >= 1);
  await new Promise(r => setTimeout(r, 400));
  const r = await page.evaluate(() => ({ settled: GraphView._debug.settled, ticks: GraphView._debug.settleTicks, frames: GraphView._debug.frames, raf: window.__cnt.raf }));
  assert.deepEqual(r, { settled: true, ticks: 0, frames: 1, raf: 1 });
});

test('力学: 「視差効果を減らす」では途中を描かず、完成形だけ描く', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.addInitScript(COUNT_SCRIPT);
  await page.goto(base + '/__graph_test.html');
  await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  await new Promise(r => setTimeout(r, 300));
  const frames = await page.evaluate(() => GraphView._debug.frames);
  assert.ok(frames <= 2, `途中のフレームを描いている: ${frames}`);
});

test('力学: 「配置し直す」でもう一度回り、収まると止まる', async t => {
  const page = await open(t);
  await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  await page.locator('#host button[data-zoom="relayout"]').click();
  assert.equal(await page.evaluate(() => GraphView._debug.settled), false);
  await settled(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settleTicks), 120);
});
```

`document.hidden` の間に力学が止まることは、既存のテスト `document.hidden のあいだは rAF を要求せず…` と同じ仕組み（`onVisibility`）に乗るので、そのテストの中で、マウントの前に `await seedWeak(page, 40);` を足したケースを 1 つ追加する（既存のテストの本体を関数にして、苦手なし・苦手ありの 2 回呼ぶ）。

- [ ] **Step 4: 失敗を確かめる**

Run: `NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js`
Expected: 足したテストが FAIL（`GraphView._debug.settled` が `undefined` で `settled` が時間切れ、`worldOf is not a function` など）。既存のテストは PASS のまま。

- [ ] **Step 5: `js/graph-view.js` に力学を入れる**

(a) 先頭のコメントの「軽さの約束」の最初の項目を置き換える。

```js
//   - タイマーなし・常時ループなし。入力・絞り込み・refresh・リサイズ・テーマ変更で「汚れた」ときだけ
//     requestAnimationFrame を 1 回要求する（保留中は 1 つまで）。document.hidden のあいだは要求しない。
//     例外は 2 つで、どちらも終わったら必ず止まる: 開いたときの力学（決めた回数だけ）と、移動のアニメーション（約 0.3 秒）。
```

(b) 定数に足す（`const DPR_MAX = 2;` の下）。

```js
  const SETTLE_BUDGET_MS = 8;  // 力学: 1 フレームに使う計算時間の上限
```

(c) `debug` に足す。

```js
    settled: true, settleTicks: 0, settleMs: 0, settleMaxFrameMs: 0,
```

(d) `createInstance` の前処理で、`const bounds = { minX, maxX, minY, maxY };` を `let bounds = { minX, maxX, minY, maxY };` に変え、`const kConcept = …` の行に種類の添字を足す。

```js
    const kConcept = kinds.indexOf('concept'), kTrap = kinds.indexOf('trap');
    const kQuestion = kinds.indexOf('question'), kChapter = kinds.indexOf('chapter'), kRule = kinds.indexOf('rule');
```

(e) 「状態」に足す（`let sheetIndex = -1;` の下）。

```js
    let settle = null;          // 力学の実行中だけ { sim, nodes, left, t0, maxFrame, quiet }
```

(f) `requestDraw` / `onFrame` を置き換える。

```js
    function requestDraw() {
      dirty = true;
      if (!alive || rafId || document.hidden) return;
      rafId = requestAnimationFrame(onFrame);
      debug.pending = true;
    }
    function onFrame() {
      rafId = 0;
      debug.pending = false;
      if (!alive || document.hidden) return; // dirty は残し、見えるようになったら描く（力学の続きもそこから）
      if (settle) {
        const quiet = settle.quiet;
        stepSettle();
        if (settle) {
          // まだ続く。「視差効果を減らす」のときは途中を描かない
          if (!quiet) draw();
          requestDraw();
          return;
        }
      }
      draw();
    }
```

(g) `buildGrid` の定義の下に、力学の関数を足す。

```js
    // ---- 力学（開いたときと「配置し直す」のときだけ。決めた回数で必ず止まる） ----
    function updateBounds() {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < n; i++) {
        if (xs[i] < a) a = xs[i];
        if (xs[i] > b) b = xs[i];
        if (ys[i] < c) c = ys[i];
        if (ys[i] > d) d = ys[i];
      }
      minX = a; maxX = b; minY = c; maxY = d;
      bounds = { minX, maxX, minY, maxY };
    }
    // 範囲が変わったら全体表示の倍率を取り直す。まだ触っていなければ、全体表示のまま追いかける
    function refit() {
      if (!(width > 0 && height > 0)) return;
      const fit = S.createCamera(width, height, bounds);
      fitScale = fit.scale;
      if (!interacted) cam = fit;
    }
    function resetPositions() {
      for (let i = 0; i < n; i++) { xs[i] = +graph.x[i]; ys[i] = +graph.y[i]; }
    }
    function canSettle() {
      const d3 = root.d3;
      return !!(d3 && typeof d3.forceSimulation === 'function' && typeof S.createSimulation === 'function');
    }
    function stopSettle() {
      if (!settle) return;
      settle.sim.stop();
      settle = null;
    }
    // 収まった（または回さなかった）後の後始末。fromFrame = onFrame の中から呼ばれた（直後に描くので要求しない）
    function finishSettle(fromFrame) {
      updateBounds();
      refit();
      maskKey = '';                 // 当たり判定用の座標（hitXs）を作り直させる
      if (width > 0 && height > 0) buildGrid();
      debug.settled = true;
      if (!fromFrame) requestDraw();
    }
    function startSettle() {
      stopSettle();
      resetPositions();
      debug.settleTicks = 0; debug.settleMs = 0; debug.settleMaxFrameMs = 0;
      const weakQ = new Uint8Array(n);
      let anyWeak = false;
      for (let i = 0; i < n; i++) if (graph.kind[i] === kQuestion && mastery.weak[i] > 0) { weakQ[i] = 1; anyWeak = true; }
      // 苦手が 1 問もなければ、力はビルド時と同じ。回しても揺れるだけなので、固定配置のまま出す
      if (!anyWeak || !canSettle()) { finishSettle(false); return; }
      const kn = new Array(n);
      for (let i = 0; i < n; i++) kn[i] = kindName(i);
      let made;
      try {
        made = S.createSimulation(root.d3, {
          kindName: kn, edges: E, bookOf: S.bookOfNodes(graph.id, kn, E), x: xs, y: ys, weakQ, hubWeak: mastery.weak,
        }, S.GRAPH_LAYOUT, S.GRAPH_RUNTIME);
      } catch (e) { finishSettle(false); return; } // 組み立てに失敗したら固定配置
      const mq = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      settle = { sim: made.sim, nodes: made.nodes, left: made.ticks, t0: performance.now(), maxFrame: 0, quiet: !!(mq && mq.matches) };
      debug.settled = false;
      requestDraw();
    }
    function stepSettle() {
      const t0 = performance.now();
      do { settle.sim.tick(); settle.left--; debug.settleTicks++; } while (settle.left > 0 && performance.now() - t0 < SETTLE_BUDGET_MS);
      const nodes = settle.nodes;
      let finite = true;
      for (let i = 0; i < n; i++) if (!Number.isFinite(nodes[i].x) || !Number.isFinite(nodes[i].y)) { finite = false; break; }
      if (!finite) { stopSettle(); resetPositions(); finishSettle(true); return; } // 壊れたら固定配置に戻す
      for (let i = 0; i < n; i++) { xs[i] = nodes[i].x; ys[i] = nodes[i].y; }
      const dt = performance.now() - t0;
      if (dt > settle.maxFrame) settle.maxFrame = dt;
      if (settle.left > 0) { updateBounds(); refit(); return; }
      debug.settleMs = performance.now() - settle.t0;
      debug.settleMaxFrameMs = settle.maxFrame;
      stopSettle();
      finishSettle(true);
    }
```

(h) `endPointer` の `const i = hitIndex(p.x, p.y);` の直前に足す。

```js
      if (settle) return; // 動いているノードを押し間違えないよう、収まるまでタップは受け付けない
```

(i) `onZoomClick` を置き換える。

```js
    function onZoomClick(e) {
      const b = e.target.closest('button[data-zoom]');
      if (!b || !cam) return;
      if (b.dataset.zoom === 'relayout') { closeSheet(); startSettle(); return; }
      if (b.dataset.zoom === 'fit') { cam = S.createCamera(width, height, bounds); interacted = false; requestDraw(); }
      else zoomBy(width / 2, height / 2, b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6);
    }
```

(j) `rootEl.innerHTML` の `.graph-zoom` に、ボタンを 1 つ足す（「全体」の次）。

```js
          '<button type="button" data-zoom="relayout" aria-label="配置し直す">再配置</button>' +
```

(k) 「起動」の `resize(…)` の次の行に足す。

```js
    startSettle(); // 苦手があれば、ビルド済みの座標から続きを回す（なければ何もしない）
```

(l) `destroy()` の `if (rafId) cancelAnimationFrame(rafId);` の前に `stopSettle();` を足す。`catch (err)` の中の `alive = false;` の次にも `if (settle) { try { settle.sim.stop(); } catch (e2) { /* 無視 */ } settle = null; }` を足す（`settle` は `try` の外で宣言しているので見える）。

(m) 返すオブジェクトの「テスト用」に足し、ファイル末尾の `debug.*` にも対応する行を足す。

```js
      worldOf(i) { return i >= 0 && i < n ? [xs[i], ys[i]] : null; },
```

```js
  debug.worldOf = i => (inst ? inst.worldOf(i) : null);
```

`mount` の `debug.frames = 0; …` の行に `debug.settled = true; debug.settleTicks = 0; debug.settleMs = 0; debug.settleMaxFrameMs = 0;` を足す。

(n) `createInstance` の先頭の読み込み確認は変えない（`createSimulation` がなくても開けるようにするため）。

- [ ] **Step 6: `css/graph.css` のズームボタンの並びを確かめる**

`.graph-zoom` はボタンが 3 つの前提で書かれている。`grep -n "graph-zoom" css/graph.css` で定義を読み、4 つ目（「再配置」）が同じ見た目で縦に並ぶことを、スクリーンショットで確かめる（幅が足りなければ `.graph-zoom button { min-width: 44px; }` を足す）。

- [ ] **Step 7: ブラウザのテストを通す**

Run: `NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js`
Expected: すべて PASS。既存の `マウントすると canvas が 1 枚でき、1 回だけ描かれ…`（記録が空）は、力学を回さないので `raf: 1` のまま通る。

- [ ] **Step 8: アプリの読み込みリスト・ファイル一覧に足す**

`home.js` の `GRAPH_SCRIPTS` の定義を読み（`grep -n "GRAPH_SCRIPTS" -B2 -A12 home.js`）、その下に足す。

```js
// 力学用（d3-force と力の定義）。読めなくてもグラフは固定配置で開くので、失敗しても止めない
const GRAPH_FORCE_SCRIPTS = [
  'vendor/d3-dispatch.min.js',
  'vendor/d3-quadtree.min.js',
  'vendor/d3-timer.min.js',
  'vendor/d3-force.min.js',
  'src/graph-force.js',
];
let graphForcePromise = null; // 失敗したら捨てて、次に開いたときにやり直す
function loadGraphForceAssets() {
  if (graphForcePromise) return graphForcePromise;
  const p = (async () => {
    for (const url of GRAPH_FORCE_SCRIPTS) await insertGraphAsset(url);
  })();
  graphForcePromise = p;
  p.catch(() => { if (graphForcePromise === p) graphForcePromise = null; });
  return p;
}
```

`showGraphPage` の `await loadGraphAssets();` を含む `try { … } catch (e) { … return; }` の直後に足す。

```js
  try { await loadGraphForceAssets(); } catch (e) { /* 力学なし（固定配置）で開く */ }
```

`sw.js`: `const CACHE = 'toeic-drill-v14';` を `'toeic-drill-v15'` にし、`ASSETS` の `'css/graph.css',` の次に足す。

```js
  'vendor/d3-dispatch.min.js',
  'vendor/d3-quadtree.min.js',
  'vendor/d3-timer.min.js',
  'vendor/d3-force.min.js',
  'src/graph-force.js',
```

`upload.py`: `FILES` の `"css/graph.css",` の次に足す。

```python
    "vendor/d3-dispatch.min.js",
    "vendor/d3-quadtree.min.js",
    "vendor/d3-timer.min.js",
    "vendor/d3-force.min.js",
    "vendor/LICENSE-d3.txt",
    "src/graph-force.js",
```

- [ ] **Step 9: 入口のテストを直して足す**

`tests/graph-entry.test.js`:

- `GRAPH_FILES` の `'js/graph-view.js',` の次に、`GRAPH_FORCE_SCRIPTS` と同じ 5 本を足す。先頭のコメントの「7 ファイル」を「12 ファイル」に直す。
- 読み込み順を確かめる箇所（`const order = await page.evaluate(…)` の `filter(s => /grammar_graph|mastery|graph-/.test(s))`）は、力学用のファイルが `js/graph-view.js` の後に差し込まれるので、正規表現を `/grammar_graph|mastery|graph-|vendor\//` にし、期待値を「`GRAPH_FILES` の `.js` のうち `js/graph-view.js` まで」+「力学用の 5 本」の順にする。

```js
  const order = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => /grammar_graph|mastery|graph-|vendor\//.test(s)));
  assert.deepEqual(order, GRAPH_FILES.filter(f => f.endsWith('.js')));
```

  （`GRAPH_FILES` を「必須 6 本 → 力学用 5 本」の順に並べておけば、期待値はそのまま `GRAPH_FILES` の `.js` になる。）

- テストを 1 つ足す。

```js
test('力学用のファイルが読めなくても、グラフは固定配置で開く', async t => {
  const { page } = await open(t, {
    beforeGoto: async page => { await page.route('**/vendor/**', route => route.abort()); },
  });
  await openReviewCard(page);
  await drawn(page);
  assert.equal(await page.evaluate(() => GraphView._debug.settled), true);
  assert.equal(await page.evaluate(() => typeof d3), 'undefined');
});
```

  このテストでは `vendor/` の読み込み失敗がコンソールのエラーになるが、`pageerror`（例外）にはならないので `open` の後始末は通る。通らない場合は、失敗の種類を確かめてから直す（握りつぶさない）。

- [ ] **Step 10: 全体のテスト**

Run:
```bash
node --test tests/unit/
pytest tests -q
NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js
NODE_PATH=$(npm root -g) node --test tests/graph-entry.test.js
```
Expected: すべて PASS。`tests/graph-entry.test.js` の「起動のリクエスト数 48」が変わらないこと。

- [ ] **Step 11: スクリーンショットを利用者に見せる**

開発サーバー `toeic-nocache`（8766）で `http://localhost:8766/#graph` を開く。記録がないと動かないので、ブラウザのコンソールから一時的に苦手を入れる（開発サーバーのオリジンだけに保存される）。

```js
(() => { const s = {}, w = {}; RAW_GRAMMAR.filter((_, i) => i % 9 === 0).forEach(g => { s[g.id] = { a: 2, c: 0 }; w[g.id] = { streak: 0, added: Date.now(), due: Date.now() + 86400000 }; }); localStorage.setItem('toeic_grammar_stats', JSON.stringify(s)); localStorage.setItem('toeic_weak_grammar', JSON.stringify(w)); location.reload(); })();
```

375×812 と 1280×800 で、収まった後のスクリーンショットを撮って見せる。この段階では苦手の問題は近景でしか見えない（全体表示で出すのは Task 3）。

- [ ] **Step 12: コミット**

```bash
git add vendor home.js sw.js upload.py js/graph-view.js css/graph.css tests/graph-view.test.js tests/graph-entry.test.js
git commit -m "feat(graph): settle a force layout from the user's records when the graph opens"
```

---

### Task 3: 束ねた線と、苦手の量の表示

**Files:**
- Modify: `src/graph-filter.js`
- Modify: `tests/unit/graph-filter.test.js`
- Modify: `js/graph-view.js`
- Modify: `css/graph.css`
- Modify: `tests/graph-view.test.js`

**Interfaces:**
- Produces（`src/graph-filter.js`）:
  - `buildIndex(graph): { n, nq, parent: Int32Array, hubStart: Int32Array, hubs: Int32Array, qNode: Int32Array, chapterOf: Int32Array, ruleOf: Int32Array, kQ, kCh, kRule, kCon, kTrap, kBook }`
    - `hubs[hubStart[q] .. hubStart[q+1])` = 問題ノード `q` がつながる概念・ひっかけのノード
    - `qNode[序数]` = その問題のノード添字（なければ -1）
    - `chapterOf[q]`・`ruleOf[q]` = 問題ノード `q` の章・ルールのノード（なければ -1）
  - `buildBundles(graph, index, level: 'chapter' | 'rule'): { count, a: Int32Array, b: Int32Array, type: Uint8Array, start: Int32Array, questions: Int32Array }`
    - 束 `j` は、章（ルール）`a[j]` と概念・ひっかけ `b[j]` を結ぶ。`type[j]` は 1（概念）か 2（ひっかけ）。問題ノードは `questions[start[j] .. start[j+1])`
    - `level: 'rule'` でルールを持たない問題は、章の束に入る
  - `bundleWeak(bundles, nodeWeak: ArrayLike<number>): Int32Array`（束ごとの苦手の問題数。`nodeWeak` は `mastery.weak`）
  - `visibleMask` の `opts.showWeakQuestions: boolean`（苦手の問題は LOD に関係なく残す）と `opts.forceShow: Uint8Array | null`（1 のノードは LOD に関係なく残す。本・苦手のみの絞り込みは通す）
- Produces（`js/graph-view.js`）: `GraphView._debug.lastDrawnBundles: number`

- [ ] **Step 1: 失敗する単体テストを書く**

`tests/unit/graph-filter.test.js` の末尾に足す。

```js
const { makeFixture, makeMastery } = require('./helpers/graph-fixture.js');

test('buildIndex: 親・概念/ひっかけ・章・ルール・序数→ノード', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.strictEqual(ix.n, 16);
  assert.strictEqual(ix.nq, 6);
  assert.deepStrictEqual([...ix.qNode], [3, 4, 6, 7, 10, 11]);
  assert.strictEqual(ix.parent[3], 2);
  assert.strictEqual(ix.parent[0], -1);
  assert.strictEqual(ix.chapterOf[3], 1);
  assert.strictEqual(ix.ruleOf[3], 2);
  assert.strictEqual(ix.chapterOf[6], 5);
  assert.strictEqual(ix.ruleOf[6], -1);
  const hubsOf = q => [...ix.hubs.slice(ix.hubStart[q], ix.hubStart[q + 1])].sort((a, b) => a - b);
  assert.deepStrictEqual(hubsOf(10), [12, 14]);
  assert.deepStrictEqual(hubsOf(11), [14, 15]);
  assert.deepStrictEqual(hubsOf(7), []);
  assert.deepStrictEqual(hubsOf(0), []);
});

test('buildIndex: 範囲外の端点を持つエッジは無視する', () => {
  const g = makeFixture();
  g.edges.push(99, 3, 0, 3, 99, 1);
  const ix = F.buildIndex(g);
  assert.strictEqual(ix.parent[3], 2);
  assert.strictEqual(ix.hubStart[4] - ix.hubStart[3], 1);
});

test('buildBundles: 章の単位で束ねる', () => {
  const g = makeFixture();
  const b = F.buildBundles(g, F.buildIndex(g), 'chapter');
  assert.strictEqual(b.count, 6);
  assert.deepStrictEqual([...b.a], [1, 1, 5, 9, 9, 9]);
  assert.deepStrictEqual([...b.b], [12, 15, 13, 12, 14, 15]);
  assert.deepStrictEqual([...b.type], [1, 2, 1, 1, 1, 2]);
  const qs = j => [...b.questions.slice(b.start[j], b.start[j + 1])];
  assert.deepStrictEqual(qs(0), [3]);
  assert.deepStrictEqual(qs(4), [10, 11]);
  assert.deepStrictEqual(qs(5), [11]);
});

test('buildBundles: ルールの単位。ルールを持たない問題は章の束に入る', () => {
  const g = makeFixture();
  const b = F.buildBundles(g, F.buildIndex(g), 'rule');
  assert.deepStrictEqual([...b.a], [2, 2, 5, 9, 9, 9]);
  assert.deepStrictEqual([...b.b], [12, 15, 13, 12, 14, 15]);
});

test('bundleWeak: 束ごとの苦手の問題数', () => {
  const g = makeFixture();
  const b = F.buildBundles(g, F.buildIndex(g), 'chapter');
  const m = makeMastery(g, { 10: 1, 11: 1, 3: 1 });
  assert.deepStrictEqual([...F.bundleWeak(b, m.weak)], [1, 0, 0, 1, 2, 1]);
  assert.deepStrictEqual([...F.bundleWeak(b, new Int32Array(16))], [0, 0, 0, 0, 0, 0]);
});

test('visibleMask: showWeakQuestions は、苦手の問題だけを LOD に関係なく残す', () => {
  const g = makeFixture();
  const stats = { 6: { a: 2, c: 0 } };
  const weak = { 6: { due: Date.now() + 1e9 } };
  const m = M.computeMastery(g, stats, weak, () => false);
  const far = F.visibleMask(g, m, { lod: 0, showWeakQuestions: true });
  assert.strictEqual(far[11], 1, '苦手の q:6 が遠景で残っていない');
  assert.strictEqual(far[10], 0, '苦手でない q:5 が遠景で残っている');
  assert.strictEqual(far[2], 0, 'ルールは遠景では出ない');
  assert.strictEqual(F.visibleMask(g, m, { lod: 0 })[11], 0, '既定では残さない');
  // 本の絞り込みは通す（別の本の苦手は残さない）
  assert.strictEqual(F.visibleMask(g, m, { lod: 0, showWeakQuestions: true, book: 'kin' })[11], 0);
});

test('visibleMask: forceShow のノードは LOD に関係なく残す。本の絞り込みは通す', () => {
  const g = makeFixture();
  const m = M.computeMastery(g, {}, {}, () => false);
  const force = new Uint8Array(16); force[3] = 1; force[10] = 1;
  const far = F.visibleMask(g, m, { lod: 0, forceShow: force });
  assert.strictEqual(far[3], 1);
  assert.strictEqual(far[10], 1);
  assert.strictEqual(far[4], 0);
  assert.strictEqual(F.visibleMask(g, m, { lod: 0, forceShow: force, book: 'kin' })[10], 0);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test tests/unit/graph-filter.test.js`
Expected: FAIL（`F.buildIndex is not a function`）

- [ ] **Step 3: `src/graph-filter.js` に足す**

`visibleMask` の中、`const bookKind = kinds.indexOf('book');` の次に足す。

```js
    // LOD の例外: 苦手の問題（showWeakQuestions）と、指定されたノード（forceShow）は、種類が LOD の外でも残す
    const qKind = kinds.indexOf('question');
    const forceShow = opts.forceShow && opts.forceShow.length >= n ? opts.forceShow : null;
    const showWeakQ = !!opts.showWeakQuestions;
```

`const weakCnt = …; const dueCnt = …;` は今 `for` の直前にあるので、そのまま使う。`for` の中の `if (!kindOk[kind[i]]) continue;` を置き換える。

```js
      if (!kindOk[kind[i]]) {
        const forced = (forceShow && forceShow[i]) || (showWeakQ && kind[i] === qKind && weakCnt && weakCnt[i] > 0);
        if (!forced) continue;
      }
```

`return { visibleMask, lodForScale, kindsAtLod, LOD_SCALES };` の前に、関数を足す。

```js
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
```

`return` を置き換える。

```js
  return { visibleMask, lodForScale, kindsAtLod, LOD_SCALES, buildIndex, buildBundles, bundleWeak };
```

- [ ] **Step 4: 単体テストを通す**

Run: `node --test tests/unit/graph-filter.test.js`
Expected: すべて PASS（既存のテストも）。

- [ ] **Step 5: 失敗するブラウザのテストを書く**

`tests/graph-view.test.js` の力学のテストの後に足す。

```js
test('束ねた線: 記録が空でも、全体表示で章と概念・ひっかけの間に線が出る', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const d = await page.evaluate(() => ({ lod: GraphView._debug.lod, bundles: GraphView._debug.lastDrawnBundles }));
  assert.equal(d.lod, 0);
  assert.ok(d.bundles >= 50, `束ねた線が少ない: ${d.bundles}`);
  assert.ok(d.bundles <= 248, `章の束の総数（248）を超えている: ${d.bundles}`);
});

test('束ねた線: 近景では描かず、問題ごとの線になる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const f = await frames(page);
  await page.evaluate(() => GraphView._debug.focus(null, 9));
  await nextFrame(page, f);
  assert.equal(await page.evaluate(() => GraphView._debug.lod), 2);
  assert.equal(await page.evaluate(() => GraphView._debug.lastDrawnBundles), 0);
});

test('苦手の量: 苦手の問題は全体表示でも描かれ、苦手のある概念にはラベルに数が付く', async t => {
  const page = await open(t);
  const picked = await seedWeak(page, 40);
  await page.evaluate(() => window.__mount());
  await settled(page);
  await new Promise(r => setTimeout(r, 200));
  const d = await page.evaluate(picked => ({
    lod: GraphView._debug.lod,
    questions: GraphView._debug.drawnKinds[5],
    visible: picked.filter(i => GraphView._debug.isVisible(i)).length,
  }), picked);
  assert.equal(d.lod, 0);
  assert.equal(d.visible, 40, '苦手の問題が全体表示で隠れている');
  assert.ok(d.questions >= 1 && d.questions <= 40);
  // 苦手のある概念は、苦手のない概念より大きく描かれる
  const sizes = await page.evaluate(() => {
    const G = GRAMMAR_GRAPH, out = [];
    for (let i = 0; i < G.id.length; i++) if (G.kinds[G.kind[i]] === 'concept') out.push(GraphView._debug.radiusOf(i));
    return out;
  });
  assert.ok(Math.max(...sizes) > Math.min(...sizes) || new Set(sizes).size === 1, '大きさが計算されていない');
  assert.ok(Math.max(...sizes) > 0);
});

test('凡例が出ている', async t => {
  const page = await open(t);
  await mountAndWait(page);
  assert.match(await page.locator('#host .graph-legend').innerText(), /苦手/);
});
```

- [ ] **Step 6: 失敗を確かめる**

Run: `NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js`
Expected: 足した 4 つが FAIL（`lastDrawnBundles` が `undefined`、`radiusOf is not a function`、`.graph-legend` がない）。

- [ ] **Step 7: `js/graph-view.js` に、束ねた線と苦手の量を入れる**

(a) 定数に足す。

```js
  const BUNDLE_MIN_Q = 2;                     // 苦手が 0 で問題数がこれ以下の束は、遠景・中景では描かない
  const BUNDLE_WIDTHS = [0.8, 1.6, 2.6, 3.8]; // 束の太さ: 苦手 0 / 1〜2 / 3〜5 / 6 以上
  const SIZE_BOOST_STEP = 0.25, SIZE_BOOST_MAX = 1.2; // 大きさ = 1 + min(上限, 段 × √苦手の数)
  const RED_VARS = ['--graph-weak-1', '--graph-weak-2', '--graph-weak']; // 赤の濃さ（苦手の割合 1 割未満 / 3 割未満 / それ以上）
```

`COLOR_VARS` に `weakEdge: '--graph-weak-edge',` を、`FALLBACK` に `weakEdge: 'rgba(229,72,77,0.8)', reds: ['#f29a9d', '#ec6f74', '#e5484d'],` を足す。`debug` に `lastDrawnBundles: 0,` を足す。

(b) 前処理（`const edgesByType = …` の下）に足す。

```js
    // 索引と束ねた線（マウント時に 1 回）。bundles[0] = 章の単位（遠景）、[1] = ルールの単位（中景）
    const index = S.buildIndex(graph);
    const bundles = [S.buildBundles(graph, index, 'chapter'), S.buildBundles(graph, index, 'rule')];
    let bundleWeakCnt = [new Int32Array(bundles[0].count), new Int32Array(bundles[1].count)];
    const sizeBoost = new Float32Array(n).fill(1); // 苦手の数に応じた大きさの倍率
    const fillClass = new Uint8Array(n);           // 0〜5 = 状態の色、6〜8 = 赤の濃さ
    const baseLabel = labelText.slice();           // 数を付ける前のラベル
```

`createInstance` の先頭の読み込み確認に `typeof S.buildIndex !== 'function'` を足す（古い `graph-filter.js` がキャッシュに残っている場合に、分かる形で失敗させる）。

(c) `readColors` の `colors = c;` の前に足す。

```js
      c.reds = RED_VARS.map((v, k) => get(v, FALLBACK.reds[k]));
```

(d) `recompute` を置き換える。

```js
    function recompute() {
      stats = safeObj(deps.getStats);
      weak = safeObj(deps.getWeak);
      mastery = S.computeMastery(graph, stats, weak, deps.isDue);
      masteryVer++;
      bundleWeakCnt = bundles.map(b => S.bundleWeak(b, mastery.weak));
      for (let i = 0; i < n; i++) {
        const w = mastery.weak[i], k = graph.kind[i], st = mastery.state[i];
        const grows = k === kConcept || k === kTrap || k === kChapter || k === kRule;
        sizeBoost[i] = grows && w > 0 ? 1 + Math.min(SIZE_BOOST_MAX, SIZE_BOOST_STEP * Math.sqrt(w)) : 1;
        if (st === 1 || st === 2) {
          // 赤は、配下に占める苦手の割合で 3 段階。問題そのものはいちばん濃い
          const ratio = k === kQuestion ? 1 : mastery.total[i] > 0 ? w / mastery.total[i] : 0;
          fillClass[i] = ratio < 0.1 ? 6 : ratio < 0.3 ? 7 : 8;
        } else {
          fillClass[i] = st;
        }
        const text = w > 0 && k !== kQuestion ? baseLabel[i] + ' ' + w : baseLabel[i];
        if (text !== labelText[i]) { labelText[i] = text; labelW[i] = NaN; } // 幅は次に置くときに測り直す
      }
    }
```

(e) `ensureMask` の `S.visibleMask(…)` を置き換える。

```js
      mask = S.visibleMask(graph, mastery, { book, weakOnly, lod, showWeakQuestions: true });
```

(f) `draw` の中: `rs[i] = baseR[i] * rf;` を `rs[i] = baseR[i] * sizeBoost[i] * rf;` にする。エッジの `for (let t = 0; t < 3; t++) { … }` の直前に足す。

```js
      // 概念・ひっかけの線: 遠景・中景は束ねた線。そのうえで、見えている苦手の問題の線は下のループが描く
      const bundleCount = lod < 2 ? drawBundles(lod, s, ox, oy) : 0;
```

ノードを塗るループを置き換える（`for (let c = 0; c < 6; c++) { … }` の全体）。

```js
      for (let c = 0; c < 9; c++) {
        ctx.beginPath();
        let any = false;
        for (let j = 0; j < m; j++) {
          const i = drawList[j];
          if (fillClass[i] !== c) continue;
          ctx.moveTo(sxs[i] + rs[i], sys[i]);
          ctx.arc(sxs[i], sys[i], rs[i], 0, Math.PI * 2);
          any = true;
        }
        if (!any) continue;
        ctx.fillStyle = c < 6 ? colors.states[c] : colors.reds[c - 6];
        ctx.fill();
        ctx.stroke();
      }
```

`debug.lastDrawnEdges = edgeCount;` の次に `debug.lastDrawnBundles = bundleCount;` を足す。

(g) `ringPath` の定義の前に足す。

```js
    const bundleClass = w => (w <= 0 ? 0 : w <= 2 ? 1 : w <= 5 ? 2 : 3);
    // 束ねた線を、太さ（苦手の数）と種類（概念 / ひっかけ）ごとに 1 つの path にまとめて描く。描いた本数を返す
    function drawBundles(lod, s, ox, oy) {
      const B = bundles[lod], W = bundleWeakCnt[lod];
      let count = 0;
      for (let c = 0; c < 4; c++) {
        for (let t = 1; t <= 2; t++) {
          ctx.beginPath();
          let any = false;
          for (let j = 0; j < B.count; j++) {
            if (B.type[j] !== t || bundleClass(W[j]) !== c) continue;
            const a = B.a[j], b = B.b[j];
            if (!mask[a] || !mask[b] || !(inView[a] || inView[b])) continue;
            if (c === 0 && B.start[j + 1] - B.start[j] <= BUNDLE_MIN_Q) continue;
            ctx.moveTo(xs[a] * s + ox, ys[a] * s + oy);
            ctx.lineTo(xs[b] * s + ox, ys[b] * s + oy);
            any = true;
            count++;
          }
          if (!any) continue;
          ctx.strokeStyle = c === 0 ? (t === 1 ? colors.conceptEdge : colors.trapLine) : colors.weakEdge;
          ctx.globalAlpha = c === 0 ? 0.5 : 1;
          ctx.lineWidth = BUNDLE_WIDTHS[c];
          ctx.setLineDash(t === 2 ? [5, 4] : []);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      return count;
    }
```

(h) 凡例を足す（`rootEl.innerHTML` の `.graph-stage` の中、`.graph-zoom` の前）。

```js
        '<div class="graph-legend" aria-hidden="true">' +
          '<span class="graph-legend-item"><i class="graph-legend-size"></i>大きさ・線の太さ = 苦手の数</span>' +
          '<span class="graph-legend-item"><i class="graph-legend-red"></i>赤の濃さ = 苦手の割合</span>' +
        '</div>' +
```

(i) テスト用に足す（返すオブジェクトと、末尾の `debug.*`）。

```js
      radiusOf(i) { return i >= 0 && i < n ? baseR[i] * sizeBoost[i] : 0; },
```

```js
  debug.radiusOf = i => (inst ? inst.radiusOf(i) : 0);
```

- [ ] **Step 8: `css/graph.css` に色と凡例を足す**

`--graph-weak:` を定義しているブロックをすべて探し（`grep -n "\-\-graph-weak:" css/graph.css`）、それぞれの直後に 3 行足す。明るいテーマのブロック:

```css
  --graph-weak-1: #f29a9d;   /* 苦手の割合 1 割未満 */
  --graph-weak-2: #ec6f74;   /* 3 割未満 */
  --graph-weak-edge: rgba(229, 72, 77, 0.8);  /* 苦手のある束ねた線 */
```

暗いテーマのブロック:

```css
  --graph-weak-1: #a34448;
  --graph-weak-2: #d14f54;
  --graph-weak-edge: rgba(255, 90, 95, 0.85);
```

ファイルの末尾に足す。

```css
/* 凡例（Canvas の上に置く。操作は通す） */
.graph-legend {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 9px;
  border-radius: 10px;
  background: var(--graph-surface);
  border: 1px solid var(--graph-border);
  color: var(--graph-label-muted);
  font-size: 11px;
  line-height: 1.3;
  pointer-events: none;
}
.graph-legend-item { display: flex; align-items: center; gap: 6px; }
.graph-legend-size { width: 12px; height: 12px; border-radius: 50%; background: var(--graph-unseen); flex: none; }
.graph-legend-red { width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(90deg, var(--graph-weak-1), var(--graph-weak)); flex: none; }
```

（凡例の点は DOM なのでグラデーションを使ってよい。Canvas に渡す変数は単色のまま。）

- [ ] **Step 9: 既存のテストへの影響を直す**

Run: `NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js`

足した 4 つは PASS になる。既存のテストのうち、苦手を入れた状態で「描いたノード数」や「近景でだけ問題が出る」ことを数で確かめているものが変わりうる（苦手の問題が全体表示にも出るため）。失敗したテストは 1 つずつ読み、**新しい仕様（苦手の問題はどの倍率でも出る・赤は 3 段階）に合わせて期待値を直す**。色の判定 `isRed`（`r > 150 && r - g > 60 && r - b > 60`）は、いちばん薄い赤 `#f29a9d`（r − g = 88、r − b = 85）でも通る。

- [ ] **Step 10: 全体のテスト、スクリーンショット、コミット**

Run:
```bash
node --test tests/unit/
NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js
NODE_PATH=$(npm root -g) node --test tests/graph-entry.test.js
```
Expected: すべて PASS

Task 2 の Step 11 と同じ手順で、375×812 と 1280×800 の全体表示・中くらいのズームのスクリーンショットを撮り、利用者に見せる。線が多すぎて読めない場合は `BUNDLE_MIN_Q` を上げる（値を変えたら Step 5 の「50 本以上」の下限も実測に合わせる）。

```bash
git add src/graph-filter.js tests/unit/graph-filter.test.js js/graph-view.js css/graph.css tests/graph-view.test.js
git commit -m "feat(graph): bundled concept/trap edges and weak-count size, shade and labels at every zoom"
```

---

### Task 4: 近さの計算（`src/graph-near.js`）

**Files:**
- Create: `src/graph-near.js`
- Create: `tests/unit/graph-near.test.js`

**Interfaces:**
- Consumes: `buildIndex`（Task 3）
- Produces:
  - `NEAR`: `{ count: 30, poolFactor: 3, trapBase: 2, conceptBase: 1, ruleWeight: 1.5, chapterWeight: 0.3 }`
  - `nearScores(graph, index, seed: number): Float64Array`（ノード添字で引く。問題ノード以外は 0）
  - `pickNear(graph, index, seed, mastery, opts?): { nodes: number[], ids: number[], scores: Float64Array }`
    - `mastery` は `{ weak, answered }`（ノード添字で引く。`null` 可）。`opts = { count?: number, random?: () => number }`
    - `random` を渡さなければ混ぜない（並びは決まる）
  - `nearestQuestions(graph, index, seed, limit): number[]`（起点を除く、点数が正の問題ノードを近い順に）

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/graph-near.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const F = require('../../src/graph-filter.js');
const N = require('../../src/graph-near.js');
const { makeFixture, makeMastery } = require('./helpers/graph-fixture.js');

const setup = () => { const g = makeFixture(); return { g, ix: F.buildIndex(g) }; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const LN4 = Math.log(4); // ln(1 + 6 / 2)。問題 2 問につながる概念の重み

test('nearScores: 起点が問題。同じひっかけだけの問題が、同じ概念と同じ章を持つ問題より上', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 11); // q:6（con:c・trap:t、ch:sekai:1）
  assert.ok(near(s[4], 2 * LN4), `q:2（ひっかけだけ）= ${s[4]}`);
  assert.ok(near(s[10], LN4 / Math.SQRT2 + 0.3), `q:5（概念 + 章）= ${s[10]}`);
  assert.ok(near(s[11], (LN4 + 2 * LN4) / Math.SQRT2 + 0.3), `q:6（自分）= ${s[11]}`);
  assert.ok(s[4] > s[10]);
  assert.strictEqual(s[3], 0);
  assert.strictEqual(s[6], 0);
  assert.strictEqual(s[14], 0, '問題ノード以外は 0');
});

test('nearScores: 同じルールと同じ章は、概念・ひっかけを共有しなくても点が付く', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 4); // q:2（trap:t、rule:kin:1:1、ch:kin:1）
  assert.ok(near(s[3], 1.5 + 0.3), `q:1（同じルール・章）= ${s[3]}`);
  assert.ok(s[11] > s[3], '同じひっかけの q:6 が、同じルールだけの q:1 より上');
});

test('nearScores: 起点が概念。配下の問題の特徴の割合で点が付く', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 14); // con:c（q:5・q:6）
  assert.ok(near(s[11], (LN4 + 2 * LN4 * 0.5) / Math.SQRT2 + 0.3));
  assert.ok(near(s[10], (LN4 * 0.5 + LN4) / Math.SQRT2 + 0.3));
  assert.ok(near(s[4], 2 * LN4 * 0.5));
  assert.ok(near(s[3], LN4 * 0.5));
  assert.strictEqual(s[6], 0);
});

test('nearScores: 概念もひっかけもない問題が起点でも落ちない（同じ章の問題に点が付く）', () => {
  const { g, ix } = setup();
  const s = N.nearScores(g, ix, 7); // q:4（つながりなし、ch:kin:2）
  assert.ok(near(s[6], 0.3));
  assert.ok(near(s[7], 0.3));
  assert.strictEqual(s[3], 0);
});

test('nearScores: 範囲外の起点は全部 0', () => {
  const { g, ix } = setup();
  assert.ok([...N.nearScores(g, ix, -1)].every(v => v === 0));
  assert.ok([...N.nearScores(g, ix, 999)].every(v => v === 0));
});

test('pickNear: 起点の問題が先頭。記録がなければ近い順', () => {
  const { g, ix } = setup();
  const r = N.pickNear(g, ix, 11, null);
  assert.deepStrictEqual(r.nodes, [11, 4, 10]);
  assert.deepStrictEqual(r.ids, [6, 2, 5]);
});

test('pickNear: 苦手 → 未解答 → 正解済みの順で埋める', () => {
  const { g, ix } = setup();
  // 起点 con:c。近い順は q:6(11) > q:5(10) > q:2(4) > q:1(3)
  const m = makeMastery(g, { 3: 1 }, { 3: 1, 10: 2 }); // q:1 が苦手、q:5 は正解済み、ほかは未解答
  const r = N.pickNear(g, ix, 14, m);
  assert.deepStrictEqual(r.nodes, [3, 11, 4, 10]);
  assert.deepStrictEqual(r.ids, [1, 6, 2, 5]);
  assert.deepStrictEqual(N.pickNear(g, ix, 14, m, { count: 2 }).nodes, [3, 11]);
});

test('pickNear: 遠い苦手は、近い未解答を押しのけない（候補は上位 count×3 と、起点の配下）', () => {
  const { g, ix } = setup();
  const m = makeMastery(g, { 3: 1 }, { 3: 1, 10: 2 });
  // count 1 → 上位 3 問（q:6・q:5・q:2）。苦手の q:1 は 4 番目なので候補に入らない
  assert.deepStrictEqual(N.pickNear(g, ix, 14, m, { count: 1 }).nodes, [11]);
});

test('pickNear: 起点の配下の問題は、上位に入らなくても候補に残る', () => {
  const { g, ix } = setup();
  // 起点 book:kin（q:1〜q:4）。count 1 → 上位 3 問だが、配下 4 問はすべて候補。苦手の q:4 が選ばれる
  const m = makeMastery(g, { 7: 1 }, { 7: 1 });
  assert.deepStrictEqual(N.pickNear(g, ix, 0, m, { count: 1 }).nodes, [7]);
});

test('pickNear: 候補が足りなければ、ある分だけ返す。範囲外の起点は空', () => {
  const { g, ix } = setup();
  assert.strictEqual(N.pickNear(g, ix, 11, null, { count: 30 }).ids.length, 3);
  assert.deepStrictEqual(N.pickNear(g, ix, -1, null).ids, []);
});

test('pickNear: random を渡すと、起点の問題を先頭に残して残りを混ぜる。同じ乱数なら同じ並び', () => {
  const { g, ix } = setup();
  const seq = () => { let k = 0; const v = [0.9, 0.1, 0.5, 0.3]; return () => v[k++ % v.length]; };
  const a = N.pickNear(g, ix, 11, null, { random: seq() });
  const b = N.pickNear(g, ix, 11, null, { random: seq() });
  assert.deepStrictEqual(a.nodes, b.nodes);
  assert.strictEqual(a.nodes[0], 11);
  assert.deepStrictEqual([...a.nodes].sort((x, y) => x - y), [4, 10, 11]);
});

test('nearestQuestions: 起点を除いて近い順。上限つき', () => {
  const { g, ix } = setup();
  assert.deepStrictEqual(N.nearestQuestions(g, ix, 11, 30), [4, 10]);
  assert.deepStrictEqual(N.nearestQuestions(g, ix, 11, 1), [4]);
  assert.deepStrictEqual(N.nearestQuestions(g, ix, 999, 30), []);
});

test('本物のグラフ: どの種類のノードを起点にしても落ちず、30 問以内で id は重複しない', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'data', 'grammar_graph.js'), 'utf8');
  const g = vm.runInNewContext(src + '; GRAMMAR_GRAPH');
  const ix = F.buildIndex(g);
  const seen = new Set();
  for (let i = 0; i < g.id.length; i++) {
    const k = g.kinds[g.kind[i]];
    if (seen.has(k) && i % 97 !== 0) continue; // 種類ごとの最初の 1 つと、97 個おき
    seen.add(k);
    const r = N.pickNear(g, ix, i, null);
    assert.ok(r.ids.length >= 1 && r.ids.length <= 30, `${g.id[i]}: ${r.ids.length} 問`);
    assert.strictEqual(new Set(r.ids).size, r.ids.length, `${g.id[i]}: id が重複`);
    assert.ok(r.ids.every(id => g.qids.includes(id)), `${g.id[i]}: グラフにない id`);
  }
  assert.strictEqual(seen.size, 6);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test tests/unit/graph-near.test.js`
Expected: FAIL（`Cannot find module '../../src/graph-near.js'`）

- [ ] **Step 3: `src/graph-near.js` を書く**

```js
// 文法グラフの「近さ」。起点のノードに近い問題に点数を付け、出題する問題を選ぶ。DOM にも保存にも触れない純関数。
// 近さ = 起点と共有する特徴の重みの和。特徴は、概念・ひっかけ（つながる問題が少ないほど重い。ひっかけは概念の 2 倍）、
// 同じルール、同じ章。辺を辿る索引は src/graph-filter.js の buildIndex で作ったものを受け取る。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const NEAR = {
    count: 30,          // 出題する問題数
    poolFactor: 3,      // 候補にする上位の数 = count × これ（遠い苦手が、近い未解答を押しのけないように）
    trapBase: 2,        // ひっかけの重み = これ × ln(1 + 全問題数 / つながる問題数)
    conceptBase: 1,     // 概念の重み   = これ × 同じ式
    ruleWeight: 1.5,    // 同じルール
    chapterWeight: 0.3, // 同じ章
  };

  const inRange = (index, i) => Number.isInteger(i) && i >= 0 && i < index.n;

  // 起点の問題ノード。問題ならその 1 問、それ以外は配下の問題すべて
  function seedQuestions(graph, index, seed) {
    if (!inRange(index, seed)) return [];
    if (graph.kind[seed] === index.kQ) return [seed];
    const out = [];
    for (let m = graph.memberStart[seed]; m < graph.memberStart[seed + 1]; m++) {
      const q = index.qNode[graph.members[m]];
      if (q >= 0) out.push(q);
    }
    return out;
  }

  // 概念・ひっかけのノードごとの重み（ほかは 0）
  function hubWeights(graph, index) {
    const w = new Float64Array(index.n);
    const nq = Math.max(1, index.nq);
    for (let i = 0; i < index.n; i++) {
      const k = graph.kind[i];
      if (k !== index.kCon && k !== index.kTrap) continue;
      const df = graph.memberStart[i + 1] - graph.memberStart[i];
      if (df > 0) w[i] = (k === index.kTrap ? NEAR.trapBase : NEAR.conceptBase) * Math.log(1 + nq / df);
    }
    return w;
  }

  // 問題ノードごとの点数（ノード添字で引く。問題以外は 0）
  function nearScores(graph, index, seed) {
    const scores = new Float64Array(index.n);
    const seeds = seedQuestions(graph, index, seed);
    if (seeds.length === 0) return scores;
    const w = hubWeights(graph, index);
    // 特徴（概念・ひっかけ・ルール・章のノード）ごとの、起点での割合
    const p = new Float64Array(index.n);
    const inc = 1 / seeds.length;
    for (const q of seeds) {
      for (let k = index.hubStart[q]; k < index.hubStart[q + 1]; k++) p[index.hubs[k]] += inc;
      if (index.ruleOf[q] !== -1) p[index.ruleOf[q]] += inc;
      if (index.chapterOf[q] !== -1) p[index.chapterOf[q]] += inc;
    }
    for (let o = 0; o < index.nq; o++) {
      const q = index.qNode[o];
      if (q < 0) continue;
      let s = 0, cnt = 0;
      for (let k = index.hubStart[q]; k < index.hubStart[q + 1]; k++) { cnt++; s += w[index.hubs[k]] * p[index.hubs[k]]; }
      s /= Math.sqrt(Math.max(1, cnt)); // 概念・ひっかけを多く持つ問題が有利になりすぎないように
      if (index.ruleOf[q] !== -1) s += NEAR.ruleWeight * p[index.ruleOf[q]];
      if (index.chapterOf[q] !== -1) s += NEAR.chapterWeight * p[index.chapterOf[q]];
      scores[q] = s;
    }
    return scores;
  }

  // 出題する問題を選ぶ。mastery は { weak, answered }（ノード添字で引く。null 可）。
  // opts.count（既定 30）、opts.random（渡すと、起点の問題を先頭に残して残りを混ぜる）
  function pickNear(graph, index, seed, mastery, opts) {
    opts = opts || {};
    const count = opts.count > 0 ? Math.floor(opts.count) : NEAR.count;
    const scores = nearScores(graph, index, seed);
    const seeds = seedQuestions(graph, index, seed);
    if (seeds.length === 0) return { nodes: [], ids: [], scores };
    const isSeed = new Uint8Array(index.n);
    for (const q of seeds) isSeed[q] = 1;

    const cand = [];
    for (let o = 0; o < index.nq; o++) {
      const q = index.qNode[o];
      if (q >= 0 && (scores[q] > 0 || isSeed[q])) cand.push(q);
    }
    cand.sort((a, b) => (scores[b] - scores[a]) || (a - b));
    const poolSize = count * NEAR.poolFactor;
    const pool = cand.filter((q, j) => j < poolSize || isSeed[q]); // 起点の配下は必ず候補に残す

    const weak = mastery && mastery.weak, answered = mastery && mastery.answered;
    const tier = q => (weak && weak[q] > 0 ? 0 : !(answered && answered[q] > 0) ? 1 : 2); // 苦手 → 未解答 → 正解済み
    const seedQ = graph.kind[seed] === index.kQ ? seed : -1;
    pool.sort((a, b) => ((b === seedQ) - (a === seedQ)) || (tier(a) - tier(b)) || (scores[b] - scores[a]) || (a - b));
    const nodes = pool.slice(0, count);

    if (typeof opts.random === 'function') {
      const from = seedQ >= 0 && nodes[0] === seedQ ? 1 : 0;
      for (let i = nodes.length - 1; i > from; i--) {
        const j = from + Math.floor(opts.random() * (i - from + 1));
        const t = nodes[i]; nodes[i] = nodes[j]; nodes[j] = t;
      }
    }
    return { nodes, ids: nodes.map(q => graph.qid[q]), scores };
  }

  // 起点を除いて、近い順の問題ノード（点数が正のものだけ）。グラフで周辺として光らせるのに使う
  function nearestQuestions(graph, index, seed, limit) {
    const scores = nearScores(graph, index, seed);
    const out = [];
    for (let o = 0; o < index.nq; o++) {
      const q = index.qNode[o];
      if (q >= 0 && q !== seed && scores[q] > 0) out.push(q);
    }
    out.sort((a, b) => (scores[b] - scores[a]) || (a - b));
    return out.slice(0, limit > 0 ? Math.floor(limit) : 0);
  }

  return { NEAR, nearScores, pickNear, nearestQuestions };
});
```

- [ ] **Step 4: テストを通す**

Run: `node --test tests/unit/graph-near.test.js`
Expected: すべて PASS。期待値が合わないテストがあれば、**まずテストの手計算（このタスクの各テストのコメント）とコードの式が一致しているかを確かめる**。式のほうが設計書（重みの具体値は、このプランの「設計書からの変更点」4）と違っていればコードを直す。

- [ ] **Step 5: 全体の単体テストとコミット**

Run: `node --test tests/unit/`
Expected: PASS

```bash
git add src/graph-near.js tests/unit/graph-near.test.js
git commit -m "feat(graph): score questions near any node and pick a weak-first drill set"
```

---

### Task 5: タップしたときの表示と、シートからの移動

**Files:**
- Modify: `src/graph-filter.js`
- Modify: `tests/unit/graph-filter.test.js`
- Modify: `js/graph-view.js`
- Modify: `css/graph.css`
- Modify: `home.js`（`GRAPH_SCRIPTS`）、`sw.js`（`ASSETS`）、`upload.py`（`FILES`）
- Modify: `tests/graph-view.test.js`・`tests/graph-entry.test.js`

**Interfaces:**
- Consumes: `buildIndex`（Task 3）、`nearestQuestions`（Task 4）
- Produces:
  - `focusSet(graph, index, i, extraQuestionNodes?: number[]): Uint8Array`（浮かび上がらせるノードが 1）
  - `GraphView._debug.focusNode: number`（選択中のノード。なければ -1）、`focusCount: number`、`animating: boolean`
  - シートの問題一覧の `li.graph-q[data-node]`（ノード添字）、`button.graph-sheet-expand`（広げる / 縮める）

- [ ] **Step 1: 失敗する単体テストを書く**

`tests/unit/graph-filter.test.js` の末尾に足す。

```js
const on = mask => [...mask].map((v, i) => (v ? i : -1)).filter(i => i >= 0);

test('focusSet: 問題 → 自分・概念・ひっかけ・ルール・章と、渡された近い問題', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 3)), [1, 2, 3, 12]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 11, [4, 10])), [4, 9, 10, 11, 14, 15]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 7)), [5, 7], 'つながりのない問題は自分と章だけ');
});

test('focusSet: 概念・ひっかけ → 自分・配下の問題・その章', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 14)), [9, 10, 11, 14]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 15)), [1, 4, 9, 11, 15]);
});

test('focusSet: ルール・章・本 → 自分・配下の問題・それらの概念とひっかけ', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 2)), [2, 3, 4, 12, 15]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 9)), [9, 10, 11, 12, 14, 15]);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 0)), [0, 3, 4, 6, 7, 12, 13, 15]);
});

test('focusSet: 範囲外の添字・範囲外の近い問題でも落ちず、何も立てない', () => {
  const g = makeFixture();
  const ix = F.buildIndex(g);
  assert.deepStrictEqual(on(F.focusSet(g, ix, -1)), []);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 99)), []);
  assert.deepStrictEqual(on(F.focusSet(g, ix, 3, [99, -1, 4])), [1, 2, 3, 4, 12]);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test tests/unit/graph-filter.test.js`
Expected: FAIL（`F.focusSet is not a function`）

- [ ] **Step 3: `src/graph-filter.js` に `focusSet` を足す**

`bundleWeak` の下に足し、`return` に `focusSet` を加える。

```js
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
```

Run: `node --test tests/unit/graph-filter.test.js`
Expected: すべて PASS

- [ ] **Step 4: 読み込みリストとファイル一覧に `src/graph-near.js` を足す**

- `home.js` の `GRAPH_SCRIPTS`: `'src/graph-detail.js',` の次に `'src/graph-near.js',`
- `sw.js` の `ASSETS`: `'src/graph-detail.js',` の次に `'src/graph-near.js',`（`CACHE` は Task 2 で上げた `v15` のまま。まだ公開していないため）
- `upload.py` の `FILES`: `"src/graph-detail.js",` の次に `"src/graph-near.js",`
- `tests/graph-entry.test.js` の `GRAPH_FILES`: `'src/graph-detail.js',` の次に `'src/graph-near.js',`。コメントの「12 ファイル」を「13 ファイル」に
- `tests/graph-view.test.js` の `testPage`: `<script src="/src/graph-detail.js"></script>` の次に `<script src="/src/graph-near.js"></script>`

- [ ] **Step 5: 失敗するブラウザのテストを書く**

`tests/graph-view.test.js` の、シートを確かめる既存のテスト（`ノードをタップするとシートが開く…` と `シートを開いた直後の互換 click…`）を読み、覆い（`.graph-sheet-backdrop`）に依存している部分を次のように直す。

- 「外側タップで閉じる」は、**何もない場所（Canvas の隅）をタップすると閉じる**に変える。
- `シートを開いた直後の互換 click（覆いの上で pointerdown がない click）では閉じない` は、覆いがなくなるので、**Canvas の上の `click` イベントだけ（pointerdown / pointerup なし）ではシートが閉じない**ことを確かめるテストに書き換える。

```js
test('シートを開いた直後の互換 click（pointer イベントのない click）では閉じない', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const [x, y] = await page.evaluate(() => GraphView._debug.screenOf(GRAMMAR_GRAPH.id.findIndex(s => s.startsWith('con:'))));
  await page.mouse.click(x, y);
  assert.equal(await sheetOpen(page), true);
  await page.evaluate(() => document.querySelector('#host canvas').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })));
  assert.equal(await sheetOpen(page), true);
});
```

そのうえで、次のテストを足す。

```js
const firstOf = (page, prefix) => page.evaluate(p => GRAMMAR_GRAPH.id.findIndex(s => s.startsWith(p)), prefix);
async function tapNode(page, i) {
  const [x, y] = await page.evaluate(i => GraphView._debug.screenOf(i), i);
  await page.mouse.click(x, y);
}

test('周辺: 概念をタップすると、配下の問題が全体表示でも出て、ほかのノードは薄くなる。何もない場所のタップで戻る', async t => {
  const page = await open(t, { viewport: { width: 1280, height: 800 } });
  await mountAndWait(page);
  const con = await firstOf(page, 'con:');
  const before = await page.evaluate(() => GraphView._debug.drawnKinds[5]);
  assert.equal(before, 0, '記録が空なら、全体表示に問題は出ない');
  const f = await frames(page);
  await tapNode(page, con);
  await nextFrame(page, f);
  const d = await page.evaluate(() => ({ node: GraphView._debug.focusNode, count: GraphView._debug.focusCount, questions: GraphView._debug.drawnKinds[5], lod: GraphView._debug.lod }));
  assert.equal(d.node, con);
  assert.equal(d.lod, 0);
  assert.ok(d.questions > 0, '配下の問題が出ていない');
  assert.ok(d.count > d.questions, '概念と章も含まれるはず');
  // つながらない本のノードは、背景に近い色になる（薄い）
  const other = await page.evaluate(con => {
    const G = GRAMMAR_GRAPH, D = GraphView._debug;
    for (let i = 0; i < G.id.length; i++) if (G.kinds[G.kind[i]] === 'book' && !D.isFocused(i)) return i;
    return -1;
  }, con);
  assert.ok(other >= 0);
  const [ox, oy] = await page.evaluate(i => GraphView._debug.screenOf(i), other);
  const px = await page.evaluate(([x, y]) => window.__px(x, y), [ox, oy]);
  const bg = await page.evaluate(() => window.__px(3, 120));
  assert.ok(Math.abs(px[0] - bg[0]) < 40 && Math.abs(px[1] - bg[1]) < 40 && Math.abs(px[2] - bg[2]) < 40, `薄くなっていない: ${px} / 背景 ${bg}`);
  // パンできる（覆いがない）
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  await page.mouse.move(200, 150); await page.mouse.down(); await page.mouse.move(260, 190, { steps: 4 }); await page.mouse.up();
  const cam1 = await page.evaluate(() => GraphView._debug.camera());
  assert.notEqual(cam1.x, cam0.x, 'シートを開いたままパンできない');
  assert.equal(await sheetOpen(page), true, 'ドラッグでシートが閉じた');
  // 何もない場所のタップで閉じて、元に戻る
  await page.mouse.click(4, 120);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.evaluate(() => GraphView._debug.focusNode), -1);
});

test('周辺: 問題をタップすると、近い問題（最大 30 問）も浮かび上がる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const pick = await pickLinkedQuestion(page);
  let f = await frames(page);
  await page.evaluate(q => GraphView._debug.focus(q, 9), pick.q);
  await nextFrame(page, f);
  f = await frames(page);
  await tapNode(page, pick.q);
  await nextFrame(page, f);
  const d = await page.evaluate(p => ({
    node: GraphView._debug.focusNode,
    concept: GraphView._debug.isFocused(p.concept), trap: GraphView._debug.isFocused(p.trap),
    questions: GRAMMAR_GRAPH.id.filter((s, i) => s.startsWith('q:') && GraphView._debug.isFocused(i)).length,
  }), pick);
  assert.equal(d.node, pick.q);
  assert.equal(d.concept, true);
  assert.equal(d.trap, true);
  assert.ok(d.questions >= 2 && d.questions <= 31, `自分 + 近い問題（最大 30）: ${d.questions}`);
});

test('シート: 半分の高さで開き、「広げる」で広がる。問題をタップすると、その場所へ動いて選択が切り替わり、動き終わると止まる', async t => {
  const page = await open(t);
  await mountAndWait(page);
  const con = await firstOf(page, 'con:');
  await tapNode(page, con);
  const h0 = await page.evaluate(() => document.querySelector('#host .graph-sheet').getBoundingClientRect().height);
  assert.ok(h0 <= 812 * 0.45, `半分より高い: ${h0}`);
  await page.locator('#host .graph-sheet-expand').click();
  const h1 = await page.evaluate(() => document.querySelector('#host .graph-sheet').getBoundingClientRect().height);
  assert.ok(h1 > h0, '広がっていない');
  await page.locator('#host .graph-sheet-expand').click();
  const target = Number(await page.locator('#host .graph-q[data-node]').first().getAttribute('data-node'));
  const cam0 = await page.evaluate(() => GraphView._debug.camera());
  await page.locator('#host .graph-q[data-node]').first().click();
  await waitFor(page, () => GraphView._debug.animating === false && GraphView._debug.pending === false);
  const d = await page.evaluate(() => ({ node: GraphView._debug.focusNode, cam: GraphView._debug.camera() }));
  assert.equal(d.node, target, '選択が問題に切り替わっていない');
  assert.ok(d.cam.x !== cam0.x || d.cam.y !== cam0.y, '画面が動いていない');
  const [sx, sy] = await page.evaluate(i => GraphView._debug.screenOf(i), target);
  assert.ok(sx > 100 && sx < 275, `横の中央に来ていない: ${sx}`);
  assert.ok(sy > 60 && sy < 812 * 0.6, `シートに隠れている: ${sy}`);
  await page.evaluate(() => { window.__cnt.raf = 0; window.__cnt.timeout = 0; window.__cnt.interval = 0; });
  await new Promise(r => setTimeout(r, 900));
  assert.deepEqual(await page.evaluate(() => window.__cnt), { raf: 0, timeout: 0, interval: 0 }, '動き終わった後も描き続けている');
});

test('シート: 「視差効果を減らす」では、アニメーションなしで切り替わる', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.addInitScript(COUNT_SCRIPT);
  await page.goto(base + '/__graph_test.html');
  await mountAndWait(page);
  await tapNode(page, await firstOf(page, 'con:'));
  await page.locator('#host .graph-q[data-node]').first().click();
  assert.equal(await page.evaluate(() => GraphView._debug.animating), false);
});
```

- [ ] **Step 6: 失敗を確かめる**

Run: `NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js`
Expected: 足したテストと、書き換えたシートのテストが FAIL。

- [ ] **Step 7: `js/graph-view.js` に、周辺の表示・下部パネルのシート・移動を入れる**

(a) 定数に足す。

```js
  const FOCUS_NEAR = 30;         // 問題を選んだときに一緒に浮かび上がらせる、近い問題の数
  const DIM_NODE = 0.16;         // 選択中、つながらないノードの濃さ
  const DIM_EDGE = 0.08;         // 選択中、つながらない線の濃さ
  const JUMP_MS = 300;           // シートの問題をタップしたときの移動の長さ
  const JUMP_MIN_REL = 2.4;      // 移動先の倍率の下限（全体表示に対する比。ルールまで見える倍率）
```

`debug` に `focusNode: -1, focusCount: 0, animating: false,` を足す。`mount` の初期化の行にも同じ 3 つを足す。

(b) 「状態」を直す。`let backdropArmed = false;` を消し、次を足す。

```js
    let focus = null, focusNode = -1; // 選択中: 浮かび上がらせるノード（Uint8Array）と、選択したノード
    let anim = null;                  // 移動のアニメーション中だけ { from, to, t0 }
    let sheetWide = false;            // シートを広げているか（既定は半分の高さ）
    const qidNode = new Map();        // 問題 id → ノード添字（シートの一覧から移動するため）
```

前処理の `const index = S.buildIndex(graph);` の下で `qidNode` を埋める。

```js
    for (let o = 0; o < index.nq; o++) if (index.qNode[o] >= 0) qidNode.set(graph.qids[o], index.qNode[o]);
```

`createInstance` の先頭の読み込み確認に `typeof S.focusSet !== 'function'` を足す。

(c) DOM: `'<div class="graph-sheet-backdrop" hidden></div>' +` の行を消す。`<section class="graph-sheet" …>` の `aria-modal="true"` を `aria-modal="false"` にする。ヘッダーの閉じるボタンの前に足す。

```js
          '<button type="button" class="graph-sheet-expand" aria-pressed="false">広げる</button>' +
```

`const backdrop = rootEl.querySelector('.graph-sheet-backdrop');` を消し、`const sheetExpand = sheet.querySelector('.graph-sheet-expand');` を足す。`on(backdrop, 'pointerdown', …)` と `on(backdrop, 'click', …)` の 2 行と、その上のコメントを消す。`openSheet` / `closeSheet` の `backdrop.hidden = …`・`backdropArmed = false;` を消す。

(d) `ensureMask` を置き換える。

```js
    function ensureMask(lod) {
      const key = lod + '|' + book + '|' + (weakOnly ? 1 : 0) + '|' + masteryVer + '|' + focusNode;
      if (key === maskKey) return;
      maskKey = key;
      mask = S.visibleMask(graph, mastery, { book, weakOnly, lod, showWeakQuestions: true, forceShow: focus });
      for (let i = 0; i < n; i++) hitXs[i] = mask[i] ? xs[i] : NaN;
    }
```

（`finishSettle` が `maskKey = ''` にするので、座標が変わったときも作り直される。）

(e) 選択の関数を、`renderSheet` の前に足す。

```js
    // ---- 選択（周辺を浮かび上がらせる） ----
    function setFocus(i) {
      const nearQ = graph.kind[i] === index.kQ && typeof S.nearestQuestions === 'function'
        ? S.nearestQuestions(graph, index, i, FOCUS_NEAR) : null;
      focus = S.focusSet(graph, index, i, nearQ);
      focusNode = i;
      let c = 0;
      for (let k = 0; k < n; k++) c += focus[k];
      debug.focusNode = i; debug.focusCount = c;
      requestDraw();
    }
    function clearFocus() {
      if (!focus) return;
      focus = null; focusNode = -1;
      debug.focusNode = -1; debug.focusCount = 0;
      requestDraw();
    }
```

(f) `openSheet` / `closeSheet` を置き換える。

```js
    function setSheetWide(wide) {
      sheetWide = !!wide;
      sheet.classList.toggle('graph-sheet-wide', sheetWide);
      sheetExpand.setAttribute('aria-pressed', String(sheetWide));
      sheetExpand.textContent = sheetWide ? '縮める' : '広げる';
    }
    function openSheet(i) {
      if (!renderSheet(i)) return;
      sheetIndex = i;
      debug.lastTap = i;
      sheetBody.scrollTop = 0;
      sheet.hidden = false;
      setFocus(i);
      try { sheet.focus({ preventScroll: true }); } catch (e) { /* 古いブラウザ */ }
    }
    function closeSheet() {
      if (sheetIndex < 0 && sheet.hidden) return;
      sheetIndex = -1;
      sheet.hidden = true;
      setSheetWide(false);
      clearFocus();
    }
```

(g) `renderSheet` の問題一覧の `<li …>` を置き換える（`data-node` と、キーボードで押せるようにする属性を足す）。

```js
      for (const q of d.questions) {
        const node = qidNode.has(q.qid) ? qidNode.get(q.qid) : -1;
        html += `<li class="graph-q graph-q-${esc(q.status)}"${node >= 0 ? ` data-node="${node}" role="button" tabindex="0"` : ''}><span class="graph-q-status">${esc(STATUS_LABEL[q.status] || q.status)}</span>` +
          `<span class="graph-q-no">#${esc(q.qid)}</span><span class="graph-q-text">${q.text == null ? '' : esc(q.text)}</span></li>`;
      }
```

(h) 移動の関数を、`zoomBy` の下に足す。

```js
    // シートの一覧から: その問題へ画面を動かし、選択を切り替える。シートに隠れない位置（上側の中央）に置く
    function jumpTo(i) {
      if (!(i >= 0 && i < n) || !cam || settle) return;
      setSheetWide(false);
      openSheet(i);
      const sc = Math.max(cam.scale, fitScale * JUMP_MIN_REL);
      const covered = sheet.hidden ? 0 : Math.min(height * 0.6, sheet.getBoundingClientRect().height);
      const to = { x: width / 2 - xs[i] * sc, y: Math.max(60, (height - covered) / 2) - ys[i] * sc, scale: sc };
      const mq = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (mq && mq.matches) { anim = null; debug.animating = false; setCam(to); return; }
      anim = { from: cam, to, t0: performance.now() };
      debug.animating = true;
      interacted = true;
      requestDraw();
    }
    function stepAnim() {
      const u = Math.min(1, (performance.now() - anim.t0) / JUMP_MS);
      const e = u * (2 - u); // だんだん遅くなる
      const a = anim.from, b = anim.to;
      cam = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, scale: a.scale + (b.scale - a.scale) * e };
      if (u >= 1) { anim = null; debug.animating = false; }
    }
    function stopAnim() { if (anim) { anim = null; debug.animating = false; } }
```

`onFrame` の最後の `draw();` を置き換える（力学の分岐の後）。

```js
      if (anim) stepAnim();
      draw();
      if (anim) requestDraw(); // 動き終わったら（anim = null）要求しない
```

指やホイールで触ったら、移動をやめる。`onPointerDown` の先頭（`if (e.pointerType === 'mouse' …` の次）と、`onWheel` の先頭（`e.preventDefault();` の次）に `stopAnim();` を足す。`startSettle` の先頭の `stopSettle();` の次と、`destroy()` にも `stopAnim();` を足す。

(i) `onSheetClick` と `onKeyDown` を置き換える。

```js
    function onSheetClick(e) {
      if (e.target.closest('.graph-sheet-close')) { closeSheet(); return; }
      if (e.target.closest('.graph-sheet-expand')) { setSheetWide(!sheetWide); return; }
      const li = e.target.closest('.graph-q[data-node]');
      if (li) jumpTo(Number(li.dataset.node));
    }
    function onKeyDown(e) {
      if (e.key === 'Escape' && !sheet.hidden) { e.preventDefault(); closeSheet(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && sheet.contains(e.target)) {
        const li = e.target.closest('.graph-q[data-node]');
        if (li) { e.preventDefault(); jumpTo(Number(li.dataset.node)); }
      }
    }
```

(j) `draw` を、選択中は 2 回に分けて描く形にする。

エッジの部分（Task 3 で足した `const bundleCount = …` から、`ctx.setLineDash([]);` まで）を置き換える。

```js
      // 線。選択中は、まず全部を薄く描き、そのあと浮かび上がらせる線を通常の濃さで重ねる
      const lit = focus;
      ctx.globalAlpha = lit ? DIM_EDGE : 1;
      const bundleCount = lod < 2 ? drawBundles(lod, s, ox, oy, lit ? DIM_EDGE : 1) : 0;
      let edgeCount = 0;
      const edgeStyle = [
        [colors.edge, 1, null],
        [colors.conceptEdge, 1, [1.5, 3]],
        [colors.trapLine, 1.2, [5, 4]],
      ];
      for (let pass = 0; pass < (lit ? 2 : 1); pass++) {
        // pass 0 = 全部（選択中は薄く）、pass 1 = 両端が浮かび上がっている線だけ
        for (let t = 0; t < 3; t++) {
          const list = edgesByType[t];
          ctx.beginPath();
          let any = false;
          for (let k = 0; k < list.length; k += 2) {
            const a = list[k], b = list[k + 1];
            if (!mask[a] || !mask[b] || !(inView[a] || inView[b])) continue;
            if (pass === 1 && !(lit[a] && lit[b])) continue;
            ctx.moveTo(xs[a] * s + ox, ys[a] * s + oy);
            ctx.lineTo(xs[b] * s + ox, ys[b] * s + oy);
            any = true;
            if (pass === 0) edgeCount++;
          }
          if (!any) continue;
          ctx.globalAlpha = pass === 0 && lit ? DIM_EDGE : 1;
          ctx.strokeStyle = edgeStyle[t][0];
          ctx.lineWidth = pass === 1 ? 1.8 : edgeStyle[t][1];
          ctx.setLineDash(edgeStyle[t][2] || []);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
```

元の `let edgeCount = 0;` と `const edgeStyle = […]` の宣言は、この置き換えの中に入っているので、重複して残さない。

`drawBundles` に 5 番目の引数 `alpha` を足し、`ctx.globalAlpha = c === 0 ? 0.5 : 1;` を `ctx.globalAlpha = (c === 0 ? 0.5 : 1) * alpha;` にする。

ノードを塗るループ（Task 3 の `for (let c = 0; c < 9; c++) { … }`）を置き換える。

```js
      for (let pass = 0; pass < (lit ? 2 : 1); pass++) {
        // pass 0 = 選択中はつながらないノード（薄く）、選択していなければ全部。pass 1 = 浮かび上がらせるノード
        ctx.globalAlpha = lit && pass === 0 ? DIM_NODE : 1;
        for (let c = 0; c < 9; c++) {
          ctx.beginPath();
          let any = false;
          for (let j = 0; j < m; j++) {
            const i = drawList[j];
            if (fillClass[i] !== c) continue;
            if (lit && (lit[i] ? pass === 0 : pass === 1)) continue;
            ctx.moveTo(sxs[i] + rs[i], sys[i]);
            ctx.arc(sxs[i], sys[i], rs[i], 0, Math.PI * 2);
            any = true;
          }
          if (!any) continue;
          ctx.fillStyle = c < 6 ? colors.states[c] : colors.reds[c - 6];
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
```

種類の印（3 つの `ringPath(…)`）は、選択中は浮かび上がらせるノードだけにする。それぞれの `pick` に `(!lit || lit[i]) &&` を足す。

```js
      ringPath(m, i => (!lit || lit[i]) && graph.kind[i] === kConcept, 2.5);
      ctx.strokeStyle = colors.ring; ctx.lineWidth = 1.3; ctx.stroke();
      ringPath(m, i => (!lit || lit[i]) && graph.kind[i] === kTrap, 2.5);
      ctx.strokeStyle = colors.trapEdge; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2.5]); ctx.stroke();
      ctx.setLineDash([]);
      ringPath(m, i => (!lit || lit[i]) && st[i] === 1, 1.6, i => graph.kind[i] === kConcept || graph.kind[i] === kTrap ? 5 : 0);
      ctx.strokeStyle = colors.dueRing; ctx.lineWidth = 1.8; ctx.stroke();
      // 選択したノードの外枠
      if (lit && focusNode >= 0 && mask[focusNode] && inView[focusNode]) {
        ctx.beginPath();
        ctx.arc(sxs[focusNode], sys[focusNode], rs[focusNode] + 5, 0, Math.PI * 2);
        ctx.strokeStyle = colors.label; ctx.lineWidth = 2; ctx.stroke();
      }
```

`drawLabels` の候補の条件 `if (!mask[i] || !inView[i]) continue;` を置き換える（選択中は、浮かび上がらせるノードだけにラベルを置く）。

```js
        if (!mask[i] || !inView[i] || (focus && !focus[i])) continue;
```

(k) テスト用に足す（返すオブジェクトと、末尾の `debug.*`）。

```js
      isFocused(i) { return !!(focus && focus[i]); },
```

```js
  debug.isFocused = i => (inst ? inst.isFocused(i) : false);
```

`refresh()` の中の `if (sheetIndex >= 0 && !renderSheet(sheetIndex)) closeSheet();` はそのまま（選択は座標によらないので、作り直さない）。

- [ ] **Step 8: `css/graph.css` を直す**

`.graph-sheet-backdrop` の定義を消す（`grep -n "graph-sheet-backdrop" css/graph.css`）。`.graph-sheet` の `max-height: 72%;` を `max-height: 42%;` にし、次を足す。

```css
/* シートは背景を覆わない下部パネル。既定は半分の高さで、グラフを触りながら読める */
.graph-sheet.graph-sheet-wide { max-height: 72%; }
.graph-sheet-expand {
  flex: none;
  margin-right: 6px;
  padding: 6px 10px;
  border: 1px solid var(--graph-border);
  border-radius: 999px;
  background: transparent;
  color: var(--graph-label);
  font-size: 12px;
}
.graph-q[data-node] { cursor: pointer; }
.graph-q[data-node]:focus-visible { outline: 2px solid var(--graph-ring); outline-offset: 2px; }
```

凡例（`.graph-legend`）とズームのボタンが、開いたシートの下に隠れることは許す（シートが手前）。

- [ ] **Step 9: テストを通す**

Run:
```bash
node --test tests/unit/
NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js
NODE_PATH=$(npm root -g) node --test tests/graph-entry.test.js
pytest tests -q
```
Expected: すべて PASS。`tests/graph-entry.test.js` に覆いへの参照（`graph-sheet-backdrop`）があれば、Step 5 と同じ方針で直す。

- [ ] **Step 10: スクリーンショットとコミット**

375×812 で「概念をタップした状態」「問題をタップした状態（近い問題が浮かび上がる）」「シートの問題をタップして移動した後」、1280×800 で「章をタップした状態」を撮って利用者に見せる。

```bash
git add src/graph-filter.js tests/unit/graph-filter.test.js js/graph-view.js css/graph.css home.js sw.js upload.py tests/graph-view.test.js tests/graph-entry.test.js
git commit -m "feat(graph): highlight a node's neighbourhood and jump to a question from the sheet"
```

---

### Task 6: 近い問題の出題

**Files:**
- Modify: `js/word-stats.js`（`state` の初期値）
- Modify: `js/settings.js`（続きの保存と復元）
- Modify: `js/grammar-drill.js`（出題の入口・表示・解除）
- Modify: `js/vocab-drill.js`（`updateFooter`）
- Modify: `js/filter-sheet.js`（`setApp`）
- Modify: `home.js`（`saveBookSessionSnapshot`・`restoreBookSessionSnapshot`・`showGraphPage`）
- Modify: `css/app.css`
- Modify: `js/graph-view.js`・`css/graph.css`（ボタン）
- Create: `tests/graph-drill.test.js`
- Modify: `tests/graph-view.test.js`

**Interfaces:**
- Consumes: `pickNear`（Task 4）、`index`（Task 3）
- Produces:
  - `GraphView.mount` の `deps.onStartDrill?: (ids: number[], label: string) => void`（渡されたときだけボタンを出す）
  - `NEAR_DRILL_KEY = 'toeic_near_drill_v1'`、`state.nearDrill: null | { label: string }`
  - `nearDrillActive(): boolean`、`saveNearDrill()`、`clearNearDrill()`、`restoreNearDrill(): boolean`（`js/settings.js`）
  - `startGrammarCustomDrill(ids: number[], label: string): boolean`、`exitNearDrill()`、`updateNearDrillBanner()`（`js/grammar-drill.js`）
  - 画面: `#near-drill-banner`（`.near-drill-label`・`button.near-drill-exit`）、完了画面の `button.near-drill-back`、シートの `button.graph-drill-btn`

- [ ] **Step 1: 前提を確かめる（コードを書く前に）**

```bash
grep -n "removeItem" js/*.js home.js | head -20
grep -n "nearDrill\|NEAR_DRILL" js/*.js home.js src/*.js | head
sed -n 280,300p js/word-stats.js
grep -n "function insertGraphAsset" -A14 home.js
grep -n "completion-card" js/grammar-drill.js
```

確かめること:
- 記録のキーを消すとき、既存のコードが `localStorage.removeItem` を直接呼んでいるか、補助関数があるか。補助関数があればそれを使う（このプランのコードは直接呼ぶ形で書いてある）。
- `nearDrill`・`NEAR_DRILL` という名前がまだ使われていないこと。
- `state` の初期値の書き方（`grammarPool: [],` の近く）。

- [ ] **Step 2: 失敗するブラウザのテストを書く**

`tests/graph-drill.test.js`:

```js
// グラフの「近い問題を解く」の検証（アプリ全体を起動する）。
// 実行: NODE_PATH=$(npm root -g) node --test tests/graph-drill.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const NEAR_KEY = 'toeic_near_drill_v1';
const SESSION_KEY = 'toeic_session';
const BOOK_SESSIONS_KEY = 'toeic_book_sessions_v1';

let browser, base;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' }[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

async function open(t, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  t.after(() => assert.deepEqual(errors.map(String), [], 'ページで例外が出た'));
  if (opts.init) await page.addInitScript(opts.init.fn, opts.init.arg);
  await page.goto(base + '/index.html' + (opts.hash || '#home'));
  return { page, context };
}
async function waitFor(page, fn, arg, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout: ' + fn.toString());
    await new Promise(r => setTimeout(r, 20));
  }
}
const graphReady = page => waitFor(page, () => typeof GraphView !== 'undefined' && GraphView._debug.frames >= 1 && GraphView._debug.settled === true);
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const poolIds = page => page.evaluate(() => state.grammarPool.map(g => g.id));

// 文法の通常の出題を 1 問進めてから、グラフを開く（通常の続きがある状態にする）
async function openGraphWithNormalSession(page) {
  await page.evaluate(() => { setApp('grammar'); applyGrammarFilters(); switchAppPage('practice'); });
  await page.locator('#choices-container button').first().click();
  await page.evaluate(() => switchAppPage('graph'));
  await graphReady(page);
}
// ノードをタップしてシートを開き、「近い問題を解く」を押す。押す前のボタンの文字を返す
async function startNearDrill(page, prefix) {
  const [x, y] = await page.evaluate(p => GraphView._debug.screenOf(GRAMMAR_GRAPH.id.findIndex(s => s.startsWith(p))), prefix);
  await page.mouse.click(x, y);
  const btn = page.locator('#graph-page .graph-drill-btn');
  const text = await btn.innerText();
  await btn.click();
  await waitFor(page, () => currentAppPage === 'practice');
  return text;
}

test('概念から「近い問題を解く」: 演習ページへ移り、問題数がボタンと合い、通常の続きは変わらない', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = await stored(page, SESSION_KEY);
  const books0 = await stored(page, BOOK_SESSIONS_KEY);
  assert.ok(session0, '通常の続きが保存されている前提');
  const text = await startNearDrill(page, 'con:');
  const m = text.match(/(\d+) 問/);
  assert.ok(m, `ボタンの文字: ${text}`);
  const ids = await poolIds(page);
  assert.equal(ids.length, Number(m[1]));
  assert.ok(ids.length >= 1 && ids.length <= 30);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(await page.evaluate(() => state.app), 'grammar');
  assert.match(await page.locator('#near-drill-banner').innerText(), /に近い \d+ 問/);
  assert.equal(await stored(page, SESSION_KEY), session0, '通常の続きが書き換わった');
  assert.equal(await stored(page, BOOK_SESSIONS_KEY), books0, '本ごとの続きが書き換わった');
  const near = JSON.parse(await stored(page, NEAR_KEY));
  assert.deepEqual(near.ids, ids);
  assert.equal(near.index, 0);
});

test('回答すると、苦手の記録が通常と同じ形で保存され、通常の続きは変わらないまま。再読み込みしても続きから解ける', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = await stored(page, SESSION_KEY);
  await startNearDrill(page, 'con:');
  const ids = await poolIds(page);
  const stats0 = JSON.parse((await stored(page, 'toeic_grammar_stats')) || '{}');
  await page.locator('#choices-container button').first().click();
  const stats1 = JSON.parse(await stored(page, 'toeic_grammar_stats'));
  assert.equal(stats1[ids[0]].a, ((stats0[ids[0]] || {}).a || 0) + 1, '解答数が増えていない');
  assert.equal(await stored(page, SESSION_KEY), session0);
  assert.equal(JSON.parse(await stored(page, NEAR_KEY)).index, 1, '回答済みの問題の次から再開する');
  // バックアップに入る「出題の続き」も、通常の続きのまま
  assert.deepEqual(await page.evaluate(() => sessionSnapshot()), JSON.parse(session0));
  await page.reload();
  await waitFor(page, () => typeof state !== 'undefined' && state.grammarPool.length > 0);
  await page.evaluate(() => switchAppPage('practice'));
  assert.deepEqual(await poolIds(page), ids, '再読み込みで 30 問が戻らない');
  assert.equal(await page.evaluate(() => state.currentGrammarIndex), 1);
  assert.equal(await page.locator('#near-drill-banner').isVisible(), true);
});

test('解除すると、表示が消え、続きのキーも消え、通常の出題の続きに戻る', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = JSON.parse(await stored(page, SESSION_KEY));
  await startNearDrill(page, 'trap:');
  await page.locator('#near-drill-banner .near-drill-exit').click();
  assert.equal(await page.locator('#near-drill-banner').isVisible(), false);
  assert.equal(await stored(page, NEAR_KEY), null);
  assert.equal(await page.evaluate(() => state.nearDrill), null);
  assert.deepEqual(await poolIds(page), session0.grammar.pool, '通常の続きの問題に戻っていない');
  assert.equal(await page.evaluate(() => state.currentGrammarIndex), session0.grammar.index);
});

test('フィルターを変える（出題し直す）と解除される。単語に切り替えて戻ると、近い問題の続きに戻る', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  await startNearDrill(page, 'ch:');
  const ids = await poolIds(page);
  await page.evaluate(() => setApp('vocab'));
  assert.equal(await page.locator('#near-drill-banner').isVisible(), false, '単語では表示しない');
  await page.evaluate(() => setApp('grammar'));
  assert.deepEqual(await poolIds(page), ids);
  assert.equal(await page.locator('#near-drill-banner').isVisible(), true);
  await page.evaluate(() => applyGrammarFilters());
  assert.equal(await stored(page, NEAR_KEY), null);
  assert.equal(await page.locator('#near-drill-banner').isVisible(), false);
});

test('最後まで解くと「グラフに戻る」が出て、押すとグラフが開き、通常の続きに戻っている', async t => {
  const { page } = await open(t);
  await openGraphWithNormalSession(page);
  const session0 = JSON.parse(await stored(page, SESSION_KEY));
  await startNearDrill(page, 'con:');
  // 残りを飛ばして最後へ（描画は本物の関数に任せる）
  await page.evaluate(() => { state.currentGrammarIndex = state.grammarPool.length; renderCurrentGrammar(); });
  await page.locator('.near-drill-back').click();
  await waitFor(page, () => currentAppPage === 'graph');
  assert.equal(await stored(page, NEAR_KEY), null);
  assert.deepEqual(await poolIds(page), session0.grammar.pool);
  assert.deepEqual(JSON.parse(await stored(page, SESSION_KEY)).grammar.pool, session0.grammar.pool, '通常の続きが 30 問で上書きされた');
});

for (const [name, raw] of [
  ['JSON が壊れている', '{'],
  ['ids が配列でない', '{"ids":5}'],
  ['存在しない問題 id', '{"ids":[1,99999999],"index":0}'],
  ['index が範囲の外', '{"ids":[1],"index":7}'],
  ['空の ids', '{"ids":[],"index":0}'],
]) {
  test(`壊れた続き（${name}）でも、通常の出題で始まり、例外は出ない`, async t => {
    const { page } = await open(t, {
      init: { fn: ([k, v]) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem(k, v); } }, arg: [NEAR_KEY, raw] },
    });
    await page.evaluate(() => { setApp('grammar'); switchAppPage('practice'); });
    assert.equal(await page.evaluate(() => state.nearDrill), null);
    assert.ok((await poolIds(page)).length > 1, '通常の出題になっていない');
    assert.equal(await page.locator('#near-drill-banner').count() === 0 || !(await page.locator('#near-drill-banner').isVisible()), true);
  });
}

test('問題・ルール・本のノードからも出題できる（どの種類でも）', async t => {
  const { page } = await open(t);
  for (const prefix of ['book:', 'rule:']) {
    await page.evaluate(() => switchAppPage('graph'));
    await graphReady(page);
    // ルールは中くらいのズームで出る
    if (prefix === 'rule:') await page.evaluate(p => GraphView._debug.focus(GRAMMAR_GRAPH.id.findIndex(s => s.startsWith(p)), 3), prefix);
    await waitFor(page, () => GraphView._debug.pending === false);
    const text = await startNearDrill(page, prefix);
    assert.match(text, /\d+ 問/);
    assert.ok((await poolIds(page)).length >= 1);
  }
});
```

`tests/graph-view.test.js` にも足す（アプリなしの最小のページ）。

```js
test('出題ボタン: onStartDrill を渡したときだけ出て、押すと問題 id（30 以内・重複なし）と名前が渡る', async t => {
  const page = await open(t);
  await mountAndWait(page);
  await tapNode(page, await firstOf(page, 'con:'));
  assert.equal(await page.locator('#host .graph-drill-btn').count(), 0, 'onStartDrill がないのにボタンが出た');
  await page.evaluate(() => {
    GraphView.destroy();
    window.__drill = null;
    const deps = window.__deps();
    deps.onStartDrill = (ids, label) => { window.__drill = { ids, label }; };
    GraphView.mount(document.getElementById('host'), deps);
  });
  await waitFor(page, () => GraphView._debug.frames >= 1);
  await tapNode(page, await firstOf(page, 'con:'));
  await page.locator('#host .graph-drill-btn').click();
  const d = await page.evaluate(() => window.__drill);
  assert.ok(d && d.ids.length >= 1 && d.ids.length <= 30);
  assert.equal(new Set(d.ids).size, d.ids.length);
  assert.equal(typeof d.label, 'string');
  assert.ok(d.label.length > 0);
});
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_PATH=$(npm root -g) node --test tests/graph-drill.test.js`
Expected: FAIL（`.graph-drill-btn` が見つからず時間切れ）

- [ ] **Step 4: グラフのシートにボタンを足す（`js/graph-view.js`）**

「状態」に `let sheetPick = null; // 開いているシートの「近い問題」の選び（押したときにそのまま渡す）` を足す。

`renderSheet` の `if (d.advice) html += …;` の次に足す。

```js
      sheetPick = null;
      if (typeof deps.onStartDrill === 'function' && typeof S.pickNear === 'function') {
        const pick = S.pickNear(graph, index, i, mastery, { random: Math.random });
        if (pick.ids.length > 0) {
          sheetPick = { ids: pick.ids, label: d.title };
          html += `<button type="button" class="graph-drill-btn">近い問題を ${esc(pick.ids.length)} 問解く</button>`;
        }
      }
```

`onSheetClick` の先頭の 2 行の次に足す。

```js
      if (e.target.closest('.graph-drill-btn')) {
        const p = sheetPick;
        if (p) deps.onStartDrill(p.ids.slice(), p.label); // 呼び出し側が画面を切り替える（この後 destroy されうる）
        return;
      }
```

`closeSheet` に `sheetPick = null;` を足す。先頭のコメントの `deps` の説明に `onStartDrill?: (ids, label) => void` を足す。

`css/graph.css` に足す。

```css
.graph-drill-btn {
  display: block;
  width: 100%;
  margin: 10px 0 4px;
  padding: 11px 14px;
  border: 0;
  border-radius: 12px;
  background: var(--graph-chip-on-bg);
  color: var(--graph-chip-on-text);
  font-size: 14px;
  font-weight: 600;
}
```

- [ ] **Step 5: 続きの保存と復元（`js/word-stats.js`・`js/settings.js`）**

`js/word-stats.js` の `state` の初期値、`grammarPool: [],` の次に足す。

```js
  nearDrill: null, // グラフの「近い問題を解く」の出題中だけ { label }。通常の出題の続きとは別に持つ
```

`js/settings.js` の `const SESSION_KEY = 'toeic_session';` の次に足す。

```js
// グラフの「近い問題を解く」の続き。この端末だけに置く（バックアップ・同期・別のタブへの反映の対象にしない。
// RECORD_KEYS / EXTRA_KEYS / CROSS_TAB_KEYS に足さないこと）。中身は { ids, index, score, answered, label }
const NEAR_DRILL_KEY = 'toeic_near_drill_v1';
```

`sessionSnapshot` の `const sessions = loadJSON(SESSION_KEY, {});` の次に足す。

```js
  // 近い問題の出題中は、通常の続きを書き換えない（保存済みのものをそのまま返す。バックアップにも通常の続きが入る）
  if (nearDrillActive()) return sessions;
```

`saveSession` を置き換える。

```js
function saveSession() {
  // 近い問題の出題中は、通常の続き（SESSION_KEY）に触れず、専用のキーにだけ保存する
  if (nearDrillActive()) { saveNearDrill(); return; }
  saveJSON(SESSION_KEY, sessionSnapshot());
}

function nearDrillActive() {
  return state.app === 'grammar' && !!state.nearDrill;
}

function saveNearDrill() {
  saveJSON(NEAR_DRILL_KEY, {
    ids: state.grammarPool.map(g => g.id),
    // 回答済みの問題は開き直したときに出し直さないよう、次の問題から再開する（通常の続きと同じ）
    index: Math.min(state.currentGrammarIndex + (state.grammarAnswered ? 1 : 0), state.grammarPool.length),
    score: state.grammarScore,
    answered: state.grammarAnsweredCount,
    label: state.nearDrill.label,
  });
}

// 近い問題の出題をやめる（メモリの印と、保存した続きの両方を消す）。出題そのものは呼び出し側が入れ替える
function clearNearDrill() {
  state.nearDrill = null;
  try { localStorage.removeItem(NEAR_DRILL_KEY); } catch (e) { /* 消せなくても、次に読むときに形を確かめる */ }
}

// 保存した近い問題の続きを戻せたら true。形が正しくない・解き終えている・問題が見つからないときは、消して false
function restoreNearDrill() {
  const saved = loadJSON(NEAR_DRILL_KEY, null);
  if (saved === null) return false;
  const ok = isPlainObject(saved) && Array.isArray(saved.ids);
  const pool = ok ? saved.ids.map(id => GRAMMAR_BY_ID.get(id)) : [];
  const index = ok && Number.isInteger(saved.index) ? saved.index : 0;
  if (!ok || pool.length === 0 || pool.some(x => !x) || index < 0 || index >= pool.length) { clearNearDrill(); return false; }
  resetReview();
  Object.assign(state, {
    grammarPool: pool,
    currentGrammarIndex: index,
    grammarScore: Number.isInteger(saved.score) ? saved.score : 0,
    grammarAnsweredCount: Number.isInteger(saved.answered) ? saved.answered : 0,
    nearDrill: { label: typeof saved.label === 'string' ? saved.label.slice(0, 60) : '' },
  });
  return true;
}
```

`loadJSON` が壊れた JSON のときに何を返すかを `js/util.js` で確かめる（`sed -n '/^function loadJSON/,/^}/p' js/util.js`）。`fallback`（ここでは `null`）を返すなら、壊れた続きは「続きなし」として扱われ、キーは残る。その場合は `restoreNearDrill` の `if (saved === null) return false;` を次に置き換えて、壊れたキーを消す。

```js
  if (saved === null) {
    let raw = null;
    try { raw = localStorage.getItem(NEAR_DRILL_KEY); } catch (e) { /* 読めなければ何もしない */ }
    if (raw !== null) clearNearDrill(); // 中身があるのに読めない = 壊れている
    return false;
  }
```

`restoreSession` の成功側（`resetReview();` の直前）に足す。

```js
  if (app === 'grammar') clearNearDrill(); // 通常の続きに戻すので、近い問題の出題は終わり
```

- [ ] **Step 6: 出題の入口・表示・解除（`js/grammar-drill.js`・`js/vocab-drill.js`・`js/filter-sheet.js`・`home.js`）**

`js/grammar-drill.js`: `applyGrammarFilters` の先頭に 1 行足す。

```js
function applyGrammarFilters() {
  clearNearDrill(); // フィルターで出題し直すので、近い問題の出題は終わり
  state.grammarPool = shuffle(filteredGrammar());
```

`applyGrammarFilters` の下に足す。

```js
// グラフの「近い問題を解く」から呼ぶ。ids の順に出題する。採点・苦手の記録は通常の出題と同じ。
// 通常の出題の続き（SESSION_KEY・本ごとの続き）は書き換えない。出題できたら true
function startGrammarCustomDrill(ids, label) {
  const pool = (Array.isArray(ids) ? ids : []).map(id => GRAMMAR_BY_ID.get(id)).filter(Boolean);
  if (pool.length === 0) return false;
  saveSession();                                   // 今の続き（通常の、または前の近い問題の）を先に保存する
  if (state.app !== 'grammar') setApp('grammar');  // 単語から来たときは文法に切り替える（表示の切り替えも含む）
  resetReview();
  Object.assign(state, {
    grammarPool: pool,
    currentGrammarIndex: 0,
    grammarScore: 0,
    grammarAnsweredCount: 0,
    nearDrill: { label: String(label == null ? '' : label).slice(0, 60) },
  });
  updateGrammarWeakBadge();
  updateFilterSummary();
  renderCurrentGrammar();
  return true;
}

// 近い問題の出題をやめて、通常の出題の続き（なければ今のフィルターで出題し直し）に戻る
function exitNearDrill() {
  clearNearDrill();
  if (!restoreSession('grammar')) return applyGrammarFilters();
  updateGrammarWeakBadge();
  updateFilterSummary();
  renderCurrentGrammar();
}

// 演習画面の上の「〈名前〉に近い N 問 ［解除］」。近い問題の出題中だけ出す。要素は初めて出すときに作る
function updateNearDrillBanner() {
  let el = document.getElementById('near-drill-banner');
  if (!nearDrillActive()) { if (el) el.hidden = true; return; }
  if (!el) {
    const quiz = document.getElementById('quiz-container');
    if (!quiz || !quiz.parentNode) return;
    el = document.createElement('div');
    el.id = 'near-drill-banner';
    el.className = 'near-drill-banner';
    el.innerHTML = '<span class="near-drill-label"></span><button type="button" class="near-drill-exit">解除</button>';
    el.querySelector('.near-drill-exit').addEventListener('click', exitNearDrill);
    quiz.parentNode.insertBefore(el, quiz);
  }
  const label = state.nearDrill.label ? `「${state.nearDrill.label}」に近い` : 'グラフで選んだ';
  el.querySelector('.near-drill-label').textContent = `${label} ${state.grammarPool.length} 問`;
  el.hidden = false;
}
```

`renderCurrentGrammar` の完了画面（`if (!review && state.currentGrammarIndex >= state.grammarPool.length) {` の中）の `container.innerHTML = …` の文字列で、最後の `</div>` の直前（`${typeof sessionReviewHtml === 'function' ? sessionReviewHtml('grammar') : ''}` の後）に足す。

```js
${nearDrillActive() ? '<button type="button" class="home-weak-btn near-drill-back">グラフに戻る</button>' : ''}
```

その `container.innerHTML = …;` の次の行に足す。

```js
    const backBtn = container.querySelector('.near-drill-back');
    // 通常の続きに戻してからグラフを開く（解き終えた 30 問で、通常の続きを上書きしないため）
    if (backBtn) backBtn.addEventListener('click', () => { exitNearDrill(); switchAppPage('graph'); });
```

`js/vocab-drill.js` の `updateFooter` の `updateBackButton();` の次に足す（単語・文法のどの描画でも呼ばれる場所）。

```js
  updateNearDrillBanner();
```

`js/filter-sheet.js` の `setApp`、文法の分岐の 1 行目を置き換える。

```js
    // 近い問題の続きがあればそれを、なければ通常の続きを、どちらもなければ今のフィルターで出題し直す
    if (!restoreNearDrill() && !restoreSession('grammar')) return applyGrammarFilters();
```

`home.js`:

- `saveBookSessionSnapshot` の先頭（`const bookSessions = loadJSON(…);` の前）に足す。

```js
  // 近い問題の出題中は、本ごとの続きを書き換えない（settings.js の sessionSnapshot と同じ扱い）
  if (state.app === 'grammar' && state.nearDrill) return;
```

- `restoreBookSessionSnapshot` の成功側（`resetReview();` の直前）に足す。

```js
  if (kind === 'grammar') clearNearDrill(); // 本の続きに戻すので、近い問題の出題は終わり
```

- `showGraphPage` の `GraphView.mount(host, { … })` に足す。

```js
      onStartDrill: (ids, label) => { if (startGrammarCustomDrill(ids, label)) switchAppPage('practice'); },
```

`css/app.css` の末尾に足す。

```css
/* グラフの「近い問題を解く」の出題中に、演習画面の上に出す表示 */
.near-drill-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(120, 120, 128, 0.14);
  font-size: 13px;
  line-height: 1.4;
}
.near-drill-banner[hidden] { display: none; }
.near-drill-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.near-drill-exit {
  flex: none;
  padding: 5px 12px;
  border: 1px solid rgba(120, 120, 128, 0.4);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 12px;
}
.near-drill-back { margin-top: 14px; }
```

- [ ] **Step 7: テストを通す**

Run:
```bash
NODE_PATH=$(npm root -g) node --test tests/graph-drill.test.js
NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js
```
Expected: すべて PASS。

失敗したときの見どころ:
- 「通常の続きが書き換わった」: `saveSession` を通らずに `SESSION_KEY` を書いている場所がないか（`grep -n "SESSION_KEY" js/*.js home.js`）。`home.js` の末尾で `window.saveSession` を包んでいる箇所は、中で元の `saveSession`（近い問題の出題中は専用のキーにだけ書く）と `saveBookSessionSnapshot`（先頭で抜ける）を呼ぶので、そのままでよい。
- 「再読み込みで 30 問が戻らない」: 起動時に `setApp` を通らずに `restoreSession('grammar')` を呼ぶ経路がないか（`grep -n "restoreSession(" js/*.js home.js`）。あれば、その前に `restoreNearDrill()` を試す形に揃える（`setApp` と同じ 1 行）。

- [ ] **Step 8: 保存とデータ保全のテストが変わらないことを確かめる**

Run:
```bash
NODE_PATH=$(npm root -g) node tests/storage-writes.test.js
NODE_PATH=$(npm root -g) node tests/storage-subscribe.test.js
NODE_PATH=$(npm root -g) node tests/data-safety.test.js
NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js
NODE_PATH=$(npm root -g) node --test tests/graph-entry.test.js
node --test tests/unit/
pytest tests -q
```
Expected: すべて PASS。`tests/fixtures/storage-scenario.golden.json` は変更しない（差分が出たら、通常の出題の保存内容が変わっている。原因を直す。比較用ファイルを作り直してはいけない）。

`git status --short` で、変更が意図したファイルだけであることを確かめる。

- [ ] **Step 9: スクリーンショットとコミット**

375×812 で「シートのボタン」「演習画面の上の表示」「完了画面の『グラフに戻る』」を撮って利用者に見せる。

```bash
git add js/word-stats.js js/settings.js js/grammar-drill.js js/vocab-drill.js js/filter-sheet.js home.js css/app.css js/graph-view.js css/graph.css tests/graph-drill.test.js tests/graph-view.test.js
git commit -m "feat(graph): start a weak-first drill of the questions near any node"
```

---

### Task 7: 計測・係数の調整・文書

**Files:**
- Modify: `tests/graph-view.test.js`（計測のテスト）
- Modify: `src/graph-force.js`（`GRAPH_RUNTIME` の値。必要なら）、`js/graph-view.js`（定数。必要なら）
- Modify: `docs/superpowers/specs/2026-11-11-grammar-graph-view-v3-design.md`（状態と実測値）
- Modify: `CLAUDE.md`、`README.md`

**Interfaces:**
- Consumes: Task 1〜6 のすべて

- [ ] **Step 1: 計測のテストを足す**

`tests/graph-view.test.js` の `性能（CPU 4 倍スロットル、記録用）` の下に足す。

```js
test('性能: 力学（CPU 4 倍スロットル、記録用。苦手 110 問 = 全体の約 1/9）', async t => {
  const out = {};
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const page = await open(t, { viewport: vp });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await seedWeak(page, 110);
    await page.evaluate(() => window.__mount());
    await settled(page);
    out[vp.width] = await page.evaluate(() => ({
      settleMs: Math.round(GraphView._debug.settleMs),
      maxFrameMs: Math.round(GraphView._debug.settleMaxFrameMs),
      ticks: GraphView._debug.settleTicks,
      drawMs: Math.round(GraphView._debug.forceDraw() * 10) / 10,
    }));
    assert.equal(out[vp.width].ticks, 120);
    assert.ok(out[vp.width].settleMs < 8000, `収まるまでが長すぎる: ${out[vp.width].settleMs}ms`);
  }
  console.log('# 力学（CPU 4 倍）', JSON.stringify(out));
});
```

Run: `NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js`
Expected: PASS。出力の `# 力学（CPU 4 倍）` の値を控える。

- [ ] **Step 2: 係数を調整する（スクリーンショットで判断する）**

`GRAPH_SHOTS=<このセッションの作業用ディレクトリ> NODE_PATH=$(npm root -g) node --test tests/graph-view.test.js` で画像を書き出す（`スクリーンショット（GRAPH_SHOTS があるときだけ）` のテスト。苦手ありの画面が含まれていなければ、そのテストに `seedWeak(page, 110)` → `settled` の後の 1 枚を足す）。リポジトリの中には書き出さない。

見るところと、動かす値（`src/graph-force.js` の `GRAPH_RUNTIME`。**`GRAPH_LAYOUT` は動かさない**。生成物が変わる）:

| 見え方 | 動かす値 |
|---|---|
| 苦手の問題が概念・ひっかけに寄りきらない | `weakConceptStrength`・`weakTrapStrength` を上げる、`weakParentFactor` を下げる |
| 寄りすぎて重なり、数が読めない | `weakLinkDistance` を上げる、`hubCollidePerWeak` を上げる |
| 苦手でないノードまで大きく動く | `alpha` を下げる |
| 収まりきらずに止まる（最後のフレームまで大きく動く） | `ticks` を上げる（収まるまでの時間と引き換え） |
| 収まるまでが長い（CPU 4 倍で 3 秒を超える） | `ticks` を下げる |

値を変えたら、`tests/unit/graph-force.test.js` と Task 2 のテスト（`settleTicks` の期待値 120 は `GRAPH_RUNTIME.ticks` と同じにする）を通し直す。線の量は `js/graph-view.js` の `BUNDLE_MIN_Q`・`BUNDLE_WIDTHS`、ノードの大きさは `SIZE_BOOST_STEP`・`SIZE_BOOST_MAX` で調整する。

調整前後のスクリーンショット（375×812 と 1280×800、全体表示）を利用者に見せ、値を決める。

- [ ] **Step 3: 全テストを通す**

Run:
```bash
pytest tests -q
node --test tests/unit/
node --test tests/build_graph.test.js
for f in graph-view graph-entry graph-drill; do NODE_PATH=$(npm root -g) node --test tests/$f.test.js || break; done
for f in storage-writes storage-subscribe data-safety grammar-seen; do NODE_PATH=$(npm root -g) node tests/$f.test.js || break; done
NODE_PATH=$(npm root -g) node tests/shell.test.js
```
Expected: すべて PASS（`shell.test.js` は約 90 秒）。ほかの `tests/*.test.js` も、`ls tests/*.test.js` で一覧を出して 1 つずつ実行する（`node:test` を使うものは `node --test`、そうでないものは `node`。ファイルの先頭のコメントに実行方法がある）。`tests/next-browser.cjs` の失敗は既知で、この作業とは無関係。

- [ ] **Step 4: 設計書に実測値を書く**

`docs/superpowers/specs/2026-11-11-grammar-graph-view-v3-design.md`:

- 冒頭の状態を `**実装済み（<実装した日>。実装計画 docs/superpowers/plans/2026-11-11-grammar-graph-view-v3.md、実機（iPhone）の確認は未実施）**` にする。
- §3.1 の計測の段落の後に、Step 1 の値を表で足す（「デスクトップの Chromium、CPU 4 倍の制限。iPhone では未計測」と断る）。
- §3.2・§4・§6 の「目安」と書いた値を、決めた値（`GRAPH_RUNTIME`、`BUNDLE_MIN_Q`、重み）に直す。
- §5 に、このプランの「設計書からの変更点」1（シートは背景を覆わない下部パネル）・2・3・5 を反映する。

- [ ] **Step 5: `CLAUDE.md` と `README.md` を直す**

`CLAUDE.md`:

- 「構成」の `src/*.js` の行の後に足す。

```markdown
- `vendor/`: d3-force 3.0.0 とその依存（UMD、無改変）。グラフを開いたときだけ読む。配置の力の定義は `src/graph-force.js` で、
  ビルド（`tools/lib/layout.mjs`）とアプリ（`js/graph-view.js`）が共有する。`GRAPH_LAYOUT` を変えると生成物 `data/grammar_graph.js` の座標が変わる
  （`tests/build_graph.test.js` がコミット済みの座標の再現を確かめる）。実行時の調整は `GRAPH_RUNTIME` だけで行う。
```

- 「守ること」に 11 を足し、7〜10 の後の「7〜10 と…」の段落の前に置く。

```markdown
11. **グラフの「近い問題を解く」は、通常の出題の続きを書き換えない。** 出題中（`state.nearDrill`）は `SESSION_KEY` と本ごとの続きに触れず、
    続きはこの端末だけのキー `toeic_near_drill_v1` に置く（バックアップ・同期・別のタブへの反映の対象外。`RECORD_KEYS` / `EXTRA_KEYS` / `CROSS_TAB_KEYS` に足さない）。
    通常の出題に戻る経路（`applyGrammarFilters`・`restoreSession`・`restoreBookSessionSnapshot`）は `clearNearDrill()` を呼ぶ。`tests/graph-drill.test.js` で確かめる。
12. **グラフは、力学が収まった後と移動のアニメーションが終わった後は描かない。** `requestAnimationFrame` を呼び続けるのは、
    開いたときの力学（`GRAPH_RUNTIME.ticks` 回）と移動（約 0.3 秒）の間だけ。`tests/graph-view.test.js` が、その後の呼び出しが 0 回であることを確かめる。
```

- 「テストの実行」の一覧に `tests/graph-drill.test.js` を足す必要はない（「ブラウザのテストは `tests/*.test.js` の単位で実行する」に含まれる）。

`README.md`: 文法グラフの説明がある節を探し（`grep -n "グラフ" README.md`）、「苦手が位置・大きさ・線の太さで見える」「ノードをタップすると周辺が浮かび上がる」「どのノードからでも近い問題を 30 問解ける」を 1〜3 行で足す。節がなければ、機能の一覧に 1 項目足す。

- [ ] **Step 6: コミット**

```bash
git add tests/graph-view.test.js src/graph-force.js js/graph-view.js docs/superpowers/specs/2026-11-11-grammar-graph-view-v3-design.md CLAUDE.md README.md
git commit -m "docs(graph): record v3 measurements, tuned constants and the near-drill invariants"
```

- [ ] **Step 7: 利用者に報告する**

次を伝える（公開はしない）:

- 実測値（収まるまでの時間、1 フレームの最長時間。デスクトップの Chromium、CPU 4 倍。iPhone では未計測）。
- 起動のリクエスト数が 48 件のままであること、起動ファイルの増加（`home.js`・`css/app.css` などの増えたバイト数を `git diff --stat main` と `wc -c` で出す）。
- Service Worker の install で新しく取るファイル（`vendor/` の 4 本、`src/graph-force.js`、`src/graph-near.js`）の合計バイト数。
- 実機（iPhone）での確認と公開（`python3 upload.py -n` で内容を確認してから）は、利用者の判断で行うこと。
