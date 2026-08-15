# 04 — 케이지 게임 · 롤링 · 커미션 정산

> **마일스톤**: M1 · M2 · **선행**: [`01`](01-ledger-foundation.md) · [`03`](03-api-idempotency.md) · **후행**: [`06`](06-event-commission.md) · [`08`](08-account-lifecycle.md)
> **입력**: [`01-current-system.md`](../architecture/01-current-system.md) §5~§7 · [`04-posting-rules.md`](../architecture/04-posting-rules.md) §5~§10 · [`00-decisions.md`](00-decisions.md) U3
> **닫는 수용 기준**: `AC-11-*` `AC-13-*` `AC-17-*` `AC-42-*` `AC-43-*` `AC-45-*` `AC-48-*` `AC-61-*` `AC-64-*` `AC-84-*` `AC-85-*`

---

## 1. 범위

게임 개설 → 바이인 → 롤링 → 중간정산 → 종료 → 롤링 커미션 정산 → 취소. 물리 칩 재고와 교대 카운터도 여기다.

**현행이 도메인 스펙이다.** 근거 위치:

```
게임 개설      _doStartGame                index.html:6912
바이인 추가     _doAddBuyin                 index.html:6890
정산(커미션)    _doSettleGame               index.html:7250   ← DB.settled push
중간정산        _doConfirmMidSettle         index.html:7412
게임 종료       (종료 분기)                  index.html:7634
통화           gCurrency 5종                index.html:697
```

---

## 2. 롤링 커미션 산정 (U3)

**결정**: 관측 롤링 × 요율. 요율은 **게임 개설 시점 스냅샷**(`cage.games.commission_rate_bp`)이 유일한 권위. 소급 없음.

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-01` | `op_settle_commission`이 `rolling_base_minor × commission_rate_bp / 10000`로 계산한다. **클라이언트가 보낸 금액을 신뢰하지 않는다** | 결정 §4 |
| `R-04-02` | `assert_commission_base_available()`이 `sum(rolling_base_minor) <= games.rolling_total_minor`를 강제한다 — 같은 롤링에 두 번 지급할 수 없다 | `DR-85` 목표측 |
| `R-04-03` | 요율 변경이 **이미 개설된 게임에 소급하지 않는다.** 스냅샷 값 불변을 트리거가 강제한다 | 결정 §4 |
| `R-04-04` | `bet_type`(프리셋 문자열)은 **표시용**이며 요율의 권위가 아님이 컬럼 주석에 있다 | `DR-84` 목표측 |

### 2-1. 현행 코드 결함 2건 — 목표 설계와 별개로 지금 고친다

`[현행]` 표기 항목이다. **지금 오지급을 낸다.** 이관을 기다릴 이유가 없다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-05` | `Share 40%` 프리셋에서 커미션 프리필이 **0이거나 비어 있다.** 40%를 넣지 않는다 | `AC-84-1` |
| `R-04-06` | 요율 파싱 정규식이 "첫 퍼센트"가 아니라 **롤링 요율을 지목**한다 — `Rolling\s+([\d.]+)%`. 매치가 없으면 프리필하지 않는다 | `AC-84-2` |
| `R-04-07` | 프리필 값과 실제 입력값이 다를 때 화면에 표시된다 — 지금은 조용히 덮어쓴다 | `AC-84-3` |
| `R-04-08` | 진행 중 게임 재정산 시 **이미 정산된 롤링 구간을 차감**하고 남은 분만 프리필한다 | `AC-85-1` |
| `R-04-09` | 남은 분이 0이면 정산 버튼이 막힌다 | `AC-85-2` |

> `AC-84-4` · `AC-85-3`(과거 오지급·중복 정산 역산 조사)는 U1=데모 결정으로 **소멸**한다 ([`00-decisions`](00-decisions.md) §2).

---

## 3. 롤링 정정 (`DR-11`)

**문제**: `op_record_rolling`이 항상 `source='manual'` + `counts_toward_branch_total=TRUE`를 넣고 트리거가 그 조합을 1:1 강제한다. 그런데 정정 대상이 **바이인 시드**(`source='buyin'`, `counts=FALSE`)일 수 있다.

