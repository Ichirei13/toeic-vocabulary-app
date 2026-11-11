// 学習記録が消える・巻き戻る経路のテスト（2026-11-10 の調査で作成）。
// 実行: NODE_PATH=$(npm root -g) node tests/data-safety.test.js   （引数に 1 や 3b を付けると、その番号で始まるものだけ）
//
// 各シナリオは「記録が消える・巻き戻る不具合が再現するか」を調べ、「再現できた／再現できない」と根拠（観測した値）を出力する。
// 「再現できない」でなければ失敗（終了コード 1）。調査中でまだ直していない経路を足すときは { open: true } を付けると、
// 再現しても失敗にしない（直したら外す）。
// 番号: 1 複数タブ / 2 Drive 同期の重なり / 3 容量不足のときの巻き戻し / 4 端末の時計のずれ / 5 そのほか
//
// 前提: マージの規則（u の新しい方・より進んでいる方・合算しない）は意図した仕様として扱う。
// Google ドライブは本物に通信せず、Node 側の偽物（makeDrive）に差し替える。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let browser;
let baseUrl;
const DAY = 86400000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1 台の端末（= ブラウザの保存領域 1 つ）。time を渡すとその端末の時計を固定する
async function newDevice({ storage = {}, time = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 800 }, timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
  await context.route(url => new URL(url).origin !== baseUrl, route => route.abort());
  await context.addInitScript(items => {
    try {
      if (localStorage.getItem('__test_seeded')) return; // 同じ端末の 2 つ目のタブや再読み込みでは入れ直さない
      localStorage.setItem('__test_seeded', '1');
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) { /* 使えなければ何もしない */ }
  }, storage);
  const errors = [];
  const openTab = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(String(e)));
    if (time !== null) await page.clock.setFixedTime(new Date(time));
    await page.goto(baseUrl + '/index.html');
    return page;
  };
  return { context, openTab, errors, close: () => context.close() };
}

// 偽の Google ドライブ。ファイルは 1 つだけで、PATCH は無条件に上書きする（本物の PATCH も、条件を付けなければ同じ）
// modified: ファイルの更新時刻（Google 側の時計）。serverNow: 応答の Date ヘッダーに入れる Google 側の「今」。どちらも無ければ付けない。
// gate: { label, at } を入れると、その端末の at 回目のファイル検索を、だれかの PATCH が済むまで待たせる
function makeDrive(initialText = '') {
  const d = { text: initialText, log: [], holdGetsUntil: 0, waiting: [], version: 1, modified: null, serverNow: null, finds: {}, gate: null, gateWaiters: [] };
  d.handle = async (label, method, url, body) => {
    const date = d.serverNow === null ? null : new Date(d.serverNow).toUTCString();
    if (url.includes('spaces=appDataFolder')) {
      d.finds[label] = (d.finds[label] || 0) + 1;
      if (d.gate && d.gate.label === label && d.finds[label] === d.gate.at) await new Promise(resolve => d.gateWaiters.push(resolve));
      const file = { id: 'f1', version: String(d.version), ...(d.modified === null ? {} : { modifiedTime: new Date(d.modified).toISOString() }) };
      return { status: 200, date, body: JSON.stringify({ files: [file] }) };
    }
    if (method === 'PATCH') {
      d.log.push(`${label}: PATCH`);
      d.text = body;
      d.version++;
      d.gate = null; d.gateWaiters.forEach(r => r()); d.gateWaiters = [];
      return { status: 200, date, body: JSON.stringify({ modifiedTime: 't' }) };
    }
    if (url.includes('alt=media')) {
      const snapshot = d.text; // 取得した時点の中身
      d.log.push(`${label}: GET`);
      if (d.holdGetsUntil > 0) {
        // 指定した数の取得がそろうまで返事を止める（2 台が同じ中身を取得してから保存する、という重なりを作る）
        await new Promise(resolve => {
          d.waiting.push(resolve);
          if (d.waiting.length >= d.holdGetsUntil) { d.waiting.forEach(r => r()); d.waiting = []; d.holdGetsUntil = 0; }
        });
      }
      return { status: 200, body: snapshot };
    }
    return { status: 200, body: '{}' };
  };
  return d;
}

// そのタブの通信を偽のドライブに向け、連携済みの状態にする
async function linkDrive(page, label, drive) {
  await page.exposeFunction('__drive', (method, url, body) => drive.handle(label, method, url, body));
  await page.evaluate(() => {
    const realFetch = window.fetch;
    window.fetch = async (url, opt = {}) => {
      const u = String(url);
      if (!u.includes('googleapis.com')) return realFetch(url, opt);
      const r = await window.__drive(opt.method || 'GET', u, opt.body || null);
      return new Response(r.body, { status: r.status, headers: r.date ? { Date: r.date } : {} });
    };
    localStorage.setItem(GDRIVE_LINKED_KEY, '1');
    gdriveAccessToken = 'fake';
    gdriveTokenExpiresAt = Date.now() + 3600e3;
  });
}
const sync = page => page.evaluate(async () => ({ ok: await syncWithGoogleDrive({ silent: true }), msg: gdriveLastSyncMsg }));
const lsJson = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const dump = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])));
// 単語 RAW_WORDS[i] に答える（画面を通さず、回答時に呼ばれる記録の関数を直接呼ぶ）。記録のキーを返す
const answerWord = (page, i, isCorrect) => page.evaluate(([idx, ok]) => { recordWeak(RAW_WORDS[idx], ok); return wordStatKey(RAW_WORDS[idx].w); }, [i, isCorrect]);

