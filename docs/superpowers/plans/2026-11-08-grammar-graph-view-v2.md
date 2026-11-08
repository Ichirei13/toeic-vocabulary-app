# 文法グラフビュー v2 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文法 4 冊 983 問を、概念・Trap・ルール・章・本とつないだ「理解度が色で見えるグラフ」として、オフラインで動く Canvas 画面で開けるようにする。

**Architecture:** Vault（Obsidian）から手元のスクリプトでグラフを作り、d3-force（Node 上）で座標まで事前計算して `data/grammar_graph.js` にコミットする。アプリ側は、画面を開いたときだけ動的に `<script>` を足して読み込み、純粋関数（理解度・絞り込み・幾何・詳細）と Canvas の描画を分けて持つ。入力があったときだけ `requestAnimationFrame` で 1 回描く。

**Tech Stack:** 静的 HTML・ビルドなしの JS（UMD の純粋関数は `src/`、画面は `js/`）、Canvas 2D、Node（生成スクリプトだけ。d3-force 3.0.0）、`node --test` + Playwright、pytest。

**Spec:** `docs/superpowers/specs/2026-11-08-grammar-graph-view-v2-design.md`（§12 は決定済み。実装前に必ず読む）。軽量化の根拠は `docs/performance-investigation-2026-11-08.md`。

## Global Constraints

- 静的 HTML・ビルドなしのアプリのまま。ビルドが要るのは `tools/` の生成スクリプトだけで、生成物 `data/grammar_graph.js` をコミットする。d3 はアプリに同梱しない（`vendor/` を作らない）。
- 既存の単語ドリル・文法ドリルの動作と、**起動時のリクエスト数**を変えない。グラフ用ファイルは起動時に読まない（動的に差し込む）。
- 保存内容（`tests/storage-writes.test.js` の golden）を 1 バイトも変えない。**新しい保存キーを作らない**。グラフは記録を読むだけ。
- `python` ではなく `python3`。出力ドキュメントは Markdown。
- ファイル一覧は 3 か所: `index.html` → `sw.js` の `ASSETS` → `upload.py` の `FILES`（`tests/test_file_lists.py`）。動的に読むファイルは `index.html` に書かず、`ASSETS` と `FILES` にだけ足す。`tools/`・`docs/`・`tests/` は公開しない。
- 描画は入力があったときだけ。動いていないときの `requestAnimationFrame`・タイマーは 0 回。画面を離れたら `GraphView.destroy()` でリスナー・rAF・Canvas を解放する。`devicePixelRatio` は上限 2。
- ラベルは日本語で短く切る。1 画面に描くラベルは上限つき（目安 80 個）。長い名前は詳細シートで全文。
- 状態の判定（上から）: `answered===0`→unseen／`due>0`→due／`weak>0 または (answered>=3 かつ rate<0.6)`→weak／`answered<3`→few／`rate>=0.8 かつ weak===0`→good／それ以外→mid。`rate=(correct+1)/(answered+2)`。
- 入口: スマホ幅は下部 5 タブのまま、ホームか復習のカードから開く。幅 1000px 以上（`css/shell.css` の左サイドバー）では `.top-page-tabs` に「グラフ」タブを足す。PC サイドバーにだけ「同期」ボタンを置き、押すと `saveToGoogleDrive({ interactive: true })` を実行する。
- テストの実行: node は `NODE_PATH=$(npm root -g) node --test tests`（作業開始時 171 件）、python は `uv run --no-project --with pytest pytest -q`（24 件）。作業開始時、既存の `pomeranian-surfaces` のブランド表示が 1 件失敗する可能性が調査記録にある（今回と無関係。増えなければよい）。
- 各段階の終わりでユーザーに確認する。**コミットはユーザーが指示したときだけ**行う（各段階の最後の「コミット」ステップは、確認後に実行）。npm パッケージ（d3-force）を入れたら、何を入れたか作業の最後に報告する。

## 設計書からの変更点（実装前に確認済みの事実による）

計測（`RAW_GRAMMAR` 983 問）で次が分かった。計画はこの数字を前提にする。ユーザーの承認が要るのは「ルールの鍵」のみ（Task 2 の段階終了時に確認）。

| 項目 | 設計書 | 実測・計画 |
|---|---|---|
| ルールの数 | 約 460 | 約 521（金 84 / 世界一 38 / ポラリス2 334 / トップレベル 65）。合計ノードは約 1,580 |
| ルールの鍵 | `rule.number` を本ごとに数える | トップレベルの `rule.number` は 4 通りだけ（章ごとに 1 から振り直し）なので使えない。**鍵 = (本, `ch`, `rule.number`)**（世界一は `rule` がないので (本, `ch`, `th_title`)）。金の複数章にまたがる 1 ルールは、章ごとに別ノードになり、「親が複数のエッジ」は不要 |
| ポラリス2 | — | ルール 334 = 問題 334（1 問 1 ルール）。ルール層は情報を足さない。**まず設計どおり全ノードを入れ、Task 3 の見た目の確認で「1 問だけのルールは作らず問題を章に直接つなぐ」案を試して、ユーザーが選ぶ** |
| 純粋関数の置き場 | `js/mastery.js`、`js/graph-filter.js` | 既存の規約（UMD の純粋関数は `src/`、テストは `tests/unit/`）に合わせ `src/mastery.js` ほか。画面だけ `js/graph-view.js` |
| 起動の転送量 | 1 バイトも増えない | `#graph-page` は動的に作るので `index.html` はタブ 1 行だけ増える。テストで固定するのは「起動時のリクエスト数が変わらない」「グラフ用ファイルを起動時に取らない」 |
| 理解度の入力 | `now` を引数 | 期日判定は既存の `isDue(entry)`（`js/review-interval.js`）を引数 `isDue` で受ける。テストは固定時刻の関数を渡す |
| Node | 22 | この Mac は v26.13.0。d3-force 3.0.0 は ESM で動く |

