// R-12-02 04 §2 출금.
//   그 절의 표: member_deposit +withdraw_cash / house_cash −withdraw_cash
//
// 두 번째 테스트가 이 파일의 핵심이다. 잔액 하한(I2)은 지연 제약이라
// op_withdraw 호출 자체는 성공한다. COMMIT 에서만 걸린다 — asStaff/withActor 는
// 콜백이 끝나면 바로 COMMIT 해 버려 그 실패를 가릴 수 없으므로, 여기서는
// expectCommitFailure 로 COMMIT 자체를 관찰한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { expectCommitFailure, uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { createActor, withActor } from '../fixtures/scenario.mjs';
import { fundedAccount } from '../fixtures/members.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §2 출금 분개 집합', async () => {
  await withActor({}, async (client, ctx) => {
    const acct = await fundedAccount(client, ctx, { amount: 100000 });
    const token = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.withdraw',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_withdraw($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('wd'),
      ctx.staffId,
      token,
      ctx.device,
      ctx.branch,
      acct,
      30000,
    ]);

    // 삼중항(종류·부호·범주)과 금액을 같은 entryRowsOf 결과에서 함께 본다 — 두 번
    // 왕복하지 않는다. 삼중항만 보면 요청한 30000 대신 ±300 이 찍혀도 I1(차대
    // 균형)은 통과하고 이 테스트도 통과해 버린다 — 그 구멍을 막는다.
    const stored = await entryRowsOf(client, rows[0].result);
    assert.deepEqual(
      stored.map((r) => [r.account_kind, r.sign, r.category]),
      [
        ['house_cash', -1, 'withdraw_cash'],
        ['member_deposit', 1, 'withdraw_cash'],
      ]
    );
    assert.deepEqual(
      stored.map((r) => r.amount_minor),
      [-30000n, 30000n]
    );
  });
});

test('R-12-02 잔액을 초과한 출금은 COMMIT 에서 거부된다 (I2, 지연 제약)', async () => {
  // createActor 만 쓴다 — asOwner/createStaff 로 액터를 손수 조립하면
  // fundedAccount 가 기대하는 ctx 모양({ staffId, device, branch, ... })이
  // createActor 밖에서 따로 유지되어, 그 모양이 바뀌는 순간 조용히 갈라진다.
  // expectCommitFailure 는 트랜잭션을 직접 열어야 하므로 withActor(=asActor,
  // 콜백 종료 시 자동 COMMIT)는 못 쓰고 액터 생성만 여기서 가져온다.
  const ctx = await createActor({ branches: ['HANN'], roles: ['cage_manager'] });

  const err = await expectCommitFailure(
    '23000',
    async (client) => {
      const acct = await fundedAccount(client, ctx, { amount: 1000 });
      const token = await issueStepUp({
        staffId: ctx.staffId,
        deviceId: ctx.device,
        scope: 'ledger.withdraw',
        method: 'totp',
      });
      // 이 호출은 성공한다. 그게 요점이다 — 롤백하는 테스트는 여기서 끝나
      // 아무것도 못 잡는다. 잔액 하한은 COMMIT 시점의 지연 제약 트리거에서만 걸린다.
      await client.query('SELECT ledger.op_withdraw($1, $2, $3, $4, $5, $6, $7)', [
        uniq('wd'),
        ctx.staffId,
        token,
        ctx.device,
        ctx.branch,
        acct,
        9999,
      ]);
    },
    { staffId: ctx.staffId }
  );
  // member_deposit 을 특정한다 — house_cash 쪽이 대신 과대차감되는 회귀도
  // 같은 트리거·같은 메시지 접두사를 내므로 /insufficient balance/ 만으로는
  // 어느 계정이 걸렸는지 구분하지 못하고 통과해 버린다.
  assert.match(err.message, /insufficient balance: member_deposit/);
});
