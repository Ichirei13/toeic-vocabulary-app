# 文法ドリルの「苦手+未」絞り込み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文法ドリルに、単語側と同じ意味の「苦手+未」(苦手の問題 + 出題済みでない問題)の絞り込みを足し、そのための文法の出題済み記録をバックアップ・復元まで含めて持たせる。

**Architecture:** 単語側の「学習済み」と同じ作りで、文法の出題済み問題番号を `localStorage` の専用キーに配列で持つ。初回だけ、通算正誤カウントと苦手リストから初期値を作る。バックアップは形式を版4に上げ、`seenGrammar` を足す。実装は `index.html` 1ファイルに収め、テストは Playwright の単体スクリプトを `tests/` に置く。

**Tech Stack:** 素の HTML/JS(`index.html` のみ)、`localStorage`、Playwright(環境に導入済み)、Node の標準 `http`。

**Spec:** `docs/superpowers/specs/2026-10-26-grammar-weak-unseen-filter-design.md`

## Global Constraints

- 保存キーは `toeic_seen_grammar`(定数名 `GRAMMAR_SEEN_KEY`)。値は問題番号(正の整数)の配列。モード別にしない。
- `BACKUP_FORMAT` は 3 → 4。ファイル内の名前は `data.seenGrammar`。
- 絞り込みの値は `'weak_unlearned'`、画面の表記は「苦手+未」(「すべて」と「苦手のみ」の間)。初期値は `'all'` のまま。
- 比較表の行の表記は「出題済みの文法」、単位は「問」。
- 出題済みの記録は**回答した時点**で追加する(「わからない」も含む)。
- 新しい依存は入れない。Obsidian 連携(`exportObsidianGrammarSync` / `applyObsidianSyncPayload`)は変えない。
- コメントとユーザー向けの文言は日本語。既存の書き方(短い説明コメント、`loadJSON` / `saveJSON` の利用)に合わせる。
- 関数は行番号ではなく名前で探す(`index.html` は編集で行がずれる)。

## Review Focus

- 出題済みの保存値が**空の配列 `[]`**のとき: 「記録が無い」と取り違えて初期値を作り直さない(全部解いたあとに復活しない)。→ Task 1
- すべて解き終えて苦手も無いとき「苦手+未」を選ぶ: 「条件に合う文法問題がありません」と出て、エラーにならない。→ Task 2
- 版3以前のバックアップに `grammarStats` / `weakGrammar` が**片方だけ・空**でも、変換が落ちず、出題済みが正しく作られる。→ Task 3
- `seenGrammar` に**重複・文字列・負数・小数・オブジェクト**が混ざったファイル: 正しい番号だけが残り、除いた件数が数えられる。→ Task 3
- 復元を**取り消した**とき、復元前に `toeic_seen_grammar` が存在しなかった端末でも、読み込み時に初期値が作り直されて壊れない。→ Task 4

---

## File Structure

- Modify: `index.html` — 保存と読み込み、絞り込み、バックアップの各関数(Task ごとに触る関数を明記)。
- Create: `tests/grammar-seen.test.js` — Playwright で動かす検証スクリプト(Task 1 で作り、Task ごとに足す)。

---

### Task 1: 出題済みの記録(保存・初期値・回答時の追加)

**Files:**
- Create: `tests/grammar-seen.test.js`
- Modify: `index.html` — キー定数のあたり(`GRAMMAR_STATS_KEY` の近く)、`state` の定義、`recordWeakGrammar`

**Interfaces:**
- Produces:
  - `const GRAMMAR_SEEN_KEY = 'toeic_seen_grammar'`
  - `isGrammarId(v: unknown): boolean` — 正の整数(`Number.isInteger(v) && v > 0`)
  - `grammarIdsFrom(...maps: object[]): number[]` — 渡した複数のオブジェクトのキーのうち `isGrammarKey` に合うものを、重複なしの数値配列にして返す(Task 3 の変換でも使う)
  - `loadGrammarSeen(): Set<number>` / `saveGrammarSeen(): void`
  - `state.grammarSeen: Set<number>`
- テストの下ごしらえ(以降の Task でも使う): `tests/grammar-seen.test.js` の `withPage(storage: Record<string,string>, fn: (page) => Promise<void>)` — 自前の静的サーバでリポジトリ直下を配信し、`addInitScript` で `localStorage` を設定してから `index.html` を開く。「300問以上」のナッジ(`#filter-nudge-modal`)は `dismissNudge()` で閉じる補助 `dismissNudge(page)` も用意する。

