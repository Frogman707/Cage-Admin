# a02 — 지점 참조 테이블과 운영 가드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ledger.branches`를 스펙 `01` §2-1 모양으로 맞추고, 지점 추가를 `ledger.provision_branch()` 한 트랜잭션으로 묶고, 반쪽 지점을 잡는 검사와 U4 전환 회귀를 막는 드리프트 테스트를 세우고, `01` §7의 운영 가드 문서를 실제와 맞춘다.

**Architecture:** 스키마는 마이그레이션 도구 없이 `db/schema/0NN_*.sql`을 **제자리에서 고치고 빈 DB에 001~013 전체를 다시 적용**한다 ([`00-decisions` §12](../../spec/00-decisions.md)). 지점 프로비저닝은 세 파일에 흩어진 부수 효과(`001` `branch_config` · `003` 하우스 주체·계정 · `004` `chain_heads`)를 `004` 말미의 `ledger.provision_branch()` 하나로 묶고, 시드 3행을 만드는 부트스트랩 경로와 **하우스 계정 생성 헬퍼를 공유**해 둘이 갈라지지 않게 한다. 검증은 `013`의 `ledger.v_check_branch_provisioning` 뷰가 상시로, `db/tests/`의 골든·드리프트 테스트가 매 CI 실행마다 한다.

**Tech Stack:** PostgreSQL 18.6 · `psql` (`db/scripts/apply.sh` · `reset.sh`) · `node:test` + `pg` (a01 하니스)

**Spec:** [`docs/spec/01-ledger-foundation.md`](../../spec/01-ledger-foundation.md) **§2 · §7** (`R-01-01`~`R-01-06` · `R-01-50`~`R-01-53`)
부수 근거: [`00-decisions.md` §5(U4) · §12(D1)](../../spec/00-decisions.md) · [`10-acceptance-criteria.md` DR-49 · DR-60](../../architecture/10-acceptance-criteria.md) · [`12-ci-golden-tests.md` `R-12-20`](../../spec/12-ci-golden-tests.md)

---

## 선행 조건 — a01이 **구현까지** 끝나 있어야 한다

`docs/superpowers/plans/2026-08-15-a01-ci-golden-harness.md`는 2026-08-16 기준 **계획만 있고 구현이 없다.** `db/tests/`에는 `README.md` 하나뿐이다. 이 계획의 모든 테스트는 a01 Task 1의 헬퍼를 그대로 쓴다:

```
db/tests/helpers/db.mjs   query · withRollback · asOwner · asStaff · asIdentity ·
                          asMigrator · expectCommitFailure · expectSqlState ·
                          uniq · closePool
db/scripts/test-role.sh   cage_test_app · cage_test_identity · cage_test_migrator
package.json              db:apply · db:reset · db:test-role · test:db
```

**a01 Task 1이 머지되기 전에는 이 계획의 Step "Run:" 칸이 전부 실패한다.** 착수 전에 `ls db/tests/helpers/db.mjs`로 확인한다.

이 계획은 그 헬퍼 파일에 **`asRole(role, fn)` 하나를 더한다** (Task 3 Step 1). a01의 산출물을 건드리는 유일한 곳이다. a01의 세 로그인 역할은 그대로 두고 로그인 역할을 넷째로 만들지 않는다 — `ledger_read` 검사에는 `SET LOCAL ROLE`이면 충분하다 (계획 결정 5).

`R-01-52`(`SET CONSTRAINTS ALL IMMEDIATE` 후 다중 분개 거래가 의도대로 실패)는 **a01 Task 9가 `db/tests/invariants/deferred.test.js`에 만든다.** 이 계획은 그 테스트를 다시 만들지 않고 **존재만 확인한다** (Task 7 Step 4).

---

## Global Constraints

[`00-decisions.md`](../../spec/00-decisions.md)의 결정을 값까지 옮긴 것이다. 모든 Task의 요구사항에 암묵적으로 포함된다.

| # | 제약 | 값 |
|---|---|---|
| U1 | 이관 대상 데이터 없음 — **데모** | 운영 DB가 없다. 증분 마이그레이션 파일을 쌓지 않는다 |
| U2 | 통화 5종 | `PHP`(2) · `USD`(2) · `HKD`(2) · `CNY`(2) · **`KRW`(minor_unit = 0)** |
| U2 | 환전 없음 | `tx_kind`에 `fx_exchange`가 없다. `fx_rates` · `fx_position`을 만들지 않는다 |
| U4 | 지점 참조 테이블 | `ledger.branch_code` ENUM 없음. 시드 3행 **`HANN` · `NUSTAR` · `ONLINE`** |
| U5 | 규제 관할 유예 | `branch_config`의 임계·윈도 값은 **"잠정"** 표기로 둔다 |
| D1 | 저장소 구조 | 실행 자산은 `db/` · `tools/`. `docs/architecture/ddl/`에는 `README.md`만 남는다. **문서가 `ddl/004`라고 부르는 것은 `db/schema/004_ledger.sql`이다** |
| D1 | 마이그레이션 도구 없음 | 번호 파일을 제자리에서 고치고 `db/scripts/reset.sh`로 전체 재적용 |
| D2 | 테스트 러너 | `node:test` + `pg`. `--test-concurrency=1` |
| ROADMAP §9-1 | 테스트 이름에 `AC-*` / `R-*` ID를 그대로 쓴다 | |
| ROADMAP §9-6 | 함수 시그니처를 바꾸면 `012`의 GRANT 인자 목록을 **같은 커밋에서** 바꾼다 | |
| ROADMAP §9-7 | 새 대사 검사를 추가하기 전에 [`10-acceptance-criteria.md` §11](../../architecture/10-acceptance-criteria.md) R 번호 대장을 **먼저** 갱신한다 | |
| ROADMAP §9-8 | `SET CONSTRAINTS ALL IMMEDIATE`는 금지 | |
| ROADMAP §9-9 | 픽스처는 `ledger.provision_branch()`로 지점을 만든다 | `R-12-20` |
| ADR-014 | **모든 뷰에 `WITH (security_invoker = true)`** | 빠뜨리면 a01의 `db/tests/drift/security.test.js`가 즉시 빨개진다 |

---

## 착수 전 실측 — 무엇이 이미 참인가

`db/schema/` 13개 파일을 읽어 확인한 상태다. **§2의 절반은 이미 되어 있고, 계획의 일은 "만들기"보다 "빈 곳을 메우고 회귀를 막기"다.**

| 요구사항 | 현 상태 | 이 계획이 하는 일 |
|---|---|---|
| `R-01-01` `branch_code` ENUM 부재 | ✅ 이미 참. `001:32`에 전환 기록 주석만 있다 | 회귀 가드 테스트 (Task 5) |
| `R-01-02` 전 `branch` 컬럼 FK | ✅ 이미 참. 12개 테이블 전부 `TEXT REFERENCES ledger.branches(code)` | 카탈로그 전수 검사 테스트 (Task 5) |
| `R-01-03` `current_branches()` → `TEXT[]` | ✅ 이미 참. **단 실물은 `ledger.current_branches()`** ([`012:343`](../../../db/schema/012_roles_and_grants.sql)) — 스펙 표기 `identity.`와 다르다 | 반환형 테스트 + 스펙 표기 정정 (Task 5·8) |
| `R-01-04` 검증 쿼리가 `branches`를 읽음 | ❌ [`10-acceptance-criteria.md:617`](../../architecture/10-acceptance-criteria.md)이 아직 `unnest(enum_range(NULL::ledger.branch_code))` | 문서 정정 + 소스 전수 검사 (Task 7·5) |
| `R-01-05` `provision_branch()` | ❌ **없다.** `001:42` · `003:282` · `004:55` 주석이 "provision_branch() 가 처리한다"고 **약속만** 하고 있다 | 구현 (Task 3) |
| `R-01-06` 반쪽 지점 검사 | ❌ 없다 | 뷰 신설 (Task 4) |
| §2-1 테이블 모양 | ❌ 스펙은 `status` · `opened_on`, 실물은 `is_online` · `active` | 정렬 (Task 1) |
| `R-01-50` `ddl/README`에 `SET CONSTRAINTS` 금지 | ❌ [`db/README.md:56`](../../../db/README.md)에만 있다. `ddl/README.md`에는 없다 | 추가 (Task 7) |
| `R-01-51` `references.md` 행이 그 문단을 가리킴 | 🟡 [`references.md:19`](../../architecture/references.md) 행은 있으나 **가리키는 문단이 존재하지 않는다** | 앵커 연결 (Task 7) |
| `R-01-52` 골든 테스트 | ⏳ **a01 Task 9 소관** | 존재 확인만 (Task 7) |
| `R-01-53` R번호 ↔ 파일 참조 일치 | ❌ `005`에 R4 주석이 **아예 없다.** `AC-49-1`은 "`005`의 해당 주석이 `013`을 가리킨다"를 요구 | 주석 추가 + 검사 (Task 7·5) |

---

## 이 계획이 내리는 설계 결정 5건

계획서가 스펙과 다르게 가는 곳이다. **각각 왜 그런지 여기 적고, 코드 주석에도 같은 이유를 남긴다.**

### 결정 1 — `branches`에 `is_online`을 남긴다

스펙 §2-1은 `code` · `name` · `status` · `opened_on` · `created_at` 5컬럼이다. 실물에는 `is_online BOOLEAN`이 더 있고 `ONLINE` 지점이 `true`다. **스펙이 이 정보를 대체할 컬럼을 주지 않는다.** 지우면 "온라인 지점"이라는 사실이 스키마에서 사라진다.

→ `active BOOLEAN`은 `status TEXT`로 **대체**하고(같은 것을 두 가지로 표현하지 않는다), `is_online`은 **남긴다.** `opened_on`을 더하고 CHECK 정규식에 `-`를 넣는다.

### 결정 2 — `provision_branch()`는 인자 7개다. 스펙의 3개가 아니다

스펙 `R-01-05`는 `ledger.provision_branch(p_code, p_name, p_opened_on)`이다. 그런데 `branch_config.approval_threshold_minor`는 `NOT NULL` **이고 기본값이 없다** ([`001:325`](../../../db/schema/001_types_and_extensions.sql)). 그것이 `DR-39`의 교훈이다 — 예전에 NULL 허용 + 시드 미지정이어서 신규 설치가 "임계 없음"으로 출발했고, **오류도 로그도 없이 4-eyes 통제 전체가 비활성**이었다.

3인자 시그니처를 지키려면 함수가 임계값을 임의로 정해야 하고, 그 순간 `DR-39`가 되돌아온다.

→ `p_approval_threshold_minor BIGINT`를 **필수 인자로 받는다.** 나머지(`p_is_online` · `p_timezone` · `p_cutoff_time`)는 기본값을 준다. 스펙 §2-2 표의 시그니처는 Task 8에서 정정한다.

### 결정 3 — 하우스 계정 생성을 `ledger.bootstrap_house_accounts()` 하나로 모은다

`003`의 부트스트랩 `DO` 블록이 시드 3행의 하우스 주체·계정을 만들고, `provision_branch()`는 신규 지점에 **같은 것**을 만들어야 한다. 두 벌로 쓰면 갈라진다 — 그리고 갈라진 사실은 신규 지점을 실제로 만들어 보기 전까지 드러나지 않는다.

