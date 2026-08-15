// R-12-02 04 §7 중간정산 + §8 게임 종료 — cage.op_settle_game.
// p_kind 가 'mid' 면 tx_kind = mid_settle, 'final' 이면 game_end 다.
//
// 한 파일인 이유: §8 은 게임의 chips_outstanding 이 0 이어야 통과한다.
// §7 이 얼마를 회수했는지 알아야 §8 의 회수액이 정해진다.
//
// game_no · member 코드는 uniqCode() 로 만든다 (games_no_format ·
// parties_code_format 이 둘 다 대문자 전용이다).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/members.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openGame, chipsOutstanding } from '../fixtures/games.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §7 중간정산 → §8 게임 종료', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 100000 });

      // ---- §7 중간정산 ----
      const midToken = await ctx.stepUp('game.settle');
      const mid = await client.query('SELECT cage.op_settle_game($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
        uniq('mid'),
        ctx.staffId,
        midToken,
        ctx.device,
        gameNo,
        'mid',
        100000,
        50000,
      ]);

      const midStored = await entryRowsOf(client, mid.rows[0].result);
      assert.deepEqual(
        midStored.map((r) => [r.account_kind, r.sign, r.category]),
        [
          ['chips_outstanding', 1, 'chips_redeem'],
          ['house_cash', -1, 'settle_cashout'],
          ['member_deposit', -1, 'settle_deposit'],
        ]
      );
      assert.deepEqual(
        midStored.map((r) => r.amount_minor),
        [150000n, -50000n, -100000n]
      );

      // ---- §8 게임 종료 ----
      // 미회수 칩을 정확히 회수해야 한다. 남으면 games_chips_settled 지연 제약이
      // COMMIT 에서 game G cannot close: chips_outstanding balance is N 으로 거부한다.
      const chips = await chipsOutstanding(client, gameNo);
      const endToken = await ctx.stepUp('game.settle');
      const end = await client.query('SELECT cage.op_settle_game($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
        uniq('end'),
        ctx.staffId,
        endToken,
        ctx.device,
        gameNo,
        'final',
        0,
        Number(chips),
      ]);

      const endStored = await entryRowsOf(client, end.rows[0].result);
      assert.deepEqual(
        endStored.map((r) => [r.account_kind, r.sign, r.category]),
        [
          ['chips_outstanding', 1, 'chips_redeem'],
          ['house_cash', -1, 'settle_cashout'],
        ]
      );
      assert.deepEqual(
        endStored.map((r) => r.amount_minor),
        [chips, -chips]
      );

      const { rows: st } = await client.query('SELECT status FROM cage.games WHERE game_no = $1', [gameNo]);
      assert.equal(st[0].status, 'ended');
    }
  );
});

test('R-12-02 미회수 칩이 남으면 게임 종료가 COMMIT 에서 거부된다', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  await assert.rejects(
    () =>
      withActor({ setup: (client) => createMember(client, { code: member, branch: 'HANN' }) }, async (client, ctx) => {
        await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 0 });
        const token = await ctx.stepUp('game.settle');
        // 500000 을 발행했는데 1000 만 회수한다.
        await client.query('SELECT cage.op_settle_game($1, $2, $3, $4, $5, $6, $7, $8)', [
          uniq('end'),
          ctx.staffId,
          token,
          ctx.device,
          gameNo,
          'final',
          0,
          1000,
        ]);
        // 여기서는 아직 안 터진다. withActor 의 COMMIT 에서 터진다.
      }),
    /cannot close: chips_outstanding balance is/
  );
});
