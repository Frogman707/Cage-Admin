# a01 — CI 골든 하니스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 PR에서 PostgreSQL 18에 `db/schema/` 13개 파일을 처음부터 적용하고, 분개 계약 · 드리프트 · 문서 정합성을 자동 검사하는 테스트 하니스를 만든다.

**Architecture:** GitHub Actions의 `postgres:18-alpine` 서비스 컨테이너에 `db/scripts/apply.sh`로 스키마를 적용한 뒤 `node --test db/tests/`를 돌린다. 테스트는 `pg` 풀로 붙어 `op_*` 함수를 호출하고 **커밋한 뒤 `ledger.entries`를 다시 읽어** 분개 집합 `(account_kind, sign, category)`을 [`04-posting-rules.md`](../../architecture/04-posting-rules.md)의 표와 대조한다. 커밋하는 이유는 두 가지다 — 잔액·균형 불변식이 지연 제약이라 COMMIT 때만 발화하고, 함수의 반환 JSON이 아니라 저장된 행을 봐야 저장 경로의 결함이 잡힌다. 문서 정합성 검사 2종(`tools/`)은 DB 없이 도는 별도 스텝이다.

**Tech Stack:** Node 24 내장 `node:test` · `pg` 8 · GitHub Actions · PostgreSQL 18.6 (`postgres:18-alpine`) · 확장 없음

## Global Constraints

- **PostgreSQL 18 이상.** `uuidv7()`(18 내장) · `sha256(bytea)`(11 내장)만 쓴다. `pgcrypto` 등 확장을 추가하지 않는다.
- **스키마 파일은 제자리에서 고친다.** `db/schema/014_*.sql`을 만들지 않는다. 검증은 빈 DB 전체 재적용이다 ([`00-decisions`](../../spec/00-decisions.md) §12).
- **`SET CONSTRAINTS ALL IMMEDIATE` 금지.** 지연 제약 트리거 I1·I2가 삽입 순서 의존이 된다 (`R-01-50`). 유일한 예외는 **그 금지를 증명하는 테스트 한 건**이다 (`R-01-52`, Task 9).
- **`op_*`는 애플리케이션 역할로 부른다.** 소유자(`postgres`)로 부르면 RLS와 테이블 권한이 우회되어 GRANT 실수·REVOKE 누락·지점 격리 실패가 초록으로 통과한다. 픽스처 생성만 소유자로 한다.
- **연산 함수는 세 스키마에 있다** — `ledger` 12 · `cage` 8 · `identity` 3. 게임·실사 연산은 `cage.op_*`다. `ledger`만 보면 절반을 놓친다.
- **`op_*` 를 부르는 테스트는 COMMIT 한다.** 잔액 하한(I2) · 차대 균형(I1) · 봉인 트리거가 전부 `DEFERRABLE INITIALLY DEFERRED`라 롤백만 하면 **발화하지 않는다.** 롤백은 DB를 읽기만 하는 테스트에만 쓴다.
- **통화 5종**: `PHP` · `USD` · `HKD` · `CNY` · `KRW`. 컬럼명은 `ledger.currencies.scale`이고 `KRW`는 `scale = 0`이다. 스펙이 `minor_unit`이라 부르는 것이 이 컬럼이다.
- **지점 시드 3행**: `HANN` · `NUSTAR` · `ONLINE`. 현재 `ledger.branches` 컬럼은 `code · name · is_online · active · created_at`이다. `status` · `opened_on`은 a02가 추가한다.
- **`fx_exchange` 없음.** 환전 연산을 만들지도 테스트하지도 않는다.
- **테스트 이름에 `AC-*` / `R-*` ID를 그대로 쓴다** ([`12` §3](../../spec/12-ci-golden-tests.md)).
- **픽스처에 개인정보·실계좌 값을 쓰지 않는다** (`R-12-23`). 직원 코드는 `T-`, 계좌 코드는 `TEST-`로 시작한다.
- **`op_*` 시그니처를 바꾸면 `db/schema/012_roles_and_grants.sql`의 `GRANT EXECUTE` 인자 목록을 같은 커밋에서 바꾼다** (`R-02-24`).

---

## 이 계획이 알고 있어야 할 현재 상태

구현 전에 PostgreSQL 18.6에 실제로 적용해 확인한 사실이다. 추측이 아니다.

| 사실                                  | 값                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity.staff` 시드                 | **0행.** 픽스처가 직접 만든다                                                                                                                                                                         |
| `identity.staff.pin_hash`             | **NOT NULL.** DB는 형식을 강제하지 않는다                                                                                                                                                             |
| `identity.staff.status` 타입          | `ledger.account_status` = `active` \| `suspended` \| `closed`                                                                                                                                         |
| `identity.step_up_tokens.method` 타입 | `identity.auth_method` = `pin` \| `totp` \| `withdraw_pw` \| `approval` \| `system`                                                                                                                   |
| 스텝업 토큰                           | **1회용.** 연산 하나에 토큰 하나. 재사용하면 `step-up token N is already used`                                                                                                                        |
| `op_transfer`                         | `pin` 스텝업을 **거부**한다 — `transfer requires step-up auth, got pin`. `totp`를 쓴다                                                                                                                |
| `account.open` 권한                   | `cage_manager` · `partner_admin`만 가진다. `cage_operator`에는 **없다**                                                                                                                               |
| `ledger.entries`                      | `account_kind` 컬럼이 **없다.** `ledger.accounts.kind`([`003:48`](../../../db/schema/003_accounts.sql))를 `account_id`로 조인해 얻는다. 반환 JSON으로 대신하지 않는다                                 |
| **지연 제약 트리거**                  | 4개 — [`004:390`](../../../db/schema/004_ledger.sql) · `004:439` · `004:561` · [`005:367`](../../../db/schema/005_games_rolling.sql). 전부 `DEFERRABLE INITIALLY DEFERRED`라 **COMMIT 때만 발화한다** |
| 잔액 초과 출금                        | `op_withdraw` **호출은 성공한다.** COMMIT에서 `insufficient balance ...` (`SQLSTATE 23000`)로 실패한다. 롤백만 하는 테스트는 이 회귀를 못 잡는다                                                      |
| 4-eyes                                | **요청자는 자기 요청을 승인할 수 없다** — `four-eyes violation: 요청자(N)는 자기 요청을 승인할 수 없다`. `required_count` 기본 2 → 승인 연산 하나에 직원 **3명**이 필요하다                           |
| `ledger.opening_balance` 권한         | **`migrator` 역할만** 가진다. `cage_manager`에 없다                                                                                                                                                   |
| `op_resolve_suspense` 스텝업 scope    | `ledger.suspense_resolve`다. 함수 이름(`resolve_suspense`)과 **뒤집혀 있다**                                                                                                                          |
| `player_wallet` 계정                  | 만드는 `op_*`가 **없다.** 픽스처가 `ledger.parties` + `ledger.accounts`에 직접 INSERT 한다                                                                                                            |
| `ledger.provision_branch()`           | **아직 없다.** `R-01-05`는 a02의 몫이다. a01 픽스처는 시드 지점 3개를 쓴다                                                                                                                            |
| `ledger_relay` 역할                   | **아직 없다.** a05 · c02의 몫이다                                                                                                                                                                     |

---

## File Structure

| 파일                                                  | 책임                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `db/tests/helpers/db.mjs`                             | 소유자 · 앱 · 이관 세 풀 · 커밋/롤백 래퍼 · SQLSTATE 단언 · 실행별 고유 키                |
| `db/tests/helpers/entries.mjs`                        | `ledger.entries` 조회 → `(account_kind, sign, category)` 정렬 집합                        |
| `db/scripts/test-role.sh`                             | 테스트용 로그인 역할 2종 (`ledger_app` · `ledger_migrator`)                               |
| `db/tests/fixtures/actors.mjs`                        | 테스트 직원 · 지점 배정 · 역할 · 스텝업 토큰                                              |
| `db/tests/fixtures/approvals.mjs`                     | 4-eyes 승인 — `identity.op_request_approval` + `op_cast_vote` 경유                        |
| `db/tests/fixtures/members.mjs`                       | 회원 주체 + 계정 (만드는 `op_*`가 없다)                                                   |
| `db/tests/fixtures/games.mjs`                         | 게임 개설 · 미회수 칩 조회 · 커미션 요율 스냅샷                                           |
| `db/tests/fixtures/scenario.mjs`                      | `withActor` — 소유자로 픽스처, 앱 역할로 `op_*`                                           |
| `db/tests/drift/security.test.js`                     | `v_check_view_security` · `v_check_public_execute` 0행                                    |
| `db/tests/invariants/access.test.js`                  | 앱 역할 경계 — 직접 DML 불가 · 내부 함수 불가 · 지점 격리                                 |
| `db/tests/invariants/deferred.test.js`                | 지연 제약이 COMMIT에서 발화 · `SET CONSTRAINTS` 금지 증명 (`R-01-52`)                     |
| `db/tests/posting/sections.mjs`                       | [`04`](../../architecture/04-posting-rules.md) 절 대장 — 절 ↔ 스키마 한정 `op_*` ↔ 테스트 |
| `db/tests/posting/section-coverage.test.js`           | 함수가 있는데 테스트가 없으면 실패 + **역방향** 미등재 `op_*` 검사                        |
| `db/tests/posting/posting-rules.test.js`              | `ledger.posting_rules` 표 대조 · `tx_kind` 고아 검사                                      |
| `db/tests/posting/section-01-deposit.test.js`         | `04` §1 입금                                                                              |
| `db/tests/posting/section-02-withdraw.test.js`        | `04` §2 출금 + 잔액 하한이 **COMMIT에서** 걸리는 것                                       |
| `db/tests/posting/section-03-transfer.test.js`        | `04` §3 계좌 간 이체 + 통화 시드                                                          |
| `db/tests/posting/section-04-branch-transfer.test.js` | `04` §4 지점 간 이체 (분개별 `entries.branch`가 갈린다)                                   |
| `db/tests/posting/section-05-game-buyin.test.js`      | `04` §5 개설·추가 바이인 + §6 롤링이 원장을 안 건드리는 것                                |
| `db/tests/posting/section-06-1-commission.test.js`    | `04` §6-1 롤링 커미션 (요율 스냅샷)                                                       |
| `db/tests/posting/section-07-08-settle.test.js`       | `04` §7 중간정산 + §8 게임 종료 (미회수 칩 지연 검사)                                     |
| `db/tests/posting/section-09-game-cancel.test.js`     | `04` §9 게임 취소 — 역분개                                                                |
| `db/tests/posting/section-11-adjustment.test.js`      | `04` §11 차액 조정 + §11-2 확정 해소. 두 진입점 대조                                      |
| `db/tests/posting/section-12-wallet-transfer.test.js` | `04` §12 케이지 계좌 ↔ 회원 보유금                                                        |
| `db/tests/posting/section-14-opening-balance.test.js` | `04` §14 기초 잔액 (`ledger_migrator` 전용)                                               |
| `tools/check-line-refs.mjs`                           | 문서의 `index.html:NNNN` 참조가 실제 줄을 가리키는지                                      |
| `.github/workflows/db-golden.yml`                     | PostgreSQL 18 서비스 컨테이너 잡                                                          |

---

## Task 1: 러너 뼈대와 드리프트 검사

**Files:**

- Create: `db/tests/helpers/db.mjs`
- Create: `db/scripts/test-role.sh`
- Create: `db/tests/drift/security.test.js`
- Modify: `package.json` (`scripts` · `devDependencies`)
- Test: `db/tests/drift/security.test.js`

**Interfaces:**

- Consumes: 적용된 스키마의 `ledger.v_check_view_security` · `ledger.v_check_public_execute` (`db/schema/013_reconciliation.sql`)
- Produces: `query(text, params)` · `withRollback(fn, opts)` · `asOwner(fn)` · `asStaff(staffId, fn)` · `asMigrator(staffId, fn)` · `expectCommitFailure(state, fn, opts)` · `expectSqlState(state, fn)` · `uniq(prefix)` · `closePool()` — 이후 모든 테스트가 이것들만 쓴다

**왜 `withRollback` 하나로 안 되는가.** 잔액 하한 · 차대 균형 · 봉인 트리거는 `DEFERRABLE INITIALLY DEFERRED`다. 롤백은 지연 제약을 **발화시키지 않는다.** 실제로 확인한 결과다:

```
잔액 1000 계좌에서 op_withdraw(9999) 호출 → 성공 (반환 JSON 정상)
COMMIT                                   → ERROR: insufficient balance ... (SQLSTATE 23000)
```

롤백만 하는 테스트를 쓰면 잔액 초과 출금을 허용하는 회귀가 **초록으로 통과한다.** `op_*`를 부르는 테스트는 전부 `asStaff`(또는 `asMigrator`)를 쓴다. 커밋한 행은 지우지 않는다 — `ledger.entries` · `ledger.transactions`에는 불변 트리거가 걸려 있어 DELETE 자체가 거부된다. 대신 `uniq()`로 실행마다 다른 키를 쓰고, DB는 매 CI 실행에서 새로 만들어진다 (로컬은 `npm run db:reset`).

- [ ] **Step 1: `pg` 의존성 추가**

```bash
npm install --save-dev pg@^8.13.1
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`db/tests/drift/security.test.js`:

