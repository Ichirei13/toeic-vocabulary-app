# 文法グラフビュー「文法軸」モード設計（13 概念の円周配置）

日付: 2026-11-19 / 状態: **実装済み（2026-11-19。実機（iPhone）の確認は未実施）**

`2026-11-11-grammar-graph-view-v3-design.md`（v3）への機能追加。
現行の「教材軸（4 冊を四隅、概念・ひっかけを中央）」に加え、**文法の分類（既存の 13 概念）を円周上に均等配置（固定）して軸にする「文法軸」モード**を追加する。

## 1. 目的

現行のグラフビュー（教材軸）は、4 冊の参考書を四隅に置いて各章・ルール・問題を並べるため、教材ごとの進捗は見やすい一方、**教材の枠を超えて「文法分野ごとのまとまり・分野同士のつながり・弱点の偏り」を文法の体系として俯瞰しにくい**。

本設計では、同じデータ・同じノード集合（本・章・ルール・概念・ひっかけ・問題）のまま、配置の軸を **「教材軸」↔「文法軸」** で切り替えられるようにする。

### 利用者が決めたこと（2026-11-19）

| 内容 | 決定 |
|---|---|
| 円周に並べる軸 | 既存の 13 の「概念（Concept）」を円周上に均等配置する |
| 表示対象 | 本・章・ルール・概念・ひっかけ・問題の全ノードを残し、配置の軸だけを切り替える |
| 概念以外の配置 | 13 概念を円周上に均等配置で固定するだけにし、章・ルール・問題・本・ひっかけは力学まかせで自然に配置する |
| 初期モードと記憶 | 既定は現行の「教材軸」。最後に選んだモードをこの端末に記憶し、次回も引き継ぐ |
| 実現方式 | 案 1: 実行時レイアウトのみ（生成物 `data/grammar_graph.js` は変更しない） |

### 守ること

- 生成物 `data/grammar_graph.js` は 1 バイトも変えない。`GRAPH_LAYOUT` と既存の教材軸 `createSimulation` の挙動を変えない（`tests/build_graph.test.js` の座標再現テストをそのまま通す）。
- 起動時の読み込みを増やさない（新規ファイルは追加せず、グラフを開いたときだけ読む構成を維持する）。
- オフラインで動く（`sw.js` の `CACHE` の版を上げる）。
- 学習記録（正誤・苦手リスト）、バックアップ（`RECORD_KEYS` / `EXTRA_KEYS` / `BACKUP_FORMAT`）、Google ドライブ同期、他タブ再読込（`CROSS_TAB_KEYS`）の形式と対象を変えない。
- 力学が収まった後と移動アニメーションが終わった後は `requestAnimationFrame` を呼ばない（`CLAUDE.md` 約束 12）。
- 既存の絞り込み（教材・苦手のみ）、LOD、タップ時の周辺ハイライト、詳細シート、「近い問題を解く」の動作を、両モードで壊さない。

### やらないこと

- `data/grammar_graph.js` への文法軸座標の事前埋め込み（案 2）。
- 概念の並び順をユーザーが手作業でドラッグ並べ替えする機能。
- 文法軸専用のノード非表示ルール（本・章・ルールは隠さない）。

## 2. 変更対象ファイル

新規ファイルは増やさないため、`index.html`・`sw.js`（`ASSETS`）・`upload.py`（`FILES`）のファイル一覧の増減はない。

