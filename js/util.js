// 複数のファイルから使う小さな関数。他のファイルの最上位コードからも呼ばれるので、最初に読み込む

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---- HTML・画面 ----

// innerHTML に入れる文字列から、タグや属性を壊す記号を無害にする。ユーザー入力や外部から来る文字列はこれを通す
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 画面下に短いお知らせを出す
function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.getElementById('app').appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3500);
  setTimeout(() => el.remove(), 4000);
}

// ---- 配列 ----

// 配列をその場でシャッフルして返す（Fisher–Yates）
function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

// ---- 保存（localStorage） ----

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

// 保存先の値がすでに同じなら書かない。書いても保存の結果は変わらないので、書かなくても失うものはない
// （描画のたびに同じ設定や出題の続きを書き直していた分を省く）。書いたら true、同じで省いたら false を返す。
// 保存できないときは localStorage の例外がそのまま出る（呼び出し側で扱う）
function writeStorage(key, raw) {
  if (localStorage.getItem(key) === raw) return false;
  localStorage.setItem(key, raw);
  return true;
}

// 「保存した」という通知の受け手。saveJSON が実際に書いたとき（値が変わったとき）に、キーを渡して呼ぶ。
// 保存の側は、受け手が何をするか（同期など）を知らない。受け手は、読み込むファイルの側から onStorageSaved で登録する
const storageSavedListeners = [];
function onStorageSaved(listener) {
  storageSavedListeners.push(listener);
}

// 「保存に失敗した」という通知の受け手。画面にお知らせを出す側が登録する（保存の側は画面を知らない）
const saveFailureListeners = [];
function onStorageSaveFailed(listener) {
  saveFailureListeners.push(listener);
}

// 保存に失敗したことを受け手に伝える。saveJSON を通らず例外を握りつぶしている書き込みからも呼ぶ。
// 受け手が例外を出しても、呼び出し側（保存や学習）は止めない
function reportSaveFailure(key) {
  saveFailureListeners.forEach(listener => {
    try { listener(key); } catch (e) { /* 受け手の不具合で、ほかの受け手や学習を止めない */ }
  });
}

// 値が変わっていなければ書かず、通知もしない。保存に失敗しても学習は続けられるので、例外は出さず、失敗の受け手に伝える。
// 受け手が例外を出しても、保存は済んでいて、ほかの受け手にも届く
function saveJSON(key, value) {
  try {
    if (!writeStorage(key, JSON.stringify(value))) return;
  } catch (e) {
    reportSaveFailure(key); // 保存できなくても学習は続けられるが、記録が残っていないことは知らせる
    return;
  }
  storageSavedListeners.forEach(listener => {
    try { listener(key); } catch (e) { /* 受け手の不具合で、保存や他の受け手を止めない */ }
  });
}
