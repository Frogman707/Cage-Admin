# 03. 원장 모델

이 문서가 시스템의 심장이다. 여기가 틀리면 나머지는 의미가 없다.

---

## 1. 출발점 — 현행 모델은 이미 옳다

`applyAccountTransaction()`은 손님 계좌에 기록할 때마다 `MAIN-{branch}`에 반대 방향 동일 금액을 기록한다 (`index.html:6463-6467`). 코드 주석이 이를 "double-entry mirror"라고 명시한다 (`index.html:4585-4586`).

**따라서 이 설계는 새 회계 모델을 도입하는 것이 아니라, 이미 지키고 있는 규율을 데이터베이스가 강제하게 만드는 것이다.**

바뀌는 것은 세 가지다.

1. 두 번의 순차 write → **한 트랜잭션 안의 두 분개**
2. 애플리케이션의 선의 → **DB 제약**
3. 두 계정만 다루는 이항 미러 → **N개 계정을 다루는 일반 분개** (정산이 4~7개 계정에 걸친다)

---

## 2. 세 가지 핵심 객체

```
accounts        원장 계정 — 잔액을 갖는 주체
transactions    거래 — 하나의 자금 사건. 항상 2개 이상의 분개를 가진다
entries         분개 — 하나의 계정에 대한 하나의 증감. 거래 단위로 합이 0
```

이 3객체 구조는 복식부기 시스템의 표준 형태다.

---

## 3. 부호 규약

### 3-1. 저장 규약

**`entries.amount_minor` = 부호 있는 정수. 차변(debit) 양수, 대변(credit) 음수.**

```
거래 하나의 통화별 SUM(amount_minor) = 0     ← 항상. 예외 없음
```

### 3-2. 표시 규약

계정마다 `normal_balance`를 갖는다. 화면 표시 잔액은 이것으로 부호를 맞춘다.

| `normal_balance` | 성격 | 저장 잔액 | 표시 잔액 | 하한 |
|---|---|---|---|---|
| `debit` | 자산 (현금, 마커 미수금) | 양수 | `balance_minor` | `≥ 0` |
| `credit` | 부채 (손님 예치금, 미상환 칩, 팁) | 음수 | `-balance_minor` | `≤ 0` |

### 3-3. 왜 손님 예치금이 부채인가

케이지 입장에서 손님이 맡긴 돈은 **언제든 돌려줘야 할 채무**다. 회계적으로 부채다.

이 규약을 쓰면 현행 코드의 미러링과 정확히 일치한다:

```
손님 입금 500,000 (PHP, 센타보 단위 50,000,000)

  house_cash[HANN]     +50,000,000    차변   자산 증가 (현금 유입)
  member[SE7419]       −50,000,000    대변   부채 증가 (갚을 돈 증가)
  ─────────────────────────────────────────
  합계                           0    ✓

  화면 표시: 손님 잔액 = −(−50,000,000) = 500,000 ✓
```

현행 코드: 손님 `IN` → `MAIN` `OUT`. **동일하다.**

---

## 4. 계정 종류 — 9개 교대 카운터를 흡수한다

현행의 가장 큰 약점은 9개 `shift` 카운터가 서로 독립적으로 누적되며 **상호 정합성을 검증할 수단이 없다**는 것이다 (`index.html:4935`, [01번 문서 9절](01-current-system.md)).

이를 원장 계정과 재고 원장으로 승격하면 밸런싱이 회계 항등식으로 자동 검증된다. **화면과 기능은 그대로 두고, 9개 카운터를 계정 잔액에서 파생시킨다.**

### 4-1. 계정 종류 정의

| `kind` | `normal_balance` | 의미 | 소유 주체 |
|---|---|---|---|
| `member_deposit` | credit | 손님 예치금 (갚을 돈) | 손님 |
| `house_cash` | debit | 지점 현금 금고 | 지점 |
| `chips_outstanding` | credit | 그 게임에 발행된 미상환 칩 | 게임 |
| `marker_receivable` | debit | 마커 미수금 (받을 돈) | 지점 |
| `tips_dealer` | credit | 딜러 팁 미지급금 | 지점 |
| `tips_house` | credit | 하우스 팁 | 지점 |
| `promo_expense` | debit | 워킹칩 등 프로모션 비용 | 지점 |
| `player_wallet` | credit | 온라인 회원 보유금 (현 `memberLedger`) | 회원 |
| `suspense` | debit | 밸런싱 차액 임시 계정 | 지점 |