| ファイル | 役割 |
|---|---|
| `src/graph-force.js` | 文法軸用の定数（`GRAMMAR_CONCEPT_ORDER`・`GRAPH_GRAMMAR`）と純粋関数（`grammarInitialPositions`・`createGrammarSimulation`）を追加 |
| `js/graph-view.js` | モード状態（`'book'` / `'grammar'`）、切り替え UI、モードごとの座標キャッシュ、文法軸の力学実行・フォールバック、薄いガイド円の描画、デバッグ観測値の追加 |
| `css/graph.css` | ツールバー内のモード切り替え UI（`.graph-mode`）のスタイルと、ガイド円用の CSS 変数（`--graph-ring-guide`） |
| `home.js` | 端末限定の保存キー `toeic_graph_mode_v1` の読み書きと、`GraphView.mount` への `initialMode` / `onModeChange` 受け渡し |
| `sw.js` | `CACHE` の版を `toeic-drill-v15` → `toeic-drill-v16` に上げる |
| `tests/unit/graph-force.test.js` | 文法軸の初期配置・力学（円周固定、決定論性、概念近接、苦手引き寄せ、未知概念耐性）の単体テストを追加 |
| `tests/graph-view.test.js` | モード切替、収束後 rAF 0 回、キャッシュ往復、再配置、d3 なしフォールバック、`initialMode` / `onModeChange`、フィルター/詳細シート/近い問題併用、性能計測のテストを追加 |

## 3. モードと画面 UI

### 3.1 モードの識別子と表示名

- `'book'`: 表示名 **教材軸**（既定）
- `'grammar'`: 表示名 **文法軸**

無効な値（`initialMode` に `'book'`・`'grammar'` 以外が渡された場合など）は `'book'` として扱う。

### 3.2 切り替え UI の配置

`.graph-filter`（`role="toolbar"`）の中に、配置軸の切り替えグループを置く。

```html
<div class="graph-mode" role="group" aria-label="配置の軸">
  <button type="button" class="graph-mode-btn" data-mode="book" aria-pressed="true">教材軸</button>
  <button type="button" class="graph-mode-btn" data-mode="grammar" aria-pressed="false">文法軸</button>
</div>
```

- 既存の `.graph-chips`（`data-book`）と `.graph-weak-toggle` のクラス名・属性は変えない。
- 画面幅が広いときは 1 行、狭い画面（375px 幅など）では `.graph-filter` が 2 段に折り返して「配置の軸＋苦手のみ」と「教材チップ」がどちらも窮屈にならず押せるようにする（タップ領域の最小高さ 32px 以上）。
- `GraphView` 単体（`home.js` を介さないテストなど）でも完結して動作するよう、切り替え UI は `.graph-view` の内側に持つ。

### 3.3 ガイド円の描画

文法軸モード（`mode === 'grammar'`）の描画時のみ、エッジを描く直前に原点 `(0, 0)`・半径 `GRAPH_GRAMMAR.ringRadius` のガイド円を 1 本描く。

- 線色: CSS 変数 `--graph-ring-guide`（ライト: `rgba(60, 60, 67, 0.14)`、ダーク: `rgba(235, 235, 245, 0.16)`。`readColors()` でマウント時・テーマ変更時のみ取得し、描画中には `getComputedStyle` を呼ばない）。
- 線幅: 1px、破線 `[4, 6]`。選択ハイライト中（`focus` あり）は `DIM_EDGE` で薄くする。
- ノード・エッジ・束ねた線・ラベル・凡例・詳細シート・近い問題出題の仕様は現行 v3 と同一。

## 4. 配置と力学（`src/graph-force.js`）

### 4.1 13 概念の円周順（`GRAMMAR_CONCEPT_ORDER`）

12 時方向（角度 $-\pi / 2$）から時計回りに均等配置する。英文法の学習の流れに沿い、かつ実データで共起の多い概念同士（代名詞↔名詞、動名詞/不定詞↔名詞、比較↔関係詞、助動詞/仮定法↔時制・動名詞/不定詞、分詞↔受動態）が隣り合う順序を既定とする。

1. `con:SVOC（文の骨格）`
2. `con:能動態と受動態`
3. `con:分詞（現在分詞・過去分詞）`
4. `con:動詞の時制と相`
5. `con:助動詞・仮定法`
6. `con:動名詞 vs 不定詞`
7. `con:名詞の役割（主語・目的語・補語）`
8. `con:代名詞の格と用法`
9. `con:形容詞と副詞の修飾関係`
10. `con:関係代名詞・関係副詞`
11. `con:比較級・最上級`
12. `con:接続詞 vs 前置詞の識別`
13. `con:倒置・強調・並列構造`

