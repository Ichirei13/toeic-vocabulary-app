# 現行版へ Study Desk の機能を移植する 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-subagent-driven-development (recommended) or sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 実行方法はユーザー指定の **native**（サブエージェントを使わず、このセッションで直接実行）→ `sp-executing-plans`。

**Goal:** 現行版（`index.html` ＋ `home.js` ＋ `home.css`）に、絞り込みの対象件数、ホームの PC レイアウト、今日の目標とカレンダー、4 つ目の画面「復習」を追加する。

**Architecture:** 新しい純粋ロジックは `src/*.js`（classic script と node の両方で読める小さな UMD ファイル）に置き、node の単体テストで固める。画面への接続は `home.js` と `index.html` の最小限の変更で行う。既存の保存キーの形式は変えず、新しいデータは `toeic_prefs_v1` と既存 `toeic_daily_activity_v1` の拡張だけで持つ。

**Tech Stack:** 素の HTML / CSS / JavaScript（ビルドなし、外部依存なし）、node の組み込みテスト（`node --test`）、pytest（既存）、ブラウザ確認は Claude のブラウザペイン。

**Spec:** `docs/superpowers/specs/2026-10-29-port-study-desk-features-design.md`

## Global Constraints

- 既存の保存キー（`toeic_weak_*`、`toeic_seen_*`、`toeic_*_stats`、設定、セッション）の形式と意味は変更しない。`toeic_next_v1` は使わない。
- 新しい記録（`toeic_prefs_v1`、日別記録の拡張）は **Google Drive 同期の対象（`RECORD_KEYS` / `RECORD_STORAGE_KEYS`）に入れない**。バックアップと取り消しには含める。
- ビルド処理・外部ライブラリ・外部通信を追加しない。新ファイルは `sw.js` の `ASSETS` に追加する。
- 色・角丸は現行のテーマ変数（`--ui-surface`、`--ui-border`、`--accent`、`--text-page`、`--text-muted` など）だけを使い、新しい配色を足さない。
- 演習画面・設定画面の幅と中身は変えない（演習画面の PC 対応は今回やらない）。
- 絞り込みの挙動は現行のまま（タップで即反映）。「適用で確定」方式にしない。
- 画面の文言は日本語。コマンドは `python3` を使う（`python` は無い）。
- コミットは `git add` でファイルを個別に指定する（作業フォルダには追跡していない `*.bak*` が多いので `git add -A` / `git add .` は使わない）。コミットメッセージの末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` を付ける。
- **`git push`（公開）は、段階ごとにユーザーの確認を取ってから行う。** 確認なしに push しない。

## Review Focus

仕様が前提にしているがタスクのテストが直接は扱わない入力・状況（起こりやすい順）。各行の対策テストは、担当タスクの手順に入れてある。

1. `toeic_prefs_v1` が壊れている・存在しない・未知の目標値 → 目標 10 問で普通に起動する（Task 3 の `normalizeGoal`、Task 4 の確認）。
2. 目標を「なし」にしている日 → 達成メッセージもトーストも出ず、カレンダーに達成印が付かない（Task 3 / 4 のテスト）。
3. 形式 1〜5 の古いバックアップを「上書き復元」しても、今の日別記録と目標が消えない（Task 6 の確認）。
4. 対象 0 件の絞り込み → ボタンの近くに理由が出て、既存の「条件に合う…がありません」も変わらない（Task 1 の確認）。
5. アプリを開いたまま日付が変わる → ホームの「今日 N / M問」が 0 に戻る（Task 5 の日付更新）。
6. 未来の月へカレンダーを送れない／昔の取り消し用スナップショット（日別記録のキーが無い）で取り消しても日別記録が消えない（Task 3 / Task 6）。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/filter-count.js`（新規） | 絞り込みシートのボタン文言と 0 件判定（純粋関数） |
| `src/activity.js`（新規） | 目標値の正規化、今日の進捗、月カレンダーのモデル、日別記録の検証と統合（純粋関数） |
| `src/review.js`（新規） | 演習 1 回分の「苦手を復習・克服した数」の集計（純粋関数） |
| `tests/unit/*.test.js`（新規） | 上の 3 ファイルの単体テスト（`node --test tests/unit/`） |
| `tests/test_port_wiring.py`（新規） | `index.html` / `sw.js` への組み込み漏れを検出する静的テスト（pytest） |
| `home.js` | 目標・日別記録の保存、ホームの目標行、ダイアログ、復習画面、回答フック |
| `home.css` | ホームの PC レイアウト、目標行、ダイアログ、復習画面の見た目 |
| `index.html` | script タグ、絞り込みボタン、ナビ、復習ページの器、バックアップ形式 6、完了画面の一文 |
| `sw.js` | `ASSETS` への新ファイル追加 |

## ブラウザ確認の準備（各タスクで共通）

プレビュー用サーバを起動し、Claude のブラウザペインで開く。終わったら止める。

```bash
cd /Users/reiji/myapps/toeic_practice && python3 -m http.server 8766 --bind 127.0.0.1
```

バックグラウンドで起動し、`http://127.0.0.1:8766/` を開く。幅の切り替えはブラウザペインの `resize_window`（375 / 1024 / 1440）。確認後は `pkill -f "http.server 8766"`。

---

## 段階 0：着手前の安全確保

### Task 0: 復元用タグとベースライン

**Files:**
- Create: `tests/unit/`（空ディレクトリは作らず、Task 1 のテストと同時に作る）

**Interfaces:**
- Consumes: なし
- Produces: git タグ `stable-before-port-20261029`（以降のすべての作業の復元地点）

- [ ] **Step 1: 作業ツリーの状態を確認する**

Run: `cd /Users/reiji/myapps/toeic_practice && git status --short | grep -v '^??'`
Expected: 出力なし（追跡ファイルに未コミットの変更がない）。変更があれば止めてユーザーに報告する。

- [ ] **Step 2: 復元用タグを打つ**

```bash
cd /Users/reiji/myapps/toeic_practice && git tag stable-before-port-20261029 && git tag | grep port
```
Expected: `stable-before-port-20261029` が表示される。

- [ ] **Step 3: 既存テストのベースラインを記録する**

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests -q 2>&1 | tail -15`
Expected: 結果（通過数・失敗数）を控える。`English_study` の Vault に依存するテストが失敗する場合は、その失敗名を「ベースラインで失敗済み」として控える。以降の回帰判定はこのベースラインとの差で行う。

- [ ] **Step 4: スペックとプランをコミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add docs/superpowers/specs/2026-10-29-port-study-desk-features-design.md docs/superpowers/plans/2026-10-29-port-study-desk-features.md && git commit -m "docs: add spec and plan for porting Study Desk features" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## 段階 1：絞り込みの対象件数

### Task 1: 「この条件で解く（対象 N 問）」

**Files:**
- Create: `src/filter-count.js`
- Create: `tests/unit/filter-count.test.js`
- Create: `tests/test_port_wiring.py`
- Modify: `index.html`（script タグ、ボタン、`updateFilterSummary`、`openFilterSheet`）
- Modify: `home.css`（末尾に追記）
- Modify: `sw.js`（`ASSETS`）

**Interfaces:**
- Consumes: 既存の `getCurrentPoolCount()`（`index.html`、現在の出題プールの件数を返す）、`state.app`
- Produces: `StudyCore.filterCountLabel(count: number, unit: string) -> { label: string, empty: boolean }`（`src/filter-count.js`）、`refreshFilterApplyLabel()`（`index.html` のグローバル関数）

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/filter-count.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { filterCountLabel } = require('../../src/filter-count.js');

test('件数と単位をラベルに入れる', () => {
  assert.deepStrictEqual(filterCountLabel(160, '問'), { label: 'この条件で解く（対象 160 問）', empty: false });
  assert.deepStrictEqual(filterCountLabel(1635, '語'), { label: 'この条件で解く（対象 1,635 語）', empty: false });
});

test('0 件は empty を立てる', () => {
  assert.deepStrictEqual(filterCountLabel(0, '問'), { label: 'この条件で解く（対象 0 問）', empty: true });
});

test('数でない値・負の値・小数は安全に 0 または切り捨てにする', () => {
  assert.strictEqual(filterCountLabel(undefined, '問').empty, true);
  assert.strictEqual(filterCountLabel(NaN, '問').empty, true);
  assert.strictEqual(filterCountLabel(-3, '問').empty, true);
  assert.strictEqual(filterCountLabel(12.9, '問').label, 'この条件で解く（対象 12 問）');
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/filter-count.test.js`
Expected: FAIL（`Cannot find module '../../src/filter-count.js'`）

- [ ] **Step 3: 最小限の実装を書く**

`src/filter-count.js`:

```js
// 絞り込みシートの「この条件で解く」ボタンに出す文言と、0 件の判定。
// ブラウザでは StudyCore.filterCountLabel、node では require で使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  function filterCountLabel(count, unit) {
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    return {
      label: `この条件で解く（対象 ${n.toLocaleString('en-US')} ${unit}）`,
      empty: n === 0,
    };
  }
  return { filterCountLabel };
});
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/filter-count.test.js`
Expected: PASS（3 テスト）

- [ ] **Step 5: 組み込み漏れを検出する静的テストを書く（失敗させる）**

`tests/test_port_wiring.py`:

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


def test_filter_count_is_wired():
    assert '<script src="src/filter-count.js"></script>' in HTML
    assert 'id="filter-apply-btn"' in HTML
    assert 'id="filter-zero-note"' in HTML
    assert "function refreshFilterApplyLabel()" in HTML
    assert "'src/filter-count.js'" in SW


def test_new_scripts_load_before_home_js():
    # src/*.js は home.js より前に読み込む（home.js の先頭で StudyCore を使うため）
    home = HTML.index('<script src="home.js"></script>')
    for name in ("filter-count",):
        assert HTML.index(f'<script src="src/{name}.js"></script>') < home
```

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py -q`
Expected: FAIL（まだ組み込んでいない）

- [ ] **Step 6: `index.html` に組み込む**

(a) script タグ。`<script src="data/grammar.js"></script>` の直後に追加:

```html
<script src="src/filter-count.js"></script>
```

(b) ボタンと 0 件の案内。次の 1 行を置き換える。

置換前:
```html
    <button class="filter-apply-btn" onclick="closeFilterSheet()">この条件で解く</button>
```
置換後:
```html
    <div class="filter-zero-note" id="filter-zero-note" role="status" hidden>条件に合う問題がありません。条件をゆるめてください。</div>
    <button class="filter-apply-btn" id="filter-apply-btn" onclick="closeFilterSheet()">この条件で解く</button>
```

(c) ラベル更新関数。`function updateFilterSummary() {` の直前に追加し、`updateFilterSummary` の先頭で呼ぶ。

置換前:
```js
function updateFilterSummary() {
  let n = 0;
```
置換後:
```js
// 絞り込みシートのボタンに、今の出題プールの件数を出す
function refreshFilterApplyLabel() {
  const btn = document.getElementById('filter-apply-btn');
  if (!btn || !window.StudyCore) return;
  const { label, empty } = StudyCore.filterCountLabel(getCurrentPoolCount(), state.app === 'grammar' ? '問' : '語');
  btn.textContent = label;
  const note = document.getElementById('filter-zero-note');
  if (note) note.hidden = !empty;
}

function updateFilterSummary() {
  refreshFilterApplyLabel();
  let n = 0;
```

(d) シートを開いたときにも更新する。

置換前:
```js
function openFilterSheet() {
  closeSheet();
```
置換後:
```js
function openFilterSheet() {
  closeSheet();
  refreshFilterApplyLabel();
```

- [ ] **Step 7: `home.css` の末尾に 0 件の案内の見た目を追加する**

