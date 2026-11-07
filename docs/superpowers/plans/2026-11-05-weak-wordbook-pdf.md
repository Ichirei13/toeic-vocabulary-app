# 苦手単語帳PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 苦手リストのシートから、選んだモードの苦手単語を、紙向けの単語帳（暗記ページ＋任意で確認テスト・答え）として印刷／PDF保存できるようにする。

**Architecture:** DOM に触らない純粋ロジックと HTML 生成を `src/wordbook.js`（`StudyCore.*`、Node で単体テスト）に置く。画面側の `js/weak-print.js` は、別タブを開いて HTML を書き込み、印刷ダイアログを出すだけ。オプション2つ（赤字・確認テスト）は `state` と既存の設定保存（`settingsSnapshot` / `restoreSettings`）に載せる。

**Tech Stack:** 素の JavaScript（ビルドなし）、Node 標準テストランナー（`node --test`）、Playwright（Chromium）、pytest。

**Spec:** `docs/superpowers/specs/2026-11-05-weak-wordbook-pdf-design.md`

## Global Constraints

- 用紙は A4 縦。`@page { size: A4 portrait; margin: 15mm 10mm 15mm 20mm; }`
- 色の強制印刷: `print-color-adjust: exact` と `-webkit-print-color-adjust: exact`
- 1セット = 最大30語。1ページ = 15行 × 左右2ブロック（行は常に30。語が足りない分は空の行で埋める）
- 行の高さ: 暗記ページ・確認テスト 15mm、答えページ 9mm
- 意味が20文字を超える語は、その行だけ文字を小さくする（行の高さは変えない）
- 赤字の色は朱赤 `#e0301e`。赤字は暗記ページと答えページの日本語だけ。確認テストの日本語は常に黒字
- 品詞の略記: 名詞→名、動詞→動、形容詞→形、副詞→副、動詞句→動句、名詞句→名句、形容詞句→形句、表現→句、句・表現→句。知らない品詞はそのまま
- 暗記ページの並びは復習日が近い順（同日なら追加日の古い順、さらに同じなら見出し語のABC順）。確認テストは乱数で並べ替え、答えページはテストと同じ並び
- オプションの既定はどちらもオン。保存値が真偽値でなければオン
- 苦手の記録（`state.weakByMode`）は読むだけで、変更しない。文法の苦手は対象外
- 新しいファイルは `index.html`・`sw.js` の ASSETS・`upload.py` の FILES の3か所に足す。`sw.js` の `CACHE` は `toeic-drill-v8` → `toeic-drill-v9`
- コミットは、自分が変えたファイルを1つずつパスで `git add` する（`git add -A` と `git add .` は使わない）。作業ツリーには、ほかの変更（今は `js/shell-chrome.js`、`tests/shell.test.js`）がある。自分が編集する既存ファイルに、すでに他の未コミットの変更があるときは、編集せずに止めて報告する
- Python は `python3`、テストは README の書き方どおり

## Review Focus

1. 語数が29・30・31・60のとき、セットの分け方と空の行の埋め方が崩れない（Task 1・2）
2. 意味が65文字（データの最長）の語を30語並べても、A4で3ページ（確認テストなしなら1ページ）に収まる（Task 5）
3. 見出し語・意味に `<` `&` `"` が入っていても、HTMLが壊れず、タグとして解釈されない（Task 2）
4. 保存された設定が壊れている（文字列・null・片方だけ）ときも、オンに戻って動く（Task 3）
5. ポップアップをブロックされたとき、何も起きないのではなく、メッセージが出る（Task 4）

---

### Task 1: 純粋ロジック（並べ替え・分割・品詞・オプションの正規化）

**Files:**
- Create: `src/wordbook.js`
- Test: `tests/unit/wordbook.test.js`

