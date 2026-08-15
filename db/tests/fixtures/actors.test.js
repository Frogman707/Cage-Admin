// 픽스처 자체의 계약. 이것이 깨지면 뒤 테스트의 실패 원인이 픽스처인지 연산인지 알 수 없다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, asStaff, withRollback, uniq, uniqCode, expectSqlState, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from './actors.mjs';
import { approve } from './approvals.mjs';

after(closePool);

test('R-12-23 픽스처 직원이 권한 검사를 통과한다', async () => {
  await withRollback(async (client) => {
    const branch = 'HANN';

    // account.open 은 cage_manager · partner_admin 에만 있고 cage_operator 에는 없다
    // (db/schema/002_identity.sql). 인가/비인가 두 경로를 실제로 갈라서 본다 —
    // RETURNS VOID 함수의 성공 호출은 항상 행 1개를 내므로 rows.length 단언은
    // 아무것도 증명하지 못한다.
    const authorized = await createStaff(client, {
      code: uniqCode('T-MGR'),
      branches: [branch],
      roles: ['cage_manager'],
    });
    await assert.doesNotReject(() =>
      client.query("SELECT identity.assert_actor_authorized($1, $2, 'account.open')", [authorized, branch])
    );

    const unauthorized = await createStaff(client, {
      code: uniqCode('T-OPR'),
      branches: [branch],
      roles: ['cage_operator'],
    });
    await assert.rejects(
      () => client.query("SELECT identity.assert_actor_authorized($1, $2, 'account.open')", [unauthorized, branch]),
      /lacks permission/
    );
  });
});

test('R-12-23 스텝업 토큰은 1회용이다', async () => {
  // issueStepUp 은 별도 소유자 커넥션에서 즉시 커밋한다 — 그래서 참조하는 staff
  // 행이 먼저 커밋돼 있어야 한다. withRollback(fn) 은 (staffId 없이) 소유자로
  // 붙지만 커밋하지 않으므로, staff 생성은 asOwner 로 먼저 커밋해 둔다.
  const device = uniq('dev');
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
  const tokenId = await issueStepUp({ staffId, deviceId: device, scope: 'ledger.deposit' });
  await withRollback(async (client) => {
    await client.query('SELECT identity.consume_step_up($1, $2, $3, $4)', [tokenId, staffId, device, 'ledger.deposit']);
    await assert.rejects(
      () =>
        client.query('SELECT identity.consume_step_up($1, $2, $3, $4)', [tokenId, staffId, device, 'ledger.deposit']),
      /already used/
    );
  });
});

test('R-12-23 승인 픽스처가 실제 승인 경로를 거친다', async () => {
  // approve() 안의 issueStepUp 은 별도 소유자 커넥션에서 커밋한다. 승인자 a·b 가
  // 그 커넥션에서 보이려면 먼저 커밋돼 있어야 하므로, 직원 생성을 별도 asOwner
  // 트랜잭션으로 먼저 끝낸다. 승인 흐름 자체는 소유자가 아니라 앱 역할
  // (asStaff)로 돈다 — op_* 를 소유자로 부르면 RLS·GRANT 우회가 전부 통과해
  // 버려, 이 계약 테스트가 정작 확인해야 할 것(앱 레인에서 approve() 가
  // 실제로 동작하는가)을 확인하지 못한다. op_request_approval · op_cast_vote
  // 는 EXECUTE 가 ledger_app 에 있고(012_roles_and_grants.sql) p_actor_staff_id
  // 를 명시 인자로 받아 app.staff_id 를 읽지 않으므로, 한 asStaff(actor, …)
  // 트랜잭션 안에서 actor·a·b 세 명의 투표를 모두 진행할 수 있다.
  const branch = 'HANN';
  const { actor, a, b } = await asOwner(async (client) => {
    const actor = await createStaff(client, { code: uniqCode('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    const a = await createStaff(client, { code: uniqCode('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    const b = await createStaff(client, { code: uniqCode('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    return { actor, a, b };
  });

  await asStaff(actor, async (client) => {
    const approvalId = await approve(client, {
      actor,
      approvers: [a, b],
      branch,
      subjectKind: 'adjustment',
      subjectRef: uniq('adj'),
      payload: { branch, variance_minor: 7000, currency: 'PHP' },
      deviceId: uniq('dev'),
    });

    const { rows } = await client.query(
      `SELECT count(*)::int AS votes FROM identity.approval_votes
        WHERE approval_id = $1 AND decision = 'approve'`,
      [approvalId]
    );
    assert.equal(rows[0].votes, 2);
  });
});

test('R-12-23 요청자는 자기 요청에 투표할 수 없다 (4-eyes)', async () => {
  await asOwner(async (client) => {
    const branch = 'HANN';
    const actor = await createStaff(client, { code: uniqCode('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    await assert.rejects(
      () =>
        approve(client, {
          actor,
          approvers: [actor],
          branch,
          subjectKind: 'adjustment',
          subjectRef: uniq('adj'),
          payload: { branch, variance_minor: 1000, currency: 'PHP' },
          deviceId: uniq('dev'),
        }),
      /요청자는 승인자가 될 수 없다/
    );
  });
});

test('R-12-23 요청자는 자기 요청에 투표할 수 없다 (4-eyes, DB 트리거 직접 확인)', async () => {
  // 위 테스트는 approve() 의 JS 가드를 확인한다 — approvers.includes(actor) 가
  // 참이면 DB 에 닿기 전에 던지므로, identity.approval_votes_four_eyes 트리거
  // 자체는 그 테스트로 한 번도 실행되지 않는다. 열두 개 후속 태스크 어디에도
  // 이 트리거를 직접 겨냥하는 테스트가 없으므로 (계획 전체 확인함), 픽스처
  // 가드를 우회해 identity.op_cast_vote 를 직접 호출한다.
  //
  // 확인한 사실 (아래 SQL 을 그대로 psql 로 실행): SQLSTATE 23000,
  // 'four-eyes violation: 요청자(N)는 자기 요청을 승인할 수 없다'
  // (assert_four_eyes(), db/schema/002_identity.sql:247).
  const branch = 'HANN';
  const actor = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: [branch], roles: ['cage_manager'] })
  );

  await asStaff(actor, async (client) => {
    const { rows } = await client.query('SELECT identity.op_request_approval($1, $2, $3, $4, $5) AS result', [
      actor,
      branch,
      'adjustment',
      uniq('adj'),
      { branch, variance_minor: 500, currency: 'PHP' },
    ]);
    const approvalId = Number(rows[0].result.approval_id);

    const device = uniq('dev');
    // 요청자 자신에게 투표용 스텝업 토큰을 발급한다 — JS 가드를 우회해도
    // consume_step_up 자체는 통과해야 four-eyes 트리거까지 도달한다.
    const tokenId = await issueStepUp({ staffId: actor, deviceId: device, scope: 'approval.vote', method: 'totp' });

    await expectSqlState('23000', () =>
      client.query('SELECT identity.op_cast_vote($1, $2, $3, $4, $5)', [
        actor,
        approvalId,
        'approve',
        tokenId,
        device,
      ])
    );
  });
});
