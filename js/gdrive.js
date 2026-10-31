// ==================== Google ドライブ自動バックアップ (AppData) ====================
const GOOGLE_CLIENT_ID = '739368898331-c517aujpdukivk4uang69hcm8go3p6ca.apps.googleusercontent.com';
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GDRIVE_LINKED_KEY = 'toeic_gdrive_linked';
const GDRIVE_AUTOSYNC_KEY = 'toeic_gdrive_autosync';
const GDRIVE_LAST_SYNC_KEY = 'toeic_gdrive_last_sync';
const GDRIVE_LAST_MOD_KEY = 'toeic_gdrive_last_remote_mod';
const GDRIVE_BACKUP_FILENAME = 'toeic-drill-backup.json';

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
    return isGoogleDriveLinked() && localStorage.getItem(GDRIVE_AUTOSYNC_KEY) !== '0';
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
          if (localStorage.getItem(GDRIVE_AUTOSYNC_KEY) === null) {
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

async function findGoogleDriveBackupFile(token) {
  const query = encodeURIComponent(`name = '${GDRIVE_BACKUP_FILENAME}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime,size)&pageSize=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`ファイル検索に失敗しました (${res.status})`);
  }
  const data = await res.json();
  return (data.files && data.files.length > 0) ? data.files[0] : null;
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
    const existingFile = await findGoogleDriveBackupFile(token);

    if (existingFile) {
      // 1. クラウド側の最新バックアップを取得
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`クラウドからの取得に失敗しました (${res.status})`);
      const remoteText = await res.text();
      const remoteParsed = parseBackup(remoteText);

      // 2. 手元データとクラウドデータを合算（マージ）
      if (remoteParsed.ok) {
        const localRec = getCurrentLocalRecords();
        const mergedRecords = mergeBackupRecords(localRec, remoteParsed.records);
        // 3. 合算結果を手元（メモリ・ストレージ）に反映
        applyMergedRecordsToLocal(mergedRecords);
      } else {
        console.warn('[GDrive] remote parse warning:', remoteParsed.error);
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
        localStorage.setItem(GDRIVE_LAST_MOD_KEY, savedFile.modifiedTime);
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
        localStorage.setItem(GDRIVE_LAST_MOD_KEY, savedFile.modifiedTime);
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
    const file = await findGoogleDriveBackupFile(token);
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

function scheduleGoogleDriveAutoSync(key) {
  if (!isGoogleDriveAutoSyncEnabled()) return;
  if (typeof RECORD_STORAGE_KEYS !== 'undefined' && !RECORD_STORAGE_KEYS.includes(key)) return;
  // 設定と出題の続きは描画のたびに保存されるので、これで同期すると同期が次の同期を呼び続ける
  if (key === SETTINGS_KEY || key === SESSION_KEY) return;

  if (gdriveSyncTimer) clearTimeout(gdriveSyncTimer);
  gdriveSyncTimer = setTimeout(() => {
    if (gdriveAccessToken && Date.now() < gdriveTokenExpiresAt) {
      syncWithGoogleDrive({ interactive: false, silent: true });
    }
  }, 4000);
}

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
  if (!isGoogleDriveLinked()) return;
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

