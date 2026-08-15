# db — PostgreSQL 스키마와 검증

실행 자산이다. 설계 문서가 아니다.

| 여기                              | 저기                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `db/schema/*.sql` — 적용되는 물건 | [`docs/architecture/ddl/README.md`](../docs/architecture/ddl/README.md) — 왜 그렇게 생겼는지     |
| `db/tests/` — 골든 테스트         | [`docs/spec/12-ci-golden-tests.md`](../docs/spec/12-ci-golden-tests.md) — 무엇을 검사해야 하는지 |

문서가 `ddl/004` 라고 부르는 파일은 `db/schema/004_ledger.sql` 이다. 번호는 그대로다.

---

## 레이아웃

```
db/
├─ schema/     001_types_and_extensions.sql … 013_reconciliation.sql
├─ scripts/    apply.sh · reset.sh
└─ tests/      helpers · fixtures · golden · posting · drift
```

---

## 마이그레이션이 아니라 스키마다

**U1 = 데모 결정으로 이관할 데이터베이스가 없다** ([`docs/spec/00-decisions.md`](../docs/spec/00-decisions.md) §2).
운영 중인 DB가 없으므로 증분 마이그레이션 파일을 쌓지 않는다.

- 스키마를 바꾸려면 **해당 번호 파일을 제자리에서 고친다.** `014_` 를 더하지 않는다.
  스펙도 그렇게 쓰여 있다 — `R-01-22` 는 "`004` 안에서 트리거 생성이 시드 INSERT 뒤에 온다".
- 검증은 **빈 DB에 001~013 전체 재적용**이다. 매 PR마다 처음부터 다시 짓는다.
- sqitch · Flyway는 도입하지 않는다. 운영 DB가 생기는 시점(Track C)에 다시 판단한다.

---

## 적용

```bash
# PostgreSQL 18 컨테이너 (5432 가 비어 있지 않으면 55432 로 매핑)
docker run -d --name cage-pg18 -p 55432:5432 \
  -e POSTGRES_PASSWORD=devonly -e POSTGRES_DB=cage postgres:18.6-alpine

PGPASSWORD=devonly npm run db:apply       # 001 → 013 순차 적용
PGPASSWORD=devonly npm run db:reset       # 5개 스키마 DROP 후 재적용
PGPASSWORD=devonly npm run db:test-role   # 테스트용 로그인 역할 3종
PGPASSWORD=devonly npm run test:db        # 골든 테스트
```

접속 파라미터는 표준 `PG*` 환경변수로 받는다. 기본값은 `db/scripts/apply.sh` 상단에 있다.

**확장은 필요 없다.** `uuidv7()` 는 PostgreSQL 18 내장, `sha256(bytea)` 는 11 이상 내장이다 (`pgcrypto` 불필요).

---

## 금지 · 주의

- **`SET CONSTRAINTS ALL IMMEDIATE` 금지.** 지연 제약 트리거 I1·I2가 삽입 순서 의존이 되어
  다중 분개 거래가 첫 분개에서 실패한다 (`R-01-50`).
- **적용 순서가 계약이다.** 파일 간 FK·함수 의존이 번호 순서를 전제한다.
  예외 2건은 [`docs/architecture/ddl/README.md`](../docs/architecture/ddl/README.md) "주의" 절에 있다.
- **`op_*` 시그니처를 바꾸면 `012_roles_and_grants.sql` 의 `GRANT EXECUTE` 인자 목록을 같은 커밋에서 바꾼다.**
  한 글자만 어긋나도 그 GRANT가 `function does not exist` 로 실패하고 `009`~`013` 전체가 적용 불가가 된다 (`R-02-24`).
- **지점 추가는 `ledger.provision_branch()` 로만 한다.** `branches` 에 INSERT만 하면
  `branch_config` · `chain_heads` · 하우스 주체 · 하우스 계정이 빠진 반쪽 지점이 남는다 (`R-12-20`).
- **픽스처에 개인정보·실계좌 값을 쓰지 않는다** (`R-12-23`).
- **골든 테스트를 소유자(`postgres`)로 돌리지 않는다.** RLS와 테이블 권한이 우회되어 GRANT 실수·REVOKE 누락·지점 격리 실패가 초록으로 통과한다. `op_*` 호출은 `ledger_app`(§14는 `ledger_migrator`)로 한다.
- **테스트 로그인 역할 하나에 `ledger_app`과 `identity_app`을 함께 주지 않는다.** 자금 경로가 자기 스텝업 토큰을 발급할 수 있게 되어 DR-03(발급자 ≠ 소비자)이 테스트에서 사라진다. `db/schema/012_roles_and_grants.sql:214`가 같은 말을 한다. 픽스처 토큰은 소유자가 발급한다.

---

## 배포에서 제외

`firebase.json` 의 `hosting.public` 이 `"."` 이다. `hosting.ignore` 에 `db/**` 가 있어야
스키마가 공개 호스팅으로 배포되지 않는다. **이 항목을 지우지 않는다.**

---

## 아직 없는 것

| 대상                     | 언제                                    |
| ------------------------ | --------------------------------------- |
| `services/` — API 런타임 | D4(Go 또는 TypeScript) 확정 후. Track C |

계획 대장은 [`docs/superpowers/ROADMAP.md`](../docs/superpowers/ROADMAP.md).
