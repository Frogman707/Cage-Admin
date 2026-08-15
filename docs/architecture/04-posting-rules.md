# 04. 분개 정의표 (Posting Rules)

**이 표가 구현 계약이다.** 모든 자금 연산은 여기 정의된 분개만 생성한다.

> **이 표는 주석이 아니라 제약이다.** 각 행이 [`ddl/004_ledger.sql`](../../db/schema/004_ledger.sql)의 `ledger.posting_rules` 테이블에 들어가고, `entries_posting_rule` 트리거가 모든 분개 삽입을 그 표와 대조한다. **표에 없는 `(거래종류, 분개범주, 계정종류, 부호)` 조합은 커밋되지 않는다.** 상세는 18절.
>
> 잔액 합이 0이라는 것만으로는 부족하다. 예를 들어 `member_deposit`을 대변 기록하고 `suspense`를 차변 기록하면 합은 0이지만 돈이 창조된다. 이 표가 그 조합을 존재하지 않게 만든다.

---

## 0. 읽는 법

| 기호 | 의미 |
|---|---|
| `+` | 차변 (debit). `amount_minor` 양수 |
| `−` | 대변 (credit). `amount_minor` 음수 |
| `[X]` | 계정 소유 주체 — `[acct]` 손님 계좌 · `[branch]` 지점 · `[GAME]` 해당 게임 |

**모든 거래는 통화별 분개 합이 0이다.** 예외 없다.

금액은 전부 최소 단위 정수다. 예시는 PHP 기준(`scale = 2`, 센타보):

```
2,000,000.00 PHP  →  amount_minor = 200000000
```

### 계정 종류 요약

| `kind` | `normal_balance` | 표시 잔액 |
|---|---|---|
| `member_deposit` | credit | `−balance_minor` |
| `player_wallet` | credit | `−balance_minor` |
| `chips_outstanding` | credit | `−balance_minor` |
| `tips_dealer` · `tips_house` | credit | `−balance_minor` |
| `house_gaming` | credit | `−balance_minor` |
| `cage_point` | credit | `−balance_minor` |
| `house_cash` | debit | `balance_minor` |
| `marker_receivable` | debit | `balance_minor` |
| `promo_expense` | debit | `balance_minor` |
| `point_liability` | debit | `balance_minor` |
| `suspense` | debit (`allow_negative = true`) | `balance_minor` |

> `cage_point`·`point_liability`는 케이지 포인트 전용이다 (B2 분리 결정 · §13-4). 파트너 측 `player_points`와 **다른 계정 종류**다.
> **`point_liability`는 이름과 달리 차변 계정이다** — 손님 쪽 의무는 `cage_point`(credit)가 지고, 이것은 그 발행분을 받는 하우스 쪽 상대 계정이다.

---

## 1. 입금 — `deposit`

**현행:** `_doProcessIo()` IN 분기 (`index.html:6595`) + `applyAccountTransaction` MAIN 미러 (`:6591`)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `house_cash[branch]` | `+` | D | `deposit_cash` |
| `member_deposit[acct]` | `−` | D | `deposit_cash` |

```
입금 500,000 PHP

  house_cash[HANN]       +50,000,000
  member_deposit[SE7419] −50,000,000
  ─────────────────────────────────
  합계                             0  ✓
  손님 표시 잔액 증가: +500,000
```

**멱등키:** `deposit:{account_code}:{client_request_id}`

---

## 2. 출금 — `withdraw`

**현행:** `_doProcessIo()` OUT 분기 (`index.html:6483-6492`)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `member_deposit[acct]` | `+` | W | `withdraw_cash` |
| `house_cash[branch]` | `−` | W | `withdraw_cash` |

**불변식 작동 지점:** 손님 잔액이 부족하면 `member_deposit` 잔액이 양수가 되어 (credit 계정의 하한 `≤ 0` 위반) **커밋이 실패한다.** 현행의 메모리 변수 사전 검사(`index.html:6606`)는 UX상 즉시 피드백용으로 유지하되, 최종 방어선이 DB로 내려간다.

`house_cash` 잔액이 부족하면(금고에 현금이 없으면) 마찬가지로 커밋이 실패한다. **현행에는 이 검사가 아예 없다.**

> **지점 분산 출금 폐기:** 현행 `withdrawAcrossBranches()`(`index.html:6553`)는 `MAIN` 계좌 전용 이월 차감 로직이다. 신규 모델에서는 `house_cash`가 지점별 독립 계정이고 손님 잔액은 이미 통합되어 있으므로 **이 경로 자체가 불필요하다.**

**멱등키:** `withdraw:{account_code}:{client_request_id}`

---

## 3. 계좌 간 이체 — `transfer`

**현행:** `_doTransfer()` (`index.html:6688`) — `writeLedgerEntry` 2회. MAIN 미러 없음

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `member_deposit[from]` | `+` | T | `transfer_out` |
| `member_deposit[to]` | `−` | T | `transfer_in` |

현금은 움직이지 않는다. `house_cash`에 분개가 생기지 않는다.

**해소되는 실패 모드:** 현행은 두 write 중 두 번째가 실패하면 `toastTransferHalfFailed`를 띄우고 **반쪽 거래를 남긴다** (`index.html:6694`). 단일 트랜잭션에서는 구조적으로 발생하지 않는다.

**멱등키:** `transfer:{from}:{to}:{client_request_id}`

---

## 4. 지점 간 이체 — `branch_transfer`

**현행:** `_doProcessBranchTransfer()` (`index.html:4903`) — 원장 2건 + `branchTransfers` 감사 로그 1건

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `house_cash[to_branch]` | `+` | X | `branch_transfer_in` |
| `house_cash[from_branch]` | `−` | X | `branch_transfer_out` |

별도 감사 로그 테이블은 유지하지 않는다. `transactions.kind = 'branch_transfer'` + 분개 2건이 `fromBranch`/`toBranch`를 이미 표현한다.

