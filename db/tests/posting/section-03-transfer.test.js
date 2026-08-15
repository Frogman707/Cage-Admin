// R-12-02 04 §3 계좌 간 이체 + R-12-21 통화 시드.
// op_transfer 는 pin 스텝업을 거부한다 — totp 를 쓴다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openAccount, fundedAccount } from '../fixtures/members.mjs';
import { entriesOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §3 계좌 간 이체 분개 집합', async () => {
  await withActor({}, async (client, ctx) => {
    const from = await fundedAccount(client, ctx, { amount: 100000 });
    const to = await openAccount(client, ctx);

    const transferToken = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.transfer',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_transfer($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
      uniq('xfer'),
      ctx.staffId,
      transferToken,
      ctx.device,
      ctx.branch,
      from,
      to,
      30000,
    ]);

    assert.deepEqual(await entriesOf(client, rows[0].result), [
      ['member_deposit', -1, 'transfer_in'],
      ['member_deposit', 1, 'transfer_out'],
    ]);
  });
});

test('R-12-02 op_transfer 가 pin 스텝업을 거부한다', async () => {
  await withActor({}, async (client, ctx) => {
    const from = await openAccount(client, ctx);
    const to = await openAccount(client, ctx);

    const pinToken = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.transfer',
      method: 'pin',
    });
    await assert.rejects(
      () =>
        client.query('SELECT ledger.op_transfer($1, $2, $3, $4, $5, $6, $7, $8)', [
          uniq('xfer'),
          ctx.staffId,
          pinToken,
          ctx.device,
          ctx.branch,
          from,
          to,
          1000,
        ]),
      /requires step-up auth, got pin/
    );
  });
});

test('R-12-21 통화 5종이 시드되어 있고 KRW 는 scale = 0 이다', async () => {
  const rows = await query('SELECT code, scale FROM ledger.currencies ORDER BY code');
  assert.deepEqual(
    rows.map((r) => r.code),
    ['CNY', 'HKD', 'KRW', 'PHP', 'USD']
  );
  assert.equal(rows.find((r) => r.code === 'KRW').scale, 0);
});
