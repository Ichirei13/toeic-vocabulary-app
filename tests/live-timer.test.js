// 解いている間のカウントアップ表示（画面下のフッター）の検証。
// 実行: NODE_PATH=$(npm root -g) node tests/live-timer.test.js
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

// 「300問以上」のナッジが開いていたら閉じる
const dismissNudge = page => page.evaluate(() => {
  const m = document.getElementById('filter-nudge-modal');
  if (m && m.classList.contains('open')) dismissNudge();
});
// 解いている間のカウントアップ（画面下のフッターの枠）
const live = page => page.evaluate(() => {
  const el = document.querySelector('#practice-page .footer .stats #pace-text.live');
  return el ? { text: el.textContent, over: el.classList.contains('over') } : null;
});
// フッターの枠の今の文字（カウントアップ中でなければ平均ペース）
const footerPace = page => page.evaluate(() => document.getElementById('pace-text').textContent);
// 回答後にカードへ出る結果バッジ
const badge = page => page.evaluate(() => {
  const el = document.querySelector('#main-card .card-pace-badge');
  return el ? { text: el.textContent } : null;
});
const num = t => parseFloat(String(t).replace(/[^\d.]/g, ''));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('counts_up_while_solving_vocab', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.waitForTimeout(450);
  const a = await live(page);
  assert(a && /^⏱ \d+\.\d$/.test(a.text), JSON.stringify(a));
  await page.waitForTimeout(450);
  const b = await live(page);
  assert(num(b.text) > num(a.text), `${a.text} -> ${b.text}`);
  assert.strictEqual(await badge(page), null, '解いている間、カードの上には何も出さない（出題の邪魔にならない）');
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('#practice-page .footer .stats #pace-text')), true, '画面下のフッターに出る');
}));

test('counts_up_while_solving_grammar', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.click('.app-type-segments .segment[data-app="grammar"]');
  await dismissNudge(page);
  await page.waitForTimeout(450);
  const a = await live(page);
  assert(a && /^⏱ \d+\.\d$/.test(a.text), JSON.stringify(a));
  assert.strictEqual(await badge(page), null, '解いている間、カードの上には何も出さない');
}));

test('stops_at_answer_and_becomes_the_result_badge', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.waitForTimeout(300);
  await page.click('#choices-container .choice-btn >> nth=0');
  const after = await badge(page);
  assert(after && /\d+\.\d秒/.test(after.text), JSON.stringify(after));
  assert.strictEqual(await live(page), null, '回答後もカウントアップが残っている');
  assert(/s\/問/.test(await footerPace(page)), 'フッターが平均ペースに戻っていない: ' + await footerPace(page));
  assert.strictEqual(await page.evaluate(() => liveTimerId), null, 'interval が止まっていない');
  await page.waitForTimeout(400);
  assert.strictEqual((await badge(page)).text, after.text, '回答後に数字が動いている');
  assert(/s\/問/.test(await footerPace(page)));
}));

test('goes_over_target_and_shows_120_plus', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.evaluate(() => { questionShownAt = performance.now() - 6000; }); // 単語の目標 5 秒を超える
  await page.waitForTimeout(250);
  assert.strictEqual((await live(page)).over, true);
  await page.evaluate(() => { questionShownAt = performance.now() - 61000; });
  await page.waitForTimeout(250);
  assert(/^⏱ 6[1-2]\.\d$/.test((await live(page)).text), '60 秒で頭打ちにしている: ' + (await live(page)).text);
  await page.evaluate(() => { questionShownAt = performance.now() - 121000; });
  await page.waitForTimeout(250);
  assert.strictEqual((await live(page)).text, '⏱ 120+');
}));

test('uses_the_same_clock_as_the_recorded_time', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.evaluate(() => { questionShownAt = performance.now() - 2000; });
  await page.waitForTimeout(250);
  const shown = num((await live(page)).text);
  await page.click('#choices-container .choice-btn >> nth=0');
  const final = num((await badge(page)).text);
  assert(final >= shown && final - shown < 0.6, `${shown} -> ${final}`);
}));

test('not_shown_while_reviewing_a_previous_question', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.click('#choices-container .choice-btn >> nth=0');
  await page.click('#next-btn');
  await page.waitForTimeout(200);
  assert.notStrictEqual(await live(page), null, '次の問題では数え始める');
  await page.evaluate(() => reviewBack());
  await page.waitForTimeout(250);
  assert.strictEqual(await live(page), null);
  assert.strictEqual(await page.evaluate(() => liveTimerId), null);
  assert(/s\/問/.test(await footerPace(page)), '見直し中のフッターは平均ペース');
}));

test('setting_off_hides_the_timer_and_is_saved', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.evaluate(() => {
    switchAppPage('settings');
    const box = document.getElementById('setting-live-timer');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.strictEqual((await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_prefs_v1')))).liveTimer, false);
  await page.evaluate(() => switchAppPage('practice'));
  await dismissNudge(page); // 演習画面に戻ると「300問以上」のナッジがまた開く
  await page.click('#choices-container .choice-btn >> nth=0');
  await page.click('#next-btn');
  await dismissNudge(page); // 次の問題でも「300問以上」のナッジが開く
  await page.waitForTimeout(300);
  assert.strictEqual(await live(page), null);
  // 回答後のバッジは、タイマーを消していても今までどおり出る
  await page.click('#choices-container .choice-btn >> nth=0');
  assert.notStrictEqual(await badge(page), null);
}));

test('setting_defaults_on_and_survives_garbage', () => withPage({ toeic_prefs_v1: JSON.stringify({ dailyGoal: 10, liveTimer: 'no' }) }, async page => {
  assert.strictEqual(await page.evaluate(() => prefs.liveTimer), true);
  await page.evaluate(() => switchAppPage('settings'));
  assert.strictEqual(await page.evaluate(() => document.getElementById('setting-live-timer').checked), true);
}));

test('stops_when_leaving_the_practice_page_and_resumes_on_return', () => withPage({}, async page => {
  await dismissNudge(page);
  await page.waitForTimeout(250);
  assert.notStrictEqual(await live(page), null);
  await page.evaluate(() => switchAppPage('home'));
  assert.strictEqual(await page.evaluate(() => liveTimerId), null);
  await page.evaluate(() => switchAppPage('practice'));
  await page.waitForTimeout(300);
  assert.notStrictEqual(await live(page), null, '未回答の問題に戻ったら数え直さず続きを表示する');
}));

test('backup_carries_the_timer_setting_and_rejects_non_boolean', () => withPage({ toeic_prefs_v1: JSON.stringify({ dailyGoal: 10, liveTimer: false }) }, async page => {
  const r = await page.evaluate(() => {
    const b = buildBackup();
    const drive = buildBackup({ forDrive: true });
    const good = JSON.parse(JSON.stringify(parseBackup(JSON.stringify(b))));
    const bad = JSON.parse(JSON.stringify(parseBackup(JSON.stringify({ ...b, data: { ...b.data, prefs: { liveTimer: 'x' } } }))));
    return { exported: b.data.prefs.liveTimer, drive: 'prefs' in drive.data, good: good.extras.prefs, bad: bad.extras.prefs };
  });
  assert.strictEqual(r.exported, false);
  assert.strictEqual(r.drive, false);
  assert.strictEqual(r.good.liveTimer, false);
  assert.deepStrictEqual(r.bad, {}); // 真偽値でない値は取り込まない（今のまま）
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