## ファイル構成

| ファイル | 責務 |
|---|---|
| `tools/package.json`, `tools/package-lock.json` | d3-force 3.0.0 だけに依存（`"type": "module"`）。`.gitignore` に `tools/node_modules/` |
| `tools/lib/vault.mjs` | Vault の読み取り（問題ノート・概念・Trap） |
| `tools/lib/match.mjs` | アプリの問題と Vault の問題の対応づけ |
| `tools/check_mapping.mjs` | 段階 1 の検証 CLI（件数と未対応の一覧を出す） |
| `tools/lib/model.mjs` | 問題・対応づけ・概念・Trap から、ノードとエッジ（座標なし）を作る |
| `tools/lib/layout.mjs`, `tools/lib/layout-config.mjs` | 種つき d3-force の配置。力の係数は config に集約 |
| `tools/lib/encode.mjs` | モデル + 座標 → `GRAMMAR_GRAPH`（列ごとの配列）の JS 文字列 |
| `tools/build_grammar_graph.mjs` | CLI。`node tools/build_grammar_graph.mjs <Vault のパス>` |
| `data/grammar_graph.js` | 生成物（コミットする） |
| `src/mastery.js` | 理解度の計算（純粋関数） |
| `src/graph-filter.js` | 本別・苦手別・LOD 別の表示判定（純粋関数） |
| `src/graph-geometry.js` | カメラ変換・画面外の間引き・格子索引の当たり判定（純粋関数） |
| `src/graph-detail.js` | 詳細シートに出す内容を組み立てる（純粋関数。HTML は作らない） |
| `js/graph-view.js` | `window.GraphView`（mount / refresh / destroy）。Canvas・入力・シート |
| `css/graph.css` | グラフ画面とシートの見た目（動的に `<link>` で読む） |
| `home.js`（変更） | `APP_PAGES` に `graph`、カード、動的読み込み `loadGraphAssets()`、`openGraphPage()` |
| `index.html`（変更） | `.top-page-tabs` に「グラフ」「同期」ボタン各 1 行 |
| `css/shell.css`（変更） | 1000px 未満では「グラフ」「同期」を隠す |
| `sw.js`, `upload.py`（変更） | 新規 7 ファイル（`data/grammar_graph.js`, `src/mastery.js`, `src/graph-filter.js`, `src/graph-geometry.js`, `src/graph-detail.js`, `js/graph-view.js`, `css/graph.css`）を足す |
| `tests/` | 各タスクに記載 |

## Review Focus

仕様が黙っていて、使う人が踏みそうな入力・状態。各行のテストは、担当のタスクに入れてある。

1. **Vault に概念リンクが 1 本もない問題**（対応づけ不能の問題）: 親エッジだけで入り、理解度が計算でき、描画が落ちない → Task 2, 4
2. **グラフにない問題 id の記録・数値でないキー・`a` が 0 の記録**: 無視し、例外にしない。記録が空の初回起動は、全ノードが `unseen` で NaN が出ない → Task 4
3. **グラフを開く／閉じるを繰り返す・読み込み中に画面を離れる・オフラインで未キャッシュ**: リスナーや Canvas が増えない、二重に `<script>` を足さない、失敗時は理由と再試行が出る → Task 8, 9
4. **パン／ピンチの直後のタップ・ノードが重なる場所・何もない場所のタップ**: パン後にシートが誤って開かない、重なったら近い方、空きはシートを開かない → Task 6, 8
5. **ダークテーマ・テーマ切り替え後の色**: マウント時に読んだ色が古いままにならない（テーマ変更で読み直す） → Task 8

---

## 段階 1: 対応づけの検証

### Task 1: Vault の読み取りと対応づけ、検証 CLI

**Files:**
- Create: `tools/package.json`（`{"private":true,"type":"module","dependencies":{"d3-force":"3.0.0"}}`）, `tools/lib/vault.mjs`, `tools/lib/match.mjs`, `tools/check_mapping.mjs`
- Create: `tests/fixtures/mini-vault/`（`03_Questions/金の文法/*.md` 2 本、`03_Questions/トップレベル英語/*.md` 2 本、`00_Concepts/*.md` 2 本、`04_Traps/*.md` 1 本。実 Vault と同じ書式の抜粋）
- Test: `tests/build_vault.test.js`
- Modify: `.gitignore`（`tools/node_modules/` を追記）, `docs/superpowers/specs/2026-11-08-grammar-graph-view-v2-design.md`（§3.2 に検証結果を追記）

**Interfaces:**
- Produces（`tools/lib/vault.mjs`）: `loadVault(vaultDir: string): Promise<{ questions: VaultQuestion[], concepts: Concept[], traps: Trap[] }>`
  - `VaultQuestion = { practiceId: number, book: string, text: string, conceptIds: string[], trapIds: string[] }`（`practiceId` はフロントマターの `practice_id`、`text` は「## 問題文」の引用ブロック、`conceptIds` は本文中の `[[00_Concepts/<名前>…]]` の `<名前>`、`trapIds` は `[[04_Traps/<ファイル名>…]]` のファイル名（拡張子なし））
  - `Concept = { id: string /* 名前 */, name: string, desc: string }`, `Trap = { id: string /* ファイル名 */, name: string, desc: string, advice: string }`。`desc` は「核心講義」または警告ボックスの本文、`advice` は「見破り方と突破の鉄則」の本文（先頭の `>` を除いて 1 行にしない・短く切らない）
