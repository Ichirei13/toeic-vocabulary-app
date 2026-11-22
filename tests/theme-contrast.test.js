// NODE_PATH=$(npm root -g) node tests/theme-contrast.test.js
// 設定画面と、暗い固定配色のシート（バックアップ）で、文字が背景に埋もれていないかを全テーマで確かめる。
// 設定画面のカードはテーマによらず濃いチャコール（--fd-surface）なので、明るいテーマ（セピア）で
// 文字色だけテーマの濃い色を引き継ぐと読めなくなる（2026-11-22 に見つかった不具合）。
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

const THEMES = ['ink', 'duolingo', 'navy', 'quizlet', 'forest', 'nordic', 'light', 'ios'];
// 文字と背景の明るさの比（WCAG のコントラスト比）の下限。大きな文字の AA 基準に合わせて 3。
const MIN_RATIO = 3;
// 今回の範囲外で、もともと薄いもの。直したらここを消す
// - quizlet: マスコット説明の文字が 2.91
// - ios（端末がライト）: 設定画面の「標準に戻す」などの操作ボタンが 1.32（灰色の文字が明るい背景に乗る）、
//   バックアップのシートの「設定に戻る」が 2.28
const KNOWN_LOWER = { quizlet: 2.5, 'ios (light)': 1.3 };

// ページの中で、見えている文字ごとに「文字色」と「実際に塗られている背景色」の比を測り、低いものを返す
function measure({ selector, limit }) {
  const parse = c => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => [r, g, b]
    .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bgOf = el => {
    for (; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.5) return c;
      if (cs.backgroundImage !== 'none') {
        const g = parse((cs.backgroundImage.match(/rgba?\([^)]+\)/) || [])[0]);
        if (g && g.a > 0.5) return g;
      }
    }
    return null;
  };
  const low = [];
  for (const el of document.querySelectorAll(`${selector} *`)) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden') continue;
    const text = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!text) continue;
    const fg = parse(getComputedStyle(el).color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    if (ratio < limit) low.push(`${text.slice(0, 20)}（${ratio.toFixed(2)}）`);
  }
  return low;
}

let browser, base;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function open(theme, colorScheme, fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme, reducedMotion: 'reduce' });
  await context.addInitScript(theme => localStorage.setItem('toeic_app_theme', theme), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/index.html#settings');
  // テーマの切り替えや開く動きの途中の色を測らないよう、動きを止める
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  try { await fn(page); } finally { await context.close(); }
  assert.deepEqual(errors, []);
}

for (const theme of THEMES) {
  for (const colorScheme of ['light', 'dark']) {
    const limit = KNOWN_LOWER[`${theme} (${colorScheme})`] || KNOWN_LOWER[theme] || MIN_RATIO;
    test(`${theme} (${colorScheme}): settings page text is readable`, () => open(theme, colorScheme, async page => {
      await page.waitForSelector('#settings-page .settings-section');
      const low = await page.evaluate(measure, { selector: '#settings-page', limit });
      assert.deepEqual(low, [], `設定画面に読みにくい文字がある: ${low.slice(0, 5).join(' / ')}`);
    }));
    test(`${theme} (${colorScheme}): backup sheet text is readable`, () => open(theme, colorScheme, async page => {
      await page.evaluate(() => openBackupFromSettings());
      await page.waitForSelector('#bottom-sheet.open.sheet-fixed-dark');
      const low = await page.evaluate(measure, { selector: '#bottom-sheet', limit });
      assert.deepEqual(low, [], `バックアップのシートに読みにくい文字がある: ${low.slice(0, 5).join(' / ')}`);
    }));
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  let failed = 0;
  try {
    for (const [name, fn] of tests) {
      try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e.message.split('\n')[0]}`); }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  process.exitCode = failed ? 1 : 0;
})();