> **`suspense` 잔액이 0이 아니면 알람.** 미해소 차액이 남아 있다는 뜻이다.

### 4-2. 칩은 케이지의 부채다

이 관점이 모델 전체를 일관되게 만든다.

- 손님이 들고 있는 칩 = 케이지가 갚아야 할 돈 → `chips_outstanding` (credit)
- 금고에 있는 **미발행** 칩 = 아직 부채가 아니다 → 원장 계정이 아니라 **재고 카운트**

따라서 NN/CC 칩 금고 재고는 별도 append-only 재고 원장으로 분리한다 (`cage.chip_inventory_events`). 자금 원장에 섞지 않는다.

### 4-3. 9개 카운터 매핑

| 현행 `shift` 필드 | 신규 파생 원천 |
|---|---|
| `cashBuyinShift` | `house_cash` 분개 중 `tx_kind = game_buyin` 합계 |
| `buyinRollingShift` | `chips_outstanding` 발행(대변) 합계 중 바이인분 |
| `workingChipRollingShift` | `promo_expense` 순잔액 (발행 − 반환) |
| `nnChipInShift` | `chip_inventory_events(nn, +)` 합계 |
| `nnCashoutShift` | `chip_inventory_events(nn, +)` 중 `cashout` + `house_cash` 감소 |
| `nnMarkerShift` | `marker_receivable` 증가분 중 NN분 |
| `ccChipInShift` | `chip_inventory_events(cc, +)` 합계 |
| `ccMarkerShift` | `marker_receivable` 증가분 중 CC분 |
| `rollingCashShift` | `cage.rolling_events` 중 `counts_toward_branch_total = true` 합계 (**자금 아님**) |

**결과: 9개 독립 카운터가 사라지고, 전부 검증 가능한 원장·재고 원장에서 파생된다.**

---

## 5. 스키마

### 5-1. 계정

```sql
CREATE TABLE ledger.parties (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,          -- 'SE7419' · 'MAIN-HANN' · 'GAME-260810001'
  party_type   ledger.party_type NOT NULL,    -- member | house | game | internal
  home_branch  ledger.branch_code,
  ...
);

CREATE TABLE ledger.accounts (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  party_id       BIGINT NOT NULL REFERENCES ledger.parties,
  kind           ledger.account_kind NOT NULL,
  currency       TEXT NOT NULL REFERENCES ledger.currencies(code),
  normal_balance ledger.normal_balance NOT NULL,   -- debit | credit
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  status         ledger.account_status NOT NULL DEFAULT 'active',
  UNIQUE (party_id, kind, currency)
);
```

**하나의 계정은 하나의 통화만 갖는다.** 손님이 PHP와 USD를 모두 보유하면 계정이 2개다. 통화 혼합은 회계 오류의 주요 원인이며 구조적으로 차단한다.

### 5-2. 거래와 분개

