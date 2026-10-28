// NODE_PATH=<bundled node_modules> node --test tests/next-responsive.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let browser, base;
const PREFIX = '/toeic-vocabulary-app';
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  if (!pathname.startsWith(PREFIX + '/')) return res.writeHead(404).end();
  let file = path.resolve(root, '.' + pathname.slice(PREFIX.length));
  if (!file.startsWith(root + path.sep)) return res.writeHead(404).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}${PREFIX}/next/`;
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

test('normal exercise remembers conditions but individual review does not overwrite them', async t => {
 const page=await open(t,'setup/grammar/kin',1280,900);
 await page.locator('#count').selectOption('20');
 await page.locator('[name="chapters"][value="2"]').check();
 await page.locator('#setup-form [type="submit"]').click();
 await page.locator('.choice').first().waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('toeic_next_v1')).preferences.recentPreset),'grammar:kin');
 await page.locator('[data-action="dont-know"]').click();
 await page.goto(base+'#review');
 await page.locator('.review-item summary').first().click();
 await page.locator('[data-action="review-one"]').first().click();
 await page.locator('.choice').first().waitFor();
 await page.goto(base+'#setup/grammar/kin');
 await page.locator('#count').waitFor();
 assert.equal(await page.locator('#count').inputValue(),'20');
 assert.ok(await page.locator('[name="chapters"][value="2"]').isChecked());
 await page.reload();
 await page.locator('#count').waitFor();
 assert.equal(await page.locator('#count').inputValue(),'20');
});

test('daily goal, calendar, backup and settings persist without counting a reload',async t=>{
 const page=await open(t);
 assert.ok(await page.locator('[data-action="open-calendar"]').isVisible());
 await page.locator('[data-action="open-calendar"]').click();
 await page.getByRole('dialog',{name:'学習カレンダー'}).waitFor();
 await page.locator('[data-action="calendar-prev"]').click();
 assert.match(await page.locator('#calendar-month').innerText(),/年/);
 await page.keyboard.press('Escape');
 await page.locator('[data-action="quick-start"]').click();
 await page.locator('.choice').first().waitFor();
 await page.locator('[data-action="dont-know"]').click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('toeic_next_v1')).activity);
 await page.reload();await page.locator('.question-text').waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('toeic_next_v1')).activity),before);
 await page.goto(base+'#settings');await page.locator('#daily-goal').waitFor();
 await page.locator('#daily-goal').selectOption('5');await page.reload();await page.locator('#daily-goal').waitFor();
 assert.equal(await page.locator('#daily-goal').inputValue(),'5');
});