```js
// R-12-05 · AC-12-5 — 매 실행 끝에 두 드리프트 뷰가 0행이어야 한다.
// 한쪽에서 닫고 다른 쪽에서 기본값으로 다시 열리는 병(DR-24)을 잡는 유일한 검사다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, closePool } from '../helpers/db.mjs';

after(closePool);

test('R-12-05 · AC-12-5 정의자 뷰 드리프트 — v_check_view_security 0행', async () => {
  const rows = await query('SELECT * FROM ledger.v_check_view_security');
  assert.deepEqual(rows, [], `security_invoker 가 아닌 뷰가 남아 있다: ${JSON.stringify(rows)}`);
});

test('R-12-05 · AC-12-5 PUBLIC EXECUTE 드리프트 — v_check_public_execute 0행', async () => {
  const rows = await query('SELECT * FROM ledger.v_check_public_execute');
  assert.deepEqual(rows, [], `PUBLIC 에 열린 함수가 남아 있다: ${JSON.stringify(rows)}`);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `node --test db/tests/drift/`
Expected: FAIL — `Cannot find module '.../db/tests/helpers/db.mjs'`

- [ ] **Step 4: 테스트용 로그인 역할 스크립트를 만든다**

`db/scripts/test-role.sh`:

```bash
#!/usr/bin/env bash
# 골든 테스트가 애플리케이션 경로를 검증할 때 쓰는 로그인 역할을 만든다.
#
# 왜 필요한가: db/schema/012_roles_and_grants.sql 은 NOLOGIN 그룹 역할만 만든다.
# 로그인 역할 생성은 운영의 몫으로 주석 처리되어 있다 (012 하단). 테스트 전용
# 로그인 역할을 스키마 파일에 넣지 않고 여기서 만든다.
#
# 이 역할이 없으면 테스트가 소유자(postgres)로 붙고, 그러면 RLS 와 테이블 권한이
# 전부 우회되어 GRANT 실수·REVOKE 누락·지점 격리 실패가 초록으로 통과한다.
#
# 역할이 둘인 이유: ledger.op_load_opening_balance 의 EXECUTE 는 ledger_migrator
# 에만 있고 ledger_app 에는 없다. 하나로 합치면 그 경계가 사라진다.
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=55432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=cage}"
: "${PGAPPUSER:=cage_test_app}"
: "${PGMIGUSER:=cage_test_migrator}"
: "${PGAPPPASSWORD:=devonly}"
export PGHOST PGPORT PGUSER PGDATABASE

psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc \
  -v app_user="${PGAPPUSER}" -v mig_user="${PGMIGUSER}" -v app_pw="${PGAPPPASSWORD}" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_pw');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'mig_user') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'mig_user', :'app_pw');
  END IF;
END $$;
GRANT ledger_app, identity_app TO :"app_user";
GRANT ledger_migrator          TO :"mig_user";
SQL

echo "OK: roles ${PGAPPUSER} (ledger_app, identity_app) and ${PGMIGUSER} (ledger_migrator) ready"
```

```bash
chmod +x db/scripts/test-role.sh
```

- [ ] **Step 5: 헬퍼를 만든다**

`db/tests/helpers/db.mjs`:

```js
// 골든 테스트 공용 커넥션 헬퍼.
//
// 풀이 둘이다. 하나로는 이 하니스가 지켜야 할 것을 못 지킨다:
//
//   소유자 풀 (postgres) — 스키마 적용과 픽스처 생성. RLS 와 테이블 권한을 우회한다.
//   앱 풀 (cage_test_app, ledger_app 상속) — op_* 호출. 실제 애플리케이션이 붙는 방식.
//
// 소유자로 op_* 를 부르면 GRANT EXECUTE 누락 · REVOKE 누락 · 지점 격리 실패가
// 전부 통과한다. 검사해야 할 경계 바깥에서 검사하는 셈이다.
// 확인한 사실: 앱 역할은 ledger.entries 에 INSERT 불가, ledger.post_transaction
// 실행 불가, 그리고 app.staff_id 가 가리키는 직원의 지점 분개만 보인다.
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

// 애플리케이션 역할(ledger_app · identity_app). 대부분의 op_* 호출.
export const appPool = new Pool({
  ...base,
  user: process.env.PGAPPUSER ?? 'cage_test_app',
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
  await Promise.all([ownerPool.end(), appPool.end(), migratorPool.end()]);
}
```

- [ ] **Step 6: npm 스크립트를 더한다**

`package.json`의 `scripts`에서 `docs:check-links` 줄 다음에 추가한다:

```json
    "db:test-role": "bash db/scripts/test-role.sh",
    "test:db": "node --test --test-concurrency=1 db/tests/",
```

`--test-concurrency=1`은 필수다. `node --test`는 기본으로 파일을 **병렬 실행한다.** 테스트가 커밋하므로 `ledger.suspense` 같은 지점 공유 계정을 두 파일이 동시에 건드리면 결과가 실행마다 달라진다.

- [ ] **Step 7: 통과를 확인한다**

```bash
PGPASSWORD=devonly npm run db:test-role
PGPASSWORD=devonly npm run test:db
```

Expected: `OK: role cage_test_app ready`, 그다음 `# pass 2` · `# fail 0`

- [ ] **Step 8: 커밋**

```bash
git add package.json package-lock.json db/scripts/test-role.sh db/tests/helpers/db.mjs db/tests/drift/security.test.js
git commit -m "test(db): add golden test harness and drift checks (R-12-05)"
```

---

## Task 2: 행위자 · 승인 · 회원 픽스처

**Files:**

- Create: `db/tests/fixtures/actors.mjs`
- Create: `db/tests/fixtures/approvals.mjs`
- Create: `db/tests/fixtures/members.mjs`
- Create: `db/tests/fixtures/scenario.mjs`
- Create: `db/tests/fixtures/actors.test.js`
- Test: `db/tests/fixtures/actors.test.js`

**Interfaces:**

- Consumes: `asOwner`, `asStaff`, `asMigrator`, `withRollback`, `uniq`, `closePool` (Task 1)
- Produces:
  - `createStaff(client, {code, branches, roles}) -> Promise<number>` — `branches`는 배열이다. 지점 간 이체는 양쪽 지점 배정이 필요하다
  - `issueStepUp(client, {staffId, deviceId, scope, method}) -> Promise<number>`
  - `approve(client, {actor, approvers, branch, subjectKind, subjectRef, payload, deviceId}) -> Promise<number>` — `identity.op_request_approval` + `op_cast_vote`를 거쳐 소비 가능한 승인 id를 돌려준다
  - `createMember(client, {code, branch, currency, kinds}) -> Promise<number>`
  - `withActor(options, act) -> Promise<T>` — 소유자로 픽스처를 만들고, 앱 역할(`as: 'migrator'`면 이관 역할)로 `act`를 돌린다

**픽스처는 소유자, `op_*`는 앱 역할.** `identity.staff` · `ledger.parties` 삽입은 앱 역할 권한 밖이다(확인함: `permission denied for table entries`와 같은 계열). 커넥션이 다르므로 **한 트랜잭션에 담을 수 없다.** 이미 전부 커밋하는 구조라 문제되지 않는다 — `withActor`가 이 두 단계를 감춘다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/fixtures/actors.test.js`:

```js
// 픽스처 자체의 계약. 이것이 깨지면 뒤 테스트의 실패 원인이 픽스처인지 연산인지 알 수 없다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, withRollback, uniq, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from './actors.mjs';
import { approve } from './approvals.mjs';

after(closePool);

test('R-12-23 픽스처 직원이 권한 검사를 통과한다', async () => {
  await withRollback(async (client) => {
    const staffId = await createStaff(client, {
      code: uniq('T-MGR'),
      branches: ['HANN'],
      roles: ['cage_manager'],
    });
    const { rows } = await client.query("SELECT identity.assert_actor_authorized($1, 'HANN', 'account.open') AS ok", [
      staffId,
    ]);
    assert.equal(rows.length, 1);
  });
});

test('R-12-23 스텝업 토큰은 1회용이다', async () => {
  await withRollback(async (client) => {
    const device = uniq('dev');
    const staffId = await createStaff(client, {
      code: uniq('T-MGR'),
      branches: ['HANN'],
      roles: ['cage_manager'],
    });
    const tokenId = await issueStepUp(client, { staffId, deviceId: device, scope: 'ledger.deposit' });
    await client.query('SELECT identity.consume_step_up($1, $2, $3, $4)', [tokenId, staffId, device, 'ledger.deposit']);
    await assert.rejects(
      () =>
        client.query('SELECT identity.consume_step_up($1, $2, $3, $4)', [tokenId, staffId, device, 'ledger.deposit']),
      /already used/
    );
  });
});

test('R-12-23 승인 픽스처가 실제 승인 경로를 거친다', async () => {
  await asOwner(async (client) => {
    const branch = 'HANN';
    const actor = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    const a = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    const b = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });

    const approvalId = await approve(client, {
      actor,
      approvers: [a, b],
      branch,
      subjectKind: 'adjustment',
      subjectRef: uniq('adj'),
      payload: { branch, variance_minor: 7000, currency: 'PHP' },
      deviceId: uniq('dev'),
    });

    const { rows } = await client.query(
      `SELECT count(*)::int AS votes FROM identity.approval_votes
        WHERE approval_id = $1 AND decision = 'approve'`,
      [approvalId]
    );
    assert.equal(rows[0].votes, 2);
  });
});