```
원본:  buyin   +2,000,000  counts=FALSE  → 지점 누계 미산입
정정:  manual  −2,000,000  counts=TRUE   → 지점 누계에서 차감
지점 관측 롤링 누계 = 넣은 적 없는 금액만큼 줄어든다
```

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-10` | 정정이 **대상 이벤트를 지목**한다 — `p_corrects_event_id`를 받거나 정정 전용 연산이 분리돼 있다 | `AC-11-1` |
| `R-04-11` | 정정의 `counts_toward_branch_total`이 **대상 이벤트 값을 따른다.** `manual ↔ TRUE` 강제 트리거가 정정 경로에는 적용되지 않는다 | `AC-11-2` |
| `R-04-12` | [`04` §6](../architecture/04-posting-rules.md)에 롤링 정정 입력 규칙이 있다 | `AC-11-4` |

---

## 4. 게임 취소 회복 경로 (`DR-13`)

**문제**: `op_cancel_game`이 중간정산 입금을 역분개하면 `member_deposit` 차변이 되는데, 손님이 이미 출금했으면 지연 제약 트리거가 **커밋을 거부한다.** 설계상 옳다 — 없는 돈은 회수할 수 없다. 문제는 **그 상태에서 할 수 있는 일이 문서에 없다는 것**이다. 게임은 `ongoing`으로 남는다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-20` | [`04` §9](../architecture/04-posting-rules.md)에 "취소가 실패하는 조건"이 명시돼 있다 | `AC-13-1` |
| `R-04-21` | `ledger.op_issue_marker(member, amount)`가 존재한다 — `marker_receivable[branch] +A` / `member_deposit[acct] −A`. `tx_kind`에 `marker_issue`, `entry_category`에 `marker_issue`. **4-eyes 대상** | `AC-13-2` |
| `R-04-22` | **부분 취소를 만들지 않는다.** 미회수분을 마커로 전환한 뒤 취소를 재시도하는 2단계 절차다. 미회수분이 손님에 대한 채권으로 남고 흔적이 전부 남는다 | `AC-13-3` |
| `R-04-23` | API가 이 실패를 `insufficient-balance`가 아니라 `cancel-would-overdraw`로 구분한다. 화면이 절차를 안내할 수 있어야 한다 | `AC-13-4` |

---

## 5. 윈로스 원천 단일화 (`DR-17` — A안)

**결정**: `cage.games.win_loss_minor` 스냅샷 컬럼을 **삭제**하고 `cage.v_game_win_loss` 뷰만 남긴다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-30` | `win_loss_minor` 컬럼이 존재하지 않는다 | `AC-17-A` |
| `R-04-31` | 선택 근거가 [`08-adr.md`](../architecture/08-adr.md)에 ADR로 기록돼 있다 | `AC-17-1` |
| `R-04-32` | 종료 후 역분개 시나리오에서 화면 표시 윈로스가 뷰 계산과 일치한다 | `AC-17-2` |

---

## 6. 게임 ↔ 계정 결속 (`DR-43`)

**문제**: `games.chips_account_id`에 FK만 있다. 그 계정이 `chips_outstanding`인지, `game_party_id` 소유인지, `games.currency`와 통화가 같은지 **아무것도 검사하지 않는다.** `UNIQUE`도 없어 두 게임이 한 계정을 가리킬 수 있다. 지금은 `op_open_game`이 항상 옳게 만들지만 **검사가 데이터가 아니라 코드에 있다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-40` | 트리거 하나가 셋을 함께 검사한다 — `kind='chips_outstanding'` · `party_id=game_party_id` · `currency=games.currency` | `AC-43-1` |
| `R-04-41` | `UNIQUE (chips_account_id)` | `AC-43-2` |
| `R-04-42` | **게임 통화 = 계좌 통화**를 강제한다 (U2, [`01`](01-ledger-foundation.md) `R-01-16`) | 결정 §3 |

---

## 7. 잠금 규율 (`DR-45`)

**문제**: `assert_game_ongoing()`이 게임 행을 `FOR SHARE`로 잡고, 같은 트랜잭션의 AFTER 트리거 `apply_rolling_projection()`이 그 행을 `UPDATE`한다. 전형적인 **잠금 승격**이며 두 트랜잭션이 동시에 하면 교착이다. 지금 교착이 없는 이유는 `cage.lock_ongoing_game()`이 진입부에서 `FOR UPDATE`를 먼저 잡기 때문 — **규율로만 가려져 있다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-50` | `assert_game_ongoing()`이 `FOR SHARE`를 쓰지 않는다 — `FOR UPDATE`로 통일하거나 잠금 없이 읽는다 | `AC-45-1` |
| `R-04-51` | 규율(`lock_ongoing_game()` 선행 호출)이 함수 주석이 아니라 **구조로** 강제된다 | `AC-45-2` |

---

## 8. 물리 칩 재고 (`DR-42`) · 교대 카운터 (`DR-61`)

**칩 재고**: `cage.chip_inventory_events`가 append-only인데 R1~R7 어디에도 없다. **금고에서 칩을 꺼내고 게임에 싣지 않아도, 게임에 실었는데 금고 기록을 남기지 않아도 알람이 없다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-60` | R10 `cage.v_check_chip_inventory` 신설 — 검사식 **금고 순유출 = 미상환 칩 잔액**, 지점별 ([`01`](01-ledger-foundation.md) §6) | `AC-42-1`~`AC-42-3` |
| `R-04-61` | `chip_type(nn/cc) ↔ entry_category` 매핑이 [`04`](../architecture/04-posting-rules.md)에 **먼저** 확정되고 뷰가 그 매핑을 쓴다 | `AC-42-4` |
| `R-04-62` | `chip_inventory_events.reason`이 **전용 ENUM**을 쓴다 (결정 §10) | `AC-42-5` |

