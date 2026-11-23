# レーダーの専用ページ 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-subagent-driven-development (recommended) or sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レーダーチャートを文法グラフの画面から切り離し、グラフ本体と力学を読まずに開ける専用ページ `radar` にして、ホームと復習から行けるようにする。

**Architecture:** 詳細シートを共通の部品 `js/graph-sheet.js`（`GraphSheet`）に切り出し、グラフ（`GraphView`）とレーダー（新しい `RadarView`）の両方から使う。
レーダーの描画コードは `js/graph-view.js` から `js/radar-view.js` へ移し、グラフにはモードを 2 つだけ残す。`home.js` がページ `radar` を作り、開いたときだけ必要なファイルを差し込む。

**Tech Stack:** 素の JS（ビルドなし、グローバル共有の `<script>`）、SVG、Playwright + `node:test`。

**Spec:** `docs/superpowers/specs/2026-11-23-radar-page-design.md`

## Global Constraints

- 起動時のリクエスト数を増やさない（`tests/graph-entry.test.js` の `STARTUP_REQUESTS_BASELINE = 53` のまま）。新しいファイルは `index.html` に書かない。
- 新しいファイルは `sw.js` の `ASSETS` に足し、`CACHE` を `'toeic-drill-v23'` にする（`tests/test_file_lists.py` が一覧の食い違いを見る）。
- 学習記録・バックアップ・同期・別タブ反映の形式と対象を変えない。新しい保存キーを作らない（`RECORD_KEYS` / `EXTRA_KEYS` / `CROSS_TAB_KEYS` に触れない）。
- レーダーのページは `requestAnimationFrame` もタイマーも呼ばない。
- グラフは、力学が収まった後と移動のアニメーションの後は描かない（CLAUDE.md の約束 12）。
- テーマの演習は今の仕組みのまま（`state.nearDrill`・`toeic_near_drill_v1`・`kind: 'theme'`、CLAUDE.md の約束 11）。
- コメント・文書は日本語。コミットメッセージは英語で `feat:` / `fix:` / `docs:` / `refactor:` の形。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- push しない。

## Review Focus

1. **教材で絞った状態でシートを開いたまま教材を変える** → シートの中身がその教材の分に描き直され、0 問になったら閉じる（今のレーダーと同じ）。Task 2 のテスト「教材フィルタと詳細シート…」で確かめる。
2. **記録の読み込み直し（同期・別タブ）でレーダーのページが開いている** → 数字が更新され、開いているシートも描き直される。Task 4 のテスト「記録が読み込み直されると、開いているレーダーが更新される」。
3. **テーマの演習を解き終えて戻る** → レーダーのページに戻り、通常の出題の続きは書き換わっていない。近い問題（グラフから）は今までどおりグラフへ戻る。Task 4 のテスト（`tests/graph-drill.test.js`）。
4. **`toeic_graph_mode_v1` に `radar` が残った端末でグラフを開く** → 教材軸で開き、例外を出さない。Task 3 のテスト。
5. **レーダーのページとグラフのページを行き来する（レーダー → 問題タップでグラフ → 戻る → レーダー）** → 共通のファイルを二度差し込まず、リスナーも DOM も残らない。Task 4 のテスト。

---

### Task 1: 詳細シートを共通の部品 `GraphSheet` に切り出す（グラフの動きは変えない）

**Files:**
- Create: `js/graph-sheet.js`
- Modify: `js/graph-view.js`（シートの DOM・`renderSheet` の HTML 組み立て・高さ・ドラッグ・`onSheetClick`・Esc / Enter の処理を `GraphSheet` に置き換える）
- Modify: `home.js:1391-1400`（`GRAPH_SCRIPTS` の `js/graph-view.js` の前に `js/graph-sheet.js`）
- Modify: `sw.js`（`ASSETS` に `js/graph-sheet.js`）
- Test: `tests/graph-view.test.js`（テスト用ページに `<script src="/js/graph-sheet.js">` を足す。テストの中身は変えない）、`tests/graph-entry.test.js`（`GRAPH_FILES` に `js/graph-sheet.js`）

**Interfaces:**
- Produces: `window.GraphSheet.create(parent, opts)` →
  `{ el, render(content), open(), close(), isOpen(), contains(node) }`
  - `opts = { on(target, type, fn, o), S, getSheetHeight?, setSheetHeight?, questionNode(qid) → number(-1 なら移動先なし), onQuestion(node), onDrill(pick), onClose() }`
  - `content = { kindText, title, detail /* buildDetail の戻り値 */, correct, picks: [{ key, text, sub?, ids, label, kind }] }`
  - `render` は中身だけ描き直す（スクロール位置はそのまま）。`open` はスクロールを先頭に戻し、閉じていたら覚えた高さで開いてフォーカスする。
  - `close` は閉じていれば何もしない。閉じたら `opts.onClose()` を呼ぶ。Esc（document）・×・下へはじく、のどれでも `close` を通る。
  - シートの中の `.graph-q[data-node]` のクリックと Enter / Space で `opts.onQuestion(node)`、`.graph-drill-btn` で `opts.onDrill(pick)`。

- [ ] **Step 1: テスト用ページと一覧を先に直す（失敗を確かめる）**

`tests/graph-view.test.js` の `testPage` で `<script src="/js/graph-view.js">` の直前に `<script src="/js/graph-sheet.js"></script>` を足す。
`tests/graph-entry.test.js` の `GRAPH_FILES` で `'js/graph-view.js'` の直前に `'js/graph-sheet.js'` を足す。

Run: `node tools/run_tests.mjs graph-entry`
Expected: FAIL（`js/graph-sheet.js` が読み込まれない／存在しない）

- [ ] **Step 2: `js/graph-sheet.js` を書く**

