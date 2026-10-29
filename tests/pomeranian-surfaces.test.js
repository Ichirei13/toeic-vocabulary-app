// NODE_PATH=$(npm root -g) node tests/pomeranian-surfaces.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser, base;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

async function open(t, { width = 375, height = 812, theme = 'ink' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', timezoneId: 'Asia/Tokyo' });
  t.after(() => context.close());
  await context.addInitScript(theme => localStorage.setItem('toeic_app_theme', theme), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(base + '/index.html#home');
  await page.evaluate(() => dismissNudge());
  return { page, context };
}

async function capture(page, name) {
  if (!process.env.FEEDBACK_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.FEEDBACK_SCREENSHOT_DIR, { recursive: true });
  for (const img of await page.locator('img').all()) await img.evaluate(img => img.decode());
  await page.locator('.top-page-nav').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await page.screenshot({ path: path.join(process.env.FEEDBACK_SCREENSHOT_DIR, name) });
}

test('each grammar book retains its title and opens with its own mascot', async t => {
  const { page } = await open(t);
  await page.getByRole('tab', { name: '文法', exact: true }).click();
  for (const [id, asset, title] of [
    ['kin', 'course-kin.svg', '金の文法'], ['sekai', 'course-sekaiichi.svg', '世界一わかりやすい英文法'],
    ['polaris2', 'course-polaris.svg', '英文法ポラリス2'], ['toplevel', 'course-toplevel.svg', '高3 トップレベル英語'],
  ]) {
    if (id !== 'kin') await page.locator(`[data-home-select-book="${id}"]`).click();
    assert.equal(await page.locator('.home-main-book-title').innerText(), title);
    const img = page.locator('.home-main-book-title img');
    assert.equal(await img.count(), 1);
    assert((await img.getAttribute('src')).endsWith(asset));
    await img.evaluate(img => img.decode());
    assert.equal(await page.locator('.home-other-title img').count(), 4);
  }
});

test('book tiles keep each color when selected and use the new vocabulary mascots', async t => {
  const { page } = await open(t);
  const colors = new Map();
  for (const [kind, entries] of [
    ['vocab', [['teppan', 'vocab-teppan.svg'], ['daily', 'vocab-daily.svg'], ['all', 'vocab-flashcards.svg']]],
    ['grammar', [['kin', 'course-kin.svg'], ['sekai', 'course-sekaiichi.svg'], ['polaris2', 'course-polaris.svg'], ['toplevel', 'course-toplevel.svg'], ['all', 'neutral.svg']]],
  ]) {
    await page.getByRole('tab', { name: kind === 'vocab' ? '単語' : '文法', exact: true }).click();
    for (const [id, asset] of entries) {
      const listed = page.locator(`[data-home-select-book="${id}"] .home-book-tile`);
      const color = await listed.count() ? await listed.evaluate(el => getComputedStyle(el).backgroundColor) : null;
      if (await listed.count()) await page.locator(`[data-home-select-book="${id}"]`).click();
      const tile = page.locator('.home-main-book-title .home-book-tile');
      assert.equal(await tile.count(), 1);
      const style = await tile.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), w: el.clientWidth, h: el.clientHeight }));
      assert.notEqual(style.bg, 'rgba(0, 0, 0, 0)');
      assert(style.radius >= 8 && style.w === style.h, '角丸の四角になっていない');
      if (color) assert.equal(style.bg, color, '選択すると教材の色が変わってしまう');
      if (id === 'all' && colors.has(id)) assert.equal(style.bg, colors.get(id));
      colors.set(id, style.bg);
      assert((await tile.locator('img').getAttribute('src')).endsWith(asset));
    }
  }
  assert.equal(new Set(colors.values()).size, 7, '教材の背景色を区別できない');
});

test('brand mascot stays beside a readable label and returns home on mobile', async t => {
  const { page } = await open(t, { width: 375 });
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 812 });
    const img = page.locator('.top-page-brand img');
    assert.equal(await img.count(), 1);
    await img.evaluate(img => img.decode());
    const layout = await page.locator('.top-page-brand').evaluate(el => {
      const label = [...el.querySelectorAll('span')].find(span => getComputedStyle(span).display !== 'none');
      const rect = el.getBoundingClientRect();
      const tabs = document.querySelector('.top-page-tabs').getBoundingClientRect();
      const icon = el.querySelector('img').getBoundingClientRect();
      return { fullLabel: label.scrollWidth <= label.clientWidth + 1, brandRight: rect.right, tabsLeft: tabs.left, tabsRight: tabs.right, iconWidth: icon.width };
    });
    assert(layout.fullLabel && layout.brandRight <= layout.tabsLeft && layout.tabsRight <= width + 1 && layout.iconWidth >= 24, JSON.stringify(layout));
  }
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'TOEIC Practice ホームへ', exact: true }).click();
  assert(await page.locator('#home-page').isVisible());
});

