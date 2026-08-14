# Cage Admin — 서버 · 데이터베이스 재설계 아키텍처

**상태:** 설계 제안 (구현 착수 전)
**작성일:** 2026-08-10 · **최종 갱신:** 2026-08-14
**기준 브랜치:** `backend` — 현행 시스템 서술의 기준 스냅샷

> **2026-08-14 갱신.** 이 설계와 **별개로** 현행 Firestore 시스템에 보안·정합성 하드닝이 진행됐다(아래 "두 개의 트랙"). 목표 설계인 [02](02-target-architecture.md)~[05](05-api-contract.md)와 [`ddl/`](ddl/)는 영향받지 않았다. 현행 시스템을 서술하는 [01](01-current-system.md), [06](06-security.md) 1·3-2·8·11절, [07](07-migration.md), [02](02-target-architecture.md) 7절이 갱신됐다.

---

## 두 개의 트랙

이 저장소에는 지금 **서로 다른 목적의 설계 문서 두 벌**이 있다. 충돌하는 제안이 아니라 시간축이 다른 것이다.

| | **Track A — 현행 하드닝** | **Track B — 이 문서 세트** |
|---|---|---|
| 대상 | 지금 돌아가는 Firestore 시스템 | 신규 PostgreSQL 시스템 |
| 목적 | 이전이 끝날 때까지의 **완충** | 최종 목표 아키텍처 |
| 문서 | [`docs/review-security-data-integrity.md`](../review-security-data-integrity.md) · [`docs/BALANCE_ARCHITECTURE_DESIGN.md`](../BALANCE_ARCHITECTURE_DESIGN.md) | `docs/architecture/` 전체 |
| 상태 | 일부 배포 완료 (01번 문서에 반영) | 미착수 |

**Track A가 만든 것은 Track B에서 대부분 소멸한다.** `balanceTotals` 유지 잔액은 `ledger.account_balances`가, `staffLogin` Cloud Function은 Identity 서비스가 대체한다. 그럼에도 Track A를 진행하는 이유는 **이전에 걸리는 기간 동안 실제 현금이 계속 움직이기 때문**이다.

다만 Track A의 산출물 중 두 가지는 Track B에서 **그대로 쓰인다**:

- `functions/index.js`의 서버 측 TOTP 구현 — [06](06-security.md) 3-2절이 계획했던 "서버로 이전"이 이미 끝났다
- `functions/balance/backfillBalances.js` · `reconcile.js` — [07](07-migration.md) 3-1절 **3단계(감사)** 가 요구하는 계좌별 잔액 산출·불일치 탐지 도구 그 자체다

---

## 이 문서 세트의 전제

1. **현행 구현이 도메인 스펙이다.** `docs/cage-guide/`, `docs/cage-spec/`의 케이지 어드민 기능 정의는 폐기한다. 이 문서 세트의 도메인 사실은 전부 `index.html`, `partner-admin/app.js`, `avatar/app.js`, `shared/*.js`의 실제 코드에서 추출했으며, 각 사실에 코드 위치를 명시한다.

2. **목표는 실서비스다.** 큰 금액의 자금을 처리하고, 무결성을 데이터베이스가 강제하며, 보안을 서버가 책임진다. "최소 변경"은 제약 조건이 아니다.

3. **저장소를 Firestore에서 PostgreSQL로 이전하고 서버를 신규 구축한다.**

---

## 문서 구성

| # | 문서 | 내용 |
|---|---|---|
| 01 | [현행 시스템 분석](01-current-system.md) | 코드에서 추출한 실제 도메인·스키마·자금 흐름. **모든 후속 설계의 사실 기준선** |
| 02 | [목표 아키텍처](02-target-architecture.md) | 서비스 경계, 런타임, 실시간 전파, 배포 구조 |
| 03 | [원장 모델](03-ledger-model.md) | 복식부기 설계, 부호 규약, 불변식과 그 강제 수단 |
| 04 | [분개 정의표](04-posting-rules.md) | 모든 자금 연산의 차변/대변 정의. 구현 시 이 표가 계약 |
| 05 | [API 계약](05-api-contract.md) | 명령 API 목록, 멱등성 규약, 오류 응답 |
| 06 | [보안 아키텍처](06-security.md) | 인증·권한·암호화·감사·4-eyes |
| 07 | [마이그레이션 계획](07-migration.md) | Firestore → PostgreSQL 이관, 단계별 일정 |
| 08 | [설계 결정 기록 (ADR)](08-adr.md) | 주요 선택과 그 근거·대안·트레이드오프 |
| — | [참고 문헌](references.md) | 인용한 공식 문서 전체 목록 |

## 산출물

