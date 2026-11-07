# iOS テーマの横画面版 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-subagent-driven-development (recommended) or sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS テーマで画面の幅が 1000px 以上のとき、左のサイドバー・中央寄せの本文・右の絞り込みパネルの 3 列配置にする。

**Architecture:** 新しい `css/theme-ios-wide.css`（すべて `@media (min-width: 1000px)` と `[data-theme="ios"]` の中）が、`#app` を 3 列のグリッドにして、既存の `.top-page-nav` を左のサイドバーに、既存の `#filter-drawer`（`.top-sheet`）を右のパネルに変える。パネルの開閉は、`#app` の `ios-filter-panel-open` クラスと `localStorage` で持ち、新しい `js/ios-wide.js` が受け持つ。他のテーマと幅 1000px 未満には、何も足さない。

**Tech Stack:** 素の CSS / JS（ビルドなし）、検証は Playwright（Chromium）の Node テスト。

**Spec:** `docs/superpowers/specs/2026-11-04-ios-wide-layout-design.md`

## Global Constraints

- 適用条件は「iOS テーマ（`data-theme="ios"`）で、幅 1000px 以上」だけ。他のテーマと 1000px 未満の見た目は、1 ピクセルも変えない。
- 幅の境目は `min-width: 1000px`（CSS・JS で同じ値）。サイドバー 240px、絞り込みパネル 320px。
- 本文の最大幅は、演習 720px、復習 720px、設定 640px、ホーム 1080px。
- 絞り込みパネルは最初から開く。開閉の記憶は `localStorage` のキー `toeic_ios_filter_panel`（値 `closed` のときだけ閉じる。キーがなければ開く）。
- 新しいファイルは、`index.html`、`sw.js` の ASSETS、`upload.py` の FILES の 3 か所に登録する（`tests/test_file_lists.py` が一致を確かめる）。
- 日本語のコメントで、既存のコードに合わせる。`python` ではなく `python3`。
- コミットの末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` を付ける。
- 公開（`upload.py`）は、このプランの範囲に含めない。ユーザーの指示があったときだけ行う。

## Review Focus

- 幅がちょうど 1000px と 999px のとき、サイドバーとタブバーが混ざらず、どちらか一方になる（Task 2 のテスト）。
- 画面の回転やウィンドウの幅の変更で、再読み込みなしに配置が切り替わる（Task 2 のテスト）。
- タブバーを格納した状態が保存されたまま横画面で開いても、サイドバーが隠れない（Task 2 のテスト）。
- `localStorage` が使えない（読み出しが例外を投げる）ときも、パネルが開いた状態で始まり、エラーが出ない（Task 3 のテスト）。
- パネルを閉じたあと、別のページに移って戻っても、閉じたままである（Task 3 のテスト）。

## File Structure

| ファイル | 役割 |
|---|---|
| `css/theme-ios-wide.css`（新規） | 横画面の配置だけ。3 列のグリッド、サイドバー、パネル、本文の幅。 |
| `js/ios-wide.js`（新規） | パネルの開閉と記憶。60 行程度。 |
| `js/ios-chrome.js`（変更） | 横画面では、タブバーのスワイプ格納を無効にする（1 行）。 |
| `index.html` / `sw.js` / `upload.py`（変更） | 新しいファイルの登録。 |
| `tests/ios-wide.test.js`（新規） | 横画面の動作テスト（Playwright）。 |
| `docs/superpowers/specs/2026-11-04-ios-wide-layout-design.md`（変更） | Task 3 で、パネルの開閉の仕様を実装に合わせて直す。 |

---

### Task 1: 土台（空のファイル、登録、テストの枠組み）

**Files:**
- Create: `css/theme-ios-wide.css`, `js/ios-wide.js`, `tests/ios-wide.test.js`
- Modify: `index.html`, `sw.js`, `upload.py`

**Interfaces:**
- Produces: テストの枠組み `withPage(storage, fn, viewport)`、`test(name, fn)`（Task 2・3 のテストが同じファイルに足される）。

- [ ] **Step 1: テストの枠組みと、最初のテストを書く**

`tests/ios-wide.test.js` を新規作成する。

```js
// iOS テーマの横画面版（幅 1000px 以上）の動作テスト。
// 実行: NODE_PATH=$(npm root -g) node tests/ios-wide.test.js
// リポジトリ直下を自前の静的サーバで配信し、Playwright(Chromium)で index.html を操作する。
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

