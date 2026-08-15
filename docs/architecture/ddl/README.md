# DDL — 실행 가능한 스키마

PostgreSQL 18 기준. 번호 순서대로 적용한다.

```bash
for f in 0*.sql 1*.sql; do psql -v ON_ERROR_STOP=1 -f "$f" || break; done
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
- `003` 의 부트스트랩 `DO` 블록은 **3개 지점(HANN · NUSTAR · ONLINE)** 을 전제한다.
  지점을 늘리려면 `ledger.branch_code` ENUM 부터 손봐야 한다
  ([08-adr.md](../08-adr.md) U4).
- 통화는 `PHP` · `USD` · `KRW` 를 심어 두었으나 **다통화 정책은 미확정**이다
  ([08-adr.md](../08-adr.md) U2).
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
- 스키마 적용은 검증됐으나 **연산 함수의 동작은 아직 골든 테스트로 검증되지
  않았다.** 계정 종류 일관성 트리거 · 파트너 프로필 트리거 · `posting_rules`
  시드 · `partner_subtree()` 재귀만 스모크 테스트로 확인했다.

### ⚠️ 2026-08-15 변경분은 적용 검증 전이다

[design-review.md](../design-review.md)의 **차단 13건**을 반영하면서 001~013 대부분을
고쳤다. **위 2026-08-14 클린 적용 확인은 이 변경 이전 상태에 대한 것이다.**

가장 큰 것이 `DR-03`이다 — `op_*` **함수 19개의 시그니처**에서
`p_auth_method identity.auth_method` 를 `p_step_up_id BIGINT` 로 바꾸고,
`012` 의 `GRANT EXECUTE` 인자 목록을 같은 폭으로 바꿨다. 함수 정의와 GRANT 의
인자 타입이 **한 글자라도** 어긋나면 그 GRANT 가 `function does not exist` 로
실패하고, 위 두 건이 그랬듯 `009`~`013` 전체가 적용 불가가 된다.

적용 전 반드시 확인한다.

```bash
for f in 0*.sql; do psql -v ON_ERROR_STOP=1 -f "$f" || break; done
```

그다음 세 가지를 본다.

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

-- (3) 008 의 코어 함수가 앱에 새지 않았는가 (DR-50)
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'ledger' AND p.proname NOT LIKE 'op\_%'
   AND has_function_privilege('ledger_app', p.oid, 'EXECUTE');
-- 기대: business_date_of · account_id_of · house_account_id 셋뿐
```

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
