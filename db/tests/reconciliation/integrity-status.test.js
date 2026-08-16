// R-12-04 · AC-12-4 — 하니스가 커밋한 모든 행을 ledger.v_integrity_status 로 되짚는다.
//
// 이 하니스는 §1~§14 를 돌며 실제 거래 수십 건을 **커밋**하는데, 지금까지 그 결과를
// 대사 뷰로 한 번도 확인하지 않았다. 각 절 테스트는 자기가 만든 거래의 분개 집합만
// 본다 — 차대 균형(R1) · 잔액 투영(R2) · 해시 체인(R3) · 롤링 투영(R4) · suspense(R5) ·
// 분개 지점(R6) · **posting_rules 표 대조(R7)** · 체인 앵커(R8) · 머클 앵커(R9) 는
// 아무도 안 본다. 이 파일 하나가 R1~R7 을 켠다. 특히 R7 이 계획의 파일 구조 표가
// 약속한 "ledger.posting_rules 표 대조" 다 — posting-rules.test.js 는 고아 tx_kind
// 검사와 sign 도메인 검사만 하고 실제 분개 대조는 하지 않는다.
//
// **R8 · R9 는 이 파일이 켜지 못한다.** 두 뷰는 audit.chain_anchors ·
// audit.merkle_anchors 를 FROM 절에 두는데, 그 테이블에 쓰는 주체는 audit_anchorer
// 역할뿐이고 그 역할을 쓰는 배치가 아직 없다 — 두 테이블은 항상 비어 있고, 뷰가
// 0행이면 violations 도 무조건 0 이다. 아래 CHECKS 의 아홉 이름은 뷰의 UNION ALL
// 가지가 조용히 사라지는 것을 잡을 뿐이며, 초록 아홉 행이 앵커 변조 커버리지를
// 뜻하지는 않는다. 실질 커버리지는 일곱이다 (a01 계획 "완료 후 추가된 이월" 참조).
//
// **디렉터리 이름이 곧 실행 순서다.** node --test 는 글롭이 찾은 파일을 경로
// 알파벳 순으로 돈다 (실측: drift → fixtures → helpers → invariants → posting).
// 그래서 이 검사를 invariants/ 에 두면 'i' < 'p' 라 §1~§14 가 행을 쓰기 **전에**
// 돌아 빈 원장을 검사하게 된다. 'reconciliation' 은 'posting' 뒤에 온다 —
// 013_reconciliation.sql 이 이 뷰의 출처이기도 하다.
//
// 그 순서 전제가 깨져도 조용히 통과하지 않도록, 검사 전에 원장에 실제로 행이
// 쌓여 있는지부터 본다 — 0행짜리 원장에 대한 "위반 0" 은 아무것도 증명하지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, closePool } from '../helpers/db.mjs';

after(closePool);

// 이 검사가 유의미하려면 §1~§14 가 먼저 돌아야 한다. 실측: 빈 DB 에서 골든
// 스위트를 통째로 돌리면 분개 75행(거래 33건)이고, posting/ 앞 디렉터리
// (drift · fixtures · helpers · invariants)만 돌면 6행이다. 50 은 그 둘을 넉넉히
// 가르는 값이다 — 실행 순서가 바뀌거나 posting/ 이 통째로 스킵되면 "위반 0" 이
// 아니라 이 단언이 먼저 실패한다.
const MIN_ENTRIES = 50;

// 뷰가 집계하는 아홉 검사. UNION ALL 가지 하나가 조용히 빠지거나 이름이 바뀌면
// 행 수·이름 비교가 잡는다 — violations 만 보면 사라진 검사는 영원히 0으로 보인다.
const CHECKS = [
  'R1_double_entry',
  'R2_balance_projection',
  'R3_hash_chain_link',
  'R4_rolling_projection',
  'R5_suspense',
  'R6_entry_branch',
  'R7_posting_rules',
  'R8_chain_anchor',
  'R9_merkle_anchor',
];

test('R-12-04 · AC-12-4 골든 스위트가 쓴 원장이 v_integrity_status 9행 전부 violations = 0 이다', async () => {
  const [{ entries, txs }] = await query(
    'SELECT count(*)::int AS entries, count(DISTINCT transaction_id)::int AS txs FROM ledger.entries'
  );
  assert.ok(
    entries >= MIN_ENTRIES,
    `원장에 분개가 ${entries}행(거래 ${txs}건)뿐이다 — ${MIN_ENTRIES}행 이상을 기대했다. ` +
      'posting/ 이 아직 안 돌았거나(파일 실행 순서가 바뀌었다) 스킵됐다. ' +
      '그 상태의 "위반 0" 은 아무것도 증명하지 않으므로 통과시키지 않는다'
  );

  const rows = await query(
    'SELECT check_name, violations::int AS violations FROM ledger.v_integrity_status ORDER BY check_name'
  );
  assert.deepEqual(
    rows.map((r) => r.check_name),
    CHECKS,
    'v_integrity_status 의 집계 항목이 바뀌었다 (013_reconciliation.sql). 없어진 검사는 영원히 0으로 보인다'
  );
  assert.deepEqual(
    rows.filter((r) => r.violations !== 0).map((r) => `${r.check_name} = ${r.violations}`),
    [],
    `분개 ${entries}행 · 거래 ${txs}건에 대해 대사가 깨졌다. ` +
      '실패한 검사 이름으로 013_reconciliation.sql 의 해당 v_check_* 뷰를 직접 조회해 원인을 찾는다'
  );
});
