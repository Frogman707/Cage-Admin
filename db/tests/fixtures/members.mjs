// 회원 주체와 계정을 만드는 op_* 가 없다. §12 wallet_transfer 는 player_wallet 을,
// §5 game_buyin 은 member_deposit 을 전제하므로 픽스처가 직접 만든다.
//
// normal_balance 는 'credit' 이어야 한다 — accounts 의 kind ↔ normal_balance
// 조합 검사 트리거(003)가 어긋난 조합을 거부한다.
import { uniq, uniqCode } from '../helpers/db.mjs';
import { issueStepUp } from './actors.mjs';

export async function createMember(client, { code, branch, currency = 'PHP', kinds = ['member_deposit'] }) {
  // ledger.parties.code 도 대문자만 허용한다 (parties_code_format 체크 제약, 003).
  // 정규화(대문자화 · 32자 상한)는 호출부 책임이다 — db.mjs 의 uniqCode() 를
  // 쓴다. 여기서 다시 하지 않는 이유는 createStaff 참고.
  const { rows } = await client.query(
    `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
     VALUES ($1, 'member', $2, $3)
     RETURNING id`,
    [code, `TEST ${code}`, branch]
  );
  // BIGINT → pg 는 문자열로 돌려준다(setTypeParser 미등록). 브리프의
  // Promise<number> 를 지키려면 여기서 변환한다 — createStaff 참고.
  const partyId = Number(rows[0].id);

  for (const kind of kinds) {
    await client.query(
      `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance)
       VALUES ($1, $2, $3, 'credit')`,
      [partyId, kind, currency]
    );
  }
  return partyId;
}

// 자금 이동이 검증 대상이 아니라 전제조건일 뿐인 테스트(§3 이체 등)용 계좌 개설.
// op_open_account 는 코드를 정규화하지 않으므로 uniqCode() 로 만든다 — db.mjs 참고.
// asActor/withActor 콜백 안(커밋 후 레인)에서만 부른다 — createActor 의 setup 훅은
// 커밋 전에 돌아 op_* 를 못 쓴다(scenario.mjs 참고).
export async function openAccount(client, ctx, { currency = 'PHP' } = {}) {
  const code = uniqCode('TEST-ACC');
  await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5, $6, $7)', [
    uniq('open'),
    ctx.staffId,
    ctx.branch,
    code,
    `TEST ACCOUNT ${code}`,
    '{}',
    currency,
  ]);
  return code;
}

// openAccount + 스텝업 토큰 + op_deposit. 이미 잔고가 있는 계좌가 전제조건인
// 테스트용이다. 오류를 삼키지 않는다 — 입금이 실패하면 그 오류가 호출부까지
// 그대로 올라간다.
export async function fundedAccount(client, ctx, { amount, currency = 'PHP' }) {
  const code = await openAccount(client, ctx, { currency });
  const token = await issueStepUp({
    staffId: ctx.staffId,
    deviceId: ctx.device,
    scope: 'ledger.deposit',
    method: 'totp',
  });
  await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7, $8)', [
    uniq('dep'),
    ctx.staffId,
    token,
    ctx.device,
    ctx.branch,
    code,
    amount,
    currency,
  ]);
  return code;
}
