# DDL — 스키마 설계 문서

> **`.sql` 파일은 여기 없다.** 2026-08-15 D1 결정으로 [`db/schema/`](../../../db/schema/)로 옮겼다
> ([`00-decisions.md`](../../spec/00-decisions.md) §12). `docs/`는 문서만 담는다.
> 이 문서가 `ddl/004`라고 부르는 것은 `db/schema/004_ledger.sql`이다. **번호가 이름이다.**
> 적용 절차와 운영 규약은 [`db/README.md`](../../../db/README.md).

PostgreSQL 18 기준. 번호 순서대로 적용한다.

```bash
PGPASSWORD=devonly npm run db:apply     # db/scripts/apply.sh — 001 → 013
```

## 계층

```
001~007   테이블 · 타입 · 불변식        데이터 구조와 제약
008       원장 코어                     내부 전용. 앱에 노출하지 않는다
009~011   연산 함수                     애플리케이션 API. 이것만 EXECUTE 가능
012       역할 · 권한 · RLS             위 규칙을 실제로 강제한다
013       대사 · 파생 뷰                상시 검증
```

**이 계층이 설계의 핵심이다.** `ledger_app` 은 자금 테이블에 DML 권한이 없고
`008` 의 코어 함수에도 EXECUTE 권한이 없다. 가진 것은 `009`~`011` 의
`op_*` 함수 EXECUTE 와 조회 SELECT 뿐이다.

## 파일

| # | 파일 | 내용 | 설계 문서 |
|---|---|---|---|
| 001 | `001_types_and_extensions.sql` | 스키마 · ENUM · 통화 · 영업일 규칙 · 승인 임계 | [03](../03-ledger-model.md) |
| 002 | `002_identity.sql` | 직원 · **파트너 운영자** · 세션 · TOTP · RBAC · 4-eyes 승인 · 인가 함수 | [06](../06-security.md) |
| 003 | `003_accounts.sql` | 주체 · 계정 · 잔액 프로젝션 · KYC · **파트너 프로필** | [03](../03-ledger-model.md) |
| 004 | `004_ledger.sql` | 거래 · 분개 · **분개 정의표** · 불변식 · 멱등키 | [03](../03-ledger-model.md) · [04](../04-posting-rules.md) |
| 005 | `005_games_rolling.sql` | 게임 · 롤링 · 정산 · 메인케이지 · 칩재고 | [01](../01-current-system.md) |
| 006 | `006_periods_balancing.sql` | 실사 · 기간 행 확보 | [03](../03-ledger-model.md) |
| 007 | `007_outbox_audit.sql` | Outbox · 감사 로그 · 레거시 아카이브 | [02](../02-target-architecture.md) |
| 008 | `008_post_transaction.sql` | **내부 전용.** 해시 정규화 · 멱등 · 기록 · 역분개 | [03](../03-ledger-model.md) |
| 009 | `009_operations_money.sql` | 입금 · 출금 · 이체 · 지점이체 · 지갑이체 · 차액조정 | [04](../04-posting-rules.md) §1~4 · 11 · 12 |
| 010 | `010_operations_game.sql` | 게임 개설 · 바이인 · 롤링 · 정산 · 취소 · 메인케이지 | [04](../04-posting-rules.md) §5~10 |
| 011 | `011_operations_admin.sql` | 승인 · 실사 · 기간 마감 · 교대 · 계좌 개설 | [04](../04-posting-rules.md) §11 · 15 |
| 012 | `012_roles_and_grants.sql` | 역할 · 권한 · RLS | [06](../06-security.md) |
| 013 | `013_reconciliation.sql` | 대사 R1~R7 · 교대 카운터 파생 뷰 | [03](../03-ledger-model.md) |

## 주의

- **적용 순서가 계약이다.** 파일 간 FK · 함수 의존이 번호 순서를 전제한다.
  예외 둘:
  - `011` 의 `op_settle_period()` 가 `013` 의 `ledger.integrity_ok()` 를
    호출한다. plpgsql 본문은 실행 시점에 해석되므로 생성은 성공하지만,
    `013` 적용 전에는 그 함수를 호출할 수 없다.
  - `002` 의 `identity.staff.partner_party_id` 는 컬럼만 만들고 FK 를 붙이지
    않는다. 참조 대상 `ledger.parties` 가 `003` 에서 생기기 때문이다.
    제약은 `003` 말미의 `ALTER TABLE identity.staff ADD CONSTRAINT
    staff_partner_party_fk` 가 붙인다.
