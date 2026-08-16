// 01 §2 지점 참조 테이블 (U4).
//
// 이 파일은 DB 를 바꾸지 않는 검사와 provision_branch() 검사를 함께 담는다.
// 프로비저닝은 커밋해야 한다 — 004 의 chain_heads · 003 의 하우스 계정이
// 같은 트랜잭션에서 만들어졌는지를 다른 커넥션에서 확인해야 하기 때문이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  query,
  withRollback,
  asMigrator,
  asRole,
  expectSqlState,
  closePool,
} from '../helpers/db.mjs';
import { provisionBranch, branchCode } from '../fixtures/branches.mjs';

// provision_branch 테스트가 커밋한 지점 코드를 여기 모은다. 파일 끝에서 정확히
// 이 코드들만 지운다 — 시드 3행(HANN·NUSTAR·ONLINE)은 절대 건드리지 않는다.
// 각 커밋 테스트가 성공 직후 push 한다. 실패로 push 전에 죽으면 그 코드는
// 애초에 커밋되지 않았으므로(트랜잭션이 성공해야 push 에 닿는다) 지울 것도 없다.
const provisionedCodes = [];

// FK 역순으로 지운다: account_balances → accounts → parties → chain_heads →
// branch_config → branches. account_balances 는 003 의 accounts_create_balance
// 트리거가 계정마다 자동으로 만들고 accounts 를 참조하므로(ON DELETE 없음)
// accounts 보다 먼저 지워야 한다.
//
// closePool() 보다 먼저 등록한다 — node:test 의 after() 는 등록 순서로 실행된다.
// 나중에 등록하면 풀이 먼저 닫힌 뒤 이 정리가 돌아 "Cannot use a pool after
// calling end" 로 죽는다.
//
// 이 정리가 없으면 이 파일을 db:reset 없이 두 번 돌릴 때마다 CEBU·DAVAO·BAGUIO
// 계열 지점이 누적되고, 시드 3행만을 기대하는 :114-134(U4 시드 3행) ·
// :157-171(AC-60-3 시드 지점 3곳) 의 전체 테이블 단언이 두 번째 실행부터 깨진다.
after(async () => {
  if (provisionedCodes.length === 0) return;
  await query(
    `DELETE FROM ledger.account_balances
      WHERE account_id IN (
        SELECT a.id FROM ledger.accounts a
        JOIN ledger.parties p ON p.id = a.party_id
       WHERE p.home_branch = ANY($1))`,
    [provisionedCodes]
  );
  await query(
    `DELETE FROM ledger.accounts
      WHERE party_id IN (SELECT id FROM ledger.parties WHERE home_branch = ANY($1))`,
    [provisionedCodes]
  );
  await query('DELETE FROM ledger.parties WHERE home_branch = ANY($1)', [provisionedCodes]);
  await query('DELETE FROM ledger.chain_heads WHERE branch = ANY($1)', [provisionedCodes]);
  await query('DELETE FROM ledger.branch_config WHERE branch = ANY($1)', [provisionedCodes]);
  await query('DELETE FROM ledger.branches WHERE code = ANY($1)', [provisionedCodes]);
});

after(closePool);

// 컬럼 이름 -> 데이터 타입. 스펙 01 §2-1 이 정한 모양이다.
// is_online 은 스펙에 없지만 남긴다 — ONLINE 지점이라는 사실을 대체할 컬럼이
// 스펙에 없다 (계획 결정 1).
const EXPECTED_COLUMNS = {
  code: 'text',
  name: 'text',
  is_online: 'boolean',
  status: 'text',
  opened_on: 'date',
  created_at: 'timestamp with time zone',
};

test('R-01-01 · U4 ledger.branches 가 스펙 §2-1 의 컬럼 집합을 갖는다', async () => {
  const rows = await query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'ledger' AND table_name = 'branches'
      ORDER BY column_name`
  );
  const actual = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.deepEqual(actual, EXPECTED_COLUMNS);

  // active BOOLEAN 이 남아 있으면 status 와 같은 사실을 두 컬럼이 말한다.
  assert.equal(actual.active, undefined, 'active 컬럼이 status 로 대체되지 않았다');

  const nullable = rows.filter((r) => r.is_nullable === 'YES').map((r) => r.column_name);
  assert.deepEqual(nullable, [], `NULL 허용 컬럼이 있다: ${nullable.join(', ')}`);
});

test('R-01-01 status 가 3상태 CHECK 로 좁혀져 있다', async () => {
  // 임의 문자열이 들어가면 §2-3 · §3-2 의 WHERE status='active' 가 조용히 빗나간다.
  const rows = await query(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'branches' AND c.contype = 'c'`
  );
  const defs = rows.map((r) => r.def).join('\n');
  for (const s of ['active', 'suspended', 'closed']) {
    assert.ok(defs.includes(`'${s}'`), `status CHECK 에 ${s} 가 없다:\n${defs}`);
  }
});

