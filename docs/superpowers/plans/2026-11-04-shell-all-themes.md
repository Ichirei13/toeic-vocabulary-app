# 画面の枠を全テーマに広げる 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-subagent-driven-development (recommended) or sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 今は iOS テーマだけにある「下の浮いたタブバー・スワイプ格納・横画面版」を、全 8 テーマで、各テーマの色のまま使えるようにする。

**Architecture:** 共通の枠（位置・形・格納・横画面の 3 列）を新しい `css/shell.css` に集め、選択子を `[data-theme]`（どのテーマにも当たる。詳細度は `[data-theme="ios"]` と同じ）で書く。読み込み順は `home.css` → `css/app.css` → `css/shell.css` → `css/theme-ios.css`。iOS の見た目（ガラス・青）だけを theme-ios.css に残す。JS（`shell-chrome.js` と `wide-layout.js`）から「iOS のときだけ」の条件を外す。

**Tech Stack:** 素の CSS / JS（ビルドなし）、検証は Playwright（Chromium）の Node テストと、Python の pytest。

**Spec:** `docs/superpowers/specs/2026-11-04-shell-all-themes-design.md`（前提: `2026-11-04-ios-wide-layout-design.md`）

## Global Constraints

- 8 テーマ: `ink, duolingo, navy, quizlet, forest, nordic, light, ios`。どのテーマも `<html data-theme="…">` を持つ。
- 幅の境目は `min-width: 1000px`（CSS・JS で同じ値）。サイドバー 240px、絞り込みパネル `clamp(320px, 30vw, 380px)`、本文の最大幅は演習 640px・復習 720px・設定 640px・ホーム 1080px。
- 下のタブバー: 左右 16px、下から `max(8px, セーフエリア)`、丸いカプセル、高さ 52px のタブ。`#app` の下の余白は `--shell-tab-space`（= 74px + max(8px, セーフエリア)）。
- 色は各テーマの変数だけを使う: バーの背景 `--top-sheet-bg`、枠 `1px solid var(--top-sheet-border)`、影 `0 8px 24px rgba(0,0,0,0.22)`、選択中のタブは既存の `.top-page-tab.active`。iOS のガラス・青は theme-ios.css に残す。
- 名前の変更（ユーザーが了解済み）:
  - ファイル: `css/theme-ios-wide.css` → `css/shell.css`、`js/ios-chrome.js` → `js/shell-chrome.js`、`js/ios-wide.js` → `js/wide-layout.js`、`tests/ios-wide.test.js` → `tests/shell.test.js`（`git mv`）。
  - クラス: `ios-nav-stowed` → `nav-stowed`、`ios-top-stowed` → `top-stowed`、`ios-grabber`（`-bottom` / `-top` / `-footer` を含む）→ `shell-grabber`、`ios-filter-panel-open` → `filter-panel-open`。
  - localStorage: `toeic_ios_nav_stowed` → `toeic_nav_stowed`、`toeic_ios_top_stowed` → `toeic_top_stowed`、`toeic_ios_filter_panel` → `toeic_wide_filter_panel`（古い値は引き継がない）。
  - CSS 変数 `--ios-*`（iOS の見た目）は、名前を変えない。
- 新しいファイルは、`index.html`、`sw.js` の ASSETS、`upload.py` の FILES の 3 か所に登録する（`tests/test_file_lists.py` が一致を確かめる）。`sw.js` のキャッシュ名は `v8` にする。
- 日本語のコメントで、既存のコードに合わせる。`python` ではなく `python3`。
- コミットの末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` を付ける。
- 公開（`upload.py`）は、このプランの範囲に含めない。ユーザーの指示があったときだけ行う。
- 検証用スクリプトの置き場（リポジトリ外）: `/private/tmp/claude-501/-Users-reiji-myapps-toeic-practice/6e8917ce-d63f-40e0-90aa-931260ece7f0/scratchpad`（以下 `$SCRATCH`）。

## Review Focus

- 各テーマで、下のバーの背景が本文に埋もれない（背景色が透明でなく、枠がある）（Task 2 のテスト）。
- 格納した状態でテーマを切り替えても、バーが隠れたまま・状態が混ざらない（Task 2 のテスト）。
- iOS の下のバーの見た目が、変更前と同じ（計算済みスタイルの前後比較）（Task 2）。
- 幅がちょうど 999px / 1000px のとき、全テーマで下のバー / サイドバーのどちらか一方になる（Task 3 のテスト）。
- 古い名前で覚えさせた値（`toeic_ios_nav_stowed` など）が残っていても、エラーにならず、無視される（Task 1 のテスト）。

## File Structure

| ファイル | 役割 |
|---|---|
| `css/shell.css`（旧 theme-ios-wide.css） | 全テーマ共通の画面の枠。下のタブバー、格納・つまみ、横画面版。 |
| `css/theme-ios.css`（変更） | iOS の見た目だけ。ナビの構造と格納の構造は shell.css へ移す。 |
| `js/shell-chrome.js`（旧 ios-chrome.js） | スワイプ格納。全テーマで動く。 |
| `js/wide-layout.js`（旧 ios-wide.js） | 横画面の絞り込みパネルの開閉と記憶。全テーマで動く。 |
| `tests/shell.test.js`（旧 ios-wide.test.js） | 全テーマを対象にしたテスト。 |
| `index.html` / `sw.js` / `upload.py`（変更） | 名前と読み込み順の更新。 |

---

### Task 1: 名前の変更（見た目と動きは変えない）

**Files:**
- Rename: `css/theme-ios-wide.css` → `css/shell.css`、`js/ios-chrome.js` → `js/shell-chrome.js`、`js/ios-wide.js` → `js/wide-layout.js`、`tests/ios-wide.test.js` → `tests/shell.test.js`
- Modify: `css/theme-ios.css`、上記の各ファイル、`index.html`、`sw.js`、`upload.py`

**Interfaces:**
- Produces: 新しい名前（上の Global Constraints のとおり）。以降のタスクは、すべて新しい名前を使う。

- [ ] **Step 1: テストを新しい名前に直して、失敗することを確かめる**

```bash
cd /Users/reiji/myapps/toeic_practice
git mv tests/ios-wide.test.js tests/shell.test.js
python3 - <<'EOF'
from pathlib import Path
p = Path('tests/shell.test.js'); s = p.read_text(encoding='utf-8')
for old, new in [
    ('toeic_ios_nav_stowed', 'toeic_nav_stowed'), ('toeic_ios_top_stowed', 'toeic_top_stowed'),
    ('toeic_ios_filter_panel', 'toeic_wide_filter_panel'),
    ('ios-nav-stowed', 'nav-stowed'), ('ios-top-stowed', 'top-stowed'),
    ('ios-grabber', 'shell-grabber'), ('ios-filter-panel-open', 'filter-panel-open'),
    ('css/theme-ios-wide.css', 'css/shell.css'), ('js/ios-wide.js', 'js/wide-layout.js'),
    ('theme-ios-wide.css', 'shell.css'), ('ios-wide.test.js', 'shell.test.js'),
]:
    s = s.replace(old, new)
