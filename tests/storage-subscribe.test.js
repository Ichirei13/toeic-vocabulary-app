// 保存と Google ドライブ同期の分離の検証。
// 実行: NODE_PATH=$(npm root -g) node --test tests/storage-subscribe.test.js
// saveJSON は、書いたとき（値が変わったとき）だけ「保存した」と通知する。同期（gdrive.js）はその通知を受け取るだけで、
// 保存の側は同期の存在を知らない。通知先が壊れても、保存は必ず済む。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const utilSource = fs.readFileSync(path.join(root, 'js', 'util.js'), 'utf8');

// util.js だけを、偽の localStorage つきで読み込む（util.js は関数の定義だけなので、ブラウザなしで動く）
function loadUtil({ failWrites = false } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
  };
  const ctx = vm.createContext({ localStorage, JSON, console });
  vm.runInContext(utilSource, ctx);
  return { ctx, store };
}

test('保存の通知は、値が変わって書いたときだけ、キーつきで届く', () => {
  const { ctx, store } = loadUtil();
  assert.equal(typeof ctx.onStorageSaved, 'function', 'onStorageSaved がない');
  const seen = [];
  ctx.onStorageSaved(key => seen.push(key));
  ctx.saveJSON('a', { n: 1 });
  ctx.saveJSON('a', { n: 1 }); // 同じ値: 書かない・通知しない
  ctx.saveJSON('a', { n: 2 });
  ctx.saveJSON('b', [1]);
  assert.deepEqual(seen, ['a', 'a', 'b']);
  assert.equal(store.get('a'), '{"n":2}');
  assert.equal(store.get('b'), '[1]');
});

test('通知を受ける側が例外を出しても、保存は済み、ほかの受け手にも届く', () => {
  const { ctx, store } = loadUtil();
  const seen = [];
  ctx.onStorageSaved(() => { throw new Error('同期側の不具合'); });
  ctx.onStorageSaved(key => seen.push(key));
  ctx.saveJSON('a', { n: 1 });
  assert.equal(store.get('a'), '{"n":1}', '保存できていない');
  assert.deepEqual(seen, ['a'], '2つ目の受け手に届いていない');
});

test('受け手が1つもなくても（gdrive.js が無くても）保存できる', () => {
  const { ctx, store } = loadUtil();
  ctx.saveJSON('a', { n: 1 });
  assert.equal(store.get('a'), '{"n":1}');
});

test('保存に失敗したときは、例外を出さず、通知もしない', () => {
  const { ctx } = loadUtil({ failWrites: true });
  const seen = [];
  ctx.onStorageSaved(key => seen.push(key));
  assert.doesNotThrow(() => ctx.saveJSON('a', { n: 1 }));
  assert.deepEqual(seen, []);
});

test('writeStorage は、書いたら true、同じで省いたら false を返す', () => {
  const { ctx, store } = loadUtil();
  assert.equal(ctx.writeStorage('a', '1'), true);
  assert.equal(ctx.writeStorage('a', '1'), false);
  assert.equal(ctx.writeStorage('a', '2'), true);
  assert.equal(store.get('a'), '2');
});

test('保存に失敗したときは、失敗したキーが失敗の受け手に届く。成功や、同じ値で省いたときは届かない', () => {
  const { ctx } = loadUtil({ failWrites: true });
  assert.equal(typeof ctx.onStorageSaveFailed, 'function', 'onStorageSaveFailed がない');
  const failed = [];
  ctx.onStorageSaveFailed(key => failed.push(key));
  ctx.saveJSON('a', { n: 1 });
  ctx.saveJSON('b', [1]);
  assert.deepEqual(failed, ['a', 'b']);

  const ok = loadUtil();
  const seen = [];
  ok.ctx.onStorageSaveFailed(key => seen.push(key));
  ok.ctx.saveJSON('a', { n: 1 });
  ok.ctx.saveJSON('a', { n: 1 });
  assert.deepEqual(seen, []);
});