- Produces（`tools/lib/match.mjs`）:
  - `normalizeText(s: string): string` — 空白・記号・全角半角・大文字小文字を揃える
  - `matchQuestions(appQuestions: {id:number,b:string,q:string}[], vaultQuestions: VaultQuestion[]): { byApp: Map<number, VaultQuestion>, via: Map<number, 'id'|'text'>, unmatched: number[] }`

- [ ] **Step 1: 失敗するテストを書く** — `tests/build_vault.test.js`（CommonJS。ESM の `tools/lib/*.mjs` は `await import()` で読む）。
  - `loadVault(mini-vault)` で、金の 1 問目が `practiceId===1001`、`conceptIds` に 2 件、トップレベルの 1 問に `trapIds` が 1 件、Trap の `advice` が空でない。
  - `normalizeText('A  prize ------- for…')` と `normalizeText('a prize ------- for…')`（全角スペース・全角ハイフン違い）が等しい。
  - `matchQuestions`: ID 一致の問題は `via==='id'`、ID は違うが本文が同じ問題は `via==='text'`、どちらも無い問題は `unmatched` に入る。**同じ本文が 2 問ある場合は、`book` が同じ Vault 問題のうち未使用のものを順に割り当てる**（先着で二重に使わない）。
- [ ] **Step 2: 実行して失敗を確認** — `NODE_PATH=$(npm root -g) node --test tests/build_vault.test.js`。Expected: FAIL（モジュールがない）。
- [ ] **Step 3: `vault.mjs` と `match.mjs` を実装** — Markdown は依存なしの正規表現で読む（YAML は `practice_id` と `book` だけ読めばよい）。照合の順は「ID → 正規化した本文」。本ごとに `practice_id` の付き方が違っても、本文照合が拾う。
- [ ] **Step 4: テストを実行して通ることを確認** — Expected: PASS。
- [ ] **Step 5: `tools/check_mapping.mjs` を実装** — 引数は Vault のパス。`data/grammar.js` を `node:vm` で読んで `RAW_GRAMMAR` を得て、本ごとの件数（ID 一致／本文一致／未対応）と、未対応の `id` と本文の先頭 40 文字の一覧を出す。環境変数 `VAULT_DIR` でも指定可。
- [ ] **Step 6: 実 Vault で実行して結果を記録** — `cd tools && npm install && cd .. && node tools/check_mapping.mjs /Users/reiji/projects/English_study`。Expected: ID 一致 915、本文一致で残り 68 問のうち何問が結べたか、未対応の件数が出る。**未対応が 0 でないときは、原因（Vault 側が削除した重複問題など）を調べ、設計書 §3.2 に「検証結果」として件数・原因・扱いを追記する**（完成基準の「未対応 0、または理由つきで明記」を満たす）。あわせて本ごとの `practice_id` の付き方（金 1001〜、トップレベル 2456〜など）を 1 行ずつ記す。
- [ ] **Step 7: 段階 1 の確認** — 結果をユーザーに示し、未対応の扱いを確認してもらう。
- [ ] **Step 8: コミット（ユーザーの指示後）**

```bash
git add tools/package.json tools/package-lock.json tools/lib/vault.mjs tools/lib/match.mjs tools/check_mapping.mjs tests/build_vault.test.js tests/fixtures/mini-vault .gitignore docs/superpowers/specs/2026-11-08-grammar-graph-view-v2-design.md
git commit -m "feat(graph): read Vault and verify question mapping"
```

---

## 段階 2: 生成スクリプトと座標の事前計算

### Task 2: グラフのモデルと符号化（座標なし）

**Files:**
- Create: `tools/lib/model.mjs`, `tools/lib/encode.mjs`
- Test: `tests/build_graph.test.js`（モデルと符号化の部分）

**Interfaces:**
- Consumes: `matchQuestions` の結果（Task 1）、`Concept[]`, `Trap[]`、アプリの問題（`{id,b,ch,ch_title,th_title,q,rule?}`）、本の名前（`js/grammar-drill.js` の `GRAMMAR_BOOKS` から。`vm` で `name` だけ読むか、`tools/lib/books.mjs` に `{kin:'金の文法', sekai:'世界一', polaris2:'ポラリス2', toplevel:'トップレベル'}` を持つ。どちらを選んでもテストで `GRAMMAR_BOOKS` と一致を確かめる）
- Produces（`model.mjs`）: `buildModel(input): Model`
  - `Model = { kinds: ['book','chapter','rule','concept','trap','question'], id: string[], kind: number[], label: string[], qid: number[], edges: [from:number, to:number, type:0|1|2][], text: Record<number,{desc:string,advice?:string}>, unmatchedQids: number[] }`
  - ノード id の形: `book:kin` / `ch:kin:3` / `rule:kin:3:12`（本:章:ルール番号。世界一は `rule:sekai:<ch>:<th_title の連番>`）/ `con:<概念名>` / `trap:<Trap_NN>` / `q:<id>`。エッジ: 0 = parent（book→chapter→rule→question）、1 = question→concept、2 = question→trap。
  - ラベルは日本語で短く: question は問題番号（`#<id>`）、rule は `rule.title`（世界一は `th_title`）を 14 字で切り「…」、chapter は `ch_title`、book は本の名前。全文は `text` ではなく、アプリ側が `RAW_GRAMMAR` から引く（概念・Trap の `desc`/`advice` だけ `text` に入れる）。
