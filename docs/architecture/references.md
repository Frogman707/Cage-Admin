# 참고 문헌

이 문서 세트에서 인용한 1차 자료 목록. **모든 규범적 주장은 여기 있는 공식 문서에 근거한다.**
조사 시점: 2026-08-10.

---

## PostgreSQL 공식 문서

| 주제 | 사용처 | URL |
|---|---|---|
| `CREATE TRIGGER` — 제약 트리거 | [03 §7-1](03-ledger-model.md) · [`ddl/004`](ddl/004_ledger.sql) | https://www.postgresql.org/docs/current/sql-createtrigger.html |
| `CREATE FUNCTION` — `SECURITY DEFINER` | [06 §4-2](06-security.md) · [`ddl/008`](ddl/008_post_transaction.sql) | https://www.postgresql.org/docs/current/sql-createfunction.html |
| 트랜잭션 격리 수준 | [03 §7-3](03-ledger-model.md) · [08 ADR-004](08-adr.md) | https://www.postgresql.org/docs/current/transaction-iso.html |
| 명시적 잠금 · 데드락 | [03 §7-3](03-ledger-model.md) · [`ddl/008`](ddl/008_post_transaction.sql) | https://www.postgresql.org/docs/current/explicit-locking.html |
| 수치 데이터 타입 | [03 §6](03-ledger-model.md) · [08 ADR-003](08-adr.md) | https://www.postgresql.org/docs/current/datatype-numeric.html |
| Row Level Security | [06 §4-3](06-security.md) · [`ddl/012`](ddl/012_roles_and_grants.sql) | https://www.postgresql.org/docs/current/ddl-rowsecurity.html |
| 논리 디코딩 | [02 §4-1](02-target-architecture.md) · [08 ADR-007](08-adr.md) | https://www.postgresql.org/docs/current/logicaldecoding.html |
| `SET CONSTRAINTS` | [`ddl/README`](ddl/README.md) | https://www.postgresql.org/docs/current/sql-set-constraints.html |
| PostgreSQL 18 릴리스 | [02 §5-1](02-target-architecture.md) | https://www.postgresql.org/about/news/postgresql-18-released-3142/ |
| PostgreSQL 18 릴리스 노트 | [02 §5-1](02-target-architecture.md) | https://www.postgresql.org/docs/18/release-18.html |
| 위키 — Don't Do This | [03 §6](03-ledger-model.md) · [03 §8-1](03-ledger-model.md) | https://wiki.postgresql.org/wiki/Don%27t_Do_This |

### 인용한 핵심 문장

**제약 트리거** — [03 §7-1](03-ledger-model.md)의 근거

> "They can be fired either at the end of the statement causing the triggering event, or at the end of the containing transaction; in the latter case they are said to be *deferred*."
> "A constraint trigger can only be specified as `AFTER`."
> "Constraint triggers can only be specified `FOR EACH ROW`."
> "Constraint triggers are expected to raise an exception when the constraints they implement are violated."

**`SECURITY DEFINER`** — [06 §4-2](06-security.md)의 근거

> "SECURITY DEFINER specifies that the function is to be executed with the privileges of the user that owns it."
> "For security, search_path should be set to exclude any schemas writable by untrusted users. This prevents malicious users from creating objects (e.g., tables, functions, and operators) that mask objects intended to be used by the function."
> "Particularly important in this regard is the temporary-table schema, which is searched first by default, and is normally writable by anyone. A secure arrangement can be obtained by forcing the temporary schema to be searched last. To do this, write pg_temp as the last entry in search_path."

**격리 수준** — [08 ADR-004](08-adr.md)의 근거

> "Read Committed is the default isolation level in PostgreSQL."
> "Applications using this level must be prepared to retry transactions due to serialization failures."
> "It is important that an environment which uses this technique have a generalized way of handling serialization failures (which always return with an SQLSTATE value of '40001')"

**잠금과 데드락** — [`ddl/008`](ddl/008_post_transaction.sql)의 잠금 순서 규칙 근거

> "`FOR UPDATE` causes the rows retrieved by the `SELECT` statement to be locked as though for update. This prevents them from being locked, modified or deleted by other transactions until the current transaction ends."
> "The best defense against deadlocks is generally to avoid them by being certain that all applications using a database acquire locks on multiple objects in a consistent order."

**수치 타입** — [08 ADR-003](08-adr.md)의 근거

> "The type `numeric` can store numbers with a very large number of digits. It is especially recommended for storing monetary amounts and other quantities where exactness is required."
> "However, calculations on `numeric` values are very slow compared to the integer types, or to the floating-point types described in the next section."
> "If you require exact storage and calculations (such as for monetary amounts), use the `numeric` type instead." (부동소수 타입 경고)

위키 "Don't Do This"의 관련 권고:
> "Don't use money" — `numeric` 또는 정수를 쓸 것
> "For new applications, identity columns should be used instead" — `serial` 대신
> "Use timestamptz (also known as timestamp with time zone) instead" — 순수 `timestamp` 대신
> "Don't use the type char(n). You probably want text."

