// NODE_PATH=$(npm root -g) node --test tests/pomeranian-placement.test.js
// 追加ポーズを画面に出し分けるところと、動きを減らす設定用の静止版を確かめる。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const assetDir = path.join(root, 'assets', 'pomeranian');
const poses = fs.readdirSync(assetDir).filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, ''));
let browser, base;
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

// hour: 案内役のポーズは時刻で変わるので、テストごとに固定する
async function open(t, { motion = 'reduce', hour = 12, width = 375 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 812 }, reducedMotion: motion, timezoneId: 'Asia/Tokyo' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.clock.setFixedTime(new Date(`2026-11-07T${String(hour).padStart(2, '0')}:00:00+09:00`));
  await page.goto(base + '/index.html#home');
  await page.evaluate(() => dismissNudge());
  return page;
}

async function frames(page, img) {
  await page.waitForTimeout(300);
  const hashes = new Set();
  for (let i = 0; i < 4; i++) {
    hashes.add(createHash('sha256').update(await img.screenshot({ animations: 'allow' })).digest('hex'));
    await page.waitForTimeout(170);
  }
  return hashes.size;
}

const currentPose = async locator => (await locator.getAttribute('src')).replace(/^.*\/|\.svg$/g, '');

test('every pose has a still version without animation, and the generator is up to date', () => {
  assert(poses.length >= 48);
  for (const pose of poses) {
    const still = fs.readFileSync(path.join(assetDir, 'still', `${pose}.svg`), 'utf8');
    assert(!/<style|@keyframes|<animate/.test(still), `${pose} の静止版にアニメーションが残っている`);
    assert(/<svg[^>]*viewBox/.test(still), `${pose} の静止版が SVG として壊れている`);
  }
  execFileSync('python3', [path.join(root, 'scripts', 'make-pomeranian-stills.py'), '--check']);
});

test('pomeranianImage picks the still for every pose in reduced motion', async t => {
  const page = await open(t);
  const wrong = await page.evaluate(async poses => {
    const out = [];
    for (const pose of poses) {
      const holder = document.createElement('div');
      holder.innerHTML = pomeranianImage(pose, 'test-pose', 40);
      document.body.append(holder);
      const img = holder.querySelector('img');
      await img.decode();
      if (!img.currentSrc.endsWith(`/still/${pose}.svg`)) out.push(pose);
      holder.remove();
    }
    return out;
  }, poses);
  assert.deepEqual(wrong, []);
});