p.write_text(s, encoding='utf-8')
EOF
NODE_PATH=$(npm root -g) node tests/shell.test.js 2>&1 | grep -E "^FAIL|tests passed" | head -20
```

Expected: 複数の FAIL（`css/shell.css が index.html から読み込まれていない`、つまみ・パネルのクラス名・記憶のキーが見つからない、など）。`N/M tests passed` の N が M より小さい。

- [ ] **Step 2: 古い名前の記憶が残っていても無視されることを確かめるテストを足す（失敗しないはずの守りのテスト）**

`tests/shell.test.js` の `// === TESTS-INSERT-POINT` の行の上に足す。

```js
test('old_ios_named_storage_keys_are_ignored_without_errors', () => withPage({ ...IOS, toeic_ios_nav_stowed: '1', toeic_ios_top_stowed: '1', toeic_ios_filter_panel: 'closed' }, async page => {
  const r = await page.evaluate(() => ({
    navStowed: document.getElementById('app').classList.contains('nav-stowed'),
    topStowed: document.getElementById('practice-page').classList.contains('top-stowed'),
  }));
  assert.strictEqual(r.navStowed, false, '古い名前の「格納している」は引き継がない');
  assert.strictEqual(r.topStowed, false);
  assert.strictEqual(await visible(page, PANEL), true, '古い名前の「閉じている」は引き継がず、パネルは開いて始まる');
}));
```

（`PANEL` と `visible` は、このファイルの前の方で定義済み。もし定義が後ろにあるなら、このテストを定義の後ろ、`TESTS-INSERT-POINT` の直前に置く。）

- [ ] **Step 3: 名前を変更する（ファイルとコード）**

```bash
cd /Users/reiji/myapps/toeic_practice
git mv css/theme-ios-wide.css css/shell.css
git mv js/ios-chrome.js js/shell-chrome.js
git mv js/ios-wide.js js/wide-layout.js
python3 - <<'EOF'
from pathlib import Path
files = ['css/shell.css', 'css/theme-ios.css', 'js/shell-chrome.js', 'js/wide-layout.js', 'index.html', 'sw.js', 'upload.py']
pairs = [
    ('toeic_ios_nav_stowed', 'toeic_nav_stowed'), ('toeic_ios_top_stowed', 'toeic_top_stowed'),
    ('toeic_ios_filter_panel', 'toeic_wide_filter_panel'),
    ('ios-nav-stowed', 'nav-stowed'), ('ios-top-stowed', 'top-stowed'),
    ('ios-grabber', 'shell-grabber'), ('ios-filter-panel-open', 'filter-panel-open'),
    ('css/theme-ios-wide.css', 'css/shell.css'), ('js/ios-chrome.js', 'js/shell-chrome.js'), ('js/ios-wide.js', 'js/wide-layout.js'),
    ('theme-ios-wide.css', 'shell.css'),
]
for f in files:
    p = Path(f); s = p.read_text(encoding='utf-8')
    for old, new in pairs:
        s = s.replace(old, new)
    p.write_text(s, encoding='utf-8')
p = Path('sw.js'); s = p.read_text(encoding='utf-8')
s = s.replace("const CACHE = 'toeic-drill-v7';", "const CACHE = 'toeic-drill-v8';")
p.write_text(s, encoding='utf-8')
EOF
grep -rn "ios-nav-stowed\|ios-top-stowed\|ios-grabber\|ios-filter-panel\|ios-chrome\|ios-wide\|toeic_ios_\|theme-ios-wide" css js index.html sw.js upload.py tests home.js home.css | grep -v "^tests/shell.test.js.*toeic_ios_" || echo "古い名前は残っていない"
```

Expected: `古い名前は残っていない`（テストの Step 2 のテストだけが、古いキー名 `toeic_ios_*` を意図して使う）。

index.html の読み込み順のコメント（`8.` と `9.` の行）の文言を、新しい名前に合わせて直す。

```bash
cd /Users/reiji/myapps/toeic_practice
grep -n "shell-chrome\|wide-layout" index.html | cut -c1-160
```

