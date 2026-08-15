// 회원 주체와 계정을 만드는 op_* 가 없다. §12 wallet_transfer 는 player_wallet 을,
// §5 game_buyin 은 member_deposit 을 전제하므로 픽스처가 직접 만든다.
//
// normal_balance 는 'credit' 이어야 한다 — accounts 의 kind ↔ normal_balance
// 조합 검사 트리거(003)가 어긋난 조합을 거부한다.
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
