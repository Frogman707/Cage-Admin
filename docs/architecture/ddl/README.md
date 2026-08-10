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
| 002 | `002_identity.sql` | 직원 · 세션 · TOTP · RBAC · 4-eyes 승인 · 인가 함수 | [06](../06-security.md) |
| 003 | `003_accounts.sql` | 주체 · 계정 · 잔액 프로젝션 · KYC | [03](../03-ledger-model.md) |
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
  예외 하나: `011` 의 `op_settle_period()` 가 `013` 의 `ledger.integrity_ok()` 를
  호출한다. plpgsql 본문은 실행 시점에 해석되므로 생성은 성공하지만,
  `013` 적용 전에는 그 함수를 호출할 수 없다.
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
- **아직 실제 psql 적용으로 검증되지 않았다.** 자체 검토만 거친 상태다.

## 운영 배치

| 주기 | 작업 |
|---|---|
| 1분 | `SELECT * FROM ledger.v_integrity_status WHERE violations > 0` |
| 야간 | `ledger.verify_hash_chain(branch, from_id, to_id)` — 해시 재계산. **위조를 잡는 것은 이쪽뿐이다** |
| 야간 | 재계산 통과 후 `audit.chain_anchors` 앵커링 |
| 일 1회 | `SELECT ledger.purge_expired_idempotency()` |
| 이관 완료 시 1회 | `SELECT archive.scrub_secrets()` — 되돌릴 수 없다 |
