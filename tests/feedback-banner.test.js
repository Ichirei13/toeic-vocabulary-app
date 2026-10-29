// NODE_PATH=$(npm root -g) node tests/feedback-banner.test.js
// 回答後の表示、自己採点、記録の二重加算防止と、小さい画面での重なりを検証する。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = path.resolve(root, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)];
  res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
let browser, base;
const errors = [];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const themes = ['ink', 'duolingo', 'navy', 'quizlet', 'forest', 'nordic', 'sepia'];

async function open(fn, { theme = 'ink', mode = 'e2j', width = 375, height = 667, grammar = false, five = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.addInitScript(theme => localStorage.setItem('toeic_app_theme', theme), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/index.html#practice');
  await page.evaluate(({ mode, grammar, five }) => {
    dismissNudge();
    if (grammar) {
      document.querySelector('.app-type-segments [data-app="grammar"]').click();
      const source = RAW_GRAMMAR.find(ex => ex.exp.length > 700);
      // 現在のデータには5択がないので、実際の問題に追加の誤答を足して対応幅を確認する。
      const ex = five ? { ...source, c: [...source.c, 'An additional distractor with a long label'] } : source;
      state.grammarPool = [ex, RAW_GRAMMAR.find(other => other.id !== ex.id)];
      state.currentGrammarIndex = 0;
      renderCurrentGrammar();
    } else {
      document.querySelector(`#sheet-mode-segments [data-mode="${mode}"]`).click();
    }
    dismissNudge();
  }, { mode, grammar, five });
  try { await fn(page, context); } finally { await context.close(); }
}

async function answer(page, mode, outcome) {
  if (mode === 'grammar') {
    if (outcome === 'skip') return page.locator('#dont-know-btn').click();
    const index = await page.evaluate(ok => {
      const ex = state.grammarPool[state.currentGrammarIndex];
      return ok ? ex.a : (ex.a + 1) % ex.c.length;
    }, outcome === 'correct');
    return page.locator('#choices-container .choice-btn').nth(index).click();
  }
  if (mode === 'flash') {
    await page.locator('#next-btn').click();
    return page.locator(outcome === 'correct' ? '#next-btn' : '#dont-know-btn').click();
  }
  if (outcome === 'skip') return page.locator('#dont-know-btn').click();
  if (mode === 'type') {
    const value = outcome === 'correct' ? await page.evaluate(() => state.pool[state.currentIndex].w.split('/')[0].replace(/[~～]/g, '').trim()) : 'a_deliberately_incorrect_answer';
    await page.locator('#type-input').fill(value);
    return page.locator('#type-check-btn').click();
  }
  const index = await page.evaluate(ok => state.currentOptions.findIndex(opt => (opt.w === state.pool[state.currentIndex].w) === ok), outcome === 'correct');
  await page.locator('#choices-container .choice-btn').nth(index).click();
}

async function feedback(page, correct) {
  assert(await page.locator('#duo-banner').isVisible(), '回答後のバナーが見えない');
  assert(await page.locator(`#duo-banner.${correct ? 'correct' : 'wrong'}`).count(), '判定が一致しない');
  const mascot = page.locator('#duo-banner img');
  assert.equal(await mascot.count(), 1, 'ポメラニアンが表示されていない');
  assert((await mascot.getAttribute('src')).endsWith(correct ? '/encourage.svg' : '/reflect.svg'));
  await mascot.evaluate(img => img.decode());
}

// バナーのテーマ制限、欠けたモード接続、次の問題に残る表示を検知する。
for (const mode of ['e2j', 'j2e', 'type', 'grammar']) {
  for (const outcome of ['correct', 'wrong', 'skip']) {
    test(`${mode}: ${outcome} shows feedback and next clears it`, () => open(async page => {
      assert.equal(await page.locator('#duo-banner').isVisible(), false);
      const before = await page.locator('#practice-page .header').boundingBox();
      await answer(page, mode, outcome);
      await feedback(page, outcome === 'correct');
      const after = await page.locator('#practice-page .header').boundingBox();
      assert(after.height < before.height, '回答後に上部がコンパクトになっていない');
      if (outcome === 'skip') assert.match(await page.locator('#duo-banner-title').innerText(), /ここで覚えよう/);
      await page.locator('#next-btn').click();
      assert.equal(await page.locator('#duo-banner').isVisible(), false);
      assert.equal(await page.locator('#practice-page').evaluate(el => el.classList.contains('has-feedback')), false);
    }, { mode, grammar: mode === 'grammar' }));
  }
}

for (const known of [true, false]) {
  test(`flash: ${known ? 'known' : 'unknown'} waits for next and records once`, () => open(async page => {
    const before = await page.evaluate(() => ({ index: state.currentIndex, answered: state.answeredCount, score: state.score }));
    await answer(page, 'flash', known ? 'correct' : 'wrong');
    await feedback(page, known);
    const graded = await page.evaluate(() => ({ index: state.currentIndex, answered: state.answeredCount, score: state.score, xp: duoXP }));
    assert.deepEqual(graded, { ...before, answered: before.answered + 1, score: before.score + (known ? 1 : 0), xp: known ? 10 : 0 });
    assert.equal(await page.locator('#next-btn').innerText(), '次へ');
    assert.equal(await page.locator('#dont-know-btn').isVisible(), false);
    await page.evaluate(() => gradeFlash(true));
    assert.equal(await page.evaluate(() => state.answeredCount), graded.answered);
    await page.locator('#next-btn').click();
    assert.equal(await page.evaluate(() => state.currentIndex), before.index + 1);
    assert.equal(await page.locator('#duo-banner').isVisible(), false);
  }, { mode: 'flash' }));
}

for (const theme of themes) {
  test(`${theme}: feedback survives theme changes and review without adding points`, () => open(async page => {
    await answer(page, 'e2j', 'correct');
    await feedback(page, true);
    const totals = await page.evaluate(() => ({ answered: state.answeredCount, score: state.score, xp: duoXP }));
    await page.evaluate(() => setAppTheme('sepia'));
    await feedback(page, true);
    await page.locator('#next-btn').click();
    await page.locator('#back-btn').click();
    await feedback(page, true);
    assert.deepEqual(await page.evaluate(() => ({ answered: state.answeredCount, score: state.score, xp: duoXP })), totals);
  }, { theme }));
  test(`${theme}: long grammar answers fit a small screen`, () => open(async page => {
    await answer(page, 'grammar', 'wrong');
    await geometry(page);
  }, { theme, grammar: true, five: true, width: 320, height: 568 }));
}

async function geometry(page) {
  const r = await page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    return { height: innerHeight, width: innerWidth, card: rect('#main-card'), quiz: rect('#quiz-container'), choices: rect('#choices-container'), banner: rect('#duo-banner'), action: rect('.action-bar'), next: rect('#next-btn'), scroll: document.getElementById('app').scrollTop };
  });
  assert(r.card.top >= r.quiz.top - 1 && r.card.bottom <= r.quiz.bottom + 1, `カードが領域外: ${JSON.stringify(r)}`);
  assert(r.card.bottom <= r.choices.top + 1, `カードと選択肢が重なる: ${JSON.stringify(r)}`);
  assert(r.choices.bottom <= r.banner.top + 1, `選択肢とバナーが重なる: ${JSON.stringify(r)}`);
  assert(r.banner.bottom <= r.action.top + 1, `バナーと操作が重なる: ${JSON.stringify(r)}`);
  assert(r.next.top >= 0 && r.next.bottom <= r.height + 1 && r.next.height >= 44, `次へを操作できない: ${JSON.stringify(r)}`);
  assert(r.banner.height > 0 && r.banner.left >= 0 && r.banner.right <= r.width + 1);
  assert(r.card.height >= 60, `カードが読める高さを失っている: ${JSON.stringify(r)}`);
  assert.equal(r.scroll, 0, 'アプリ全体が押し出されている');
}