test('R-12-23 요청자는 자기 요청에 투표할 수 없다 (4-eyes)', async () => {
  await asOwner(async (client) => {
    const branch = 'HANN';
    const actor = await createStaff(client, { code: uniq('T-MGR'), branches: [branch], roles: ['cage_manager'] });
    await assert.rejects(
      () =>
        approve(client, {
          actor,
          approvers: [actor],
          branch,
          subjectKind: 'adjustment',
          subjectRef: uniq('adj'),
          payload: { branch, variance_minor: 1000, currency: 'PHP' },
          deviceId: uniq('dev'),
        }),
      /요청자는 승인자가 될 수 없다/
    );
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/fixtures/`
Expected: FAIL — `Cannot find module '.../db/tests/fixtures/actors.mjs'`

- [ ] **Step 3: 행위자 픽스처를 만든다**

`db/tests/fixtures/actors.mjs`:

```js
// 테스트 전용 행위자. 개인정보·실계좌 값을 쓰지 않는다 (R-12-23).
// 직원 코드는 T- 로 시작한다. pin_hash 는 NOT NULL 이라 합성 문자열을 넣는다 —
// DB 는 형식을 강제하지 않고, 애플리케이션이 Argon2id 로 해시해 넣는 자리다.
const FIXTURE_PIN_HASH = '$argon2id$test-fixture-not-a-real-hash';

// branches 는 배열이다. cage.op_branch_transfer 는 보내는 지점과 받는 지점 양쪽에
// 배정된 직원을 요구한다 — 한쪽만 주면 staff N is not assigned to branch X 로 거부된다.
// app.staff_id 기반 RLS 도 이 표를 읽는다 (ledger.current_branches()).
export async function createStaff(client, { code, branches, roles = ['cage_operator'] }) {
  const { rows } = await client.query(
    `INSERT INTO identity.staff (code, name, principal_type, status, pin_hash)
     VALUES ($1, $2, 'cage_staff', 'active', $3)
     RETURNING id`,
    [code, `TEST ${code}`, FIXTURE_PIN_HASH]
  );
  const staffId = rows[0].id;

  for (const branch of branches) {
    await client.query('INSERT INTO identity.staff_branches (staff_id, branch) VALUES ($1, $2)', [staffId, branch]);
  }
  for (const role of roles) {
    await client.query('INSERT INTO identity.staff_roles (staff_id, role_code) VALUES ($1, $2)', [staffId, role]);
  }
  return staffId;
}

// 스텝업 토큰은 1회용이다. op_* 호출 하나에 토큰 하나를 발급한다.
// op_transfer 처럼 pin 을 거부하는 연산이 있으므로 method 를 호출부가 정한다.
export async function issueStepUp(client, { staffId, deviceId, scope, method = 'pin' }) {
  const { rows } = await client.query(
    `INSERT INTO identity.step_up_tokens (staff_id, method, device_id, scope, expires_at)
     VALUES ($1, $2, $3, $4, clock_timestamp() + interval '30 minutes')
     RETURNING id`,
    [staffId, method, deviceId, scope]
  );
  return rows[0].id;
}

export { approve } from './approvals.mjs';
export { createMember } from './members.mjs';
```

- [ ] **Step 4: 승인 픽스처를 만든다**

`db/tests/fixtures/approvals.mjs`:

```js
// 4-eyes 승인 픽스처.
//
// identity.approvals · approval_votes 에 직접 INSERT 하지 않는다.
// identity.op_request_approval() + op_cast_vote() 를 거친다 — 실제 승인 경로를
// 우회하는 픽스처는 그 경로가 망가져도 알려주지 못한다.
// (db/README.md 가 provision_branch 우회를 금지한 것과 같은 이유다.)
//
// 반드시 지켜야 소비된다:
//  1. payload 가 op_* 내부의 v_args 와 **정확히 같아야** 한다. 키 하나만 달라도
//     approval N payload does not match the request being executed 로 거부된다.
//  2. 요청자는 자기 요청에 투표할 수 없다. required_count 가 기본 2 이므로
//     요청자 1 + 승인자 2 = 직원 3명이 필요하다.
//  3. 투표에도 스텝업이 필요하다. scope 는 'approval.vote' 다.
import { issueStepUp } from './actors.mjs';

export async function approve(client, { actor, approvers, branch, subjectKind, subjectRef, payload, deviceId }) {
  if (approvers.includes(actor)) {
    throw new Error('요청자는 승인자가 될 수 없다 — 픽스처가 four-eyes 를 우회하려 한다');
  }

  const { rows } = await client.query('SELECT identity.op_request_approval($1, $2, $3, $4, $5) AS result', [
    actor,
    branch,
    subjectKind,
    subjectRef,
    payload,
  ]);
  const approvalId = Number(rows[0].result.approval_id);

  for (const staffId of approvers) {
    const tokenId = await issueStepUp(client, { staffId, deviceId, scope: 'approval.vote', method: 'totp' });
    await client.query('SELECT identity.op_cast_vote($1, $2, $3, $4, $5)', [
      staffId,
      approvalId,
      'approve',
      tokenId,
      deviceId,
    ]);
  }
  return approvalId;
}
```

- [ ] **Step 5: 회원 픽스처를 만든다**

`db/tests/fixtures/members.mjs`:

```js
// 회원 주체와 계정을 만드는 op_* 가 없다. §12 wallet_transfer 는 player_wallet 을,
// §5 game_buyin 은 member_deposit 을 전제하므로 픽스처가 직접 만든다.
//
// normal_balance 는 'credit' 이어야 한다 — accounts 의 kind ↔ normal_balance
// 조합 검사 트리거(003)가 어긋난 조합을 거부한다.
export async function createMember(client, { code, branch, currency = 'PHP', kinds = ['member_deposit'] }) {
  const { rows } = await client.query(
    `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
     VALUES ($1, 'member', $2, $3)
     RETURNING id`,
    [code, `TEST ${code}`, branch]
  );
  const partyId = rows[0].id;

  for (const kind of kinds) {
    await client.query(
      `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance)
       VALUES ($1, $2, $3, 'credit')`,
      [partyId, kind, currency]
    );
  }
  return partyId;
}
```

- [ ] **Step 6: 시나리오 래퍼를 만든다**

`db/tests/fixtures/scenario.mjs`:

```js
// 픽스처는 소유자 커넥션으로, op_* 호출은 앱 역할 커넥션으로 돈다.
// 커넥션이 다르므로 두 트랜잭션이다. 전부 커밋하는 구조라 문제되지 않는다.
//
// 이 래퍼를 거치지 않고 소유자로 op_* 를 부르면 GRANT EXECUTE 누락 ·
// 지점 격리 실패가 전부 통과한다. 검사할 경계 바깥에서 검사하는 셈이다.
import { asOwner, asStaff, asMigrator, uniq } from '../helpers/db.mjs';
import { createStaff } from './actors.mjs';

// as: 'app'(기본) 또는 'migrator'. §14 만 migrator 를 쓴다 —
// ledger.op_load_opening_balance 의 EXECUTE 가 ledger_migrator 에만 있다.
export async function withActor({ branches = ['HANN'], roles = ['cage_manager'], setup, as = 'app' } = {}, act) {
  const ctx = await asOwner(async (client) => {
    const staffId = await createStaff(client, { code: uniq('T-MGR'), branches, roles });
    const extra = setup ? await setup(client, { staffId }) : {};
    return { staffId, device: uniq('dev'), branch: branches[0], ...extra };
  });
  const run = as === 'migrator' ? asMigrator : asStaff;
  return run(ctx.staffId, (client) => act(client, ctx));
}
```

- [ ] **Step 7: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/fixtures/`
Expected: PASS — `# pass 4` · `# fail 0`

- [ ] **Step 8: 커밋**

```bash
git add db/tests/fixtures/
git commit -m "test(db): add actor, approval, member, and scenario fixtures (R-12-23)"
```

---

## Task 3: 저장된 분개 단언과 `04` §1 입금 계약

**Files:**

- Create: `db/tests/helpers/entries.mjs`
- Create: `db/tests/posting/section-01-deposit.test.js`
- Test: `db/tests/posting/section-01-deposit.test.js`

**Interfaces:**

- Consumes: `asStaff`, `uniq`, `closePool` (Task 1) · `issueStepUp`, `withActor` (Task 2)
- Produces:
  - `entryRowsOf(client, opResult) -> Promise<Array<{account_kind, sign, category, amount_minor, branch}>>` — 저장된 `ledger.entries` 행
  - `entriesOf(client, opResult) -> Promise<Array<[account_kind, sign, category]>>` — 위에서 삼중항만 뽑은 것. `04`의 절 표와 그대로 비교한다

**왜 반환 JSON을 안 보는가.** `R-12-02`는 **`ledger.entries`의** `(account_kind, sign, category)`를 비교하라고 쓰여 있다. 반환 JSON은 `ledger.tx_response()`가 조립한 **함수의 자기 보고서**다. 저장이 어긋나도, 분개가 빠져도, `tx_response`만 옳으면 초록이 된다. 검사 대상은 DB에 남은 행이다.

**앱 역할로 읽는다.** 조회도 `asStaff` 안에서 한다. RLS가 `app.staff_id`의 지점으로 분개를 거르므로, 자기가 방금 만든 거래가 안 보이면 그것도 결함이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/posting/section-01-deposit.test.js`:

```js
// R-12-02 · AC-12-2 — 04-posting-rules.md §1 입금.
// 그 절의 표: house_cash +deposit_cash / member_deposit −deposit_cash
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entriesOf, entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §1 입금 분개 집합', async () => {
  await withActor({ branches: ['HANN'], roles: ['cage_manager'] }, async (client, ctx) => {
    const acct = uniq('TEST-ACC');
    await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
      uniq('open'),
      ctx.staffId,
      ctx.branch,
      acct,
      'TEST ACCOUNT',
    ]);
    const tokenId = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('dep'),
      ctx.staffId,
      tokenId,
      ctx.device,
      ctx.branch,
      acct,
      100000,
    ]);
    const result = rows[0].result;

    assert.deepEqual(await entriesOf(client, result), [
      ['house_cash', 1, 'deposit_cash'],
      ['member_deposit', -1, 'deposit_cash'],
    ]);

    // 금액도 본다. 부호만 맞고 금액이 어긋나는 회귀는 삼중항으로 안 잡힌다.
    const byKind = Object.fromEntries((await entryRowsOf(client, result)).map((r) => [r.account_kind, r.amount_minor]));
    assert.equal(byKind.house_cash, 100000n);
    assert.equal(byKind.member_deposit, -100000n);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/posting/`
Expected: FAIL — `Cannot find module '.../db/tests/helpers/entries.mjs'`

- [ ] **Step 3: 단언 헬퍼를 만든다**

`db/tests/helpers/entries.mjs`:

```js
// 저장된 분개를 읽는다. op_* 반환 JSON 이 아니라 ledger.entries 를 본다 (R-12-02).
//
// ledger.entries 에 account_kind 컬럼은 없다. ledger.accounts.kind 를
// account_id 로 조인해 얻는다 — 반환 JSON 의 entries[].kind 로 대신하지 않는다.
// 그렇게 하면 tx_response 가 옳고 저장이 틀린 결함을 못 잡는다.
//
// 호출자의 커넥션을 그대로 쓴다. 앱 역할 커넥션이면 RLS 가 함께 걸린다.
const ENTRY_SQL = `
  SELECT a.kind::text              AS account_kind,
         sign(e.amount_minor)::int AS sign,
         e.category::text          AS category,
         e.amount_minor,
         e.branch
    FROM ledger.entries e
    JOIN ledger.transactions t ON t.id = e.transaction_id
    JOIN ledger.accounts     a ON a.id = e.account_id
   WHERE t.external_id = $1
   ORDER BY a.kind, e.category, sign(e.amount_minor)`;

export async function entryRowsOf(client, opResult) {
  const externalId = opResult?.transaction?.external_id;
  if (!externalId) {
    throw new Error(`op 반환 JSON 에 transaction.external_id 가 없다: ${JSON.stringify(opResult)}`);
  }
  const { rows } = await client.query(ENTRY_SQL, [externalId]);
  if (rows.length === 0) {
    throw new Error(`거래 ${externalId} 의 분개가 저장되어 있지 않다 (또는 RLS 로 안 보인다)`);
  }
  return rows.map((r) => ({ ...r, amount_minor: BigInt(r.amount_minor) }));
}

// 04 의 절 표와 그대로 비교할 삼중항. 금액은 부호만 본다.
export async function entriesOf(client, opResult) {
  const rows = await entryRowsOf(client, opResult);
  return rows.map((r) => [r.account_kind, r.sign, r.category]);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/posting/`
Expected: PASS — `# pass 1` · `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add db/tests/helpers/entries.mjs db/tests/posting/section-01-deposit.test.js
git commit -m "test(db): assert persisted posting contract for 04 section 1 (R-12-02)"
```

---

## Task 4: `04` §3 이체 계약과 통화 시드

**Files:**

- Create: `db/tests/posting/section-03-transfer.test.js`
- Test: `db/tests/posting/section-03-transfer.test.js`

**Interfaces:**

- Consumes: `withRollback`, `query`, `uniq`, `closePool` (Task 1) · `issueStepUp`, `withActor` (Task 2) · `entriesOf` (Task 3)
- Produces: 없음 (검증 전용)

- [ ] **Step 1: 테스트를 쓴다**

`db/tests/posting/section-03-transfer.test.js`:

```js
// R-12-02 04 §3 계좌 간 이체 + R-12-21 통화 사각.
// op_transfer 는 pin 스텝업을 거부한다 — totp 를 쓴다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entriesOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §3 계좌 간 이체 분개 집합', async () => {
  await withActor({}, async (client, ctx) => {
    const from = uniq('TEST-ACC');
    const to = uniq('TEST-ACC');
    for (const code of [from, to]) {
      await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
        uniq('open'),
        ctx.staffId,
        ctx.branch,
        code,
        `TEST ACCOUNT ${code}`,
      ]);
    }

    const depositToken = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7)', [
      uniq('dep'),
      ctx.staffId,
      depositToken,
      ctx.device,
      ctx.branch,
      from,
      100000,
    ]);

    const transferToken = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.transfer',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_transfer($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
      uniq('xfer'),
      ctx.staffId,
      transferToken,
      ctx.device,
      ctx.branch,
      from,
      to,
      30000,
    ]);

    assert.deepEqual(await entriesOf(client, rows[0].result), [
      ['member_deposit', -1, 'transfer_in'],
      ['member_deposit', 1, 'transfer_out'],
    ]);
  });
});

test('R-12-02 op_transfer 가 pin 스텝업을 거부한다', async () => {
  await withActor({}, async (client, ctx) => {
    const from = uniq('TEST-ACC');
    const to = uniq('TEST-ACC');
    for (const code of [from, to]) {
      await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
        uniq('open'),
        ctx.staffId,
        ctx.branch,
        code,
        `TEST ACCOUNT ${code}`,
      ]);
    }
    const pinToken = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.transfer',
      method: 'pin',
    });
    await assert.rejects(
      () =>
        client.query('SELECT ledger.op_transfer($1, $2, $3, $4, $5, $6, $7, $8)', [
          uniq('xfer'),
          ctx.staffId,
          pinToken,
          ctx.device,
          ctx.branch,
          from,
          to,
          1000,
        ]),
      /requires step-up auth, got pin/
    );
  });
});

test('R-12-21 통화 5종이 시드되어 있고 KRW 는 scale = 0 이다', async () => {
  const rows = await query('SELECT code, scale FROM ledger.currencies ORDER BY code');
  assert.deepEqual(
    rows.map((r) => r.code),
    ['CNY', 'HKD', 'KRW', 'PHP', 'USD']
  );
  assert.equal(rows.find((r) => r.code === 'KRW').scale, 0);
});
```

- [ ] **Step 2: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/posting/`
Expected: PASS — `# pass 4` · `# fail 0`

- [ ] **Step 3: 커밋**

```bash
git add db/tests/posting/section-03-transfer.test.js
git commit -m "test(db): assert posting contract for 04 section 3 transfer (R-12-02, R-12-21)"
```

---

## Task 5: `04` §2 출금과 §4 지점 간 이체

**Files:**

- Create: `db/tests/posting/section-02-withdraw.test.js`
- Create: `db/tests/posting/section-04-branch-transfer.test.js`
- Test: 위 두 파일

**Interfaces:**

- Consumes: `expectCommitFailure`, `uniq`, `closePool` (Task 1) · `issueStepUp`, `withActor` (Task 2) · `entriesOf`, `entryRowsOf` (Task 3)
- Produces: 없음 (검증 전용)

**왜 지금인가.** `ledger.op_withdraw` · `ledger.op_branch_transfer`는 **이미 스키마에 있다** ([`009_operations_money.sql:187`](../../../db/schema/009_operations_money.sql) · `:327`). `R-12-02`는 분개를 만드는 절마다 테스트를 요구하고, 함수가 있으면 미룰 근거가 없다.

- [ ] **Step 1: 출금 테스트를 쓴다**

`db/tests/posting/section-02-withdraw.test.js`:

```js
// R-12-02 04 §2 출금.
//   그 절의 표: member_deposit +withdraw_cash / house_cash −withdraw_cash
//
// 두 번째 테스트가 이 파일의 핵심이다. 잔액 하한(I2)은 지연 제약이라
// op_withdraw 호출 자체는 성공한다. COMMIT 에서만 걸린다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, expectCommitFailure, uniq, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entriesOf, entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

// 계좌를 열고 amount 만큼 입금한다. 앱 역할 커넥션 안에서 돈다.
async function fundedAccount(client, ctx, { amount }) {
  const acct = uniq('TEST-ACC');
  await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
    uniq('open'),
    ctx.staffId,
    ctx.branch,
    acct,
    'TEST ACCOUNT',
  ]);
  if (amount > 0) {
    const token = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7)', [
      uniq('dep'),
      ctx.staffId,
      token,
      ctx.device,
      ctx.branch,
      acct,
      amount,
    ]);
  }
  return acct;
}

test('R-12-02 · AC-12-2 04 §2 출금 분개 집합', async () => {
  await withActor({}, async (client, ctx) => {
    const acct = await fundedAccount(client, ctx, { amount: 100000 });
    const token = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.withdraw',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_withdraw($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('wd'),
      ctx.staffId,
      token,
      ctx.device,
      ctx.branch,
      acct,
      30000,
    ]);
    const result = rows[0].result;

    assert.deepEqual(await entriesOf(client, result), [
      ['house_cash', -1, 'withdraw_cash'],
      ['member_deposit', 1, 'withdraw_cash'],
    ]);

    const byKind = Object.fromEntries((await entryRowsOf(client, result)).map((r) => [r.account_kind, r.amount_minor]));
    assert.equal(byKind.member_deposit, 30000n);
    assert.equal(byKind.house_cash, -30000n);
  });
});

test('R-12-02 잔액을 초과한 출금은 COMMIT 에서 거부된다 (I2, 지연 제약)', async () => {
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniq('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
  const device = uniq('dev');

  const err = await expectCommitFailure(
    '23000',
    async (client) => {
      const ctx = { staffId, device, branch: 'HANN' };
      const acct = await fundedAccount(client, ctx, { amount: 1000 });
      const token = await issueStepUp(client, {
        staffId,
        deviceId: device,
        scope: 'ledger.withdraw',
        method: 'totp',
      });
      // 이 호출은 성공한다. 그게 요점이다 — 롤백하는 테스트는 여기서 끝나 아무것도 못 잡는다.
      await client.query('SELECT ledger.op_withdraw($1, $2, $3, $4, $5, $6, $7)', [
        uniq('wd'),
        staffId,
        token,
        device,
        'HANN',
        acct,
        9999,
      ]);
    },
    { staffId }
  );
  assert.match(err.message, /insufficient balance/);
});
```

