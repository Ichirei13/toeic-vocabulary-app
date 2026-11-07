// ==================== ポモドーロタイマー（集中画面・Dynamic Island 風ミニピル・PiP） ====================

const POMO_CORE_FALLBACK = {
  POMO_DEFAULT_SETTINGS: { work: 25, brk: 5, long: 15, every: 4, auto: true, subject: '' },
  POMO_RANGES: {
    work: { min: 1, max: 120 },
    brk: { min: 1, max: 60 },
    long: { min: 1, max: 60 },
    every: { min: 2, max: 8 },
  },
  clampPomoInt: () => null,
  normalizePomoSettings: () => ({ work: 25, brk: 5, long: 15, every: 4, auto: true, subject: '' }),
  pomoSettingsPatch: () => null,
  pomoDurationSec: mode => (mode === 'long' ? 900 : mode === 'short' ? 300 : 1500),
  nextPomoPhase: (mode, cycle) => ({ mode: mode === 'work' ? 'short' : 'work', cycle: mode === 'work' ? cycle + 1 : cycle }),
  formatPomoTime: sec => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  },
  recordPomoSession: log => log || {},
  sanitizePomoLog: () => { throw new Error('src/pomodoro.js を読み込めていません'); },
  mergePomoLog: () => { throw new Error('src/pomodoro.js を読み込めていません'); },
};
window.StudyCore = Object.assign({}, POMO_CORE_FALLBACK, window.StudyCore || {});

const POMO_LOG_KEY = 'toeic_pomo_log_v1';
const POMO_SETTINGS_KEY = 'toeic_pomo_settings_v1';

let pomoLog = loadPomoLog();
let pomoSettings = loadPomoSettings();

const pomoState = {
  mode: 'work', // 'work' | 'short' | 'long'
  running: false,
  total: 25 * 60,
  remaining: 25 * 60,
  cycle: 0,
  tickId: null,
  endAt: 0, // 動作中の終了予定時刻（Date.now() の値）。残り時間はここから逆算する
};

function loadPomoLog() {
  const raw = loadJSON(POMO_LOG_KEY, {});
  try {
    return StudyCore.sanitizePomoLog(raw).log;
  } catch (e) {
    return {};
  }
}

function savePomoLog() {
  saveJSON(POMO_LOG_KEY, pomoLog);
}

function loadPomoSettings() {
  const raw = loadJSON(POMO_SETTINGS_KEY, {});
  return StudyCore.normalizePomoSettings(raw);
}

function savePomoSettings() {
  saveJSON(POMO_SETTINGS_KEY, pomoSettings);
}

function pomoTodayKey() {
  if (typeof localDateStr === 'function') return localDateStr();
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pomoTodayStats() {
  const entry = pomoLog[pomoTodayKey()];
  return entry || { minutes: 0, sets: 0, subjects: {} };
}

// 現在演習中・選択中の教材名を自動で取得する
function getAutoPomoSubject() {
  if (typeof state === 'undefined') return 'TOEIC演習';
  if (state.app === 'grammar') {
    const map = {
      kin: '金の文法',
      sekai: '世界一わかりやすい英文法',
      polaris2: '英文法ポラリス2',
      toplevel: '高3 トップレベル英語',
      all: '文法ドリル',
    };
    return map[state.grammarBook] || '文法ドリル';
  }
  const vmap = {
    teppan: 'TEPPAN英単語',
    daily: '日々の単語',
    all: '単語ドリル',
  };
  return vmap[state.sourceFilter] || '単語ドリル';
}

function getEffectivePomoSubject() {
  const custom = (pomoSettings.subject || '').trim();
  return custom || getAutoPomoSubject();
}

function isPomoBreak() {
  return pomoState.mode !== 'work';
}

function isPomoActiveOrPaused() {
  return pomoState.running || pomoState.remaining < pomoState.total || pomoState.mode !== 'work';
}

function pomoPhaseLabel(mode = pomoState.mode) {
  if (mode === 'long') return '長い休憩';
  if (mode === 'short') return '短い休憩';
  return '集中';
}

function pomoPhaseBadgeText(mode = pomoState.mode) {
  if (mode === 'long') return 'LONG BREAK';
  if (mode === 'short') return 'SHORT BREAK';
  return 'FOCUS';
}

// ---------- 音声（Web Audio API チャイム） & 通知 ----------
let pomoAudioCtx = null;

function initPomoAudio() {
  if (!pomoAudioCtx) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) pomoAudioCtx = new Ctx();
    } catch (e) {}
  }
  if (pomoAudioCtx && pomoAudioCtx.state === 'suspended') {
    pomoAudioCtx.resume().catch(() => {});
  }
}

