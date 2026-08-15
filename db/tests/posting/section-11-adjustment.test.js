// R-12-02 04 §11 밸런싱 차액 조정 + §11-2 차액 확정 해소.
//
// 둘 다 4-eyes 가 무조건 필수다. 승인 payload 는 op_* 내부의 v_args 와
// 정확히 같아야 하고, 요청자는 자기 요청에 투표할 수 없다 — 직원 3명이 필요하다.
//
// 한 파일에 두 절이 있는 이유: op_resolve_suspense 는 금액을 인자로 받지
// 않는다. 현재 suspense 잔액을 직접 읽어 그만큼을 해소한다(04 §11-2). suspense
// 는 지점 단위 공유 계정이고 이 하니스의 모든 테스트가 커밋하므로, 이 파일의
// 첫 번째 테스트가 §11 로 그 잔액을 스스로 만들고 §11-2 로 바로 해소해야만
// §11-2 가 읽는 잔액이 §11 이 만든 것이라고 보장할 수 있다. node:test 는
// concurrency 옵션이 없는 한 파일 안 최상위 test() 를 선언 순서대로 순차
// 실행하므로, suspense 를 다시 건드리는 두 번째 테스트(교차 검증)는 반드시
// 첫 번째 테스트 뒤에 실행된다 — 파일 안에 suspense 를 건드리는 테스트는 이
// 둘뿐이고 순서가 고정되어 있으므로 첫 번째 테스트의 리터럴 기대값이
// 어지럽혀지지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, asStaff, query, uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from '../fixtures/actors.mjs';
import { approve } from '../fixtures/approvals.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

const BRANCH = 'HANN';

// 승인 연산 하나에 직원 3명. 요청자는 투표할 수 없다.
async function threeStaff() {
  return asOwner(async (client) => {
    const make = () =>
      createStaff(client, { code: uniqCode('T-MGR'), branches: [BRANCH], roles: ['cage_manager'] });
    return { actor: await make(), approverA: await make(), approverB: await make() };
  });
}

// entryRowsOf 한 번의 결과에서 삼중항과 금액을 함께 뽑는다 — 두 번 왕복하지 않는다.
function triplesOf(rows) {
  return rows.map((r) => [r.account_kind, r.sign, r.category]);
}
function amountsOf(rows) {
  return rows.map((r) => r.amount_minor);
}

test('R-12-02 · AC-12-2 04 §11 현금 과잉 조정 → §11-2 과잉분 확정', async () => {
  const { actor, approverA, approverB } = await threeStaff();
  const device = uniq('dev');
  const variance = 5000; // 양수 = 실사 > 시스템 = 과잉

  // 승인은 소유자 커넥션에서 미리 만든다. op_* 는 다음 트랜잭션에서 소비한다.
  const { adjApproval, resApproval } = await asOwner(async (client) => ({
    adjApproval: await approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'adjustment',
      subjectRef: uniq('adj'),
      // op_adjustment 의 v_args 와 키·값이 정확히 같아야 한다.
      payload: { branch: BRANCH, variance_minor: variance, currency: 'PHP' },
      deviceId: device,
    }),
    resApproval: await approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'suspense_resolve',
      subjectRef: uniq('res'),
      // op_resolve_suspense 의 v_args 에는 금액이 없다 — 잔액을 직접 읽기 때문이다.
      payload: { branch: BRANCH, currency: 'PHP' },
      deviceId: device,
    }),
  }));

  await asStaff(actor, async (client) => {
    // ---- §11 조정 ----
    const adjToken = await issueStepUp({
      staffId: actor,
      deviceId: device,
      scope: 'ledger.adjustment',
      method: 'totp',
    });
    const adj = await client.query('SELECT ledger.op_adjustment($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('adj'),
      actor,
      adjToken,
      device,
      BRANCH,
      variance,
      adjApproval,
    ]);

    const adjRows = await entryRowsOf(client, adj.rows[0].result);
    assert.deepEqual(triplesOf(adjRows), [
      ['house_cash', 1, 'adjustment'],
      ['suspense', -1, 'adjustment'],
    ]);
    assert.deepEqual(amountsOf(adjRows), [BigInt(variance), -BigInt(variance)]);

    // ---- §11-2 확정 해소 ----
    // 스텝업 scope 는 함수 이름과 뒤집혀 있다: ledger.suspense_resolve
    const resToken = await issueStepUp({
      staffId: actor,
      deviceId: device,
      scope: 'ledger.suspense_resolve',
      method: 'totp',
    });
    const res = await client.query('SELECT ledger.op_resolve_suspense($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('res'),
      actor,
      resToken,
      device,
      BRANCH,
      'test finding: 실사 과잉분 확정',
      resApproval,
    ]);

    const resRows = await entryRowsOf(client, res.rows[0].result);
    assert.deepEqual(triplesOf(resRows), [
      ['overage_income', -1, 'suspense_resolve_in'],
      ['suspense', 1, 'suspense_resolve_out'],
    ]);
    // 리터럴 variance 와 비교한다(파생값이 아니다). §11 이 저장한 금액을 다시
    // 읽어 비교하면 §11 과 §11-2 가 같은(어쩌면 같이 틀린) 값을 서로 맞춘
    // 것인지 구분할 수 없다 — §11-2 가 실제로 방금 만든 잔액을 읽었다는
    // 증거는 호출자가 미리 아는 리터럴과 비교해야만 나온다.
    assert.deepEqual(amountsOf(resRows), [-BigInt(variance), BigInt(variance)]);

    // 해소 후 suspense 잔액은 정확히 0 이어야 한다 (§11-2 규약).
    const { rows: bal } = await client.query(
      `SELECT COALESCE(sum(e.amount_minor), 0)::bigint AS balance
         FROM ledger.entries e
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE a.kind = 'suspense' AND e.branch = $1`,
      [BRANCH]
    );
    assert.equal(BigInt(bal[0].balance), 0n);
  });
});

