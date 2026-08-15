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
import { asOwner, asStaff, asIdentity, expectSqlState, query, uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { fundedAccount } from '../fixtures/members.mjs';

after(closePool);

test('테스트가 소유자로 돌고 있지 않다', async () => {
  // 이 테스트가 깨지면 다른 모든 권한·RLS 테스트가 무의미해진다.
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
  await asStaff(staffId, async (client) => {
    const { rows } = await client.query('SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user');
    assert.equal(rows[0].rolsuper, false, `앱 풀이 슈퍼유저(${rows[0].current_user})로 붙어 있다`);
  });
});

test('앱 역할은 ledger.entries 에 직접 쓸 수 없다', async () => {
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
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

test('앱 역할은 내부 함수를 직접 부를 수 없다', async () => {
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
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
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
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
  const [{ has_identity: appHasIdentity }] = await asStaff(staffId, async (client) => {
    const { rows } = await client.query("SELECT pg_has_role(current_user, 'identity_app', 'USAGE') AS has_identity");
    return rows;
  });
  assert.equal(appHasIdentity, false, '자금 레인이 identity_app 을 물려받았다 — DR-03 이 무력화된다');

  const [{ has_ledger: idHasLedger }] = await asIdentity(async (client) => {
    const { rows } = await client.query("SELECT pg_has_role(current_user, 'ledger_app', 'USAGE') AS has_ledger");
    return rows;
  });
  assert.equal(idHasLedger, false, 'identity 레인이 ledger_app 을 물려받았다 — DR-03 이 무력화된다');
});

test('자금 레인은 스텝업 토큰을 발급할 수 없다', async () => {
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
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
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
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
  await withActor({ branches: ['HANN', 'NUSTAR'] }, async (client, ctx) => {
    await fundedAccount(client, ctx, { amount: 100000 });
    const bt = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.branch_transfer',
      method: 'totp',
    });
    await client.query('SELECT ledger.op_branch_transfer($1, $2, $3, $4, $5, $6, $7)', [
      uniq('bt'),
      ctx.staffId,
      bt,
      ctx.device,
      'HANN',
      'NUSTAR',
      20000,
    ]);
  });

  // HANN 에만 배정된 직원은 NUSTAR 분개를 볼 수 없다.
  const hannOnly = await asOwner((client) =>
    createStaff(client, { code: uniqCode('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
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

  // 소유자에게는 NUSTAR 분개가 실제로 있다 — 위가 "데이터가 없어서" 통과한 게 아니다.
  const all = await query("SELECT count(*)::int AS n FROM ledger.entries WHERE branch = 'NUSTAR'");
  assert.ok(all[0].n > 0, 'NUSTAR 분개가 아예 없다면 RLS 테스트가 공허하다');
});
