// ---- 画面 ----

// 単語の苦手はモードごとの件数、学習済みはどれかのモードで答えた単語の数
function wordCounts(weakByMode, seenByMode) {
  const list = x => (Array.isArray(x) || x instanceof Set ? [...x] : []);
  return {
    words: Object.fromEntries(VOCAB_MODES.map(m => [m, isPlainObject(weakByMode[m]) ? Object.keys(weakByMode[m]).length : 0])),
    seen: new Set(VOCAB_MODES.flatMap(m => list(seenByMode[m]))).size,
  };
}

function currentCounts() {
  const dueCount = data => Object.values(data).filter(isDue).length;
  return {
    ...wordCounts(state.weakByMode, state.seenByMode),
    wordsDue: Object.fromEntries(VOCAB_MODES.map(m => [m, dueCount(state.weakByMode[m])])),
    grammar: Object.keys(state.grammarWeakData).length,
    grammarDue: dueCount(state.grammarWeakData),
    grammarSeen: state.grammarSeen.size,
    wordStats: summarizeStats(state.wordStats),
    grammarStats: summarizeStats(state.grammarStats),
  };
}

// 取り消し用に残した記録（保存されている文字列のまま）の件数
function countsFromRaw(records) {
  const parse = raw => {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  };
  const words = parse(records[RECORD_KEYS.weakWords]);
  const grammar = parse(records[RECORD_KEYS.weakGrammar]);
  const seen = parse(records[RECORD_KEYS.seenWords]);
  const wordStats = parse(records[RECORD_KEYS.wordStats]);
  const grammarStats = parse(records[RECORD_KEYS.grammarStats]);
  const grammarSeen = parse(records[RECORD_KEYS.seenGrammar]);
  return {
    ...wordCounts(isPlainObject(words) ? words : {}, isPlainObject(seen) ? seen : {}),
    grammar: isPlainObject(grammar) ? Object.keys(grammar).length : 0,
    // 出題済みの記録が無い取り消し用の記録は、取り消したあと成績と苦手リストから作り直される
    grammarSeen: records[RECORD_KEYS.seenGrammar] == null
      ? seedGrammarSeenFromRaw(grammarStats, grammar).length
      : (Array.isArray(grammarSeen) ? grammarSeen.length : 0),
    wordStats: summarizeStats(isPlainObject(wordStats) ? wordStats : {}),
    grammarStats: summarizeStats(isPlainObject(grammarStats) ? grammarStats : {}),
  };
}

function compareTable(leftLabel, rightLabel, left, right, extraRows = '') {
  return `
    <table class="backup-table compare">
      <tr><th></th><th>${leftLabel}</th><th>${rightLabel}</th></tr>
      ${VOCAB_MODES.map(m => `<tr><td>単語の苦手（${MODE_LABELS[m]}）</td><td>${left.words[m]}件</td><td>${right.words[m]}件</td></tr>`).join('')}
      <tr><td>文法の苦手</td><td>${left.grammar}件</td><td>${right.grammar}件</td></tr>
      <tr><td>出題済みの文法</td><td>${left.grammarSeen}問</td><td>${right.grammarSeen}問</td></tr>
      <tr><td>学習済みの単語</td><td>${left.seen}語</td><td>${right.seen}語</td></tr>
      <tr><td>単語 累計解答数</td><td>${left.wordStats ? `${left.wordStats.totalA}問 (${left.wordStats.rate}%)` : '—'}</td><td>${right.wordStats ? `${right.wordStats.totalA}問 (${right.wordStats.rate}%)` : '—'}</td></tr>
      <tr><td>文法 累計解答数</td><td>${left.grammarStats ? `${left.grammarStats.totalA}問 (${left.grammarStats.rate}%)` : '—'}</td><td>${right.grammarStats ? `${right.grammarStats.totalA}問 (${right.grammarStats.rate}%)` : '—'}</td></tr>
      ${extraRows}
    </table>`;
}