- Produces（`encode.mjs`）: `encodeGraph(model, xs: number[], ys: number[]): string` — `const GRAMMAR_GRAPH = {...};` の JS ソース。形は設計書 §4.3 に、次を足す。`qids: number[]`（983 問の id を `question` ノードの並び順に）、`memberStart: number[]`（長さ n+1）と `members: number[]`（各ノード配下の問題の**序数** = `qids` の添字。本・章・ルール・概念・Trap のすべて。重複なし）、`version: 3`。座標は整数に丸める。

- [ ] **Step 1: 失敗するテストを書く** — mini 入力（金 2 章・トップレベル 1 章の 8 問程度）で:
  - 全ノード id が一意。全エッジの端点が存在する。`kind` の添字が `kinds` の範囲内。
  - **Review Focus 1**: 概念リンクのない問題が `unmatchedQids` に入り、親エッジはあり、概念エッジはない。
  - question ノード数 = 入力の問題数。全問が `qids` に 1 回ずつ。
  - 金で複数章にまたがる同じ `rule.number` が、別のルールノード（`rule:kin:<ch>:<n>`）になる。トップレベルの `rule.number` 1 が章ごとに別ノードになる。
  - `members`: 概念ノードの配下は、その概念にリンクした問題の序数だけ。本ノードの配下は本の全問。どのノードでも重複なし。`memberStart` が単調で、最後が `members.length`。
  - `encodeGraph` の出力を `vm` で評価して `GRAMMAR_GRAPH` が得られ、`x`/`y` が整数、配列の長さが揃う。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL（モジュールがない）。
- [ ] **Step 3: `model.mjs` を実装** — 親子エッジは `buildModel` が (本, ch, rule 鍵) をキーに作る。`members` は `encode` で、エッジを辿って作る（配下の問題の和集合を、親エッジの逆向きとコンセプト/Trap エッジから）。
- [ ] **Step 4: `encode.mjs` を実装** — 設計書 §4.3 の列ごとの配列。
- [ ] **Step 5: テストを実行して通ることを確認** — Expected: PASS。
- [ ] **Step 6: コミット（段階 2 の確認後）**

### Task 3: 種つき d3-force の配置と生成 CLI、生成物

**Files:**
- Create: `tools/lib/layout.mjs`, `tools/lib/layout-config.mjs`, `tools/build_grammar_graph.mjs`, `data/grammar_graph.js`（生成）
- Test: `tests/build_graph.test.js`（配置と生成物の部分を追加）
- Modify: `tools/package.json`（`scripts.build` を足してもよい）

**Interfaces:**
- Consumes: `Model`（Task 2）
- Produces: `layout(model: Model, config?: LayoutConfig): { x: number[], y: number[] }`（整数に丸めた座標。同じ入力から同じ出力）。`layout-config.mjs` は `export const LAYOUT = { seed, ticks, parentStrength, conceptStrength, trapStrength, charge, collideRadius: {book,chapter,rule,concept,trap,question}, anchors: {kin:[x,y], …} }` の定数のみ（調整はここだけで行う）。
- CLI: `node tools/build_grammar_graph.mjs <VaultDir>`（または `VAULT_DIR`）が `data/grammar_graph.js` を書き、ノード数・エッジ数・未対応の問題数と一覧・ファイルサイズ（gzip 後も）をログに出す。

- [ ] **Step 1: 失敗するテストを書く**
  - **決定性**: mini 入力で `layout` を 2 回呼んで `x`・`y` が完全に一致する。`buildModel` → `encodeGraph` の文字列も 2 回で一致する。
  - すべての座標が有限の整数。2 つのノードが同一座標にならない（衝突半径が効いている）。
  - **生成物の契約**（実データ。Vault 不要）: `data/grammar_graph.js` と `data/grammar.js` を `vm` で読み、`qids` が `RAW_GRAMMAR` の 983 問の id と過不足なく一致、id の一意性、全エッジの端点の存在、`kinds` の範囲、`members` の整合、book 4・chapter 51・concept 13・trap 12 のノード数。生成物の `version===3`。
  - d3-force がない環境（`tools/node_modules` なし）では配置テストを `skip` し、理由を表示する。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: `layout.mjs` を実装** — `forceLink`（親は強く、概念・Trap は弱く）、`forceManyBody`、`forceCenter`、`forceCollide`（種類ごとの半径）。`simulation.randomSource(mulberry32(seed))`、`stop()` してから固定の `ticks` 回 `tick()`。初期位置は本ごとの `anchors` の近くに置く（本ごとの塊 + 中央寄りのハブ）。
- [ ] **Step 4: `build_grammar_graph.mjs` を実装** — Task 1・2 の部品をつなぐ。
- [ ] **Step 5: 実データで生成** — `node tools/build_grammar_graph.mjs /Users/reiji/projects/English_study`。もう一度実行して `git diff --stat data/grammar_graph.js` が変化なしであること（再現性）。サイズを実測し、数百 KB を超えるときは座標・エッジの符号化を見直す。
- [ ] **Step 6: 見た目を確認** — ブラウザ（`mcp__Claude_Browser__*`）で、座標を SVG か Canvas に 1 回だけ描く使い捨ての確認ページ（`/private/tmp/...` のスクラッチに置く。リポジトリに入れない）を開き、スクリーンショットを撮る。本ごとの塊と、概念・Trap のハブが中央寄りに出ているか確認し、`layout-config.mjs` の係数を調整する。**ポラリス2 のルール層（334 ノードが 1 問 1 ルール）を、(a) そのまま入れた図と (b) 1 問だけのルールを作らず問題を章に直接つないだ図の 2 枚を撮り、ユーザーに選んでもらう。** (b) を選んだ場合は `model.mjs` の変更とテスト（「1 問だけのルールは作らない」）を足し、再生成する。
- [ ] **Step 7: テストを実行して通ることを確認** — `NODE_PATH=$(npm root -g) node --test tests/build_graph.test.js tests/build_vault.test.js`。Expected: PASS。
- [ ] **Step 8: 段階 2 の確認とコミット（ユーザーの指示後）** — 図・サイズ・未対応の件数・選んだルール層の扱いを示す。

