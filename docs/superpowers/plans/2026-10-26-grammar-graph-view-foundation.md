# 文法グラフビュー(基盤)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解いた履歴が反映され、苦手・間違えた問題・共通文法概念・Trapが赤く見える文法フルナレッジグラフビューを、既存アプリに「グラフ」タブとして追加する。

**Architecture:** `/Users/reiji/projects/English_study`（Obsidian Vault）の13普遍文法概念・12Trap・問題リンクと、既存の `RAW_GRAMMAR` からクロスリファレンスグラフ(`GRAMMAR_GRAPH`)を手元のスクリプトで生成してコミットする。ノードの状態計算(`mastery.js`)と表示用の絞り込み(`graph-filter.js`)は DOM に依存しない純粋関数にして Node でテストする。描画(`graph-view.js`)は SVG + 同梱した d3-force で、`window.GraphView` だけを公開し `index.html` の `state` には触れない。

**Tech Stack:** 静的 HTML / 素の JS(ビルドなし)、d3-force 3.0.0(同梱)、Node 22 の `node --test`、Playwright(事前導入済み)での手動 E2E。

**Spec:** `docs/superpowers/specs/2026-10-26-grammar-graph-view-foundation-design.md`

## Global Constraints

- 静的 HTML のまま。サーバなし、ビルドなし。`sw.js` のオフライン動作を壊さない。
- スマホ幅を基準に設計し、PC でも使える。
- 既存の単語ドリル・文法ドリルの画面と動作は変えない。
- d3-force(と依存の d3-dispatch / d3-quadtree / d3-timer)は `vendor/` に同梱する。CDN は使わない。
- 新しい localStorage の記録を作らない。バックアップ形式(`BACKUP_FORMAT`)は変えない。グラフビューは `grammarStats` と `grammarWeakData` を読むだけ。
- `GRAMMAR_GRAPH` の `version` は `2`。ノード `kind` は `'root' | 'category' | 'rule' | 'concept' | 'trap' | 'question'`、エッジ `kind` は `'parent' | 'concept' | 'trap'`。
- ノード ID: `book:<book>` / `cat:<book>:<ch>` / `rule:kin:<num>` / `rule:sekai:<ch>:<seq>` / `con:<概念名>` / `trap:<num>` / `q:<id>`。
- 総ノード数: 469（root 2、category 21、rule 120、concept 13、trap 12、question 301）。
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
| `tools/build_grammar_graph.mjs`(新規) | `RAW_GRAMMAR` + Vault → `GRAMMAR_GRAPH`。CLI で `data/grammar_graph.js` を書き出す |
| `data/grammar_graph.js`(生成) | `const GRAMMAR_GRAPH = {...};` |
| `js/mastery.js`(新規) | ノードごとの理解度の計算(純粋関数) |
| `js/graph-filter.js`(新規) | 本・苦手・表示モードの絞り込み(純粋関数) |
| `js/graph-view.js`(新規) | `window.GraphView`。SVG 描画、物理配置、操作、シート |
| `vendor/`(新規) | d3-force と依存 3 つの UMD ミニファイ版、ライセンス、出典メモ |
| `tests/*.test.mjs`(新規) | 純粋関数・生成物・同梱物のテスト |
| `tests/e2e/graph-view.e2e.mjs`(新規) | ブラウザでの手動 E2E(`node --test` の対象外) |
| `index.html`、`sw.js`、`upload.py`(変更) | タブ追加、読み込み、キャッシュ・配信一覧 |

---

### Task 1: グラフ生成スクリプトと生成物

**Files:**
- Create: `tools/build_grammar_graph.mjs`、`data/grammar_graph.js`(生成)
- Test: `tests/build_graph.test.mjs`

