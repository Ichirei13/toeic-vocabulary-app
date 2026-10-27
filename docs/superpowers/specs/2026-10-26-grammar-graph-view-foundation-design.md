# 文法グラフビュー(基盤)設計

日付: 2026-10-26 / ブランチ: `claude/friendly-bohr-lwlh2r`

## 1. 背景と目的

文法学習の新機能として、複数の参考書の問題を「文法ノード」のグラフでつなぎ、弱点を可視化・出題に生かす構想がある(将来の目標は 30 問診断・章チェックなど)。

今回の対象は、その**最初の一歩であるグラフビューの基盤**に限る。

> 解いた履歴がグラフに反映され、間違えた問題・苦手な分野が赤く見える。

本設計では、`/Users/reiji/projects/English_study`（Obsidian 英文法ナレッジグラフ Vault）で確立された **「13の普遍的文法概念」** と **「12の頻出Trap（ひっかけパターン）」** を取り込み、参考書（金の文法・世界一）の垣根を越えて弱点を串刺しで分析できるフルナレッジグラフ基盤を構築する。

後続の機能(30問診断、章チェック、類題出題)は別の仕様で扱う。

### 前提と制約(合意済み)

- 静的 HTML のまま作る(サーバなし、ビルドなし)。オフライン動作(`sw.js`)を壊さない。
- スマホ幅を基準に設計し、PC でも使えるようにする。
- 既存の文法ドリル・単語ドリルの画面と動作は変えない。
- `English_study` の Vault（`00_Concepts`, `04_Traps`, `03_Questions`）から生成スクリプトでグラフデータを抽出し、静的ファイル `data/grammar_graph.js` に出力してコミットする。アプリ実行時は静的ファイルのみを参照する。
- 授業用テキストなどの追加の本は今回扱わないが、後から足せる形にしておく。

## 2. スコープ

### 含む

1. `English_study` の Vault および既存の問題データから**ナレッジグラフ**を生成するスクリプトと、その生成物。
2. グラフデータの形式（13普遍概念・12Trap・本固有ルール・章・問題）。
3. ノードの理解度状態を計算する純粋関数と、そのテスト。
4. グラフビュー(SVG 描画、物理配置、ドラッグ、ズーム、LOD段階表示、タップで詳細シート)。
5. 「学習対象」への「グラフ」の追加。

### 含まない

- 30 問診断、章チェック、練習ボタンによる出題プールの差し替え。
- バックアップ形式の変更(グラフビューは既存の記録を**読むだけ**で、新しい記録を持たない)。
- 既存の `index.html` の大規模な分割(今回は新規コードを `js/` に置くだけにとどめる)。

## 3. グラフデータの契約

`data/grammar_graph.js` は、グローバル変数 `GRAMMAR_GRAPH` を 1 つ定義する(既存の `data/words.js` / `data/grammar.js` と同じ流儀)。

```js
const GRAMMAR_GRAPH = {
  version: 2,
  nodes: [
    { id, label, kind, book, qids, desc, advice }
  ],
  edges: [
    { s, t, kind }
  ]
};
```

| フィールド | 内容 |
|---|---|
| `id` | 文字列。全体で一意 |
| `label` | 表示名 |
| `kind` | `'root'`(本)/ `'category'`(章)/ `'rule'`(本固有ルール)/ `'concept'`(13普遍概念)/ `'trap'`(12Trap)/ `'question'`(問題) |
| `book` | 本の識別子。`'sekai'` / `'kin'`。本をまたぐ普遍概念・Trapでは `null` |
| `qids` | そのノードの**直接の**問題 ID の配列。`question` ノードは自分の ID 1 つ。`rule` / `concept` / `trap` は該当する問題 ID 群。それ以外は空配列 |
| `desc` | (任意) 概念やTrapの解説文 |
| `advice` | (任意) Trapの対策アドバイス |
| `edges[].kind` | `'parent'`(階層ツリー)/ `'concept'`(問題→普遍概念)/ `'trap'`(問題→Trap) |
| `edges[].s` / `.t` | 始点 ID → 終点 ID |

### グラフの生成規則(`tools/build_grammar_graph.mjs`)

入力は `data/grammar.js` の `RAW_GRAMMAR` と `/Users/reiji/projects/English_study` の Vault データ。出力は `data/grammar_graph.js`。手元で `node tools/build_grammar_graph.mjs` を実行して生成し、生成物をコミットする。

- **root**: 本ごとに 1 つ（計2件）。`id` は `book:sekai`、`book:kin`。
- **category**: 章ごとに 1 つ（計21件）。`id` は `cat:<book>:<ch>`、`label` は `ch_title`。
- **rule**:
  - 金の文法: ルール番号ごと（82件）。`id` は `rule:kin:<rule.number>`、`label` は `rule.title`。
  - 世界一: `(ch, th_title)` の組ごと（38件）。`id` は `rule:sekai:<ch>:<連番>`、`label` は `th_title`。連番は章内の出現順。
