export const THEMES = [
  { id: 'light', name: 'Study Desk', note: '紙の余白と、深い青緑', scheme: 'light', bg: '#f6f5f1', surface: '#ffffff', accent: '#24685b' },
  { id: 'dark', name: 'Study Desk 夜', note: '静かな夜の学習に', scheme: 'dark', bg: '#17201c', surface: '#222d27', accent: '#9bd4bd' },
  { id: 'duolingo', name: 'Duolingo', note: '立体ボタンと、解く楽しさ', scheme: 'dark', bg: '#131f24', surface: '#202f36', accent: '#58cc02' },
  { id: 'ink', name: '和モダン', note: '墨色と、温かな金色', scheme: 'dark', bg: '#181512', surface: '#2b251d', accent: '#d4a759' },
  { id: 'navy', name: 'ネイビー', note: '深い青で集中する', scheme: 'dark', bg: '#0b1329', surface: '#182342', accent: '#93b8ff' },
  { id: 'quizlet', name: 'Quizlet', note: 'すっきりとした藍色', scheme: 'dark', bg: '#0a092d', surface: '#1b1a44', accent: '#b3baff' },
  { id: 'forest', name: 'フォレスト', note: '緑に包まれる学習時間', scheme: 'dark', bg: '#0a1713', surface: '#172c24', accent: '#6ee7b7' },
  { id: 'nordic', name: 'チャコール', note: '色を抑え、文字に集中', scheme: 'dark', bg: '#18181b', surface: '#27272a', accent: '#d4d4d8' },
  { id: 'sepia', name: 'セピア', note: '柔らかい紙と琥珀色', scheme: 'light', bg: '#f6f3ed', surface: '#fffcf5', accent: '#98500c' },
];
export const themeById = id => THEMES.find(theme => theme.id === id) || THEMES[0];
export const legacyTheme = id => id === 'light' ? 'sepia' : THEMES.some(t => t.id === id) ? id : 'light';

// Derive session rewards from answers so reloads and revisiting a question never add XP.
export function sessionRewards(session) {
  const answers = Object.values(session?.answers || {}).sort((a, b) => a.at - b.at);
  let streak = 0, best = 0, correct = 0;
  for (const answer of answers) {
    streak = answer.correct ? streak + 1 : 0;
    if (answer.correct) correct++;
    best = Math.max(best, streak);
  }
  return { streak, best, xp: correct * 10 };
}

let audioContext;
export function playAnswerSound(correct) {
  try {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    audioContext ??= new Context();
    const play = () => {
      const notes = correct ? [523.25, 659.25, 783.99, 1046.5] : [220, 207.65];
      notes.forEach((frequency, index) => {
        const start = audioContext.currentTime + (correct ? index * .07 : 0);
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = correct ? 'triangle' : 'sawtooth';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(correct ? .12 : .06, start);
        gain.gain.exponentialRampToValueAtTime(.001, start + .24);
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + .27);
      });
    };
    if (audioContext.state === 'suspended') audioContext.resume().then(play).catch(() => {});
    else play();
  } catch { /* Audio is optional; the visible result always remains available. */ }
}
