// R-12-02 · AC-12-2 — 04-posting-rules.md 의 분개 절마다 테스트가 하나씩 있어야 한다.
// 유예는 "그 연산 함수가 아직 없다" 는 사실로만 정당화된다. 사유 문자열만으로는 안 된다.
//
// 면제 판정 로직(uncoveredSections · sectionsMissingReason · unclaimedOps)은 sections.mjs 에
// 순수 함수로 있다. 아래 라이브 DB 테스트와, 그 뒤의 합성 입력 테스트가 같은 함수를
// 부른다 — 가드를 무디게 만드는 리팩터(뒤집힌 필터, some↔every 교체, 피연산자 교환)가
// 생기면 합성 테스트가 먼저 걸린다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { query, closePool } from '../helpers/db.mjs';
import { POSTING_SECTIONS, uncoveredSections, sectionsMissingReason, unclaimedOps } from './sections.mjs';

const HERE = import.meta.dirname;
const DOC = path.resolve(HERE, '../../../docs/architecture/04-posting-rules.md');

after(closePool);

// 스키마에 실재하는 op_* 이름 집합. ledger 뿐 아니라 cage · identity 도 본다 —
// 게임 · 실사 연산은 cage 스키마에 있다.
async function existingOps() {
  const rows = await query(`
    SELECT n.nspname || '.' || p.proname AS fn
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('ledger', 'cage', 'identity')
       AND p.proname LIKE 'op\\_%'`);
  return new Set(rows.map((r) => r.fn));
}

// ---- 라이브 DB 테스트 -------------------------------------------------------

test('R-12-02 04 의 절 목록이 대장과 일치한다', () => {
  const headings = readFileSync(DOC, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).split('.')[0].trim());
  const known = new Set(POSTING_SECTIONS.map((s) => s.id));
  assert.deepEqual(
    headings.filter((id) => !known.has(id)),
    [],
    '04 에 대장에 없는 절이 생겼다. sections.mjs 에 등재하고 posting 여부를 정한다'
  );
});

test('R-12-02 대장이 가리키는 테스트 파일이 전부 존재한다', () => {
  const missing = POSTING_SECTIONS.filter((s) => s.test !== null).filter((s) => !existsSync(path.join(HERE, s.test)));
  assert.deepEqual(
    missing.map((s) => `${s.id} ${s.title} -> ${s.test}`),
    []
  );
});

test('R-12-02 연산 함수가 있는 분개 절은 반드시 테스트가 있다', async () => {
  const ops = await existingOps();
  const uncovered = uncoveredSections(POSTING_SECTIONS, ops);
  assert.deepEqual(
    uncovered.map((s) => {
      const present = s.ops.filter((op) => ops.has(op));
      return `${s.id} ${s.title} — ${present.join(', ')} 가 있는데 계약 테스트가 없다`;
    }),
    [],
    '함수가 하나라도 있으면 미룰 수 없다. 사유(pending)로 면제되지 않는다'
  );
});

test('R-12-02 미작성 절에 사유가 적혀 있다', () => {
  const noReason = sectionsMissingReason(POSTING_SECTIONS);
  assert.deepEqual(
    noReason.map((s) => `${s.id} ${s.title}`),
    []
  );
});

test('R-12-02 스키마의 모든 op_* 가 대장에 등재되어 있다', async () => {
  // 역방향 검사. 앞의 검사들은 전부 "대장에 적힌 것" 만 본다.
  // 대장에 없는 새 op_* 는 그 그물을 통과한다 — 이 계획의 첫 판이 cage.op_* 8개를
  // 통째로 놓친 것이 정확히 그 구멍이었다.
  const ops = await existingOps();
  const orphans = unclaimedOps(POSTING_SECTIONS, ops);
  assert.deepEqual(orphans, [], '대장에 없는 op_* 가 있다. 04 의 어느 절에 속하는지 정하고 sections.mjs 에 등재한다');
});

// ---- 합성 입력 테스트 — DB 없이 판정 함수 자체를 고정한다 --------------------
//
// 가드의 가치는 "아무도 안 볼 때 걸리는 것" 이다. 손으로 sections.mjs 를 세 번 바꿔
// 보는 수동 검증(리포트에 기록)은 재실행되지 않는다. 아래는 그 수동 검증이 본 다섯
// 상태(대장 표의 다섯 행)를 합성 sections/opNames 로 재현해 커밋된 회귀로 고정한다.