// 保存領域に上限があるように見せる（上限 = 今の使用量 + slack 文字）。超える書き込みは本物と同じ例外を出す
const installBudget = (page, slack) => page.evaluate(s => {
  const orig = Storage.prototype.setItem;
  const total = () => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + localStorage.getItem(k).length; } return n; };
  const limit = total() + s;
  Storage.prototype.setItem = function (k, v) {
    if (this === localStorage) {
      const cur = this.getItem(k);
      const next = total() - (cur === null ? 0 : k.length + cur.length) + k.length + String(v).length;
      if (next > limit) throw new DOMException('quota', 'QuotaExceededError');
    }
    return orig.call(this, k, v);
  };
  return { used: total(), limit };
}, slack);

const scenarios = [];
const scenario = (id, title, fn, { open = false } = {}) => scenarios.push({ id, title, fn, open });
const YES = '再現できた';
const NO = '再現できない';

// ==================== 仮説1: 複数タブで state が互いを上書きする ====================

scenario('1a', '2 つのタブで別々に解くと、あとから保存したタブが先のタブの記録を消す', async () => {
  const dev = await newDevice();
  try {
    const tabA = await dev.openTab();
    const tabB = await dev.openTab(); // A が解く前に開いておく（B のメモリは A の回答を知らない）
    const solve = (page, n) => page.evaluate(async count => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const visible = sel => [...document.querySelectorAll(sel)].filter(b => b.checkVisibility());
      dismissNudge();
      setApp('vocab'); switchAppPage('practice'); await wait(50);
      for (let i = 0; i < count; i++) {
        visible('#choices-container button, button.choice-btn')[0].click(); await wait(30);
        visible('button').find(b => /次/.test(b.textContent)).click(); await wait(30);
      }
    }, n);
    const snapshot = page => page.evaluate(() => {
      const act = JSON.parse(localStorage.getItem('toeic_daily_activity_v1'));
      return {
        stats: JSON.parse(localStorage.getItem('toeic_word_stats')) || {},
        seen: (JSON.parse(localStorage.getItem('toeic_seen_words_by_mode')) || {}).e2j || [],
        today: ((act && act.days) || {})[localDateStr()] || null,
      };
    });
    await solve(tabA, 3);
    const afterA = await snapshot(tabA);
    await solve(tabB, 1);
    const afterB = await snapshot(tabB);
    const lostStats = Object.keys(afterA.stats).filter(k => !afterB.stats[k] || afterB.stats[k].a < afterA.stats[k].a);
    const lostSeen = afterA.seen.filter(w => !afterB.seen.includes(w));
    const evidence = [
      `タブAで3問のあと: 成績 ${Object.keys(afterA.stats).length} 件・出題済み ${afterA.seen.length} 語・今日の回答数 ${afterA.today && afterA.today.a}`,
      `タブBで1問のあと: 成績 ${Object.keys(afterB.stats).length} 件・出題済み ${afterB.seen.length} 語・今日の回答数 ${afterB.today && afterB.today.a}`,
      `保存領域から消えたタブAの記録: 成績 ${lostStats.length} 件・出題済み ${lostSeen.length} 語`,
    ];
    const rolledBack = lostStats.length > 0 || lostSeen.length > 0 || (afterB.today && afterA.today && afterB.today.a < afterA.today.a + 1);
    return { verdict: rolledBack ? YES : NO, evidence };
  } finally { await dev.close(); }
});

scenario('1b', '別のタブで復元すると、もう一方のタブは読み込み直す（古い記録で上書きしない）', async () => {
  const dev = await newDevice();
  try {
    const tabA = await dev.openTab();
    const tabB = await dev.openTab();
    await tabB.evaluate(() => { window.__alive = true; });
    const key = await answerWord(tabA, 0, false);
    await tabA.evaluate(() => {
      backupView = { step: 'confirm', restoreMode: 'overwrite', pending: parseBackup(JSON.stringify(buildBackup())) };
      runRestore();
    });
    let reloaded = false;
    for (let i = 0; i < 40 && !reloaded; i++) {
      await sleep(100);
      try { reloaded = await tabB.evaluate(() => !window.__alive && typeof state !== 'undefined'); } catch (e) { /* 読み込み直しの最中 */ }
    }
    const bKnows = reloaded && await tabB.evaluate(k => k in state.wordStats, key);
    await answerWord(tabB, 1, false);
    const stats = await lsJson(tabB, 'toeic_word_stats');
    return {
      verdict: reloaded && bKnows && key in stats ? NO : YES,
      evidence: [`タブBが読み込み直した: ${reloaded}`, `読み込み直したタブBのメモリにタブAの回答がある: ${bKnows}`, `タブBで1問解いたあとも、保存領域にタブAの回答が残っている: ${key in stats}`],
    };
  } finally { await dev.close(); }
});