function pomoBeep() {
  if (!pomoAudioCtx) return;
  try {
    const now = pomoAudioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = pomoAudioCtx.createOscillator();
      const gain = pomoAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = isPomoBreak() ? 660 : 880;
      const t = now + i * 0.26;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.32, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(pomoAudioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  } catch (e) {}
}

function pomoNotify(msg) {
  if (typeof showToast === 'function') {
    showToast(msg);
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('TOEIC Practice タイマー', { body: msg });
    } catch (e) {}
  }
}

// ---------- タイマー動作コア ----------
function initPomoTimerState() {
  pomoState.total = StudyCore.pomoDurationSec(pomoState.mode, pomoSettings);
  pomoState.remaining = pomoState.total;
}
initPomoTimerState();

// 動作中は、setInterval の回数ではなく現在時刻から残りを出す。
// 裏のタブや画面ロックで interval が止まっても、戻ったときに正しい残り時間になる。
function syncPomoRemaining() {
  if (!pomoState.running) return;
  pomoState.remaining = Math.max(0, Math.ceil((pomoState.endAt - Date.now()) / 1000));
}

function tickPomo() {
  const before = pomoState.remaining;
  syncPomoRemaining();
  if (pomoState.remaining <= 0) {
    updatePomoLiveDOM();
    finishPomoPhase(false);
    return;
  }
  if (pomoState.remaining !== before) updatePomoLiveDOM();
}

function startPomo() {
  if (pomoState.running) return;
  initPomoAudio();
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) {}
  }
  pomoState.running = true;
  pomoState.endAt = Date.now() + pomoState.remaining * 1000;
  pomoState.tickId = setInterval(tickPomo, 250);
  updatePomoLiveDOM();
}

function pausePomo() {
  syncPomoRemaining();
  pomoState.running = false;
  if (pomoState.tickId !== null) {
    clearInterval(pomoState.tickId);
    pomoState.tickId = null;
  }
  updatePomoLiveDOM();
}

function togglePomo() {
  if (pomoState.running) pausePomo();
  else startPomo();
}

function loadPomoPhase(mode, autoStart) {
  pausePomo();
  pomoState.mode = mode;
  pomoState.total = StudyCore.pomoDurationSec(mode, pomoSettings);
  pomoState.remaining = pomoState.total;
  updatePomoLiveDOM();
  if (autoStart) startPomo();
}

function finishPomoPhase(isManualSkip = false) {
  syncPomoRemaining();
  const elapsedSec = pomoState.total - pomoState.remaining;
  const elapsedMin = isManualSkip
    ? Math.round(elapsedSec / 60)
    : Math.max(1, Math.round(pomoState.total / 60));
  pausePomo();
  pomoBeep();

  const wasWork = pomoState.mode === 'work';
  if (wasWork && elapsedMin > 0) {
    pomoLog = StudyCore.recordPomoSession(pomoLog, pomoTodayKey(), elapsedMin, getEffectivePomoSubject());
    savePomoLog();
  }

  const next = StudyCore.nextPomoPhase(pomoState.mode, pomoState.cycle, pomoSettings.every);
  pomoState.cycle = next.cycle;

  if (!isManualSkip) {
    if (wasWork) {
      pomoNotify(next.mode === 'long' ? '🎉 集中おつかれさま！長めに休憩しましょう 🌿' : '☕ 集中おつかれさま！少し休憩しましょう');
    } else {
      pomoNotify('🔥 休憩おわり！次の集中をはじめましょう');
    }
  }

  loadPomoPhase(next.mode, isManualSkip ? false : pomoSettings.auto);
}