```sql
CREATE TABLE ledger.transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id     UUID NOT NULL DEFAULT uuidv7() UNIQUE,   -- 외부 노출용
  idempotency_key TEXT NOT NULL UNIQUE,
  kind            ledger.tx_kind NOT NULL,
  branch          ledger.branch_code NOT NULL,
  business_date   DATE NOT NULL,                            -- 영업일 (컷오프 기준)
  actor_staff_id  BIGINT REFERENCES identity.staff,
  auth_method     identity.auth_method NOT NULL,            -- pin | totp | withdraw_pw | ...
  device_id       TEXT NOT NULL,
  memo            TEXT,
  reverses_tx_id  BIGINT REFERENCES ledger.transactions,    -- 정정 = 역분개
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  prev_hash       BYTEA NOT NULL,
  hash            BYTEA NOT NULL
);

CREATE TABLE ledger.entries (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES ledger.transactions,
  account_id     BIGINT NOT NULL REFERENCES ledger.accounts,
  currency       TEXT NOT NULL,
  amount_minor   BIGINT NOT NULL CHECK (amount_minor <> 0),
  category       ledger.entry_category NOT NULL
);

CREATE TABLE ledger.account_balances (
  account_id    BIGINT PRIMARY KEY REFERENCES ledger.accounts,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  version       BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

---

## 6. 금액 타입 — `BIGINT` 최소 단위 정수

현행은 JavaScript `number`(IEEE 754 배정밀도)다. 그래서 워킹칩 반환 검증에 허용 오차가 필요하다:

```js
// index.html:7450
if(Math.abs(returnedWorking - (g.workingChip||0)) > 0.001){ ... }
```

### 선택: `BIGINT` 최소 단위 정수

PostgreSQL 공식 위키의 "Don't Do This"는 `money` 타입을 쓰지 말고 `numeric` 또는 정수를 쓰라고 명시한다. 두 후보 중 정수를 택한다.

| 후보 | 장점 | 단점 | 판단 |
|---|---|---|---|
| `NUMERIC` | 임의 정밀도, 소수 표현이 자연스러움 | 정수 대비 연산이 매우 느림, 저장 크기 가변 | 환율·요율 계산에만 사용 |
| **`BIGINT` 최소 단위** | 빠름, 8바이트 고정, 반올림 모호성 없음 | 통화별 소수 자릿수를 애플리케이션이 알아야 함 | **채택** |

```
PHP 500,000.00  →  50000000  (센타보, scale = 2)
범위: ±9,223,372,036,854,775,807 센타보 ≈ ±92,233조 페소
```

통화별 자릿수는 테이블로 관리한다:

```sql
CREATE TABLE ledger.currencies (
  code   TEXT PRIMARY KEY,          -- 'PHP'
  scale  SMALLINT NOT NULL,         -- 2
  symbol TEXT NOT NULL
);
```

**효과:** 워킹칩 반환 검증이 정확한 정수 동등 비교가 된다. 허용 오차 자체가 사라진다.

---

## 7. 불변식과 강제 수단

이 절이 이 문서의 핵심이다. **각 불변식이 어떤 DB 기능으로 강제되는지** 명시한다.

| # | 불변식 | 강제 수단 | 위반 시 |
|---|---|---|---|
| I1 | 거래별·통화별 분개 합 = 0 | **지연 제약 트리거** | 커밋 실패 |
| I2 | 계정 잔액이 하한을 넘지 않음 | **지연 제약 트리거** | 커밋 실패 |
| I3 | 원장은 수정·삭제 불가 | `BEFORE UPDATE OR DELETE` 트리거 + 권한 회수 | 예외 발생 |
| I4 | 같은 멱등키는 거래 1건 | `UNIQUE` 제약 | 중복 삽입 실패 |
| I5 | 시각은 서버 권위 | `DEFAULT clock_timestamp()` + 컬럼 권한 제한 | 앱이 지정 불가 |
| I6 | 동결 기간에 기록 불가 | `BEFORE INSERT` 트리거 | 예외 발생 |
| I7 | 잔액 = 분개 합 | 상시 대사 뷰 + 알람 | 거래 차단 |
| I8 | 이력 변조 탐지 | 해시 체인 | 대사 배치가 탐지 |

### 7-1. I1 — 분개 균형: 왜 지연 제약 트리거인가

분개는 여러 행에 걸쳐 삽입된다. 첫 행이 들어간 시점에는 합이 0이 아니다. 따라서 **커밋 시점에 검사**해야 한다.

PostgreSQL 문서:
> "They can be fired either at the end of the statement causing the triggering event, or at the end of the containing transaction; in the latter case they are said to be *deferred*."
> "Constraint triggers are expected to raise an exception when the constraints they implement are violated."

문서가 명시한 제약:
- `AFTER`만 가능 — "A constraint trigger can only be specified as `AFTER`."
- `FOR EACH ROW`만 가능 — "Constraint triggers can only be specified `FOR EACH ROW`."
- 일반 테이블에만 생성 가능

```sql
CREATE CONSTRAINT TRIGGER entries_balanced
  AFTER INSERT ON ledger.entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_transaction_balanced();
