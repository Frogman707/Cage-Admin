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
import {
  POSTING_SECTIONS,
  uncoveredSections,
  sectionsMissingReason,
  unclaimedOps,
  sectionsWithUncitedOps,
} from './sections.mjs';

const HERE = import.meta.dirname;
const DOC = path.resolve(HERE, '../../../docs/architecture/04-posting-rules.md');

after(closePool);

// 스키마에 실재하는 op_* 이름 집합. 스키마를 손으로 고르지 않는다 — 시스템 스키마만
// 뺀 나머지 전부를 본다. IN ('ledger','cage','identity') 로 손으로 고르면 새
// 마이그레이션이 무심코 public 에 만든 op_* 가 이 그물을 조용히 빠져나간다.
async function existingOps() {
  const rows = await query(`
    SELECT n.nspname || '.' || p.proname AS fn
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\\_%'
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
  // 반대 방향도 본다 — 대장에는 남아 있는데 04 에서 이름이 바뀌었거나(오타 포함)
  // 지워진 절 id 는 한쪽 검사만으로는 영원히 안 잡힌다. pending 을 단 채로 잡초처럼
  // 방치될 수 있다.
  const headingSet = new Set(headings);
  assert.deepEqual(
    POSTING_SECTIONS.map((s) => s.id).filter((id) => !headingSet.has(id)),
    [],
    '대장에는 있는데 04 에 더는 없는(또는 id 가 어긋난) 절이 있다. sections.mjs 를 04 에 맞춘다'
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

test('R-12-02 절이 주장하는 op_* 는 그 테스트 파일 안에 이름으로 등장한다', async () => {
  // 앞의 두 검사는 전부 "그 절에 테스트 파일이 있는가" 만 본다. 연산이 둘 이상인
  // 절에서 이웃 op 의 테스트만 있어도 그 검사들은 통과한다 — §9 가 op_cancel_game
  // 테스트만 갖고 op_reverse_transaction 은 대장에만 적혀 있던 것이 정확히 이 구멍이다.
  const ops = await existingOps();
  const sourceOf = (testPath) => readFileSync(path.join(HERE, testPath), 'utf8');
  const uncited = sectionsWithUncitedOps(POSTING_SECTIONS, ops, sourceOf);
  assert.deepEqual(
    uncited.map((r) => `${r.section.id} ${r.section.title} — ${r.missing.join(', ')} 를 그 테스트 파일이 부르지 않는다`),
    [],
    '이웃 op 의 테스트가 있다고 이 op 가 검증된 것은 아니다. 대장이 주장하는 op_* 를 실제로 호출하는 테스트를 추가한다'
  );
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

test('R-12-02 합성 · 테스트 파일이 절의 op_* 를 전부 부르지 않으면 sectionsWithUncitedOps 가 잡는다', () => {
  // §9 가 실제로 겪은 모양이다: 연산이 둘인데 소스는 하나만 인용한다.
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['cage.op_a', 'cage.op_b'], test: './x.test.js' }];
  const ops = new Set(['cage.op_a', 'cage.op_b']);
  const sourceOf = () => "client.query('SELECT cage.op_a($1)')"; // op_b 는 언급이 없다
  assert.deepEqual(sectionsWithUncitedOps(sections, ops, sourceOf), [{ section: sections[0], missing: ['cage.op_b'] }]);
});

test('R-12-02 합성 · 아직 존재하지 않는 op_* 는 인용 검사에서 빠진다', () => {
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['cage.op_not_yet'], test: './x.test.js' }];
  const ops = new Set(); // 스키마에 아직 없다 — 부를 게 없으니 인용도 못 한다
  const sourceOf = () => '아무 op_* 도 언급하지 않는 소스';
  assert.deepEqual(sectionsWithUncitedOps(sections, ops, sourceOf), []);
});

test('R-12-02 합성 · 절의 op_* 가 전부 소스에 등장하면 sectionsWithUncitedOps 가 통과한다', () => {
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['cage.op_a'], test: './x.test.js' }];
  const ops = new Set(['cage.op_a']);
  const sourceOf = () => "client.query('SELECT cage.op_a($1)')";
  assert.deepEqual(sectionsWithUncitedOps(sections, ops, sourceOf), []);
});

test('R-12-02 합성 · posting 이 false 이거나 test 가 이미 있으면 sectionsMissingReason 에서 빠진다', () => {
  // sectionsMissingReason 의 세 절 중 !s.pending 만 :131·:138 에서 이미 걸린다.
  // 아래 두 절은 각각 s.posting 과 !s.test 절을 지웠을 때만 결과가 달라지도록
  // 고른 것이다 — 하나라도 삭제되는 리팩터가 있으면 deepEqual 이 []을 못 받는다.
  const sections = [
    { id: 'A', title: '무분개 절', posting: false, test: null }, // posting 이 없으면 조건 자체가 안 걸린다
    { id: 'B', title: '이미 테스트 있음', posting: true, test: './b.test.js' }, // test 가 있으니 사유가 필요 없다
  ];
  assert.deepEqual(sectionsMissingReason(sections), []);
});

test('R-12-02 합성 · test 필드가 생략돼도(undefined) 있는 것으로 취급하지 않는다', () => {
  // s.test === null 이 아니라 !s.test 여야 한다 — 필드 자체를 빠뜨린 행도 잡아야
  // 대장 파일 존재 검사가 아니라 이 테스트에서 먼저, 알아보기 쉬운 메시지로 걸린다.
  const sections = [{ id: 'X', title: '가상 절', posting: true, ops: ['ledger.op_missing_test'] }]; // test 필드 자체가 없다
  const ops = new Set(['ledger.op_missing_test']);
  assert.deepEqual(
    uncoveredSections(sections, ops).map((s) => s.id),
    ['X']
  );
  assert.deepEqual(
    sectionsMissingReason(sections).map((s) => s.id),
    ['X']
  );
});
