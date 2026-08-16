// 01 §2 지점 참조 테이블 (U4).
//
// 이 파일은 DB 를 바꾸지 않는 검사와 provision_branch() 검사를 함께 담는다.
// 프로비저닝은 커밋해야 한다 — 004 의 chain_heads · 003 의 하우스 계정이
// 같은 트랜잭션에서 만들어졌는지를 다른 커넥션에서 확인해야 하기 때문이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withRollback, expectSqlState, uniq, closePool } from '../helpers/db.mjs';

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

// branches_code_format: ^[A-Z][A-Z0-9_-]{1,15}$ — 대문자 시작, 총 2~16자.
function branchCode(prefix) {
  return `${prefix}${uniq('')}`.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

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