- [ ] **Step 1: テストスクリプトの土台と、失敗するテストを書く** — `tests/grammar-seen.test.js` に `withPage` / `dismissNudge` と次のケースを書く。各ケースは名前つきの `async function` で、最後にまとめて実行し、失敗があれば `process.exit(1)`。
  - `seed_from_stats_and_weak`: `storage = { toeic_grammar_stats: '{"5":{"a":2,"c":1}}', toeic_weak_grammar: '{"9":{"streak":0,"added":1,"due":1}}' }`(キー名は `GRAMMAR_STATS_KEY` と `'toeic_weak_grammar'` の実際の値に合わせる)で開き、`JSON.parse(localStorage.toeic_seen_grammar)` を昇順に並べると `[5, 9]`、`state.grammarSeen` のサイズが 2。
  - `no_reseed_when_present`: `toeic_seen_grammar = '[]'` と上の成績・苦手を入れて開いても、保存値は `[]` のまま(サイズ 0)。← Review Focus 1
  - `no_seed_when_corrupt`: `toeic_seen_grammar = '{"a":1}'` なら `state.grammarSeen` のサイズは 0 で、保存値は書き換えられない。
  - `record_on_answer`: 保存なしで文法に切り替え、`#choices-container .choice-btn` の先頭を押すと、その問題の番号が `grammarSeen` と保存値に入る。「わからない」でも同じ。
- [ ] **Step 2: 失敗を確認する** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 4件とも FAIL(`state.grammarSeen` が無い)。
- [ ] **Step 3: `GRAMMAR_SEEN_KEY`・`isGrammarId`・`grammarIdsFrom`・`loadGrammarSeen`・`saveGrammarSeen` を実装し、`state.grammarSeen = loadGrammarSeen()` を `grammarStats` / `grammarWeakData` の**後ろ**に足す** — `loadGrammarSeen` は、保存値が配列なら `isGrammarId` で絞って返す。`null` なら `grammarIdsFrom(state.grammarStats, state.grammarWeakData)` で作って保存する。それ以外(壊れた値)は空で返し、保存しない。`state` の定義の中で呼ぶので、`loadJSON` の宣言より後になるよう置き場所に注意する。
- [ ] **Step 4: `recordWeakGrammar` の中で `state.grammarSeen.add(ex.id)` し、集合が増えたときだけ `saveGrammarSeen()` する** — 単語側の `recordWeak` の `wordSeen().add` と同じ流れにする。
- [ ] **Step 5: テストを通す** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 4件とも PASS、コンソールエラーなし。
- [ ] **Step 6: コミット**

```bash
git add index.html tests/grammar-seen.test.js
git commit -m "feat: 文法の出題済み記録を追加(初回は成績と苦手から初期値を作る)"
```

---

### Task 2: 「苦手+未」の絞り込み

**Files:**
- Modify: `index.html` — 文法の絞り込みの HTML(`#grammar-weak-segments`)、`applyGrammarFilters`、`restoreSettings`
- Test: `tests/grammar-seen.test.js`

**Interfaces:**
- Consumes: `state.grammarSeen: Set<number>`(Task 1)
- Produces: `state.grammarWeakFilter` が `'weak_unlearned'` を取れる

- [ ] **Step 1: 失敗するテストを書く**
  - `filter_weak_unlearned_pool`: `toeic_seen_grammar = '[1,2,3]'`、`toeic_weak_grammar` に番号 2 だけを入れて文法で開き、`state.grammarWeakFilter = 'weak_unlearned'; applyGrammarFilters()` を呼ぶ。`state.grammarPool` の番号の集合は「全問 − {1, 3}」と一致する(番号 2 は苦手なので残り、1・3 は出題済みで外れる)。
  - `filter_segment_click`: 絞り込みシートを開き `[data-gweak="weak_unlearned"]` を押すと、`state.grammarWeakFilter` が `'weak_unlearned'` になり、そのセグメントが `active`。セグメントの並びは「すべて・苦手+未・苦手のみ・要復習」。
  - `filter_empty_pool`: 全問題の番号を `toeic_seen_grammar` に入れ、苦手を空にして `weak_unlearned` にすると、`#quiz-container` に「条件に合う文法問題がありません」が出て、コンソールエラーが無い。← Review Focus 2
  - `filter_persists`: `weak_unlearned` を選んで `location.reload()` すると、まだ `weak_unlearned`。`toeic_settings` に `grammarWeakFilter: 'bogus'` を入れて開くと `'all'`。
- [ ] **Step 2: 失敗を確認する** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 新しい4件が FAIL。
- [ ] **Step 3: `#grammar-weak-segments` に `<div class="segment" data-gweak="weak_unlearned">苦手+未</div>` を「すべて」の次に足す**
- [ ] **Step 4: `applyGrammarFilters` に、`weak_unlearned` のとき「苦手リストに無く、かつ `grammarSeen` に入っている問題」を除く条件を足す** — 単語側 `applyFilters` の `weak_unlearned` と同じ形にそろえる。
- [ ] **Step 5: `restoreSettings` の `grammarWeakFilter` の許可リストに `'weak_unlearned'` を足す**
- [ ] **Step 6: テストを通す** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 全件 PASS。
- [ ] **Step 7: コミット**