**Interfaces:**
- Produces（`StudyCore` に出す。`src/pace.js` と同じ UMD 形式で、node では `require` で使う）:
  - `shortPos(p: string) -> string`
  - `normalizeOptions(v: unknown) -> { red: boolean, test: boolean }`
  - `selectItems(weakData: {[key]: entry}, words: Array<{w, m, p}>) -> Array<{ key, entry, word }>` — `words` にないキーは捨てる。見出し語の検索は `Map` で行う
  - `sortByDue(items) -> items`（新しい配列。元は変えない）
  - `chunk(items, size = 30) -> items[][]`
  - `shuffle(items, rng = Math.random) -> items`（新しい配列。i を末尾から 1 まで、`j = Math.floor(rng() * (i + 1))` と入れ替えるフィッシャー–イェーツ）

- [ ] **Step 1: 失敗するテストを書く（`tests/unit/wordbook.test.js`）**

`const W = require('../../src/wordbook.js');` で読み、ヘルパは `word = (w, m = '意味', p = '名詞') => ({ w, m, p })` と `entry = (due, added = 0) => ({ streak: 0, added, due, u: 0 })`。テストは次の6つ。

- `shortPos`: 上の略記表の10通り（前置詞 → 前置詞 のように知らない品詞はそのまま）を `assert.strictEqual`。
- `normalizeOptions`: `{ red: false, test: true }` → そのまま。`{ red: 'no', test: null }`、`undefined`、`'x'` → `{ red: true, test: true }`。`{ test: false }` → `{ red: true, test: false }`。
- `selectItems`: `selectItems({ apple: entry(1), ghost: entry(2) }, [word('apple'), word('pear')])` のキーは `['apple']`。`items[0].word.w === 'apple'`、`items[0].entry.due === 1`。
- `sortByDue`: `[{key:'b',entry:entry(2,5)}, {key:'a',entry:entry(2,5)}, {key:'c',entry:entry(1,9)}, {key:'d',entry:entry(2,1)}]` のキー順は `['c','d','a','b']`。元の配列は変わらない（コピーと `deepStrictEqual`）。
- `chunk`: 長さ 0・29・30・31・60 の配列を分けた各グループの長さが、`[]`・`[29]`・`[30]`・`[30,1]`・`[30,30]`。
- `shuffle`: `shuffle([1,2,3,4,5], () => 0)` は `[2,3,4,5,1]`。`Math.random` のときも、結果を並べ直すと元と同じ組になり、元の配列は変わらない。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test tests/unit/wordbook.test.js`
Expected: FAIL（`Cannot find module '../../src/wordbook.js'`）

- [ ] **Step 3: `src/wordbook.js` に上の6関数を実装する**

冒頭は `src/pace.js` と同じ UMD 形式（`StudyCore` に `Object.assign`）。コメントは同ファイルと同じ密度で、日本語。品詞の略記は定数のオブジェクトで持つ。

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test tests/unit/`
Expected: 既存のテストも含めて PASS

- [ ] **Step 5: コミット（設計書とこの計画も、ここで一緒に入れる）**

```bash
git add src/wordbook.js tests/unit/wordbook.test.js docs/superpowers/specs/2026-11-05-weak-wordbook-pdf-design.md docs/superpowers/plans/2026-11-05-weak-wordbook-pdf.md
git commit -m "feat: wordbook helpers (sort, chunk, shuffle, short POS, options)"
```

---

### Task 2: 印刷用HTMLの生成（`buildDocument`）

**Files:**
- Modify: `src/wordbook.js`
- Test: `tests/unit/wordbook.test.js`

