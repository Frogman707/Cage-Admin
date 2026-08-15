# 06 — 이벤트 커미션 (Event Commission)

> **마일스톤**: M4 · **선행**: [`03`](03-api-idempotency.md) · [`04`](04-cage-game-rolling.md)
> **입력**: [`01-current-system.md`](../architecture/01-current-system.md) §7-4 · `index.html:8958`·`9003`·`7259` · [`00-decisions.md`](00-decisions.md) B1
> **닫는 수용 기준**: `AC-67-1` ~ `AC-67-7` · `AC-86-*`
> **상태**: 목표 설계 **신규** — `01`·`04`·`05`·DDL 전부 부재였다 (`DR-67`)

---

## 1. 범위

이벤트 기간 중 **롤링 커미션 정산이 일어나면 추가 보너스를 자동 지급**하는 기능. 활성 기간 관리 · 요율 · 활성화 로그 · 지급 이력 · 실패 기록.

[`00-decisions`](00-decisions.md) §7에서 **계속 운영 + 재구현**으로 확정됐다.

---

## 2. 현행 근거와 결함

```js
// index.html:8958  payEventCommissionForSettle(account, rolling)
if(!isEventActiveNow() || !rolling) return;
const rate = Number(document.getElementById('eventRate').value||0);   // ← DOM 이 권위
const amt  = Math.round(rolling*rate/100);
const txn  = await applyAccountTransaction(account,'IN',amt,t('memoEventCommission'));
if(!txn) return;                                                      // ← 실패 무기록
DB.eventHistory.unshift({dt, account, rolling, rate, amt, staff});
```

```js
// index.html:7259  _doSettleGame 안
payEventCommissionForSettle(g.account, g.rolling||0);                 // ← await 없음
```

| # | 결함 | 결과 |
|---|---|---|
| 1 | 요율 권위가 DOM 입력 필드 | 화면 값과 `DB.eventRate`가 갈라지면 **지급액은 화면을 따른다** |
| 2 | `if(!txn) return` | **미지급이 어디에도 안 남는다.** 사후 보전 불가 |
| 3 | `await` 없이 트리거 | 정산 완료 토스트가 보너스 성패를 모른다 |
| 4 | 기간 판정이 클라이언트 시계 문자열 비교 (`isEventActiveNow`) | **단말 시계를 바꾸면 종료된 이벤트가 되살아난다** |
| 5 | 상태가 `DB.eventStart`/`End`/`Rate` — `localStorage` 전용 | 단말마다 다른 이벤트가 돈다 |

---

## 3. 목표 데이터 모델

| ID | 요구사항 | AC |
|---|---|---|
| `R-06-01` | `cage.bonus_events` 신설 — `id` · `branch` · `starts_at TIMESTAMPTZ` · `ends_at TIMESTAMPTZ` · `rate_bp INTEGER` · `status` · `created_by` · `created_at` | `AC-67-1` |
| `R-06-02` | `CHECK (ends_at > starts_at)` · `rate_bp` 상한 CHECK. **요율은 bp 정수다** — 현행 `"1.00"` 문자열 퍼센트를 그대로 옮기지 않는다 | `AC-67-3` |
| `R-06-03` | `cage.bonus_event_activations` — 활성화·종료 감사 로그. 현행 `DB.eventActivationLog`(`dt`·`start`·`end`·`rate`·`staff`)의 대응물 | `AC-67-1` |
| `R-06-04` | `cage.bonus_event_payouts` — 지급 이력. `settlement_id` · `event_id` · `account_id` · `rolling_base_minor` · `rate_bp` · `amount_minor` · `status('paid','failed','pending')` · `failure_reason` · `attempt_count` | `AC-67-6` |
| `R-06-05` | **같은 정산에 두 번 지급할 수 없다** — `UNIQUE (settlement_id)` | — |
| `R-06-06` | `tx_kind`에 `event_commission`, `entry_category`에 `event_commission` 추가. 분개는 `commission_expense` 차변 / 손님 `member_deposit` 대변 | `AC-67-4` |
| `R-06-07` | 겹치는 기간의 활성 이벤트가 같은 지점에 둘 이상 존재할 수 없다 (배타 제약) | — |

---

## 4. 기간 · 요율의 권위

