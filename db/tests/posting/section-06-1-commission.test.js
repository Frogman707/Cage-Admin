// R-12-02 04 §6-1 롤링 커미션 정산 — cage.op_settle_commission.
//   commission_expense +commission_payout / member_deposit −commission_payout
//
// 요율의 권위는 cage.games.commission_rate_bp 스냅샷이다 (DR-66 · DR-84 · DR-85).
// 그 값을 채우는 op_* 가 아직 없어 픽스처가 직접 세운다.
//
// **이 테스트만 앱 트랜잭션을 둘로 나눈다.** setCommissionRate 는 소유자 커넥션이고,
// 소유자는 아직 커밋되지 않은 cage.games 행을 보지 못한다. op_open_game 을 먼저
// 커밋해야 UPDATE 가 1행을 친다 — createActor + asActor 2회가 그 경계다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/members.mjs';
import { createActor, asActor, withActor } from '../fixtures/scenario.mjs';
import { openGame, setCommissionRate } from '../fixtures/games.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §6-1 롤링 커미션 분개 집합', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  const rollingBase = 300000;
  const rateBp = 150; // 1.5%
  const expected = Math.round((rollingBase * rateBp) / 10000);

  const ctx = await createActor({
    setup: (client) => createMember(client, { code: member, branch: 'HANN' }),
  });

  // 1단계: 게임 개설을 커밋한다. 여기까지 앱 역할 트랜잭션 하나.
  await asActor(ctx, (client) => openGame(client, ctx, { gameNo, member }));

  // 2단계: 커밋된 행에 요율을 세운다 (소유자). rowCount 1 을 픽스처가 단언한다.
  await setCommissionRate(gameNo, rateBp);

  // 3단계: 새 앱 역할 트랜잭션에서 정산한다. 스텝업 토큰은 여기서 새로 발급된다.
  await asActor(ctx, async (client) => {
    const token = await ctx.stepUp('game.commission');
    const { rows } = await client.query('SELECT cage.op_settle_commission($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('comm'),
      ctx.staffId,
      token,
      ctx.device,
      gameNo,
      rollingBase,
      expected,
    ]);
    const result = rows[0].result;

    // p_commission_minor 로 우리가 계산한 expected 를 그대로 밀어 넣으므로,
    // 아래 entryRowsOf 분개 단언만으로는 서버가 commission_rate_bp 를 실제로 적용해
    // 금액을 계산하는지 증명하지 못한다 — 서버가 요율을 무시하고 엉뚱한 값을
    // 냈어도 우리가 건넨 값이 그대로 찍혀 통과해 버린다. op_settle_commission
    // 은 v_g.commission_rate_bp 로 독립적으로 계산한 v_expected 를
    // result.expected_minor 로 되돌려준다(010_operations_game.sql:790,844) —
    // 그 값이 우리 JS 계산과 일치해야 요율이 실제로 적용됐다고 말할 수 있다.
    assert.equal(result.expected_minor, expected);

    // op_settle_commission 의 반환 JSON 은 다른 게임 연산과 달리 tx_response 를
    // 최상위로 병합하지 않고 result.transaction 아래에 그대로 얹는다 — 그래서
    // external_id 는 result.transaction.transaction.external_id 에 있다
    // (실측으로 확인했다; op_open_game 등은 result.transaction.external_id 다).
    //
    // 삼중항과 금액을 같은 entryRowsOf 결과에서 함께 본다(harness-contract.md 의
    // 금액 단언 룰링) — account_kind 로 키를 잡는 Object.fromEntries 는 쓰지 않는다.
    const stored = await entryRowsOf(client, result.transaction);
    assert.deepEqual(
      stored.map((r) => [r.account_kind, r.sign, r.category]),
      [
        ['commission_expense', 1, 'commission_payout'],
        ['member_deposit', -1, 'commission_payout'],
      ]
    );
    assert.deepEqual(
      stored.map((r) => r.amount_minor),
      [BigInt(expected), -BigInt(expected)]
    );
  });
});

test('R-12-02 요율 스냅샷이 없으면 커미션 정산이 거부된다', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  // 여기는 나눌 필요가 없다 — 소유자 픽스처가 중간에 끼지 않으므로 같은
  // 트랜잭션이 자기가 만든 게임 행을 본다. 거부로 트랜잭션이 abort 되고
  // withActor 의 COMMIT 은 롤백으로 처리된다 — 남길 행이 없으니 그래도 된다.
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member });
      // setCommissionRate 를 부르지 않는다.
      const token = await ctx.stepUp('game.commission');
      await assert.rejects(
        () =>
          client.query('SELECT cage.op_settle_commission($1, $2, $3, $4, $5, $6, $7)', [
            uniq('comm'),
            ctx.staffId,
            token,
            ctx.device,
            gameNo,
            300000,
            4500,
          ]),
        /has no commission rate snapshot/
      );
    }
  );
});