test('home guidance, real streak and goal achievement use distinct poses without losing counts', async t => {
  const { page } = await open(t);
  assert((await page.locator('.home-message-bar img').getAttribute('src')).endsWith('neutral.svg'));
  await page.evaluate(() => {
    dailyActivity.days = {};
    for (let offset = 0; offset < 3; offset++) {
      const d = new Date(); d.setDate(d.getDate() - offset);
      dailyActivity.days[localDateStr(d.getTime())] = { a: offset ? 1 : 10, c: 1, fast: 0, sec: 2, g: 10 };
    }
    prefs.dailyGoal = 10;
    renderHomePage();
  });
  assert.match(await page.locator('.home-streak-badge').innerText(), /3日連続/);
  assert((await page.locator('.home-streak-badge img').getAttribute('src')).endsWith('streak.svg'));
  assert((await page.locator('.home-goal-row img').getAttribute('src')).endsWith('celebrate.svg'));
  assert.match(await page.locator('.home-goal-row').innerText(), /目標\s*達成/);
  assert.match(await page.locator('.home-goal-row').innerText(), /10 \/ 10問/);
  await capture(page, 'pomeranian-home-achieved.png');
  await page.locator('.home-goal-row').click();
  assert(await page.getByRole('dialog', { name: '学習カレンダー' }).isVisible());
  await page.getByRole('dialog', { name: '学習カレンダー' }).getByRole('button', { name: '閉じる', exact: true }).click();
  await page.evaluate(() => { prefs.dailyGoal = 0; dailyActivity.days[localDateStr()].g = 0; renderHomePage(); });
  assert.equal(await page.locator('.home-goal-row img[src$="celebrate.svg"]').count(), 0);
});

test('completion and actual graduated results celebrate without inventing achievements', async t => {
  const { page } = await open(t);
  for (const kind of ['vocab', 'grammar']) {
    await page.evaluate(kind => {
      setApp(kind);
      if (kind === 'grammar') state.currentGrammarIndex = state.grammarPool.length;
      else state.currentIndex = state.pool.length;
      sessionReview[reviewKey(kind)] = { reviewed: 1, graduated: 0 };
      (kind === 'grammar' ? renderCurrentGrammar : renderCurrent)();
      switchAppPage('practice');
    }, kind);
    assert(await page.locator('.completion-mascot').isVisible());
    assert((await page.locator('.completion-mascot').boundingBox()).width >= 80);
    assert.equal(await page.locator('.review-result img').count(), 0);
    await page.evaluate(kind => {
      sessionReview[reviewKey(kind)].graduated = 1;
      (kind === 'grammar' ? renderCurrentGrammar : renderCurrent)();
    }, kind);
    assert.equal(await page.locator('.review-result img').count(), 1);
    assert.match(await page.locator('.review-result').innerText(), /1 問は克服/);
    await capture(page, `pomeranian-completion-${kind}.png`);
  }
  await page.evaluate(() => { dailyActivity.days[localDateStr()] = { a: 1, c: 1, gr: 0 }; switchAppPage('review'); });
  assert.equal(await page.locator('.review-today img').count(), 0);
  await page.evaluate(() => { dailyActivity.days[localDateStr()].gr = 2; renderReviewPage(); });
  assert.equal(await page.locator('.review-today img').count(), 1);
  assert.match(await page.locator('.review-today').innerText(), /2 問/);
});

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`home at ${width}px keeps images, labels and actions within their cards`, async t => {
    const { page } = await open(t, { width });
    for (const kind of ['vocab', 'grammar']) {
      await page.getByRole('tab', { name: kind === 'vocab' ? '単語' : '文法', exact: true }).click();
      const geometry = await page.evaluate(() => [...document.querySelectorAll('#home-page img,.home-main-actions button,.home-other-title,.home-main-book-title,.top-page-tabs')].map(el => {
        const r = el.getBoundingClientRect();
        return { name: el.className || el.tagName, left: r.left, right: r.right, w: r.width };
      }));
      for (const r of geometry) assert(r.left >= 0 && r.right <= width + 1 && r.w > 0, JSON.stringify(r));
      for (const img of await page.locator('#home-page img').all()) await img.evaluate(img => img.decode());
      await page.locator('.home-main-actions [data-home-action="continue-book"]').click();
      assert(await page.locator('#practice-page').isVisible());
      await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    }
    if (process.env.FEEDBACK_SCREENSHOT_DIR && [375, 1440].includes(width)) {
      await capture(page, `pomeranian-home-${width}.png`);
    }
  });
}

test('app icons decode at the advertised sizes and new assets are available offline', async t => {
  const { page, context } = await open(t);
  const icons = await page.evaluate(async () => {
    const manifest = await (await fetch('manifest.webmanifest')).json();
    return Promise.all(manifest.icons.map(async icon => {
      const img = new Image(); img.src = icon.src; await img.decode();
      return { ...icon, actual: `${img.naturalWidth}x${img.naturalHeight}` };
    }));
  });
  for (const icon of icons) { assert.match(icon.src, /pomeranian/); assert.equal(icon.actual, icon.sizes); }
  assert.match(await page.locator('link[rel="icon"]').getAttribute('href'), /pomeranian/);
  assert.match(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'), /pomeranian/);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  const results = await page.evaluate(async () => Promise.all(['neutral', 'streak', 'celebrate', 'course-kin', 'course-sekaiichi', 'course-polaris', 'course-toplevel', 'goal-target', 'vocab-teppan', 'vocab-daily', 'vocab-flashcards'].map(async name => {
    const response = await fetch(`assets/pomeranian/${name}.svg`);
    return response.ok && (await response.text()).includes('<svg');
  })));
  assert(results.every(Boolean));
});

test('exercise streak keeps its number beside the mascot', async t => {
  const { page } = await open(t, { theme: 'duolingo' });
  await page.evaluate(() => { switchAppPage('practice'); dismissNudge(); });
  const img = page.locator('.duo-stat-item[title="連続正解数"] img');
  assert.equal(await img.count(), 1);
  await page.evaluate(() => showDuoBanner(true, ''));
  assert.equal(await page.locator('#duo-streak-count').innerText(), '1');
});