```bash
git add tools data/grammar_graph.js tests/build_graph.test.js .gitignore
git commit -m "feat(graph): precomputed graph data and layout generator"
```

---

## 段階 3: 純粋関数（テスト先行）

### Task 4: 理解度の計算 `src/mastery.js`

**Files:**
- Create: `src/mastery.js`
- Test: `tests/unit/mastery.test.js`

**Interfaces:**
- Consumes: `GRAMMAR_GRAPH`（`qids`, `memberStart`, `members`、ノード数 = `id.length`）
- Produces: `StudyCore.computeMastery(graph, stats, weak, isDue): Mastery`、`StudyCore.MASTERY_STATES`、`StudyCore.MASTERY_THRESHOLDS`
  - `stats: Record<string,{a:number,c:number}>`、`weak: Record<string,object>`、`isDue: (entry:object)=>boolean`
  - `Mastery = { total: Int32Array, answered: Int32Array, correct: Int32Array, weak: Int32Array, due: Int32Array, rate: Float32Array, state: Uint8Array }`（長さ = ノード数）。`state` の値は `MASTERY_STATES = ['unseen','due','weak','few','mid','good']` の添字。`answered`/`correct` は配下の問題の `a`/`c` の合計、`weak`/`due` は配下の問題のうち苦手／要復習の数。しきい値（3、0.6、0.8）は `MASTERY_THRESHOLDS` に 1 か所で定義。
  - 実装は、問題ごとの値（`a`,`c`,`weak`,`due`）を序数順の `Int32Array` に 1 回だけ作り、各ノードは `members` の区間の和で求める。

- [ ] **Step 1: 失敗するテストを書く**（UMD を `require('../../src/mastery.js')`。小さな手書きの `graph` を使う）
  - 境界: 解答数 0 → unseen、2 → few、3 かつ `rate<0.6` → weak、`rate` が 0.8 ちょうど → good、0.6 ちょうどで weak でない → mid。`rate` の式 `(c+1)/(a+2)` を値で確認。
  - 優先: `due>0` と `weak>0` が両方あるとき due。`weak>0`（苦手に登録）だが解答数が 2 のとき weak（few より先）。
  - 集計: 本をまたぐ 2 問を配下にもつ概念が、各問を 1 回ずつ数える（二重カウントなし）。同じ問題が章と概念の両方に属しても、それぞれのノードでは 1 回。
  - **Review Focus 2**: グラフにない問題 id の `stats`／`weak`、キー `'abc'`・`'__proto__'`、`{a:0,c:0}`、`c>a` の記録を渡しても例外にならず、集計に入らない。`stats`・`weak` が `{}` のとき全ノードが unseen で `rate` に NaN がない。
  - **Review Focus 1**: 概念エッジのない問題だけの本でも計算できる。
  - 速さ: 983 問・1,600 ノードの合成グラフで `computeMastery` が 20ms 未満（デスクトップ）。
- [ ] **Step 2: 実行して失敗を確認** — `NODE_PATH=$(npm root -g) node --test tests/unit/mastery.test.js`。Expected: FAIL。
- [ ] **Step 3: `src/mastery.js` を実装** — `src/review.js` と同じ UMD ラッパー。
- [ ] **Step 4: テストを実行して通ることを確認** — Expected: PASS。

### Task 5: 絞り込みと LOD `src/graph-filter.js`

**Files:**
- Create: `src/graph-filter.js`
- Test: `tests/unit/graph-filter.test.js`

**Interfaces:**
- Consumes: `graph`、`Mastery`（Task 4）
- Produces: `StudyCore.visibleMask(graph, mastery, opts): Uint8Array`、`StudyCore.lodForScale(scale: number): 0|1|2`、`StudyCore.kindsAtLod(lod: number): number[]`、`StudyCore.LOD_SCALES`
  - `opts = { book: 'all'|'kin'|'sekai'|'polaris2'|'toplevel', weakOnly: boolean, lod: 0|1|2 }`。マスク 1 = 描く。
  - LOD: 0 = book・concept・trap・chapter、1 = + rule、2 = + question。`book` で絞ると、その本の配下に入る問題を 1 問以上もつノードだけが残る（概念・Trap は、その本の問題とつながるものだけ）。`weakOnly` は `weak>0` または `due>0` のノードだけ（問題は自分が苦手のもの）。LOD は種類による除外と両立する。

- [ ] **Step 1: 失敗するテストを書く** — 本別（概念が、その本の問題とつながるときだけ残る）、苦手別（苦手でない章が消え、苦手な問題の親は残る）、LOD 別（遠景に question が出ない）、`lodForScale` の境界、3 条件の組み合わせ。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: 実装** — `members` を使い、グラフを辿らない。
- [ ] **Step 4: テストを実行して通ることを確認** — Expected: PASS。
- [ ] **Step 5: 段階 3 の確認とコミット（ユーザーの指示後）**

