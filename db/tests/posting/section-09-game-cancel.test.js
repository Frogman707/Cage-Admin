// R-12-02 04 §9 게임 취소 — cage.op_cancel_game · ledger.op_reverse_transaction.
// 새 분개 조합을 만들지 않는다. 그 게임의 거래를 ledger.reverse_transaction 으로
// 역분개한다 — 원 분개의 부호를 뒤집은 것이 나와야 한다.
//
// op_cancel_game 의 반환 JSON 은 { transaction: { external_id } } 모양이 아니라
// reversed_transactions 배열의 external_id 문자열이다. entryRowsOf 가 기대하는
// 모양으로 감싸 그대로 재사용한다 — 별도 SQL 을 새로 짜지 않는다.
//
// 두 번째 테스트는 op_cancel_game 이 아니라 ledger.op_reverse_transaction 자체를
// 부른다. §9 는 게임 취소 전용 절이 아니라 "역분개" 절이고
// (011_operations_admin.sql:508, design-review-4.md DR-50), op_reverse_transaction
// 은 그 유일한 범용 진입점이다 — 입금이든 출금이든 이체든 어떤 거래도 이 경로로만
// 정정된다. 금액과 무관하게 4-eyes 가 무조건 필수다(임계 검사를 거치지 않는다).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, asStaff, uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from '../fixtures/actors.mjs';
import { createMember } from '../fixtures/members.mjs';
import { approve } from '../fixtures/approvals.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openGame } from '../fixtures/games.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §9 게임 취소가 개설 분개를 역분개한다', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      const opened = await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 0 });

      const original = await entryRowsOf(client, opened);
      assert.deepEqual(
        original.map((r) => [r.account_kind, r.sign, r.category]),
        [
          ['chips_outstanding', -1, 'chips_issue'],
          ['house_cash', 1, 'buyin_cash'],
        ]
      );
      assert.deepEqual(
        original.map((r) => r.amount_minor),
        [-500000n, 500000n]
      );

      const token = await ctx.stepUp('game.cancel');
      const { rows } = await client.query('SELECT cage.op_cancel_game($1, $2, $3, $4, $5) AS result', [
        uniq('cancel'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
      ]);
      const result = rows[0].result;

      assert.equal(result.reversed_count, 1, '개설 거래 하나가 역분개되어야 한다');

      // 역분개 거래의 분개는 원 분개의 부호를 뒤집은 것이다 — kind · category ·
      // 행 순서는 그대로다(두 행이 kind 로 이미 구분되므로 부호 반전이 정렬을
      // 바꾸지 않는다).
      const reversedId = result.reversed_transactions[0];
      const reversed = await entryRowsOf(client, { transaction: { external_id: reversedId } });
      assert.deepEqual(
        reversed.map((r) => [r.account_kind, r.sign, r.category]),
        original.map((r) => [r.account_kind, -r.sign, r.category])
      );
      assert.deepEqual(
        reversed.map((r) => r.amount_minor),
        original.map((r) => -r.amount_minor)
      );

      const { rows: st } = await client.query('SELECT status FROM cage.games WHERE game_no = $1', [gameNo]);
      assert.equal(st[0].status, 'cancelled');
    }
  );
});

test('R-12-02 04 §9 ledger.op_reverse_transaction 이 임의 거래의 분개를 부호만 반전해 역분개한다', async () => {
  // op_cancel_game 은 게임의 칩 계정을 건드린 거래만 되돌린다. 이 테스트는 그
  // 특수 경로가 아니라 범용 진입점 자체를 직접 부른다 — 입금을 역분개해 본다.
  const device = uniq('dev');
  const { actor, approverA, approverB } = await asOwner(async (client) => {
    const make = () =>
      createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] });
    return { actor: await make(), approverA: await make(), approverB: await make() };
  });

  // ---- 원 거래: 입금. 역분개는 거래 종류를 가리지 않는 범용 경로라 아무 posting
  // 거래로나 재현할 수 있다 ----
  const acct = uniqCode('TEST-ACC');
  let originalExtId;
  let original;
  await asStaff(actor, async (client) => {
    await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
      uniq('open'),
      actor,
      'HANN',
      acct,
      'TEST ACCOUNT',
    ]);
    const depToken = await issueStepUp({ staffId: actor, deviceId: device, scope: 'ledger.deposit', method: 'totp' });
    const { rows } = await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('dep'),
      actor,
      depToken,
      device,
      'HANN',
      acct,
      100000,
    ]);
    const result = rows[0].result;
    originalExtId = result.transaction.external_id;
    original = await entryRowsOf(client, result);
  });

  assert.deepEqual(
    original.map((r) => [r.account_kind, r.sign, r.category]),
    [
      ['house_cash', 1, 'deposit_cash'],
      ['member_deposit', -1, 'deposit_cash'],
    ]
  );
  assert.deepEqual(original.map((r) => r.amount_minor), [100000n, -100000n]);

  // ---- 4-eyes 승인. payload 는 op_reverse_transaction 내부의 v_args 와 정확히
  // 같아야 한다(jsonb_build_object('original_external_id', p_original_ext_id)) ----
  const approvalId = await asOwner((client) =>
    approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: 'HANN',
      subjectKind: 'reversal',
      subjectRef: uniq('rev'),
      payload: { original_external_id: originalExtId },
      deviceId: device,
    })
  );

  // ---- 역분개. 금액과 무관하게 항상 4-eyes 를 요구한다 ----
  await asStaff(actor, async (client) => {
    const revToken = await issueStepUp({ staffId: actor, deviceId: device, scope: 'ledger.reverse', method: 'totp' });
    const { rows } = await client.query('SELECT ledger.op_reverse_transaction($1, $2, $3, $4, $5, $6) AS result', [
      uniq('rev'),
      actor,
      revToken,
      device,
      originalExtId,
      approvalId,
    ]);

    const reversed = await entryRowsOf(client, rows[0].result);
    // §9 표: (원 분개 전부) 부호 반전, 금액 동일, category 그대로.
    assert.deepEqual(
      reversed.map((r) => [r.account_kind, r.sign, r.category]),
      original.map((r) => [r.account_kind, -r.sign, r.category])
    );
    assert.deepEqual(
      reversed.map((r) => r.amount_minor),
      original.map((r) => -r.amount_minor)
    );
  });
});
