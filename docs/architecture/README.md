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
| 00 | [전체 시스템 지도](00-system-map.md) | 앱 4개·컬렉션 33종의 현행 구성도, 목표 구성도, 도메인 커버리지 매트릭스. **어디가 아직 설계되지 않았는지** |
| 01 | [현행 시스템 분석](01-current-system.md) | 코드에서 추출한 실제 도메인·스키마·자금 흐름. **모든 후속 설계의 사실 기준선** |
| 02 | [목표 아키텍처](02-target-architecture.md) | 서비스 경계, 런타임, 실시간 전파, 배포 구조 |
| 03 | [원장 모델](03-ledger-model.md) | 복식부기 설계, 부호 규약, 불변식과 그 강제 수단 |
| 04 | [분개 정의표](04-posting-rules.md) | 모든 자금 연산의 차변/대변 정의. 구현 시 이 표가 계약 |
| 05 | [API 계약](05-api-contract.md) | 명령 API 목록, 멱등성 규약, 오류 응답 |
| 06 | [보안 아키텍처](06-security.md) | 인증·권한·암호화·감사·4-eyes |
| 07 | [마이그레이션 계획](07-migration.md) | Firestore → PostgreSQL 이관, 단계별 일정 |
| 08 | [설계 결정 기록 (ADR)](08-adr.md) | 주요 선택과 그 근거·대안·트레이드오프 |
| 10 | [수용 기준 등록부](10-acceptance-criteria.md) | 설계 검토 잔여 72건을 마일스톤별 검증 가능 기준(`AC-*`)으로 전환 |
| — | [설계 검토 (결함 등록부)](design-review.md) | **위 문서와 `ddl/`을 서로 대조한 결과. 미해결 23건 — 차단 5.** 구현 착수 전 해소 대상 |
| — | [설계 검토 2차 (권한 · 대사 · 감사)](design-review-2.md) | **`012`·`013`·`002`·`006`·`007` 정독 결과. 미해결 14건 — 차단 4.** 1차와 합쳐 37건 |
| — | [설계 검토 3차 (타입 · 계정 · 게임)](design-review-3.md) | **`001`·`003`·`005` 정독 + op 함수 18개 전수 조사. 미해결 12건 — 차단 2.** 세 문서 합계 **49건 — 차단 11** |
| — | [설계 검토 4차 (원장 코어)](design-review-4.md) | **`004` 전량 정독 + `008` 내부 함수의 애플리케이션 경로 대조. 미해결 11건 — 차단 1(역분개 경로 부재).** 네 문서 합계 **60건 — 차단 12** |
| — | [설계 검토 5차 (현행↔목표 대조)](design-review-5.md) | **`01` 전량을 `ddl/`·`04`·`07`과 대조. 미해결 5건 — 차단 0, 반증 6건.** 파트너 쉐어는 **현행 구현 자체가 없다.** 다섯 문서 합계 **65건 — 차단 12** |
| — | [설계 검토 6차 (코드↔설계 · 재구현 판정)](design-review-6.md) | **저장소 실코드를 `01`~`07`·`ddl/`과 대조 + 연동/재구현 판정. 미해결 7건 — 차단 1(롤링 커미션 정산 설계 부재).** 케이지 어드민은 **Vite+React SPA 재구현 권장.** 여섯 문서 합계 **72건 — 차단 13** |
| — | [설계 검토 7차 (파트너 콘솔 코드↔설계)](design-review-7.md) | **`partner-admin/app.js` 1,867줄 전량을 `01` §13·`04`·`ddl/`·`00` §8과 대조. 미해결 5건 — 차단 0, 반증 6건. 포인트·쉐어 연산의 op 계층이 어느 계획 항목에도 없다.** 아바타 측은 외부 개선 진행 확인으로 후순위 유지. 일곱 문서 합계 **77건 — 차단 13** |
| — | [설계 검토 8차 (플레이어 사이트 코드↔설계)](design-review-8.md) | **`avatar/` + `shared/game-engine.js` 1,764줄 전량을 `02` §4-2·`04` §13·`ddl/001`·`004`·`008`과 대조. 미해결 5건 — 차단 0, 반증 7건. 페이아웃 멱등키가 베팅 키와 같아 지급이 422로 막힌다.** 아바타 개선으로 바뀌지 않는 축만 선별. 아홉 문서 합계 **86건 — 차단 13, 2026-08-15 전부 해소** |
| — | [설계 검토 9차 (기준선 정정 중 파생)](design-review-9.md) | **`index.html`의 정산·계좌해지·이벤트·컨시어지 블록을 본문까지 읽었다. 미해결 4건 — 차단 0, 등록 제외 4건. 롤링 커미션 요율의 권위가 UI select 옵션 라벨이고, `Share 40%` 프리셋은 롤링 커미션 40%로 프리필된다.** 계좌 해지는 원장을 물리 삭제한다. 아홉 문서 합계 **86건 — 차단 13, 2026-08-15 전부 해소** |
| — | [참고 문헌](references.md) | 인용한 공식 문서 전체 목록 |

## 산출물