→ `003`에 **참조 테이블 `ledger.house_account_policy(kind PK, normal_balance, allow_negative)`** 를 만들어 11행을 시드하고, `ledger.bootstrap_house_accounts(p_branch TEXT) RETURNS BIGINT`가 그 테이블을 읽어 INSERT한다. `DO` 블록과 `004`의 `provision_branch()`가 같은 함수를 부른다. **하우스 계정 정책이 한 곳에만 있다.**

정책을 함수가 아니라 **테이블**로 두는 이유가 둘이다. (1) `013`의 검사 뷰가 `security_invoker`라 호출자 권한으로 돈다 — 테이블이면 `012:186`의 `GRANT SELECT ON ALL TABLES IN SCHEMA ledger TO ledger_read`가 이미 덮는다(`003` < `012`). 함수였다면 `013` 말미의 일괄 `REVOKE ... FROM PUBLIC` 뒤에 `GRANT EXECUTE`를 따로 챙겨야 한다. (2) `normal_balance`·`allow_negative`를 `CASE WHEN kind IN (...)` 두 벌로 쓰던 것이 사라진다 — U4가 ENUM을 참조 테이블로 옮긴 것과 같은 방향이다.

> **통화는 아직 `PHP`만이다.** `R-01-11`(하우스 계정 = `branches × currencies × house account_kind` 곱집합)은 스펙 `01` **§3**이고 ROADMAP이 **a03**에 배정했다. a02는 곱집합으로 넓히지 않는다. 대신 넓힐 자리를 **짝을 이루는 두 곳**으로 좁혀 둔다 — `003`의 `bootstrap_house_accounts()` 안 `INSERT ... SELECT`(만드는 쪽)와 `013`의 `v_check_branch_provisioning`의 `a.currency = 'PHP'` 조건(검사하는 쪽)이다. 두 곳 다 주석으로 서로를 가리킨다.

### 결정 4 — 프로비저닝 검사는 R 번호를 받지 않는다

`R1`~`R11`은 [`10-acceptance-criteria.md` §11](../../architecture/10-acceptance-criteria.md) 대장이 관리하고, `R10`·`R11`은 스펙 `01` §6(**a03** 소관)이 이미 예약했다. a02가 새 R 번호를 쓰면 충돌한다.

→ `ledger.v_check_branch_provisioning`은 `v_check_view_security` · `v_check_public_execute`와 같은 등급이다 — **`v_integrity_status`에 넣지 않는다.** 이것은 원장 정합성이 아니라 **설치 완결성**이고, 거래를 차단할 일이 아니라 배포를 막을 일이다. 대장에는 `—` 행으로 등록한다 (ROADMAP §9-7).

### 결정 5 — 프로비저닝은 `SECURITY DEFINER`, 검사 뷰는 `security_invoker`. 둘 다 실제 역할로 테스트한다

**소유자로만 테스트하면 이 계획의 권한 설계는 한 줄도 검증되지 않는다.** 소유자는 GRANT와 RLS를 전부 우회한다. 실측한 두 구멍이다:

**(가) `provision_branch()`를 평범한 PL/pgSQL로 두면 이관 역할이 못 부른다.** 기본값은 `SECURITY INVOKER`이므로 INSERT가 호출자 권한으로 돈다. [`012:275-291`](../../../db/schema/012_roles_and_grants.sql)이 `ledger_migrator`에게 준 것은 `archive` INSERT · `ledger`·`identity` USAGE · 함수 2종 EXECUTE · `ledger.accounts`·`ledger.parties` **SELECT**뿐이다. `branches` · `branch_config` · `chain_heads` · `parties` · `accounts` 어디에도 INSERT가 없다. `GRANT EXECUTE`만 주면 부르는 순간 `42501`이다.

→ `provision_branch()`에 **`SECURITY DEFINER`** 를 붙인다. `008`~`011`의 `op_*`가 전부 같은 형태다 ([`012:328-332`](../../../db/schema/012_roles_and_grants.sql)가 그 이유를 적어 두었다 — 정의자 함수만 쓰기를 통과하므로 RLS에 `FORCE`를 쓰지 않는다). `search_path`는 `ledger, pg_temp`로 고정하고 `pg_temp`를 마지막에 둔다 (`012:11-14`). `PUBLIC` REVOKE + `ledger_migrator` EXECUTE는 그대로다. Task 3이 **`asMigrator` 성공 테스트와 직접 INSERT 거부 테스트**를 함께 넣는다.

**`bootstrap_house_accounts()`에는 EXECUTE를 아무에게도 주지 않는다.** 이관 역할이 그것만 부를 수 있으면 `branch_config`·`chain_heads` 없는 **반쪽 지점을 만드는 경로가 하나 생긴다** — `R-01-06`이 잡으려는 바로 그 상태다. 이 함수는 `003`의 부트스트랩 `DO`(적용 시점, 소유자)와 `provision_branch()`(정의자 권한 = 소유자) 안에서만 불리므로 GRANT가 필요 없다.

**(나) 검사 뷰가 `identity.staff_branches`를 읽는데 `ledger_read`에 그 SELECT가 없다.** [`012:186`](../../../db/schema/012_roles_and_grants.sql)의 `ALL TABLES`는 `ledger, cage`만이고, `012:194`는 `identity` **USAGE**만, `012:196-197`은 `identity.staff`의 컬럼 GRANT뿐이다. `security_invoker` 뷰이므로 `ledger_read`가 조회하면 `42501`로 죽는다.

→ 뷰가 쓰는 것은 `branch` 한 컬럼뿐이므로 **컬럼 단위로만** 연다: `GRANT SELECT (branch) ON identity.staff_branches TO ledger_read`. "어느 지점에 직원이 있는가"는 나가고 "누가 어느 지점인가"는 안 나간다. `012:150-159`·`164-167`·`196-200`이 쓰는 방식 그대로다.

→ 그리고 **`ledger_read`로 실제로 조회하는 테스트**를 넣는다. 로그인 역할을 4번째로 만들지 않는다 — `SET LOCAL ROLE`이면 충분하다. 소유자 커넥션은 superuser지만 `SET ROLE` 뒤에는 그 역할의 권한으로 검사받는다(`ledger_read`는 `rolsuper`도 `rolbypassrls`도 아니다). a01 `db/tests/helpers/db.mjs`에 `asRole(role, fn)` 하나를 더한다 (**Task 3 Step 1**, Task 4가 재사용). `013`이 이미 `ledger_read`에 GRANT하는 기존 검사 뷰들도 지금껏 그 역할로는 한 번도 조회된 적이 없다.

---

## 파일 구조

| 파일 | 책임 | 이 계획에서 |
|---|---|---|
| [`db/schema/001_types_and_extensions.sql`](../../../db/schema/001_types_and_extensions.sql) | 타입 · `branches` · `currencies` · `branch_config` · 영업일 | **Modify** — `branches` 컬럼 정렬 · 시드에 `opened_on` |
| [`db/schema/003_accounts.sql`](../../../db/schema/003_accounts.sql) | 주체 · 계정 · 하우스 부트스트랩 | **Modify** — `house_account_policy` 참조 테이블 신설 · `bootstrap_house_accounts()` 추출 |
| [`db/schema/004_ledger.sql`](../../../db/schema/004_ledger.sql) | 기간 · `chain_heads` · 거래 · 분개 · `posting_rules` | **Modify** — 말미에 `provision_branch()` |
| [`db/schema/005_games_rolling.sql`](../../../db/schema/005_games_rolling.sql) | 게임 · 롤링 · 재고 | **Modify** — R4 위치 주석 (`AC-49-1`) |
| [`db/schema/012_roles_and_grants.sql`](../../../db/schema/012_roles_and_grants.sql) | 역할 · GRANT · RLS | **Modify** — 새 함수 2종의 EXECUTE 정책 · `identity.staff_branches(branch)` 컬럼 GRANT |
| [`db/tests/helpers/db.mjs`](../../../db/tests/helpers/db.mjs) | a01 하니스 커넥션 헬퍼 | **Modify** — `asRole(role, fn)` 추가 (이 계획이 a01 산출물을 넓히는 유일한 곳) |
| [`db/schema/013_reconciliation.sql`](../../../db/schema/013_reconciliation.sql) | 대사 뷰 · 파생 뷰 · 설정 드리프트 검사 | **Modify** — `v_check_branch_provisioning` |
| `db/tests/fixtures/branches.mjs` | 테스트용 신규 지점 프로비저닝 (`R-12-20`) | **Create** |
| `db/tests/golden/spec-01-branch.test.js` | `01` §2 골든 테스트 — 테이블 모양 · `provision_branch` · 누락 검사 | **Create** |
| `db/tests/drift/branch-model.test.js` | U4 전환 회귀 가드 — ENUM 부재 · FK 전수 · 반환형 · 소스 텍스트 | **Create** |
| [`docs/architecture/ddl/README.md`](../../architecture/ddl/README.md) | 스키마 설계 문서 | **Modify** — `SET CONSTRAINTS` 금지 문단 (`R-01-50`) |
| [`docs/architecture/references.md`](../../architecture/references.md) | 외부 문서 인용 대장 | **Modify** — `SET CONSTRAINTS` 행 앵커 (`R-01-51`) |
| [`docs/architecture/10-acceptance-criteria.md`](../../architecture/10-acceptance-criteria.md) | `AC-*` 원본 · R 번호 대장 | **Modify** — `DR-60` 검증 쿼리 · §11 대장 |
| [`docs/spec/01-ledger-foundation.md`](../../spec/01-ledger-foundation.md) | 이 계획의 스펙 | **Modify** — 시그니처 · 스키마 표기 정정 |
| [`db/README.md`](../../../db/README.md) · [`db/tests/README.md`](../../../db/tests/README.md) · [`docs/superpowers/ROADMAP.md`](../ROADMAP.md) | 대장 | **Modify** — 상태 갱신 |

---

## 반복 루프 — 스키마를 고칠 때마다

마이그레이션 도구가 없으므로 **스키마 편집 후에는 반드시 전체 재적용**한다. 이 계획의 모든 "Run:" 칸이 이 순서를 전제한다.

```bash
# 컨테이너가 없으면 먼저 (CI 와 같은 마이너 버전을 쓴다)
docker run -d --name cage-pg18 -p 55432:5432 \
  -e POSTGRES_PASSWORD=devonly -e POSTGRES_DB=cage postgres:18.6-alpine

PGPASSWORD=devonly npm run db:reset       # DROP 5 schemas + apply 001~013
PGPASSWORD=devonly npm run db:test-role   # 테스트 로그인 역할 3종
PGPASSWORD=devonly npm run test:db
```

`db:reset`이 성공하면 마지막 줄이 `OK: 13 files applied to cage@localhost:55432`다. **이 줄이 안 나오면 그 다음 스텝을 하지 않는다** — 스키마가 반쯤 적용된 DB에서 테스트를 돌리면 실패 원인이 두 겹이 된다.

---

## Task 1: `branches` 테이블을 스펙 §2-1 모양으로 맞춘다

**Files:**