scenario('1c', '別タブの保存を受け取って読み込み直すとき、タブどうしが読み込み直しを呼び合い続ける', async () => {
  const dev = await newDevice();
  try {
    const tabA = await dev.openTab();
    const tabB = await dev.openTab();
    for (const t of [tabA, tabB]) {
      await t.evaluate(() => {
        window.__reloads = 0;
        const orig = reloadRecordsFromStorage;
        reloadRecordsFromStorage = function () { window.__reloads++; return orig.apply(this, arguments); };
      });
    }
    await tabA.evaluate(() => { recordWeak(RAW_WORDS[0], false); recordWeak(RAW_WORDS[1], true); }); // 2 問ぶんの保存（キーは 6 つほど変わる）
    await sleep(600);
    const first = [await tabA.evaluate(() => window.__reloads), await tabB.evaluate(() => window.__reloads)];
    await sleep(600);
    const second = [await tabA.evaluate(() => window.__reloads), await tabB.evaluate(() => window.__reloads)];
    const ok = first[0] === 0 && first[1] === 1 && second[0] === 0 && second[1] === 1;
    return {
      verdict: ok ? NO : YES,
      evidence: [`読み込み直しの回数（解いたタブA, 受け取ったタブB）: 0.6 秒後 ${first.join(', ')} / 1.2 秒後 ${second.join(', ')}（0, 1 のままなら正しい）`],
    };
  } finally { await dev.close(); }
});

scenario('1d', '保存に失敗しているタブが、別タブの保存を受け取って、メモリにしかない回答を捨てる', async () => {
  const dev = await newDevice();
  try {
    const tabA = await dev.openTab();
    const tabB = await dev.openTab();
    // タブBだけ、書き込みがすべて失敗する
    await tabB.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    const keyB = await answerWord(tabB, 1, false);
    await answerWord(tabA, 0, false);
    await sleep(400);
    const kept = await tabB.evaluate(k => k in state.wordStats, keyB);
    return { verdict: kept ? NO : YES, evidence: [`保存できなかったタブBの回答が、タブBのメモリに残っている: ${kept}`] };
  } finally { await dev.close(); }
});

scenario('1e', '通知を受け取れなかったタブが、画面に戻ってきても古い記録のまま', async () => {
  const dev = await newDevice();
  try {
    const page = await dev.openTab();
    // 同じタブからの書き込みは通知（storage イベント）が来ない。これを「通知を受け取れなかった」状況として使う
    const r = await page.evaluate(() => {
      const stats = JSON.parse(localStorage.getItem('toeic_word_stats') || '{}');
      stats['e2j:__saved_elsewhere__'] = { a: 2, c: 1 };
      localStorage.setItem('toeic_word_stats', JSON.stringify(stats));
      const before = 'e2j:__saved_elsewhere__' in state.wordStats;
      document.dispatchEvent(new Event('visibilitychange'));
      return { visibility: document.visibilityState, before, after: 'e2j:__saved_elsewhere__' in state.wordStats };
    });
    return { verdict: !r.before && r.after ? NO : YES, evidence: [`表示の状態: ${r.visibility}`, `メモリに別の保存の記録がある: 戻る前 ${r.before} → 戻ったあと ${r.after}`] };
  } finally { await dev.close(); }
});

scenario('1f', '別タブの保存を受け取ると、止めているポモドーロの残り時間が戻る／別タブのポモドーロの記録を消す', async () => {
  const dev = await newDevice();
  try {
    const tabA = await dev.openTab();
    const tabB = await dev.openTab();
    // タブB: タイマーを動かして止め、残り 10 分にしておく
    await tabB.evaluate(() => {
      switchAppPage('timer');
      document.getElementById('pomo-start-btn').click();
      switchAppPage('practice');
      document.getElementById('pomo-mini-toggle').click();
      pomoState.remaining = 600;
    });
    // タブA: 1 問解き、ポモドーロを 1 セット終える
    await answerWord(tabA, 0, false);
    await tabA.evaluate(() => {
      switchAppPage('timer');
      document.getElementById('pomo-start-btn').click();
      switchAppPage('practice');
      document.getElementById('pomo-mini-toggle').click(); // 止めてから残りを 1 分にする（動いている間は残り時間が時刻から計算される）
      pomoState.remaining = 60;
      skipPomo();
    });
    await sleep(400);
    const b = await tabB.evaluate(() => ({ running: pomoState.running, remaining: pomoState.remaining, sets: (pomoLog[pomoTodayKey()] || {}).sets || 0 }));
    return {
      verdict: !b.running && b.remaining === 600 && b.sets === 1 ? NO : YES,
      evidence: [`タブBの止めたタイマー: 動作中=${b.running}・残り ${b.remaining} 秒（600 のままなら正しい）`, `タブBのメモリにある今日のセット数: ${b.sets}（タブAの 1 セットが見えていれば正しい）`],
    };
  } finally { await dev.close(); }
});