**Interfaces:**
- Consumes: Task 1 の `shortPos`、`chunk`、`shuffle`、`normalizeOptions`
- Produces: `buildDocument({ items, modeLabel, date, options }) -> string`
  - `items` は、並べ替え済みの `{ key, entry, word }` の配列。`options` は `{ red, test }`（`normalizeOptions` を通す）。`date` は出力日の文字列（呼ぶ側が作る）
  - 返すのは `<!doctype html>` から始まる完全なHTML（`<meta charset>`、`<title>`、`<style>` を含む）
  - **マークアップの約束**（テストとCSSが使う）:
    - ページ: `<section class="page" data-kind="study|test|answer" data-set="n">`。セットごとに、`study`、（`options.test` なら）`test`、`answer` の順
    - 行: `<div class="row" data-w="見出し語">`。空の行は `<div class="row empty">`（`data-w` なし）。各ページは左右のブロックに15行ずつ、合計30行
    - 日本語のセル: `class="ja"`。赤字にするセルには `ja-red` を足す（`study` と `answer` のページで `options.red` のときだけ。`test` には付けない）。意味が20文字を超えるときは `long` を足す
    - ヘッダー: 「TOEIC 苦手単語帳（モード名）」、出力日、`セット n/N`、通しの `p. x/全体`。ページの種類は `<span class="kind">暗記|テスト|答え</span>`（確認テストがオフのときは出さない）
    - 文字はすべて HTML エスケープする（`& < > " '`）

- [ ] **Step 1: 失敗するテストを書く**

ヘルパは `mk = n => 長さ n の [{ key: 'w'+i, entry: {...}, word: { w: 'w'+i, m: '意味'+i, p: '名詞' } }]`、`opts = (red, test) => ({ red, test })`、`pages = html => (html.match(/<section class="page"/g) || []).length`。`buildDocument` の引数は `{ items, modeLabel: '英→日', date: '2026-11-05', options }`。

- `ページ数`: 語数 1・30・31・60 で、確認テストオンは 3・3・6・6 ページ、オフは 1・1・2・2 ページ。語数 0 は 0 ページ。
- `ページの種類の順`: 31語・テストオンで `data-kind` の並びが `study,test,answer,study,test,answer`。テストオフでは `study,study`。
- `行`: 31語・テストオンの各セクション（`html.split('<section ')` で分ける）で、`class="row` の出現が 30。`data-w=` の数は、セット1の3ページが 30、セット2の3ページが 1。
- `テストと答えの並び`: セクションごとに `data-w` を取り出し、`test` と `answer` が同じ並びで、`study` と並べ直すと同じ組になる（30語）。
- `赤字`: 31語で `ja-red` を持つセルの数（`/class="ja[^"]*\bja-red\b/g`）が、赤オン・テストオンで 62、赤オン・テストオフで 31、赤オフで 0。`data-kind="test"` のセクションには、赤オンでも `ja-red` が出ない。
- `長い意味`: 意味が20文字の語には `long` が付かず、21文字の語には付く（`html.split('data-w="')` で語ごとに切って確かめる。テストオフで1ページ分）。
- `エスケープ`: 見出し語 `<b>&"x`、意味 `a'b` を入れると、HTML に生の `<b>&"x` が含まれず、`&lt;b&gt;&amp;&quot;x` と `a&#39;b` が含まれる。
- `ヘッダー`: 31語・テストオンで `セット 2/2`、`英→日`、`2026-11-05`、`暗記`、`テスト`、`答え` が含まれる。テストオフでは `class="kind"` が含まれない。
- `CSS`: `size: A4 portrait`、`margin: 15mm 10mm 15mm 20mm`、`print-color-adjust: exact`、`#e0301e` が含まれる。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test tests/unit/wordbook.test.js`
Expected: FAIL（`buildDocument is not a function`）

- [ ] **Step 3: `buildDocument` を `src/wordbook.js` に実装する**

内部に、エスケープ関数、1ブロック（15行）を作る関数、1ページを作る関数、CSS の定数を持つ。`chunk` で30語ごとに分け、確認テストが必要なら `shuffle` で並べ替えた同じ配列を `test` と `answer` の両方に使う。1ブロックの幅は約87mm（本文幅180mm、ブロックの間隔6mm）。暗記ページの行は2段（上段に「番号・英語＋品詞・日本語」、下段に周回チェック □□□ とメモ罫線）。英語と日本語の境目に薄い点線の折り線を引く。ページの区切りは `break-after: page`（最後のページを除く）。

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test tests/unit/`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/wordbook.js tests/unit/wordbook.test.js
git commit -m "feat: build the printable wordbook document (study, test, answer pages)"
```

---

### Task 3: オプションの状態と保存

**Files:**
- Modify: `js/word-stats.js`（`state` の初期値、`weakListMode` の直後）
- Modify: `js/settings.js`（`settingsSnapshot()` のキー、`restoreSettings()` の末尾）
- Create: `tests/wordbook-ui.test.js`（`tests/sheets.test.js` の先頭〜`withPage`、下の実行部分と同じ作りで）

**Interfaces:**
- Consumes: Task 1 の `StudyCore.normalizeOptions`（この時点では `index.html` に `src/wordbook.js` がまだ無いので、Task 4 で読み込む。**この Task のテストは Task 4 の読み込みを足したあとで通る**ため、Step 3 で `index.html` に `src/wordbook.js` の script だけ先に足す）
- Produces: `state.wordbookRed: boolean`、`state.wordbookTest: boolean`（既定 `true`）。`toeic_settings` に保存される

- [ ] **Step 1: 失敗するテストを書く（`tests/wordbook-ui.test.js`）**

ハーネスは `tests/sheets.test.js` と同じ（静的サーバ、`withPage(storage, fn)`、`tests` 配列、実行部分、`pageErrors`）。冒頭の実行方法のコメントは `NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js`。テストは次の3つ。

- `wordbook_options_default_to_on`: `withPage({})` で `state.wordbookRed === true` かつ `state.wordbookTest === true`。
- `wordbook_options_restore_booleans_and_ignore_garbage`: `withPage({ toeic_settings: JSON.stringify({ wordbookRed: false, wordbookTest: 'x' }) })` で `wordbookRed === false`、`wordbookTest === true`。さらに `{ wordbookRed: null }` のときは `true`。
- `wordbook_options_are_saved_with_settings`: ページで `state.wordbookRed = false; saveSettings();` のあと、`JSON.parse(localStorage.getItem('toeic_settings')).wordbookRed === false`。

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js`
Expected: 3件とも FAIL（`undefined`）

