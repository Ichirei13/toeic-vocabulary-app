# 文法グラフ v4 対応（16 概念・副概念・解法タイプ・着眼点）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sp-executing-plans` or `sp-subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書 `docs/superpowers/specs/2026-11-24-grammar-question-analysis-design.md` に従い、`toeic_practice` のグラフ生成ツール（`tools/`）・純粋ロジック（`src/`）・UI（`js/`, `css/`）を文法グラフ v4（16 概念・18 Trap・エッジ種別 3 副概念・`solveTypes` / `qSolveType` / `qPoint`）に対応させる。

**Architecture:**
- `tools/lib/vault.mjs` / `model.mjs` / `encode.mjs` / `build_grammar_graph.mjs`: `question_analysis.json`（存在する場合）または Vault ノートから主概念（type 1）・Trap（type 2）・副概念（type 3）・解法タイプ・着眼点を読み込み、`version: 4` の `data/grammar_graph.js` を生成する。`members` 集計はエッジ種別 `0, 1, 2` のみを辿り、`3`（副概念）を除外することで概念合計 983 問を保つ。
- `src/graph-filter.js` / `graph-force.js` / `graph-near.js` / `graph-report.js` / `graph-detail.js`: 16 概念の円周・レーダー配置、副概念の弱い引力（`secondaryConceptStrength`）、近さ計算の重み付け（Trap 2.0 > 主概念 1.2 > 副概念 0.4）、問題ノード詳細へのメタデータ抽出を実装する。
- `js/graph-sheet.js` / `graph-view.js` / `radar-view.js` / `css/graph.css`: 問題ノード詳細シートに解法タイプ・主概念/副概念/Trap ジャンプチップ・1 行着眼点を表示し、レーダー見出しの概念数を動的化する。
- **後方互換性:** `English_study` 側で `question_analysis.json` を作成して `data/grammar_graph.js` を v4 へ再生成するまでの間も、既存の v3 データ（13 概念・12 Trap）で全テスト・全画面が正常動作するように保つ。

**Global Constraints:**
- テスト実行は `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && node tools/run_tests.mjs --fast`（および対象ブラウザテスト）で行う。
- コミットメッセージは英語（`feat:` / `fix:` / `test:` / `docs:`）、コードのコメント・ドキュメントは日本語とする。
- `data/grammar_graph.js` は生成物であるため手で編集しない。

---

### Task 1: 設計書のコミットと 16 概念定義の更新（`src/graph-force.js`, `src/graph-report.js`, `js/radar-view.js`）

**Consumes:** `docs/superpowers/specs/2026-11-24-grammar-question-analysis-design.md`
**Produces:** 16 概念の時計回り順定義・短縮ラベル・レーダー表示の動的概念数対応

- [ ] **Step 1: 失敗するテストを追加する**

`tests/unit/graph-report.test.js` に 16 概念の `shortConceptLabel` と `DEFAULT_CONCEPT_ORDER` の長さ（16）を検証するテストを追加し、`tests/unit/graph-force.test.js` の `GRAMMAR_CONCEPT_ORDER.length` 期待値を 16 に更新する。

```js
// tests/unit/graph-report.test.js に追加
test('shortConceptLabel & DEFAULT_CONCEPT_ORDER: 16 概念の短縮名と順序を定義する', () => {
  assert.equal(R.DEFAULT_CONCEPT_ORDER.length, 16);
  assert.equal(new Set(R.DEFAULT_CONCEPT_ORDER).size, 16);
  assert.equal(R.shortConceptLabel('動詞・形容詞の語法'), '語法');
  assert.equal(R.shortConceptLabel('助動詞'), '助動詞');
  assert.equal(R.shortConceptLabel('仮定法'), '仮定法');
  assert.equal(R.shortConceptLabel('名詞の役割（主語・目的語・補語）'), '名詞・冠詞');
  assert.equal(R.shortConceptLabel('接続詞 vs 前置詞の識別'), '接続詞');
  assert.equal(R.shortConceptLabel('前置詞のコアイメージと用法'), '前置詞');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && NODE_PATH=$(npm root -g) node --test tests/unit/graph-report.test.js tests/unit/graph-force.test.js`