// 固定のカード最低高さ、長い選択肢・バナー、5択による領域の衝突を検知する。
for (const [width, height] of [[320, 568], [375, 667], [375, 812], [768, 1024], [1024, 768], [1440, 900], [667, 375]]) {
  test(`${width}x${height}: five choices and long feedback do not overlap`, () => open(async page => {
    await answer(page, 'grammar', 'wrong');
    // 実際の正解文が長い場合と同じ表示経路を通す。
    await page.evaluate(() => showDuoBanner(false, 'とても長い正解の説明です。'.repeat(30)));
    await geometry(page);
  }, { theme: 'duolingo', grammar: true, five: true, width, height }));
}

test('typing after a short keyboard viewport still leaves feedback and next reachable', () => open(async page => {
  await page.setViewportSize({ width: 390, height: 350 });
  await answer(page, 'type', 'wrong');
  await feedback(page, false);
  assert(await page.locator('#next-btn').isVisible());
  await page.locator('#next-btn').click();
  assert.equal(await page.locator('#duo-banner').isVisible(), false);
}, { mode: 'type' }));

test('answering restores the whole screen after focus has scrolled the app container', () => open(async page => {
  // 最低高さのある未回答カードへブラウザがフォーカスを移したときの押し出しを再現する。
  await page.locator('#app').evaluate(el => { el.scrollTop = 70; });
  await answer(page, 'grammar', 'correct');
  await geometry(page);
}, { grammar: true, width: 375, height: 667 }));

test('long feedback and answer choices can be scrolled to the end', () => open(async page => {
  await answer(page, 'grammar', 'wrong');
  await page.evaluate(() => showDuoBanner(false, '長い正解文です。'.repeat(50)));
  const reachable = await page.evaluate(() => ['main-card', 'choices-container', 'duo-banner'].map(id => {
    const el = document.getElementById(id);
    el.scrollTop = el.scrollHeight;
    return el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  }));
  assert.deepEqual(reachable, [true, true, true]);
  await geometry(page);
}, { grammar: true, five: true, width: 320, height: 568 }));

test('mobile mascot feedback screenshots', async () => {
  if (!process.env.FEEDBACK_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.FEEDBACK_SCREENSHOT_DIR, { recursive: true });
  for (const [mode, outcome] of [['grammar', 'correct'], ['grammar', 'wrong'], ['flash', 'wrong']]) {
    await open(async page => {
      await answer(page, mode, outcome);
      await feedback(page, outcome === 'correct');
      if (mode !== 'flash') await geometry(page);
      await page.screenshot({ path: path.join(process.env.FEEDBACK_SCREENSHOT_DIR, `pomeranian-${mode}-${outcome}.png`) });
    }, { mode, grammar: mode === 'grammar' });
  }
});

test('both mascot expressions remain available offline before their first answer', () => open(async (page, context) => {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8000 });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  const status = await page.evaluate(async () => Promise.all(['encourage', 'reflect'].map(async name => {
    const response = await fetch(`assets/pomeranian/${name}.svg`);
    return response.ok && (await response.text()).includes('<svg');
  })));
  assert.deepEqual(status, [true, true]);
}));

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  let failed = 0;
  try {
    const selected = tests.filter(([name]) => !process.argv[2] || name.includes(process.argv[2]));
    for (const [name, fn] of selected) {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (error) { failed++; console.log(`FAIL ${name}\n  ${error.message}`); }
    }
    if (errors.length) { failed++; console.log('FAIL page errors\n' + errors.join('\n')); }
    console.log(`${selected.length} tests, ${failed} failures`);
  } finally { await browser.close(); server.close(); }
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