function backupHomeHtml(v) {
  const c = currentCounts();
  const meta = loadJSON(BACKUP_META_KEY, {});
  const undo = loadUndo();
  const isLinked = isGoogleDriveLinked();
  const autoSync = isGoogleDriveAutoSyncEnabled();
  const lastSync = parseInt(localStorage.getItem(GDRIVE_LAST_SYNC_KEY) || '0', 10);

  return `
    ${v.success ? `<div class="backup-msg ok">${escapeHtml(v.success)}</div>` : ''}
    ${v.error ? `<div class="backup-msg ng">${escapeHtml(v.error)}</div>` : ''}

    <!-- Google ドライブ自動保存 -->
    <div class="gdrive-card">
      <div class="gdrive-header">
        <div class="gdrive-title">
          <span>☁️ Google ドライブ自動保存</span>
        </div>
        <span class="gdrive-badge ${isLinked ? 'linked' : 'unlinked'}">
          ${isLinked ? '● 連携中' : '未連携'}
        </span>
      </div>
      ${!isLinked ? `
        <div class="gdrive-desc">
          Google ドライブのアプリ専用領域に学習記録を自動バックアップします。別端末の記録とも自動で合算・同期されます。
        </div>
        <button class="backup-btn primary" data-backup="gdrive-login" style="width:100%;text-align:center;">
          🔑 Google アカウントで連携
        </button>
      ` : `
        <div class="gdrive-desc">
          ${lastSync > 0 ? `最終同期: ${formatDateTime(lastSync)}` : 'まだ同期されていません'}
          ${gdriveLastSyncMsg ? `<div class="gdrive-sync-msg">${escapeHtml(gdriveLastSyncMsg)}</div>` : ''}
        </div>
        <div class="gdrive-row">
          <span>学習時に自動で同期・合算</span>
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
            <input type="checkbox" id="gdrive-auto-toggle" ${autoSync ? 'checked' : ''} onchange="toggleGoogleDriveAutoSync(this.checked)">
            <span style="font-size:12px;font-weight:600;">${autoSync ? 'ON' : 'OFF'}</span>
          </label>
        </div>
        <div class="backup-actions" style="margin: 10px 0 4px;">
          <button class="backup-btn primary" data-backup="gdrive-sync">☁️ 今すぐ同期（合算保存）</button>
          <button class="backup-btn" data-backup="gdrive-restore">📥 ドライブから復元…</button>
        </div>
        <div style="text-align:right; margin-top:8px;">
          <button class="backup-back" data-backup="gdrive-unlink" style="color:var(--wrong);font-size:11.5px;margin:0;">連携を解除する</button>
        </div>
      `}
    </div>

    <div class="guide-label">この端末の学習記録・通算成績</div>
    <div style="background:rgba(255,255,255,0.4);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;line-height:1.6;">
      📘 <strong>単語ドリル通算:</strong> ${c.wordStats.totalA.toLocaleString()}問解答（正答率 ${c.wordStats.rate}%・学習済み ${c.seen}語）<br>
      👑 <strong>文法ドリル通算:</strong> ${c.grammarStats.totalA.toLocaleString()}問解答（正答率 ${c.grammarStats.rate}%・苦手 ${c.grammar}問）
    </div>
    <table class="backup-table">
      ${VOCAB_MODES.map(m => `<tr><td>単語の苦手（${MODE_LABELS[m]}）</td><td>${c.words[m]}件（要復習 ${c.wordsDue[m]}件）</td></tr>`).join('')}
      <tr><td>文法の苦手</td><td>${c.grammar}件（要復習 ${c.grammarDue}件）</td></tr>
      <tr><td>出題済みの文法</td><td>${c.grammarSeen}問</td></tr>
      <tr><td>学習済みの単語</td><td>${c.seen}語</td></tr>
    </table>
    <div class="backup-note">最後に書き出した日時: ${Number.isFinite(meta.lastExportAt) ? formatDateTime(meta.lastExportAt) : 'まだ書き出していません'}</div>
    <div class="backup-actions">
      <button class="backup-btn primary" data-backup="export">💾 バックアップを書き出す</button>
      <button class="backup-btn" data-backup="copy">📋 クリップボードにコピー</button>
      ${canShareBackup() ? '<button class="backup-btn" data-backup="share">共有して保存・送る</button>' : ''}
      <button class="backup-btn" data-backup="pick">📂 ファイルから復元…</button>
    </div>
    <!-- accept で絞ると iPhone で .json が選べないことがあるので絞らず、読み込んでから確かめる -->
    <input type="file" id="backup-file" hidden>
    <div style="margin-top:14px;border-top:1px dashed rgba(0,0,0,0.15);padding-top:10px;">
      <div class="guide-label">テキストを貼り付けて復元・引き継ぎ</div>
      <textarea id="backup-paste-input" class="backup-paste-area" placeholder="ここにバックアップJSONテキストを貼り付けて復元できます"></textarea>
      <button class="backup-btn small" data-backup="paste-confirm" style="width:100%;text-align:center;">📥 貼り付けたテキストから復元…</button>
    </div>
    ${undo ? `
      <div class="backup-undo" style="margin-top:14px;">
        ${formatDateTime(undo.savedAt)} の復元より前の記録を残しています。
        <button class="backup-btn small" data-backup="undo">直前の復元を取り消す</button>
      </div>` : ''}
    <div class="backup-help" style="margin-top:14px;">
      苦手リスト（復習日を含む。単語はモードごと）・学習済みの単語・出題済みの文法・通算の正誤カウント・設定・出題の続きを1つのファイルに保存します。
      別の端末やブラウザで復元すると、同じ記録で続けられます（統合と上書きを選べます）。
      記録はこの端末の中にしか無いので、ときどき書き出しておくと安心です。
    </div>`;
}