- Modify: `db/schema/001_types_and_extensions.sql:46-63`
- Create: `db/tests/golden/spec-01-branch.test.js`
- Test: `db/tests/golden/spec-01-branch.test.js`

**Interfaces:**

- Consumes: `query`, `closePool` (a01 Task 1)
- Produces: `ledger.branches(code, name, is_online, status, opened_on, created_at)` — `status ∈ {active, suspended, closed}`. 이후 Task 3·4가 `status = 'active'`로 거른다

**왜 `active BOOLEAN`을 지우는가.** 스펙 §2-3과 §3-2의 검증 쿼리가 둘 다 `WHERE b.status = 'active'`다. `active BOOLEAN`을 남긴 채 `status`를 더하면 **같은 사실을 두 컬럼이 말하고**, 둘이 어긋나는 순간 어느 쪽이 맞는지 스키마가 답하지 못한다. `status`는 3상태(`active`/`suspended`/`closed`)라 `BOOLEAN`보다 넓으므로 정보 손실도 없다.

**`opened_on`의 시드 값.** U1=데모라 실제 개점일이 없다. `DATE '2026-01-01'`을 넣고 **주석에 자리표시값임을 적는다.** `NOT NULL`을 풀어 침묵으로 비워 두지 않는다 — 값이 없다는 사실이 데이터에 남지 않기 때문이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/golden/spec-01-branch.test.js`:

```js
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-branch.test.js`
Expected: FAIL — 첫 테스트가 `Expected values to be strictly deep-equal` 로 떨어진다 (`active: 'boolean'`이 남아 있고 `status` · `opened_on` 이 없다)

- [ ] **Step 3: `001`의 `branches` 정의를 바꾼다**

[`db/schema/001_types_and_extensions.sql:46-53`](../../../db/schema/001_types_and_extensions.sql)의 `CREATE TABLE ledger.branches (...)` 블록을 아래로 교체한다:

```sql
CREATE TABLE ledger.branches (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,

  -- 스펙 01 §2-1 에 없지만 남긴다. ONLINE 지점이라는 사실을 대체할 컬럼이
  -- 스펙에 없어서, 지우면 그 사실이 스키마에서 사라진다.
  is_online   BOOLEAN NOT NULL DEFAULT false,

  -- active BOOLEAN 을 대체한다 (스펙 01 §2-1). 같은 사실을 두 컬럼이 말하면
  -- 어긋났을 때 어느 쪽이 맞는지 스키마가 답하지 못한다.
  -- §2-3 · §3-2 의 검증 쿼리가 status = 'active' 로 거른다.
  status      TEXT NOT NULL DEFAULT 'active',

  -- U1=데모라 실제 개점일이 없다. 시드 3행의 값은 자리표시값이며
  -- NOT NULL 을 풀지 않는다 — 풀면 "모른다" 가 데이터에 남지 않는다.
  opened_on   DATE NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  -- 하이픈을 허용한다 (스펙 01 §2-1). 지점 코드에 구분자를 쓰는 사례가 있다.
  CONSTRAINT branches_code_format CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,15}$'),
  CONSTRAINT branches_name_length CHECK (length(name) BETWEEN 1 AND 64),
  CONSTRAINT branches_status_values CHECK (status IN ('active','suspended','closed'))
);
```

- [ ] **Step 4: 시드에 `opened_on`을 넣는다**

[`db/schema/001_types_and_extensions.sql:58-63`](../../../db/schema/001_types_and_extensions.sql)의 INSERT를 아래로 교체한다:

```sql
-- 현행 index.html:4563 / :6430 의 하드코딩 3개 지점을 그대로 옮긴 것.
-- opened_on 은 자리표시값이다 — U1=데모 결정으로 이관할 실제 개점일이 없다
-- (docs/spec/00-decisions.md §2). 실지점 운영이 정해지면 여기와
-- 07-migration.md 의 컷오버 체크리스트를 함께 고친다.
INSERT INTO ledger.branches (code, name, is_online, opened_on) VALUES
  ('HANN',   'Hann',   false, DATE '2026-01-01'),
  ('NUSTAR', 'NUSTAR', false, DATE '2026-01-01'),
  ('ONLINE', 'Online', true,  DATE '2026-01-01');
```

- [ ] **Step 5: 재적용하고 통과를 확인한다**

Run:

```bash
PGPASSWORD=devonly npm run db:reset && \
PGPASSWORD=devonly npm run db:test-role && \
PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-branch.test.js
```

Expected: `OK: 13 files applied` 후 PASS — `# pass 4` · `# fail 0`

- [ ] **Step 6: 기존 테스트가 안 깨졌는지 본다**

Run: `PGPASSWORD=devonly npm run test:db`
Expected: `# fail 0`. `active` 컬럼을 읽던 곳이 있었다면 여기서 드러난다 (실측: `db/schema/` 안에 `branches.active` 참조는 정의 자체뿐이었다)

- [ ] **Step 7: 커밋**

```bash
git add db/schema/001_types_and_extensions.sql db/tests/golden/spec-01-branch.test.js
git commit -m "feat(db): align ledger.branches with spec 01 section 2-1 (R-01-01)"
```

---

## Task 2: 하우스 계정 정책을 참조 테이블로 세우고 생성을 함수로 뽑는다

**Files:**

- Modify: `db/schema/003_accounts.sql:277-334`
- Modify: `db/schema/012_roles_and_grants.sql`
- Modify: `db/tests/golden/spec-01-branch.test.js` (테스트 추가)
- Test: `db/tests/golden/spec-01-branch.test.js`

**Interfaces:**

- Consumes: `query`, `withRollback`, `expectSqlState`, `uniq`, `closePool` (a01 Task 1)
- Produces:
  - `ledger.house_account_policy(kind ledger.account_kind PK, normal_balance ledger.normal_balance NOT NULL, allow_negative BOOLEAN NOT NULL, note TEXT)` — 11행. Task 4의 검사 뷰가 이것과 실물을 대조한다
  - `ledger.bootstrap_house_accounts(p_branch TEXT) RETURNS BIGINT` — `MAIN-<branch>` 하우스 주체를 만들고 정책 전 종류의 계정을 달아 **주체 id**를 돌려준다. Task 3의 `provision_branch()`가 이것을 부른다. **EXECUTE는 어떤 역할에도 주지 않는다**

**왜 뽑는가.** 지금 이 로직은 `003`의 `DO` 블록 안에만 있다. `provision_branch()`가 같은 것을 다시 쓰면 두 벌이 되고, **갈라진 사실은 신규 지점을 실제로 만들어 보기 전까지 드러나지 않는다.** 부트스트랩과 지점 추가가 같은 코드를 지나가야 한다.

**왜 테이블까지 만드는가.** 함수만 뽑으면 "어떤 계정이 있어야 하는가"가 여전히 PL/pgSQL 본문 안의 배열 + `CASE`다. Task 4의 검사 뷰가 그것을 읽을 수 없으니 결국 **개수만 세게 되고, 11종 중 10종이 사라진 지점이 초록으로 통과한다.** 정책을 테이블로 꺼내면 만드는 쪽과 검사하는 쪽이 같은 행을 본다 (계획 결정 3).

**통화는 `PHP`만 유지한다.** 곱집합 확장(`R-01-11`)은 스펙 `01` §3 = **a03** 소관이다. a02는 넓히지 않고, **넓힐 자리를 이 함수와 Task 4의 뷰, 두 곳으로 좁힌다.**

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/golden/spec-01-branch.test.js`의 import 줄을 먼저 아래로 바꾼다:

```js
import { query, withRollback, expectSqlState, uniq, closePool } from '../helpers/db.mjs';
```

파일 끝에 덧붙인다:

```js
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
    `SELECT p.home_branch, array_agg(a.kind::text ORDER BY a.kind) AS kinds
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
      `SELECT array_agg(a.kind::text ORDER BY a.kind) AS kinds
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-branch.test.js`
Expected: FAIL — `function ledger.bootstrap_house_accounts(unknown) does not exist`

- [ ] **Step 3: 함수를 만들고 `DO` 블록이 그것을 부르게 한다**

[`db/schema/003_accounts.sql:277-334`](../../../db/schema/003_accounts.sql)의 부트스트랩 주석 + `DO $$ ... $$;` 블록 **전체**를 아래로 교체한다:

```sql
-- -----------------------------------------------------------------------------
-- 지점 하우스 계정 — 생성 정책을 한 곳에 모은다
-- -----------------------------------------------------------------------------
-- U4 전환(2026-08-15): 지점 목록을 하드코딩하지 않고 ledger.branches 에서 읽는다.
--
-- ⚠️ 이 함수는 **지점 추가 경로가 아니다.** 지점 추가는 004 의
-- ledger.provision_branch() 가 branch_config · chain_heads 까지 한 트랜잭션에서
-- 처리한다 (AC-60-3). 이 함수는 그 안에서 하우스 측 한 조각만 담당한다.
--
-- 함수로 뽑은 이유(a02 결정 3): 아래 부트스트랩 DO 블록과 provision_branch() 가
-- 같은 계정 집합을 만들어야 하는데, 두 벌로 쓰면 갈라진다. 갈라진 사실은
-- 신규 지점을 실제로 만들어 보기 전까지 드러나지 않는다.
--
-- ⚠️ U2 와 곱해진다. 아래 통화가 'PHP' 로 고정돼 있는데, U2 결정에 따라
-- 하우스 계정은 branches × currencies × house account_kind 곱집합이어야 한다
-- (docs/spec/01-ledger-foundation.md R-01-11 · AC-06-4). **그 확장은 스펙 01 §3
-- 이고 계획 a03 소관이다.** 넓힐 자리는 여기 한 곳이다 — 아래 INSERT ... SELECT 에
-- ledger.currencies 를 크로스조인하면 시드 지점과 신규 지점이 함께 따라온다.
-- 현재 상태에서 PHP 외 통화 거래는 상대 하우스 계정이 없어 실패한다.

-- 하우스 계정 정책. ENUM 을 참조 테이블로 옮긴 U4 와 같은 방향이다.
-- 함수가 아니라 테이블인 이유(a02 결정 3):
--   (1) 013 의 v_check_branch_provisioning 이 security_invoker 라 호출자 권한으로
--       읽는다. 테이블이면 012 의 GRANT SELECT ON ALL TABLES IN SCHEMA ledger
--       가 이미 덮는다 (003 이 012 보다 먼저 적용된다). 함수였다면 013 말미의
--       일괄 REVOKE ... FROM PUBLIC 뒤에 GRANT EXECUTE 를 따로 챙겨야 한다.
--   (2) normal_balance · allow_negative 를 CASE WHEN kind IN (...) 로 두 벌
--       쓰던 것이 사라진다. 종류를 하나 늘릴 때 고칠 곳이 한 행이다.
CREATE TABLE ledger.house_account_policy (
  kind           ledger.account_kind   PRIMARY KEY,
  normal_balance ledger.normal_balance NOT NULL,
  allow_negative BOOLEAN               NOT NULL,
  note           TEXT
);

COMMENT ON TABLE ledger.house_account_policy IS
  '지점 하우스 계정의 정본. bootstrap_house_accounts() 가 이것을 읽어 만들고 013 의 v_check_branch_provisioning 이 이것과 대조한다. 행을 더하면 신규 지점은 자동으로 따라오지만 **기존 지점은 따라오지 않는다** — 같은 커밋에서 기존 지점 보정 INSERT 를 함께 넣는다.';

