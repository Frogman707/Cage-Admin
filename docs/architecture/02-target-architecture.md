# 02. 목표 아키텍처

---

## 1. 설계 원칙

| # | 원칙 | 이유 |
|---|---|---|
| 1 | **불변식은 데이터베이스가 강제한다** | 애플리케이션 계층 검증은 버그·경합·우회에 취약하다. 잔액 하한과 분개 균형은 앱이 무엇을 하든 깨지지 않아야 한다 |
| 2 | **브라우저는 어떤 권한도 갖지 않는다** | 클라이언트에 두고 안전한 비밀값은 존재하지 않는다 |
| 3 | **원장은 추가만 한다. 정정은 역분개** | 삭제·수정은 감사 추적을 파괴한다 |
| 4 | **시각은 서버가 정한다** | 정산 기준일은 단말 시계에 의존할 수 없다 |
| 5 | **서비스 분리 기준은 부하가 아니라 런타임 형태** | 조기 마이크로서비스화는 분산 트랜잭션 비용만 만든다 |
| 6 | **화면·조작 흐름은 유지한다** | 현행 UX(조작마다 재인증, 지점 스코프)는 잘 설계되어 있다 |

---

## 2. 서비스 경계

이 도메인은 실제로 **하나의 강결합 원장**이다. 케이지·파트너·플레이어가 전부 같은 자금을 만진다. 잘게 쪼개면 전부 Saga가 된다.

```
                          ┌─────────────────┐
   케이지 단말 ──────┐    │   API Gateway   │   인증 · 인가 · rate limit
   파트너 콘솔 ──────┼───▶│                 │   Idempotency-Key 검사
   플레이어 앱 ──────┘    │                 │   감사 로그 기록
                          └────────┬────────┘
                                   │
        ┌──────────────┬───────────┼───────────┬──────────────┐
        ▼              ▼           ▼           ▼              ▼
  ┌───────────┐ ┌───────────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐
  │  Ledger   │ │  Player   │ │Identity │ │Notifica- │ │ Realtime  │
  │  & Cage   │ │  & Game   │ │         │ │  tion    │ │  Gateway  │
  │   Core    │ │           │ │         │ │          │ │(WebSocket)│
  └─────┬─────┘ └─────┬─────┘ └────┬────┘ └────┬─────┘ └─────▲─────┘
        │             │            │           │             │
        ▼             ▼            ▼           ▼             │
  ┌──────────────────────────────────────────────┐           │
  │            PostgreSQL 18                     │           │
  │  ledger · cage · game · identity · audit     │           │
  │                                    outbox ───┼───────────┘
  └──────────────────────────────────────────────┘
```

### 2-1. 서비스별 책임

| 서비스 | 소유 스키마 | 책임 | 분리 근거 |
|---|---|---|---|
| **Ledger & Cage Core** | `ledger` · `cage` | **회원 계정**·거래·분개·잔액·게임·롤링·정산·기간·실사·메인케이지 | **분리 불가.** 자금 불변식이 하나의 트랜잭션 안에 있어야 한다 |
| **Player & Game** | `game` | 라운드·테이블·아바타 신청·채팅. 자금은 Ledger API 호출 | 테이블당 상주 single-writer 워커가 필요. 요청/응답 런타임과 형태가 다름 |
| **Identity** | `identity` | 직원·파트너·회원 인증, TOTP, RBAC, 세션, 승인(4-eyes) | 인증 격리. 침해 시 폭발 반경 축소 |
| **Notification** | `notify` | Telegram·SMS 발송 큐, 연동 토큰 | 외부 시스템 의존. 장애 격리 |
| **API Gateway** | — | 인증 검증, 인가, rate limit, 멱등키, 감사 로그 | 횡단 관심사 |
| **Realtime Gateway** | — | WebSocket 팬아웃. Outbox 이벤트 구독 → 채널 전송 | 상태 유지 커넥션. 수평 확장 축이 다름 |

> **경계 규칙:** 하나의 서비스가 하나의 스키마를 독점 소유한다. 다른 서비스는 API로만 접근한다. 이 규칙만 지키면 나중에 프로세스를 쪼개도 트랜잭션이 깨지지 않는다.

