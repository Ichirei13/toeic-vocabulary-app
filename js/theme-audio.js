// テーマ切替機能（プレビュー用）
function setAppTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('toeic_app_theme', theme); } catch(e){}
  document.querySelectorAll('.theme-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick').includes("'" + theme + "'"));
  });
}
(function() {
  let saved = 'ink';
  try { saved = localStorage.getItem('toeic_app_theme') || localStorage.getItem('toeic_preview_theme') || 'ink'; } catch(e){}
  document.documentElement.setAttribute('data-theme', saved);
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.theme-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('onclick').includes("'" + saved + "'"));
    });
  });
})();

// === Duolingo風 Web Audio API 効果音 & 結果バナー ===
let duoStreak = 0;
let duoXP = 0;

function playDuoSound(isCorrect) {
  if (document.documentElement.getAttribute('data-theme') !== 'duolingo') return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (isCorrect) {
      // Duolingo名物の明るいメジャーアルペジオ（ピロリロリン♪）
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.07);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.07 + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.07);
        osc.stop(ctx.currentTime + idx * 0.07 + 0.26);
      });
    } else {
      // Duolingo風の低めのブブッ（ディスコード）
      const notes = [220, 207.65]; // A3, G#3
      notes.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      });
    }
  } catch(e) {}
}

// 隣の見出しや数字で意味を伝える装飾画像。サイズを予約して読み込み時のずれを防ぐ。
function pomeranianImage(pose, className, size) {
  const img = `<img class="${className}" src="assets/pomeranian/${pose}.svg" width="${size}" height="${size}" alt="" aria-hidden="true">`;
  if (!['neutral', 'encourage', 'reflect', 'celebrate', 'streak'].includes(pose)) return img;
  // SVG画像の中のメディア条件に頼らず、ページ側の設定で静止版を選ぶ。
  return `<picture class="pomeranian-picture"><source media="(prefers-reduced-motion: reduce)" srcset="assets/pomeranian/still/${pose}.svg">${img}</picture>`;
}

// 見直しでも同じ表示を使うが、点数や連続正解は新しい回答だけで更新する。
function showDuoBanner(isCorrect, answerText, { review = false, skipped = false, flash = false } = {}) {
  const banner = document.getElementById('duo-banner');
  if (!banner) return;
  const mascot = document.querySelector('#duo-banner-icon img');
  const title = document.getElementById('duo-banner-title');
  const sub = document.getElementById('duo-banner-sub');

  if (!review) {
    duoStreak = isCorrect ? duoStreak + 1 : 0;
    if (isCorrect) duoXP += 10;
  }
  document.getElementById('practice-page').classList.add('has-feedback');
  banner.className = `duo-banner ${isCorrect ? 'correct' : 'wrong'}`;
  banner.scrollTop = 0;
  const pose = isCorrect ? 'encourage' : 'reflect';
  mascot.closest('picture').querySelector('source').srcset = `assets/pomeranian/still/${pose}.svg`;
  mascot.src = `assets/pomeranian/${pose}.svg`;
  if (isCorrect) {
    title.textContent = flash ? '覚えた！その調子。' : '正解！その調子。';
    sub.textContent = !review && duoStreak > 1 ? `${duoStreak}問連続正解！` : 'この調子で続けましょう！';
  } else {
    title.textContent = skipped || flash ? 'ここで覚えよう。' : 'おしい！正解はこちら。';
    sub.textContent = answerText || '';
  }
  
  const streakEl = document.getElementById('duo-streak-count');
  const xpEl = document.getElementById('duo-xp-count');
  if (streakEl) streakEl.textContent = duoStreak;
  if (xpEl) xpEl.textContent = duoXP;
}

function hideDuoBanner() {
  const banner = document.getElementById('duo-banner');
  if (banner) banner.classList.add('hide');
  document.getElementById('practice-page')?.classList.remove('has-feedback');
}

// localStorage が壊れていたり使えなかったり（プライベートモードなど）しても起動できるようにする
function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (v === null || typeof v !== typeof fallback || Array.isArray(v) !== Array.isArray(fallback)) return fallback;
    return v;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof scheduleGoogleDriveAutoSync === 'function') {
      scheduleGoogleDriveAutoSync(key);
    }
  } catch (e) {
    // 保存できなくても学習は続けられるので無視する
  }
}