```bash
git add src/mastery.js src/graph-filter.js tests/unit/mastery.test.js tests/unit/graph-filter.test.js
git commit -m "feat(graph): mastery and filter pure functions"
```

---

## 段階 4: 画面（Canvas・操作・シート）

### Task 6: 幾何 `src/graph-geometry.js`

**Files:**
- Create: `src/graph-geometry.js`
- Test: `tests/unit/graph-geometry.test.js`

**Interfaces:**
- Produces（`StudyCore.*`）:
  - `createCamera(width, height, bounds): Camera`（`Camera = { x, y, scale }`。`bounds` は座標の外接矩形に余白をつけて全体が収まる初期値）
  - `worldToScreen(cam, wx, wy): [number, number]`、`screenToWorld(cam, sx, sy): [number, number]`
  - `zoomAt(cam, sx, sy, factor, limits): Camera`（指の位置を固定してズーム。`limits = {min, max}`）、`panBy(cam, dx, dy): Camera`
  - `visibleIndices(xs, ys, cam, width, height, margin): Int32Array`（画面内のノード添字）
  - `buildGrid(xs, ys, cellSize): Grid`、`hitTest(grid, xs, ys, wx, wy, radiusWorld, order?): number`（当たりなし = -1。複数重なったら**中心が近い方**。`radiusWorld` は呼び出し側が見た目より大きめに渡す）

- [ ] **Step 1: 失敗するテストを書く** — 変換の往復一致、ズームで指の下のワールド座標が動かない、ズームの上下限、画面外のノードが `visibleIndices` に入らない（境界の margin を含む）、**Review Focus 4**: 重なった 2 ノードの中間をタップすると近い方、何もない場所は -1、半径の外は -1。1,600 ノードの `hitTest` が総当たりと同じ結果で、1 回あたり 0.1ms 未満の目安。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: 実装** — 格子はセル → 添字の配列（`Map` か疎配列）。`hitTest` は近傍 3×3 セルだけ見る。
- [ ] **Step 4: テストを実行して通ることを確認** — Expected: PASS。

### Task 7: 詳細の組み立て `src/graph-detail.js`

**Files:**
- Create: `src/graph-detail.js`
- Test: `tests/unit/graph-detail.test.js`

**Interfaces:**
- Consumes: `graph`、`Mastery`、`stats`、`weak`、`getQuestion: (qid:number)=>{q:string,...}|undefined`
- Produces: `StudyCore.buildDetail(graph, mastery, nodeIndex, ctx): Detail`
  - `Detail = { title: string, kindLabel: string, stateLabel: string, rate: number|null, answered: number, weakCount: number, desc?: string, advice?: string, questions: {qid:number, text:string, status:'unseen'|'correct'|'wrong'|'weak'}[] }`
  - `title` はノードの全文（question は問題文の先頭 60 字）。`questions` は配下の問題（上限 200 件。超えたら `moreCount` を足す）で、苦手を先頭にする。`status`: `weak` に入っていれば weak、未解答は unseen、直近の正誤が分かる情報がなければ `a>0 && c===a` を correct、それ以外を wrong とする（直近正誤は保存にないので使わない）。

- [ ] **Step 1: 失敗するテストを書く** — 概念・Trap は `desc`/`advice` を返し、ほかの種類は返さない。`questions` の並び（苦手が先頭）、上限と `moreCount`、問題文が `getQuestion` に無い問題（`undefined`）でも落ちずに id 表示で代用する。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: 実装** — HTML は作らない（画面側が `escapeHtml` を通して組む）。
- [ ] **Step 4: テストを実行して通ることを確認** — Expected: PASS。

### Task 8: 画面 `js/graph-view.js` と `css/graph.css`

**Files:**
- Create: `js/graph-view.js`, `css/graph.css`
- Test: `tests/graph-view.test.js`（Playwright。`tests/weak-list-lookup.test.js` と同じ静的サーバーの型）

**Interfaces:**
- Consumes: `GRAMMAR_GRAPH`、`StudyCore.{computeMastery,visibleMask,lodForScale,createCamera,worldToScreen,zoomAt,panBy,visibleIndices,buildGrid,hitTest,buildDetail}`
- Produces: `window.GraphView`
  - `GraphView.mount(container: HTMLElement, deps: { graph, getStats: ()=>object, getWeak: ()=>object, getQuestion: (qid)=>object|undefined, isDue: (entry)=>boolean }): void`
  - `GraphView.refresh(): void`（理解度を再計算し、再描画を 1 回要求）
  - `GraphView.destroy(): void`
  - テスト用に `GraphView._debug = { frames: number, listeners: number }` を持つ（描画した回数と、足したリスナー数）。

- [ ] **Step 1: 失敗するテストを書く**（ページに `data/grammar_graph.js` と `src/*.js`、`js/graph-view.js` を読み込む最小の HTML を Playwright でサーバーから配る。アプリ全体の起動に依存しない）
  - マウントすると `<canvas>` が 1 枚でき、1 回描かれる（`_debug.frames===1`）。
  - 苦手データ（概念につながる問題 1 問）を渡すと、そのノードと、つながる概念・Trap の描画色が赤系になる（`canvas` の該当ピクセルを `getImageData` で確認）。**記録が空**なら全ノードが灰で、例外もない。
  - **動いていないとき**: マウントの 1 秒後まで `requestAnimationFrame` と `setTimeout`/`setInterval` の呼び出しが 0 回（`page.addInitScript` で包んで数える）。
  - 入力: ドラッグでパンして 1 回描かれる。ホイールでズームすると LOD が上がり、近景で question が描かれる。ピンチ（2 本指の Pointer Events）でズームする。**Review Focus 4**: パンした直後の `pointerup` ではシートが開かない（移動が 6px 超なら tap でない）。ノードのタップで `.bottom-sheet` 相当のシートが開き、概念なら `desc`、Trap なら `advice`、配下の問題一覧が出る。何もない場所のタップではシートが開かない。Esc と外側タップで閉じる。
  - 絞り込み（本・苦手のみ）で描くノード数が変わる。
  - **destroy**: `destroy()` のあと、`<canvas>` が消え、足したリスナーが 0、保留中の rAF が 0。2 回呼んでも落ちない。`mount` → `destroy` → `mount` を 5 回繰り返してもリスナー数が増えない（Review Focus 3）。`document.hidden` になったら描画を止める（rAF を要求しない）。
  - **Review Focus 5**: `data-theme` を切り替えて `refresh()` またはテーマ変更で、色が読み直される（背景ピクセルが変わる）。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL（`GraphView` がない）。
