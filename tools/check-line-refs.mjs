#!/usr/bin/env node
/* global process, console */
// 문서의 `<파일>:<줄>` 참조가 실제 그 줄을 가리키는지 검사한다.
//
//   node tools/check-line-refs.mjs
//
// 규칙 둘:
//   (1) 참조한 줄 번호가 파일 길이 안에 있어야 한다.
//   (2) 참조가 있는 문서 줄에 백틱 식별자가 있으면, 그 식별자가 대상 파일의
//       참조 줄 ±3 줄 안에 나타나야 한다. 문서가 코드와 함께 움직였는지 보는 값싼 대조다.
//
// 근거: docs/spec/12-ci-golden-tests.md R-12-11 · R-12-12
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DOC_ROOT = path.join(REPO_ROOT, 'docs');
const REF_RE = /([A-Za-z0-9_./-]+\.(?:html|js|mjs|sql)):(\d{1,6})/g;
const IDENT_RE = /`([A-Za-z_$][A-Za-z0-9_$.]{2,})`/g;
const WINDOW = 3;

async function collectMarkdown(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const sourceCache = new Map();
async function sourceLines(file) {
  if (!sourceCache.has(file)) {
    try {
      sourceCache.set(file, (await readFile(file, 'utf8')).split('\n'));
    } catch {
      sourceCache.set(file, null);
    }
  }
  return sourceCache.get(file);
}

const docs = await collectMarkdown(DOC_ROOT, []);
docs.sort();

const problems = [];
let checked = 0;

for (const doc of docs) {
  const lines = (await readFile(doc, 'utf8')).split('\n');
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(REF_RE)) {
      const [, rawPath, rawLine] = match;
      const lineNo = Number(rawLine);
      checked += 1;
      const where = `${path.relative(REPO_ROOT, doc)}:${index + 1}`;
      // 참조 경로는 **저장소 루트 기준**으로만 푼다. 문서 기준 상대 경로로
      // 다시 시도하지 않는다: 문서가 옮겨 다니면 같은 문자열이 다른 파일을
      // 가리키게 되고, 그러면 이 검사가 가리키는 대상 자체가 흔들린다.
      // 실측으로도 얻을 것이 없다 — 지금 열리지 않는 참조 31건 중 문서 기준으로
      // 풀어서 열리는 것은 0건이다. 전부 저장소 기준 경로가 빠졌거나
      // 없어진 디렉터리(`ddl/`)를 가리킬 뿐이다. 고칠 곳은 검사기가 아니라 문서다.
      const body = await sourceLines(path.resolve(REPO_ROOT, rawPath));
      if (body === null) {
        // 읽을 수 없는 참조 대상은 통과가 아니라 문제다. 파일이 지워지거나
        // 이름이 바뀌면 그 파일을 가리키던 참조 전부가 조용히 검사에서 빠진다 —
        // index.html 은 이 프로젝트가 대체하려는 레거시 단일 파일이라
        // 정확히 그 일이 일어난다. 검사가 가장 필요한 시점에 꺼지는 셈이다.
        problems.push(`${where}: ${rawPath}:${rawLine} — 참조 대상 파일을 읽을 수 없다`);
        continue;
      }
      if (lineNo < 1 || lineNo > body.length) {
        problems.push(`${where}: ${rawPath}:${lineNo} — 파일은 ${body.length}줄뿐이다`);
        continue;
      }
      const idents = [...line.matchAll(IDENT_RE)].map((m) => m[1]);
      if (idents.length === 0) continue;
      const window = body.slice(Math.max(0, lineNo - 1 - WINDOW), lineNo + WINDOW).join('\n');
      if (!idents.some((id) => window.includes(id.split('.').pop()))) {
        problems.push(`${where}: ${rawPath}:${lineNo} — 근처 ±${WINDOW}줄에 ${idents.join(' · ')} 가 없다`);
      }
    }
  }
}

for (const problem of problems) console.error(problem);
console.log(`${docs.length} docs, ${checked} line refs, ${problems.length} stale`);
process.exit(problems.length === 0 ? 0 : 1);