INSERT INTO ledger.house_account_policy (kind, normal_balance, allow_negative, note) VALUES
  ('house_cash',         'debit',  false, '지점 현금'),
  ('marker_receivable',  'debit',  false, '마커 채권'),
  ('tips_dealer',        'credit', false, '딜러 팁'),
  ('tips_house',         'credit', false, '하우스 팁'),
  ('promo_expense',      'debit',  true,  '프로모션 비용'),
  ('commission_expense', 'debit',  false, '롤링 커미션 비용'),
  ('suspense',           'debit',  true,  '미결 — 실사 차액이 여기 머문다'),
  ('house_gaming',       'credit', true,  '게임 손익'),
  -- 실사 차액 종착지 (design-review.md DR-01). 지점별로 있어야 한다.
  ('shortage_expense',   'debit',  false, '실사 부족 확정'),
  ('overage_income',     'credit', false, '실사 초과 확정'),
  -- 케이지 포인트 발행의 하우스 측 상대 계정 (B2 분리 결정 · spec/05 R-05-02).
  -- 지점별로 있어야 손님 포인트 발행이 상대 계정을 찾는다.
  ('point_liability',    'debit',  false, '포인트 발행 상대 계정');

CREATE FUNCTION ledger.bootstrap_house_accounts(p_branch TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_party BIGINT;
BEGIN
  INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
  VALUES ('MAIN-' || p_branch, 'house', p_branch || ' MAIN ACCOUNT', p_branch)
  RETURNING id INTO v_party;

  INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
  SELECT v_party, k.kind, 'PHP', k.normal_balance, k.allow_negative
    FROM ledger.house_account_policy k;

  RETURN v_party;
END;
$$;

COMMENT ON FUNCTION ledger.bootstrap_house_accounts IS
  '지점의 하우스 주체(MAIN-<branch>)와 ledger.house_account_policy 전 종류의 계정을 만든다. 지점 추가는 이것만으로 끝나지 않는다 — ledger.provision_branch() 를 쓴다. **EXECUTE 를 어떤 역할에도 주지 않는다** — 이것만 부를 수 있으면 branch_config · chain_heads 없는 반쪽 지점을 만들 수 있다.';

-- 시드 지점 부트스트랩. 004 의 provision_branch() 는 아직 존재하지 않으므로
-- (chain_heads 가 004 에서 생긴다) 여기서는 하우스 조각만 만들고,
-- 004 말미가 시드 3행의 프로비저닝 완결성을 다시 단언한다.
DO $$
DECLARE
  v_branch TEXT;
  v_party  BIGINT;
BEGIN
  FOR v_branch IN SELECT code FROM ledger.branches ORDER BY code LOOP
    PERFORM ledger.bootstrap_house_accounts(v_branch);
  END LOOP;

  -- 마이그레이션 개시 균형 계정
  INSERT INTO ledger.parties (code, party_type, display_name)
  VALUES ('OPENING-EQUITY', 'internal', 'Migration opening equity')
  RETURNING id INTO v_party;

  INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
  VALUES (v_party, 'opening_equity', 'PHP', 'credit', TRUE);
END;
$$;
```

- [ ] **Step 4: `012`에 EXECUTE 정책을 더한다**

`ledger.bootstrap_house_accounts`는 **소유자만** 부른다 — `003`의 부트스트랩 `DO`(적용 시점)와 `004`의 `provision_branch()`(정의자 권한이라 소유자로 실행된다) 안에서만이다. **어떤 역할에도 `GRANT EXECUTE`를 주지 않는다** (계획 결정 5). [`db/schema/012_roles_and_grants.sql`](../../../db/schema/012_roles_and_grants.sql)의 `ledger.current_branches()` GRANT 블록 **뒤에** 더한다:

```sql
-- 지점 프로비저닝은 앱 역할의 일이 아니다. 하우스 계정을 만들 수 있는 자가
-- 자금 경로에 있으면 상대 계정을 스스로 지어내 분개를 통과시킬 수 있다.
--
-- ledger_migrator 에게도 주지 않는다. 이것만 부를 수 있으면 branch_config ·
-- chain_heads 가 빠진 **반쪽 지점을 만드는 경로가 하나 생긴다** — 013 의
-- v_check_branch_provisioning 이 잡으려는 바로 그 상태다 (R-01-06).
-- 이관 역할이 부를 것은 004 의 provision_branch() 하나뿐이고, 그것이
-- SECURITY DEFINER 라 이 함수를 소유자 권한으로 부른다.
REVOKE EXECUTE ON FUNCTION ledger.bootstrap_house_accounts(TEXT) FROM PUBLIC;
```

> `013` 말미의 일괄 `REVOKE`가 결국 같은 일을 하지만 여기 명시한다 — 함수 옆에 의도가 없으면 다음 사람이 "빠뜨린 GRANT"로 읽고 채워 넣는다.

- [ ] **Step 5: 재적용하고 통과를 확인한다**

Run:

```bash
PGPASSWORD=devonly npm run db:reset && \
PGPASSWORD=devonly npm run db:test-role && \
PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-branch.test.js
```

Expected: PASS — `# pass 8` · `# fail 0`

- [ ] **Step 6: 드리프트 검사가 여전히 0행인지 본다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/drift/`
Expected: PASS — `v_check_public_execute` 가 0행. 위 REVOKE 를 빠뜨렸다면 여기서 잡힌다

- [ ] **Step 7: 커밋**

```bash
git add db/schema/003_accounts.sql db/schema/012_roles_and_grants.sql db/tests/golden/spec-01-branch.test.js
git commit -m "refactor(db): extract bootstrap_house_accounts so provisioning has one policy (AC-60-3)"
```

---

## Task 3: `ledger.provision_branch()`

**Files:**

- Modify: `db/schema/004_ledger.sql` (파일 말미 `COMMIT;` 직전)
- Modify: `db/schema/012_roles_and_grants.sql` (EXECUTE 정책)
- Modify: `db/tests/helpers/db.mjs` (a01 산출물에 `asRole` 추가)
- Modify: `db/tests/golden/spec-01-branch.test.js`
- Test: `db/tests/golden/spec-01-branch.test.js`

**Interfaces:**

- Consumes: `ledger.bootstrap_house_accounts(TEXT)` (Task 2) · `asOwner`, `asMigrator`, `withRollback`, `query`, `expectSqlState`, `uniq`, `closePool` (a01 Task 1)
- Produces:

  ```sql
  ledger.provision_branch(
    p_code                     TEXT,
    p_name                     TEXT,
    p_opened_on                DATE,
    p_approval_threshold_minor BIGINT,
    p_is_online                BOOLEAN DEFAULT false,
    p_timezone                 TEXT    DEFAULT 'Asia/Manila',
    p_cutoff_time              TIME    DEFAULT '06:00'
  ) RETURNS TEXT   -- 만들어진 지점 코드. SECURITY DEFINER · ledger_migrator EXECUTE 전용
  ```

  Task 6의 픽스처와 Task 4의 검사 테스트가 쓴다

- Produces: `asRole(role, fn)` — a01 `db/tests/helpers/db.mjs`에 더한다. `SET LOCAL ROLE`로 강등하고 `ROLLBACK`한다. Task 4가 `ledger_read`로 검사 뷰를 조회할 때 다시 쓴다

**왜 `004` 말미인가.** 이 함수가 만드는 5종 중 `chain_heads`가 `004:47`에서 생긴다. `001`이나 `003`에 두면 적용 시점에 그 테이블이 없다. `004` 말미는 `branches`(001) · `branch_config`(001) · `parties`·`accounts`(003) · `chain_heads`(004)가 **전부 존재하는 첫 지점**이다.

**왜 시드 3행은 이 함수를 쓰지 않는가.** 함수가 정의되는 시점(`004` 말미)이 시드가 필요한 시점(`001`·`003`·`004` 각 파일 안)보다 뒤다. 순환이다. 대신 `004` 말미에서 **시드 3행이 이 함수의 사후조건을 만족하는지 단언**한다 — 부트스트랩 경로와 함수 경로가 갈라지면 `db:apply`가 그 자리에서 멈춘다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

**먼저 역할 강등 헬퍼를 더한다.** a01 [`db/tests/helpers/db.mjs`](../../../db/tests/helpers/db.mjs)의 `asIdentity` **뒤에** 붙인다. 이 계획이 a01의 산출물을 넓히는 유일한 곳이다:

```js
// NOLOGIN 그룹 역할의 권한으로 강등해서 돈다. 로그인 역할을 새로 만들지 않는다.
//
// 소유자 커넥션은 superuser 지만 SET ROLE 뒤에는 그 역할로 권한 검사를 받는다
// (ledger_read 는 rolsuper 도 rolbypassrls 도 아니다). security_invoker 뷰가
// 기반 테이블 GRANT 를 갖췄는지, RLS 정책이 그 역할에 붙어 있는지를 본다.
//
// 왜 필요한가: 013 은 검사 뷰를 ledger_read 에 GRANT 하는데, 지금까지 그
// 역할로 조회해 본 테스트가 하나도 없다. 소유자로만 돌면 기반 테이블 GRANT
// 누락이 전부 초록으로 통과한다.
//
// 롤백한다 — 권한 경계 확인이 목적이라 남길 행이 없다.
export async function asRole(role, fn) {
  // SET ROLE 은 파라미터를 받지 않아 문자열을 붙여야 한다. 012 가 만드는 역할
  // 이름만 통과시킨다 — 붙이기 습관이 남으면 다음 사람이 여기 변수를 넣는다.
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`unsafe role name: ${role}`);
  }
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL 이라 트랜잭션이 끝나면 사라진다. 풀에 남지 않는다.
    await client.query(`SET LOCAL ROLE "${role}"`);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
```

그다음 `db/tests/golden/spec-01-branch.test.js`의 import 줄을 아래로 바꾼다:

```js
import {
  query,
  withRollback,
  asOwner,
  asMigrator,
  asRole,
  expectSqlState,
  uniq,
  closePool,
} from '../helpers/db.mjs';
```

파일 끝에 덧붙인다:

```js
// 커밋해서 만든다. 004 의 chain_heads · 003 의 하우스 계정이 정말 같은
// 트랜잭션에서 만들어졌는지 다른 커넥션으로 확인해야 하기 때문이다.
// 롤백으로 확인하면 "한 트랜잭션 안이라 보인다" 와 구분되지 않는다.
test('R-01-05 · AC-60-3 provision_branch 가 한 트랜잭션에서 5종을 만든다', async () => {
  const code = branchCode('CEBU');

  await asOwner((client) =>
    client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
      code,
      'Cebu Test',
      '2026-03-01',
      50000000,
    ])
  );

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
  const code = branchCode('DAVAO');
  await asOwner((client) =>
    client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
      code,
      'Davao Test',
      '2026-03-01',
      50000000,
    ])
  );

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
```

> **`42501`은 두 가지 서로 다른 실패를 같은 코드로 낸다** — `GRANT EXECUTE`가 없어서(`permission denied for function`)와, 함수 안의 INSERT가 막혀서(`permission denied for table`)다. 위 `ledger_migrator` 성공 테스트가 있어야 둘이 구분된다: `SECURITY DEFINER`를 빠뜨리면 그 테스트가 후자로 빨개지고, `GRANT`를 빠뜨리면 전자로 빨개진다.

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-branch.test.js`
Expected: FAIL — `function ledger.provision_branch(unknown, unknown, unknown, integer) does not exist`