test('R-12-02 cage.op_record_balancing 이 ledger.op_adjustment 와 같은 분개를 낸다', async () => {
  const { actor, approverA, approverB } = await threeStaff();
  const device = uniq('dev');
  const countKind = 'cash';
  const counted = 108000;
  const system = 100000;
  const variance = counted - system; // op_adjustment 를 같은 값으로 걸어 두 진입점을 직접 비교한다

  // payload 는 각 함수의 v_args 와 **정확히** 같아야 한다
  // (op_adjustment: 009:471-473 / op_record_balancing: 011:156-159). 키가 하나만
  // 달라도 consume_approval 이 "approval N payload does not match ..." 로 거부한다.
  // 같은 'adjustment' subject_kind 라도 payload 는 부르는 함수를 따른다.
  //
  // resApproval: 이 테스트가 만드는 두 조정(op_adjustment + op_record_balancing)은
  // 둘 다 suspense 를 같은 방향으로 민다 — 서로 상쇄되지 않는다. suspense 는
  // 지점 단위 공유 계정이고 이 하니스의 모든 테스트가 커밋하므로, 여기서 만든
  // 잔액을 이 테스트 끝에서 직접 해소해 0 으로 되돌리지 않으면 파일을 다시
  // 실행할 때(또는 이 지점의 suspense 를 보는 다른 테스트가 나중에 추가될 때)
  // 잔여 잔액이 남아 있게 된다. §11-2 를 실제로 호출해 그 규약(해소 후 잔액
  // 정확히 0)까지 한 번 더 다른 크기로 확인하는 셈이라 낭비도 아니다.
  const { adjApproval, balApproval, resApproval } = await asOwner(async (client) => ({
    adjApproval: await approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'adjustment',
      subjectRef: uniq('adj'),
      payload: { branch: BRANCH, variance_minor: variance, currency: 'PHP' },
      deviceId: device,
    }),
    balApproval: await approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'adjustment',
      subjectRef: uniq('bal'),
      payload: {
        branch: BRANCH,
        count_kind: countKind,
        counted_total_minor: counted,
        system_total_minor: system,
      },
      deviceId: device,
    }),
    resApproval: await approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'suspense_resolve',
      subjectRef: uniq('res'),
      payload: { branch: BRANCH, currency: 'PHP' },
      deviceId: device,
    }),
  }));

  const [adjRows, balRows] = await asStaff(actor, async (client) => {
    // ---- 진입점 1: ledger.op_adjustment ----
    const adjToken = await issueStepUp({
      staffId: actor,
      deviceId: device,
      scope: 'ledger.adjustment',
      method: 'totp',
    });
    const adj = await client.query('SELECT ledger.op_adjustment($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('adj'),
      actor,
      adjToken,
      device,
      BRANCH,
      variance,
      adjApproval,
    ]);
    const adjRows = await entryRowsOf(client, adj.rows[0].result);

    // ---- 진입점 2: cage.op_record_balancing ----
    // 스텝업 scope 는 'balancing.count' 다 (011:174). 'cage.balancing' 이 아니다.
    const balToken = await issueStepUp({
      staffId: actor,
      deviceId: device,
      scope: 'balancing.count',
      method: 'totp',
    });
    const { rows } = await client.query(
      'SELECT cage.op_record_balancing($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS result',
      [
        uniq('bal'),
        actor,
        balToken,
        device,
        BRANCH,
        countKind,
        JSON.stringify({ 1000: counted / 1000 }),
        counted,
        system,
        approverA,
        balApproval,
      ]
    );

    assert.equal(BigInt(rows[0].result.variance_minor), BigInt(variance));
    // op_record_balancing 은 조정 거래를 result **자체**가 아니라
    // result.adjustment 아래에 tx_response 로 담는다(011:229-231). entryRowsOf
    // 가 찾는 transaction.external_id 는 그 안에 있다.
    const balRows = await entryRowsOf(client, rows[0].result.adjustment);

    // ---- 정리: 이 테스트가 두 진입점으로 쌓은 suspense 를 §11-2 로 해소한다 ----
    // 위 주석 참고 — 남기면 이 지점의 suspense 잔여가 다른 실행에 새어 나간다.
    const resToken = await issueStepUp({
      staffId: actor,
      deviceId: device,
      scope: 'ledger.suspense_resolve',
      method: 'totp',
    });
    await client.query('SELECT ledger.op_resolve_suspense($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('res'),
      actor,
      resToken,
      device,
      BRANCH,
      'test cleanup: 교차 검증에서 쌓인 조정분 해소',
      resApproval,
    ]);
    const { rows: bal } = await client.query(
      `SELECT COALESCE(sum(e.amount_minor), 0)::bigint AS balance
         FROM ledger.entries e
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE a.kind = 'suspense' AND e.branch = $1`,
      [BRANCH]
    );
    assert.equal(BigInt(bal[0].balance), 0n);

    return [adjRows, balRows];
  });

  const EXPECTED = [
    ['house_cash', 1, 'adjustment'],
    ['suspense', -1, 'adjustment'],
  ];
  // 두 진입점을 04 표와 각각 비교하는 것으로는 부족하다 — 서로 같다는 것도
  // 직접 봐야 한다(harness-contract.md 의 매그니튜드 규약과 이 태스크의 취지).
  // 같은 variance 로 걸었으므로 (kind, sign, category, amount_minor, branch)
  // 전 행이 두 진입점 사이에서 그대로 같아야 한다.
  assert.deepEqual(triplesOf(adjRows), EXPECTED);
  assert.deepEqual(triplesOf(balRows), EXPECTED);
  assert.deepEqual(amountsOf(adjRows), [BigInt(variance), -BigInt(variance)]);
  assert.deepEqual(amountsOf(balRows), [BigInt(variance), -BigInt(variance)]);
  assert.deepEqual(adjRows, balRows);

  // 승인은 1회용이다. 소비되지 않았다면 payload 나 scope 가 어긋난 채
  // 다른 경로로 통과했다는 뜻이다 — 그것까지 고정한다.
  const [adjStatus] = await query('SELECT status FROM identity.approvals WHERE id = $1', [adjApproval]);
  const [balStatus] = await query('SELECT status FROM identity.approvals WHERE id = $1', [balApproval]);
  const [resStatus] = await query('SELECT status FROM identity.approvals WHERE id = $1', [resApproval]);
  assert.equal(adjStatus.status, 'approved');
  assert.equal(balStatus.status, 'approved');
  assert.equal(resStatus.status, 'approved');
});
