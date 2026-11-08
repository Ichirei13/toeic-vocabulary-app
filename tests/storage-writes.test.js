// 保存（localStorage）まわりの特性テスト。学習記録を失わないための土台。
// 実行: NODE_PATH=$(npm root -g) node --test tests/storage-writes.test.js
//   golden を作り直すとき: UPDATE_GOLDEN=1 NODE_PATH=$(npm root -g) node --test tests/storage-writes.test.js
//
// 決まった手順（単語・文法を解く／わからない／苦手の削除／バックアップの上書き復元・取り消し・統合復元／Drive 統合）を
// 時刻と乱数を固定して実行し、最後の localStorage の全内容を、1バイトも違わないことを確かめる。
// 保存の仕組み（書く回数・タイミング）を変えても、保存される中身は同じでなければならない。
// 解く操作の間に起きた書き込みのうち、保存済みの値と同じ値の書き直し（冗長な書き込み）が 0 件であることも確かめる
// （復元・取り消し・Drive 統合は、安全のため同じ値でもそのまま書くので数えない）。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'storage-scenario.golden.json');
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

// アプリのスクリプトより先に、乱数・時刻・経過時間を固定し、localStorage への書き込みを数える
const INIT = () => {
  let seed = 123456789;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const original = Storage.prototype.setItem;
  window.__w = { total: 0, redundant: 0, redundantKeys: {} };
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && window.__counting) {
      window.__w.total++;
      let same = false;
      try { same = this.getItem(key) === String(value); } catch (e) { /* 読めなければ冗長とは数えない */ }
      if (same) {
        window.__w.redundant++;
        window.__w.redundantKeys[key] = (window.__w.redundantKeys[key] || 0) + 1;
      }
    }
    return original.call(this, key, value);
  };
};

// 手順本体。ページの中で動かし、最後の localStorage の全内容と書き込みの数を返す
const SCENARIO = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = sel => [...document.querySelectorAll(sel)].filter(b => b.checkVisibility());
  const answer = async i => {
    const choices = visible('#choices-container button, button.choice-btn');
    if (!choices.length) throw new Error('選択肢がない');
    choices[i % choices.length].click();
    await sleep(30);
  };
  const next = async () => {
    const n = visible('button').find(b => /次/.test(b.textContent));
    if (!n) throw new Error('次へのボタンがない');
    n.click();
    await sleep(30);
  };
  window.__w = { total: 0, redundant: 0, redundantKeys: {} };
  window.__counting = true; // 解く操作の間だけ数える（復元・Drive 統合は、安全のため同じ値でもそのまま書くので数えない）
  // 経過時間も固定する（Playwright の時計の仕組みが読み込み時に performance.now を使うので、読み込んだあとで差し替える）
  performance.now = () => 5000;
  dismissNudge();

  // 単語を解く（正解・不正解・わからない）
  setApp('vocab'); switchAppPage('practice'); await sleep(50);
  for (let i = 0; i < 6; i++) { await answer(i); await next(); }
  document.getElementById('dont-know-btn').click(); await sleep(30); await next();

  // 苦手を1件削除（削除した印が残る）
  state.app = 'vocab'; state.weakListMode = state.mode;
  const weakKey = Object.keys(wordWeak(state.mode))[0];
  if (weakKey) removeWeak(weakKey);

  // 文法を解く
  setApp('grammar'); await sleep(50);
  for (let i = 0; i < 4; i++) { await answer(i + 1); await next(); }

  // バックアップを書き出し、さらに解いてから、上書き復元 → 取り消し → 統合復元
  const backupText = JSON.stringify(buildBackup());
  window.__counting = false;
  setApp('vocab'); await sleep(50);
  for (let i = 0; i < 3; i++) { await answer(i + 2); await next(); }
  const pending = () => parseBackup(backupText);
  backupView = { step: 'confirm', restoreMode: 'overwrite', pending: pending() }; runRestore(); await sleep(30);
  runUndo(); await sleep(30);
  backupView = { step: 'confirm', restoreMode: 'merge', pending: pending() }; runRestore(); await sleep(30);

  // Google ドライブとの統合（通信は偽物に差し替える。本物には出さない）
  const realFetch = window.fetch; let remote = '';
  window.fetch = async (url, opt = {}) => {
    if (!String(url).includes('googleapis.com')) return realFetch(url, opt);
    if (String(url).includes('spaces=appDataFolder')) return new Response(JSON.stringify({ files: [{ id: 'x' }] }));
    if ((opt.method || 'GET') === 'PATCH') { remote = opt.body; return new Response(JSON.stringify({ modifiedTime: '2026-11-07T03:00:00.000Z' })); }
    return new Response(remote);
  };
  localStorage.setItem(GDRIVE_LINKED_KEY, '1');
  gdriveAccessToken = 'fake'; gdriveTokenExpiresAt = Date.now() + 3600e3;
  await syncWithGoogleDrive({ silent: true });
  await syncWithGoogleDrive({ silent: true });
  window.fetch = realFetch; gdriveAccessToken = null; gdriveTokenExpiresAt = 0;
  await sleep(100);

  const dump = {};
  Object.keys(localStorage).sort().forEach(k => { dump[k] = localStorage.getItem(k); });
  // データが変わったときに golden の作り直しを促すための指紋
  const sum = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const fingerprint = { words: RAW_WORDS.length, grammar: RAW_GRAMMAR.length, hash: sum(RAW_WORDS.map(w => w.w).join('|') + '#' + RAW_GRAMMAR.map(g => g.id).join(',')) };
  return { dump, fingerprint, writes: JSON.parse(JSON.stringify(window.__w)) };
};

