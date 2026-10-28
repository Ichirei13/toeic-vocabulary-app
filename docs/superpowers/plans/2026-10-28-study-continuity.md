# 学習を続けやすくする6機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. サブエージェントによる実行は利用者がその方式を選択した場合にsp-subagent-driven-developmentを使う。

**Goal:** 前回条件での再開、教材進捗、今日の目標、学習日カレンダー、間違い直しの成果、オリジナル案内役を `/next/` に追加する。

**Architecture:** 採点・保存の入口は既存の `next/core.mjs` に保ち、設定・日別集計・進捗集計を副作用のない小さなモジュールへ分ける。追加UIは専用モジュールで描画し、既存 `app.mjs` がイベントと画面遷移を担当する。新しい保存形式とバックアップ対応を先に完成させ、UIを順に接続する。

**Tech Stack:** Vanilla JavaScript ES modules、CSS、localStorage、既存Service Worker、Node標準テスト、Playwright＋インストール済みChrome。新規依存なし。

**Spec:** [設計案](../specs/2026-10-28-study-continuity-design.md)

**Status:** 承認された計画をローカル試用版に実装。全7タスクを完了し、独立レビューの2件を回帰テストで修正。公開は未実施。

## Global Constraints

- 従来版の `index.html`・`data/`・`sw.js` と従来版の保存キーは変更しない。
- 試用版の保存キーは `toeic_next_v1` の1つだけを使う。
- GitHub Pagesで動く静的構成を維持し、外部サービス・外部依存・外部通信を追加しない。
- 全9テーマ、320〜1440px、200%文字、キーボード操作、動きを減らす設定に対応する。
- 公開サイトへの反映は、ローカル検証と利用者の確認を経て別途行う。

## Review Focus

1. 日付変更・夏時間・タイムゾーン変更：日付は回答時のローカル日付で保存し、既存履歴を書き換えない。Task 4で日付を注入する単体テストを作る。
2. 教材更新で消えた教材・章・追加日：前回条件を広げて黙って開始せず設定確認へ戻す。Task 2で新旧カタログのテストを作る。
3. 別タブ・保存容量不足・不正な将来形式：保存済み文字列を保ち、未保存状態を表示する。Task 1で移行・復元の失敗テストを作る。
4. 旧バックアップと新バックアップの混在：旧形式から日別履歴を推測せず、統合の再実行で増やさない。Task 1とTask 4で同一ファイルの重複統合テストを作る。
5. 回答・目標達成・連続正解・案内役が同時発生：操作を覆わず補助メッセージを1つに絞り、再読込で再演出しない。Task 6で実ブラウザテストを作る。

## 作業を分ける理由と順序

| 段階 | タスク | 利用者が確認できるもの |
|---|---|---|
| A | 1 | 移行と復元で既存記録を保護できる土台 |
| B | 2・3 | 前回条件での開始、教材カードの学習状況 |
| C | 4 | 今日の目標、日別記録、カレンダー |
| D | 5・6 | 復習の成果、案内役と演出 |
| E | 7 | 6機能をつないだ試用版 |

各タスクはテスト→失敗の確認→実装→成功の確認→コミットの順。各段階でローカル画面を示す。公開はTask 7の確認後に別途判断する。

## ファイル構成

| ファイル | 責任 |
|---|---|
| `next/preferences.mjs`（新規） | 設定の既定値・検証・教材別プリセットの解決 |
| `next/activity.mjs`（新規） | ローカル日付、日別集計、目標、月カレンダーのデータ |
| `next/progress.mjs`（新規） | 既存記録からの教材進捗、セッション内の復習成果 |
| `next/learning-ui.mjs`（新規） | 目標行・カレンダー・追加設定のHTML。DOM操作と保存は持たない |
| `next/companion.mjs`（新規） | 案内役のSVG、表示条件、補助メッセージの選択 |
| `next/core.mjs`（変更） | schema1→2移行、採点時の新記録との接続 |
| `next/backup.mjs`（変更） | format1/2、統合・置換・取り消し、検証 |
| `next/app.mjs`（変更） | 既存画面と追加機能を接続するイベント・描画 |
| `next/index.html`（変更） | カレンダーを開くdialogの外枠 |
| `next/styles.css` / `next/themes.css`（変更） | 追加UIの伸縮・テーマ・演出 |
| `next/sw.js`（変更） | 新モジュールをオフライン対象へ追加 |
| `tests/next-preferences.test.mjs`（新規） | 設定・プリセットの検証 |
| `tests/next-activity.test.mjs`（新規） | 日別集計・日付・目標・カレンダー |
| `tests/next-progress.test.mjs`（新規） | 教材重複・不明ID・復習成果 |
| `tests/next-companion.test.mjs`（新規） | 表示設定とメッセージの優先順位 |
| `tests/next-core.test.mjs` / `tests/next-backup.test.mjs`（変更） | 移行・採点・復元の結合テスト |
| `tests/next-continuity.cjs`（新規） | 追加機能を利用者の操作順で確認するブラウザテスト |
| 既存 `tests/next-browser.cjs` / `tests/next-responsive.cjs`（変更） | 新しいホーム初期表示に合わせた既存検証の維持 |