> **지점 정합성 검사의 유일한 예외.** `post_transaction()`은 하우스·게임 계정이 거래 지점과 일치할 것을 요구하지만, 지점 간 이체는 정의상 두 지점의 `house_cash`를 함께 움직인다. `kind = 'branch_transfer'`일 때만 이 검사를 면제하고, 대신 **`house_cash` 이외의 계정 종류를 전면 금지**한다. 양쪽 지점에 대한 행위자 권한 확인은 `ledger.op_branch_transfer()`가 한다.
>
> `entries.branch`는 거래 지점이 아니라 **각 분개 계정의 귀속 지점**을 담는다. 받는 쪽 분개가 받는 지점 소속이어야 그 지점 직원이 RLS로 자기 분개를 볼 수 있다.

**멱등키:** `branch_transfer:{from}:{to}:{client_request_id}`

---

## 5. 게임 시작 · 바이인 추가 — `game_buyin`

**현행:** `_doStartGame()` (`index.html:6783-6823`) · `_doAddBuyin()` (`:6747-6782`)

게임 생성 시 `chips_outstanding[GAME-{game_no}]` 계정을 함께 만든다.

### 5-1. `startType = 'account'` (계좌 바이인)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `member_deposit[acct]` | `+` | B | `buyin_account` |
| `chips_outstanding[GAME]` | `−` | B | `chips_issue` |

### 5-2. `startType = 'cash'` (현금 바이인)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `house_cash[branch]` | `+` | B | `buyin_cash` |
| `chips_outstanding[GAME]` | `−` | B | `chips_issue` |

### 5-3. `startType = 'marker'` (마커 바이인)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `marker_receivable[branch]` | `+` | B | `buyin_marker` |
| `chips_outstanding[GAME]` | `−` | B | `chips_issue` |

#### 5-3-1. 마커 발행 — `marker_issue` (바이인과 별개 거래)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `marker_receivable[branch]` | `+` | M | `marker_issue` |
| `member_deposit[member]` | `−` | M | `marker_issue` |

**발행과 사용을 나누는 이유**: 위 5-3은 "발행된 마커로 칩을 산다"이고 이것은 "마커를 발행한다"이다. 둘을 한 거래로 묶으면 **발행 기록 없이 마커 바이인이 성립**하고, 미수금이 언제 어떤 승인으로 생겼는지가 남지 않는다 ([`spec/04`](../spec/04-cage-game-rolling.md) `R-04-21`).

**4-eyes 대상이다.** 마커 발행은 신용 공여이며 금액과 무관하게 두 사람이 필요하다.

**멱등키:** `marker_issue:{member_code}:{client_request_id}`

### 5-4. 워킹칩 발행 (동시 발생 가능)

같은 거래에 추가 분개로 포함한다.

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `promo_expense[branch]` | `+` | W | `working_chip_issue` |
| `chips_outstanding[GAME]` | `−` | W | `chips_issue` |

```
계좌 바이인 2,000,000 + 워킹칩 500,000

  member_deposit[SE7419]       +200,000,000   buyin_account
  chips_outstanding[GAME-...]  −200,000,000   chips_issue
  promo_expense[HANN]           +50,000,000   working_chip_issue
  chips_outstanding[GAME-...]   −50,000,000   chips_issue
  ─────────────────────────────────────────
  합계                                    0  ✓
```

### 5-5. 롤링 시드 (자금 아님)

현행은 바이인과 워킹칩을 게임 롤링에 시드한다 (`seedRollingFromBuyin`, `index.html:6854`). 같은 트랜잭션에서 `cage.rolling_events`에 기록한다.

| `source` | 금액 | `counts_toward_branch_total` |
|---|---|---|
| `buyin` | B | `false` |
| `working_chip` | W | `false` |

**멱등키:** `game_buyin:{game_no}:{seq}` — `seq`는 게임별 바이인 순번. 추가 바이인이 자연스럽게 구분된다.

---

## 6. 롤링 입력 — 자금 이동 없음

**현행:** `confirmRollingInput()` (`index.html:6914-6939`)

**분개 없음.** `ledger.transactions`를 생성하지 않는다.

| 대상 | 값 |
|---|---|
| `cage.rolling_events.source` | `manual` |
| `counts_toward_branch_total` | `true` |
| `amount_minor` | 입력값 (정정은 음수) |

**멱등키:** `rolling:{game_no}:{client_request_id}`

> 현행은 `guestRollingGrandTotal` · `rollingDailyTotal` · `rollingCashShift` 세 개의 누계를 각각 갱신한다 (`index.html:7049`). 신규에서는 전부 `rolling_events` 집계로 파생되므로 별도 카운터가 없다.

---

## 6-1. 롤링 커미션 정산 — `commission_payout`

**현행:** `settleGame()` → `_doSettleGame()` (`index.html:7218-7267`)

롤링 입력(§6)은 자금 이동이 없지만 **그 롤링에 대한 커미션 지급은 실제 자금 이동이다.** 매 정산마다 손님 계좌로 돈이 들어간다. [design-review-6.md `DR-66`](design-review-6.md) — 이 흐름은 `01`·`04`·`05`·DDL 어디에도 없었다.

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `commission_expense[branch]` | `+` | P | `commission_payout` |
| `member_deposit[acct]` | `−` | P | `commission_payout` |

```
롤링 1,000,000 · 요율 1.45% · F&B 차감 5,000

  총커미션 C = 14,500
  F&B      F =  5,000
  순지급   P =  9,500

  commission_expense[HANN]   +950,000
  member_deposit[SE7419]     −950,000
  ─────────────────────────────────────
  합계                              0  ✓
  손님 표시 잔액 증가: +9,500
```

**멱등키:** `commission:{game_no}:{client_request_id}`