- [ ] **Step 3: 実装する**

- `js/word-stats.js`: `state` に `wordbookRed: true, // 単語帳PDFで日本語を赤字にする` と `wordbookTest: true // 単語帳PDFに確認テストをつける` を足す（`weakListMode` の行の末尾のカンマに注意）。
- `js/settings.js`: `settingsSnapshot()` の `keys` に `'wordbookRed'`, `'wordbookTest'` を足す。`restoreSettings()` の末尾（`weakSort` の次）で `const o = StudyCore.normalizeOptions({ red: saved.wordbookRed, test: saved.wordbookTest }); state.wordbookRed = o.red; state.wordbookTest = o.test;`。
- `index.html`: `<script src="src/pace.js"></script>` の次の行に `<script src="src/wordbook.js"></script>` を足す。

- [ ] **Step 4: 通ることを確かめる**

Run: `NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js`
Expected: `3/3 tests passed`

- [ ] **Step 5: コミット**

```bash
git add js/word-stats.js js/settings.js index.html tests/wordbook-ui.test.js
git commit -m "feat: persist the wordbook options (red text, confirmation test)"
```

（`index.html`、`sw.js`、`upload.py` の登録は Task 4 でまとめて仕上げる。この時点で `tests/test_file_lists.py` は `src/wordbook.js` が ASSETS にないため失敗する。Task 4 の完了まで、そのテストは実行しない）

---

### Task 4: ボタン・オプションのチップ・印刷、ファイル一覧への登録

**Files:**
- Create: `js/weak-print.js`
- Modify: `js/weak-list.js`（`renderWordWeakList()` と末尾の委譲ハンドラ）
- Modify: `index.html`（`js/weak-list.js` の次に `js/weak-print.js`、読み込み順のコメントの4番の並びに `weak-print` を足す）
- Modify: `sw.js`（ASSETS に `src/wordbook.js`（`src/pace.js` の次）と `js/weak-print.js`（`js/weak-list.js` の次）、`CACHE` を `toeic-drill-v9` に）
- Modify: `upload.py`（FILES に同じ2つ）
- Test: `tests/wordbook-ui.test.js`

