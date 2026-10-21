const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp } = require('./helpers.cjs');

// 読み上げの代わりに、読もうとした文字列と言語を window.__spoken に溜める
const STUB = `
window.__spoken = [];
window.__cancelled = 0;
Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
  speak(u) { window.__spoken.push(u.text + '|' + u.lang); },
  cancel() { window.__cancelled++; },
} });
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
`;
const NO_SPEECH = "Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });";

const spoken = page => page.evaluate(() => window.__spoken);

test('speechText: 日本語訳と ~ を取り除く', () => withApp({ init: STUB }, async page => {
  const r = await page.evaluate(() => [
    speechText('a paid vacation（有給休暇）'),
    speechText('refer to ~'),
    speechText('（訳だけ）'),
    speakBtnHtml('（訳だけ）'),
  ]);
  assert.deepEqual(r, ['a paid vacation', 'refer to', '', '']);
}));

test('speakBtnHtml: 引用符や < を含む文字列も data-speak で元に戻る', () => withApp({ init: STUB }, async page => {
  const text = 'say "hi" <b> & \'ok\'';
  const r = await page.evaluate(t => {
    const div = document.createElement('div');
    div.innerHTML = speakBtnHtml(t);
    return { count: div.querySelectorAll('.speak-btn').length, speak: div.querySelector('.speak-btn').dataset.speak };
  }, text);
  assert.deepEqual(r, { count: 1, speak: text });
}));

test('英→日: 単語の横に 🔊 があり、押すと en-US で読み、回答済みにはならない', () => withApp({ init: STUB }, async page => {
  const word = await page.evaluate(() => speechText(state.pool[0].w));
  await page.click('#main-card .word-display .speak-btn');
  assert.deepEqual(await spoken(page), [`${word}|en-US`]);
  assert.ok(await page.evaluate(() => window.__cancelled) >= 1);
  assert.equal(await page.evaluate(() => state.answered), false);
}));

test('カード: 表面の 🔊 を押してもカードがめくれない', () => withApp({ init: STUB }, async page => {
  await page.click('[data-mode="flash"]');
  await page.click('#flash-card .card-face:not(.card-back) .speak-btn');
  assert.equal(await page.evaluate(() => document.getElementById('flash-card').classList.contains('flipped')), false);
  assert.equal((await spoken(page)).length, 1);
  assert.equal(await page.evaluate(() => state.answered), false);
}));

test('回答後の例文欄に単語と例文の 🔊 が出て、例文は日本語訳なしで読まれる', () => withApp({ init: STUB }, async page => {
  await page.click('#dont-know-btn');
  const buttons = page.locator('#example-box .speak-btn');
  assert.equal(await buttons.count(), 2);
  const expected = await page.evaluate(() => speechText(state.pool[state.currentIndex].e));
  await buttons.nth(1).click();
  assert.deepEqual(await spoken(page), [`${expected}|en-US`]);
}));

test('回答後の 🔊 は「単語」「例文」のラベル付きで、タップしやすい大きさ', () => withApp({ init: STUB }, async page => {
  await page.click('#dont-know-btn');
  const buttons = page.locator('#example-box .speak-btn');
  assert.deepEqual(await buttons.allTextContents(), ['🔊 単語', '🔊 例文']);
  const box = await buttons.first().boundingBox();
  assert.ok(box.height >= 32, `height ${box.height}`);
}));

for (const mode of ['j2e', 'type']) {
  test(`${mode}: 回答前は答えが分かる 🔊 を出さず、回答後に出る`, () => withApp({ init: STUB }, async page => {
    await page.click(`[data-mode="${mode}"]`);
    // 例文欄は回答前は非表示なので、見えている 🔊 だけを数える
    assert.equal(await page.locator('#main-card .speak-btn:visible').count(), 0);
    await page.click('#dont-know-btn');
    assert.ok(await page.locator('#example-box .speak-btn:visible').count() > 0);
  }));
}

test('カード: 表面に単語の 🔊、裏面に単語と例文の 🔊 がある', () => withApp({ init: STUB }, async page => {
  await page.click('[data-mode="flash"]');
  assert.equal(await page.locator('#flash-card .card-face:not(.card-back) .speak-btn').count(), 1);
  assert.equal(await page.locator('#flash-card .card-back .speak-btn').count(), 2);
}));

test('音声が使えない端末では 🔊 が1つも出ず、エラーも出ない', () => withApp({ init: NO_SPEECH }, async page => {
  for (const mode of ['e2j', 'flash', 'j2e', 'type']) {
    await page.click(`[data-mode="${mode}"]`);
    assert.equal(await page.locator('.speak-btn').count(), 0);
  }
  await page.click('[data-mode="e2j"]');
  await page.click('#dont-know-btn');
  assert.equal(await page.locator('.speak-btn').count(), 0);
  assert.deepEqual(page.errors, []);
}));