```bash
git add index.html tests/grammar-seen.test.js
git commit -m "feat: 文法ドリルに「苦手+未」の絞り込みを追加"
```

---

### Task 3: バックアップの書き出しと読み込み(版4)

**Files:**
- Modify: `index.html` — `BACKUP_FORMAT` とそのコメント、`BACKUP_MIGRATIONS`、`buildBackup`、`parseBackup`(独自形式の変換を含む)、`sanitizeSeenGrammar`(新規)
- Test: `tests/grammar-seen.test.js`

**Interfaces:**
- Consumes: `grammarIdsFrom(...maps)`、`isGrammarId`、`state.grammarSeen`(Task 1)
- Produces:
  - `sanitizeSeenGrammar(raw: unknown): { data: number[], invalid: number }` — 配列でなければ `{ data: [], invalid: 0 }`。配列の各要素のうち `isGrammarId` を満たさないものと重複を `invalid` に数える。
  - `parseBackup(text)` の戻り値の `records.seenGrammar: number[]`、`invalid` に上の件数が加わる
  - 版4のファイルの `data.seenGrammar: number[]`

- [ ] **Step 1: 失敗するテストを書く**(`page.evaluate` の中で `parseBackup(JSON.stringify(...))` と `buildBackup()` を直接呼ぶ)
  - `build_has_seen_grammar`: `state.grammarSeen = new Set([4, 7])` のとき `buildBackup().format === 4`、`data.seenGrammar` を昇順にして `[4, 7]`。
  - `migrate_v3`: 版3のファイル(`data` に `weakWords`, `weakGrammar: {"9":{...}}`, `seenWords: {}`, `wordStats: {}`, `grammarStats: {"5":{"a":1,"c":1}}` を入れ、`seenGrammar` なし)を `parseBackup` に渡すと `ok` で、`records.seenGrammar` が `[5, 9]`(昇順)。← Review Focus 3
  - `migrate_v3_partial`: 上のファイルで `grammarStats` が無い版、`weakGrammar` が `{}` の版、両方空の版のそれぞれが、落ちずに `ok`(空配列も可)。
  - `compat_toeic_practice_backup`: `app: 'toeic_practice_backup'` の独自形式に `grammarStats` と `weakGrammar` がある場合も、`records.seenGrammar` が両方のキーの和になる。
  - `v4_requires_array`: 版4で `seenGrammar` が無い、または `'x'` のファイルは `ok: false`(「形が正しくありません」系のメッセージ)。
  - `v4_sanitize`: `seenGrammar: [3, 3, "4", -1, 2.5, {}, 8]` の版4ファイルは `records.seenGrammar` が `[3, 8]`、`invalid` に 5 が入る(他の項目に不正が無い前提で、`invalid` がちょうど 5)。← Review Focus 4
  - `roundtrip_v4`: `buildBackup()` を JSON にして `parseBackup` に渡すと、`records.seenGrammar` が元の集合と一致する。
  - `v5_rejected`: `format: 5` は従来どおり「新しいバージョン」と断られる。
- [ ] **Step 2: 失敗を確認する** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 新しいケースが FAIL。
- [ ] **Step 3: `BACKUP_FORMAT = 4` にし、版の説明コメントに「版4: 文法の出題済みを含む」を足す**
- [ ] **Step 4: `BACKUP_MIGRATIONS[3]` を足す** — `data` がオブジェクトなら `seenGrammar` が配列でないときだけ `grammarIdsFrom(isPlainObject(d.grammarStats) ? d.grammarStats : {}, isPlainObject(d.weakGrammar) ? d.weakGrammar : {})` を入れ、`format` を 4 にして返す。`data` がオブジェクトでなければ `format` だけ 4 にする(`BACKUP_MIGRATIONS[2]` と同じ作法)。
- [ ] **Step 5: `parseBackup` の独自形式の変換(`toeic_practice_backup`)に、同じ式で作った `seenGrammar` を足す**
- [ ] **Step 6: `sanitizeSeenGrammar` を実装し、`parseBackup` の検証に `if (!Array.isArray(d.seenGrammar)) return fail('文法の出題済みの記録が欠けているか、形が正しくありません。')` を足して、`records.seenGrammar` と `invalid` の合計に反映する**
- [ ] **Step 7: `buildBackup` の `data` に `seenGrammar: [...state.grammarSeen]` を足す**
- [ ] **Step 8: テストを通す** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 全件 PASS。
- [ ] **Step 9: コミット**

