// iOS テーマの横画面版（幅 1000px 以上）の動作テスト。
// 実行: NODE_PATH=$(npm root -g) node tests/shell.test.js
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
    css: [...document.styleSheets].some(s => (s.href || '').includes('css/shell.css')),
    js: [...document.scripts].some(s => (s.src || '').includes('js/wide-layout.js')),
  }));
  assert.strictEqual(r.css, true, 'css/shell.css が index.html から読み込まれていない');
  assert.strictEqual(r.js, true, 'js/wide-layout.js が index.html から読み込まれていない');
}));

test('wide_ios_shows_a_left_sidebar_instead_of_the_tab_bar', () => withPage(IOS, async page => {
  const nav = await rect(page, '.top-page-nav');
  assert(nav.left < 30, `サイドバーが左端にない: left=${nav.left}`);
  assert(nav.width >= 200 && nav.width <= 260, `サイドバーの幅が 240px 前後でない: ${nav.width}`);
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.top-page-tab')].map(t => {
    const r = t.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  }));
  assert.strictEqual(tabs.length, 6); // 幅 1000px 以上では「グラフ」タブも出る
  assert(tabs.every(t => t.left === tabs[0].left), 'タブが縦に並んでいない');
  assert(tabs.every((t, i) => i === 0 || t.top > tabs[i - 1].top), 'タブが上から順に並んでいない');
  assert.strictEqual(await style(page, '#app', 'paddingBottom'), '0px', '下のタブバー用の余白が残っている');
}));

test('wide_ios_content_is_a_readable_column_next_to_the_sidebar', () => withPage(IOS, async page => {
  const nav = await rect(page, '.top-page-nav');
  const practice = await rect(page, '#practice-page');
  assert(practice.left >= nav.right - 1, '本文がサイドバーに重なっている');
  assert(practice.width <= 641, `演習画面が 640px を超えている: ${practice.width}`);
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

test('wide_sidebar_stays_visible_even_if_the_tab_bar_was_stowed_before', () => withPage({ ...IOS, toeic_nav_stowed: '1' }, async page => {
  const nav = await rect(page, '.top-page-nav');
  assert(nav.left < 30 && nav.width > 200, `サイドバーが隠れている: ${JSON.stringify(nav)}`);
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'visible');
  assert.strictEqual(await style(page, '.shell-grabber-bottom', 'display'), 'none', '横画面ではつまみを出さない');
  assert.strictEqual(await style(page, '.shell-grabber-footer', 'display'), 'none');
}));

const PANEL = '#filter-drawer';
const visible = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
}, sel);
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const pref = page => page.evaluate(() => localStorage.getItem('toeic_wide_filter_panel'));

test('wide_filter_panel_starts_open_on_the_right_of_the_question', () => withPage(IOS, async page => {
  assert.strictEqual(await visible(page, PANEL), true, '最初からパネルが開いていない');
  const panel = await rect(page, PANEL);
  const practice = await rect(page, '#practice-page');
  assert(panel.left >= practice.right - 1, `パネルが本文の右にない: panel.left=${panel.left}, practice.right=${practice.right}`);
  assert(Math.abs(panel.width - 380) <= 1, `1280px のとき、パネルの幅が 380px でない: ${panel.width}`);
  assert(panel.top >= 0 && panel.bottom <= 800, `パネルが画面からはみ出している: ${JSON.stringify(panel)}`);
  assert(panel.bottom >= 800 - 24, `パネルが縦に広がっていない（画面の高さいっぱいのはず）: ${JSON.stringify(panel)}`);
  // 日付・品詞のチップは、横にはみ出さず折り返す
  const overflow = await page.evaluate(() => ['date-filters', 'pos-filters'].map(id => {
    const el = document.getElementById(id);
    return el.scrollWidth - el.clientWidth;
  }));
  assert(overflow.every(d => d <= 1), `チップが横にはみ出している: ${overflow}`);
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
    const KEY = 'toeic_wide_filter_panel';
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, del = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (k) { if (k === KEY) throw new Error('blocked'); return get.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (k === KEY) throw new Error('blocked'); return set.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { if (k === KEY) throw new Error('blocked'); return del.call(this, k); };
  });
  await page.reload();
  assert.strictEqual(await visible(page, PANEL), true, '記憶が使えなくても、パネルは開いて始まる');
  await click(page, '#filter-toggle');
  assert.strictEqual(await visible(page, PANEL), false, '記憶が使えなくても、ボタンで閉じられる');
  // 答えると演習画面の class が変わる。そのとき、記憶を読み直して開き直してはいけない
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => document.getElementById('practice-page').classList.contains('has-feedback')), true, '答えられていない（テストの前提）');
  assert.strictEqual(await visible(page, PANEL), false, '答えたら、閉じたパネルが開き直った');
}));

