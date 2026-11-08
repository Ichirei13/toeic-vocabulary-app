// 文法グラフの生成: アプリの問題 + Vault（概念・Trap・問題ノート）→ data/grammar_graph.js
// 使い方: node tools/build_grammar_graph.mjs <Vault のパス> [--keep-single-rules] [--out <ファイル>]
//        （Vault は環境変数 VAULT_DIR でも指定可）
// 既定では、問題が 1 つだけのルールはノードにせず問題を章に直接つなぐ。--keep-single-rules で全ルールをノードにする。
// 未対応の問題が 1 問でもある、またはリンク先の概念・Trap が Vault にない場合は、ファイルを書かずに終了コード 1。
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVault } from './lib/vault.mjs';
import { matchQuestions } from './lib/match.mjs';
import { buildModel } from './lib/model.mjs';
import { encodeGraph } from './lib/encode.mjs';
import { loadRawGrammar } from './check_mapping.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'data', 'grammar_graph.js');

// モデルを作り、書き出してはいけない問題を集める（座標・ファイル出力はしない）。
export function assemble(app, vault, matched, options = {}) {
  const model = buildModel(
    { app, byApp: matched.byApp, concepts: vault.concepts, traps: vault.traps },
    { collapseSingleRuleQuestions: options.collapseSingleRuleQuestions !== false });
  const problems = [];
  if (matched.unmatched.length) problems.push(`Vault に対応のない問題が ${matched.unmatched.length} 問: ${matched.unmatched.join(', ')}`);
  if (model.dangling.length) problems.push(`リンク先が Vault にない概念・Trap が ${model.dangling.length} 件: ${model.dangling.join(', ')}`);
  return { model, problems };
}

function parseArgs(argv) {
  const opts = { vaultDir: process.env.VAULT_DIR, collapseSingleRuleQuestions: true, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep-single-rules') opts.collapseSingleRuleQuestions = false;
    else if (a === '--out') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error('--out にはファイル名が要ります');
      opts.out = path.resolve(v);
    }
    else if (a.startsWith('--')) throw new Error('知らないオプション: ' + a);
    else opts.vaultDir = a;
  }
  return opts;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (!opts.vaultDir) {
    console.error('使い方: node tools/build_grammar_graph.mjs <Vault のパス> [--keep-single-rules] [--out <ファイル>]（または環境変数 VAULT_DIR）');
    process.exit(2);
  }
  const { layout } = await import('./lib/layout.mjs'); // d3-force が要るので、使うときだけ読む

  const app = await loadRawGrammar();
  const vault = await loadVault(opts.vaultDir);
  const matched = matchQuestions(app, vault.questions);
  const { model, problems } = assemble(app, vault, matched, opts);

  if (problems.length) {
    console.error('生成を中止します（ファイルは書きません）:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }

  const { x, y } = layout(model);
  const src = encodeGraph(model, x, y);
  await writeFile(opts.out, src);

  const count = k => model.kind.filter(v => v === model.kinds.indexOf(k)).length;
  const bytes = Buffer.byteLength(src);
  console.log(`ノード ${model.id.length}（${model.kinds.map(k => `${k} ${count(k)}`).join(' / ')}）・エッジ ${model.edges.length}`);
  console.log(`ルール層: ${opts.collapseSingleRuleQuestions ? '1 問だけのルールは作らず問題を章に直接つなぐ（既定）' : '全ルールをノードにする（--keep-single-rules）'}`);
  console.log(`Vault と未対応の問題: ${matched.unmatched.length} 問`);
  console.log(`概念リンクのない問題: ${model.unmatchedQids.length} 問` + (model.unmatchedQids.length ? `（id: ${model.unmatchedQids.join(', ')}）` : ''));
  console.log(`出力: ${opts.out}  ${bytes} バイト（gzip 後 ${gzipSync(src).length} バイト）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