`8. js/shell-chrome.js` の行の説明を「スワイプ格納（タブバーと演習画面の見出し行）。全テーマで動く」に、`9. js/wide-layout.js` の行の説明を「横画面（幅 1000px 以上）の右の絞り込みパネルの開閉の記憶。全テーマで動く」に、書き換える（Edit で、その行の説明部分だけを置き換える）。

- [ ] **Step 4: テストが通ることを確かめる**

```bash
cd /Users/reiji/myapps/toeic_practice
export NODE_PATH=$(npm root -g)
node tests/shell.test.js | tail -3
python3 -m pytest tests -q | tail -2
for t in practice-chrome sheets; do echo "$t: $(node tests/$t.test.js | tail -1)"; done
```

Expected: `shell.test.js` が全件 passed（Step 2 のテストを含む）、pytest が全件 passed、他の 2 つも全件 passed。

- [ ] **Step 5: コミット**

```bash
cd /Users/reiji/myapps/toeic_practice
git add -A css js tests index.html sw.js upload.py
git commit -m "refactor: drop the iOS name from the shell files, classes and storage keys

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 下の浮いたタブバーと格納を、全テーマに

**Files:**
- Modify: `css/shell.css`、`css/theme-ios.css`、`js/shell-chrome.js`、`index.html`、`tests/shell.test.js`
- Create（リポジトリ外）: `$SCRATCH/shell-snapshot.cjs`

**Interfaces:**
- Consumes: Task 1 の新しい名前。`withPage`、`rect`、`style`、`click`、`visible`、`PANEL`、`IOS`、`test`（tests/shell.test.js）。
- Produces: `forThemes(name, fn, viewport)`（全テーマ分のテストを登録する）、`drag(page, from, to)`、`center(rect)`（Task 3 のテストが使う）。`shell.css` に `--shell-tab-space`、`--shell-spring` と、全テーマ共通の下のバー・格納の CSS。

- [ ] **Step 1: iOS の見た目の「変更前」を記録する**

`$SCRATCH/shell-snapshot.cjs` を作る。

```js
// iOS テーマの下のバーと格納の見た目を、計算済みスタイルで記録する（変更の前後で比べる）。
// 使い方: NODE_PATH=$(npm root -g) node shell-snapshot.cjs <出力する JSON のパス>
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = '/Users/reiji/myapps/toeic_practice';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
const PROPS = ['position', 'left', 'right', 'bottom', 'zIndex', 'padding', 'borderTopWidth', 'borderRadius', 'backgroundColor', 'backdropFilter', 'boxShadow',
  'gap', 'flexDirection', 'justifyContent', 'minHeight', 'fontSize', 'fontWeight', 'letterSpacing', 'color', 'transform', 'visibility', 'opacity', 'display', 'width', 'height', 'paddingBottom'];
const TARGETS = ['#app', '.top-page-nav', '.top-page-brand', '.top-page-tabs', '.top-page-tab', '.top-page-tab.active', '.shell-grabber-bottom', '.shell-grabber-footer', '.shell-grabber-top', '#practice-page .header'];
server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const out = {};
  for (const [state, storage] of [['normal', {}], ['nav-stowed', { toeic_nav_stowed: '1' }], ['top-stowed', { toeic_top_stowed: '1' }]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    await ctx.addInitScript(items => { try { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e) {} }, { toeic_app_theme: 'ios', ...storage });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await ctx.newPage();
    await page.goto(base + '/index.html#practice');
    await page.waitForTimeout(1200);
    out[state] = await page.evaluate(([targets, props]) => {
      const r = {};
      for (const sel of targets) {
        const el = document.querySelector(sel);
        if (!el) { r[sel] = null; continue; }
        const cs = getComputedStyle(el);
        r[sel] = Object.fromEntries(props.map(p => [p, cs[p]]));
        const rc = el.getBoundingClientRect();
        r[sel].__rect = [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)].join(',');
      }
      const before = getComputedStyle(document.querySelector('.top-page-tab'), '::before');
      r['tab::before'] = { width: before.width, height: before.height, mask: (before.webkitMaskImage || '').slice(0, 60), bg: before.backgroundColor };
      return r;
    }, [TARGETS, PROPS]);
    await ctx.close();
  }
  await browser.close(); server.close();
  fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log('wrote', process.argv[2]);
});
```

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node $SCRATCH/shell-snapshot.cjs $SCRATCH/ios-before.json`
Expected: `wrote …/ios-before.json`

- [ ] **Step 2: 失敗するテストを足す**

`tests/shell.test.js` の `// === TESTS-INSERT-POINT` の行の上に足す。

