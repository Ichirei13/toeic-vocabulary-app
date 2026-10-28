// NODE_PATH=<bundled node_modules> node --test tests/next-responsive.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let browser, base;
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(404).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/next/`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => { await browser?.close(); server.close(); });
async function open(t, route = 'home', width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  await page.goto(base + '#' + route);
  await page.locator('main h1').waitFor();
  return page;
}
async function inside(page, locator) {
  const b = await locator.boundingBox();
  assert.ok(b && b.y >= 0 && b.y + b.height <= page.viewportSize().height, `control outside viewport: ${JSON.stringify(b)}`);
}

test('mobile home reaches a textbook without scrolling and quick start begins an exercise', async t => {
  const page = await open(t);
  await inside(page, page.locator('.book-card').first());
  await page.getByRole('button', { name: '10問から始める' }).click();
  assert.equal(new URL(page.url()).hash, '#exercise');
  await page.locator('.choice').first().waitFor();
  assert.equal(await page.locator('.choice').count(), 4);
});

test('setup start stays visible at small sizes and after scrolling', async t => {
  const page = await open(t, 'setup/grammar/kin', 375, 667);
  await inside(page, page.locator('#setup-form [type="submit"]'));
  assert.ok(await page.getByRole('button', { name: /絞り込み/ }).isVisible());
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await inside(page, page.locator('#setup-form [type="submit"]'));
});

test('filter sheet cancels edits, applies chapters to the actual session, and restores focus', async t => {
  const page = await open(t, 'setup/grammar/kin');
  const trigger = page.getByRole('button', { name: /絞り込み/ });
  assert.ok(await trigger.isVisible());
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '絞り込み' });
  await dialog.locator('[name="chapters"][value="1"]').check();
  await page.keyboard.press('Escape');
  assert.ok(await trigger.evaluate(el => el === document.activeElement));
  await trigger.click();
  assert.equal(await dialog.locator('[name="chapters"][value="1"]').isChecked(), false);
  await dialog.locator('[name="chapters"][value="2"]').check();
  await dialog.getByRole('button', { name: /適用/ }).click();
  await page.locator('#setup-form [type="submit"]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('toeic_next_v1')).session);
  assert.deepEqual(saved.config.chapters, [2]);
  assert.ok(await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('toeic_next_v1')).session;
    return s.ids.every(id => RAW_GRAMMAR.find(g => 'g:' + g.id === id)?.ch === 2);
  }));
});

test('resizing preserves pending filters, keeps one input set, and allows explicit cancel', async t => {
  const page = await open(t, 'setup/grammar/kin');
  const trigger = page.getByRole('button', { name: /絞り込み/ });
  assert.ok(await trigger.isVisible());
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '絞り込み' });
  await dialog.locator('[name="chapters"][value="1"]').check();
  await page.setViewportSize({ width: 1200, height: 800 });
  assert.ok(await dialog.locator('[name="chapters"][value="1"]').isChecked());
  assert.equal(await page.locator('[name="chapters"][value="1"]').count(), 1);
  await dialog.getByRole('button', { name: /適用/ }).click();
  assert.ok(await page.locator('#filter-inline [name="chapters"][value="1"]').isChecked());
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await dialog.getByRole('button', { name: '解除', exact: true }).click();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await trigger.click();
  assert.ok(await dialog.locator('[name="chapters"][value="1"]').isChecked());
  await page.goto(base + '#home');
  assert.equal(await page.locator('dialog[open]').count(), 0);
});

test('empty filters cannot start, reset restores the pool, and focus stays in sheet', async t => {
  const page = await open(t, 'setup/vocab/teppan', 320, 568);
  const trigger = page.getByRole('button', { name: /絞り込み/ });
  assert.ok(await trigger.isVisible());
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '絞り込み' });
  await dialog.locator('[name="filter"]').selectOption('weak');
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
  }
  await inside(page, dialog.getByRole('button', { name: /適用/ }));
  await dialog.getByRole('button', { name: /適用/ }).click();
  assert.ok(await page.locator('#setup-form [type="submit"]').isDisabled());
  await trigger.click();
  await dialog.getByRole('button', { name: '解除', exact: true }).click();
  await dialog.getByRole('button', { name: /適用/ }).click();
  assert.equal(await page.locator('#setup-form [type="submit"]').isDisabled(), false);
});

test('desktop displays filters alongside basic settings and mobile settings expose backups', async t => {
  const page = await open(t, 'setup/grammar/kin', 1280, 900);
  assert.ok(await page.locator('#filter-inline').isVisible());
  const basic = await page.locator('#source').boundingBox();
  const filter = await page.locator('#filter').boundingBox();
  assert.ok(filter.x > basic.x + basic.width);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '#settings');
  await inside(page, page.locator('#backup-section h2'));
  await page.locator('.theme-disclosure > summary').click();
  await page.locator('[data-theme-id="duolingo"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'duolingo');
});

test('typing in a short mobile viewport is not covered by the exercise dock', async t => {
  const page = await open(t, 'setup/vocab/daily');
  await page.locator('#mode').selectOption('type');
  await page.locator('#setup-form [type="submit"]').click();
  await page.locator('#typed-answer').waitFor();
  await page.setViewportSize({ width: 390, height: 350 });
  await page.locator('#typed-answer').fill('example');
  assert.equal(await page.locator('.exercise-actions').isVisible(), false);
  await page.locator('#type-form button').scrollIntoViewIfNeeded();
  await inside(page, page.locator('#type-form button'));
  await page.locator('#type-form button').focus();
  assert.equal(await page.locator('.exercise-actions').isVisible(), false);
  await page.locator('#type-form button').press('Enter');
  await page.locator('.answer-panel').waitFor();
});

test('all themes reflow with large text and filter actions remain reachable', async t => {
  const page = await open(t, 'setup/vocab/teppan', 320, 568);
  for (const theme of ['light', 'dark', 'duolingo', 'ink', 'navy', 'quizlet', 'forest', 'nordic', 'sepia']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole('button', { name: /絞り込み/ }).click();
    const style = await page.addStyleTag({ content: ':root { font-size:32px !important; }' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const dialog = page.getByRole('dialog', { name: '絞り込み' });
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    await inside(page, dialog.getByRole('button', { name: /適用/ }));
    await style.evaluate(el => el.remove());
    await page.keyboard.press('Escape');
  }
});

test('desktop multi-selection keeps the filter list scroll position', async t => {
  const page = await open(t, 'setup/vocab/teppan', 1280, 800);
  const target = page.locator('[name="ranges"]').last();
  await target.scrollIntoViewIfNeeded();
  const before = await page.locator('#filter-inline .filter-fields').evaluate(el => el.scrollTop);
  assert.ok(before > 100);
  await target.check();
  const after = await page.locator('#filter-inline .filter-fields').evaluate(el => el.scrollTop);
  assert.ok(Math.abs(before - after) < 2, `list jumped from ${before} to ${after}`);
  assert.ok(await target.isChecked());
});
