// アプリの文法問題（data/grammar.js の RAW_GRAMMAR）と Vault の問題ノートの対応を検証する。
// 使い方: node tools/check_mapping.mjs <Vault のパス>   （環境変数 VAULT_DIR でも指定可）
// 未対応が 1 問でもあれば終了コード 1。
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVault } from './lib/vault.mjs';
import { matchQuestions, BOOK_NAMES } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadRawGrammar(file = path.join(ROOT, 'data', 'grammar.js')) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext((await readFile(file, 'utf8')) + '\n;this.__RAW = RAW_GRAMMAR;', ctx, { filename: file });
  return ctx.__RAW;
}

async function main() {
  const vaultDir = process.argv[2] || process.env.VAULT_DIR;
  if (!vaultDir) {
    console.error('使い方: node tools/check_mapping.mjs <Vault のパス>（または環境変数 VAULT_DIR）');
    process.exit(2);
  }
  const app = await loadRawGrammar();
  const vault = await loadVault(vaultDir);
  const { byApp, via, unmatched } = matchQuestions(app, vault.questions);

  console.log(`アプリ ${app.length} 問 / Vault ${vault.questions.length} 問（概念 ${vault.concepts.length}・Trap ${vault.traps.length}）`);
  console.log('');
  console.log('本ごとの対応（ID 一致 / 本文一致 / 並び順 / 未対応）');
  const books = [...new Set(app.map(q => q.b))];
  const tot = { id: 0, text: 0, order: 0, none: 0 };
  for (const b of books) {
    const qs = app.filter(q => q.b === b);
    const n = { id: 0, text: 0, order: 0, none: 0 };
    for (const q of qs) n[via.get(q.id) || 'none']++;
    for (const k of Object.keys(tot)) tot[k] += n[k];
    console.log(`  ${b.padEnd(9)} ${String(qs.length).padStart(4)} 問 : ${n.id} / ${n.text} / ${n.order} / ${n.none}  （Vault: ${BOOK_NAMES[b] || b}）`);
  }
  console.log(`  ${'合計'.padEnd(9)} ${String(app.length).padStart(4)} 問 : ${tot.id} / ${tot.text} / ${tot.order} / ${tot.none}`);

  // Vault 側の参照整合: 問題ノートが指す概念・Trap が実在するか
  const conceptIds = new Set(vault.concepts.map(c => c.id));
  const trapIds = new Set(vault.traps.map(t => t.id));
  const dangling = new Set();
  for (const v of byApp.values()) {
    for (const c of v.conceptIds) if (!conceptIds.has(c)) dangling.add('00_Concepts/' + c);
    for (const t of v.trapIds) if (!trapIds.has(t)) dangling.add('04_Traps/' + t);
  }
  if (dangling.size) {
    console.log('');
    console.log(`リンク先が見つからない概念・Trap: ${dangling.size} 件`);
    for (const d of dangling) console.log('  ' + d);
  }

  if (unmatched.length) {
    const byId = new Map(app.map(q => [q.id, q]));
    console.log('');
    console.log(`未対応 ${unmatched.length} 問（id : 本文の先頭 40 文字）`);
    for (const id of unmatched) {
      const q = byId.get(id);
      console.log(`  ${String(id).padStart(5)} [${q.b}] ${String(q.q).replace(/\s+/g, ' ').slice(0, 40)}`);
    }
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('未対応 0 問');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
