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
// 저장된 분개는 migrator 커넥션으로 되읽지 않는다 — ledger_migrator 는
// ledger.entries · ledger.transactions 에 SELECT GRANT 자체가 없다
// (012_roles_and_grants.sql:291). 이관 역할은 한 번 쓰고 끝나는 적재 전용이라
// 자기 결과를 되읽는 경로가 애초에 없다 — RLS 가 걸러서가 아니라 GRANT 가
// 없어서다. 그렇다고 소유자로 읽지 않는다 — 소유자는 모든 테이블 권한과 RLS 를
// 통째로 우회하므로 "분개가 저장돼 있다"만 증명하고 "app 역할이 자기 지점
// 분개를 볼 수 있다"는 증명하지 못한다(binding constraint: 앱 역할로도 읽는다).
// ledger_app 은 ledger.transactions/entries/accounts/parties 전부 SELECT 를
// 가지고 있고(012_roles_and_grants.sql:136-137, migrator 의 291 과는 다른
// 범위다), RLS 는 branch = ANY(current_branches()) 다(012:399-412). §14 의 두
// 분개는 모두 branch='ONLINE' 으로 찍힌다 — house_cash 쪽은 MAIN-ONLINE 이
// party_type='house' 라 home_branch 로, opening_equity 쪽은 OPENING-EQUITY 가
// party_type='internal' 이라 거래 지점(p_branch='ONLINE')으로 떨어진다
// (008_post_transaction.sql:462-463, 003_accounts.sql:324-325). 그래서 migrator
// 트랜잭션이 커밋된 뒤, ONLINE 에 배정된 별도의 app 역할 액터로 다시 읽는다 —
// migrator 가 쓴 거래가 app 역할에도 보인다는 것 자체가 이 절이 증명해야 할
// 경계다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, uniq, closePool, expectSqlState } from '../helpers/db.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

// 계정 조회(houseCashAccountId)와 액터 지점 배정 양쪽에 쓴다 — 둘이 갈리면
// 개시 잔액이 액터가 못 보는 지점의 house_cash 에 실려도 app 역할 읽기가 그
// 불일치를 잡아낸다(같은 값을 한 곳에서만 관리해야 그 실패가 의미 있다).
const BRANCH = 'ONLINE';

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
  const acctId = await houseCashAccountId(BRANCH);
  const result = await withActor({ branches: [BRANCH], roles: ['migrator'], as: 'migrator' }, async (client, ctx) => {
    const { rows } = await client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, acctId, 777000]);
    return rows[0].result;
  });

  // migrator 트랜잭션은 이미 커밋됐다. 별도의 app 역할 액터(ONLINE 배정)로
  // 다시 붙어 RLS 를 통과해 읽는다 — 삼중항·금액을 같은 entryRowsOf 결과에서
  // 함께 본다(두 번 왕복하지 않는다).
  const stored = await withActor({ branches: [BRANCH] }, (client) => entryRowsOf(client, result));
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
  // 위 헤더가 길게 따진 결론 — 두 분개가 서로 다른 경로로 같은 branch 에 떨어진다는
  // 것 — 을 실제로 단언한다. house_cash 쪽은 MAIN-ONLINE 의 home_branch 로,
  // opening_equity 쪽은 거래 지점(p_branch)으로 정해지는데, 그 둘이 갈리면 app 역할
  // 액터에게 한 행만 보이고 entryRowsOf 가 "분개가 저장되어 있지 않다" 가 아니라
  // 한 행짜리 배열을 돌려준다 — 위 두 단언은 그 모양을 길이 차이로만 잡는다.
  assert.deepEqual(
    stored.map((r) => r.branch),
    [BRANCH, BRANCH]
  );
});

test('R-12-02 ledger_app 은 op_load_opening_balance 를 실행할 수 없다', async () => {
  const acctId = await houseCashAccountId(BRANCH);
  // 앱 역할로 붙는다. identity 권한이 아니라 DB 의 EXECUTE 권한에서 막혀야 한다.
  // SQLSTATE 42501 (insufficient_privilege) 은 두 경계(DB GRANT · identity 권한)
  // 모두 이 코드로 떨어지므로, 메시지까지 함께 고정해 어느 경계인지 못 박는다.
  await withActor({ branches: [BRANCH], roles: ['migrator'] }, async (client, ctx) => {
    const err = await expectSqlState('42501', () =>
      client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, acctId, 1000])
    );
    assert.match(err.message, /permission denied for function op_load_opening_balance/);
  });
});

test('R-12-02 migrator 가 아닌 직원은 기초 잔액을 세울 수 없다', async () => {
  const acctId = await houseCashAccountId(BRANCH);
  // migrator 커넥션이 EXECUTE 는 가지고 있다 — assert_actor_authorized 안쪽,
  // identity 권한(role_permissions)에서 막혀야 한다. SQLSTATE 는 위 테스트와
  // 같은 42501 이라 메시지로만 경계가 갈린다.
  await withActor({ branches: [BRANCH], roles: ['cage_manager'], as: 'migrator' }, async (client, ctx) => {
    const err = await expectSqlState('42501', () =>
      client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, acctId, 1000])
    );
    assert.match(err.message, /lacks permission ledger\.opening_balance/);
  });
});
