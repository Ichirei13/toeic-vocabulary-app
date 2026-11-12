// Service Worker が、変わっていないファイルをキャッシュに書き直さないことの検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/sw-cache-writes.test.js
// 以前は、起動のたびに約48件（約1MB）を Cache Storage に書いていた。中身が同じなら書かないのが正しい。
// 公開先（GitHub Pages）と同じく ETag と Last-Modified を付けるサーバで、sw.js の先頭に「書いた数」を数える仕掛けを足して配る。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const COUNTER = `self.__c={put:0,urls:[]};(()=>{const o=Cache.prototype.put;Cache.prototype.put=function(r,res){self.__c.put++;self.__c.urls.push((r.url||String(r)));return o.call(this,r,res)}})();\n`;

// 試験ごとに変えられる、サーバの振る舞い
const behavior = { validators: true, changed: new Map() }; // changed: 相対パス → { body, etag }
let browser, server, base;

before(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    if (rel === 'sw.js') {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(COUNTER + fs.readFileSync(file, 'utf8'));
    }
    const st = fs.statSync(file);
    const changed = behavior.changed.get(rel);
    const headers = { 'Content-Type': type, 'Cache-Control': 'max-age=0' };
    if (behavior.validators) {
      headers.ETag = changed ? changed.etag : `W/"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;
      headers['Last-Modified'] = st.mtime.toUTCString();
      if (!changed && req.headers['if-none-match'] === headers.ETag) return res.writeHead(304, { ETag: headers.ETag }).end();
    }
    res.writeHead(200, headers);
    res.end(changed ? changed.body : fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

// SW が起動して、ページが SW の管理下になるまで待つ。戻り値で数を読む
async function launch(t) {
  behavior.validators = true;
  behavior.changed.clear();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForTimeout(1500);
  const sw = () => context.serviceWorkers().find(w => w.url().endsWith('/sw.js'));
  const counts = () => sw().evaluate(() => ({ put: self.__c.put, urls: [...self.__c.urls] }));
  // 再読み込みして、その間に書いた件数と URL を返す
  const reloadAndCount = async () => {
    const before = await counts();
    await page.reload();
    await page.waitForTimeout(2000);
    const after = await counts();
    return { put: after.put - before.put, urls: after.urls.slice(before.urls.length) };
  };
  return { context, page, reloadAndCount };
}

test('中身が変わっていないファイルは、再読み込みでキャッシュに書かない', async t => {
  const { reloadAndCount } = await launch(t);
  for (let i = 0; i < 2; i++) {
    const r = await reloadAndCount();
    assert.equal(r.put, 0, `${i + 1}回目の再読み込みで ${r.put} 件書いた: ${r.urls.slice(0, 3).join(', ')}`);
  }
});

test('ETag が変わったファイルだけが書き直され、新しい中身に置き換わる', async t => {
  const { page, reloadAndCount } = await launch(t);
  behavior.changed.set('css/app.css', { body: '/* 変更後 */\n' + fs.readFileSync(path.join(root, 'css/app.css'), 'utf8'), etag: 'W/"changed-1"' });
  const r = await reloadAndCount();
  assert.deepEqual(r.urls.map(u => new URL(u).pathname), ['/css/app.css']);
  const cacheName = /const CACHE = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'))[1]; // sw.js の版を上げても追従する
  const cached = await page.evaluate(async name => {
    const res = await (await caches.open(name)).match('css/app.css');
    return (await res.text()).startsWith('/* 変更後 */');
  }, cacheName);
  assert.equal(cached, true, 'キャッシュの中身が新しくなっていない');
  const again = await reloadAndCount();
  assert.equal(again.put, 0, '同じ ETag のままなら、もう書かない');
});

test('ETag も Last-Modified もない場合は、変わったか分からないので毎回書く', async t => {
  const { reloadAndCount } = await launch(t);
  behavior.validators = false;
  const r = await reloadAndCount();
  assert.ok(r.put >= 40, `検証できないのに書いていない: ${r.put} 件`);
});

test('オフラインでも、書き直しを省いたキャッシュからアプリが開く', async t => {
  const { context, page } = await launch(t);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof RAW_WORDS !== 'undefined' && typeof renderCurrent === 'function');
  assert.equal(await page.title(), 'TOEIC Drill');
  assert.ok(await page.evaluate(() => RAW_WORDS.length > 1000));
});
