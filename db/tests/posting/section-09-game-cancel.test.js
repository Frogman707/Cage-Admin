// R-12-02 04 §9 게임 취소 — cage.op_cancel_game.
// 새 분개 조합을 만들지 않는다. 그 게임의 거래를 ledger.reverse_transaction 으로
// 역분개한다 — 원 분개의 부호를 뒤집은 것이 나와야 한다.
//
// op_cancel_game 의 반환 JSON 은 { transaction: { external_id } } 모양이 아니라
// reversed_transactions 배열의 external_id 문자열이다. entryRowsOf 가 기대하는
// 모양으로 감싸 그대로 재사용한다 — 별도 SQL 을 새로 짜지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/members.mjs';
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