- **ENUM 에 값을 추가하면 함께 고쳐야 하는 곳이 있다.** 값만 늘리면 조용히
  틀린 상태가 된다.
  - `ledger.account_kind` → `003` 의 `ledger.assert_account_kind_consistent()`
    CASE (누락 시 `v_expected` 가 NULL 이 되어 계정 생성이 막힌다) ·
    `003` 의 지점 하우스 부트스트랩 배열 · `004` 의 `posting_rules` 시드
  - `ledger.party_type` → `012` 의 `ledger.party_visible()` CASE
    (누락 시 `home_branch` 비교로 떨어져 **전면 비가시**가 된다)
  - `ledger.entry_category` · `ledger.tx_kind` → `004` 의 `posting_rules` 시드 ·
    [04-posting-rules.md](../04-posting-rules.md) §16 목록
- 애플리케이션은 커넥션마다 `SET LOCAL app.staff_id = '<staff.id>'` 를 설정한다.
  설정하지 않으면 RLS 기본 거부로 조회 결과가 빈다 — 조용히 새는 게 아니라
  즉시 빈 결과가 된다.
- **지점은 ENUM 이 아니라 `ledger.branches` 참조 테이블이다** (U4 결정 2026-08-15 ·
  [`docs/spec/00-decisions.md`](../../spec/00-decisions.md) §5). 시드 3행(HANN ·
  NUSTAR · ONLINE)은 값이지 제약이 아니다. 전 테이블의 `branch` 컬럼이
  `TEXT REFERENCES ledger.branches(code)` 이고 `current_branches()` 반환형은 `TEXT[]` 다.
  - **지점 추가는 `provision_branch()` 로만 한다.** `branches` 에 INSERT 만 하면
    `branch_config` · `chain_heads` · 하우스 주체 · 하우스 계정이 빠진 반쪽 지점이 남는다.
  - `003` 의 부트스트랩 `DO` 블록은 이제 `ledger.branches` 를 읽는다. 지점 목록을
    하드코딩하지 않는다.
- 통화는 **5종**(`PHP` · `USD` · `HKD` · `CNY` · `KRW`)을 심는다 (U2 결정 2026-08-15).
  환전 연산(`fx_exchange` · `fx_rates` · `fx_position`)은 **만들지 않는다.**
  `KRW` 는 `scale = 0` 이므로 최소 단위 산술이 통화마다 다르다 — PHP 만 통과하고
  나머지가 비뚤어지는 사각을 CI 가 잡아야 한다 (`DR-41`).
- **하우스 계정 부트스트랩은 아직 `PHP` 만 만든다.** U2 결정대로면
  `branches × currencies × house account_kind` 곱집합이어야 하고, 그 확장이 M0 작업이다
  ([`docs/spec/01-ledger-foundation.md`](../../spec/01-ledger-foundation.md) `R-01-11`).
  현재 상태에서 PHP 외 통화 거래는 상대 하우스 계정이 없어 실패한다.
- `identity.staff` 의 `pin_hash` · `withdraw_pw_hash` 는 **애플리케이션이
  Argon2id 로 해시해 넣는다.** DB 는 형식을 강제하지 않는다.
- `member_profiles.passport_no_enc` 는 **애플리케이션 계층 KMS 암호화** 값이다.
  DB 관리자가 평문을 볼 수 없어야 한다.
- **2026-08-14: PostgreSQL 18 에 전 파일 클린 적용을 확인했다.** 그 과정에서
  기존 결함 두 건이 드러났고 함께 고쳤다.
  - `008` `begin_idempotent()` — `RETURNING ... INTO v_inserted, v_row`.
    PL/pgSQL 의 다중 타깃 `INTO` 는 스칼라만 받는다. 행 변수는 단독 타깃이어야
    하므로 삽입 여부만 받고 기존 행은 다시 읽도록 분리했다.
  - `012` — `GRANT EXECUTE ... ledger.current_branches()` 가 그 함수의 정의보다
    앞에 있었다. 세션 스코프 헬퍼의 GRANT 를 정의 뒤로 옮겼다.
  - 두 건 모두 `009`~`013` 전체를 적용 불가로 만들고 있었다. **적용해 보지
    않으면 드러나지 않는 종류의 결함이다.**
### 2026-08-15: U4·U2·B1·B2 결정 반영 · 재적용 검증 완료

[`docs/spec/00-decisions.md`](../../spec/00-decisions.md)의 결정을 001~013 전체에 반영했다.
PostgreSQL 18 컨테이너에 **빈 DB 부터 13개 파일 순차 적용**을 다시 확인했다.

