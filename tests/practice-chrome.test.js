// 演習画面の上部・フッターの構成（モード選択を絞り込みシートだけに集約、フッターに設定リンクを置かない）の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/practice-chrome.test.js
// リポジトリ直下を自前の静的サーバで配信し、Playwright(Chromium)で index.html を操作する。
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' };

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

let browser;
let baseUrl;
const pageErrors = [];

async function withPage(storage, fn, viewport = { width: 420, height: 800 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(items => {
    try {
      if (sessionStorage.getItem('__test_init')) return;
      sessionStorage.setItem('__test_init', '1');
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) { /* 使えなければ何もしない */ }
  }, storage);
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(baseUrl + '/index.html');
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

// 「300問以上」のナッジが開いていたら閉じる
const dismissNudge = page => page.evaluate(() => {
  const m = document.getElementById('filter-nudge-modal');
  if (m && m.classList.contains('open')) dismissNudge();
});
// 絞り込みシートの出題モードのボタンを押す（シートが閉じていても押せるよう、クリックを直接送る）
const pickMode = (page, mode) => page.evaluate(m => document.querySelector(`#sheet-mode-segments [data-mode="${m}"]`).click(), mode);
const eyebrow = page => page.evaluate(() => document.getElementById('practice-eyebrow').textContent.trim());

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('footer_has_no_settings_link_but_keeps_the_rest', () => withPage({}, async page => {
  const r = await page.evaluate(() => {
    const stats = document.querySelector('#practice-page .footer .stats');
    return {
      text: stats.textContent.replace(/\s+/g, ' '),
      settingsLinks: stats.querySelectorAll('[onclick*="toggleSettings"]').length,
      weak: !!stats.querySelector('[onclick*="toggleWeakList"]'),
      pace: !!stats.querySelector('#pace-text'),
    };
  });
  assert.strictEqual(r.settingsLinks, 0, r.text);
  assert(!/設定/.test(r.text), r.text);
  assert.strictEqual(r.weak, true, '苦手リストのリンクは残す');
  assert.strictEqual(r.pace, true, '解答時間の枠は残す');
}));

test('header_gear_button_stays', () => withPage({}, async page => {
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('#practice-page .header #settings-btn')), true);
}));

test('practice_screen_has_no_mode_selector_but_the_filter_sheet_does', () => withPage({}, async page => {
  const r = await page.evaluate(() => ({
    practiceRow: !!document.getElementById('mode-segments'),
    outsideSheet: [...document.querySelectorAll('.mode-segments')].filter(el => !el.closest('#filter-drawer')).length,
    inSheet: document.querySelectorAll('#filter-drawer #sheet-mode-segments .segment[data-mode]').length,
  }));
  assert.strictEqual(r.practiceRow, false, '演習画面にモード選択の行が残っている');
  assert.strictEqual(r.outsideSheet, 0);
  assert.strictEqual(r.inSheet, 4, '絞り込みシートに 4 モードが揃っている');
}));

test('eyebrow_shows_the_current_mode_and_follows_changes', () => withPage({}, async page => {
  await dismissNudge(page);
  assert.strictEqual(await eyebrow(page), '英→日');
  for (const [mode, label] of [['j2e', '日→英'], ['flash', 'カード'], ['type', 'タイプ'], ['e2j', '英→日']]) {
    await pickMode(page, mode);
    assert.strictEqual(await page.evaluate(() => state.mode), mode);
    assert.strictEqual(await eyebrow(page), label, mode);
  }
}));

test('eyebrow_is_part5_for_grammar_and_returns_to_the_mode_for_vocab', () => withPage({}, async page => {
  await dismissNudge(page);
  await pickMode(page, 'type');
  await page.click('.app-type-segments .segment[data-app="grammar"]');
  await dismissNudge(page);
  assert.strictEqual(await eyebrow(page), 'Part 5');
  await page.click('.app-type-segments .segment[data-app="vocab"]');
  await dismissNudge(page);
  assert.strictEqual(await eyebrow(page), 'タイプ');
}));

test('eyebrow_uses_the_saved_mode_on_load', () => withPage({}, async page => {
  await dismissNudge(page);
  await pickMode(page, 'flash');
  await page.reload();
  await dismissNudge(page);
  assert.strictEqual(await eyebrow(page), 'カード');
}));

test('eyebrow_follows_the_mode_saved_for_a_book_opened_from_home', () => withPage({}, async page => {
  // ホームから教材を開くと、その教材で最後に使ったモードに切り替わる（setApp を通らない経路）
  await page.evaluate(() => { homeState.presets['vocab:daily'] = { ...(homeState.presets['vocab:daily'] || {}), mode: 'j2e' }; });
  await page.evaluate(() => startBookFromHome('vocab', 'daily'));
  assert.strictEqual(await page.evaluate(() => state.mode), 'j2e');
  assert.strictEqual(await eyebrow(page), '日→英');
}));

test('every_mode_still_runs_and_shows_the_solving_timer', async () => {
  for (const mode of ['e2j', 'j2e', 'flash', 'type']) {
    await withPage({}, async page => {
      await dismissNudge(page);
      await pickMode(page, mode);
      await dismissNudge(page);
      await page.waitForTimeout(350);
      const r = await page.evaluate(() => ({
        quiz: document.getElementById('quiz-container').innerText.length > 0,
        timer: !!document.querySelector('#pace-text.live'),
        mode: state.mode,
      }));
      assert.strictEqual(r.mode, mode);
      assert.strictEqual(r.quiz, true, `${mode}: 問題が表示されていない`);
      assert.strictEqual(r.timer, true, `${mode}: カウントアップが出ていない`);
    });
  }
});

test('more_room_for_the_question_without_the_mode_row', () => withPage({}, async page => {
  await dismissNudge(page);
  const top = await page.evaluate(() => Math.round(document.querySelector('#practice-page .main-area').getBoundingClientRect().top));
  // モード選択の行（約 50px）が無くなった分、問題の領域が上に来る
  assert(top < 190, `問題領域の上端が ${top}px（モード選択の行が残っている可能性）`);
}));

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
