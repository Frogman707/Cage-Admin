# 00 — 전체 시스템 지도

> **분류**: 진입점 (Orientation)
> **작성일**: 2026-08-14 · 브랜치 `backend` · 코드 기준 커밋 `1bd7ef6`
> **읽는 순서**: 이 문서 → [01-current-system.md](01-current-system.md) → [02-target-architecture.md](02-target-architecture.md)

이 저장소에는 서로 다른 것을 서술하는 **문서 세트가 셋** 있다. 이 문서는 그 셋을 한 장에
겹쳐 놓고, 시스템 전체가 어떤 모양인지와 **어디가 아직 설계되지 않았는지**를 보여준다.

---

## 0. 문서 지형 — 셋은 같은 것을 말하지 않는다

| 문서 세트 | 서술 대상 | 시제 | 무엇이 바뀌면 갱신되나 |
| --- | --- | --- | --- |
| [`docs/avatar-speed/`](../avatar-speed/README.md) | `avatar/` · `shared/game-engine.js` | **현재** | 플레이어 사이트 코드 |
| [`docs/partner-admin/`](../partner-admin/README.md) | `partner-admin/` | **현재** | 파트너 콘솔 코드 |
| [`docs/architecture/`](README.md) | PostgreSQL 목표 서버 | **미래** | 설계 결정 |

예외가 하나 있다. [01-current-system.md](01-current-system.md)는 `architecture/`에 있지만
**현재**를 서술한다 — 목표 설계가 딛고 선 사실 기준선이기 때문이다. 즉 현행을 서술하는 문서가
세 곳(`avatar-speed/`, `partner-admin/`, `01`)에 흩어져 있고, 셋의 상세도가 크게 다르다.

| 서브시스템 | `01`의 분량 | 전용 문서 세트의 분량 |
| --- | --- | --- |
| 케이지 어드민 (`index.html`) | §1~§12, §14~§17 — 약 480줄 | 없음 |
| 파트너 콘솔 (`partner-admin/`) | §13 일부 — 약 12줄 | 8개 문서 약 134KB |
| 플레이어 사이트 (`avatar/`) | §13 일부 — 약 12줄 | 8개 문서 약 169KB |

**§13 스물다섯 줄이 코드 3,069줄과 문서 303KB를 대표하고 있다.** 이것이 이 지도가 필요한 이유다.

---

## 1. 통합 판정 — 전부 합칠 수는 없다

결론: **문서를 통째로 옮기는 통합은 하지 않는다. 사실만 끌어올린다.**

### 합치지 않는 것