for (const pose of ['sad-cry', 'praise-dance', 'status-timer', 'vocab-type']) {
  test(`${pose}: moves normally and holds still in reduced motion`, async t => {
    const page = await open(t, { motion: 'no-preference' });
    const img = await page.evaluate(async pose => {
      document.body.insertAdjacentHTML('beforeend', `<div id="probe" style="position:fixed;left:20px;top:20px;z-index:9999;background:#fff">${pomeranianImage(pose, 'probe-pose', 96)}</div>`);
      await document.querySelector('#probe img').decode();
    }, pose).then(() => page.locator('#probe img'));
    assert((await frames(page, img)) > 1, `${pose} が動いていない`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(pose => document.querySelector('#probe img').currentSrc.endsWith(`/still/${pose}.svg`), pose);
    await img.evaluate(img => img.decode());
    assert.equal(await frames(page, img), 1, `${pose} が静止しない`);
  });
}

test('answer feedback rotates poses, escalates with streaks, and keeps reviews plain', async t => {
  const page = await open(t);
  const poseOf = (isCorrect, opts) => page.evaluate(([isCorrect, opts]) => {
    showDuoBanner(isCorrect, 'x', opts);
    return document.querySelector('#duo-banner-icon img').getAttribute('src').replace(/^.*\/|\.svg$/g, '');
  }, [isCorrect, opts || {}]);
  await page.evaluate(() => { setApp('vocab'); switchAppPage('practice'); dismissNudge(); duoStreak = 0; duoMiss = 0; });

  const correct = [];
  for (let i = 0; i < 4; i++) correct.push(await poseOf(true));
  assert.deepEqual([...correct].sort(), ['encourage', 'praise-clap', 'praise-heart', 'praise-highfive'], `連続正解1〜4問目: ${correct}`);
  assert.equal(await poseOf(true), 'praise-star-eyes', '5問連続');
  for (let i = 0; i < 4; i++) await poseOf(true);
  assert.equal(await poseOf(true), 'praise-dance', '10問連続');

  const wrong = [];
  for (let i = 0; i < 2; i++) wrong.push(await poseOf(false));
  assert(wrong.every(p => ['reflect', 'sad-sweat', 'sad-tears', 'sad-bandage'].includes(p)), `1〜2問連続の不正解: ${wrong}`);
  assert(['sad-cry', 'sad-rain'].includes(await poseOf(false)), '3問連続の不正解');

  assert.equal(await poseOf(true, { review: true }), 'encourage', '見直しは基本のポーズ');
  assert.equal(await poseOf(false, { review: true }), 'reflect');
  assert.equal(await poseOf(false, { skipped: true }), 'reflect', 'スキップは励ましを強めない');
  assert.equal(await poseOf(true, { flash: true }), 'encourage');

  await page.evaluate(() => showDuoBanner(true, 'x'));
  const img = page.locator('#duo-banner-icon img');
  await img.evaluate(img => img.decode());
  assert((await img.evaluate(img => img.currentSrc)).includes('/still/'), '動きを減らす設定では静止版');
  assert.equal(await frames(page, img), 1);
});

test('home guide: night and late-night override, otherwise the message decides', async t => {
  const page = await open(t);
  assert.deepEqual(await page.evaluate(() => [
    homeGuidePose({ pose: 'speed-bolt' }, 3, 12), homeGuidePose({}, 3, 12), homeGuidePose({}, 0, 12),
    homeGuidePose({ pose: 'speed-bolt' }, 3, 22), homeGuidePose({}, 0, 23), homeGuidePose({ pose: 'speed-bolt' }, 3, 0), homeGuidePose({}, 3, 4), homeGuidePose({}, 3, 5)
  ]), ['speed-bolt', 'streak', 'neutral', 'status-night', 'status-night', 'status-sleep', 'status-sleep', 'streak']);
});

for (const [hour, expected] of [[12, 'speed-bolt'], [23, 'status-night'], [2, 'status-sleep']]) {
  test(`home at ${hour}:00 shows ${expected} in the message bar`, async t => {
    const page = await open(t, { hour });
    await page.evaluate(() => {
      dailyActivity.days = { [localDateStr()]: { a: 3, c: 3, fast: 2, sec: 6, g: 0 } };
      prefs.dailyGoal = 0;
      // 先頭のメッセージ（連続日数）の次、即答のメッセージを出す
      praiseRotationIndex = 1;
      renderHomePage();
    });
    assert.match(await page.locator('.home-message-text').innerText(), /即答/);
    assert.equal(await currentPose(page.locator('.home-message-bar img')), expected);
    await page.locator('.home-message-bar img').evaluate(img => img.decode());
    assert((await page.locator('.home-message-bar img').evaluate(img => img.currentSrc)).includes('/still/'));
  });
}

test('home goal row follows the goal level, and weak section has its own pose', async t => {
  const page = await open(t);
  const row = () => currentPose(page.locator('.home-goal-row img'));
  for (const [goal, expected] of [[0, 'goal-0-relaxed'], [5, 'goal-5-casual'], [10, 'goal-target'], [20, 'goal-20-active'], [30, 'goal-30-intense']]) {
    await page.evaluate(goal => { dailyActivity.days = {}; prefs.dailyGoal = goal; renderHomePage(); }, goal);
    assert.equal(await row(), expected, `目標${goal}問`);
  }
  assert.equal(await currentPose(page.locator('.home-weak-title img')), 'status-search');
});

test('settings, goal calendar, tips and typing mode use their own poses and the gallery count is real', async t => {
  const page = await open(t);
  await page.evaluate(() => switchAppPage('settings'));
  assert.equal(await currentPose(page.locator('#setting-goal-mascot-img')), 'goal-target');
  await page.evaluate(() => { prefs.dailyGoal = 30; syncGoalChips(); });
  assert.equal(await currentPose(page.locator('#setting-goal-mascot-img')), 'goal-30-intense');
  assert.equal(await page.locator('#setting-goal-mascot-img').evaluate(img => img.closest('picture').querySelector('source').srcset.endsWith('/still/goal-30-intense.svg')), true);
  assert.equal(await currentPose(page.locator('.settings-menu-mascot').first()), 'cloud-sync');

  const heading = await page.locator('#pome-gallery-section .settings-section-title').innerText();
  const cards = await page.locator('.pome-gallery-card').count();
  assert.equal(Number(heading.match(/全(\d+)ポーズ/)[1]), cards, '図鑑の見出しの数と並んでいる数が違う');
  assert.equal(cards, poses.length, '図鑑に載っていない素材がある');

  await page.evaluate(() => { switchAppPage('home'); document.querySelector('.home-goal-row').click(); });
  assert.equal(await currentPose(page.locator('.goal-dialog-mascot')), 'goal-calendar');

  const tip = await page.evaluate(() => tipHtml({ w: Object.keys(WORD_TIPS)[0] }, false));
  assert.match(tip, /status-idea\.svg/);
  assert.match(tip, /豆知識/);

  await page.evaluate(() => { setApp('vocab'); state.mode = 'type'; switchAppPage('practice'); dismissNudge(); renderCurrent(); });
  assert.equal(await currentPose(page.locator('.type-input-container img')), 'vocab-type');
});

test('goal row and review use trophy and medal when achieved', async t => {
  const page = await open(t);
  await page.evaluate(() => { dailyActivity.days[localDateStr()] = { a: 10, c: 9, gr: 2, g: 10 }; prefs.dailyGoal = 10; renderHomePage(); });
  assert.equal(await currentPose(page.locator('.home-goal-row img')), 'praise-trophy');
  await page.evaluate(() => switchAppPage('review'));
  assert.equal(await currentPose(page.locator('.review-today img')), 'praise-medal');
});

test('pomodoro mascot changes only when the pose changes', async t => {
  const page = await open(t);
  await page.evaluate(() => switchAppPage('timer'));
  const img = page.locator('#pomo-mascot-img');
  assert.equal(await currentPose(img), 'pomo-tomato');
  const same = await img.evaluate(img => {
    img.dataset.keep = '1';
    const before = img.getAttribute('src');
    for (let i = 0; i < 5; i++) updatePomoLiveDOM();
    return img.dataset.keep === '1' && img.getAttribute('src') === before && !img.classList.contains('pome-pop');
  });
  assert(same, '同じポーズなのに絵を入れ直している');
  assert.equal(await img.evaluate(img => !!img.closest('picture')?.querySelector('source')), true);
});