```css

/* 絞り込みシート：対象 0 件の案内 */
.filter-zero-note {
  margin: 8px 0 0;
  padding: 8px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
.filter-zero-note[hidden] { display: none; }
```

- [ ] **Step 8: `sw.js` の `ASSETS` に追加する**

置換前:
```js
  'home.js',
```
置換後:
```js
  'home.js',
  'src/filter-count.js',
```

- [ ] **Step 9: 静的テストと既存テストを実行する**

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py tests/test_ui_consistency.py -q && node --test tests/unit/`
Expected: すべて PASS

- [ ] **Step 10: ブラウザで確認する**

プレビューサーバを起動し、`http://127.0.0.1:8766/#practice` を 375px 幅で開いて確認する（コンソールエラーが無いこと、`read_console_messages` で確認）。

1. 絞り込みボタンを押してシートを開く → ボタンが「この条件で解く（対象 N 語）」になり、N がフッターの総数（`1 / N` の N）と一致する。
2. 「文法ドリル (Part 5)」に切り替え → 「対象 1,155 問」（全冊のとき）。「👑 金の文法」を押す → 「対象 160 問」にその場で変わる。
3. 文法で「苦手のみ」を押し、苦手が 0 件のデータ状態 → 「対象 0 問」と、ボタン上に「条件に合う問題がありません。条件をゆるめてください。」が出る。カード側の「条件に合う文法問題がありません」も従来どおり出る。
4. 「すべて」に戻すと案内が消える。

- [ ] **Step 11: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add src/filter-count.js tests/unit/filter-count.test.js tests/test_port_wiring.py index.html home.css sw.js && git commit -m "feat: show matching question count on the filter apply button" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.5: 段階 1 のチェックポイント

- [ ] **Step 1:** ユーザーに「段階 1（対象件数）が動いた。スマホ幅で確認済み。公開（push）してよいか」を報告し、確認を待つ。承認がなければ push せず、次の段階へ進んでよいかだけ確認する。
- [ ] **Step 2:** 承認されたら `git push origin main`。公開後、本番 URL で絞り込みシートの表示を確認する。

---

## 段階 2：ホーム画面の PC レイアウト

### Task 2: ホームを広い画面で 2 カラムにする

**Files:**
- Modify: `home.js`（`renderHomePage` のテンプレート、`switchAppPage`）
- Modify: `home.css`（末尾に追記）

**Interfaces:**
- Consumes: 既存の `renderHomePage()` / `switchAppPage(page, options)`
- Produces: `#app` に付く `page-home` クラス（ホーム表示中のみ）、ホームの DOM 構造 `.home-layout > (.home-top, .home-col-main, .home-col-side)`。Task 5 は `.home-col-side` の先頭に目標行を入れる。

- [ ] **Step 1: `renderHomePage` のテンプレートにラッパーを入れる**

`home.js` の `renderHomePage` 内、`container.innerHTML = \`` の中を 4 か所編集する。

(a) 先頭。置換前:
```js
  container.innerHTML = `
    <!-- 1. メッセージ枠（タップで他の褒めポイントへ切り替え） -->
```
置換後:
```js
  container.innerHTML = `
    <div class="home-layout">
    <div class="home-top">
    <!-- 1. メッセージ枠（タップで他の褒めポイントへ切り替え） -->
```

(b) 切り替えスイッチの後。置換前:
```js
    <!-- 3. 学習中の参考書（前回解いた1冊） -->
```
置換後:
```js
    </div>
    <div class="home-col-main">
    <!-- 3. 学習中の参考書（前回解いた1冊） -->
```

(c) 苦手問題バーの後。置換前:
```js
    <!-- 5. 他の参考書（スクロール可能ボックス） -->
```
置換後:
```js
    </div>
    <div class="home-col-side">
    <!-- 5. 他の参考書（スクロール可能ボックス） -->
```

(d) 末尾。`renderHomePage` の最後の `</section>\n  \`;\n}` を置き換える。置換前（`renderSettingsPage` の直前）:
```js
    </section>
  `;
}

