# 文法グラフビュー(基盤)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解いた履歴が反映され、苦手・間違えた問題が赤く見える文法グラフビューを、既存アプリに「グラフ」タブとして追加する。

**Architecture:** 既存の `RAW_GRAMMAR` から階層グラフ(`GRAMMAR_GRAPH`)を手元のスクリプトで生成してコミットする。ノードの状態計算(`mastery.js`)と表示用の絞り込み(`graph-filter.js`)は DOM に依存しない純粋関数にして Node でテストする。描画(`graph-view.js`)は SVG + 同梱した d3-force で、`window.GraphView` だけを公開し `index.html` の `state` には触れない。

**Tech Stack:** 静的 HTML / 素の JS(ビルドなし)、d3-force 3.0.0(同梱)、Node 22 の `node --test`、Playwright(事前導入済み)での手動 E2E。

**Spec:** `docs/superpowers/specs/2026-10-26-grammar-graph-view-foundation-design.md`

## Global Constraints

- 静的 HTML のまま。サーバなし、ビルドなし。`sw.js` のオフライン動作を壊さない。
- スマホ幅を基準に設計し、PC でも使える。
- 既存の単語ドリル・文法ドリルの画面と動作は変えない。
- d3-force(と依存の d3-dispatch / d3-quadtree / d3-timer)は `vendor/` に同梱する。CDN は使わない。
- 新しい localStorage の記録を作らない。バックアップ形式(`BACKUP_FORMAT`)は変えない。グラフビューは `grammarStats` と `grammarWeakData` を読むだけ。
- `GRAMMAR_GRAPH` の `version` は `1`。ノード `kind` は `'root' | 'category' | 'concept' | 'question'`、エッジ `kind` は `'parent' | 'related'`(今回 `related` は出力しない)。
- ノード ID: `book:<book>` / `cat:<book>:<ch>` / `con:kin:<rule.number>` / `con:sekai:<ch>:<連番>` / `q:<id>`。
- `state` の閾値: 解答数 3 未満は `few`、`rate < 0.6` で `weak`、`rate >= 0.8` かつ苦手 0 で `good`。`rate = (correct + 1) / (answered + 2)`。
- 配信物に含めるのは `index.html`、`sw.js`、`upload.py` の一覧に載るファイルのみ。`tools/`、`tests/`、`docs/` は配信しない。
- コミットメッセージの末尾に次の 2 行を付ける(空行を挟む):
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_01DoH7jwftbmCAEgcGCdLycK`
- テストの実行コマンドは `node --test tests/*.test.mjs`。

## Review Focus

仕様が暗に前提としているが、どのタスクのテストも直接は扱っていない入力・状況のうち、使う人に影響しやすいもの。各行のテストは、担当タスクに入れてある。

1. 記録(`stats` / `weak`)にグラフに無い問題 ID がある、またはグラフにある問題が記録に無い(データ追加・削除後の端末)。クラッシュせず、無い分は未着手として扱う。→ Task 2
2. 初回起動で記録が空、または「苦手だけ」で該当ノードが 0 件。真っ白にならず、全部灰色で出る / 「苦手はありません」と表示する。→ Task 4、Task 7
3. グラフタブを何度も出入りする。シミュレーションや購読が増え続けず、エラーも出ない。→ Task 8
4. グラフ表示中にテーマ(`data-theme`)を切り替える。色が JS に固定されず、再描画なしで追従する。→ Task 5
5. ラベルに `<` や `&` を含む文字がある。HTML として解釈されず、そのまま表示される。→ Task 5

---

## File Structure

| ファイル | 責務 |
|---|---|
| `tools/build_graph_from_questions.mjs`(新規) | `RAW_GRAMMAR` → `GRAMMAR_GRAPH`。CLI で `data/grammar_graph.js` を書き出す |
| `data/grammar_graph.js`(生成) | `const GRAMMAR_GRAPH = {...};` |
| `js/mastery.js`(新規) | ノードごとの理解度の計算(純粋関数) |
| `js/graph-filter.js`(新規) | 本・苦手・問題表示の絞り込み(純粋関数) |
| `js/graph-view.js`(新規) | `window.GraphView`。SVG 描画、物理配置、操作、シート |
| `vendor/`(新規) | d3-force と依存 3 つの UMD ミニファイ版、ライセンス、出典メモ |
| `tests/*.test.mjs`(新規) | 純粋関数・生成物・同梱物のテスト |
| `tests/e2e/graph-view.e2e.mjs`(新規) | ブラウザでの手動 E2E(`node --test` の対象外) |
| `index.html`、`sw.js`、`upload.py`(変更) | タブ追加、読み込み、キャッシュ・配信一覧 |

仕様書は `mastery.js` と `graph-view.js` の 2 ファイルを挙げているが、絞り込みを純粋関数として Node でテストするため `graph-filter.js` を 1 つ足す。Task 1 の中で、仕様書のファイル一覧にも反映する。

---

### Task 1: 仮グラフの生成スクリプトと生成物

**Files:**
- Create: `tools/build_graph_from_questions.mjs`、`data/grammar_graph.js`(生成)
- Test: `tests/build_graph.test.mjs`
- Modify: `docs/superpowers/specs/2026-10-26-grammar-graph-view-foundation-design.md`(2 節・6 節に `js/graph-filter.js` を追記)

**Interfaces:**
- Produces:
  - `buildGraph(raw: Array<Question>): { version: 1, nodes: Node[], edges: Edge[] }`(`export`)
  - `serializeGraph(graph): string` — `const GRAMMAR_GRAPH = ...;\n` を返す。1 ノード・1 エッジを 1 行にする(差分が読める)
  - `loadRawGrammar(path: string): Array<Question>` — `data/grammar.js` を `new Function` で評価して `RAW_GRAMMAR` を返す
  - CLI: `node tools/build_graph_from_questions.mjs` で `data/grammar_graph.js` を書く
  - `Node = { id, label, kind, book, qids }`、`Edge = { s, t, kind }`(仕様書 3 節)

- [ ] **Step 1: 失敗するテストを書く** — `tests/build_graph.test.mjs`
  - `loadRawGrammar('data/grammar.js')` の結果を `buildGraph` に渡して、次の `test` を並べる。
  - `ノードIDは一意` / `すべてのエッジの端点が存在する` / `question以外のすべてのノードが root から parent で到達できる`
  - `301問が1回ずつ含まれる`: `kind === 'question'` のノード数が 301 で、`qids` の和集合が `RAW_GRAMMAR` の ID と一致する。
  - `ノード数の内訳`: root 2、category 21、concept 120(金 82 + 世界一 38)、question 301(2 冊の実データ)。
  - `金の文法の concept は rule.number ごと`: `con:kin:1` が存在し、`label` は `品詞問題では、主語には名詞を選ぶ。`、`qids` に `1001` を含む。
  - `世界一の concept ID は章内の出現順の連番`: `con:sekai:1:1` が存在し、`label` は `受動態の変形パターン`。
  - `複数の章にまたがるルールは、章ごとに親エッジを持つ`: 実データでは金のルール 30 だけが章 1・3・7 に問題を持つので、`con:kin:30` を終点とする `parent` エッジが 3 本(`cat:kin:1`、`cat:kin:3`、`cat:kin:7` から)。他の concept は親が 1 本。
  - `決定的`: `serializeGraph(buildGraph(raw))` を 2 回呼んで同一文字列。
  - `金の問題に rule が無いと異常終了する`: `rule` を欠いた金の問題を 1 件含む配列で `buildGraph` が例外を投げる。
  - `同じルール番号でタイトルが食い違うと例外`。
- [ ] **Step 2: 失敗を確認する** — `node --test tests/build_graph.test.mjs` が「`buildGraph` が無い」で FAIL。
- [ ] **Step 3: 実装** — 仕様書 3 節「仮グラフの生成規則」のとおり。本の判定は `q.b || 'sekai'`。出力順は root → category(本・章昇順)→ concept(金は番号昇順、世界一は章・連番昇順)→ question(ID 昇順)。エッジは親 → 子の `parent`。金の concept の親 category は、そのルールに属する問題の `ch` の種類ごとに 1 本ずつ張る(重複は 1 本にまとめる)。
- [ ] **Step 4: テストが通ることを確認する** — 同じコマンドで PASS。
- [ ] **Step 5: 生成物を作る** — `node tools/build_graph_from_questions.mjs` を実行して `data/grammar_graph.js` を作る。続けて `node -e "const s=require('fs').readFileSync('data/grammar_graph.js','utf8'); const g=new Function(s+';return GRAMMAR_GRAPH;')(); console.log(g.nodes.length, g.edges.length)"` を実行し、ノード数が 444 であることを確認する。
- [ ] **Step 6: 仕様書に `js/graph-filter.js` を追記する**(2 節の「含む」と 6 節の配信物)。
- [ ] **Step 7: コミット** — `feat: 文法グラフの仮データ生成スクリプトを追加`

---

### Task 2: 理解度の計算(`mastery.js`)

**Files:**
- Create: `js/mastery.js`
- Test: `tests/mastery.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `GRAMMAR_GRAPH` の形(テストでは小さな手書きグラフを使う)
- Produces:
  - `computeNodeStates(graph, stats, weak, now = Date.now()): { [nodeId]: NodeState }`
  - `NodeState = { total, answered, correct, weak, due, rate, state }`、`state` は `'unseen'|'few'|'weak'|'due'|'mid'|'good'`
  - `THRESHOLDS = { few: 3, weakRate: 0.6, goodRate: 0.8 }`
  - 読み込み: ブラウザでは `window.Mastery = { computeNodeStates, THRESHOLDS }`、Node では `module.exports` に同じもの(ファイル末尾の `typeof module` 分岐)。テストは `import Mastery from '../js/mastery.js'` で読む。

- [ ] **Step 1: 失敗するテストを書く** — 手書きのグラフ(root → category → concept → question 3〜4 個)で次の `test` を並べる。`now` は固定値を渡す。
  - `記録が空なら全ノードが unseen`(`answered === 0`、`rate === 0.5`)
  - `解答数0/2/3の境界`: `{a:2,c:0}` は `few`、`{a:3,c:0}` は `weak`(rate = 0.2 < 0.6)
  - `rateの境界`: `{a:3,c:2}` は rate = 0.6 で `mid`、`{a:3,c:3}` は rate = 0.8 で `good`
  - `期限切れの苦手があれば due`: `weak[qid] = {streak:0, added:0, due: now - 1}` なら親ノードも `due`、`due` カウント 1
  - `期限前の苦手は weak`: `due: now + 1000` なら `weak` で `due` カウント 0
  - `due は weak より優先、weak は few より優先`(解答数 2 でも苦手に入っていれば `weak`)
  - `親ノードは配下を合算する`(`answered`、`correct`、`weak`、`total`)
  - `同じ問題が複数経路から届いても1回しか数えない`(1 つの concept が 2 つの category を親に持つグラフ。実データでは金のルール 30 がこの形で、上位の category や root から見ても、その問題を 1 回だけ数える)
  - **(Review Focus 1)** `グラフに無い問題IDが記録にあっても無視する` / `記録に無い問題はanswered 0として扱う` / `stats の c が a を超える壊れた値でも rate が 1 を超えない`
  - `question ノード自身も同じ規則で判定される`
- [ ] **Step 2: 失敗を確認する** — `node --test tests/mastery.test.mjs` が FAIL。
- [ ] **Step 3: 実装** — `parent` エッジをたどって各ノードの配下の `question` の ID を `Set` で集め(メモ化)、`stats` / `weak` を合算する。判定の順序は仕様書 4 節の表どおり(`unseen` → `due` → `weak`〔`weak > 0 || (answered >= 3 && rate < 0.6)`〕→ `few` → `good` → `mid`)。
- [ ] **Step 4: 通過を確認する** — 同じコマンドで PASS。
- [ ] **Step 5: コミット** — `feat: 文法ノードの理解度計算を追加`

---

### Task 3: d3-force の同梱

**Files:**
- Create: `vendor/d3-dispatch.min.js`、`vendor/d3-quadtree.min.js`、`vendor/d3-timer.min.js`、`vendor/d3-force.min.js`、`vendor/README.md`
- Test: `tests/vendor.test.mjs`

**Interfaces:**
- Produces: 4 ファイルを上記の順に読み込むと、グローバル `d3` に `forceSimulation`、`forceLink`、`forceManyBody`、`forceCenter`、`forceCollide` が生える。

- [ ] **Step 1: 失敗するテストを書く** — `tests/vendor.test.mjs`
  - `4ファイルを順に読み込むと d3.forceSimulation が使える`: `node:vm` の新しいコンテキストで 4 ファイルを順に評価し、`d3.forceSimulation` が関数で、`forceSimulation([{}, {}]).stop().tick()` が例外なく動く。
  - `ライセンス表記が README に残っている`(`ISC` を含む)。
- [ ] **Step 2: 失敗を確認する** — ファイルが無いので FAIL。
- [ ] **Step 3: 取得して配置する** — `npm pack d3-force@3.0.0 d3-dispatch@3.0.1 d3-quadtree@3.0.1 d3-timer@3.0.1` を作業用ディレクトリ(リポジトリの外)で実行し、各 tgz の `package/dist/<name>.min.js` を `vendor/` に置く。`vendor/README.md` に、パッケージ名とバージョン、取得元(npm)、ライセンス(ISC)と元の著作権表示、更新手順(同じコマンド)を書く。
- [ ] **Step 4: 通過を確認する** — `node --test tests/vendor.test.mjs` が PASS。
- [ ] **Step 5: コミット** — `chore: d3-force を vendor に同梱`

---

### Task 4: 表示用の絞り込み(`graph-filter.js`)

**Files:**
- Create: `js/graph-filter.js`
- Test: `tests/graph-filter.test.mjs`

**Interfaces:**
- Consumes: Task 2 の `NodeState` の形(`states[nodeId].state`)
- Produces:
  - `filterGraph(graph, states, opts): { nodes: Node[], edges: Edge[] }`
  - `opts = { book: 'all'|'sekai'|'kin', weakOnly: boolean, showQuestions: boolean }`
  - 読み込み方法は `mastery.js` と同じ(`window.GraphFilter` / `module.exports`)。

- [ ] **Step 1: 失敗するテストを書く** — 手書きの 2 冊分のグラフと `states` で次の `test` を並べる。
  - `book: 'all' なら全ノード`
  - `book: 'kin' なら book が 'kin' のノードと book が null のノードだけが残る`
  - `showQuestions: false なら question ノードと、その端点を持つエッジが消える`
  - `weakOnly: true なら state が weak / due のノードと、その祖先だけが残る`(`rate < 0.6` だけで weak になった concept の子の question が `good` なら、その question は残らない)
  - `weakOnly の祖先は parent エッジをたどって root まで残る`
  - `エッジは両端がともに残るものだけ`
  - **(Review Focus 2)** `weakOnly: true で該当 0 件なら nodes も edges も空配列(例外なし)`
  - `入力のグラフを書き換えない`(`Object.freeze` した入力でも動く)
- [ ] **Step 2: 失敗を確認する** — FAIL。
- [ ] **Step 3: 実装** — 3 つの条件を順に適用する。`weakOnly` の祖先は逆向きの隣接表を作ってたどる。
- [ ] **Step 4: 通過を確認する** — `node --test tests/graph-filter.test.mjs` が PASS。
- [ ] **Step 5: コミット** — `feat: グラフの絞り込み関数を追加`

---

### Task 5: グラフビュー ① 描画・物理配置・色

**Files:**
- Create: `js/graph-view.js`、`tests/e2e/graph-view.e2e.mjs`(以降のタスクで追記する)

**Interfaces:**
- Consumes: `window.d3`(Task 3)、`window.Mastery.computeNodeStates`(Task 2)、`window.GraphFilter.filterGraph`(Task 4)
- Produces: `window.GraphView = { mount(container, opts), refresh(), destroy() }`
  - `opts = { graph, getStats: () => object, getWeak: () => object, getQuestion: (qid:number) => object|undefined }`
  - DOM の契約(E2E と後続タスクが使う):
    - ルート `.gv-root`(`container` の中に作る)
    - SVG `.gv-svg`
    - ノード `circle.gv-node[data-id][data-kind]` に状態クラス `s-unseen|s-few|s-weak|s-due|s-mid|s-good`
    - エッジ `line.gv-edge`
    - ラベル `text.gv-label[data-id]`
  - スタイルは `graph-view.js` が `<style id="gv-style">` を 1 度だけ `document.head` に注入する。色は既存の CSS 変数(`--correct`、`--wrong`、`--accent`、`--ui-border`、`--muted`)に、`s-few` 用の薄い青をフォールバック付きで足して使い、JS に色を直書きしない。

- [ ] **Step 1: E2E の土台と、失敗する検証を書く** — `tests/e2e/graph-view.e2e.mjs`
  - `createRequire` で `playwright` を読み込み、`python3 -m http.server`(ポートは空きを探す)をリポジトリ直下で起動する。ページは `http://localhost:<port>/index.html`。終了時に必ずサーバを止める。
  - ヘルパー: `seed(page, {stats, weak})`(`addInitScript` で `toeic_grammar_stats` / `toeic_weak_grammar` に書き込む)、`openGraph(page)`(Task 8 までは `page.evaluate` で `GraphView.mount(document.body の div, ...)` を直接呼ぶ。Task 8 で本物のタブ操作に置き換える)。
  - 検証:
    - 記録が空のとき `.gv-node` が描画され、すべて `s-unseen`。
    - `1001` に `{a:3,c:0}` と期限切れの苦手を入れると、`[data-id="q:1001"]` が `s-due`、その祖先の `con:kin:1`、`cat:kin:1`、`book:kin` も `s-due`、別の本の `book:sekai` は `s-unseen` のまま。
    - **(Review Focus 4)** `document.documentElement` の `data-theme` を別の値に変えると、再描画なしで `s-due` ノードの `getComputedStyle().fill` が変わる。
    - **(Review Focus 5)** ラベルに `<img src=x onerror=...>` を持つノードを足したグラフで `mount` しても、`img` 要素は生成されず、ラベルがそのままの文字列で表示される。
  - 実行: `node tests/e2e/graph-view.e2e.mjs` が、`GraphView` 未定義で FAIL する。
- [ ] **Step 2: 実装** — `mount` / `refresh` / `destroy` を作る。
  - 描画: `kind` ごとに半径を決める(`question` は小、配下の問題数が多い `concept` ほど大)。
  - 配置: `d3.forceSimulation` に `forceLink`(距離は `root–category` 90、`category–concept` 50、`concept–question` 18)、`forceManyBody`(`root`/`category` は強く、`question` は弱く)、`forceCenter`、`forceCollide(半径 + 2)`。最初の描画の前に `simulation.tick(120)` を同期で回して初期の暴れを抑え、`end` イベントで停止する。
  - `question` とラベルは `<text>` の `textContent` で入れる(HTML を使わない)。
  - 初期状態: `question` ノードは非表示(`showQuestions: false`)。`filterGraph` の結果だけを描画する。
  - `refresh()` は状態を再計算してクラスだけを付け替える(再配置しない)。
  - `destroy()` は `simulation.stop()` とイベント購読の解除、DOM の削除を行う。
- [ ] **Step 3: 通過を確認する** — E2E が PASS(出力に `PASS` と各検証名が出る)。
- [ ] **Step 4: コミット** — `feat: グラフビューの描画と色分けを追加`

---

### Task 6: グラフビュー ② パン・ズーム・ドラッグ・段階表示

**Files:**
- Modify: `js/graph-view.js`、`tests/e2e/graph-view.e2e.mjs`

**Interfaces:**
- Consumes: Task 5 の DOM の契約
- Produces: ルート `.gv-root` に `data-zoom="<数値>"` を持たせる(E2E 用に現在の拡大率を反映する)。拡大率の範囲は `[0.3, 8]`。定数 `LABEL_ZOOM = 1.2`、`QUESTION_ZOOM = 1.6`。

- [ ] **Step 1: 失敗する検証を追記する**
  - ホイールで拡大すると `data-zoom` が増え、`QUESTION_ZOOM` を超えると `[data-kind="question"]` が表示され(数が 301 になる)、下回ると消える。
  - `LABEL_ZOOM` 未満では `concept` のラベルが無く、以上で出る(`category` / `root` のラベルは常に出る)。
  - 背景のドラッグでパンする(ノードの画面上の位置が動き、ノード同士の相対位置は変わらない)。
  - ノードをドラッグすると、そのノードの位置が動き、リンクしているノードの位置も変わる。
  - **(Review Focus 4 の補足)** ビューポートを 360×640 から 800×600 に変えてもノードが描画領域内に残り、水平スクロールが生じない(`document.documentElement.scrollWidth <= innerWidth`)。
  - 実行して FAIL を確認する。
- [ ] **Step 2: 実装** — Pointer Events で、1 本指のドラッグ(ノード上ならノードを移動、背景ならパン)、2 本指のピンチ、ホイールのズームを実装する。ズームはポインタ位置を中心にする。ノードのドラッグ中は `alphaTarget(0.3).restart()`、離したら `alphaTarget(0)`。`question` が表示されるときは、見た目より広い透明な円(当たり判定)を重ねて、小さな点でもタップしやすくする。`destroy()` で、追加した全リスナーを解除する。
- [ ] **Step 3: 通過を確認する** — E2E が PASS。
- [ ] **Step 4: コミット** — `feat: グラフビューにパン・ズーム・ドラッグを追加`

---

### Task 7: グラフビュー ③ 詳細シートと絞り込み UI

**Files:**
- Modify: `js/graph-view.js`、`tests/e2e/graph-view.e2e.mjs`

**Interfaces:**
- Consumes: Task 4 の `filterGraph`、Task 5 の `opts.getQuestion`
- Produces: DOM の契約
  - ツールバー `.gv-toolbar`: 本の切り替え `[data-gv-book="all|sekai|kin"]`、苦手トグル `[data-gv-weak]`、凡例 `.gv-legend`(6 状態の色と名前)
  - シート `.gv-sheet`(開いているとき `.open`)、閉じるボタン `.gv-sheet-close`
  - 空表示 `.gv-empty`(表示するノードが 0 件のとき)

- [ ] **Step 1: 失敗する検証を追記する**
  - ノードをタップすると `.gv-sheet.open` になり、ノード名、状態の日本語表示、正答率(解答数 0 のときは `—`)、解答数、苦手数、配下の問題の一覧が出る。問題の行には問題文の先頭 40 字と、正誤の状態がある。
  - `Esc`、`.gv-sheet-close`、シート外のタップのどれでも閉じる。
  - 本の切り替えで、選んだ本以外のノードが消える。
  - **(Review Focus 2)** 記録が空のまま苦手トグルを入れると `.gv-empty` が出て、文言に `苦手はありません` を含む。記録がある状態では、赤いノードとその祖先だけが残る。
  - **(Review Focus 5)** 問題文に `<` / `&` を含む問題をシートに出しても、HTML として解釈されない。
  - 実行して FAIL を確認する。
- [ ] **Step 2: 実装** — ツールバーとシートを `mount` で作る。シートの中身は `textContent` / `createElement` で組み立てる(`innerHTML` に文字列を連結しない)。状態の日本語表示は `unseen`=未着手、`few`=データ少、`weak`=苦手、`due`=要復習、`mid`=あと一歩、`good`=得意。絞り込みを変えたら `filterGraph` を再適用して、シミュレーションを作り直さずに表示だけを更新する(位置は保持)。
- [ ] **Step 3: 通過を確認する** — E2E が PASS。
- [ ] **Step 4: コミット** — `feat: グラフビューに詳細シートと絞り込みを追加`

---

### Task 8: `index.html` への統合と配信ファイルの更新

**Files:**
- Modify: `index.html`、`sw.js`、`upload.py`、`tests/e2e/graph-view.e2e.mjs`

**Interfaces:**
- Consumes: `GraphView.mount/destroy`(Task 5〜7)、`GRAMMAR_GRAPH`(Task 1)、既存の `state.grammarStats` / `state.grammarWeakData` / `RAW_GRAMMAR`
- Produces: `data-app="graph"` のセグメントと、`#graph-container`。

- [ ] **Step 1: 失敗する検証を追記する** — Task 5〜7 の `openGraph` を、実際のタブ操作(`[data-app="graph"]` のクリック)に置き換える。追加の検証:
  - 「グラフ」タブをクリックするとグラフが出て、問題カード・選択肢・アクションバー・フッターが非表示になる。
  - **(Review Focus 3)** 単語 → グラフ → 文法 → グラフ → 単語を 10 周しても、`pageerror` / `console.error` が 0 件で、`.gv-root` が常に 1 つ以下、`#gv-style` が 1 つ。
  - 文法ドリルで 1 問間違えてからグラフを開くと、その問題を含むノードが赤い(記録の反映)。
  - グラフからドリルに戻ったあと、単語ドリルと文法ドリルが、タブ追加前と同じように出題・回答できる。
  - ページをリロードしても例外が出ず、(`app` が保存されて `'graph'` が復元されても)単語ドリルで起動する。
  - Service Worker が有効になったあとでオフラインにしてリロードしても、グラフが開く(`context.setOffline(true)`)。
  - 360×640 で CPU を 4 倍に絞り(`Emulation.setCPUThrottlingRate`)、ノードを 2 秒ドラッグしている間の `requestAnimationFrame` 間隔の平均が 50ms 未満。
  - 実行して FAIL を確認する。
- [ ] **Step 2: `index.html` を変更する**
  - `#app-type-segments`(2105 行付近)と `#sheet-app-type-segments`(2179 行付近)の両方に `<div class="segment" data-app="graph">グラフ</div>` を足す。
  - `.main-area` の隣に `<div id="graph-container" style="display:none"></div>` を足す。
  - 既存の `<script src="data/grammar.js">` の後、大きなインライン `<script>` の前に、`vendor/d3-dispatch.min.js`、`vendor/d3-quadtree.min.js`、`vendor/d3-timer.min.js`、`vendor/d3-force.min.js`、`data/grammar_graph.js`、`js/mastery.js`、`js/graph-filter.js`、`js/graph-view.js` をこの順に読み込む。
  - `setApp(app)`(3020 行付近)を拡張する: `app === 'graph'` のとき、タイトルを `グラフ` にし、ルールガイドのリンク・モード切替・単語/文法のフィルタ・`.main-area`・`.action-bar`・`#duo-banner`・`.footer` を隠して `#graph-container` を表示し、`GraphView.mount` を呼んで**セッション復元の前に return** する。グラフから他の app へ移るときは `GraphView.destroy()` を呼び、`#graph-container` を隠して、隠した要素を戻す。`vocab` / `grammar` の既存の分岐は変えない。
  - `restoreSettings`(3662 行付近)の許可リストは変えない。`'graph'` は保存されても復元時に `'vocab'` に落ちる。
  - `state.app` を参照する 8 か所(3150、3318、3326、3365、3623、3701、4163、4229 行付近)を 1 つずつ読み、`graph` のとき(`grammar` でないので単語として扱われる)に例外や、単語の記録の書き換えが起きないことを確認する。問題があれば、`state.app === 'graph'` を早期に return するガードを足す。結果をコミットメッセージの本文に 1 行ずつ書く。
- [ ] **Step 3: `sw.js` の `ASSETS` と `upload.py` の `FILES` に追加する** — `data/grammar_graph.js`、`js/mastery.js`、`js/graph-filter.js`、`js/graph-view.js`、`vendor/d3-dispatch.min.js`、`vendor/d3-quadtree.min.js`、`vendor/d3-timer.min.js`、`vendor/d3-force.min.js`。`tools/`、`tests/`、`docs/` は入れない。
- [ ] **Step 4: 通過を確認する** — `node tests/e2e/graph-view.e2e.mjs` が全項目 PASS。
- [ ] **Step 5: コミット** — `feat: グラフタブを追加し配信ファイルに登録`

---

### Task 9: 最終確認

**Files:** なし(確認のみ。問題があれば該当タスクのファイルを直す)

- [ ] **Step 1: 全テスト** — `node --test tests/*.test.mjs` が全 PASS(出力の `# fail 0` を確認)。
- [ ] **Step 2: E2E** — `node tests/e2e/graph-view.e2e.mjs` が全 PASS。
- [ ] **Step 3: 仕様書の完成基準 6 項目を 1 つずつ確認する** — オフライン表示、赤い表示、シートの内容、テスト通過、スマホ幅の動作、既存ドリルの無変更。E2E のどの検証が対応するかを一覧にして、最終報告に載せる。
- [ ] **Step 4: 配信物の確認** — `git diff --stat db4ec08` で、意図したファイル以外が変わっていないこと、`upload.py` / `sw.js` の一覧と実在ファイルが一致することを確認する(存在しないパスが一覧に無い)。
- [ ] **Step 5: 実機に近い目視** — 360×640 でグラフを開いた画面のスクリーンショットを、通常時と苦手データありの 2 枚、ユーザーに見せる。
- [ ] **Step 6: プッシュ** — `git push -u origin claude/friendly-bohr-lwlh2r`(PR は作らない)。
