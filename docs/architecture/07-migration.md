# 07. 마이그레이션 계획

---

## 1. 첫 번째 결정 — 데이터를 옮길 것인가

**이 답에 따라 계획 전체가 갈린다.**

```
현재 Firestore 데이터가 실거래인가?
│
├── 아니오 (데모/시연 데이터)
│     → 옮기지 않는다. 새 DB에서 시작한다
│     → 마이그레이션 작업이 통째로 사라진다. 가장 안전하고 가장 빠르다
│
└── 예 (실제 자금 이력)
      → 3절 이관 절차. 감사가 선행되어야 한다
```

### 실거래 여부 판별 방법

`seedDB()`가 데모 계좌를 생성한다 (`index.html:5758-5790`). 다음이 시드값이다 (**2026-08-14 기준 — 직원 목록이 초판에서 바뀌었다**):

```
SE7419 · MK2201 · PL0001 · PL8888 · PL9999 · PL7777 · PL9642   (전부 balance 5,000,000)
MAIN-HANN · MAIN-NUSTAR · MAIN-ONLINE                          (NUSTAR 만 50,000,000)
직원 6명: Eric · Jena · Woni · Liv · Minami · May               (PIN 전부 '1234')
```

> **초판은 직원 시드를 `Kyle · Teddy · Jena · Woni · Liv · Minami · May` 7명으로 적었다.** Track A에서 `Kyle`/`Teddy` 하드코딩이 제거되고 `Eric`이 추가됐다. **실거래 판별에 이 목록을 쓴다면 반드시 위 6명 기준으로 하라** — 옛 목록을 쓰면 `Eric`이 "시드에 없는 직원"으로 잡혀 데모 데이터를 실거래로 오판한다.

판별 절차:
1. Firestore `accounts` 컬렉션에서 위 목록에 없는 계좌 코드가 있는지 확인
2. `games` 컬렉션에 실제 게임 기록이 있는지 확인
3. `ledger` 문서 수가 시드 생성분을 초과하는지 확인

> **⚠ 초판의 2번 절차는 더 이상 쓸 수 없다.** "`id`가 `ldg_seed_`로 시작하지 않는 문서를 찾아라"는 절차였는데, Track A에서 원장 ID가 `crypto.randomUUID()`로 바뀌어 **접두사 규약 자체가 사라졌다**. 신규 문서와 시드 문서를 ID 형태로 구분할 수 없다. 대신 `createdAt` 필드 유무로 시대 구분은 가능하다(아래 M9 참조).

> 위 셋 다 없으면 데모다. **이 확인을 먼저 하라.** 결과에 따라 이후 4~6주 분량의 작업이 없어질 수 있다.

---

## 2. 이관을 어렵게 만드는 것들

실거래라면 **있는 그대로 옮길 수 없다.** 현행 데이터에 다음 문제가 있다.

| # | 문제 | 근거 | 결과 |
|---|---|---|---|
| M1 | 원장 금액 필드명이 셋 다 다름 | `inn`/`out` · `amt` · `amount` | 정규화 필요 |
| M2 | 롤링 `memo` 모호성 | 빈 문자열 = `'rolling'` | `source` 판정 불가 건 발생 |
| M3 | 시각이 클라이언트 벽시계 | `phNow()` (`index.html:4156`) | 영업일 재계산 불가 |
| M4 | 금액이 부동소수점 | 전역 | 정수 변환 시 반올림 정책 필요 |
| M5 | 중복 거래 가능성 | 호출 시점 생성 ID | 앱 재시도로 중복 원장 생성됐을 수 있음 |
| M6 | 반쪽 거래 가능성 | `toastTransferHalfFailed` 경로 존재 | 미러 누락 건이 있을 수 있음 |
| M7 | 게임 취소가 삭제 | `deleteGameDoc` | 취소된 게임의 이력이 없음 |
| M8 | 로컬/클라우드 이중 경로 | `if(fbDb)` 분기 전반 | 로컬에만 있는 데이터 존재 가능 |
| **M9** | **데이터가 두 시대로 갈린다** | Track A 듀얼라이트 배포 시점 | **한 컬렉션 안에 성질이 다른 두 종류의 문서가 섞여 있다** |
| **M10** | **파생 컬렉션이 존재한다** | `balanceTotals` · `games.rolling` | 원장과 함께 이관하면 **이중 계상** |
| **M11** | **계좌 마스터가 Firestore에 없다** | `db.collection('accounts')` 호출 0건 | **Firestore 덤프만으로는 계좌 신원을 복원할 수 없다** |

