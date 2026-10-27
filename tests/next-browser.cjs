// NODE_PATH=<bundled node_modules> node tests/next-browser.cjs
// Uses the installed Chrome with a temporary, isolated profile. No user browser state.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const KEY = 'toeic_next_v1';
const PREFIX = '/toeic-vocabulary-app';
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith(PREFIX + '/')) return res.writeHead(404).end();
  let file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname.slice(PREFIX.length)));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return res.writeHead(404).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
});
const legacy = { toeic_grammar_stats: '{"1001":{"a":4,"c":2}}', toeic_weak_grammar: '{"1001":{"streak":0,"added":1,"due":1,"u":1}}',
  toeic_gdrive_linked: '1', toeic_gdrive_autosync: '1', toeic_app_theme: 'navy', toeic_settings: '{"app":"grammar"}' };
const reports = [];
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin + PREFIX;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const external = [];
  context.on('request', req => { if (!req.url().startsWith(origin)) external.push(req.url()); });
  await context.addInitScript(items => {
    if (!localStorage.getItem('__seeded_next_test')) {
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
      localStorage.setItem('__seeded_next_test', '1');
    }
  }, legacy);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/next/');
  await page.getByRole('heading', { name: 'おかえりなさい。' }).waitFor();
  assert.equal(await page.locator('.book-card').count(), 4);
  assert.equal(await page.locator('.count').innerText(), '1問');
  await page.screenshot({ path: '/tmp/study-desk-home.png', fullPage: true });
  reports.push('ホーム・公開版の教材4種・既存記録の初回コピー');
  await page.getByRole('link', { name: /金の文法/ }).click();
  await page.locator('[name="chapters"][value="1"]').check();
  await page.locator('[name="chapters"][value="2"]').check();
  await page.getByRole('button', { name: '10問を始める' }).click();
  await page.locator('.choice').first().waitFor();
  const question = await page.locator('.question-text').innerText();
  await page.keyboard.press('0');
  await page.getByRole('heading', { name: '答えを確認しましょう' }).waitFor();
  const raw = await page.evaluate(key => localStorage.getItem(key), KEY);
  const parsed = JSON.parse(raw);
  assert.equal(Object.keys(parsed.session.answers).length, 1);
  await page.screenshot({ path: '/tmp/study-desk-exercise.png', fullPage: true });
  await page.reload();
  assert.equal(await page.locator('.question-text').innerText(), question);
  await page.getByRole('heading', { name: '答えを確認しましょう' }).waitFor();
  assert.equal(await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key)).session.answers).length, KEY), 1);
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('button', { name: '前の問題' }).click();
  assert.equal(await page.locator('.question-text').innerText(), question);
  await page.getByRole('button', { name: '次へ' }).click();
  reports.push('複数章選択・解答・再読込・前へ・二重採点防止');
  for (let i = 1; i < 10; i++) {
    await page.getByRole('button', { name: 'わからない', exact: true }).click();
    await page.getByRole('button', { name: i === 9 ? '結果を見る' : '次へ' }).click();
  }
  await page.getByRole('heading', { name: 'おつかれさまでした。' }).waitFor();
  await page.getByRole('button', { name: '間違えた10問をもう一度' }).click();
  assert.equal(await page.locator('.progress-row').innerText().then(t => t.includes('1 / 10')), true);
  reports.push('10問完了・結果・誤答だけ再演習');
  for (const mode of ['e2j', 'j2e', 'flash', 'type']) {
    await page.goto(base + '/next/#setup/vocab/daily');
    await page.locator('#mode').selectOption(mode);
    await page.getByRole('button', { name: '10問を始める' }).click();
    if (mode === 'flash') {
      await page.getByRole('button', { name: '意味を見る' }).click();
      await page.getByRole('button', { name: '覚えていた', exact: true }).click();
    } else if (mode === 'type') {
      const answer = await page.evaluate(key => {
        const s = JSON.parse(localStorage.getItem(key)).session;
        return RAW_WORDS[Number(s.ids[0].slice(2))].w;
      }, KEY);
      await page.locator('#typed-answer').fill(answer);
      await page.locator('#typed-answer').press('Enter');
    } else {
      await page.locator('.choice').first().waitFor();
      const correct = await page.evaluate(key => {
        const s = JSON.parse(localStorage.getItem(key)).session;
        return s.choices[s.ids[0]].correct;
      }, KEY);
      await page.keyboard.press(String(correct + 1));
    }
    await page.getByRole('heading', { name: '✓ 正解です' }).waitFor();
  }
  reports.push('単語4モード・キーボード回答・タイプ判定');
  await page.goto(base + '/next/#review');
  await page.locator('.review-item').first().locator('summary').click();
  await page.locator('.review-item').first().getByRole('button', { name: 'この問題を解く' }).click();
  assert.ok((await page.locator('.progress-row').innerText()).includes('1 / 1'));
  reports.push('苦手一覧・個別復習');
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 768 ? 375 : 900 });
    for (const route of ['home', 'setup/grammar/kin', 'exercise', 'review', 'settings']) {
      await page.goto(base + '/next/#' + route);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width} ${route}`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base + '/next/#home');
  await page.screenshot({ path: '/tmp/study-desk-mobile.png', fullPage: true });
  await page.goto(base + '/next/#settings');
  await page.getByRole('button', { name: 'ダーク', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.goto(base + '/next/#exercise');
  await page.screenshot({ path: '/tmp/study-desk-dark.png', fullPage: true });
  await page.addStyleTag({ content: ':root { font-size: 32px !important; }' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text overflow');
  reports.push('375/768/1024/1440px・横向き・200%文字・ダーク・reduced motion');
  const savedLegacy = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(legacy));
  assert.deepEqual(savedLegacy, legacy);
  assert.deepEqual(external, []);
  reports.push('従来版の全対象キーが不変・外部通信ゼロ');
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The existing root worker removes all other cache names on activation.
  // Installing it after the trial must retain trial assets AND its own root assets.
  await page.evaluate(async () => {
    const cache = await caches.open('toeic-drill-v1');
    await cache.put('../legacy-sentinel', new Response('untouched'));
    const registration = await navigator.serviceWorker.register('../sw.js', { scope: '../' });
    if (!registration.active) await new Promise(resolve => {
      const worker = registration.installing || registration.waiting;
      if (worker.state === 'activated') resolve();
      else worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); });
    });
    if (await (await cache.match('../legacy-sentinel')).text() !== 'untouched') throw new Error('Legacy cache changed');
    const keys = await cache.keys();
    if (!keys.some(k => k.url.includes('/next/__offline__/'))) throw new Error('Trial cache evicted');
  });
  await context.setOffline(true);
  await page.reload();
  await page.locator('.question-text').waitFor();
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await page.getByRole('button', { name: '結果を見る' }).click();
  reports.push('従来版のSW有効化後も試用版のオフライン再読込・解答・従来キャッシュ保持');
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(reports.map(x => 'PASS ' + x).join('\n'));
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