function renderSettingsPage() {
```
置換後:
```js
    </section>
    </div>
    </div>
  `;
}

function renderSettingsPage() {
```

- [ ] **Step 2: `switchAppPage` で `page-home` クラスを切り替える**

置換前:
```js
  currentAppPage = page;

  // シートが開いていれば閉じる（オプションで維持指定がない場合）
```
置換後:
```js
  currentAppPage = page;
  const appEl = document.getElementById('app');
  if (appEl) appEl.classList.toggle('page-home', page === 'home');

  // シートが開いていれば閉じる（オプションで維持指定がない場合）
```

- [ ] **Step 3: `home.css` の末尾に PC レイアウトを追加する**

```css

/* ==================== ホーム：ラッパー（狭い画面では何もしない） ==================== */
.home-layout,
.home-top,
.home-col-main,
.home-col-side {
  display: contents;
}

/* ==================== ホーム：PC の広い画面で 2 カラム ==================== */
@media (min-width: 1024px) {
  #app.page-home {
    max-width: 1080px;
  }
  #app.page-home #home-page {
    padding: 18px 28px 28px;
  }
  #app.page-home .home-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 14px 22px;
    align-items: start;
  }
  #app.page-home .home-top {
    display: flex;
    flex-direction: column;
    gap: 10px;
    grid-column: 1 / -1;
  }
  #app.page-home .home-col-main,
  #app.page-home .home-col-side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  /* 他の参考書は PC では内側スクロールをやめ、そのまま並べる */
  #app.page-home .home-others-section {
    flex: none;
    min-height: 0;
  }
  #app.page-home .home-others-scroll {
    flex: none;
    overflow: visible;
    max-height: none;
  }
}
```

- [ ] **Step 4: 回帰を確認する（スマホ幅で見た目が変わっていないこと）**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/ && python3 -m pytest tests/test_port_wiring.py tests/test_ui_consistency.py -q`
Expected: PASS

- [ ] **Step 5: ブラウザで確認する**

プレビューサーバで `http://127.0.0.1:8766/#home` を開き、幅を切り替えて確認する。

1. 375px: 変更前の画面（メッセージ枠 → 単語/文法 → 学習中の参考書 → 苦手問題 → 他の参考書の内側スクロール）と同じ。コンソールエラーなし。
2. 768px: 1 カラムのまま。
3. 1024px・1440px: メッセージ枠と切り替えが上に全幅で並び、左に「学習中の参考書」「苦手問題」、右に「他の参考書」の一覧（内側スクロールなし、全部並ぶ）。
4. 1440px で「演習」「設定」タブへ切り替える → 幅が従来どおりの細い列に戻る。「ホーム」に戻ると広がる。
5. 単語 ⇄ 文法の切り替え、「つづきから」「範囲を指定」「苦手を解く」「一覧を見る」が従来どおり動く。
6. 文字拡大 200%（ブラウザのズーム）で 1024px 幅でも崩れない。

- [ ] **Step 6: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add home.js home.css && git commit -m "feat: two-column home layout on wide screens" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.5: 段階 2 のチェックポイント

- [ ] **Step 1:** ユーザーに段階 2 の結果（1440px のホームのスクリーンショットを含む）を報告し、公開（push）してよいか確認する。承認されたら `git push origin main`。

---

## 段階 3：今日の目標とカレンダー

### Task 3: `src/activity.js`（純粋ロジック）

**Files:**
- Create: `src/activity.js`
- Create: `tests/unit/activity.test.js`
- Modify: `index.html`（script タグ）、`sw.js`、`tests/test_port_wiring.py`

**Interfaces:**
- Consumes: なし
- Produces（すべて `StudyCore.*`、node では `require('../../src/activity.js')`）:
  - `GOALS: number[]` = `[0, 5, 10, 20, 30]`
  - `normalizeGoal(v: any) -> number`（GOALS に含まれる数値ならそのまま、それ以外は 10）
  - `goalProgress(day: {a?:number}|undefined, goal: number) -> { answered, goal, hasGoal, reached, ratio }`
  - `sanitizeActivity(raw: any) -> { days: Record<string, {a,c,fast,sec,g?,gr?}>, invalid: number }`（`raw` は `{ days: {...} }`）
  - `mergeActivity(cur: days, inc: days) -> days`（同じ日は `a` の大きい方。`g` は cur 優先。`gr` は大きい方）
  - `monthModel(days, ym: 'YYYY-MM', todayKey: 'YYYY-MM-DD') -> { ym, label, leading, cells:[{day,key,answered,goal,studied,reached,future,today}], canNext }`
  - `shiftMonth(ym, delta) -> 'YYYY-MM'`
  - `studiedDays(days) -> number`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/activity.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const A = require('../../src/activity.js');

test('normalizeGoal: 許可された数値だけ通し、それ以外は 10', () => {
  assert.strictEqual(A.normalizeGoal(0), 0);
  assert.strictEqual(A.normalizeGoal(5), 5);
  assert.strictEqual(A.normalizeGoal(30), 30);
  assert.strictEqual(A.normalizeGoal(undefined), 10);
  assert.strictEqual(A.normalizeGoal(null), 10);
  assert.strictEqual(A.normalizeGoal('5'), 10);
  assert.strictEqual(A.normalizeGoal(7), 10);
  assert.strictEqual(A.normalizeGoal(NaN), 10);
});

test('goalProgress: 達成・未達・目標なし', () => {
  assert.deepStrictEqual(A.goalProgress({ a: 3 }, 10), { answered: 3, goal: 10, hasGoal: true, reached: false, ratio: 0.3 });
  assert.strictEqual(A.goalProgress({ a: 10 }, 10).reached, true);
  assert.strictEqual(A.goalProgress({ a: 25 }, 10).ratio, 1);
  const none = A.goalProgress({ a: 40 }, 0);
  assert.strictEqual(none.hasGoal, false);
  assert.strictEqual(none.reached, false);
  assert.strictEqual(none.ratio, 0);
  assert.strictEqual(A.goalProgress(undefined, 10).answered, 0);
});

test('sanitizeActivity: 正しい日だけ残し、不正な日は数える', () => {
  const r = A.sanitizeActivity({ days: {
    '2026-10-28': { a: 5, c: 3, fast: 1, sec: 20.5, g: 10, gr: 2 },
    '2026-10-27': { a: 2, c: 9, fast: 9, sec: -4 },
    'bad-key': { a: 1 },
    '2026-10-26': { a: 0 },
    '2026-10-25': 'x',
  } });
  assert.deepStrictEqual(r.days['2026-10-28'], { a: 5, c: 3, fast: 1, sec: 20.5, g: 10, gr: 2 });
  assert.deepStrictEqual(r.days['2026-10-27'], { a: 2, c: 2, fast: 2, sec: 0 });
  assert.strictEqual(Object.keys(r.days).length, 2);
  assert.strictEqual(r.invalid, 3);
});

test('sanitizeActivity: 壊れた入力は空にする', () => {
  assert.deepStrictEqual(A.sanitizeActivity(null), { days: {}, invalid: 0 });
  assert.deepStrictEqual(A.sanitizeActivity([]), { days: {}, invalid: 0 });
  assert.deepStrictEqual(A.sanitizeActivity({ days: [] }), { days: {}, invalid: 0 });
  assert.deepStrictEqual(A.sanitizeActivity({ days: { '2026-10-28': { a: 1, g: 7 } } }).days['2026-10-28'].g, undefined);
});

test('mergeActivity: a の大きい方・g は現在優先・gr は大きい方', () => {
  const cur = { '2026-10-28': { a: 5, c: 3, fast: 0, sec: 10, g: 20 }, '2026-10-27': { a: 1, c: 1, fast: 0, sec: 1 } };
  const inc = { '2026-10-28': { a: 8, c: 6, fast: 2, sec: 30, g: 5, gr: 3 }, '2026-10-26': { a: 4, c: 2, fast: 0, sec: 9, g: 10 } };
  const out = A.mergeActivity(cur, inc);
  assert.strictEqual(out['2026-10-28'].a, 8);
  assert.strictEqual(out['2026-10-28'].c, 6);
  assert.strictEqual(out['2026-10-28'].g, 20);
  assert.strictEqual(out['2026-10-28'].gr, 3);
  assert.strictEqual(out['2026-10-27'].a, 1);
  assert.strictEqual(out['2026-10-26'].g, 10);
  assert.strictEqual(Object.keys(out).length, 3);
});

test('mergeActivity: 目標が現在側に無ければ取り込み側の値を使う', () => {
  const out = A.mergeActivity({ '2026-10-28': { a: 1, c: 0, fast: 0, sec: 1 } }, { '2026-10-28': { a: 1, c: 0, fast: 0, sec: 1, g: 5 } });
  assert.strictEqual(out['2026-10-28'].g, 5);
});

test('monthModel: 2026年10月（10/1 は木曜）', () => {
  const days = {
    '2026-10-27': { a: 3, c: 2, fast: 0, sec: 5, g: 10 },
    '2026-10-28': { a: 12, c: 9, fast: 0, sec: 50, g: 10 },
    '2026-10-26': { a: 4, c: 4, fast: 0, sec: 9, g: 0 },
  };
  const m = A.monthModel(days, '2026-10', '2026-10-29');
  assert.strictEqual(m.label, '2026年10月');
  assert.strictEqual(m.leading, 4);
  assert.strictEqual(m.cells.length, 31);
  assert.strictEqual(m.canNext, false);
  const c = key => m.cells.find(x => x.key === key);
  assert.strictEqual(c('2026-10-28').reached, true);
  assert.strictEqual(c('2026-10-27').studied, true);
  assert.strictEqual(c('2026-10-27').reached, false);
  assert.strictEqual(c('2026-10-26').reached, false); // 目標なしの日は達成にしない
  assert.strictEqual(c('2026-10-29').today, true);
  assert.strictEqual(c('2026-10-30').future, true);
  assert.strictEqual(c('2026-10-01').studied, false);
});

test('monthModel: 過去の月は次へ進める', () => {
  assert.strictEqual(A.monthModel({}, '2026-09', '2026-10-29').canNext, true);
});

test('shiftMonth: 年またぎ', () => {
  assert.strictEqual(A.shiftMonth('2026-01', -1), '2025-12');
  assert.strictEqual(A.shiftMonth('2026-12', 1), '2027-01');
  assert.strictEqual(A.shiftMonth('2026-10', 0), '2026-10');
});

test('studiedDays: 1 問以上答えた日の数', () => {
  assert.strictEqual(A.studiedDays({ '2026-10-28': { a: 1 }, '2026-10-27': { a: 0 }, x: { a: 5 } }), 1);
  assert.strictEqual(A.studiedDays(undefined), 0);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/activity.test.js`
Expected: FAIL（`Cannot find module '../../src/activity.js'`）

- [ ] **Step 3: 実装を書く**

`src/activity.js`:

```js
// 今日の目標・日別記録・月カレンダーの純粋ロジック（DOM にも localStorage にも触れない）。
// ブラウザでは StudyCore.*、node では require で使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const GOALS = [0, 5, 10, 20, 30];
  const DEFAULT_GOAL = 10;
  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const toInt = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

  // 数値で、許可された目標のときだけ通す。文字列や未知の値は初期値の 10 問
  function normalizeGoal(v) {
    return GOALS.includes(v) ? v : DEFAULT_GOAL;
  }

  function goalProgress(day, goal) {
    const answered = toInt(day && day.a);
    const g = normalizeGoal(goal);
    return {
      answered,
      goal: g,
      hasGoal: g > 0,
      reached: g > 0 && answered >= g,
      ratio: g > 0 ? Math.min(1, answered / g) : 0,
    };
  }

  // raw は { days: { 'YYYY-MM-DD': { a, c, fast, sec, g?, gr? } } }。形の正しい日だけ残し、除いた数を返す
  function sanitizeActivity(raw) {
    const days = {};
    let invalid = 0;
    if (!isObject(raw) || !isObject(raw.days)) return { days, invalid: 0 };
    Object.keys(raw.days).forEach(k => {
      const e = raw.days[k];
      if (!DATE_KEY.test(k) || !isObject(e) || toInt(e.a) <= 0) {
        invalid++;
        return;
      }
      const a = toInt(e.a);
      const entry = {
        a,
        c: Math.min(a, toInt(e.c)),
        fast: Math.min(a, toInt(e.fast)),
        sec: Math.max(0, Number(e.sec) || 0),
      };
      if (GOALS.includes(e.g)) entry.g = e.g;
      if (toInt(e.gr) > 0) entry.gr = toInt(e.gr);
      days[k] = entry;
    });
    return { days, invalid };
  }

  // 同じ日は回答数 a の大きい方を採用（端末間の厳密な合算ではない）。目標 g は現在（cur）を優先
  function mergeActivity(cur, inc) {
    const out = {};
    const c = cur || {};
    const i = inc || {};
    new Set([...Object.keys(c), ...Object.keys(i)]).forEach(k => {
      const a = c[k];
      const b = i[k];
      const picked = !a ? b : !b ? a : (b.a > a.a ? b : a);
      const entry = { ...picked };
      const g = a && a.g !== undefined ? a.g : (b ? b.g : undefined);
      if (g !== undefined) entry.g = g;
      else delete entry.g;
      const gr = Math.max(toInt(a && a.gr), toInt(b && b.gr));
      if (gr > 0) entry.gr = gr;
      else delete entry.gr;
      out[k] = entry;
    });
    return out;
  }

  // 月カレンダー。leading は 1 日の曜日（日曜 = 0）＝先頭の空きマス数。未来の月へは進めない（canNext）
  function monthModel(days, ym, todayKey) {
    const [y, m] = ym.split('-').map(Number);
    const leading = new Date(y, m - 1, 1).getDay();
    const count = new Date(y, m, 0).getDate();
    const cells = [];
    for (let d = 1; d <= count; d++) {
      const key = `${ym}-${String(d).padStart(2, '0')}`;
      const day = (days || {})[key];
      const answered = toInt(day && day.a);
      const goal = day && GOALS.includes(day.g) ? day.g : 0;
      cells.push({
        day: d,
        key,
        answered,
        goal,
        studied: answered > 0,
        reached: goal > 0 && answered >= goal,
        future: key > todayKey,
        today: key === todayKey,
      });
    }
    return { ym, label: `${y}年${m}月`, leading, cells, canNext: ym < todayKey.slice(0, 7) };
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function studiedDays(days) {
    return Object.keys(days || {}).filter(k => DATE_KEY.test(k) && toInt(days[k] && days[k].a) > 0).length;
  }

  return { GOALS, normalizeGoal, goalProgress, sanitizeActivity, mergeActivity, monthModel, shiftMonth, studiedDays };
});
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/activity.test.js`
Expected: PASS（10 テスト）

- [ ] **Step 5: 組み込み漏れのテストを追加し、組み込む**

`tests/test_port_wiring.py` の最後に追加:

```python


def test_activity_module_is_wired():
    assert '<script src="src/activity.js"></script>' in HTML
    assert "'src/activity.js'" in SW
    assert HTML.index('<script src="src/activity.js"></script>') < HTML.index('<script src="home.js"></script>')
```

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py -q`
Expected: FAIL

`index.html`: `<script src="src/filter-count.js"></script>` の直後に追加:

```html
<script src="src/activity.js"></script>
```

`sw.js`: `'src/filter-count.js',` の直後に追加:

```js
  'src/activity.js',
```

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py -q && node --test tests/unit/`
Expected: PASS

- [ ] **Step 6: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add src/activity.js tests/unit/activity.test.js tests/test_port_wiring.py index.html sw.js && git commit -m "feat: add activity module for goals, calendar and daily records" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: 目標の保存と、回答時の記録・達成通知

**Files:**
- Modify: `home.js`（`dailyActivity` の直後、`recordAnswerPaceAndActivity`、`buildHomePraiseMessages`）

**Interfaces:**
- Consumes: `StudyCore.normalizeGoal`（Task 3）、既存の `loadJSON` / `saveJSON` / `showToast` / `localDateStr` / `dailyActivity` / `saveDailyActivity`
- Produces（home.js のグローバル）:
  - `prefs: { dailyGoal: number }`（`let`）
  - `loadPrefs() -> { dailyGoal }`、`savePrefs()`
  - `setDailyGoal(goal: number)`（今日の `days[today].g` にも反映）
  - 日別記録の各日に `g`（その日の目標）を保存する

- [ ] **Step 1: `prefs` の読み書きを追加する**

`home.js` で `let dailyActivity = loadDailyActivity();` の行を探し、その直後（`function saveDailyActivity()` の前）に追加する。

置換前:
```js
let dailyActivity = loadDailyActivity();
```
置換後:
```js
let dailyActivity = loadDailyActivity();

// 表示設定（今日の目標）。壊れていても読めなくても、目標 10 問で動く
const PREFS_KEY = 'toeic_prefs_v1';
function loadPrefs() {
  const raw = loadJSON(PREFS_KEY, {});
  return { dailyGoal: StudyCore.normalizeGoal(raw.dailyGoal) };
}
let prefs = loadPrefs();
function savePrefs() {
  saveJSON(PREFS_KEY, prefs);
}
// 目標を変える。今日の分にも反映し、昨日以前の日には触れない
function setDailyGoal(goal) {
  prefs.dailyGoal = StudyCore.normalizeGoal(goal);
  savePrefs();
  const entry = dailyActivity.days[localDateStr()];
  if (entry) {
    entry.g = prefs.dailyGoal;
    saveDailyActivity();
  }
}
```

- [ ] **Step 2: 回答時に、その日の目標を記録して達成を知らせる**

`recordAnswerPaceAndActivity` 内。置換前:
```js
  entry.sec = Math.round(((entry.sec || 0) + sec) * 10) / 10;
  saveDailyActivity();

  renderPaceFeedback(kind, sec, isCorrect);
```
置換後:
```js
  entry.sec = Math.round(((entry.sec || 0) + sec) * 10) / 10;
  entry.g = prefs.dailyGoal;
  saveDailyActivity();

  // 今日の目標を初めて越えた回答の直後だけ知らせる（目標なしのときは何も出さない）
  if (prefs.dailyGoal > 0 && entry.a - 1 < prefs.dailyGoal && entry.a >= prefs.dailyGoal) {
    showToast('🎯 今日の目標を達成しました！');
  }

  renderPaceFeedback(kind, sec, isCorrect);
```

- [ ] **Step 3: メッセージ枠 1 番目を目標と重ならないようにする**

`buildHomePraiseMessages` 内。置換前:
```js
  if (streakInfo.studiedToday) {
    const todayRate = Math.round((streakInfo.todayCorrect / streakInfo.todayAnswered) * 100);
    list.push({
      icon: '🔥',
      html: `<b>${streakInfo.streak}日連続</b>で学習達成！今日はすでに <b>${streakInfo.todayAnswered}問</b> 解答（正答率 ${todayRate}%）、すごい集中力です！`,
    });
  } else if (streakInfo.streak >= 1) {
```
置換後:
```js
  if (streakInfo.studiedToday) {
    const todayRate = Math.round((streakInfo.todayCorrect / streakInfo.todayAnswered) * 100);
    // 目標を設定しているときは、今日の解答数は目標行に出るので、ここでは連続日数と正答率だけにする
    const todayText = prefs.dailyGoal > 0
      ? `今日の正答率は <b>${todayRate}%</b>、すごい集中力です！`
      : `今日はすでに <b>${streakInfo.todayAnswered}問</b> 解答（正答率 ${todayRate}%）、すごい集中力です！`;
    list.push({
      icon: '🔥',
      html: `<b>${streakInfo.streak}日連続</b>で学習達成！${todayText}`,
    });
    if (prefs.dailyGoal > 0 && streakInfo.todayAnswered >= prefs.dailyGoal) {
      list.push({
        icon: '🎯',
        html: `今日の目標 <b>${prefs.dailyGoal}問</b> を達成しました！この調子です！`,
      });
    }
  } else if (streakInfo.streak >= 1) {
```

- [ ] **Step 4: ブラウザで確認する**

プレビューサーバで `http://127.0.0.1:8766/#practice` を開き、`javascript_tool` で確認する。

1. 初期状態: `prefs` が `{dailyGoal: 10}`。`localStorage.setItem('toeic_prefs_v1','{broken')` → 再読み込み後も `prefs.dailyGoal === 10` でエラーなく起動（**Review Focus 1**）。`localStorage.setItem('toeic_prefs_v1', JSON.stringify({dailyGoal: 7}))` → 再読み込み後 10。
2. `setDailyGoal(5)` を実行 → `JSON.parse(localStorage.getItem('toeic_prefs_v1')).dailyGoal === 5`。
3. 演習画面で 1 問答える → `dailyActivity.days[localDateStr()].g === 5`、`.a` が 1 増える。
4. `setDailyGoal(5)` のまま 5 問目を答えた瞬間にだけ「🎯 今日の目標を達成しました！」のトーストが出て、6 問目では出ない。
5. `setDailyGoal(0)` にして答える → トーストが出ず、ホームのメッセージ枠に達成メッセージも出ない（**Review Focus 2**）。

- [ ] **Step 5: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add home.js && git commit -m "feat: store daily goal and notify when it is reached" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: ホームの目標行とカレンダーのダイアログ

**Files:**
- Modify: `home.js`（`renderHomePage`、クリック処理、ダイアログ、日付更新）
- Modify: `home.css`（末尾に追記）

**Interfaces:**
- Consumes: `StudyCore.goalProgress / monthModel / shiftMonth / studiedDays`（Task 3）、`prefs` / `setDailyGoal`（Task 4）、`getStreakSummary()`、`localDateStr()`、`dailyActivity`
- Produces: `openGoalDialog()`、`renderGoalDialog()`（home.js のグローバル）、ホームの `.home-goal-row`（`data-home-action="open-goal"`）

- [ ] **Step 1: ホームのテンプレートに目標行を入れる**

`renderHomePage` の、`container.innerHTML = \`` の直前（`const streakBadgeHtml = ...` の宣言の後ろ）に追加する。置換前:
```js
  container.innerHTML = `
    <div class="home-layout">
```
置換後:
```js
  const goalInfo = StudyCore.goalProgress(dailyActivity.days[localDateStr()], prefs.dailyGoal);
  lastRenderedDate = localDateStr();
  const goalRowHtml = `
    <button type="button" class="home-goal-row" data-home-action="open-goal" aria-haspopup="dialog">
      <span class="home-goal-label">🎯 今日の目標</span>
      <span class="home-goal-count">${goalInfo.hasGoal ? `${goalInfo.answered} / ${goalInfo.goal}問` : `${goalInfo.answered}問（目標なし）`}</span>
      <span class="home-goal-track" aria-hidden="true"><i style="width:${Math.round(goalInfo.ratio * 100)}%"></i></span>
    </button>`;

  container.innerHTML = `
    <div class="home-layout">
```

さらに、`.home-col-side` の先頭に目標行を差し込む。置換前:
```js
    <div class="home-col-side">
    <!-- 5. 他の参考書（スクロール可能ボックス） -->
```
置換後:
```js
    <div class="home-col-side">
    ${goalRowHtml}
    <!-- 5. 他の参考書（スクロール可能ボックス） -->
```

`lastRenderedDate` の宣言を、`let praiseRotationIndex = 0;` の直後に追加する。置換前:
```js
let praiseRotationIndex = 0;
```
置換後:
```js
let praiseRotationIndex = 0;
let lastRenderedDate = '';
let goalCalendarMonth = '';
let goalDialogTrigger = null;
```

- [ ] **Step 2: クリック処理に `open-goal` を追加する**

ホームのクリック委譲内。置換前:
```js
        if (action === 'rotate-praise') {
          praiseRotationIndex++;
          renderHomePage();
          return;
        }
```
置換後:
```js
        if (action === 'rotate-praise') {
          praiseRotationIndex++;
          renderHomePage();
          return;
        }
        if (action === 'open-goal') {
          openGoalDialog(actionBtn);
          return;
        }
```

- [ ] **Step 3: ダイアログの描画と操作を追加する**

`home.js` の `// 初期化＆イベント登録` コメントの直前に追加する。

```js
// ==================== 今日の目標・学習カレンダー（ダイアログ） ====================

function ensureGoalDialog() {
  let dlg = document.getElementById('goal-dialog');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'goal-dialog';
  dlg.className = 'goal-dialog';
  dlg.setAttribute('aria-labelledby', 'goal-dialog-title');
  dlg.addEventListener('click', e => {
    if (e.target === dlg) dlg.close(); // 背景タップで閉じる
    const act = e.target.closest('[data-goal-action]');
    if (!act) return;
    const name = act.dataset.goalAction;
    if (name === 'close') dlg.close();
    if (name === 'prev') { goalCalendarMonth = StudyCore.shiftMonth(goalCalendarMonth, -1); renderGoalDialog(); }
    if (name === 'next') { goalCalendarMonth = StudyCore.shiftMonth(goalCalendarMonth, 1); renderGoalDialog(); }
  });
  dlg.addEventListener('change', e => {
    if (e.target.id !== 'goal-select') return;
    setDailyGoal(Number(e.target.value));
    renderGoalDialog();
    if (currentAppPage === 'home') renderHomePage();
  });
  dlg.addEventListener('close', () => {
    if (goalDialogTrigger && goalDialogTrigger.isConnected) goalDialogTrigger.focus();
    goalDialogTrigger = null;
  });
  document.body.appendChild(dlg);
  return dlg;
}

function renderGoalDialog() {
  const dlg = ensureGoalDialog();
  const today = localDateStr();
  const model = StudyCore.monthModel(dailyActivity.days, goalCalendarMonth, today);
  const streak = getStreakSummary();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const cells = [
    ...Array.from({ length: model.leading }, () => '<span class="goal-cal-cell empty"></span>'),
    ...model.cells.map(c => {
      const mark = c.reached ? '✓' : c.studied ? '●' : '';
      const state = c.reached ? '目標達成' : c.studied ? '学習した' : '';
      const label = `${model.ym.slice(5).replace(/^0/, '')}月${c.day}日${c.studied ? ` ${c.answered}問` : ''}${state ? ` ${state}` : ''}`;
      return `<span class="goal-cal-cell${c.studied ? ' studied' : ''}${c.reached ? ' reached' : ''}${c.today ? ' today' : ''}${c.future ? ' future' : ''}" role="img" aria-label="${label}"><span class="goal-cal-day">${c.day}</span><span class="goal-cal-mark" aria-hidden="true">${mark}</span></span>`;
    }),
  ].join('');
  dlg.innerHTML = `
    <div class="goal-dialog-head">
      <h2 id="goal-dialog-title">学習カレンダー</h2>
      <button type="button" class="goal-dialog-close" data-goal-action="close" aria-label="閉じる">✕</button>
    </div>
    <p class="goal-dialog-overview">累計 <b>${StudyCore.studiedDays(dailyActivity.days)}日</b> 学習 ・ 連続 <b>${streak.streak}日</b></p>
    <div class="goal-dialog-field">
      <label for="goal-select">今日の目標</label>
      <select id="goal-select">
        ${StudyCore.GOALS.map(g => `<option value="${g}" ${g === prefs.dailyGoal ? 'selected' : ''}>${g === 0 ? '目標なし' : `${g}問`}</option>`).join('')}
      </select>
    </div>
    <div class="goal-cal-nav">
      <button type="button" data-goal-action="prev" aria-label="前の月">‹</button>
      <strong>${model.label}</strong>
      <button type="button" data-goal-action="next" aria-label="次の月" ${model.canNext ? '' : 'disabled'}>›</button>
    </div>
    <div class="goal-cal-grid" role="group" aria-label="${model.label}の学習日">
      ${weekdays.map(w => `<span class="goal-cal-week" aria-hidden="true">${w}</span>`).join('')}
      ${cells}
    </div>
    <p class="goal-dialog-legend"><span>● 学習した日</span><span>✓ 目標達成の日</span></p>
    <p class="goal-dialog-note">日別の記録は、この機能を入れた日から残ります。</p>`;
}

function openGoalDialog(trigger) {
  goalDialogTrigger = trigger || null;
  goalCalendarMonth = localDateStr().slice(0, 7);
  const dlg = ensureGoalDialog();
  renderGoalDialog();
  if (!dlg.open) dlg.showModal();
}

// アプリを開いたまま日付が変わったとき、ホームの「今日 N / M問」を作り直す
function refreshForNewDay() {
  if (lastRenderedDate && lastRenderedDate !== localDateStr() && currentAppPage === 'home') renderHomePage();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshForNewDay();
});
setInterval(refreshForNewDay, 60 * 1000);

```

- [ ] **Step 4: `home.css` の末尾に見た目を追加する**

```css

/* ==================== 今日の目標（ホームの 1 行） ==================== */
.home-goal-row {
  order: -1; /* 狭い画面では、メッセージ枠の次に出す */
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: "label count" "track track";
  align-items: center;
  gap: 6px 10px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
  color: var(--text-page);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.home-message-bar { order: -2; }
.home-goal-label { grid-area: label; font-weight: 700; }
.home-goal-count { grid-area: count; justify-self: end; font-weight: 800; color: var(--accent); }
.home-goal-track {
  grid-area: track;
  display: block;
  height: 6px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.22);
  overflow: hidden;
}
.home-goal-track i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
}
@media (min-width: 1024px) {
  #app.page-home .home-goal-row,
  #app.page-home .home-message-bar { order: 0; }
}

/* ==================== 目標・カレンダーのダイアログ ==================== */
.goal-dialog {
  width: min(92vw, 380px);
  max-height: 90vh;
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--bg-page);
  color: var(--text-page);
  font-family: inherit;
}
.goal-dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
.goal-dialog-head { display: flex; align-items: center; justify-content: space-between; }
.goal-dialog-head h2 { margin: 0; font-size: 16px; }
.goal-dialog-close, .goal-cal-nav button {
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--text-page);
  border-radius: 8px;
  min-width: 32px;
  min-height: 32px;
  font-size: 15px;
  cursor: pointer;
}
.goal-cal-nav button:disabled { opacity: 0.35; cursor: default; }
.goal-dialog-overview { margin: 8px 0; font-size: 12.5px; color: var(--text-muted); }
.goal-dialog-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0 12px; font-size: 13px; }
.goal-dialog-field select {
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--text-page);
  font-family: inherit;
  font-size: 13px;
}
.goal-cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 14px; }
.goal-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.goal-cal-week { text-align: center; font-size: 10.5px; color: var(--text-muted); }
.goal-cal-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
}
.goal-cal-cell.studied { background: var(--ui-surface); border-color: var(--ui-border); }
.goal-cal-cell.reached { border-color: var(--accent); }
.goal-cal-cell.today { outline: 2px solid var(--accent); outline-offset: -2px; }
.goal-cal-cell.future { opacity: 0.4; }
.goal-cal-mark { font-size: 10px; line-height: 1; color: var(--accent); min-height: 10px; }
.goal-dialog-legend { display: flex; gap: 14px; margin: 10px 0 4px; font-size: 11px; color: var(--text-muted); }
.goal-dialog-note { margin: 4px 0 0; font-size: 11px; color: var(--text-muted); }
@media (prefers-reduced-motion: reduce) {
  .goal-dialog, .home-goal-track i { transition: none; }
}
```

- [ ] **Step 5: ブラウザで確認する**

プレビューサーバで `http://127.0.0.1:8766/#home`。`javascript_tool` で `dailyActivity.days[localDateStr()] = {a:3,c:2,fast:0,sec:9,g:10}; saveDailyActivity(); renderHomePage();` のようにテスト用の記録を作って確認する（確認後は `localStorage.removeItem('toeic_daily_activity_v1')` で消す）。

1. 375px: メッセージ枠の直下に「🎯 今日の目標　3 / 10問」と細い進捗バー。その下に単語/文法の切り替え。ホームが縦に長くなりすぎない。
2. 1440px: 右カラムの先頭に目標行、その下に他の参考書。
3. 目標行をタップ → ダイアログが開き、今月のカレンダーに今日の「●」、累計日数と連続日数が出る。Esc・✕・背景タップで閉じ、フォーカスが目標行に戻る。
4. ダイアログで目標を「5問」に変更 → ホームの行が「3 / 5問」に、`dailyActivity.days[今日].g` が 5 に変わる。「目標なし」→「3問（目標なし）」。
5. 「‹」で前月へ、「›」で戻る。今月では「›」が押せない（**Review Focus 6**）。
6. 過去の日に `{a:12,g:10}` と `{a:3,g:10}`、`{a:4,g:0}` を入れる → 12問の日は「✓」、3問の日は「●」、目標なしの日は「●」で「✓」が付かない。スクリーンリーダー用の `aria-label` に状態が入っている。
7. 日付更新（**Review Focus 5**）: `lastRenderedDate = '2000-01-01'; refreshForNewDay();` → ホームが再描画され、今日の件数が反映される。
8. 目標達成済み（`a >= g`）のとき、メッセージ枠をタップして順に切り替えると「🎯 今日の目標 N問 を達成しました！」が出る。目標なしでは出ない。
9. ダークテーマ・ライトテーマ（設定画面で切り替え）でダイアログが読める。

- [ ] **Step 6: 回帰テストを実行してコミットする**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/ && python3 -m pytest tests/test_port_wiring.py tests/test_ui_consistency.py -q`
Expected: PASS

```bash
cd /Users/reiji/myapps/toeic_practice && git add home.js home.css && git commit -m "feat: daily goal row and study calendar dialog on home" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: バックアップ形式 6（日別記録と目標を含める）

**Files:**
- Modify: `index.html`（`BACKUP_FORMAT`、`BACKUP_MIGRATIONS`、`EXTRA_KEYS`、`buildBackup`、`parseBackup`、`replaceRecords`、`runRestore`、`loadUndo`、`runUndo`、`reloadRecordsFromStorage`、`backupConfirmHtml`）
- Modify: `home.js`（`reloadHomeExtras`）
- Modify: `tests/test_port_wiring.py`

**Interfaces:**
- Consumes: `StudyCore.sanitizeActivity / mergeActivity / normalizeGoal`（Task 3）、`loadPrefs()` / `loadDailyActivity()`（home.js）
- Produces: ファイル書き出し・コピー用のバックアップ JSON の `format: 6` と `data.activity: { days }`・`data.prefs: { dailyGoal }`（`buildBackup()`）。Drive 同期用は `buildBackup({ forDrive: true })` で従来どおり版 5・日別記録なし。`parseBackup` の戻り値に `extras: { activity?: { days }, prefs?: { dailyGoal } }`（古い形式では両方 `undefined`＝今のまま）。`EXTRA_KEYS` / `LOCAL_BACKUP_KEYS`（Drive 同期の `RECORD_KEYS` とは別）。

- [ ] **Step 1: 静的テストを書く（失敗させる）**

`tests/test_port_wiring.py` の最後に追加:

```python


def test_backup_format_6_is_wired_and_drive_is_untouched():
    assert "const BACKUP_FORMAT = 6;" in HTML
    assert "const EXTRA_KEYS = {" in HTML
    assert "const LOCAL_BACKUP_KEYS =" in HTML
    # Drive 同期の対象（RECORD_KEYS）には新しいキーを入れない
    start = HTML.index("const RECORD_KEYS = {")
    end = HTML.index("};", start)
    block = HTML[start:end]
    assert "toeic_prefs_v1" not in block
    assert "toeic_daily_activity_v1" not in block
    # Drive 同期が作るファイルは従来どおり（版 5・日別記録なし）
    assert HTML.count("buildBackup({ forDrive: true })") == 2
    assert "format: forDrive ? 5 : BACKUP_FORMAT" in HTML
```

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py -q`
Expected: FAIL

- [ ] **Step 2: 形式の版と変換を更新する**

(a) 版。置換前:
```js
// 版1: 単語の苦手・学習済みがモード共通 / 版2: モードごと / 版3: 通算成績（問題別正誤カウント）を含む / 版4: 文法の出題済みを含む / 版5: 苦手から外した記録（weakDeleted）と苦手の最終更新時刻（u）を含む
const BACKUP_FORMAT = 5;
```
置換後:
```js
// 版1: 単語の苦手・学習済みがモード共通 / 版2: モードごと / 版3: 通算成績（問題別正誤カウント）を含む / 版4: 文法の出題済みを含む / 版5: 苦手から外した記録（weakDeleted）と苦手の最終更新時刻（u）を含む / 版6: 日別の学習記録（activity）と表示設定（prefs）を含む
const BACKUP_FORMAT = 6;
```

(b) 5→6 の変換。`BACKUP_MIGRATIONS` の `4:` の項の直後（`};` の前）に追加。置換前:
```js
      data: isPlainObject(d) ? { ...d, weakDeleted: isPlainObject(d.weakDeleted) ? d.weakDeleted : {} } : d
    };
  },
};
```
置換後:
```js
      data: isPlainObject(d) ? { ...d, weakDeleted: isPlainObject(d.weakDeleted) ? d.weakDeleted : {} } : d
    };
  },
  // 日別の学習記録と表示設定は版5までに無かった。無いものは「今のまま」にしたいので、空で補わず版だけ上げる
  5: backup => ({ ...backup, format: 6 }),
};
```

- [ ] **Step 3: 追加キーの定義を足す**

`const RECORD_STORAGE_KEYS = Object.values(RECORD_KEYS);` の直後に追加する。

```js
// 日別の学習記録と表示設定。バックアップと復元の取り消しには含めるが、
// Google ドライブ同期の対象（RECORD_KEYS / RECORD_STORAGE_KEYS）には含めない。
// 値は home.js の DAILY_ACTIVITY_KEY / PREFS_KEY と同じ文字列
const EXTRA_KEYS = { activity: 'toeic_daily_activity_v1', prefs: 'toeic_prefs_v1' };
const EXTRA_STORAGE_KEYS = Object.values(EXTRA_KEYS);
const LOCAL_BACKUP_KEYS = [...RECORD_STORAGE_KEYS, ...EXTRA_STORAGE_KEYS];
```

- [ ] **Step 4: 書き出しに含める（Google ドライブ用の書き出しは今までどおり）**

Google ドライブ同期も `buildBackup()` でファイルを作り、`parseBackup()` で読む（`syncWithGoogleDrive` 内の 2 か所）。そのまま版 6 にすると、Drive のファイルにも日別記録が載り、まだ更新していない端末は「新しいバージョンのファイル」として読めなくなる。そこで Drive 用の呼び出しだけ `forDrive: true` を渡し、**版 5・日別記録と表示設定なし**で作る。

(a) `buildBackup` を置き換える。置換前:
```js
function buildBackup() {
  return {
    app: BACKUP_APP_ID,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    appData: { words: RAW_WORDS.length, grammar: RAW_GRAMMAR.length },
    data: {
      weakWords: state.weakByMode,
      weakGrammar: state.grammarWeakData,
      weakDeleted: state.weakDeleted,
      seenWords: seenSnapshot(),
      wordStats: state.wordStats,
      grammarStats: state.grammarStats,
      seenGrammar: [...state.grammarSeen],
      settings: settingsSnapshot(),
      session: sessionSnapshot(),
    },
  };
}
```
置換後:
```js
// forDrive: Google ドライブ同期用。同期の対象を増やさず、まだ更新していない端末が読めるよう、
// 従来どおり版 5・日別記録と表示設定なしで作る。ファイルへの書き出しとコピーは版 6（日別記録・表示設定つき）
function buildBackup({ forDrive = false } = {}) {
  const data = {
    weakWords: state.weakByMode,
    weakGrammar: state.grammarWeakData,
    weakDeleted: state.weakDeleted,
    seenWords: seenSnapshot(),
    wordStats: state.wordStats,
    grammarStats: state.grammarStats,
    seenGrammar: [...state.grammarSeen],
    settings: settingsSnapshot(),
    session: sessionSnapshot(),
  };
  if (!forDrive) {
    data.activity = loadJSON(EXTRA_KEYS.activity, {});
    data.prefs = loadJSON(EXTRA_KEYS.prefs, {});
  }
  return {
    app: BACKUP_APP_ID,
    format: forDrive ? 5 : BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    appData: { words: RAW_WORDS.length, grammar: RAW_GRAMMAR.length },
    data,
  };
}
```

(b) Drive 同期の 2 か所を `forDrive: true` にする。置換前:
```js
      const mergedBackupData = buildBackup();