**교대 카운터**: `nn_chip_in_shift`가 `reason`으로 거르지 않아 그 지점·영업일의 **모든 NN칩 재고 이벤트 합계**가 된다 — `settle_cashout`도 `settle_marker_redeem`도 포함한다. 즉 `nn_chip_in_shift ⊇ nn_cashout_shift ∪ nn_marker_shift`로 **세 카운터가 서로소가 아니다.** 현행 `nnChipInShift`는 `nn.deposit` 하나에서만 증가한다 — **다른 양을 계산하면서 같은 이름을 붙였다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-63` | `nn_chip_in_shift` · `cc_chip_in_shift`가 `reason='settle_deposit'`으로 거른다 | `AC-61-1` |
| `R-04-64` | **9개 카운터 전부**에 대해 현행 증가 지점과 1:1 대조가 수행되고 결과가 기록돼 있다 ([`01` §9](../architecture/01-current-system.md)의 표가 대조표다) | `AC-61-2` |
| `R-04-65` | **카운터 간 항등식이 정의돼 있다** — `nn_chip_in_shift`가 나머지 NN 카운터와 어떤 관계여야 하는지. 정의 없이는 R10을 만들어도 **무엇과 대조할지 모른다** | `AC-61-3` |

> `AC-61-4`(이관 전후 대조)는 U1=데모로 **"카운터 정의 대조"** 로 성격이 바뀐다 (결정 §2).

---

## 9. 인덱스 · 지점 비정규화 (`DR-48`)

`rolling_events_branch_total_idx`가 `(business_date)`만 잡는데 `cage.rolling_events`에 `branch` 컬럼이 없어 `v_branch_rolling_total`은 `cage.games`를 조인한다 — **인덱스가 그 질의를 돕지 못한다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-70` | `rolling_events`에 `branch`를 비정규화하고 인덱스에 넣는다 (다른 테이블이 이미 그렇게 한다) | `AC-48-1` |
| `R-04-71` | `games.branch`와의 일관성을 트리거가 강제한다 | `AC-48-2` |

---

## 10. 지점 간 자금 이월 (`DR-64`)

**문제**: [`04`](../architecture/04-posting-rules.md)가 "손님 잔액은 이미 통합되어 있으므로 이 경로가 불필요하다"고 쓰는데, `withdrawAcrossBranches()`가 하던 일은 **하우스 현금이 한 지점에서 부족할 때 다른 지점에서 끌어오는 것**이다 — **근거가 다른 질문에 답한다.** 이 로직은 `functions/balance/spillPlan.js`로 살아 있고 테스트(`functions/test/spillPlan.test.js`)까지 있다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-04-80` | [`04`](../architecture/04-posting-rules.md)의 폐기 근거가 실제 대상(하우스 현금 이월)에 맞게 고쳐졌다 | `AC-64-1` |
| `R-04-81` | **"사용자에게 보이는 변화가 있다"** 가 명시돼 있다 — 신규 모델에서 `branch_transfer` → `withdraw` 2단계가 되고 **둘 사이는 원자적이지 않다.** 더 명시적이고 감사 추적도 낫지만 운영자에게 보이는 절차가 바뀐다 | `AC-64-2` |
| `R-04-82` | [`05`](../architecture/05-api-contract.md) 현행↔신규 대응표에 `withdrawAcrossBranches` 행이 있다 | `AC-64-3` |
| `R-04-83` | `spillPlan.test.js`의 처리(이식/폐기/유지)가 결정되고 기록돼 있다 — **죽은 코드가 아니라 지금 유지보수되는 기능이다** | `AC-64-4` |

---

## 11. 골든 테스트

| 테스트 | 기대 |
|---|---|
| `AC-11-3` 바이인 시드 정정 후 `v_branch_rolling_total` | 값이 변하지 않음 |
| `AC-13-5` 개설 → 중간정산 → 손님 출금 → 취소 실패 → 마커 발행 → 취소 성공 | 전 구간 통과 |
| `AC-17-2` 종료 후 역분개 | 윈로스 표시가 뷰와 일치 |
| `AC-43-3` 결속을 깬 UPDATE 3종(종류·소유자·통화) | 각각 거부 |
| `AC-45-3` 같은 게임에 두 트랜잭션 동시 롤링 | 교착 없이 직렬화 |
| `AC-84-1` `Share 40%` 프리셋 정산 화면 | 커미션 프리필 0 |
| `AC-85-2` 이미 전액 정산된 진행 중 게임 재정산 | 버튼 차단 |
| `R-04-01` 클라이언트가 조작한 커미션 금액 전송 | 서버 계산값이 이긴다 |
| `R-04-42` 계좌 통화 ≠ 게임 통화 | 개설 거부 |

---

## 12. 열린 항목

- `R-04-65` 카운터 항등식은 **R10 착수 전에** 정의돼야 한다. 미정의 상태로 R10을 만들면 대조 기준이 없다.
- 중간정산·종료 영수증의 통화 표기는 `minor_unit`을 읽어야 한다 ([`01`](01-ledger-foundation.md) §3-1 KRW 함정).