| ID | 요구사항 | AC |
|---|---|---|
| `R-06-10` | 기간 판정이 **서버 시각**(`now()`) 기준이다. 문자열 비교가 아니다 | `AC-67-2` |
| `R-06-11` | 지급 시 적용 요율이 **`bonus_events.rate_bp` 저장값**이다. DOM도 화면 입력값도 아니다 | `AC-67-3` |
| `R-06-12` | 지급 행이 **적용 요율을 스냅샷으로 남긴다** — 이벤트 요율이 나중에 바뀌어도 과거 지급의 근거가 보존된다 | `AC-67-1` |
| `R-06-13` | 이벤트 활성화·종료가 감사 이벤트를 발생시키고, **그 이벤트가 실제로 발생하는지 확인하는 테스트가 있다** | `AC-67-1` |

---

## 5. 연쇄 규약 — 아웃박스 비동기 (결정 §10)

**정산은 확정하고 보너스는 재시도 가능하게 한다.**

```
op_settle_commission (트랜잭션 A)
  ├─ 롤링 커미션 분개 확정
  └─ outbox INSERT {topic:'event_commission', settlement_id, account_id, rolling_base_minor}
                             ↓  (같은 트랜잭션에서 커밋)
소비자 (트랜잭션 B)
  ├─ 활성 이벤트 조회 (서버 시각 기준)
  ├─ op_pay_event_commission(...)   멱등키 event_comm:{settlement_id}
  └─ 실패 시 bonus_event_payouts.status='failed' + failure_reason + attempt_count++
```

| ID | 요구사항 | AC |
|---|---|---|
| `R-06-20` | `op_settle_commission`이 아웃박스 행을 **같은 트랜잭션에서** 넣는다 | `AC-67-5` |
| `R-06-21` | 보너스 지급 실패가 **정산을 되돌리지 않는다** | `AC-67-5` |
| `R-06-22` | 실패가 `bonus_event_payouts`에 기록되고 재시도 큐에 남는다 | `AC-67-6` |
| `R-06-23` | 재시도 상한과 상한 도달 시 운영 알림 경로가 정의돼 있다 ([`09`](09-notifications.md)) | `AC-67-6` |
| `R-06-24` | 멱등키 `event_comm:{settlement_id}`가 [`03`](03-api-idempotency.md) §4 대장에 등재돼 있다 | — |

> **(a) 같은 트랜잭션을 고르지 않은 이유**: 보너스 실패가 정산을 되돌린다. **(c) 수동 연산을 고르지 않은 이유**: 현행 UX가 자동 지급이고 그것을 바꾸지 않는다.

---

## 6. 조회 · 화면 계약

현행 화면을 그대로 채울 수 있어야 한다.

| ID | 요구사항 |
|---|---|
| `R-06-30` | `GET /v1/bonus-events/active` — 현재 활성 이벤트(서버 시각 기준). 화면 상단 "이벤트 활성화" 배지가 이 응답을 쓴다 |
| `R-06-31` | `POST /v1/bonus-events` · `POST /v1/bonus-events/{id}/end` — 활성화·종료. 스텝업 대상 |
| `R-06-32` | `GET /v1/bonus-events/activations` — 활성화 내역 모달의 5열(일시·시작·종료·요율·직원) |
| `R-06-33` | `GET /v1/bonus-events/payouts` — 지급 내역 표의 6열(일시·계좌·롤링·요율·지급액·직원) + **`failed` 행도 보인다.** 현행은 실패가 표에 없다 |
| `R-06-34` | 리포트 집계(현행 `index.html:8158`)가 `status='paid'`만 합산한다 |

---

## 7. 골든 테스트

| 테스트 | 기대 | AC |
|---|---|---|
| 보너스 지급 실패 후 정산 상태 | 롤링 커미션 정산은 확정, 실패가 재시도 큐에 남음 | `AC-67-7` |
| 같은 `settlement_id`로 두 번 소비 | 두 번째는 캐시 재생, 지급 1회 | `R-06-05` |
| 이벤트 종료 후 정산 | 보너스 지급 없음 | `AC-67-2` |
| 클라이언트가 요율을 실어 보냄 | 무시하고 저장 요율 적용 | `AC-67-3` |
| 겹치는 기간 이벤트 2건 활성화 | 두 번째 거부 | `R-06-07` |
| 활성화 → 감사 이벤트 조회 | 행이 실제로 존재 | `AC-67-1` |

---

## 8. 열린 항목

- **`DR-86` 잔여**: 이벤트 커미션이 [`00` §4](../architecture/00-system-map.md) 자금 쓰기 지점 전수 목록에 등재돼야 한다. 지금 그 표에 케이지 이벤트 커미션 행이 없다.
- 지점별 이벤트인지 전사 이벤트인지 — `R-06-01`은 `branch`를 두었으나 현행은 단말 로컬이라 판별 불가다. **운영 확인 필요.** 전사라면 `branch`를 NULL 허용으로 두고 배타 제약을 조정한다.
