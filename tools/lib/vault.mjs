// Obsidian Vault（English_study）の読み取り。依存なし、Vault へは書かない。
// 問題ノート 03_Questions/<本>/*.md、概念 00_Concepts/*.md、Trap 04_Traps/*.md を読む。
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// 先頭の --- ... --- を { key: value } にする（このツールが読むのは単純な key: value だけ）
export function parseFrontMatter(src) {
  const m = src.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const data = {};
  let body = src;
  if (m) {
    body = src.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/);
      if (kv) data[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  return { data, body };
}

// `> [!kind] タイトル` で始まる引用ブロックの本文（先頭の `> ` を除き、行は改行でつなぐ）
export function calloutBody(body, kind) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => new RegExp('^>\\s*\\[!' + kind + '\\]').test(l));
  if (start < 0) return '';
  const out = [];
  for (let i = start + 1; i < lines.length && /^>/.test(lines[i]); i++) out.push(lines[i].replace(/^>\s?/, ''));
  return out.join('\n').trim();
}

const OCR_FOOTER = /RECRUIT\s*HOLDINGS/;
const INSTRUCTION_LINE = /^空欄に入る最も適切なものを選びなさい。?$/;
const INLINE_CHOICES = /^\s*1\s*[.．].*2\s*[.．].*3\s*[.．].*4\s*[.．]/;

// 「## 問題文」の本文（教材 PDF のフッターの手前まで）。引用ブロック（`>` の行）と、それに続く引用でない行（「### 選択肢」・水平線・次の見出しの手前まで）。
// 実 Vault では英文が引用ブロックの次の行に続く問題（トップレベル英語など）がある。
export function questionText(body) {
  const lines = body.split(/\r?\n/);
  const h = lines.findIndex(l => /^##\s*問題文\s*$/.test(l));
  if (h < 0) return '';
  const out = [];
  for (let i = h + 1; i < lines.length; i++) {
    if (/^(#{1,6}\s|---+\s*$)/.test(lines[i])) break;
    const line = lines[i].replace(/^>\s?/, '');
    if (OCR_FOOTER.test(line)) break; // 教材 PDF のフッター以降は OCR のごみ
    // OCR 由来の定型の指示文と、1 行にまとめられた選択肢（1. … 2. … 3. … 4. …）は問題文に含めない
    if (INSTRUCTION_LINE.test(line.replace(/\s+/g, '')) || INLINE_CHOICES.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

// [[<dir>/<名前>|別名]] / [[<dir>/<名前>#見出し]] の <名前>（重複は除く）
export function linkTargets(body, dir) {
  const re = new RegExp('\\[\\[' + dir + '/([^\\]|#]+)', 'g');
  const seen = new Set();
  for (const m of body.matchAll(re)) seen.add(m[1].trim());
  return [...seen];
}

// `# 📚 名前` の見出しから先頭の絵文字を除いた名前
function headingName(body, fallback) {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  if (!m) return fallback;
  const name = m[1].replace(/^(?:[^\p{L}\p{N}\s]|️|‍)+\s*/u, '').trim();
  return name || fallback;
}

async function listMarkdown(dir) {
  let names;
  try { names = await readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return names.filter(n => n.endsWith('.md') && !n.startsWith('.')).sort().map(n => path.join(dir, n));
}

export async function loadVault(vaultDir) {
  const questions = [];
  const qRoot = path.join(vaultDir, '03_Questions');
  let bookDirs = [];
  try { bookDirs = (await readdir(qRoot, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const bookDir of bookDirs) {
    for (const file of await listMarkdown(path.join(qRoot, bookDir))) {
      const { data, body } = parseFrontMatter(await readFile(file, 'utf8'));
      const practiceId = Number(data.practice_id);
      if (!Number.isInteger(practiceId)) continue;
      const chapter = Number.isInteger(Number(data.chapter)) && data.chapter !== '' ? Number(data.chapter) : null;
      questions.push({
        practiceId,
        book: data.book || bookDir,
        chapter,
        text: questionText(body),
        conceptIds: linkTargets(body, '00_Concepts'),
        trapIds: linkTargets(body, '04_Traps'),
      });
    }
  }

  const concepts = [];
  for (const file of await listMarkdown(path.join(vaultDir, '00_Concepts'))) {
    const { data, body } = parseFrontMatter(await readFile(file, 'utf8'));
    const id = data.concept || path.basename(file, '.md');
    concepts.push({ id, name: headingName(body, id), desc: calloutBody(body, 'quote') });
  }

  const traps = [];
  for (const file of await listMarkdown(path.join(vaultDir, '04_Traps'))) {
    const { data, body } = parseFrontMatter(await readFile(file, 'utf8'));
    const id = data.trap_id || path.basename(file, '.md');
    traps.push({
      id,
      name: headingName(body, id),
      desc: calloutBody(body, 'warning'),
      advice: calloutBody(body, 'tip'),
    });
  }
  return { questions, concepts, traps };
}