| 경로 | 내용 |
|---|---|
| [`ddl/`](ddl/) | 실행 가능한 PostgreSQL 스키마 (13개 파일, 번호 순서대로 적용) |
| [`ddl/001`~`007`](ddl/) | 테이블 · 타입 · 불변식 |
| [`ddl/008_post_transaction.sql`](../../db/schema/008_post_transaction.sql) | **원장 코어 — 내부 전용.** 앱에 노출하지 않는다 |
| [`ddl/009`~`011`](ddl/) | **연산 함수 — 애플리케이션 API.** 이것만 호출 가능 |
| [`ddl/012_roles_and_grants.sql`](../../db/schema/012_roles_and_grants.sql) | 역할 · 권한 · RLS — 위 규칙을 실제로 강제한다 |
| [`ddl/013_reconciliation.sql`](../../db/schema/013_reconciliation.sql) | 상시 대사 R1~R9 — 하나라도 위반하면 즉시 알람 |

> **이 계층이 설계의 핵심이다.** `ledger_app` 역할은 자금 테이블에 DML 권한이 없고, `ledger.post_transaction()`에도 EXECUTE 권한이 없다. 가진 것은 `009`~`011`의 `op_*` 함수 EXECUTE와 조회 SELECT뿐이다. 분개는 함수가 만든다 — **호출자가 계정과 부호를 지정할 인터페이스 자체가 존재하지 않는다.** ([08-adr.md](08-adr.md) ADR-013)
>
> **2026-08-15: PostgreSQL 18 컨테이너에 13개 파일 전량 클린 적용을 확인했다.** U4 전환(`branch_code` ENUM → `ledger.branches`) 이후 재검증했고 `v_integrity_status` 9행 전부 `violations = 0`, 드리프트 검사 2종 0행이다.
>
> **그것은 사람이 손으로 돌린 것이고 CI가 아니다.** 자동화가 M0의 첫 작업이다 ([`spec/12`](../spec/12-ci-golden-tests.md)). 손으로 한 번 통과한 것과 매 PR에서 통과하는 것은 다른 보증이다.

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
| 실시간 | `onSnapshot` × 8 (케이지) | WebSocket × 8 채널 (Outbox 기반) — **케이지 범위**. 파트너·플레이어 채널은 별도 ([02](02-target-architecture.md) §4-2) |
| 통화 | 계좌는 `PHP` 하드코딩, 게임만 5종 표기 | **통화별 계정 5종** (PHP·USD·HKD·CNY·KRW). 환전 연산 없음 |
| 지점 | `HANN`/`NUSTAR`/`ONLINE` 하드코딩 | `ledger.branches` 참조 테이블 + FK |

### 무엇을 바꾸지 않는가

- 화면 구성과 조작 흐름
- 조작마다 PIN/TOTP 재인증하는 현행 UX (좋은 설계다)
- 롤링을 자금과 분리해 별도 집계하는 구조
- append-only 원장 원칙

> **"지점 3개 스코프 모델"은 더 이상 여기 없다.** U4 결정으로 지점 수가 고정이 아니다 — 3개는 시드값이지 제약이 아니다.

---

## 읽는 순서

- **처음이라면** → 01 → 03 → 04
- **DB를 만든다면** → 03 → 04 → `ddl/`
- **API를 만든다면** → 04 → 05 → 06
- **왜 이렇게 했는지 궁금하면** → 08
- **무엇을 언제 만드는지** → [`docs/spec/`](../spec/README.md)

## 미확정 사항 — 2026-08-15 전건 결정 완료

**U1~U5는 결정됐다.** 결정 · 결정일 · 결정자와 코드 근거는 [`docs/spec/00-decisions.md`](../spec/00-decisions.md)에, 요약은 [08-adr.md](08-adr.md) 말미에 있다.

| # | 결정 |
|---|---|
| U1 | **데모다** — 데이터는 이관하지 않는다. 기능과 스키마는 전부 이식 |
| U2 | **통화별 계정 정식 5종** — 환전 연산은 만들지 않는다 |
| U3 | **관측 롤링 × 요율** — 시점 스냅샷, 소급 없음. 파트너 쉐어는 이 결정 밖 |
| U4 | **참조 테이블** — `branch_code` ENUM 폐기 |
| U5 | **유예** — 구조만 만들고 값은 `branch_config` 설정으로 |

남아 있는 미확정 5건(파트너 쉐어 요율 · 잔액 남은 계좌 해지 · 관할 수치 · 이벤트 지점범위 · 아바타 일정)은 [08-adr.md](08-adr.md) "남아 있는 미확정" 절에 있다.

---

## 실행 계약 — `docs/spec/`

이 문서 세트는 **무엇을 만드는가**를 답한다. **누가 무엇을 언제 만드는가**는 [`docs/spec/`](../spec/README.md)에 있다.

| 세트 | 답하는 질문 |
|---|---|
| `docs/architecture/` (여기) | 무엇을 만드는가 — 모델 · 분개 규칙 · 보안 설계 |
| [`10-acceptance-criteria.md`](10-acceptance-criteria.md) | 무엇이 참이어야 끝난 것인가 — `AC-*` 86건 |
| [`docs/spec/`](../spec/README.md) | 누가 무엇을 언제 — 도메인별 `R-*` · 마일스톤 순서 |

**착수 지점은 M0다** — [`spec/12`](../spec/12-ci-golden-tests.md)(CI · 골든 테스트)와 [`spec/01`](../spec/01-ledger-foundation.md) §2(지점 참조 테이블 전환).