**Interfaces:**
- Consumes: `StudyCore.selectItems / sortByDue / buildDocument`、`state.weakListMode`、`state.wordbookRed / wordbookTest`、`wordWeak(mode)`、`RAW_WORDS`、`MODE_LABELS`、`saveSettings()`、`showToast(message)`（`js/util.js`）
- Produces: `openWordbook(): void`（`js/weak-print.js`）。シートの中の `[data-wordbook-opt="red"|"test"]`（チップ。`active` で状態を示す）と `[data-wordbook-print]`（ボタン）

- [ ] **Step 1: 失敗するテストを書く（`tests/wordbook-ui.test.js` に追加）**

ヘルパ: `seed = page => page.evaluate(() => { const t = Date.now(); state.weakByMode.e2j.affordable = { streak: 0, added: t, due: t, u: t }; state.weakByMode.e2j.announce = { streak: 0, added: t, due: t, u: t }; state.weakListMode = 'e2j'; toggleWeakList(); })`。`stubOpen = page => page.evaluate(() => { window.__wb = { html: '', printed: false }; window.open = () => ({ document: { write(h) { window.__wb.html += h; }, open() {}, close() {} }, focus() {}, print() { window.__wb.printed = true; } }); })`。

- `wordbook_controls_appear_only_when_there_are_weak_words`: 苦手なしで `toggleWeakList()` → `[data-wordbook-opt]` が 0 個、`[data-wordbook-print]` が 0 個。`seed` のあとは 2 個と 1 個。
- `wordbook_chips_toggle_and_persist`: `seed` のあと、`[data-wordbook-opt="red"]` を押すと `state.wordbookRed === false`、シートが描き直されたあとのそのチップに `active` がなく、`toeic_settings.wordbookRed === false`。`[data-wordbook-opt="test"]` も同様。
- `wordbook_print_writes_the_document_and_prints`: `seed`、`stubOpen`、`[data-wordbook-print]` をクリック。400ms 待って、`__wb.html` に `affordable` と `announce` と `ja-red` が含まれ、`<section class="page"` が 3 個、`__wb.printed === true`。確認テストのチップをオフにして同じ操作をすると、`<section class="page"` が 1 個。赤字のチップをオフにすると `ja-red` が含まれない。
- `wordbook_popup_blocked_shows_a_message`: `seed` のあと `window.open = () => null`、`window.showToast = m => { window.__toast = m; }` にして、`[data-wordbook-print]` をクリック。`window.__toast` に `ポップアップ` が含まれる。

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js`
Expected: 追加した4件が FAIL（要素がない）

- [ ] **Step 3: 実装する**

- `js/weak-print.js`: `openWordbook()`。モードは `state.weakListMode`。`items = StudyCore.sortByDue(StudyCore.selectItems(wordWeak(mode), RAW_WORDS))` が空なら何もしない。`window.open('', '_blank')` はクリックの中で同期的に呼ぶ（`await` の後ろに置かない）。`null` なら `showToast('別タブを開けませんでした。ポップアップを許可してください')` して終わる。開けたら `w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);`。`html` は `StudyCore.buildDocument({ items, modeLabel: MODE_LABELS[mode], date: 今日（現地時間の YYYY-MM-DD）, options: { red: state.wordbookRed, test: state.wordbookTest } })`。冒頭のコメントで、前提（`src/wordbook.js` と `weak-list.js` のあとに読む）を書く。
- `js/weak-list.js`: `renderWordWeakList()` で、並び替えの行のあとに、チップ2つ（「日本語を赤字」`data-wordbook-opt="red"`、「確認テスト」`data-wordbook-opt="test"`。状態が真なら `active`）と、`<button class="chip" data-wordbook-print>単語帳PDF</button>` の行を出す（`filter-row` を使う）。末尾の委譲ハンドラに、`[data-wordbook-opt]` のクリック（`state.wordbookRed` / `state.wordbookTest` を反転 → `saveSettings()` → `renderWeakList()`）と、`[data-wordbook-print]` のクリック（`openWordbook()`）を足す。
- `index.html`、`sw.js`、`upload.py`: 上の Files の記述どおり。

- [ ] **Step 4: テストを通す**

Run: `NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js`
Expected: `7/7 tests passed`（Task 3 の3件を含む）

Run: `python3 -m pytest tests/test_file_lists.py -v`
Expected: PASS

Run: `NODE_PATH=$(npm root -g) node tests/sheets.test.js`
Expected: 全件 PASS（苦手リストのシートの既存の動きが壊れていない）

- [ ] **Step 5: コミット**

```bash
git add js/weak-print.js js/weak-list.js index.html sw.js upload.py tests/wordbook-ui.test.js
git commit -m "feat: wordbook PDF button and options in the weak list sheet"
```

---

### Task 5: 紙面の確認（PDFのページ数）と仕上げ

**Files:**
- Test: `tests/wordbook-ui.test.js`
- Modify: `README.md`（テストの実行方法の一覧に `tests/wordbook-ui.test.js` を足す）

**Interfaces:**
- Consumes: `StudyCore.buildDocument`（ページ内で呼ぶ）、Playwright の `page.pdf`

- [ ] **Step 1: 失敗するテストを書く（`tests/wordbook-ui.test.js` に追加）**

`wordbook_30_long_words_fit_on_exact_pages`: `withPage({})` のページで、`StudyCore.buildDocument` に、意味が65文字の語30語（`items = Array.from({ length: 30 }, (_, i) => ({ key: 'w'+i, entry: { due: i, added: 0 }, word: { w: 'longword'+i, m: '意'.repeat(65), p: '形容詞句' } }))`）を渡して HTML を作る（`options` は `{ red: true, test: true }` と `{ red: true, test: false }` の2通り）。`context.newPage()` で作った別ページに `setContent(html)` し、`pdf({ preferCSSPageSize: true, printBackground: true })` のバッファを得て、ページ数 `(buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length` を数える。テストオンは 3、テストオフは 1。語が1つだけのときも同じページ数（空の行で埋めるため）。

- [ ] **Step 2: 実行する**

Run: `NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js`
Expected: 初回から PASS するか、ページ数が多い（行が溢れている）ために FAIL する。

- [ ] **Step 3: FAIL したら `src/wordbook.js` の CSS を直す**

溢れの原因は、行の高さ・見出しの高さ・長い意味の文字サイズ。`break-inside: avoid` と固定の行の高さ（15mm / 9mm）、`.long` の文字サイズを調整して、Step 1 を通す。ページ数を数える正規表現が 0 を返す（PDF の形式が違う）ときは、同じ意味のページ数の数え方に置き換える。

- [ ] **Step 4: 全体のテストを通す**

Run: `node --test tests/unit/` → PASS
Run: `python3 -m pytest tests -v` → 既存と同じ結果（この変更で増えた失敗がない）
Run: `NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js` → 全件 PASS
Run: `NODE_PATH=$(npm root -g) node tests/sheets.test.js` → 全件 PASS

- [ ] **Step 5: 目で確かめる（ブラウザのペイン）**

`preview_start` でアプリを開き、苦手リストのシートに苦手を数件入れて「単語帳PDF」を押す（または `StudyCore.buildDocument` の結果を別タブで開く）。印刷プレビューの見た目を、スクリーンショットで次の点について確かめ、ユーザーに見せる。A4で収まっている、折り線と赤字が出る、赤字オフで黒字になる、確認テストオフで1ページになる、意味の長い語で崩れない。赤シートで日本語が消えるかは、ユーザーが手元で確かめる（できなかったことは、そのまま報告する）。iPhone の Safari での印刷は、未確認として報告する。

- [ ] **Step 6: README を更新してコミット**

`README.md` の `tests/sheets.test.js` の行の近くに、`NODE_PATH=$(npm root -g) node tests/wordbook-ui.test.js` を同じ書き方で足す。

```bash
git add README.md tests/wordbook-ui.test.js src/wordbook.js
git commit -m "test: wordbook pages fit A4 (PDF page count); document the test"
```