### 2-2. 왜 12개가 아니라 5개인가

`docs/cage-guide/06_architecture_considerations.md`는 12개 마이크로서비스를 제안했다(폐기 대상 문서지만 서버 구조는 참고 대상으로 언급됨). 그 분해를 채택하지 않는 이유:

- **Ledger Service와 Cage Service를 분리하면** 케이지 바이인이 `회원계좌 차감`(Ledger)과 `게임 칩 발행`(Cage)으로 갈라져 Saga가 필요해진다. 통합하면 한 트랜잭션 안의 분개 2줄이다.
- **Wallet Service를 Ledger에서 분리하면** 잔액이 두 곳에 생긴다. Wallet은 Ledger의 조회 뷰일 뿐 별도 상태가 아니다.
- **Settlement를 분리하면** 정산 시 원장을 원격 조회해야 하고, 기간 동결이 두 서비스에 걸친다.

분리 판단 기준은 [08-adr.md](08-adr.md) ADR-002.

---

## 3. 크로스 서비스 자금 흐름 — Saga를 쓰지 않는다

**원칙: Ledger 단일 원자 거래로 표현 가능한 흐름은 전부 그렇게 한다.**

| 흐름 | 처리 |
|---|---|
| 케이지 바이인 | Ledger 단일 트랜잭션 (회원 차변 / 게임 칩 대변) |
| 계좌 간 이체 | Ledger 단일 트랜잭션 |
| 지점 간 이체 | Ledger 단일 트랜잭션 |
| 중간정산 · 게임종료 | Ledger 단일 트랜잭션 (다중 분개) |
| 케이지 계좌 → 회원 보유금 | Ledger 단일 트랜잭션 (계정 종류만 다름) |
| 플레이어 베팅 정산 | Player & Game이 Ledger API 호출. 멱등키 = `{roundId}_{memberId}_{betType}` |

Saga는 **외부 시스템이 끼는 경우에만** 쓴다 — 암호화폐 출금(체인 확정 대기), 외부 결제 게이트웨이 등. 현행 범위에는 없다.

---

## 4. 실시간 전파 — Outbox 패턴

현행 `onSnapshot` 8채널을 WebSocket 8채널로 그대로 매핑한다. 화면 로직 변경이 최소화된다.

### 4-1. Outbox

도메인 이벤트를 **자금 트랜잭션과 같은 DB 트랜잭션**에서 `outbox` 테이블에 기록하고, relay 프로세스가 발행한다. 이중 쓰기 문제(DB 커밋과 메시지 발행이 갈라지는 문제)를 해소한다.

```
BEGIN;
  INSERT INTO ledger.transactions ...
  INSERT INTO ledger.entries ...
  UPDATE ledger.account_balances ...
  INSERT INTO ledger.outbox (event_type, payload, ...)   ← 같은 트랜잭션
COMMIT;
                    │
                    ▼
         Outbox Relay (폴링 또는 논리 복제)
                    │
                    ▼
         Realtime Gateway ──▶ WebSocket 채널
```

> **전달 보장은 at-least-once다.** relay가 발행 후 확인 전에 죽으면 같은 이벤트가 다시 나간다. **구독자는 반드시 멱등해야 한다.** 이벤트에 `outbox.id`를 실어 보내고 클라이언트가 이미 처리한 ID를 무시한다.

relay 구현 두 가지. 상세는 [08-adr.md](08-adr.md) ADR-007.
- **폴링** — `SELECT ... WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED`. 단순하고 의존성이 없다. 1차 채택.
- **논리 복제** — PostgreSQL 논리 디코딩으로 WAL을 구독. 지연이 낮고 폴링 부하가 없다. 처리량이 문제될 때 전환.

### 4-2. 채널 매핑