### 원장에 들어가는 것과 안 들어가는 것

**원장은 순지급액 P만 본다.** 총커미션 C와 F&B 차감 F는 `cage.commission_settlements`가 보존한다. F&B를 매출로 인식하려면 전용 계정 종류가 필요하고 이번 범위 밖이다 — [README](README.md) 미확정 항목.

`P = 0`이면 **원장 거래를 만들지 않는다.** `entries_amount_nonzero`가 0원 분개를 막는다. 그래도 `commission_settlements` 행은 남는다 — "정산했고 지급액이 0이었다"와 "정산한 적 없다"는 다른 사실이고, 현행은 둘을 구분할 수 없었다.

`F > C`는 거부한다. 현행은 `result <= 0`이 되어 조용히 아무것도 하지 않았고, 초과 차감분의 행방이 어디에도 남지 않았다.

### 요율의 권위

**`games.commission_rate_bp` 스냅샷이다.** 게임 개설 시점의 계좌 요율을 bp(1/100 %)로 고정한다 — `145` = 1.45%. 계좌 요율이 나중에 바뀌어도 이미 시작한 게임의 정산 근거는 흔들리지 않는다.

현행은 요율이 다섯 홉을 거쳤고 그중 셋이 문자열이었다 ([design-review-9.md `DR-84`](design-review-9.md)):

```
accounts.rate "1.45%" → select 옵션 라벨 "Rolling 1.45%" → games.type 문자열
  → 정규식 /([\d.]+)%/ → #settleRolling 프리필 → DOM textContent 되읽기
```

`games.bet_type`(현행 `type`)은 **표시용 라벨로 격하한다.** 이 컬럼을 파싱해 금액을 계산하는 코드는 만들지 않는다. `Share 40%` 프리셋이 롤링 커미션 40%를 프리필하던 사고가 이 파싱에서 나왔다.

운영자가 산출값을 덮어쓸 수 있다(현행 스펙). 덮어쓰면 `commission_settlements.rate_overridden = true`로 남는다 — 덮어썼다는 사실 자체가 감사 대상이다.

### 반복 지급 방지

한 게임에 여러 번 지급할 수 있다. 현행도 진행 중 게임을 반복 정산할 수 있고, 긴 게임에 커미션을 나눠 주는 것은 정상 업무일 수 있다.

**막아야 하는 것은 "두 번"이 아니라 "같은 롤링에 두 번"이다.** `cage.commission_settlements.rolling_base_minor`의 게임별 합이 `games.rolling_total_minor`를 넘지 못한다 (`005`의 `assert_commission_base_available` 트리거). 현행은 종료된 게임에만 재정산 방지가 있었고 진행 중 게임에는 아무 키도 없었다 ([design-review-9.md `DR-85`](design-review-9.md)).

취소된 게임은 지급 대상이 아니다. 잘못 지급한 커미션은 삭제가 아니라 역분개로 되돌린다 ([05 §3-6](05-api-contract.md)).

### U3 확정 — 무엇에 요율을 곱하는가

**관측 롤링 총액 × 요율이다.** 2026-08-15 결정([`00-decisions`](../spec/00-decisions.md) §4). 바이인 대비도 윈로스 대비도 아니다. 요율 변경은 **소급하지 않는다** — 위 스냅샷 규약이 그 결정의 구현이다.

근거 3건이 전부 같은 기준을 쓰고 있었다:

| 출처 | 계산 | 위치 |
|---|---|---|
| 케이지 수동 지급 | 롤링 × 요율 | `_doSettleGame` (`index.html:7224`) |
| 이벤트 커미션 | `Math.round(rolling*rate/100)` | `payEventCommissionForSettle` (`index.html:9062`) |
| 파트너 표시 계산 | `rolling * 0.015` (1.5% 하드코딩) | `partner-admin/app.js` `userList` 파생 컬럼 |

---

## 6-2. 이벤트 보너스 커미션 — `event_commission`

**현행:** 이벤트 기간 중 롤링 커미션 정산이 일어나면 보너스가 자동 지급된다 (`payEventCommissionForSettle`, `index.html:9062`). B1(2026-08-15)이 **계속 운영 + 재구현**으로 확정했다 ([`00-decisions`](../spec/00-decisions.md) §7 · [`spec/06`](../spec/06-event-commission.md)).

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `commission_expense[branch]` | `+` | B | `event_commission` |
| `member_deposit[member]` | `−` | B | `event_commission` |

**§6-1과 분개 모양이 같지만 별개 거래다.** `tx_kind`를 나눈 이유는 리포트가 두 축을 따로 합산해야 하고, 이벤트 보너스만 되돌리는 역분개가 성립해야 하기 때문이다.

**멱등키:** `event_comm:{settlement_id}` — 정산 1건당 1회.

### 연쇄 규약 — 아웃박스 비동기

```
op_settle_commission (트랜잭션 A)
  ├─ 롤링 커미션 분개 확정            ← 이것은 되돌아가지 않는다
  └─ outbox INSERT {topic:'event_commission', settlement_id, ...}
                             ↓  (같은 트랜잭션에서 커밋)
소비자 (트랜잭션 B)
  ├─ 활성 이벤트 조회 (서버 시각 기준)
  ├─ op_pay_event_commission(...)
  └─ 실패 시 bonus_event_payouts.status='failed' + failure_reason + attempt_count++
```

**같은 트랜잭션에 넣지 않는 이유**: 보너스 실패가 정산을 되돌린다. **수동 연산으로 하지 않는 이유**: 현행 UX가 자동 지급이고 그것을 바꾸지 않는다 (`DR-67` 결정 · `AC-67-5`).

### 현행 결함 4건 — 재구현하는 이유