Expected: FAIL (`DEFAULT_CONCEPT_ORDER.length` が 13 のため)

- [ ] **Step 3: 16 概念定義とレーダー見出しを実装する**

1. `src/graph-force.js` の `GRAMMAR_CONCEPT_ORDER` を 16 概念に更新する：
```js
  // 文法軸モード: 16 概念を 12 時から時計回りに並べる既定の順序（左右対称の 16 軸）。
  // 一覧にない概念が将来増えても、末尾に添字順で追加して等分する。
  const GRAMMAR_CONCEPT_ORDER = [
    'con:SVOC（文の骨格）',
    'con:動詞・形容詞の語法',
    'con:能動態と受動態',
    'con:分詞（現在分詞・過去分詞）',
    'con:動詞の時制と相',
    'con:助動詞',
    'con:仮定法',
    'con:動名詞 vs 不定詞',
    'con:名詞の役割（主語・目的語・補語）',
    'con:代名詞の格と用法',
    'con:形容詞と副詞の修飾関係',
    'con:関係代名詞・関係副詞',
    'con:比較級・最上級',
    'con:接続詞 vs 前置詞の識別',
    'con:前置詞のコアイメージと用法',
    'con:倒置・強調・並列構造',
  ];
```

2. `src/graph-report.js` の `CONCEPT_SHORT_LABELS` を 16 概念に更新する（v3 互換のため `'助動詞・仮定法': '助動詞・仮定法'` も残す場合は `DEFAULT_CONCEPT_ORDER` を 16 概念配列として明示定義する）：
```js
  const CONCEPT_SHORT_LABELS = {
    'SVOC（文の骨格）': 'SVOC',
    '動詞・形容詞の語法': '語法',
    '能動態と受動態': '受動態',
    '分詞（現在分詞・過去分詞）': '分詞',
    '動詞の時制と相': '時制・相',
    '助動詞': '助動詞',
    '仮定法': '仮定法',
    '助動詞・仮定法': '助動詞・仮定法', // v3 互換用
    '動名詞 vs 不定詞': '動名詞/不定詞',
    '名詞の役割（主語・目的語・補語）': '名詞・冠詞',
    '代名詞の格と用法': '代名詞',
    '形容詞と副詞の修飾関係': '形容詞・副詞',
    '関係代名詞・関係副詞': '関係詞',
    '比較級・最上級': '比較',
    '接続詞 vs 前置詞の識別': '接続詞',
    '前置詞のコアイメージと用法': '前置詞',
    '倒置・強調・並列構造': '倒置・強調',
  };
  const DEFAULT_CONCEPT_ORDER = [
    'con:SVOC（文の骨格）',
    'con:動詞・形容詞の語法',
    'con:能動態と受動態',
    'con:分詞（現在分詞・過去分詞）',
    'con:動詞の時制と相',
    'con:助動詞',
    'con:仮定法',
    'con:動名詞 vs 不定詞',
    'con:名詞の役割（主語・目的語・補語）',
    'con:代名詞の格と用法',
    'con:形容詞と副詞の修飾関係',
    'con:関係代名詞・関係副詞',
    'con:比較級・最上級',
    'con:接続詞 vs 前置詞の識別',
    'con:前置詞のコアイメージと用法',
    'con:倒置・強調・並列構造',
  ];
```

3. `js/radar-view.js` の `13文法概念のレーダーチャート` / `13 文法概念バランス` を `rep.concepts.length` を使った動的表記にする：
```js
        const conceptCount = rep.concepts.length;
        const radarSvg =
          `<svg class="graph-radar-svg${compact ? ' is-compact' : ''}" viewBox="0 0 420 330" role="img" aria-label="${esc(conceptCount)}文法概念のレーダーチャート">` +
...
              `<h3>${esc(conceptCount)} 文法概念バランス</h3>` +
```

4. `tests/unit/graph-report.test.js` の既存テスト（旧 `shortConceptLabel` の `'接続詞/前置詞'` 期待や `conceptOrder` 省略時テスト）を 16 概念仕様＋v3 互換に合わせて整理する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && node tools/run_tests.mjs --fast`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add docs/superpowers/specs/2026-11-24-grammar-question-analysis-design.md src/graph-force.js src/graph-report.js js/radar-view.js tests/unit/graph-force.test.js tests/unit/graph-report.test.js
git commit -m "feat: update concept order and radar labels to 16 concepts"
```