function resetPomo() {
  pomoState.cycle = 0;
  loadPomoPhase('work', false);
}

function skipPomo() {
  initPomoAudio();
  finishPomoPhase(true);
}

// ---------- Document Picture-in-Picture (小窓) ----------
let pomoPipWin = null;
let pomoPipClock = null;
let pomoPipMode = null;
let pomoPipBtn = null;

async function openPomoPip() {
  if (!('documentPictureInPicture' in window)) {
    if (typeof showToast === 'function') {
      showToast('小窓表示は PC 版 Chrome / Edge で利用できます');
    }
    return;
  }
  if (pomoPipWin) {
    pomoPipWin.close();
    return;
  }
  try {
    pomoPipWin = await window.documentPictureInPicture.requestWindow({ width: 260, height: 170 });
    const st = pomoPipWin.document.createElement('style');
    st.textContent = `
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Hiragino Sans", sans-serif;
        background: #1c1c1e;
        color: #ffffff;
        height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        -webkit-user-select: none;
        user-select: none;
      }
      #m { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; opacity: 0.7; }
      #c { font-size: 48px; font-weight: 300; font-variant-numeric: tabular-nums; line-height: 1.05; }
      #b {
        margin-top: 4px;
        border: none;
        border-radius: 999px;
        color: #ffffff;
        font-size: 13px;
        font-weight: 600;
        padding: 8px 22px;
        cursor: pointer;
        background: #007aff;
        font-family: inherit;
      }
    `;
    pomoPipWin.document.head.appendChild(st);
    pomoPipWin.document.body.innerHTML = '<div id="m"></div><div id="c"></div><button id="b" type="button"></button>';
    pomoPipClock = pomoPipWin.document.getElementById('c');
    pomoPipMode = pomoPipWin.document.getElementById('m');
    pomoPipBtn = pomoPipWin.document.getElementById('b');
    pomoPipBtn.addEventListener('click', () => {
      initPomoAudio();
      togglePomo();
    });
    pomoPipWin.addEventListener('pagehide', () => {
      pomoPipWin = null;
      pomoPipClock = null;
      pomoPipMode = null;
      pomoPipBtn = null;
    });
    updatePomoPip();
  } catch (e) {}
}

function updatePomoPip() {
  if (!pomoPipWin || !pomoPipClock) return;
  pomoPipClock.textContent = StudyCore.formatPomoTime(pomoState.remaining);
  pomoPipMode.textContent = `${pomoPhaseBadgeText()} · ${getEffectivePomoSubject()}`;
  pomoPipBtn.textContent = pomoState.running ? '一時停止' : 'スタート';
  const brk = isPomoBreak();
  pomoPipWin.document.body.style.background = brk ? '#11241c' : '#1c1c1e';
  pomoPipBtn.style.background = brk ? '#34c759' : '#007aff';
}

// ---------- Dynamic Island 風ミニピル（他ページでの常駐表示） ----------
// ピルはドラッグで好きな場所に動かせる。位置は画面に対する中心の割合（0〜1）で、この端末だけに保存する
// （画面の大きさや向きが変わっても、はみ出さない位置に補正される。バックアップには含めない）。
const POMO_PILL_KEY = 'toeic_pomo_pill_v1';
const POMO_PILL_DRAG_PX = 6; // これ未満の動きはタップとして扱う
const POMO_PILL_MARGIN = 4;
let pomoPillPos = loadPomoPillPos();

function loadPomoPillPos() {
  const raw = loadJSON(POMO_PILL_KEY, null);
  if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  return { x: Math.min(1, Math.max(0, raw.x)), y: Math.min(1, Math.max(0, raw.y)) };
}