**M6과 M11이 특히 위험하다.** 반쪽 거래가 남아 있으면 복식부기 스키마에 넣는 순간 분개 합이 0이 아니게 되고, 첫 대사에서 항등식이 깨진다. M11은 그보다 앞선 문제다 — 분개를 세울 계정 자체가 존재하지 않는다.

### 2-1. M9 — 듀얼라이트 경계 (2026-08-14 신설)

Track A가 `ledger` · `mainCageLedger` · `rollingEvents` · `shiftEvents` 쓰기에 `createdAt`(서버 시각) · `clientCreatedAt` · `deviceId`를 추가했다. 따라서 **배포 시점을 경계로 문서의 성질이 다르다**:

| | 듀얼라이트 **이전** 문서 | 듀얼라이트 **이후** 문서 |
|---|---|---|
| 시각 | `dt` 클라이언트 문자열뿐 | `dt` + **서버 `createdAt`** |
| 단말 추적 | 없음 | `deviceId` 존재 |
| 문서 ID | `'ldg_'+Date.now()+Math.random()` | `crypto.randomUUID()` |

**이관에 주는 영향은 양면이다.**

- **좋은 쪽:** 이후 문서는 신뢰할 수 있는 서버 시각을 갖는다. 감사 단계에서 영업일 귀속을 실제로 재계산할 수 있고, `createdAt` 존재 여부가 곧 시대 구분자로 쓰인다.
- **나쁜 쪽:** **한 컬렉션 안에서 두 규칙을 동시에 다뤄야 한다.** 감사 스크립트가 `createdAt`을 무조건 신뢰하면 이전 문서 전부를 누락하고, `dt`만 신뢰하면 이후 문서의 더 나은 정보를 버린다. **둘 다 읽고, 어느 쪽을 썼는지 감사 보고서에 건별로 기록하라.**

M3은 따라서 "전부 재계산 불가"가 아니라 **"경계 이전만 재계산 불가"** 로 좁혀졌다. 경계 시점(듀얼라이트 실제 배포 일시)을 확정해 감사 보고서에 명시해야 한다.

### 2-2. M10 — 파생 컬렉션을 이관하지 마라 (2026-08-14 신설)

`balanceTotals`(`acct_*` · `maincage_*` · `shift_*` · `member_*`)와 `games.rolling` 필드는 **원장에서 계산된 파생값**이지 독립적인 사실이 아니다.

```
❌ 하지 않는 것
   balanceTotals 를 계정 잔액의 근거로 삼는다
   → 원장 합산과 balanceTotals 를 둘 다 개시 분개에 넣으면 이중 계상

✅ 하는 것
   원장 컬렉션만 진실로 취급한다 (append-only 이므로 변형된 적이 없다)
   balanceTotals 는 감사 단계의 대조 상대로만 쓴다 — 아래 3-1절 3단계
```

`archive.firestore_snapshot`에는 원본 보존 원칙에 따라 **덤프하되**, 개시 잔액 계산에는 절대 쓰지 않는다.

### 2-3. M11 — 계좌 마스터가 Firestore에 없다 (2026-08-14 신설)

**케이지 계좌(`accounts`)는 Firestore 컬렉션이 아니다.** 각 운영자 브라우저의 `localStorage`에만 있다.

| 확인 | 결과 |
|---|---|
| `db.collection('accounts')` 호출 | 저장소 전체 **0건** |
| `'accounts'` 문자열이 컬렉션 이름으로 쓰인 곳 | 없음 |
| 실시간 구독 8채널(15절) | `accounts` 없음 |
| 실제 생성 위치 | `seedDB()` `index.html:5706-5720` → `localStorage` |

`DB.accounts[accountId]`가 담고 있는 것:

```
member(회원명) · engName · phone · rate(요율) · telegram · telegramLinks[]
currency · openedCasino(개설지점) · openedDt · remark · isMain
passportPhoto · sitePhoto · signaturePhoto        ← KYC 이미지
balance | balances{HANN,NUSTAR,ONLINE}            ← 파생값. 원장 합산으로 대체됨
```