---

### Task 2: グラフ索引と副概念エッジ（type 3）の対応（`src/graph-filter.js`, `src/graph-force.js`）

**Consumes:** Task 1
**Produces:** `buildIndex` の副概念対応、`createGrammarSimulation` の `secondaryConceptStrength`、キャッシュ署名更新

- [ ] **Step 1: 失敗するテストを追加する**

`tests/unit/graph-filter.test.js` と `tests/unit/graph-force.test.js` に、エッジ種別 `3`（副概念）を含むフィクスチャを使ったテストを追加する：
- `buildIndex`: `secStart` / `secHubs` に `type === 3` のみが入り、`hubStart` / `hubs`（`type === 1, 2`）とは分離されること。
- `focusSet`: 問題ノードを選択したとき、副概念ノードも `1` になること。
- `createGrammarSimulation`: `secondaryConceptStrength`（`0.12`）が設定されており、単一の主概念＋副概念を持つ問題は副概念側へ少し引っ張られつつも主概念側に留まること。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && NODE_PATH=$(npm root -g) node --test tests/unit/graph-filter.test.js tests/unit/graph-force.test.js`
Expected: FAIL

- [ ] **Step 3: 実装する**

1. `src/graph-filter.js`:
   - `buildIndex(graph)` で `t === 3` を `secStart` / `secHubs` として索引化する。
   - `focusSet(graph, index, i, extraQuestionNodes)` で `k === index.kQ` のとき `secStart`〜`secHubs` も `f[...] = 1` にする。概念ノード（`k === index.kCon`）を選択したときは `members`（主概念のみ）が浮かび上がるため、副概念は集計を汚さない。
2. `src/graph-force.js`:
   - `GRAPH_GRAMMAR` に `secondaryConceptStrength: 0.12`, `secondaryConceptDistance: 100`, `weakSecondaryConceptStrength: 0.25` を追加。
   - `GRAPH_LAYOUT` に `secondaryConceptStrength: 0.008` を追加。
   - `createSimulation` で `l.type === 3` の強度を設定（`weak` 時は `runtime.weakConceptStrength * 0.4`、通常時は `config.secondaryConceptStrength ?? config.conceptStrength * 0.4`）。
   - `grammarInitialPositions` では `t === 1`（主概念）を基準に初期位置と `primaryConcept` を決めつつ、`t === 3`（副概念）がある場合は重み `0.25` で初期位置を少し副概念側へ寄せる。
   - `createGrammarSimulation` で `l.type === 3` に `secondaryConceptStrength` / `secondaryConceptDistance` を適用する。
   - `grammarLayoutSignature` に新パラメータを含める。

- [ ] **Step 4: テストが通ることを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && node tools/run_tests.mjs --fast`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/graph-filter.js src/graph-force.js tests/unit/graph-filter.test.js tests/unit/graph-force.test.js
git commit -m "feat: support secondary concept edges (type 3) in index and force layout"
```

---

### Task 3: 近い問題推薦の重み刷新（`src/graph-near.js`）

**Consumes:** Task 2 (`index.secStart`, `index.secHubs`)
**Produces:** Trap (2.0) > 主概念 (1.2) > 副概念 (0.4) の類似問題スコアリング

- [ ] **Step 1: 失敗するテストを追加・更新する**

`tests/unit/graph-near.test.js` に、主概念（1.2）・Trap（2.0）・副概念（0.4）の重み比率と、副概念を共有する問題より主概念を共有する問題が上位に来ることを検証するテストを追加し、既存テストの期待値を新重み（`conceptBase: 1.2`, `trapBase: 2.0`, `secondaryConceptBase: 0.4`）に合わせる。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && NODE_PATH=$(npm root -g) node --test tests/unit/graph-near.test.js`
Expected: FAIL

- [ ] **Step 3: `src/graph-near.js` を更新する**