```
置換後:
```js
      const mergedBackupData = buildBackup({ forDrive: true });
```
置換前:
```js
      const backupData = buildBackup();
      const backupJson = JSON.stringify(backupData, null, 2);
      const metadata = {
```
置換後:
```js
      const backupData = buildBackup({ forDrive: true });
      const backupJson = JSON.stringify(backupData, null, 2);
      const metadata = {
```

- [ ] **Step 5: 読み込みの検証を足す**

(a) `parseBackup` の形の確認。置換前:
```js
  if (d.session !== undefined && !isPlainObject(d.session)) return fail('出題の続きの記録の形が正しくありません。');
```
置換後:
```js
  if (d.session !== undefined && !isPlainObject(d.session)) return fail('出題の続きの記録の形が正しくありません。');
  if (d.activity !== undefined && !isPlainObject(d.activity)) return fail('日別の学習記録の形が正しくありません。');
  if (d.prefs !== undefined && !isPlainObject(d.prefs)) return fail('表示設定の形が正しくありません。');
```

(b) 検証と戻り値。置換前:
```js
  const weakDeleted = sanitizeWeakDeleted(d.weakDeleted);
  const knownWords = new Set(RAW_WORDS.map(w => w.w));
```
置換後:
```js
  const weakDeleted = sanitizeWeakDeleted(d.weakDeleted);
  const activity = d.activity === undefined ? null : StudyCore.sanitizeActivity(d.activity);
  const knownWords = new Set(RAW_WORDS.map(w => w.w));
```
置換前:
```js
    invalid: words.invalid + grammar.invalid + seen.invalid + wordStats.invalid + grammarStats.invalid + seenGrammar.invalid + weakDeleted.invalid + invalidBeforeMigration,
```
置換後:
```js
    // 日別の学習記録と表示設定。キーが無いファイル（版5以前など）は undefined のまま＝復元しても今のまま
    extras: {
      activity: activity ? { days: activity.days } : undefined,
      prefs: d.prefs === undefined ? undefined : { dailyGoal: StudyCore.normalizeGoal(d.prefs.dailyGoal) },
    },
    invalid: words.invalid + grammar.invalid + seen.invalid + wordStats.invalid + grammarStats.invalid + seenGrammar.invalid + weakDeleted.invalid + invalidBeforeMigration + (activity ? activity.invalid : 0),
```

- [ ] **Step 6: 復元・取り消しの対象にする**

(a) `replaceRecords` が書き換え前に取っておくキー。置換前:
```js
    before = Object.fromEntries(RECORD_STORAGE_KEYS.map(k => [k, localStorage.getItem(k)]));
    undoBefore = localStorage.getItem(BACKUP_UNDO_KEY);
```
置換後:
```js
    before = Object.fromEntries(LOCAL_BACKUP_KEYS.map(k => [k, localStorage.getItem(k)]));
    undoBefore = localStorage.getItem(BACKUP_UNDO_KEY);
```

(b) `runRestore`。置換前:
```js
  const rawByKey = {};
  Object.entries(RECORD_KEYS).forEach(([name, key]) => {
    if (targetRecords[name] !== undefined) rawByKey[key] = JSON.stringify(targetRecords[name]);
  });
  try {
    replaceRecords(rawByKey, true, isOverwrite ? '上書き復元' : '統合復元');
```
置換後:
```js
  const rawByKey = {};
  Object.entries(RECORD_KEYS).forEach(([name, key]) => {
    if (targetRecords[name] !== undefined) rawByKey[key] = JSON.stringify(targetRecords[name]);
  });
  // 日別の学習記録と表示設定。ファイルに無ければ今のまま。統合では同じ日の回答数の大きい方・目標は今の値を優先
  const extras = pending.extras || {};
  if (extras.activity !== undefined) {
    const curDays = StudyCore.sanitizeActivity(loadJSON(EXTRA_KEYS.activity, {})).days;
    const days = isOverwrite ? extras.activity.days : StudyCore.mergeActivity(curDays, extras.activity.days);
    rawByKey[EXTRA_KEYS.activity] = JSON.stringify({ days });
  }
  if (extras.prefs !== undefined) {
    rawByKey[EXTRA_KEYS.prefs] = JSON.stringify(isOverwrite ? extras.prefs : { ...extras.prefs, ...loadJSON(EXTRA_KEYS.prefs, {}) });
  }
  try {
    replaceRecords(rawByKey, true, isOverwrite ? '上書き復元' : '統合復元');
```

(c) `loadUndo` の検証。置換前:
```js
  return valid ? undo : null;
}
```
置換後（`loadUndo` 内の末尾の 1 か所だけ。`return valid ? undo : null;` はこの関数に 1 つだけ）:
```js
  // 日別の学習記録・表示設定は、以前の取り消し用の記録には無い（undefined なら取り消しでも触らない）
  const extrasValid = EXTRA_STORAGE_KEYS.every(k => undo.records[k] === undefined || undo.records[k] === null || typeof undo.records[k] === 'string');
  return valid && extrasValid ? undo : null;
}
```

(d) `runUndo`。置換前:
```js
    replaceRecords(Object.fromEntries(RECORD_STORAGE_KEYS.map(k => [k, undo.records[k] === undefined ? null : undo.records[k]])), false, '取り消し');
```
置換後:
```js
    // 本体の記録は、無ければ「保存が無かった」として外す。日別記録・表示設定は、取り消し用の記録に無ければ触らない
    const restoreKeys = [...RECORD_STORAGE_KEYS, ...EXTRA_STORAGE_KEYS.filter(k => undo.records[k] !== undefined)];
    replaceRecords(Object.fromEntries(restoreKeys.map(k => [k, undo.records[k] === undefined ? null : undo.records[k]])), false, '取り消し');
```

- [ ] **Step 7: 復元後にホームの表示用データを読み直す**

(a) `index.html` の `reloadRecordsFromStorage`。置換前:
```js
  if (isRestore) {
    restoreSettings();
    syncFilterUI();
    setApp(state.app);
  }
```
置換後:
```js
  if (isRestore) {
    restoreSettings();
    syncFilterUI();
    setApp(state.app);
    if (typeof reloadHomeExtras === 'function') reloadHomeExtras();
  }
```

(b) `home.js`。`function setDailyGoal(goal) {` の直前に追加:

```js
// バックアップの復元・取り消しのあとに、日別記録と表示設定を保存し直した内容で読み込み直す
function reloadHomeExtras() {
  dailyActivity = loadDailyActivity();
  prefs = loadPrefs();
  if (currentAppPage === 'home') renderHomePage();
}
```

- [ ] **Step 8: 確認画面に日別記録の行と統合の注意を出す**

`backupConfirmHtml` の比較表の追加行。置換前:
```js
      `<tr><td>設定</td><td>あり</td><td>${fromFile('settings')}</td></tr>
       <tr><td>出題の続き</td><td>あり</td><td>${fromFile('session')}</td></tr>`)}
```
置換後:
```js
      `<tr><td>設定</td><td>あり</td><td>${fromFile('settings')}</td></tr>
       <tr><td>出題の続き</td><td>あり</td><td>${fromFile('session')}</td></tr>
       <tr><td>日別の学習記録・目標</td><td>あり</td><td>${p.extras && p.extras.activity ? 'あり' : 'なし（今のまま）'}</td></tr>`)}
