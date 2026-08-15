// R-12-02 04 §4 지점 간 이체.
//   그 절의 표: house_cash[to] +branch_transfer_in / house_cash[from] −branch_transfer_out
//
// 계정 종류가 양쪽 다 house_cash 라서 (kind, sign, category) 삼중항으로만
// 구분된다 — 금액을 account_kind 로 키를 잡아 확인하면 같은 kind 의 두 번째
// 행이 조용히 덮여 하나만 확인한 것이 된다(harness-contract.md 의 known trap).
// entries.branch 가 갈리는 것도 함께 본다 — 그 절이 명시적으로 "받는 쪽 분개가
// 받는 지점 소속이어야 RLS 로 보인다" 라고 요구한다. 행위자를 양쪽 지점에
// 배정하는 이유이기도 하다: RLS 가 app.staff_id 의 지점 목록으로 분개를
// 거르므로, 한쪽만 배정하면 받는 쪽 분개가 안 보인다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { fundedAccount } from '../fixtures/members.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §4 지점 간 이체 분개 집합', async () => {
  await withActor({ branches: ['HANN', 'NUSTAR'] }, async (client, ctx) => {
    // 보내는 지점(ctx.branch === 'HANN') 금고에 현금을 만든다. house_cash 도
    // 하한이 걸려 있으므로 이체가 먹을 잔고가 미리 있어야 한다. 계좌 코드
    // 자체는 이 테스트에서 다시 쓰지 않는다 — house_cash 잔고만 필요하다.
    await fundedAccount(client, ctx, { amount: 100000 });

    const btToken = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.branch_transfer',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_branch_transfer($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('bt'),
      ctx.staffId,
      btToken,
      ctx.device,
      'HANN',
      'NUSTAR',
      20000,
    ]);

    // 삼중항·금액·branch 를 같은 entryRowsOf 결과에서 함께 본다 — 두 번 왕복하지
    // 않는다. 이 절은 두 house_cash 행이라 account_kind 로 키를 잡으면 하나가
    // 덮여 사라진다 — 대신 정렬된 전체 행 배열을 그대로 비교한다.
    const stored = await entryRowsOf(client, rows[0].result);
    assert.deepEqual(
      stored.map((r) => [r.account_kind, r.sign, r.category]),
      [
        ['house_cash', 1, 'branch_transfer_in'],
        ['house_cash', -1, 'branch_transfer_out'],
      ]
    );
    assert.deepEqual(
      stored.map((r) => r.amount_minor),
      [20000n, -20000n]
    );
    assert.deepEqual(
      stored.map((r) => r.branch),
      ['NUSTAR', 'HANN']
    );
  });
});