- `NEAR` 定数を更新:
```js
  const NEAR = {
    count: 30,
    poolFactor: 3,
    trapBase: 2.0,
    conceptBase: 1.2,
    secondaryConceptBase: 0.4,
    ruleWeight: 1.5,
    chapterWeight: 0.3,
  };
```
- `hubWeights` に加え、副概念用の重み（`conceptBase` の代わりに `secondaryConceptBase` を掛けた重み `wSec`）を計算し、`nearScores` で `index.hubStart` / `index.hubs` と `index.secStart` / `index.secHubs` の両方を加算する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && node tools/run_tests.mjs --fast`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/graph-near.js tests/unit/graph-near.test.js
git commit -m "feat: weight traps (2.0), primary (1.2), and secondary concepts (0.4) in near scoring"
```

---

### Task 4: 問題ノード詳細データとシート UI の拡張（`src/graph-detail.js`, `js/graph-sheet.js`, `js/graph-view.js`, `js/radar-view.js`, `css/graph.css`）

**Consumes:** Task 2 (`edges` の種別 1, 2, 3), `data/grammar_graph.js` v4 メタデータ (`solveTypes`, `qSolveType`, `qPoint`)
**Produces:** 問題ノードを開いたときの解法タイプ・主概念/副概念/Trap ジャンプチップ・1 行着眼点表示

- [ ] **Step 1: 失敗するテストを追加する**

`tests/unit/graph-detail.test.js` に v4 フィールド（`edges`, `solveTypes`, `qSolveType`, `qPoint`）を持つミニグラフで `buildDetail(g, m, qIdx, ctx)` を呼び、以下が返ることを検証するテストを追加する：
- `d.solveType === '文構造'`
- `d.point === '空欄の前後から主語と動詞の対応を見抜く'`
- `d.primaryConcept` に `{ nodeIndex, id, label }`
- `d.secondaryConcepts` に `[{ nodeIndex, id, label }]`
- `d.traps` に `[{ nodeIndex, id, label }]`

- [ ] **Step 2: テストが失敗することを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && NODE_PATH=$(npm root -g) node --test tests/unit/graph-detail.test.js`
Expected: FAIL

- [ ] **Step 3: `src/graph-detail.js` と UI を実装する**

1. `src/graph-detail.js`:
   - `kindName === 'question'` のとき、`qids.indexOf(graph.qid[nodeIndex])` で問題序数 `ord` を求め、`graph.solveTypes` / `graph.qSolveType` と `graph.qPoint` から `detail.solveType` と `detail.point` を設定する（存在しない場合や `-1` / 空文字は設定しない）。
   - `graph.edges` から `edges[k] === nodeIndex` のエッジを走査し、`type === 1` → `detail.primaryConcept`、`type === 3` → `detail.secondaryConcepts`、`type === 2` → `detail.traps` に `{ nodeIndex: target, id: graph.id[target], label: graph.label[target] }` を格納する。
2. `js/graph-sheet.js`:
   - `render(c)` で `d.solveType`・`d.point`・`d.primaryConcept`・`d.secondaryConcepts`・`d.traps` があれば、`.graph-stats` の直後に `.graph-q-meta` ブロックを描画する。
   - 各チップは `<button type="button" class="graph-tag-chip is-primary|is-secondary|is-trap" data-jump-node="${item.nodeIndex}">` とし、クリック時に `opts.onJumpNode(nodeIndex)` を呼ぶ。
3. `js/graph-view.js` と `js/radar-view.js`:
   - `GraphSheet.create` のオプションに `onJumpNode: node => jumpTo(node)`（`graph-view.js`）、`onJumpNode: node => openSheet(node)`（`radar-view.js`）を渡す。
   - `js/graph-view.js` のガイド円コメント・描画で副概念エッジ（`t === 3`）も描画対象に含める（`edgesByType` を 4 種 `[[], [], [], []]` に拡張し、副概念は薄い破線・細い線で描く）。
4. `css/graph.css`:
   - `.graph-q-meta`, `.graph-solve-badge`, `.graph-point`, `.graph-tag-chips`, `.graph-tag-chip`（`.is-primary`, `.is-secondary`, `.is-trap`）のスタイルを追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && node tools/run_tests.mjs --fast`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/graph-detail.js js/graph-sheet.js js/graph-view.js js/radar-view.js css/graph.css tests/unit/graph-detail.test.js