グラフに含まれる `kindName[i] === 'concept'` のうち、一覧にあるものは一覧順、一覧に無いもの（将来の拡張・テスト用フィクスチャの概念など）はノード添字の昇順で末尾に並べ、全 $M$ 個に対して $k = 0, \dots, M-1$ の位置を

$$\theta_k = -\frac{\pi}{2} + \frac{2\pi k}{M}, \qquad x = R \cos\theta_k, \quad y = R \sin\theta_k$$

とする（$M = 0$ のときは固定ノードなし）。

### 4.2 初期位置の決定（`grammarInitialPositions(input, config)`）

d3-force の出発点であり、d3-force 未ロード時・計算失敗時のフォールバック配置も兼ねる純粋関数。乱数は `mulberry32(config.seed)` を使い、同じ入力から常に同じ座標を返す。

1. **概念（`concept`）**: 上記の円周座標 $(R \cos\theta_k, R \sin\theta_k)$。
2. **問題（`question`）**: `type === 1`（概念）エッジでつながる概念すべての座標の平均（重心）を求める。
   - 紐づく概念が 1 つだけの問題: 重心（その概念の位置）から原点と逆方向へ少し外側（`singleOutward`）へずらし、小さなジッターを加える。
   - 紐づく概念が 2 つ以上の問題: 重心（自然と円の内側寄りになる）に小さなジッターを加える。
   - 紐づく概念が 0 個の問題（将来の未分類データ・テスト用）: 原点 `[0, 0]` 付近にジッターで置く。
3. **ルール・章・本・ひっかけ（`rule` / `chapter` / `book` / `trap`）**:
   - 配下につながる問題ノード（`rule`/`chapter`/`book` は親子エッジをたどった配下、`trap` は `type === 2` エッジの相手）の初期位置の平均に、小さなジッターを加える。
   - 配下に問題が 0 個の場合は原点 `[0, 0]` 付近に置く。

返り値は `{ x, y, pinned }`（`pinned[i] === 1` なら固定する概念ノード）。

### 4.3 力学の定義（`GRAPH_GRAMMAR` と `createGrammarSimulation`）

既存の `GRAPH_LAYOUT`・`GRAPH_RUNTIME`・`createSimulation` は一切変更しない。文法軸用の設定 `GRAPH_GRAMMAR` と関数 `createGrammarSimulation(d3, input, config)` を追加する。

- **固定（ピン留め）**: `concept` ノードは `node.fx = x0[i]; node.fy = y0[i]` で円周上に完全固定する。
- **中心への力**: `d3.forceCenter` は**使わない**（固定ノードがある状態で `forceCenter` を使うと、非固定ノード全体が重心補正でリングからずれるため）。代わりに原点 `(0, 0)` へのごく弱い引き寄せ（`centerPull: 0.01`）を非固定ノードだけに掛け、孤立ノードの発散を防ぐ。本の四隅アンカーは使わない。
- **リンクの力（`forceLink`）**:
  - **概念リンク（`type === 1`、問題 → 概念）**: 主軸。通常 `conceptStrength: 0.45`・距離 `conceptDistance: 65`。苦手問題なら `weakConceptStrength: 0.7`・距離 `weakLinkDistance: 44`。
  - **親子リンク（`type === 0`）**:
    - `book → chapter`（親が `book`）: 本が文法クラスタを中央へ引っ張り戻さないよう弱め（`bookChapterStrength: 0.06`・距離 `bookChapterDistance: 180`）。
    - それ以外の親子（`chapter → rule` / `chapter → question` / `rule → question`）: 章・ルールが問題群に自然についてくる強さ（`parentStrength: 0.25`・距離 `parentDistance: 32`）。苦手問題につながる親子リンクは `weakParentFactor: 0.4` を掛けて、苦手問題が概念・ひっかけへ寄りやすくする。
  - **ひっかけリンク（`type === 2`、問題 → Trap）**: 通常 `trapStrength: 0.15`・距離 `trapDistance: 70`。苦手問題なら `weakTrapStrength: 0.8`・距離 `weakLinkDistance: 44`。
