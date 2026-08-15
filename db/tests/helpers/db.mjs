// 골든 테스트 공용 커넥션 헬퍼.
//
// 풀이 넷이다. 하나로는 이 하니스가 지켜야 할 것을 못 지킨다:
//
//   소유자 풀   (postgres)            — 스키마 적용 · 픽스처 생성. RLS 와 권한을 우회한다.
//   앱 풀       (cage_test_app)       — ledger_app **만**. op_* 호출.
//   identity 풀 (cage_test_identity)  — identity_app **만**. DR-03 경계 테스트 전용.
//   이관 풀     (cage_test_migrator)  — ledger_migrator **만**. §14 기초 잔액 전용.
//
// 소유자로 op_* 를 부르면 GRANT EXECUTE 누락 · REVOKE 누락 · 지점 격리 실패가
// 전부 통과한다. 검사해야 할 경계 바깥에서 검사하는 셈이다.
// 확인한 사실: 앱 역할은 ledger.entries 에 INSERT 불가, ledger.post_transaction
// 실행 불가, 그리고 app.staff_id 가 가리키는 직원의 지점 분개만 보인다.
//
// 앱 풀에 identity_app 을 얹지 않는다. 얹으면 자금 경로가 자기 스텝업 토큰을
// 발급할 수 있게 되어 DR-03 이 테스트에서 사라진다 (db/schema/012_roles_and_grants.sql:214).
// 확인한 사실 3종 — Task 9 가 이것을 회귀로 고정한다:
//   ledger_app   INSERT identity.step_up_tokens  → permission denied for table step_up_tokens
//   ledger_app   SELECT identity.step_up_tokens  → permission denied for table step_up_tokens
//   identity_app SELECT ledger.op_deposit(...)   → permission denied for schema ledger
/* global process */
import pg from 'pg';

const { Pool } = pg;

const base = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'cage',
  max: 4,
};

// 스키마 소유자. 픽스처 생성과 카탈로그 조회 전용.
export const ownerPool = new Pool({
  ...base,
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
});

// 애플리케이션 역할(ledger_app 단독). 대부분의 op_* 호출.
export const appPool = new Pool({
  ...base,
  user: process.env.PGAPPUSER ?? 'cage_test_app',
  password: process.env.PGAPPPASSWORD ?? process.env.PGPASSWORD ?? 'devonly',
});

// identity 서비스 역할(identity_app 단독). DR-03 경계 테스트만 이 풀을 쓴다.
// 픽스처 토큰 발급에는 쓰지 않는다 — identity_app 은 step_up_tokens 에 INSERT 는
// 되지만 SELECT 가 없어 `INSERT ... RETURNING id` 가 거부된다. 확인한 사실이다.
export const identityPool = new Pool({
  ...base,
  user: process.env.PGIDUSER ?? 'cage_test_identity',
  password: process.env.PGAPPPASSWORD ?? process.env.PGPASSWORD ?? 'devonly',
});

// 이관 역할(ledger_migrator). ledger.op_load_opening_balance 의 EXECUTE 가
// 이 역할에만 있다 — ledger_app 에는 없다. §14 만 이 풀을 쓴다.
export const migratorPool = new Pool({
  ...base,
  user: process.env.PGMIGUSER ?? 'cage_test_migrator',
  password: process.env.PGAPPPASSWORD ?? process.env.PGPASSWORD ?? 'devonly',
});

// 카탈로그·시드 조회용. 소유자 풀을 쓴다.
export async function query(text, params = []) {
  const result = await ownerPool.query(text, params);
  return result.rows;
}

// 읽기 전용 테스트용. 아무것도 남기지 않는다.
// 경고: op_* 를 부르는 데 쓰지 않는다. 지연 제약은 COMMIT 때만 발화하므로
// 롤백하면 잔액 하한(I2) · 차대 균형(I1) 위반이 통과해 버린다.
export async function withRollback(fn, { staffId } = {}) {
  return runIn(staffId === undefined ? ownerPool : appPool, staffId, fn, 'ROLLBACK');
}

// 픽스처용. 소유자로 붙어 커밋한다.
// identity.staff · ledger.parties 삽입은 앱 역할 권한 밖이다.
export async function asOwner(fn) {
  return runIn(ownerPool, undefined, fn, 'COMMIT');
}

// op_* 호출용. 앱 역할로 붙고 app.staff_id 를 세운 뒤 커밋한다.
// COMMIT 까지 가야 지연 제약 트리거가 발화한다. 커밋한 행은 지우지 않는다 —
// entries · transactions 는 불변 트리거로 DELETE 가 막혀 있다. uniq() 로 키를 가른다.
export async function asStaff(staffId, fn) {
  return runIn(appPool, staffId, fn, 'COMMIT');
}

// ledger_migrator 로 붙는다. §14 기초 잔액 전용.
export async function asMigrator(staffId, fn) {
  return runIn(migratorPool, staffId, fn, 'COMMIT');
}

// identity_app 으로 붙는다. DR-03 경계 테스트 전용 — 이 역할이 자금 op_* 를
// 부를 수 없다는 것과, 반대로 토큰 발급은 된다는 것을 함께 고정한다.
// 롤백한다: 경계 확인이 목적이라 남길 행이 없다.
export async function asIdentity(fn) {
  return runIn(identityPool, undefined, fn, 'ROLLBACK');
}

async function runIn(pool, staffId, fn, ending) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (staffId !== undefined) {
      // SET LOCAL 이라 트랜잭션이 끝나면 사라진다. 풀에 남지 않는다.
      await client.query('SELECT set_config($1, $2, true)', ['app.staff_id', String(staffId)]);
    }
    const result = await fn(client);
    await client.query(ending);
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// COMMIT 에서 거부되는 것을 단언한다. 호출 자체는 성공할 수 있다 — 그게 요점이다.
// staffId 를 주면 앱 역할로, 안 주면 소유자로 돈다.
export async function expectCommitFailure(state, fn, { staffId } = {}) {
  const pool = staffId === undefined ? ownerPool : appPool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (staffId !== undefined) {
      await client.query('SELECT set_config($1, $2, true)', ['app.staff_id', String(staffId)]);
    }
    await fn(client);
    try {
      await client.query('COMMIT');
    } catch (err) {
      if (err.code === state) return err;
      throw new Error(`expected SQLSTATE ${state} at COMMIT, got ${err.code}: ${err.message}`);
    }
    throw new Error(`expected SQLSTATE ${state} at COMMIT, but the transaction committed`);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release(true); // 커밋 실패한 커넥션은 풀에 돌려보내지 않는다
  }
}

// 커밋하는 테스트는 멱등키·계좌 코드가 실행 간에 겹치면 안 된다.
// 프로세스마다 한 번 정해지는 토큰 + 증가 카운터.
const RUN_TOKEN = `${process.pid.toString(36)}${Date.now().toString(36)}`;
let seq = 0;
export function uniq(prefix) {
  seq += 1;
  return `${prefix}-${RUN_TOKEN}-${seq}`;
}

// 호출 시점에 바로 거부되는 것을 단언한다. 메시지 문자열이 아니라 SQLSTATE 로 본다.
export async function expectSqlState(state, fn) {
  try {
    await fn();
  } catch (err) {
    if (err.code === state) return err;
    throw new Error(`expected SQLSTATE ${state}, got ${err.code}: ${err.message}`);
  }
  throw new Error(`expected SQLSTATE ${state}, but the statement succeeded`);
}

export async function closePool() {
  await Promise.all([ownerPool.end(), appPool.end(), identityPool.end(), migratorPool.end()]);
}