git commit -m "feat: show solve type, point, and clickable concept/trap chips in question sheet"
```

---

### Task 5: グラフ生成パイプラインの v4 対応（`tools/lib/vault.mjs`, `tools/lib/model.mjs`, `tools/lib/encode.mjs`, `tools/build_grammar_graph.mjs`）

**Consumes:** `English_study/question_analysis.json`（存在時）または Vault ノート
**Produces:** `version: 4` の `data/grammar_graph.js` を生成できるビルドパイプライン

- [ ] **Step 1: 失敗するテストを追加する**

`tests/build_graph.test.js` に v4 仕様のテストを追加する：
- `buildModel`: `byApp` の項目が `primaryConceptId`, `secondaryConceptIds`, `trapIds`, `solveType`, `point` を持つとき、`edges` に `[qi, ci, 1]`（主概念）と `[qi, si, 3]`（副概念、主概念と重複しない）が生成され、`model.qMeta` に `solveType` と `point` が保持されること。
- `encodeGraph`: `version: 4` が出力され、`solveTypes`, `qSolveType`, `qPoint` が含まれること。また、**`edges` の種別 `3`（副概念）は概念ノードの `members` に含まれないこと**。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && NODE_PATH=$(npm root -g) node --test tests/build_graph.test.js`
Expected: FAIL

- [ ] **Step 3: ビルドツールを更新する**

1. `tools/lib/model.mjs`:
   - `SECONDARY_CONCEPT_EDGE = 3` を定義。
   - `byApp.get(q.id)` について：
     - `primaryConceptId` があればそれ、無ければ `conceptIds[0]` を `CONCEPT_EDGE (1)` として追加。
     - `secondaryConceptIds` があればそれ、無ければ `conceptIds.slice(1)` を `SECONDARY_CONCEPT_EDGE (3)` として追加（主概念と同じ ID はスキップ）。
     - `trapIds` を `TRAP_EDGE (2)` として追加。
     - `solveType`（文字列または `''`）と `point`（文字列または `''`）を `qMeta` 配列（または Map）に保持。
2. `tools/lib/encode.mjs`:
   - `questionsUnder` の `linked` 収集を `if (t === 1 || t === 2) linked[b].push(a);` に限定（`t === 3` の副概念エッジは `members` に含めない）。
   - `solveTypes`, `qSolveType`, `qPoint` を構築して `graph` オブジェクトへ出力し、`version: 4` とする。
3. `tools/build_grammar_graph.mjs`:
   - `opts.vaultDir` 直下の `question_analysis.json` を確認し、存在すれば読み込んで `app_id` ごとに `primary_concept`, `secondary_concepts`, `traps`, `solve_type`, `point` を `matched.byApp` へ反映する（存在しない場合は従来どおり Vault ノートのリンクのみを使う）。

- [ ] **Step 4: テストが通ることを確認する**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && node tools/run_tests.mjs --fast`
Expected: PASS

- [ ] **Step 5: ブラウザテストも含めて全テストを確認・コミットする**

Run: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && node tools/run_tests.mjs graph radar`
Expected: PASS

```bash
git add tools/lib/model.mjs tools/lib/encode.mjs tools/build_grammar_graph.mjs tests/build_graph.test.js
git commit -m "feat: upgrade grammar graph builder and encoder to v4 schema"
```

---

### 引き継ぎ・次のステップ（`English_study` 側との接続後）
1. `English_study` フォルダを接続し、`question_analysis.json`（全 983 問の精査結果）を作成・確定する。
2. `English_study` の Vault（`00_Concepts/`, `04_Traps/`, `03_Questions/`）を更新する。
3. `node tools/build_grammar_graph.mjs /Users/reiji/projects/English_study` を実行して `data/grammar_graph.js`（v4）を再生成する。
4. `tests/build_graph.test.js` および `tests/unit/graph-*.test.js` の実データ期待値を v4 実データに合わせて更新し、全テストを実行して完了する。