```js
const THEMES = ['ink', 'duolingo', 'navy', 'quizlet', 'forest', 'nordic', 'light', 'ios'];
// 全テーマ分のテストを 1 件ずつ登録する（失敗したとき、どのテーマか分かるように）
const forThemes = (name, fn, viewport) => THEMES.forEach(t => test(`${name} [${t}]`, () => withPage({ toeic_app_theme: t }, page => fn(page, t), viewport)));
const NARROW = { width: 390, height: 800 };
const center = r => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
const drag = async (page, from, to, steps = 8) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
  await page.mouse.up();
};
const hasClass = (page, sel, cls) => page.evaluate(([s, c]) => document.querySelector(s).classList.contains(c), [sel, cls]);
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);

forThemes('narrow_has_a_floating_bottom_tab_bar_with_icons', async page => {
  const nav = await rect(page, '.top-page-nav');
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'absolute', '下に浮いたバーになっていない');
  assert(Math.abs(nav.left - 16) <= 1 && Math.abs(nav.right - 374) <= 1, `左右 16px の余白でない: ${JSON.stringify(nav)}`);
  assert(nav.bottom <= 800 - 7 && nav.bottom >= 800 - 40, `画面の下に寄っていない: bottom=${nav.bottom}`);
  assert.strictEqual(await style(page, '#app', 'paddingBottom'), '82px', '下のバー用の余白がない');
  const look = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.top-page-nav'));
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
    return { alpha: m.length === 4 ? m[3] : 1, border: parseFloat(cs.borderTopWidth) };
  });
  assert(look.alpha >= 0.5, `バーの背景が透けすぎて、本文に埋もれる: alpha=${look.alpha}`);
  const icons = await page.evaluate(() => [...document.querySelectorAll('.top-page-tab')].map(t => (getComputedStyle(t, '::before').webkitMaskImage || '').includes('svg')));
  assert.deepStrictEqual(icons, [true, true, true, true], 'タブのアイコンが出ていない');
}, NARROW);

forThemes('narrow_swipe_down_stows_the_tab_bar_and_the_grabber_brings_it_back', async page => {
  const nav = await rect(page, '.top-page-nav');
  await drag(page, center(nav), { x: center(nav).x, y: center(nav).y + 20 });
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), false, '短いスワイプで格納された');
  await drag(page, center(nav), { x: center(nav).x, y: center(nav).y + 70 });
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true, '長く下へ引いても格納されない');
  assert.strictEqual(await stored(page, 'toeic_nav_stowed'), '1');
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'hidden');
  await click(page, '.shell-grabber-footer');
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), false, 'つまみで戻らない');
  assert.strictEqual(await stored(page, 'toeic_nav_stowed'), null);
}, NARROW);

forThemes('narrow_swipe_up_stows_the_practice_header_row', async page => {
  await drag(page, { x: 60, y: 50 }, { x: 60, y: 0 });
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#practice-page', 'top-stowed'), true, '見出し行が格納されない');
  assert.strictEqual(await stored(page, 'toeic_top_stowed'), '1');
}, NARROW);

test('narrow_stowed_state_is_remembered_and_survives_a_theme_switch', () => withPage({ toeic_app_theme: 'ink', toeic_nav_stowed: '1' }, async page => {
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'hidden', '記憶した「格納」が復元されない');
  await page.evaluate(() => setAppTheme('light'));
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true, 'テーマを切り替えたら格納が外れた');
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'hidden');
}, NARROW));
```

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/shell.test.js 2>&1 | grep -E "^FAIL|tests passed" | head -40`
Expected: iOS 以外の 7 テーマの `narrow_*` が FAIL（ナビが上にある、つまみが無い、など）。`[ios]` の 3 件と、`narrow_stowed_state_is_remembered…`（ink）は、ink が上のバーなので FAIL。

- [ ] **Step 3: shell.css に、全テーマ共通の下のバーと格納を作る（theme-ios.css から移す）**

次のスクリプトで、theme-ios.css の「下のバーの構造」と「格納」を shell.css へ移し、iOS 専用の見た目だけを theme-ios.css に残す。

```bash
cd /Users/reiji/myapps/toeic_practice
python3 - <<'EOF'
from pathlib import Path

ios = Path('css/theme-ios.css').read_text(encoding='utf-8')
shell = Path('css/shell.css').read_text(encoding='utf-8')

def cut(text, start, end):
    i = text.index(start); j = text.index(end, i)
    return text[:i], text[i:j], text[j:]

# 1) 下のバーのブロック（構造 + 見た目）と、その中のアイコンの定義を取り出す
head, nav_block, tail = cut(ios, '/* --- 下部の浮遊ガラスタブバー', '/* --- シート: ガラス + つまみ --- */')
icons = nav_block[nav_block.index('/* SF Symbols 風の線画'):]
icons = icons.replace('[data-theme="ios"]', '[data-theme]')

# 2) 格納のブロックを取り出す（theme-ios.css の「書体」の手前まで）
head2, stow_block, tail2 = cut(head + '\u0000SPLIT\u0000' + tail, '/* === スワイプで格納', '/* === 書体:')
stow = stow_block.replace('[data-theme="ios"]', '[data-theme]').replace('var(--ios-spring)', 'var(--shell-spring)')

# 3) iOS 側に残す見た目（ガラスと青）
ios_nav = '''/* --- 下部ナビ: ガラスの質感と青い選択色（位置・形・タブの並びは css/shell.css） --- */
[data-theme="ios"] .top-page-nav {
  border: none;
  background: var(--ios-glass);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  box-shadow:
    var(--ios-glass-shadow),
    inset 0 1px 0 var(--ios-glass-edge-top),
    inset 0 -1px 0 var(--ios-glass-edge-bottom);
}
[data-theme="ios"] .top-page-tab.active {
  background: var(--ui-surface);
  color: var(--ios-blue);
  font-weight: 600;
  box-shadow: inset 0 1px 0 var(--ios-glass-edge-top), inset 0 -1px 0 var(--ios-glass-edge-bottom);
}

'''
new_ios = head2.replace('\u0000SPLIT\u0000', ios_nav) + tail2  # iOS 側のナビは、元のナビのブロックがあった位置に置く
new_ios = new_ios.replace('  --ios-tab-space: calc(74px + max(8px, env(safe-area-inset-bottom, 0px)));\n', '')
Path('css/theme-ios.css').write_text(new_ios, encoding='utf-8')