// ==================== 仮説2: Drive 同期の 取得→マージ→PATCH の競合 ====================

scenario('2a', '2 台が同じ中身を取得したあと、片方が先に保存すると、あとから保存した端末が先の端末の記録をクラウドから消す', async () => {
  const drive = makeDrive('');
  const devA = await newDevice();
  const devB = await newDevice();
  try {
    const a = await devA.openTab();
    const b = await devB.openTab();
    await linkDrive(a, 'A', drive);
    await linkDrive(b, 'B', drive);
    await sync(a); // 最初のファイルを作っておく
    const keyA = await answerWord(a, 0, false);
    const keyB = await answerWord(b, 1, false);
    drive.log.length = 0;
    drive.finds = {};
    drive.holdGetsUntil = 2; // 両方の取得がそろってから返す
    drive.gate = { label: 'B', at: 2 }; // B の「保存前の確認」は、A の保存が済んでから返す
    const [ra, rb] = await Promise.all([sync(a), sync(b)]);
    const cloud = JSON.parse(drive.text).data.wordStats;
    const order = drive.log.join(' → ');
    const lostInCloud = [keyA, keyB].filter(k => !(k in cloud));
    // 消えた側の端末がもう一度同期すれば戻るか（手元には残っているので）
    await sync(a); await sync(b); await sync(a);
    const healed = JSON.parse(drive.text).data.wordStats;
    return {
      verdict: lostInCloud.length ? YES : NO,
      evidence: [
        `通信の順: ${order}`,
        `両方の同期が「成功」と表示: A=${ra.ok} B=${rb.ok}`,
        `重なった同期の直後、クラウドに無い記録: ${lostInCloud.length ? lostInCloud.join(', ') : 'なし'}（A の回答 ${keyA}、B の回答 ${keyB}）`,
        `そのあと両方がもう一度同期すると、クラウドに両方ある: ${keyA in healed && keyB in healed}`,
      ],
    };
  } finally { await devA.close(); await devB.close(); }
});

scenario('2b', '同じ端末の別タブで解いた記録が、もう一方のタブの同期で保存領域から消える', async () => {
  const drive = makeDrive('');
  const dev = await newDevice();
  try {
    const t1 = await dev.openTab();
    const t2 = await dev.openTab(); // t1 が解く前に開いておく
    await linkDrive(t2, 'T2', drive);
    // クラウドには別の端末の記録が 1 件ある
    drive.text = await t2.evaluate(() => {
      const b = JSON.parse(JSON.stringify(buildBackup({ forDrive: true }))); // 写しを取る（buildBackup は state を参照で返す）
      b.data.wordStats['e2j:__other_device__'] = { a: 1, c: 1 };
      return JSON.stringify(b);
    });
    const key = await answerWord(t1, 0, false);
    const before = await lsJson(t1, 'toeic_word_stats');
    await sleep(300); // t1 で解いてから t2 に切り替えて同期を押すまでの間（保存の通知は 50 ms 待ってまとめて受け取る）
    const r = await sync(t2);
    const after = await lsJson(t1, 'toeic_word_stats');
    const cloud = JSON.parse(drive.text).data.wordStats;
    return {
      verdict: !(key in before) || !(key in after) || !(key in cloud) ? YES : NO,
      evidence: [
        `同期の前、保存領域に t1 の回答がある: ${key in before}`,
        `t2 の同期（成功=${r.ok}）のあと、保存領域に t1 の回答がある: ${key in after}`,
        `クラウドに t1 の回答がある: ${key in cloud}`,
      ],
    };
  } finally { await dev.close(); }
});

scenario('2c', '同期の通信を待っている間に解いた回答は、同期に含まれる（1 つのタブの中では競合しない）', async () => {
  const drive = makeDrive('');
  const dev = await newDevice();
  try {
    const page = await dev.openTab();
    await linkDrive(page, 'A', drive);
    await sync(page);
    drive.holdGetsUntil = 99; // 取得の返事を止めておく
    const pending = sync(page);
    await sleep(200);
    const key = await answerWord(page, 0, false); // 待っている間に解く
    drive.waiting.forEach(r => r()); drive.waiting = []; drive.holdGetsUntil = 0;
    const r = await pending;
    const local = await lsJson(page, 'toeic_word_stats');
    const cloud = JSON.parse(drive.text).data.wordStats;
    return {
      verdict: key in local && key in cloud ? NO : YES,
      evidence: [`同期の結果: 成功=${r.ok}`, `待っている間の回答が保存領域にある: ${key in local}`, `クラウドにある: ${key in cloud}`],
    };
  } finally { await dev.close(); }
});