| 현행 구독 함수 | 신규 채널 | 페이로드 |
|---|---|---|
| `subscribeStaffCloud` | `staff` | 직원 목록 변경 |
| `subscribeLedgerCloud` | `ledger:branch:{branch}` · `ledger:account:{code}` | 거래 생성 (분개 포함) |
| `subscribeGamesCloud` | `games:{branch}` | 게임 상태 변경 |
| `subscribeRollingEventsCloud` | `rolling:{branch}` | 롤링 이벤트 |
| `subscribeMainCageLedgerCloud` | `maincage:{branch}` | 메인케이지 이벤트 |
| `subscribeShiftEventsCloud` | `shift:{branch}` | 교대 카운터 변경 |
| `subscribeCageConfigCloud` | `cageconfig:{branch}` | 기간·실사 상태 |
| `subscribeBranchTransfersCloud` | `branchtransfers` | 지점 간 이체 |

**개선점:** 현행은 컬렉션 전량을 구독한다. 신규 채널은 지점 스코프가 채널 이름에 들어가 서버가 인가를 강제할 수 있다 — 다른 지점 데이터가 애초에 전송되지 않는다.

### 4-3. 소멸하는 코드

Firestore 특유 대응이 전부 불필요해진다.

```js
fbDb.settings({experimentalForceLongPolling: true});           // index.html:4272
fbDb.enablePersistence({synchronizeTabs:true}).catch(()=>{});  // :4273
function scheduleFirestoreResubscribe(key, resubscribeFn)      // :4190
function resetFirestoreResubscribeBackoff(key)                 // :4195
async function ensureFirebaseSdkLoaded(maxRetries)             // :4246
```

WebSocket 재연결은 표준 패턴 하나로 대체한다(지수 백오프 + 재연결 후 스냅샷 재동기화).

---

## 5. 데이터베이스

### 5-1. 버전과 스키마 분리

**PostgreSQL 18** (2025년 9월 릴리스, 2026년 2월 기준 18.3). 이 설계가 사용하는 18 고유 기능:

- `uuidv7()` — 시간 정렬 UUID. 외부 노출 식별자에 사용하며 인덱스 지역성이 UUIDv4보다 낫다.
- OAuth 2.0 인증 지원 — 향후 SSO 연동 시.

스키마 분리로 서비스별 권한 경계를 만든다:

```
ledger     주체 · 계정 · 거래 · 분개 · 잔액 · 통화 · 기간 · 분개정의표 · outbox
cage       게임 · 롤링 · 정산 · 메인케이지 · 실사 · 칩 재고
identity   직원 · 역할 · 권한 · 세션 · TOTP · 승인
audit      감사 로그 (별도 role, 앱이 삭제 불가)
archive    레거시 Firestore 스냅샷 (이관 전용, 별도 role)
game       라운드 · 테이블 · 아바타 · 채팅          ← 플레이어앱 도메인. 미구현
```

> **`game` 스키마는 아직 DDL에 없다.** [`ddl/`](ddl/)의 범위는 원장과 케이지다. 회원(손님)은 `game`이 아니라 `ledger.parties` + `ledger.member_profiles`에 있다 — 자금 계정의 소유 주체이므로 원장과 분리할 수 없다. 플레이어앱 도메인은 별도 작업이다.

### 5-2. 역할 분리

| 역할 | 권한 |
|---|---|
| `ledger_owner` | 스키마 소유. 마이그레이션 전용. 애플리케이션이 쓰지 않는다 |
| `ledger_app` | **`op_*` 연산 함수 EXECUTE + 조회 SELECT만.** 자금 테이블 DML 없음 |
| `ledger_read` | 조회 전용 (리포팅 · 대사). 인증 비밀값 · KYC 제외 |
| `ledger_kyc` | KYC 컬럼 열람 전용. 감사 대상 |
| `audit_writer` | `audit` 스키마 INSERT만. SELECT · UPDATE · DELETE 없음 |
| `archive_reader` | 레거시 아카이브 조회 전용 |
| `ledger_migrator` | 마이그레이션 전용. 평시 사용 금지 |

**`ledger_app`은 `ledger.post_transaction()`에도 EXECUTE 권한이 없다.** 그 함수는 내부 전용이고, 애플리케이션이 호출할 수 있는 것은 [`ddl/009`](ddl/009_operations_money.sql)~[`011`](ddl/011_operations_admin.sql)의 연산 함수뿐이다. 범용 기록 함수를 앱에 노출하면 [04-posting-rules.md](04-posting-rules.md)의 분개 정의표가 장식이 된다.