# 4) shell.css: 先頭のコメントの後に、共通の変数・下のバー・アイコン・格納を置き、横画面のブロックを最後に残す
i = shell.index('@media (min-width: 1000px)')
shell_head, shell_wide = shell[:i], shell[i:]
shell_head = '''/* === 画面の枠（全テーマ共通）===
   下の浮いたタブバー、スワイプ格納（js/shell-chrome.js）、横画面版（幅 1000px 以上: 左のサイドバー | 本文 | 右の絞り込みパネル）。
   色は各テーマの変数（--top-sheet-bg など）を使う。iOS のガラスと青は css/theme-ios.css 側。
   選択子は [data-theme]（どのテーマにも当たる。詳細度は [data-theme="ios"] と同じ）。
   読み込み順: home.css → css/app.css → css/shell.css → css/theme-ios.css */

[data-theme] {
  --shell-tab-space: calc(74px + max(8px, env(safe-area-inset-bottom, 0px)));
  --shell-spring: cubic-bezier(0.32, 0.72, 0, 1);
}

/* --- 下の浮いたタブバー（既存の .top-page-nav を CSS だけで下に移す） --- */
[data-theme] #app { padding-bottom: var(--shell-tab-space); }

[data-theme] .top-page-nav {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: max(8px, env(safe-area-inset-bottom, 0px));
  z-index: 50;
  padding: 5px;
  gap: 0;
  border: 1px solid var(--top-sheet-border);
  border-radius: 999px;
  background: var(--top-sheet-bg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
}
[data-theme] .top-page-brand { display: none; }
[data-theme] .top-page-tabs {
  flex: 1;
  background: transparent;
  border: none;
  padding: 0;
  gap: 2px;
}
[data-theme] .top-page-tab {
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-height: 52px;
  padding: 6px 4px;
  border-radius: 999px;
  font-size: 10px;
  letter-spacing: 0.02em;
}
[data-theme] .top-page-tab::before {
  content: '';
  width: 24px;
  height: 24px;
  background-color: currentColor;
  -webkit-mask: var(--tab-icon) center / contain no-repeat;
  mask: var(--tab-icon) center / contain no-repeat;
}
[data-theme] .top-page-tab:active { transform: scale(0.94); }
''' + icons.rstrip() + '\n\n' + stow.rstrip() + '\n\n'
Path('css/shell.css').write_text(shell_head + shell_wide, encoding='utf-8')
print('ok')
EOF
grep -c "ios" css/shell.css; grep -n 'data-theme="ios"' css/shell.css | head -3
```

Expected: `ok`。`css/shell.css` の `[data-theme="ios"]` は、横画面のブロック（Task 3 で直す）にだけ残る。

index.html の link の順番を、`app.css` → `shell.css` → `theme-ios.css` に直す。

```bash
cd /Users/reiji/myapps/toeic_practice
python3 - <<'EOF'
from pathlib import Path
p = Path('index.html'); s = p.read_text(encoding='utf-8')
s = s.replace('<link rel="stylesheet" href="css/shell.css">\n', '')
s = s.replace('<link rel="stylesheet" href="css/theme-ios.css">', '<link rel="stylesheet" href="css/shell.css">\n<link rel="stylesheet" href="css/theme-ios.css">')
p.write_text(s, encoding='utf-8')
EOF
grep -n 'stylesheet' index.html | cut -c1-100
```

Expected: `home.css`、`css/app.css`、`css/shell.css`、`css/theme-ios.css` の順。

- [ ] **Step 4: shell-chrome.js から「iOS のときだけ」を外す**

`js/shell-chrome.js` を、次の内容にする（動きは今の iOS と同じ。`isIos()` と、テーマの監視をなくす）。

```js
// 画面の枠（全テーマ）: 下のタブバーと、演習画面の見出し・モード切替の行を、スワイプで格納する
// （iOS 26 でスクロール中にバーが引っ込む動きの近似）。
//   タブバー: バーを下にスワイプ → 画面の下に格納。残ったつまみをタップ／上にスワイプで戻る
//     （つまみは、演習画面では下の情報行の真上、ほかの画面では画面の最下部に出る）
//   見出し行: 見出し・モード切替の行を上にスワイプ → 画面の上に格納。つまみをタップ／下にスワイプで戻る
// 格納したかどうかは端末に覚えさせる。見た目の動きは css/shell.css 側。
// 幅 1000px 以上（横画面）では、タブバーがサイドバーになるので、タブバーは格納しない。
(function () {
  const NAV_KEY = 'toeic_nav_stowed';
  const TOP_KEY = 'toeic_top_stowed';
  const THRESHOLD = 36; // この距離(px)以上動かしたら「スワイプした」とみなす

  const app = document.getElementById('app');
  const nav = document.querySelector('.top-page-nav');
  const practice = document.getElementById('practice-page');
  if (!app || !nav || !practice) return;

  const wide = window.matchMedia('(min-width: 1000px)');
  const read = key => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } };
  const write = (key, on) => {
    try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (e) {}
  };

  // ドラッグ直後に出る click は、タブやセグメントを誤って押さないよう 1 回だけ捨てる
  function swallowNextClick() {
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, true), 350);
  }

  // sign が 1 なら画面の下向き、-1 なら上向きのスワイプで onSwipe を呼ぶ。
  // follow が true の間は、指に合わせて要素を動かす（タブバー用）。
  function attachSwipe(el, sign, onSwipe, follow) {
    let startX = 0, startY = 0, pointerId = null, moved = 0, dragging = false;
    // 動かしている間は document で受ける（マウスを速く動かすと、指やカーソルが元の要素の外に出ても追えるように）
    const move = e => {
      if (e.pointerId !== pointerId) return;
      moved = (e.clientY - startY) * sign;
      if (!dragging && moved > 8 && moved > Math.abs(e.clientX - startX)) {
        dragging = true;
        if (follow) el.style.transition = 'none';
      }
      if (dragging && follow) el.style.transform = 'translateY(' + (moved * sign) + 'px)';
    };
    const finish = e => {
      if (e.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      const wasDragging = dragging, distance = moved;
      pointerId = null; dragging = false;
      if (follow) { el.style.transition = ''; el.style.transform = ''; }
      if (wasDragging) {
        swallowNextClick();
        if (distance > THRESHOLD) onSwipe();
      }
    };
    el.addEventListener('pointerdown', e => {
      if (follow && wide.matches) return; // follow が true なのはタブバー（.top-page-nav）だけ
      if (pointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      startX = e.clientX; startY = e.clientY; pointerId = e.pointerId; moved = 0; dragging = false;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    });
  }

  function setNavStowed(on) {
    app.classList.toggle('nav-stowed', on);
    write(NAV_KEY, on);
  }
  function setTopStowed(on) {
    practice.classList.toggle('top-stowed', on);
    write(TOP_KEY, on);
  }

  function makeGrabber(className, label, onShow, sign) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shell-grabber ' + className;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<span></span>';
    b.addEventListener('click', onShow);
    attachSwipe(b, sign, onShow, false);
    return b;
  }

  // 戻すためのつまみを作り、覚えていた格納の状態を復元する
  const bottomGrabber = makeGrabber('shell-grabber-bottom', 'タブバーを表示', () => setNavStowed(false), -1);
  const topGrabber = makeGrabber('shell-grabber-top', '見出しを表示', () => setTopStowed(false), 1);
  app.appendChild(bottomGrabber);
  practice.insertBefore(topGrabber, practice.firstChild);
  // 演習画面では、画面の最下部（ホームバーと重なる）ではなく、下の情報行の真上に出す
  const footer = practice.querySelector('.footer');
  if (footer) practice.insertBefore(makeGrabber('shell-grabber-footer', 'タブバーを表示', () => setNavStowed(false), -1), footer);
  setNavStowed(read(NAV_KEY));
  setTopStowed(read(TOP_KEY));

  // 格納する側（バーと見出し行）にスワイプを付ける
  attachSwipe(nav, 1, () => setNavStowed(true), true);
  const header = practice.querySelector('.header');
  const segments = document.getElementById('app-type-segments');
  if (header) attachSwipe(header, -1, () => setTopStowed(true), false);
  if (segments) attachSwipe(segments, -1, () => setTopStowed(true), false);
})();
```

- [ ] **Step 5: テストが通ることを確かめる**

```bash
cd /Users/reiji/myapps/toeic_practice
NODE_PATH=$(npm root -g) node tests/shell.test.js 2>&1 | grep -E "^FAIL|tests passed|^     [^ ]" | head -30
```

Expected: `narrow_*` の全テーマが PASS。失敗が出たときは、原因をメッセージから調べる（詳細度の負け、変数が無いなど）。この時点では、横画面のテストの一部（iOS 専用の記述のまま）も通るはず。他のテーマの `wide_does_not_change_other_themes` は、他テーマの横画面がまだ従来のままなので、PASS のまま（Task 3 で作り直す）。

- [ ] **Step 6: iOS の見た目が変わっていないことを確かめる**

```bash
cd /Users/reiji/myapps/toeic_practice
SCRATCH=/private/tmp/claude-501/-Users-reiji-myapps-toeic-practice/6e8917ce-d63f-40e0-90aa-931260ece7f0/scratchpad
NODE_PATH=$(npm root -g) node $SCRATCH/shell-snapshot.cjs $SCRATCH/ios-after.json && diff $SCRATCH/ios-before.json $SCRATCH/ios-after.json && echo "iOS の計算済みスタイルは同一"
```

Expected: `iOS の計算済みスタイルは同一`。差分が出たときは、差分のプロパティを見て、theme-ios.css に残すべき指定が移ってしまっていないか、shell.css の指定が iOS の見た目を上書きしていないかを直す（直したら、この Step を再実行）。

- [ ] **Step 7: 全テーマを目で確かめる**

`preview_start` の `toeic-nocache`（ポート 8766）を開き、`resize_window` で幅 390・高さ 800 にして、`/?theme=<テーマ>#practice` を 8 テーマ分（`ink duolingo navy quizlet forest nordic light ios`）開き、スクリーンショットを撮る。確認すること: 下のバーが本文に埋もれていない、選択中のタブが見える、アイコンが出ている、本文が下のバーに隠れていない。コントラストの問題があれば、その場でバーの背景・枠の指定を直す（変数の選び方を見直す）。終わったら `resize_window` の `desktop` で戻す。