- **反発（`forceManyBody`）と衝突（`forceCollide`）**:
  - 種類ごとの反発（`charge`: `{ book: -320, chapter: -140, rule: -28, concept: -420, trap: -260, question: -6 }`、`chargeDistanceMax: 420`）。
  - 衝突半径は `GRAPH_LAYOUT.collideRadius` を基準とし、`hubWeak` がある概念・ひっかけには `hubCollidePerWeak * Math.sqrt(hubWeak[i])` を足す（現行 v3 と同じ考え方）。
- **実行回数と減衰**:
  - `seed: 20261119`、`ringRadius: 600`、`ticks: 140`、`alpha: 0.7`、`alphaDecay = 1 - Math.pow(0.001 / alpha, 1 / ticks)`、`alphaMin(0.001)`。
  - 実装後にデスクトップ Chromium（CPU 4 倍制限、375×812・1280×800）で収束時間と見た目を計測・確認し、必要なら `GRAPH_GRAMMAR` の係数だけを調整する。

## 5. 画面内の状態管理とキャッシュ（`js/graph-view.js`）

### 5.1 モード状態とキャッシュ

- インスタンス内の状態:
  - `mode`: `'book'` または `'grammar'`（`deps.initialMode === 'grammar'` なら `'grammar'`、それ以外は `'book'`）。
  - `modeCoords`: `{ book: null, grammar: null }`。各モードの収束済み座標 `{ x: Float64Array, y: Float64Array }` を保持する。
- **起動時**:
  - `mode === 'book'` のとき: 現行 v3 と完全に同じ（ビルド済み座標から、苦手があれば 120 tick 力学、なければ即確定して `modeCoords.book` に保存）。
  - `mode === 'grammar'` のとき（記憶から復元）: `grammarInitialPositions` を適用して 1 回描き、d3 が使えるなら `createGrammarSimulation` を分割実行して収束後に `modeCoords.grammar` へ保存。d3 が無ければ初期配置のまま即確定（`settled = true`）。
- **モード切り替え時（`setMode(next)`）**:
  1. `next === mode` なら何もしない。
  2. `stopSettle()`・`stopAnim()`・`closeSheet()` を呼ぶ。
  3. `mode = next`、ボタンの `aria-pressed` と `debug.mode` を更新し、`deps.onModeChange(mode)` があれば呼ぶ（例外は握りつぶして画面を止めない）。
  4. `interacted = false` に戻す（新しい軸の全体像を見せるため）。
  5. `modeCoords[mode]` にキャッシュがあれば、`xs` / `ys` にコピーして `finishSettle(false)`（即座に全体表示・格子再構築・1 フレーム描画。力学は回さない）。
  6. キャッシュが無ければ `startSettle()` を呼ぶ。
- **「再配置」ボタン（`relayout`）**:
  - `closeSheet()` のあと `modeCoords[mode] = null` にして `startSettle()` を呼ぶ（現在表示中のモードだけを今の記録で回し直す）。
- **`refresh()`（学習記録の更新）**:
  - 現行 v3 と同じ。色・大きさ・束ねた線・詳細シートだけを更新し、現在の配置は動かさない。
- **力学の途中中断・失敗時のリカバリ**:
  - `settle` 実行中に `mode` を切り替えた場合は `stopSettle()` で破棄するため、古いモードの結果が新モードの `modeCoords` に混ざることはない。
  - `stepSettle()` で例外や非有限座標（`NaN` / `Infinity`）が出た場合は、現在モードの安全なベース配置（`book` は `graph.x/y`、`grammar` は `grammarInitialPositions`）に戻して `finishSettle(true)` で止める。
  - `prefers-reduced-motion: reduce` が有効なときは現行同様、途中フレームを描かずに収束後だけ描く。
- **デバッグ観測値（`GraphView._debug`）**:
  - `debug.mode`（現在の `'book'` / `'grammar'`）を追加する。

## 6. 端末への記憶（`home.js`）