test('wide_home_specify_range_opens_the_panel_on_the_practice_page', () => withPage(IOS, async page => {
  await click(page, '#filter-toggle'); // 先にパネルを閉じておく
  assert.strictEqual(await visible(page, PANEL), false);
  await page.evaluate(() => switchAppPage('home'));
  await page.waitForSelector('[data-home-action="specify-range"]');
  await click(page, '[data-home-action="specify-range"]');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => document.getElementById('practice-page').classList.contains('active')), true, '演習画面に移っていない');
  assert.strictEqual(await visible(page, PANEL), true, '「範囲を指定」を押しても、パネルが出ない');
  assert.strictEqual(await page.evaluate(() => document.getElementById('filter-drawer').classList.contains('open')), false, '.open が残っていると、キー操作が止まる');
}));

test('wide_filter_opened_from_the_nudge_still_lets_number_keys_answer', () => withPage(IOS, async page => {
  await page.evaluate(() => openFilterSheetFromNudge());
  await page.waitForTimeout(200);
  assert.strictEqual(await visible(page, PANEL), true);
  assert.strictEqual(await page.evaluate(() => document.getElementById('filter-drawer').classList.contains('open')), false, '.open が残っている');
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => document.getElementById('practice-page').classList.contains('has-feedback')), true, '数字キーで答えられない');
}));

test('narrow_after_wide_does_not_leave_the_filter_button_pressed', () => withPage(IOS, async page => {
  assert.strictEqual(await page.evaluate(() => document.getElementById('filter-toggle').getAttribute('aria-expanded')), 'true');
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const t = document.getElementById('filter-toggle');
    return { active: t.classList.contains('active'), aria: t.getAttribute('aria-expanded') };
  });
  assert.strictEqual(r.active, false, '狭くしたのに、絞り込みボタンが押された見た目のまま');
  assert.strictEqual(r.aria, 'false');
}));

test('narrow_keeps_the_top_sheet', async () => {
  await withPage(IOS, async page => {
    const closed = await rect(page, PANEL);
    assert(closed.bottom <= 1, `狭い画面で、シートが最初から見えている: ${JSON.stringify(closed)}`);
    await click(page, '#filter-toggle');
    await page.waitForTimeout(800); // 上から降りる動き（0.35〜0.45 秒）が終わるまで待つ
    const open = await rect(page, PANEL);
    assert(open.top >= -1 && open.bottom > 100, `狭い画面で、上から降りるシートが開かない: ${JSON.stringify(open)}`);
    assert.strictEqual(await page.evaluate(() => document.getElementById('filter-drawer').classList.contains('open')), true);
  }, { width: 800, height: 900 });
});

test('wide_filter_panel_is_narrower_at_1000px_so_the_question_keeps_room', () => withPage(IOS, async page => {
  const panel = await rect(page, PANEL);
  const practice = await rect(page, '#practice-page');
  assert(Math.abs(panel.width - 320) <= 1, `1000px のとき、パネルの幅が 320px でない: ${panel.width}`);
  assert(practice.width >= 400, `1000px のとき、演習画面が窮屈: ${practice.width}`);
}, { width: 1000, height: 800 }));

