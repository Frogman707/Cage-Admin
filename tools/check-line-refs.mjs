#!/usr/bin/env node
/* global process, console */
// 문서의 `<파일>:<줄>` 참조가 실제 그 줄을 가리키는지 검사한다.
//
//   node tools/check-line-refs.mjs
//
// 두 층위로 나눈다:
//   구조 검사 (하드 게이트, 종료 코드 1) — 참조 대상 파일을 읽을 수 있는가,
//     참조한 줄 번호가 파일 길이 안에 있는가. 둘 다 기계적으로 확실하다.
//   자문 검사 (advisory, 종료 코드에 영향 없음) — 참조가 있는 문서 줄의 백틱
//     식별자가 대상 파일의 참조 줄 ±3 줄 안에 나타나는가. 문서가 코드와 함께
//     움직였는지 보는 값싼 대조이고, 참인 참조를 거짓으로도(창이 너무 좁을 때) —
//     거짓인 참조를 참으로도(식별자가 우연히 근처에 있을 때) 오판할 수 있다.
//     그래서 CI를 막지 않는다: 사람이 읽을 신호일 뿐이다.
//
// 참조는 두 형태다: 전체(`path.ext:NNN`)와 이어쓰기(`:NNN`, 앞선 전체 참조의
// 파일을 그대로 잇는다 — 같은 줄에서 먼저 나온 전체 참조가 있으면 그것을,
// 없으면 문서를 위에서부터 훑어오며 마지막으로 본 전체 참조를 쓴다). 이어쓰기는
// 반드시 백틱이나 마크다운 링크 텍스트로 감싸여 있어야 한다 — 그래야 `0.95:1`
// 같은 배당률 표기나 `16:25:29` 같은 시각 표기의 콜론과 구별된다.
//
// `docs/superpowers/plans/`는 훑지 않는다 — 계획 문서는 실행 중인 다른 작업의
// 소유물이고, 실행 시점 스냅샷이나 "이 문서가 예전에 뭐라고 잘못 말했는지"를
// 일부러 인용하는 경우가 있어(예: 이 저장소의 design-review-6.md DR-72) 이
// 검사기가 살아있는 참조와 의도된 역사적 인용을 구별할 수 없다.
//
// 근거: docs/spec/12-ci-golden-tests.md R-12-11 · R-12-12
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DOC_ROOT = path.join(REPO_ROOT, 'docs');
const PLANS_DIR = path.join(DOC_ROOT, 'superpowers', 'plans');
const REF_RE = /([A-Za-z0-9_./-]+\.(?:html|js|mjs|sql)):(\d{1,6})/g;
// 이어쓰기 참조: 백틱 쌍 또는 마크다운 링크 텍스트 전체가 `:NNN`/`:NNN-MMM`
// 하나뿐이어야 한다 — 델리미터가 열고 닫는 지점까지 통째로 요구해야
// `0.95:1`처럼 다른 텍스트에 파묻힌 콜론이나, `` `04`:437 `` 처럼 앞선
// 백틱 쌍의 **닫는** 백틱을 여는 델리미터로 오인하는 것을 둘 다 막는다.
const BARE_REF_RE = /`:(\d{1,6})(?:-\d{1,6})?`|\[:(\d{1,6})(?:-\d{1,6})?\]/g;
const IDENT_RE = /`([A-Za-z_$][A-Za-z0-9_$.]{2,})`/g;
const WINDOW = 3;