| 반영 | 내용 |
|---|---|
| **U4** 지점 참조 테이블 | `CREATE TYPE ledger.branch_code` 삭제 → `CREATE TABLE ledger.branches`. 12개 파일 72개 참조를 `TEXT` + FK 로 전환. `current_branches()` 반환형 `TEXT[]`. `003`·`004` 시드 루프가 `branches` 를 읽는다 |
| **U2** 통화 5종 | `currencies` 시드에 `HKD` · `CNY` 추가. `fx_exchange` 계열 미생성 |
| **B1** 이벤트 커미션 | `tx_kind`·`entry_category` 에 `event_commission`, `posting_rules` 2행 |
| **B2** 케이지 포인트 | `account_kind` 에 `cage_point`·`point_liability`, `tx_kind`·`entry_category` 에 `point_grant`·`point_use`, `posting_rules` 4행. `003` 의 `normal_balance` CASE 와 하우스 부트스트랩에 반영 |
| 마커 발행 | `marker_issue` tx_kind·category·분개 2행 |
| `DR-23` | `entry_category` 에서 미사용 `reversal` 제거 |

검증 결과:

| 검사 | 결과 |
|---|---|
| 001~013 순차 적용 | 오류 0 |
| `ledger.branches` / `currencies` / `chain_heads` | 3행 / 5행 / 3행 |
| 지점별 `point_liability` 하우스 계정 | 3행 (지점당 1) |
| 신규 `posting_rules` 행 | 8행 |
| `v_integrity_status` R1~R9 | 전부 `violations = 0` |
| `v_check_view_security` · `v_check_public_execute` | 각각 0행 |

> **여전히 사람이 손으로 돌린 것이다.** 자동화가 M0 첫 작업이다
> ([`docs/spec/12-ci-golden-tests.md`](../../spec/12-ci-golden-tests.md)).

### 2026-08-15: 차단 13건 반영분 적용 · 동작 검증 완료

[design-review.md](../design-review.md)의 **차단 13건**을 반영하면서 001~013 대부분을
고쳤다. PostgreSQL **18.6** 컨테이너에 전 파일 클린 적용을 확인했고, 연산 함수의
동작까지 확인했다. 확인한 것:

| 대상 | 결과 |
|---|---|
| 001~013 순차 적용 | 오류 0 |
| `DR-03` 스텝업 | 정상 소비 1건 + 거부 6종 (단말·재사용·만료·스코프·타직원·NULL) 전부 의도대로 |
| `DR-04` 멱등키 | 캐시 재생 정상, 캐시 행 소멸 후 재사용은 `idempotency-key-reused` (raw 23505 아님) |
| `DR-05` 체인 정책 | `bet`·`payout` 제외 18종 체인, 봉인 정상 |
| `DR-39` 임계 | 초과 거부 · 이하 통과 |
| `DR-38` 개시 잔액 | `op_load_opening_balance()` 로 500,000,000 적재, `opening_equity` 자동 균형 |
| `DR-01` 차액 해소 | `adjustment` → `suspense −30,000` → `op_resolve_suspense()` → `suspense 0` · `overage_income −30,000` |
| `DR-50` 역분개 | 원거래 2행을 정확히 뒤집는 `reversal` 거래 생성 |
| `DR-66` 커미션 | 10,000,000 × 145bp = 145,000 정산. 롤링 초과 재정산 거부 · FB 초과 차감 거부 |
| `DR-24` 정의자 뷰 | `v_check_view_security` 0행 |
| `DR-25`·`DR-26` 역할 | `ledger_app` 은 스텝업 발급 불가 · 앵커 기록 불가 · 감사 로그 조회 불가. `audit_anchorer` 미상속 |
| R1~R9 | 전부 위반 0 |

**`DR-26` 논거를 실증했다.** 트리거를 끄고 거래 금액을 10배로 고친 뒤 체인 전체를
재계산해 덮고 `chain_heads` 까지 맞췄다. 그 상태에서 **R1~R7·R9 가 전부 통과하고
R8 만 잡았다.** 외부 앵커 대조가 없으면 연쇄 재작성은 탐지되지 않는다.

**적용 과정에서 새 결함 하나를 잡았다 — 함수 7개의 PUBLIC EXECUTE 노출.**
`012` 의 `REVOKE ALL ON ALL FUNCTIONS` 은 실행 시점의 함수만 대상이라, 그 뒤에
만들어지는 `012` 의 RLS 헬퍼 넷과 `013` 의 `verify_hash_chain` ·
`integrity_ok` · `merkle_root_for` 가 내장 기본값인 PUBLIC EXECUTE 를 그대로
받았다. 일곱 개 전부 `SECURITY DEFINER` 라서 클러스터의 아무 역할이나 소유자
권한으로 부를 수 있었다.