test('R-12-02 합성 · op_* 가 있고 테스트가 없으면 uncoveredSections 가 잡는다', () => {
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['ledger.op_fake'], test: null }];
  const ops = new Set(['ledger.op_fake']);
  assert.deepEqual(
    uncoveredSections(sections, ops).map((s) => s.id),
    ['X']
  );
});

test('R-12-02 합성 · op_* 가 없고 사유가 있으면 통과한다 (호출할 대상이 없다)', () => {
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['ledger.op_not_yet'], test: null, pending: '사유' }];
  const ops = new Set(); // 아직 아무 op_* 도 없다
  assert.deepEqual(uncoveredSections(sections, ops), []);
  assert.deepEqual(sectionsMissingReason(sections), []);
});

test('R-12-02 합성 · op_* 가 없고 사유도 없으면 sectionsMissingReason 이 잡는다', () => {
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['ledger.op_not_yet'], test: null }];
  assert.deepEqual(
    sectionsMissingReason(sections).map((s) => s.id),
    ['X']
  );
});

test('R-12-02 합성 · 사유가 있어도 op_* 가 생기면 유예가 만료된다', () => {
  // 표의 넷째 줄. pending 이 있어도 uncoveredSections 는 봐주지 않는다.
  const sections = [
    { id: 'X', title: '가상 절', posting: true, ops: ['ledger.op_now_exists'], test: null, pending: '예전 사유' },
  ];
  const ops = new Set(['ledger.op_now_exists']);
  assert.deepEqual(
    uncoveredSections(sections, ops).map((s) => s.id),
    ['X']
  );
});

test('R-12-02 합성 · some 이다 — 연산이 둘인 절에서 하나만 실재해도 잡힌다', () => {
  // every 로 뒤집히면 이 테스트가 실패한다: op_b 가 없으므로 every 는 미포함으로 판정한다.
  const sections = [
    { id: 'X', title: '가상 절', posting: true, ops: ['cage.op_a', 'cage.op_b'], test: null },
  ];
  const ops = new Set(['cage.op_a']); // op_b 는 아직 없다
  assert.deepEqual(
    uncoveredSections(sections, ops).map((s) => s.id),
    ['X']
  );
});

test('R-12-02 합성 · 테스트가 있으면 op_* 가 있어도 uncoveredSections 가 넘어간다', () => {
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['ledger.op_covered'], test: './x.test.js' }];
  const ops = new Set(['ledger.op_covered']);
  assert.deepEqual(uncoveredSections(sections, ops), []);
});

test('R-12-02 합성 · posting: false 절은 op_* 가 있어도 uncoveredSections 에서 빠진다', () => {
  const sections = [{ id: 'X', title: '가상 절', posting: false, ops: ['cage.op_no_posting'], test: null }];
  const ops = new Set(['cage.op_no_posting']);
  assert.deepEqual(uncoveredSections(sections, ops), []);
});

test('R-12-02 합성 · 대장에 없는 op_* 는 posting 여부와 무관하게 unclaimedOps 가 잡는다', () => {
  // 표의 다섯째 줄 — 역방향 검사. posting: false 절(§15 류)의 op_* 가 등재되지 않아도
  // 걸려야 한다. 반대로 등재된 op_* 는 orphan 이 아니다.
  const sections = [
    { id: 'A', title: '분개 절', posting: true, ops: ['ledger.op_claimed'], test: './a.test.js' },
    { id: 'B', title: '무분개 절', posting: false, ops: ['cage.op_admin_only'], test: null },
  ];
  const ops = new Set(['ledger.op_claimed', 'cage.op_admin_only', 'cage.op_orphan']);
  assert.deepEqual(unclaimedOps(sections, ops), ['cage.op_orphan']);
});

test('R-12-02 합성 · 등재된 op_* 만 있으면 unclaimedOps 가 비어 있다', () => {
  const sections = [{ id: 'A', title: '분개 절', posting: true, ops: ['ledger.op_claimed'], test: './a.test.js' }];
  const ops = new Set(['ledger.op_claimed']);
  assert.deepEqual(unclaimedOps(sections, ops), []);
});