```

### 7-2. I2 — 잔액 하한: `CHECK`를 쓸 수 없다

**중요한 제약:** PostgreSQL에서 `CHECK` 제약은 `DEFERRABLE`이 될 수 없다. `DEFERRABLE`을 받는 것은 `UNIQUE`, `PRIMARY KEY`, `EXCLUDE`, `REFERENCES`뿐이다.

이것이 문제가 되는 이유:

```
게임 종료 정산은 최대 7개 계정에 걸친다.
분개 삽입 순서에 따라 특정 계정이 일시적으로 하한을 넘길 수 있다.
CHECK를 걸면 "삽입 순서에 의존하는 스키마"가 된다 — 취약하다.
```

**해법: 지연 제약 트리거를 쓴다.**

```sql
CREATE CONSTRAINT TRIGGER balances_within_limit
  AFTER INSERT OR UPDATE ON ledger.account_balances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_balance_within_limit();
```

검사 내용:
```
normal_balance = 'debit'  AND allow_negative = false  →  balance_minor >= 0
normal_balance = 'credit' AND allow_negative = false  →  balance_minor <= 0
```

**효과:** 트랜잭션 중간 상태는 자유롭고, 커밋 시점에만 최종 상태를 검사한다. 오버드래프트는 구조적으로 불가능해진다.

### 7-3. 동시성 — 격리 수준과 잠금

PostgreSQL 기본 격리 수준은 **Read Committed**다. 이 수준은 비반복 읽기와 팬텀 읽기를 허용하므로, 잔액 검사에 그대로 의존할 수 없다.

**선택: Read Committed + 명시적 행 잠금.**

```sql
-- post_transaction() 내부
SELECT ... FROM ledger.account_balances
 WHERE account_id = ANY(v_account_ids)
 ORDER BY account_id            -- ← 잠금 순서 고정
   FOR UPDATE;
```

문서:
> "`FOR UPDATE` causes the rows retrieved by the `SELECT` statement to be locked as though for update. This prevents them from being locked, modified or deleted by other transactions until the current transaction ends."

**데드락 회피:** 문서가 명시한 표준 대응을 따른다.
> "The best defense against deadlocks is generally to avoid them by being certain that all applications using a database acquire locks on multiple objects in a consistent order."

따라서 **모든 자금 트랜잭션은 `account_id` 오름차순으로 잠금을 획득한다.** 이 규칙은 `post_transaction()` 함수 안에 강제되어 있으므로 호출자가 위반할 수 없다.

#### Serializable을 쓰지 않는 이유

`SERIALIZABLE`은 직렬화 이상을 전부 막지만, 문서가 명시하듯 재시도 루프가 필수다.
> "Applications using this level must be prepared to retry transactions due to serialization failures."
> "It is important that an environment which uses this technique have a generalized way of handling serialization failures (which always return with an SQLSTATE value of '40001')"

Read Committed + 행 잠금은 잔액 불변식에 필요한 직렬화를 잠금으로 확보하면서 40001 재시도 부담을 피한다. 처리량도 더 낫다. 상세: [08-adr.md](08-adr.md) ADR-004.

### 7-4. I3 — 불변성

두 겹으로 막는다.

```sql
-- 1) 권한: 앱 role은 테이블 DML 권한 자체가 없다
REVOKE ALL ON ledger.entries, ledger.transactions FROM ledger_app;
GRANT EXECUTE ON FUNCTION ledger.post_transaction(...) TO ledger_app;

-- 2) 트리거: 소유자가 실수해도 막힌다
CREATE TRIGGER entries_immutable
  BEFORE UPDATE OR DELETE ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();
```

> **한계 명시:** `session_replication_role = 'replica'`로 세션을 설정하면 트리거가 비활성화된다. 이 설정은 슈퍼유저 전용이며, 운영 접근 통제와 감사로 관리한다. DB 내부에서 완전히 막을 수단은 없다.

**정정은 삭제가 아니라 역분개다.** 원 거래의 모든 분개를 부호 반전해 새 거래로 기록하고 `reverses_tx_id`로 연결한다. 현행 게임 취소는 문서를 삭제하지만(`index.html:4613`), 신규 모델에서는 흔적이 남는다.

### 7-5. I8 — 해시 체인

거래마다 이전 거래의 해시를 포함해 체인을 만든다. 사후 변조 시 체인이 끊어진다.

```
hash = SHA256(prev_hash || id || kind || branch || business_date ||
              recorded_at || 정렬된 분개 목록)
