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

// 保存したら、Google ドライブ連携が有効なら自動同期の予約もする（scheduleGoogleDriveAutoSync は gdrive.js にあり、後から読み込まれる）
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