- **concept**: `English_study/00_Concepts/` の13概念（計13件）。`id` は `con:<概念名>`、`label` は概念名（例: `SVOC（文の骨格）`）、`desc` に解説。
- **trap**: `English_study/04_Traps/` の12Trap（計12件）。`id` は `trap:<番号>`、`label` はTrapタイトル（例: `語尾の罠（-ly形容詞・-ive/-al名詞）`）、`desc` に解説、`advice` に対策。
- **question**: 問題ごと（計301件）。`id` は `q:<id>`、`label` は問題番号。親は、その問題が属する rule。
- **edges**:
  - `parent`: root → category → rule → question
  - `concept`: question → concept（全301問から該当する概念ノードへ）
  - `trap`: question → trap（該当する145問から該当するTrapノードへ）
- **総ノード数**: 469（root 2、category 21、rule 120、concept 13、trap 12、question 301）。
- 金のルール 30 は問題が章 1・3・7 にまたがっているため、親 category エッジを 3 本持つ。
- 出力は決定的にする(ソート順を固定し、同じ入力から常に同じ出力になる)。
- 金の文法の問題で `rule` が欠けている場合や、同じルール番号でタイトルが食い違う場合は、スクリプトを異常終了させる。

## 4. 理解度の計算(`js/mastery.js`)

画面や `state` に依存しない**純粋関数**として書く。ブラウザでは `<script>` で読み込み、Node のテストからも読み込めるようにする(CommonJS と `window` の両対応の小さなラッパーで、ビルドは不要)。

### 入力

- `graph`: 上記の `GRAMMAR_GRAPH`。
- `stats`: `{ [qid]: { a, c } }`(既存の `grammarStats`)。
- `weak`: `{ [qid]: { streak, added, due } }`(既存の `grammarWeakData`)。
- `now`: 現在時刻(ms)。テストのために引数で受け取る。

### 出力

ノード ID をキーとする `{ [nodeId]: NodeState }`。

```js
NodeState = {
  total,      // 配下の問題数(重複なし)
  answered,   // 解答数の合計(stats.a の和)
  correct,    // 正解数の合計(stats.c の和)
  weak,       // 苦手に入っている問題数
  due,        // うち、いま復習の期限が来ている問題数
  rate,       // (correct + 1) / (answered + 2)。解答数が少ないとき 0.5 に寄せる
  state       // 'unseen' | 'few' | 'weak' | 'due' | 'mid' | 'good'
}
```

### `state` の決め方(上から順に判定)

定数は 1 か所にまとめ、調整できるようにする。

| 順 | 条件 | state | 表示 |
|---|---|---|---|
| 1 | `answered === 0` | `unseen` | 灰色 |
| 2 | `due > 0` | `due` | 赤 + 縁取り(強調) |
| 3 | `weak > 0` または `rate < 0.6`(かつ `answered >= 3`) | `weak` | 赤 |
| 4 | `answered < 3` | `few` | 薄い青 |
| 5 | `rate >= 0.8` かつ `weak === 0` | `good` | 緑 |
| 6 | それ以外 | `mid` | 黄 |

- 集計は、そのノードの配下の `question` すべて（直接の `qids` および子孫 `qids`）を対象にする。同じ問題が複数の経路から届いても、1 回しか数えない。
- `concept` ノード（13概念）および `trap` ノード（12Trap）も、自身の `qids` に基づいて同一のロジックで集計される。これにより「受動態」「語尾の罠」等の総合弱点が即座に赤く可視化される。
- `question` ノード自身も同じ規則で判定する。
- 記録に無い問題 ID は、解答数 0 として扱う。
- `GRAMMAR_GRAPH` に存在しない問題 ID が `stats` / `weak` にあっても、エラーにせず無視する。

## 5. グラフビュー(`js/graph-view.js`)

### 公開インターフェース

`<script>` で読み込み、`window.GraphView` を 1 つだけ公開する。`index.html` の `state` には触れない。必要な値は呼び出し側から渡す。

```js
GraphView.mount(container, {
  graph,            // GRAMMAR_GRAPH
  getStats,         // () => grammarStats
  getWeak,          // () => grammarWeakData
  getQuestion       // (qid) => RAW_GRAMMAR の要素 (シート表示用)
});
GraphView.refresh();   // 記録が変わったとき、色だけ更新する
GraphView.destroy();   // 画面を離れるとき、物理シミュレーションを止める
```

### 描画と視覚デザイン