- [ ] **Step 2: 지점 간 이체 테스트를 쓴다**

`db/tests/posting/section-04-branch-transfer.test.js`:

```js
// R-12-02 04 §4 지점 간 이체.
//   그 절의 표: house_cash[to] +branch_transfer_in / house_cash[from] −branch_transfer_out
//
// 계정 종류가 양쪽 다 house_cash 라서 (kind, sign, category) 삼중항으로만
// 구분된다. entries.branch 가 갈리는 것도 함께 본다 — 그 절이 명시적으로
// "받는 쪽 분개가 받는 지점 소속이어야 RLS 로 보인다" 라고 요구한다.
// 행위자를 양쪽 지점에 배정하는 이유이기도 하다: RLS 가 app.staff_id 의
// 지점 목록으로 분개를 거르므로, 한쪽만 배정하면 받는 쪽 분개가 안 보인다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entriesOf, entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §4 지점 간 이체 분개 집합', async () => {
  await withActor({ branches: ['HANN', 'NUSTAR'] }, async (client, ctx) => {
    const acct = uniq('TEST-ACC');

    // 보내는 지점 금고에 현금을 만든다. house_cash 도 하한이 걸려 있다.
    await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
      uniq('open'),
      ctx.staffId,
      'HANN',
      acct,
      'TEST ACCOUNT',
    ]);
    const depToken = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7)', [
      uniq('dep'),
      ctx.staffId,
      depToken,
      ctx.device,
      'HANN',
      acct,
      100000,
    ]);

    const btToken = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.branch_transfer',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_branch_transfer($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('bt'),
      ctx.staffId,
      btToken,
      ctx.device,
      'HANN',
      'NUSTAR',
      20000,
    ]);
    const result = rows[0].result;

    assert.deepEqual(await entriesOf(client, result), [
      ['house_cash', 1, 'branch_transfer_in'],
      ['house_cash', -1, 'branch_transfer_out'],
    ]);

    const byCategory = Object.fromEntries((await entryRowsOf(client, result)).map((r) => [r.category, r]));
    assert.equal(byCategory.branch_transfer_in.branch, 'NUSTAR');
    assert.equal(byCategory.branch_transfer_out.branch, 'HANN');
    assert.equal(byCategory.branch_transfer_in.amount_minor, 20000n);
    assert.equal(byCategory.branch_transfer_out.amount_minor, -20000n);
  });
});
```

- [ ] **Step 3: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/posting/`
Expected: PASS — `# pass 7` · `# fail 0`

- [ ] **Step 4: 커밋**

```bash
git add db/tests/posting/section-02-withdraw.test.js db/tests/posting/section-04-branch-transfer.test.js
git commit -m "test(db): assert posting contracts for 04 sections 2 and 4 (R-12-02)"
```

---

## Task 6: `04` §11 차액 조정과 §11-2 확정 해소

**Files:**

- Create: `db/tests/posting/section-11-adjustment.test.js`
- Test: `db/tests/posting/section-11-adjustment.test.js`

**Interfaces:**

- Consumes: `asOwner`, `asStaff`, `uniq`, `closePool` (Task 1) · `createStaff`, `issueStepUp`, `approve` (Task 2) · `entriesOf` (Task 3)
- Produces: 없음 (검증 전용)

**한 파일에 두 절을 넣는 이유.** `op_resolve_suspense`는 금액을 인자로 받지 않는다. **현재 `suspense` 잔액을 직접 읽어** 그만큼을 해소한다 ([`04` §11-2](../../architecture/04-posting-rules.md) "금액을 호출자가 정하지 않는다"). 두 테스트를 나누면 §11-2가 보는 잔액이 §11이 만든 것인지 다른 테스트가 남긴 것인지 알 수 없다. 한 흐름에서 만들고 바로 해소한다.

**`cage.op_record_balancing`도 §11을 만든다.** 실사 카운트를 기록하면서 차액이 있으면 같은 `adjustment` 분개를 낸다([`011_operations_admin.sql:193`](../../../db/schema/011_operations_admin.sql)). 두 진입점 중 `ledger.op_adjustment`만 계약을 검사하면 나머지 하나가 드리프트한다 — 세 번째 테스트가 두 경로의 분개 집합이 같은지 본다.

- [ ] **Step 1: 테스트를 쓴다**

`db/tests/posting/section-11-adjustment.test.js`:

```js
// R-12-02 04 §11 밸런싱 차액 조정 + §11-2 차액 확정 해소.
//
// 둘 다 4-eyes 가 무조건 필수다. 승인 payload 는 op_* 내부의 v_args 와
// 정확히 같아야 하고, 요청자는 자기 요청에 투표할 수 없다 — 직원 3명이 필요하다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, asStaff, uniq, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp, approve } from '../fixtures/actors.mjs';
import { entriesOf } from '../helpers/entries.mjs';

after(closePool);

const BRANCH = 'HANN';

// 승인 연산 하나에 직원 3명. 요청자는 투표할 수 없다.
async function threeStaff() {
  return asOwner(async (client) => {
    const make = () => createStaff(client, { code: uniq('T-MGR'), branches: [BRANCH], roles: ['cage_manager'] });
    return { actor: await make(), approverA: await make(), approverB: await make() };
  });
}

test('R-12-02 · AC-12-2 04 §11 현금 과잉 조정 → §11-2 과잉분 확정', async () => {
  const { actor, approverA, approverB } = await threeStaff();
  const device = uniq('dev');
  const variance = 5000; // 양수 = 실사 > 시스템 = 과잉

  // 승인은 소유자 커넥션에서 미리 만든다. op_* 는 다음 트랜잭션에서 소비한다.
  const { adjApproval, resApproval } = await asOwner(async (client) => ({
    adjApproval: await approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'adjustment',
      subjectRef: uniq('adj'),
      // op_adjustment 의 v_args 와 키·값이 정확히 같아야 한다.
      payload: { branch: BRANCH, variance_minor: variance, currency: 'PHP' },
      deviceId: device,
    }),
    resApproval: await approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'suspense_resolve',
      subjectRef: uniq('res'),
      // op_resolve_suspense 의 v_args 에는 금액이 없다 — 잔액을 직접 읽기 때문이다.
      payload: { branch: BRANCH, currency: 'PHP' },
      deviceId: device,
    }),
  }));

  await asStaff(actor, async (client) => {
    // ---- §11 조정 ----
    const adjToken = await issueStepUp(client, {
      staffId: actor,
      deviceId: device,
      scope: 'ledger.adjustment',
      method: 'totp',
    });
    const adj = await client.query('SELECT ledger.op_adjustment($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('adj'),
      actor,
      adjToken,
      device,
      BRANCH,
      variance,
      adjApproval,
    ]);

    assert.deepEqual(await entriesOf(client, adj.rows[0].result), [
      ['house_cash', 1, 'adjustment'],
      ['suspense', -1, 'adjustment'],
    ]);

    // ---- §11-2 확정 해소 ----
    // 스텝업 scope 는 함수 이름과 뒤집혀 있다: ledger.suspense_resolve
    const resToken = await issueStepUp(client, {
      staffId: actor,
      deviceId: device,
      scope: 'ledger.suspense_resolve',
      method: 'totp',
    });
    const res = await client.query('SELECT ledger.op_resolve_suspense($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('res'),
      actor,
      resToken,
      device,
      BRANCH,
      'test finding: 실사 과잉분 확정',
      resApproval,
    ]);

    assert.deepEqual(await entriesOf(client, res.rows[0].result), [
      ['overage_income', -1, 'suspense_resolve_in'],
      ['suspense', 1, 'suspense_resolve_out'],
    ]);

    // 해소 후 suspense 잔액은 정확히 0 이어야 한다 (§11-2 규약).
    const { rows: bal } = await client.query(
      `SELECT COALESCE(sum(e.amount_minor), 0)::bigint AS balance
         FROM ledger.entries e
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE a.kind = 'suspense' AND e.branch = $1`,
      [BRANCH]
    );
    assert.equal(BigInt(bal[0].balance), 0n);
  });
});

test('R-12-02 cage.op_record_balancing 이 §11 과 같은 분개를 낸다', async () => {
  const { actor, approverA, approverB } = await threeStaff();
  const device = uniq('dev');
  const counted = 108000;
  const system = 100000;
  const variance = counted - system;

  const approvalId = await asOwner((client) =>
    approve(client, {
      actor,
      approvers: [approverA, approverB],
      branch: BRANCH,
      subjectKind: 'adjustment',
      subjectRef: uniq('bal'),
      payload: { branch: BRANCH, variance_minor: variance, currency: 'PHP' },
      deviceId: device,
    })
  );

  await asStaff(actor, async (client) => {
    const token = await issueStepUp(client, {
      staffId: actor,
      deviceId: device,
      scope: 'cage.balancing',
      method: 'totp',
    });
    const { rows } = await client.query(
      'SELECT cage.op_record_balancing($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS result',
      [
        uniq('bal'),
        actor,
        token,
        device,
        BRANCH,
        'cash',
        JSON.stringify({ 1000: counted / 1000 }),
        counted,
        system,
        approverA,
        approvalId,
      ]
    );

    assert.deepEqual(await entriesOf(client, rows[0].result), [
      ['house_cash', 1, 'adjustment'],
      ['suspense', -1, 'adjustment'],
    ]);
  });
});
```

**주의:** `cage.op_record_balancing`의 스텝업 `scope`와 인자 순서는 구현 시점에 `\df cage.op_record_balancing`으로 다시 확인한다. 위 값은 [`011_operations_admin.sql:136`](../../../db/schema/011_operations_admin.sql) 기준이며, 이 절에서 검사하는 것은 **분개 집합이 `ledger.op_adjustment`와 같다**는 사실이다.

- [ ] **Step 2: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/posting/`
Expected: PASS — `# pass 9` · `# fail 0`

- [ ] **Step 3: 커밋**

```bash
git add db/tests/posting/section-11-adjustment.test.js
git commit -m "test(db): assert posting contracts for 04 sections 11 and 11-2 (R-12-02)"
```

---

## Task 7: `04` §12 보유금 이체와 §14 기초 잔액

**Files:**

- Create: `db/tests/posting/section-12-wallet-transfer.test.js`
- Create: `db/tests/posting/section-14-opening-balance.test.js`
- Test: 위 두 파일

**Interfaces:**

- Consumes: `asStaff`, `uniq`, `closePool` (Task 1) · `issueStepUp`, `createMember`, `withActor` (Task 2) · `entriesOf`, `entryRowsOf` (Task 3)
- Produces: 없음 (검증 전용)

**§14는 역할이 다르다.** `ledger.op_load_opening_balance`의 `EXECUTE`는 **`ledger_migrator`에만** 있다 — `ledger_app`에는 없다. 그래서 `withActor`에 `as: 'migrator'`를 준다. 두 번째 테스트가 앱 역할이 이 함수를 **못 부르는 것**을 단언한다. 소유자로 테스트했다면 이 경계가 보이지 않는다.

- [ ] **Step 1: 보유금 이체 테스트를 쓴다**

`db/tests/posting/section-12-wallet-transfer.test.js`:

```js
// R-12-02 04 §12 케이지 계좌 ↔ 회원 보유금.
//   그 절의 표(to_wallet): member_deposit +wallet_transfer_out / player_wallet −wallet_transfer_in
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp, createMember } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entriesOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §12 케이지 계좌 → 회원 보유금', async () => {
  const member = uniq('TEST-MEM');
  await withActor(
    {
      // player_wallet 계정을 만드는 op_* 가 없다. 소유자 단계에서 만든다.
      setup: (client) => createMember(client, { code: member, branch: 'HANN', kinds: ['player_wallet'] }),
    },
    async (client, ctx) => {
      const acct = uniq('TEST-ACC');
      await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
        uniq('open'),
        ctx.staffId,
        ctx.branch,
        acct,
        'TEST ACCOUNT',
      ]);
      const depToken = await issueStepUp(client, {
        staffId: ctx.staffId,
        deviceId: ctx.device,
        scope: 'ledger.deposit',
        method: 'totp',
      });
      await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7)', [
        uniq('dep'),
        ctx.staffId,
        depToken,
        ctx.device,
        ctx.branch,
        acct,
        50000,
      ]);

      const wtToken = await issueStepUp(client, {
        staffId: ctx.staffId,
        deviceId: ctx.device,
        scope: 'ledger.wallet_transfer',
        method: 'totp',
      });
      const { rows } = await client.query(
        'SELECT ledger.op_wallet_transfer($1, $2, $3, $4, $5, $6, $7, $8, $9) AS result',
        [uniq('wt'), ctx.staffId, wtToken, ctx.device, ctx.branch, acct, member, 10000, true]
      );

      assert.deepEqual(await entriesOf(client, rows[0].result), [
        ['member_deposit', 1, 'wallet_transfer_out'],
        ['player_wallet', -1, 'wallet_transfer_in'],
      ]);
    }
  );
});
```

- [ ] **Step 2: 기초 잔액 테스트를 쓴다**

`db/tests/posting/section-14-opening-balance.test.js`:

```js
// R-12-02 04 §14 기초 잔액 개시.
//   그 절의 표: (대상 계정) 잔액 방향 / opening_equity 반대 방향, 둘 다 opening_balance
//
// 두 겹의 경계가 있다:
//   1. identity 권한 — ledger.opening_balance 는 migrator 역할만 가진다
//   2. DB 권한 — 함수의 EXECUTE 는 ledger_migrator 에만 있다 (ledger_app 에는 없다)
// op_load_opening_balance 는 스텝업 토큰을 받지 않는다 — 인자에 p_step_up_id 가 없다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asStaff, uniq, closePool } from '../helpers/db.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { entriesOf, entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

const OPENING_SQL = `
  SELECT ledger.op_load_opening_balance($1, $2, $3, $4,
           jsonb_build_array(jsonb_build_object(
             'account_id',   ledger.house_account_id($4, 'house_cash', 'PHP'),
             'amount_minor', $5::bigint))) AS result`;

test('R-12-02 · AC-12-2 04 §14 기초 잔액이 opening_equity 로 균형을 맞춘다', async () => {
  await withActor({ branches: ['ONLINE'], roles: ['migrator'], as: 'migrator' }, async (client, ctx) => {
    const { rows } = await client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, 777000]);
    const result = rows[0].result;

    assert.deepEqual(await entriesOf(client, result), [
      ['house_cash', 1, 'opening_balance'],
      ['opening_equity', -1, 'opening_balance'],
    ]);

    const byKind = Object.fromEntries((await entryRowsOf(client, result)).map((r) => [r.account_kind, r.amount_minor]));
    assert.equal(byKind.house_cash, 777000n);
    assert.equal(byKind.opening_equity, -777000n);
  });
});

test('R-12-02 ledger_app 은 op_load_opening_balance 를 실행할 수 없다', async () => {
  // 앱 역할로 붙는다. identity 권한이 아니라 DB 의 EXECUTE 권한에서 막혀야 한다.
  await withActor({ branches: ['ONLINE'], roles: ['migrator'] }, async (client, ctx) => {
    await assert.rejects(
      () => client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, 1000]),
      /permission denied for function op_load_opening_balance/
    );
  });
});

test('R-12-02 migrator 가 아닌 직원은 기초 잔액을 세울 수 없다', async () => {
  await withActor({ branches: ['ONLINE'], roles: ['cage_manager'], as: 'migrator' }, async (client, ctx) => {
    await assert.rejects(
      () => client.query(OPENING_SQL, [uniq('ob'), ctx.staffId, ctx.device, ctx.branch, 1000]),
      /lacks permission ledger\.opening_balance/
    );
  });
});
```

- [ ] **Step 3: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/posting/`
Expected: PASS — `# pass 13` · `# fail 0`

- [ ] **Step 4: 커밋**

```bash
git add db/tests/posting/section-12-wallet-transfer.test.js db/tests/posting/section-14-opening-balance.test.js
git commit -m "test(db): assert posting contracts for 04 sections 12 and 14 (R-12-02)"
```

---

## Task 8: `04` §5 · §6-1 · §7 · §8 · §9 — 게임 수명주기

**Files:**

- Create: `db/tests/fixtures/games.mjs`
- Create: `db/tests/posting/section-05-game-buyin.test.js`
- Create: `db/tests/posting/section-07-08-settle.test.js`
- Create: `db/tests/posting/section-06-1-commission.test.js`
- Create: `db/tests/posting/section-09-game-cancel.test.js`
- Test: 위 네 테스트 파일

**Interfaces:**

- Consumes: `asOwner`, `asStaff`, `uniq`, `closePool` (Task 1) · `issueStepUp`, `createMember`, `withActor` (Task 2) · `entriesOf` (Task 3)
- Produces: `openGame(client, ctx, {gameNo, member, buyin, workingChip}) -> Promise<object>` — 게임을 열고 반환 JSON을 준다

**이 절들의 함수는 `cage` 스키마에 있다.** `ledger.op_game_*`가 아니다:

| `04` 절                    | 함수                                      | 파일                                                                    |
| -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| §5 게임 시작 · 바이인 추가 | `cage.op_open_game` · `cage.op_add_buyin` | [`010:42`](../../../db/schema/010_operations_game.sql) · `010:189`      |
| §6 롤링 입력               | `cage.op_record_rolling`                  | `010:300` — **원장 거래를 만들지 않는다**                               |
| §6-1 롤링 커미션 정산      | `cage.op_settle_commission`               | `010:717`                                                               |
| §7 중간정산 · §8 게임 종료 | `cage.op_settle_game`                     | `010:358` — `p_kind`가 `'mid'`면 `mid_settle`, `'final'`이면 `game_end` |
| §9 게임 취소               | `cage.op_cancel_game`                     | `010:555` — `ledger.reverse_transaction`으로 역분개한다                 |
| §10 메인 케이지            | `cage.op_main_cage_entry`                 | `010:647` — `cage.main_cage_events`에만 쓴다. 원장 거래 없음            |

**실측한 분개다.** PostgreSQL 18.6에서 전 수명주기를 돌려 얻은 결과:

```
game_buyin        house_cash        +1 buyin_cash          chips_outstanding −1 chips_issue
                  promo_expense     +1 working_chip_issue  chips_outstanding −1 chips_issue
mid_settle        member_deposit    −1 settle_deposit
                  chips_outstanding +1 chips_redeem        house_cash        −1 settle_cashout
commission_payout commission_expense +1 commission_payout  member_deposit    −1 commission_payout
game_end          chips_outstanding +1 chips_redeem        house_cash        −1 settle_cashout
```

**두 개의 함정.**

1. `cage.games.commission_rate_bp`를 채우는 `op_*`가 **없다.** `op_open_game` 인자에도 없다. NULL이면 `op_settle_commission`이 `game G has no commission rate snapshot`으로 거부한다. 픽스처가 소유자 커넥션에서 직접 `UPDATE`한다 — 스키마 공백을 우회가 아니라 **기록**하기 위해서다.
2. `op_settle_game('final')`은 게임의 `chips_outstanding` 잔액이 0이 아니면 거부한다. 이 검사는 **지연 제약 트리거**([`005:367`](../../../db/schema/005_games_rolling.sql))라 COMMIT 에서 터진다. 정산 금액을 미리 계산해 넣는다.

- [ ] **Step 1: 게임 픽스처를 만든다**

`db/tests/fixtures/games.mjs`:

```js
// 게임 수명주기 픽스처.
//
// commission_rate_bp 를 직접 UPDATE 한다. 이 값을 채우는 op_* 가 아직 없기 때문이다
// (op_open_game 인자에 없다). 우회가 아니라 스키마 공백의 기록이다 —
// 요율 입력 경로가 생기면 이 UPDATE 를 그 op_* 호출로 바꾼다.
import { asOwner, uniq } from '../helpers/db.mjs';

export async function openGame(client, ctx, { gameNo, member, buyin = 500000, workingChip = 100000 }) {
  const token = await ctx.stepUp('game.open');
  const { rows } = await client.query(
    `SELECT cage.op_open_game($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) AS result`,
    [
      uniq('open-game'),
      ctx.staffId,
      token,
      ctx.device,
      ctx.branch,
      gameNo,
      member,
      'T-01',
      'baccarat',
      'cash',
      'live',
      buyin,
      workingChip,
    ]
  );
  return rows[0].result;
}

// 게임의 미회수 칩 잔액. op_settle_game('final') 전에 이만큼 회수해야 한다.
export async function chipsOutstanding(client, gameNo) {
  const { rows } = await client.query(
    `SELECT -b.balance_minor AS chips
       FROM cage.games g
       JOIN ledger.account_balances b ON b.account_id = g.chips_account_id
      WHERE g.game_no = $1`,
    [gameNo]
  );
  return BigInt(rows[0].chips);
}

// 요율 스냅샷을 세운다. 소유자 커넥션이 필요하다 (cage.games 는 앱 역할 UPDATE 불가).
export async function setCommissionRate(gameNo, rateBp) {
  return asOwner((client) =>
    client.query('UPDATE cage.games SET commission_rate_bp = $2 WHERE game_no = $1', [gameNo, rateBp])
  );
}
```

`db/tests/fixtures/scenario.mjs`를 아래로 **교체한다.** `ctx`에 스텝업 발급기가 붙는다 — 게임 연산은 호출마다 다른 `scope`의 토큰이 필요하고, 토큰은 1회용이다.

```js
// 픽스처는 소유자 커넥션으로, op_* 호출은 앱 역할 커넥션으로 돈다.
// 커넥션이 다르므로 두 트랜잭션이다. 전부 커밋하는 구조라 문제되지 않는다.
//
// 이 래퍼를 거치지 않고 소유자로 op_* 를 부르면 GRANT EXECUTE 누락 ·
// 지점 격리 실패가 전부 통과한다. 검사할 경계 바깥에서 검사하는 셈이다.
import { asOwner, asStaff, asMigrator, uniq } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from './actors.mjs';

// as: 'app'(기본) 또는 'migrator'. §14 만 migrator 를 쓴다 —
// ledger.op_load_opening_balance 의 EXECUTE 가 ledger_migrator 에만 있다.
export async function withActor({ branches = ['HANN'], roles = ['cage_manager'], setup, as = 'app' } = {}, act) {
  const ctx = await asOwner(async (client) => {
    const staffId = await createStaff(client, { code: uniq('T-MGR'), branches, roles });
    const extra = setup ? await setup(client, { staffId }) : {};
    return { staffId, device: uniq('dev'), branch: branches[0], ...extra };
  });

  const run = as === 'migrator' ? asMigrator : asStaff;
  return run(ctx.staffId, (client) =>
    act(client, {
      ...ctx,
      // 스텝업은 1회용이다. 호출마다 새로 발급한다.
      stepUp: (scope, method = 'totp') =>
        issueStepUp(client, { staffId: ctx.staffId, deviceId: ctx.device, scope, method }),
    })
  );
}
```

- [ ] **Step 2: §5 바이인 테스트를 쓴다**

`db/tests/posting/section-05-game-buyin.test.js`:

```js
// R-12-02 04 §5 게임 시작 · 바이인 추가 — cage.op_open_game · cage.op_add_buyin.
//   현금 바이인:  house_cash +buyin_cash / chips_outstanding −chips_issue
//   워킹칩 지급:  promo_expense +working_chip_issue / chips_outstanding −chips_issue
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openGame } from '../fixtures/games.mjs';
import { entriesOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §5 게임 개설 분개 집합 (현금 + 워킹칩)', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      const result = await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 100000 });

      assert.deepEqual(await entriesOf(client, result), [
        ['chips_outstanding', -1, 'chips_issue'],
        ['chips_outstanding', -1, 'chips_issue'],
        ['house_cash', 1, 'buyin_cash'],
        ['promo_expense', 1, 'working_chip_issue'],
      ]);
    }
  );
});

test('R-12-02 04 §5 추가 바이인이 같은 분개를 낸다', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 0 });

      const token = await ctx.stepUp('game.buyin');
      const { rows } = await client.query('SELECT cage.op_add_buyin($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
        uniq('buyin'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
        'cash',
        200000,
        0,
      ]);

      assert.deepEqual(await entriesOf(client, rows[0].result), [
        ['chips_outstanding', -1, 'chips_issue'],
        ['house_cash', 1, 'buyin_cash'],
      ]);
    }
  );
});

test('R-12-02 04 §6 롤링 입력은 원장 거래를 만들지 않는다', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member });

      const before = await client.query('SELECT count(*)::int AS n FROM ledger.transactions');
      const token = await ctx.stepUp('game.rolling');
      await client.query('SELECT cage.op_record_rolling($1, $2, $3, $4, $5, $6)', [
        uniq('roll'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
        300000,
      ]);
      const after_ = await client.query('SELECT count(*)::int AS n FROM ledger.transactions');

      assert.equal(after_.rows[0].n, before.rows[0].n, '롤링 입력은 자금 이동이 아니다 (04 §6)');
    }
  );
});
```

- [ ] **Step 3: §7 · §8 정산 테스트를 쓴다**

`db/tests/posting/section-07-08-settle.test.js`:

```js
// R-12-02 04 §7 중간정산 + §8 게임 종료 — cage.op_settle_game.
// p_kind 가 'mid' 면 tx_kind = mid_settle, 'final' 이면 game_end 다.
//
// 한 파일인 이유: §8 은 게임의 chips_outstanding 이 0 이어야 통과한다.
// §7 이 얼마를 회수했는지 알아야 §8 의 회수액이 정해진다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openGame, chipsOutstanding } from '../fixtures/games.mjs';
import { entriesOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §7 중간정산 → §8 게임 종료', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 100000 });

      // ---- §7 중간정산 ----
      const midToken = await ctx.stepUp('game.settle');
      const mid = await client.query('SELECT cage.op_settle_game($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
        uniq('mid'),
        ctx.staffId,
        midToken,
        ctx.device,
        gameNo,
        'mid',
        100000,
        50000,
      ]);

      assert.deepEqual(await entriesOf(client, mid.rows[0].result), [
        ['chips_outstanding', 1, 'chips_redeem'],
        ['house_cash', -1, 'settle_cashout'],
        ['member_deposit', -1, 'settle_deposit'],
      ]);

      // ---- §8 게임 종료 ----
      // 미회수 칩을 정확히 회수해야 한다. 남으면 games_chips_settled 지연 제약이
      // COMMIT 에서 game G cannot close: chips_outstanding balance is N 으로 거부한다.
      const chips = await chipsOutstanding(client, gameNo);
      const endToken = await ctx.stepUp('game.settle');
      const end = await client.query('SELECT cage.op_settle_game($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
        uniq('end'),
        ctx.staffId,
        endToken,
        ctx.device,
        gameNo,
        'final',
        0,
        Number(chips),
      ]);

      assert.deepEqual(await entriesOf(client, end.rows[0].result), [
        ['chips_outstanding', 1, 'chips_redeem'],
        ['house_cash', -1, 'settle_cashout'],
      ]);

      const { rows: st } = await client.query('SELECT status FROM cage.games WHERE game_no = $1', [gameNo]);
      assert.equal(st[0].status, 'ended');
    }
  );
});

test('R-12-02 미회수 칩이 남으면 게임 종료가 COMMIT 에서 거부된다', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  await assert.rejects(
    () =>
      withActor({ setup: (client) => createMember(client, { code: member, branch: 'HANN' }) }, async (client, ctx) => {
        await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 0 });
        const token = await ctx.stepUp('game.settle');
        // 500000 을 발행했는데 1000 만 회수한다.
        await client.query('SELECT cage.op_settle_game($1, $2, $3, $4, $5, $6, $7, $8)', [
          uniq('end'),
          ctx.staffId,
          token,
          ctx.device,
          gameNo,
          'final',
          0,
          1000,
        ]);
        // 여기서는 아직 안 터진다. withActor 의 COMMIT 에서 터진다.
      }),
    /cannot close: chips_outstanding balance is/
  );
});
```

