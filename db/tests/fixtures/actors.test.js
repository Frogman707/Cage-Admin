// 픽스처 자체의 계약. 이것이 깨지면 뒤 테스트의 실패 원인이 픽스처인지 연산인지 알 수 없다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, withRollback, uniq, closePool } from '../helpers/db.mjs';
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
      code: uniq('T-MGR'),
      branches: [branch],
      roles: ['cage_manager'],
    });
    await assert.doesNotReject(() =>
      client.query("SELECT identity.assert_actor_authorized($1, $2, 'account.open')", [authorized, branch])
    );

    const unauthorized = await createStaff(client, {
      code: uniq('T-OPR'),
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
    createStaff(client, { code: uniq('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
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
  // approve() 안의 issueStepUp 도 별도 소유자 커넥션에서 커밋한다. 승인자 a·b 가
  // 그 커넥션에서 보이려면 먼저 커밋돼 있어야 하므로, 직원 생성을 별도 asOwner
  // 트랜잭션으로 먼저 끝낸다 — 승인 흐름은 그다음 asOwner 트랜잭션에서 돈다.
  const branch = 'HANN';
  const { actor, a, b } = await asOwner(async (client) => {
    const actor = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    const a = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    const b = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    return { actor, a, b };
  });

  await asOwner(async (client) => {
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
    const actor = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });
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