## 共通インターフェース

時刻を使う純粋関数には必ず `now` 引数を渡せるようにする。テストが実際の今日に依存しないため。

```js
// Preferences
{ dailyGoal: 10, companion: 'auto', recentPreset: null, presets: {} }
// Activity
{ startedOn: '2026-10-28', days: {} }
// Day
{ answers: 6, goal: 10 }
// Config: 既存の型。新しい設定用の別形式は作らない。
{ kind: 'grammar', source: 'kin', mode: 'e2j', filter: 'all', count: '10',
  chapters: [], pos: [], ranges: [], dates: [] }
```

`preferences.mjs` と `activity.mjs` は `core.mjs` をimportしない。循環importを避ける。必要なカタログは引数で受け取る。
`progress.mjs` は `core.mjs` の `selectItems` を利用できるが、`core.mjs` は `progress.mjs` をimportしない。

### Task 1: 保存形式とバックアップの土台

**Files:** 新規 `next/preferences.mjs`, `next/activity.mjs`。変更 `next/core.mjs`, `next/backup.mjs`, `next/sw.js`, `tests/next-core.test.mjs`, `tests/next-backup.test.mjs`。新規 `tests/next-preferences.test.mjs`, `tests/next-activity.test.mjs`。

**Interfaces:**
- `defaultPreferences() -> Preferences`：新しい独立オブジェクトを返す。
- `validatePreferences(raw) -> Preferences`：型・値・プリセットを検証し複製。不正なら例外。
- `localDateKey(now: Date) -> 'YYYY-MM-DD'`。
- `emptyActivity(now: Date) -> Activity`。
- `validateActivity(raw) -> Activity`：実在する日付、非負の安全な整数、許容するgoalを検証。
- `mergeActivity(current, incoming) -> Activity`：日付の和集合、同日のanswersはmax、goalはcurrentを優先。入力を変更しない。
- `migrateSaved(raw, now: Date) -> DataV2`：`core.mjs`内。schema1/2を受け付け、旧形式へ既定値を追加。取り消しスナップショットも1段だけ移行。

- [x] **Step 1: 失敗する移行・設定・バックアップのテストを書く。** 既存fixtureを使い、実際の保存先の不変性を確認する。

```js
const store = openStore(diskWithSchema1);
assert.equal(store.data.schema, 2);
assert.deepEqual(store.data.preferences, {
  dailyGoal: 10, companion: 'auto', recentPreset: null, presets: {}
});
assert.deepEqual(store.data.activity.days, {});
assert.equal(diskWithSchema1.getItem(STORAGE_KEY), originalRaw);
// 未来形式を受け付けない既存テストはschema:3へ変更する。
```

追加ケース：schema2の負の回答数、存在しない2月30日、許容外目標、未知モード、危険なオブジェクトキー、2MB超、format2からの再書き出し、旧format1・従来版1〜5、同じファイルの再統合、容量不足と別タブ更新、取り消しスナップショットの移行。

- [x] **Step 2: `node --test tests/next-preferences.test.mjs tests/next-activity.test.mjs tests/next-core.test.mjs tests/next-backup.test.mjs` を実行し、新しい期待値で失敗することを確認する。**
- [x] **Step 3: 純粋関数、schema2移行、backup format2を実装する。** `openStore`の保存先照合と書込成功後の差し替えを維持する。初回のseedFromLegacyもschema2の既定項目を付け、新規・既存のどちらも同じDataV2を返す。