- [ ] **Step 4: §6-1 커미션 테스트를 쓴다**

`db/tests/posting/section-06-1-commission.test.js`:

```js
// R-12-02 04 §6-1 롤링 커미션 정산 — cage.op_settle_commission.
//   commission_expense +commission_payout / member_deposit −commission_payout
//
// 요율의 권위는 cage.games.commission_rate_bp 스냅샷이다 (DR-66 · DR-84 · DR-85).
// 그 값을 채우는 op_* 가 아직 없어 픽스처가 직접 세운다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openGame, setCommissionRate } from '../fixtures/games.mjs';
import { entriesOf, entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §6-1 롤링 커미션 분개 집합', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  const rollingBase = 300000;
  const rateBp = 150; // 1.5%
  const expected = Math.round((rollingBase * rateBp) / 10000);

  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member });
      await setCommissionRate(gameNo, rateBp);

      const token = await ctx.stepUp('game.commission');
      const { rows } = await client.query('SELECT cage.op_settle_commission($1, $2, $3, $4, $5, $6, $7) AS result', [
        uniq('comm'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
        rollingBase,
        expected,
      ]);
      const result = rows[0].result;

      assert.deepEqual(await entriesOf(client, result), [
        ['commission_expense', 1, 'commission_payout'],
        ['member_deposit', -1, 'commission_payout'],
      ]);

      const byKind = Object.fromEntries(
        (await entryRowsOf(client, result)).map((r) => [r.account_kind, r.amount_minor])
      );
      assert.equal(byKind.commission_expense, BigInt(expected));
      assert.equal(byKind.member_deposit, BigInt(-expected));
    }
  );
});

test('R-12-02 요율 스냅샷이 없으면 커미션 정산이 거부된다', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member });
      // setCommissionRate 를 부르지 않는다.
      const token = await ctx.stepUp('game.commission');
      await assert.rejects(
        () =>
          client.query('SELECT cage.op_settle_commission($1, $2, $3, $4, $5, $6, $7)', [
            uniq('comm'),
            ctx.staffId,
            token,
            ctx.device,
            gameNo,
            300000,
            4500,
          ]),
        /has no commission rate snapshot/
      );
    }
  );
});
```

- [ ] **Step 5: §9 취소 테스트를 쓴다**

`db/tests/posting/section-09-game-cancel.test.js`:

```js
// R-12-02 04 §9 게임 취소 — cage.op_cancel_game.
// 새 분개 조합을 만들지 않는다. 그 게임의 거래를 ledger.reverse_transaction 으로
// 역분개한다 — 원 분개의 부호를 뒤집은 것이 나와야 한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openGame } from '../fixtures/games.mjs';
import { entriesOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §9 게임 취소가 개설 분개를 역분개한다', async () => {
  const member = uniq('TEST-MEM');
  const gameNo = uniq('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      const opened = await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 0 });
      const original = await entriesOf(client, opened);

      const token = await ctx.stepUp('game.cancel');
      const { rows } = await client.query('SELECT cage.op_cancel_game($1, $2, $3, $4, $5) AS result', [
        uniq('cancel'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
      ]);
      const result = rows[0].result;

      assert.equal(result.reversed_count, 1, '개설 거래 하나가 역분개되어야 한다');

      // 역분개 거래의 분개는 원 분개의 부호를 뒤집은 것이다.
      const reversedId = result.reversed_transactions[0];
      const { rows: rev } = await client.query(
        `SELECT a.kind::text AS account_kind, sign(e.amount_minor)::int AS sign, e.category::text AS category
           FROM ledger.entries e
           JOIN ledger.transactions t ON t.id = e.transaction_id
           JOIN ledger.accounts     a ON a.id = e.account_id
          WHERE t.external_id = $1
          ORDER BY a.kind, e.category, sign(e.amount_minor)`,
        [reversedId]
      );

      const flipped = original.map(([kind, sign, category]) => [kind, -sign, category]);
      const actual = rev.map((r) => [r.account_kind, r.sign, r.category]);
      assert.deepEqual(new Set(actual.map(String)), new Set(flipped.map(String)));

      const { rows: st } = await client.query('SELECT status FROM cage.games WHERE game_no = $1', [gameNo]);
      assert.equal(st[0].status, 'cancelled');
    }
  );
});
```

- [ ] **Step 6: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/posting/`
Expected: PASS — `# pass 21` · `# fail 0`

`cage.op_*`의 인자 순서·스텝업 `scope`가 위와 다르면 `\df cage.op_open_game` 등으로 확인해 맞춘다. **검사 대상은 인자가 아니라 분개 집합이다.**

- [ ] **Step 7: 커밋**

```bash
git add db/tests/fixtures/games.mjs db/tests/fixtures/scenario.mjs db/tests/posting/section-0*.test.js
git commit -m "test(db): assert posting contracts for 04 game lifecycle sections (R-12-02)"
```

---

## Task 9: 접근 경계와 지연 제약

**Files:**

- Create: `db/tests/invariants/access.test.js`
- Create: `db/tests/invariants/deferred.test.js`
- Test: 위 두 파일

**Interfaces:**

- Consumes: `asOwner`, `asStaff`, `expectCommitFailure`, `query`, `uniq`, `closePool` (Task 1) · `createStaff`, `issueStepUp`, `withActor` (Task 2)
- Produces: 없음 (검증 전용)

**이 두 파일이 지키는 것은 분개 계약이 아니라 하니스 자체의 전제다.**

- 앱 역할이 실제로 제한되어 있어야 Task 3~8이 의미를 갖는다. 소유자로 돌면 GRANT·REVOKE·RLS가 전부 무력화된다.
- 지연 제약이 COMMIT 에서 발화해야 Task 5·8의 거부 테스트가 의미를 갖는다.

- [ ] **Step 1: 접근 경계 테스트를 쓴다**

`db/tests/invariants/access.test.js`:

```js
// 애플리케이션 역할의 경계. 확인한 사실을 회귀 테스트로 고정한다.
//   ledger.entries 직접 INSERT  → permission denied for table entries
//   ledger.post_transaction     → permission denied for function post_transaction
//   ledger.entries SELECT       → app.staff_id 의 지점만 (ledger.current_branches())
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, asStaff, query, uniq, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';

after(closePool);

test('테스트가 소유자로 돌고 있지 않다', async () => {
  // 이 테스트가 깨지면 다른 모든 권한·RLS 테스트가 무의미해진다.
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniq('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
  await asStaff(staffId, async (client) => {
    const { rows } = await client.query('SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user');
    assert.equal(rows[0].rolsuper, false, `앱 풀이 슈퍼유저(${rows[0].current_user})로 붙어 있다`);
  });
});

test('앱 역할은 ledger.entries 에 직접 쓸 수 없다', async () => {
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniq('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
  await assert.rejects(
    () =>
      asStaff(staffId, (client) =>
        client.query(
          `INSERT INTO ledger.entries (transaction_id, account_id, currency, amount_minor, category, branch)
           VALUES (1, 1, 'PHP', 1, 'deposit_cash', 'HANN')`
        )
      ),
    /permission denied for table entries/
  );
});

test('앱 역할은 내부 함수를 직접 부를 수 없다', async () => {
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniq('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
  await assert.rejects(
    () =>
      asStaff(staffId, (client) =>
        client.query("SELECT ledger.post_transaction($1, 'deposit', 'HANN', $2, 'pin', 'd', '[]'::jsonb)", [
          uniq('x'),
          staffId,
        ])
      ),
    /permission denied for function post_transaction/
  );
});

test('RLS 가 app.staff_id 의 지점으로 분개를 거른다', async () => {
  // HANN·NUSTAR 양쪽에 배정된 직원이 지점 간 이체를 만든다 — 양쪽 지점 분개가 생긴다.
  const acct = uniq('TEST-ACC');
  await withActor({ branches: ['HANN', 'NUSTAR'] }, async (client, ctx) => {
    await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
      uniq('open'),
      ctx.staffId,
      'HANN',
      acct,
      'TEST ACCOUNT',
    ]);
    const dep = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7)', [
      uniq('dep'),
      ctx.staffId,
      dep,
      ctx.device,
      'HANN',
      acct,
      100000,
    ]);
    const bt = await issueStepUp(client, {
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
    createStaff(client, { code: uniq('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
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
```

- [ ] **Step 2: 지연 제약 테스트를 쓴다**

`db/tests/invariants/deferred.test.js`:

```js
// 이 파일이 지키는 것:
//   1. 지연 제약 트리거가 실재하고 DEFERRABLE INITIALLY DEFERRED 다 (하니스의 전제)
//   2. R-01-52 · AC-59-3 — SET CONSTRAINTS ALL IMMEDIATE 후 다중 분개 거래가
//      의도대로 실패한다. R-01-50 금지의 반대편 짝이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { asOwner, expectCommitFailure, query, uniq, closePool } from '../helpers/db.mjs';
import { createStaff, issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';

after(closePool);

test('지연 제약 트리거가 전부 DEFERRABLE INITIALLY DEFERRED 다', async () => {
  // tgdeferrable = 지연 가능, tginitdeferred = 기본이 지연.
  // 하나라도 즉시 제약으로 바뀌면 다중 분개 거래가 첫 분개에서 깨진다 (R-01-50).
  const rows = await query(`
    SELECT n.nspname || '.' || c.relname AS table_name, t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('ledger', 'cage') AND t.tgconstraint <> 0 AND NOT t.tgisinternal
       AND NOT (t.tgdeferrable AND t.tginitdeferred)
     ORDER BY 1, 2`);
  assert.deepEqual(rows, [], `즉시 제약으로 바뀐 트리거가 있다: ${JSON.stringify(rows)}`);
});

test('지연 제약 트리거가 4개 이상 실재한다', async () => {
  const rows = await query(`
    SELECT count(*)::int AS n
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('ledger', 'cage') AND t.tgconstraint <> 0 AND NOT t.tgisinternal`);
  assert.ok(rows[0].n >= 4, `지연 제약 트리거가 ${rows[0].n} 개다. 사라졌다면 하니스가 무의미해진다`);
});

test('R-01-52 · AC-59-3 SET CONSTRAINTS ALL IMMEDIATE 후 다중 분개 거래가 실패한다', async () => {
  // 이것이 R-01-50 이 금지하는 이유다. 봉인 트리거가 분개 삽입 직후에 돌아
  // 아직 해시가 채워지지 않은 거래를 미봉인으로 판정한다.
  const staffId = await asOwner((client) =>
    createStaff(client, { code: uniq('T-MGR'), branches: ['HANN'], roles: ['cage_manager'] })
  );
  const device = uniq('dev');
  const acct = uniq('TEST-ACC');

  const err = await expectCommitFailure(
    '23000',
    async (client) => {
      await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
        uniq('open'),
        staffId,
        'HANN',
        acct,
        'TEST ACCOUNT',
      ]);
      const token = await issueStepUp(client, { staffId, deviceId: device, scope: 'ledger.deposit', method: 'totp' });

      // 여기가 금지된 구문이다. 이 테스트 하나에서만 쓴다 (R-01-50 의 유일한 예외).
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');

      await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7)', [
        uniq('dep'),
        staffId,
        token,
        device,
        'HANN',
        acct,
        1000,
      ]);
    },
    { staffId }
  );
  assert.match(err.message, /was never sealed/);
});

test('정상 경로는 SET CONSTRAINTS 없이 커밋된다', async () => {
  await withActor({}, async (client, ctx) => {
    const acct = uniq('TEST-ACC');
    await client.query('SELECT ledger.op_open_account($1, $2, $3, $4, $5)', [
      uniq('open'),
      ctx.staffId,
      ctx.branch,
      acct,
      'TEST ACCOUNT',
    ]);
    const token = await issueStepUp(client, {
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('dep'),
      ctx.staffId,
      token,
      ctx.device,
      ctx.branch,
      acct,
      1000,
    ]);
    assert.ok(rows[0].result.transaction.external_id);
  });
});
```

**주의:** `expectCommitFailure` 안에서 던진 `SET CONSTRAINTS ALL IMMEDIATE`는 그 커넥션에만 적용되고, 헬퍼가 그 커넥션을 `release(true)`로 폐기한다. 풀의 다른 커넥션에 새지 않는다.

- [ ] **Step 3: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/invariants/`
Expected: PASS — `# pass 8` · `# fail 0`

- [ ] **Step 4: 커밋**

```bash
git add db/tests/invariants/
git commit -m "test(db): assert app-role boundary and deferred constraints (R-01-52)"
```

---

## Task 10: 분개 규칙 표 대조와 `tx_kind` 고아 검사

**Files:**

- Create: `db/tests/posting/posting-rules.test.js`
- Test: `db/tests/posting/posting-rules.test.js`

**Interfaces:**

- Consumes: `query`, `closePool`
- Produces: 없음 (검증 전용)

`R-12-13`. 규칙이 없는 `tx_kind`는 "아직 만들지 않은 것"과 "빠뜨린 것"이 구분되지 않는다. 허용목록에 **사유와 함께** 적힌 것만 통과시킨다.

- [ ] **Step 1: 테스트를 쓴다**

`db/tests/posting/posting-rules.test.js`:

