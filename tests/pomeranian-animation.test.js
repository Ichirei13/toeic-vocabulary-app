// NODE_PATH=$(npm root -g) node --test tests/pomeranian-animation.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser, base;
const poses = ['neutral', 'encourage', 'reflect', 'celebrate', 'streak'];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

async function open(t, motion, seedOldCache = false) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: motion });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  if (seedOldCache) {
    await page.goto(base + '/icons/pomeranian-192.png');
    await page.evaluate(async () => {
      localStorage.setItem('animation-test-record', 'keep');
      const oldCache = await caches.open('toeic-drill-v1');
      await oldCache.put('/assets/pomeranian/neutral.svg', new Response('old-still-image'));
    });
  }
  await page.goto(base + '/index.html#home');
  await page.evaluate(() => dismissNudge());
  return { page, context };
}

async function show(page, pose) {
  await page.evaluate(pose => {
    if (pose === 'neutral') {
      dailyActivity.days = {}; switchAppPage('home'); renderHomePage();
    } else if (pose === 'streak') {
      dailyActivity.days[localDateStr()] = { a: 1, c: 1, fast: 0, sec: 1 };
      switchAppPage('home'); renderHomePage();
    } else if (pose === 'celebrate') {
      setApp('vocab'); state.currentIndex = state.pool.length;
      renderCurrent(); switchAppPage('practice');
    } else {
      setApp('vocab'); switchAppPage('practice'); dismissNudge();
      showDuoBanner(pose === 'encourage', 'sample');
    }
  }, pose);
  const img = page.locator(`#app img[src="assets/pomeranian/${pose}.svg"]`).filter({ visible: true }).first();
  await img.evaluate(img => img.decode());
  return img;
}

async function frames(page, img) {
  // バナー等の登場アニメーションが終わってから、画像だけの画素変化を比較する。
  await page.waitForTimeout(400);
  const hashes = new Set();
  for (let i = 0; i < 4; i++) {
    hashes.add(createHash('sha256').update(await img.screenshot({ animations: 'allow' })).digest('hex'));
    await page.waitForTimeout(170);
  }
  return hashes.size;
}

for (const pose of poses) {
  test(`${pose}: animates normally and stays still with reduced motion`, async t => {
    const { page } = await open(t, 'no-preference');
    const img = await show(page, pose);
    assert((await frames(page, img)) > 1, `${pose} が動いていない`);
    const before = await img.boundingBox();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(pose => [...document.querySelectorAll('img')].some(img => img.currentSrc.endsWith(`/still/${pose}.svg`)), pose);
    await img.evaluate(img => img.decode());
    assert.equal(await frames(page, img), 1, `${pose} が静止しない`);
    const after = await img.boundingBox();
    assert.deepEqual(after, before, '静止版への切り替えで画像の場所や大きさが変わった');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await img.evaluate(img => img.decode());
    assert((await frames(page, img)) > 1, '設定を戻しても動きが再開しない');
  });
}

test('answer feedback changes both poses and their still alternatives', async t => {
  const { page } = await open(t, 'reduce');
  await show(page, 'encourage');
  const correct = page.locator('#duo-banner-icon img');
  assert((await correct.evaluate(img => img.currentSrc)).endsWith('/still/encourage.svg'));
  await page.evaluate(() => showDuoBanner(false, 'sample'));
  await correct.evaluate(img => img.decode());
  assert((await correct.evaluate(img => img.currentSrc)).endsWith('/still/reflect.svg'));
  assert.equal(await frames(page, correct), 1);
});

test('header streak also selects the still image in reduced motion', async t => {
  const { page } = await open(t, 'reduce');
  await page.evaluate(() => { setAppTheme('duolingo'); switchAppPage('practice'); dismissNudge(); });
  const img = page.locator('.duo-status img');
  await img.evaluate(img => img.decode());
  assert((await img.evaluate(img => img.currentSrc)).endsWith('/still/streak.svg'));
  assert.equal(await frames(page, img), 1);
});

test('new cache replaces outdated images while keeping learning records and still images offline', async t => {
  const { page, context } = await open(t, 'reduce', true);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.equal(await page.evaluate(async () => (await caches.keys()).includes('toeic-drill-v1')), false);
  await context.setOffline(true);
  const result = await page.evaluate(async poses => ({
    record: localStorage.getItem('animation-test-record'),
    poses: await Promise.all(poses.map(async pose => {
      const response = await fetch(`assets/pomeranian/still/${pose}.svg`);
      const svg = await response.text();
      return response.ok && svg.includes('<svg') && !svg.includes('@keyframes');
    })),
  }), poses);
  assert.equal(result.record, 'keep');
  assert.deepEqual(result.poses, [true, true, true, true, true]);
});
