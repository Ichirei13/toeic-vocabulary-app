#!/usr/bin/env node
// テストを 1 つのコマンドでまとめて流し、ファイルごとの成否と所要時間を表示する。
//
//   node tools/run_tests.mjs              全部（Python・単体・ブラウザ）
//   node tools/run_tests.mjs --fast       ブラウザを使わないテストだけ（CI もこれ）
//   node tools/run_tests.mjs graph label  名前に graph か label を含むものだけ
//   node tools/run_tests.mjs --list       流すテストの一覧だけ出す
//   オプション: -j N（ブラウザのテストを同時に流す数。既定 4）、--timeout 秒（1 本あたり。既定 300）、
//               --no-retry（並列で落ちたブラウザのテストを 1 本ずつ流し直さない）
//
// テストは自動で探す（tests/ の *.test.js / *.test.mjs / *.test.cjs と tests/unit/、Python）。
// Playwright（または tests/labels-harness.cjs）を読み込むファイルを「ブラウザのテスト」とみなす。
// 成否は終了コードで決める。node:test のファイルも、独自の小さなランナーのファイルも、失敗すれば 0 以外で終わる。
// 各テストの出力は _test-logs/ に残し、失敗したものだけ末尾を画面に出す。
// ブラウザのテストには待ち時間に頼るものがあり、並列で CPU が混むと落ちることがある。そこで並列で落ちたものは
// 最後に 1 本ずつ流し直し、それで成功したら「不安定」と表示する（全体の成否は成功扱い。並列のときのログは *.parallel.log）。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(ROOT, 'tests');
const LOG_DIR = path.join(ROOT, '_test-logs');

// 既知の失敗: { 'tests/名前.test.js': '理由' }。全体の成否には数えない。成功したら「外せる」と知らせる。
const KNOWN_FAILURES = {};

// ---- 引数 ----
function parseArgs(argv) {
  const opts = { fast: false, list: false, retry: true, jobs: 4, timeout: 300, filters: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fast') opts.fast = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--no-retry') opts.retry = false;
    else if (a === '-j' || a === '--jobs') opts.jobs = Number(argv[++i]);
    else if (a.startsWith('-j') && /^\d+$/.test(a.slice(2))) opts.jobs = Number(a.slice(2));
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '-h' || a === '--help') { opts.help = true; }
    else if (a.startsWith('-')) throw new Error(`知らないオプション: ${a}`);
    else opts.filters.push(a);
  }
  if (!(opts.jobs >= 1)) throw new Error('-j には 1 以上の数を指定する');
  if (!(opts.timeout > 0)) throw new Error('--timeout には正の秒数を指定する');
  return opts;
}

