// iOS テーマ専用: 下部のタブバーと、演習画面の見出し・モード切替の行を、スワイプで格納する
// （iOS 26 でスクロール中にバーが引っ込む動きの近似）。
//   タブバー: バーを下にスワイプ → 画面の下に格納。残ったつまみをタップ／上にスワイプで戻る
//   見出し行: 見出し・モード切替の行を上にスワイプ → 画面の上に格納。つまみをタップ／下にスワイプで戻る
// 他のテーマには何も足さない（iOS テーマのときだけつまみを作り、別のテーマになったら取り除く）。
// 格納したかどうかは端末に覚えさせる。見た目の動きは css/theme-ios.css 側。
(function () {
  const NAV_KEY = 'toeic_ios_nav_stowed';
  const TOP_KEY = 'toeic_ios_top_stowed';
  const THRESHOLD = 36; // この距離(px)以上動かしたら「スワイプした」とみなす

  const app = document.getElementById('app');
  const nav = document.querySelector('.top-page-nav');
  const practice = document.getElementById('practice-page');
  if (!app || !nav || !practice) return;

  const isIos = () => document.documentElement.getAttribute('data-theme') === 'ios';
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
      if (!isIos() || pointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      startX = e.clientX; startY = e.clientY; pointerId = e.pointerId; moved = 0; dragging = false;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    });
  }

  function setNavStowed(on) {
    app.classList.toggle('ios-nav-stowed', on);
    write(NAV_KEY, on);
  }
  function setTopStowed(on) {
    practice.classList.toggle('ios-top-stowed', on);
    write(TOP_KEY, on);
  }

  function makeGrabber(className, label, onShow, sign) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ios-grabber ' + className;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<span></span>';
    b.addEventListener('click', onShow);
    attachSwipe(b, sign, onShow, false);
    return b;
  }

  let bottomGrabber = null;
  let topGrabber = null;

  // iOS テーマのときだけつまみを作り、ほかのテーマに切り替わったら取り除く
  function sync() {
    if (isIos() && !bottomGrabber) {
      bottomGrabber = makeGrabber('ios-grabber-bottom', 'タブバーを表示', () => setNavStowed(false), -1);
      topGrabber = makeGrabber('ios-grabber-top', '見出しを表示', () => setTopStowed(false), 1);
      app.appendChild(bottomGrabber);
      practice.insertBefore(topGrabber, practice.firstChild);
      setNavStowed(read(NAV_KEY));
      setTopStowed(read(TOP_KEY));
    } else if (!isIos() && bottomGrabber) {
      bottomGrabber.remove(); topGrabber.remove();
      bottomGrabber = topGrabber = null;
      app.classList.remove('ios-nav-stowed');
      practice.classList.remove('ios-top-stowed');
    }
  }

  // 格納する側（バーと見出し行）にスワイプを付ける。反応するのは iOS テーマのときだけ。
  attachSwipe(nav, 1, () => setNavStowed(true), true);
  const header = practice.querySelector('.header');
  const segments = document.getElementById('app-type-segments');
  if (header) attachSwipe(header, -1, () => setTopStowed(true), false);
  if (segments) attachSwipe(segments, -1, () => setTopStowed(true), false);

  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  sync();
})();