| # | 현행 | 결과 |
|---|---|---|
| 1 | 요율 권위가 DOM — `document.getElementById('eventRate').value` | 화면 값과 저장 값이 갈라지면 **지급액은 화면을 따른다** |
| 2 | `if(!txn) return` | **미지급이 어디에도 안 남아 사후 보전 불가** |
| 3 | `await` 없이 트리거 (`index.html:7259`) | 정산 완료 토스트가 보너스 성패를 모른다 |
| 4 | 기간 판정이 클라이언트 시계 문자열 비교 | **단말 시계를 바꾸면 종료된 이벤트가 되살아난다** |

**목표**: 기간 판정은 서버 시각(`now()`), 요율 권위는 `cage.bonus_events.rate_bp` 저장값(bp 정수), 지급 행이 적용 요율을 스냅샷으로 남긴다.

---

## 7. 중간정산 — `mid_settle`

**현행:** `_doConfirmMidSettle()` (`index.html:7219-7298`)

입력: `cc{deposit, cashout, marker, dealerTips, houseTips}` · `nn{deposit, cashout, marker, working}`

### 7-1. 분개

| # | 계정 | 부호 | 금액 | `category` |
|---|---|---|---|---|
| 1 | `chips_outstanding[GAME]` | `+` | `cc.deposit + nn.deposit` | `chips_redeem` |
| 2 | `member_deposit[acct]` | `−` | `cc.deposit + nn.deposit` | `settle_deposit` |
| 3 | `chips_outstanding[GAME]` | `+` | `cc.cashout + nn.cashout` | `chips_redeem` |
| 4 | `house_cash[branch]` | `−` | `cc.cashout + nn.cashout` | `settle_cashout` |
| 5 | `chips_outstanding[GAME]` | `+` | `cc.marker + nn.marker` | `chips_redeem` |
| 6 | `marker_receivable[branch]` | `−` | `cc.marker + nn.marker` | `settle_marker_redeem` |
| 7 | `chips_outstanding[GAME]` | `+` | `cc.dealerTips` | `chips_redeem` |
| 8 | `tips_dealer[branch]` | `−` | `cc.dealerTips` | `settle_dealer_tip` |
| 9 | `chips_outstanding[GAME]` | `+` | `cc.houseTips` | `chips_redeem` |
| 10 | `tips_house[branch]` | `−` | `cc.houseTips` | `settle_house_tip` |
| 11 | `chips_outstanding[GAME]` | `+` | `nn.working` | `chips_redeem` |
| 12 | `promo_expense[branch]` | `−` | `nn.working` | `working_chip_return` |

> 금액이 0인 항목은 분개를 생성하지 않는다 (`entries.amount_minor <> 0` 제약).

> **구현상의 축약:** 위 12행 중 홀수 행(1·3·5·7·9·11)은 계정과 `category`가 모두 같다 — `chips_outstanding[GAME]` 차변, `chips_redeem`. [`ddl/010_operations_game.sql`](../../db/schema/010_operations_game.sql)의 `cage.op_settle_game()`은 이를 **합계 1행**으로 기록한다. 의미는 동일하고 행 수만 줄어든다. 따라서 실제 분개는 최대 7행(칩 회수 1 + 대변 6)이다.

**해석:**
- 1·2 — 칩을 반납하고 계좌로 입금 → 현행 `applyAccountTransaction(g.account, 'IN', cc.deposit + nn.deposit)` (`index.html:7279`)와 동일
- 3·4 — 칩을 반납하고 현금 수령 → 금고 현금 감소
- 5·6 — 칩으로 마커 상환 → 미수금 감소
- 11·12 — 워킹칩 반환 → 프로모션 비용 취소. **전액 반환 시 이 게임 귀속 `promo_expense`가 0이 된다**

### 7-2. 재고 원장 (자금 아님)

`cage.chip_inventory_events` — 칩이 금고로 돌아온 수량.

| `chip_type` | `delta_minor` |
|---|---|
| `nn` | `nn.deposit + nn.cashout + nn.marker + nn.working` |
| `cc` | `cc.deposit + cc.cashout + cc.marker + cc.dealerTips + cc.houseTips` |

### 7-3. 롤링

**현행 공식 그대로 (`index.html:7237`):**

```
rolling_delta = −(nn.deposit + nn.cashout + nn.marker + nn.working)
```

| `source` | `counts_toward_branch_total` |
|---|---|
| `mid_settle` | `false` |

### 7-4. 정산 이력

`cage.game_settlements`에 `kind = 'mid'`로 1행. 현행 `g.checkpoints` 배열(`index.html:7369`)을 정규 테이블로 승격한 것이다.

**멱등키:** `mid_settle:{game_no}:{seq}`

---

## 8. 게임 종료 — `game_end`

**현행:** `_doConfirmGameEnd()` (`index.html:7437-7515`)

### 8-1. 분개

**중간정산(7절)과 완전히 동일하다.** `category`도 동일하고 `transactions.kind`만 `game_end`다.

### 8-2. 사전 검증

현행 두 검증(`index.html:7449-7453`)은 API 계층에서 즉시 피드백용으로 유지하되, **최종 방어선은 DB 불변식이다.**

| 검증 | 현행 | 신규 |
|---|---|---|
| 워킹칩 전액 반환 | `Math.abs(returned − workingChip) > 0.001` | 이 게임 귀속 `promo_expense` 순액 = 0 |
| 롤링 음수 금지 | `(g.rolling + netNN) < 0` | `cage.games.rolling_total_minor >= 0` CHECK |
| **칩 전량 회수** | **없음** | **`chips_outstanding[GAME]` 잔액 = 0** |

**세 번째가 신규 불변식이다.** 발행한 칩이 전부 회수되지 않으면 게임을 종료할 수 없다. 현행 워킹칩 검증을 포함하며 더 강하다.

```
게임 종료 시점 검사:

  chips_outstanding[GAME-260810001] 잔액 = 0
      ↑ 발행(대변) 합계 = 회수(차변) 합계

  위반 시: 예외. 게임 상태가 'ended'로 전이되지 않는다
```