function applyPomoPillPos(pill) {
  if (!pill) return;
  if (!pomoPillPos) {
    pill.style.left = pill.style.top = pill.style.transform = '';
    return;
  }
  if (pill.hidden) return;
  const probe = pill.querySelector('.pomo-safe-probe');
  const cs = probe ? getComputedStyle(probe) : null;
  const safeTop = cs ? parseFloat(cs.paddingTop) || 0 : 0;
  const safeBottom = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
  const r = pill.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const minLeft = POMO_PILL_MARGIN;
  const minTop = Math.max(POMO_PILL_MARGIN, safeTop);
  const left = Math.max(minLeft, Math.min(pomoPillPos.x * vw - r.width / 2, vw - r.width - POMO_PILL_MARGIN));
  const top = Math.max(minTop, Math.min(pomoPillPos.y * vh - r.height / 2, vh - r.height - Math.max(POMO_PILL_MARGIN, safeBottom)));
  pill.style.left = `${left}px`;
  pill.style.top = `${top}px`;
  pill.style.transform = 'none';
}

function resetPomoPillPos() {
  pomoPillPos = null;
  try { localStorage.removeItem(POMO_PILL_KEY); } catch (e) {}
  applyPomoPillPos(document.getElementById('pomo-mini-pill'));
}