- [ ] **Step 8: 全テストを確かめてコミット**

```bash
cd /Users/reiji/myapps/toeic_practice
export NODE_PATH=$(npm root -g)
python3 -m pytest tests -q | tail -2
for t in shell practice-chrome sheets review-pace-fixes grammar-seen; do echo "$t: $(node tests/$t.test.js | tail -1)"; done
```

Expected: pytest 全件 passed。`practice-chrome` などで、ナビが上にあることを前提にした測定が落ちたときは、新しい配置（下のバー）に合わせて、そのテストの期待値を直す（何が変わったのかを、コミットメッセージに書く）。

```bash
git add -A css js tests index.html
git commit -m "feat: floating bottom tab bar and swipe-to-stow for every theme (theme colors)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 横画面版を全テーマに

**Files:**
- Modify: `css/shell.css`、`css/theme-ios.css`、`js/wide-layout.js`、`tests/shell.test.js`

**Interfaces:**
- Consumes: Task 2 の `forThemes`、`NARROW`、`center`、`drag`、`hasClass`、`stored`、`THEMES`。`shell.css` の下のバーと格納。
- Produces: 全テーマで、幅 1000px 以上のとき、サイドバー・パネルが出る。

- [ ] **Step 1: 失敗するテストを足し、前提が変わった古いテストを直す**

`tests/shell.test.js` で、次の 2 つを直す。
1. `wide_does_not_change_other_themes` のテスト全体を、削除する（他のテーマも横画面版になるため、前提が逆になる）。
2. `narrow_ios_keeps_the_top_sheet_and_other_themes_keep_it_at_any_width` の、後半（`await withPage({ toeic_app_theme: 'ink' }, async page => { … });` の部分）を削除し、テスト名を `narrow_keeps_the_top_sheet` にする。

そのうえで、`// === TESTS-INSERT-POINT` の行の上に足す。