test('wide_filter_apply_button_stays_visible_at_the_bottom_of_the_panel', () => withPage(IOS, async page => {
  const panel = await rect(page, PANEL);
  const btn = await rect(page, '#filter-apply-btn');
  assert(btn.top >= panel.top && btn.bottom <= panel.bottom + 1, `「この条件で解く」がパネルの見える範囲にない: panel=${JSON.stringify(panel)} btn=${JSON.stringify(btn)}`);
}));

test('old_ios_named_storage_keys_are_ignored_without_errors', () => withPage({ ...IOS, toeic_ios_nav_stowed: '1', toeic_ios_top_stowed: '1', toeic_ios_filter_panel: 'closed' }, async page => {
  const r = await page.evaluate(() => ({
    navStowed: document.getElementById('app').classList.contains('nav-stowed'),
    topStowed: document.getElementById('practice-page').classList.contains('top-stowed'),
  }));
  assert.strictEqual(r.navStowed, false, '古い名前の「格納している」は引き継がない');
  assert.strictEqual(r.topStowed, false);
  assert.strictEqual(await visible(page, PANEL), true, '古い名前の「閉じている」は引き継がず、パネルは開いて始まる');
}));

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
  await page.waitForTimeout(700); // 余白は 0.45 秒かけて変わる。落ち着くまで待つ
  assert.strictEqual(await style(page, '#app', 'paddingBottom'), '82px', '下のバー用の余白がない');
  const look = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.top-page-nav'));
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
    return { alpha: m.length === 4 ? m[3] : 1, border: parseFloat(cs.borderTopWidth) };
  });
  assert(look.alpha >= 0.5, `バーの背景が透けすぎて、本文に埋もれる: alpha=${look.alpha}`);
  // 「グラフ」タブ（幅 1000px 未満では display:none）は数えない。下のバーは 5 タブのまま
  const icons = await page.evaluate(() => [...document.querySelectorAll('.top-page-tab')].filter(t => t.offsetParent !== null).map(t => (getComputedStyle(t, '::before').webkitMaskImage || '').includes('svg')));
  assert.deepStrictEqual(icons, [true, true, true, true, true], 'タブのアイコンが出ていない');
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
  assert.strictEqual(await stored(page, 'toeic_nav_stowed'), '0', '表示を選んだことを覚える');
}, NARROW);

forThemes('narrow_swipe_up_stows_the_practice_header_row', async page => {
  await drag(page, { x: 60, y: 50 }, { x: 60, y: 0 });
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#practice-page', 'top-stowed'), true, '見出し行が格納されない');
  assert.strictEqual(await stored(page, 'toeic_top_stowed'), '1');
}, NARROW);

test('narrow_stowed_state_is_remembered_and_survives_a_theme_switch', () => withPage({ toeic_app_theme: 'ink', toeic_nav_stowed: '1' }, async page => {
  await page.waitForTimeout(700); // 格納の動き（0.45 秒）が終わるまで待つ
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'hidden', '記憶した「格納」が復元されない');
  await page.evaluate(() => setAppTheme('light'));
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true, 'テーマを切り替えたら格納が外れた');
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'hidden');
}, NARROW));

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

test('narrow_bottom_bar_applies_before_the_theme_attribute_is_set', () => withPage({ toeic_app_theme: 'ink' }, async page => {
  // data-theme は読み込みの途中（theme-audio.js）で付く。それまでの間も、上のバーに戻って跳ねてはいけない
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'absolute', 'テーマが付く前は、下のバーになっていない');
  assert.notStrictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-tab-space').trim()), '', '--shell-tab-space が定義されていない');
}, NARROW));

test('wide_sidebar_applies_before_the_theme_attribute_is_set', () => withPage({ toeic_app_theme: 'ink' }, async page => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'static', 'テーマが付く前は、サイドバーになっていない');
  const nav = await rect(page, '.top-page-nav');
  assert(nav.left < 30 && nav.width >= 200, `サイドバーの幅・位置が違う: ${JSON.stringify(nav)}`);
}));

