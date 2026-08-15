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
import { expectCommitFailure, uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/members.mjs';
import { createActor, withActor } from '../fixtures/scenario.mjs';
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
      // §5 가 발행한 600000(500000+100000) 에서 §7 이 회수한 150000 을 뺀
      // 값이어야 한다 — chipsOutstanding 이 DB 에서 읽어 온 값을 그대로
      // 되돌려 쓰는 것만으로는 §5·§7 자신의 금액 드리프트를 못 잡는다.
      assert.equal(chips, 450000n);
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

test('R-12-02 미회수 칩이 남으면 게임 종료가 COMMIT 에서 거부된다 (55000, 지연 제약)', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  // expectCommitFailure 는 트랜잭션을 직접 열어야 하므로 withActor(=asActor,
  // 콜백 종료 시 자동 COMMIT)는 못 쓰고 액터 생성만 여기서 가져온다
  // (section-02-withdraw.test.js 와 같은 이유). createMember 는 앱 역할
  // 권한 밖의 원시 INSERT 라 expectCommitFailure 의 앱 콜백 안에서는 못
  // 부른다 — createActor 의 setup 훅(소유자, 커밋 전)으로 옮긴다.
  const ctx = await createActor({
    branches: ['HANN'],
    roles: ['cage_manager'],
    setup: (client) => createMember(client, { code: member, branch: 'HANN' }),
  });

  const err = await expectCommitFailure(
    '55000',
    async (client) => {
      await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 0 });
      const token = await ctx.stepUp('game.settle');
      // 500000 을 발행했는데 1000 만 회수한다. 이 호출은 성공한다 — 그게
      // 요점이다. games_chips_settled 는 지연 제약 트리거라 COMMIT 에서만 걸린다
      // (005_games_rolling.sql:355, ERRCODE object_not_in_prerequisite_state = 55000).
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
    },
    { staffId: ctx.staffId }
  );
  assert.match(err.message, /cannot close: chips_outstanding balance is/);
});