### 8-3. 윈로스

현행은 계산식을 코드에 박는다 (`index.html:7457-7463`). 신규는 원장에서 파생한다.

```sql
-- 회수 총액 − 발행 총액(워킹칩 제외)
SELECT
  SUM(e.amount_minor) FILTER (WHERE e.category = 'chips_redeem')
+ SUM(e.amount_minor) FILTER (WHERE e.category = 'chips_issue'
                                AND t.kind = 'game_buyin')
  AS win_loss_minor
FROM ledger.entries e
JOIN ledger.transactions t ON t.id = e.transaction_id
WHERE e.account_id = :chips_outstanding_account_id;
```

`cage.games.win_loss_minor`에 종료 시점 스냅샷으로 저장하되, **정정 거래가 들어오면 재계산한다.**

**멱등키:** `game_end:{game_no}`

---

## 9. 게임 취소 — `game_cancel`

**현행:** `cancelGame()` (`index.html:6953`) — 계좌 환불 후 **게임 문서와 롤링 이벤트를 삭제**한다 (`deleteGameDoc`, `:4613`)

**신규: 삭제하지 않는다. 역분개한다.**

```
1. 해당 게임의 모든 자금 거래를 조회 (이미 역분개된 것 제외)
2. 각 거래의 모든 분개를 부호 반전한 새 거래 생성
3. transactions.reverses_tx_id = 원 거래 id  ← 부분 UNIQUE 인덱스가 중복 역분개를 막는다
4. rolling_events 에 source='correction' 으로 상쇄 이벤트 기록
5. cage.games.status = 'cancelled'   ← 반드시 마지막
```

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| (원 분개 전부) | 반전 | 동일 | **원 category 그대로** |

> **역분개는 `category`를 바꾸지 않는다.** 이전 판은 전부 `'reversal'`로 덮었는데, 그러면 `category` 기준 파생 뷰([`ddl/013_reconciliation.sql`](../../db/schema/013_reconciliation.sql)의 교대 카운터·윈로스)가 정정을 반영하지 못한다 — 바이인을 역분개해도 `cash_buyin_shift`가 원래 값 그대로 남는다. 원 `category`를 유지하면 부호가 뒤집힌 같은 범주 분개가 합계에서 자동으로 상쇄된다.
>
> 역분개 여부는 `transactions.kind`(`reversal` · `game_cancel`)와 `reverses_tx_id`로 구분한다.

> **순서가 중요하다.** 롤링 상쇄와 정산 기록은 게임이 `ongoing`일 때만 허용된다(`assert_game_ongoing` 트리거). 상태 전이를 마지막에 두어야 통과한다. 그리고 롤링 상쇄는 `counts_toward_branch_total` 값별로 **나눠서** 기록해야 지점 롤링 누계가 정확히 복구된다.

**결과:** `chips_outstanding[GAME]` 잔액이 0이 되고(`games_chips_settled` 지연 트리거가 커밋 시점에 확인), 손님 계좌·금고·미수금이 원상 복구되며, **모든 흔적이 남는다.**

**멱등키:** `game_cancel:{game_no}`

---

## 10. 메인 케이지 — 자금 원장 아님

**현행:** `writeMainCageEntry()` (`index.html:4742-4749`), 부호 규약 `mainCageSignedEffect()` (`:4695-4697`)

메인 케이지 원장은 카지노(하우스)와의 누계 롤링 정산 지표이며, 현행에서도 계좌 원장과 연결되어 있지 않다. **자금 원장에 편입하지 않고 별도 테이블로 유지한다.**

