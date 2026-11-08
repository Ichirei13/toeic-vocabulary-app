// テーマ切替。テーマの色は css/app.css の [data-theme="..."] で決まる。選択は設定画面のテーマカードから
function setAppTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('toeic_app_theme', theme); } catch(e){}
  ensureThemeFont(theme);
}

// テーマが使う Web フォント。Nunito を使うのは Duolingo テーマだけ（css/app.css）なので、そのテーマのときにだけ読む。
// 使わないテーマで毎回読むと、CSS の取得と接続の確立（fonts.googleapis.com / fonts.gstatic.com）が無駄になる。
// media="print" で先に読み、届いたら all に戻すので、画面の描画はブロックしない。取れなくても、文字は代わりのフォントで出る
const THEME_FONTS = {
  duolingo: 'https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap',
};
function ensureThemeFont(theme) {
  const href = THEME_FONTS[theme];
  if (!href || [...document.head.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.media = 'print';
  link.addEventListener('load', () => { link.media = 'all'; }, { once: true });
  document.head.appendChild(link);
}
// 何も選んでいないとき（初めて開いたとき）のテーマ。index.html の <html data-theme> と合わせる
const DEFAULT_THEME = 'ios';
// 前回選んだテーマを、画面が描かれる前に反映する（旧キー toeic_preview_theme の記録も引き継ぐ）
// URL に ?theme=ios を付けると、保存せずにそのテーマで開く（試用リンク用。設定のカードを押したときだけ保存される）
(function() {
  let saved = DEFAULT_THEME;
  try { saved = localStorage.getItem('toeic_app_theme') || localStorage.getItem('toeic_preview_theme') || DEFAULT_THEME; } catch(e){}
  const PREVIEW_THEMES = ['ios'];
  const asked = new URLSearchParams(location.search).get('theme');
  if (PREVIEW_THEMES.includes(asked)) saved = asked;
  document.documentElement.setAttribute('data-theme', saved);
  ensureThemeFont(saved);
})();

// === Duolingo風 Web Audio API 効果音 & 結果バナー ===
let duoStreak = 0;
let duoMiss = 0; // 連続で間違えた数。正解で 0 に戻る
const duoFeedbackTick = { correct: 0, wrong: 0 }; // 同じポーズが続かないよう持ち回りに使う回数（最初は基本のポーズ）
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
// 全ポーズに静止版 still/ がある（scripts/make-pomeranian-stills.py で動く版から作る）。
// attrs は <img> に足す属性（id や loading など）。
function pomeranianImage(pose, className, size, attrs = '') {
  const img = `<img class="${className}" src="assets/pomeranian/${pose}.svg" width="${size}" height="${size}" alt="" aria-hidden="true"${attrs ? ' ' + attrs : ''}>`;
  // SVG画像の中のメディア条件に頼らず、ページ側の設定で静止版を選ぶ。
  return `<picture class="pomeranian-picture"><source media="(prefers-reduced-motion: reduce)" srcset="assets/pomeranian/still/${pose}.svg">${img}</picture>`;
}

// すでに表示している pomeranianImage のポーズを差し替える。同じポーズなら何もしない
// （同じ src を入れ直すとアニメーションが最初からやり直しになるため）。
function setPomeranianPose(img, pose) {
  if (!img) return false;
  const src = `assets/pomeranian/${pose}.svg`;
  if (img.getAttribute('src') === src) return false;
  const source = img.closest('picture')?.querySelector('source');
  if (source) source.srcset = `assets/pomeranian/still/${pose}.svg`;
  img.src = src;
  return true;
}

// 目標問題数に応じたポメラニアンのポーズとメッセージ
function goalMascotInfo(goal) {
  const g = Number(goal) || 0;
  if (g <= 0) return { pose: 'goal-0-relaxed', title: '目標なし（マイペース）', desc: 'プレッシャーなく、自分のペースでのんびり続けましょう。' };
  if (g <= 5) return { pose: 'goal-5-casual', title: `1日${g}問（コツコツ習慣）`, desc: 'まずは気軽にウォームアップ！毎日の習慣づくりにぴったりです。' };
  if (g <= 15) return { pose: 'goal-target', title: `1日${g}問（標準ターゲット）`, desc: '毎日無理なく着実に力がつく王道ペースです。' };
  if (g <= 25) return { pose: 'goal-20-active', title: `1日${g}問（しっかり集中）`, desc: '基礎から応用までテンポよく数をこなせる集中ペースです。' };
  return { pose: 'goal-30-intense', title: `1日${g}問（ストイック特訓）`, desc: '本番に向けて一気に実力を引き上げる猛特訓モードです！' };
}

// 演習完了時の正答率に応じたポメラニアンの褒め・応援メッセージ
function completionPraiseHtml(score, total) {
  if (!total) return '';
  const ratio = score / total;
  const info = ratio >= 1
    ? { pose: 'master-cape', text: 'パーフェクト達成！グランドマスター級の輝きです！' }
    : ratio >= 0.8
      ? { pose: 'praise-star-eyes', text: '高正答率クリア！素晴らしい集中力です！' }
      : ratio >= 0.5
        ? { pose: 'praise-clap', text: 'ナイスファイト！着実に力がついています！' }
        : { pose: 'cheer-pompoms', text: '最後まで解き切りました！復習で次に繋げよう！' };
  return `<div class="completion-praise">${pomeranianImage(info.pose, 'completion-praise-mascot', 36)}<span>${info.text}</span></div>`;
}

// 回答後に出すポーズ。見直し・スキップ・「覚えた」の確認は連続数に関係しないので基本のポーズのまま。
// 連続正解が続くと盛り上がり、3問続けて間違えたときだけ強めの励ましにする（それ以外は軽め）。
const FEEDBACK_POSES = {
  correct: ['encourage', 'praise-clap', 'praise-heart', 'praise-highfive'],
  wrong: ['reflect', 'sad-sweat', 'sad-tears', 'sad-bandage'],
  streak5: 'praise-star-eyes',
  streak10: 'praise-dance',
  miss3: ['sad-cry', 'sad-rain']
};
function feedbackPose(isCorrect, { review = false, skipped = false, flash = false } = {}) {
  const base = isCorrect ? 'encourage' : 'reflect';
  if (review || skipped || flash) return base;
  const rotate = list => list[duoFeedbackTick[isCorrect ? 'correct' : 'wrong']++ % list.length];
  if (isCorrect) {
    if (duoStreak >= 10) return FEEDBACK_POSES.streak10;
    if (duoStreak >= 5) return FEEDBACK_POSES.streak5;
    return rotate(FEEDBACK_POSES.correct);
  }
  return duoMiss >= 3 ? rotate(FEEDBACK_POSES.miss3) : rotate(FEEDBACK_POSES.wrong);
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
    duoMiss = isCorrect ? 0 : duoMiss + 1;
    if (isCorrect) duoXP += 10;
  }
  document.getElementById('practice-page').classList.add('has-feedback');
  banner.className = `duo-banner ${isCorrect ? 'correct' : 'wrong'}`;
  banner.scrollTop = 0;
  const pose = feedbackPose(isCorrect, { review, skipped, flash });
  setPomeranianPose(mascot, pose);
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
