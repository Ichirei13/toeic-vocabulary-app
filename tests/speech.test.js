// 単語ドリルの発音ボタン（🔊）の検証。読み上げ（speechSynthesis）は偽物に差し替えて、読んだ文を記録する。
// 実行: NODE_PATH=$(npm root -g) node --test tests/speech.test.js
// 元は claude/gifted-davinci-lnh4yw（5c5b7da・f3e84c7）。今の構成に合わせて作り直した。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// 答え合わせに使う単語（例文に日本語訳が付いている）
const WORD = 'affordable';
const EXAMPLE = 'The hotel offers affordable rates for business travelers.';

let server, browser, baseUrl;
const pageErrors = [];

test.before(async () => {
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
  server.close();
  assert.deepEqual(pageErrors, [], 'ページでエラーが出た');
});

// speech: true なら偽の読み上げ、false なら読み上げ機能のない端末
async function open(t, { speech = true, viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  await context.addInitScript(withSpeech => {
    if (withSpeech) {
      window.__spoken = [];
      class FakeUtterance { constructor(text) { this.text = text; this.lang = ''; } }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speak: u => window.__spoken.push({ text: u.text, lang: u.lang }),
          cancel: () => window.__spoken.push('cancel'),
        },
      });
    } else {
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
    }
  }, speech);
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(baseUrl + '/index.html');
  return page;
}

// 決まった 1 語だけを、指定したモードで出題する
async function showWord(page, mode) {
  await page.evaluate(([mode, w]) => {
    switchAppPage('practice');
    setApp('vocab');
    state.mode = mode;
    state.pool = [RAW_WORDS.find(x => x.w === w)];
    state.currentIndex = 0;
    renderCurrent();
  }, [mode, WORD]);
}

const visibleSpeakButtons = page => page.$$eval('#quiz-container .speak-btn', els => els
  .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]'))
  .filter(el => { const box = el.closest('#example-box'); return !box || getComputedStyle(box).display !== 'none'; })
  .map(el => el.dataset.speakKind));

async function answerChoice(page) {
  await page.locator('#choices-container button').first().click();
}

test('英→日: 問題の英単語の横に 🔊、答えた後は例文の欄に「単語」「例文」が出る', async t => {
  const page = await open(t);
  await showWord(page, 'e2j');
  assert.deepEqual(await visibleSpeakButtons(page), ['headword'], '答える前は見出し語の横だけ');
  await answerChoice(page);
  assert.deepEqual(await visibleSpeakButtons(page), ['headword', 'word', 'example']);
});

test('日→英: 答える前はボタンを出さない（読むと答えがわかる）。答えた後に出る', async t => {
  const page = await open(t);
  await showWord(page, 'j2e');
  assert.deepEqual(await visibleSpeakButtons(page), []);
  await answerChoice(page);
  assert.deepEqual(await visibleSpeakButtons(page), ['word', 'example']);
});

test('タイプ: 答える前は出さず、答え合わせの後に出る', async t => {
  const page = await open(t);
  await showWord(page, 'type');
  assert.deepEqual(await visibleSpeakButtons(page), []);
  await page.fill('#type-input', 'wrong');
  await page.click('#type-check-btn');
  assert.deepEqual(await visibleSpeakButtons(page), ['word', 'example']);
});

test('カード: 裏面に出て、押してもカードはめくれない', async t => {
  const page = await open(t);
  await showWord(page, 'flash');
  await page.click('#flash-card');
  assert.equal(await page.locator('#flash-card.flipped').count(), 1, 'めくれていない');
  await page.locator('#flash-card .speak-btn[data-speak-kind="word"]').click();
  assert.equal(await page.locator('#flash-card.flipped').count(), 1, '🔊 を押したらカードが戻った');
  assert.deepEqual(await page.evaluate(() => window.__spoken), ['cancel', { text: WORD, lang: 'en-US' }]);
});

test('押すと、整形した英文を en-US で読む。続けて押すと前の読み上げを止めてから読む', async t => {
  const page = await open(t);
  await showWord(page, 'e2j');
  await answerChoice(page);
  await page.locator('#example-box .speak-btn[data-speak-kind="example"]').click();
  await page.locator('#example-box .speak-btn[data-speak-kind="word"]').click();
  // 例文の日本語訳（…）は読まない
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    'cancel', { text: EXAMPLE, lang: 'en-US' },
    'cancel', { text: WORD, lang: 'en-US' },
  ]);
});

test('押しても答え合わせ・記録・画面の状態は変わらない', async t => {
  const page = await open(t);
  await showWord(page, 'e2j');
  await answerChoice(page);
  const before = await page.evaluate(() => ({ answered: state.answeredCount, score: state.score, index: state.currentIndex, storage: JSON.stringify(localStorage) }));
  await page.locator('#example-box .speak-btn[data-speak-kind="word"]').click();
  await page.locator('#quiz-container .speak-btn[data-speak-kind="headword"]').click();
  const after = await page.evaluate(() => ({ answered: state.answeredCount, score: state.score, index: state.currentIndex, storage: JSON.stringify(localStorage) }));
  assert.deepEqual(after, before);
});

test('PC: 🔊 を押した後（フォーカスが残っていても）Enter は「次へ」として働き、読み上げはしない', async t => {
  const page = await open(t, { viewport: { width: 1280, height: 800 } });
  await showWord(page, 'e2j');
  await answerChoice(page);
  await page.locator('#example-box .speak-btn[data-speak-kind="word"]').click();
  const spoken = await page.evaluate(() => window.__spoken.length);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#quiz-container .completion-card'); // 1 語だけなので、次へ進むと完了画面
  assert.equal(await page.evaluate(() => window.__spoken.length), spoken, 'Enter で読み上げた');
});

test('読み上げ機能のない端末では、どのモードでもボタンを出さない', async t => {
  const page = await open(t, { speech: false });
  for (const mode of ['e2j', 'j2e', 'type', 'flash']) {
    await showWord(page, mode);
    if (mode === 'flash') await page.click('#flash-card');
    else if (mode === 'type') { await page.fill('#type-input', 'x'); await page.click('#type-check-btn'); }
    else await answerChoice(page);
    assert.equal(await page.locator('#quiz-container .speak-btn').count(), 0, `${mode} でボタンが出た`);
  }
});

test('スマホの幅で、ボタンは押しやすい高さがあり横にはみ出さない', async t => {
  const page = await open(t, { viewport: { width: 375, height: 667 } });
  await showWord(page, 'e2j');
  await answerChoice(page);
  for (const kind of ['word', 'example']) {
    const btn = page.locator(`#example-box .speak-btn[data-speak-kind="${kind}"]`);
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    assert(box.height >= 36, `${kind}: 高さ ${box.height}`);
    assert(box.x >= 0 && box.x + box.width <= 375, `${kind}: はみ出し ${JSON.stringify(box)}`);
  }
});