let browser;
let baseUrl;
const pageErrors = [];

// storage の中身を localStorage に入れた状態で開く。再読み込みでは入れ直さない（記憶のテストのため）
async function withPage(storage, fn, viewport = { width: 1280, height: 800 }, { block = [] } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(items => {
    try {
      if (sessionStorage.getItem('__test_init')) return;
      sessionStorage.setItem('__test_init', '1');
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) { /* 使えなければ何もしない */ }
  }, storage);
  // Google Fonts は待たない（読み込みの待ちでテストが揺れるのを防ぐ）
  await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  for (const pattern of block) await context.route(pattern, route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  // 何も付けずに開くとホーム画面から始まるので、演習画面を指定して開く（再読み込みでも同じ画面に戻る）
  await page.goto(baseUrl + '/index.html#practice');
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

const IOS = { toeic_app_theme: 'ios' };
const rect = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}, sel);
const style = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('wide_stylesheet_and_script_are_loaded', () => withPage(IOS, async page => {
  const r = await page.evaluate(() => ({
    css: [...document.styleSheets].some(s => (s.href || '').includes('css/theme-ios-wide.css')),
    js: [...document.scripts].some(s => (s.src || '').includes('js/ios-wide.js')),
  }));
  assert.strictEqual(r.css, true, 'css/theme-ios-wide.css が index.html から読み込まれていない');
  assert.strictEqual(r.js, true, 'js/ios-wide.js が index.html から読み込まれていない');
}));

// === TESTS-INSERT-POINT（Task 2・3 のテストは、この行の上に足す） ===

(async () => {
  const server = await startServer();
  baseUrl = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
  if (pageErrors.length) {
    failed++;
    console.log(`FAIL page_errors\n     ${pageErrors.slice(0, 5).join('\n     ')}`);
  }
  await browser.close();
  server.close();
  console.log(`${tests.length - (failed - (pageErrors.length ? 1 : 0))}/${tests.length} tests passed${pageErrors.length ? ', page errors present' : ''}`);
  process.exit(failed ? 1 : 0);
})();
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/ios-wide.test.js`
Expected: `FAIL wide_stylesheet_and_script_are_loaded`（まだ読み込んでいないため）。

- [ ] **Step 3: 空のファイルを作る**

`css/theme-ios-wide.css`:

```css
/* === iOS テーマ × 横画面（幅 1000px 以上）===
   左のサイドバー | 中央寄せの本文 | 右の絞り込みパネル の 3 列にする（Mac / iPad の横向き向け）。
   すべて @media (min-width: 1000px) と [data-theme="ios"] の中に閉じてあり、
   他のテーマと、幅が 1000px に満たない画面には影響しない。css/theme-ios.css の「後」に読み込むこと。 */

@media (min-width: 1000px) {
}
```

`js/ios-wide.js`:

```js
// iOS テーマ × 横画面（幅 1000px 以上）専用: 右側の絞り込みパネルの開閉を、端末に覚えさせる。
// 見た目の配置は css/theme-ios-wide.css 側。他のテーマと狭い画面では何もしない。
(function () {
})();
```

- [ ] **Step 4: 3 か所に登録する**

`index.html`: 21 行目 `<link rel="stylesheet" href="css/theme-ios.css">` の次の行に
`<link rel="stylesheet" href="css/theme-ios-wide.css">` を足す。
`<script src="js/ios-chrome.js"></script>` の次の行に `<script src="js/ios-wide.js"></script>` を足す。
スクリプトの読み込み順コメントの `8. js/ios-chrome.js ...` の行の次に、
`    9. js/ios-wide.js     iOS テーマの横画面（幅 1000px 以上）専用: 右の絞り込みパネルの開閉の記憶。他のテーマでは何もしない` を足す。

`sw.js`: ASSETS の `'css/theme-ios.css',` の次に `'css/theme-ios-wide.css',`、`'js/ios-chrome.js',` の次に `'js/ios-wide.js',` を足し、`const CACHE = 'toeic-drill-v6';` を `'toeic-drill-v7'` にする。

`upload.py`: FILES の `"css/theme-ios.css",` の次に `"css/theme-ios-wide.css",`、`"js/ios-chrome.js",` の次に `"js/ios-wide.js",` を足す。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/ios-wide.test.js && python3 -m pytest tests/test_file_lists.py -q`
Expected: `1/1 tests passed`、`passed`。

