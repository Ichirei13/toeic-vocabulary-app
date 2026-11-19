// ==================== Google ドライブ自動バックアップ (AppData) ====================
const GOOGLE_CLIENT_ID = '739368898331-c517aujpdukivk4uang69hcm8go3p6ca.apps.googleusercontent.com';
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GDRIVE_LINKED_KEY = 'toeic_gdrive_linked';
const GDRIVE_AUTOSYNC_KEY = 'toeic_gdrive_autosync';
// 自動同期（記録が変わった4秒後・画面を離れたとき・起動時）は一旦止めている。コードは残してあり、
// true に戻せば再開する（画面のスイッチは backup-ui.js 側で別に外してある）。手動の同期（今すぐ同期・復元）はこの値に関係なく使える
const GDRIVE_AUTOSYNC_AVAILABLE = false;
const GDRIVE_LAST_SYNC_KEY = 'toeic_gdrive_last_sync';
const GDRIVE_LAST_MOD_KEY = 'toeic_gdrive_last_remote_mod';
const GDRIVE_BACKUP_FILENAME = 'toeic-drill-backup.json';
// 取得してから保存するまでの間に、ほかの端末がクラウドを書き換えていたら、取得からやり直す。その回数の上限
const GDRIVE_MAX_SYNC_ROUNDS = 3;

let gdriveTokenClient = null;
let gdriveAccessToken = null;
let gdriveTokenExpiresAt = 0;
let gdriveSyncTimer = null;
let gdriveIsSyncing = false;
let gdriveLastSyncMsg = '';
let gdriveAuthPendingCallback = null;

function isGoogleDriveLinked() {
  try {
    return localStorage.getItem(GDRIVE_LINKED_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function isGoogleDriveAutoSyncEnabled() {
  try {
    return GDRIVE_AUTOSYNC_AVAILABLE && isGoogleDriveLinked() && localStorage.getItem(GDRIVE_AUTOSYNC_KEY) !== '0';
  } catch (e) {
    return false;
  }
}

function toggleGoogleDriveAutoSync(enabled) {
  try {
    localStorage.setItem(GDRIVE_AUTOSYNC_KEY, enabled ? '1' : '0');
  } catch (e) {}
  refreshBackupSheet();
}

function initGoogleDriveClient() {
  if (gdriveTokenClient) return true;
  if (!window.google || !google.accounts || !google.accounts.oauth2) return false;
  try {
    gdriveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GDRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) {
          console.warn('[GDrive] Auth error:', resp);
          gdriveLastSyncMsg = '認証エラー: ' + (resp.error_description || resp.error);
          refreshBackupSheet();
          if (gdriveAuthPendingCallback) {
            const cb = gdriveAuthPendingCallback;
            gdriveAuthPendingCallback = null;
            cb(null);
          }
          return;
        }
        gdriveAccessToken = resp.access_token;
        const expiresIn = parseInt(resp.expires_in, 10) || 3600;
        gdriveTokenExpiresAt = Date.now() + (expiresIn - 120) * 1000;
        try {
          localStorage.setItem(GDRIVE_LINKED_KEY, '1');
          if (GDRIVE_AUTOSYNC_AVAILABLE && localStorage.getItem(GDRIVE_AUTOSYNC_KEY) === null) {
            localStorage.setItem(GDRIVE_AUTOSYNC_KEY, '1');
          }
        } catch (e) {}
        gdriveLastSyncMsg = '';
        refreshBackupSheet();
        if (gdriveAuthPendingCallback) {
          const cb = gdriveAuthPendingCallback;
          gdriveAuthPendingCallback = null;
          cb(gdriveAccessToken);
        }
      }
    });
    return true;
  } catch (e) {
    console.error('[GDrive] init error:', e);
    return false;
  }
}

function getGoogleAccessToken(interactive = false) {
  return new Promise((resolve) => {
    if (gdriveAccessToken && Date.now() < gdriveTokenExpiresAt) {
      return resolve(gdriveAccessToken);
    }
    if (!initGoogleDriveClient()) {
      return resolve(null);
    }
    gdriveAuthPendingCallback = resolve;
    try {
      gdriveTokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
    } catch (e) {
      console.warn('[GDrive] requestAccessToken failed:', e);
      gdriveAuthPendingCallback = null;
      resolve(null);
    }
  });
}

