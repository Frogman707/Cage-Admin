// 04-posting-rules.md 의 최상위 절 대장 + 그 위의 순수 판정 함수.
//   posting  분개를 만드는 절인가. **손으로 적지만 손으로 믿지는 않는다** —
//            sectionsWithMismatchedPosting 이 카탈로그(pg_proc.prosrc)에서 도출한
//            사실과 대조한다. posting: false 는 uncoveredSections ·
//            sectionsWithUncitedOps 를 통째로 면제시키는 탈출구라, 리터럴을
//            믿으면 §15 에 새 연산 하나 얹는 것만으로 다섯 가드가 전부 통과한다.
//   ops      그 절을 실행하는 연산 함수. **스키마 한정 이름**이다.
//            게임 · 실사 연산은 ledger 가 아니라 cage 스키마에 있다.
//   test     그 절의 계약 테스트 파일 (없으면 null)
//   pending  test 가 null 인 분개 절의 사유. ops 가 하나라도 실재하면 사유는 무효다
//
// 스키마의 모든 op_* 가 여기 어딘가에 있어야 한다 (역방향 검사).
// 분개를 만들지 않는 연산도 §15 에 등재한다.
import path from 'node:path';

export const POSTING_SECTIONS = [
  { id: '0', title: '읽는 법', posting: false, ops: [], test: null },
  { id: '1', title: '입금', posting: true, ops: ['ledger.op_deposit'], test: './section-01-deposit.test.js' },
  { id: '2', title: '출금', posting: true, ops: ['ledger.op_withdraw'], test: './section-02-withdraw.test.js' },
  {
    id: '3',
    title: '계좌 간 이체',
    posting: true,
    ops: ['ledger.op_transfer'],
    test: './section-03-transfer.test.js',
  },
  {
    id: '4',
    title: '지점 간 이체',
    posting: true,
    ops: ['ledger.op_branch_transfer'],
    test: './section-04-branch-transfer.test.js',
  },
  {
    id: '5',
    title: '게임 시작 · 바이인 추가',
    posting: true,
    ops: ['cage.op_open_game', 'cage.op_add_buyin'],
    test: './section-05-game-buyin.test.js',
  },
  {
    id: '6',
    title: '롤링 입력 — 자금 이동 없음',
    posting: false,
    ops: ['cage.op_record_rolling'],
    test: './section-05-game-buyin.test.js',
  },
  {
    id: '6-1',
    title: '롤링 커미션 정산',
    posting: true,
    ops: ['cage.op_settle_commission'],
    test: './section-06-1-commission.test.js',
  },
  {
    id: '6-2',
    title: '이벤트 보너스 커미션',
    posting: true,
    ops: [],
    test: null,
    pending: 'a14 — B5 미결. 전용 연산 함수가 없다',
  },
  { id: '7', title: '중간정산', posting: true, ops: ['cage.op_settle_game'], test: './section-07-08-settle.test.js' },
  { id: '8', title: '게임 종료', posting: true, ops: ['cage.op_settle_game'], test: './section-07-08-settle.test.js' },
  {
    id: '9',
    title: '게임 취소',
    posting: true,
    ops: ['cage.op_cancel_game', 'ledger.op_reverse_transaction'],
    test: './section-09-game-cancel.test.js',
  },
  {
    id: '10',
    title: '메인 케이지 — 자금 원장 아님',
    posting: false,
    ops: ['cage.op_main_cage_entry'],
    test: null,
  },
  {
    id: '11',
    title: '밸런싱 차액 조정',
    posting: true,
    ops: ['ledger.op_adjustment', 'cage.op_record_balancing'],
    test: './section-11-adjustment.test.js',
  },
  {
    id: '11-2',
    title: '차액 확정 해소',
    posting: true,
    ops: ['ledger.op_resolve_suspense'],
    test: './section-11-adjustment.test.js',
  },
  {
    id: '12',
    title: '케이지 계좌 ↔ 회원 보유금',
    posting: true,
    ops: ['ledger.op_wallet_transfer'],
    test: './section-12-wallet-transfer.test.js',
  },
  {
    id: '13',
    title: '플레이어 베팅 · 페이아웃',
    posting: true,
    ops: [],
    test: null,
    pending: '보류 — 13 §2. 전용 연산 함수가 없다. 멱등키 분리는 a12',
  },
  { id: '13-2', title: '포인트', posting: true, ops: [], test: null, pending: 'a10 — B2 미결. 연산 함수 없음' },
  { id: '13-3', title: '파트너 쉐어', posting: true, ops: [], test: null, pending: 'a13 — B4 미결. 연산 함수 없음' },
  { id: '13-4', title: '케이지 포인트', posting: true, ops: [], test: null, pending: 'a10 — B2 미결. 연산 함수 없음' },
  {
    id: '14',
    title: '기초 잔액 개시',
    posting: true,
    ops: ['ledger.op_load_opening_balance'],
    test: './section-14-opening-balance.test.js',
  },
  {
    id: '15',
    title: '자금 이동이 없는 연산',
    posting: false,
    // 분개를 만들지 않는 연산의 집합소. 역방향 검사가 미등재 op_* 를 막으므로
    // 여기 모아 둔다. 나중에 분개를 만들게 되면 해당 절로 옮긴다.
    ops: [
      'ledger.op_open_account',
      'ledger.op_freeze_period',
      'ledger.op_settle_period',
      'identity.op_request_approval',
      'identity.op_cast_vote',
      'identity.op_shift_event',
    ],
    test: null,
  },
  { id: '16', title: '`entry_category` 전체 목록', posting: false, ops: [], test: null },
  { id: '17', title: '검증 체크리스트', posting: false, ops: [], test: null },
  { id: '18', title: '이 표를 강제하는 방법', posting: false, ops: [], test: null },
];