// ==================== 仮説3: replaceRecords が容量不足で途中失敗したときの巻き戻し ====================

const manyStats = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`e2j:w${i}`, { a: 1, c: 1 }]));
const manyWeak = (n, u) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`weakword${i}`, { streak: 0, added: 1, due: 1, ...(u ? { u } : {}) }]));
const manySeen = n => Array.from({ length: n }, (_, i) => `seen${i}`);

scenario('3a', '復元（取り消し用の記録あり）が途中で容量不足になっても、元の記録に戻る', async () => {
  const dev = await newDevice();
  try {
    const page = await dev.openTab();
    await answerWord(page, 0, false);
    await answerWord(page, 1, true);
    const text = await page.evaluate(n => {
      const b = JSON.parse(JSON.stringify(buildBackup())); // 写しを取る（buildBackup は state を参照で返す）
      for (let i = 0; i < n; i++) b.data.wordStats[`e2j:w${i}`] = { a: 1, c: 1 };
      return JSON.stringify(b);
    }, 20000);
    const before = await dump(page);
    const recordsSize = Object.values(before).reduce((s, v) => s + v.length, 0);
    const budget = await installBudget(page, recordsSize * 2 + 3000); // 取り消し用の記録は入るが、大きな成績は入らない
    const error = await page.evaluate(t => {
      backupView = { step: 'confirm', restoreMode: 'merge', pending: parseBackup(t) };
      runRestore();
      return backupView.error || null;
    }, text);
    const after = await dump(page);
    const same = JSON.stringify(before) === JSON.stringify(after);
    return {
      verdict: error && same ? NO : YES,
      evidence: [`上限 ${budget.limit} 文字（使用 ${budget.used}）`, `表示された文言: ${error}`, `保存領域が復元の前と 1 文字も違わない: ${same}`],
    };
  } finally { await dev.close(); }
});

scenario('3b', '同期（取り消し用の記録なし）の途中で容量不足になると、巻き戻しにも失敗して一部だけ書き換わる', async () => {
  const now = Date.now();
  const drive = makeDrive('');
  const dev = await newDevice({ storage: {
    toeic_weak_words_by_mode: JSON.stringify({ e2j: manyWeak(1000, now - 10 * DAY), j2e: {}, flash: {}, type: {} }),
  } });
  try {
    const page = await dev.openTab();
    await linkDrive(page, 'A', drive);
    // クラウド: 手元の苦手 1000 語は別の端末で克服済み（削除の記録）。出題済みと成績はクラウドのほうがずっと多い
    drive.text = await page.evaluate(([t, seen, stats]) => {
      const b = JSON.parse(JSON.stringify(buildBackup({ forDrive: true }))); // 写しを取る（buildBackup は state を参照で返す）
      Object.keys(b.data.weakWords.e2j).forEach(w => { b.data.weakDeleted[`w:e2j:${w}`] = t; });
      b.data.weakWords.e2j = {};
      b.data.seenWords.e2j = seen;
      b.data.wordStats = stats;
      return JSON.stringify(b);
    }, [now - DAY, manySeen(1500), manyStats(5000)]);
    const before = await dump(page);
    const budget = await installBudget(page, 500);
    const r = await sync(page);
    const after = await dump(page);
    const changed = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k] && !k.startsWith('toeic_gdrive'));
    const weakBefore = Object.keys(JSON.parse(before.toeic_weak_words_by_mode).e2j).length;
    const weakAfter = Object.keys(JSON.parse(after.toeic_weak_words_by_mode).e2j).length;
    const memWeak = await page.evaluate(() => Object.keys(state.weakByMode.e2j).length);
    return {
      verdict: changed.length ? YES : NO,
      evidence: [
        `上限 ${budget.limit} 文字（使用 ${budget.used}）`,
        `同期の結果: 成功=${r.ok} / ${r.msg}`,
        `書き換わったままのキー: ${changed.join(', ') || 'なし'}`,
        `苦手（e2j）: 保存領域 ${weakBefore} → ${weakAfter} 語、メモリは ${memWeak} 語`,
              ],
    };
  } finally { await dev.close(); }
});

