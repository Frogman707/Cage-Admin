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
// 마지막 키 e.id 는 총순서를 보장한다 — (kind, category, sign) 이 같은 행이
// 둘 이상이면(같은 종류 계정에 금액이 다른 분개 두 건 등) 그 안에서는 순서가
// 안 정해져 entryRowsOf 의 amount_minor·branch 비교가 간헐적으로 실패할 수
// 있다. tx_response 도 자기 entries 배열을 e.id 로 정렬한다
// (009_operations_money.sql) — 그 관례를 따른다.
const ENTRY_SQL = `
  SELECT a.kind::text              AS account_kind,
         sign(e.amount_minor)::int AS sign,
         e.category::text          AS category,
         e.amount_minor,
         e.branch
    FROM ledger.entries e
    JOIN ledger.transactions t ON t.id = e.transaction_id
    LEFT JOIN ledger.accounts a ON a.id = e.account_id
   WHERE t.external_id = $1
   ORDER BY a.kind::text, e.category::text, sign(e.amount_minor), e.id`;

export async function entryRowsOf(client, opResult) {
  const externalId = opResult?.transaction?.external_id;
  if (!externalId) {
    throw new Error(`op 반환 JSON 에 transaction.external_id 가 없다: ${JSON.stringify(opResult)}`);
  }
  const { rows } = await client.query(ENTRY_SQL, [externalId]);
  if (rows.length === 0) {
    throw new Error(`거래 ${externalId} 의 분개가 저장되어 있지 않다 (또는 RLS 로 안 보인다)`);
  }
  // ledger.entries 와 ledger.accounts 는 RLS 정책이 다르다 — entries 는 branch
  // 로, accounts 는 party_visible(party_id) 로 거른다(012_roles_and_grants.sql).
  // 분개 행은 보이는데 그 계정이 안 보이는 경우가 있을 수 있다. INNER JOIN 이면
  // 그 행이 조용히 사라져 "저장이 덜 됐다"처럼 보인다 — 실제로는 계정 가시성
  // 문제다. LEFT JOIN 으로 붙이고 여기서 크게 실패시킨다.
  const invisible = rows.find((r) => r.account_kind == null);
  if (invisible) {
    throw new Error(
      `거래 ${externalId} 의 분개 중 계정이 안 보이는 행이 있다 (RLS 로 계정 가시성이 막혔을 가능성 — ` +
        `party_visible 확인) — branch=${invisible.branch}, category=${invisible.category}`
    );
  }
  return rows.map((r) => ({ ...r, amount_minor: BigInt(r.amount_minor) }));
}

// 04 의 절 표와 그대로 비교할 삼중항. 금액은 부호만 본다.
export async function entriesOf(client, opResult) {
  const rows = await entryRowsOf(client, opResult);
  return rows.map((r) => [r.account_kind, r.sign, r.category]);
}