// 아래 세 함수가 R-12-02 면제 판정("어느 절이 유예 대상인가")의 핵심 로직이다 —
// 대장·문서 제목 일치, 테스트 파일 존재 같은 구조 점검은 별개로 section-coverage.test.js
// 안에 남아 있다. 라이브 DB 테스트와 합성 입력 테스트가 이 세 함수를 똑같이 호출한다 —
// 로직이 한 곳에만 있고, 실 스키마 조회 없이도 합성 sections/opNames 로 검증할 수 있다.
//
// sections: POSTING_SECTIONS 모양의 배열.
// opNames:  스키마에 실재하는 "schema.op_name" 문자열의 Set.

// posting 절인데 테스트가 없고, 매핑된 op_* 가 하나라도 실재하는 절.
// some 이다 — every 가 아니다. 연산이 둘인 절에서 하나만 구현돼도 계약 테스트가 필요하다.
// pending 사유가 있어도 예외가 아니다 — op_* 가 하나 생기는 순간 유예는 그 자리에서 만료된다.
// !s.test 다 — s.test === null 이 아니다. test 필드 자체가 생략된(undefined) 행도
// "테스트 없음"으로 취급해야, 그 실수가 이 테스트가 아니라 파일 존재 검사에서
// 알아보기 힘든 ERR_INVALID_ARG_TYPE 로 먼저 터지는 것을 막는다.
export function uncoveredSections(sections, opNames) {
  return sections.filter((s) => s.posting && !s.test && s.ops.some((op) => opNames.has(op)));
}

// post_transaction 을 **직접** 부르지는 않지만 분개를 만드는 op_*. op -> 사유.
// posting-rules.test.js 의 KNOWN_RULELESS 와 같은 규율이다: 사유 없이 올리지 않고,
// 목록이 낡으면(그 op 이 사라졌거나 이제 직접 부르면) 그 자체가 실패다.
export const INDIRECT_POSTING_OPS = new Map([
  [
    'cage.op_cancel_game',
    'ledger.reverse_transaction() 을 거쳐 역분개를 찍는다 (010_operations_game.sql:603). ' +
      '그 함수가 post_transaction 을 부르므로 prosrc 직접 검사에는 안 걸린다',
  ],
  [
    'ledger.op_reverse_transaction',
    'ledger.reverse_transaction() 의 얇은 공개 래퍼다 (011_operations_admin.sql §6). ' +
      '분개는 그 안쪽에서 찍힌다',
  ],
]);

// 절이 선언한 posting 플래그를 카탈로그에서 도출한 사실과 대조한다.
//
// postingOps: prosrc 가 ledger.post_transaction 을 직접 부르는 op_* 이름의 Set.
// opNames:    스키마에 실재하는 op_* 전체.
//
// **실재하는 op 이 하나도 없는 절은 판정하지 않는다** — 도출할 근거가 없다.
// §13 처럼 연산 함수가 아직 없는 예정 절(posting: true, ops: [])은 문서가 약속한
// 미래이지 카탈로그가 반증할 수 있는 주장이 아니다. 그 절들은 uncoveredSections ·
// sectionsMissingReason 이 따로 지킨다.
export function sectionsWithMismatchedPosting(sections, opNames, postingOps) {
  const posts = (op) => postingOps.has(op) || INDIRECT_POSTING_OPS.has(op);
  return sections
    .map((s) => {
      const present = s.ops.filter((op) => opNames.has(op));
      if (present.length === 0) return null;
      const derived = present.some(posts);
      return derived === Boolean(s.posting) ? null : { section: s, declared: Boolean(s.posting), derived, present };
    })
    .filter((r) => r !== null);
}