- [ ] **Step 3: 함수를 만든다**

[`db/schema/004_ledger.sql`](../../../db/schema/004_ledger.sql) 말미의 `COMMIT;` **직전**에 아래를 넣는다:

```sql
-- =============================================================================
-- 지점 프로비저닝 — 흩어진 부수 효과를 한 트랜잭션으로 묶는다 (DR-60 · AC-60-3)
-- =============================================================================
-- 지점 하나를 추가하려면 원래 네 곳을 손대야 했다 — 001 의 branches ·
-- 001 의 branch_config · 003 의 하우스 주체·계정 · 004 의 chain_heads.
-- chain_heads 를 빠뜨리면 **그 지점의 첫 거래에서 터진다.** 스키마 적용 시점이
-- 아니라 운영 중이다. 그래서 하나의 함수로 묶는다.
--
-- 여기(004 말미)에 두는 이유: chain_heads 가 이 파일 47행에서 생긴다.
-- 001 이나 003 에 두면 적용 시점에 그 테이블이 없다. 004 말미는 필요한 네 테이블이
-- 전부 존재하는 첫 지점이다.
--
-- 시드 3행이 이 함수를 쓰지 않는 이유: 함수가 정의되는 시점이 시드가 필요한
-- 시점(001·003·004 각 파일 안)보다 뒤다. 순환이다. 대신 이 블록 끝에서
-- 시드 3행이 같은 사후조건을 만족하는지 단언한다 — 두 경로가 갈라지면
-- db/scripts/apply.sh 가 그 자리에서 멈춘다.
--
-- ⚠️ 인자가 스펙 01 §2-2 표기(3개)보다 많다. approval_threshold_minor 가
-- branch_config 에서 NOT NULL 이고 기본값이 없기 때문이다 — 그것이 DR-39 의
-- 교훈이다. 예전에는 NULL 허용 + 시드 미지정이어서 신규 설치가 "임계 없음" 으로
-- 출발했고, 오류도 로그도 없이 4-eyes 통제 전체가 비활성이었다.
-- 함수가 임계값을 임의로 정하면 그 결함이 되돌아온다.
--
-- SECURITY DEFINER 인 이유: 이 함수를 부를 역할은 ledger_migrator 하나인데,
-- 012:275-291 이 그 역할에 준 것은 ledger.accounts · ledger.parties **SELECT**
-- 까지다. branches · branch_config · chain_heads · parties · accounts 어디에도
-- INSERT 가 없다. 기본값(SECURITY INVOKER)으로 두면 INSERT 가 호출자 권한으로
-- 돌아 42501 로 죽는다 — 그것도 스키마 적용 시점이 아니라 **운영에서 처음
-- 지점을 만들 때** 알게 된다. 008~011 의 op_* 가 전부 같은 이유로 정의자 함수다.
-- search_path 는 고정하고 pg_temp 를 마지막에 둔다 (012:11-14 의 PostgreSQL 권고).
CREATE FUNCTION ledger.provision_branch(
  p_code                     TEXT,
  p_name                     TEXT,
  p_opened_on                DATE,
  p_approval_threshold_minor BIGINT,
  p_is_online                BOOLEAN DEFAULT false,
  p_timezone                 TEXT    DEFAULT 'Asia/Manila',
  p_cutoff_time              TIME    DEFAULT '06:00'
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, pg_temp
AS $$
BEGIN
  -- 1. 지점 행. code 형식 · name 길이 · status 값은 branches 의 CHECK 가 본다.
  INSERT INTO ledger.branches (code, name, is_online, opened_on)
  VALUES (p_code, p_name, p_is_online, p_opened_on);

  -- 2. 영업일 · 승인 임계 설정. approval_threshold_minor > 0 은
  --    branch_config 의 CHECK 가 본다 (DR-39 센티널 규약).
  INSERT INTO ledger.branch_config (branch, timezone, cutoff_time, approval_threshold_minor)
  VALUES (p_code, p_timezone, p_cutoff_time, p_approval_threshold_minor);

  -- 3. 해시 체인 헤드. 004:56 의 시드와 **같은 식**이어야 한다.
  --    다르면 그 지점의 첫 거래에서 체인이 끊어진 것처럼 보인다.
  INSERT INTO ledger.chain_heads (branch, last_hash)
  VALUES (p_code, sha256(('cage-admin-genesis:' || p_code)::bytea));

  -- 4·5. 하우스 주체 + 하우스 계정. 정책은 003 의 함수 한 곳에만 있다.
  PERFORM ledger.bootstrap_house_accounts(p_code);

  -- 직원 배정은 여기 없다. 지점을 만드는 것과 사람을 붙이는 것은 다른 일이고,
  -- 갓 만든 지점에 직원이 없는 것은 결함이 아니다 (013 의 검사 뷰가
  -- has_staff 를 정보 열로만 낸다).
  RETURN p_code;
END;
$$;

COMMENT ON FUNCTION ledger.provision_branch IS
  '지점 추가의 유일한 경로. branches · branch_config · chain_heads · 하우스 주체 · 하우스 계정을 한 트랜잭션에서 만든다. branches 에 직접 INSERT 하면 반쪽 지점이 남는다 (AC-60-3).';

-- 부트스트랩 경로(001·003·004 의 시드)와 provision_branch() 가 갈라지지 않았는지
-- 적용 시점에 단언한다. 갈라진 사실을 신규 지점을 만들어 볼 때까지 미루지 않는다.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(b.code, ', ' ORDER BY b.code) INTO v_bad
    FROM ledger.branches b
   WHERE NOT (EXISTS (SELECT 1 FROM ledger.branch_config c WHERE c.branch = b.code)
          AND EXISTS (SELECT 1 FROM ledger.chain_heads   h WHERE h.branch = b.code)
          AND EXISTS (SELECT 1 FROM ledger.parties       p WHERE p.home_branch = b.code
                        AND p.party_type = 'house'));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '반쪽 지점이 시드에 있다: % — 001·003·004 의 시드와 provision_branch() 가 갈라졌다', v_bad;
  END IF;
END;
$$;
```

- [ ] **Step 4: `012`에 EXECUTE 정책을 더한다**

Task 2 Step 4에서 더한 블록 **바로 아래**에 붙인다:

```sql
-- 지점 추가는 이관 역할의 일이다. 자금 레인(ledger_app)이 지점을 만들 수 있으면
-- 자기 거래의 상대 계정을 스스로 지어낼 수 있게 된다.
REVOKE EXECUTE ON FUNCTION
  ledger.provision_branch(TEXT, TEXT, DATE, BIGINT, BOOLEAN, TEXT, TIME) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION
  ledger.provision_branch(TEXT, TEXT, DATE, BIGINT, BOOLEAN, TEXT, TIME) TO ledger_migrator;
```

> ROADMAP §9-6: 시그니처를 바꾸면 이 GRANT 인자 목록을 **같은 커밋에서** 고친다. 안 그러면 `009`~`013`이 적용 불가가 된다.

- [ ] **Step 5: 재적용하고 통과를 확인한다**

Run:

```bash
PGPASSWORD=devonly npm run db:reset && \
PGPASSWORD=devonly npm run db:test-role && \
PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-branch.test.js
```

Expected: PASS — `# pass 17` · `# fail 0`

- [ ] **Step 6: 커밋**

```bash
git add db/schema/004_ledger.sql db/schema/012_roles_and_grants.sql \
        db/tests/helpers/db.mjs db/tests/golden/spec-01-branch.test.js
git commit -m "feat(db): add ledger.provision_branch for one-transaction branch setup (R-01-05, AC-60-3)"
```

---

## Task 4: 반쪽 지점 검사 뷰

**Files:**

- Modify: `docs/architecture/10-acceptance-criteria.md:1366-1381` (R 번호 대장 — **먼저**)
- Modify: `db/schema/013_reconciliation.sql`
- Modify: `db/schema/012_roles_and_grants.sql` (`identity.staff_branches` 컬럼 GRANT)
- Modify: `db/tests/golden/spec-01-branch.test.js`
- Test: `db/tests/golden/spec-01-branch.test.js`

**Interfaces:**

- Consumes: `ledger.provision_branch` (Task 3) · `ledger.house_account_policy` (Task 2) · `query`, `asOwner`, `withRollback`, `asRole` (Task 3에서 추가), `uniq`, `closePool` (a01 Task 1)
- Produces: `ledger.v_check_branch_provisioning(branch, status, has_config, has_chain_head, has_house_party, house_account_count, missing_house_accounts, has_staff, ok)` — `ok = false` 행이 반쪽 지점이거나 하우스 계정이 정책과 어긋난 지점이다. `missing_house_accounts`가 둘을 가른다

**대장을 먼저 갱신한다** (ROADMAP §9-7). 그리고 이 뷰는 **`v_integrity_status`에 넣지 않는다** — 계획 결정 4.

- [ ] **Step 1: R 번호 대장에 먼저 등록한다**

[`docs/architecture/10-acceptance-criteria.md`](../../architecture/10-acceptance-criteria.md) §11 표의 `v_check_public_execute` 행 **아래**에 더한다:

```markdown
| — | `v_check_branch_provisioning` | ✅ 2026-08-16 신설. **`v_integrity_status`에 넣지 않는다** — 원장 정합성이 아니라 설치 완결성이다. R10·R11이 스펙 `01` §6에 예약돼 있어 R 번호를 쓰지 않는다 | `DR-60` · `AC-60-2` |
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`db/tests/golden/spec-01-branch.test.js` 끝에 덧붙인다:

```js
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
  const code = branchCode('ILOILO');
  await asOwner((client) =>
    client.query('SELECT ledger.provision_branch($1, $2, $3, $4)', [
      code,
      'Iloilo Test',
      '2026-03-01',
      50000000,
    ])
  );

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
```

- [ ] **Step 3: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-branch.test.js`
Expected: FAIL — `relation "ledger.v_check_branch_provisioning" does not exist`

- [ ] **Step 4: 뷰를 만든다**

[`db/schema/013_reconciliation.sql`](../../../db/schema/013_reconciliation.sql)에서 `-- 설정 드리프트 검사 — security_invoker 누락` 헤더 블록 **바로 앞**에 넣는다:

```sql
-- =============================================================================
-- 설치 완결성 검사 — 반쪽 지점 (design-review DR-60 · AC-60-2)
-- =============================================================================
-- 지점 추가가 branches INSERT 한 줄로 끝난 것처럼 보이지만, branch_config ·
-- chain_heads · 하우스 주체 · 하우스 계정이 함께 있어야 한다. chain_heads 를
-- 빠뜨리면 **그 지점의 첫 거래에서** 터진다 — 스키마 적용 시점이 아니라 운영 중이다.
--
-- 위 R1~R9 와 달리 v_integrity_status 에 넣지 않는다. 이것은 원장 정합성이 아니라
-- 설치 완결성이고, 거래를 차단할 일이 아니라 배포를 막을 일이다
-- (v_check_view_security · v_check_public_execute 와 같은 등급).
-- R 번호도 쓰지 않는다 — R10·R11 이 스펙 01 §6 에 예약돼 있다
-- (10-acceptance-criteria.md §11 대장).
--
-- has_staff 는 **정보 열이다.** ok 판정에 넣지 않는다 — 직원 배정은
-- provision_branch() 의 일이 아니고, 갓 만든 지점에 직원이 없는 것은 결함이 아니다.
--
-- 하우스 계정은 **개수가 아니라 집합으로** 본다. count(*) > 0 으로 두면 11 종 중
-- 10 종이 사라진 지점도 ok=true 다 — 그런 지점은 스키마 적용 시점이 아니라
-- 상대 계정을 못 찾는 첫 분개에서 터진다. 그래서 003 의 house_account_policy
-- 와 대조하고, 종류뿐 아니라 성격(normal_balance · allow_negative)과 통화까지 본다.
CREATE VIEW ledger.v_check_branch_provisioning
  WITH (security_invoker = true) AS
SELECT
  t.*,
  (t.has_config
   AND t.has_chain_head
   AND t.has_house_party
   AND t.missing_house_accounts = 0) AS ok
  FROM (
    SELECT
      b.code   AS branch,
      b.status AS status,
      EXISTS (SELECT 1 FROM ledger.branch_config c WHERE c.branch = b.code) AS has_config,
      EXISTS (SELECT 1 FROM ledger.chain_heads   h WHERE h.branch = b.code) AS has_chain_head,
      EXISTS (SELECT 1 FROM ledger.parties       p WHERE p.home_branch = b.code
                AND p.party_type = 'house')                                 AS has_house_party,
      -- 정보 열. 진단용이며 ok 판정에는 아래 missing_house_accounts 를 쓴다.
      (SELECT count(*) FROM ledger.accounts a
         JOIN ledger.parties p2 ON p2.id = a.party_id
        WHERE p2.home_branch = b.code AND p2.party_type = 'house')::int     AS house_account_count,
      -- 정책에 있는데 실물이 없거나 성격이 다른 종류의 수. 0 이어야 한다.
      -- ⚠️ 통화가 'PHP' 로 고정돼 있다 — a03 이 하우스 계정을 통화 곱집합으로
      -- 넓힐 때 (R-01-11) 이 조건도 함께 넓힌다. 003 의 house_account_policy 와
      -- 여기, 두 곳이 짝이다.
      (SELECT count(*) FROM ledger.house_account_policy k
        WHERE NOT EXISTS (
          SELECT 1 FROM ledger.accounts a
            JOIN ledger.parties hp ON hp.id = a.party_id
           WHERE hp.home_branch = b.code
             AND hp.party_type    = 'house'
             AND a.kind           = k.kind
             AND a.currency       = 'PHP'
             AND a.normal_balance = k.normal_balance
             AND a.allow_negative = k.allow_negative))::int                 AS missing_house_accounts,
      EXISTS (SELECT 1 FROM identity.staff_branches s WHERE s.branch = b.code) AS has_staff
      FROM ledger.branches b
  ) t;

COMMENT ON VIEW ledger.v_check_branch_provisioning IS
  'AC-60-2. ok=false 는 provision_branch() 를 건너뛴 반쪽 지점이거나 하우스 계정이 house_account_policy 와 어긋난 지점이다. missing_house_accounts 가 어느 쪽인지 가른다. has_staff 는 정보 열이며 ok 판정에 들어가지 않는다.';
```

- [ ] **Step 5: GRANT를 더한다 — 뷰 하나로는 안 된다**

먼저 같은 파일(`013`)의 `GRANT SELECT ON ... TO ledger_read;` 목록에서 `ledger.v_check_view_security,` 줄 **아래**에 더한다:

```sql
  ledger.v_check_branch_provisioning,
```

**이것만으로는 `ledger_read`가 이 뷰를 못 읽는다.** `security_invoker` 뷰라 기반 테이블을 호출자 권한으로 읽는데, [`012:186`](../../../db/schema/012_roles_and_grants.sql)의 `GRANT SELECT ON ALL TABLES`는 `ledger, cage`만 덮는다. `identity`는 `012:194`가 **USAGE**만 주고 `012:196-197`이 `identity.staff`의 컬럼만 연다 — `identity.staff_branches`는 어디에도 없다. 소유자로 테스트하면 이 사실이 안 보인다 (계획 결정 5).

[`db/schema/012_roles_and_grants.sql`](../../../db/schema/012_roles_and_grants.sql)의 `GRANT SELECT (party_id, member_no, vip, ...) ON ledger.member_profiles TO ledger_read;` **뒤에** 더한다:

```sql
-- 013 의 v_check_branch_provisioning 이 security_invoker 라 이 테이블을
-- 호출자 권한으로 읽는다. 뷰가 쓰는 것은 branch 한 컬럼뿐이므로 컬럼 단위로만
-- 연다 — "어느 지점에 직원이 있는가" 는 나가고 "누가 어느 지점인가" 는 안 나간다.
-- 테이블 통째로 열면 리포팅 자격증명 하나로 직원 배치도를 뜰 수 있게 된다.
GRANT SELECT (branch) ON identity.staff_branches TO ledger_read;
```

> ROADMAP §9-6과 같은 성격의 짝이다: **`security_invoker` 뷰에 테이블을 하나 더 끌어들이면 `012`의 `ledger_read` GRANT를 같은 커밋에서 확인한다.** 안 그러면 뷰는 만들어지고 조회만 `42501`로 죽는다.

- [ ] **Step 6: 재적용하고 통과를 확인한다**

Run:

```bash
PGPASSWORD=devonly npm run db:reset && \
PGPASSWORD=devonly npm run db:test-role && \
PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/ db/tests/drift/
```

Expected: PASS — `# fail 0`. `security_invoker`를 빠뜨렸다면 `drift/security.test.js`와 이 파일의 마지막 테스트가 **둘 다** 빨개진다

- [ ] **Step 7: 커밋**

```bash
git add docs/architecture/10-acceptance-criteria.md db/schema/013_reconciliation.sql \
        db/schema/012_roles_and_grants.sql db/tests/golden/spec-01-branch.test.js
git commit -m "feat(db): detect half-provisioned branches with v_check_branch_provisioning (R-01-06, AC-60-2)"
```

---

## Task 5: U4 전환 회귀 가드

**Files:**

- Create: `db/tests/drift/branch-model.test.js`
- Modify: `db/schema/005_games_rolling.sql:160`
- Test: `db/tests/drift/branch-model.test.js`

**Interfaces:**

- Consumes: `query`, `closePool` (a01 Task 1) · `node:fs/promises`
- Produces: 없음 (검증 전용)

**`R-01-01`~`R-01-04`는 이미 참이다. 이 Task는 만들지 않고 못 되돌아가게 한다.** ENUM 이 되살아나거나, FK 없는 `branch` 컬럼이 새로 생기거나, `current_branches()` 반환형이 바뀌면 **다음 계획(a03~a14) 어딘가에서** 조용히 벌어진다. 여기서 잡는다.

`R-01-04`는 카탈로그가 아니라 **소스 텍스트** 검사다 — 존재하지 않는 ENUM을 읽는 쿼리는 문서와 주석 안에만 남아 있을 수 있고, 그것을 복사해 쓰는 순간 틀린다.

- [ ] **Step 1: 테스트를 쓴다**

`db/tests/drift/branch-model.test.js`:

```js
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/drift/branch-model.test.js`
Expected: FAIL — `AC-49-1` 테스트가 `005 에 R4 위치를 알리는 주석이 없다`로 떨어진다. 나머지 6건은 PASS (이미 참인 요구사항이다)

> 여기서 나머지가 하나라도 실패하면 **실측이 틀렸다는 뜻이다.** 진행하지 말고 그 파일을 먼저 읽는다.

- [ ] **Step 3: `005`에 R4 위치 주석을 더한다 (`AC-49-1`)**

[`db/schema/005_games_rolling.sql:160`](../../../db/schema/005_games_rolling.sql)의 `-- 게임 롤링 총액 프로젝션 갱신` 줄을 아래로 교체한다:

```sql
-- 게임 롤링 총액 프로젝션 갱신
-- R4 (cage.v_check_rolling_projection) 는 013_reconciliation.sql 에 있다.
-- 뷰는 대사 파일에 모으고 트리거는 도메인 파일에 둔다 — 이 주석이 예전에
-- 잘못된 파일을 가리키고 있었다 (design-review-3.md DR-49 · AC-49-1).
```

> **`R4` 와 `013` 이 반드시 같은 줄에 있어야 한다.** Step 1의 `AC-49-1` 테스트가 `R4` 를 담은 **첫 줄**을 찾아 그 줄에 `013` 이 있는지 본다. 두 줄로 나누면 테스트가 실패한다 — 그리고 그것이 의도다. 주석이 두 줄로 갈라지면 "R4 는 여기 있다" 라는 한 문장이 읽는 사람에게 한 번에 도달하지 않는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/drift/`
Expected: PASS — `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add db/tests/drift/branch-model.test.js db/schema/005_games_rolling.sql
git commit -m "test(db): lock in the U4 branch reference conversion (R-01-01..R-01-04, AC-49-1)"
```

---

## Task 6: 픽스처를 `provision_branch()` 위로 옮긴다

**Files:**

- Create: `db/tests/fixtures/branches.mjs`
- Modify: `db/tests/golden/spec-01-branch.test.js`
- Modify: `db/tests/README.md`
- Test: `db/tests/golden/spec-01-branch.test.js`

**Interfaces:**

- Consumes: `asOwner`, `uniq` (a01 Task 1) · `ledger.provision_branch` (Task 3)
- Produces: `provisionBranch({prefix, name, openedOn, approvalThresholdMinor, isOnline, timezone, cutoffTime}) -> Promise<string>` — 새 지점 코드를 돌려준다. `R-12-20`이 요구하는 유일한 지점 생성 경로다

**`R-12-20`이 이 Task의 이유다.** [`db/tests/README.md`](../../../db/tests/README.md)가 이미 적어 두었다 — "픽스처는 시드 지점 3종을 쓴다. `ledger.provision_branch()` 가 생기면 그 위로 옮긴다 (`R-12-20`, a02)." 지금 그 함수가 생겼다.

**시드 3종을 대체하는 것이 아니다.** a01의 기존 픽스처는 `HANN`을 계속 쓴다 — 그것으로 충분하고, 테스트마다 지점을 만들면 하우스 계정이 실행마다 11개씩 쌓인다. 이 픽스처는 **지점 자체가 검사 대상인 테스트**(Task 3·4, 그리고 앞으로 지점 격리를 보는 테스트)에서만 쓴다.

- [ ] **Step 1: 픽스처를 만든다**

`db/tests/fixtures/branches.mjs`:

```js
// 지점 픽스처 (R-12-20).
//
// ledger.branches 에 직접 INSERT 하지 않는다. 그러면 branch_config ·
// chain_heads · 하우스 주체 · 하우스 계정이 빠진 반쪽 지점이 남고,
// 그 지점을 쓰는 테스트는 "첫 거래에서 터지는" 결함을 재현하게 된다.
// 반쪽 지점을 일부러 만드는 것은 그 자체가 검사 대상인 테스트뿐이다
// (db/tests/golden/spec-01-branch.test.js 의 AC-60-2 케이스).
//
// 소유자 커넥션으로 만들고 커밋한다. provision_branch 의 EXECUTE 는
// ledger_migrator 에만 있고 ledger_app 에는 없다 — 자금 레인이 지점을 만들 수
// 있으면 자기 거래의 상대 계정을 스스로 지어낼 수 있다 (012).
import { asOwner, uniq } from '../helpers/db.mjs';

