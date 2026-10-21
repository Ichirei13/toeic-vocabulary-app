# 学習機能の追加 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 発音ボタン、連続日数と今日の目標、学習統計、期限の来た語の優先出題、穴埋めモードを、単語ドリルに追加する。

**Architecture:** `index.html` 1ファイルのまま、既存の関数に小さな呼び出しを足し、新しい処理は小さな関数に分ける。学習ログ（`toeic_daily_log`）を土台にして、連続日数と統計がそこから計算する。テストは Node の `node:test` と Playwright で、ページを開いてグローバルな関数と `state` を直接呼ぶ。

**Tech Stack:** プレーンな HTML/CSS/JS（外部ライブラリなし）。テストは Playwright 1.56（この環境にグローバルで入っている）と Node 22。

**Spec:** `docs/superpowers/specs/2026-10-21-study-features-design.md`

## Global Constraints

- 新しいライブラリを入れない。`package.json` を作らない。ランタイムのファイルは `index.html` のまま（`upload.py` の `FILES` は変えない）。`data/` は変えない。
- 保存キーは `toeic_daily_log`（学習ログ、最大400日分）。目標と出題順は `toeic_settings` の `goal`（10/20/50/100、初期値20）と `priority`（`due_first` / `random`、初期値 `due_first`）。
- 発音は `speechSynthesis` の `lang = 'en-US'`。使えない端末ではボタンを出さない。
- 既存の記録（苦手、学習済み、設定、出題の続き）は壊さない。新しいキーは足すだけ。
- 画面の文言は日本語。コメントも日本語で、周りの密度に合わせる。
- 最後に `sw.js` の `CACHE` を `toeic-drill-v2` に上げる（Task 8）。
- 各コミットの末尾に次の2行を付ける:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_011WiduHyqST1VbNbLioEuZF`
- テストの実行: `NODE_PATH="$(npm root -g)" node --test tests/<ファイル>`。全部は `NODE_PATH="$(npm root -g)" node --test tests/*.test.cjs`。

## Review Focus

1. `localStorage` への書き込みが例外になる環境（プライベートモード）でも、回答して学習を続けられる（Task 1）。
2. 壊れた `toeic_daily_log`（配列、負数、正解が回答より多い、存在しない日付）で起動でき、壊れた件は捨てる（Task 1、Task 2）。
3. 月またぎ・年またぎで連続日数が途切れない（Task 1）。
4. `dailyLog` も `cloze` も入っていない古いバックアップを復元しても、今の学習ログを消さない（Task 2、Task 7）。
5. 空欄にできない語や、正規表現の記号を含む見出し語があっても、穴埋めモードが落ちない（Task 7）。

## File Structure

- Create: `tests/helpers.cjs` — ページを開くヘルパー
- Create: `tests/log.test.cjs`、`backup.test.cjs`、`streak.test.cjs`、`stats.test.cjs`、`priority.test.cjs`、`speech.test.cjs`、`cloze.test.cjs`
- Modify: `index.html` — すべての機能。`sw.js` — キャッシュ名のみ。

---

### Task 1: テストの土台と学習ログ

**Files:**
- Create: `tests/helpers.cjs`、`tests/log.test.cjs`
- Modify: `index.html`（`let state = {` の直前に学習ログの節を追加。`state` に `dailyLog: loadDailyLog()` を足す。`recordWeak`（1913行付近）と `recordWeakGrammar`（1380行付近）に呼び出しを足す）

**Interfaces:**
- Produces（`tests/helpers.cjs`）: `openApp(opts?: { storage?: Record<string,string>, init?: string, time?: string }): Promise<{ page: Page, close(): Promise<void> }>`。`storage` は、そのキーがまだ無いときだけ書き込む（リロードしても上書きしない）。`init` は `addInitScript` に渡す文字列。`time` は `page.clock.setFixedTime` に渡す ISO 文字列。`file://` で `index.html` を開き、`pageerror` を `page.errors` に溜める。
- Produces（`index.html`）:
  - `DAILY_LOG_KEY = 'toeic_daily_log'`、`DAILY_LOG_MAX_DAYS = 400`
  - `dateKey(d?: Date): string` — 端末のローカル日付 `YYYY-MM-DD`
  - `sanitizeDailyLog(raw: object): { data: object, invalid: number }`
  - `loadDailyLog(): object`
  - `recordActivity(app: 'vocab' | 'grammar', isCorrect: boolean, now?: Date): void` — `state.dailyLog[日付] = { v:[回答,正解], g:[回答,正解] }` を増やして保存
  - `dayCount(log: object, key: string): number` — その日の `v` と `g` の回答数の合計
  - `streakDays(log: object, todayKey: string): number`

- [ ] **Step 1: `tests/helpers.cjs` を書く**（`chromium.launch()`、新しい context、`addInitScript` で `storage` を条件付きで書き込み、`page.goto('file://' + path.resolve(__dirname, '../index.html'))`）。起動に失敗したら `executablePath: '/opt/pw-browsers/chromium'` を使う。

- [ ] **Step 2: `tests/log.test.cjs` に失敗するテストを書く**
  - `dateKey(new Date(2026, 0, 5))` が `'2026-01-05'`。
  - `sanitizeDailyLog({"2026-10-21":{v:[3,2],g:[1,1]},"bad":{v:[1,1]},"2026-13-40":{v:[1,1]},"2026-10-20":{v:[2,5]},"2026-10-19":{v:[-1,0]},"2026-10-18":"x"})` が、`data` のキーは `2026-10-21` だけ、`invalid` は 5、`data['2026-10-21']` は `{v:[3,2],g:[1,1]}`。`g` がない日は `g:[0,0]` になる。
  - 450日分を渡すと、新しい400日分だけ残る（古い分は `invalid` に数えない）。
  - 配列 `[]` や文字列が `toeic_daily_log` に入っていても、`openApp` で起動でき `state.dailyLog` は `{}`。
  - `recordActivity('vocab', true)`、`('vocab', false)`、`('grammar', true)` のあと、`state.dailyLog[dateKey()]` が `{v:[2,1], g:[1,1]}` で、`localStorage` にも同じ内容が入っている。
  - 画面から: 「わからない」ボタンを押すと、今日の `v` が `[1,0]`。文法に切り替えて選択肢を押すと `g[0]` が 1 になる。
  - `streakDays`: 空は 0。今日だけは 1。今日がなく昨日と一昨日があれば 2。1日抜けると、そこで止まる。`{v:[0,0],g:[0,0]}` の日は数えない。`2026-02-27`・`02-28`・`03-01` があり今日が `2026-03-01` なら 3。`2025-12-31`・`2026-01-01` があり今日が `2026-01-01` なら 2。
  - `Storage.prototype.setItem` が例外を投げる `init` で開き、回答しても `page.errors` が空で、`state.dailyLog` には記録される。

- [ ] **Step 3: 実行して失敗を確かめる** — `NODE_PATH="$(npm root -g)" node --test tests/log.test.cjs`。Expected: FAIL（`dateKey is not defined`）。

- [ ] **Step 4: `index.html` に実装する** — 上のシグネチャどおり。`dateKey` は `getFullYear/getMonth/getDate`。`sanitizeDailyLog` は日付の妥当性を `parseLocalDate` で戻して確かめる（`2026-13-40` を弾く）。`streakDays` は `parseLocalDate` から `setDate(-1)` で1日ずつ戻し、`dateKey` に直して `dayCount` を見る（月・年またぎとサマータイムに強い）。今日の `dayCount` が 0 なら昨日から数える。`recordActivity` は `saveJSON` を使うので、保存の失敗は既存どおり黙って無視される。`recordWeak` と `recordWeakGrammar` の中に `recordActivity('vocab', isCorrect)` / `recordActivity('grammar', isCorrect)` を1行ずつ足す。

- [ ] **Step 5: 実行して通ることを確かめる** — Step 3 のコマンド。Expected: すべて PASS。

- [ ] **Step 6: コミット** — `git add tests index.html && git commit -m "Add daily study log"`（末尾の2行を付ける）

---

### Task 2: バックアップへの組み込み

**Files:**
- Create: `tests/backup.test.cjs`
- Modify: `index.html`（`RECORD_KEYS`（2323行付近）、`buildBackup`、`parseBackup`、`reloadRecordsFromStorage`）

**Interfaces:**
- Consumes: Task 1 の `DAILY_LOG_KEY`、`sanitizeDailyLog`、`loadDailyLog`。
- Produces: `RECORD_KEYS.dailyLog`、バックアップの `data.dailyLog`、`parseBackup(...).records.dailyLog`（ファイルにあるときだけ。無いときは `undefined`）。

- [ ] **Step 1: 失敗するテストを書く**（`parseBackup` と `buildBackup` をページ内から直接呼ぶ。復元は `backupView.pending = parseBackup(text)` を入れて `runRestore()`）
  - `buildBackup().data.dailyLog` が `state.dailyLog` と同じ。
  - `dailyLog` のない古いファイル（`format: 2`、`weakWords`・`weakGrammar`・`seenWords` のみ）を `parseBackup` すると `ok: true` で `records.dailyLog` は `undefined`。それを復元しても、`localStorage` の `toeic_daily_log` と `state.dailyLog` は復元前のまま。
  - 壊れたログ（Task 1 の入力例）を含むファイルは、`ok: true` で `invalid` に 5 が足され、`records.dailyLog` には正しい日だけ。
  - `dailyLog` が配列のファイルは `ok: false`。
  - `dailyLog` ありのファイルを復元すると、`state.dailyLog` がファイルの中身になる。

- [ ] **Step 2: 実行して失敗を確かめる** — `... tests/backup.test.cjs`。Expected: FAIL。

- [ ] **Step 3: 実装する** — `RECORD_KEYS` に `dailyLog: DAILY_LOG_KEY`。`buildBackup` の `data` に `dailyLog: state.dailyLog`。`parseBackup` は `d.dailyLog !== undefined` かつ `isPlainObject` でなければ `fail('学習ログの記録の形が正しくありません。')`、あれば `sanitizeDailyLog` にかけて `records.dailyLog` に入れ、`invalid` に足す（`undefined` のときは `records` にキーを作らない）。`reloadRecordsFromStorage` で `state.dailyLog = loadDailyLog()`。フォーマットの版（`BACKUP_FORMAT`）は上げない。

- [ ] **Step 4: 実行して通ることを確かめる** — Expected: PASS。`log.test.cjs` も再実行して PASS。

- [ ] **Step 5: コミット** — `git commit -m "Include study log in backup and restore"`

---

### Task 3: 連続日数と今日の目標

**Files:**
- Create: `tests/streak.test.cjs`
- Modify: `index.html`（ヘッダーの下にバーのHTMLとCSS。`state`、`settingsSnapshot`、`restoreSettings`、`updateFooter`）

**Interfaces:**
- Consumes: Task 1 の `streakDays`、`dayCount`、`dateKey`。
- Produces: `GOALS = [10, 20, 50, 100]`、`state.goal`（初期値 20）、`updateStreakBar(): void`、`cycleGoal(): void`。バーは `#streak-bar`（目標を達成した日は `done` クラスが付く）。

- [ ] **Step 1: 失敗するテストを書く**（`time: '2026-10-21T10:00:00'`、`storage` に `2026-10-19` と `2026-10-20` の記録を入れる）
  - 起動直後、`#streak-bar` のテキストが `🔥2日連続 ・ 今日 0/20`。
  - 1問回答すると `🔥3日連続 ・ 今日 1/20`。
  - バーをクリックすると目標が 50 になり（`state.goal === 50`）、トーストが出て、リロードしても 50 のまま。100 の次は 10 に戻る。
  - 今日の記録を `{v:[20,10]}`、目標 20 で開くと `#streak-bar` に `done` クラスが付く。目標未達ならない。
  - `toeic_settings` に不正な `goal`（`7` や `"x"`）が入っていても、20 になる。

- [ ] **Step 2: 実行して失敗を確かめる** — Expected: FAIL（`#streak-bar` がない）。

- [ ] **Step 3: 実装する** — `<div class="streak-bar" id="streak-bar" role="button" tabindex="0"></div>` を `.header` の直後に置く。`updateStreakBar` は `updateFooter` の中（`saveSettings()` の前）から呼ぶ。`cycleGoal` は `GOALS` の次の値にして `saveSettings()` → `updateStreakBar()` → `showToast(\`今日の目標を${goal}問にしました\`)`。`settingsSnapshot` のキー一覧に `'goal'` を足し、`restoreSettings` で `state.goal = pick(saved.goal, GOALS, 20)`。クリックとEnterキーの両方で `cycleGoal`。

- [ ] **Step 4: 実行して通ることを確かめる** — Expected: PASS。`log.test.cjs`・`backup.test.cjs` も PASS のまま。

- [ ] **Step 5: コミット** — `git commit -m "Add streak and daily goal bar"`

---

### Task 4: 学習統計

**Files:**
- Create: `tests/stats.test.cjs`
- Modify: `index.html`（フッターのリンク、`toggleStats`、`renderStatsSheet`、棒グラフのCSS）

**Interfaces:**
- Consumes: Task 1 の `dateKey`、`state.dailyLog`、既存の `openSheet`、`closeSheet`、`isDue`。
- Produces:
  - `statsSummary(log: object, todayKey: string): { today: {n, c}, week: {n, c}, total: {n, c}, days: Array<{key: string, n: number}> }` — `week` は今日を含む7日、`days` は14日分（古い順、最後が今日）。`n` は回答数、`c` は正解数。単語と文法の合計。
  - `learnedStats(): { learned: number, total: number, weak: number, due: number, gWeak: number, gDue: number }` — 単語は全モードをまとめた重複なしの数。`total` は `RAW_WORDS` の重複なしの語数。
  - `toggleStats(): void`、`renderStatsSheet(): void`（`#weak-list-content` に描く）

- [ ] **Step 1: 失敗するテストを書く**
  - 今日が `2026-10-21` で、ログが `10-21: v[3,2] g[1,1]`、`10-15: v[10,8]`、`10-14: v[5,5]` のとき、`today` は `{n:4,c:3}`、`week` は `{n:14,c:11}`（`10-15` は入り、`10-14` は入らない）、`total` は `{n:19,c:16}`。`days.length` は 14、`days[0].key` は `'2026-10-08'`、`days[13].key` は `'2026-10-21'`、`days[13].n` は 4。
  - ログが空なら、すべて 0 で例外なし。
  - `learnedStats()`: `seenByMode.e2j` に 2語、`seenByMode.flash` にそのうち1語と別の1語を入れると `learned` は 3。苦手を 2 モードで同じ語に入れても `weak` は 1。`due: 0` の語は `due` に数えられ、`due` が未来の語は数えられない。
  - 画面: 「統計」リンクを押すとシートが開き、テキストに `今日`・`直近7日`・`累計` の行があり、今日の行が `4問 ・ 正答率 75%`。記録のない期間は `0問`（正答率は出さない）。棒が14本ある。もう一度押すと閉じる。

- [ ] **Step 2: 実行して失敗を確かめる** — Expected: FAIL。

- [ ] **Step 3: 実装する** — `.stats` に `<span style="cursor:pointer; text-decoration:underline;" onclick="toggleStats()">統計</span>` を足す。`toggleStats` は `toggleWeakList` と同じ作りで `openSheet('学習統計', renderStatsSheet)`。棒グラフは `div` の高さ（最大値に対する割合、0 の日は 2px）で、外部ライブラリは使わない。棒には `title` と `aria-label` で `10/21 4問` の形のラベルを付ける。学習済みの行は `学習済み ${learned} / ${total}語（${割合}%）`、苦手の行は `苦手 5語 ・ 要復習 2語`、文法の行は `文法 苦手 3問 ・ 要復習 1問`。

- [ ] **Step 4: 実行して通ることを確かめる** — Expected: PASS。

- [ ] **Step 5: コミット** — `git commit -m "Add study stats sheet"`

---

### Task 5: 期限の来た語を優先出題

**Files:**
- Create: `tests/priority.test.cjs`
- Modify: `index.html`（`applyFilters`、`applyGrammarFilters`、絞り込みドロワーのHTML、`syncFilterUI`、`initFilters`、`settingsSnapshot`、`restoreSettings`、`sessionSignature`）

**Interfaces:**
- Produces: `orderByDue<T>(items: T[], isDueFn: (item: T) => boolean): T[]` — `[...shuffle(期限の来たもの), ...shuffle(残り)]` の新しい配列（入力は変えない）。`state.priority`（`'due_first' | 'random'`、初期値 `'due_first'`）。

- [ ] **Step 1: 失敗するテストを書く**
  - `orderByDue`: 20個のうち5個が期限切れなら、先頭5個がちょうどその5個（順不同）。全体の要素は同じ。入力の配列は変わらない。期限切れが0個でも全要素が残る。全部が期限切れでも同様。
  - 画面（単語）: 3語を `toeic_weak_words_by_mode` の `e2j` に `{streak:0, added:1, due:0}` で入れて開くと、`state.pool` の先頭3語がその3語。「ランダム」を押しても例外が出ず、`state.priority` が `'random'` になる。苦手のみ（`weakFilter === 'weak_only'`）で絞っているときは、どちらの設定でも `state.pool` の語の集合が同じ。
  - 画面（文法）: `toeic_weak_grammar` に `{"1":{streak:0,added:1,due:0}}` を入れて文法に切り替えると、`state.grammarPool[0].id` が 1。
  - `toeic_settings` に `priority` がなければ `'due_first'`。不正な値でも `'due_first'`。
  - 既存の出題の続きが引き継がれる: 1問回答してリロードすると `state.currentIndex` が 1 以上（初期設定では `sessionSignature` が変わらない）。「ランダム」にしたあとにリロードしても続きから始まる。

- [ ] **Step 2: 実行して失敗を確かめる** — Expected: FAIL。

- [ ] **Step 3: 実装する** — `applyFilters`: `state.pool = state.priority === 'due_first' && state.weakFilter === 'all' ? orderByDue(dedupeWords(filtered), w => { const e = wordWeak()[w.w]; return !!e && isDue(e); }) : shuffle(dedupeWords(filtered))`。`applyGrammarFilters` も同様に `grammarWeakFilter === 'all'` のとき `state.grammarWeakData[ex.id]` で判定する。ドロワーの先頭（`#vocab-filters` の前）に `#priority-segments`（`data-priority="due_first"`「要復習を先に」、`"random"`「ランダム」）を単語・文法共通で置く。クリックで `state.priority` を変え、`saveSettings()` のあと今のアプリの `applyFilters` / `applyGrammarFilters` を呼ぶ。`syncFilterUI` に `mark('#priority-segments .segment', ...)`。`sessionSignature` の末尾に `...(state.priority === 'random' ? ['random'] : [])` を足す（初期設定では署名が変わらず、既存の出題の続きが使える）。`updateFilterSummary` の数には含めない。

- [ ] **Step 4: 実行して通ることを確かめる** — Expected: PASS。これまでのテストも全部 PASS。

- [ ] **Step 5: コミット** — `git commit -m "Prioritize due words in question order"`

---

### Task 6: 発音ボタン

**Files:**
- Create: `tests/speech.test.cjs`
- Modify: `index.html`（`.speak-btn` のCSS、`renderCurrent` の e2j・カード・回答後の例文欄、キャプチャ段階のクリック処理）

**Interfaces:**
- Produces: `speechAvailable(): boolean`、`speechText(text: string): string`（`（…）` の部分と `~`・`～` を取り除いて前後の空白を削る）、`speak(text: string): void`（`cancel()` してから `lang = 'en-US'` で再生）、`speakBtnHtml(text: string): string`（使えない端末か、読む文字が空なら `''`。それ以外は `<button type="button" class="speak-btn" data-speak="…" aria-label="発音を聞く">🔊</button>`、属性値は `escapeHtml` を通す）。

- [ ] **Step 1: 失敗するテストを書く**（`init` で `window.speechSynthesis` の差し替えを入れる。`speak(u)` が `window.__spoken.push(u.text + '|' + u.lang)`、`cancel()` は何もしない。`SpeechSynthesisUtterance` は `text` を持つ関数）
  - `speechText('a paid vacation（有給休暇）')` が `'a paid vacation'`。`speechText('refer to ~')` が `'refer to'`。`speechText('（訳だけ）')` は `''`（このとき `speakBtnHtml` も `''`）。
  - 英→日モード: 単語の横に 🔊 があり、押すと `__spoken` に `単語|en-US` が入り、まだ回答済みにならない（`state.answered === false`）。
  - カードモード: 表面の 🔊 を押してもカードがめくれない（`#flash-card` に `flipped` が付かない）。
  - 回答後の例文欄に、単語と例文の 🔊 があり、例文の方を押すと日本語訳なしで読まれる。日→英・タイプのモードでは、回答前にその単語の 🔊 が出ていない。
  - `data-speak` に `"` や `<` を含む文字列を渡しても、`dataset.speak` が元の文字列に戻る。
  - `speechSynthesis` が使えない（`Object.defineProperty(window, 'speechSynthesis', {value: undefined})`）と、`.speak-btn` が一つもなく、`page.errors` が空。

- [ ] **Step 2: 実行して失敗を確かめる** — Expected: FAIL。

- [ ] **Step 3: 実装する** — 回答前に答えが分かってしまう場所には置かない（e2j は単語の横とカードの表面のみ、ほかは回答後の `#example-box` 内と、カードの裏面）。`document.addEventListener('click', handler, true)` のキャプチャ段階で `.speak-btn` を拾い、`stopPropagation()` してから `speak(btn.dataset.speak)` を呼ぶ（カードの `onclick` が先に動かないようにするため）。

- [ ] **Step 4: 実行して通ることを確かめる** — Expected: PASS。これまでのテストも PASS。

- [ ] **Step 5: コミット** — `git commit -m "Add pronunciation buttons"`

---

### Task 7: 穴埋めモード

**Files:**
- Create: `tests/cloze.test.cjs`
- Modify: `index.html`（`VOCAB_MODES`、`MODE_LABELS`、モード切り替えのHTMLとハンドラ、`restoreSettings`、`renderCurrent`、`applyFilters`、`sessionSignature`）

**Interfaces:**
- Consumes: 既存の `buildOptions`、`answerChoice`、`escapeHtml`、`posTagHtml`。
- Produces: `CLOZE_BLANK = '-------'`、`maskGloss(text: string): string`（`（…）` を同じ長さの空白に置き換える）、`findBlank(word: {w: string, e: string}): {start: number, end: number} | null`（`word.e` の添字。結果は語ごとに覚えておく）、`clozeSentenceHtml(word, revealed: boolean): string`。

- [ ] **Step 1: 失敗するテストを書く**
  - `findBlank`: `cornerstone` と `Education is the cornerstone of a prosperous society.` で、切り出すと `cornerstone`。`marinate` と `The chef marinated the chicken` は `marinated`（語幹一致）。`update` と `Update the file` は `Update`（大文字小文字を区別しない）。`opt for` と `Many employees opted for flexible hours` は `null`。`vacation` と `a paid vacation（有給休暇）` は `vacation` の位置（日本語訳に切り出し範囲がかからない）。`abc` と `foo（abc）` は `null`（日本語訳の中は対象外）。`a (b)+` と `x`、`[`、`.*` のような正規表現の記号を含む見出し語でも例外が出ず `null`。例文が空文字なら `null`。
  - 全データ: `RAW_WORDS` のうち `findBlank` が `null` でない語が 97% 以上。
  - `clozeSentenceHtml(word, false)` は空欄に `-------` が入り、`（…）` を含まず、見出し語の活用形が入っていない。`clozeSentenceHtml(word, true)` は活用形が `<mark>` で囲まれる。HTML記号を含む例文は `escapeHtml` されている。
  - 画面: 「穴埋め」を押すと `state.mode === 'cloze'`、`state.pool` の全語で `findBlank` が非 null。カードに `-------` があり、選択肢は 4つ。正解を押すと `#example-box` が表示され `<mark>` を含む。不正解を押すと `state.weakByMode.cloze[word.w]` ができ、`state.weakByMode.e2j` には入らない。
  - `weakFilter` が `all` のとき、穴埋めから英→日に戻すと `state.pool.length` が絞り込みなしの語数（重複排除後）に戻る。`sessionSignature('vocab')` は `cloze` のときと `e2j` のときで異なる。
  - `toeic_settings` の `mode: 'cloze'` が復元される。`cloze` のキーがない古い `toeic_weak_words_by_mode`・`toeic_seen_words_by_mode` でも起動でき、`state.weakByMode.cloze` が `{}`。`cloze` を含まない古いバックアップの `parseBackup` が `ok: true`。苦手リストのチップに「穴埋め」が出る。

- [ ] **Step 2: 実行して失敗を確かめる** — Expected: FAIL。

- [ ] **Step 3: 実装する** — `findBlank`: 先に `maskGloss(word.e)` で日本語訳を隠した文字列を使い、(1) `\b` + エスケープした見出し語 + `\b` を大文字小文字無視で探す。(2) なければ、見出し語を空白で区切った各語（5文字以上のものだけ）の末尾の `ion|ing|ed|es|s|e|y` を1つ取って（語幹）、`\b語幹…\w*` を探す。(3) どちらもなければ `null`。正規表現の記号は必ずエスケープする。`clozeSentenceHtml` は元の `word.e` の添字で前後に分け、前後から `（…）` を取り除いてから `escapeHtml` する。`renderCurrent` の `cloze` は e2j と同じ作りのカードで、問題文に `clozeSentenceHtml(word, false)`、`#example-box` に `clozeSentenceHtml(word, true)` と意味を入れ、選択肢は `buildOptions(word)` の `opt.w`、回答は `handleAnswer` / `handleDontKnow` を使う。`applyFilters` は `cloze` のとき `findBlank(w)` が `null` の語を除く。モード切り替えのハンドラは、`weakFilter !== 'all'` に加えて、切り替えの前後どちらかが `cloze` のときも `applyFilters()` する。`sessionSignature` は `weakFilter` が `all` でも `state.mode === 'cloze'` なら `state.mode` を含める。`VOCAB_MODES` に `'cloze'`、`MODE_LABELS` に `cloze: '穴埋め'`、`restoreSettings` の許可リスト、モード切り替えの `<div class="segment" data-mode="cloze">穴埋め</div>`。

- [ ] **Step 4: 実行して通ることを確かめる** — Expected: PASS。これまでのテストも全部 PASS。

- [ ] **Step 5: コミット** — `git commit -m "Add cloze mode"`

---

### Task 8: キャッシュの更新と通しの確認

**Files:**
- Modify: `sw.js`（1行目付近の `CACHE`）

- [ ] **Step 1: `CACHE` を `'toeic-drill-v2'` に変える。**

- [ ] **Step 2: 全テストを実行する** — `NODE_PATH="$(npm root -g)" node --test tests/*.test.cjs`。Expected: すべて PASS、失敗 0。

- [ ] **Step 3: 通しで画面を確認する** — Playwright で幅 390×844 で開き、(a) 単語ドリルの英→日（バー、🔊）、(b) 統計シート、(c) 穴埋めモードの回答前と回答後、(d) 文法ドリル、のスクリーンショットを scratchpad に保存して見る。レイアウトの崩れ、バーがはみ出す、シートが読めない、がないこと。見つけたら直して、該当するテストを足す。

- [ ] **Step 4: バックアップの書き出しと復元を通しで確認する** — 回答してから `buildBackup()` の JSON を `parseBackup` → `runRestore` で戻し、学習ログ・苦手・穴埋めの苦手が残ること。

- [ ] **Step 5: コミットしてプッシュ** — `git commit -m "Bump service worker cache"`、`git push -u origin claude/gifted-davinci-lnh4yw`。