- [ ] **Step 6: コミット**

```bash
cd /Users/reiji/myapps/toeic_practice
git add css/theme-ios-wide.css js/ios-wide.js tests/ios-wide.test.js index.html sw.js upload.py
git commit -m "feat: scaffold the iOS landscape layout (empty css/js, test harness, file lists)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 3 列のグリッド、サイドバー、本文の幅

**Files:**
- Modify: `css/theme-ios-wide.css`, `js/ios-chrome.js`, `tests/ios-wide.test.js`

**Interfaces:**
- Consumes: Task 1 の `withPage`、`rect`、`style`、`IOS`、`test`。
- Produces: `#app` が 3 列のグリッド（`240px minmax(0,1fr) auto`）。列 1 = `.top-page-nav`、列 2 = 各ページ、列 3 = `.top-sheet`（Task 3 が使う）。

- [ ] **Step 1: 失敗するテストを足す**

`tests/ios-wide.test.js` の `// === TESTS-INSERT-POINT` の行の上に、次を足す。

```js
test('wide_ios_shows_a_left_sidebar_instead_of_the_tab_bar', () => withPage(IOS, async page => {
  const nav = await rect(page, '.top-page-nav');
  assert(nav.left < 30, `サイドバーが左端にない: left=${nav.left}`);
  assert(nav.width >= 200 && nav.width <= 260, `サイドバーの幅が 240px 前後でない: ${nav.width}`);
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.top-page-tab')].map(t => {
    const r = t.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  }));
  assert.strictEqual(tabs.length, 4);
  assert(tabs.every(t => t.left === tabs[0].left), 'タブが縦に並んでいない');
  assert(tabs.every((t, i) => i === 0 || t.top > tabs[i - 1].top), 'タブが上から順に並んでいない');
  assert.strictEqual(await style(page, '#app', 'paddingBottom'), '0px', '下のタブバー用の余白が残っている');
}));

test('wide_ios_content_is_a_readable_column_next_to_the_sidebar', () => withPage(IOS, async page => {
  const nav = await rect(page, '.top-page-nav');
  const practice = await rect(page, '#practice-page');
  assert(practice.left >= nav.right - 1, '本文がサイドバーに重なっている');
  assert(practice.width <= 721, `演習画面が 720px を超えている: ${practice.width}`);
}));

test('wide_boundary_999_is_the_tab_bar_and_1000_is_the_sidebar', async () => {
  await withPage(IOS, async page => {
    assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'absolute', '999px はこれまでのタブバーのまま');
    assert.strictEqual(await style(page, '#app', 'maxWidth'), '520px');
  }, { width: 999, height: 800 });
  await withPage(IOS, async page => {
    assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static', '1000px はサイドバー');
  }, { width: 1000, height: 800 });
});

test('wide_layout_follows_a_viewport_resize_without_reloading', () => withPage(IOS, async page => {
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static');
  await page.setViewportSize({ width: 800, height: 900 });
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'absolute', '狭くしたらタブバーに戻る');
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static', '広げたらサイドバーに戻る');
}));

test('wide_sidebar_stays_visible_even_if_the_tab_bar_was_stowed_before', () => withPage({ ...IOS, toeic_ios_nav_stowed: '1' }, async page => {
  const nav = await rect(page, '.top-page-nav');
  assert(nav.left < 30 && nav.width > 200, `サイドバーが隠れている: ${JSON.stringify(nav)}`);
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'visible');
  assert.strictEqual(await style(page, '.ios-grabber-bottom', 'display'), 'none', '横画面ではつまみを出さない');
  assert.strictEqual(await style(page, '.ios-grabber-footer', 'display'), 'none');
}));

test('wide_does_not_change_other_themes', async () => {
  for (const theme of ['ink', 'duolingo', 'navy', 'quizlet', 'forest', 'nordic', 'light']) {
    await withPage({ toeic_app_theme: theme }, async page => {
      assert.strictEqual(await style(page, '#app', 'display'), 'flex', `${theme}: #app が flex でない`);
      assert.strictEqual(await style(page, '#app', 'maxWidth'), '520px', `${theme}: 最大幅が変わった`);
      assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static', `${theme}: ナビの配置が変わった`);
      assert.strictEqual(await style(page, '.top-page-nav', 'flexDirection'), 'row', `${theme}: ナビが縦になった`);
    });
  }
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/ios-wide.test.js`
Expected: `wide_ios_*`、`wide_boundary_*`、`wide_layout_follows_*`、`wide_sidebar_stays_*` が FAIL。`wide_does_not_change_other_themes` は PASS（まだ何も変えていないため）。

- [ ] **Step 3: CSS を書く**

`css/theme-ios-wide.css` の `@media (min-width: 1000px) {` の中身を、次にする（`}` の手前に入れる）。

```css
  /* --- 全体: 左サイドバー | 本文 | 右の絞り込みパネル（パネルが無いときは幅 0） --- */
  [data-theme="ios"] #app,
  [data-theme="ios"] #app.page-home,
  [data-theme="ios"] #app.page-review {
    max-width: none; /* home.css の #app.page-home { max-width: 1080px } などを上書き */
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) auto;
    grid-template-rows: minmax(0, 1fr);
  }
  /* 下のタブバー用の余白は要らない（演習画面の情報行の分も含めて 0） */
  [data-theme="ios"] #app,
  [data-theme="ios"] #app.ios-nav-stowed,
  [data-theme="ios"] #app.ios-nav-stowed:has(#practice-page.active) { padding-bottom: 0; }

  /* --- 左のサイドバー（既存の .top-page-nav を縦に並べ直す） --- */
  [data-theme="ios"] .top-page-nav,
  [data-theme="ios"] #app.ios-nav-stowed .top-page-nav {
    position: static;
    grid-column: 1;
    grid-row: 1;
    align-self: stretch;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 18px;
    margin: 12px 0 12px 12px;
    padding: 16px 10px;
    border-radius: 24px;
    transform: none;      /* 格納の状態が残っていても、サイドバーは隠さない */
    visibility: visible;
  }
  [data-theme="ios"] .top-page-brand { display: flex; padding: 4px 8px; font-size: 15px; }
  [data-theme="ios"] .top-page-tabs { flex: none; flex-direction: column; align-items: stretch; gap: 4px; }
  [data-theme="ios"] .top-page-tab {
    flex: none;
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    min-height: 44px;
    padding: 8px 14px;
    border-radius: 12px;
    font-size: 15px;
  }
  [data-theme="ios"] .top-page-tab::before { width: 22px; height: 22px; }
  /* 下のつまみは、タブバーを格納した後の戻し口。サイドバーは常に出すので要らない */
  [data-theme="ios"] .ios-grabber-bottom,
  [data-theme="ios"] .ios-grabber-footer { display: none !important; }

  /* --- 本文: 読みやすい幅で、サイドバーの右の列の中央に置く --- */
  [data-theme="ios"] .app-page-view { grid-column: 2; grid-row: 1; justify-self: center; }
  [data-theme="ios"] #practice-page { max-width: 720px; }
  [data-theme="ios"] #review-page { max-width: 720px; }
  [data-theme="ios"] #settings-page { max-width: 640px; }
  [data-theme="ios"] #home-page { max-width: 1080px; }