// branches_code_format: ^[A-Z][A-Z0-9_-]{1,15}$ — 대문자 시작, 총 2~16자.
export function branchCode(prefix) {
  return `${prefix}${uniq('')}`.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

export async function provisionBranch({
  prefix = 'T',
  name,
  openedOn = '2026-01-01',
  // DR-39: 임계는 반드시 정한다. 끄려면 BIGINT 최댓값을 넣는다 — 0 이나 NULL 로
  // 끄면 "끄기로 했다" 가 데이터에 남지 않는다.
  approvalThresholdMinor = 50000000,
  isOnline = false,
  timezone = 'Asia/Manila',
  cutoffTime = '06:00',
} = {}) {
  const code = branchCode(prefix);
  await asOwner((client) =>
    client.query('SELECT ledger.provision_branch($1, $2, $3, $4, $5, $6, $7)', [
      code,
      name ?? `TEST ${code}`,
      openedOn,
      approvalThresholdMinor,
      isOnline,
      timezone,
      cutoffTime,
    ])
  );
  return code;
}
```

- [ ] **Step 2: 골든 테스트가 픽스처를 쓰게 바꾼다**

`db/tests/golden/spec-01-branch.test.js`에서 로컬 `branchCode()` **정의를 지우고** 픽스처에서 가져온다. import에 한 줄 더한다:

```js
import { provisionBranch, branchCode } from '../fixtures/branches.mjs';
```

그리고 `asOwner(... provision_branch ...)` 호출 셋을 픽스처 호출로 바꾼다:

```js
// (1) R-01-05 · AC-60-3 5종 생성
const code = await provisionBranch({ prefix: 'CEBU', name: 'Cebu Test', openedOn: '2026-03-01' });

// (2) R-01-05 chain_heads 창세 해시
const code = await provisionBranch({ prefix: 'DAVAO', name: 'Davao Test', openedOn: '2026-03-01' });

// (3) R-01-06 has_staff 정보 열
const code = await provisionBranch({ prefix: 'ILOILO', name: 'Iloilo Test', openedOn: '2026-03-01' });
```

**바꾸지 않는 곳 셋** — 전부 `provision_branch`를 **거치지 않는** 경로를 일부러 본다:

- `AC-60-3 ledger.bootstrap_house_accounts ...` — 하우스 조각만 만드는 것이 요점
- `AC-60-3 같은 지점에 두 번 부르면 거부된다` — 시드 지점 `HANN` 을 쓴다
- `R-01-06 ... 반쪽 지점이 잡힌다` — 반쪽으로 만드는 것이 요점

이 셋은 `branchCode()`를 계속 쓴다 (이제 픽스처에서 import 한 것).
`asOwner` import가 더 이상 쓰이지 않으면 import 줄에서 뺀다.

- [ ] **Step 3: 통과를 확인한다**

Run:

```bash
PGPASSWORD=devonly npm run db:reset && \
PGPASSWORD=devonly npm run db:test-role && \
PGPASSWORD=devonly npm run test:db
```

Expected: PASS — `# fail 0`

- [ ] **Step 4: `db/tests/README.md`를 고친다**

디렉터리 표에서 `invariants/` 행 **위**에 더한다:

```markdown
| `golden/`     | 스펙 번호별 골든 테스트 — `spec-01-branch` 등                                              | `12` §3               |
```

규약 목록의 지점 줄(`픽스처는 시드 지점 3종...`)을 아래로 교체한다:

```markdown
- **새 지점은 `ledger.provision_branch()` 로만 만든다** (`R-12-20`). `db/tests/fixtures/branches.mjs` 의 `provisionBranch()` 가 유일한 경로다. `ledger.branches` 에 직접 INSERT 하면 `branch_config` · `chain_heads` · 하우스 주체 · 하우스 계정이 빠진 **반쪽 지점**이 남고, 그 지점을 쓰는 테스트는 첫 거래에서 터진다. 일부러 반쪽으로 만드는 것은 `AC-60-2` 케이스뿐이다. 대부분의 테스트는 시드 3종(`HANN` · `NUSTAR` · `ONLINE`)을 그대로 쓴다 — 테스트마다 지점을 만들면 하우스 계정이 실행마다 11개씩 쌓인다.
```

"아직 비어 있다" 절 전체를 아래로 교체한다:

```markdown
## 채워진 곳

| 계획 | 채운 것 |
|---|---|
| `a01-ci-golden-harness` | `helpers/` · `fixtures/` · `posting/` · `invariants/` · `drift/security` · CI 잡 |
| `a02-branch-reference` | `golden/spec-01-branch` · `drift/branch-model` · `fixtures/branches` |

대장은 [`docs/superpowers/ROADMAP.md`](../../docs/superpowers/ROADMAP.md).
```

- [ ] **Step 5: 커밋**

```bash
git add db/tests/fixtures/branches.mjs db/tests/golden/spec-01-branch.test.js db/tests/README.md
git commit -m "test(db): create branches only through provision_branch (R-12-20)"
```

---

## Task 7: `01` §7 운영 가드 문서를 실제와 맞춘다

**Files:**

- Modify: `docs/architecture/ddl/README.md` (`## 주의` 절)
- Modify: `docs/architecture/references.md:19`
- Modify: `docs/architecture/10-acceptance-criteria.md:609-619`
- Test: `npm run docs:check-links` · `npm run docs:check-line-refs` (a01 Task 12)

**Interfaces:**

- Consumes: a01 Task 12의 `tools/check-line-refs.mjs`
- Produces: 없음 (문서 정정)

**`R-01-50`이 가리키는 문단이 존재하지 않는다.** [`references.md:19`](../../architecture/references.md)의 `SET CONSTRAINTS` 행이 `ddl/README`를 가리키는데, 그 파일에는 `SET CONSTRAINTS`라는 문자열이 없다. 금지 규약은 [`db/README.md:56`](../../../db/README.md)에만 있다. **참조가 가리키는 곳에 내용이 없는 상태**가 `AC-59-1`·`AC-59-2`가 막으려던 바로 그것이다.

- [ ] **Step 1: `ddl/README.md`에 금지 문단을 넣는다 (`R-01-50` · `AC-59-1`)**

[`docs/architecture/ddl/README.md`](../../architecture/ddl/README.md)의 `## 주의` 줄 **바로 아래**, 첫 항목(`- **적용 순서가 계약이다.**`) **앞**에 넣는다:

```markdown
### `SET CONSTRAINTS ALL IMMEDIATE` 금지

**이 스키마에서 `SET CONSTRAINTS ALL IMMEDIATE` 를 실행하지 않는다.** 애플리케이션 ·
마이그레이션 · 운영 스크립트 · 테스트 어디서도 마찬가지다.

지연 제약 트리거 4개가 `DEFERRABLE INITIALLY DEFERRED` 다 —
[`004`](../../../db/schema/004_ledger.sql) 에 셋, [`005`](../../../db/schema/005_games_rolling.sql)
에 하나. 이들이 COMMIT 시점에 발화하는 것이 설계다. `IMMEDIATE` 로 바꾸면 각 트리거가
**분개 한 줄이 들어갈 때마다** 돈다.

그러면 **다중 분개 거래가 삽입 순서에 의존하게 된다.** 차대 균형(I1)은 거래의 마지막
분개가 들어가야 성립하므로 첫 분개에서 반드시 깨진다. 잔액 하한(I2)도 같다 — 차감이
먼저 들어가면 상계될 입금이 아직 없다. 봉인 트리거는 해시가 채워지기 전의 거래를
미봉인으로 판정한다. **정상 거래가 실패하고, 실패 이유는 데이터가 아니라 순서다.**

`R-01-50` · `AC-59-1`. 반대편 짝은 `R-01-52` — 골든 테스트
[`db/tests/invariants/deferred.test.js`](../../../db/tests/invariants/deferred.test.js) 가
`SET CONSTRAINTS ALL IMMEDIATE` 후 다중 분개 거래가 **의도대로 실패하는 것**을 고정한다
(`AC-59-3`). 금지가 취향이 아니라 관찰된 동작임을 그 테스트가 증명한다.

같은 규약이 [`db/README.md`](../../../db/README.md) 에도 있다 — 실행 자산 쪽에서
읽는 사람을 위한 것이고, 근거 문단은 여기다.
```

> 줄 번호를 본문에 쓰지 않는다. a01의 `tools/check-line-refs.mjs`가 `<파일>:<줄>` 참조를 검사하는데, 트리거 위치는 앞으로 계획들이 `004`·`005`를 고치면서 밀린다. 파일만 가리키면 밀려도 틀리지 않는다.

- [ ] **Step 2: `references.md` 행이 그 문단을 가리키게 한다 (`R-01-51` · `AC-59-2`)**

[`docs/architecture/references.md:19`](../../architecture/references.md) 행을 아래로 교체한다:

```markdown
| `SET CONSTRAINTS` — **금지 규약** | [`ddl/README` § SET CONSTRAINTS ALL IMMEDIATE 금지](ddl/README.md#set-constraints-all-immediate-금지) · 골든 테스트 [`invariants/deferred`](../../db/tests/invariants/deferred.test.js) | https://www.postgresql.org/docs/current/sql-set-constraints.html |
```

- [ ] **Step 3: `DR-60` 검증 쿼리에서 `enum_range`를 걷어낸다 (`R-01-04`)**

[`docs/architecture/10-acceptance-criteria.md:609-619`](../../architecture/10-acceptance-criteria.md)의 SQL 블록을 아래로 교체한다:

````markdown
```sql
-- 지점 프로비저닝 누락 탐지. U4 전환 후에는 ENUM 이 없으므로 ledger.branches 를 읽는다
-- (docs/spec/00-decisions.md §5 · R-01-04). 이 쿼리는 013 의
-- ledger.v_check_branch_provisioning 뷰로 상시화돼 있다 — 아래는 그 정의의 뼈대다.
SELECT b.code AS branch,
       EXISTS (SELECT 1 FROM ledger.branch_config    c WHERE c.branch = b.code) AS has_config,
       EXISTS (SELECT 1 FROM ledger.chain_heads      h WHERE h.branch = b.code) AS has_chain_head,
       EXISTS (SELECT 1 FROM ledger.parties          p WHERE p.home_branch = b.code
                 AND p.party_type = 'house')                                    AS has_house_party,
       EXISTS (SELECT 1 FROM identity.staff_branches s WHERE s.branch = b.code)  AS has_staff
  FROM ledger.branches b WHERE b.status = 'active';
-- 기대: has_staff 를 뺀 전 열 true. has_staff 는 정보 열이다 —
-- provision_branch() 는 직원을 배정하지 않고, 갓 만든 지점에 직원이 없는 것은 결함이 아니다.
```
````

- [ ] **Step 4: `R-01-52`가 a01에서 이미 충족됐는지 확인한다**

Run:

```bash
grep -n "R-01-52\|SET CONSTRAINTS ALL IMMEDIATE" db/tests/invariants/deferred.test.js
```

Expected: `R-01-52 · AC-59-3 SET CONSTRAINTS ALL IMMEDIATE 후 다중 분개 거래가 실패한다` 테스트가 잡힌다

> **잡히지 않으면 a01 Task 9가 아직 안 들어온 것이다.** 이 계획에서 그 테스트를 새로 쓰지 않는다 — 두 벌이 되면 어느 쪽이 계약인지 알 수 없어진다. a01을 먼저 끝낸다.

- [ ] **Step 5: 문서 검사 2종을 돌린다**

Run:

```bash
npm run docs:check-links && npm run docs:check-line-refs
```

Expected: 둘 다 종료 코드 0. Step 1이 더한 링크의 대상 파일이 실재하는지 `check-doc-links`가 본다 — `db/tests/invariants/deferred.test.js`가 없으면 여기서 잡히고, 그것은 a01이 아직 안 들어왔다는 뜻이다 (Step 4와 같은 신호)

- [ ] **Step 6: 커밋**

```bash
git add docs/architecture/ddl/README.md docs/architecture/references.md docs/architecture/10-acceptance-criteria.md
git commit -m "docs: put the SET CONSTRAINTS prohibition where references point (R-01-50, R-01-51, R-01-04)"
```

---

## Task 8: 스펙 정정과 대장 갱신

**Files:**

- Modify: `docs/spec/01-ledger-foundation.md:44-62`
- Modify: `db/README.md:56`
- Modify: `docs/superpowers/ROADMAP.md:56`
- Test: `npm run docs:check-links` · `npm run test:db`

**Interfaces:**

- Consumes: 없음
- Produces: 없음

**계획이 스펙과 다르게 간 곳 2건을 스펙에 되먹인다.** ROADMAP §11: "계획과 어긋나면 결정 대장이 맞다" — 결정 대장(`00-decisions`)과는 어긋나지 않았고, 어긋난 것은 스펙 `01`의 **표기**다. 고쳐 둔다. 안 고치면 다음 사람이 스펙을 읽고 3인자 함수를 찾다가 못 찾는다.

- [ ] **Step 1: `R-01-03` 스키마 표기를 실제와 맞춘다**

[`docs/spec/01-ledger-foundation.md:44`](../../spec/01-ledger-foundation.md)의 `R-01-03` 행을 아래로 교체한다:

```markdown
| `R-01-03` | **`ledger.current_branches()`**가 `TEXT[]`를 반환하고 RLS 정책이 그 형으로 비교한다. 스키마는 `identity`가 아니라 `ledger`다 — `012`의 RLS 정책 전부가 `ledger.current_branches()`를 부른다 |
```

- [ ] **Step 2: `R-01-05` 시그니처를 실제와 맞춘다**

[`docs/spec/01-ledger-foundation.md:46`](../../spec/01-ledger-foundation.md)의 `R-01-05` 행을 아래로 교체한다:

```markdown
| `R-01-05` | **`ledger.provision_branch(p_code, p_name, p_opened_on, p_approval_threshold_minor, [p_is_online, p_timezone, p_cutoff_time])`가 한 트랜잭션에서 5종을 만든다** — `branches` 행 · `branch_config` 행 · `chain_heads` 행 · 하우스 주체 · 하우스 계정. **임계값이 필수 인자인 이유는 `DR-39`다** — `branch_config.approval_threshold_minor`가 `NOT NULL`이고 기본값이 없다. 함수가 임의로 정하면 "임계 없음"으로 출발하는 결함이 되돌아온다. 직원 배정은 포함하지 않는다 |
```

- [ ] **Step 3: §2-3 검증 쿼리의 기대를 실제와 맞춘다**

[`docs/spec/01-ledger-foundation.md:62`](../../spec/01-ledger-foundation.md)의 `-- 기대: 전 열 true` 줄을 아래로 교체한다:

```
-- 기대: has_staff 를 뺀 전 열 true. 이 쿼리는 013 의
-- ledger.v_check_branch_provisioning 으로 상시화돼 있다 (계획 a02).
-- has_staff 는 정보 열이다 — provision_branch() 의 5종에 직원 배정이 없고,
-- 갓 만든 지점에 직원이 없는 것은 결함이 아니다.
```

- [ ] **Step 4: `db/README.md`의 `SET CONSTRAINTS` 항목이 근거 문단을 가리키게 한다**

[`db/README.md:56`](../../../db/README.md)의 항목 끝에 한 줄 더한다:

```markdown
  근거 문단은 [`docs/architecture/ddl/README.md`](../docs/architecture/ddl/README.md#set-constraints-all-immediate-금지) 에 있다 (`R-01-50`). 반대편 짝은 `db/tests/invariants/deferred.test.js` (`R-01-52` · `AC-59-3`).
```

- [ ] **Step 5: ROADMAP 상태를 구현 완료로 올린다**

계획 파일을 만들 때 이미 `✅ 계획 작성 완료`로 갱신했다 (ROADMAP §10). 위 종료 게이트가 전부 초록이면 [`docs/superpowers/ROADMAP.md:56`](../ROADMAP.md)의 a02 행을 아래로 교체한다:

```markdown
| **a02** | [`a02-branch-reference`](plans/2026-08-16-a02-branch-reference.md) | [`01`](../spec/01-ledger-foundation.md) §2 · §7 | a01 | M0 | 🏁 구현 완료 |
```

> `🏁`는 ROADMAP §10에서 "해당 스펙 골든 테스트 전 통과"를 뜻한다. a02가 닫는 것은 스펙 `01` §8 중 `R-01-05` 한 건이므로, **§8 나머지 13건이 아직 빨간 것은 정상이다** — a03이 닫는다. 이 사실을 커밋 메시지 본문에 적는다.

- [ ] **Step 6: 전체를 돌린다**

Run:

```bash
PGPASSWORD=devonly npm run db:reset && \
PGPASSWORD=devonly npm run db:test-role && \
PGPASSWORD=devonly npm run test:db && \
npm run docs:check-links && \
npm run docs:check-line-refs
```

Expected: `OK: 13 files applied` · `# fail 0` · 문서 검사 2종 종료 코드 0

- [ ] **Step 7: 커밋**

```bash
git add docs/spec/01-ledger-foundation.md db/README.md docs/superpowers/ROADMAP.md
git commit -m "docs: fold a02's signature and schema corrections back into spec 01"
```

---

## 종료 게이트

ROADMAP §9-3: 각 계획의 종료 게이트 = 해당 스펙의 **골든 테스트 절 전부 통과.** 스펙 `01` §8의 14건 중 **a02 범위는 `R-01-05` 한 건**이다 — 나머지 13건은 §3~§6(a03) 소관이다.

| 판정 | 명령 | 기대 |
|---|---|---|
| 스키마가 빈 DB에 클린 적용된다 | `PGPASSWORD=devonly npm run db:reset` | `OK: 13 files applied` |
| `R-01-05` `provision_branch(...)` → §2-3 쿼리가 전 열 true | `node --test db/tests/golden/spec-01-branch.test.js` | `# fail 0` |
| `R-01-01`~`R-01-04` 회귀 가드 | `node --test db/tests/drift/branch-model.test.js` | `# fail 0` |
| `R-01-06` · `AC-60-2` 반쪽 지점 탐지 | 위 두 파일에 포함 | 반쪽 지점이 `ok=false` 로 나온다. **계정이 한 종류만 남은 지점도 `ok=false`** |
| 역할 경계 — `ledger_migrator`가 `provision_branch`를 **실제로 실행**한다 | `node --test db/tests/golden/spec-01-branch.test.js` | `# fail 0`. `SECURITY DEFINER`가 빠지면 `42501 permission denied for table branches` |
| 역할 경계 — `ledger_read`가 검사 뷰를 **실제로 조회**한다 | 같은 파일 | `# fail 0`. `identity.staff_branches(branch)` GRANT가 빠지면 `42501 permission denied for table staff_branches` |
| 역할 경계 — `ledger_app`·`ledger_migrator`의 우회로가 막혀 있다 | 같은 파일 | `provision_branch` 호출과 `branches` 직접 INSERT 가 각각 `42501` |
| `R-01-50`·`R-01-51`·`R-01-53` 문서 정합 | `npm run docs:check-links && npm run docs:check-line-refs` | 종료 코드 0 |
| `R-01-52` | a01 소관 — `grep R-01-52 db/tests/invariants/deferred.test.js` | 테스트가 존재한다 |
| 기존 하니스가 안 깨졌다 | `PGPASSWORD=devonly npm run test:db` | `# fail 0` |

**a02가 닫지 않는 것 (a03으로 넘어간다):** `R-01-10`~`R-01-16`(통화 5종 · 하우스 계정 곱집합) · `R-01-20`~`R-01-25`(분개 규칙 표) · `R-01-30`~`R-01-40`(불변식) · §6(대사 R1·R2·R7·R10·R11). 특히 **하우스 계정이 아직 `PHP`만이다.** a03이 넓힐 자리는 **짝을 이루는 두 곳**이다 (계획 결정 3): `003`의 `bootstrap_house_accounts()` 안 `INSERT ... SELECT`에 `ledger.currencies`를 크로스조인하고, `013`의 `v_check_branch_provisioning`에서 `a.currency = 'PHP'` 조건을 같이 넓힌다. 앞만 고치면 신규 지점이 초록으로 나오지 않고, 뒤만 고치면 모든 지점이 빨개진다.

---

## 실행 순서와 차단 요인

```
[a01 구현 완료]  ← db/tests/helpers/db.mjs · test-role.sh · test:db 가 있어야 한다
      │
   Task 1  branches 모양          (001)
      │
   Task 2  하우스 계정 함수 추출   (003 · 012)
      │
   Task 3  provision_branch       (004 · 012)   ← Task 2 의 함수를 부른다
      │
   ├── Task 4  검사 뷰            (013 · 10-AC §11)
   │
   ├── Task 5  회귀 가드          (drift · 005)  ← Task 3 과 병렬 가능
   │
   └── Task 6  픽스처             (fixtures · README)  ← Task 3·4 뒤
             │
          Task 7  §7 문서 정정
             │
          Task 8  스펙·대장 갱신
```

**차단 결정 없음.** ROADMAP §7의 B1~B5 중 a02를 막는 것은 하나도 없다 — B1(교대 카운터 항등식)은 a03·a06, B2·B3는 a10·a11, B4는 a13, B5는 a14다. a02는 ROADMAP §3 표에서 `⬜`(미작성 · 선행만 풀리면 가능)로 표기돼 있다.

**유일한 실질 차단은 a01의 구현이다.** 계획만 있고 코드가 없으면 이 계획의 테스트를 한 줄도 돌릴 수 없다.