**Row Level Security** — [`ddl/012`](ddl/012_roles_and_grants.sql)의 근거

> "If no policy exists for the table, a default-deny policy is used, meaning that no rows are visible or can be modified."
> "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when accessing a table. Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with `ALTER TABLE ... FORCE ROW LEVEL SECURITY`."

---

## 보안 표준

| 주제 | 사용처 | URL |
|---|---|---|
| OWASP Password Storage Cheat Sheet | [06 §3-1](06-security.md) · [`ddl/002`](ddl/002_identity.sql) | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| RFC 6238 — TOTP | [06 §3-2](06-security.md) · [`ddl/002`](ddl/002_identity.sql) | https://datatracker.ietf.org/doc/html/rfc6238 |

### Argon2id 권장 파라미터

다음 설정들은 **동등한 방어 수준**이며 CPU/RAM 트레이드오프만 다르다. 이 설계는 `m=19456, t=2, p=1`을 채택했다.

```
m=47104 (46 MiB), t=1, p=1
m=19456 (19 MiB), t=2, p=1      ← 채택
m=12288 (12 MiB), t=3, p=1
m=9216  (9 MiB),  t=4, p=1
m=7168  (7 MiB),  t=5, p=1
```

대안 알고리즘 권장값: scrypt `N=2^17 (128 MiB), r=8, p=1` · bcrypt 작업 계수 최소 10 · PBKDF2-HMAC-SHA256 600,000 회.

페퍼는 "stored separately from the password database"이며 "secrets vaults or HSMs"에 보관한다. 단, "cannot be changed without knowledge of a user's password" — 유출 시 전원 비밀번호 재설정이 필요하다.

### TOTP

> "TOTP = HOTP(K, T), where T is an integer and represents the number of time steps between the initial counter time T0 and the current Unix time."
> "We RECOMMEND a default time-step size of 30 seconds."
> "at most one time step is allowed as the network delay"
> "The verifier MUST NOT accept the second attempt of the OTP after the successful validation has been issued for the first OTP, which ensures one-time only use of an OTP."

마지막 문장이 [`ddl/002`](ddl/002_identity.sql)의 `identity.totp_used` 테이블 근거다.

---

## HTTP · API 표준

| 주제 | 사용처 | URL |
|---|---|---|
| `Idempotency-Key` 헤더 (draft-ietf-httpapi-idempotency-key-header-07) | [05 §2](05-api-contract.md) · [`ddl/004`](ddl/004_ledger.sql) | https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07 |
| 워킹그룹 문서 이력 | — | https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ |

### 인용

> "Idempotency-Key is an Item Structured Header. Its value MUST be a String."
> "The idempotency key MUST be unique and MUST NOT be reused with another request with a different request payload."
> "It is RECOMMENDED that a UUID or a similar random identifier be used as an idempotency key."
> "If the Idempotency-Key request header is missing for a documented idempotent operation requiring this header, the resource SHOULD reply with an HTTP 400 status code."
> "If there is an attempt to reuse an idempotency key with a different request payload, the resource SHOULD reply with a HTTP 422 status code."
> "If the request is retried, while the original request is still being processed, the resource SHOULD reply with an HTTP 409 status code."
> "The resource SHOULD define such expiration policy and publish it in the documentation."

> **상태 주의:** 이 문서는 IETF 인터넷 초안이며 RFC가 아니다. 최신 버전은 draft-07(2025-10-15). 채택 시점에 버전을 재확인할 것.

---

## 아키텍처 패턴

| 주제 | 사용처 | URL |
|---|---|---|
| Transactional Outbox | [02 §4-1](02-target-architecture.md) · [08 ADR-007](08-adr.md) | https://microservices.io/patterns/data/transactional-outbox.html |
| Outbox 전달 보장 | [02 §4-1](02-target-architecture.md) | https://event-driven.io/en/outbox_inbox_patterns_and_delivery_guarantees_explained/ |
| Transactional Outbox (AWS Prescriptive Guidance) | [08 ADR-007](08-adr.md) | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |

핵심 사실: **전달 보장은 at-least-once다.** relay가 발행 후 확인 전에 죽으면 중복 발행된다. 구독자는 반드시 멱등해야 한다.

---

## 복식부기 원장 설계

| 주제 | 사용처 | URL |
|---|---|---|
| 원장 불변성 강제 | [03 §7-4](03-ledger-model.md) · [08 ADR-009](08-adr.md) | https://www.moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger |
| 원장 확장 — 불변성과 복식부기 | [03 §2](03-ledger-model.md) | https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v |
| 암호학적 불변성 | [03 §7-5](03-ledger-model.md) | https://www.moderntreasury.com/learn/what-is-cryptographic-immutability |

이 자료들이 뒷받침하는 설계 요소:
- **3객체 구조** — accounts · transactions · entries
- **거래 단위 균형** — 차변 합 = 대변 합을 DB가 강제
- **append-only** — 정정은 후속 분개로. 삭제·수정 없음