- 保存キー: `const GRAPH_MODE_KEY = 'toeic_graph_mode_v1';`
- 読み込み: `loadJSON(GRAPH_MODE_KEY, 'book')` を読み、`'grammar'` なら `'grammar'`、それ以外は `'book'` を `GraphView.mount` の `deps.initialMode` に渡す。
- 書き込み: `deps.onModeChange` で `saveJSON(GRAPH_MODE_KEY, mode)` を呼ぶ（`CLAUDE.md` 約束 3 準拠）。
- 隔離ルール: `RECORD_KEYS`・`EXTRA_KEYS`・`CROSS_TAB_KEYS` には**入れない**（`toeic_near_drill_v1` と同じ扱い。バックアップ・Google ドライブ同期・他タブ再読込の対象外）。
- `js/graph-view.js` は `localStorage` に直接触れない（依存は `deps` のみ）。

## 7. テストと完成の基準

### 通し続ける既存テスト
- `pytest tests -q`（ファイル一覧・データ検証）
- `node --test tests/unit/`
- `NODE_PATH=$(npm root -g) node --test tests/build_graph.test.js`（`data/grammar_graph.js` の座標完全再現）
- `NODE_PATH=$(npm root -g) node tests/storage-writes.test.js`・`tests/storage-subscribe.test.js`・`tests/data-safety.test.js`
- `NODE_PATH=$(npm root -g) node tests/graph-view.test.js`・`tests/graph-drill.test.js`

### 追加するテスト
- **単体（`tests/unit/graph-force.test.js`）**:
  - `grammarInitialPositions`: 概念ノードが半径 `R` の円周上に等間隔・指定順で配置され、全座標が有限かつ決定論的であること。
  - `createGrammarSimulation`: 収束後も概念ノードが円周上から動かないこと、同じ入力で同じ座標になること、単一概念の問題が対応概念の近くへ寄ること、苦手問題が非苦手時より概念・ひっかけへ近づくこと、未知の概念 ID があっても落ちないこと。
- **ブラウザ（`tests/graph-view.test.js`）**:
  - 初期表示は `'book'`。モードボタンで `'grammar'` へ切り替えると力学が収束し、13 概念が円周上（半径 `R`）に並び、収束後は `requestAnimationFrame` の呼び出しが 0 回で止まること。
  - 文法軸 → 教材軸 → 文法軸の往復でキャッシュが効き、再計算（`settleTicks === 0`）なしに即座に切り替わること。
  - 文法軸で「再配置」を押すと力学が再実行されること。
  - d3-force なしでも文法軸へ切り替えられ、概念リングの初期配置で落ちずに表示されること。
  - `initialMode: 'grammar'` で最初から文法軸が開き、切り替え時に `onModeChange` が呼ばれること。
  - 文法軸モードで教材絞り込み・「苦手のみ」・ノードタップによる詳細シート＆ハイライト・シート内問題タップのジャンプが動作すること。
  - `home.js` 経由の画面結合で、選択したモードが `toeic_graph_mode_v1` に保存され、再マウント後も引き継がれること。
- **性能計測・視覚確認**:
  - デスクトップ Chromium（CPU 4 倍制限、苦手 110 問、140 tick、iPhone では未計測）での実測値（`tests/graph-view.test.js`）:
    - 375×812: 収束 `2747 ms`・最長フレーム `34 ms`・1 フレーム描画 `0.9 ms`
    - 1280×800: 収束 `3225 ms`・最長フレーム `33 ms`・1 フレーム描画 `1.0 ms`
  - 375×812・1280×800 のスクリーンショットで 13 概念の円周配置、ガイド円、ツールバーの折り返し、詳細シート表示を確認済み。

### 完成の基準
1. グラフ画面の切り替え UI で「教材軸」↔「文法軸」をいつでも切り替えられる。
2. 文法軸では 13 の概念が円周上に均等配置（固定）され、他の全ノードが力学で自然に集まる。
3. 最後に選んだモードがこの端末に記憶され、次回開いたときも引き継がれる。
4. 収束後は描画が止まり、起動時のリクエスト数・`data/grammar_graph.js`・バックアップ/同期の形式が変わらない。
5. 上記の全テストが通る（既知の失敗 `tests/next-browser.cjs` を除く）。
