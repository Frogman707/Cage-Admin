// 게임 수명주기 픽스처.
//
// commission_rate_bp 를 직접 UPDATE 한다. 이 값을 채우는 op_* 가 아직 없기 때문이다
// (op_open_game 인자에 없다). 우회가 아니라 스키마 공백의 기록이다 —
// 요율 입력 경로가 생기면 이 UPDATE 를 그 op_* 호출로 바꾼다.
import { asOwner, uniq } from '../helpers/db.mjs';

export async function openGame(client, ctx, { gameNo, member, buyin = 500000, workingChip = 100000 }) {
  const token = await ctx.stepUp('game.open');
  const { rows } = await client.query(
    `SELECT cage.op_open_game($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) AS result`,
    [
      uniq('open-game'),
      ctx.staffId,
      token,
      ctx.device,
      ctx.branch,
      gameNo,
      member,
      'T-01',
      'baccarat',
      'cash',
      'live',
      buyin,
      workingChip,
    ]
  );
  return rows[0].result;
}

// 게임의 미회수 칩 잔액. op_settle_game('final') 전에 이만큼 회수해야 한다.
export async function chipsOutstanding(client, gameNo) {
  const { rows } = await client.query(
    `SELECT -b.balance_minor AS chips
       FROM cage.games g
       JOIN ledger.account_balances b ON b.account_id = g.chips_account_id
      WHERE g.game_no = $1`,
    [gameNo]
  );
  if (rows.length !== 1) {
    throw new Error(
      `chipsOutstanding(${gameNo}) found ${rows.length} rows — ` +
        '게임을 찾을 수 없거나 RLS 로 그 계정 잔액이 안 보인다'
    );
  }
  return BigInt(rows[0].chips);
}

// 요율 스냅샷을 세운다. 소유자 커넥션이 필요하다 (cage.games 는 앱 역할 UPDATE 불가).
//
// **op_open_game 트랜잭션이 커밋된 뒤에 불러야 한다.** 소유자 커넥션은 별도
// 트랜잭션이라 아직 커밋되지 않은 cage.games 행을 보지 못한다 — 그 상태로 부르면
// UPDATE 가 0행을 치고 조용히 통과한 뒤, 이어지는 op_settle_commission 이
// `game G has no commission rate snapshot` 으로 거부된다. rowCount 를 단언해
// 그 실수가 여기서 바로 터지게 한다.
export async function setCommissionRate(gameNo, rateBp) {
  const result = await asOwner((client) =>
    client.query('UPDATE cage.games SET commission_rate_bp = $2 WHERE game_no = $1', [gameNo, rateBp])
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `setCommissionRate(${gameNo}) updated ${result.rowCount} rows — ` +
        '게임 행이 아직 커밋되지 않았다. op_open_game 을 별도 asActor 트랜잭션으로 먼저 커밋한다.'
    );
  }
  return result;
}
