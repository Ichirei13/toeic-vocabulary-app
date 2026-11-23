# レーダーを専用ページに分ける設計

日付: 2026-11-23 / 状態: 実装済み（2026-11-23。実機 iPhone の確認は未実施）

`2026-11-20-grammar-graph-radar-mode-design.md` の続き。レーダーチャートは文法グラフの画面の 3 つ目のモード（`js/graph-view.js` の `radar`）として作ったが、
よく使われるので、重いグラフとは別のページ `radar` に分ける。

## 1. 目的

- レーダーを開くときに、グラフ本体（`js/graph-view.js` 87KB）・`graph-filter` / `graph-geometry` / `graph-near`・d3-force と力の定義（`src/graph-force.js`）を読まない。
  Canvas と配置の前処理（索引・束ねた線・力学）もしない。
- ホームと復習の画面から、レーダーのページへ直接行けるようにする。

## 2. 画面

- 新しいページ `radar`（`#radar-page`。`APP_PAGES` に足す。`#radar` のハッシュでも開く）。上のタブ・下のバーには足さない。
- 見出し行は「← 戻る」と題名「レーダー」と「グラフ」ボタン（グラフのページを開く）。戻る先は開いたページ（ホーム・復習。ハッシュで直接開いたときはホーム）。
  グラフから戻ってきたときは戻る先を変えない（復習 → レーダー → グラフ → 戻る → レーダー → 戻る で復習に戻る）。
- 中身は今のレーダーと同じ: 教材チップ・「苦手のみ」、スコア、13 概念のレーダー、項目別の横棒（文法概念・ひっかけ・教材別、標準順・弱い順、内訳の色分け）、詳細シート（テーマの全問／苦手と未着手を解く）。
- 入口（ボタンはどれも同じ色。主ボタンの `solve` は「苦手を解く」の赤なので使わない）:
  - ホーム（文法のタブ）のカード: 「レーダー」と「グラフ」の 2 つ。題名は「🕸 文法グラフ」のまま（正答率・苦手の数の表示も今のまま）。
  - 復習の「🕸 文法グラフ」の欄: 「レーダーを開く」と「グラフを開く」。
  - グラフのページの見出し行: 「レーダー」ボタン。
- グラフのページのモードは「教材軸 / 文法軸」の 2 つにする。`toeic_graph_mode_v1` に `radar` が残っていれば教材軸で開く（値は書き換えない。次にモードを選んだときに上書きされる）。

## 3. シートの問題をタップしたとき

今は同じ画面の中で教材軸に切り替えてその問題へ移動していた。新しいページでは、グラフのページを開いてその問題へ移動する
（`GraphView.mount` の `deps.initialJumpNode`。指定があれば教材軸・絞り込みなしで開き、配置が収まったらその問題へ移動してシートを開く）。
グラフのページの「← 戻る」はレーダーへ戻る。

## 4. 部品の分け方

| ファイル | 役割 |
|---|---|
| `js/graph-sheet.js`（新規） | 下から出る詳細シート（`window.GraphSheet`）。DOM・高さ（つまみ・広げる・覚えた高さ）・閉じる（×・Esc・下へはじく）・問題一覧・出題ボタン。グラフとレーダーで共用 |
| `js/radar-view.js`（新規） | レーダーのページの中身（`window.RadarView`。`mount` / `refresh` / `destroy` / `_debug`）。`requestAnimationFrame` もタイマーも使わない |
| `js/graph-view.js` | レーダーのモードを外し、シートを `GraphSheet` に任せる。`deps.initialJumpNode` を足す |
| `home.js` | ページ `radar` の作成・読み込み・マウント・片付け、入口のボタン、記録の読み込み直しで `RadarView.refresh()` |
| `js/grammar-drill.js` | テーマの演習（`kind: 'theme'`）を解き終えたときのボタンを「レーダーに戻る」にして、レーダーのページへ戻す |

レーダーのページで読むファイル（開いたときだけ。`index.html` には書かない）:
`css/graph.css`・`data/grammar_graph.js`・`src/mastery.js`・`src/graph-detail.js`・`src/graph-report.js`・`js/graph-sheet.js`・`js/radar-view.js`。
グラフのページは、今の一覧の `js/graph-view.js` の前に `js/graph-sheet.js` を足す。共通のファイルは一度読めば二度読まない（`insertGraphAsset` の今の仕組み）。

概念の並び順は `src/graph-force.js` の `GRAMMAR_CONCEPT_ORDER` を読まず、`src/graph-report.js` の `DEFAULT_CONCEPT_ORDER` を使う（2026-11-23 時点で同じ並び。単体テストで同じことを確かめる）。

## 5. 変えないもの

- 学習記録・バックアップ・Google ドライブ同期・別タブへの反映の形式と対象。新しい保存キーは作らない。
- テーマの演習の仕組み（`state.nearDrill`・`toeic_near_drill_v1`・`kind: 'theme'`）。
- レーダーの見た目と集計（`src/graph-report.js`・`css/graph.css` のレーダーの部分）。
- シートの高さの記憶（`toeic_sheet_heights_v1` の「グラフの詳細」。レーダーのシートも同じ高さを使う）。
- 起動時のリクエスト数（`STARTUP_REQUESTS_BASELINE`）。

## 6. 公開とオフライン

`sw.js` の `ASSETS` に `js/graph-sheet.js`・`js/radar-view.js` を足し、`CACHE` を `toeic-drill-v23` にする。