**Interfaces:**
- Produces:
  - `buildGraph(rawQuestions, vaultData): { version: 2, nodes: Node[], edges: Edge[] }`(`export`)
  - `serializeGraph(graph): string` — `const GRAMMAR_GRAPH = ...;\n` を返す。1 ノード・1 エッジを 1 行にする
  - `loadRawGrammar(path: string): Array<Question>` — `data/grammar.js` から `RAW_GRAMMAR` を取得
  - `loadVaultData(vaultPath: string): { concepts: Map, traps: Map, questionLinks: Map }` — `English_study` から 13 概念、12 Trap、各問題のリンク情報を取得
  - CLI: `node tools/build_grammar_graph.mjs` で `data/grammar_graph.js` を書き出す
  - `Node = { id, label, kind, book, qids, desc, advice }`、`Edge = { s, t, kind }`

- [ ] **Step 1: 失敗するテストを書く** — `tests/build_graph.test.mjs`
  - `loadRawGrammar('data/grammar.js')` と Vault データを `buildGraph` に渡して検証。
  - `ノードIDは一意` / `すべてのエッジの端点が存在する`
  - `301問が1回ずつ含まれる`: `kind === 'question'` のノード数が 301。
  - `ノード総数は469`: root 2、category 21、rule 120(金 82 + 世界一 38)、concept 13、trap 12、question 301。
  - `13の普遍文法概念ノードが存在`: `con:SVOC（文の骨格）` 等があり、`qids` に該当問題が含まれる。
  - `12のTrapノードが存在`: `trap:1` 等があり、`advice` を持ち、該当問題が含まれる。
  - `全問が概念にリンクされている`: `edges.filter(e => e.kind === 'concept')` の始点ユニーク数が 301。
  - `145問がTrapにリンクされている`: `edges.filter(e => e.kind === 'trap')` の始点ユニーク数が 145。
  - `複数の章にまたがるルール(金のルール30)`: `rule:kin:30` の親 category エッジが 3 本。
  - `決定的`: `serializeGraph(buildGraph(...))` を 2 回呼んで完全一致。
- [ ] **Step 2: 失敗を確認する** — `node --test tests/build_graph.test.mjs` が FAIL。
- [ ] **Step 3: 実装** — `tools/build_grammar_graph.mjs` を作成。`English_study` の `00_Concepts`, `04_Traps`, `03_Questions` を読み込み、`RAW_GRAMMAR` と統合してノード・エッジを生成。
- [ ] **Step 4: テストが通ることを確認する** — `node --test tests/build_graph.test.mjs` が PASS。
- [ ] **Step 5: 生成物を作る** — `node tools/build_grammar_graph.mjs` を実行して `data/grammar_graph.js` を出力。ノード数 469 を確認。
- [ ] **Step 6: コミット** — `feat: 文法ナレッジグラフ生成スクリプトとデータを追加`

---

### Task 2: 理解度の計算(`mastery.js`)

