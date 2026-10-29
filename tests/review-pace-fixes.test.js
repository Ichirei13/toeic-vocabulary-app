// (1) 復習できた数は教材（本）ごとに別々に数える、(2) 長い解答時間を 60 秒で頭打ちにして即答扱いにしない、の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/review-pace-fixes.test.js
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

async function withPage(storage, fn) {
  const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
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

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ==================== (1) 教材ごとの復習カウンター ====================

// 本の最初の n 問を苦手にして（今すぐ復習できる状態）、正解として記録する
async function answerWeakCorrectly(page, book, n) {
  await page.evaluate(([b, count]) => {
    const items = RAW_GRAMMAR.filter(g => (g.b || 'sekai') === b).slice(0, count);
    const now = Date.now();
    items.forEach(ex => { state.grammarWeakData[ex.id] = { streak: 0, added: now, due: 0, u: now }; });
    items.forEach(ex => recordWeakGrammar(ex, true));
  }, [book, n]);
}
const reviewText = page => page.evaluate(() => sessionReviewHtml('grammar').replace(/<[^>]+>/g, ''));

test('review_counts_are_kept_per_book', () => withPage({}, async page => {
  await page.evaluate(() => startBookFromHome('grammar', 'kin'));
  await answerWeakCorrectly(page, 'kin', 3);
  await page.evaluate(() => startBookFromHome('grammar', 'sekai'));
  assert.strictEqual(await reviewText(page), '', '世界一を開いた直後に、金の文法の成果が混ざっている');
  await answerWeakCorrectly(page, 'sekai', 7);
  assert(/7 問/.test(await reviewText(page)), await reviewText(page));
  await page.evaluate(() => startBookFromHome('grammar', 'kin')); // 保存した続きに戻る
  const kin = await reviewText(page);
  assert(/3 問/.test(kin) && !/7 問/.test(kin), '金の文法に戻ったとき世界一の 7 問が混ざっている: ' + kin);
  await page.evaluate(() => startBookFromHome('grammar', 'sekai'));
  assert(/7 問/.test(await reviewText(page)), '世界一の成果が消えている');
}));

test('rebuilding_a_books_pool_resets_only_that_books_count', () => withPage({}, async page => {
  await page.evaluate(() => startBookFromHome('grammar', 'kin'));
  await answerWeakCorrectly(page, 'kin', 2);
  await page.evaluate(() => startBookFromHome('grammar', 'sekai'));
  await answerWeakCorrectly(page, 'sekai', 4);
  await page.evaluate(() => { state.grammarBook = 'kin'; applyGrammarFilters(); }); // 金の文法の出題を作り直す
  assert.strictEqual(await reviewText(page), '');
  await page.evaluate(() => startBookFromHome('grammar', 'sekai'));
  assert(/4 問/.test(await reviewText(page)), '作り直していない世界一の成果まで消えた: ' + await reviewText(page));
}));

test('vocab_review_counts_are_kept_per_source', () => withPage({}, async page => {
  const answer = (source, n) => page.evaluate(([s, count]) => {
    const words = RAW_WORDS.filter(w => (s === 'all' ? true : w.src === s || true)).slice(0, count);
    const now = Date.now();
    words.forEach(w => { wordWeak()[w.w] = { streak: 0, added: now, due: 0, u: now }; });
    words.forEach(w => recordWeak(w, true));
  }, [source, n]);
  const text = () => page.evaluate(() => sessionReviewHtml('vocab').replace(/<[^>]+>/g, ''));
  await page.evaluate(() => startBookFromHome('vocab', 'teppan'));
  await answer('teppan', 2);
  await page.evaluate(() => startBookFromHome('vocab', 'daily'));
  assert.strictEqual(await text(), '', '別の教材の成果が混ざっている');
  await answer('daily', 5);
  await page.evaluate(() => startBookFromHome('vocab', 'teppan'));
  const t = await text();
  assert(/2 問/.test(t) && !/5 問/.test(t), t);
}));

// ==================== (2) 長い解答時間 ====================

// 問題を出してから secs 秒たったことにして、回答を記録する。今日の記録の即答数を返す
async function answerAfter(page, kind, secs, isCorrect = true) {
  return page.evaluate(([k, s, ok]) => {
    questionShownAt = performance.now() - s * 1000;
    recordAnswerPaceAndActivity(k, ok);
    const d = dailyActivity.days[localDateStr()];
    return { fast: d.fast || 0, sec: d.sec, a: d.a };
  }, [kind, secs, isCorrect]);
}
const setTarget = (page, kind, v) => page.evaluate(([k, x]) => { prefs.paceTarget[k] = x; savePrefs(); }, [kind, v]);

test('90s_answer_is_not_quick_when_the_target_is_70s', () => withPage({}, async page => {
  await setTarget(page, 'grammar', 70);
  const r = await answerAfter(page, 'grammar', 90);
  assert.strictEqual(r.fast, 0, '90 秒かかった回答が即答になっている');
  const within = await answerAfter(page, 'grammar', 65);
  assert.strictEqual(within.fast, 1, '70 秒以内なら即答');
}));

test('90s_answer_is_quick_when_the_target_is_120s_and_is_recorded_as_90s', () => withPage({}, async page => {
  await setTarget(page, 'grammar', 120);
  const r = await answerAfter(page, 'grammar', 90);
  assert.strictEqual(r.fast, 1);
  assert(r.sec > 89 && r.sec < 91, `記録された秒数が 90 秒でない: ${r.sec}`);
}));

test('idle_time_is_capped_when_recorded_and_never_counts_as_quick', () => withPage({}, async page => {
  await setTarget(page, 'grammar', 120);
  const r = await answerAfter(page, 'grammar', 400);
  assert.strictEqual(r.fast, 0, '放置した回答が即答になっている');
  assert(r.sec <= 120.1, `放置した時間が頭打ちされていない: ${r.sec}`);
}));

test('badge_tier_uses_the_real_time_not_the_capped_one', () => withPage({}, async page => {
  await setTarget(page, 'grammar', 70);
  await page.evaluate(() => { questionShownAt = performance.now() - 90000; });
  await page.evaluate(() => { document.querySelector('.app-type-segments .segment[data-app="grammar"]').click(); });
  await page.evaluate(() => { questionShownAt = performance.now() - 90000; recordAnswerPaceAndActivity('grammar', true); });
  const text = await page.evaluate(() => document.querySelector('#main-card .card-pace-badge')?.textContent || '');
  assert(/9\d\.\d秒/.test(text), 'バッジの秒数が実測の 90 秒でない: ' + text);
  assert(!/⚡/.test(text), '90 秒の回答に即答のバッジが付いている: ' + text);
  // 上限（120 秒）を超えて放置した回答は「120+秒」と表示し、目標が最大の 120 秒でも即答のバッジを付けない
  await setTarget(page, 'grammar', 120);
  await page.evaluate(() => { questionShownAt = performance.now() - 300000; recordAnswerPaceAndActivity('grammar', true); });
  const idle = await page.evaluate(() => document.querySelector('#main-card .card-pace-badge')?.textContent || '');
  assert.strictEqual(idle, '⏱ 120+秒', idle);
}));

test('live_timer_shows_real_seconds_beyond_60', () => withPage({}, async page => {
  await setTarget(page, 'grammar', 120);
  await page.evaluate(() => { document.querySelector('.app-type-segments .segment[data-app="grammar"]').click(); });
  await page.evaluate(() => { const m = document.getElementById('filter-nudge-modal'); if (m && m.classList.contains('open')) dismissNudge(); });
  await page.evaluate(() => { questionShownAt = performance.now() - 90000; });
  await page.waitForTimeout(300);
  const at90 = await page.evaluate(() => document.getElementById('pace-text').textContent);
  assert(/^⏱ 9\d\.\d$/.test(at90), '90 秒が表示されていない: ' + at90);
  await page.evaluate(() => { questionShownAt = performance.now() - 125000; });
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => document.getElementById('pace-text').textContent), '⏱ 120+');
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
