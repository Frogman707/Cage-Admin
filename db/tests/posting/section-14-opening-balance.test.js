// R-12-02 04 §14 기초 잔액 개시.
//   그 절의 표: (대상 계정) 잔액 방향 / opening_equity 반대 방향, 둘 다 opening_balance
//
// 두 겹의 경계가 있다:
//   1. DB 권한 — 함수의 EXECUTE 는 ledger_migrator 에만 있다 (ledger_app 에는 없다)
//   2. identity 권한 — ledger.opening_balance 는 identity 역할 migrator 에만 있다
// op_load_opening_balance 는 스텝업 토큰을 받지 않는다 — 인자에 p_step_up_id 가 없다.
//
// p_balances 는 이미 정해진 account_id 를 받는다(함수 주석의 예시가 그렇다:
// [{"account_id": 12, ...}]) — 텍스트 코드를 넘기지 않는다. 그래서 house_cash
// 계정 id 는 소유자 커넥션(RLS 를 우회한다)에서 미리 구해 정수로 넘긴다.
// ledger.parties/ledger.accounts 의 RLS 정책(app_scope)은 ledger_app 에만 걸려
// 있고 ledger_migrator 에는 정책이 없다 — 실행 시점에 migrator 커넥션이
// ledger.account_id_of() 같은 SECURITY INVOKER 함수로 같은 조회를 하면 GRANT
// SELECT 가 있어도 RLS 가 행을 전부 가려 "account not found" 로 거부된다
// (012_roles_and_grants.sql:441-491). 실행해서 확인한 사실이다.
//
// 같은 이유로 저장된 분개도 migrator 커넥션으로는 못 읽는다 — ledger_migrator 는
// ledger.entries · ledger.transactions 에 SELECT GRANT 자체가 없다
// (012_roles_and_grants.sql:291, ledger_app 전용 SELECT 목록에만 있다). 이관
// 역할은 한 번 쓰고 끝나는 적재 전용이라 자기 결과를 되읽는 경로가 애초에 없다 —
// RLS 가 걸러서가 아니라 GRANT 가 없어서다. 그래서 검증은 ownerPool 로 한다.
// withActor 콜백 안에서 바로 하면 아직 커밋 전이라(runIn 이 콜백 뒤에 COMMIT 한다)
// 다른 커넥션(ownerPool)에는 안 보인다 — 콜백이 op 반환 JSON 을 돌려주게 하고,
// withActor 가 끝나 커밋된 뒤에 읽는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, ownerPool, uniq, closePool, expectSqlState } from '../helpers/db.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

const OPENING_SQL = `
  SELECT ledger.op_load_opening_balance($1, $2, $3, $4,
           jsonb_build_array(jsonb_build_object(
             'account_id',   $5::bigint,
             'amount_minor', $6::bigint))) AS result`;

async function houseCashAccountId(branch) {
  const rows = await query(`SELECT ledger.account_id_of('MAIN-' || $1, 'house_cash', 'PHP') AS id`, [branch]);
  return Number(rows[0].id);
}

test('R-12-02 · AC-12-2 04 §14 기초 잔액이 opening_equity 로 균형을 맞춘다', async () => {
  const acctId = await houseCashAccountId('ONLINE');
  const result = await withActor({ branches: ['ONLINE'], roles: ['migrator'], as: 'migrator' }, async (client, ctx) => {
    const { rows } = await client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, acctId, 777000]);
    return rows[0].result;
  });

  // migrator 커넥션에는 ledger.entries/transactions 의 SELECT GRANT 자체가 없다 —
  // 커밋된 뒤 ownerPool 로 읽는다(파일 상단 설명 참고). 삼중항·금액을 같은
  // entryRowsOf 결과에서 함께 본다 — 두 번 왕복하지 않는다.
  const stored = await entryRowsOf(ownerPool, result);
  assert.deepEqual(
    stored.map((r) => [r.account_kind, r.sign, r.category]),
    [
      ['house_cash', 1, 'opening_balance'],
      ['opening_equity', -1, 'opening_balance'],
    ]
  );
  assert.deepEqual(
    stored.map((r) => r.amount_minor),
    [777000n, -777000n]
  );
});

test('R-12-02 ledger_app 은 op_load_opening_balance 를 실행할 수 없다', async () => {
  const acctId = await houseCashAccountId('ONLINE');
  // 앱 역할로 붙는다. identity 권한이 아니라 DB 의 EXECUTE 권한에서 막혀야 한다.
  // SQLSTATE 42501 (insufficient_privilege) 은 두 경계(DB GRANT · identity 권한)
  // 모두 이 코드로 떨어지므로, 메시지까지 함께 고정해 어느 경계인지 못 박는다.
  await withActor({ branches: ['ONLINE'], roles: ['migrator'] }, async (client, ctx) => {
    const err = await expectSqlState('42501', () =>
      client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, acctId, 1000])
    );
    assert.match(err.message, /permission denied for function op_load_opening_balance/);
  });
});

test('R-12-02 migrator 가 아닌 직원은 기초 잔액을 세울 수 없다', async () => {
  const acctId = await houseCashAccountId('ONLINE');
  // migrator 커넥션이 EXECUTE 는 가지고 있다 — assert_actor_authorized 안쪽,
  // identity 권한(role_permissions)에서 막혀야 한다. SQLSTATE 는 위 테스트와
  // 같은 42501 이라 메시지로만 경계가 갈린다.
  await withActor({ branches: ['ONLINE'], roles: ['cage_manager'], as: 'migrator' }, async (client, ctx) => {
    const err = await expectSqlState('42501', () =>
      client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, acctId, 1000])
    );
    assert.match(err.message, /lacks permission ledger\.opening_balance/);
  });
});
