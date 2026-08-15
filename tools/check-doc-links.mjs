#!/usr/bin/env node
// 문서의 상대 링크가 실재하는 파일을 가리키는지 검사한다.
//
//   node tools/check-doc-links.mjs [루트...]      기본 루트: docs db
//
// 검사 대상: 마크다운 링크 `](target)` 중 상대 경로인 것.
// 제외: http(s):// · mailto: · 앵커 전용(#...) · 프로토콜 상대(//...).
// 깨진 링크가 하나라도 있으면 종료 코드 1.
//
// 근거: docs/spec/12-ci-golden-tests.md R-12-10
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ['docs', 'db'];
const LINK_RE = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

async function collectMarkdown(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target);
}

const files = [];
for (const root of ROOTS) await collectMarkdown(path.resolve(REPO_ROOT, root), files);
files.sort();

const broken = [];
let checked = 0;

for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(LINK_RE)) {
      const raw = match[1];
      if (isExternal(raw)) continue;
      const target = decodeURI(raw.split('#')[0]);
      if (!target) continue;
      checked += 1;
      const resolved = path.resolve(path.dirname(file), target);
      if (!(await exists(resolved))) {
        broken.push({
          file: path.relative(REPO_ROOT, file),
          line: index + 1,
          target: raw,
        });
      }
    }
  }
}

for (const item of broken) {
  console.error(`${item.file}:${item.line}: broken link -> ${item.target}`);
}
console.log(`${files.length} markdown files, ${checked} relative links, ${broken.length} broken`);
process.exit(broken.length === 0 ? 0 : 1);
