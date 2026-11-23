// 文法グラフ・レーダーの詳細シート（下から出るパネル）。window.GraphSheet を 1 つだけ公開する。
// 中身（StudyCore.buildDetail の結果）の HTML 化、高さ（つまみ・見出しのドラッグ、広げる・縮める、覚えた高さ）、
// 閉じる（×・Esc・下へはじく）、問題一覧のタップ、出題ボタンを受け持つ。グラフ（js/graph-view.js）とレーダー（js/radar-view.js）で共用。
//
// GraphSheet.create(parent, opts) → { el, render(content), open(), close(), isOpen(), contains(node) }
//   opts = {
//     on(target, type, fn, o)   … リスナーの登録（呼び出し側が数えて、destroy でまとめて外す）
//     S                          … StudyCore（resolveSheetDrag を使う。src/sheet-size.js）
//     getSheetHeight?() → 割合|null, setSheetHeight?(割合) … つまみで変えた高さを端末に覚える
//     questionNode(qid) → ノード添字（-1 なら移動先なし。一覧の行を押せなくする）
//     onQuestion(node)           … 一覧の問題を押したとき（クリック・Enter・Space）
//     onDrill({ ids, label, kind }) … 出題ボタンを押したとき（呼び出し側が画面を切り替える。この後 destroy されうる）
//     onClose()                  … 閉じたとき（どの閉じ方でも 1 回）
//   }
//   content = { kindText, title, detail, correct, picks: [{ key, text, sub?, ids, label, kind }] }
//   render は中身だけ描き直す（スクロール位置はそのまま）。open はスクロールを先頭に戻し、閉じていたら覚えた高さで開いてフォーカスする。
(function (root) {
  'use strict';

  const SHEET_DEFAULT_RATIO = 0.42; // 「縮める」で戻す高さ（CSS の既定の max-height と同じ）
  const SHEET_WIDE_RATIO = 0.72;    // 「広げる」の高さ
  const SHEET_WIDE_FROM = 0.6;      // これ以上の高さなら、ボタンを「縮める」にする
  const SHEET_MIN_BODY_PX = 64;     // つまみで下げても、見出しの下にこれだけは本文を残す
  const STATUS_LABEL = { weak: '苦手', overcome: '克服', unseen: '未解答', correct: '正解' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // エスケープ済みの文字列の **太字** だけを <strong> にする（エスケープの後なので安全）。残った ** は消す
  function richText(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*\*/g, '');
  }

  function create(parent, opts) {
    const S = opts.S || {};
    const el = document.createElement('section');
    el.className = 'graph-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'graph-sheet-title');
    el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML =
      '<div class="graph-sheet-grab" title="上下に動かして高さを変える"><span></span></div>' +
      '<header class="graph-sheet-head">' +
        '<div class="graph-sheet-titles"><span class="graph-sheet-kind"></span><h2 class="graph-sheet-title" id="graph-sheet-title"></h2></div>' +
        '<button type="button" class="graph-sheet-expand" aria-pressed="false">広げる</button>' +
        '<button type="button" class="graph-sheet-close" aria-label="閉じる">×</button>' +
      '</header>' +
      '<div class="graph-sheet-body"></div>';
    parent.appendChild(el);
    const kindEl = el.querySelector('.graph-sheet-kind');
    const titleEl = el.querySelector('.graph-sheet-title');
    const body = el.querySelector('.graph-sheet-body');
    const expandBtn = el.querySelector('.graph-sheet-expand');
    let picks = null;   // { key: pick }（押したときにそのまま渡す）
    let wide = false;   // 広げているか（高さが SHEET_WIDE_FROM 以上。ボタンの表示に使う）
    let ratio = null;   // 容器に対する割合。null なら既定（中身の高さ、最大は CSS の 42%）
    let drag = null;    // つまみ・見出しを動かしている間だけ { id, y0, start, box, lastY, lastT, v }

    function render(c) {
      const d = c.detail;
      kindEl.textContent = c.kindText;
      titleEl.textContent = c.title;
      const pct = d.answered > 0 ? Math.round((100 * c.correct) / d.answered) + '%' : '—';
      let html =
        '<dl class="graph-stats">' +
          `<div><dt>状態</dt><dd>${esc(d.stateLabel)}</dd></div>` +
          `<div><dt>正答率</dt><dd>${esc(pct)}</dd></div>` +
          `<div><dt>解答数</dt><dd>${esc(d.answered)}</dd></div>` +
          `<div><dt>苦手</dt><dd>${esc(d.weakCount)}</dd></div>` +
        '</dl>';
      if (d.desc) html += `<p class="graph-desc">${richText(d.desc)}</p>`;
      if (d.advice) html += `<p class="graph-advice"><span class="graph-advice-label">対策</span>${richText(d.advice)}</p>`;
      picks = null;
      const list = Array.isArray(c.picks) ? c.picks.filter(p => p && Array.isArray(p.ids) && p.ids.length > 0) : [];
      if (list.length > 0) {
        picks = {};
        const btns = list.map(p => {
          picks[p.key] = p;
          return `<button type="button" class="graph-drill-btn${p.sub ? ' is-sub' : ''}" data-drill="${esc(p.key)}">${esc(p.text)}</button>`;
        }).join('');
        // 2 つ以上なら並べる枠に入れる（レーダーの「全問」と「苦手と未着手」）
        html += c.group || list.length > 1 ? `<div class="graph-drill-btns">${btns}</div>` : btns;
      }
      const total = d.questions.length + (d.moreCount || 0);
      html += `<h3 class="graph-qs-head">問題（${esc(total)}）</h3><ul class="graph-qs">`;
      for (const q of d.questions) {
        const node = typeof opts.questionNode === 'function' ? opts.questionNode(q.qid) : -1;
        html += `<li class="graph-q graph-q-${esc(q.status)}"${node >= 0 ? ` data-node="${node}" role="button" tabindex="0"` : ''}><span class="graph-q-status">${esc(STATUS_LABEL[q.status] || q.status)}</span>` +
          `<span class="graph-q-no">#${esc(q.qid)}</span><span class="graph-q-text">${q.text == null ? '' : esc(q.text)}</span></li>`;
      }
      html += '</ul>';
      if (d.moreCount) html += `<p class="graph-more">ほか ${esc(d.moreCount)} 問</p>`;
      body.innerHTML = html;
    }

    // シートの高さ。r が null なら既定（中身の高さ、最大は CSS の max-height）、数なら容器に対するその割合
    function applyRatio(r) {
      ratio = typeof r === 'number' && Number.isFinite(r) ? r : null;
      el.style.height = ratio == null ? '' : `${(ratio * 100).toFixed(2)}%`;
      el.style.maxHeight = ratio == null ? '' : 'none';
      wide = ratio != null && ratio >= SHEET_WIDE_FROM;
      expandBtn.setAttribute('aria-pressed', String(wide));
      expandBtn.textContent = wide ? '縮める' : '広げる';
    }
    function remember(r) {
      if (typeof opts.setSheetHeight === 'function') {
        try { opts.setSheetHeight(r); } catch (e) { /* 覚えられなくても操作は止めない */ }
      }
    }
    function saved() {
      if (typeof opts.getSheetHeight !== 'function') return null;
      try { const r = opts.getSheetHeight(); return typeof r === 'number' && Number.isFinite(r) ? r : null; } catch (e) { return null; }
    }
    // 「広げる」「縮める」ボタン（キーボードでも使える）。押した高さも覚える
    function setWide(next) {
      const r = next ? SHEET_WIDE_RATIO : SHEET_DEFAULT_RATIO;
      applyRatio(r);
      remember(r);
    }
    // つまみ・見出しを上下させて高さを変える（計算は src/sheet-size.js）。離したところで止まり、その割合を覚える。
    // 下限よりさらに引き下ろすか、素早く下へはじくと閉じる。見出しのボタンを押したときは動かさない
    function onPointerDown(e) {
      if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('button') || typeof S.resolveSheetDrag !== 'function') return;
      if (!e.target.closest('.graph-sheet-grab, .graph-sheet-head')) return;
      const box = el.parentElement ? el.parentElement.getBoundingClientRect().height : 0;
      drag = { id: e.pointerId, y0: e.clientY, start: el.getBoundingClientRect().height, box, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベントなど */ }
      e.preventDefault();
    }
    function dragResult(e, velocity) {
      const head = el.querySelector('.graph-sheet-head');
      const minPx = (head ? head.getBoundingClientRect().height : 0) + SHEET_MIN_BODY_PX; // 見出しと本文の頭が隠れないように
      return S.resolveSheetDrag({ startPx: drag.start, dyPx: e.clientY - drag.y0, containerPx: drag.box, velocity, minPx });
    }
    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (e.clientY - drag.lastY) / dt;
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      el.style.maxHeight = 'none';
      el.style.height = `${dragResult(e, 0).px}px`;
    }
    function onPointerUp(e, cancelled) {
      if (!drag || e.pointerId !== drag.id) return;
      const velocity = e.timeStamp - drag.lastT > 100 ? 0 : drag.v; // 止めてから離したら、はじいたことにしない
      const moved = Math.abs(e.clientY - drag.y0);
      const r = dragResult(e, velocity);
      drag = null;
      if (cancelled || moved < 4) { applyRatio(ratio); return; } // 動かしていなければ元のまま
      if (r.close) { applyRatio(ratio); close(); return; }
      applyRatio(r.ratio);
      remember(r.ratio);
    }

    function open() {
      body.scrollTop = 0;
      if (el.hidden) applyRatio(saved()); // 開くときは覚えた高さで（開いたまま別の項目に移るときは今の高さのまま）
      el.hidden = false;
      try { el.focus({ preventScroll: true }); } catch (e) { /* 古いブラウザ */ }
    }
    function close() {
      if (el.hidden) return;
      el.hidden = true;
      picks = null;
      drag = null;
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    function onClick(e) {
      if (e.target.closest('.graph-sheet-close')) { close(); return; }
      if (e.target.closest('.graph-sheet-expand')) { setWide(!wide); return; }
      const b = e.target.closest('.graph-drill-btn');
      if (b) {
        const p = picks && picks[b.dataset.drill];
        if (p && typeof opts.onDrill === 'function') opts.onDrill({ ids: p.ids.slice(), label: p.label, kind: p.kind });
        return;
      }
      const li = e.target.closest('.graph-q[data-node]');
      if (li && typeof opts.onQuestion === 'function') opts.onQuestion(Number(li.dataset.node));
    }
    function onKey(e) {
      if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.closest) return;
      const li = e.target.closest('.graph-q[data-node]');
      if (!li) return;
      e.preventDefault();
      if (typeof opts.onQuestion === 'function') opts.onQuestion(Number(li.dataset.node));
    }
    function onDocKey(e) {
      if (e.key === 'Escape' && !el.hidden) { e.preventDefault(); close(); }
    }

    opts.on(el, 'click', onClick);
    opts.on(el, 'keydown', onKey);
    opts.on(el, 'pointerdown', onPointerDown);
    opts.on(el, 'pointermove', onPointerMove);
    opts.on(el, 'pointerup', e => onPointerUp(e, false));
    opts.on(el, 'pointercancel', e => onPointerUp(e, true));
    opts.on(document, 'keydown', onDocKey);

    return { el, render, open, close, isOpen: () => !el.hidden, contains: node => !!node && el.contains(node) };
  }

  root.GraphSheet = { create };
})(typeof self !== 'undefined' ? self : this);