```js
// openStoreの読み込み後：既存のvalidSavedを版別の検証へ分ける。
data = migrateSaved(parsed, new Date());
// 新backupの追加フィールド：parseBackupで検証、prepareRestoreでモード別に反映。
next.activity = parsed.activity
  ? (mode === 'merge' ? mergeActivity(current.activity, parsed.activity) : structuredClone(parsed.activity))
  : (mode === 'merge' ? structuredClone(current.activity) : emptyActivity(new Date()));
```

旧形式には `parsed.activity` がない。統合では現状維持、置換では空にする。旧形式の設定は置換でも現状維持。復元プレビューへその説明を追加する。`createBackup`は引き続き`restoreUndo`を除外する。

- [x] **Step 4: 上記テストを再実行し、既存の記録保護テストも成功させる。** 新モジュールを`next/sw.js`のASSETSへ追加する。
- [x] **Step 5: 関連ファイルを限定して `git commit -m "Add learning preferences and activity backup schema"` で保存する。**

### Task 2: 前回の条件を覚えて開始する

**Files:** 変更 `next/preferences.mjs`, `next/app.mjs`, `tests/next-preferences.test.mjs`。新規 `tests/next-continuity.cjs`（既存ブラウザテストと同じ隔離Chrome・公開パス付き静的サーバーを使用）。

**Interfaces:**
- `presetKey(config) -> string`：`${kind}:${source}`。
- `rememberPreset(preferences, config) -> Preferences`：複製を返し、recentPresetも更新。
- `resolvePreset(preferences, key, catalog) -> {config: Config|null, needsConfirmation: boolean, message: string}`。
- `begin(config, items, {remember = true} = {})`：通常演習のみプリセットを保存する。復習・retry・repeatのうち通常条件の再演習以外は`remember:false`を渡す。

- [x] **Step 1: 通常演習・復習・教材更新の回帰テストを書く。**

```js
const saved = rememberPreset(defaultPreferences(), config);
assert.equal(saved.recentPreset, 'grammar:kin');
assert.deepEqual(saved.presets['grammar:kin'].chapters, [2]);
assert.equal(resolvePreset(saved, 'grammar:kin', catalogWithoutChapter2).needsConfirmation, true);
```

ブラウザでは「章2・20問」で開始→ホーム→再読込→前回条件で開始→session.configを確認する。途中セッションがあるときは続きからが優先。個別復習後に前回条件が変わらないこと、設定の未確定変更が保存されないこと、対象0件で設定へ戻ることも確認する。

- [x] **Step 2: `node --test tests/next-preferences.test.mjs` と追加ブラウザケースを実行して失敗を確認する。**
- [x] **Step 3: 教材を開く経路とホームCTAを接続する。**

```js
const restored = resolvePreset(data.preferences, presetKey(draft), catalog);
if (restored.config) draft = restored.config;
// needsConfirmationまたは対象0件なら演習を始めず設定画面を表示する。
// 標準に戻す操作ではdraftだけ変更し、通常演習を開始した時点でrememberPresetする。
```

`render()`のたびにプリセットを読んで編集中のdraftを上書きしない。教材ルートへ初めて入った時だけ読む。削除された教材はホームで利用可能な教材を案内する。

- [x] **Step 4: 再読み込みと復習のブラウザケースを通す。**
- [x] **Step 5: `git commit -m "Remember exercise settings per textbook"`。**

### Task 3: 教材カードに進捗を表示する

**Files:** 新規 `next/progress.mjs`, `tests/next-progress.test.mjs`。変更 `next/app.mjs`, `next/styles.css`, `next/themes.css`, `next/sw.js`, `tests/next-continuity.cjs`。

**Interfaces:** `bookProgress(catalog, records, kind, source) -> {total, seen, unseen}`。保存せず既存記録から計算する。

- [x] **Step 1: 同語の重複・複数モード・不明IDのテストを書く。**

```js
// 手書きfixture：同じ教材にtestが2行、otherが1行。testはe2jとtypeで回答済み。
assert.deepEqual(bookProgress(catalog, records, 'vocab', 'teppan'),
  {total: 2, seen: 1, unseen: 1});
// grammarSeenに現在存在しない999を含めても、現在2問中1問だけ学習済み。
assert.deepEqual(bookProgress(catalog, records, 'grammar', 'kin'),
  {total: 2, seen: 1, unseen: 1});
```