test('R-01-01 code CHECK 정규식이 하이픈을 허용한다 (스펙 §2-1)', async () => {
  const rows = await query(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'branches' AND c.conname = 'branches_code_format'`
  );
  assert.equal(rows.length, 1, 'branches_code_format 제약이 없다');
  assert.ok(rows[0].def.includes('A-Z0-9_-'), `정규식에 하이픈이 없다: ${rows[0].def}`);
});

test('U4 시드 3행이 HANN · NUSTAR · ONLINE 이고 opened_on 이 채워져 있다', async () => {
  const rows = await query(
    'SELECT code, is_online, status, opened_on FROM ledger.branches ORDER BY code'
  );
  assert.deepEqual(
    rows.map((r) => r.code),
    ['HANN', 'NUSTAR', 'ONLINE']
  );
  assert.deepEqual(
    rows.map((r) => r.is_online),
    [false, false, true]
  );
  assert.deepEqual(
    rows.map((r) => r.status),
    ['active', 'active', 'active']
  );
  assert.ok(
    rows.every((r) => r.opened_on instanceof Date),
    'opened_on 이 비어 있다'
  );
});

// 하우스 계정 정책이 이 배열 하나에만 있어야 한다. 003 의 부트스트랩 DO 블록과
// 004 의 provision_branch() 가 같은 함수를 지나가는지 확인한다.
const HOUSE_KINDS = [
  'commission_expense',
  'house_cash',
  'house_gaming',
  'marker_receivable',
  'overage_income',
  'point_liability',
  'promo_expense',
  'shortage_expense',
  'suspense',
  'tips_dealer',
  'tips_house',
];

test('AC-60-3 시드 지점 3곳이 같은 하우스 계정 집합을 갖는다', async () => {
  const rows = await query(
    `SELECT p.home_branch, array_agg(a.kind::text ORDER BY a.kind::text) AS kinds
       FROM ledger.parties p
       JOIN ledger.accounts a ON a.party_id = p.id
      WHERE p.party_type = 'house'
      GROUP BY p.home_branch
      ORDER BY p.home_branch`
  );
  assert.deepEqual(
    rows.map((r) => r.home_branch),
    ['HANN', 'NUSTAR', 'ONLINE']
  );
  for (const r of rows) {
    assert.deepEqual(r.kinds, HOUSE_KINDS, `${r.home_branch} 의 하우스 계정 집합이 다르다`);
  }
});

test('AC-60-3 ledger.bootstrap_house_accounts 가 하우스 주체와 계정을 함께 만든다', async () => {
  // 롤백한다: 읽기 전용 확인이고 지연 제약이 걸린 분개를 만들지 않는다.
  // provision_branch 를 거치지 않는 경로를 일부러 본다 — 픽스처를 쓰지 않는 이유다.
  await withRollback(async (client) => {
    const branch = branchCode('TB');
    await client.query(
      `INSERT INTO ledger.branches (code, name, opened_on)
       VALUES ($1, $1, DATE '2026-01-01')`,
      [branch]
    );
    const { rows } = await client.query('SELECT ledger.bootstrap_house_accounts($1) AS party_id', [
      branch,
    ]);
    assert.ok(Number(rows[0].party_id) > 0);

    const { rows: kinds } = await client.query(
      `SELECT array_agg(a.kind::text ORDER BY a.kind::text) AS kinds
         FROM ledger.accounts a WHERE a.party_id = $1`,
      [rows[0].party_id]
    );
    assert.deepEqual(kinds[0].kinds, HOUSE_KINDS);
  });
});

test('AC-60-3 같은 지점에 두 번 부르면 거부된다', async () => {
  // parties.code 의 UNIQUE 가 잡는다. 조용히 두 번째 하우스 주체가 생기면
  // house_account_id() 가 어느 쪽을 고를지 알 수 없게 된다.
  //
  // expectSqlState(state, fn) 은 fn 을 **인자 없이** 부른다 (a01 db.mjs:375).
  // client 를 쓰려면 withRollback / asOwner 로 감싸야 한다.
  await expectSqlState('23505', () =>
    withRollback((client) => client.query('SELECT ledger.bootstrap_house_accounts($1)', ['HANN']))
  );
});

test('AC-60-3 하우스 계정 정책이 house_account_policy 한 곳에만 있다', async () => {
  // 정책 테이블이 있어야 013 의 검사 뷰가 "몇 개인가" 가 아니라
  // "어느 종류가 어떤 성격으로 있어야 하는가" 를 볼 수 있다 (계획 결정 3·5).
  const kinds = await query(
    'SELECT kind::text AS kind FROM ledger.house_account_policy ORDER BY kind'
  );
  assert.deepEqual(
    kinds.map((r) => r.kind),
    HOUSE_KINDS,
    'house_account_policy 의 종류 집합이 기대와 다르다'
  );

  // 시드 지점의 실제 계정이 정책과 한 행도 어긋나지 않는다.
  // currency 가 'PHP' 로 고정된 것은 의도다 — 곱집합 확장은 a03 (R-01-11).
  const [drift] = await query(
    `SELECT count(*)::int AS n
       FROM ledger.parties p
       JOIN ledger.accounts a ON a.party_id = p.id
       JOIN ledger.house_account_policy k ON k.kind = a.kind
      WHERE p.party_type = 'house'
        AND (a.normal_balance <> k.normal_balance
          OR a.allow_negative <> k.allow_negative
          OR a.currency <> 'PHP')`
  );
  assert.equal(drift.n, 0, '시드 하우스 계정이 house_account_policy 와 어긋난다');
});

// 커밋해서 만든다. 004 의 chain_heads · 003 의 하우스 계정이 정말 같은
// 트랜잭션에서 만들어졌는지 다른 커넥션으로 확인해야 하기 때문이다.
// 롤백으로 확인하면 "한 트랜잭션 안이라 보인다" 와 구분되지 않는다.
test('R-01-05 · AC-60-3 provision_branch 가 한 트랜잭션에서 5종을 만든다', async () => {
  const code = await provisionBranch({ prefix: 'CEBU', name: 'Cebu Test', openedOn: '2026-03-01' });
  provisionedCodes.push(code); // 커밋 성공 직후 등록 — 이후 단언이 실패해도 정리 대상에서 빠지지 않는다.

  // 스펙 01 §2-3 의 검증 쿼리를 그대로 쓴다 (참조테이블 판).
  const [row] = await query(
    `SELECT b.code,
            EXISTS (SELECT 1 FROM ledger.branch_config c WHERE c.branch = b.code) AS has_config,
            EXISTS (SELECT 1 FROM ledger.chain_heads   h WHERE h.branch = b.code) AS has_chain_head,
            EXISTS (SELECT 1 FROM ledger.parties       p WHERE p.home_branch = b.code
                      AND p.party_type = 'house')                                 AS has_house_party,
            (SELECT count(*) FROM ledger.accounts a
               JOIN ledger.parties p2 ON p2.id = a.party_id
              WHERE p2.home_branch = b.code AND p2.party_type = 'house')::int     AS house_accounts
       FROM ledger.branches b WHERE b.code = $1`,
    [code]
  );

  assert.equal(row.has_config, true, 'branch_config 가 없다');
  assert.equal(row.has_chain_head, true, 'chain_heads 가 없다');
  assert.equal(row.has_house_party, true, '하우스 주체가 없다');
  assert.equal(row.house_accounts, HOUSE_KINDS.length, '하우스 계정 수가 시드 지점과 다르다');
});

test('R-01-05 chain_heads 시드 해시가 창세 규약을 따른다', async () => {
  const code = await provisionBranch({ prefix: 'DAVAO', name: 'Davao Test', openedOn: '2026-03-01' });
  provisionedCodes.push(code); // 커밋 성공 직후 등록 — 이후 단언이 실패해도 정리 대상에서 빠지지 않는다.

  // 004:56 의 시드와 같은 식이어야 한다. 다르면 그 지점의 첫 거래에서
  // 해시 체인이 끊어진 것처럼 보인다 — 스키마 적용 시점이 아니라 운영 중이다.
  const [row] = await query(
    `SELECT h.last_hash = sha256(('cage-admin-genesis:' || h.branch)::bytea) AS ok,
            h.last_tx_id
       FROM ledger.chain_heads h WHERE h.branch = $1`,
    [code]
  );
  assert.equal(row.ok, true, 'chain_heads.last_hash 가 창세 규약과 다르다');
  assert.equal(row.last_tx_id, null);
});

test('R-01-05 임계값 인자가 필수다 (DR-39)', async () => {
  // 4인자 시그니처가 없으면 임계 없는 지점을 만들 수 있게 된다.
  // 스펙 §2-2 의 3인자 표기를 그대로 구현하면 이 테스트가 실패한다 —
  // 그것이 의도다 (계획 결정 2).
  const rows = await query(
    `SELECT count(*)::int AS n
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'ledger' AND p.proname = 'provision_branch'
        AND p.pronargs - p.pronargdefaults >= 4`
  );
  assert.equal(rows[0].n, 1, 'provision_branch 의 필수 인자가 4개가 아니다');
});

// expectSqlState(state, fn) 은 fn 을 **인자 없이** 부른다 (a01 db.mjs:375).
// client 가 필요하면 withRollback 으로 감싼다. 롤백이라 실패해도 남는 게 없다.
test('R-01-05 이미 있는 지점 코드는 거부된다', async () => {
  await expectSqlState('23505', () =>
    withRollback((client) =>
      client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
        'HANN',
        'Duplicate',
        '2026-03-01',
        50000000,
      ])
    )
  );
});

test('R-01-05 형식에 맞지 않는 코드는 거부된다', async () => {
  // 소문자 시작이 branches_code_format 에 걸린다.
  await expectSqlState('23514', () =>
    withRollback((client) =>
      client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
        'cebu',
        'lowercase',
        '2026-03-01',
        50000000,
      ])
    )
  );
});

test('R-01-05 임계값 0 이하는 거부된다 (DR-39 센티널 규약)', async () => {
  // 임계를 끄려면 BIGINT 최댓값을 넣는다. 0 으로 끄면 "끄기로 했다" 가
  // 데이터에 남지 않는다.
  await expectSqlState('23514', () =>
    withRollback((client) =>
      client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
        branchCode('ZERO'),
        'Zero threshold',
        '2026-03-01',
        0,
      ])
    )
  );
});

// ---- 역할 경계. 소유자로만 돌면 이 셋은 전부 초록으로 통과한다 ----------------
//
// 012:275-291 이 ledger_migrator 에게 준 것은 archive INSERT · ledger·identity
// USAGE · 함수 2종 EXECUTE · ledger.accounts·ledger.parties SELECT 뿐이다.
// provision_branch 가 SECURITY DEFINER 가 아니면 INSERT 가 호출자 권한으로 돌아
// 42501 로 죽는다 — 운영에서 처음 지점을 만들 때 알게 된다 (계획 결정 5).
test('R-01-05 ledger_migrator 가 provision_branch 를 실제로 실행할 수 있다', async () => {
  const code = branchCode('BAGUIO');

  // asMigrator(staffId, fn) — provision_branch 는 app.staff_id 를 읽지 않으므로
  // undefined 를 준다. 커밋한다: 다른 커넥션에서 결과를 확인해야 한다.
  await asMigrator(undefined, (client) =>
    client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
      code,
      'Baguio Test',
      '2026-03-01',
      50000000,
    ])
  );
  provisionedCodes.push(code); // 커밋 성공 직후 등록 — 이후 단언이 실패해도 정리 대상에서 빠지지 않는다.

  // Task 4 의 검사 뷰는 아직 없다. §2-3 원본 쿼리로 본다.
  const [row] = await query(
    `SELECT EXISTS (SELECT 1 FROM ledger.branch_config c WHERE c.branch = b.code) AS has_config,
            EXISTS (SELECT 1 FROM ledger.chain_heads   h WHERE h.branch = b.code) AS has_chain_head,
            (SELECT count(*) FROM ledger.accounts a
               JOIN ledger.parties p2 ON p2.id = a.party_id
              WHERE p2.home_branch = b.code AND p2.party_type = 'house')::int     AS house_accounts
       FROM ledger.branches b WHERE b.code = $1`,
    [code]
  );
  assert.equal(row.has_config, true, '이관 역할이 만든 지점에 branch_config 가 없다');
  assert.equal(row.has_chain_head, true, '이관 역할이 만든 지점에 chain_heads 가 없다');
  assert.equal(row.house_accounts, HOUSE_KINDS.length, '하우스 계정 수가 시드 지점과 다르다');
});

test('R-01-05 ledger_migrator 는 branches 에 직접 INSERT 할 수 없다', async () => {
  // 함수를 통하지 않는 우회로가 열려 있으면 provision_branch 가 유일한 경로라는
  // 전제가 깨진다 — 그리고 그 우회로로 만든 지점은 전부 반쪽이다.
  await expectSqlState('42501', () =>
    asMigrator(undefined, (client) =>
      client.query(
        `INSERT INTO ledger.branches (code, name, opened_on)
         VALUES ($1, $1, DATE '2026-01-01')`,
        [branchCode('DENY')]
      )
    )
  );
});

test('R-01-05 ledger_app 은 provision_branch 를 부를 수 없다', async () => {
  // 자금 레인이 지점을 만들 수 있으면 자기 거래의 상대 하우스 계정을 스스로
  // 지어낼 수 있다. 012 의 계층 분리가 무너지는 지점이다.
  await expectSqlState('42501', () =>
    asRole('ledger_app', (client) =>
      client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
        branchCode('APPDENY'),
        'App denied',
        '2026-03-01',
        50000000,
      ])
    )
  );
});

test('R-01-06 · AC-60-2 시드 지점 3곳이 검사 뷰에서 ok=true 다', async () => {
  const rows = await query(
    `SELECT branch, ok FROM ledger.v_check_branch_provisioning
      WHERE branch IN ('HANN','NUSTAR','ONLINE') ORDER BY branch`
  );
  assert.deepEqual(
    rows.map((r) => r.branch),
    ['HANN', 'NUSTAR', 'ONLINE']
  );
  assert.deepEqual(
    rows.map((r) => r.ok),
    [true, true, true]
  );
});

test('R-01-06 · AC-60-2 branches 직접 INSERT 로 만든 반쪽 지점이 잡힌다', async () => {
  // 롤백한다 — 반쪽 지점을 커밋해 두면 이후 실행의 검사 뷰가 계속 빨개진다.
  await withRollback(async (client) => {
    const code = branchCode('HALF');
    await client.query(
      `INSERT INTO ledger.branches (code, name, opened_on)
       VALUES ($1, $1, DATE '2026-01-01')`,
      [code]
    );

    const { rows } = await client.query(
      `SELECT ok, has_config, has_chain_head, has_house_party, house_account_count
         FROM ledger.v_check_branch_provisioning WHERE branch = $1`,
      [code]
    );
    assert.equal(rows.length, 1, '새 지점이 검사 뷰에 안 나온다');
    assert.equal(rows[0].ok, false, 'provision_branch 를 건너뛴 지점이 ok=true 로 나온다');
    assert.equal(rows[0].has_config, false);
    assert.equal(rows[0].has_chain_head, false);
    assert.equal(rows[0].has_house_party, false);
    assert.equal(rows[0].house_account_count, 0);
  });
});

test('R-01-06 has_staff 는 정보 열이지 ok 판정에 들어가지 않는다', async () => {
  // 갓 만든 지점에 직원이 없는 것은 결함이 아니다. provision_branch 는
  // 직원을 배정하지 않는다 (R-01-05 의 5종에 없다).
  const code = await provisionBranch({ prefix: 'ILOILO', name: 'Iloilo Test', openedOn: '2026-03-01' });
  provisionedCodes.push(code); // 커밋 성공 직후 등록 — 이후 단언이 실패해도 정리 대상에서 빠지지 않는다.

  const [row] = await query(
    'SELECT ok, has_staff FROM ledger.v_check_branch_provisioning WHERE branch = $1',
    [code]
  );
  assert.equal(row.has_staff, false, '테스트 전제가 깨졌다 — 새 지점에 직원이 붙어 있다');
  assert.equal(row.ok, true, 'has_staff 가 ok 판정에 섞여 들어갔다');
});

test('R-01-06 검사 뷰가 security_invoker 다 (ADR-014)', async () => {
  const rows = await query(
    `SELECT count(*)::int AS n FROM ledger.v_check_view_security
      WHERE view_name = 'v_check_branch_provisioning'`
  );
  assert.equal(rows[0].n, 0, 'security_invoker 가 빠진 뷰다 — RLS 를 우회한다');
});

// ---- 개수가 아니라 집합을 본다는 것을 고정한다 ------------------------------
//
// house_account_count > 0 으로 판정하면 아래 두 상태가 **둘 다 ok=true** 다.
// 그리고 둘 다 상대 계정을 못 찾는 첫 분개에서 운영 중에 터진다.
test('R-01-06 하우스 계정이 한 종류만 있는 지점은 ok=false 다', async () => {
  await withRollback(async (client) => {
    const code = branchCode('PARTIAL');
    await client.query(
      `INSERT INTO ledger.branches (code, name, opened_on)
       VALUES ($1, $1, DATE '2026-01-01')`,
      [code]
    );
    // provision_branch 를 일부러 거치지 않는다 — 부분 실패나 나중의 삭제로
    // 계정이 하나만 남은 상태를 흉내 낸다.
    const { rows: party } = await client.query(
      `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
       VALUES ('MAIN-' || $1, 'house', $1 || ' MAIN ACCOUNT', $1) RETURNING id`,
      [code]
    );
    await client.query(
      `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
       SELECT $1, k.kind, 'PHP', k.normal_balance, k.allow_negative
         FROM ledger.house_account_policy k WHERE k.kind = 'house_cash'`,
      [party[0].id]
    );

    const { rows } = await client.query(
      `SELECT ok, house_account_count, missing_house_accounts, has_house_party
         FROM ledger.v_check_branch_provisioning WHERE branch = $1`,
      [code]
    );
    assert.equal(rows[0].has_house_party, true, '테스트 전제가 깨졌다 — 하우스 주체가 없다');
    assert.equal(rows[0].house_account_count, 1, '테스트 전제가 깨졌다');
    assert.equal(rows[0].missing_house_accounts, HOUSE_KINDS.length - 1);
    assert.equal(rows[0].ok, false, '계정 하나만 남은 지점이 ok=true 로 나온다');
  });
});

test('R-01-06 하우스 계정 성격이 정책과 다르면 ok=false 다', async () => {
  await withRollback(async (client) => {
    const code = branchCode('DRIFT');
    // 여기서는 provision_branch 로 정상 지점을 만든 뒤 한 계정만 어긋뜨린다.
    await client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
      code,
      'Drift Test',
      '2026-03-01',
      50000000,
    ]);
    const before = await client.query(
      'SELECT ok FROM ledger.v_check_branch_provisioning WHERE branch = $1',
      [code]
    );
    assert.equal(before.rows[0].ok, true, '테스트 전제가 깨졌다 — 갓 만든 지점이 ok=false 다');

    // 종류도 개수도 그대로다. 성격 하나만 정책과 어긋난다.
    //
    // 방향이 중요하다. 003:123 의 accounts_kind_consistent 는 BEFORE UPDATE 로도
    // 돌면서 (가) normal_balance 가 종류와 안 맞으면 거부하고 (나) allow_negative
    // = true 를 suspense · house_gaming · promo_expense · opening_equity 외에는
    // 거부한다. 그래서 **true → false 만이 트리거를 통과하는 드리프트**다.
    // 나머지 두 방향은 DB 가 이미 막고 있으니 뷰가 메울 구멍은 이것 하나다.
    await client.query(
      `UPDATE ledger.accounts a SET allow_negative = false
         FROM ledger.parties p
        WHERE p.id = a.party_id AND p.home_branch = $1 AND a.kind = 'suspense'`,
      [code]
    );

    const { rows } = await client.query(
      `SELECT ok, house_account_count, missing_house_accounts
         FROM ledger.v_check_branch_provisioning WHERE branch = $1`,
      [code]
    );
    assert.equal(rows[0].house_account_count, HOUSE_KINDS.length, '개수는 그대로여야 한다');
    assert.equal(rows[0].missing_house_accounts, 1);
    assert.equal(rows[0].ok, false, 'allow_negative 가 정책과 달라도 ok=true 로 나온다 — 개수만 세고 있다');
  });
});

test('R-01-06 ledger_read 가 검사 뷰를 실제로 조회할 수 있다', async () => {
  // 소유자로만 돌면 이 테스트가 잡는 것은 하나도 안 잡힌다 — 소유자는
  // GRANT 와 RLS 를 우회한다. 이 뷰는 security_invoker 라 identity.staff_branches
  // 를 호출자 권한으로 읽는데, 012 는 ledger_read 에 그 SELECT 를 주지 않았다.
  const rows = await asRole('ledger_read', async (client) => {
    const r = await client.query(
      `SELECT branch, ok, has_staff FROM ledger.v_check_branch_provisioning
        WHERE branch = 'HANN'`
    );
    return r.rows;
  });
  assert.equal(rows.length, 1, 'ledger_read 가 검사 뷰에서 아무 행도 못 본다');
  assert.equal(rows[0].ok, true);
});