// posting 절인데 테스트가 없고, pending 사유도 적혀 있지 않은 절.
export function sectionsMissingReason(sections) {
  return sections.filter((s) => s.posting && !s.test && !s.pending);
}

// 스키마에는 있지만 어느 절의 ops 에도 등재되지 않은 op_* (정렬됨).
// 역방향 검사 — posting 여부와 무관하게 opNames 전체를 훑는다. §15 처럼 posting: false 인
// 절의 연산도 여기 등재되지 않으면 고아로 잡혀야 한다.
export function unclaimedOps(sections, opNames) {
  const claimed = new Set(sections.flatMap((s) => s.ops));
  return [...opNames].filter((op) => !claimed.has(op)).sort();
}

// 절이 테스트를 "갖고 있다"는 사실만으로는, 그 절이 주장하는 op_* 전부가 실제로
// 검증됐다는 뜻이 아니다 — 연산이 둘 이상인 절에서 이웃 op 의 테스트만 있어도
// uncoveredSections 는 통과한다(§9: op_cancel_game 은 테스트가 있고
// op_reverse_transaction 은 대장에만 적혀 있던 경우가 그것이다).
//
// 이름이 소스에 "등장"하는 것만으로는 부족하다. 헤더 주석에 op 이름을 적어 두면
// 실제로는 아무것도 부르지 않고도 이 검사를 통과했다(§5 의 cage.op_open_game 이
// 파일 첫 줄 주석에만 있고 실제 호출은 fixtures/games.mjs 안에 있던 경우) — 그래서
// 아래 세 가지를 강제한다:
//   1. 주석(줄·블록)을 지운 소스에서 찾는다 — 이름이 프로즈에만 살아 있으면 인용이
//      아니다. 문자열 리터럴은 그대로 둔다 — SQL 호출은 대개 문자열 안에 있다.
//   2. "호출 형태" 만 인용으로 친다 — 이름 뒤에 (공백 있어도) 여는 괄호가 와야 한다.
//   3. 상대 import(`./` · `../`) 를 한 겹만 따라간다 — 절이 fixture 를 거쳐 op_* 를
//      부르는 경우(§5 → games.mjs, fundedAccount 를 쓰는 절 → members.mjs)를 덮는다.
//      바깥 패키지 import 는 따라가지 않는다. 더 깊이 재귀하지 않는다.
//
// sourceOf(path) -> 그 파일의 소스 텍스트. path 는 절의 test 필드처럼 posting/ 기준
// 상대 경로이거나, 그 소스 안에서 찾은 import 특정자를 절 test 의 디렉터리에 대해
// 다시 합친 경로다. 실사용은 fs 읽기, 합성 테스트는 in-memory 맵을 주입해
// DB·파일시스템 없이 검증한다.
// opNames 로 존재 여부를 먼저 거른다 — 아직 없는 op_* 를 인용 못 했다고 잡으면
// pending 절의 test:null 케이스와 목적이 겹친다(그건 uncoveredSections 의 몫이다).
export function sectionsWithUncitedOps(sections, opNames, sourceOf) {
  return sections
    .filter((s) => s.test)
    .map((s) => {
      const ownSource = stripComments(sourceOf(s.test));
      const importedSources = relativeImportsOf(ownSource).map((spec) =>
        stripComments(sourceOf(path.join(path.dirname(s.test), spec)))
      );
      const allSource = [ownSource, ...importedSources].join('\n');
      const missing = s.ops.filter((op) => opNames.has(op) && !isCalledIn(allSource, op));
      return { section: s, missing };
    })
    .filter((r) => r.missing.length > 0);
}

// 문자열 리터럴(작은·큰따옴표·백틱)은 그대로 두고, 줄·블록 주석만 지운다.
// 문자열 안의 // 같은 패턴을 주석으로 오인하지 않도록 문자열을 먼저 통째로 매칭해
// 캡처 그룹으로 보존한다 — 그 그룹이 잡히면 그대로 돌려주고, 아니면(주석이 매칭된
// 것이므로) 빈 문자열로 지운다.
function stripComments(source) {
  return source.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, str) => (str !== undefined ? str : '')
  );
}

// op 이름 뒤에 (공백을 사이에 두고라도) 여는 괄호가 와야 "호출"로 친다.
function isCalledIn(source, op) {
  const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\(`).test(source);
}

// 소스 안의 상대 경로 import 특정자를 모은다. bare specifier(패키지 이름)는
// 무시한다 — 따라갈 필요도, 안전하게 따라갈 방법도 없다.
function relativeImportsOf(source) {
  const specs = new Set();
  for (const m of source.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
    specs.add(m[1]);
  }
  return [...specs];
}
