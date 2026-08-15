// 애플리케이션 역할의 경계. 확인한 사실을 회귀 테스트로 고정한다.
// 모든 권한 거부는 SQLSTATE 42501 (insufficient_privilege) 이다 — expectSqlState 로
// 그 사실 자체를 단언하고, 메시지 정규식으로 "무엇이" 막았는지까지 좁힌다.
// SQLSTATE 만 보면 다른 이유의 거부(오타난 테이블명 등)도 같은 42501 이 나올 수 있는
// 문법 오류(42601)와는 구분되지만, 메시지가 없으면 "권한이 막았다"는 것만 알 뿐 "이
// 경계가 막았다"는 것은 모른다 — 그래서 이 파일은 SQLSTATE 와 메시지를 항상 함께 본다.
//   ledger.entries 직접 INSERT           → permission denied for table entries
//   ledger.post_transaction              → permission denied for function post_transaction
//   ledger.entries SELECT                → app.staff_id 의 지점만 (ledger.current_branches())
//   ledger_app → step_up_tokens INSERT   → permission denied for table step_up_tokens
//   ledger_app → step_up_tokens SELECT   → permission denied for table step_up_tokens
//   identity_app → ledger.op_deposit     → permission denied for schema ledger
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asStaff, asIdentity, expectSqlState, query, uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { createActor, withActor } from '../fixtures/scenario.mjs';
import { fundedAccount } from '../fixtures/members.mjs';

after(closePool);

test('테스트가 소유자로 돌고 있지 않다', async () => {
  // 이 테스트가 깨지면 다른 모든 권한·RLS 테스트가 무의미해진다.
  // rolsuper 만으로는 부족하다 — 슈퍼유저가 아니어도 테이블 소유자면
  // FORCE ROW LEVEL SECURITY 가 없는 한 RLS 를 그냥 우회한다 (012 의 주석 참고).
  // 그래서 슈퍼유저 여부와 ledger.entries 소유자 여부를 함께 본다.
  const { staffId } = await createActor();
  await asStaff(staffId, async (client) => {
    const { rows } = await client.query('SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user');
    assert.equal(rows[0].rolsuper, false, `앱 풀이 슈퍼유저(${rows[0].current_user})로 붙어 있다`);

    const { rows: own } = await client.query(
      `SELECT relowner::regrole <> current_user::regrole AS not_owner
         FROM pg_class WHERE oid = 'ledger.entries'::regclass`
    );
    assert.equal(own[0].not_owner, true, '앱 풀이 ledger.entries 의 소유자다 — RLS 를 그냥 우회한다');
  });
});

test('앱 역할은 ledger.entries 에 직접 쓸 수 없다', async () => {
  const { staffId } = await createActor();
  const err = await expectSqlState('42501', () =>
    asStaff(staffId, (client) =>
      client.query(
        `INSERT INTO ledger.entries (transaction_id, account_id, currency, amount_minor, category, branch)
         VALUES (1, 1, 'PHP', 1, 'deposit_cash', 'HANN')`
      )
    )
  );
  // account_id/transaction_id 1 은 존재하지 않을 수 있다 — 그래도 상관없다. 권한
  // 검사는 FK·제약 검사보다 먼저 돈다. 이 INSERT 가 다른 이유(FK 위반 등)로 막힌
  // 것이 아니라는 것은 아래 메시지로 확인한다.
  assert.match(err.message, /permission denied for table entries/);
});

