// R-12-02 · AC-12-2 — 04-posting-rules.md §1 입금.
// 그 절의 표: house_cash +deposit_cash / member_deposit −deposit_cash
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

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

    // 삼중항(종류·부호·범주)과 금액을 같은 entryRowsOf 결과에서 함께 본다 — 두 번
    // 왕복하지 않는다. 부호만 맞고 금액이 어긋나는 회귀는 삼중항으로 안 잡힌다.
    //
    // account_kind 로 키를 잡은 Object.fromEntries 는 쓰지 않는다. §1 은 kind 가
    // 둘 다 달라서 당장은 맞지만, 같은 kind 가 둘인 절(§4 지점 간 이체의 house_cash
    // 두 행)에서는 한 행이 조용히 덮여 "둘 다 확인한 것처럼 보이면서 하나만"
    // 확인하게 된다 (harness-contract.md known trap). 이 파일이 하니스에서 가장
    // 먼저 읽히는 파일이라, 형제 절들과 같은 모양으로 맞춘다.
    const stored = await entryRowsOf(client, result);
    assert.deepEqual(
      stored.map((r) => [r.account_kind, r.sign, r.category]),
      [
        ['house_cash', 1, 'deposit_cash'],
        ['member_deposit', -1, 'deposit_cash'],
      ]
    );
    assert.deepEqual(
      stored.map((r) => r.amount_minor),
      [100000n, -100000n]
    );
  });
});