```sql
CREATE TABLE cage.main_cage_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch        ledger.branch_code NOT NULL,
  kind          cage.main_cage_kind NOT NULL,  -- buyin | rolling_cc | marker | redeem | reset
  amount_minor  BIGINT NOT NULL,               -- 이미 부호가 적용된 값
  staff_id      BIGINT NOT NULL,
  business_date DATE NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

**부호 규약 (현행 유지):** `redeem`은 음수, 나머지는 양수. 현행은 저장 시 원값을 넣고 읽을 때 부호를 적용하지만(`mainCageSignedEffect`), 신규는 **저장 시점에 부호를 확정**한다. 읽는 쪽에서 부호 규칙을 다시 적용할 필요가 없다.

`reset`은 기간 마감으로 대체 가능하지만, 현행 화면이 리셋 이력을 표시하므로 종류를 유지한다.

**멱등키:** `main_cage:{branch}:{client_request_id}`

---

## 11. 밸런싱 차액 조정 — `adjustment`

**현행:** 실사 카운트를 `cageConfig.{cash,nn,cc}BreakdownCounts`에 저장하고, 차액은 `memberCompanyDiffVal` 스칼라에 숫자만 남긴다.

**신규: 차액은 명시적 거래로만 흡수한다.**

### 현금 과잉 (실사 > 시스템, 차액 V)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `house_cash[branch]` | `+` | V | `adjustment` |
| `suspense[branch]` | `−` | V | `adjustment` |

### 현금 부족 (실사 < 시스템, 차액 V)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `suspense[branch]` | `+` | V | `adjustment` |
| `house_cash[branch]` | `−` | V | `adjustment` |

**`suspense` 계정은 `allow_negative = true`다.** 양방향 차액을 담기 때문이다.

> **`suspense` 잔액이 0이 아니면 알람이 울린다.** 원인을 조사해 확정 분개로 해소해야 한다. 차액이 조용히 묻히지 않는다.

**4-eyes 필수.** 실사자와 검증자가 달라야 하며, 임계 금액 초과 시 2인 승인이 필요하다. [06-security.md](06-security.md) 5절.

**멱등키:** `adjustment:{branch}:{business_date}:{count_kind}`

---

## 11-2. 차액 확정 해소 — `suspense_resolve`

위 §11이 말한 **"확정 분개"가 이것이다.** 정의되어 있지 않았다 — [design-review.md `DR-01`](design-review.md).

`adjustment`는 차액을 `suspense`에 옮겨 담을 뿐이고, `suspense`가 등장하는 분개 조합은 `adjustment` 하나뿐이었다. 그래서 `op_adjustment`를 다시 불러도 `house_cash ↔ suspense`를 왕복할 뿐 **차액을 최종 귀착시킬 계정이 없었다.** 결과: 실사 차액이 한 번 발생하면 `op_freeze_period`가 영구히 거부하고 그 지점은 다시 마감되지 않았다.

실사 차액은 예외가 아니라 **실사의 정상 산출물이다.** 차액이 나지 않는다면 실사할 이유가 없다.

### 부족분 확정 (`suspense` 차변 잔액 V > 0)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `shortage_expense[branch]` | `+` | V | `suspense_resolve_in` |
| `suspense[branch]` | `−` | V | `suspense_resolve_out` |

### 과잉분 확정 (`suspense` 대변 잔액 V < 0)

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `suspense[branch]` | `+` | \|V\| | `suspense_resolve_out` |
| `overage_income[branch]` | `−` | \|V\| | `suspense_resolve_in` |

**멱등키:** `suspense_resolve:{branch}:{client_request_id}`

### 규약

- **금액을 호출자가 정하지 않는다.** `ledger.op_resolve_suspense()`가 현재 잔액을 직접 읽어 정한다. 부분 해소는 없고, 호출 후 `suspense` 잔액은 정확히 0이다.
- **조사 결과(`p_resolution`)가 필수다.** NULL·빈 문자열은 거부된다. 차액을 확정 손실·이익으로 넘기는 조작이므로 근거 없이 통과시키지 않는다.
- **금액과 무관하게 항상 4-eyes다.** 임계 검사에 맡기지 않는다.
- **`op_freeze_period`의 `suspense ≠ 0` 거부는 그대로 둔다.** 해소 경로가 생겼으므로 이제 그 제약이 정당하다.

> **탈출구 없는 제약은 우회를 만든다.** 마감이 막힌 상태에서 사람이 하는 일은 정해져 있다 — DBA에게 직접 `UPDATE`를 요청한다. 그 순간 이 문서의 불변식 전체가 무의미해진다.

---

## 12. 케이지 계좌 ↔ 회원 보유금 — `wallet_transfer` (신규 기능)

**현행에는 존재하지 않는다.** 케이지 `accounts`/`ledger`와 플레이어 `members`/`memberLedger`가 완전히 분리되어 있어 이체가 불가능하다.

통합 원장에서는 계정 종류만 다를 뿐이므로 **한 트랜잭션**이 된다.

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `member_deposit[acct]` | `+` | A | `wallet_transfer_out` |
| `player_wallet[member]` | `−` | A | `wallet_transfer_in` |

> **정책 필요:** 어느 방향으로 얼마까지 허용할지, 통화가 다르면 어떻게 할지는 사업 결정이다. 기술적으로는 계정 종류 쌍 화이트리스트로 제한한다.

**멱등키:** `wallet_transfer:{account_code}:{member_code}:{client_request_id}`

---

## 13. 플레이어 베팅 · 페이아웃

**현행:** `shared/game-engine.js`가 클라이언트에서 `memberLedger`에 직접 쓴다.

### 베팅

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `player_wallet[member]` | `+` | B | `bet` |
| `house_gaming[branch]` | `−` | B | `bet` |

### 페이아웃

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `house_gaming[branch]` | `+` | P | `payout` |
| `player_wallet[member]` | `−` | P | `payout` |

**멱등키:** `bet:{round_id}:{member_code}:{bet_type}` — 자연키다. 버튼 재클릭·네트워크 재시도가 진짜로 멱등해진다. 현행은 호출 시점 UUID를 새로 만들어 앱 레벨 재시도가 중복 원장을 만든다.

> **베팅은 해시 체인 대상에서 제외한다.** 고빈도라 지점 체인의 병목이 된다. 일 단위 머클 앵커링으로 대체한다. [08-adr.md](08-adr.md) ADR-006.

> **13절의 나머지(라운드 취소 · 결과 정정 · 팁 · 가입 보너스)는 아직 정의되지 않았다.** 아바타/스피드 개선 작업이 진행 중이라 라운드·베팅 구조가 확정되지 않았기 때문이다 — [00-system-map.md](00-system-map.md) §8 A1·A2. 아래 13-2·13-3은 파트너 콘솔 측이라 그 영향을 받지 않으므로 먼저 확정한다.

---

## 13-2. 포인트 — `point_earn` · `point_convert`

**현행:** `memberLedger`에 `category: 'point_earn'` · `'point_convert'`로 섞여 들어간다. 보유포인트는 그 둘만 골라 합산한 값이다 (`partner-admin/app.js:255`).

**현행의 결함:** 포인트를 보유금으로 전환하면 `point_convert` 음수 한 줄만 남고 **대응하는 보유금 입금 항목이 없다** ([G-05](../avatar-speed/explanation-known-gaps.md#g-05--point_convert에-대응하는-보유금-입금-항목이-없다)). 포인트는 줄고 보유금은 늘지 않는다.

계정을 나누면 이 결함이 스키마 차원에서 불가능해진다.

### 적립

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `promo_expense[branch]` | `+` | P | `point_earn` |
| `player_points[member]` | `−` | P | `point_earn` |

포인트 적립은 하우스의 프로모션 비용이다. 회원에게 진 빚(`player_points`는 credit 계정)이 늘고 비용이 함께 잡힌다.

**멱등키:** `point_earn:{member_code}:{source_ref}` — `source_ref`는 적립 근거(라운드 · 기간 · 수동 지급 ID).

### 전환

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `player_points[member]` | `+` | C | `point_convert_out` |
| `player_wallet[member]` | `−` | C | `point_convert_in` |

**한 트랜잭션의 분개 두 줄이다.** 포인트가 줄고 보유금이 같은 금액 늘어난다. 합이 0이므로 한쪽만 기록하는 것이 불가능하다 — G-05가 재발할 수 없다.

**멱등키:** `point_convert:{member_code}:{client_request_id}`

> **전환 비율은 1:1로 두었다.** 현행에도 비율 개념이 없다. 비율을 도입하면 `point_convert_out`과 `point_convert_in`의 금액이 달라지고 차액을 흡수할 계정(`promo_expense`)이 세 번째 분개로 들어간다. 사업 결정 사항이다.

---

## 13-3. 파트너 쉐어 — `share_accrue` · `share_settle`

**현행:** `shareLedger/{uuid}` `{partnerCode, amount, category:'share_accum', memo, dt}`. **데모 시드에서만 쓰이고**(`partner-admin/app.js:1740`) 실제 적립 코드는 없다. 파트너 쉐어 누계는 이 컬렉션의 합이다.

파트너는 자금 주체다 — `ledger.parties`에 `party_type = 'partner'`로 들어가고 `partner_share_payable` 계정을 소유한다 (`ddl/003_accounts.sql`).

### 적립

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `commission_expense[branch]` | `+` | S | `share_accrue` |
| `partner_share_payable[partner]` | `−` | S | `share_accrue` |

**멱등키:** `share_accrue:{partner_code}:{period_code}` — 기간별 1회. 같은 기간을 재계산해도 중복 적립이 생기지 않는다.

### 지급

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `partner_share_payable[partner]` | `+` | S | `share_settle` |
| `house_cash[branch]` | `−` | S | `share_settle` |

**멱등키:** `share_settle:{partner_code}:{client_request_id}`

> **요율 계산 규칙은 여전히 미확정이다.** U3(2026-08-15)는 **케이지 롤링 커미션**만 확정했다 — 관측 롤링 × 요율, 시점 스냅샷, 소급 없음(§6-1). **파트너 쉐어는 그 결정 밖이다**([`00-decisions`](../spec/00-decisions.md) §4). `ledger.partner_profiles.share_rate_bp`에 요율을 basis point로 두었으나 **무엇에 곱하는지**(롤링 누계인지 순손익인지)와 상위 파트너 배분 규칙은 정해지지 않았다. 계정과 분개는 그 결정과 무관하게 확정할 수 있으므로 먼저 세운다.
>
> **`share_settle`은 U3와 무관하게 만든다** — 입력이 금액이지 요율이 아니다(`AC-07-6`). 미확정인 것은 `share_accrue`의 산정식뿐이다.

> ⚠️ **`shareRate` 표기 함정.** 현행 `partners.shareRate`는 부동소수점 퍼센트다 — `0.5`는 **0.5%**이며 `50`bp이다. 순진하게 `×10000`하면 `5000`bp가 되어 **100배 오지급**이 난다([`spec/10`](../spec/10-partner-console.md) `R-10-43`).

---

## 13-4. 케이지 포인트 — `point_grant` · `point_use`

**§13-2와 다른 시스템이다.** 저 위는 파트너/플레이어 측 `player_points`이고, 이것은 **케이지 손님 계좌**(`SE7419`류)에 붙는 포인트다. B2(2026-08-15)가 **분리**로 확정했다 — 흡수하려면 "케이지 손님 = 온라인 회원" 매핑 규칙(`DR-75`)이 선행하는데 그것이 A1/A8 보류에 묶여 있다 ([`00-decisions`](../spec/00-decisions.md) §8 · [`spec/05`](../spec/05-cage-points.md)).

**현행:** `DB.pointsByAccount{accountId:number}` · `DB.pointsHistory[]` — **`localStorage` 전용**이다(`index.html:8958-8990`). 잔액이 단말에만 있고, 포인트 발행에 재인증이 없으며, 발행 상한도 없다.

### 발행

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `point_liability[branch]` | `+` | P | `point_grant` |
| `cage_point[member]` | `−` | P | `point_grant` |

**멱등키:** `point:{account_code}:{seq}`

### 사용

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `cage_point[member]` | `+` | P | `point_use` |
| `point_liability[branch]` | `−` | P | `point_use` |

**잔액 부족은 사전 검사가 아니라 지연 제약 트리거(I2)가 잡는다.** 애플리케이션 검사에 의존하면 동시 사용 두 건이 각각 통과한다.

> **발행·사용 양쪽이 스텝업 재인증을 요구한다** — 현행에 없는 통제다([`spec/05`](../spec/05-cage-points.md) `R-05-12`). 사유는 필수이며 `CHECK (length BETWEEN 1 AND 200)`이다. 현행의 `'—'` 기본값을 이식하지 않는다.

> **포인트 ↔ 자금 전환은 만들지 않는다.** 현행에 없다. 요구가 생기면 그때 분개를 추가한다.

---

## 14. 기초 잔액 개시 — `opening_balance`

마이그레이션 전용. [07-migration.md](07-migration.md) 참조.

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| (대상 계정) | 잔액 방향 | 확정 잔액 | `opening_balance` |
| `opening_equity[internal]` | 반대 | 동일 | `opening_balance` |

전 계정의 개시 잔액을 **하나의 거래**로 세운다. `opening_equity`가 균형 계정 역할을 하며, 이후 잔액은 0이 아니어야 정상이다(자기자본에 해당).

---

## 15. 자금 이동이 없는 연산

분개를 생성하지 않는 연산 목록. 혼동을 막기 위해 명시한다.

| 연산 | 현행 위치 | 기록 대상 |
|---|---|---|
| 롤링 입력 | `index.html:7043` | `cage.rolling_events` |
| 교대 IN/OUT | `shiftLog` | `identity.shift_events` |
| 일일 컷오프 | `index.html:8274` 부근 | `ledger.accounting_periods.status = 'frozen'` |
| 월정산 | `index.html:8274-8280` | 기간 마감 + 다음 기간 개시 |
| 실사 카운트 입력 | `cageConfig.*BreakdownCounts` | `cage.balancing_counts` (차액 발생 시에만 11절 거래) |
| 계좌 개설 · KYC 수정 | — | `ledger.parties` · `ledger.member_profiles` |
| 계좌 차단 · 해지 | `applyBlock`·`unblock` | `ledger.accounts.status` + 상태 이력 ([`spec/08`](../spec/08-account-lifecycle.md)) |
| 컨시어지 예약 (호텔·차량·항공) | `index.html:8781`·`8830`·`8883` | `concierge` 스키마 ([`spec/07`](../spec/07-concierge.md)) |
| 공지 · 문의 · 채팅 | `partner-admin/` 고객센터 7화면 | `support` 스키마 ([`spec/11`](../spec/11-chat-notice-support.md)) |
| 텔레그램 알림 발송 | `functions/index.js` | `notify` 스키마 ([`spec/09`](../spec/09-notifications.md)) |
| 이벤트 활성화 · 종료 | `activateEvent` (`index.html:9003`) | `cage.bonus_event_activations` (§6-2) |

---

## 16. `entry_category` 전체 목록

DDL의 `ledger.entry_category` ENUM과 일치해야 한다.

```
deposit_cash            withdraw_cash
transfer_out            transfer_in
branch_transfer_out     branch_transfer_in
buyin_account           buyin_cash            buyin_marker
marker_issue
chips_issue             chips_redeem
working_chip_issue      working_chip_return
settle_deposit          settle_cashout        settle_marker_redeem
settle_dealer_tip       settle_house_tip
wallet_transfer_out     wallet_transfer_in
bet                     payout
point_earn              point_convert_out     point_convert_in
point_grant             point_use
share_accrue            share_settle
commission_payout       event_commission
adjustment              suspense_resolve_out  suspense_resolve_in
opening_balance
```

> **`reversal`은 이 목록에서 제거했다** (`DR-23` 결정 · `AC-23-1`). ADR-016 이후 역분개는 **원 `category`를 그대로 유지**하므로 이 값을 쓰는 경로가 없다. 미사용 값을 남기면 다음 사람이 "쓸 수 있다"고 읽는다. M1 착수 전이라 타입 재생성이 싸다(`AC-23-2`). `tx_kind`의 `reversal`은 그대로 있다 — 역분개 여부는 그쪽으로 판별한다(18절).

> **아직 대응이 없는 현행 카테고리가 셋 남아 있다** — `avatar_tip` · `dealer_tip`(`avatar/app.js:706`)과 가입 보너스(`shared/game-engine.js:82`, 현행은 `deposit`으로 기록). 전부 아바타/스피드 도메인이라 A1과 함께 확정한다. 현행 `correction`(라운드 취소 환불·회수)은 신규 모델에서 `reversal` 거래가 대신한다.

---

## 17. 검증 체크리스트

구현 시 각 연산에 대해 확인한다.

- [ ] 통화별 분개 합이 0인가
- [ ] 모든 분개의 `amount_minor`가 0이 아닌가
- [ ] 잔액 하한을 넘는 계정이 없는가 (커밋 시점 기준)
- [ ] 멱등키가 **의도 시점**에 생성되는가 (호출 시점 랜덤값이 아닌가)
- [ ] `business_date`가 서버 계산값인가
- [ ] 게임 종료 시 `chips_outstanding` 잔액이 0인가
- [ ] 정정이 삭제가 아니라 역분개인가 (원 `category` 유지)
- [ ] 동결된 기간에 쓰려 하지 않는가

---

## 18. 이 표를 강제하는 방법

문서와 구현이 갈라지지 않게 하려면 표 자체가 데이터여야 한다.

```sql
CREATE TABLE ledger.posting_rules (
  kind         ledger.tx_kind        NOT NULL,
  category     ledger.entry_category NOT NULL,
  account_kind ledger.account_kind   NOT NULL,
  sign         SMALLINT              NOT NULL CHECK (sign IN (-1, 1)),
  PRIMARY KEY (kind, category, account_kind, sign)
);
```

1절부터 14절까지의 각 행이 그대로 이 테이블의 행이 된다. 역분개(`reversal` · `game_cancel`) 규칙은 나머지 규칙의 부호를 뒤집어 자동 생성한다.

```sql
CREATE TRIGGER entries_posting_rule
  BEFORE INSERT ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_posting_rule();
```

**분개를 만드는 주체는 저장 프로시저뿐이다.** 애플리케이션 역할은 `ledger.entries`에 INSERT 권한이 없고, `ledger.post_transaction()`에 EXECUTE 권한도 없다. 호출할 수 있는 것은 [`ddl/009`](../../db/schema/009_operations_money.sql)~[`011`](../../db/schema/011_operations_admin.sql)의 `op_*` 함수뿐이며, 이 함수들이 계정과 부호를 직접 구성한다. **호출자가 임의 분개를 주입할 인터페이스 자체가 존재하지 않는다.**

세 겹이다.

| 겹 | 수단 | 막는 것 |
|---|---|---|
| 1 | `op_*` 함수만 EXECUTE | 임의 분개 주입 경로 자체 |
| 2 | `entries_posting_rule` 트리거 | 함수 내부 버그로 잘못된 조합이 만들어지는 것 |
| 3 | `v_check_posting_rules` (R7) | 트리거를 우회한 흔적 (`session_replication_role` 등) |

---

**이전:** [03. 원장 모델](03-ledger-model.md) · **다음:** [05. API 계약](05-api-contract.md)