```

**범위: 지점별 체인.** 전역 단일 체인은 모든 거래를 직렬화해 처리량을 죽인다. 지점별로 나누면 지점 내 순서만 보장되며, 케이지 거래량(시간당 수십 건)에는 충분하다.

체인 헤드는 별도 테이블에 두고 `FOR UPDATE`로 잠근다:

```sql
CREATE TABLE ledger.chain_heads (
  branch     ledger.branch_code PRIMARY KEY,
  last_tx_id BIGINT,
  last_hash  BYTEA NOT NULL
);
```

일 단위로 체인 헤드를 외부 저장소에 서명·보관(앵커링)하면 DB 전체가 침해되어도 변조를 탐지할 수 있다.

> **처리량 주의:** 플레이어 베팅처럼 고빈도 거래에 지점 체인을 걸면 병목이 된다. 베팅은 체인 대상에서 제외하고 일 단위 머클 앵커링으로 대체한다. [08-adr.md](08-adr.md) ADR-006.

---

## 8. 영업일과 회계 기간

현행은 클라이언트 시계 문자열이 시간축 전부다 (`phNow()`, `index.html:4153`). 정산일 경계가 모호하고 조작 가능하다.

### 8-1. 두 개의 시각

| 컬럼 | 의미 | 권위 |
|---|---|---|
| `recorded_at TIMESTAMPTZ` | 실제 기록 시각 | **서버** (`clock_timestamp()`) |
| `business_date DATE` | 정산 귀속 영업일 | **서버** (컷오프 규칙으로 계산) |

`business_date`는 `recorded_at`을 `Asia/Manila` 타임존으로 변환한 뒤 컷오프 시각(예: 06:00) 기준으로 결정한다. 고정 오프셋 +8 산술이 아니라 타임존 규칙을 사용한다.

> PostgreSQL 위키 "Don't Do This": `timestamp without time zone` 대신 `timestamptz`를 쓸 것. 이 설계는 모든 시각 컬럼에 `TIMESTAMPTZ`를 쓴다.

### 8-2. 회계 기간 엔티티

현행 `cageConfig`의 `*Baseline` 스칼라 6종(`index.html:4709`)을 기간 엔티티로 대체한다.

```sql
CREATE TABLE ledger.accounting_periods (
  branch        ledger.branch_code NOT NULL,
  business_date DATE NOT NULL,
  status        ledger.period_status NOT NULL DEFAULT 'open',  -- open | frozen | settled
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  frozen_at     TIMESTAMPTZ,
  settled_at    TIMESTAMPTZ,
  closed_by     BIGINT REFERENCES identity.staff,
  PRIMARY KEY (branch, business_date)
);
```

**규칙:**
- 동결된 기간에 속하는 거래 삽입은 트리거가 거부한다 (I6)
- 동결 이후 발견된 오류는 **다음 기간의 `adjustment` 거래**로 흡수한다
- "월정산 리셋"이 데이터 삭제가 아니라 기간 마감이 된다

이로써 현행 월정산의 파괴적 동작(`index.html:8274-8280` — 메인케이지 누계 리셋, 교대 카운터 0으로, 게임 롤링 리셋)이 **비파괴적 기간 전환**으로 바뀐다.

---

## 9. 롤링 — 자금이 아니다

롤링은 턴오버 지표이지 자금이 아니다. **원장에 넣지 않는다.** 별도 테이블로 유지하되, 현행의 `memo` 문자열 관례를 명시 컬럼으로 승격한다.

```sql
CREATE TABLE cage.rolling_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id        BIGINT NOT NULL REFERENCES cage.games,
  amount_minor   BIGINT NOT NULL,              -- 부호 있음 (정정은 음수)
  source         cage.rolling_source NOT NULL, -- buyin | working_chip | manual
                                               -- | mid_settle | game_end | month_reset | correction
  counts_toward_branch_total BOOLEAN NOT NULL, -- source에서 파생하되 명시 저장
  transaction_id BIGINT REFERENCES ledger.transactions,  -- 자금 이동 동반 시 연결
  staff_id       BIGINT NOT NULL REFERENCES identity.staff,
  business_date  DATE NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

### 해소되는 모호성

현행 판정 로직:
```js
// index.html:4553
if(!e.memo || e.memo==='rolling') total += e.amount;
```