`avatar-speed/`와 `partner-admin/`은 [Diataxis](https://diataxis.fr/) 4분면 문서다. 튜토리얼과
하우투는 **지금 있는 코드를 실행하는 절차**이고, `architecture/`는 **그 코드를 대체할 시스템의
설계**다. 둘을 한 디렉터리에 넣으면 두 가지가 깨진다.

- **갱신 주기가 다르다.** 튜토리얼은 버튼 이름이 바뀌면 틀린다. 설계 문서는 버튼 이름과 무관하다.
  한곳에 두면 어느 쪽이 낡았는지 구분할 수 없다.
- **폐기 시점이 다르다.** `avatar-speed/`의 튜토리얼은 이관이 끝나면 통째로 폐기 대상이다.
  `architecture/`는 그때 비로소 정본이 된다.

### 합치는 것 — 다섯 가지 사실

| # | 무엇 | 출처 | 들어갈 곳 |
| --- | --- | --- | --- |
| 1 | 라운드·베팅·아바타 도메인 모델 | `avatar-speed/reference-*`, `explanation-round-flow.md` | **신규 `09-player-game-domain.md`** + `ddl/014_game.sql` |
| 2 | 파트너 콘솔 58화면이 쓰는 컬렉션·연산 | `partner-admin/reference-screens.md` | `01` §13 확장, `05` 조회 API |
| 3 | 결함 26건 (G-01~G-12 · P-01~P-14) | 양쪽 `explanation-known-gaps.md` | `06` §11 체크리스트, `07` M-목록 |
| 4 | 원장 카테고리 5종 누락 | 코드 대조 | `04` §16 ENUM, `ddl/001` |
| 5 | 자금 쓰기 지점 전수 목록 | 양쪽 README + 코드 | 이 문서 §4, `04` |

나머지(튜토리얼·하우투·화면 카탈로그·로드맵 알고리즘)는 **제자리에 두고 상호 링크만 건다.**

---

## 2. 전체 시스템 구성도 — 현행

```
                    ┌──────────────────────────────────────────────────┐
                    │       Firebase Hosting  (단일 오리진, 빌드 없음)    │
                    │       정적 파일을 그대로 서빙. 번들러도 없다          │
                    └──────────────────────────────────────────────────┘
         ┌────────────────────┬───────────────────────┬────────────────────┐
         ▼                    ▼                       ▼                    ▼
 ┌───────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐
 │ /index.html   │  │ /partner-admin/  │  │ /avatar/         │  │ /speed/       │
 │ 케이지 어드민   │  │ 파트너 콘솔        │  │ 플레이어 사이트     │  │ 리다이렉트만    │
 │               │  │                  │  │                  │  │ → /avatar/    │
 │ 단일 파일 SPA  │  │ app.js 1,867줄   │  │ app.js 1,202줄    │  │   ?mode=speed │
 │ 9,422줄       │  │ 12그룹 / 58화면   │  │ 아바타 39초 루프   │  └───────────────┘
 │ 계좌·게임·정산 │  │ 승인·정산·통계    │  │ 스피드 21초 루프   │
 └───┬───────┬───┘  └────────┬─────────┘  └────────┬─────────┘
     │       │               │                     │
     │       │               └──────────┬──────────┘
     │       │                          │
     │       │              ┌───────────▼────────────────────────────┐
     │       │              │ shared/                                 │
     │       │              │  cage-ui.js      Firebase 부트스트랩     │
     │       │              │                  writeMemberLedgerEntry  │
     │       │              │  game-engine.js  결과 생성 · 정산 · 로드  │
     │       │              │  i18n.js         ko / zh / en / ja / vi  │
     │       │              └───────────┬─────────────────────────────┘
     │       │                          │
     │       │  ※ 파트너 콘솔과 플레이어 사이트는 Cloud Function을 호출하지 않는다.
     │       │     전부 브라우저에서 Firestore를 직접 읽고 쓴다.
     │       │
     │       └────────────────┐
     │                        ▼
     │        ┌────────────────────────────────────────────────┐
     │        │ Cloud Functions v2  (functions/index.js 365줄)  │
     │        │                                                 │
     │        │  인증 3종     listStaffNames · staffLogin        │
     │        │              masterSessionToken                 │
     │        │  텔레그램 4종  telegramWebhook · getTelegramLinks │
     │        │              sendTelegramMessage                │
     │        │              deleteTelegramLink                 │
     │        │                                                 │
     │        │  functions/balance/   (미배포 · 미연결)           │
     │        │   backfillBalances · reconcile                   │
     │        │   spillPlan · withdrawTransaction                │
     │        └───────────┬──────────────────┬──────────────────┘
     │                    │                  │
     │                    │                  ▼
     │                    │        ┌──────────────────┐
     │                    │        │ Telegram Bot API │
     │                    │        └──────────────────┘
     ▼                    ▼
┌─────────────────┐  ┌──────────────────────────────────────────────────────┐
│  localStorage   │  │                     Firestore                         │
│  (단말별 로컬)   │  │                    컬렉션 33종                          │
│                 │  │                                                       │
│ ★ accounts      │  │  케이지 9종    ledger · games · rollingEvents ·         │
│   계좌 마스터     │  │               mainCageLedger · shiftEvents ·          │
│   Firestore에    │  │               cageConfig · branchTransfers ·          │
│   존재하지 않음   │  │               staff · avatarMissCorrections           │
│                 │  │                                                       │
│   로그인 폴백     │  │  회원자금 3종  memberLedger · members · balanceTotals   │
│   시드 데이터     │  │                                                       │
└─────────────────┘  │  플레이어 5종  rounds · tables · avatarRequests ·       │
                     │               avatarServiceRequests · chatMessages     │
   firestore.rules   │                                                       │
   staff 만 잠김      │  파트너운영 16종 partners · partnerStaff · adminLogs ·  │
   나머지 32종 무제한 │               depositRequests · paymentRequests ·      │
                     │               memberActionLogs · shareLedger ·         │
                     │               notices · inGameNotices · tickerNotices · │
                     │               noticeGuide · inquiries · csContacts ·    │
                     │               events · bannedWords · cageConfigPartner  │
                     └──────────────────────────────────────────────────────┘
```

### 이 그림에서 읽어야 할 세 가지

**첫째, 인증 경계와 자금 경계가 다른 곳에 있다.** Cloud Functions는 직원 로그인과 텔레그램만
가로챈다. 돈을 만지는 모든 쓰기는 브라우저에서 Firestore로 직접 간다. `firestore.rules`는
`staff` 컬렉션 하나만 잠근다 — `memberLedger`·`ledger`·`balanceTotals`를 포함한 32종은
프로젝트 ID만 알면 누구나 읽고 쓴다. 자세히는 [06-security.md](06-security.md) §1.

**둘째, `accounts`는 Firestore에 없다.** 케이지 계좌 마스터(회원명·전화·요율·텔레그램·여권
사본·통화·개설지점)는 `index.html:5706`의 `seedDB()`가 만들고 **`localStorage`에만** 남는다.
저장소 전체에서 `db.collection('accounts')` 호출이 0건이고, 실시간 구독 8채널에도 없다. 원장
항목은 Firestore에 있는데 그 항목이 가리키는 계좌의 신원 정보는 각 운영자의 브라우저에만
있다는 뜻이다. **단말마다 계좌 목록이 다를 수 있다.** 이관 시 결정적 문제이며
[07-migration.md](07-migration.md)에 아직 항목이 없다 (§8 개선 항목 A3).

**셋째, `/speed/`는 앱이 아니다.** `/avatar/?mode=speed`로 보내는 리다이렉트 껍데기다. 두
모드는 같은 코드·같은 로그인·같은 보유금을 쓰고 라운드 길이와 베팅 주체만 다르다.

---

## 3. 앱 4개의 경계

| | 케이지 어드민 | 파트너 콘솔 | 플레이어 사이트 |
| --- | --- | --- | --- |
| 경로 | `/index.html` | `/partner-admin/` | `/avatar/` (+`/speed/`) |
| 사용자 | 지점 케이지 직원 | 파트너(에이전트) 운영자 | 회원 |
| 인증 | PIN + TOTP, Cloud Function 검증 | `admin`/`0000` 클라이언트 비교 | 회원 ID + 평문 비밀번호 |
| 자금 대상 | 케이지 `ledger` (계좌·칩) | 회원 `memberLedger` | 회원 `memberLedger` |
| Cloud Function | **호출함** (인증·텔레그램) | 호출 안 함 | 호출 안 함 |
| 트랜잭션 가드 | 출금 등 일부 | 4곳 | **0곳** |
| 전용 문서 | 없음 (`01`이 대신) | `docs/partner-admin/` | `docs/avatar-speed/` |

**케이지와 회원은 서로 다른 원장이다.** `ledger`(케이지)와 `memberLedger`(회원)는 필드 구조도
계정 체계도 분리되어 있고, 둘 사이에 이체 경로가 없다. 목표 설계는 이 둘을 하나의 원장으로
합친다 — [08-adr.md](08-adr.md) ADR-011, [04-posting-rules.md](04-posting-rules.md) §12.

---

## 4. 자금이 움직이는 전 지점

두 원장에 쓰는 지점 전부. **하나라도 빠뜨리면 이관 시 잔액이 맞지 않는다.**

### 4-1. 회원 원장 (`memberLedger`) — 9곳

전부 [`writeMemberLedgerEntry()`](../../shared/cage-ui.js#L202) 한 함수를 거친다. 같은 배치
안에서 `balanceTotals`에 `FieldValue.increment()`를 적용한다.

| 앱 | 함수 | 위치 | `category` |
| --- | --- | --- | --- |
| 파트너 | `submitBalanceAdjust` | `partner-admin/app.js:416` | `deposit` / `withdraw` |
| 파트너 | `approveDeposit` | `:906` | `deposit` |
| 파트너 | `processPayment` | `:1681` | `deposit` / `withdraw` |
| 파트너 | `submitRoundCancel` — 베팅 환불 | `:1304` | `correction` |
| 파트너 | `submitRoundCancel` — 페이아웃 회수 | `:1307` | `correction` |
| 플레이어 | `playerSignup` 가입 보너스 | `shared/game-engine.js:82` | `deposit` |
| 플레이어 | `placeBet` | `:124` | `bet` |
| 플레이어 | `settleBet` | `:131` | `payout` |
| 플레이어 | 팁 | `avatar/app.js:706` | `avatar_tip` / `dealer_tip` |

예외가 하나 있다. **데모 시드(`seedDemoData`, `partner-admin/app.js:1724`)만 이 함수를 거치지
않고 `batch.set()`으로 직접 쓴다** — 시드 데이터는 `balanceTotals`에 반영되지 않는다
([P-08](../partner-admin/explanation-known-gaps.md#p-08--데모-시드가-balancetotals를-갱신하지-않는다)).

### 4-2. 케이지 원장 (`ledger` · `mainCageLedger`)

`index.html` 안에 있다. 입출금 · 바이인 · 중간정산 · 게임종료 · 게임취소 · 지점이체 ·
메인케이지 조정. 상세는 [01-current-system.md](01-current-system.md) §4 · §7 · §8 · §11.

### 4-3. 현행 카테고리와 목표 ENUM의 차이

현행 `memberLedger`가 실제로 쓰는 `category` 10종:

```
bet   payout   deposit   withdraw   correction
point_earn   point_convert   share_accum   avatar_tip   dealer_tip
```

[04-posting-rules.md](04-posting-rules.md) §16의 `entry_category` ENUM에는 **뒤 5종이 없다.**
`point_earn` · `point_convert` · `share_accum` · `avatar_tip` · `dealer_tip`은 목표 설계에
대응하는 분개 규칙도, DDL의 ENUM 값도, 계정 종류도 없다. 포인트와 파트너 쉐어는 별도 회계
주체이므로 계정 종류부터 정해야 한다 (§8 개선 항목 A4).

---

## 5. 목표 시스템 구성도

```
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ 케이지 어드민  │  │ 파트너 콘솔    │  │ 플레이어 앱    │  │  텔레그램 봇   │
   └───────┬──────┘  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘
           └─────────────────┴─────────────────┴─────────────────┘
                                    │  HTTPS · Idempotency-Key 필수
                                    ▼
        ┌────────────────────────────────────────────────────────────┐
        │              API 게이트웨이  (모듈러 모놀리스)                  │
        │  인증 · 인가 · 멱등성 · 4-eyes 승인 · 감사 로그                │
        │  [05-api-contract.md]                                       │
        └────────────────────────────┬───────────────────────────────┘
                                     │  전 자금 명령이 DB 함수 하나로 수렴
                                     ▼
        ┌────────────────────────────────────────────────────────────┐
        │                      PostgreSQL 18                          │
        │                                                             │
        │   identity   직원 · 역할 · 세션 · TOTP · 승인 · 교대          │  002 ✅
        │   ledger     계정 · 거래 · 분개 · 잔액 · 회원 · 기간           │  003·004·006 ✅
        │   cage       게임 · 롤링 · 정산 · 메인케이지 · 실사 · 칩재고    │  005 ✅
        │   game       라운드 · 테이블 · 베팅 · 아바타 · 채팅            │  ❌ 미설계
        │                                                             │
        │   ┌──────────────────────────────────────────────────┐      │
        │   │  ledger.post_transaction()   내부 코어             │      │  008 ✅
        │   │   · 통화별 분개 합 = 0 강제                        │      │
        │   │   · 잔액 하한 검사 (지연 제약 트리거)               │      │
        │   │   · 해시 체인 · 기간 동결 검사                      │      │
        │   └──────────────────────▲───────────────────────────┘      │
        │                          │ op_* 만 호출할 수 있다            │
        │   op_deposit · op_withdraw · op_transfer · op_branch_transfer │  009 ✅
        │   op_game_start · op_buyin · op_settle · op_game_end · …      │  010 ✅
        │   op_bet · op_payout · op_round_cancel · op_avatar_*          │  ❌ 미설계
        │                                                             │
        │   RLS · SECURITY DEFINER · 지연 제약 · Outbox                │  007·012 ✅
        └────────────────────────────┬───────────────────────────────┘
                                     ▼
                     ┌───────────────────────────────┐
                     │ Outbox → 실시간 스트림 · 텔레그램 │
                     └───────────────────────────────┘
```

`ddl/`의 13개 SQL 파일이 위 그림을 거의 다 덮는다. **비어 있는 것은 `game` 스키마와 플레이어
연산뿐이다.**

---

## 6. 도메인 커버리지 매트릭스

무엇이 코드에 있고, 문서화됐고, 목표 설계가 있고, DDL이 있는가.

> **2026-08-15 갱신.** 목표 설계가 ❌였던 도메인이 전부 [`docs/spec/`](../spec/README.md)로 채워졌다
> ([`00-decisions.md`](../spec/00-decisions.md) §11 범위 결정). **"목표 설계" 열은 이제 빈 칸이 없다.**
> DDL 열은 아직 비어 있고 **그것이 남은 작업이다** — 이 두 열의 차이가 곧 M2·M4의 크기다.

| 도메인 | 현행 코드 | 현행 문서 | 목표 설계 | DDL |
| --- | --- | --- | --- | --- |
| 케이지 계좌 · 원장 | `index.html` | `01` §3·§4 | `03` · `04` §1~4 · [`spec/01`](../spec/01-ledger-foundation.md) | ✅ 003·004·008 |
| 케이지 게임 · 롤링 · 중간정산 · 종료 | `index.html` | `01` §5·§6·§7-1~7-3 | `04` §5~10 · [`spec/04`](../spec/04-cage-game-rolling.md) | ✅ 005·010 |
| **케이지 롤링 커미션 정산** | `index.html` `_doSettleGame` | ✅ `01` §7-0 *(2026-08-15 신규)* | ✅ `04` §6-1 · `05` §3-2 *(`DR-66` 해소)* · [`spec/04`](../spec/04-cage-game-rolling.md) §2 *(U3 확정)* | ✅ `commission_payout` · `cage.commission_settlements` · `op_settle_commission` |
| **이벤트 커미션** | `index.html` `payEventCommissionForSettle` | ✅ `01` §7-4 | ✅ [`spec/06`](../spec/06-event-commission.md) *(2026-08-15, `DR-67`·B1 해소)* | ⚠ `tx_kind`·`entry_category`·분개 2행만. `cage.bonus_events` 미작성 |
| **케이지 포인트** | `index.html` `grantPoints`·`usePoints` | ✅ `01` §3-1 | ✅ [`spec/05`](../spec/05-cage-points.md) *(2026-08-15, `DR-68`·B2 **분리**로 해소)*. 아래 "포인트 · 파트너 쉐어" 행은 **파트너 측 전용**이다 | ⚠ `cage_point`·`point_liability` 계정 종류 + 분개 4행만. `op_point_grant`/`op_point_use` 미작성 |
| **컨시어지 — 호텔 · 차량 · 항공** | `index.html` | ✅ `01` §3-2 | ✅ [`spec/07`](../spec/07-concierge.md) *(2026-08-15, `DR-69` 해소)* | ❌ 없음 — `concierge` 스키마 신설 필요 |
| **계좌 차단 · 생명주기** | `index.html` `applyBlock`·`unblock` | ✅ `01` §3-3 | ✅ [`spec/08`](../spec/08-account-lifecycle.md) *(2026-08-15, `DR-70`·`DR-83` 해소)* | ⚠ `account_status` ENUM + `approval_subject='account_status'`만. `op_set_account_status` 미작성 |
| 메인케이지 · 교대 · 실사 | `index.html` | `01` §8~10 | `03` §9 · `04` §11 | ✅ 006 |
| 지점 간 이체 | `index.html` | `01` §11 | `04` §4 | ✅ 009 |
| 직원 인증 · TOTP · 4-eyes | `index.html` + `functions/` | `01` §12 · `06` | `06` §3 · [`spec/02`](../spec/02-identity-access.md) | ✅ 002 |
| 회원 보유금 원장 | 3개 앱 공통 | `01` §13 (전수) | `04` §13 (베팅·페이아웃만) · [`spec/13`](../spec/13-player-domain-deferred.md) *(§2~§4 확정분)* | ⚠ ENUM만 |
| 계좌 마스터 데이터 | **`localStorage`** | ✅ `01` §3 · `07` M11 | `ledger.parties` · [`spec/08`](../spec/08-account-lifecycle.md) §4 | ⚠ 모델 정의가 M0. **수집은 U1=데모로 소멸** |
| **파트너 주체 · 운영자** | `partner-admin/` | ✅ `01` §13-1 | ✅ `06` §1·§6-1 · [`spec/10`](../spec/10-partner-console.md) | ✅ 001·002·003·012 |
| **포인트 · 파트너 쉐어** *(파트너 측)* | `partner-admin/` | ✅ `01` §13-3 | ✅ `04` §13-2·§13-3 · [`spec/10`](../spec/10-partner-console.md) §5 | ⚠ 001·003·004 (`share_accrue` **요율 규칙 미확정**) |
| **플레이어 라운드 · 베팅** | `avatar/` + `game-engine.js` | ✅ `avatar-speed/` | ⏸ **보류** — 단 [`spec/13`](../spec/13-player-domain-deferred.md) §2~§4(배당 규약·페이아웃 멱등키·행위자 모델)는 **보류 밖** | ⏸ 보류 |
| **아바타 대리베팅** | `avatar/` + `partner-admin/` | ✅ 양쪽 | ⏸ **보류** — 행위자 2행 모델은 [`spec/13`](../spec/13-player-domain-deferred.md) §4에서 지금 확정 | ⏸ 보류 |
| **파트너 콘솔 58화면** | `partner-admin/` | ✅ `partner-admin/` | ✅ [`spec/10`](../spec/10-partner-console.md) *(2026-08-15 신규)* | ❌ 없음 |
| **채팅 · 공지 · 고객센터** | `partner-admin/` + `avatar/` | ✅ `reference-screens.md` | ✅ [`spec/11`](../spec/11-chat-notice-support.md) *(2026-08-15 신규)* | ❌ 없음 — `support` 스키마 신설 필요 |
| 텔레그램 연동 | `functions/` | `reference-cloud-functions.md` | ✅ `06` §8 + [`spec/09`](../spec/09-notifications.md) *(2026-08-15 신규)* | ❌ 없음 — `notify` 스키마 신설 필요 |
| **CI · 골든 테스트** | 없음 | — | ✅ [`spec/12`](../spec/12-ci-golden-tests.md) *(2026-08-15 신규)* | ❌ 없음 — **M0의 첫 커밋** |

[02-target-architecture.md](02-target-architecture.md)의 스키마 지도가 이미 이렇게 적어 두었다:

> **`game` 스키마는 아직 DDL에 없다.** `ddl/`의 범위는 원장과 케이지다. 플레이어앱 도메인은
> 별도 작업이다.

**그 "별도 작업"의 입력 자료가 방금 완성된 두 문서 세트다.** 지금까지는 `avatar/`의 도메인을
서술한 문서가 없어 설계를 시작할 수 없었다. 이제 있다.

---

## 7. 결함 ID 체계 — 네임스페이스가 충돌한다

지금 저장소에 결함 ID 체계가 넷 있다.

| 접두사 | 출처 | 개수 | 대상 |
| --- | --- | --- | --- |
| `TA-S*` · `TA-C*` · `TA-Q*` · `TA-P*` · `TA-D*` | Track A 하드닝 작업 | 14 | 저장소 전체 |
| `G-01` ~ `G-12` | [`avatar-speed/explanation-known-gaps.md`](../avatar-speed/explanation-known-gaps.md) | 12 | 플레이어 사이트 |
| `P-01` ~ `P-14` | [`partner-admin/explanation-known-gaps.md`](../partner-admin/explanation-known-gaps.md) | 14 | 파트너 콘솔 |

**Track A 항목에 `TA-` 접두사를 붙인다.** 원래 표기는 `S1` · `C1` · `Q1` · `P2` · `D1`이었는데,
그중 **`P2`(실시간 구독 성능)가 `P-02`(빈 입력 로그인이 `admin`이 됨)와 하이픈 하나 차이**였다.
접두사 없이는 어느 체계의 항목인지 문장 밖에서 판별할 수 없다.

이 문서 세트에서 Track A 항목을 인용할 때는 `TA-S8`처럼 쓴다. Track A 자체 산출물(작업 보고서)의
원래 표기는 그대로 두되, 이 문서 세트 안에서는 접두사를 붙인 형태가 정본이다.

### 목표 설계로 올려야 할 결함

26건 중 **목표 설계의 요구사항을 바꾸는 것**만 추렸다. 나머지는 현행 코드의 버그이지 설계
입력이 아니다.

| 결함 | 요지 | 목표 설계에 미치는 영향 |
| --- | --- | --- |
| [G-01](../avatar-speed/explanation-known-gaps.md#g-01--베팅의-relatedroundid가-rounds-문서-id와-일치하지-않는다) | 베팅의 `relatedRoundId`가 `rounds` 문서 ID와 불일치 | **`04` §13의 멱등키 `bet:{round_id}:{member}:{bet_type}`를 이관 데이터에 적용할 수 없다.** 과거 베팅은 라운드와 조인되지 않는다 |
| [G-02](../avatar-speed/explanation-known-gaps.md#g-02--베팅-한도가-어디에서도-강제되지-않는다) | 베팅 한도 미강제 | `game.tables`에 한도 컬럼 + `op_bet` 검사 필요 |
| [G-03](../avatar-speed/explanation-known-gaps.md#g-03--아바타-자동베팅은-잔액을-확인하지-않는다) | 아바타 자동베팅이 잔액 미검사 | `post_transaction()`의 잔액 하한이 이 경로를 반드시 덮어야 한다 |
| [G-05](../avatar-speed/explanation-known-gaps.md#g-05--point_convert에-대응하는-보유금-입금-항목이-없다) | 포인트 전환에 대응 입금 없음 | 포인트 계정 종류 필요. 현행은 한쪽만 기록돼 분개 합이 0이 아니다 |
| [G-09](../avatar-speed/explanation-known-gaps.md#g-09--아바타-바이인이-보유금에-반영되지-않는다) | 아바타 바이인이 기록만 됨 | 바이인을 자금 연산으로 볼지 결정 필요 |
| [P-01](../partner-admin/explanation-known-gaps.md#p-01--라운드-취소-환불-루프가-원자적이지-않다) | 취소 환불 루프가 비원자적 | `op_round_cancel`은 단일 트랜잭션이어야 한다 |
| [P-03](../partner-admin/explanation-known-gaps.md#p-03--라운드-취소가-실플레이-베팅을-환불하지-못한다) | 취소가 실플레이 베팅을 못 찾음 | G-01과 같은 뿌리. 조인 키 설계 문제 |
| [P-14](../partner-admin/explanation-known-gaps.md#p-14--라운드-결과-수정이-정산을-재계산하지-않는다) | 결과 수정이 정산을 재계산하지 않음 | 결과 정정 = 역분개 + 재정산. `04`에 규칙이 없다 |
| [P-05](../partner-admin/explanation-known-gaps.md#p-05--아바타-신청-승인에는-트랜잭션-가드가-없다) | 아바타 승인에 가드 없음 | 승인은 상태 전이 + 자금. 4-eyes 대상 후보 |
| [P-12](../partner-admin/explanation-known-gaps.md#p-12--partnerstaff가-평문-비밀번호를-공개-노출한다) | `partnerStaff` 평문 비밀번호 공개 노출 | **`06` §1에 해당 행이 없다.** `identity.staff`와 별개 주체 |
| [P-08](../partner-admin/explanation-known-gaps.md#p-08--데모-시드가-balancetotals를-갱신하지-않는다) | 시드가 `balanceTotals` 미갱신 | `07` M10 보강 — 파생값을 개시 잔액으로 쓰면 안 되는 근거 |

---

## 8. 개선 항목

| ID | 항목 | 왜 | 산출물 | 상태 |
| --- | --- | --- | --- | --- |
| **A3** | 계좌 마스터 이관 경로 | `accounts`가 `localStorage`에만 있다. Firestore 덤프만으로는 복원 불가 | `07` 신규 **M11** · `01` §3 경고 | ✅ 완료 |
| **A5** | 파트너 주체 모델 | `partners`·`partnerStaff`가 `identity`에 없다. 직원과 다른 주체다 | `ddl/001`·`002`·`003`·`012` · `06` §1·§6-1 | ✅ 완료 |
| **A4** | 원장 카테고리 — 포인트 · 쉐어 | `point_earn`·`point_convert`·`share_accum`이 목표 ENUM에 없다. 전환은 한쪽만 기록돼 분개 합이 0이 아니다 | `04` §13-2·§13-3·§16 · `ddl/001`·`003`·`004` | ✅ 완료 |
| **A7** | `01` §13 확장 | 25줄이 코드 3,069줄을 대표 중. 파트너·플레이어 컬렉션 24종이 미열거 | `01` §13-1~13-5 | ✅ 완료 |
| **A6** | 결함 ID 재배정 | `P2` ≠ `P-02`. 충돌 | `TA-` 접두사 도입 (§7) | ✅ 완료 |
| **A9** | 상호 링크 | 세 문서 세트가 서로를 가리키지 않는다 | 각 README · `references.md` | ✅ 완료 |
| **A1** | `game` 스키마 설계 | 플레이어 도메인 전체가 목표 설계에 없다 | `09-player-game-domain.md` + `ddl/014_game.sql` | ⏸ **보류** |
| **A2** | 플레이어 자금 연산 규칙 | `04` §13이 베팅 · 페이아웃 2종만 다룬다. 취소 · 정정 · 팁 · 보너스가 없다 | `04` §13-2~ + `ddl/015_operations_player.sql` | ⏸ **보류** |
| **A8** | 플레이어 · 파트너 API | `05` §3·§4에 해당 엔드포인트가 0개 | `05` §3-6 신규 | ⏸ 부분 보류 |
| **A10** | **케이지 기준선 정정 — 누락 도메인 5종** | `01`이 케이지 자금 이동 2곳(롤링 커미션 정산 · 이벤트 커미션)과 화면 도메인 3곳(포인트 · 컨시어지 · 차단)을 서술하지 않았고, 그 공백이 목표 설계 공백으로 전파됐다 (`DR-66`~`DR-70`) | `01` §3-1~3-4 · §7-0 · §7-4 · §9 라인 재고정 · §17 12~14행 · 위 §6 매트릭스 6행 | ✅ **서술 완료** · 목표 설계는 `DR-66`만 완료 |
| **A11** | **차단 13건 설계 반영 (1단계)** | 아홉 회차 검토의 차단 13건이 해소되기 전에는 스펙을 쓸 수 없다 — 스펙이 참조할 경로가 설계에 없어 구현자가 시그니처와 분개를 즉석에서 지어내게 된다 | `ddl/` 001~013 · `04` §6-1·§11-2 · `05` §2-3·§3-2·§3-6·§6-2·§6-4 · `06` §4-1·§9-2·§10 · `07` §3-1·§9 | ✅ **완료 (2026-08-15)** — `DR-38`만 부분. **적용 검증 완료** (B1) |

### A1 · A2 · A8을 보류하는 이유

**아바타/스피드 플레이어 사이트의 개선 작업이 진행 중이다 (2026-08-14).** 라운드·베팅 구조가
바뀔 여지가 있으므로, 지금의 `rounds` · `avatarRequests` 구조를 목표 스키마로 옮기면 확정되지
않은 설계를 옮기는 것이 되어 폐기 작업이 된다. [07-migration.md](07-migration.md) §8의 M3·F4
보류 표기와 같은 근거다.

현행 구조의 사실 기록은 [`docs/avatar-speed/`](../avatar-speed/README.md)에 있다. 아바타 개선이
확정되고 그 문서가 갱신된 뒤 A1을 착수한다. A2는 A1의 테이블에 의존하므로 함께 움직인다.
A8은 케이지·파트너 엔드포인트만 먼저 다루고 플레이어 명령 API는 A1과 함께 미룬다.

### 지금 진행하는 것의 순서

의존 관계가 순서를 정한다. 타입이 테이블보다 먼저고, 테이블이 연산 함수보다 먼저다.

```
A3  계좌 마스터 M11        케이지 측. 아바타와 무관. 이관 블로커     ✅
A5  파트너 주체            ddl/001 party_type · 002 principal_type   ✅
                          003 partner_profiles · 012 party_visible
A4  포인트 · 쉐어 계정      ddl/001 account_kind · entry_category     ✅
                          003 부트스트랩 · 004 posting_rules · 04 §13-2·13-3
A7  01 §13 기준선 정정      컬렉션 24종 · 쓰기 9곳 · category 10종    ✅
A6  결함 ID 재배정          TA- 접두사                                ✅
A9  상호 링크 · 매트릭스 갱신                                        ✅
A10 케이지 기준선 정정      01 §3-1~3-4 · §7-0 · §7-4 · §9 · §17     ✅ 서술만
                          누락 도메인 5종 (DR-66~70) · 6차 착수순서 1번
A11 차단 13건 설계 반영     ddl/001~013 · 04 §6-1·§11-2 · 05 · 06 · 07  ✅ 완료
                          DR-38 만 부분. PG 18.6 적용·동작 검증 통과
```

**A4의 팁(`avatar_tip`·`dealer_tip`)과 가입 보너스는 이번 범위에서 뺐다** — 아바타 도메인
소속이라 A1과 함께 움직인다. 포인트와 파트너 쉐어는 파트너 콘솔 측이라 영향받지 않는다.

### 남은 것

| | 무엇 | 언제 |
| --- | --- | --- |
| **A1 · A2 · A8(플레이어 부분)** | `game` 스키마 · 플레이어 자금 연산 · 플레이어 API | 아바타 개선 확정 후 |
| **A8(케이지 · 파트너 부분)** | `05` §3·§4에 파트너 콘솔 엔드포인트 | A1과 무관. 착수 가능 |
| ~~**A10 후속 — 롤링 커미션 정산**~~ | ~~`04` 분개 규칙 · `05` 엔드포인트 · `ddl` `tx_kind`·`posting_rules`·`op_settle_commission`·GRANT~~ | ✅ **완료 (2026-08-15)** — `DR-66` 해소. `04` §6-1 · `05` `POST /v1/games/{game_no}/commission-settle` · `cage.commission_settlements` · `commission_payout`. `DR-84`·`DR-85`도 함께 편입 |
| **A10 후속 — 이벤트 커미션 · 케이지 포인트** | 사업 결정 선행(이벤트 지속 여부 · 포인트 흡수/분리/폐기) 후 설계 | `DR-67`·`DR-68`. 파트너 쉐어 사업 규칙 수집과 같은 회의 |
| **A10 후속 — 컨시어지 · 계좌 차단** | 자금 무관. 테이블 + CRUD, 차단은 이력 테이블 + 재인증 | `DR-69`·`DR-70`. 화면 이식 순서에 맞춰 후순위 |
| ~~**B1 — `ddl/` 적용 검증**~~ | ~~2026-08-15 차단 13건 반영분이 실제 PostgreSQL에 클린 적용되는지 확인~~ | ✅ **완료 (2026-08-15)** — PostgreSQL 18.6에 001~013 클린 적용 + op 함수 실동작 확인. 새 결함 1건(함수 7개 PUBLIC EXECUTE 노출) 발견·수정. [ddl/README.md](ddl/README.md) |
| ~~**B2 — 2단계: 높음 이하 73건**~~ | ~~남은 검토 항목을 스펙 수용 기준으로 전환~~ | ✅ **완료 (2026-08-15)** — [10-acceptance-criteria.md](10-acceptance-criteria.md). 잔여 **72건**을 마일스톤별로 묶고 `AC-*` 수용 기준으로 전환했다 |
| **B3 — 3단계: 마일스톤별 스펙 작성** | `AC-*`를 구현 스펙으로 전개 | **선행: §2 결정 6건** (U1·U2·U3·U5·B1·B2). 결정 없이 쓸 수 있는 것은 M0·M1의 스키마 항목뿐이다 |
| 파트너 콘솔 58화면 · 채팅 · 공지 · 고객센터 | 목표 설계 없음 | 우선순위 미정 |
| 텔레그램 연동 | `06` §8 외 설계 없음 | 우선순위 미정 |

### DDL 검증 상태

**2026-08-14: `ddl/` 001~013 전 파일이 PostgreSQL 18에 클린 적용되는 것을 처음으로 확인했다.**
그 과정에서 `008`의 `begin_idempotent()`(PL/pgSQL 다중 타깃 `INTO`에 행 변수)와 `012`의
GRANT/정의 순서 역전이 드러났고 함께 고쳤다 — **둘 다 `009`~`013` 전체를 적용 불가로 만들고
있었다.**

**2026-08-15: 차단 13건 반영분을 PostgreSQL 18.6에 적용하고 연산 함수 동작까지 확인했다.**
적용 오류 0. `DR-03` 스텝업(정상 1 + 거부 6종) · `DR-04` 멱등키 · `DR-01` 차액 해소 ·
`DR-50` 역분개 · `DR-66` 커미션 정산 · `DR-38` 개시 잔액이 전부 의도대로 동작했고
R1~R9 위반 0이다. **`DR-26`의 논거도 실증했다** — 체인을 통째로 재작성하면
R1~R7·R9가 전부 통과하고 **R8만 잡는다.**

여기서 **새 결함 하나가 드러났다.** 함수 7개(`SECURITY DEFINER`)가 PUBLIC EXECUTE로
열려 있었다. `012`의 `REVOKE ALL ON ALL FUNCTIONS`가 실행 시점의 함수만 대상이고,
막고 있다고 적혀 있던 `ALTER DEFAULT PRIVILEGES ... REVOKE ... ON FUNCTIONS FROM PUBLIC`은
PostgreSQL 18에서 **아무 일도 하지 않기 때문이다.** `013` 끝의 사후 일괄 REVOKE로
막고 `ledger.v_check_public_execute`를 드리프트 검사에 추가했다. `DR-24`와 같은 병 —
한쪽에서 닫고 다른 쪽에서 기본값으로 다시 열렸다.

상세는 [`ddl/README.md`](ddl/README.md).

---

## 9. 관련 문서

| 문서 | 내용 |
| --- | --- |
| [README.md](README.md) | 이 문서 세트의 목적과 두 트랙 구분 |
| [design-review.md](design-review.md) | **설계 검토 결과 (DR-01~DR-23).** 위 §8의 `✅` 표기 재검증 대상 포함 |
| [10-acceptance-criteria.md](10-acceptance-criteria.md) | **수용 기준 등록부.** 검토 잔여 72건을 마일스톤별 `AC-*` 로 전환. §8 B3 의 입력 |
| [01-current-system.md](01-current-system.md) | 현행 케이지 어드민 사실 기준선 |
| [02-target-architecture.md](02-target-architecture.md) | 목표 서비스 경계와 스키마 지도 |
| [`docs/avatar-speed/`](../avatar-speed/README.md) | 플레이어 사이트 전체 문서 8건 |
| [`docs/partner-admin/`](../partner-admin/README.md) | 파트너 콘솔 전체 문서 8건 |
| [`docs/FIRESTORE_DATA_MODEL.md`](../FIRESTORE_DATA_MODEL.md) | 현행 컬렉션 스키마 |
| [`docs/BALANCE_ARCHITECTURE_DESIGN.md`](../BALANCE_ARCHITECTURE_DESIGN.md) | `balanceTotals` 이중 쓰기와 컷오버 |

---

## 10. 이 문서에 대해

- **작성 방법**: `docs/avatar-speed/`와 `docs/partner-admin/`의 문서 16건을 읽고,
  `docs/architecture/`의 문서 10건 및 `ddl/` 14개 파일과 대조했다. 두 문서 세트가 서술한
  사실은 코드에서 재확인했다 — 컬렉션 목록, 자금 쓰기 지점, 원장 카테고리, Cloud Function
  호출자, `accounts` 저장 위치.
- **직접 확인한 것**: 컬렉션 33종(`collection()`과 시드 헬퍼 전수 grep), `memberLedger` 쓰기
  9곳, `category` 10종, `db.collection('accounts')` 0건, 파트너·플레이어의 Cloud Function
  호출 0건, Cloud Function export 7종.
- **줄 번호 규약**: 함수명이 권위 있는 참조이고 줄 번호는 보조다. 기준 커밋은 `1bd7ef6`.