| 경로 | 내용 |
|---|---|
| [`ddl/`](ddl/) | 실행 가능한 PostgreSQL 스키마 (13개 파일, 번호 순서대로 적용) |
| [`ddl/001`~`007`](ddl/) | 테이블 · 타입 · 불변식 |
| [`ddl/008_post_transaction.sql`](ddl/008_post_transaction.sql) | **원장 코어 — 내부 전용.** 앱에 노출하지 않는다 |
| [`ddl/009`~`011`](ddl/) | **연산 함수 — 애플리케이션 API.** 이것만 호출 가능 |
| [`ddl/012_roles_and_grants.sql`](ddl/012_roles_and_grants.sql) | 역할 · 권한 · RLS — 위 규칙을 실제로 강제한다 |
| [`ddl/013_reconciliation.sql`](ddl/013_reconciliation.sql) | 상시 대사 R1~R7 — 하나라도 위반하면 즉시 알람 |

> **이 계층이 설계의 핵심이다.** `ledger_app` 역할은 자금 테이블에 DML 권한이 없고, `ledger.post_transaction()`에도 EXECUTE 권한이 없다. 가진 것은 `009`~`011`의 `op_*` 함수 EXECUTE와 조회 SELECT뿐이다. 분개는 함수가 만든다 — **호출자가 계정과 부호를 지정할 인터페이스 자체가 존재하지 않는다.** ([08-adr.md](08-adr.md) ADR-013)
>
> **아직 실제 psql 적용으로 검증되지 않았다.** 자체 검토만 거친 상태다.

---

## 한 장 요약

### 지금 무엇이 문제인가

브라우저가 Firestore에 직접 쓴다. 서버 측 검증 지점이 0개다. 자금 이동의 원자성·잔액 하한·멱등성·시각 권위를 강제하는 주체가 시스템 어디에도 없다.

코드가 이 사실을 스스로 인정한다 — 반쪽 이체를 **토스트 메시지로 대응**하고 있다:

```js
// index.html:6562-6566
if(!okIn){
  // The debit from the source account already landed - flag this loudly rather than
  // silently leaving the transfer half-done, since the credit never made it.
  toast(t('toastTransferHalfFailed'));
```

### 무엇이 이미 옳은가

**회계 모델이 이미 복식부기다.** `applyAccountTransaction()`이 손님 계좌에 쓸 때마다 `MAIN-{branch}`에 반대 방향 동일 금액을 함께 쓴다. 코드 주석이 이를 명시한다:

> Each branch has its own internal "house" account used as the **double-entry mirror** for every guest deposit/withdraw in that casino — `index.html:4585-4586`

따라서 이 재설계는 **개념 변환이 아니라, 이미 지키고 있는 규율을 데이터베이스가 강제하게 만드는 작업**이다.

### 무엇을 바꾸는가

| 축 | 현행 | 목표 |
|---|---|---|
| 저장소 | Firestore (브라우저 직접 접근) | PostgreSQL 18 (서버 전용) |
| 자금 원자성 | 애플리케이션이 순차 write, 실패 시 토스트 | 단일 트랜잭션 + 지연 제약 트리거 |
| 잔액 하한 | 없음 (메모리 변수 검사) | 지연 제약 트리거 + 행 잠금 |
| 금액 타입 | JS `number` (IEEE 754 배정밀도) | `BIGINT` 최소 단위 정수 |
| 시각 | 클라이언트 시계 문자열 | `clock_timestamp()` + 영업일 엔티티 |
| 멱등성 | 호출 시점 생성 UUID. **앱 레벨 재시도는 여전히 중복 문서를 만든다** | `Idempotency-Key` + 자연키 |
| 정정 | 문서 삭제 | 역분개 (`reverses_tx_id`) |
| 인증 | PIN·마스터 비밀번호 평문/무솔트 저장. 검증 위치만 Cloud Functions로 이동 | Argon2id, 서버 검증 |
| 실시간 | `onSnapshot` × 8 | WebSocket × 8 채널 (Outbox 기반) |

### 무엇을 바꾸지 않는가

- 화면 구성과 조작 흐름
- 조작마다 PIN/TOTP 재인증하는 현행 UX (좋은 설계다)
- 지점 3개 스코프 모델
- 롤링을 자금과 분리해 별도 집계하는 구조
- append-only 원장 원칙

---

## 읽는 순서

- **처음이라면** → 01 → 03 → 04
- **DB를 만든다면** → 03 → 04 → `ddl/`
- **API를 만든다면** → 04 → 05 → 06
- **왜 이렇게 했는지 궁금하면** → 08

## 미확정 사항

구현 착수 전 반드시 확정해야 할 4가지. [08-adr.md](08-adr.md) 말미에 상세.

1. 현재 Firestore 데이터가 실거래인가 데모인가
2. 다통화 실사용 계획
3. 롤링 요율(`rate`) 커미션 계산 규칙 — 필드는 있으나 계산 코드를 찾지 못함
4. 지점 확장 계획 (현행 `HANN`/`NUSTAR`/`ONLINE` 하드코딩)