scenario('3c', '復元の取り消しが途中で容量不足になると、巻き戻しにも失敗し、復元のあとに解いた記録が保存領域から消える', async () => {
  // 復元の前: 苦手は少なく、出題済みと成績が多い
  const dev = await newDevice({ storage: {
    toeic_seen_words_by_mode: JSON.stringify({ e2j: manySeen(1500), j2e: [], flash: [], type: [] }),
    toeic_word_stats: JSON.stringify(manyStats(5000)),
  } });
  try {
    const page = await dev.openTab();
    // 苦手が多く、出題済みと成績が少ないバックアップで上書き復元する
    const restoreError = await page.evaluate(weak => {
      const b = JSON.parse(JSON.stringify(buildBackup())); // 写しを取る（buildBackup は state を参照で返す）
      b.data.weakWords = { e2j: weak, j2e: {}, flash: {}, type: {} };
      b.data.seenWords = { e2j: [], j2e: [], flash: [], type: [] };
      b.data.wordStats = {};
      backupView = { step: 'confirm', restoreMode: 'overwrite', pending: parseBackup(JSON.stringify(b)) };
      runRestore();
      return backupView.error || null;
    }, manyWeak(1000));
    // 復元のあとに 1 問間違える（苦手に入る）
    const word = await page.evaluate(() => { recordWeak(RAW_WORDS[0], false); return RAW_WORDS[0].w; });
    const before = await dump(page);
    const budget = await installBudget(page, 500);
    const undoError = await page.evaluate(() => { runUndo(); return backupView.error || null; });
    const after = await dump(page);
    const changed = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k]);
    const weakHas = d => word in (JSON.parse(d.toeic_weak_words_by_mode).e2j || {});
    await page.reload();
    const memHasAfterReload = await page.evaluate(w => w in state.weakByMode.e2j, word);
    return {
      verdict: changed.length || !weakHas(before) || !weakHas(after) || !memHasAfterReload ? YES : NO,
      evidence: [
        `上書き復元の結果: ${restoreError || '成功'}`,
        `上限 ${budget.limit} 文字（使用 ${budget.used}）`,
        `取り消しで表示された文言: ${undoError}`,
        `書き換わったままのキー: ${changed.join(', ') || 'なし'}`,
        `復元のあとに間違えた単語が苦手にある: 取り消しの前 ${weakHas(before)} → あと ${weakHas(after)} → 再読み込み後のメモリ ${memHasAfterReload}`,
        `取り消し用の記録は残っている: ${after.toeic_backup_undo !== undefined}（もう一度取り消すことはできる）`,
      ],
    };
  } finally { await dev.close(); }
});

// ==================== 仮説4: 端末の時計のずれと更新時刻 u のマージ ====================

const T = Date.parse('2026-11-10T12:00:00+09:00');
const MIN = 60000;
const HOUR = 3600000;

// 端末Aが単語を克服（苦手から外す）し、そのあと（実際の時刻で 1 時間後）端末Bが同じ単語を間違える。Bが同期したあと、Bの苦手に残るか
async function graduateThenWrong(clockAheadOfA) {
  const drive = makeDrive('');
  const devA = await newDevice({ time: T + clockAheadOfA });
  const devB = await newDevice({ time: T + HOUR });
  try {
    const a = await devA.openTab();
    const tomb = await a.evaluate(() => {
      const w = RAW_WORDS[0];
      state.weakByMode.e2j[w.w] = { streak: 1, added: 1, due: 1 };
      recordWeak(w, true); // 2 回目の正解で克服 → 削除の記録が付く
      return state.weakDeleted[`w:e2j:${w.w}`];
    });
    drive.text = await a.evaluate(() => JSON.stringify(buildBackup({ forDrive: true })));
    drive.modified = T; // A が保存した、実際の時刻
    const b = await devB.openTab();
    await linkDrive(b, 'B', drive);
    const word = await b.evaluate(() => { recordWeak(RAW_WORDS[0], false); return RAW_WORDS[0].w; });
    const uB = await b.evaluate(w => state.weakByMode.e2j[w].u, word);
    await b.clock.setFixedTime(new Date(T + HOUR + MIN)); // 間違えた 1 分後に同期する
    const r = await sync(b);
    const kept = await b.evaluate(w => w in state.weakByMode.e2j && w in JSON.parse(localStorage.getItem('toeic_weak_words_by_mode')).e2j, word);
    const cloudHas = word in JSON.parse(drive.text).data.weakWords.e2j;
    return { tomb, uB, ok: r.ok, msg: r.msg, kept, cloudHas };
  } finally { await devA.close(); await devB.close(); }
}

scenario('4a', '時計が進んだ端末の「克服」が、そのあとに別の端末で間違えた記録を消す', async () => {
  const control = await graduateThenWrong(0);
  const skewed = await graduateThenWrong(2 * DAY);
  const fmt = ms => new Date(ms).toISOString();
  return {
    verdict: control.ok && control.kept && skewed.kept ? NO : YES,
    evidence: [
      `時計が合っているとき: 削除 ${fmt(control.tomb)} < 間違い ${fmt(control.uB)} → 同期 成功=${control.ok}、Bの苦手に残る: ${control.kept}`,
      `Aの時計が2日進んでいるとき: 削除 ${fmt(skewed.tomb)}（実際は間違いより前）→ 同期 成功=${skewed.ok}、Bの苦手に残る: ${skewed.kept}`,
      `表示: ${skewed.msg}`,
    ],
  };
});

