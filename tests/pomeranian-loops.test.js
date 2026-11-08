// マスコットの動きが「ずっと」ではなく、数秒で止まることの検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/pomeranian-loops.test.js
// 動き続けるアニメーションは、見ていない間も画面を描き直し続けて電池を使う。
// 動く楽しさは残したまま、約5秒で止める。回数は「ceil(5秒 ÷ 1周の秒数)」で決めてある。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'assets', 'pomeranian');
const MAX_TOTAL_SECONDS = 8; // 5秒を目安に、周期で切り上げた分の余裕を含めた上限
const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg')).sort();

// SVG の <style> から、動いている指定（animation: 名前 秒 … 回数）を取り出す
function animations(svg) {
  const out = [];
  for (const m of svg.matchAll(/animation:\s*([\w-]+)\s+([\d.]+)s([^;}]*)/g)) {
    const tokens = m[3].trim().split(/\s+/).filter(Boolean);
    const count = tokens.find(t => t === 'infinite' || /^\d+$/.test(t));
    out.push({ name: m[1], seconds: Number(m[2]), count });
  }
  return out;
}

test('マスコットのSVGに infinite が残っていない', () => {
  const offenders = files.filter(f => /\binfinite\b/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('マスコットのどの動きも、数回で終わり、合計が上限以内に収まる', () => {
  let checked = 0;
  for (const f of files) {
    const list = animations(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(list.length >= 1, `${f} に動きの指定がない（検査が空振りしている）`);
    for (const a of list) {
      checked++;
      assert.ok(a.count && a.count !== 'infinite', `${f} の ${a.name} に回数がない`);
      assert.ok(a.seconds * Number(a.count) <= MAX_TOTAL_SECONDS, `${f} の ${a.name} が長い: ${a.seconds}s × ${a.count}回`);
      assert.ok(a.seconds * Number(a.count) >= 4, `${f} の ${a.name} がすぐ止まる: ${a.seconds}s × ${a.count}回`);
    }
  }
  assert.ok(checked >= files.length, `動きの指定が少なすぎる: ${checked}`);
});

test('絞り込みボタンの脈動も、数回で止まる', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'app.css'), 'utf8');
  const m = css.match(/\.filter-toggle\.pulse-glow\s*\{[^}]*animation:\s*filterBtnPulse\s+([\d.]+)s([^;]*);/);
  assert.ok(m, 'filterBtnPulse の指定が見つからない');
  assert.ok(!/infinite/.test(m[2]), 'filterBtnPulse が infinite');
  assert.ok(/\b\d+\b/.test(m[2]), 'filterBtnPulse に回数がない');
});

// ---- 実際に止まるか（ブラウザ） ----
const { chromium } = require('playwright');
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

async function distinctFrames(img, page) {
  const hashes = new Set();
  for (let i = 0; i < 4; i++) {
    hashes.add(createHash('sha256').update(await img.screenshot({ animations: 'allow' })).digest('hex'));
    await page.waitForTimeout(170);
  }
  return hashes.size;
}

test('ホームのマスコットは、最初は動き、約8秒後には止まる', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'no-preference' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  await page.goto(base + '/index.html#home');
  await page.evaluate(() => { dismissNudge(); dailyActivity.days = {}; switchAppPage('home'); renderHomePage(); });
  const img = page.locator('#app img[src="assets/pomeranian/neutral.svg"]').filter({ visible: true }).first();
  await img.evaluate(img => img.decode());
  await page.waitForTimeout(300);
  assert.ok(await distinctFrames(img, page) > 1, '最初は動いているはず');
  await page.waitForTimeout(MAX_TOTAL_SECONDS * 1000);
  assert.equal(await distinctFrames(img, page), 1, `${MAX_TOTAL_SECONDS}秒たっても止まらない`);
});