- [x] **Step 2: `node --test tests/next-progress.test.mjs` で失敗を確認する。**
- [x] **Step 3: selectItems相当の教材内重複排除とseen集合の交差を取り、カード内へ小さなバーと学習済み・未学習数を表示する。**

```js
const progress = bookProgress(catalog, data.records, kind, source);
// バーのaccessible nameにも数値を入れ、色だけに依存させない。
const label = `学習済み ${progress.seen} / ${progress.total}${kind === 'grammar' ? '問' : '語'}`;
```

単語カードには「いずれかのモードで回答済み」の説明を付ける。総数0では割り算しない。

- [x] **Step 4: 単体テスト、320/390/768/1440px・9テーマでのカード表示、回答後と復元後の更新を確認する。** 最初の教材カードが390×844pxで画面内に残るようホームの余白を調整する。
- [x] **Step 5: `git commit -m "Show study progress on textbook cards"`。段階Bの画面を示す。**

### Task 4: 今日の目標・日別記録・カレンダー

**Files:** 変更 `next/activity.mjs`, `next/core.mjs`, `next/app.mjs`, `next/index.html`, `next/styles.css`, `next/themes.css`, `next/sw.js`, `tests/next-activity.test.mjs`, `tests/next-core.test.mjs`, `tests/next-continuity.cjs`。新規 `next/learning-ui.mjs`。

**Interfaces:**
- `addDailyAnswer(activity, goal, now: Date) -> Activity`：1回答分だけ加算。呼出しは採点の成功経路に限定。
- `setDailyGoal(data, goal, now: Date) -> DataV2`：preferencesと既存の当日行を複製して更新。過去の日を変更しない。
- `activitySummary(activity, goal, now: Date) -> {date, answers, goal, achieved, activeDays, streak}`。
- `monthModel(activity, month: 'YYYY-MM', now: Date) -> {month, previousMonth, nextMonth, canGoNext, days}`。daysは先頭の空白と実在日（date,answers,goal,active,achieved,today,future）を持つ。
- `goalMarkup(summary) -> string`, `calendarMarkup(model) -> string`, `learningSettingsMarkup(preferences) -> string`：`learning-ui.mjs`の純粋なHTML描画。

- [x] **Step 1: 23:59→翌日、うるう年、夏時間を含む日付、目標変更、二重採点のテストを書く。**

```js
assert.equal(localDateKey(new Date(2026, 9, 28, 23, 59)), '2026-10-28');
assert.equal(localDateKey(new Date(2026, 9, 29, 0, 1)), '2026-10-29');
const a = {startedOn:'2026-10-27', days:{'2026-10-27':{answers:5,goal:5}}};
assert.equal(activitySummary(a,10,new Date(2026,9,28)).streak,1);
assert.equal(activitySummary(a,10,new Date(2026,9,29)).streak,0);
// recordAnswerを同じsession/itemに2回呼んでもactivityの回答数は1。
```

追加ケース：目標なし、目標を下げたときの達成表示、昨日の目標不変、復元での重複統合、時計を戻しても過去行を消さない、カレンダーの2月29日と未来月禁止。

- [x] **Step 2: 単体テストとカレンダー開閉・目標到達のブラウザケースを実行し、失敗を確認する。**
- [x] **Step 3: recordAnswerの二重採点ガードの内側で日別記録を更新する。**

```js
// 同一のnowを既存採点と日別集計に渡す。再描画や保存関数には加算処理を置かない。
data.activity = addDailyAnswer(data.activity, data.preferences.dailyGoal, new Date(now));
// app.answerでは回答前後のachievedを比較し、新規に越えた回答のときだけ一時的な演出状態を作る。
```

ホームには目標行だけを追加する。カレンダーはネイティブdialogで表示し、閉じる・Esc・フォーカス復帰に対応する。日付のラベルに「28日、6問、目標10問」などを入れる。月移動後に見出しを読み上げる。日付ボタンを設ける場合は44px以上を確保する（狭い画面では日付自体は非操作にし月移動ボタンで操作）。設定にも入口を付ける。