- SVG。エッジは `<line>`、ノードは `<circle>` / `<g>`。
- ノードの色は `state` から決める(4 節の表)。色はアプリのテーマ(`data-theme`)の CSS 変数を使い、既存のカラーテーマ切替に追従させる。
- ノードの半径とスタイル:
  - `concept` (13概念): 半径 22、二重リング。大ハブとして存在感を持たせる。
  - `trap` (12Trap): 半径 18、破線ストローク（警告・注意ハブ）。
  - `root`: 半径 18。
  - `category`: 半径 14。
  - `rule`: 半径 10。
  - `question`: 半径 5 の小丸（ズームイン時のみ表示）。
- エッジのスタイル:
  - `parent`: 実線（薄いグレー）
  - `concept`: 点線（テーマカラー依存）
  - `trap`: 破線（警告アクセントカラー）

### 物理配置

- `d3-force`(`forceSimulation`、`forceLink`、`forceManyBody`、`forceCenter`、`forceCollide`)を使う。
- `vendor/` に必要なファイル(d3-force、d3-dispatch、d3-quadtree、d3-timer)を**同梱**する。CDN は使わない。`sw.js` のキャッシュ対象に加える。
- シミュレーションが収まったら停止し、ドラッグしたときだけ再開する。
- 画面を離れたら必ずシミュレーションを止める(`destroy`)。

### 操作とLOD（段階表示）

- ドラッグ(ノード): ノードを動かし、つながるノードが追従する。
- ドラッグ(背景): パン。
- ピンチ・ホイール: ズーム。
- ズームレベルに応じたLOD表示:
  - 遠景: `root`, `concept`, `trap`, `category` のみ表示。
  - 中景: `rule` が追加表示。
  - 近景: `question` が追加表示。
- 絞り込みトグル:
  - 「すべて」「金の文法」「世界一」
  - 「苦手のみ」トグル: `weak` / `due` のノードとその接続先のみ抽出。
- タップ: 下から詳細シートを出す。
  - ノード種別に応じた見出しとアイコン（「普遍概念」「ひっかけトラップ」「ルール」「問題」）。
  - 状態、正答率、解答数、苦手の数。
  - 概念/Trapの場合は、解説（`desc`）とアドバイス（`advice`）。
  - 配下の問題一覧（問題文先頭、正誤状態）。
- シートは `Esc` かシートの外側のタップで閉じる。
- スマホ幅を基準にし、タップ領域は透明な当たり判定パディングを持たせる。

## 6. `index.html` への統合

- 「学習対象」のセグメント(トップの `#app-type-segments` と、絞り込みシート内の `#sheet-app-type-segments`)に `data-app="graph"` の「グラフ」を追加する。
- `setApp('graph')` のとき: 単語・文法のフィルタ、モード切替、問題カード表示、フッターを隠し、グラフ用のコンテナを表示して `GraphView.mount` を呼ぶ。他の app へ切り替えるときは `GraphView.destroy()` を呼び、コンテナを隠す。
- 既存の `setApp('vocab' | 'grammar')` の動作は変えない。
- `sw.js` の `ASSETS` に、`data/grammar_graph.js`、`js/mastery.js`、`js/graph-filter.js`、`js/graph-view.js`、`vendor/*` を追加する。
- `upload.py` の `FILES` に同じものを追加する。`tools/` と `docs/` と `tests/` は含めない。

## 7. テスト

- `tests/mastery.test.js`:
  - 境界値: 解答数 0 / 2 / 3、`rate` が 0.6 と 0.8 の前後、`due` と `weak` の優先順位。
  - 概念・Trapノードの集計: 本を跨ぐ複数問題の集約、二重カウント防止。
  - 堅牢性: グラフに無い問題 ID が記録にある場合、記録に無い問題がグラフにある場合。
- `tests/build_graph.test.js`:
  - 生成したグラフが契約を満たす(ID の一意性、全エッジの端点が存在、全ノード数469、全301問が漏れなく含まれる)。
  - 生成が決定的である(2 回生成して同じ結果)。
- `tests/graph_filter.test.js`:
  - 本別・苦手別・LOD別のノード・エッジ抽出が正しく動作すること。
- ブラウザでの確認(手動、または Playwright):
  - 「グラフ」を開いて描画される。
  - 苦手データがある状態で、該当ノード（概念・Trap含む）が赤になる。
  - ノードのタップでシートが開き、解説と問題一覧が出る。
  - オフライン(Service Worker 経由)でも開く。
  - 他の app へ切り替えても、既存の動作に影響が無い。

## 8. 完成の基準

1. オフラインでグラフが開く。
2. 間違えた問題、苦手な概念、引っかかったTrapが赤く表示される。
3. ノードをタップすると、概念解説・Trapアドバイス・正答率と紐づく問題が見える。
4. `mastery.js` と生成スクリプト、絞り込み関数のテストが通る。
5. スマホ幅で、469ノードを動かしても引っかからない。
6. 既存の単語ドリル・文法ドリルの動作が変わらない。