test('ledger.entries 에는 INSERT/ALL 을 허용하는 RLS 정책이 없다', async () => {
  // 위 테스트가 "GRANT 가 없다"만 고정하면, 누군가 실수로
  // `CREATE POLICY ... FOR INSERT TO ledger_app WITH CHECK (true)` 를 추가해도
  // 잡아내지 못한다 (GRANT 는 여전히 없으니 여전히 거부되지만, 이제는 GRANT
  // 때문이 아니라 두 번째 방어선이 없어서 우연히 막힌 것이 된다 — 그리고 GRANT
  // 가 나중에 실수로 추가되면 이 정책이 그대로 뚫린다). 그래서 정책 자체가
  // INSERT/ALL 커맨드를 허용하지 않는다는 사실을 카탈로그로 직접 고정한다.
  // pg_policy.polcmd: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL.
  const rows = await query(`
    SELECT polname, polcmd
      FROM pg_policy
     WHERE polrelid = 'ledger.entries'::regclass
       AND polcmd IN ('a', '*')
     ORDER BY 1`);
  assert.deepEqual(
    rows,
    [],
    `ledger.entries 에 INSERT/ALL 정책이 있다: ${JSON.stringify(rows)} — GRANT 누락만으로는 더 이상 안전하지 않다`
  );
});

test('앱 역할은 내부 함수를 직접 부를 수 없다', async () => {
  const { staffId } = await createActor();
  const err = await expectSqlState('42501', () =>
    asStaff(staffId, (client) =>
      client.query("SELECT ledger.post_transaction($1, 'deposit', 'HANN', $2, 'pin', 'd', '[]'::jsonb)", [
        uniq('x'),
        staffId,
      ])
    )
  );
  assert.match(err.message, /permission denied for function post_transaction/);
});

// ---- DR-03: 발급자 ≠ 소비자 ----
// 아래 넷이 깨지면 자금 경로가 자기 재인증 근거를 만들어 낼 수 있다는 뜻이다.
// db/schema/012_roles_and_grants.sql:203-227 이 나눠 놓은 경계를 그대로 되읽는다.

test('AC-12-3 자금 레인과 identity 레인은 서로 다른 로그인 역할이다', async () => {
  // 두 풀이 같은 사용자로 붙어 있으면 아래 세 테스트가 전부 공허해진다.
  const { staffId } = await createActor();
  const appUser = await asStaff(staffId, async (client) => {
    const { rows } = await client.query('SELECT current_user AS u');
    return rows[0].u;
  });
  const idUser = await asIdentity(async (client) => {
    const { rows } = await client.query('SELECT current_user AS u');
    return rows[0].u;
  });
  assert.notEqual(appUser, idUser, `두 레인이 같은 자격증명(${appUser})으로 붙어 있다`);

  // 이름만 다르고 그룹을 겸하면 같은 얘기다. 상속까지 양방향으로 본다 — 한쪽만
  // 확인하면 DR-03 의 절반만 검증한 것이다.
  //
  // 'USAGE' 가 아니라 'MEMBER' 로 본다. pg_has_role(..., 'USAGE') 는 그 역할의
  // 권한이 SET ROLE 없이 "자동 상속"될 때만 참이다 — PostgreSQL 16+ 는
  // `GRANT identity_app TO cage_test_app WITH INHERIT FALSE, SET TRUE` 를
  // 허용하는데, 이 형태는 SET ROLE 로 언제든 전환 가능하면서도
  // pg_has_role(..., 'USAGE') 는 계속 false 를 낸다. 'MEMBER' 는 SET ROLE 가능
  // 여부와 무관하게 멤버십 자체를 보므로 이 변형까지 잡는다.
  const [{ has_identity: appHasIdentity }] = await asStaff(staffId, async (client) => {
    const { rows } = await client.query("SELECT pg_has_role(current_user, 'identity_app', 'MEMBER') AS has_identity");
    return rows;
  });
  assert.equal(appHasIdentity, false, '자금 레인이 identity_app 의 멤버다 — DR-03 이 무력화된다');

  const [{ has_ledger: idHasLedger }] = await asIdentity(async (client) => {
    const { rows } = await client.query("SELECT pg_has_role(current_user, 'ledger_app', 'MEMBER') AS has_ledger");
    return rows;
  });
  assert.equal(idHasLedger, false, 'identity 레인이 ledger_app 의 멤버다 — DR-03 이 무력화된다');
});