test('失敗の受け手が例外を出しても、saveJSON は例外を出さず、ほかの受け手にも届く', () => {
  const { ctx } = loadUtil({ failWrites: true });
  const failed = [];
  ctx.onStorageSaveFailed(() => { throw new Error('画面側の不具合'); });
  ctx.onStorageSaveFailed(key => failed.push(key));
  assert.doesNotThrow(() => ctx.saveJSON('a', { n: 1 }));
  assert.deepEqual(failed, ['a']);
});

test('reportSaveFailure は、writeStorage の例外を握りつぶしている呼び出し側からも使える', () => {
  const { ctx } = loadUtil();
  const failed = [];
  ctx.onStorageSaveFailed(key => failed.push(key));
  ctx.reportSaveFailure('toeic_daily_activity_v1');
  assert.deepEqual(failed, ['toeic_daily_activity_v1']);
});

test('util.js は、同期（Google ドライブ）の関数名を直接呼ばない', () => {
  assert.ok(!/scheduleGoogleDriveAutoSync|gdrive/i.test(utilSource.replace(/\/\/.*$/gm, '')), 'util.js が同期のコードを知っている');
});

// ---- ブラウザでの同期の挙動（分離しても、これまでどおり） ----
const { chromium } = require('playwright');
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

test('Drive の自動同期は止めてある。記録が変わっても、画面を離れても、Drive への通信は出ない', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  t.after(() => context.close());
  await context.route(url => new URL(url).origin !== base, route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/index.html');
  await page.evaluate(() => {
    window.__reqs = [];
    const realFetch = window.fetch;
    window.fetch = async (url, opt = {}) => {
      if (!String(url).includes('googleapis.com')) return realFetch(url, opt);
      window.__reqs.push((opt.method || 'GET') + ' ' + String(url));
      return new Response('{}');
    };
    localStorage.setItem(GDRIVE_LINKED_KEY, '1');
    localStorage.setItem(GDRIVE_AUTOSYNC_KEY, '1'); // 以前の自動同期ONの端末を想定
    gdriveAccessToken = 'fake'; gdriveTokenExpiresAt = Date.now() + 3600e3;
  });
  await page.evaluate(() => saveJSON(WORD_STATS_KEY, { zzz: { a: 1, c: 1 } }));
  await page.waitForTimeout(4600);
  assert.equal(await page.evaluate(() => window.__reqs.length), 0, '記録が変わっただけで Drive に通信した');
  await page.evaluate(() => {
    saveJSON(WORD_STATS_KEY, { zzz: { a: 2, c: 2 } });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__reqs.length), 0, '画面を離れたときに Drive に通信した');
  assert.equal(await page.evaluate(() => gdriveSyncTimer), null, '同期の予約が残っている');
  assert.deepEqual(errors, []);
});

test('保存が失敗し続けても、お知らせは1回だけ出て、学習は続けられる', async t => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  await context.route(url => new URL(url).origin !== base, route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/index.html');
  const result = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const toasts = [];
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
      if (n.classList && n.classList.contains('toast')) toasts.push(n.textContent);
    }))).observe(document.getElementById('app'), { childList: true, subtree: true });
    const visible = sel => [...document.querySelectorAll(sel)].filter(b => b.checkVisibility());
    dismissNudge();
    setApp('vocab'); switchAppPage('practice'); await sleep(50);
    // ここから、書き込みはすべて容量不足で失敗する
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    for (let i = 0; i < 5; i++) {
      visible('#choices-container button, button.choice-btn')[0].click(); await sleep(30);
      visible('button').find(b => /次/.test(b.textContent)).click(); await sleep(30);
    }
    return { toasts, answered: state.answeredCount };
  });
  assert.equal(result.toasts.length, 1, `お知らせの回数: ${JSON.stringify(result.toasts)}`);
  assert.match(result.toasts[0], /保存できませんでした/);
  assert.ok(result.answered >= 5, '保存に失敗しても学習は続けられるはず');
  assert.deepEqual(errors, []);
});
