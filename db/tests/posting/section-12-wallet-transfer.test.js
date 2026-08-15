// R-12-02 04 §12 케이지 계좌 ↔ 회원 보유금.
//   그 절의 표(to_wallet): member_deposit +wallet_transfer_out / player_wallet −wallet_transfer_in
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { createMember, fundedAccount } from '../fixtures/members.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §12 케이지 계좌 → 회원 보유금', async () => {
  const member = uniqCode('TEST-MEM');
  await withActor(
    {
      // player_wallet 계정을 만드는 op_* 가 없다. setup 훅(커밋 전, 소유자 레인)에서 만든다.
      setup: (client) => createMember(client, { code: member, branch: 'HANN', kinds: ['player_wallet'] }),
    },
    async (client, ctx) => {
      // 케이지 계좌(member_deposit) 쪽 잔고. op_open_account + step-up + op_deposit 은
      // fundedAccount 로 묶는다 — 이 테스트에서는 전제조건일 뿐이다.
      const acct = await fundedAccount(client, ctx, { amount: 50000 });

      const wtToken = await issueStepUp({
        staffId: ctx.staffId,
        deviceId: ctx.device,
        scope: 'ledger.wallet_transfer',
        method: 'totp',
      });
      const { rows } = await client.query(
        'SELECT ledger.op_wallet_transfer($1, $2, $3, $4, $5, $6, $7, $8, $9) AS result',
        [uniq('wt'), ctx.staffId, wtToken, ctx.device, ctx.branch, acct, member, 10000, true]
      );

      // 삼중항·금액을 같은 entryRowsOf 결과에서 함께 본다 — 두 번 왕복하지 않는다.
      const stored = await entryRowsOf(client, rows[0].result);
      assert.deepEqual(
        stored.map((r) => [r.account_kind, r.sign, r.category]),
        [
          ['member_deposit', 1, 'wallet_transfer_out'],
          ['player_wallet', -1, 'wallet_transfer_in'],
        ]
      );
      assert.deepEqual(
        stored.map((r) => r.amount_minor),
        [10000n, -10000n]
      );
    }
  );
});