function unlinkGoogleDrive() {
  try {
    localStorage.removeItem(GDRIVE_LINKED_KEY);
    localStorage.removeItem(GDRIVE_LAST_SYNC_KEY);
    localStorage.removeItem(GDRIVE_LAST_MOD_KEY);
  } catch (e) {}
  const tokenToRevoke = gdriveAccessToken;
  gdriveAccessToken = null;
  gdriveTokenExpiresAt = 0;
  gdriveLastSyncMsg = '';
  if (tokenToRevoke && window.google && google.accounts && google.accounts.oauth2) {
    try {
      google.accounts.oauth2.revoke(tokenToRevoke, () => {});
    } catch (e) {}
  }
  showToast('Google ドライブとの連携を解除しました');
  refreshBackupSheet();
}

// クラウドのバックアップファイルを探す。file は見つからなければ null。
// serverNow は Google 側の「今」（応答の Date ヘッダー。読めなければ NaN）。この端末の時計がずれていないかを確かめるのに使う
async function findGoogleDriveBackupFile(token) {
  const query = encodeURIComponent(`name = '${GDRIVE_BACKUP_FILENAME}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime,size,md5Checksum,version)&pageSize=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`ファイル検索に失敗しました (${res.status})`);
  }
  const data = await res.json();
  return {
    file: (data.files && data.files.length > 0) ? data.files[0] : null,
    serverNow: Date.parse((res.headers && res.headers.get('date')) || ''),
  };
}

// 取得したときと同じファイルのままか（ほかの端末が書き換えていないか）。応答に無い項目は比べない
function isSameDriveFileVersion(a, b) {
  return ['version', 'md5Checksum', 'modifiedTime'].every(k => a[k] === b[k]);
}

// 時計のずれを確かめる。統合は「最終更新が新しい方」を残すので、時計がずれた端末の記録が混ざると、新旧の判定が入れ替わって
// 記録が巻き戻る。ずれが分かったときは、統合も保存もせずに止める（止めても、手元とクラウドの記録はどちらも変わらない）。
// ずれていれば利用者に見せる文言、問題なければ null を返す。渡されなかった・読めなかった時刻は確かめない
//   serverNow: Google 側の「今」 / serverModified: クラウドのファイルの更新時刻（Google 側の時計）
//   exportedAt・latestTime: クラウドのファイルに入っている書き出し時刻と、記録のいちばん新しい時刻（書いた端末の時計）
function driveClockProblem({ serverNow = NaN, serverModified = NaN, exportedAt = NaN, latestTime = NaN }) {
  const now = Date.now();
  const tol = CLOCK_SKEW_TOLERANCE_MS;
  const own = 'この端末の時計がずれているため、同期を止めました。時計を合わせてから、もう一度同期してください。記録は変えていません';
  if (Number.isFinite(serverNow) && Math.abs(serverNow - now) > tol) return own;
  if (Number.isFinite(serverModified) && serverModified - now > tol) return own;
  const latestInFile = Math.max(Number.isFinite(exportedAt) ? exportedAt : 0, Number.isFinite(latestTime) ? latestTime : 0);
  if (latestInFile - now > tol) {
    return 'クラウドの記録に、この端末の時計より先の時刻が入っているため、同期を止めました。前に同期した端末の時計が進んでいたようです。その時刻を過ぎると、また同期できます。記録は変えていません';
  }
  return null;
}

// クラウドとローカルの双方向マージ同期（合算保存・反映）
async function syncWithGoogleDrive({ interactive = false, silent = false } = {}) {
  if (gdriveIsSyncing) return false;
  const token = await getGoogleAccessToken(interactive);
  if (!token) {
    if (!silent) showToast('Google連携のログインが必要です');
    return false;
  }

  gdriveIsSyncing = true;
  if (!silent) showToast('☁️ Google ドライブと同期・合算中...');
  try {
    const found = await findGoogleDriveBackupFile(token);
    let existingFile = found.file;
    // この端末の時計がずれていたら、何もせずに止める（ずれた時刻の記録をクラウドに上げない）
    const ownClockProblem = driveClockProblem({ serverNow: found.serverNow });
    if (ownClockProblem) throw new Error(ownClockProblem);

    if (existingFile) {
      for (let round = 1; ; round++) {
        // 1. クラウド側の最新バックアップを取得
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`クラウドからの取得に失敗しました (${res.status})`);
        const remoteText = await res.text();

        // 中身が空のファイル（作成途中で止まったものなど）は、失う記録がないので手元の内容で作り直す
        if (remoteText.trim() !== '') {
          const remoteParsed = parseBackup(remoteText);

          // クラウド側が読めない（壊れている、またはこのアプリより新しい形式）ときは、
          // 手元の内容で上書きするとクラウドの記録を失うので、保存せずに止める
          if (!remoteParsed.ok) {
            throw new Error('クラウドのバックアップを読み込めないため、上書きを中止しました (' + remoteParsed.error + ')');
          }

          // クラウドの記録の時刻がこの端末の時計より先なら、統合せずに止める
          const clockProblem = driveClockProblem({
            serverModified: Date.parse(existingFile.modifiedTime || ''),
            exportedAt: remoteParsed.exportedAt === null ? NaN : remoteParsed.exportedAt,
            latestTime: remoteParsed.latestTime,
          });
          if (clockProblem) throw new Error(clockProblem);

          // 2. 手元データとクラウドデータを合算（マージ）
          const localRec = getCurrentLocalRecords();
          const mergedRecords = mergeBackupRecords(localRec, remoteParsed.records);
          // 3. 合算結果を手元（メモリ・ストレージ）に反映
          applyMergedRecordsToLocal(mergedRecords);
        }

        // 保存の直前に、取得したあとでほかの端末がクラウドを書き換えていないか確かめる。
        // 書き換えられていたら、そのまま保存すると相手の記録を消してしまうので、取得からやり直す。
        // （確かめてから保存するまでの通信 1 回ぶんの隙は残る。消えるのはクラウド側だけで、相手の端末が次に同期すれば戻る）
        const latest = (await findGoogleDriveBackupFile(token)).file;
        if (!latest || isSameDriveFileVersion(existingFile, latest)) break;
        if (round >= GDRIVE_MAX_SYNC_ROUNDS) {
          throw new Error('ほかの端末が同時に同期しているため、クラウドへの保存を見送りました。少し待ってから、もう一度同期してください');
        }
        existingFile = latest;
      }

      // 4. 合算された完全な最新データをクラウドへ上書き保存 (PATCH)
      const mergedBackupData = buildBackup({ forDrive: true });
      const mergedBackupJson = JSON.stringify(mergedBackupData, null, 2);

      const patchRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: mergedBackupJson
      });
      if (!patchRes.ok) throw new Error(`クラウドへの保存に失敗しました (${patchRes.status})`);
      const savedFile = await patchRes.json();
      if (savedFile.modifiedTime) {
        // クラウドへの保存は済んでいる。この控えが書けなくても、同期を失敗にしない
        try { localStorage.setItem(GDRIVE_LAST_MOD_KEY, savedFile.modifiedTime); } catch (e) {}
      }
    } else {
      // 初回：クラウドにファイルが無いので新規作成 (POST)
      const backupData = buildBackup({ forDrive: true });
      const backupJson = JSON.stringify(backupData, null, 2);
      const metadata = {
        name: GDRIVE_BACKUP_FILENAME,
        parents: ['appDataFolder']
      };
      const boundary = '-------toeic_drill_gdrive_boundary';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;
      const body = delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        backupJson +
        closeDelim;

      const postRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`
        },
        body: body
      });
      if (!postRes.ok) throw new Error(`クラウドへの新規保存に失敗しました (${postRes.status})`);
      const savedFile = await postRes.json();
      if (savedFile.modifiedTime) {
        try { localStorage.setItem(GDRIVE_LAST_MOD_KEY, savedFile.modifiedTime); } catch (e) {}
      }
    }

    const now = Date.now();
    try {
      localStorage.setItem(GDRIVE_LAST_SYNC_KEY, String(now));
    } catch (e) {}
    markExported();
    gdriveLastSyncMsg = '正常に同期・合算されました (' + formatDateTime(now) + ')';
    if (!silent) showToast('✅ Google ドライブと最新の学習記録を同期・合算しました');
    refreshBackupSheet();
    return true;
  } catch (err) {
    console.error('[GDrive] sync error:', err);
    gdriveLastSyncMsg = '同期エラー: ' + err.message;
    if (!silent) showToast('⚠️ Google ドライブ同期失敗: ' + err.message);
    refreshBackupSheet();
    return false;
  } finally {
    gdriveIsSyncing = false;
  }
}