```
置換前:
```js
        : '💡 苦手・学習済み・問題ごとの正誤カウントを両方合わせ、より進んでいる記録を残します。'}
```
置換後:
```js
        : '💡 苦手・学習済み・問題ごとの正誤カウントを両方合わせ、より進んでいる記録を残します。日別の記録は、同じ日の回答数が多い方を残します（端末どうしの合算ではありません）。'}
```

- [ ] **Step 9: テストを実行する**

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py tests/test_ui_consistency.py -q && node --test tests/unit/`
Expected: PASS

- [ ] **Step 10: ブラウザで確認する**

プレビューサーバで `http://127.0.0.1:8766/#settings`。バックアップのシートは設定画面から開く。`javascript_tool` でテスト記録を作る: `localStorage.setItem('toeic_daily_activity_v1', JSON.stringify({days:{'2026-10-20':{a:7,c:5,fast:0,sec:30,g:10}}}));` → 再読み込み。

1. 「バックアップを書き出す」で出力した内容（`buildBackup()` を `javascript_tool` で呼んでよい）に `format: 6`、`data.activity.days['2026-10-20']`、`data.prefs` が入っている。
2. 日別記録を消した状態（`localStorage.removeItem('toeic_daily_activity_v1')`）で、上のバックアップを `parseBackup(JSON.stringify(b)).extras.activity.days` が復元できる形で返す。「上書き復元」実行後、`localStorage` の日別記録が戻る。
3. **Review Focus 3**: 形式 5 のファイル（`b.format = 5; delete b.data.activity; delete b.data.prefs;`）を `parseBackup` に渡すと `ok: true` かつ `extras.activity === undefined`。「上書き復元」しても、今の `toeic_daily_activity_v1` と `toeic_prefs_v1` は変わらない。
4. 統合復元: 今の記録に `'2026-10-20': {a:3,...,g:20}`、ファイルに `{a:7,...,g:5}` → 結果は `a:7`、`g:20`。
5. 「復元を取り消す」: 復元前の日別記録に戻る。**Review Focus 6**: 取り消し用スナップショットから日別記録のキーを消したもの（古いスナップショット）で取り消しても、現在の日別記録は消えない。
6. 復元後、ホームの目標行が復元した記録の値に更新される（再読み込み不要）。
7. Drive 同期の対象が増えていない: `RECORD_STORAGE_KEYS.includes('toeic_prefs_v1') === false`。さらに `buildBackup({ forDrive: true })` の結果が `format === 5` で、`data.activity` と `data.prefs` を持たないこと。`buildBackup()`（ファイル書き出し用）は `format === 6` で両方を持つこと。Drive が作る版 5 のファイルを `parseBackup` に渡すと `ok: true`・`extras.activity === undefined`（読み込みも今までどおり）。
8. 壊れたファイル（`data.activity` が配列）→ 「日別の学習記録の形が正しくありません。」で断られる。