// 端末Bが苦手を 1 段階進め（実際の時刻で 1 時間前）、そのあと端末Aが同じ単語を間違える。Aが同期したあと、Aの記録はどちらか
async function progressThenWrong(clockOffsetOfA) {
  const drive = makeDrive('');
  const devB = await newDevice({ time: T - HOUR });
  const devA = await newDevice({ time: T + clockOffsetOfA });
  try {
    const b = await devB.openTab();
    await b.evaluate(() => {
      const w = RAW_WORDS[0];
      state.weakByMode.e2j[w.w] = { streak: 0, added: 1, due: 1 };
      recordWeak(w, true); // 1 回目の正解 → streak 1、復習日は明日
    });
    drive.text = await b.evaluate(() => JSON.stringify(buildBackup({ forDrive: true })));
    drive.modified = T - HOUR; // B が保存した、実際の時刻
    const a = await devA.openTab();
    await linkDrive(a, 'A', drive);
    const word = await a.evaluate(() => { recordWeak(RAW_WORDS[0], false); return RAW_WORDS[0].w; });
    await a.clock.setFixedTime(new Date(T + clockOffsetOfA + MIN));
    const r = await sync(a);
    const entry = await a.evaluate(w => JSON.parse(localStorage.getItem('toeic_weak_words_by_mode')).e2j[w], word);
    return { ok: r.ok, msg: r.msg, streak: entry && entry.streak, dueNow: await a.evaluate(w => isDue(state.weakByMode.e2j[w]), word) };
  } finally { await devA.close(); await devB.close(); }
}

scenario('4b', '時計が遅れた端末で間違えた記録が、別の端末の古い「進んだ記録」に負けて巻き戻る', async () => {
  const control = await progressThenWrong(0);
  const skewed = await progressThenWrong(-2 * DAY);
  return {
    verdict: control.ok && control.streak === 0 && skewed.streak === 0 ? NO : YES,
    evidence: [
      `時計が合っているとき: 同期 成功=${control.ok}、Aの記録は streak ${control.streak}・要復習 ${control.dueNow}（今の間違いが残る）`,
      `Aの時計が2日遅れているとき: 同期 成功=${skewed.ok}、Aの記録は streak ${skewed.streak}・要復習 ${skewed.dueNow}`,
      `表示: ${skewed.msg}`,
    ],
  };
});

scenario('4c', '時計が進んだ端末が同期すると、自分の古い記録を「新しい」としてクラウドに上書きする', async () => {
  const drive = makeDrive('');
  const devB = await newDevice({ time: T });
  const devA = await newDevice({ time: T + 2 * DAY });
  try {
    // 端末A（時計が2日進み）: 単語を間違えた記録がある（streak 0）
    const a = await devA.openTab();
    await linkDrive(a, 'A', drive);
    const word = await a.evaluate(() => { recordWeak(RAW_WORDS[0], false); return RAW_WORDS[0].w; });
    // 端末B（正しい時計）: そのあとに同じ単語を 1 段階進めて、クラウドに保存した
    const b = await devB.openTab();
    await b.evaluate(() => {
      const w = RAW_WORDS[0];
      state.weakByMode.e2j[w.w] = { streak: 0, added: 1, due: 1 };
      recordWeak(w, true);
    });
    drive.text = await b.evaluate(() => JSON.stringify(buildBackup({ forDrive: true })));
    drive.modified = T;
    drive.serverNow = T + MIN; // Google 側の「今」（応答の Date ヘッダー）
    const cloudBefore = drive.text;
    const r = await sync(a);
    const cloudStreak = JSON.parse(drive.text).data.weakWords.e2j[word].streak;
    return {
      verdict: !r.ok && drive.text === cloudBefore ? NO : YES,
      evidence: [`同期 成功=${r.ok}`, `表示: ${r.msg}`, `クラウドの記録は変わっていない: ${drive.text === cloudBefore}（Bの進んだ記録 streak ${cloudStreak}）`],
    };
  } finally { await devA.close(); await devB.close(); }
});

// ==================== そのほかの経路 ====================

scenario('5a', '壊れて読めない記録が、次の回答（日別記録は起動時）で跡形なく上書きされる', async () => {
  const dev = await newDevice({ storage: { toeic_word_stats: '{"e2j:keep":{"a":3,"c":2', toeic_daily_activity_v1: '{"days":{"2026-10-01":' } });
  try {
    const page = await dev.openTab();
    await answerWord(page, 0, false);
    const r = await page.evaluate(() => ({
      stats: localStorage.getItem('toeic_word_stats'),
      statsKept: localStorage.getItem('toeic_word_stats.broken'),
      activityKept: localStorage.getItem('toeic_daily_activity_v1.broken'),
    }));
    const ok = r.statsKept === '{"e2j:keep":{"a":3,"c":2' && r.activityKept === '{"days":{"2026-10-01":';
    return {
      verdict: ok ? NO : YES,
      evidence: [`回答のあとの成績: ${r.stats}`, `壊れていた成績の元の文字列が残っている: ${r.statsKept !== null}`, `壊れていた日別記録の元の文字列が残っている: ${r.activityKept !== null}`],
    };
  } finally { await dev.close(); }
});