막고 있다고 적혀 있던 `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON FUNCTIONS
FROM PUBLIC` 은 **아무 일도 하지 않는다.** 단일/다중 스키마, `ALL`/`EXECUTE`,
`FOR ROLE` 명시까지 네 형태 모두 `pg_default_acl` 에 행을 남기지 않았고 새 함수는
계속 `=X/postgres` 를 받았다. 유일하게 동작하는 것은 **모든 함수가 만들어진 뒤의
사후 일괄 REVOKE** 이고, 그것을 `013` 끝에 두었다. 드리프트는
`ledger.v_check_public_execute` 가 잡는다.

> `DR-24` 와 같은 병이다 — 한쪽에서 닫고 다른 쪽에서 기본값으로 다시 열렸다.
> 선언을 읽지 말고 `has_function_privilege('public', ...)` 를 읽어야 한다.

`DR-03` 이 남긴 위험은 그대로 유효하다 — `op_*` **함수 19개의 시그니처**에서
`p_auth_method identity.auth_method` 를 `p_step_up_id BIGINT` 로 바꾸고 `012` 의
`GRANT EXECUTE` 인자 목록을 같은 폭으로 바꿨다. 이후 시그니처를 손대는 사람은
GRANT 를 함께 고쳐야 한다. 한 글자만 어긋나도 그 GRANT 가
`function does not exist` 로 실패하고 `009`~`013` 전체가 적용 불가가 된다.

적용 전 반드시 확인한다.

```bash
# 다른 프로젝트가 5432 를 쓰고 있으면 포트를 옮긴다
docker run -d --name cage-pg18 -p 55432:5432 \
  -e POSTGRES_PASSWORD=… -e POSTGRES_DB=cage postgres:18.6-alpine
for f in 0*.sql; do psql -v ON_ERROR_STOP=1 -f "$f" || break; done
```

확장은 필요 없다. 해시 체인은 PostgreSQL 11 이상 내장 `sha256(bytea)` 만 쓴다
(`pgcrypto` 불필요).

그다음 네 가지를 본다.

```sql
-- (1) op_* 와 GRANT 의 인자 타입이 맞물렸는가
SELECT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('ledger','cage','identity') AND p.proname LIKE 'op\_%'
   AND NOT has_function_privilege('ledger_app', p.oid, 'EXECUTE')
   AND p.proname <> 'op_load_opening_balance';        -- 이것만 migrator 전용
-- 기대: 0행

-- (2) 정의자 뷰가 남았는가 (DR-24)
SELECT * FROM ledger.v_check_view_security;           -- 기대: 0행

-- (3) PUBLIC 에 열린 함수가 남았는가 — 013 끝의 일괄 REVOKE 가 돌았는가
SELECT * FROM ledger.v_check_public_execute;          -- 기대: 0행

-- (4) 008 의 코어 함수가 앱에 새지 않았는가 (DR-50)
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'ledger' AND p.proname NOT LIKE 'op\_%'
   AND has_function_privilege('ledger_app', p.oid, 'EXECUTE');
```

(4) 의 기대값은 아래 아홉 개다. 이 목록에 없는 이름이 나오면 그것이 문제다.
특히 `post_transaction` · `begin_idempotent` · `complete_idempotent` 가 나오면
ADR-013 의 계층 분리가 깨진 것이다.

| 함수 | 앱이 왜 필요한가 |
|---|---|
| `business_date_of` · `account_id_of` · `house_account_id` | op 함수가 정의자 컨텍스트 밖에서 참조 |
| `current_branches` · `current_partner_id` · `partner_subtree` · `party_visible` | RLS 정책이 세션 컨텍스트로 호출 |
| `integrity_ok` | 앱 헬스체크. `v_integrity_status` 자체는 `ledger_read` 전용이라 정의자 함수로만 연다 |
| `verify_hash_chain` | 야간 배치 재계산 |

## 운영 배치

| 주기 | 작업 |
|---|---|
| 1분 | `SELECT * FROM ledger.v_integrity_status WHERE violations > 0` |
| 야간 | `ledger.verify_hash_chain(branch, from_id, to_id)` — 해시 재계산. **위조를 잡는 것은 이쪽뿐이다** |
| 야간 | 재계산 통과 후 `audit.chain_anchors` 앵커링 — **`audit_anchorer` 역할로** (`ledger_app` 아님) |
| 야간 | 체인 밖 거래(`chain_policy.chained = false`)의 `audit.merkle_anchors` 앵커링. 루트는 `audit.merkle_root_for()` 로만 계산한다 |
| 야간 | 앵커 기록 후 R8 · R9 대조 + 외부 서명 검증 — **연쇄 재작성 위조를 잡는 것은 이쪽뿐이다** |
| 일 1회 | `SELECT ledger.purge_expired_idempotency()` |
| 이관 완료 시 1회 | `SELECT archive.scrub_secrets()` — 되돌릴 수 없다 |
