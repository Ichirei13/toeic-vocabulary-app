// ラベリング機能のブラウザテスト（tests/labels-*.test.js）が共通で使う、静的サーバと Playwright の土台。
// 作りは tests/sheets.test.js と同じ。リポジトリ直下を配信し、index.html を Chromium で操作する。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

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
const tests = [];

function test(name, fn) {
  tests.push([name, fn]);
}

// storage: 最初に開く前に localStorage に入れておく値。fn(page, context)
async function withPage(storage, fn) {
  const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
  await context.addInitScript(items => {
    try {
      if (sessionStorage.getItem('__test_init')) return;
      sessionStorage.setItem('__test_init', '1');
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) { /* 使えなければ何もしない */ }
  }, storage || {});
  const page = await openPage(context);
  try {
    await fn(page, context);
  } finally {
    await context.close();
  }
}

async function openPage(context) {
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(baseUrl + '/index.html');
  return page;
}

async function run() {
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
      console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`);
    }
  }
  if (pageErrors.length) console.log(`FAIL page_errors\n     ${pageErrors.slice(0, 5).join('\n     ')}`);
  await browser.close();
  server.close();
  console.log(`${tests.length - failed}/${tests.length} tests passed${pageErrors.length ? ', page errors present' : ''}`);
  process.exit(failed || pageErrors.length ? 1 : 0);
}

module.exports = { test, withPage, openPage, run };