```

- [ ] **Step 4: タブバーの格納スワイプを、横画面では無効にする**

`js/ios-chrome.js` の、`const isIos = ...` の次の行に足す。

```js
  const wide = window.matchMedia('(min-width: 1000px)'); // 横画面ではタブバーがサイドバーになるので、格納しない
```

`attachSwipe` の `el.addEventListener('pointerdown', e => {` の次の行（`if (!isIos() || ...` の行）の「前」に足す。

```js
      if (follow && wide.matches) return; // follow が true なのはタブバー（.top-page-nav）だけ
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/ios-wide.test.js`
Expected: `7/7 tests passed`。

- [ ] **Step 6: ブラウザで目で確かめる**

`preview_start` の `toeic-nocache`（ポート 8766）を開き、`resize_window` で幅 1280・高さ 800 にする。`/?theme=ios` を開き、ホーム・演習・復習・設定を順に見る。確認すること: サイドバーが左にある、本文が中央にある、ホームの二列が崩れていない、1024px にしても崩れていない。
ホームの二列の各列が約 320px 未満に窄まるときは、`css/theme-ios-wide.css` に `@media (max-width: 1199px)` の中で `[data-theme="ios"] #app.page-home .home-layout { grid-template-columns: minmax(0, 1fr); }` を足して、右の列が暗黙の列として横にはみ出さないことを確かめてから、その結果を記録する。見終わったら `resize_window` の `desktop` で戻す。

- [ ] **Step 7: 既存のテストを確かめてコミット**

Run: `cd /Users/reiji/myapps/toeic_practice && python3 -m pytest tests -q && for t in practice-chrome sheets; do NODE_PATH=$(npm root -g) node tests/$t.test.js | tail -1; done`
Expected: Python 23 passed、各 Node テストが全件 passed。

```bash
git add css/theme-ios-wide.css js/ios-chrome.js tests/ios-wide.test.js
git commit -m "feat: iOS landscape layout - left sidebar and centered columns at >=1000px

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 右側の絞り込みパネル

**Files:**
- Modify: `css/theme-ios-wide.css`, `js/ios-wide.js`, `tests/ios-wide.test.js`, `docs/superpowers/specs/2026-11-04-ios-wide-layout-design.md`

**Interfaces:**
- Consumes: Task 2 の 3 列グリッド（列 3 = `.top-sheet`）、`js/settings.js` の `closeFilterSheet()`、`switchAppPage(page)`（`home.js`）、`toggleWeakList()`（下のシートを開く）。
- Produces: `#app.ios-filter-panel-open`（パネルを出す印）、`localStorage` の `toeic_ios_filter_panel`（`closed` のとき閉じる）。

- [ ] **Step 1: 失敗するテストを足す**

`tests/ios-wide.test.js` の `// === TESTS-INSERT-POINT` の行の上に、次を足す。

```js
const PANEL = '#filter-drawer';
const visible = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
}, sel);
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const pref = page => page.evaluate(() => localStorage.getItem('toeic_ios_filter_panel'));

test('wide_filter_panel_starts_open_on_the_right_of_the_question', () => withPage(IOS, async page => {
  assert.strictEqual(await visible(page, PANEL), true, '最初からパネルが開いていない');
  const panel = await rect(page, PANEL);
  const practice = await rect(page, '#practice-page');
  assert(panel.left >= practice.right - 1, `パネルが本文の右にない: panel.left=${panel.left}, practice.right=${practice.right}`);
  assert(Math.abs(panel.width - 320) <= 1, `パネルの幅が 320px でない: ${panel.width}`);
  assert(panel.top >= 0 && panel.bottom <= 800, `パネルが画面からはみ出している: ${JSON.stringify(panel)}`);
  assert.strictEqual(await page.evaluate(() => document.getElementById('filter-toggle').getAttribute('aria-expanded')), 'true');
}));

test('wide_filter_button_toggles_the_panel_and_remembers_it', () => withPage(IOS, async page => {
  await click(page, '#filter-toggle');
  assert.strictEqual(await visible(page, PANEL), false, 'ボタンでパネルが閉じない');
  assert.strictEqual(await pref(page), 'closed');
  await page.reload();
  assert.strictEqual(await visible(page, PANEL), false, '再読み込みで開き直した');
  await click(page, '#filter-toggle');
  assert.strictEqual(await visible(page, PANEL), true, 'もう一度押しても開かない');
  assert.strictEqual(await pref(page), null, '開いたら記憶（closed）は消える');
}));

test('wide_filter_close_x_and_apply_button_close_the_panel', () => withPage(IOS, async page => {
  await click(page, '#filter-drawer .top-sheet-close');
  assert.strictEqual(await visible(page, PANEL), false, '✕ で閉じない');
  assert.strictEqual(await pref(page), 'closed');
  await click(page, '#filter-toggle');
  await click(page, '#filter-apply-btn');
  assert.strictEqual(await visible(page, PANEL), false, '「この条件で解く」で閉じない');
}));

test('wide_filter_panel_state_survives_switching_pages', () => withPage(IOS, async page => {
  await page.evaluate(() => switchAppPage('home'));
  assert.strictEqual(await visible(page, PANEL), false, '演習以外の画面にパネルが出ている');
  await page.evaluate(() => switchAppPage('practice'));
  assert.strictEqual(await visible(page, PANEL), true, '戻ったらパネルが開いている（開いたまま）');
  await click(page, '#filter-toggle');
  await page.evaluate(() => switchAppPage('settings'));
  await page.evaluate(() => switchAppPage('practice'));
  assert.strictEqual(await visible(page, PANEL), false, '閉じたパネルが、ページを移ったら開いた');
}));

test('wide_filter_overlay_is_hidden_unless_the_bottom_sheet_is_open', () => withPage(IOS, async page => {
  assert.strictEqual(await visible(page, '#sheet-overlay'), false, 'パネルだけなのに暗幕が出ている');
  await page.evaluate(() => toggleWeakList());
  assert.strictEqual(await page.evaluate(() => document.getElementById('bottom-sheet').classList.contains('open')), true);
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('sheet-overlay')).display !== 'none'), true, '下のシートが開いているのに暗幕が出ない');
}));

test('wide_filter_works_when_local_storage_throws', () => withPage(IOS, async page => {
  // このパネルの記憶のキーだけ、読み書きで例外を投げる（アプリのほかの部分のエラーと切り分けるため）
  await page.addInitScript(() => {
    const KEY = 'toeic_ios_filter_panel';
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, del = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (k) { if (k === KEY) throw new Error('blocked'); return get.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (k === KEY) throw new Error('blocked'); return set.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { if (k === KEY) throw new Error('blocked'); return del.call(this, k); };
  });
  await page.reload();
  assert.strictEqual(await visible(page, PANEL), true, '記憶が使えなくても、パネルは開いて始まる');
  await click(page, '#filter-toggle');
  assert.strictEqual(await visible(page, PANEL), false, '記憶が使えなくても、ボタンで閉じられる');
}));

test('narrow_ios_keeps_the_top_sheet_and_other_themes_keep_it_at_any_width', async () => {
  await withPage(IOS, async page => {
    const closed = await rect(page, PANEL);
    assert(closed.bottom <= 1, `狭い画面で、シートが最初から見えている: ${JSON.stringify(closed)}`);
    await click(page, '#filter-toggle');
    const open = await rect(page, PANEL);
    assert(open.top >= -1 && open.bottom > 100, `狭い画面で、上から降りるシートが開かない: ${JSON.stringify(open)}`);
    assert.strictEqual(await page.evaluate(() => document.getElementById('filter-drawer').classList.contains('open')), true);
  }, { width: 800, height: 900 });
  await withPage({ toeic_app_theme: 'ink' }, async page => {
    const closed = await rect(page, PANEL);
    assert(closed.bottom <= 1, `ink（1280px）でシートが最初から見えている: ${JSON.stringify(closed)}`);
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/ios-wide.test.js`
Expected: `wide_filter_*` が FAIL（パネルがまだ無いため）。`narrow_ios_keeps_the_top_sheet_*` は PASS。

- [ ] **Step 3: パネルの CSS を書く**

`css/theme-ios-wide.css` の `@media (min-width: 1000px) {` の中（Task 2 の本文の幅の後ろ）に足す。

```css

  /* --- 右の絞り込みパネル（既存の #filter-drawer = .top-sheet）---
     上から降りる動きをやめ、本文の右の列に置く。出すかどうかは、#app.ios-filter-panel-open（js/ios-wide.js）か、
     既存の .open（home の「範囲を指定」などから開かれたとき）。演習画面のときだけ出す。 */
  [data-theme="ios"] .top-sheet {
    display: none;
    position: static;
    grid-column: 3;
    grid-row: 1;
    align-self: start;
    width: 320px;
    max-height: calc(100dvh - 24px - env(safe-area-inset-top, 0px));
    margin: 12px 12px 12px 0;
    padding: 18px 16px 16px;
    border-radius: 24px;
    border-bottom: none !important;
    transform: none;
    transition: none;
  }
  [data-theme="ios"] #app.ios-filter-panel-open:has(#practice-page.active) .top-sheet,
  [data-theme="ios"] #app:has(#practice-page.active) .top-sheet.open { display: flex; }
  /* 暗幕は、下のシート（苦手リストなど）が開いているときだけ */
  [data-theme="ios"] #app:not(:has(.bottom-sheet.open)) .sheet-overlay { display: none; }
```

- [ ] **Step 4: パネルの開閉と記憶を書く**

`js/ios-wide.js` を、次の内容にする。

```js
// iOS テーマ × 横画面（幅 1000px 以上）専用: 右側の絞り込みパネルの開閉を、端末に覚えさせる。
// 見た目の配置は css/theme-ios-wide.css 側。他のテーマと狭い画面では何もしない。
//   最初は開く。ユーザーが「絞り込み」ボタン・✕・「この条件で解く」で閉じたときだけ、閉じた状態を覚える。
(function () {
  const KEY = 'toeic_ios_filter_panel'; // 値が 'closed' のときだけ閉じる。無ければ開く
  const wide = window.matchMedia('(min-width: 1000px)');
  const app = document.getElementById('app');
  const drawer = document.getElementById('filter-drawer');
  const toggle = document.getElementById('filter-toggle');
  const practice = document.getElementById('practice-page');
  if (!app || !drawer || !toggle || !practice) return;

  const isIos = () => document.documentElement.getAttribute('data-theme') === 'ios';
  const active = () => isIos() && wide.matches;
  const readClosed = () => { try { return localStorage.getItem(KEY) === 'closed'; } catch (e) { return false; } };
  const write = closed => {
    try { if (closed) localStorage.setItem(KEY, 'closed'); else localStorage.removeItem(KEY); } catch (e) {}
  };
  // パネルが出ているか（この JS の印、または既存の .open）
  const isOpen = () => app.classList.contains('ios-filter-panel-open') || drawer.classList.contains('open');

  // 絞り込みボタンの見た目と aria を、パネルの状態に合わせる
  function reflect() {
    const open = isOpen();
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  // ユーザーの操作で開閉する。閉じるときは、既存の .open（上から降りるシート側）も外す
  function setOpen(open) {
    app.classList.toggle('ios-filter-panel-open', open);
    if (!open && typeof closeFilterSheet === 'function') closeFilterSheet();
    write(!open);
    reflect();
  }

  // 記憶（無ければ開く）を画面に反映する。幅・テーマ・表示中のページが変わったときにも呼ぶ
  function sync() {
    app.classList.toggle('ios-filter-panel-open', active() && !readClosed());
    if (active()) reflect();
  }

  // 横画面の iOS テーマでは、絞り込みボタンは上から降りるシートではなく、パネルの開閉にする
  document.addEventListener('click', e => {
    if (!active() || !e.target.closest('#filter-toggle')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    setOpen(!isOpen());
  }, true);

  // ✕ と「この条件で解く」は、既存の onclick（closeFilterSheet）のあとで、パネルも閉じて記憶する
  document.addEventListener('click', e => {
    if (!active()) return;
    if (e.target.closest('#filter-drawer .top-sheet-close, #filter-apply-btn')) setOpen(false);
  });

  wide.addEventListener('change', sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // ページを移ると closeFilterSheet が呼ばれて aria などがずれるので、演習画面が表示されたら合わせ直す
  new MutationObserver(sync).observe(practice, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/ios-wide.test.js`
Expected: `14/14 tests passed`（Task 1 の 1 件 + Task 2 の 6 件 + Task 3 の 7 件）。

失敗したら、メッセージの内容から原因を調べる。とくに、`wide_filter_works_when_local_storage_throws` で `pageErrors`（ページのエラー）が出るときは、`ios-wide.js` の `localStorage` の読み書きが `try` の外にないかを確かめる。

- [ ] **Step 6: 設計書を、実装に合わせて直す**

`docs/superpowers/specs/2026-11-04-ios-wide-layout-design.md` の「4. 右側の絞り込みパネル」の次の 2 行を直す。

直す前:
```
- 開閉は、既存の `open` クラスの付け外しをそのまま使う（`openFilterSheet` / `closeFilterSheet` / `toggleFilterSheet`、`js/settings.js`）。
```
直した後:
```
- パネルを出すかどうかは、`#app` の `ios-filter-panel-open` クラス（`js/ios-wide.js` が付け外し）か、既存の `.top-sheet.open`（ホームの「範囲を指定」などが開いたとき）のどちらか。
  ページ切り替えで呼ばれる `closeFilterSheet()` は `.open` だけを外すので、パネルは開閉の記憶のとおりに残る。
```

直す前:
```
  下のシートを開いたことによる自動の閉じは、覚えない。
```
直した後:
```
  下のシート（苦手リストなど）を開いても、パネルは閉じない（暗幕と下のシートがパネルの上に重なる）。
```
- [ ] **Step 7: ブラウザで目で確かめる**

幅 1280 で `/?theme=ios` の演習画面を開き、パネルが右に出ていること、「絞り込み」ボタンで開閉できること、条件を変えると真ん中の問題がすぐ変わること、ホームの「範囲を指定」を押すと演習画面に移ってパネルが出ること、下の「苦手リスト」を開くと暗幕と下のシートが出ることを確かめる。幅 800 に狭めると、上から降りるシートに戻ることも確かめる。見終わったら `resize_window` の `desktop` で戻す。

- [ ] **Step 8: コミット**

```bash
cd /Users/reiji/myapps/toeic_practice
git add css/theme-ios-wide.css js/ios-wide.js tests/ios-wide.test.js docs/superpowers/specs/2026-11-04-ios-wide-layout-design.md
git commit -m "feat: iOS landscape layout - right-hand filter panel (open by default, remembered)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 他への影響の最終確認

**Files:**
- Modify: なし（確認のみ。問題が見つかったときだけ、該当のファイルを直す）

- [ ] **Step 1: 他のテーマが変わらないことを、検証用のスクリプトで確かめる**

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node /private/tmp/claude-501/-Users-reiji-myapps-toeic-practice/6e8917ce-d63f-40e0-90aa-931260ece7f0/scratchpad/ios-isolation.cjs | grep -E "FAIL|checks"`
Expected: `25 checks, 0 failed`（このスクリプトは幅 420px ほどの狭い画面で動くので、`theme-ios-wide.css` が狭い画面に影響しないことの確認になる）。

- [ ] **Step 2: 全テストを実行する**

Run:
```bash
cd /Users/reiji/myapps/toeic_practice
python3 -m pytest tests -q
for t in ios-wide practice-chrome sheets review-pace-fixes grammar-seen; do echo "== $t"; NODE_PATH=$(npm root -g) node tests/$t.test.js | tail -1; done
```
Expected: Python 23 passed、各 Node テストが全件 passed。

- [ ] **Step 3: 公開待ちの確認（公開はしない）**

Run: `cd /Users/reiji/myapps/toeic_practice && git status --short && python3 upload.py -n | tail -8`
Expected: 公開待ちが `css/theme-ios-wide.css`、`js/ios-wide.js`、`js/ios-chrome.js`、`index.html`、`sw.js`、`upload.py` だけ。

- [ ] **Step 4: ユーザーに報告する**

変更内容、確認できたこと、確認できていないこと（iPad / Mac の実機での見え方、1000px 付近の見え方）を報告し、公開してよいかを聞く。公開は、ユーザーの返事があってから行う。