async function collectMarkdown(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (full === PLANS_DIR) continue;
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

// 식별자가 창 안에 "단어"로 나타나는지 본다 — 점 포함 전체 식별자를 그대로
// 찾는다(마지막 세그먼트로 줄여 부분 문자열 포함으로 찾지 않는다). 그래야
// `nn.cashout`이 무관한 지역변수 `cashout`에 우연히 걸리지 않는다.
function identAppears(window, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9_$.])${escaped}(?![A-Za-z0-9_$])`);
  return re.test(window);
}

const docs = await collectMarkdown(DOC_ROOT, []);
docs.sort();

const structural = [];
const advisory = [];
let checked = 0;

for (const doc of docs) {
  const lines = (await readFile(doc, 'utf8')).split('\n');
  let lastFullPath = null; // 문서를 위에서부터 훑으며 마지막으로 본 전체 참조의 경로
  for (const [index, line] of lines.entries()) {
    const where = `${path.relative(REPO_ROOT, doc)}:${index + 1}`;

    // 이 줄의 모든 참조(전체 + 이어쓰기)를 위치 순으로 모은다.
    const refs = [];
    for (const match of line.matchAll(REF_RE)) {
      refs.push({ pos: match.index, rawPath: match[1], rawLine: match[2], full: true });
    }
    for (const match of line.matchAll(BARE_REF_RE)) {
      refs.push({ pos: match.index, rawLine: match[1] ?? match[2], full: false });
    }
    refs.sort((a, b) => a.pos - b.pos);

    // 왼쪽에서 오른쪽으로 훑으며 전체 참조를 만날 때마다 lastFullPath 를 갱신하고,
    // 이어쓰기는 (같은 줄에서 앞서 나온 전체 참조가 있으면 그것을, 없으면 문서
    // 전체에서 가장 최근 전체 참조를) 그 시점의 lastFullPath 로 해소한다.
    const resolved = [];
    for (const r of refs) {
      if (r.full) {
        lastFullPath = r.rawPath;
        resolved.push({ pos: r.pos, rawPath: r.rawPath, rawLine: r.rawLine });
      } else if (lastFullPath !== null) {
        resolved.push({ pos: r.pos, rawPath: lastFullPath, rawLine: r.rawLine, bare: true });
      }
      // lastFullPath 가 아직 없으면(문서 맨 앞에서부터 이어쓰기로 시작하는 경우는
      // 없다고 보고) 조용히 건너뛴다 — 해소할 근거가 없다.
    }
    if (resolved.length === 0) continue;

    // 이 줄의 백틱 식별자를 위치가 가장 가까운 참조 하나에만 배정한다 — 이전에는
    // 줄에 참조가 여럿이면 식별자 전부를 참조 전부에 대조했다. 그러면 무관한
    // 참조 옆 식별자가 엉뚱한 참조를 통과/탈락시킨다(오귀속).
    const idents = [...line.matchAll(IDENT_RE)].map((m) => ({ text: m[1], pos: m.index }));
    const assigned = resolved.map(() => []);
    for (const id of idents) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < resolved.length; i += 1) {
        const dist = Math.abs(resolved[i].pos - id.pos);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      assigned[bestIdx].push(id.text);
    }

    for (let i = 0; i < resolved.length; i += 1) {
      const ref = resolved[i];
      const lineNo = Number(ref.rawLine);
      checked += 1;
      // 참조 경로는 **저장소 루트 기준**으로만 푼다. 문서 기준 상대 경로로
      // 다시 시도하지 않는다: 문서가 옮겨 다니면 같은 문자열이 다른 파일을
      // 가리키게 되고, 그러면 이 검사가 가리키는 대상 자체가 흔들린다.
      const body = await sourceLines(path.resolve(REPO_ROOT, ref.rawPath));
      if (body === null) {
        // 읽을 수 없는 참조 대상은 통과가 아니라 문제다. 파일이 지워지거나
        // 이름이 바뀌면 그 파일을 가리키던 참조 전부가 조용히 검사에서 빠진다.
        structural.push(`${where}: ${ref.rawPath}:${ref.rawLine} — 참조 대상 파일을 읽을 수 없다`);
        continue;
      }
      if (lineNo < 1 || lineNo > body.length) {
        structural.push(`${where}: ${ref.rawPath}:${lineNo} — 파일은 ${body.length}줄뿐이다`);
        continue;
      }
      const myIdents = assigned[i];
      if (myIdents.length === 0) continue;
      const window = body.slice(Math.max(0, lineNo - 1 - WINDOW), lineNo + WINDOW).join('\n');
      if (!myIdents.some((id) => identAppears(window, id))) {
        advisory.push(`${where}: ${ref.rawPath}:${lineNo} — 근처 ±${WINDOW}줄에 ${myIdents.join(' · ')} 가 없다`);
      }
    }
  }
}

for (const problem of structural) console.error(problem);
if (advisory.length > 0) {
  console.error('');
  console.error(`--- advisory (종료 코드에 영향 없음, ${advisory.length}건) ---`);
  for (const note of advisory) console.error(note);
}
console.log(`${docs.length} docs, ${checked} line refs, ${structural.length} structural, ${advisory.length} advisory`);
process.exit(structural.length === 0 ? 0 : 1);
