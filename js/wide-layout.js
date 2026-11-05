// iOS テーマ × 横画面（幅 1000px 以上）専用: 右側の絞り込みパネルの開閉を、端末に覚えさせる。
// 見た目の配置は css/shell.css 側。幅 1000px 未満では何もしない。全テーマで動く。
//   最初は開く。ユーザーが「絞り込み」ボタン・✕・「この条件で解く」で閉じたときだけ、閉じた状態を覚える。
//   開閉の状態は変数（panelOpen）で持つ。localStorage は、起動時に一度読むのと、保存にしか使わない
//   （読み直すと、保存できない環境で、閉じたパネルが開き直ってしまうため）。
(function () {
  const KEY = 'toeic_wide_filter_panel'; // 値が 'closed' のときだけ閉じる。無ければ開く
  const wide = window.matchMedia('(min-width: 1000px)');
  const app = document.getElementById('app');
  const drawer = document.getElementById('filter-drawer');
  const toggle = document.getElementById('filter-toggle');
  const practice = document.getElementById('practice-page');
  if (!app || !drawer || !toggle || !practice) return;

  const active = () => wide.matches;
  const readClosed = () => { try { return localStorage.getItem(KEY) === 'closed'; } catch (e) { return false; } };
  const write = closed => {
    try { if (closed) localStorage.setItem(KEY, 'closed'); else localStorage.removeItem(KEY); } catch (e) {}
  };

  let panelOpen = !readClosed();

  // 絞り込みボタンの見た目と aria を合わせる（横画面ではパネルの状態、そうでなければ上から降りるシートの状態）。
  // 値が変わるときだけ書く（書き換えを監視しているので、同じ値を書き続けると止まらなくなる）
  function reflect() {
    const open = active() ? panelOpen : drawer.classList.contains('open');
    if (toggle.classList.contains('active') !== open) toggle.classList.toggle('active', open);
    if (toggle.getAttribute('aria-expanded') !== String(open)) toggle.setAttribute('aria-expanded', String(open));
  }

  // ほかの処理（ホームの「範囲を指定」、300 問以上のナッジ、狭い画面で開いたまま広げた場合）が
  // 上から降りるシートとして開いたら、横画面ではパネルとして引き受ける。
  // .open を残すと、キー操作（js/keyboard.js が .open の間は数字キーなどを捨てる）が止まる。
  function adoptOpenSheet() {
    panelOpen = true; // 外から開かれただけなので、記憶は書かない
    if (typeof closeFilterSheet === 'function') closeFilterSheet();
    if (!practice.classList.contains('active') && typeof switchAppPage === 'function') {
      switchAppPage('practice', { keepSheets: true });
    }
    sync();
  }

  // 状態を画面に反映する。幅・テーマ・表示中のページが変わったときにも呼ぶ
  function sync() {
    if (active() && drawer.classList.contains('open')) { adoptOpenSheet(); return; }
    app.classList.toggle('filter-panel-open', active() && panelOpen);
    reflect();
  }

  // ユーザーの操作で開閉する。閉じるときは、既存の .open（上から降りるシート側）も外す
  function setOpen(open) {
    panelOpen = open;
    write(!open);
    if (!open && typeof closeFilterSheet === 'function') closeFilterSheet();
    sync();
  }

  // 横画面の iOS テーマでは、絞り込みボタンは上から降りるシートではなく、パネルの開閉にする
  document.addEventListener('click', e => {
    if (!active() || !e.target.closest('#filter-toggle')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    setOpen(!panelOpen);
  }, true);

  // ✕ と「この条件で解く」は、既存の onclick（closeFilterSheet）のあとで、パネルも閉じて記憶する
  document.addEventListener('click', e => {
    if (!active()) return;
    if (e.target.closest('#filter-drawer .top-sheet-close, #filter-apply-btn')) setOpen(false);
  });

  wide.addEventListener('change', sync);
  // 演習画面が表示されたら合わせ直す。シートの .open が付いたら、パネルとして引き受ける
  new MutationObserver(sync).observe(practice, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(drawer, { attributes: true, attributeFilter: ['class'] });
  // closeFilterSheet（ページ移動や下のシートを開くときに呼ばれる）がボタンの状態を外すので、合わせ直す
  new MutationObserver(reflect).observe(toggle, { attributes: true, attributeFilter: ['class', 'aria-expanded'] });
  sync();
})();