test('자금 레인은 스텝업 토큰을 발급할 수 없다', async () => {
  const { staffId } = await createActor();
  const err = await expectSqlState('42501', () =>
    asStaff(staffId, (client) =>
      client.query(
        `INSERT INTO identity.step_up_tokens (staff_id, method, device_id, scope, expires_at)
         VALUES ($1, 'pin', 'dev-x', 'ledger.deposit', clock_timestamp() + interval '30 minutes')`,
        [staffId]
      )
    )
  );
  assert.match(err.message, /permission denied for table step_up_tokens/);
});

test('자금 레인은 스텝업 토큰을 읽을 수도 없다', async () => {
  // 읽을 수 있으면 남의 토큰을 주워 쓸 수 있다. 소비는 op_* 안에서만 일어나야 한다.
  const { staffId } = await createActor();
  const err = await expectSqlState('42501', () =>
    asStaff(staffId, (client) => client.query('SELECT id FROM identity.step_up_tokens LIMIT 1'))
  );
  assert.match(err.message, /permission denied for table step_up_tokens/);
});

test('identity 레인은 자금 op_* 를 부를 수 없다', async () => {
  // 스키마 USAGE 자체가 없다. 함수 EXECUTE 이전 단계에서 막힌다.
  const err = await expectSqlState('42501', () =>
    asIdentity((client) =>
      client.query("SELECT ledger.op_deposit($1, 1, 1, 'dev-x', 'HANN', 'TEST-ACC', 1)", [uniq('x')])
    )
  );
  assert.match(err.message, /permission denied for schema ledger/);
});

test('RLS 가 app.staff_id 의 지점으로 분개를 거른다', async () => {
  // HANN·NUSTAR 양쪽에 배정된 직원이 지점 간 이체를 만든다 — 양쪽 지점 분개가 생긴다.
  // 반환된 external_id 는 "무엇이 커밋됐는지"의 증거가 아니라(그건 return JSON 의
  // 자기 보고일 뿐이다), 아래에서 실제 저장된 행을 다시 찾기 위한 열쇠로만 쓴다.
  const extId = await withActor({ branches: ['HANN', 'NUSTAR'] }, async (client, ctx) => {
    await fundedAccount(client, ctx, { amount: 100000 });
    const bt = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.branch_transfer',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_branch_transfer($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('bt'),
      ctx.staffId,
      bt,
      ctx.device,
      'HANN',
      'NUSTAR',
      20000,
    ]);
    return rows[0].result.transaction.external_id;
  });

  // HANN 에만 배정된 직원은 NUSTAR 분개를 볼 수 없다.
  const { staffId: hannOnly } = await createActor();
  await asStaff(hannOnly, async (client) => {
    const { rows: branches } = await client.query('SELECT ledger.current_branches() AS b');
    assert.deepEqual(branches[0].b, ['HANN']);

    const { rows } = await client.query('SELECT DISTINCT branch FROM ledger.entries ORDER BY 1');
    assert.deepEqual(
      rows.map((r) => r.branch),
      ['HANN'],
      'HANN 직원에게 다른 지점 분개가 보인다 — RLS 가 새고 있다'
    );
  });

  // 소유자에게는 방금 만든 그 거래의 NUSTAR 분개가 실제로 있다 — 위가
  // "데이터가 없어서" 통과한 게 아니다. 테이블 전체를 세면 다른 테스트 파일이
  // 남긴 NUSTAR 행으로도 통과해 버리므로, 이 테스트가 만든 external_id 로 좁힌다.
  const own = await query(
    `SELECT count(*)::int AS n
       FROM ledger.entries e
       JOIN ledger.transactions t ON t.id = e.transaction_id
      WHERE e.branch = 'NUSTAR' AND t.external_id = $1`,
    [extId]
  );
  assert.equal(own[0].n, 1, '이 거래의 NUSTAR 분개가 정확히 하나 있어야 한다 — RLS 테스트가 공허하지 않다는 증거');
});