- [ ] **Step 11: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add index.html home.js tests/test_port_wiring.py && git commit -m "feat: include daily activity and prefs in backup format 6" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6.5: 段階 3 のチェックポイント

- [ ] **Step 1:** 全体の回帰を実行する: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/ && python3 -m pytest tests -q`。結果を Task 0 のベースラインと比べ、新しい失敗がないことを確認する。
- [ ] **Step 2:** ユーザーに段階 3 の結果（スマホ・PC のホーム、ダイアログのスクリーンショット）を報告し、公開（push）してよいか確認する。承認されたら `git push origin main`。公開後、本番で既存のバックアップファイルを読み込んで形式 6 に移行できることを確認する。

---

## 段階 4：「復習」画面

### Task 7: `src/review.js`（演習 1 回分の復習の集計）

**Files:**
- Create: `src/review.js`
- Create: `tests/unit/review.test.js`
- Modify: `index.html`（script タグ）、`sw.js`、`tests/test_port_wiring.py`

**Interfaces:**
- Consumes: なし
- Produces（`StudyCore.*`）:
  - `createSessionReview() -> { reviewed: 0, graduated: 0 }`
  - `noteReviewAnswer(counter, { wasWeak: boolean, isWeakNow: boolean, isCorrect: boolean }) -> counter`（同じオブジェクトを更新して返す）
  - `reviewSummaryText(counter) -> string`（0 件なら空文字）

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/review.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const R = require('../../src/review.js');

test('苦手だった問題に正解すると復習として数える', () => {
  const c = R.createSessionReview();
  R.noteReviewAnswer(c, { wasWeak: true, isWeakNow: true, isCorrect: true });
  assert.deepStrictEqual(c, { reviewed: 1, graduated: 0 });
});

test('苦手から外れたら克服としても数える', () => {
  const c = R.createSessionReview();
  R.noteReviewAnswer(c, { wasWeak: true, isWeakNow: false, isCorrect: true });
  assert.deepStrictEqual(c, { reviewed: 1, graduated: 1 });
});

test('不正解・もともと苦手でない問題は数えない', () => {
  const c = R.createSessionReview();
  R.noteReviewAnswer(c, { wasWeak: true, isWeakNow: true, isCorrect: false });
  R.noteReviewAnswer(c, { wasWeak: false, isWeakNow: false, isCorrect: true });
  R.noteReviewAnswer(c, { wasWeak: false, isWeakNow: true, isCorrect: false });
  assert.deepStrictEqual(c, { reviewed: 0, graduated: 0 });
});

test('文言: 0 件は空、克服が無ければ復習のみ、あれば両方', () => {
  assert.strictEqual(R.reviewSummaryText({ reviewed: 0, graduated: 0 }), '');
  assert.strictEqual(R.reviewSummaryText(undefined), '');
  assert.strictEqual(R.reviewSummaryText({ reviewed: 3, graduated: 0 }), '苦手を 3 問 復習できました。');
  assert.strictEqual(R.reviewSummaryText({ reviewed: 3, graduated: 1 }), '苦手を 3 問 復習できました。そのうち 1 問は克服しました！');
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/review.test.js`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装を書く**

`src/review.js`:

