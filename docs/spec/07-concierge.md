# 07 — 컨시어지 (호텔 · 차량 · 항공)

> **마일스톤**: M2 · **선행**: [`03`](03-api-idempotency.md) · **후행**: [`08`](08-account-lifecycle.md)
> **입력**: [`01-current-system.md`](../architecture/01-current-system.md) §3-2 · `index.html:8792`·`8843`·`8894` · [`00-decisions.md`](00-decisions.md) §11
> **닫는 수용 기준**: `AC-69-1` ~ `AC-69-4`
> **상태**: 목표 설계 **신규**. `DR-69`가 지적한 대로 **커버리지 매트릭스에 행 자체가 없었다** — "어디가 설계 안 됐는지" 보여주는 문서가 이 도메인은 누락 여부조차 기록하지 않았다

---

## 1. 범위

손님 편의 예약 3종 — 호텔 · 차량 · 항공. **자금과 무관하다.** 원장에 분개를 만들지 않는다.

7개 네비 뷰 중 하나가 통째로 이 도메인이다 (`index.html:598`, `data-view="concierge"`).

---

## 2. 현행 근거

```js
// index.html:8792
DB.hotels.unshift({id, account, guest, roomType, bedType, checkin, checkout, remark, status:'confirmed'});
// index.html:8843
DB.cars.unshift({id, account, guest, dt, pickup, dropoff, carType, pax, remark, status:'confirmed'});
// index.html:8894
DB.aero.unshift({id, account, guest, direction, flight, airline, airport, pax, dt, status:'confirmed'});
```

| 항목 | 현행 |
|---|---|
| 저장 | `DB.hotels` · `DB.cars` · `DB.aero` — **`localStorage` 전용** |
| 상태 | `'confirmed'` → `'cancelled'` (취소는 상태 변경, 삭제 아님) |
| 조회 | `recordVisibleInBranch(x.account)`로 지점 필터 |
| ID | **클라이언트 난수 4자리** — 단말이 둘이면 충돌한다 |
| 계좌 해지 시 | 세 목록에서 연쇄 삭제 (`index.html:6246-6248`) |

---

## 3. 목표 데이터 모델

| ID | 요구사항 | AC |
|---|---|---|
| `R-07-01` | 스키마가 `cage` 밖이다 — **`concierge`** 스키마를 쓴다. 자금 원장과 무관하다 | `AC-69-2` |
| `R-07-02` | 테이블 3종: `concierge.hotel_bookings` · `car_reservations` · `flight_assists` | `AC-69-3` |
| `R-07-03` | 공통 컬럼: `id BIGINT GENERATED ALWAYS AS IDENTITY` · `branch` · `account_id` · `guest_name` · `status` · `remark` · `created_by` · `created_at` · `cancelled_by` · `cancelled_at` | `AC-69-4` |
| `R-07-04` | 호텔 고유: `room_type` · `bed_type` · `checkin DATE` · `checkout DATE` + `CHECK (checkout >= checkin)` | — |
| `R-07-05` | 차량 고유: `scheduled_at TIMESTAMPTZ` · `pickup` · `dropoff` · `car_type` · `pax INTEGER CHECK (pax > 0)` | — |
| `R-07-06` | 항공 고유: `direction('arrival','departure')` · `flight_no` · `airline` · `airport` · `pax` · `scheduled_at TIMESTAMPTZ` | — |
| `R-07-07` | `status` = `'confirmed'` · `'cancelled'` · `'completed'`. **취소는 상태 전이이고 행을 지우지 않는다** | — |
| `R-07-08` | **예약 ID를 서버가 생성한다.** 현행 난수 4자리를 이식하지 않는다 | `AC-69-4` |
| `R-07-09` | `account_id`가 `ledger.parties` FK. 계좌 해지가 예약을 **삭제하지 않는다** ([`08`](08-account-lifecycle.md)) | — |
| `R-07-10` | 세 테이블에 지점 RLS가 적용된다 — 현행 `recordVisibleInBranch`와 같은 경계 | — |

---

## 4. API

| ID | 엔드포인트 | 비고 |
|---|---|---|
| `R-07-20` | `POST /v1/concierge/hotels` · `/cars` · `/flights` | 생성. 서버가 ID 발급 |
| `R-07-21` | `GET /v1/concierge/{kind}` | 목록(지점 스코프 · 페이지네이션 · 상태 필터) |
| `R-07-22` | `POST /v1/concierge/{kind}/{id}/cancel` | 취소. `cancelled_by` · `cancelled_at` 기록 |
| `R-07-23` | `GET /v1/concierge/{kind}/{id}` | 상세 — 현행 상세 모달 대응 |
| `R-07-24` | 자금 연산이 아니므로 **스텝업 불필요**. 다만 `created_by`·`cancelled_by`는 반드시 남는다 | |

---

## 5. 커버리지 매트릭스 갱신

| ID | 요구사항 | AC |
|---|---|---|
| `R-07-30` | [`00-system-map.md`](../architecture/00-system-map.md) §6 커버리지 매트릭스의 컨시어지 행이 목표 설계 ❌ → ✅로 갱신된다. **설계가 없다는 사실 자체를 먼저 기록한 것이 `DR-69`의 요구였고, 이 스펙이 그 다음 단계다** | `AC-69-1` |

---

## 6. 골든 테스트

| 테스트 | 기대 |
|---|---|
| 두 단말이 동시에 예약 생성 | 둘 다 성공, ID 충돌 없음 |
| 취소 후 목록 조회 | 행이 `cancelled` 상태로 보인다 (사라지지 않는다) |
| 계좌를 `closed`로 전이 | 예약이 남아 있고 조회된다 |
| 다른 지점 세션에서 조회 | 0행 |
| `checkout < checkin` 생성 | 거부 |
| `pax = 0` 생성 | 거부 |

---

## 7. 열린 항목

- 컨시어지 예약이 **자금 이벤트로 발전하는가** — 호텔 비용을 손님 계좌에서 차감하는 업무가 생기면 원장 연결이 필요하다. 현행에는 없다. **없다는 사실을 스키마 주석에 적는다.**
- 예약 알림([`09`](09-notifications.md)) 연동 여부. 현행은 컨시어지 예약에 텔레그램 알림을 보내지 않는다.