// 絞り込みで選択中のボタンが、濃い青の塗りのとき、文字は白い（黒だと読みにくい）
forThemes('filter_selected_buttons_on_a_dark_blue_fill_use_white_text', async page => {
  const rows = await page.evaluate(() => {
    const parse = c => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    return [...document.querySelectorAll('#filter-drawer .segment.active, #filter-drawer .chip.active')].map(el => {
      const cs = getComputedStyle(el);
      const bg = parse(cs.backgroundColor);
      return { text: el.textContent.trim().slice(0, 10), bg, bgLum: lum(bg), textLum: lum(parse(cs.color)) };
    });
  });
  assert(rows.length > 0, '選択中のボタンが見つからない');
  const bad = rows.filter(r => r.bg[2] >= 1.5 * Math.max(r.bg[0], r.bg[1]) && r.bgLum < 0.25 && r.textLum < 0.8);
  assert.strictEqual(bad.length, 0, `濃い青の塗りに、暗い文字が使われている: ${JSON.stringify(bad)}`);
});

test('default_theme_is_ios_when_nothing_is_saved', () => withPage({}, async page => {
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'ios');
  await page.evaluate(() => switchAppPage('settings'));
  const checked = await page.evaluate(() => [...document.querySelectorAll('.settings-theme-card')].filter(c => c.querySelector('.settings-theme-check')).map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  assert.deepStrictEqual(checked, ['iOS ✓'], `設定のテーマカードで、iOS が選ばれた状態になっていない: ${checked}`);
}, NARROW));

test('a_saved_theme_is_kept_even_if_it_is_ink', () => withPage({ toeic_app_theme: 'ink' }, async page => {
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'ink', '保存してあるテーマが上書きされた');
}, NARROW));

test('the_theme_in_the_url_still_wins_over_the_default_without_being_saved', () => withPage({}, async page => {
  await page.goto(baseUrl + '/index.html?theme=ios#practice');
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'ios');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('toeic_app_theme')), null, 'URL で指定しただけなのに保存された');
}, NARROW));

// 背の低い画面（スマホの横向き）では、下のバーを薄くして、問題の場所を残す
forThemes('short_landscape_phone_keeps_the_bottom_bar_compact', async page => {
  await page.waitForTimeout(700);
  const nav = await rect(page, '.top-page-nav');
  assert(nav.height <= 48, `バーが厚すぎる: ${nav.height}px`);
  const pad = parseFloat(await style(page, '#app', 'paddingBottom'));
  assert(pad <= 56, `下の余白が大きすぎる: ${pad}px`);
  assert.strictEqual(await style(page, '.top-page-nav', 'position'), 'absolute');
}, { width: 667, height: 375 });

// 背の低い画面（スマホの横向き）では、最初から下のバーを格納しておく。つまみで出したら、それを覚える
const SHORT = { width: 667, height: 375 };
forThemes('short_screen_starts_with_the_tab_bar_stowed_and_remembers_a_choice_to_show_it', async page => {
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true, '背の低い画面で、最初から格納されていない');
  assert.strictEqual(await style(page, '.top-page-nav', 'visibility'), 'hidden');
  assert.strictEqual(await stored(page, 'toeic_nav_stowed'), null, '何も選んでいないのに、記憶が書かれた');
  await click(page, '.shell-grabber-footer');
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), false, 'つまみで出せない');
  assert.strictEqual(await stored(page, 'toeic_nav_stowed'), '0');
  await page.reload();
  await page.waitForTimeout(700);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), false, '出したバーが、再読み込みでまた格納された');
}, SHORT);

test('stowed_by_default_follows_the_screen_when_the_user_has_not_chosen', () => withPage({ toeic_app_theme: 'ink' }, async page => {
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true, '横向きの低い画面では格納');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(300);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), false, '縦向きに回したら、バーが出ない');
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(300);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true, '横向きに戻したら、格納されない');
}, SHORT));

test('an_explicit_choice_to_stow_survives_rotating_to_a_tall_screen', () => withPage({ toeic_app_theme: 'ink', toeic_nav_stowed: '1' }, async page => {
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  assert.strictEqual(await hasClass(page, '#app', 'nav-stowed'), true, '本人が格納を選んだのに、外れた');
}));

// === TESTS-INSERT-POINT ===

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
