// テスト用: index.html をブラウザ（Chromium）で開く。グローバルな関数と state は page.evaluate から直接呼べる。
// 実行: NODE_PATH="$(npm root -g)" node --test tests/
const path = require('path');
const { chromium } = require('playwright');

const INDEX_URL = 'file://' + path.resolve(__dirname, '../index.html');

async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

// storage: 開く前に localStorage へ入れる値（そのキーがまだ無いときだけ。リロードしても上書きしない）
// init: ページのスクリプトより先に実行する文字列
// time: 現在時刻を固定する ISO 文字列
async function openApp({ storage = {}, init, time } = {}) {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  if (time) await page.clock.setFixedTime(time);
  await page.addInitScript(seed => {
    for (const [k, v] of Object.entries(seed)) {
      try {
        if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
      } catch (e) {
        // 書き込めない環境を再現するテストでは、入れられなくてよい
      }
    }
  }, storage);
  if (init) await page.addInitScript(init);
  await page.goto(INDEX_URL);
  return { page, close: () => browser.close() };
}

// ページを開いて fn(page) を実行し、必ず閉じる
async function withApp(opts, fn) {
  const app = await openApp(opts);
  try {
    return await fn(app.page);
  } finally {
    await app.close();
  }
}

module.exports = { openApp, withApp, INDEX_URL };