```js
forThemes('wide_has_a_left_sidebar_and_a_right_filter_panel', async page => {
  const nav = await rect(page, '.top-page-nav');
  assert(nav.left < 30 && nav.width >= 200 && nav.width <= 260, `サイドバーになっていない: ${JSON.stringify(nav)}`);
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.top-page-tab')].map(t => Math.round(t.getBoundingClientRect().top)));
  assert(tabs.every((t, i) => i === 0 || t > tabs[i - 1]), 'タブが縦に並んでいない');
  assert.strictEqual(await visible(page, PANEL), true, '最初からパネルが開いていない');
  const panel = await rect(page, PANEL);
  const practice = await rect(page, '#practice-page');
  assert(panel.left >= practice.right - 1, 'パネルが本文の右にない');
  assert(Math.abs(panel.width - 380) <= 1, `パネルの幅が 380px でない: ${panel.width}`);
  assert(practice.left >= nav.right - 1 && practice.width <= 641, `本文が重なっているか、広すぎる: ${JSON.stringify(practice)}`);
  assert.strictEqual(await style(page, '#app', 'paddingBottom'), '0px');
});

forThemes('wide_panel_toggle_is_remembered', async page => {
  await click(page, '#filter-toggle');
  assert.strictEqual(await visible(page, PANEL), false, 'ボタンでパネルが閉じない');
  assert.strictEqual(await pref(page), 'closed');
  await page.reload();
  assert.strictEqual(await visible(page, PANEL), false, '再読み込みで開き直した');
});

forThemes('wide_sidebar_ignores_a_saved_stowed_state', async page => {
  await page.evaluate(() => { localStorage.setItem('toeic_nav_stowed', '1'); });
  await page.reload();
  const nav = await rect(page, '.top-page-nav');
  assert(nav.left < 30 && nav.width > 200, `サイドバーが隠れている: ${JSON.stringify(nav)}`);
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'visible');
  assert.strictEqual(await style(page, '.shell-grabber-bottom', 'display'), 'none');
});

test('boundary_999_is_the_bottom_bar_and_1000_is_the_sidebar_in_every_theme', async () => {
  for (const theme of THEMES) {
    await withPage({ toeic_app_theme: theme }, async page => {
      assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'absolute', `${theme}: 999px は下のバー`);
    }, { width: 999, height: 800 });
    await withPage({ toeic_app_theme: theme }, async page => {
      assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static', `${theme}: 1000px はサイドバー`);
    }, { width: 1000, height: 800 });
  }
});

forThemes('wide_filter_panel_is_adopted_from_the_nudge_and_keys_still_work', async page => {
  await page.evaluate(() => openFilterSheetFromNudge());
  await page.waitForTimeout(200);
  assert.strictEqual(await visible(page, PANEL), true);
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  assert.strictEqual(await hasClass(page, '#practice-page', 'has-feedback'), true, '数字キーで答えられない');
});
```

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node tests/shell.test.js 2>&1 | grep -E "^FAIL|tests passed" | head -40`
Expected: iOS 以外の 7 テーマの `wide_*` が FAIL（サイドバーになっていない、パネルが開いていない）。`[ios]` は PASS。`boundary_999…` は、`ink` などの 1000px で FAIL。

- [ ] **Step 2: 横画面のブロックを全テーマ向けにする**

```bash
cd /Users/reiji/myapps/toeic_practice
python3 - <<'EOF'
from pathlib import Path
p = Path('css/shell.css'); s = p.read_text(encoding='utf-8')
s = s.replace('[data-theme="ios"]', '[data-theme]')

# パネル: 枠と、控えめな影を足す（iOS は theme-ios.css で枠なし・ガラスの影に上書きする）
old = "    border-radius: 24px;\n    border-bottom: none !important;\n    transition: none;\n  }"
assert old in s
s = s.replace(old, "    border-radius: 24px;\n    border: 1px solid var(--top-sheet-border);\n    border-bottom: 1px solid var(--top-sheet-border) !important; /* 元の .top-sheet の border-bottom: 2px !important を打ち消す */\n    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);\n    transition: none;\n  }")
p.write_text(s, encoding='utf-8')