// 互換性のため別名も定義
const saveToGoogleDrive = syncWithGoogleDrive;

async function loadFromGoogleDrive({ interactive = false } = {}) {
  const token = await getGoogleAccessToken(interactive);
  if (!token) {
    showToast('Google連携のログインが必要です');
    return null;
  }
  showToast('☁️ ドライブから記録を取得中...');
  try {
    const { file } = await findGoogleDriveBackupFile(token);
    if (!file) {
      showToast('Google ドライブ内にバックアップが見つかりませんでした');
      return null;
    }
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`ダウンロードに失敗しました (${res.status})`);
    const backupText = await res.text();
    const result = parseBackup(backupText);
    if (!result.ok) {
      showToast('データの解析に失敗しました: ' + result.error);
      return null;
    }
    backupView = {
      step: 'confirm',
      pending: result,
      fileName: 'Google ドライブ (AppData)',
      restoreMode: 'merge'
    };
    refreshBackupSheet();
    return result;
  } catch (err) {
    console.error('[GDrive] load error:', err);
    showToast('⚠️ ドライブからの取得に失敗: ' + err.message);
    return null;
  }
}

// 保存されたキーが自動同期のきっかけになるか。学習記録だけ。
// 設定と出題の続きは描画のたびに保存されるので、これで同期すると同期が次の同期を呼び続ける
function autoSyncTriggeredBy(key) {
  if (typeof RECORD_STORAGE_KEYS !== 'undefined' && !RECORD_STORAGE_KEYS.includes(key)) return false;
  return key !== SETTINGS_KEY && key !== SESSION_KEY;
}