- [ ] **Step 3: 実装** — 描き方は設計書 §7 のとおり。要点: `<canvas>` 1 枚、`devicePixelRatio` 上限 2、dirty フラグ + `requestAnimationFrame` 1 回だけ、`visibleIndices` で画面外を間引く、エッジは種類ごとに 1 つの path（親は薄い灰の実線、概念は点線、Trap は警告色の破線）、ノードは `concept` 二重リング・`trap` 破線・`book`>`chapter`>`rule`>`question` の順に小さく、ラベルは画面内かつ重ならないものを上限つき（目安 80）で描く、色は `state` を CSS 変数からマウント時とテーマ変更時に読んで保持する（描画のたびに `getComputedStyle` を呼ばない）。入力は Pointer Events（パン・ホイール・ピンチ）。シートは既存の `.bottom-sheet`（`openSheet` は `isFixedTheme` の引数などがあり、再利用できるか実装時に確かめる。無理なら `css/graph.css` に専用の軽いシートを持つ）。詳細の文字列は `escapeHtml` を通す。`destroy()` は登録したリスナー・保留中の rAF・`visibilitychange` の購読・Canvas を解放する。
- [ ] **Step 4: テストを実行して通ることを確認** — Expected: PASS。
- [ ] **Step 5: 目で確認** — Playwright で 375×812 と 1280×800 のスクリーンショットを撮り、遠景・中景・近景の見え方、ラベルが重ならないこと、苦手が赤く見えることを確認する（テスト用の合成の記録を使う。アプリの実データには触れない）。
- [ ] **Step 6: 段階 4 の確認とコミット（ユーザーの指示後）**

```bash
git add src/graph-geometry.js src/graph-detail.js js/graph-view.js css/graph.css tests/unit/graph-geometry.test.js tests/unit/graph-detail.test.js tests/graph-view.test.js
git commit -m "feat(graph): canvas graph view with detail sheet"
```

---

## 段階 5: 入口・動的読み込み・ファイル一覧

### Task 9: 入口（カード・PC タブ・ハッシュ）と動的読み込み

**Files:**
- Modify: `home.js`（`APP_PAGES` に `'graph'`、`switchAppPage` の分岐、カード、`loadGraphAssets`、`openGraphPage`、戻る）, `index.html`（`.top-page-tabs` に `<button type="button" class="top-page-tab" data-page="graph" role="tab" aria-selected="false">グラフ</button>` を 1 行）, `css/shell.css`（幅 1000px 未満で `.top-page-tab[data-page="graph"]` を隠す）, `sw.js`（`ASSETS` に 7 ファイル）, `upload.py`（`FILES` に同じ 7 ファイル）
- Test: `tests/graph-entry.test.js`（Playwright）、既存の `tests/test_file_lists.py`

**Interfaces:**
- Produces（`home.js`）: `loadGraphAssets(): Promise<void>`（`css/graph.css` の `<link>` と、`data/grammar_graph.js`・`src/mastery.js`・`src/graph-filter.js`・`src/graph-geometry.js`・`src/graph-detail.js`・`js/graph-view.js` の `<script>` を**この順に 1 つずつ** `async=false` で差し込む。成功した Promise は保持して再利用し、失敗したら捨てて次回やり直す。同じ要素を二重に足さない）、`openGraphPage(): void`（`switchAppPage('graph')`）
  - `switchAppPage('graph')` は `#graph-page`（`.app-page-view`、なければ動的に作る）を表示し、読み込み中表示 → `loadGraphAssets()` → `GraphView.mount(...)`（`deps` は `state.grammarStats`・`state.grammarWeakData`・`GRAMMAR_BY_ID.get`・`isDue`）。失敗時は理由と「再試行」ボタン。別ページへ移るとき（`switchAppPage` の先頭）に `GraphView.destroy()`。記録が変わったとき（`renderHomePage` などが走る箇所）に `GraphView.refresh()` は呼ばない（画面を開いている間は記録が変わらない）。
  - ホームか復習ページに、スマホ幅でも見えるカード「🕸 文法グラフ」（`data-home-action="open-graph"`）を足す。戻るボタンで直前のページへ戻る。ハッシュ `#graph` で直接開ける。