```bash
git add index.html tests/grammar-seen.test.js
git commit -m "feat: バックアップを版4に上げ、文法の出題済みを書き出し・読み込めるようにする"
```

---

### Task 4: 復元・取り消し・件数の表示

**Files:**
- Modify: `index.html` — `RECORD_KEYS`、`mergeSeenGrammar`(新規)、`runRestore`、`reloadRecordsFromStorage`、`currentCounts`、`countsFromRaw`、`compareTable`
- Test: `tests/grammar-seen.test.js`

**Interfaces:**
- Consumes: `records.seenGrammar`(Task 3)、`loadGrammarSeen`(Task 1)
- Produces: `mergeSeenGrammar(cur: number[], inc: number[]): number[]` — 重複なしの和集合。`currentCounts().grammarSeen` と `countsFromRaw(records).grammarSeen`: 件数(数値)。

- [ ] **Step 1: 失敗するテストを書く**(復元は `backupView = { step: 'confirm', pending: parseBackup(...), restoreMode: ... }` を作って `runRestore()` を呼ぶ。`runRestore` が描画に使う要素が無いと困る場合は、設定シートからバックアップ画面を開いてから呼ぶ)
  - `merge_union`: `mergeSeenGrammar([1, 2], [2, 3])` を昇順にして `[1, 2, 3]`。
  - `restore_merge`: 今 `grammarSeen = {1}`、ファイルが `seenGrammar: [2]` の版4で統合復元すると、`state.grammarSeen` が `{1, 2}`、保存値も同じ。
  - `restore_overwrite`: 同じ条件で上書き復元すると `{2}`。ファイルが `seenGrammar: []` なら空のまま(初期値は作り直されない)。
  - `restore_v3_file`: 版3のファイル(成績に 5、苦手に 9)を統合・上書きのそれぞれで復元すると、出題済みにファイル由来の `{5, 9}` が入る。
  - `undo_restores_absent_key`: `toeic_seen_grammar` が無い端末(成績に 5 だけがある)で上書き復元してから `runUndo()` すると、保存値が復元前の状態に戻り、読み込み後の `state.grammarSeen` が `{5}`(初期値の作り直し)になって、エラーが出ない。← Review Focus 5
  - `counts_and_table`: `currentCounts().grammarSeen` が `grammarSeen` のサイズと一致する。`countsFromRaw` に `toeic_seen_grammar` が無い・壊れた値の `records` を渡すと 0。復元の確認画面の比較表に「出題済みの文法」の行があり、「今の記録」と「ファイル・テキスト」の件数が出る。
- [ ] **Step 2: 失敗を確認する** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 新しいケースが FAIL。
- [ ] **Step 3: `RECORD_KEYS` に `seenGrammar: GRAMMAR_SEEN_KEY` を足す** — 取り消し用の退避(`RECORD_STORAGE_KEYS`)に自動で入る。
- [ ] **Step 4: `mergeSeenGrammar` を実装し、`runRestore` の統合に `seenGrammar: mergeSeenGrammar([...state.grammarSeen], pending.records.seenGrammar || [])` を足す** — 上書きは `pending.records` のまま(`seenGrammar` が入っている)。
- [ ] **Step 5: `reloadRecordsFromStorage` に `state.grammarSeen = loadGrammarSeen()` を足す**
- [ ] **Step 6: `currentCounts` に `grammarSeen: state.grammarSeen.size`、`countsFromRaw` に保存文字列から数えた `grammarSeen`(配列でなければ 0)を足す**
- [ ] **Step 7: `compareTable` に `<tr><td>出題済みの文法</td><td>${left.grammarSeen}問</td><td>${right.grammarSeen}問</td></tr>` を、「文法の苦手」の次に足す** — ファイル側の件数(`fileCounts`)を作っている箇所(`renderBackupSheet` 近辺)にも `grammarSeen: records.seenGrammar.length` を足す。
- [ ] **Step 8: テストを通す** — Run: `NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js`。Expected: 全件 PASS。
- [ ] **Step 9: 通し確認と退行確認** — 次を `NODE_PATH=$(npm root -g) node` の使い捨てスクリプトか手元の Playwright で確認する。単語側の「苦手+未」が従来どおり動く。版3の単語データだけのバックアップが復元できる。設定シート → バックアップ画面で、書き出し・テキスト出力・テキスト貼り付けの復元が動く。全操作でコンソールエラーが出ない。
- [ ] **Step 10: コミット**

```bash
git add index.html tests/grammar-seen.test.js
git commit -m "feat: 文法の出題済みを統合・上書き復元と取り消し、比較表に対応させる"
```