**`ledger`는 Firestore에 있는데 그 항목이 가리키는 계좌의 신원 정보는 브라우저에만 있다.**

#### 결과

1. **개시 분개를 세울 대상이 없다.** [3-1절](#3-1-단계)의 감사 단계는 원장을 `accountId`별로 합산해 잔액을 낸다. 그 `accountId`가 어떤 손님인지, 어느 통화인지, 어느 지점에서 개설했는지가 `localStorage`에만 있으므로 `ledger.parties` · `ledger.accounts` 행을 만들 수 없다.
2. **단말마다 계좌 목록이 다를 수 있다.** `localStorage`는 단말 로컬이고 동기화 경로가 없다. A 단말에서 개설한 계좌는 B 단말에 존재하지 않는다. **어느 단말이 정본인지 판별할 근거가 데이터 안에 없다.**
3. **`isMain` 판별이 사라진다.** 손님 계좌와 지점 하우스 계좌를 가르는 것은 `accounts[id].isMain`뿐이다([1절](01-current-system.md) §3). 이것 없이는 원장 항목만 보고 `member_deposit`인지 `house_cash`인지 결정할 수 없다. ID 규약(`MAIN-{branch}`)이 유일한 대체 단서다.
4. **KYC 이미지가 이관 대상에서 누락된다.** 여권·현장·서명 사본이 `localStorage`에 base64로 들어 있다. 용량 한도(보통 5~10MB)를 고려하면 실제로 얼마나 저장돼 있는지도 단말마다 다르다.
5. **선행 문서가 이 사실과 어긋난다.** [`docs/FIRESTORE_DATA_MODEL.md`](../FIRESTORE_DATA_MODEL.md)는 `accounts`를 Firestore 컬렉션으로 서술한다("`accounts` — KYC/회원 정보만"). **설계 의도였고 구현되지 않았다.** 그 문서만 읽고 이관 스크립트를 짜면 존재하지 않는 컬렉션을 덤프하려 한다.

#### 이관 전 필수 작업

**M0 선행 조건으로 올린다.** 원장 이관을 시작하기 전에 끝나야 한다.

```
1. 운영자 단말 전수 파악
   케이지 어드민을 로그인해 쓴 적이 있는 모든 브라우저 프로필

2. 단말별 localStorage 계좌 목록 수집
   각 단말에서 내보내고, 단말 식별자와 수집 시각을 함께 남긴다

3. 병합과 충돌 판정
   같은 accountId가 단말마다 다른 값을 가지면 자동 병합하지 않는다.
   충돌 목록을 만들어 운영 책임자가 건별로 확정한다

4. 원장과 대조
   ledger 에 등장하는 accountId 전체가 병합 결과에 있는지 확인.
   없는 ID = 계좌 마스터가 유실된 계좌. 이관 중단 사유다
```

> **수집 방법 자체는 이 문서의 범위 밖이다.** 내보내기 스크립트를 만들지, 운영자가 수동으로 옮길지는 이관 실행 시점의 운영 결정이다. 여기서 확정하는 것은 **원장 이관 전에 반드시 끝나야 한다**는 순서뿐이다.

#### M8과의 관계

M8(로컬/클라우드 이중 경로)은 "일부 데이터가 로컬에만 있을 수 있다"는 가능성이다. **M11은 가능성이 아니라 확정 사실이다** — 계좌 마스터는 처음부터 끝까지 로컬에만 있다. 클라우드 경로가 아예 구현되지 않았다.

---

## 3. 이관 전략 — 기초 잔액 개시

**과거 원장을 재해석해 옮기지 않는다.**

```
❌ 하지 않는 것
   Firestore ledger 문서 하나하나를 entries 로 변환
   → M2·M3·M5·M6 때문에 분개 합이 맞지 않는다
   → 맞추려면 과거 데이터를 "고쳐야" 하는데, 그건 조작이다

✅ 하는 것
   1. 감사로 시점 잔액을 확정한다
   2. 확정 잔액을 opening_balance 거래 한 건으로 새 원장에 세운다
   3. 과거 이력은 별도 아카이브 테이블에 원본 그대로 보관한다
```

### 3-1. 단계

```
1단계  동결
       현행 시스템의 자금 조작을 중단한다. 읽기만 허용

2단계  추출
       Firestore 전 컬렉션을 원본 JSON 그대로 덤프
       → archive.firestore_snapshot (JSONB, 무손실)

3단계  감사
       계좌별 잔액 계산 (inn − out 합산)
       중복 후보 탐지 (같은 계좌·금액·1분 이내)
       반쪽 거래 탐지 (MAIN 미러가 없는 손님 거래)
       게임별 chips_outstanding 이 0이 아닌 진행 중 게임 목록
       balanceTotals 와 원장 재합산의 불일치 대조 (M10)
       → 사람이 검토하고 서명한다

4단계  확정
       감사 결과를 운영 책임자가 승인한다
       이 시점의 계좌별 잔액이 "확정 개시 잔액"

5단계  개시
       ledger.op_load_opening_balance() 1회 호출로
       전 계정 잔액을 세운다 (균형 계정: opening_equity)
       ※ 실행 주체 · 권한 요건은 아래 3-1 참조

6단계  진행 중 게임 이관
       status='ongoing' 게임은 chips_outstanding 계정을 만들고
       현재 미회수 칩 잔액을 개시 분개에 포함한다

7단계  검증
       R1·R2 대사 통과 확인
       계좌별 표시 잔액이 감사 확정값과 일치하는지 전수 대조

8단계  전환
       신규 시스템 가동. 현행 시스템 읽기 전용으로 보존
```

> **[Track A] 3단계 도구는 이미 만들어져 있다. 새로 쓰지 마라.**
>
> | 도구 | 하는 일 | 감사 단계에서의 용도 |
> |---|---|---|
> | `functions/balance/backfillBalances.js` | 전 컬렉션 스캔 후 계좌·지점·게임·시프트·회원별 합산값 산출 | **계좌별 잔액 계산** 그 자체. `--commit` 없이 실행하면 계산만 하고 쓰지 않는다 |
> | `functions/balance/reconcile.js` | 저장된 유지 잔액과 원장 재합산을 비교해 불일치 보고 | **M10 대조** 및 백필 스크립트 자체의 버그 검출 |
> | `functions/test/backfillBalances.test.js` | 합산 산식을 앱의 `subscribeLedgerCloud` / `deriveMainCageForBranch` / `buildGameFromCache` / `deriveShiftTotalsForBranch` / `getPlayerBalance`와 나란히 고정 | **감사 산식이 앱과 어긋나지 않음을 증명** |
>
> 마지막 항목이 중요하다. 감사가 앱과 **다른 방식으로** 잔액을 계산하면, 나온 차이가 실제 결함인지 산식 드리프트인지 구분할 수 없다. 이 테스트가 그 구분을 미리 해결해 둔다.
>
> 이 도구들은 Admin SDK 기반이며 사람이 로컬에서 수동 실행한다. 상세는 [`docs/BALANCE_ARCHITECTURE_DESIGN.md`](../BALANCE_ARCHITECTURE_DESIGN.md) 2절.

### 3-1. 개시 잔액 적재 — 실행 주체와 권한

5단계를 실행할 함수가 **없었다.** [design-review-3.md `DR-38`](design-review-3.md) — `003`이 `OPENING-EQUITY` 주체와 계정을 부트스트랩에서 만들어 두고 이 문서 전체가 그 계정에 개시 잔액을 싣는 것을 전제로 서 있었는데, `opening_balance` 분개를 발행할 `op_*` 함수가 없었다. [ADR-013](08-adr.md)이 `post_transaction()`을 앱에 노출하지 않기로 했으므로 op 함수가 없는 자금은 기록할 경로 자체가 없다. **이관 계획이 실행 불가능한 상태였다.**

`ledger.op_load_opening_balance()`([`011`](../../db/schema/011_operations_admin.sql))가 그 경로다.

| 항목 | 값 |
|---|---|
| DB 역할 | `ledger_migrator` — **`ledger_app`에는 부여하지 않는다** |
| RBAC 역할 | `migrator` (`identity.roles`) + 권한 `ledger.opening_balance` |
| 인증 방식 | `system` (`transactions.auth_method`에 그대로 기록된다) |
| 호출 횟수 | 지점당 1회. 멱등키가 재실행을 막는다 |
| 균형 | `opening_equity` 행은 함수가 자동으로 만든다. 호출자가 넣지 않는다 |

**`p_balances` 형식.** 계정을 **`account_id` 로 지목한다.** 코드·종류가 아니다.

```sql
SELECT ledger.op_load_opening_balance(
  'opening:HANN:2026-09-01',            -- 멱등키
  :migrator_staff_id, :device_id, 'HANN',
  (SELECT jsonb_agg(jsonb_build_object(
            'account_id',   a.id,
            'amount_minor', v.amount_minor))
     FROM confirmed_opening_balances v                  -- 4단계 산출물
     JOIN ledger.accounts a ON a.id = v.account_id),
  '2026-09-01 컷오버 개시 잔액');
```

`opening_equity` 행은 넣지 않는다 — 합계의 반대 부호로 함수가 만든다.

> 키 이름을 틀리면 `account_id` 가 NULL 이 되고, 오류는 `post_transaction()`
> 안쪽에서 `account <NULL> has no balance row` 로 나온다. 원인을 가리키지 않는
> 메시지다. **호출 전에 `jsonb_agg` 결과를 눈으로 확인한다.**

**앱에 열지 않는 이유.** 이 함수는 임의 금액을 무에서 만든다. 상시 접속하는 애플리케이션 자격증명이 이것을 가지면 그 자체가 화폐 발행 API다. 컷오버 기간에만 쓰는 역할로 격리하고, 끝나면 회수한다.

**컷오버 담당자에게 필요한 것 셋.** DB 역할 `ledger_migrator`, RBAC 역할 `migrator`, 그리고 세 지점 전부에 대한 `identity.staff_branches` 행 — `assert_actor_authorized()`가 지점 소속을 검사하기 때문이다. 셋 중 하나라도 없으면 5단계에서 막힌다.

> 컷오버 종료 후 `migrator` 역할 배정을 회수하고 `ledger_migrator` 자격증명을 폐기한다. §9 체크리스트에 항목이 있다.

### 3-2. 병행 운영 금지

**두 원장이 동시에 살아 있는 기간을 만들지 않는다.** 이중 기록·누락·정합성 확인 불가가 동시에 발생하는 가장 위험한 구간이다.

전환은 영업 중단 시간(컷오프 직후)에 한 번에 한다.

### 3-3. 롤백

7단계 검증 실패 시 현행 시스템을 다시 쓰기 가능 상태로 되돌린다. 신규 DB는 폐기하고 원인 수정 후 재시도한다. **부분 전환은 하지 않는다.**

---

## 4. 반올림 정책 (M4)

부동소수점 → 정수 변환 규칙을 명시한다.

```
amount_minor = ROUND(amount × 10^scale)      -- PHP: scale = 2

예: 1234567.891  →  123456789 (센타보)
```

**전 계좌 변환 후 반드시 확인:**
```
Σ(변환 전 잔액 × 100)  vs  Σ(변환 후 amount_minor)
차이가 있으면 반올림 잔차다. 크기를 기록하고 opening_equity 로 흡수한다
```

차액을 조용히 흡수하지 않는다. **감사 보고서에 명시한다.**

---

## 5. 롤링 `source` 판정 (M2)

현행 `memo` 값에서 `source`를 결정한다.

| `memo` | `source` | `counts_toward_branch_total` |
|---|---|---|
| `'rolling'` | `manual` | `true` |
| `'buy-in'` | `buyin` | `false` |
| `'working-chip'` | `working_chip` | `false` |
| `'mid-settle'` | `mid_settle` | `false` |
| `'game-end'` | `game_end` | `false` |
| `'month-settle-reset'` | `month_reset` | `false` |
| `''` (빈 문자열) | **판정 불가** | — |

**빈 `memo`는 자동 변환하지 않는다.** 현행 코드는 이를 `manual`과 동일 취급하지만(`index.html:4555`), 실제로는 구버전 데이터일 뿐 의미가 확인되지 않았다. 별도 검토 큐로 보내 사람이 판정한다.

> 개시 잔액 방식을 쓰면 이 문제의 영향 범위가 좁아진다. 롤링 이력은 아카이브에 보존되고, 신규 원장의 롤링 누계는 개시 시점부터 새로 쌓인다. **누계 연속성이 필요한지는 사업 결정이다.**

---

## 6. 아카이브

```sql
CREATE SCHEMA archive;

CREATE TABLE archive.firestore_snapshot (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection      TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  data            JSONB NOT NULL,        -- 원본 그대로. 변환하지 않음
  snapshot_at     TIMESTAMPTZ NOT NULL,
  UNIQUE (collection, document_id)
);

CREATE TABLE archive.migration_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_code   TEXT NOT NULL,
  legacy_balance NUMERIC NOT NULL,       -- 감사 시점 계산값 (부동소수 원본)
  opening_minor  BIGINT NOT NULL,        -- 확정 개시 잔액 (정수)
  rounding_delta BIGINT NOT NULL,        -- 반올림 잔차
  anomalies      JSONB,                  -- 중복 후보 · 반쪽 거래 등
  approved_by    TEXT NOT NULL,
  approved_at    TIMESTAMPTZ NOT NULL
);
```

**아카이브는 조회 전용이며 신규 원장과 연결되지 않는다.** 분쟁 발생 시 근거 자료로만 쓴다.

---

## 7. 전체 일정

각 단계는 앞 단계 없이 성립하지 않는다.

```
M0  기반 확정                                          [선행 조건]
    ├── 실거래 여부 판별 (1절)
    ├── 미확정 4항목 결정 (08-adr.md 말미)
    ├── 듀얼라이트 배포 일시 확정 (M9 경계 시점)
    ├── 계좌 마스터 수집·병합·대조 완료 (M11)   ← 원장 이관의 선행 조건
    ├── 원장 DDL 확정 + 불변식 제약 (ddl/)
    ├── 분개 정의표 확정 (04-posting-rules.md)
    └── CI: 원장 재생 테스트 · 대사 쿼리

M1  Ledger + Identity                                  [핵심]
    ├── post_transaction() · 역분개 · 멱등 · 해시 체인
    ├── 인증 (Argon2id · TOTP · 세션) · RBAC
    ├── 4-eyes 승인 엔진
    └── 골든 테스트: 04번 문서 전 연산의 분개 검증

M2  Cage API
    ├── 계좌 명령 4종 (입금 · 출금 · 이체 · 지점이체)
    ├── 게임 명령 6종 (시작 · 바이인 · 롤링 · 중간정산 · 종료 · 취소)
    ├── 케이지 운영 (메인케이지 · 실사 · 기간)
    └── Outbox + Realtime Gateway

M3  Player & Game                                      [설계 보류 중]
    ├── 테이블 워커 · 라운드 권위 · commit-reveal RNG
    └── 회원 자금을 통합 원장으로

M4  정산 · 리포팅
    ├── 컷오프 · 월정산 (기간 마감)
    ├── 롤링 커미션 (요율 규칙 확정 후)
    └── 리포트 · PDF

M5  경화
    ├── 부하 테스트 · 장애 주입
    ├── 침투 테스트
    ├── 백업 복구 리허설
    └── 마이그레이션 리허설 (실데이터 사본으로 전 과정 예행)

M6  전환
    └── 3-1절 8단계
```

> **골든 테스트를 M1에 두는 이유:** 정산·요율 케이스를 기획이 먼저 스냅샷으로 고정해야 이후 리팩터링이 안전하다. 나중에 만들면 이미 있는 버그를 정답으로 굳힌다.

> **[Track A] M0의 CI 항목은 절반 선행돼 있다.** 저장소에 이미 CI 게이트가 있다 — `npm run lint`(ESLint)와 `npm test --prefix functions`(plain `node --test`)가 push마다 돈다. **원장 재생 테스트와 대사 쿼리는 아직 없다.**
>
> 주의할 점 하나: Firestore 에뮬레이터가 필요한 테스트(`test/balance-emulator.test.js`, `test/dual-write-compat.test.js`)는 **의도적으로 CI에 연결돼 있지 않다** — 에뮬레이터 없는 기존 잡을 깨지 않기 위해 저장소 루트의 별도 `test/` 디렉터리로 분리됐다. 신규 시스템의 원장 재생 테스트는 실제 DB를 필요로 하므로, **CI에 DB를 붙이는 문제를 M0에서 함께 풀어야 한다.**
>
> 또한 Track A에서 **배포 트리거 경로 필터 누락으로 `firestore.rules` 변경이 배포되지 않던 인시던트**가 있었다. 신규 시스템의 배포 파이프라인 설계 시 같은 함정을 반복하지 마라 — 경로 필터는 조용히 실패하며, 배포된 줄 알았던 보안 변경이 실제로는 반영되지 않는다.

---

## 8. 프런트엔드 트랙

백엔드와 병렬로 진행하되 **M0의 API 계약 확정 이후** 착수한다.

```
F0  API 계약 기반 타입 생성 · 목 서버
F1  디자인 시스템 + 공통 프레임 (그리드 · 폼 · 권한 · 지점 전환)
F2  케이지 화면 (현행 index.html 기능 전수)
F3  파트너 콘솔
F4  플레이어 화면 (Avatar · Speed)                     [설계 보류 중]
```

현행 화면을 **기능 스펙으로 참조**한다. `shared/i18n.js` 다국어 사전은 그대로 이식한다.

> **M3와 F4는 설계를 보류한다 (2026-08-14).** 아바타/스피드 플레이어 사이트의 개선 작업이 현재
> 진행 중이며 라운드·베팅 구조가 바뀔 여지가 있다. 지금의 `rounds` · `avatarRequests` 구조를
> 목표 스키마로 옮기면 확정 전 설계를 옮기는 것이 되어 폐기 작업이 된다.
>
> **보류 중인 산출물**: `game` 스키마 설계(`09-player-game-domain.md`) · `ddl/014_game.sql` ·
> `ddl/015_operations_player.sql` · [05-api-contract.md](05-api-contract.md)의 플레이어 명령 API.
> 현행 구조의 사실 기록은 [`docs/avatar-speed/`](../avatar-speed/README.md)에 있으며, 아바타
> 개선이 확정되면 그 문서가 갱신된 뒤 설계를 착수한다.
>
> **보류가 막지 않는 것**: M0~M2의 케이지·원장·인증 트랙과 파트너 주체 설계는 아바타 변경과
> 무관하므로 그대로 진행한다. 커버리지 현황은 [00-system-map.md](00-system-map.md) §6.

---

## 9. 전환 전 필수 확인

- [ ] 실데이터 여부 판별 완료 (1절 — **갱신된 6명 시드 목록 기준**)
- [ ] 듀얼라이트 배포 일시 확정 및 감사 보고서 명시 (M9 경계)
- [ ] `balanceTotals` · `games.rolling`을 개시 잔액 산정에서 제외했음을 확인 (M10)
- [ ] **운영자 단말 전수의 계좌 마스터 수집·병합 완료 (M11)**
- [ ] **`ledger`의 모든 `accountId`가 병합 결과에 존재함을 확인 (M11) — 하나라도 없으면 중단**
- [ ] **계좌 마스터 단말 간 충돌 목록에 운영 책임자 확정 서명 (M11)**
- [ ] 감사 보고서에 운영 책임자 서명
- [ ] 반올림 잔차 규모 기록 및 승인
- [ ] 롤링 판정 불가 건 처리 방침 확정
- [ ] 진행 중 게임 목록 확정 및 개시 분개 반영
- [ ] R1 · R2 대사 통과
- [ ] **R8 앵커 대조 통과 + 외부 서명 검증 1회 성공** (`DR-26`)
- [ ] **`SELECT * FROM ledger.v_check_view_security` 0행** — 정의자 뷰가 남아 있으면 RLS가 우회된다 (`DR-24`)
- [ ] **`SELECT branch FROM ledger.branch_config WHERE approval_threshold_minor IS NULL` 0행** + 임계 금액에 운영 책임자 확정 (`DR-39` — 시드는 잠정값이다)
- [ ] **`audit_reader`로 `audit.access_log` 조회 성공, `ledger_app`으로는 `permission denied`** (`DR-25`)
- [ ] **`ledger_app`으로 `INSERT INTO audit.chain_anchors` 시도 → `permission denied`** (`DR-26`)
- [ ] 계좌별 표시 잔액 전수 대조 완료
- [ ] 마이그레이션 리허설 1회 이상 성공
- [ ] 롤백 절차 문서화 및 담당자 지정
- [ ] 현행 시스템 읽기 전용 보존 계획 확정
- [ ] **컷오버 종료 후 `migrator` RBAC 역할 배정 회수 + `ledger_migrator` 자격증명 폐기** (§3-1)

---

**이전:** [06. 보안 아키텍처](06-security.md) · **다음:** [08. 설계 결정 기록](08-adr.md)