- [ ] **Step 1: 失敗するテストを書く**
  - **起動の不変**: ホームを開いて 2 秒待つまでのリクエストを数え、グラフ用の 7 ファイルを 1 つも取っていない。リクエスト数は、変更前に取った基準値（テストに定数で持つ。実装前に今のコードで測って決める）と等しい。
  - カードをタップすると `#graph-page` が表示され、キャンバスが描かれる。戻るボタンで元のページに戻り、`GraphView._debug.listeners===0`、`<canvas>` なし。開く→戻るを 3 回繰り返してもスクリプトタグが 1 組のまま（Review Focus 3）。
  - 読み込み中に別のページへ移っても、あとからマウントされない。
  - 失敗: `page.route` で `data/grammar_graph.js` を 500 にすると、理由と「再試行」が出て、ルートを戻して再試行すると開く。
  - オフライン: Service Worker 経由で一度開いたあと `context.setOffline(true)` で再度開ける（`ASSETS` に入っている）。
  - 幅 1280 では「グラフ」タブが見え、タップで開く。幅 375 では隠れている。`#graph` で直接開く。
  - 既存の `tests/shell.test.js`・`tests/practice-chrome.test.js` のタブ数・位置の前提が、幅 375 で変わらない（隠すので変わらないはず）。変わるなら、その前提をテスト側で直す。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: 実装** — 上記の Interfaces どおり。`ASSETS`・`FILES` の更新、`sw.js` のキャッシュ名（`CACHE`）の世代を上げる必要があるか `sw.js` を読んで判断する。
- [ ] **Step 4: ファイル一覧のテスト** — `uv run --no-project --with pytest pytest -q tests/test_file_lists.py`。Expected: PASS（動的に読むファイルは `ASSETS` ⊂ `FILES` と存在の検査だけに引っかかる）。
- [ ] **Step 5: 軽さの確認** — デスクトップ Chromium、CPU 4 倍スロットルで、グラフを開いてから最初の描画までと、パン中の 1 フレームの描画時間、長いタスク（50ms 超）の有無を計測して、`docs/performance-investigation-2026-11-08.md` の末尾に「実装記録: グラフビュー」として数字を書く。基準（設計書 §9）に届かないときは、原因（ラベル、エッジの path、LOD のしきい値）を直す。
- [ ] **Step 6: 全テスト** — `NODE_PATH=$(npm root -g) node --test tests` と python 側。Expected: 失敗は作業開始時の既知の 1 件以下。`tests/storage-writes.test.js`（golden）が通ること。
- [ ] **Step 7: 段階 5 の確認とコミット（ユーザーの指示後）**

```bash
git add home.js index.html css/shell.css sw.js upload.py tests/graph-entry.test.js docs/performance-investigation-2026-11-08.md
git commit -m "feat(graph): entry points, lazy loading and offline cache"
```

---

## 段階 5b: PC サイドバーの「同期」ボタン

### Task 10: 同期のワンタップ

**Files:**
- Modify: `index.html`（`.top-page-nav` に、タブ列とは別の `<button type="button" class="top-sync-btn" aria-label="Google ドライブと同期">☁️ 同期</button>` を 1 つ）, `css/shell.css`（幅 1000px 以上のサイドバー下部に表示、未満は `display:none`）, `home.js` か `js/backup-ui.js`（クリックで `saveToGoogleDrive({ interactive: true })`。二重実行は `gdriveIsSyncing` が防ぐ）
- Test: `tests/sidebar-sync.test.js`（Playwright）

- [ ] **Step 1: 失敗するテストを書く** — 幅 1280 でボタンが見え、幅 375 では見えない。クリックで `saveToGoogleDrive` が `{ interactive: true }` で 1 回呼ばれる（`page.evaluate` で `window.saveToGoogleDrive` を差し替えて数える。**実際の Google には通信しない**）。連打しても同期関数が 1 回の進行中は重ねて呼ばれない、または呼ばれても `syncWithGoogleDrive` 側が弾く（既存の挙動を変えない）。保存内容は 1 バイトも変えない（golden が通る）。
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: 実装** — 同期の中身（`js/gdrive.js`）は変えない。ボタンは見た目だけ既存のサイドバーのタブに揃える。
- [ ] **Step 4: テストを実行して通ることを確認** — `NODE_PATH=$(npm root -g) node --test tests/sidebar-sync.test.js tests/shell.test.js`。Expected: PASS。
- [ ] **Step 5: コミット（ユーザーの指示後）**

```bash
git add index.html css/shell.css home.js tests/sidebar-sync.test.js
git commit -m "feat: one-tap Drive sync button in desktop sidebar"
```

---

## 段階 6: 仕上げ

### Task 11: 総合確認と引き継ぎ

**Files:**
- Modify: `docs/superpowers/specs/2026-11-08-grammar-graph-view-v2-design.md`（状態を「実装済み」に、完成基準の確認結果）, `docs/performance-investigation-2026-11-08.md`

- [ ] **Step 1: 全テスト** — node と python の全件。`tests/storage-writes.test.js`（golden）、`tests/test_file_lists.py`、グラフ関連が通る。件数を記録。
- [ ] **Step 2: 完成基準 §10 の 6 項目を 1 つずつ確認** — オフラインで開く、苦手・概念・Trap が赤く見える、タップで解説・対策・正答率・問題一覧が見える、§9 の軽さの基準、983 問が入っている（未対応は 0 または理由つき）、既存動作が変わらない。結果を設計書に書く。
- [ ] **Step 3: 報告** — 入れた npm パッケージ（`tools/` の d3-force 3.0.0 とその依存）、生成物のサイズ、未対応の問題、実機（iPhone）で確かめること（描画の滑らかさ、ピンチ、電池）を一覧にしてユーザーに渡す。
- [ ] **Step 4: 公開はユーザーに依頼** — `python3 upload.py -n` で内容を確認 → 問題なければ `python3 upload.py`。**公開は外向きの操作なので、ユーザーが実行する（または明示の指示を待つ）。**