> **주의:** 위 세 링크는 상용 벤더의 기술 블로그다. 설계 원칙 자체는 표준 복식부기 회계이며 벤더 종속적이지 않다. 이 문서 세트는 해당 제품을 채택하지 않는다.

---

## Firestore (이전 근거)

| 주제 | 사용처 | URL |
|---|---|---|
| Cloud Firestore 할당량·한도 | [08 ADR-001](08-adr.md) | https://firebase.google.com/docs/firestore/quotas |

확인된 한도 중 이 설계에 영향을 준 것:
- 문서 최대 크기 1 MiB
- 단일 `Commit`/트랜잭션의 필드 변환 최대 500
- 트랜잭션 시간 제한 270초

> 이전 결정의 주된 근거는 한도 수치가 아니라 **엔진 제약**이다 — 쿼리 결과에 트랜잭션을 걸 수 없고, 다중 문서 불변식을 강제할 수단이 없다. [08 ADR-001](08-adr.md).

---

## 코드 기준선

문서 세트의 도메인 사실은 전부 저장소 코드에서 추출했다.

- **초판 기준 커밋:** `e8469a1` (브랜치 `claude/cage-admin-5-features-75k9ac`)
- **2026-08-14 갱신 기준:** 브랜치 `backend`, 커밋 `1bd7ef6`

| 파일 | 규모 (2026-08-14) | 역할 |
|---|---|---|
| [index.html](../../index.html) | 9,422줄 / 518 KB | 케이지 운영 화면 + Firestore 동기화 |
| [partner-admin/app.js](../../partner-admin/app.js) | 1,867줄 | 파트너 운영 콘솔 |
| [avatar/app.js](../../avatar/app.js) | 1,202줄 | 플레이어 화면 |
| [shared/game-engine.js](../../shared/game-engine.js) | 300줄 | 게임 시뮬레이션 · 회원 원장 |
| [shared/cage-ui.js](../../shared/cage-ui.js) | — | Firebase 초기화 · 공통 유틸 · `writeMemberLedgerEntry()` |
| [functions/index.js](../../functions/index.js) | 365줄 | Telegram 연동 **+ 스태프 인증** Cloud Functions |
| [functions/balance/](../../functions/balance/) | 4개 파일 | 유지 잔액 프로토타입 · 백필 · 대사 — **미배포·미연결** |
| [firestore.rules](../../firestore.rules) | 28줄 | `staff` 컬렉션만 인증 요구, 나머지 무제한 |

추출 결과는 [01-current-system.md](01-current-system.md)에 코드 위치와 함께 정리했다. **라인 번호는 위 스냅샷 기준이며 함수명이 권위 있는 참조다.**

### 저장소 내 선행 문서

| 문서 | 판단 |
|---|---|
| [docs/review-security-data-integrity.md](../review-security-data-integrity.md) | **유효.** 보안·정합성 문제 목록이 이 설계의 출발점 중 하나. **Track A가 이 목록을 대상으로 실행됐다** — 항목별 현재 상태는 [01-current-system.md](01-current-system.md) 17절 |
| [docs/BALANCE_ARCHITECTURE_DESIGN.md](../BALANCE_ARCHITECTURE_DESIGN.md) | **유효 (2026-08-14 추가).** Track A의 유지 잔액 설계. 이 문서 세트와 **경쟁하지 않는다** — 이전 완료 시점까지의 완충이며, 그 감사 도구는 [07-migration.md](07-migration.md) 3단계에서 재사용된다 |
| [docs/explanation-architecture.md](../explanation-architecture.md) | 현행 구조를 정직하게 서술. 이전 후 갱신 필요 |
| [docs/partner-admin/](../partner-admin/README.md) | **유효 (2026-08-14 추가).** 파트너 콘솔 8건. 화면 58개 · 리스트 엔진 계약 · 결함 P-01~P-14. `01` 13절이 이 세트를 요약 참조한다 |
| [docs/avatar-speed/](../avatar-speed/README.md) | **유효 (2026-08-14 추가).** 플레이어 사이트 8건. 라운드 흐름 · 게임 룰 · 로드맵 알고리즘 · 결함 G-01~G-12. **`game` 스키마 설계의 입력 자료** — [00-system-map.md](00-system-map.md) §8 A1 |
| [docs/FIRESTORE_DATA_MODEL.md](../FIRESTORE_DATA_MODEL.md) | **폐기 대상.** 목표 설계를 현재형으로 서술해 구현과 불일치. **TA-D1이 문서 상단에 불일치 목록 경고를 추가**해 오독 위험은 낮췄으나, 이 문서 세트가 그 역할을 대체한다. 특히 `accounts`를 Firestore 컬렉션으로 서술하는데 **구현되지 않았다** — [07-migration.md](07-migration.md) M11 |
| `docs/cage-guide/` · `docs/cage-spec/` | **폐기 대상** (사용자 지시). 서버 구조 아이디어만 참고 |

---

**인덱스:** [README](README.md)