- [x] **Step 4: 表示中のローカル日付が変わるタイマー、visibilitychangeでの再確認を追加し、復元・設定変更から達成アニメーションが発火しないことを確認する。** 日付更新は入力途中のDOMを全描画し直さず、目標行・カレンダーだけを更新する。
- [x] **Step 5: `git commit -m "Add daily study goal and activity calendar"`。段階Cの画面を示す。**

### Task 5: 間違い直しの成果を正確に伝える

**Files:** 変更 `next/core.mjs`, `next/progress.mjs`, `next/backup.mjs`, `next/app.mjs`, `tests/next-core.test.mjs`, `tests/next-progress.test.mjs`, `tests/next-backup.test.mjs`, `tests/next-continuity.cjs`。

**Interfaces:** `reviewSummary(session) -> {reviewed, graduated}`。`reviewed`はwasWeakかつ正解の回答数、`graduated`は実際に苦手から削除した回答数。

- [x] **Step 1: 即日復習と間隔復習完了を分けたテストを書く。**

```js
assert.deepEqual(reviewSummary({answers:{
  a:{correct:true,wasWeak:true,graduated:false},
  b:{correct:false,wasWeak:true,graduated:false},
  c:{correct:true}
}}), {reviewed:1,graduated:0});
// dueが未来なら正解しても削除されない。streak3かつdue到来の正解だけgraduated:true。
```

- [x] **Step 2: `node --test tests/next-core.test.mjs tests/next-progress.test.mjs tests/next-backup.test.mjs` で失敗を確認する。**
- [x] **Step 3: 回答前のweakMapの存在をwasWeakとして保存し、既存の削除経路を通った時だけgraduatedをtrueにする。**

```js
const wasWeak = Boolean(map[item.key]);
// 採点と間隔復習の更新後：
session.answers[item.id].wasWeak = wasWeak;
session.answers[item.id].graduated = wasWeak && result.correct && !map[item.key];
```

`safeSession`で両値が未定義またはbooleanであることを検証する。終了画面にはreviewed>0の時だけ成果を追加し、graduated>0なら別に「克服」を表示する。0件なら通常の結果文を使う。

- [x] **Step 4: 同じ問題の見直し・再読込・旧セッション復元で数値を推測・重複加算しないことを確認する。**
- [x] **Step 5: `git commit -m "Report review progress without changing mastery rules"`。**

### Task 6: オリジナル案内役と演出の統一

**Files:** 新規 `next/companion.mjs`, `tests/next-companion.test.mjs`。変更 `next/learning-ui.mjs`, `next/app.mjs`, `next/styles.css`, `next/themes.css`, `next/sw.js`, `tests/next-continuity.cjs`。

**Interfaces:**
- `companionVisible(preferences, theme) -> boolean`。
- `feedbackModel({correct,goalReached,streak,reviewed,complete}) -> {state,message,detail}`：stateはneutral/encourage/reflect/celebrate。補助detailは目標達成→連続正解の順に最大1件。
- `companionMarkup(state) -> string`：装飾SVG。任意入力をそのままHTMLへ埋め込まない。

- [x] **Step 1: 表示設定と同時イベントのテストを書く。**

```js
assert.equal(companionVisible({companion:'auto'},'duolingo'),true);
assert.equal(companionVisible({companion:'auto'},'light'),false);
assert.equal(companionVisible({companion:'off'},'duolingo'),false);
const f = feedbackModel({correct:true,goalReached:true,streak:5,reviewed:0,complete:false});
assert.match(f.detail,/目標達成/);
assert.ok(!f.detail.includes('連続'));
```

ブラウザでは目標10問の10問目を正解し、目標達成・連続正解・案内役が1つのバナー内に収まることを確認する。不正解時は正しい答えが優先される。非表示設定でも全情報と操作が残ることを確認する。

- [x] **Step 2: 単体・ブラウザテストで失敗を確認する。**
- [x] **Step 3: しおり型のSVGを4状態で描画し、既存の正誤バナー・終了画面へ組み込む。**

```js
const shown = companionVisible(data.preferences, data.theme);
const artwork = shown ? companionMarkup(model.state) : '';
// model.message/detailは既存のテキスト欄に出し、別の通知枠を追加しない。
```

48〜64px程度から始め、320px幅では装飾を縮める。動きは新規回答・新規完了のみ。既存のanimateAnswerと競合させず1〜2要素に限定する。prefers-reduced-motionで停止し、SVGはaria-hiddenにする。案内役on/offを設定から保存できるようにする。