```js
// 演習 1 回分の「苦手を復習できた数・克服できた数」の集計。DOM にも保存にも触れない。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  function createSessionReview() {
    return { reviewed: 0, graduated: 0 };
  }

  // 回答の前に苦手だった問題に正解したら「復習できた」。その回答で苦手から外れたら「克服」。
  // 不正解や、もともと苦手でない問題は数えない
  function noteReviewAnswer(counter, { wasWeak, isWeakNow, isCorrect }) {
    if (!wasWeak || !isCorrect) return counter;
    counter.reviewed++;
    if (!isWeakNow) counter.graduated++;
    return counter;
  }

  function reviewSummaryText(counter) {
    if (!counter || counter.reviewed <= 0) return '';
    const base = `苦手を ${counter.reviewed} 問 復習できました。`;
    return counter.graduated > 0 ? `${base}そのうち ${counter.graduated} 問は克服しました！` : base;
  }

  return { createSessionReview, noteReviewAnswer, reviewSummaryText };
});
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/review.test.js`
Expected: PASS（4 テスト）

- [ ] **Step 5: 組み込み漏れのテストを書き、組み込む**

`tests/test_port_wiring.py` の最後に追加:

```python


def test_review_module_is_wired():
    assert '<script src="src/review.js"></script>' in HTML
    assert "'src/review.js'" in SW
    assert HTML.index('<script src="src/review.js"></script>') < HTML.index('<script src="home.js"></script>')
```

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py -q`
Expected: FAIL

`index.html`: `<script src="src/activity.js"></script>` の直後に追加:

```html
<script src="src/review.js"></script>
```

`sw.js`: `'src/activity.js',` の直後に追加:

```js
  'src/review.js',
```

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py -q && node --test tests/unit/`
Expected: PASS

- [ ] **Step 6: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add src/review.js tests/unit/review.test.js tests/test_port_wiring.py index.html sw.js && git commit -m "feat: add session review counter module" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: 回答フックと完了画面の一文、克服数の日別記録

**Files:**
- Modify: `home.js`（`initHomeAndPages` の回答フック、`resetReview` フック、補助関数）
- Modify: `index.html`（2 つの完了画面）
- Modify: `home.css`（末尾に追記）

**Interfaces:**
- Consumes: `StudyCore.createSessionReview / noteReviewAnswer / reviewSummaryText`（Task 7）、既存の `wordWeak()`（現在のモードの苦手マップ）、`state.grammarWeakData`、`dailyActivity`、`saveDailyActivity`、`escapeHtml`
- Produces: `sessionReview`（`let`）、`noteSessionReview(wasWeak, isWeakNow, isCorrect)`、`sessionReviewHtml() -> string`（home.js のグローバル）。日別記録の `gr`（その日に克服した数）。Task 9 が `gr` を表示する。

- [ ] **Step 1: 集計用の変数と補助関数を足す**

`home.js` の `let goalDialogTrigger = null;`（Task 5）の直後に追加。

```js
// 今の演習（出題し直すたびにリセット）で、苦手を復習・克服できた数
let sessionReview = StudyCore.createSessionReview();
```

`function setDailyGoal(goal) {` の直前に追加:

```js
// 回答のあとに呼ぶ。苦手だった問題に正解したら集計し、苦手から外れたらその日の克服数 gr も増やす
function noteSessionReview(wasWeak, isWeakNow, isCorrect) {
  StudyCore.noteReviewAnswer(sessionReview, { wasWeak, isWeakNow, isCorrect });
  if (wasWeak && !isWeakNow && isCorrect) {
    const entry = dailyActivity.days[localDateStr()];
    if (entry) {
      entry.gr = (entry.gr || 0) + 1;
      saveDailyActivity();
    }
  }
}

// 演習の完了画面に足す 1 行（復習できた問題が無ければ何も出さない）
function sessionReviewHtml() {
  const text = StudyCore.reviewSummaryText(sessionReview);
  return text ? `<div class="review-result">${escapeHtml(text)}</div>` : '';
}
```

- [ ] **Step 2: 回答フックで苦手の状態を前後で比べる**

`initHomeAndPages` 内の既存フックを置き換える。置換前:
```js
    window.recordWeak = function (word, isCorrect) {
      const res = origRecordWeak.apply(this, arguments);
      recordAnswerPaceAndActivity('vocab', isCorrect);
      return res;
    };
```
置換後:
```js
    window.recordWeak = function (word, isCorrect) {
      const wasWeak = Boolean(wordWeak()[word.w]);
      const res = origRecordWeak.apply(this, arguments);
      recordAnswerPaceAndActivity('vocab', isCorrect);
      noteSessionReview(wasWeak, Boolean(wordWeak()[word.w]), isCorrect);
      return res;
    };
```
置換前:
```js
    window.recordWeakGrammar = function (ex, isCorrect) {
      const res = origRecordWeakGrammar.apply(this, arguments);
      recordAnswerPaceAndActivity('grammar', isCorrect);
      return res;
    };
```
置換後:
```js
    window.recordWeakGrammar = function (ex, isCorrect) {
      const wasWeak = Boolean(state.grammarWeakData[ex.id]);
      const res = origRecordWeakGrammar.apply(this, arguments);
      recordAnswerPaceAndActivity('grammar', isCorrect);
      noteSessionReview(wasWeak, Boolean(state.grammarWeakData[ex.id]), isCorrect);
      return res;
    };
```

- [ ] **Step 3: 出題し直したら集計をリセットする**

`const origRecordWeakGrammar = window.recordWeakGrammar;` の定義ブロックの直後（`updateFooterPaceDisplay();` の前）に追加:

```js
  // 出題プールを作り直す（絞り込み・モード変更・苦手ドリルなど）たびに、今の演習の集計をやり直す
  const origResetReview = window.resetReview;
  if (typeof origResetReview === 'function') {
    window.resetReview = function () {
      sessionReview = StudyCore.createSessionReview();
      return origResetReview.apply(this, arguments);
    };
  }
```

- [ ] **Step 4: 完了画面に 1 行を足す**

`index.html` の 2 か所。

文法。置換前:
```js
正答: ${state.grammarScore} / ${state.grammarAnsweredCount}</div></div>`;
```
置換後:
```js
正答: ${state.grammarScore} / ${state.grammarAnsweredCount}</div>${typeof sessionReviewHtml === 'function' ? sessionReviewHtml() : ''}</div>`;
```
単語。置換前:
```js
正答: ${state.score} / ${state.answeredCount}</div></div>`;
```
置換後:
```js
正答: ${state.score} / ${state.answeredCount}</div>${typeof sessionReviewHtml === 'function' ? sessionReviewHtml() : ''}</div>`;
```

- [ ] **Step 5: `home.css` の末尾に見た目を追加する**

```css

/* 完了画面：苦手を復習できた数 */
.review-result {
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
  color: var(--text-card, var(--text-page));
  font-size: 13px;
  line-height: 1.5;
}
```

- [ ] **Step 6: ブラウザで確認する**

プレビューサーバで確認する。苦手を作るため、`javascript_tool` で文法の苦手を 3 件仕込む（問題番号は実在する 1, 2, 3）:

```js
['1','2','3'].forEach(id => { state.grammarWeakData[id] = { streak: 0, added: Date.now(), due: 0, u: Date.now() }; });
saveGrammarWeakData();
```

1. ホームの「苦手を解く」（文法）で苦手ドリルを開始 → 3 問を **正解** する（正解は `state.grammarPool[state.currentGrammarIndex].answer` などで確認するか、画面で選ぶ）。完了画面に「苦手を 3 問 復習できました。」が出る（克服はまだ 0 なので「そのうち…」は出ない）。
2. 苦手でない問題だけを解いたドリルの完了画面には、この 1 行が出ない。
3. 不正解にした苦手は数えない。
4. 苦手を克服する場合の確認: `state.grammarWeakData['1'] = { streak: 3, added: Date.now(), due: 0, u: Date.now() }` にして正解 → 完了画面に「そのうち 1 問は克服しました！」、`dailyActivity.days[今日].gr === 1`。
5. 絞り込みを変えて出題し直すと、完了画面の集計が 0 に戻る。
6. 単語（英→日）でも同様に動く。カードモードの「覚えた」でも数える。

- [ ] **Step 7: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add home.js home.css index.html && git commit -m "feat: show reviewed and mastered weak items on the finish screen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: 4 つ目の画面「復習」

**Files:**
- Modify: `index.html`（ナビのタブ、復習ページの器）
- Modify: `home.js`（ページ一覧の定数、`switchAppPage`、`renderReviewPage`、クリック処理、要復習メッセージのリンク）
- Modify: `home.css`（末尾に追記）
- Modify: `tests/test_port_wiring.py`

**Interfaces:**
- Consumes: `getBookProgress(kind, 'all')`（`{ weak, due, unit, ... }`）、`startWeakDrillFromHome(kind)`、`openWeakListFromHome(kind)`、`MODE_LABELS`、`dailyActivity`（`gr`）、`switchAppPage`
- Produces: `APP_PAGES = ['home', 'practice', 'review', 'settings']`、`renderReviewPage()`、ホームのメッセージ「要復習…」内の `data-home-action="open-review"` ボタン

- [ ] **Step 1: 静的テストを書く（失敗させる）**

`tests/test_port_wiring.py` の最後に追加:

```python


def test_review_page_is_wired():
    assert 'data-page="review"' in HTML
    assert 'id="review-page"' in HTML
    home = (ROOT / "home.js").read_text(encoding="utf-8")
    assert "const APP_PAGES = ['home', 'practice', 'review', 'settings'];" in home
    assert "function renderReviewPage()" in home
    # ナビは「ホーム / 演習 / 復習 / 設定」の順
    nav = HTML[HTML.index('class="top-page-tabs"'):]
    assert nav.index('data-page="practice"') < nav.index('data-page="review"') < nav.index('data-page="settings"')
```

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py -q`
Expected: FAIL

- [ ] **Step 2: ナビのタブとページの器を足す**

`index.html`。タブ。置換前:
```html
      <button type="button" class="top-page-tab" data-page="settings" role="tab" aria-selected="false">設定</button>
```
置換後:
```html
      <button type="button" class="top-page-tab" data-page="review" role="tab" aria-selected="false">復習</button>
      <button type="button" class="top-page-tab" data-page="settings" role="tab" aria-selected="false">設定</button>
```
ページの器。置換前:
```html
  <div id="settings-page" class="app-page-view">
```
置換後:
```html
  <!-- 復習画面 -->
  <div id="review-page" class="app-page-view"></div>

  <div id="settings-page" class="app-page-view">
```

- [ ] **Step 3: ページ一覧を定数にまとめ、復習を扱えるようにする**

`home.js`。定数の追加。置換前:
```js
let currentAppPage = 'home'; // 'home' | 'practice' | 'settings'
```
置換後:
```js
const APP_PAGES = ['home', 'practice', 'review', 'settings'];
let currentAppPage = 'home'; // APP_PAGES のどれか
```
`switchAppPage` の冒頭。置換前:
```js
  if (!['home', 'practice', 'settings'].includes(page)) page = 'home';
```
置換後:
```js
  if (!APP_PAGES.includes(page)) page = 'home';