function backupConfirmHtml(v) {
  const p = v.pending;
  const r = p.records;
  const notes = [];
  if (p.invalid > 0) notes.push(`形の正しくない記録 ${p.invalid}件は読み込みません。`);
  if (p.unknownWords + p.unknownGrammar > 0) {
    notes.push(`今の単語・問題データに無い記録（単語 ${p.unknownWords}件・問題 ${p.unknownGrammar}件）も、消さずに残します。`);
  }
  const fromFile = name => (r[name] === undefined ? 'なし（今のまま）' : 'あり');
  const fileCounts = {
    ...wordCounts(r.weakWords, r.seenWords),
    grammar: Object.keys(r.weakGrammar).length,
    grammarSeen: r.seenGrammar.length,
    wordStats: summarizeStats(r.wordStats),
    grammarStats: summarizeStats(r.grammarStats),
  };
  const isOverwrite = v.restoreMode === 'overwrite';
  return `
    <div class="guide-label">復元するファイル・テキスト</div>
    <div class="backup-file-name">${escapeHtml(v.fileName)}</div>
    <div class="backup-note">書き出した日時: ${p.exportedAt ? formatDateTime(p.exportedAt) : '不明'}</div>
    ${compareTable('今の記録', 'ファイル・テキスト', currentCounts(), fileCounts,
      `<tr><td>設定</td><td>あり</td><td>${fromFile('settings')}</td></tr>
       <tr><td>出題の続き</td><td>あり</td><td>${fromFile('session')}</td></tr>
       <tr><td>日別の学習記録・目標</td><td>あり</td><td>${p.extras && p.extras.activity ? 'あり' : 'なし（今のまま）'}</td></tr>`)}
    ${notes.length ? `<ul class="backup-notes">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
    
    <div class="guide-label" style="margin-top:12px;">復元方法</div>
    <div class="filter-row" style="flex-wrap:wrap;margin-bottom:6px;">
      <button class="chip ${!isOverwrite ? 'active' : ''}" data-backup="mode-merge">今の記録に統合（おすすめ）</button>
      <button class="chip ${isOverwrite ? 'active' : ''}" data-backup="mode-overwrite">上書きして置き換え</button>
    </div>
    <div class="backup-note" style="margin-bottom:10px;">
      ${isOverwrite
        ? '⚠️ この端末の記録はバックアップの内容に完全に入れ替わります。'
        : '💡 苦手・学習済み・問題ごとの正誤カウントを両方合わせ、より進んでいる記録を残します。日別の記録は、同じ日の回答数が多い方を残します（端末どうしの合算ではありません）。'}
    </div>

    <div class="backup-msg warn">${isOverwrite ? '復元すると、この端末の学習記録はバックアップの内容に置き換わります。' : '復元すると、バックアップのデータが現在の記録に合算・統合されます。'}</div>
    <label class="backup-check"><input type="checkbox" id="backup-pre-export" checked> 復元の前に、今の記録を書き出しておく</label>
    <div class="backup-actions">
      <button class="backup-btn danger" data-backup="restore">${isOverwrite ? '上書き復元する' : '統合して復元する'}</button>
      <button class="backup-btn" data-backup="cancel">やめる</button>
    </div>`;
}

function backupUndoHtml() {
  const undo = loadUndo();
  if (!undo) return backupHomeHtml({ error: '取り消せる復元がありません。' });
  return `
    <div class="guide-label">直前の復元を取り消す</div>
    <div class="backup-note">${formatDateTime(undo.savedAt)} に復元する前の記録に戻します。</div>
    ${compareTable('今の記録', '戻す記録', currentCounts(), countsFromRaw(undo.records))}
    <div class="backup-msg warn">復元したあとに学習した分は、取り消すと消えます。</div>
    <div class="backup-actions">
      <button class="backup-btn danger" data-backup="undo-confirm">取り消す</button>
      <button class="backup-btn" data-backup="cancel">やめる</button>
    </div>`;
}

function renderBackupSheet() {
  const v = backupView;
  let backLabel = backupSource === 'weak' ? '‹ 苦手リストに戻る' : '‹ 設定に戻る';
  let html = `<button class="backup-back" data-backup="back">${backLabel}</button>`;
  if (v.step === 'confirm') html += backupConfirmHtml(v);
  else if (v.step === 'undo') html += backupUndoHtml();
  else html += backupHomeHtml(v);
  document.getElementById('weak-list-content').innerHTML = html;
  const input = document.getElementById('backup-file');
  if (input) input.onchange = onBackupFileChosen;
}

// ファイル選択や共有のあと、バックアップの画面がまだ開いていれば描き直す
function refreshBackupSheet() {
  if (isSheetOpen() && activeSheetRender === renderBackupSheet) renderBackupSheet();
}

async function onBackupFileChosen(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = ''; // 同じファイルを選び直しても反応するように
  if (!file) return;
  const result = await readBackupFile(file);
  backupView = result.ok
    ? { step: 'confirm', pending: result, fileName: file.name, restoreMode: 'merge' }
    : { step: 'home', error: result.error };
  refreshBackupSheet();
}

function backupEntryHtml() {
  return '<button class="backup-open-btn" data-backup="open" onclick="backupSource=\'weak\'">💾 学習記録のバックアップ・復元</button>';
}

async function copyBackup() {
  const json = JSON.stringify(buildBackup(), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    markExported();
    backupView = { ...backupView, success: 'バックアップのJSONテキストをクリップボードにコピーしました。' };
  } catch (e) {
    const area = document.getElementById('backup-paste-input');
    if (area) {
      area.value = json;
      area.focus();
      area.select();
      markExported();
      backupView = { ...backupView, success: '下のテキスト欄にバックアップ内容を出力しました。コピーしてご利用ください。' };
    } else {
      backupView = { ...backupView, error: 'クリップボードにコピーできませんでした。' };
    }
  }
  refreshBackupSheet();
}

function onBackupPasteConfirm() {
  const area = document.getElementById('backup-paste-input');
  const text = area ? area.value.trim() : '';
  if (!text) {
    backupView = { ...backupView, error: 'テキスト欄にバックアップJSONを貼り付けてください。' };
    return refreshBackupSheet();
  }
  const result = parseBackup(text);
  backupView = result.ok
    ? { step: 'confirm', pending: result, fileName: '貼り付けたテキスト', restoreMode: 'merge' }
    : { step: 'home', error: result.error };
  refreshBackupSheet();
}

function handleBackupAction(action) {
  switch (action) {
    case 'open':
      backupView = { step: 'home', restoreMode: 'merge' };
      return openSheet('学習記録のバックアップ', renderBackupSheet, true);
    case 'back':
      if (backupSource === 'weak') {
        return openSheet('苦手リスト', renderWeakList, false);
      }
      return closeSheet(); // 設定ページから開いたので、シートを閉じれば設定ページに戻る
    case 'gdrive-login':
      return saveToGoogleDrive({ interactive: true });
    case 'gdrive-sync':
      return saveToGoogleDrive({ interactive: true });
    case 'gdrive-restore':
      return loadFromGoogleDrive({ interactive: true });
    case 'gdrive-unlink':
      if (confirm('Google ドライブとの連携を解除しますか？\n（ドライブ内のバックアップデータは削除されません）')) {
        unlinkGoogleDrive();
      }
      return;
    case 'export':
      downloadBackup();
      backupView = { step: 'home', success: '書き出しました。ダウンロードしたファイル（iPhone は「ファイル」アプリ）を保管してください。' };
      return renderBackupSheet();
    case 'copy':
      return copyBackup();
    case 'share':
      return shareBackup();
    case 'pick':
      return document.getElementById('backup-file').click();
    case 'paste-confirm':
      return onBackupPasteConfirm();
    case 'mode-merge':
      backupView.restoreMode = 'merge';
      return refreshBackupSheet();
    case 'mode-overwrite':
      backupView.restoreMode = 'overwrite';
      return refreshBackupSheet();
    case 'restore':
      return runRestore();
    case 'undo':
      backupView = { step: 'undo' };
      return renderBackupSheet();
    case 'undo-confirm':
      return runUndo();
    case 'cancel':
      backupView = { step: 'home', restoreMode: 'merge' };
      return renderBackupSheet();
  }
}

function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.getElementById('app').appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3500);
  setTimeout(() => el.remove(), 4000);
}

