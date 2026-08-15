// 04-posting-rules.md 의 최상위 절 대장 + 그 위의 순수 판정 함수.
//   posting  분개를 만드는 절인가
//   ops      그 절을 실행하는 연산 함수. **스키마 한정 이름**이다.
//            게임 · 실사 연산은 ledger 가 아니라 cage 스키마에 있다.
//   test     그 절의 계약 테스트 파일 (없으면 null)
//   pending  test 가 null 인 분개 절의 사유. ops 가 하나라도 실재하면 사유는 무효다
//
// 스키마의 모든 op_* 가 여기 어딘가에 있어야 한다 (역방향 검사).
// 분개를 만들지 않는 연산도 §15 에 등재한다.
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
export function uncoveredSections(sections, opNames) {
  return sections.filter((s) => s.posting && s.test === null && s.ops.some((op) => opNames.has(op)));
}

// posting 절인데 테스트가 없고, pending 사유도 적혀 있지 않은 절.
export function sectionsMissingReason(sections) {
  return sections.filter((s) => s.posting && s.test === null && !s.pending);
}

// 스키마에는 있지만 어느 절의 ops 에도 등재되지 않은 op_* (정렬됨).
// 역방향 검사 — posting 여부와 무관하게 opNames 전체를 훑는다. §15 처럼 posting: false 인
// 절의 연산도 여기 등재되지 않으면 고아로 잡혀야 한다.
export function unclaimedOps(sections, opNames) {
  const claimed = new Set(sections.flatMap((s) => s.ops));
  return [...opNames].filter((op) => !claimed.has(op)).sort();
}
