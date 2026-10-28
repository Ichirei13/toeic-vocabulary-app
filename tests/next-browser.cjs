// NODE_PATH=<bundled node_modules> node tests/next-browser.cjs
// Uses the installed Chrome with a temporary, isolated profile. No user browser state.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const KEY = 'toeic_next_v1';
const PREFIX = '/toeic-vocabulary-app';
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith(PREFIX + '/')) return res.writeHead(404).end();
  let file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname.slice(PREFIX.length)));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return res.writeHead(404).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
});
const legacy = { toeic_grammar_stats: '{"1001":{"a":4,"c":2}}', toeic_weak_grammar: '{"1001":{"streak":0,"added":1,"due":1,"u":1}}',
  toeic_gdrive_linked: '1', toeic_gdrive_autosync: '1', toeic_app_theme: 'navy', toeic_settings: '{"app":"grammar"}' };
const reports = [];
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin + PREFIX;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const external = [];
  context.on('request', req => { if (!req.url().startsWith(origin)) external.push(req.url()); });
  await context.addInitScript(items => {
    if (!localStorage.getItem('__seeded_next_test')) {
      Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v));
      localStorage.setItem('__seeded_next_test', '1');
    }
  }, legacy);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/next/');
  await page.getByRole('heading', { name: 'おかえりなさい。' }).waitFor();
  assert.equal(await page.locator('.book-card').count(), 4);
  assert.equal(await page.locator('.count').innerText(), '1問');
  await page.screenshot({ path: '/tmp/study-desk-home.png', fullPage: true });
  reports.push('ホーム・公開版の教材4種・既存記録の初回コピー');
  await page.getByRole('link', { name: /金の文法/ }).click();
  await page.locator('[name="chapters"][value="1"]').check();
  await page.locator('[name="chapters"][value="2"]').check();
  await page.getByRole('button', { name: '10問を始める' }).click();
  await page.locator('.choice').first().waitFor();
  const question = await page.locator('.question-text').innerText();
  await page.keyboard.press('0');
  await page.getByRole('heading', { name: '答えを確認しましょう' }).waitFor();
  const raw = await page.evaluate(key => localStorage.getItem(key), KEY);
  const parsed = JSON.parse(raw);
  assert.equal(Object.keys(parsed.session.answers).length, 1);
  await page.screenshot({ path: '/tmp/study-desk-exercise.png', fullPage: true });
  await page.reload();
  assert.equal(await page.locator('.question-text').innerText(), question);
  await page.getByRole('heading', { name: '答えを確認しましょう' }).waitFor();
  assert.equal(await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key)).session.answers).length, KEY), 1);
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('button', { name: '前の問題' }).click();
  assert.equal(await page.locator('.question-text').innerText(), question);
  await page.getByRole('button', { name: '次へ' }).click();
  reports.push('複数章選択・解答・再読込・前へ・二重採点防止');
  for (let i = 1; i < 10; i++) {
    await page.getByRole('button', { name: 'わからない', exact: true }).click();
    await page.getByRole('button', { name: i === 9 ? '結果を見る' : '次へ' }).click();
  }
  await page.getByRole('heading', { name: 'おつかれさまでした。' }).waitFor();
  await page.getByRole('button', { name: '間違えた10問をもう一度' }).click();
  assert.equal(await page.locator('.progress-row').innerText().then(t => t.includes('1 / 10')), true);
  reports.push('10問完了・結果・誤答だけ再演習');
  for (const mode of ['e2j', 'j2e', 'flash', 'type']) {
    await page.goto(base + '/next/#setup/vocab/daily');
    await page.locator('#mode').selectOption(mode);
    await page.getByRole('button', { name: '10問を始める' }).click();
    if (mode === 'flash') {
      await page.getByRole('button', { name: '意味を見る' }).click();
      await page.getByRole('button', { name: '覚えていた', exact: true }).click();
    } else if (mode === 'type') {
      const answer = await page.evaluate(key => {
        const s = JSON.parse(localStorage.getItem(key)).session;
        return RAW_WORDS[Number(s.ids[0].slice(2))].w;
      }, KEY);
      await page.locator('#typed-answer').fill(answer);
      await page.locator('#typed-answer').press('Enter');
    } else {
      await page.locator('.choice').first().waitFor();
      const correct = await page.evaluate(key => {
        const s = JSON.parse(localStorage.getItem(key)).session;
        return s.choices[s.ids[0]].correct;
      }, KEY);
      await page.keyboard.press(String(correct + 1));
    }
    await page.getByRole('heading', { name: '✓ 正解です' }).waitFor();
  }
  reports.push('単語4モード・キーボード回答・タイプ判定');
  await page.goto(base + '/next/#review');
  await page.locator('.review-item').first().locator('summary').click();
  await page.locator('.review-item').first().getByRole('button', { name: 'この問題を解く' }).click();
  assert.ok((await page.locator('.progress-row').innerText()).includes('1 / 1'));
  reports.push('苦手一覧・個別復習');
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 768 ? 375 : 900 });
    for (const route of ['home', 'setup/grammar/kin', 'exercise', 'review', 'settings']) {
      await page.goto(base + '/next/#' + route);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width} ${route}`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base + '/next/#home');
  await page.screenshot({ path: '/tmp/study-desk-mobile.png', fullPage: true });
  await page.goto(base + '/next/#settings');
  await page.locator('.theme-disclosure > summary').click();
  await page.locator('[data-theme-id="dark"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.goto(base + '/next/#exercise');
  await page.screenshot({ path: '/tmp/study-desk-dark.png', fullPage: true });
  await page.addStyleTag({ content: ':root { font-size: 32px !important; }' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text overflow');
  reports.push('375/768/1024/1440px・横向き・200%文字・ダーク・reduced motion');
  const savedLegacy = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(legacy));
  assert.deepEqual(savedLegacy, legacy);
  assert.deepEqual(external, []);
  reports.push('従来版の全対象キーが不変・外部通信ゼロ');
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The existing root worker removes all other cache names on activation.
  // Installing it after the trial must retain trial assets AND its own root assets.
  await page.evaluate(async () => {
    const cache = await caches.open('toeic-drill-v1');
    await cache.put('../legacy-sentinel', new Response('untouched'));
    const registration = await navigator.serviceWorker.register('../sw.js', { scope: '../' });
    if (!registration.active) await new Promise(resolve => {
      const worker = registration.installing || registration.waiting;
      if (worker.state === 'activated') resolve();
      else worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); });
    });
    if (await (await cache.match('../legacy-sentinel')).text() !== 'untouched') throw new Error('Legacy cache changed');
    const keys = await cache.keys();
    if (!keys.some(k => k.url.includes('/next/__offline__/'))) throw new Error('Trial cache evicted');
  });
  await context.setOffline(true);
  await page.reload();
  await page.locator('.question-text').waitFor();
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await page.getByRole('button', { name: '結果を見る' }).click();
  reports.push('従来版のSW有効化後も試用版のオフライン再読込・解答・従来キャッシュ保持');
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  await context.close();

  const uiContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const ui = await uiContext.newPage();
  ui.on('pageerror', e => errors.push(String(e)));
  await uiContext.addInitScript(() => {
    if (!localStorage.getItem('__theme_seed')) {
      localStorage.setItem('toeic_app_theme', 'duolingo'); localStorage.setItem('__theme_seed', '1');
    }
  });
  await ui.goto(base + '/next/');
  await ui.getByRole('heading', { name: 'おかえりなさい。' }).waitFor();
  assert.equal(await ui.locator('html').getAttribute('data-theme'),'duolingo');
  await ui.locator('[data-action="open-themes"]').click();
  assert.equal(await ui.locator('#theme-dialog [data-theme-id]').count(),9);
  await ui.keyboard.press('Escape');
  assert.ok(await ui.locator('[data-action="open-themes"]').evaluate(el => el === document.activeElement));
  await ui.getByRole('link', { name: /金の文法/ }).click();
  await ui.getByRole('button', { name: '10問を始める' }).click();
  await ui.locator('.choice').first().waitFor();
  const correctIndex=await ui.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key)).session;return s.choices[s.ids[0]].correct;},KEY);
  await ui.locator('.choice').nth(correctIndex).click();
  assert.equal(await ui.locator('.reward-pill.xp').innerText(),'10 XP');
  assert.ok((await ui.locator('.result-banner').innerText()).includes('正解'));
  const beforeTheme=await ui.evaluate(key=>JSON.parse(localStorage.getItem(key)).session,KEY);
  await ui.locator('[data-action="open-themes"]').click();
  await ui.locator('#theme-dialog [data-theme-id="light"]').click();
  await ui.keyboard.press('1');
  await ui.keyboard.press('Escape');
  assert.deepEqual(await ui.evaluate(key=>JSON.parse(localStorage.getItem(key)).session,KEY),beforeTheme);
  await ui.locator('[data-action="open-themes"]').click();
  await ui.locator('#theme-dialog [data-theme-id="duolingo"]').click();
  await ui.keyboard.press('Escape');
  await ui.reload();
  await ui.locator('.result-banner').waitFor();
  assert.equal(await ui.locator('.reward-pill.xp').innerText(),'10 XP');
  await ui.evaluate(()=>window.scrollTo(0,0));
  await ui.screenshot({path:'/tmp/study-desk-duolingo-desktop.png'});
  reports.push('Duolingo初期テーマ継承・演習中切替・モーダルのキー隔離・XP再読込');

  await ui.goto(base+'/next/#settings');
  await ui.locator('.theme-disclosure > summary').click();
  await ui.locator('#sound-enabled').uncheck();
  assert.equal(await ui.evaluate(key=>JSON.parse(localStorage.getItem(key)).sound,KEY),false);
  const themeIds=['light','dark','duolingo','ink','navy','quizlet','forest','nordic','sepia'];
  for(const id of themeIds) {
    await ui.locator(`[data-theme-id="${id}"]`).click();
    assert.equal(await ui.locator('html').getAttribute('data-theme'),id);
    const ratios=await ui.evaluate(()=>{
      const css=getComputedStyle(document.documentElement);
      function luminance(hex){const rgb=hex.trim().replace('#',''); const full=rgb.length===3?[...rgb].map(c=>c+c).join(''):rgb;return [0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
      const ratio=(a,b)=>{const x=[luminance(css.getPropertyValue(a)),luminance(css.getPropertyValue(b))].sort((a,b)=>a-b);return(x[1]+.05)/(x[0]+.05)};
      return [ratio('--text','--surface'),ratio('--muted','--surface'),ratio('--accent','--surface'),ratio('--on-accent','--accent')];
    });
    assert.ok(ratios.every(r=>r>=4.5), `${id} contrast ${ratios}`);
  }
  await ui.locator('[data-theme-id="duolingo"]').click();
  await ui.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});
  await ui.screenshot({path:'/tmp/study-desk-themes-desktop.png',fullPage:true});
  await ui.setViewportSize({width:375,height:812});
  await ui.screenshot({path:'/tmp/study-desk-themes-mobile.png',fullPage:true});
  assert.ok(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  reports.push('9テーマ・主要文字コントラスト4.5以上・効果音設定・375px設定画面');

  const downloadPromise=ui.waitForEvent('download');
  await ui.locator('[data-action="export"]').click();
  const download=await downloadPromise;
  const backupBuffer=fs.readFileSync(await download.path());
  const original=JSON.parse(backupBuffer.toString());
  assert.equal(original.app,'toeic-study-desk-preview');
  const beforeImport=await ui.evaluate(key=>localStorage.getItem(key),KEY);
  await ui.locator('#backup-file').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:backupBuffer});
  await ui.locator('#restore-title').waitFor();
  assert.equal(await ui.evaluate(key=>localStorage.getItem(key),KEY),beforeImport);
  await ui.locator('[data-action="cancel-restore"]').click();
  assert.equal(await ui.evaluate(key=>localStorage.getItem(key),KEY),beforeImport);
  const replacement=JSON.parse(backupBuffer.toString());replacement.data.theme='forest';
  replacement.data.records.grammarStats={'1001':{a:12,c:8}};
  const buffer=Buffer.from(JSON.stringify(replacement));
  await ui.locator('#backup-file').setInputFiles({name:'replace.json',mimeType:'application/json',buffer});
  await ui.locator('[name="restore-mode"][value="replace"]').check();
  await ui.screenshot({path:'/tmp/study-desk-restore-mobile.png',fullPage:true});
  await ui.locator('[data-action="confirm-restore"]').click();
  assert.equal(await ui.locator('html').getAttribute('data-theme'),'forest');
  assert.equal(await ui.evaluate(key=>JSON.parse(localStorage.getItem(key)).records.grammarStats['1001'].a,KEY),12);
  await ui.reload();
  await ui.locator('[data-action="preview-undo"]').click();
  await ui.locator('[data-action="confirm-restore"]').click();
  assert.equal(await ui.locator('html').getAttribute('data-theme'),'duolingo');
  assert.deepEqual(await ui.evaluate(key=>JSON.parse(localStorage.getItem(key)).records,KEY),original.data.records);
  const beforeInvalid=await ui.evaluate(key=>localStorage.getItem(key),KEY);
  await ui.locator('#backup-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await ui.getByText('JSONとして読み込めませんでした。バックアップファイルを選んでください。').waitFor();
  assert.equal(await ui.evaluate(key=>localStorage.getItem(key),KEY),beforeInvalid);
  assert.equal(await ui.evaluate(()=>localStorage.getItem('toeic_app_theme')),'duolingo');
  reports.push('JSON書き出し→確認→キャンセル→置換→再読込→取り消し・不正ファイル拒否');
  await ui.goto(base+'/next/#exercise');
  await ui.locator('.question-text').waitFor();
  await ui.evaluate(()=>window.scrollTo(0,0));
  await ui.screenshot({path:'/tmp/study-desk-duolingo-mobile.png'});
  const resultRect=await ui.locator('.result-banner').boundingBox();
  assert.ok(resultRect.y>=0 && resultRect.y+resultRect.height<=812, 'result banner is in viewport');
  const nextRect=await ui.locator('[data-action="next"]').boundingBox();
  assert.ok(nextRect.y+nextRect.height<=812, 'next button is in viewport');
  await ui.addStyleTag({content:':root {font-size:32px !important}'});
  assert.ok(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'duolingo 200% text');
  await ui.reload();
  await ui.goto(base+'/next/#home');
  await ui.screenshot({path:'/tmp/study-desk-polished-home.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await uiContext.close();
  console.log(reports.map(x => 'PASS ' + x).join('\n'));
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