```js
// R-12-13 — ledger.tx_kind 전수 대비 posting_rules 고아 검사.
// 목록에 없는 새 고아가 생기면 실패한다. 규칙이 생겨서 목록이 남아도 실패한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, closePool } from '../helpers/db.mjs';

after(closePool);

// 규칙 없음이 의도인 tx_kind. 사유와 함께 적는다.
// 현재는 비어 있다 — 실측 결과 tx_kind 24종 전부가 posting_rules 행을 갖는다.
// bet · payout · share_accrue · share_settle 도 규칙은 있고 op 함수만 없다.
// 따라서 이 목록에 무엇이든 추가되는 순간이 회귀다.
const KNOWN_RULELESS = new Map();

test('R-12-13 posting_rules 고아 tx_kind 가 허용목록과 정확히 일치한다', async () => {
  const rows = await query(`
    SELECT k.kind::text AS kind
      FROM unnest(enum_range(NULL::ledger.tx_kind)) AS k(kind)
     WHERE NOT EXISTS (SELECT 1 FROM ledger.posting_rules r WHERE r.kind = k.kind)
     ORDER BY 1
  `);
  const actual = rows.map((r) => r.kind).sort();
  const allowed = [...KNOWN_RULELESS.keys()].sort();
  assert.deepEqual(
    actual,
    allowed,
    '규칙 없는 tx_kind 가 바뀌었다. 새로 생겼으면 규칙을 넣거나 허용목록에 사유를 적는다. ' +
      '허용목록에만 있으면 규칙이 생긴 것이므로 목록에서 지운다.'
  );
});

test('R-12-02 posting_rules 의 sign 이 −1 또는 1 뿐이다', async () => {
  const rows = await query('SELECT DISTINCT sign FROM ledger.posting_rules ORDER BY 1');
  assert.deepEqual(
    rows.map((r) => r.sign),
    [-1, 1]
  );
});
```

- [ ] **Step 2: 실행해 현재 상태를 확인한다**

Run: `PGPASSWORD=devonly node --test db/tests/posting/posting-rules.test.js`
Expected: PASS. 고아는 현재 0건이다. **FAIL하면 그 자체가 발견**이므로 출력의 `actual` 배열을 `KNOWN_RULELESS`에 옮기되 **사유를 한 줄씩 적는다.** 사유를 못 적는 항목은 허용목록이 아니라 결함이므로 그대로 두고 해당 도메인 계획에 올린다.

- [ ] **Step 3: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test db/tests/posting/`
Expected: PASS — `# pass 6` · `# fail 0`

- [ ] **Step 4: 커밋**

```bash
git add db/tests/posting/posting-rules.test.js
git commit -m "test(db): check posting_rules orphan tx_kind against allowlist (R-12-13)"
```

---

## Task 11: `04` 절 커버리지 가드

**Files:**

- Create: `db/tests/posting/sections.mjs`
- Create: `db/tests/posting/section-coverage.test.js`
- Test: `db/tests/posting/section-coverage.test.js`

**Interfaces:**

- Consumes: `query`, `closePool` (Task 1) — `pg_proc`을 읽어야 하므로 DB에 붙는다
- Produces: `POSTING_SECTIONS` — `{id, title, posting, ops, test, pending?}` 배열. `ops`는 **스키마 한정 이름**이다

**이 가드의 규칙.** `R-12-02`는 "**절 하나에 테스트가 없으면 잡이 실패한다**"이다. 사유 문자열로 면제받는 구조를 만들면 그 요구를 만족하지 못한다. 그래서 면제 조건을 사람 말이 아니라 **기계가 확인하는 사실**에 건다:

| 상태                                            | 판정                                         |
| ----------------------------------------------- | -------------------------------------------- |
| 매핑된 `op_*`가 **하나라도** 있는데 테스트 없음 | **실패.** 사유를 적어도 통과하지 않는다      |
| 매핑된 `op_*`가 하나도 없음 + 사유 있음         | 통과. 호출할 대상이 없으면 계약을 쓸 수 없다 |
| 매핑된 `op_*`가 하나도 없음 + 사유 없음         | 실패                                         |
| 사유는 있는데 `op_*`가 **하나 생겼음**          | **실패.** 유예가 그 자리에서 만료된다        |
| `pg_proc`에 있는 `op_*`가 대장 어디에도 없음    | **실패.** 새 연산이 미등재로 스며들 수 없다  |

**세 번째 줄과 마지막 줄이 핵심이다.**

- `every`가 아니라 `some`이다. §13처럼 연산이 둘인 절에서 `op_bet`만 들어오고 `op_payout`이 아직 없다고 유예가 유지되면, 검증 없는 자금 경로가 머지된다.
- 마지막 줄이 **역방향 검사**다. 앞의 네 줄은 전부 "대장에 적힌 것"만 본다. 대장에 안 적힌 새 `op_*`는 그 그물을 통과한다 — 실제로 이 계획의 첫 판이 `cage.op_*` 8개를 통째로 놓쳤다. 스키마의 모든 `op_*`가 어느 절에든 매핑되어야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/posting/section-coverage.test.js`:

```js
// R-12-02 · AC-12-2 — 04-posting-rules.md 의 분개 절마다 테스트가 하나씩 있어야 한다.
// 유예는 "그 연산 함수가 아직 없다" 는 사실로만 정당화된다. 사유 문자열만으로는 안 된다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { query, closePool } from '../helpers/db.mjs';
import { POSTING_SECTIONS } from './sections.mjs';

const HERE = import.meta.dirname;
const DOC = path.resolve(HERE, '../../../docs/architecture/04-posting-rules.md');

after(closePool);

// 스키마에 실재하는 op_* 이름 집합. ledger 뿐 아니라 cage · identity 도 본다 —
// 게임 · 실사 연산은 cage 스키마에 있다.
async function existingOps() {
  const rows = await query(`
    SELECT n.nspname || '.' || p.proname AS fn
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('ledger', 'cage', 'identity')
       AND p.proname LIKE 'op\\_%'`);
  return new Set(rows.map((r) => r.fn));
}

test('R-12-02 04 의 절 목록이 대장과 일치한다', () => {
  const headings = readFileSync(DOC, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).split('.')[0].trim());
  const known = new Set(POSTING_SECTIONS.map((s) => s.id));
  assert.deepEqual(
    headings.filter((id) => !known.has(id)),
    [],
    '04 에 대장에 없는 절이 생겼다. sections.mjs 에 등재하고 posting 여부를 정한다'
  );
});

test('R-12-02 대장이 가리키는 테스트 파일이 전부 존재한다', () => {
  const missing = POSTING_SECTIONS.filter((s) => s.test !== null).filter((s) => !existsSync(path.join(HERE, s.test)));
  assert.deepEqual(
    missing.map((s) => `${s.id} ${s.title} -> ${s.test}`),
    []
  );
});

test('R-12-02 연산 함수가 있는 분개 절은 반드시 테스트가 있다', async () => {
  const ops = await existingOps();
  // some 이다. every 가 아니다 — 연산이 둘인 절에서 하나만 구현돼도 계약이 필요하다.
  const uncovered = POSTING_SECTIONS.filter((s) => s.posting && s.test === null && s.ops.some((op) => ops.has(op)));
  assert.deepEqual(
    uncovered.map((s) => {
      const present = s.ops.filter((op) => ops.has(op));
      return `${s.id} ${s.title} — ${present.join(', ')} 가 있는데 계약 테스트가 없다`;
    }),
    [],
    '함수가 하나라도 있으면 미룰 수 없다. 사유(pending)로 면제되지 않는다'
  );
});

test('R-12-02 미작성 절에 사유가 적혀 있다', () => {
  const noReason = POSTING_SECTIONS.filter((s) => s.posting && s.test === null && !s.pending);
  assert.deepEqual(
    noReason.map((s) => `${s.id} ${s.title}`),
    []
  );
});