```
`switchAppPage` の描画。置換前:
```js
  } else if (page === 'settings') {
    renderSettingsPage();
  } else if (page === 'practice') {
```
置換後:
```js
  } else if (page === 'review') {
    renderReviewPage();
  } else if (page === 'settings') {
    renderSettingsPage();
  } else if (page === 'practice') {
```
初期ページの決定。置換前:
```js
  const initialPage = ['home', 'practice', 'settings'].includes(hash)
```
置換後:
```js
  const initialPage = APP_PAGES.includes(hash)
```
`hashchange`。置換前:
```js
    if (['home', 'practice', 'settings'].includes(h) && h !== currentAppPage) {
```
置換後:
```js
    if (APP_PAGES.includes(h) && h !== currentAppPage) {
```

- [ ] **Step 4: `renderReviewPage` を追加する**

`function renderSettingsPage() {` の直前に追加:

```js
// 復習画面：今日の復習の件数、苦手ドリルと一覧への入口、今日克服できた数
function renderReviewPage() {
  const container = document.getElementById('review-page');
  if (!container) return;
  const today = dailyActivity.days[localDateStr()] || {};
  const mastered = today.gr || 0;
  const block = (kind, title, sub) => {
    const p = getBookProgress(kind, 'all');
    return `
      <section class="review-block" aria-label="${title}の復習">
        <div class="review-block-head">
          <h3>${title}</h3>
          <span class="review-block-sub">${sub}</span>
        </div>
        <div class="review-block-stats">
          <div><b>${p.due}</b><small>今日の要復習（${p.unit}）</small></div>
          <div><b>${p.weak}</b><small>苦手に登録（${p.unit}）</small></div>
        </div>
        <div class="review-block-actions">
          <button type="button" class="home-weak-btn solve" data-home-action="solve-weak" data-kind="${kind}" ${p.weak === 0 ? 'disabled' : ''}>苦手を解く</button>
          <button type="button" class="home-weak-btn" data-home-action="view-weak-list" data-kind="${kind}">一覧を見る</button>
        </div>
      </section>`;
  };
  container.innerHTML = `
    <div class="review-page-inner">
      <h2 class="review-page-title">復習</h2>
      <p class="review-today">${mastered > 0
        ? `今日は苦手を <b>${mastered} 問</b> 克服しました！`
        : '苦手を正解して、間隔をあけた復習を最後まで終えると「克服」になります。'}</p>
      ${block('vocab', '単語', `モード：${MODE_LABELS[state.mode || 'e2j']}`)}
      ${block('grammar', '文法', '全 4 冊')}
    </div>`;
}
```

- [ ] **Step 5: 復習画面のボタンを動かす**

`initHomeAndPages` の、ホーム画面内のクリック委譲（`const homeEl = document.getElementById('home-page');` のブロック）の直後に追加:

```js
  // 復習画面のボタン（苦手ドリル・苦手一覧）
  const reviewEl = document.getElementById('review-page');
  if (reviewEl) {
    reviewEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-home-action]');
      if (!btn || btn.disabled) return;
      const kind = btn.dataset.kind || homeCategory;
      if (btn.dataset.homeAction === 'solve-weak') startWeakDrillFromHome(kind);
      else if (btn.dataset.homeAction === 'view-weak-list') openWeakListFromHome(kind);
    });
  }
```
ここまでで、ホームのクリック委譲の中に `open-review` を足す。置換前（Task 5 で足した `open-goal` の直後）:
```js
        if (action === 'open-goal') {
          openGoalDialog(actionBtn);
          return;
        }
```
置換後:
```js
        if (action === 'open-goal') {
          openGoalDialog(actionBtn);
          return;
        }
        if (action === 'open-review') {
          switchAppPage('review');
          return;
        }
```

- [ ] **Step 6: ホームの「要復習」メッセージから復習画面へ行けるようにする**

`buildHomePraiseMessages` の 5 番目。置換前:
```js
      html: `現在、${kind === 'grammar' ? '文法' : '単語'}の<b>要復習問題が ${allProg.due}${allProg.unit}</b>あります。復習で記憶をロックしましょう！`,
```
置換後:
```js
      html: `現在、${kind === 'grammar' ? '文法' : '単語'}の<b>要復習問題が ${allProg.due}${allProg.unit}</b>あります。<button type="button" class="home-inline-link" data-home-action="open-review">復習へ</button>`,
```

- [ ] **Step 7: `home.css` の末尾に見た目を追加する**

```css

/* ==================== 復習画面 ==================== */
#review-page {
  padding: 10px 20px max(14px, env(safe-area-inset-bottom, 14px));
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.review-page-inner { display: flex; flex-direction: column; gap: 12px; }
.review-page-title { margin: 4px 0 0; font-size: 18px; font-weight: 800; color: var(--text-page); }
.review-today { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.review-block {
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.review-block-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.review-block-head h3 { margin: 0; font-size: 15px; color: var(--text-page); }
.review-block-sub { font-size: 11px; color: var(--text-muted); }
.review-block-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.review-block-stats div { display: flex; flex-direction: column; gap: 2px; }
.review-block-stats b { font-size: 22px; color: var(--accent); }
.review-block-stats small { font-size: 11px; color: var(--text-muted); }
.review-block-actions { display: flex; gap: 8px; }
.home-inline-link {
  margin-left: 6px;
  padding: 2px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}
@media (min-width: 1024px) {
  #app.page-review { max-width: 720px; }
}
```

- [ ] **Step 8: ナビが 4 つに増えても狭い画面で収まることを確認し、必要なら調整する**

375px 幅でナビ（ブランド＋4 タブ）が 1 行に収まるかを確認する。収まらなければ、`home.css` の `.top-page-tab` の `padding: 5px 12px;` を狭い幅だけ小さくする:

```css
@media (max-width: 400px) {
  .top-page-tab { padding: 5px 8px; font-size: 11.5px; }
  .top-page-brand span:last-child { display: none; }
}
```
（収まっているなら追加しない。）

また、`#app.page-review` の幅クラスを付けるため、`switchAppPage` の `page-home` の行を次のようにする。置換前:
```js
  if (appEl) appEl.classList.toggle('page-home', page === 'home');
```
置換後:
```js
  if (appEl) {
    appEl.classList.toggle('page-home', page === 'home');
    appEl.classList.toggle('page-review', page === 'review');
  }
```

- [ ] **Step 9: テストとブラウザ確認**

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests/test_port_wiring.py tests/test_ui_consistency.py -q && node --test tests/unit/`
Expected: PASS

プレビューサーバで確認する（`#review` を直接開いてもよい）。

1. ナビが「ホーム / 演習 / 復習 / 設定」の順。375px で 1 行に収まる。
2. 「復習」を開くと、単語・文法それぞれに「今日の要復習」「苦手に登録」の件数が出る。苦手が 0 件なら「苦手を解く」が無効。
3. 「苦手を解く」→ 演習画面に移り、苦手のみのドリルが始まる。「一覧を見る」→ 苦手リストのシートが開く。
4. Task 8 の手順で苦手を 1 問克服した後、復習画面に「今日は苦手を 1 問 克服しました！」が出る。
5. ホームで要復習が 1 件以上ある状態にして、メッセージ枠を切り替えて「復習へ」を押す → 復習画面に移る。メッセージの切り替え（タップで次へ）は従来どおり動く。
6. `#review` の URL で直接開ける・再読み込みしても復習画面のまま。戻る操作で他の画面と行き来できる。
7. 既存の「ホーム」の「苦手を解く」「一覧を見る」は従来どおり動く。
8. 1440px: 復習画面は幅 720px 程度で中央に出て、演習・設定は従来の幅のまま。

- [ ] **Step 10: コミットする**

```bash
cd /Users/reiji/myapps/toeic_practice && git add index.html home.js home.css tests/test_port_wiring.py && git commit -m "feat: add review page as the fourth screen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: 最終確認と公開前チェック

**Files:**
- なし（確認のみ）。必要なら修正してコミット。

- [ ] **Step 1: 全テスト**

Run: `cd /Users/reiji/myapps/toeic_practice && node --test tests/unit/ && python3 -m pytest tests -q 2>&1 | tail -15`
Expected: ユニットテストは全 PASS。pytest は Task 0 のベースラインと同じ（新しい失敗なし）。

- [ ] **Step 2: Google Drive 同期に影響がないことの確認**

Run: `cd /Users/reiji/myapps/toeic_practice && git diff stable-before-port-20261029 -- index.html | grep -n "RECORD_KEYS\|RECORD_STORAGE_KEYS\|syncWithGoogleDrive\|mergeBackupRecords\|applyMergedRecordsToLocal" `
Expected: `RECORD_KEYS` の定義（`const RECORD_KEYS = {`）に差分がない。`mergeBackupRecords` / `applyMergedRecordsToLocal` に差分がない。`syncWithGoogleDrive` の差分は `buildBackup()` → `buildBackup({ forDrive: true })` の 2 行だけ。`replaceRecords` の差分は `before` のキー一覧だけ。差分があれば内容を読み、Drive 同期の挙動が変わっていないことを確認する。

- [ ] **Step 3: 通し確認（スマホ 375px と PC 1440px）**

1. ホーム → 目標行 → ダイアログ → 目標変更。
2. 演習 → 絞り込みシートの「対象 N 問」→ 数問解く → 目標達成トースト。
3. 完了画面（苦手の復習の一文）。
4. 復習画面 → 苦手ドリル。
5. 設定 → バックアップ書き出し → 復元（統合）→ 取り消し。
6. すべてでコンソールエラーなし（`read_console_messages` の onlyErrors）。
7. 4 つのテーマ以上（ink / light / duolingo など）でホームとダイアログと復習画面が読める。

- [ ] **Step 4: オフライン確認**

ブラウザで一度読み込んだ後、サーバを止めて再読み込み → `src/*.js` がキャッシュから読まれ、ホームが表示される（`sw.js` の `ASSETS` に 3 ファイルが入っている）。

- [ ] **Step 5: ユーザーに報告する**

段階 4 の結果と、全体の確認結果（成功した項目・確認できなかった項目）を報告し、公開（push）してよいか確認する。承認されたら `git push origin main`。公開後に本番 URL（`https://ichirei13.github.io/toeic-vocabulary-app/`）で、復習画面・目標・バックアップの書き出しを 1 回ずつ確認する。

- [ ] **Step 6: 後始末**

`pkill -f "http.server 8766"`（プレビューサーバを止める）。ブラウザペインの幅を `resize_window` の `desktop` に戻す。

---

## 自己レビュー（プラン作成時に実施）

**仕様の網羅:**
- 段階 1（対象件数）→ Task 1。単位は語/問（仕様は「N 問」だが、単語は「語」にする。仕様に反映する）。
- 段階 2（ホームの PC レイアウト）→ Task 2。演習・設定の幅は変えない（Global Constraints）。
- 段階 3（目標・カレンダー・メッセージ枠との共存・データ・バックアップ）→ Task 3〜6。Drive 同期に含めない → Task 6 と Task 10 Step 2。
- 段階 4（復習画面、復習の成果、要復習メッセージのリンク）→ Task 7〜9。仕様の「各回答に wasWeak / graduated を記録」は、**演習 1 回分のカウンタ（メモリ上）と日別の克服数 `gr`** で実装する（完了画面の表示に必要な情報はこれで足り、回答ごとのログを新設せずに済む）。仕様を実装に合わせて更新する。
- 記録の安全（復元用タグ、既存キー不変、壊れた新キーでも起動）→ Task 0、Task 4。
- 段階 5 は今回やらない。

**プレースホルダー走査:** TBD / TODO / 「適切に処理」などの記述なし。

**型の一貫性:** `StudyCore.normalizeGoal / goalProgress / sanitizeActivity / mergeActivity / monthModel / shiftMonth / studiedDays / filterCountLabel / createSessionReview / noteReviewAnswer / reviewSummaryText`、`prefs` / `loadPrefs` / `savePrefs` / `setDailyGoal` / `reloadHomeExtras` / `noteSessionReview` / `sessionReviewHtml` / `renderReviewPage` / `APP_PAGES` / `EXTRA_KEYS` / `LOCAL_BACKUP_KEYS` / `EXTRA_STORAGE_KEYS` の名前をタスク間で確認済み。日別記録のフィールド `a, c, fast, sec, g, gr` は Task 3 / 4 / 6 / 8 / 9 で一致。

**Review Focus:** 6 項目のうち 1（Task 4 Step 4）、2（Task 3・4）、3（Task 6 Step 10）、4（Task 1 Step 10）、5（Task 5 Step 5）、6（Task 3・6）に対応する確認がある。
