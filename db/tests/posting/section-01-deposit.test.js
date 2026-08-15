// R-12-02 · AC-12-2 — 04-posting-rules.md §1 입금.
// 그 절의 표: house_cash +deposit_cash / member_deposit −deposit_cash
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entriesOf, entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §1 입금 분개 집합', async () => {
  await withActor({ branches: ['HANN'], roles: ['cage_manager'] }, async (client, ctx) => {
    // parties_code_format (003_accounts.sql) 은 대문자만 허용한다. op_open_account
    // 는 정규화하지 않으므로 (createStaff/createMember 와 달리 이 함수는 앱
    // 레이어가 아니다) 계좌 코드는 uniqCode() 로 만든다 — db.mjs 참고.
    const acct = uniqCode('TEST-ACC');
    await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
      uniq('open'),
      ctx.staffId,
      ctx.branch,
      acct,
      'TEST ACCOUNT',
    ]);
    const tokenId = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('dep'),
      ctx.staffId,
      tokenId,
      ctx.device,
      ctx.branch,
      acct,
      100000,
    ]);
    const result = rows[0].result;

    assert.deepEqual(await entriesOf(client, result), [
      ['house_cash', 1, 'deposit_cash'],
      ['member_deposit', -1, 'deposit_cash'],
    ]);

    // 금액도 본다. 부호만 맞고 금액이 어긋나는 회귀는 삼중항으로 안 잡힌다.
    const byKind = Object.fromEntries((await entryRowsOf(client, result)).map((r) => [r.account_kind, r.amount_minor]));
    assert.equal(byKind.house_cash, 100000n);
    assert.equal(byKind.member_deposit, -100000n);
  });
});