test('R-12-02 스키마의 모든 op_* 가 대장에 등재되어 있다', async () => {
  // 역방향 검사. 앞의 검사들은 전부 "대장에 적힌 것" 만 본다.
  // 대장에 없는 새 op_* 는 그 그물을 통과한다 — 이 계획의 첫 판이 cage.op_* 8개를
  // 통째로 놓친 것이 정확히 그 구멍이었다.
  const ops = await existingOps();
  const claimed = new Set(POSTING_SECTIONS.flatMap((s) => s.ops));
  const orphans = [...ops].filter((op) => !claimed.has(op)).sort();
  assert.deepEqual(orphans, [], '대장에 없는 op_* 가 있다. 04 의 어느 절에 속하는지 정하고 sections.mjs 에 등재한다');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test db/tests/posting/section-coverage.test.js`
Expected: FAIL — `Cannot find module '.../db/tests/posting/sections.mjs'`

- [ ] **Step 3: 절 대장을 만든다**

`db/tests/posting/sections.mjs`:

```js
// 04-posting-rules.md 의 최상위 절 대장.
//   posting  분개를 만드는 절인가
//   ops      그 절을 실행하는 연산 함수. **스키마 한정 이름**이다.
//            게임 · 실사 연산은 ledger 가 아니라 cage 스키마에 있다.
//   test     그 절의 계약 테스트 파일 (없으면 null)
//   pending  test 가 null 인 분개 절의 사유. ops 가 하나라도 실재하면 사유는 무효다
//
// 스키마의 모든 op_* 가 여기 어딘가에 있어야 한다 (역방향 검사).
// 분개를 만들지 않는 연산도 §15 에 등재한다.
export const POSTING_SECTIONS = [
  { id: '0', title: '읽는 법', posting: false, ops: [], test: null },
  { id: '1', title: '입금', posting: true, ops: ['ledger.op_deposit'], test: './section-01-deposit.test.js' },
  { id: '2', title: '출금', posting: true, ops: ['ledger.op_withdraw'], test: './section-02-withdraw.test.js' },
  {
    id: '3',
    title: '계좌 간 이체',
    posting: true,
    ops: ['ledger.op_transfer'],
    test: './section-03-transfer.test.js',
  },
  {
    id: '4',
    title: '지점 간 이체',
    posting: true,
    ops: ['ledger.op_branch_transfer'],
    test: './section-04-branch-transfer.test.js',
  },
  {
    id: '5',
    title: '게임 시작 · 바이인 추가',
    posting: true,
    ops: ['cage.op_open_game', 'cage.op_add_buyin'],
    test: './section-05-game-buyin.test.js',
  },
  {
    id: '6',
    title: '롤링 입력 — 자금 이동 없음',
    posting: false,
    ops: ['cage.op_record_rolling'],
    test: './section-05-game-buyin.test.js',
  },
  {
    id: '6-1',
    title: '롤링 커미션 정산',
    posting: true,
    ops: ['cage.op_settle_commission'],
    test: './section-06-1-commission.test.js',
  },
  {
    id: '6-2',
    title: '이벤트 보너스 커미션',
    posting: true,
    ops: [],
    test: null,
    pending: 'a14 — B5 미결. 전용 연산 함수가 없다',
  },
  { id: '7', title: '중간정산', posting: true, ops: ['cage.op_settle_game'], test: './section-07-08-settle.test.js' },
  { id: '8', title: '게임 종료', posting: true, ops: ['cage.op_settle_game'], test: './section-07-08-settle.test.js' },
  {
    id: '9',
    title: '게임 취소',
    posting: true,
    ops: ['cage.op_cancel_game', 'ledger.op_reverse_transaction'],
    test: './section-09-game-cancel.test.js',
  },
  {
    id: '10',
    title: '메인 케이지 — 자금 원장 아님',
    posting: false,
    ops: ['cage.op_main_cage_entry'],
    test: null,
  },
  {
    id: '11',
    title: '밸런싱 차액 조정',
    posting: true,
    ops: ['ledger.op_adjustment', 'cage.op_record_balancing'],
    test: './section-11-adjustment.test.js',
  },
  {
    id: '11-2',
    title: '차액 확정 해소',
    posting: true,
    ops: ['ledger.op_resolve_suspense'],
    test: './section-11-adjustment.test.js',
  },
  {
    id: '12',
    title: '케이지 계좌 ↔ 회원 보유금',
    posting: true,
    ops: ['ledger.op_wallet_transfer'],
    test: './section-12-wallet-transfer.test.js',
  },
  {
    id: '13',
    title: '플레이어 베팅 · 페이아웃',
    posting: true,
    ops: [],
    test: null,
    pending: '보류 — 13 §2. 전용 연산 함수가 없다. 멱등키 분리는 a12',
  },
  { id: '13-2', title: '포인트', posting: true, ops: [], test: null, pending: 'a10 — B2 미결. 연산 함수 없음' },
  { id: '13-3', title: '파트너 쉐어', posting: true, ops: [], test: null, pending: 'a13 — B4 미결. 연산 함수 없음' },
  { id: '13-4', title: '케이지 포인트', posting: true, ops: [], test: null, pending: 'a10 — B2 미결. 연산 함수 없음' },
  {
    id: '14',
    title: '기초 잔액 개시',
    posting: true,
    ops: ['ledger.op_load_opening_balance'],
    test: './section-14-opening-balance.test.js',
  },
  {
    id: '15',
    title: '자금 이동이 없는 연산',
    posting: false,
    // 분개를 만들지 않는 연산의 집합소. 역방향 검사가 미등재 op_* 를 막으므로
    // 여기 모아 둔다. 나중에 분개를 만들게 되면 해당 절로 옮긴다.
    ops: [
      'ledger.op_open_account',
      'ledger.op_freeze_period',
      'ledger.op_settle_period',
      'identity.op_request_approval',
      'identity.op_cast_vote',
      'identity.op_shift_event',
    ],
    test: null,
  },
  { id: '16', title: '`entry_category` 전체 목록', posting: false, ops: [], test: null },
  { id: '17', title: '검증 체크리스트', posting: false, ops: [], test: null },
  { id: '18', title: '이 표를 강제하는 방법', posting: false, ops: [], test: null },
];
```

**대장이 주장하는 것과 실제.** 현재 `pg_proc`의 `op_*`는 23개다 — `ledger` 12 · `cage` 8 · `identity` 3. 위 대장이 그 23개를 전부 claim 한다. `pending` 5건(§6-2 · §13 · §13-2 · §13-3 · §13-4)은 전부 `ops: []`, 즉 **연산 함수 자체가 없다.** Step 4가 이 주장을 기계로 검증한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `PGPASSWORD=devonly node --test db/tests/posting/section-coverage.test.js`
Expected: PASS — `# pass 5` · `# fail 0`

- [ ] **Step 5: 가드가 실제로 무는지 확인한다**

세 번 바꿔 보고 각각 실패를 눈으로 본다. 확인 후 되돌린다.

| 바꿀 것                                                           | 기대 실패                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| §2의 `test`를 `null`로, `pending: '나중에'` 추가                  | `2 출금 — ledger.op_withdraw 가 있는데 계약 테스트가 없다`    |
| §13의 `ops`에 `'ledger.op_deposit'` 추가하고 `test`는 `null` 유지 | `13 플레이어 베팅 · 페이아웃 — ledger.op_deposit 가 있는데 …` |
| §15의 `ops`에서 `'ledger.op_open_account'` 제거                   | `대장에 없는 op_* 가 있다` + `ledger.op_open_account`         |

이 스텝을 건너뛰면 가드가 항상 통과하는 빈 껍데기여도 알 수 없다. 두 번째 줄이 `some` 규칙을, 세 번째 줄이 역방향 검사를 검증한다.

- [ ] **Step 6: 커밋**

```bash
git add db/tests/posting/sections.mjs db/tests/posting/section-coverage.test.js
git commit -m "test(db): fail when a posting section has an op but no contract test (R-12-02)"
```

---

## Task 12: 라인 참조 검증기

**Files:**

- Create: `tools/check-line-refs.mjs`
- Modify: `package.json` (`scripts`)
- Modify: `docs/` — 검증기가 잡아낸 어긋난 참조
- Test: `npm run docs:check-line-refs`

**Interfaces:**

- Consumes: 없음
- Produces: `npm run docs:check-line-refs` — 어긋난 참조가 있으면 종료 코드 1

`R-12-11` · `R-12-12`. 문서에 `index.html:NNNN` 형태 참조가 **217건** 있다. 파일이 한 줄만 밀려도 전부 조용히 틀어진다.

- [ ] **Step 1: 검증기를 만든다**

`tools/check-line-refs.mjs`:

```js
#!/usr/bin/env node
// 문서의 `<파일>:<줄>` 참조가 실제 그 줄을 가리키는지 검사한다.
//
//   node tools/check-line-refs.mjs
//
// 규칙 둘:
//   (1) 참조한 줄 번호가 파일 길이 안에 있어야 한다.
//   (2) 참조가 있는 문서 줄에 백틱 식별자가 있으면, 그 식별자가 대상 파일의
//       참조 줄 ±3 줄 안에 나타나야 한다. 문서가 코드와 함께 움직였는지 보는 값싼 대조다.
//
// 근거: docs/spec/12-ci-golden-tests.md R-12-11 · R-12-12
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DOC_ROOT = path.join(REPO_ROOT, 'docs');
const REF_RE = /([A-Za-z0-9_./-]+\.(?:html|js|mjs|sql)):(\d{1,6})/g;
const IDENT_RE = /`([A-Za-z_$][A-Za-z0-9_$.]{2,})`/g;
const WINDOW = 3;

async function collectMarkdown(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const sourceCache = new Map();
async function sourceLines(file) {
  if (!sourceCache.has(file)) {
    try {
      sourceCache.set(file, (await readFile(file, 'utf8')).split('\n'));
    } catch {
      sourceCache.set(file, null);
    }
  }
  return sourceCache.get(file);
}

const docs = await collectMarkdown(DOC_ROOT, []);
docs.sort();

const problems = [];
let checked = 0;

for (const doc of docs) {
  const lines = (await readFile(doc, 'utf8')).split('\n');
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(REF_RE)) {
      const [, rawPath, rawLine] = match;
      const lineNo = Number(rawLine);
      checked += 1;
      const where = `${path.relative(REPO_ROOT, doc)}:${index + 1}`;
      const body = await sourceLines(path.resolve(REPO_ROOT, rawPath));
      if (body === null) {
        // 읽을 수 없는 참조 대상은 통과가 아니라 문제다. 파일이 지워지거나
        // 이름이 바뀌면 그 파일을 가리키던 참조 전부가 조용히 검사에서 빠진다 —
        // index.html 은 이 프로젝트가 대체하려는 레거시 단일 파일이라
        // 정확히 그 일이 일어난다. 검사가 가장 필요한 시점에 꺼지는 셈이다.
        problems.push(`${where}: ${rawPath}:${rawLine} — 참조 대상 파일을 읽을 수 없다`);
        continue;
      }
      if (lineNo < 1 || lineNo > body.length) {
        problems.push(`${where}: ${rawPath}:${lineNo} — 파일은 ${body.length}줄뿐이다`);
        continue;
      }
      const idents = [...line.matchAll(IDENT_RE)].map((m) => m[1]);
      if (idents.length === 0) continue;
      const window = body.slice(Math.max(0, lineNo - 1 - WINDOW), lineNo + WINDOW).join('\n');
      if (!idents.some((id) => window.includes(id.split('.').pop()))) {
        problems.push(`${where}: ${rawPath}:${lineNo} — 근처 ±${WINDOW}줄에 ${idents.join(' · ')} 가 없다`);
      }
    }
  }
}

for (const problem of problems) console.error(problem);
console.log(`${docs.length} docs, ${checked} line refs, ${problems.length} stale`);
process.exit(problems.length === 0 ? 0 : 1);
```

- [ ] **Step 2: npm 스크립트를 더한다**

`package.json`의 `scripts`에서 `docs:check-links` 줄 다음에 추가한다:

```json
    "docs:check-line-refs": "node tools/check-line-refs.mjs",
```

- [ ] **Step 3: 실행해 현재 어긋남을 본다**

Run: `npm run docs:check-line-refs`
Expected: 어긋난 참조 목록과 `N docs, M line refs, K stale`. **여기 나온 목록이 `R-12-12`가 요구한 재검증 대상이다** — `01` §7-1의 `_doConfirmMidSettle`, `04` §7-4의 `g.checkpoints`, `05`:122-173 구간이 포함돼 있으면 그것이 `AC-72-1`~`AC-72-3`이다.

- [ ] **Step 4: 나온 항목을 하나씩 고친다**

각 항목마다 대상 파일에서 식별자를 찾아 문서의 줄 번호를 실제 값으로 바꾼다:

```bash
grep -n "_doConfirmMidSettle" index.html
```

**식별자 자체가 사라졌으면 줄 번호가 아니라 문장이 낡은 것이다** — 그때는 문장을 고친다.

- [ ] **Step 5: 0건을 확인한다**

Run: `npm run docs:check-line-refs`
Expected: `0 stale`, 종료 코드 0. 참조 대상 파일이 사라지면 그 자체로 `stale` 로 집계된다

- [ ] **Step 6: 커밋**

```bash
git add tools/check-line-refs.mjs package.json docs/
git commit -m "test(docs): verify index.html line references (R-12-11, R-12-12)"
```

---

## Task 13: CI 잡

**Files:**

- Create: `.github/workflows/db-golden.yml`
- Test: PR에서 잡이 도는 것을 확인

**Interfaces:**

- Consumes: `db/scripts/apply.sh` · `npm run test:db` · `npm run docs:check-links` · `npm run docs:check-line-refs`
- Produces: 없음

- [ ] **Step 1: 워크플로를 만든다**

`.github/workflows/db-golden.yml`:

```yaml
# R-12-01 · R-12-06 — 모든 PR에서 빈 DB에 db/schema 를 적용하고 골든 테스트를 돌린다.
# paths 필터를 두지 않는다. 조용히 스킵되면 그 자체가 사고다 (AC-12-6).
name: db-golden

on:
  pull_request:
  push:
    branches: [main, backend]

jobs:
  golden:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: cage
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20

    env:
      PGHOST: localhost
      PGPORT: 5432
      PGUSER: postgres
      PGPASSWORD: ci
      PGDATABASE: cage
      # 애플리케이션 역할 레인. 테스트는 op_* 를 이 역할로 부른다.
      PGAPPUSER: cage_test_app
      PGMIGUSER: cage_test_migrator
      PGAPPPASSWORD: ci

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: apply schema (001 → 013)
        run: bash db/scripts/apply.sh

      # 테스트용 로그인 역할. 이 스텝이 빠지면 골든 테스트가 소유자로 붙어
      # RLS 와 테이블 권한이 전부 우회된다.
      - name: create test roles
        run: bash db/scripts/test-role.sh

      - name: golden tests
        run: npm run test:db

      - name: doc link check
        run: npm run docs:check-links

      - name: line reference check
        run: npm run docs:check-line-refs
```

- [ ] **Step 2: 로컬에서 같은 순서를 재현한다**

```bash
docker rm -f cage-pg18 2>/dev/null || true
docker run -d --name cage-pg18 -p 55432:5432 \
  -e POSTGRES_PASSWORD=devonly -e POSTGRES_DB=cage postgres:18-alpine
PGPASSWORD=devonly npm run db:apply
PGPASSWORD=devonly npm run db:test-role
PGPASSWORD=devonly npm run test:db
npm run docs:check-links
npm run docs:check-line-refs
```

Expected: `db:apply`는 `OK: 13 files applied`, `test:db`는 `# fail 0`, 문서 검사 2종은 종료 코드 0

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/db-golden.yml
git commit -m "ci: run schema apply and golden tests on every PR (R-12-01, R-12-06)"
```

- [ ] **Step 4: PR에서 잡이 실제로 도는 것을 확인한다**

Run: `gh pr checks`
Expected: `db-golden / golden`이 목록에 있고 상태가 `pass`. **목록에 없으면 `R-12-06` 위반이다** — 잡이 조용히 스킵된 것이므로 트리거 조건을 고친다.

---

## Task 14: 문서 갱신

**Files:**

- Modify: `db/README.md` ("아직 없는 것" 표 · 접속 역할 절)
- Modify: `db/tests/README.md` ("아직 비어 있다" 절)
- Modify: `docs/superpowers/ROADMAP.md` (§3 a01 상태)

- [ ] **Step 1: `db/README.md`를 갱신한다**

"아직 없는 것" 표에서 `db/tests/` 실체 행과 `.github/workflows/db-golden.yml` 행을 지우고 `services/` 행만 남긴다.

"적용" 절에 역할 생성을 더한다:

```bash
PGPASSWORD=devonly npm run db:apply       # 001 → 013 순차 적용
PGPASSWORD=devonly npm run db:test-role   # 테스트용 로그인 역할 2종
PGPASSWORD=devonly npm run test:db        # 골든 테스트
```

"금지 · 주의" 절에 한 줄 더한다:

> - **골든 테스트를 소유자(`postgres`)로 돌리지 않는다.** RLS와 테이블 권한이 우회되어 GRANT 실수·REVOKE 누락·지점 격리 실패가 초록으로 통과한다. `op_*` 호출은 `ledger_app`(§14는 `ledger_migrator`)로 한다.

- [ ] **Step 2: `db/tests/README.md`의 "아직 비어 있다" 절을 실행 방법으로 바꾼다**

````markdown
## 실행

```bash
PGPASSWORD=devonly npm run db:apply     # 빈 DB에 db/schema 적용
PGPASSWORD=devonly npm run test:db      # node --test --test-concurrency=1 db/tests/
```

테스트는 커밋한다. 지연 제약이 COMMIT 에서만 발화하기 때문이다.
그래서 파일 병렬 실행을 끄고(`--test-concurrency=1`), 다시 돌리기 전에는 `npm run db:reset` 한다.

절별 계약 테스트의 진행 상황은 `db/tests/posting/sections.mjs`가 대장이다.
`pending`은 **그 절의 `op_*`가 아직 없을 때만** 유효하다 — 함수가 생기면 커버리지 가드가 바로 실패한다.
````

- [ ] **Step 3: `ROADMAP.md` §3의 a01 상태를 `🏁`로 바꾼다**

- [ ] **Step 4: 커밋**

```bash
git add db/README.md db/tests/README.md docs/superpowers/ROADMAP.md
git commit -m "docs: record golden harness completion"
```

---

## 이 계획의 범위 밖

플레이스홀더가 아니라 **의도된 이월**이다. 각각 왜 지금이 아닌지 적는다.

| 요구사항                                          | 이월 대상           | 사유                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `R-12-03` 불변식 I1~I8 위반 테스트 **전체**       | **a03**             | a03이 I1에 "분개 수 ≥ 2"를 **추가**한다(`R-01-30`). 지금 전부 쓰면 같은 테스트를 두 번 쓴다. **단 I2(잔액 하한)와 봉인은 Task 5·8이 이미 덮는다** — 하니스가 지연 제약을 실제로 발화시키는지가 나머지 전부의 전제이기 때문이다 |
| `04` §6-2 · §13 · §13-2 · §13-3 · §13-4 분개 계약 | **a10 · a13 · a14** | 그 절들의 연산 함수가 **아직 없다** (`ops: []`). 호출할 대상이 없어 계약을 쓸 수 없다. Task 11의 가드가 `pg_proc`으로 확인하고, 함수가 하나라도 들어오는 순간 유예를 만료시킨다                                                |
| `R-12-04` 전 경로 시나리오 4종                    | **a03 · a06**       | 네 시나리오가 부르는 연산(게임 개설·중간정산·실사·기간마감)의 요구사항이 a03·a06에서 바뀐다. 하니스 위에 얹는 것이 순서다                                                                                                      |
| `R-12-10` `ddl/` R번호 ↔ 파일 참조 대조           | **a03**             | `R-01-53`이 같은 일이고, 대사 계층을 손보는 a03이 R 번호 대장을 함께 고친다                                                                                                                                                    |
| `R-12-14` R 번호 대장 ↔ 실제 뷰 목록 대조         | **a03**             | 위와 같다. R10 · R11 신설이 a03이다                                                                                                                                                                                            |
| `R-12-20` 픽스처가 `provision_branch()`를 쓴다    | **a02**             | 그 함수가 아직 없다. a02가 만든 뒤 픽스처를 그 위로 옮긴다                                                                                                                                                                     |
| `R-12-22` KRW 금액 표기 테스트                    | **c04 · c06 · c08** | 표기는 화면·영수증·리포트 계층이다. DB 쪽은 `scale = 0` 단언(Task 4)까지가 몫이다                                                                                                                                              |
| `R-01-24` `reversal` · `game_cancel` 행 제거      | **a03**             | 지금 `posting_rules`에 그 행들이 **있다.** 제거는 R11 미러 대조 신설과 한 몸이다                                                                                                                                               |
| 통화 매트릭스 nightly 분리                        | 미정                | [`12` §6](../../spec/12-ci-golden-tests.md) 열린 항목. CI 실행 시간이 문제가 될 때 판단한다                                                                                                                                    |