function scheduleGoogleDriveAutoSync(key) {
  if (!isGoogleDriveAutoSyncEnabled()) return;
  if (!autoSyncTriggeredBy(key)) return;

  if (gdriveSyncTimer) clearTimeout(gdriveSyncTimer);
  gdriveSyncTimer = setTimeout(() => {
    if (gdriveAccessToken && Date.now() < gdriveTokenExpiresAt) {
      syncWithGoogleDrive({ interactive: false, silent: true });
    }
  }, 4000);
}
// 保存の側（util.js の saveJSON）は同期を知らない。保存されたら通知が来るので、ここで受け取って同期を予約する
onStorageSaved(scheduleGoogleDriveAutoSync);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && gdriveSyncTimer) {
    clearTimeout(gdriveSyncTimer);
    gdriveSyncTimer = null;
    if (isGoogleDriveAutoSyncEnabled() && gdriveAccessToken && Date.now() < gdriveTokenExpiresAt) {
      syncWithGoogleDrive({ interactive: false, silent: true });
    }
  }
});

async function checkGoogleDriveOnStartup() {
  if (!GDRIVE_AUTOSYNC_AVAILABLE || !isGoogleDriveLinked()) return;
  setTimeout(async () => {
    if (!initGoogleDriveClient()) return;
    const token = await getGoogleAccessToken(false);
    if (!token) return;
    try {
      await syncWithGoogleDrive({ interactive: false, silent: true });
    } catch (e) {
      console.warn('[GDrive] startup sync error:', e);
    }
  }, 2000);
}