**빈 문자열(구버전 데이터)과 명시적 `'rolling'`을 같이 취급한다.** 마이그레이션 시 각 이벤트의 `source`를 확정해야 하며, 판정 불가 건은 별도 검토 큐로 보낸다. [07-migration.md](07-migration.md) 참조.

### 게임별 총액

`cage.games.rolling_total_minor`를 같은 트랜잭션에서 갱신한다(프로젝션). 지점 누계는 인덱스 집계로 구한다.

```sql
-- 지점 롤링 누계
SELECT SUM(r.amount_minor)
  FROM cage.rolling_events r
  JOIN cage.games g ON g.id = r.game_id
 WHERE g.branch = $1 AND r.counts_toward_branch_total;
```

---

## 10. 게임 종료 불변식 — 현행보다 강해진다

현행은 워킹칩 반환을 검증한다 (`index.html:7449-7453`). 신규 모델에서는 더 강한 불변식이 자연스럽게 나온다.

```
게임 종료 시:  chips_outstanding[GAME-x] 잔액 = 0
```

발행한 칩이 전부 회수(계좌 입금·캐시아웃·마커·팁·워킹칩 반환)되었다는 뜻이다. 이 하나가 현행의 워킹칩 검증을 포함하며, **누락된 칩이 있으면 게임을 종료할 수 없다.**

### 윈로스

현행 공식 (`index.html:7463`):
```js
winLoss = (historicalSum + ccSum + nn.deposit + nn.cashout + nn.marker) - (g.buyin||0);
```

신규 모델에서는 원장에서 파생된다:
```
winLoss = chips_outstanding[GAME] 총 차변(회수)
        − chips_outstanding[GAME] 총 대변(발행) 중 워킹칩 제외분
```

**계산식을 코드에 박지 않고 원장 질의로 얻는다.** 정정 거래가 자동 반영된다.

---

## 11. 상시 대사

세 가지를 상시 검증한다. 구현은 [`ddl/013_reconciliation.sql`](../../db/schema/013_reconciliation.sql).

```sql
-- R1. 전역 복식부기 항등식 — 통화별 합이 0이어야 한다
SELECT currency, SUM(amount_minor) FROM ledger.entries
 GROUP BY currency HAVING SUM(amount_minor) <> 0;      -- 결과가 있으면 위반

-- R2. 잔액 프로젝션 대사 — 모든 계정에서 0이어야 한다
SELECT a.id, b.balance_minor - COALESCE(SUM(e.amount_minor), 0) AS variance
  FROM ledger.accounts a
  JOIN ledger.account_balances b ON b.account_id = a.id
  LEFT JOIN ledger.entries e ON e.account_id = a.id
 GROUP BY a.id, b.balance_minor
HAVING b.balance_minor <> COALESCE(SUM(e.amount_minor), 0);

-- R3. 해시 체인 연속성
```

추가로 정기 실시:
- **원장 재생 테스트** — 분개 전량을 재생해 프로젝션과 일치하는지 CI에서 상시 검증
- **실물 대사** — `house_cash` 잔액 vs 실사 현금 카운트. 차액은 명시적 `adjustment` 거래로만 흡수

---

## 12. 현행 대비 요약

| 항목 | 현행 | 신규 |
|---|---|---|
| 회계 모델 | 복식부기 (관례) | 복식부기 (**DB 강제**) |
| 원자성 | 순차 write, 실패 시 토스트 | 단일 트랜잭션 |
| 잔액 하한 | 메모리 변수 검사 | 지연 제약 트리거 + 행 잠금 |
| 금액 | IEEE 754 배정밀도 | `BIGINT` 최소 단위 |
| 정정 | 문서 삭제 | 역분개 |
| 시각 | 클라이언트 문자열 | `TIMESTAMPTZ` + 영업일 |
| 교대 카운터 | 독립 9개, 검증 불가 | 원장·재고 원장에서 파생 |
| 게임 종료 검증 | 워킹칩 반환 + 롤링 ≥ 0 | `chips_outstanding = 0` |
| 정산 기간 | `*Baseline` 스칼라 6개 | 기간 엔티티 + 동결 |
| 변조 탐지 | 없음 | 해시 체인 + 앵커링 |

---

**이전:** [02. 목표 아키텍처](02-target-architecture.md) · **다음:** [04. 분개 정의표](04-posting-rules.md)
