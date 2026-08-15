// 저장된 분개를 읽는다. op_* 반환 JSON 이 아니라 ledger.entries 를 본다 (R-12-02).
//
// ledger.entries 에 account_kind 컬럼은 없다. ledger.accounts.kind 를
// account_id 로 조인해 얻는다 — 반환 JSON 의 entries[].kind 로 대신하지 않는다.
// 그렇게 하면 tx_response 가 옳고 저장이 틀린 결함을 못 잡는다.
//
// 호출자의 커넥션을 그대로 쓴다. 앱 역할 커넥션이면 RLS 가 함께 걸린다.
//
// ORDER BY 는 a.kind::text, e.category::text 로 캐스트한다. a.kind 와
// e.category 는 PostgreSQL enum 컬럼이라 캐스트 없이 정렬하면 선언 순서
// (ordinal) 로 정렬된다 — SELECT 절의 ::text 캐스트는 별칭일 뿐 ORDER BY 에
// 묶이지 않는다. 04 절 표를 그대로 옮겨 적은 기대 배열은 알파벳 순이므로,
// 여기서도 텍스트로 캐스트해 알파벳 순 정렬을 맞춘다.
const ENTRY_SQL = `
  SELECT a.kind::text              AS account_kind,
         sign(e.amount_minor)::int AS sign,
         e.category::text          AS category,
         e.amount_minor,
         e.branch
    FROM ledger.entries e
    JOIN ledger.transactions t ON t.id = e.transaction_id
    JOIN ledger.accounts     a ON a.id = e.account_id
   WHERE t.external_id = $1
   ORDER BY a.kind::text, e.category::text, sign(e.amount_minor)`;

export async function entryRowsOf(client, opResult) {
  const externalId = opResult?.transaction?.external_id;
  if (!externalId) {
    throw new Error(`op 반환 JSON 에 transaction.external_id 가 없다: ${JSON.stringify(opResult)}`);
  }
  const { rows } = await client.query(ENTRY_SQL, [externalId]);
  if (rows.length === 0) {
    throw new Error(`거래 ${externalId} 의 분개가 저장되어 있지 않다 (또는 RLS 로 안 보인다)`);
  }
  return rows.map((r) => ({ ...r, amount_minor: BigInt(r.amount_minor) }));
}

// 04 의 절 표와 그대로 비교할 삼중항. 금액은 부호만 본다.
export async function entriesOf(client, opResult) {
  const rows = await entryRowsOf(client, opResult);
  return rows.map((r) => [r.account_kind, r.sign, r.category]);
}