scenario('5b', 'クラウドへの保存は成功したのに、そのあとの端末内の控えが書けないだけで「同期失敗」と表示される', async () => {
  const drive = makeDrive('');
  const dev = await newDevice();
  try {
    const page = await dev.openTab();
    await linkDrive(page, 'A', drive);
    const key = await answerWord(page, 0, false);
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === GDRIVE_LAST_MOD_KEY) throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    const r = await sync(page);
    const inCloud = drive.text !== '' && key in JSON.parse(drive.text).data.wordStats;
    return { verdict: inCloud && r.ok ? NO : YES, evidence: [`クラウドに保存されている: ${inCloud}`, `表示: 成功=${r.ok} / ${r.msg}`] };
  } finally { await dev.close(); }
});

scenario('5c', '保存の失敗が一度あると、直ったあとも別タブの保存を受け取らず、次の失敗も知らせない', async () => {
  const dev = await newDevice();
  try {
    const tabA = await dev.openTab();
    const tabB = await dev.openTab();
    await tabB.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
        if (n.classList && n.classList.contains('toast') && /保存できませんでした/.test(n.textContent)) window.__toasts.push(n.textContent);
      }))).observe(document.getElementById('app'), { childList: true, subtree: true });
      window.__realSetItem = Storage.prototype.setItem;
      window.__failWrites = on => { Storage.prototype.setItem = on ? function () { throw new DOMException('quota', 'QuotaExceededError'); } : window.__realSetItem; };
      window.__failWrites(true);
    });
    await answerWord(tabB, 1, false); // 失敗（1 回目のお知らせ）
    await answerWord(tabB, 2, false); // 失敗が続く（お知らせは増えない）
    const toastsDuring = await tabB.evaluate(() => window.__toasts.length);
    await tabB.evaluate(() => window.__failWrites(false));
    await answerWord(tabB, 3, false); // 直った。メモリにあった分もまとめて保存される
    const keyA = await answerWord(tabA, 0, false);
    await sleep(400);
    const bSeesA = await tabB.evaluate(k => k in state.wordStats, keyA);
    await tabB.evaluate(() => window.__failWrites(true));
    await answerWord(tabB, 4, false); // また失敗（2 回目のお知らせ）
    const toastsAfter = await tabB.evaluate(() => window.__toasts.length);
    return {
      verdict: toastsDuring === 1 && bSeesA && toastsAfter === 2 ? NO : YES,
      evidence: [`失敗が続いている間のお知らせ: ${toastsDuring} 回（1 回が正しい）`, `直ったあと、タブAの回答がタブBのメモリに入る: ${bSeesA}`, `もう一度失敗したときまでのお知らせ: ${toastsAfter} 回（2 回が正しい）`],
    };
  } finally { await dev.close(); }
});

scenario('5d', '書き出したバックアップを書き換えると、メモリの学習記録まで変わる', async () => {
  const dev = await newDevice();
  try {
    const page = await dev.openTab();
    await answerWord(page, 0, false);
    const r = await page.evaluate(() => {
      const b = buildBackup({ forDrive: true });
      b.data.wordStats['e2j:__leak__'] = { a: 1, c: 1 };
      b.data.weakWords.e2j = {};
      return { leaked: 'e2j:__leak__' in state.wordStats, weak: Object.keys(state.weakByMode.e2j).length };
    });
    return { verdict: !r.leaked && r.weak === 1 ? NO : YES, evidence: [`書き換えがメモリの成績に入った: ${r.leaked}`, `メモリの苦手（e2j）: ${r.weak} 語（1 語のままなら正しい）`] };
  } finally { await dev.close(); }
});

// ==================== 実行 ====================

(async () => {
  const server = await startServer();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const only = process.argv[2];
  let broken = 0;
  for (const s of scenarios) {
    if (only && !s.id.startsWith(only)) continue;
    try {
      const r = await s.fn();
      const failed = r.verdict === YES && !s.open;
      if (failed) broken++;
      console.log(`\n[${s.id}] ${s.title}\n  → ${r.verdict}${failed ? '【失敗】' : r.verdict === YES ? '（未修正・既知）' : ''}`);
      r.evidence.forEach(e => console.log(`     - ${e}`));
    } catch (e) {
      broken++;
      console.log(`\n[${s.id}] ${s.title}\n  → シナリオが動かなかった: ${String(e.stack || e).split('\n').slice(0, 5).join('\n     ')}`);
    }
  }
  await browser.close();
  server.close();
  process.exit(broken ? 1 : 0);
})();