function bindPomoPillDrag(pill) {
  let drag = null;
  let suppressClick = false;

  // 動き・指を離す操作は、ピルの外に出ても拾えるよう画面全体（window）で受ける
  const onMove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < POMO_PILL_DRAG_PX) return;
      drag.moved = true;
      pill.classList.add('is-dragging');
    }
    e.preventDefault();
    const size = pill.getBoundingClientRect();
    const cx = e.clientX - drag.offX + size.width / 2;
    const cy = e.clientY - drag.offY + size.height / 2;
    pomoPillPos = { x: cx / document.documentElement.clientWidth, y: cy / window.innerHeight };
    applyPomoPillPos(pill);
    // 画面の端で補正された位置を保存する
    const r = pill.getBoundingClientRect();
    pomoPillPos = {
      x: Math.min(1, Math.max(0, (r.left + r.width / 2) / document.documentElement.clientWidth)),
      y: Math.min(1, Math.max(0, (r.top + r.height / 2) / window.innerHeight)),
    };
  };

  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (drag.moved) {
      suppressClick = true; // ドラッグの指を離したときに、ボタンが押されたことにしない（次の操作を始めるときに解除する）
      setTimeout(() => { suppressClick = false; }, 100);
      pill.classList.remove('is-dragging');
      saveJSON(POMO_PILL_KEY, pomoPillPos);
    }
    drag = null;
  };

  pill.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressClick = false;
    const r = pill.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, moved: false };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  pill.addEventListener('click', e => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

window.addEventListener('resize', () => applyPomoPillPos(document.getElementById('pomo-mini-pill')));

function ensurePomoMiniPill() {
  let pill = document.getElementById('pomo-mini-pill');
  if (pill) return pill;
  const appEl = document.getElementById('app');
  if (!appEl) return null;
  pill = document.createElement('div');
  pill.id = 'pomo-mini-pill';
  pill.className = 'pomo-mini-pill';
  pill.setAttribute('role', 'region');
  pill.setAttribute('aria-label', 'ポモドーロタイマー');
  pill.hidden = true;
  pill.innerHTML = `
    <button type="button" class="pomo-mini-main" id="pomo-mini-open" aria-label="集中タイマー画面を開く">
      <span class="pomo-mini-dot" id="pomo-mini-dot" aria-hidden="true"></span>
      <span class="pomo-mini-phase" id="pomo-mini-phase">集中</span>
      <span class="pomo-mini-clock" id="pomo-mini-clock">25:00</span>
    </button>
    <button type="button" class="pomo-mini-toggle" id="pomo-mini-toggle" aria-label="一時停止・再開">⏸</button>
    <span class="pomo-safe-probe" aria-hidden="true"></span>
  `;
  bindPomoPillDrag(pill);
  pill.querySelector('#pomo-mini-open').addEventListener('click', () => {
    if (typeof switchAppPage === 'function') switchAppPage('timer');
  });
  pill.querySelector('#pomo-mini-toggle').addEventListener('click', e => {
    e.stopPropagation();
    initPomoAudio();
    togglePomo();
  });
  appEl.insertBefore(pill, appEl.firstChild);
  return pill;
}

function syncPomoMiniPill() {
  const pill = ensurePomoMiniPill();
  if (!pill) return;
  const onTimerPage = typeof currentAppPage !== 'undefined' && currentAppPage === 'timer';
  const show = !onTimerPage && isPomoActiveOrPaused();
  pill.hidden = !show;
  pill.classList.toggle('is-break', isPomoBreak());
  pill.classList.toggle('is-paused', !pomoState.running);
  if (!show) return;

  const phaseEl = document.getElementById('pomo-mini-phase');
  const clockEl = document.getElementById('pomo-mini-clock');
  const toggleEl = document.getElementById('pomo-mini-toggle');
  if (phaseEl) phaseEl.textContent = pomoPhaseLabel();
  if (clockEl) clockEl.textContent = StudyCore.formatPomoTime(pomoState.remaining);
  if (toggleEl) {
    toggleEl.textContent = pomoState.running ? '⏸' : '▶';
    toggleEl.setAttribute('aria-label', pomoState.running ? '一時停止' : '再開');
  }
  applyPomoPillPos(pill); // 文字の幅が変わっても、画面からはみ出さないようにする
}

// ---------- 専用ページ (#timer-page) の描画と部分更新 ----------
const POMO_RING_R = 96;
const POMO_RING_CIRC = 2 * Math.PI * POMO_RING_R;

function renderPomoDotsHtml() {
  const every = pomoSettings.every;
  let html = '';
  for (let i = 0; i < every; i++) {
    html += `<span class="pomo-dot${i < pomoState.cycle ? ' fill' : ''}"></span>`;
  }
  return html;
}

function updatePomoLiveDOM() {
  syncPomoMiniPill();
  updatePomoPip();

  const timerPage = document.getElementById('timer-page');
  if (!timerPage) return;
  timerPage.classList.toggle('is-break', isPomoBreak());

  const clockEl = document.getElementById('pomo-clock');
  if (!clockEl) return;

  clockEl.textContent = StudyCore.formatPomoTime(pomoState.remaining);

  const badgeEl = document.getElementById('pomo-mode-badge');
  if (badgeEl) badgeEl.textContent = `${pomoPhaseLabel()} · ${pomoPhaseBadgeText()}`;

  const pomoMascotImg = document.getElementById('pomo-mascot-img');
  const pomoMascotText = document.getElementById('pomo-mascot-text');
  if (pomoMascotImg && pomoMascotText) {
    const pm = pomoState.mode === 'long'
      ? { pose: 'status-sleep', text: '長い休憩中：ゆっくり休んでリフレッシュしましょう 💤' }
      : pomoState.mode === 'short'
        ? { pose: 'goal-5-casual', text: '短い休憩中：おつかれさま！飲み物でほっと一息 ☕' }
        : pomoState.running
          ? { pose: 'status-timer', text: '集中タイム進行中！自分のペースで解き進めましょう ⏱️' }
          : { pose: 'pomo-tomato', text: 'ポモドーロ集中の準備OK！スタートで始めよう 🍅' };
    if (setPomeranianPose(pomoMascotImg, pm.pose)) {
      pomoMascotImg.classList.remove('pome-pop');
      void pomoMascotImg.offsetWidth;
      pomoMascotImg.classList.add('pome-pop');
    }
    pomoMascotText.textContent = pm.text;
  }

  const ringEl = document.getElementById('pomo-ring-fg');
  if (ringEl) {
    const ratio = pomoState.total > 0 ? pomoState.remaining / pomoState.total : 0;
    ringEl.style.strokeDasharray = String(POMO_RING_CIRC);
    ringEl.style.strokeDashoffset = String(POMO_RING_CIRC * (1 - ratio));
  }

  const startBtn = document.getElementById('pomo-start-btn');
  if (startBtn) {
    startBtn.textContent = pomoState.running ? '一時停止' : (pomoState.remaining < pomoState.total ? '再開' : 'スタート');
    startBtn.classList.toggle('running', pomoState.running);
  }

  const dotsEl = document.getElementById('pomo-dots');
  if (dotsEl) dotsEl.innerHTML = renderPomoDotsHtml();

  const today = pomoTodayStats();
  const countEl = document.getElementById('pomo-today-count');
  if (countEl) countEl.textContent = `今日 ${today.sets} セット（${today.minutes}分）`;

  const subHintEl = document.getElementById('pomo-subject-auto-hint');
  if (subHintEl) {
    const autoSub = getAutoPomoSubject();
    subHintEl.textContent = pomoSettings.subject
      ? `記録ラベル: ${pomoSettings.subject}`
      : `学習中の教材と自動連動中: ${autoSub}`;
  }

  // モード切替セグメントの選択状態
  document.querySelectorAll('[data-pomo-phase]').forEach(btn => {
    const active = btn.dataset.pomoPhase === pomoState.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function renderTimerPage() {
  const container = document.getElementById('timer-page');
  if (!container) return;

  const today = pomoTodayStats();
  const autoSub = getAutoPomoSubject();
  const ratio = pomoState.total > 0 ? pomoState.remaining / pomoState.total : 1;
  const dashOffset = POMO_RING_CIRC * (1 - ratio);

  container.classList.toggle('is-break', isPomoBreak());
  container.innerHTML = `
    <div class="pomo-page-inner">
      <div class="pomo-page-header">
        <h2 class="pomo-page-title">集中タイマー</h2>
        <span class="pomo-today-pill" id="pomo-today-count">今日 ${today.sets} セット（${today.minutes}分）</span>
      </div>

      <!-- フェーズ切り替えセグメント -->
      <div class="segments pomo-phase-segments" role="tablist" aria-label="タイマーモード">
        <button type="button" class="segment ${pomoState.mode === 'work' ? 'active' : ''}" data-pomo-phase="work" role="tab" aria-selected="${pomoState.mode === 'work'}">集中</button>
        <button type="button" class="segment ${pomoState.mode === 'short' ? 'active' : ''}" data-pomo-phase="short" role="tab" aria-selected="${pomoState.mode === 'short'}">短い休憩</button>
        <button type="button" class="segment ${pomoState.mode === 'long' ? 'active' : ''}" data-pomo-phase="long" role="tab" aria-selected="${pomoState.mode === 'long'}">長い休憩</button>
      </div>

      <!-- メインタイマーカード -->
      <section class="pomo-card" aria-label="カウントダウンタイマー">
        <div class="pomo-mode-badge" id="pomo-mode-badge">${pomoPhaseLabel()} · ${pomoPhaseBadgeText()}</div>
        ${(() => {
          const pm = pomoState.mode === 'long'
            ? { pose: 'status-sleep', text: '長い休憩中：ゆっくり休んでリフレッシュしましょう 💤' }
            : pomoState.mode === 'short'
              ? { pose: 'goal-5-casual', text: '短い休憩中：おつかれさま！飲み物でほっと一息 ☕' }
              : pomoState.running
                ? { pose: 'status-timer', text: '集中タイム進行中！自分のペースで解き進めましょう ⏱️' }
                : { pose: 'pomo-tomato', text: 'ポモドーロ集中の準備OK！スタートで始めよう 🍅' };
          return `<div class="pomo-mascot-bar" id="pomo-mascot-bar">
            ${pomeranianImage(pm.pose, 'pomo-mascot-img', 40, 'id="pomo-mascot-img"')}
            <span id="pomo-mascot-text" class="pomo-mascot-text">${escapeHtml(pm.text)}</span>
          </div>`;
        })()}

        <div class="pomo-ring-wrap">
          <svg class="pomo-ring" width="220" height="220" viewBox="0 0 220 220" aria-hidden="true">
            <circle class="pomo-ring-bg" cx="110" cy="110" r="${POMO_RING_R}" fill="none" stroke-width="10"/>
            <circle class="pomo-ring-fg" id="pomo-ring-fg" cx="110" cy="110" r="${POMO_RING_R}" fill="none" stroke-width="10"
              style="stroke-dasharray:${POMO_RING_CIRC}; stroke-dashoffset:${dashOffset};"/>
          </svg>
          <div class="pomo-ring-center">
            <div class="pomo-clock" id="pomo-clock">${StudyCore.formatPomoTime(pomoState.remaining)}</div>
            <div class="pomo-dots" id="pomo-dots" aria-label="サイクル進捗">${renderPomoDotsHtml()}</div>
          </div>
        </div>

        <div class="pomo-controls">
          <button type="button" class="pomo-btn-sub" id="pomo-reset-btn">リセット</button>
          <button type="button" class="pomo-btn-main ${pomoState.running ? 'running' : ''}" id="pomo-start-btn">${pomoState.running ? '一時停止' : (pomoState.remaining < pomoState.total ? '再開' : 'スタート')}</button>
          <button type="button" class="pomo-btn-sub" id="pomo-skip-btn">スキップ</button>
        </div>

        <button type="button" class="pomo-pip-btn" id="pomo-pip-btn">⇱ 小窓（ピクチャーインピクチャー）で表示</button>
      </section>

      <!-- 設定カード（iOS Inset Grouped 風） -->
      <section class="pomo-settings-section" aria-label="タイマー設定">
        <h3 class="pomo-sec-title">タイマー設定</h3>
        <div class="pomo-grouped-list">
          <div class="pomo-list-row">
            <label for="pomo-subject-input">学習科目・ラベル</label>
            <input type="text" id="pomo-subject-input" class="pomo-text-input" maxlength="24"
              placeholder="自動（${escapeHtml(autoSub)}）" value="${escapeHtml(pomoSettings.subject)}">
          </div>
          <div class="pomo-list-row">
            <label for="pomo-work-min">集中時間（分）</label>
            <input type="number" id="pomo-work-min" class="pomo-num-input" inputmode="numeric"
              min="${StudyCore.POMO_RANGES.work.min}" max="${StudyCore.POMO_RANGES.work.max}" value="${pomoSettings.work}">
          </div>
          <div class="pomo-list-row">
            <label for="pomo-brk-min">短い休憩（分）</label>
            <input type="number" id="pomo-brk-min" class="pomo-num-input" inputmode="numeric"
              min="${StudyCore.POMO_RANGES.brk.min}" max="${StudyCore.POMO_RANGES.brk.max}" value="${pomoSettings.brk}">
          </div>
          <div class="pomo-list-row">
            <label for="pomo-long-min">長い休憩（分）</label>
            <input type="number" id="pomo-long-min" class="pomo-num-input" inputmode="numeric"
              min="${StudyCore.POMO_RANGES.long.min}" max="${StudyCore.POMO_RANGES.long.max}" value="${pomoSettings.long}">
          </div>
          <div class="pomo-list-row">
            <label for="pomo-every-cnt">長休憩までの回数（セット）</label>
            <input type="number" id="pomo-every-cnt" class="pomo-num-input" inputmode="numeric"
              min="${StudyCore.POMO_RANGES.every.min}" max="${StudyCore.POMO_RANGES.every.max}" value="${pomoSettings.every}">
          </div>
          <label class="pomo-list-row pomo-toggle-row" for="pomo-auto-start">
            <span>休憩・集中を自動で開始する</span>
            <input type="checkbox" id="pomo-auto-start" ${pomoSettings.auto ? 'checked' : ''}>
          </label>
        </div>
        <p class="pomo-sub-hint" id="pomo-subject-auto-hint">${pomoSettings.subject ? `記録ラベル: ${escapeHtml(pomoSettings.subject)}` : `学習中の教材と自動連動中: ${escapeHtml(autoSub)}`}</p>
        <p class="pomo-sub-hint">他のページに出る小さなタイマーは、ドラッグで好きな場所に動かせます。</p>
        <button type="button" class="pomo-pip-btn pomo-pill-reset" id="pomo-pill-reset">小さなタイマーの位置をもとに戻す</button>
      </section>
    </div>
  `;

  // イベント登録
  container.querySelector('#pomo-start-btn').addEventListener('click', () => {
    initPomoAudio();
    togglePomo();
  });
  container.querySelector('#pomo-reset-btn').addEventListener('click', resetPomo);
  container.querySelector('#pomo-skip-btn').addEventListener('click', skipPomo);
  container.querySelector('#pomo-pip-btn').addEventListener('click', openPomoPip);
  container.querySelector('#pomo-pill-reset').addEventListener('click', () => {
    resetPomoPillPos();
    if (typeof showToast === 'function') showToast('小さなタイマーの位置をもとに戻しました');
  });

  container.querySelectorAll('[data-pomo-phase]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetMode = btn.dataset.pomoPhase;
      if (targetMode && targetMode !== pomoState.mode) {
        loadPomoPhase(targetMode, false);
      }
    });
  });

  const bindNumSetting = (id, key) => {
    const el = container.querySelector(`#${id}`);
    if (!el) return;
    el.addEventListener('change', () => {
      const clamped = StudyCore.clampPomoInt(key, el.value);
      if (clamped === null) {
        el.value = pomoSettings[key];
        return;
      }
      pomoSettings[key] = clamped;
      el.value = clamped;
      savePomoSettings();
      if (!pomoState.running && pomoState.remaining === pomoState.total) {
        loadPomoPhase(pomoState.mode, false);
      } else {
        updatePomoLiveDOM();
      }
    });
  };
  bindNumSetting('pomo-work-min', 'work');
  bindNumSetting('pomo-brk-min', 'brk');
  bindNumSetting('pomo-long-min', 'long');
  bindNumSetting('pomo-every-cnt', 'every');

  const autoEl = container.querySelector('#pomo-auto-start');
  if (autoEl) {
    autoEl.addEventListener('change', () => {
      pomoSettings.auto = autoEl.checked;
      savePomoSettings();
    });
  }

  const subEl = container.querySelector('#pomo-subject-input');
  if (subEl) {
    subEl.addEventListener('input', () => {
      pomoSettings.subject = subEl.value.trim().slice(0, 24);
      savePomoSettings();
      updatePomoLiveDOM();
    });
  }
}

// バックアップ復元・取り消し後の再読み込み用
function reloadPomoExtras() {
  pomoLog = loadPomoLog();
  pomoSettings = loadPomoSettings();
  if (!pomoState.running) {
    pomoState.total = StudyCore.pomoDurationSec(pomoState.mode, pomoSettings);
    pomoState.remaining = pomoState.total;
  }
  if (typeof currentAppPage !== 'undefined' && currentAppPage === 'timer') {
    renderTimerPage();
  }
  syncPomoMiniPill();
}

// 画面に戻ってきたとき、止まっていた interval を待たずにすぐ残り時間を合わせる（時間切れならそのまま次のフェーズへ）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pomoState.running) tickPomo();
});
window.addEventListener('pageshow', () => {
  if (pomoState.running) tickPomo();
});

// 集中画面でスペースキーを押したときに開始/一時停止を切り替える
// （ボタン・入力欄・チェックボックスなどにフォーカスがあるときは、その部品本来の動きを優先する）
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (typeof currentAppPage === 'undefined' || currentAppPage !== 'timer') return;
  const t = e.target;
  if (t && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(t.tagName) || t.isContentEditable)) return;
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    initPomoAudio();
    togglePomo();
  }
});