// ---- テストを探す ----
const BROWSER_RE = /require\(\s*['"]playwright['"]\s*\)|from\s+['"]playwright['"]|labels-harness/;

function hasCommand(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

function discover() {
  const jobs = [];
  if (fs.readdirSync(TESTS).some(f => /^test_.*\.py$/.test(f))) {
    // この開発機の python3 には pytest が無いので、pytest コマンドを優先する
    const cmd = hasCommand('pytest', ['--version']) ? ['pytest'] : ['python3', '-m', 'pytest'];
    jobs.push({ name: 'pytest tests', kind: 'fast', cmd: [...cmd, 'tests', '-q', '-p', 'no:cacheprovider'] });
  }
  if (fs.existsSync(path.join(TESTS, 'unit'))) {
    jobs.push({ name: 'tests/unit/', kind: 'fast', cmd: ['node', '--test', 'tests/unit/'] });
  }
  for (const f of fs.readdirSync(TESTS).sort()) {
    if (!/\.test\.(js|mjs|cjs)$/.test(f)) continue;
    const rel = `tests/${f}`;
    const browser = BROWSER_RE.test(fs.readFileSync(path.join(TESTS, f), 'utf8'));
    jobs.push({ name: rel, kind: browser ? 'browser' : 'fast', cmd: ['node', rel] });
  }
  return jobs;
}

// ---- 前回の所要時間（並べ替えにだけ使う。_test-logs/ に置く）----
const DURATIONS = path.join(LOG_DIR, 'durations.json');
function readDurations() {
  try { return JSON.parse(fs.readFileSync(DURATIONS, 'utf8')); } catch { return {}; }
}
function writeDurations(d) {
  try { fs.writeFileSync(DURATIONS, JSON.stringify(d, null, 2) + '\n'); } catch { /* 書けなくても結果は変わらない */ }
}

// ---- 実行 ----
function runJob(job, env, timeoutSec) {
  return new Promise(resolve => {
    const logFile = path.join(LOG_DIR, job.name.replace(/[\/]+$/, '').replace(/[\/ ]/g, '_') + '.log');
    const out = fs.openSync(logFile, 'w');
    const start = Date.now();
    const child = spawn(job.cmd[0], job.cmd.slice(1), { cwd: ROOT, env, stdio: ['ignore', out, out] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutSec * 1000);
    const finish = (code, error) => {
      clearTimeout(timer);
      fs.closeSync(out);
      if (error) fs.appendFileSync(logFile, `\n[run_tests] 起動できなかった: ${error.message}\n`);
      if (timedOut) fs.appendFileSync(logFile, `\n[run_tests] ${timeoutSec} 秒を超えたので止めた\n`);
      resolve({ ...job, ok: !error && !timedOut && code === 0, timedOut, secs: (Date.now() - start) / 1000, logFile });
    };
    child.on('error', e => finish(null, e));
    child.on('close', code => finish(code));
  });
}

async function runPool(jobs, limit, env, timeoutSec, onDone) {
  const results = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await runJob(jobs[i], env, timeoutSec);
      onDone(results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

// ---- 表示 ----
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const STATUS = {
  pass: paint('32', '成功      '),
  fail: paint('31', '失敗      '),
  known: paint('33', '既知の失敗'),
  fixed: paint('36', '成功(既知)'),
  flaky: paint('33', '不安定    '),
};

function statusOf(r) {
  const known = Object.hasOwn(KNOWN_FAILURES, r.name);
  if (r.ok) return known ? 'fixed' : r.flaky ? 'flaky' : 'pass';
  return known ? 'known' : 'fail';
}

const line = r => `${STATUS[statusOf(r)]}  ${r.secs.toFixed(1).padStart(6)}s  ${r.name}${r.timedOut ? '（時間切れ）' : ''}`;

function tail(file, n) {
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  return lines.slice(-n).join('\n');
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }

  const allJobs = discover();
  let jobs = allJobs;
  if (opts.fast) jobs = jobs.filter(j => j.kind === 'fast');
  if (opts.filters.length) jobs = jobs.filter(j => opts.filters.some(f => j.name.includes(f)));
  if (!jobs.length) {
    console.error('流すテストがない');
    process.exit(2);
  }
  if (opts.list) {
    for (const j of jobs) console.log(`${j.kind === 'browser' ? 'ブラウザ' : '速い    '}  ${j.name}`);
    return;
  }

  const env = { ...process.env };
  if (!env.NODE_PATH && jobs.some(j => j.kind === 'browser')) {
    // Playwright はグローバルに入れてあるので、そこを探させる
    const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' });
    if (r.status === 0) env.NODE_PATH = r.stdout.trim();
  }

  // 前回の所要時間を読んでから、ログを入れ替える
  const names = new Set(allJobs.map(j => j.name));
  const prev = Object.fromEntries(Object.entries(readDurations()).filter(([k]) => names.has(k))); // 消えたテストの分は捨てる
  fs.rmSync(LOG_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const fast = jobs.filter(j => j.kind === 'fast');
  // 長いものから先に始めると全体が早く終わる（前回の記録が無いものは先頭）
  const browser = jobs.filter(j => j.kind === 'browser')
    .sort((a, b) => (prev[b.name] ?? Infinity) - (prev[a.name] ?? Infinity));
  console.log(`テスト ${jobs.length} 本（速い ${fast.length}・ブラウザ ${browser.length}、ブラウザは同時に ${opts.jobs} 本）`);
  const started = Date.now();
  const print = r => console.log(line(r));
  // 速いテストは軽いので一度に流す。ブラウザのテストは -j 本ずつ
  const results = [
    ...(await runPool(fast, fast.length, env, opts.timeout, print)),
    ...(await runPool(browser, opts.jobs, env, opts.timeout, print)),
  ];
  writeDurations({ ...prev, ...Object.fromEntries(results.map(r => [r.name, Math.round(r.secs * 10) / 10])) });

  const retry = results.filter(r => r.kind === 'browser' && statusOf(r) === 'fail' && !r.timedOut);
  if (opts.retry && opts.jobs > 1 && retry.length) {
    console.log(`\n並列で落ちた ${retry.length} 本を 1 本ずつ流し直す`);
    for (const r of retry) {
      fs.renameSync(r.logFile, r.logFile.replace(/\.log$/, '.parallel.log'));
      const again = await runJob(r, env, opts.timeout);
      Object.assign(r, again.ok ? { ...again, flaky: true } : again);
      print(r);
    }
  }
  const total = (Date.now() - started) / 1000;

  const by = s => results.filter(r => statusOf(r) === s);
  for (const r of by('fail')) {
    console.log(`\n${paint('31', `---- 失敗: ${r.name}`)}（全文: ${path.relative(ROOT, r.logFile)}）`);
    console.log(tail(r.logFile, 40));
  }

  console.log('\n==== まとめ（遅い順）====');
  for (const r of [...results].sort((a, b) => b.secs - a.secs)) console.log(line(r));
  for (const r of by('known')) console.log(`既知の失敗: ${r.name} — ${KNOWN_FAILURES[r.name]}`);
  for (const r of by('flaky')) console.log(paint('33', `不安定: ${r.name} は並列では落ち、1 本だけなら成功した（並列のときのログ: ${path.relative(ROOT, r.logFile.replace(/\.log$/, '.parallel.log'))}）`));
  for (const r of by('fixed')) console.log(paint('36', `既知の失敗に入っている ${r.name} が成功した。KNOWN_FAILURES から外せる`));
  const counts = [`成功 ${by('pass').length + by('fixed').length}`, `失敗 ${by('fail').length}`];
  if (by('flaky').length) counts.push(`不安定 ${by('flaky').length}`);
  if (by('known').length) counts.push(`既知の失敗 ${by('known').length}`);
  console.log(`\n${counts.join(' / ')}  — 全体 ${total.toFixed(1)}s（ログ: _test-logs/）`);
  process.exitCode = by('fail').length ? 1 : 0;
}

main();