```js
// 文法グラフ・レーダーの詳細シート（下から出るパネル）。window.GraphSheet を 1 つだけ公開する。
// 中身（buildDetail の結果）の HTML 化、高さ（つまみ・見出しのドラッグ、広げる・縮める、覚えた高さ）、閉じる（×・Esc・下へはじく）、
// 問題一覧のタップ、出題ボタンを受け持つ。リスナーは opts.on で登録する（呼び出し側が数えて、destroy でまとめて外す）。
(function (root) {
  'use strict';
  const SHEET_DEFAULT_RATIO = 0.42; // 「縮める」で戻す高さ（CSS の既定の max-height と同じ）
  const SHEET_WIDE_RATIO = 0.72;    // 「広げる」の高さ
  const SHEET_WIDE_FROM = 0.6;      // これ以上の高さなら、ボタンを「縮める」にする
  const SHEET_MIN_BODY_PX = 64;     // つまみで下げても、見出しの下にこれだけは本文を残す
  const STATUS_LABEL = { weak: '苦手', overcome: '克服', unseen: '未解答', correct: '正解' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // エスケープ済みの文字列の **太字** だけを <strong> にする（エスケープの後なので安全）。残った ** は消す
  function richText(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*\*/g, '');
  }

  function create(parent, opts) {
    const S = opts.S || {};
    const el = document.createElement('section');
    el.className = 'graph-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'graph-sheet-title');
    el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML =
      '<div class="graph-sheet-grab" title="上下に動かして高さを変える"><span></span></div>' +
      '<header class="graph-sheet-head">' +
        '<div class="graph-sheet-titles"><span class="graph-sheet-kind"></span><h2 class="graph-sheet-title" id="graph-sheet-title"></h2></div>' +
        '<button type="button" class="graph-sheet-expand" aria-pressed="false">広げる</button>' +
        '<button type="button" class="graph-sheet-close" aria-label="閉じる">×</button>' +
      '</header>' +
      '<div class="graph-sheet-body"></div>';
    parent.appendChild(el);
    const kindEl = el.querySelector('.graph-sheet-kind');
    const titleEl = el.querySelector('.graph-sheet-title');
    const body = el.querySelector('.graph-sheet-body');
    const expandBtn = el.querySelector('.graph-sheet-expand');
    let picks = null;   // { key: pick }（押したときにそのまま渡す）
    let wide = false;
    let ratio = null;   // 容器に対する割合。null なら既定（中身の高さ、最大は CSS の 42%）
    let drag = null;    // つまみ・見出しを動かしている間だけ { id, y0, start, box, lastY, lastT, v }

    function render(c) {
      const d = c.detail;
      kindEl.textContent = c.kindText;
      titleEl.textContent = c.title;
      const pct = d.answered > 0 ? Math.round((100 * c.correct) / d.answered) + '%' : '—';
      let html =
        '<dl class="graph-stats">' +
          `<div><dt>状態</dt><dd>${esc(d.stateLabel)}</dd></div>` +
          `<div><dt>正答率</dt><dd>${esc(pct)}</dd></div>` +
          `<div><dt>解答数</dt><dd>${esc(d.answered)}</dd></div>` +
          `<div><dt>苦手</dt><dd>${esc(d.weakCount)}</dd></div>` +
        '</dl>';
      if (d.desc) html += `<p class="graph-desc">${richText(d.desc)}</p>`;
      if (d.advice) html += `<p class="graph-advice"><span class="graph-advice-label">対策</span>${richText(d.advice)}</p>`;
      picks = null;
      const list = Array.isArray(c.picks) ? c.picks.filter(p => p && p.ids && p.ids.length > 0) : [];
      if (list.length > 0) {
        picks = {};
        const btns = list.map(p => {
          picks[p.key] = p;
          return `<button type="button" class="graph-drill-btn${p.sub ? ' is-sub' : ''}" data-drill="${esc(p.key)}">${esc(p.text)}</button>`;
        }).join('');
        html += list.length > 1 ? `<div class="graph-drill-btns">${btns}</div>` : btns;
      }
      const total = d.questions.length + (d.moreCount || 0);
      html += `<h3 class="graph-qs-head">問題（${esc(total)}）</h3><ul class="graph-qs">`;
      for (const q of d.questions) {
        const node = typeof opts.questionNode === 'function' ? opts.questionNode(q.qid) : -1;
        html += `<li class="graph-q graph-q-${esc(q.status)}"${node >= 0 ? ` data-node="${node}" role="button" tabindex="0"` : ''}><span class="graph-q-status">${esc(STATUS_LABEL[q.status] || q.status)}</span>` +
          `<span class="graph-q-no">#${esc(q.qid)}</span><span class="graph-q-text">${q.text == null ? '' : esc(q.text)}</span></li>`;
      }
      html += '</ul>';
      if (d.moreCount) html += `<p class="graph-more">ほか ${esc(d.moreCount)} 問</p>`;
      body.innerHTML = html;
    }
    // （applyRatio / remember / saved / setWide / onPointerDown / dragResult / onPointerMove / onPointerUp は
    //   js/graph-view.js の applySheetRatio / rememberSheetRatio / savedSheetRatio / setSheetWide / onSheetPointerDown /
    //   sheetDragResult / onSheetPointerMove / onSheetPointerUp をそのまま移し、sheet → el、sheetExpand → expandBtn、
    //   sheetRatio → ratio、sheetWide → wide、sheetDrag → drag、deps → opts、closeSheet() → close() に読み替える）
    function open() {
      body.scrollTop = 0;
      if (el.hidden) applyRatio(saved()); // 開くときは覚えた高さで（開いたまま別の項目に移るときは今の高さのまま）
      el.hidden = false;
      try { el.focus({ preventScroll: true }); } catch (e) { /* 古いブラウザ */ }
    }
    function close() {
      if (el.hidden) return;
      el.hidden = true;
      picks = null;
      drag = null;
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    function onClick(e) {
      if (e.target.closest('.graph-sheet-close')) { close(); return; }
      if (e.target.closest('.graph-sheet-expand')) { setWide(!wide); return; }
      const b = e.target.closest('.graph-drill-btn');
      if (b) {
        const p = picks && picks[b.dataset.drill];
        if (p && typeof opts.onDrill === 'function') opts.onDrill({ ids: p.ids.slice(), label: p.label, kind: p.kind }); // 呼び出し側が画面を切り替える（この後 destroy されうる）
        return;
      }
      const li = e.target.closest('.graph-q[data-node]');
      if (li && typeof opts.onQuestion === 'function') opts.onQuestion(Number(li.dataset.node));
    }
    function onKey(e) {
      if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.closest) return;
      const li = e.target.closest('.graph-q[data-node]');
      if (!li) return;
      e.preventDefault();
      if (typeof opts.onQuestion === 'function') opts.onQuestion(Number(li.dataset.node));
    }
    function onDocKey(e) {
      if (e.key === 'Escape' && !el.hidden) { e.preventDefault(); close(); }
    }
    opts.on(el, 'click', onClick);
    opts.on(el, 'keydown', onKey);
    opts.on(el, 'pointerdown', onPointerDown);
    opts.on(el, 'pointermove', onPointerMove);
    opts.on(el, 'pointerup', e => onPointerUp(e, false));
    opts.on(el, 'pointercancel', e => onPointerUp(e, true));
    opts.on(document, 'keydown', onDocKey);
    return { el, render, open, close, isOpen: () => !el.hidden, contains: node => el.contains(node) };
  }

  root.GraphSheet = { create };
})(typeof self !== 'undefined' ? self : this);
```

（コメントで「そのまま移す」と書いた 8 関数は、`js/graph-view.js:1153-1211` の本文を、上の読み替えだけで写す。実装のときはコメントではなく本文を書く。）

- [ ] **Step 3: `js/graph-view.js` をシートの部品に切り替える**

1. `rootEl.innerHTML` から `<section class="graph-sheet" …>…</section>` を消す。`sheet` / `sheetKind` / `sheetTitle` / `sheetBody` / `sheetExpand` と、`SHEET_*`・`STATUS_LABEL`・`richText`・`sheetWide` / `sheetRatio` / `sheetDrag` / `sheetPicks` を消す。
2. `const ctx = …` の直前でシートを作る:
   ```js
   const sheetUI = root.GraphSheet.create(rootEl, {
     on, S,
     getSheetHeight: deps.getSheetHeight, setSheetHeight: deps.setSheetHeight,
     questionNode: qid => (qidNode.has(qid) ? qidNode.get(qid) : -1),
     onQuestion: node => (mode === 'radar' ? jumpFromRadar(node) : jumpTo(node)),
     onDrill: p => { if (typeof deps.onStartDrill === 'function') deps.onStartDrill(p.ids, p.label, { kind: p.kind }); },
     onClose: () => { sheetIndex = -1; clearFocus(); syncRadarSelection(); },
   });
   const sheet = sheetUI.el;
   ```
   `createInstance` の先頭の存在確認に `typeof root.GraphSheet === 'undefined'` のとき投げるエラーを足す（メッセージに `js/graph-sheet.js` を含める）。
3. `renderSheet(i)` は、`buildDetail` と「教材で絞って 0 問なら false」の判定と出題の選び（`picks` の配列）だけを作り、`sheetUI.render({ kindText, title: d.title, detail: d, correct, picks })` を呼んで `true` を返す。
   picks はレーダーのとき `[{ key: 'all', text: \`このテーマの全 ${n} 問を解く\`, ids, label, kind: 'theme' }, { key: 'rest', text: \`苦手と未着手の ${m} 問を解く\`, sub: true, … }]`（rest は今と同じ条件のときだけ）、それ以外は `pickNear` が 1 問以上なら `[{ key: 'near', text: \`近い問題を ${k} 問解く\`, ids, label: d.title, kind: 'near' }]`。`onStartDrill` がなければ空配列。
4. `openSheet(i)`: `if (!renderSheet(i)) return; sheetIndex = i; debug.lastTap = i; sheetUI.open(); if (mode === 'radar') syncRadarSelection(); else setFocus(i);`
5. `closeSheet()` は `sheetUI.close()` だけにする（後始末は `onClose`）。
6. `onSheetClick`・`onSheetPointer*`・シートの `on(sheet, …)` 6 行を消す。`onKeyDown` から Esc の分岐と `sheet.contains(e.target)` の分岐を消し、先頭に `if (sheetUI.contains(e.target)) return;` を置く（レーダーの軸の Enter はそのまま残す）。
7. 他の場所で `sheet.hidden` を見ている所（`onRadarClick` の最後、キャンバスのタップ処理など）は `sheetUI.isOpen()` に置き換える。`rg -n "sheet\\.hidden|sheetBody|sheetExpand|sheetPicks|sheetWide|sheetRatio" js/graph-view.js` が 0 件になること。

- [ ] **Step 4: `GRAPH_SCRIPTS`・`ASSETS` に足す**

`home.js` の `GRAPH_SCRIPTS` で `'js/graph-view.js'` の直前に `'js/graph-sheet.js'`。`sw.js` の `ASSETS` で `'js/graph-view.js'` の直前に `'js/graph-sheet.js'`（`CACHE` はまだ上げない。Task 4 でまとめて上げる）。

- [ ] **Step 5: テストを流す**

Run: `node tools/run_tests.mjs graph --no-retry` と `node tools/run_tests.mjs --fast`
Expected: すべて PASS（グラフの動き・シートの高さ・出題ボタン・レーダーのテストを含めて、今までのテストが変更なしで通る）

- [ ] **Step 6: コミット**

```bash
git add js/graph-sheet.js js/graph-view.js home.js sw.js tests/graph-view.test.js tests/graph-entry.test.js
git commit -m "refactor: move the graph detail sheet into a shared GraphSheet component"
```

---

### Task 2: レーダーの部品 `RadarView` を作る

**Files:**
- Create: `js/radar-view.js`
- Create: `tests/radar-view.test.js`
- Modify: `tests/unit/graph-report.test.js`（並び順のテストを 1 つ足す）

**Interfaces:**
- Consumes: `GraphSheet.create`（Task 1）、`StudyCore.computeMastery`（`src/mastery.js`）、`buildDetail`（`src/graph-detail.js`）、`computeGraphReport` / `computeRadarGeometry` / `sortReportItems` / `DEFAULT_CONCEPT_ORDER`（`src/graph-report.js`）、`resolveSheetDrag`（`src/sheet-size.js`）
- Produces: `window.RadarView = { mount(container, deps), refresh(), destroy(), _debug }`
  - `deps = { graph, getStats, getWeak, getQuestion, isDue, onStartDrill?(ids, label, opts), onOpenQuestion?(node), getSheetHeight?, setSheetHeight? }`
  - `_debug = { listeners, book, weakOnly, compact, lastTap, mounted }`（`mount` ごとに `book: 'all'`・`weakOnly: false`・`compact: false`・`lastTap: -1` に戻す）

- [ ] **Step 1: 並び順の単体テストを書く**

`tests/unit/graph-report.test.js` の末尾に足す:

```js
test('レーダーのページは graph-force.js を読まないので、既定の並び順が文法軸の並び順と同じであること', () => {
  const GF = require('../../src/graph-force.js');
  assert.deepStrictEqual(R.DEFAULT_CONCEPT_ORDER, GF.GRAMMAR_CONCEPT_ORDER);
});
```
（`R` はこのファイルで `src/graph-report.js` を読んでいる変数名に合わせる。）

Run: `node tools/run_tests.mjs graph-report`
Expected: PASS（今は同じ並び。将来どちらかを変えたら落ちて気づける）

- [ ] **Step 2: `tests/radar-view.test.js` を書く（失敗を確かめる）**

`tests/graph-view.test.js` の土台（サーバー・`open`・`waitFor`・`COUNT_SCRIPT`）を写し、テスト用ページは次のファイルだけを読む:
`/css/graph.css`・`/data/grammar_graph.js`・`/src/mastery.js`・`/src/graph-detail.js`・`/src/graph-report.js`・`/src/sheet-size.js`・`/js/graph-sheet.js`・`/js/radar-view.js`。
`window.__deps()` は graph-view のテストと同じ形に `onOpenQuestion: n => window.__opened.push(n)` を足し、`window.__mount = () => RadarView.mount(document.getElementById('host'), window.__deps())`。
`const ready = page => waitFor(page, () => !!document.querySelector('#host .graph-radar-svg'));`

`tests/graph-view.test.js` から次のテストを移し、置き換えは「`GraphView.mount(…deps)`（`initialMode = 'radar'`）→ `RadarView.mount(…deps)`」「モードボタンのクリックと `GraphView._debug.mode` の確認を消す」「`GraphView._debug.radarCompact` → `RadarView._debug.compact`」「`GraphView.refresh()` → `RadarView.refresh()`」「`settled(page)` → `ready(page)`」だけにする:
- 1395「出題ボタン: テーマの全問と、苦手と未着手…」
- 1442「出題ボタン: 全問を正解済みなら…教材で絞ると…」
- 1479「横棒: 正解・克服・苦手・未着手の色分け…」
- 1867「切り替えで SVG レーダー(13軸)と横棒…」→ 題名を「開くと SVG レーダー(13軸)と横棒グラフが出て rAF・タイマーは 0 回、教材・苦手・カテゴリ・ソートが連動する」に。`canvasHidden` / `radarHidden` / `pressed` の確認を消し、`document.querySelector('#host canvas') === null` と `typeof GraphView === 'undefined'` を確かめる
- 1968「スマホ(375px)とPC(1280px)で横はみ出しがない」
- 1985「教材フィルタと詳細シート・0問項目・…・refresh が整合する」→ 問題ジャンプの部分（グラフの `isVisible` / `weakOnly` 解除の確認）は消し、代わりに「問題をタップすると `__opened` にその問題のノード番号が 1 つ入る」を確かめる
- 2107「1280px・375px で全軸 100% でもラベルがカード枠内…全 8 テーマでバッジコントラスト 4.5 以上」
- 2186「軸ラベルの実効文字サイズ…」
- 2227「表示中に画面幅が狭い⇔広いと変わると、詰めた配置へ描き直す」（最後の `GraphView._debug.pending` の確認は `window.__cnt.raf === 0` に置き換える）

新しく足すテスト:

```js
test('頂点・バータップで詳細シートが開き、問題をタップすると onOpenQuestion にその問題のノードが渡る', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__opened = [];
    window.__stats = { [GRAMMAR_GRAPH.qids[0]]: { a: 3, c: 1 } };
    window.__weak = { [GRAMMAR_GRAPH.qids[0]]: { due: Date.now() + 86400000 } };
    window.__mount();
  });
  await ready(page);
  await page.locator('#host .graph-bar-row').first().click();
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.locator('#host .graph-bar-row.is-active').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.locator('#host .graph-bar-row.is-active').count(), 0);
  await page.locator('#host .graph-radar-axis-btn[data-node]').first().click();
  assert.equal(await sheetOpen(page), true);
  const q = page.locator('#host .graph-q[data-node]').first();
  const node = Number(await q.getAttribute('data-node'));
  await q.click();
  const opened = await page.evaluate(() => window.__opened);
  assert.deepEqual(opened, [node]);
  assert.equal(await page.evaluate(n => GRAMMAR_GRAPH.kinds[GRAMMAR_GRAPH.kind[n]], node), 'question');
});

test('destroy: DOM とリスナーが消え、2 回呼んでも落ちない。mount/destroy を 5 回繰り返してもリスナーは増えない', async t => {
  const page = await open(t);
  const r = await page.evaluate(() => {
    const counts = [];
    for (let k = 0; k < 5; k++) {
      window.__mount();
      counts.push(RadarView._debug.listeners);
      RadarView.destroy();
    }
    RadarView.destroy();
    return { counts, left: RadarView._debug.listeners, dom: document.querySelectorAll('#host *').length };
  });
  assert.ok(r.counts[0] > 0);
  assert.deepEqual(r.counts, Array(5).fill(r.counts[0]));
  assert.equal(r.left, 0);
  assert.equal(r.dom, 0);
});

test('XSS: 問題文に HTML が入っていても、シートに挿入も実行もされない', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.__getQ = () => ({ q: '<img src=x onerror="window.__xss=1">' });
    window.__mount();
  });
  await ready(page);
  await page.locator('#host .graph-bar-row').first().click();
  assert.equal(await page.locator('#host .graph-sheet img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});
```

Run: `node tools/run_tests.mjs radar-view --no-retry`
Expected: FAIL（`js/radar-view.js` がまだない）

- [ ] **Step 3: `js/radar-view.js` を書く**

骨組み:

```js
// レーダーのページ（SVG と HTML だけ。Canvas・力学なし）。window.RadarView を 1 つだけ公開し、アプリの state には触れない。
// 必要なものは mount(container, deps) の deps で受け取る:
//   deps = { graph, getStats, getWeak, getQuestion, isDue, onStartDrill?(ids, label, opts), onOpenQuestion?(node), getSheetHeight?, setSheetHeight? }
//   onOpenQuestion: シートの問題をタップしたとき。グラフのページを開いて、その問題へ移動する（home.js）
// 軽さの約束: requestAnimationFrame もタイマーも使わない。描き直すのは入力・refresh・幅の区分が変わったときだけ。
(function (root) {
  'use strict';
  const BOOKS = [['all', 'すべて'], ['kin', '金'], ['sekai', '世界一'], ['polaris2', 'ポラリス2'], ['toplevel', 'トップレベル']];
  const BOOK_NAMES = { all: '全教材', kin: '金の文法', sekai: '世界一', polaris2: 'ポラリス2', toplevel: 'トップレベル' };
  const REPORT_STATE_LABELS = { unseen: '未着手', due: '要復習', weak: '苦手', few: '練習不足', mid: 'もう少し', good: '定着' };
  const BAR_SEGMENTS = [['neverMissed', 'is-correct', '正解'], ['overcome', 'is-overcome', '克服'], ['weak', 'is-weak', '苦手'], ['untouched', 'is-unseen', '未着手']];
  const RADAR_COMPACT_BELOW_PX = 385; // SVG の枠の幅がこれ未満なら詰めた配置（12 × 385 ÷ 420 = 11.0px を保つ最小の幅）
  const debug = { listeners: 0, book: 'all', weakOnly: false, compact: false, lastTap: -1, mounted: false };
  let inst = null;
  function esc(s) { /* graph-view.js と同じ */ }
  function safeObj(fn) { /* graph-view.js と同じ */ }

  function createInstance(container, deps) {
    const S = root.StudyCore;
    if (!S || typeof S.computeMastery !== 'function' || typeof S.buildDetail !== 'function' || typeof S.computeGraphReport !== 'function' || typeof S.computeRadarGeometry !== 'function' || typeof root.GraphSheet === 'undefined') {
      throw new Error('RadarView: src/mastery.js・graph-detail.js・graph-report.js・js/graph-sheet.js が読み込まれていない');
    }
    if (!container || !deps || !deps.graph) throw new Error('RadarView.mount: container と deps.graph が必要');
    const graph = deps.graph;
    const n = graph.id.length;
    const kinds = graph.kinds || ['book', 'chapter', 'rule', 'concept', 'trap', 'question'];
    const kBook = kinds.indexOf('book'), kQuestion = kinds.indexOf('question');
    const qidNode = new Map(); // 問題 id → ノード添字（graph-filter.js の buildIndex を読まずに作る）
    for (let i = 0; i < n; i++) if (graph.kind[i] === kQuestion && graph.qid && graph.qid[i] != null) qidNode.set(graph.qid[i], i);
    const conceptOrder = S.GRAMMAR_CONCEPT_ORDER || S.DEFAULT_CONCEPT_ORDER;
    let alive = true;
    let book = 'all', weakOnly = false;
    let category = 'concept', sort = 'default', showCoverage = true, compact = false;
    let stats = {}, weak = {}, mastery = null;
    let sheetIndex = -1;
    const subs = [];
    function on(target, type, fn, o) { target.addEventListener(type, fn, o); debug.listeners++; subs.push(() => { target.removeEventListener(type, fn, o); debug.listeners--; }); }
    function track(off) { debug.listeners++; subs.push(() => { off(); debug.listeners--; }); }

    const rootEl = document.createElement('div');
    rootEl.className = 'graph-view radar-view';
    rootEl.innerHTML =
      '<div class="graph-filter" role="toolbar" aria-label="レーダーの絞り込み">' +
        '<div class="graph-chips" role="group" aria-label="教材">' +
          BOOKS.map(([id, name]) => `<button type="button" class="graph-chip" data-book="${id}" aria-pressed="${id === 'all'}">${esc(name)}</button>`).join('') +
        '</div>' +
        '<button type="button" class="graph-weak-toggle" aria-pressed="false">苦手のみ</button>' +
      '</div>' +
      '<div class="graph-stage">' +
        '<div class="graph-radar-panel" aria-label="レーダーチャートと項目別スコア"></div>' +
      '</div>';
    try {
      container.appendChild(rootEl);
      const filterEl = rootEl.querySelector('.graph-filter');
      const panel = rootEl.querySelector('.graph-radar-panel');
      const sheetUI = root.GraphSheet.create(rootEl, {
        on, S,
        getSheetHeight: deps.getSheetHeight, setSheetHeight: deps.setSheetHeight,
        questionNode: qid => (qidNode.has(qid) ? qidNode.get(qid) : -1),
        onQuestion: node => { if (typeof deps.onOpenQuestion === 'function') deps.onOpenQuestion(node); }, // 呼び出し側が画面を切り替える（この後 destroy されうる）
        onDrill: p => { if (typeof deps.onStartDrill === 'function') deps.onStartDrill(p.ids, p.label, { kind: p.kind }); },
        onClose: () => { sheetIndex = -1; syncSelection(); },
      });
      function recompute() {
        stats = safeObj(deps.getStats);
        weak = safeObj(deps.getWeak);
        mastery = S.computeMastery(graph, stats, weak, deps.isDue);
      }
      // （pctText / wantCompact / renderReport は js/graph-view.js の pctText / wantRadarCompact / renderRadarReport を移す。
      //   読み替え: radarPanel → panel、radarCategory → category、radarSort → sort、radarShowCoverage → showCoverage、
      //   radarCompact → compact、debug.radarCompact → debug.compact、S.GRAMMAR_CONCEPT_ORDER → conceptOrder）
      // （renderSheet は graph-view.js の renderSheet のレーダーの分岐だけを移す。sheetBook = book !== 'all' ? book : null、
      //   picks は「テーマの全 N 問」と「苦手と未着手の M 問」（onStartDrill がなければ空）。isBookFiltered で 0 問なら false）
      function syncSelection() {
        panel.querySelectorAll('[data-node]').forEach(el => {
          const active = Number(el.dataset.node) === sheetIndex;
          el.classList.toggle('is-active', active);
          if (el.classList.contains('graph-bar-row')) el.setAttribute('aria-pressed', String(active));
        });
      }
      function openSheet(i) {
        if (!renderSheet(i)) return;
        sheetIndex = i;
        debug.lastTap = i;
        sheetUI.open();
        syncSelection();
      }
      // （onFilterClick: graph-view.js の onFilterClick からモードボタンの分岐を消し、radar の分岐だけ残す。
      //   onPanelClick: onRadarClick を移し、最後の sheet.hidden を !sheetUI.isOpen() に。
      //   onKeyDown: graph-view.js の onKeyDown のレーダーの軸の Enter / Space の分岐だけを移す）
      on(filterEl, 'click', onFilterClick);
      on(panel, 'click', onPanelClick);
      on(document, 'keydown', onKeyDown);
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => { if (wantCompact() !== compact) renderReport(); });
        ro.observe(panel);
        track(() => ro.disconnect());
      }
      recompute();
      renderReport();
      return {
        refresh() {
          if (!alive) return;
          recompute();
          if (sheetIndex >= 0 && !renderSheet(sheetIndex)) sheetUI.close();
          renderReport();
        },
        destroy() {
          if (!alive) return;
          alive = false;
          while (subs.length) subs.pop()();
          rootEl.remove();
          mastery = null;
        },
      };
    } catch (err) {
      alive = false;
      while (subs.length) subs.pop()();
      rootEl.remove();
      throw err;
    }
  }

  function mount(container, deps) {
    if (inst) destroy();
    debug.book = 'all'; debug.weakOnly = false; debug.compact = false; debug.lastTap = -1;
    inst = createInstance(container, deps);
    debug.mounted = true;
  }
  function refresh() { if (inst) inst.refresh(); }
  function destroy() { if (!inst) return; const i = inst; inst = null; debug.mounted = false; i.destroy(); }
  root.RadarView = { mount, refresh, destroy, _debug: debug };
})(typeof self !== 'undefined' ? self : this);
```

（コメントで「移す」と書いた関数は、`js/graph-view.js` の該当箇所の本文を、書いた読み替えだけで写す。実装のときはコメントではなく本文を書く。）

`css/graph.css`: `.radar-view .graph-filter` は今のままでよい（モードボタンがないだけ）。`.graph-radar-panel` は `position: absolute; inset: 0` で `.graph-stage` を埋めるので、そのまま使える。

- [ ] **Step 4: テストを流す**

Run: `node tools/run_tests.mjs radar-view graph-report --no-retry`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/radar-view.js tests/radar-view.test.js tests/unit/graph-report.test.js
git commit -m "feat: add RadarView, a standalone radar report without the force graph"
```

---

### Task 3: グラフからレーダーのモードを外し、`initialJumpNode` を足す

**Files:**
- Modify: `js/graph-view.js`
- Test: `tests/graph-view.test.js`

**Interfaces:**
- Produces: `GraphView.mount(container, deps)` の `deps.initialJumpNode?: number` — 0 以上 `graph.id.length` 未満の整数なら、`initialMode` によらず教材軸・絞り込みなしで開き、配置が収まったら（収めなかったらすぐ）そのノードへ移動してシートを開く（今の `jumpTo` と同じ）。範囲外・整数でなければ無視する。
- `MODES` は `[['book', '教材軸'], ['grammar', '文法軸']]`。`normalizeMode` は `'grammar'` 以外を `'book'` にする。

- [ ] **Step 1: テストを直す・足す（失敗を確かめる）**

1. Task 2 で移したレーダーのテスト 9 本と、2070「シート展開中の book→radar 切替で残留 rAF…」を `tests/graph-view.test.js` から消す。
2. 1701「initialMode で初期モードを指定でき…（不正値は book 扱い）」に `initialMode: 'radar'` → `book` で開くケースを足し、モードボタンが `['book', 'grammar']` の 2 つだけであることを確かめる。
3. 足す:

```js
test('initialJumpNode: 指定した問題へ、教材軸・絞り込みなしで開き、収まったらその問題へ移動してシートを開く。範囲外は無視する', async t => {
  const page = await open(t);
  const picked = await seedWeak(page, 3);
  const target = picked[0];
  await page.evaluate(i => {
    const deps = window.__deps();
    deps.initialMode = 'grammar';
    deps.initialJumpNode = i;
    GraphView.mount(document.getElementById('host'), deps);
  }, target);
  await settled(page);
  await waitFor(page, () => GraphView._debug.animating === false && GraphView._debug.focusNode >= 0, undefined, 5000);
  const r = await page.evaluate(() => ({ mode: GraphView._debug.mode, book: GraphView._debug.book, weakOnly: GraphView._debug.weakOnly, focus: GraphView._debug.focusNode, tap: GraphView._debug.lastTap }));
  assert.deepEqual(r, { mode: 'book', book: 'all', weakOnly: false, focus: target, tap: target });
  assert.equal(await sheetOpen(page), true);

  for (const bad of [-1, 1e9, 1.5, 'x']) {
    await page.evaluate(b => { const deps = window.__deps(); deps.initialJumpNode = b; GraphView.mount(document.getElementById('host'), deps); }, bad);
    await settled(page);
    assert.equal(await sheetOpen(page), false);
  }
});
```

Run: `node tools/run_tests.mjs graph-view --no-retry`
Expected: FAIL（モードボタンが 3 つ、`initialJumpNode` が効かない）

- [ ] **Step 2: `js/graph-view.js` からレーダーを外す**

1. `MODES` と `normalizeMode` を上の形に。`REPORT_STATE_LABELS`・`BAR_SEGMENTS`・`BOOK_NAMES`（シートの教材名にだけ使っていれば一緒に）・`radarCategory` / `radarSort` / `radarShowCoverage` / `radarCompact` / `RADAR_COMPACT_BELOW_PX`・`debug.radarCompact` を消す。
2. `rootEl.innerHTML` から `.graph-radar-panel` を消し、`radarPanel`・`syncStageVisibility`・`pctText`・`wantRadarCompact`・`renderRadarReport`・`syncRadarSelection`・`jumpFromRadar`・`focusRadarControl`・`onRadarClick` と、その `on(radarPanel, …)` を消す。
3. `mode === 'radar'` / `mode !== 'radar'` の分岐をすべて消す（`requestDraw`・`onFrame`・`setMode`・`renderSheet`（`sheetBook` は常に `null`、picks は近い問題だけ）・`openSheet`・`onFilterClick`・`onKeyDown`・`onVisibility`・`onTheme`・ResizeObserver・起動・`refresh`）。`sheetUI` の `onQuestion` は `node => jumpTo(node)`、`onClose` から `syncRadarSelection()` を消す。
4. 起動の直前で:
   ```js
   const jump0 = Number.isInteger(deps.initialJumpNode) && deps.initialJumpNode >= 0 && deps.initialJumpNode < n ? deps.initialJumpNode : -1;
   if (jump0 >= 0) { mode = 'book'; debug.mode = 'book'; pendingJumpNode = jump0; }
   ```
   （`mode` を決める `let mode = normalizeMode(deps.initialMode)` とモードボタンの `aria-pressed` は、この判定を DOM を作る前に行って反映する。`pendingJumpNode` は `finishSettle` が拾う。）
5. `rg -n "radar|Radar" js/graph-view.js` がコメントの経緯以外で 0 件になること。

- [ ] **Step 3: テストを流す**

Run: `node tools/run_tests.mjs graph-view radar-view --no-retry`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add js/graph-view.js tests/graph-view.test.js
git commit -m "refactor: drop the radar mode from GraphView and add initialJumpNode"
```

---

### Task 4: ページ `radar` と入口をつなぐ

**Files:**
- Modify: `home.js`（`APP_PAGES`・読み込み・ページ作成・マウント・片付け・入口・戻る先・記録の読み込み直し・グラフの見出しの「レーダー」ボタン・`showGraphPage` の `initialJumpNode`）
- Modify: `js/grammar-drill.js:283-286`（テーマの演習の戻り先）
- Modify: `css/shell.css:85-131, 353`（`#radar-page` を `#graph-page` と同じ枠に。見出しのボタン）
- Modify: `sw.js`（`ASSETS` に `js/radar-view.js`、`CACHE = 'toeic-drill-v23'`）
- Test: `tests/graph-entry.test.js`、`tests/graph-drill.test.js`

**Interfaces:**
- Consumes: `RadarView`（Task 2）、`GraphView` の `initialJumpNode`（Task 3）
- Produces（home.js）: `RADAR_SCRIPTS`、`loadRadarAssets()`、`openRadarPage()`、`ensureRadarPage()`、`showRadarPage()`、`leaveRadarPage()`、`openGraphAtNode(node)`、`radarReturnPage`

- [ ] **Step 1: テストを書く（失敗を確かめる）**

`tests/graph-entry.test.js`:
- 先頭に `const RADAR_FILES = ['css/graph.css', 'data/grammar_graph.js', 'src/mastery.js', 'src/graph-detail.js', 'src/graph-report.js', 'js/graph-sheet.js', 'js/radar-view.js'];` と、グラフだけのファイル `const GRAPH_ONLY = GRAPH_FILES.filter(f => !RADAR_FILES.includes(f));`。
- 372 のテストを置き換える:「ホーム（文法）の文法グラフのカード: 『レーダー』でレーダーのページが開き、グラフ本体と力学のファイルは読まない。『← 戻る』でホームに戻る。『グラフ』でグラフのページが開く」。
  ネットワークのリクエストを記録し、`RADAR_FILES` がそれぞれ 1 回、`GRAPH_ONLY` が 0 回であること、`#radar-page .graph-radar-svg` があること、`location.hash === '#radar'`、`typeof GraphView === 'undefined'` を確かめる。
- 足す:「復習の『レーダーを開く』でレーダーのページが開き、戻ると復習に戻る。DOM とリスナーが残らない（`RadarView._debug.listeners === 0`、`#radar-page .graph-view` が 0 個）。3 回開いてもタグは 1 組」。
- 足す:「レーダーのシートの問題をタップするとグラフのページがその問題で開き（`GraphView._debug.focusNode` がそのノード、`mode === 'book'`）、グラフの『← 戻る』でレーダーに戻る。共通のファイルのタグは 1 つずつ」。
- 足す:「グラフのページの見出しの『レーダー』ボタンでレーダーのページが開く」。
- 足す:「記録が読み込み直されると（`reloadRecordsFromStorage`）、開いているレーダーのスコアが更新される」（322 のテストと同じ手順で、`#radar-page .graph-radar-score-num` の文字が変わることを見る）。
- 足す:「`#radar` のハッシュで開くとレーダーのページが開き、戻る先はホーム」。
- 410「モードの選択がこの端末に記憶され…」から `radar` の部分（433-440 行）を消し、代わりに「`toeic_graph_mode_v1` が `"radar"` の端末でグラフを開くと、教材軸で開き、例外を出さない」を確かめる。
- 187「オフライン: …ASSETS で取ってあるので開く」と同じ手順で、レーダーのページもオフラインで開くことを確かめる（同じテストの中に足す）。

`tests/graph-drill.test.js`:
- 118「レーダーからテーマの全問を解く…」: グラフの画面でモードを切り替える代わりに `#radar` を開き、`#radar-page` の横棒 → シートの「このテーマの全 N 問を解く」を押す。
- 172「最後まで解くと『グラフに戻る』…」はそのまま（近い問題はグラフへ戻る）。足す:「テーマの演習を最後まで解くと『レーダーに戻る』が出て、押すとレーダーのページが開き、通常の続きに戻っている」（172 と同じ手順で、出題元をレーダーのシートにする）。

Run: `node tools/run_tests.mjs graph-entry graph-drill --no-retry`
Expected: FAIL（ページ `radar` がない）

- [ ] **Step 2: `home.js` を直す**

1. `const APP_PAGES = ['home', 'practice', 'review', 'timer', 'settings', 'graph', 'radar'];`
2. 文法グラフの節に足す:
   ```js
   // レーダーのページで読むファイル（グラフ本体・力学は読まない）。共通のファイルはグラフと一度だけ読む（insertGraphAsset）
   const RADAR_SCRIPTS = ['data/grammar_graph.js', 'src/mastery.js', 'src/graph-detail.js', 'src/graph-report.js', 'js/graph-sheet.js', 'js/radar-view.js'];
   let radarAssetsPromise = null; // 失敗したら捨てて、次に開いたときにやり直す
   let radarOpenToken = 0;
   let radarReturnPage = 'home';
   let pendingGraphJumpNode = -1; // レーダーのシートの問題から開くとき、グラフの initialJumpNode に渡す
   function loadRadarAssets() {
     if (radarAssetsPromise) return radarAssetsPromise;
     const p = (async () => { for (const url of [GRAPH_STYLE, ...RADAR_SCRIPTS]) await insertGraphAsset(url); })();
     radarAssetsPromise = p;
     p.catch(() => { if (radarAssetsPromise === p) radarAssetsPromise = null; });
     return p;
   }
   function openRadarPage() { switchAppPage('radar'); }
   function openGraphAtNode(node) { pendingGraphJumpNode = node; switchAppPage('graph'); }
   ```
3. `ensureRadarPage()` / `showRadarPage()` / `leaveRadarPage()` を `ensureGraphPage` / `showGraphPage` / `leaveGraphPage` と同じ形で書く。違いは:
   id `radar-page`、`aria-label` と題名「レーダー」、見出しに `<button type="button" class="graph-page-link" data-open="graph">グラフ</button>`（押すと `switchAppPage('graph')`）、
   ホストは `.radar-host`（CSS は `.graph-host` と同じ）、読み込み中の文「レーダーを読み込んでいます…」、失敗の文「レーダーの読み込みに失敗しました（オフラインで未取得の可能性があります）」、
   読み込みは `loadRadarAssets()` だけ（力学は読まない）、マウントは:
   ```js
   RadarView.mount(host, {
     graph: GRAMMAR_GRAPH,
     getStats: () => state.grammarStats,
     getWeak: () => state.grammarWeakData,
     getQuestion: id => GRAMMAR_BY_ID.get(id),
     isDue,
     getSheetHeight: () => readSheetHeight('グラフの詳細'),
     setSheetHeight: ratio => writeSheetHeight('グラフの詳細', ratio),
     onStartDrill: (ids, label, opts) => { if (startGrammarCustomDrill(ids, label, opts && opts.kind)) switchAppPage('practice'); },
     onOpenQuestion: node => openGraphAtNode(node),
   });
   ```
   `leaveRadarPage()` は `radarOpenToken++` と `RadarView.destroy()`（定義されていれば）。
4. `ensureGraphPage()` の見出しに `<button type="button" class="graph-page-link" data-open="radar">レーダー</button>`（押すと `switchAppPage('radar')`）。
5. `showGraphPage()` のマウント: `const jump = pendingGraphJumpNode; pendingGraphJumpNode = -1;` を読み込みを待つ前に取り、`initialMode: savedMode`（`rawMode === 'grammar' ? 'grammar' : 'book'`）、`initialJumpNode: jump >= 0 ? jump : undefined`。`onModeChange` は `writeGraphMode(mode === 'grammar' ? 'grammar' : 'book')`。
6. `openGraphPage(mode)` から `radar` の分岐を消し、引数をなくす。
7. `switchAppPage`:
   - `const radarAlreadyShown = page === 'radar' && currentAppPage === 'radar' && !!document.querySelector('#radar-page .graph-radar-svg');`
   - `if (page !== 'radar') leaveRadarPage(); else if (currentAppPage !== 'radar') radarReturnPage = appPageShown && currentAppPage !== 'graph' ? currentAppPage : 'home';`
     （グラフから来たときは、グラフに戻すと行き来が終わらないのでホームにする。グラフの「← 戻る」はレーダーに戻る: グラフ側の `graphReturnPage` は今の仕組みで `'radar'` になる）
   - `if (page === 'radar') ensureRadarPage();`
   - `appEl.classList.toggle('page-radar', page === 'radar');`
   - 描画の分岐に `else if (page === 'radar') { if (!radarAlreadyShown) showRadarPage(); }`
8. 記録の読み込み直しのかぶせ: `if (currentAppPage === 'radar' && typeof RadarView !== 'undefined' && typeof RadarView.refresh === 'function') RadarView.refresh();` を足す。
9. 入口:
   - `homeGraphCardHtml` のボタンを
     `<button type="button" class="home-weak-btn solve" data-home-action="open-radar">レーダー</button><button type="button" class="home-weak-btn" data-home-action="open-graph">グラフ</button>` に。
     ホームのクリック処理で `open-graph-radar` を `open-radar` → `openRadarPage()` に、`open-graph` → `openGraphPage()` を足す。
   - `renderReviewPage` の文法グラフの欄: 説明文を「分野ごとの成績（レーダー）と、概念・ひっかけ・問題のつながり（グラフ）を見る」に、ボタンを
     `<button type="button" class="home-weak-btn solve" data-home-action="open-radar">レーダーを開く</button><button type="button" class="home-weak-btn" data-home-action="open-graph">グラフを開く</button>` に。
     復習のクリック処理に `else if (btn.dataset.homeAction === 'open-radar') openRadarPage();`。

- [ ] **Step 3: `js/grammar-drill.js` の戻り先**

解き終えたときのボタンを、テーマの演習ならレーダーへ:

```js
const backToRadar = nearDrillActive() && state.nearDrill && state.nearDrill.kind === 'theme';
// …HTML の 'グラフに戻る' を ${backToRadar ? 'レーダーに戻る' : 'グラフに戻る'} に
if (backBtn) backBtn.addEventListener('click', () => { exitNearDrill(); switchAppPage(backToRadar ? 'radar' : 'graph'); });
```
（`backToRadar` は HTML を組む前に決める。`exitNearDrill()` で `state.nearDrill` が消えるため。コメントの「グラフを開く」も直す。）

- [ ] **Step 4: `css/shell.css`**

- `:root #graph-page` の 2 か所（85-89 行、353 行の幅の広い画面）を `:root #graph-page, :root #radar-page` に。
- `:root .graph-host` の 2 行に `.radar-host` を並べる。
- 見出しのボタン: `:root .graph-page-link` を `.graph-page-back` と同じ見た目で、`margin-left: auto`（右端に寄せる）。

- [ ] **Step 5: `sw.js`**

`ASSETS` の `'js/graph-view.js'` の後に `'js/radar-view.js'`。`CACHE = 'toeic-drill-v23'`。コメントの「グラフを開いたときに」を「グラフ・レーダーを開いたときに」に。

- [ ] **Step 6: テストを流す**

Run: `node tools/run_tests.mjs graph radar labels --no-retry` と `node tools/run_tests.mjs --fast`
Expected: PASS（`test_file_lists.py` を含む）

- [ ] **Step 7: 画面で確かめる**

`toeic-nocache`（8766）で開き、375×812 と 1280×800 で: ホームの文法のカード → レーダー → 横棒 → シート → 問題 → グラフ → 戻る → レーダー → 戻る → ホーム。復習 → レーダーを開く。テーマの全問を解く → 最後まで → レーダーに戻る。コンソールにエラーがないこと。スクリーンショットを撮る。

- [ ] **Step 8: コミット**

```bash
git add home.js js/grammar-drill.js css/shell.css sw.js tests/graph-entry.test.js tests/graph-drill.test.js
git commit -m "feat: open the radar report as its own page from home and review"
```

---

### Task 5: 文書を直し、全部のテストを流す

**Files:**
- Modify: `README.md:16`（文法グラフの説明。レーダーは専用ページで、ホームと復習から開けること）
- Modify: `CLAUDE.md`（構成の `vendor/` の段落の後に「レーダーは `js/radar-view.js`（ページ `radar`）。グラフ本体・力学は読まない。詳細シートは `js/graph-sheet.js` をグラフと共用」。約束 11 の「レーダーからの『テーマの問題を解く』」に、戻り先がレーダーのページであること。約束 12 に「レーダーのページは rAF もタイマーも使わない」。約束 13 の `toeic_graph_mode_v1` は `'book' | 'grammar'`（古い `'radar'` は教材軸で開く））
- Modify: `docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md`（冒頭に「2026-11-23: 専用ページに分けた（`2026-11-23-radar-page-design.md`）」）
- Modify: `docs/superpowers/specs/2026-11-23-radar-page-design.md`（状態を「実装済み（実機 iPhone の確認は未実施）」に）

- [ ] **Step 1: 文書を直す**（上の一覧どおり）

- [ ] **Step 2: 全部のテストを流す**

Run: `node tools/run_tests.mjs`
Expected: 全体が成功（「不安定」があれば名前を控えて報告する）

- [ ] **Step 3: コミット**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-11-20-grammar-graph-radar-mode-design.md docs/superpowers/specs/2026-11-23-radar-page-design.md docs/superpowers/plans/2026-11-23-radar-page.md
git commit -m "docs: describe the standalone radar page"
```