**Files:**
- Create: `js/mastery.js`
- Test: `tests/mastery.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `GRAMMAR_GRAPH` の形
- Produces:
  - `computeNodeStates(graph, stats, weak, now = Date.now()): { [nodeId]: NodeState }`
  - `NodeState = { total, answered, correct, weak, due, rate, state }`、`state` は `'unseen'|'few'|'weak'|'due'|'mid'|'good'`
  - `THRESHOLDS = { few: 3, weakRate: 0.6, goodRate: 0.8 }`
  - 読み込み: `window.Mastery` / `module.exports`。

- [ ] **Step 1: 失敗するテストを書く** — `tests/mastery.test.mjs`
  - `記録が空なら全ノードが unseen`(`answered === 0`、`rate === 0.5`)
  - `解答数0/2/3の境界`: `{a:2,c:0}` は `few`、`{a:3,c:0}` は `weak`
  - `rateの境界`: `{a:3,c:2}` は `mid`、`{a:3,c:3}` は `good`
  - `期限切れの苦手があれば due`、`期限前の苦手は weak`
  - `親ノードは配下の問題を合算する`
  - `普遍概念ノード(concept)とTrapノードも自身のqidsに基づき正しく状態計算される`: 「受動態」に属する世界一と金の文法の問題で間違えた場合、概念ノードが `weak` / `due` になる。
  - `二重カウント防止`: 複数経路（階層エッジと概念エッジ）があっても、同一問題は 1 回だけ数える。
  - **(Review Focus 1)** `グラフに無い問題IDがあっても無視` / `記録に無い問題はanswered 0` / `c > a でも rate <= 1.0`
- [ ] **Step 2: 失敗を確認する** — `node --test tests/mastery.test.mjs` が FAIL。
- [ ] **Step 3: 実装** — `js/mastery.js` を実装。`qids` を持つノード（`rule`, `concept`, `trap`, `question`）および上位ノード（`category`, `root`）について、配下問題の集合を `Set` でまとめて `stats` と `weak` を合算。
- [ ] **Step 4: 通過を確認する** — `node --test tests/mastery.test.mjs` が PASS。
- [ ] **Step 5: コミット** — `feat: 文法ノードの理解度計算を追加`

---

### Task 3: d3-force の同梱

**Files:**
- Create: `vendor/d3-dispatch.min.js`、`vendor/d3-quadtree.min.js`、`vendor/d3-timer.min.js`、`vendor/d3-force.min.js`、`vendor/README.md`
- Test: `tests/vendor.test.mjs`

**Interfaces:**
- Produces: グローバル `d3` に `forceSimulation`、`forceLink`、`forceManyBody`、`forceCenter`、`forceCollide`。

- [ ] **Step 1: 失敗するテストを書く** — `tests/vendor.test.mjs`
  - `node:vm` で 4 ファイルを順に評価し、`d3.forceSimulation` が正しく動作すること。
  - `README.md` に ISC ライセンス表示があること。
- [ ] **Step 2: 失敗を確認する** — FAIL。
- [ ] **Step 3: 取得して配置する** — npm から取得し `vendor/` に配置。`README.md` 作成。
- [ ] **Step 4: 通過を確認する** — PASS。
- [ ] **Step 5: コミット** — `chore: d3-force を vendor に同梱`

---

### Task 4: 表示用の絞り込み(`graph-filter.js`)

**Files:**
- Create: `js/graph-filter.js`
- Test: `tests/graph-filter.test.mjs`

**Interfaces:**
- Consumes: Task 2 の `NodeState`
- Produces:
  - `filterGraph(graph, states, opts): { nodes: Node[], edges: Edge[] }`
  - `opts = { book: 'all'|'sekai'|'kin', weakOnly: boolean, showQuestions: boolean, viewMode: 'all'|'hierarchy'|'concept'|'trap' }`
  - 読み込み: `window.GraphFilter` / `module.exports`。

- [ ] **Step 1: 失敗するテストを書く** — `tests/graph-filter.test.mjs`
  - `book: 'all' なら全ノード`
  - `book: 'kin' なら kin のノードおよび本を跨ぐ概念・Trapノードが残る`
  - `showQuestions: false なら question ノードが除外される`
  - `weakOnly: true なら state が weak / due のノードとその接続先だけが残る`
  - `viewMode: 'concept' なら概念ノードと関連問題・ルールが中心に残る`
  - `viewMode: 'trap' ならTrapノードと関連問題が中心に残る`
  - **(Review Focus 2)** `weakOnly: true で該当 0 件なら空配列を返す`
- [ ] **Step 2: 失敗を確認する** — FAIL。
- [ ] **Step 3: 実装** — `js/graph-filter.js` を実装。
- [ ] **Step 4: 通過を確認する** — PASS。
- [ ] **Step 5: コミット** — `feat: グラフの絞り込み関数を追加`

---

### Task 5: グラフビュー ① 描画・物理配置・色

**Files:**
- Create: `js/graph-view.js`、`tests/e2e/graph-view.e2e.mjs`

**Interfaces:**
- Consumes: `window.d3`、`window.Mastery`、`window.GraphFilter`
- Produces: `window.GraphView = { mount(container, opts), refresh(), destroy() }`
  - DOM: `.gv-root`, `.gv-svg`, `circle.gv-node[data-id][data-kind]`, `line.gv-edge[data-kind]`, `text.gv-label`
  - スタイル: `<style id="gv-style">`。CSS 変数連動。

- [ ] **Step 1: E2E の土台と検証を書く** — `tests/e2e/graph-view.e2e.mjs`
  - Playwright によるブラウザ検証。
  - 初期表示で 469 ノードのうち主要ノードが描画される。
  - 苦手問題がある場合、該当する概念ノードおよび Trap ノードが `s-due` / `s-weak` の赤色になる。
  - **(Review Focus 4)** テーマ変更時に `fill` が追従すること。
  - **(Review Focus 5)** XSS 対策（`<img onerror>` ラベルの無害化）。
- [ ] **Step 2: 実装** — `js/graph-view.js` の描画・力学配置（`d3.forceSimulation`）を実装。
  - `concept` は二重リング、`trap` は破線リング、`rule`・`category`・`question` のサイズ分け。
- [ ] **Step 3: 通過を確認する** — PASS。
- [ ] **Step 4: コミット** — `feat: グラフビューの描画と色分けを追加`

---

### Task 6: グラフビュー ② パン・ズーム・ドラッグ・段階表示

**Files:**
- Modify: `js/graph-view.js`、`tests/e2e/graph-view.e2e.mjs`

- [ ] **Step 1: 失敗する検証を追記する**
  - 拡大で `question` が出現し、縮小で大概念のみになる LOD 動作。
  - ドラッグによるパン、ノードドラッグの追従。
- [ ] **Step 2: 実装** — Pointer Events によるパン・ズーム・ドラッグと LOD 段階表示。
- [ ] **Step 3: 通過を確認する** — PASS。
- [ ] **Step 4: コミット** — `feat: グラフビューにパン・ズーム・ドラッグを追加`

---

### Task 7: グラフビュー ③ 詳細シートと絞り込み UI

**Files:**
- Modify: `js/graph-view.js`、`tests/e2e/graph-view.e2e.mjs`

- [ ] **Step 1: 失敗する検証を追記する**
  - ノードタップで `.gv-sheet.open`。
  - 概念ノードタップ時に解説文（`desc`）と横断問題一覧が表示される。
  - Trap ノードタップ時に解説文と対策アドバイス（`advice`）が表示される。
  - ツールバーによる本切替、表示モード切替（概念/Trap/全体）、苦手トグル。
- [ ] **Step 2: 実装** — 詳細シートおよびツールバーの実装。
- [ ] **Step 3: 通過を確認する** — PASS。
- [ ] **Step 4: コミット** — `feat: グラフビューに詳細シートと絞り込みを追加`

---

### Task 8: `index.html` への統合と配信ファイルの更新

**Files:**
- Modify: `index.html`、`sw.js`、`upload.py`、`tests/e2e/graph-view.e2e.mjs`

- [ ] **Step 1: 失敗する検証を追記する** — 実アプリの「グラフ」タブクリックによる起動、既存単語/文法ドリルとの相互切替。
- [ ] **Step 2: `index.html` を変更する**
  - タブに「グラフ」追加、コンテナ追加、スクリプト読み込み追加。
  - `setApp('graph')` の制御。
- [ ] **Step 3: `sw.js` と `upload.py` の更新** — 新規 8 ファイル（graph, mastery, filter, view, vendor 4 つ）をキャッシュ・配信対象に追加。
- [ ] **Step 4: 通過を確認する** — E2E が PASS。
- [ ] **Step 5: コミット** — `feat: グラフタブを追加し配信ファイルに登録`

---

### Task 9: 最終確認

**Files:** なし

- [ ] **Step 1: 全テスト** — `node --test tests/*.test.mjs` が全 PASS。
- [ ] **Step 2: E2E** — `node tests/e2e/graph-view.e2e.mjs` が全 PASS。
- [ ] **Step 3: 完成基準の確認** — オフライン動作、赤色反映、シート内容、スマホ幅パフォーマンス。
- [ ] **Step 4: 配信物確認** — `upload.py` / `sw.js` と実在ファイルの一致。
- [ ] **Step 5: スクリーンショット** — 通常時と苦手データありの画面を確認。
- [ ] **Step 6: プッシュ** — `git push -u origin claude/friendly-bohr-lwlh2r`。
