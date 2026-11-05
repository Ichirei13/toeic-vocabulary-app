// 画面の枠（全テーマ）: 下のタブバーと、演習画面の見出し・モード切替の行を、スワイプで格納する
// （iOS 26 でスクロール中にバーが引っ込む動きの近似）。
//   タブバー: バーを下にスワイプ → 画面の下に格納。残ったつまみをタップ／上にスワイプで戻る
//     （つまみは、演習画面では下の情報行の真上、ほかの画面では画面の最下部に出る）
//   見出し行: 見出し・モード切替の行を上にスワイプ → 画面の上に格納。つまみをタップ／下にスワイプで戻る
// 格納したかどうかは端末に覚えさせる。見た目の動きは css/shell.css 側。
// 幅 1000px 以上（横画面）では、タブバーがサイドバーになるので、タブバーは格納しない。
// 背の低い画面（スマホの横向きなど）では、本人が選ぶまでは、最初から格納しておく（問題の場所を広げるため）。
(function () {
  const NAV_KEY = 'toeic_nav_stowed';
  const TOP_KEY = 'toeic_top_stowed';
  const THRESHOLD = 36; // この距離(px)以上動かしたら「スワイプした」とみなす

  const app = document.getElementById('app');
  const nav = document.querySelector('.top-page-nav');
  const practice = document.getElementById('practice-page');
  if (!app || !nav || !practice) return;

  const wide = window.matchMedia('(min-width: 1000px)');
  const short = window.matchMedia('(max-height: 520px) and (max-width: 999px)'); // CSS（css/shell.css）の薄いバーの条件と同じ
  const read = key => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } };
  const write = (key, on) => {
    try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (e) {}
  };

  // ドラッグ直後に出る click は、タブやセグメントを誤って押さないよう 1 回だけ捨てる
  function swallowNextClick() {
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, true), 350);
  }

  // sign が 1 なら画面の下向き、-1 なら上向きのスワイプで onSwipe を呼ぶ。
  // follow が true の間は、指に合わせて要素を動かす（タブバー用）。
  function attachSwipe(el, sign, onSwipe, follow) {
    let startX = 0, startY = 0, pointerId = null, moved = 0, dragging = false;
    // 動かしている間は document で受ける（マウスを速く動かすと、指やカーソルが元の要素の外に出ても追えるように）
    const move = e => {
      if (e.pointerId !== pointerId) return;
      moved = (e.clientY - startY) * sign;
      if (!dragging && moved > 8 && moved > Math.abs(e.clientX - startX)) {
        dragging = true;
        if (follow) el.style.transition = 'none';
      }
      if (dragging && follow) el.style.transform = 'translateY(' + (moved * sign) + 'px)';
    };
    const finish = e => {
      if (e.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      const wasDragging = dragging, distance = moved;
      pointerId = null; dragging = false;
      if (follow) { el.style.transition = ''; el.style.transform = ''; }
      if (wasDragging) {
        swallowNextClick();
        if (distance > THRESHOLD) onSwipe();
      }
    };
    el.addEventListener('pointerdown', e => {
      if (follow && wide.matches) return; // follow が true なのはタブバー（.top-page-nav）だけ
      if (pointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      startX = e.clientX; startY = e.clientY; pointerId = e.pointerId; moved = 0; dragging = false;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    });
  }

  // タブバーの格納は 3 つの状態: 格納（'1'）／表示を本人が選んだ（'0'）／まだ選んでいない（なし）。
  // 選んでいないときは、画面に任せる（背の低い画面では格納、それ以外は表示）。変数で持つので、保存できなくても動く
  let navChoice = null;
  try { const v = localStorage.getItem(NAV_KEY); navChoice = v === '1' ? true : v === '0' ? false : null; } catch (e) {}
  function applyNav() {
    app.classList.toggle('nav-stowed', navChoice === null ? short.matches : navChoice);
  }
  function setNavStowed(on) {
    navChoice = on;
    try { localStorage.setItem(NAV_KEY, on ? '1' : '0'); } catch (e) {}
    applyNav();
  }
  function setTopStowed(on) {
    practice.classList.toggle('top-stowed', on);
    write(TOP_KEY, on);
  }

  function makeGrabber(className, label, onShow, sign) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shell-grabber ' + className;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<span></span>';
    b.addEventListener('click', onShow);
    attachSwipe(b, sign, onShow, false);
    return b;
  }

  // 戻すためのつまみを作り、覚えていた格納の状態を復元する
  const bottomGrabber = makeGrabber('shell-grabber-bottom', 'タブバーを表示', () => setNavStowed(false), -1);
  const topGrabber = makeGrabber('shell-grabber-top', '見出しを表示', () => setTopStowed(false), 1);
  app.appendChild(bottomGrabber);
  practice.insertBefore(topGrabber, practice.firstChild);
  // 演習画面では、画面の最下部（ホームバーと重なる）ではなく、下の情報行の真上に出す
  const footer = practice.querySelector('.footer');
  if (footer) practice.insertBefore(makeGrabber('shell-grabber-footer', 'タブバーを表示', () => setNavStowed(false), -1), footer);
  applyNav();
  short.addEventListener('change', applyNav);
  setTopStowed(read(TOP_KEY));

  // 格納する側（バーと見出し行）にスワイプを付ける
  attachSwipe(nav, 1, () => setNavStowed(true), true);
  const header = practice.querySelector('.header');
  const segments = document.getElementById('app-type-segments');
  if (header) attachSwipe(header, -1, () => setTopStowed(true), false);
  if (segments) attachSwipe(segments, -1, () => setTopStowed(true), false);
})();