async function runScenario(t) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
  t.after(() => context.close());
  await context.addInitScript(INIT);
  await context.route(url => new URL(url).origin !== base, route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-07T12:00:00+09:00'));
  await page.goto(base + '/index.html');
  const result = await page.evaluate(SCENARIO);
  assert.deepEqual(errors, [], '手順の途中でページにエラーが出た');
  return result;
}

test('決まった手順のあとの保存内容が、golden と1バイトも違わない', async t => {
  const { dump, fingerprint } = await runScenario(t);
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify({ fingerprint, dump }, null, 1) + '\n');
    return;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(fingerprint, golden.fingerprint, 'データ（単語・文法）が変わっている。意図した変更なら UPDATE_GOLDEN=1 で golden を作り直す');
  assert.deepEqual(Object.keys(dump), Object.keys(golden.dump), '保存されたキーの一覧が違う');
  for (const k of Object.keys(golden.dump)) assert.equal(dump[k], golden.dump[k], `${k} の保存内容が違う`);
});

test('解く操作の間に、保存済みと同じ値の書き直し（冗長な書き込み）が起きない', async t => {
  const { writes } = await runScenario(t);
  assert.ok(writes.total > 20, `書き込みを数えられていない: ${writes.total}`);
  assert.equal(writes.redundant, 0, `冗長な書き込み ${writes.redundant} 回 / 全 ${writes.total} 回: ${JSON.stringify(writes.redundantKeys)}`);
});

test('golden は、記録の主要なキーをすべて含む（手順が空振りしていない）', () => {
  if (process.env.UPDATE_GOLDEN) return;
  const { dump } = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (const k of ['toeic_word_stats', 'toeic_grammar_stats', 'toeic_weak_words_by_mode', 'toeic_weak_deleted', 'toeic_seen_words_by_mode', 'toeic_session', 'toeic_settings', 'toeic_book_sessions_v1', 'toeic_daily_activity_v1', 'toeic_backup_undo', 'toeic_gdrive_last_sync']) {
    assert.ok(dump[k] !== undefined, `${k} が golden にない`);
  }
  const wordStats = JSON.parse(dump.toeic_word_stats);
  assert.ok(Object.keys(wordStats).length >= 6, '単語の成績が少なすぎる');
});
