// U4(지점 ENUM -> 참조 테이블) 전환이 되돌아가지 않게 고정한다.
//
// R-01-01 ~ R-01-04 는 2026-08-16 실측 기준 **이미 참이다.** 이 파일은
// 새로 만드는 것이 아니라 못 되돌아가게 하는 것이다. 되돌아가는 일은
// a03~a14 어딘가에서 조용히 벌어지고, DB 는 그때 오류를 내지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { query, closePool } from '../helpers/db.mjs';

after(closePool);

const SCHEMA_DIR = path.resolve(import.meta.dirname, '../../schema');

async function schemaFiles() {
  const names = (await readdir(SCHEMA_DIR)).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort();
  return Promise.all(
    names.map(async (name) => ({ name, body: await readFile(path.join(SCHEMA_DIR, name), 'utf8') }))
  );
}

test('R-01-01 ledger.branch_code ENUM 이 존재하지 않는다', async () => {
  const rows = await query(
    `SELECT t.typname
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'ledger' AND t.typname = 'branch_code'`
  );
  assert.deepEqual(rows, [], 'branch_code ENUM 이 되살아났다 — U4 전환이 되돌아갔다');
});

test('R-01-02 branch 컬럼을 가진 모든 테이블이 branches(code) FK 를 갖는다', async () => {
  // 컬럼 이름이 'branch' 이거나 '_branch' 로 끝나는 것을 전부 본다.
  // home_branch · opened_branch 처럼 접두어가 붙은 것도 지점 참조다.
  const rows = await query(`
    SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema IN ('ledger','cage','identity','audit','archive')
       AND (c.column_name = 'branch' OR c.column_name LIKE '%\\_branch')
       AND NOT EXISTS (
             SELECT 1
               FROM information_schema.key_column_usage k
               JOIN information_schema.referential_constraints r
                 ON r.constraint_name = k.constraint_name
                AND r.constraint_schema = k.constraint_schema
               JOIN information_schema.constraint_column_usage u
                 ON u.constraint_name = r.unique_constraint_name
                AND u.constraint_schema = r.unique_constraint_schema
              WHERE k.table_schema = c.table_schema
                AND k.table_name   = c.table_name
                AND k.column_name  = c.column_name
                AND u.table_schema = 'ledger'
                AND u.table_name   = 'branches'
                AND u.column_name  = 'code')
     ORDER BY 1, 2, 3`);
  assert.deepEqual(
    rows,
    [],
    `FK 없는 branch 컬럼이 있다: ${rows
      .map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`)
      .join(', ')}`
  );
});

test('R-01-03 current_branches() 가 TEXT[] 를 반환한다', async () => {
  // 실물은 ledger.current_branches() 다 (012:343). 스펙 01 §2-2 는
  // identity. 로 적었으나 012 의 RLS 정책 전부가 ledger. 를 부른다.
  const rows = await query(
    `SELECT n.nspname AS schema_name, pg_get_function_result(p.oid) AS result_type
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'current_branches'
      ORDER BY 1`
  );
  assert.equal(rows.length, 1, `current_branches 가 ${rows.length} 개다`);
  assert.equal(rows[0].schema_name, 'ledger');
  assert.equal(rows[0].result_type, 'text[]');
});

test('R-01-03 RLS 정책이 current_branches() 로 지점을 거른다', async () => {
  // 정책이 하나도 안 걸려 있으면 위 반환형 검사는 통과하면서 격리는 없다.
  const rows = await query(
    `SELECT count(*)::int AS n FROM pg_policies
      WHERE schemaname IN ('ledger','cage','identity')
        AND qual LIKE '%current_branches%'`
  );
  assert.ok(rows[0].n >= 5, `current_branches 를 쓰는 RLS 정책이 ${rows[0].n} 개뿐이다`);
});

test('R-01-04 스키마 소스의 실행되는 SQL 에 branch_code 참조가 없다', async () => {
  const offenders = [];
  for (const { name, body } of await schemaFiles()) {
    for (const [i, line] of body.split('\n').entries()) {
      // 001 의 전환 기록 주석은 "무엇을 무엇으로 바꿨는가" 를 적은 것이라
      // 남아 있어야 한다. 실행되는 SQL 만 본다.
      if (line.trimStart().startsWith('--')) continue;
      if (line.includes('branch_code')) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `실행되는 SQL 에 branch_code 참조가 있다:\n${offenders.join('\n')}`);
});

test('AC-49-1 · R-01-53 005 의 R4 주석이 013 을 가리킨다', async () => {
  // DR-49: 주석이 R4 위치를 010 이라고 썼던 결함이다. R4 는
  // cage.v_check_rolling_projection 이고 013 에 있다.
  const body = await readFile(path.join(SCHEMA_DIR, '005_games_rolling.sql'), 'utf8');
  const line = body.split('\n').find((l) => l.includes('R4'));
  assert.ok(line, '005 에 R4 위치를 알리는 주석이 없다');
  assert.ok(line.includes('013'), `005 의 R4 주석이 013 을 가리키지 않는다: ${line.trim()}`);
  assert.ok(!line.includes('010'), `005 의 R4 주석이 아직 010 을 가리킨다: ${line.trim()}`);
});

test('R-01-53 스키마 주석의 R번호 ↔ 파일 참조가 실제와 일치한다', async () => {
  // "R<n>" 과 세 자리 파일 번호가 같은 주석 줄에 있으면, 그 R 번호의 뷰가
  // 정말 그 파일에 정의돼 있는지 본다.
  const VIEW_OF = {
    R1: 'v_check_double_entry',
    R2: 'v_check_balance_projection',
    R3: 'v_check_hash_chain',
    R4: 'v_check_rolling_projection',
    R5: 'v_check_suspense',
    R6: 'v_check_entry_branch',
    R7: 'v_check_posting_rules',
    R8: 'v_check_chain_anchor',
    R9: 'v_check_merkle_anchor',
  };
  const files = await schemaFiles();
  const bodyOf = Object.fromEntries(files.map((f) => [f.name.slice(0, 3), f.body]));
  const problems = [];

  for (const { name, body } of files) {
    for (const [i, line] of body.split('\n').entries()) {
      if (!line.trimStart().startsWith('--')) continue;
      const rs = [...line.matchAll(/\bR(\d{1,2})\b/g)].map((m) => `R${m[1]}`);
      const targets = [...line.matchAll(/\b(0\d{2})\b/g)].map((m) => m[1]);
      if (rs.length === 0 || targets.length === 0) continue;

      for (const r of rs) {
        const view = VIEW_OF[r];
        if (!view) continue; // R10 · R11 은 아직 없다 (스펙 01 §6 · a03)
        if (!targets.some((t) => bodyOf[t]?.includes(view))) {
          problems.push(
            `${name}:${i + 1}: ${r}(${view}) 가 ${targets.join('/')} 에 없다 — ${line.trim()}`
          );
        }
      }
    }
  }
  assert.deepEqual(problems, [], `R번호 ↔ 파일 참조가 어긋난다:\n${problems.join('\n')}`);
});