`SECURITY DEFINER` 함수는 PostgreSQL 문서 권고대로 `SET search_path`를 명시하고 `pg_temp`를 마지막에 둔다. 근거와 패턴은 [06-security.md](06-security.md) 4절.

### 5-3. 고가용성

| 항목 | 구성 |
|---|---|
| 복제 | 동기 스탠바이 1대 이상 |
| 백업 | PITR + 크로스 리전 보관 |
| 복구 리허설 | 정기 실시. **복구해 본 적 없는 백업은 백업이 아니다** |
| 페일오버 | 매니지드 서비스 자동 페일오버 |

---

## 6. 애플리케이션 런타임

| 서비스 | 언어 후보 | 근거 |
|---|---|---|
| Ledger & Cage Core | Go 또는 TypeScript | 처리량보다 **정확성**이 지배적. 팀 역량 우선 |
| Player & Game | Go | 테이블당 상주 워커. 경량 동시성 모델이 적합 |
| Identity | Go 또는 TypeScript | — |
| Realtime Gateway | Go | 다수 상시 커넥션 |
| API Gateway | 기성품 또는 얇은 자체 구현 | — |

> **주의:** 언어 선택보다 중요한 것은 **Ledger가 금전 스키마의 유일한 writer**라는 사실이다. 이 규칙이 깨지면 어떤 언어를 써도 무의미하다.

---

## 7. 프런트엔드

백엔드와 **병렬 트랙**이며 API 계약 확정 후 착수한다.

현행 제약:
- `index.html` 9,211줄 단일 파일, 빌드 시스템 없음, 전역 함수 314개
- `partner-admin/app.js` 1,771줄, `escapeHtml` 누락으로 저장형 XSS 존재

재작성이 불가피하다. 다만 **화면 구성과 조작 흐름은 현행을 스펙으로 삼는다.** 재사용 자산:

| 자산 | 위치 | 판단 |
|---|---|---|
| 다국어 사전 | `shared/i18n.js` (ko / en / zh-TW / zh-CN) | 그대로 이식 |
| TOTP 구현 | `index.html:5511-5576` | 서버로 이전 후 재사용 |
| 화면 레이아웃 · 조작 흐름 | 전체 | 스펙으로 참조 |
| 지점 전환 UX | `switchBranch()` `index.html:4626` | 동작 규칙 그대로 |

---

## 8. 관측

| 계층 | 도구 | 알람 등급 |
|---|---|---|
| 분산 추적 | OpenTelemetry | — |
| 메트릭 | Prometheus / Grafana | — |
| 오류 | Sentry | — |
| **원장 무결성** | 전용 대사 배치 | **위반 시 즉시 호출** |

원장 무결성 알람은 일반 알람과 등급이 다르다. 일곱 가지를 감시한다 (상세: [`ddl/013_reconciliation.sql`](ddl/013_reconciliation.sql)).

| # | 검사 | 주기 |
|---|---|---|
| R1 | 통화별 전역 분개 합 = 0 | 1분 |
| R2 | 계정별 `account_balances` = `SUM(entries)` | 1분 |
| R3(a) | 해시 체인 **링크** 연속성 | 1분 |
| R3(b) | 해시 **내용 재계산** — 위조를 잡는 것은 이쪽뿐이다 | 야간 |
| R4 | 게임 롤링 프로젝션 = 이벤트 합 | 1분 |
| R5 | `suspense` 잔액 = 0 | 1분 |
| R6 | 비정규화 `entries.branch` 정합 | 1분 |
| R7 | 분개 정의표 준수 | 1분 |

**하나라도 위반하면 신규 거래를 차단한다.** 돈이 새는 상태에서 계속 받는 것보다 멈추는 편이 낫다.

> R3을 두 단계로 나눈 이유: 링크만 검사하면 **원문과 해시를 함께 고쳤을 때 탐지하지 못한다.** 재계산은 거래 수에 비례해 비싸므로 야간 배치로 그날치를 검증하고, 통과한 뒤에만 외부 앵커링한다.

---

**이전:** [01. 현행 시스템 분석](01-current-system.md) · **다음:** [03. 원장 모델](03-ledger-model.md)
