// 01 §2 지점 참조 테이블 (U4).
//
// 이 파일은 DB 를 바꾸지 않는 검사와 provision_branch() 검사를 함께 담는다.
// 프로비저닝은 커밋해야 한다 — 004 의 chain_heads · 003 의 하우스 계정이
// 같은 트랜잭션에서 만들어졌는지를 다른 커넥션에서 확인해야 하기 때문이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, closePool } from '../helpers/db.mjs';

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
