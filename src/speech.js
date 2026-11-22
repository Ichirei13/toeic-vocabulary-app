// 発音ボタン（単語ドリル）で読み上げる英文の整形。
// DOM にも localStorage にも触れない純関数（ブラウザでは StudyCore.*、Node では require）。
// 読み上げそのもの（speechSynthesis）は js/vocab-drill.js が行う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const SPEECH_LANG = 'en-US';

  // 例文の日本語訳「（…）」と、見出し語の「〜」「～」「~」を取り除き、空白をまとめる。
  // 例: 'a weekly conference（週1回の定例会議）' → 'a weekly conference'、'tailored to ～' → 'tailored to'
  function speechText(text) {
    if (text == null) return '';
    return String(text)
      .replace(/（[^）]*）/g, ' ')
      .replace(/[〜～~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { SPEECH_LANG, speechText };
});