q = Path('css/theme-ios.css'); t = q.read_text(encoding='utf-8')
t = t.rstrip() + '''

/* === 横画面（幅 1000px 以上）: 右の絞り込みパネルは、iOS では枠なし（ガラスの影は上の .top-sheet の指定） === */
@media (min-width: 1000px) {
  [data-theme="ios"] .top-sheet { border: none; border-bottom: none !important; }
}
'''
q.write_text(t, encoding='utf-8')
EOF
grep -n 'data-theme="ios"' css/shell.css | head -3 || true
```

Expected: shell.css に `[data-theme="ios"]` は残らない（`grep` の出力が空）。

`js/wide-layout.js` から「iOS のときだけ」を外す。次の 3 か所を Edit で直す。

1. 先頭のコメントの 2 行目 `// 見た目の配置は css/shell.css 側。他のテーマと狭い画面では何もしない。` を `// 見た目の配置は css/shell.css 側。幅 1000px 未満では何もしない。全テーマで動く。` に。
2. 次の 2 行を、
```js
  const isIos = () => document.documentElement.getAttribute('data-theme') === 'ios';
  const active = () => isIos() && wide.matches;
```
次の 1 行にする。
```js
  const active = () => wide.matches;
```
3. 次の 1 行（テーマの監視）を削除する。
```js
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
```

- [ ] **Step 3: テストが通ることを確かめる**

```bash
cd /Users/reiji/myapps/toeic_practice
NODE_PATH=$(npm root -g) node tests/shell.test.js 2>&1 | grep -E "^FAIL|tests passed|^     [^ ]" | head -30
```

Expected: 全件 passed。失敗したときは、メッセージから原因を調べる（詳細度の負け、読み込み順など）。

- [ ] **Step 4: 全テーマを目で確かめる**

`preview_start` の `toeic-nocache` を開き、`resize_window` で幅 1280・高さ 800 にして、`/?theme=<テーマ>#practice` を 8 テーマ分開き、スクリーンショットを撮る。確認すること: サイドバーと右のパネルが各テーマの色になっている、パネルの文字が読める、ホームの二列が崩れていない（ホームは `switchAppPage('home')` で開く）。見た目の問題は、その場で直す。終わったら `resize_window` の `desktop` で戻す。

- [ ] **Step 5: コミット**

```bash
cd /Users/reiji/myapps/toeic_practice
export NODE_PATH=$(npm root -g)
python3 -m pytest tests -q | tail -1
for t in shell practice-chrome sheets; do echo "$t: $(node tests/$t.test.js | tail -1)"; done
git add -A css js tests
git commit -m "feat: landscape layout (sidebar + filter panel) for every theme

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 仕上げ（他のテストと検証用スクリプトの追従、最終確認）

**Files:**
- Modify: 必要になったテスト・CSS（Task 2・3 の確認で見つかったもの）、`$SCRATCH/ios-isolation.cjs`（リポジトリ外）

- [ ] **Step 1: 検証用スクリプトを新しい仕様に合わせる**

`$SCRATCH/ios-isolation.cjs` を開き、次を直す。
- クラス名・キーを新しい名前にする（`ios-nav-stowed` → `nav-stowed`、`ios-top-stowed` → `top-stowed`、`.ios-grabber` → `.shell-grabber`、`toeic_ios_nav_stowed` → `toeic_nav_stowed`、`toeic_ios_top_stowed` → `toeic_top_stowed`）。
- D3 / D4 の「ink では格納が働かない・つまみが 0 個」という期待を、「ink でも格納が働き、つまみは 3 個」に直す（D5 の「iOS に戻す」も、新しい仕様では、テーマを切り替えても格納の状態が保たれる、に直す）。

Run: `cd /Users/reiji/myapps/toeic_practice && NODE_PATH=$(npm root -g) node $SCRATCH/ios-isolation.cjs 2>&1 | grep -E "FAIL|checks"`
Expected: `0 failed`。A（theme-ios.css の有無で、他テーマのスタイルが同一）と B（テーマの往復）は、iOS の CSS が iOS だけに限られていることの確認として、そのまま通る。通らないときは、theme-ios.css に残ったテーマ共通の指定がないかを調べて直す。

- [ ] **Step 2: 全テストを実行する**

```bash
cd /Users/reiji/myapps/toeic_practice
export NODE_PATH=$(npm root -g)
python3 -m pytest tests -q | tail -2
for t in shell practice-chrome sheets review-pace-fixes grammar-seen backup-extras live-timer; do echo "$t: $(node tests/$t.test.js | tail -1)"; done
node tests/pomeranian-animation.test.js 2>&1 | grep -E "ℹ (pass|fail)"
```

Expected: すべて通る。落ちるテストが、この変更のせいか、もとから不安定なもの（`feedback-banner` は変更前から 9 件失敗、`pomeranian-surfaces` は不安定）かを、`git stash` せずに、そのテストが対象にしている画面と照らして判断する。この変更のせいなら、直す。

- [ ] **Step 3: 古い名前が残っていないことと、公開待ちを確かめる**

```bash
cd /Users/reiji/myapps/toeic_practice
grep -rn "ios-nav-stowed\|ios-top-stowed\|ios-grabber\|ios-filter-panel\|ios-chrome\|ios-wide\|toeic_ios_\|theme-ios-wide" css js index.html sw.js upload.py home.js home.css README.md 2>/dev/null || echo "古い名前は残っていない"
git status --short
python3 upload.py -n | tail -12
```

Expected: `古い名前は残っていない`。公開待ちに、`css/shell.css`（新規）、`css/theme-ios.css`、`js/shell-chrome.js`（新規）、`js/wide-layout.js`（新規）、`index.html`、`sw.js`、`upload.py`、`css/theme-ios-wide.css` などの削除は出ない（`upload.py` は削除を送らない）。このプランの前の変更（パネルを広げた変更）が未公開なら、それも含まれる。

- [ ] **Step 4: ユーザーに報告する**

変更内容、確認できたこと、確認できていないこと（iPhone / iPad / Mac の実機、とくに各テーマの下のバーの見た目）を報告し、公開してよいかを聞く。公開は、ユーザーの返事があってから行う。
