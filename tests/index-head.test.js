// 起動時の外部通信の検証: フォント（Nunito）は Duolingo テーマのときだけ読み込む。
// 実行: NODE_PATH=$(npm root -g) node --test tests/index-head.test.js
// Nunito を使うのは Duolingo テーマだけ（css/app.css）。既定の iOS テーマでは、フォントの CSS も、
// fonts.googleapis.com / fonts.gstatic.com への先行接続（接続の確立）も、毎回の起動で無駄になる。
// Duolingo テーマのときは、描画をブロックしない形（media="print" → 届いたら all）で読む。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const links = src => [...src.matchAll(/<link\b[^>]*>/g)].map(m => m[0]);
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];

test('index.html は、フォントの CSS にも先行接続にも触れない', () => {
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(head), '<head> にフォントの外部サイトが残っている');
});

test('自分のサイトの CSS は、これまでどおり普通に読み込む（見た目が崩れないよう、ブロックする）', () => {
  const local = links(head).filter(l => attr(l, 'rel') === 'stylesheet');
  assert.deepEqual(local.map(l => attr(l, 'href')), ['home.css', 'css/app.css', 'css/shell.css', 'css/theme-ios.css']);
  local.forEach(l => assert.equal(attr(l, 'media'), undefined, `${attr(l, 'href')} に media が付いている`));
});

// ---- ブラウザでの動き ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
let browser, server, base;
before(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

// 外部（Google）への通信を数える。本物には出さず、フォントの CSS には空の CSS を返す
async function open(t, theme) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  t.after(() => context.close());
  const external = [];
  await context.route(url => new URL(url).origin !== base, route => {
    const url = route.request().url();
    external.push(new URL(url).host);
    if (/fonts\.googleapis\.com\/css2/.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '/* nunito */' });
    return route.abort();
  });
  if (theme) await context.addInitScript(th => { try { if (!sessionStorage.getItem('__t')) { sessionStorage.setItem('__t', '1'); localStorage.setItem('toeic_app_theme', th); } } catch (e) {} }, theme);
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  await page.goto(base + '/index.html');
  await page.waitForTimeout(600);
  return { page, external, fontHosts: () => external.filter(h => /fonts\./.test(h)) };
}
const fontLinks = page => page.evaluate(() => [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].map(l => ({ rel: l.rel, media: l.media, loaded: !!l.sheet })));

test('iOS テーマ（既定）では、フォントに関する通信も <link> も出ない', async t => {
  const { page, fontHosts } = await open(t);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'ios');
  assert.deepEqual(fontHosts(), []);
  assert.deepEqual(await fontLinks(page), []);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('link[rel="preconnect"]')].length), 0);
});

test('Duolingo テーマで開くと、フォントの CSS を描画をブロックしない形で1回だけ読む', async t => {
  const { page, fontHosts } = await open(t, 'duolingo');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'duolingo');
  assert.equal(fontHosts().filter(h => h === 'fonts.googleapis.com').length, 1);
  const found = await fontLinks(page);
  assert.equal(found.length, 1);
  assert.equal(found[0].rel, 'stylesheet');
  assert.equal(found[0].media, 'all', '届いたあとに media が all に戻っていない');
  assert.equal(found[0].loaded, true);
});

test('実行中に Duolingo テーマへ切り替えたときも、読み込むのは1回だけ', async t => {
  const { page, fontHosts } = await open(t);
  assert.deepEqual(fontHosts(), []);
  await page.evaluate(() => { setAppTheme('duolingo'); setAppTheme('ios'); setAppTheme('duolingo'); });
  await page.waitForTimeout(500);
  assert.equal(fontHosts().filter(h => h === 'fonts.googleapis.com').length, 1);
  assert.equal((await fontLinks(page)).length, 1);
});

test('フォントが取れなくても（オフラインなど）、Duolingo テーマは文字が出て動く', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  t.after(() => context.close());
  await context.route(url => new URL(url).origin !== base, route => route.abort());
  await context.addInitScript(() => { try { localStorage.setItem('toeic_app_theme', 'duolingo'); } catch (e) {} });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/index.html');
  await page.waitForTimeout(600);
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => typeof renderCurrent === 'function' && document.body.innerText.length > 20));
});
