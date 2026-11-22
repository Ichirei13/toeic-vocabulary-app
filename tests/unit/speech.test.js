// 発音ボタンで読み上げる英文の整形の単体テスト
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/speech.js');

test('speechText: 例文の日本語訳（全角かっこ）を取り除く', () => {
  assert.equal(S.speechText('a weekly conference（週1回の定例会議）'), 'a weekly conference');
  assert.equal(
    S.speechText('The hotel offers affordable rates for business travelers.（そのホテルは出張者向けに手頃な料金を提供している。）'),
    'The hotel offers affordable rates for business travelers.'
  );
});

test('speechText: 途中にある訳も、複数あってもすべて取り除く', () => {
  assert.equal(S.speechText('apply for（申し込む） a loan（ローン）'), 'apply for a loan');
});

test('speechText: 〜・～・~ を取り除き、空白をまとめる', () => {
  assert.equal(S.speechText('tailored to ～'), 'tailored to');
  assert.equal(S.speechText('credit A with B 〜'), 'credit A with B');
  assert.equal(S.speechText('  be eligible for ~  '), 'be eligible for');
});

test('speechText: 句・見出し語はそのまま読む', () => {
  assert.equal(S.speechText('opt for'), 'opt for');
  assert.equal(S.speechText('affordable'), 'affordable');
});

test('speechText: 読むものが無ければ空文字', () => {
  assert.equal(S.speechText(''), '');
  assert.equal(S.speechText(null), '');
  assert.equal(S.speechText(undefined), '');
  assert.equal(S.speechText('（訳だけ）'), '');
  assert.equal(S.speechText('～'), '');
});

test('SPEECH_LANG は英語（アメリカ）', () => {
  assert.equal(S.SPEECH_LANG, 'en-US');
});