- [x] **Step 4: 9テーマ、320px・横向き・200%文字、タップとキーボード、再読込・復元時の演出抑制を確認する。**
- [x] **Step 5: `git commit -m "Add optional bookmark companion and unified feedback"`。段階Dの画面を示す。**

### Task 7: 全体をつないで検証し、公開前の状態を作る

**Files:** 変更 `tests/next-continuity.cjs`, `tests/next-browser.cjs`, `tests/next-responsive.cjs`, `docs/study-desk-preview.md`。必要な修正は所有するタスクのモジュールへ戻す。

- [x] **Step 1: 一連の利用手順を追加ブラウザテストに固定する。**

```js
// 初回→教材選択→条件指定→10問回答→目標達成→結果→ホーム進捗→カレンダー
// →案内役off→JSON書出→別の隔離contextで復元→前回条件で開始→復習。
assert.deepEqual(afterRestore.activity, beforeExport.activity);
assert.equal(afterRestore.preferences.dailyGoal, 10);
assert.equal(afterRestore.preferences.companion, 'off');
```

従来版キー不変、外部通信ゼロ、Service Worker共存、新モジュールのオフライン再読込も確認する。

- [x] **Step 2: 全単体テストと3つの試用版ブラウザスイートを実行する。**

```sh
node --test tests/next-*.test.mjs
NODE_PATH=/Users/reiji/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tests/next-continuity.cjs
NODE_PATH=/Users/reiji/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tests/next-browser.cjs
NODE_PATH=/Users/reiji/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node --test tests/next-responsive.cjs
```

この環境ではPlaywright既定ブラウザを追加ダウンロードせず、テストの起動に`channel:'chrome'`を指定する。従来版の57テストは既存ファイルを変更せず、前回同様に起動設定だけメモリ内でChromeへ置換して実行する。

- [x] **Step 3: 390×844、320×568、768×375、1440×1000の画像を確認する。** ホームの目標行と進捗で教材選択が再び遠くなっていないか、カレンダーが読めるか、案内役がボタンを覆わないかを確認する。実機iOS/Androidのキーボードは確認できた範囲を区別して記録する。
- [x] **Step 4: 記録移行・バックアップ互換性・日別統合の制約・案内役設定を説明書へ記載し、`git diff --check`と従来版の差分ゼロを確認する。**
- [x] **Step 5: ローカルでコミットし、完成した試用版のURLと検証結果を提示する。** 公開の了承が得られた場合だけ、最新origin/mainとの差分とPages状態を確認して公開する。

## 計画のセルフレビュー

- 6機能の対応先：前回条件=Task 2、教材進捗=Task 3、目標・学習日=Task 4、復習成果=Task 5、案内役=Task 6。
- 記録とUIを分け、新モジュールは担当タスクでSWの対象に含める。
- 将来形式・日付・教材更新・多重採点・復元・表示競合の確認先を各タスクへ割り当てた。
- 同日データの統合はmaxであり端末間の厳密合算ではないこと、過去の日別履歴は復元できないことを設計・説明へ明記した。
- 新サービスへの登録・Google Drive同期・通知・ランキング・ログイン機能は6機能に必要ないため追加対象に含めない。

## レビューと実行方法

まず設計案とこの計画を確認し、既定の目標10問・案内役auto・日別履歴を導入後から記録する方針を承認してもらう。
実行方法は、このチャットで順に実装する方式を推奨する。保存形式と採点経路を共有する変更が多く、同じ担当が接続部分を追いやすいため。
サブエージェント方式を選ぶ場合は、タスクごとの実装とレビューを分け、共有するcore/app/backupを同時編集しない。
承認前に製品コードの実装を始めない。


## 実行結果

2026-10-28、`89edb85`から順に実装。単体35件、機能・レスポンシブ操作19件、既存試用版11項目が成功。
独立レビューで発見された「ドロップダウンでの教材切替時の前回条件」と「横向きの目標達成表示」は、失敗するテストで再現後に修正した。
日別履歴は導入後から記録。実機iOS/Androidのキーボード・読み上げ操作は未確認で、Chromeの隔離プロファイルと文字拡大で検証した範囲に限る。
