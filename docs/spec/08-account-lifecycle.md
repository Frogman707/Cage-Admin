# 08 — 계좌 생명주기 · 차단 (Account Lifecycle)

> **마일스톤**: M2 · **선행**: [`01`](01-ledger-foundation.md) · [`02`](02-identity-access.md) · **후행**: [`05`](05-cage-points.md) · [`07`](07-concierge.md)
> **입력**: [`01-current-system.md`](../architecture/01-current-system.md) §3-3 · `index.html:8613`·`8619` · [`00-decisions.md`](00-decisions.md) §10
> **닫는 수용 기준**: `AC-70-1` ~ `AC-70-7` · `AC-21-*`(성격 변경분) · `AC-77-1`(변경)
> **등급**: `DR-83`이 **높음** — 현행 해지가 원장을 물리 삭제한다

---

## 1. 범위

계좌 상태 전이(`active` ↔ `suspended` ↔ `closed`) · 차단/해제 이력 · 계좌 마스터 모델.

---

## 2. 현행 근거 — 두 가지가 동시에 잘못돼 있다

### 2-1. 차단/해제

```js
// index.html:8613  applyBlock
DB.blocks.unshift({account, type:"Full", reason, staff:staffName, dt:...});
// index.html:8619
function unblock(idx){ DB.blocks.splice(idx,1); saveDB(); renderBlocks(); }
```

**해제가 `splice` 삭제다.** 해제 이력이 소멸한다. 게다가 `DB.blocks`는 계좌 해지 연쇄 삭제에서 제외돼 있어 — **죽은 계좌의 차단 이력은 남고 산 계좌의 해제 이력은 사라지는** 비대칭이 있다. 차단 조작에는 재인증도 없다.

### 2-2. 계좌 해지

현행 `_doWithdrawAccount()`는 계좌 해지 시 **Firestore `ledger`에서 해당 계좌 원장을 전량 삭제한다.** 두 가지가 동시에 일어난다.

```
① append-only 원장의 물리 삭제
② 상대 계정(MAIN-{branch})의 미러 행은 남는다
   → 해지 한 번마다 지점 하우스 잔액이 그 계좌의 순입출금액만큼 틀어진다
   → 잔액이 원장 전량 합산으로 파생되므로 오차는 즉시 화면에 반영되고,
     되돌릴 근거 데이터는 이미 삭제됐다
```

동시에 포인트([`05`](05-cage-points.md)) · 컨시어지 예약([`07`](07-concierge.md)) · 이벤트 지급 이력도 연쇄 삭제된다.

---

## 3. 목표 — 해지는 상태 전이다

| ID | 요구사항 | AC |
|---|---|---|
| `R-08-01` | `ledger.op_set_account_status(p_idempotency_key, p_account_code, p_status, p_reason, p_step_up_id, p_device_id)`가 존재하고 **`suspended`와 `closed` 양쪽**을 다룬다 | `AC-70-1` |
| `R-08-02` | **`closed`는 4-eyes 대상, `suspended`는 스텝업만** (결정 §10). 그 판단이 [`06-security.md`](../architecture/06-security.md) 조작별 표에 있다 | `AC-70-2` |
| `R-08-03` | 상태 전이가 `audit` 이벤트 `'account_status'`를 발생시킨다. **선언된 이벤트가 실제로 발생하는지 확인하는 테스트가 있다** — 지금은 종류만 선언돼 있고 한 번도 발생할 수 없다 | `AC-70-3` |
| `R-08-04` | **차단·해제 이력 테이블**이 있다 — `ledger.account_status_history(account_id, from_status, to_status, reason, actor_staff_id, changed_at)`. 해제가 행을 지우지 않는다 | `AC-70-4` |
| `R-08-05` | `PATCH /v1/accounts/{code}/status`가 [`05` §3](../architecture/05-api-contract.md)에 있고, 기존 `PATCH`의 "자금 무관" 범위와 **분리**돼 있다 | `AC-70-5` |
| `R-08-06` | [`04`](../architecture/04-posting-rules.md) 또는 [`08-adr.md`](../architecture/08-adr.md)에 **"계좌 해지는 상태 전이이며 분개를 삭제하지 않는다"** 가 명문화돼 있다 | `AC-70-6` |
| `R-08-07` | `closed` 계좌에 대한 **모든** 자금 연산이 거부된다 — 입출금 · 이체 · 게임 개설 · 포인트 발행 | `AC-70-7` |
| `R-08-08` | `suspended` 계좌가 입금만 허용인지 전면 차단인지 결정되고 기록돼 있다. 현행 `type:"Full"`은 전면 차단을 뜻한다 | — |
| `R-08-09` | 계좌 해지가 포인트·컨시어지·알림 링크를 **연쇄 삭제하지 않는다** | `R-05-30`·`R-07-09` |

### 3-1. 검증

```sql
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'ledger' AND p.proname LIKE 'op\_%account\_status%';
-- 0 이면 재발
```

---

## 4. 차단 유형

현행은 `type:"Full"` 하나뿐이다. 목표에서도 **늘리지 않는다** — 쓰지 않는 유형을 미리 만들지 않는다.

| ID | 요구사항 |
|---|---|
| `R-08-10` | 차단 사유(`reason`)가 필수다. `CHECK (length BETWEEN 1 AND 200)` |
| `R-08-11` | 차단/해제가 스텝업 대상이다 — 현행에 재인증이 없다 ([`01` §3-3](../architecture/01-current-system.md) 결함) |
| `R-08-12` | 차단 목록 화면이 **해제된 이력도 보여줄 수 있다**(필터). 현행은 해제하면 사라진다 |

---

## 5. 계좌 마스터 모델 (`AC-21-*` 성격 변경분)

U1=데모 결정으로 "단말 순회 수집"은 사라지고 **모델 정의**만 남는다 ([`00-decisions`](00-decisions.md) §2).

현행 계좌 레코드(`index.html:8566` · 시드 `5709-5719`)의 필드:

```
member · phone · rate · telegram · balance/balances · currency · remark
engName · openedCasino · openedDt · passportPhoto · sitePhoto · signaturePhoto
telegramLinks[] · isMain
```

| ID | 요구사항 | AC |
|---|---|---|
| `R-08-20` | 위 필드가 전부 목표 모델에 대응물을 갖는다 — `ledger.parties` + `member_profiles` + `notify.telegram_links`([`09`](09-notifications.md)) | `AC-21-1`(변경) |
| `R-08-21` | `rate`(`"1.45%"` 문자열)가 `rolling_rate_bp` 정수로 저장된다. **표기 규약**(% ↔ bp)이 명시돼 있다 — `0.5` → `50`bp이며 순진한 `×10000`은 100배 오류다 | `AC-77-1`(변경) |
| `R-08-22` | 사진 3종(여권·현장·서명)의 저장 위치와 접근 통제가 정의돼 있다. **원장 DB에 바이너리를 넣지 않는다** | — |
| `R-08-23` | `isMain`(지점 메인 계좌)이 하우스 주체·계정 모델로 표현된다 — 별도 플래그를 만들지 않는다 | — |
| `R-08-24` | `openedCasino` · `openedDt`가 `parties`에 보존된다 | — |

---

## 6. 골든 테스트

| 테스트 | 기대 |
|---|---|
| `AC-70-7` `closed` 계좌 입금 | 거부 |
| `AC-70-3` 상태 전이 후 감사 이벤트 조회 | `'account_status'` 행이 실제로 존재 |
| `AC-70-4` 차단 → 해제 → 이력 조회 | 두 행 모두 남아 있다 |
| 4-eyes 없이 `closed` 전이 | 거부 |
| 스텝업 없이 `suspended` 전이 | 거부 |
| 계좌 `closed` 후 원장 조회 | **분개가 전부 남아 있다** |
| 계좌 `closed` 후 포인트·컨시어지 조회 | 행이 남아 있다 |
| `suspended` 주체의 계정에 자금 연산 | 거부 ([`01`](01-ledger-foundation.md) `R-01-32`) |

---

## 7. 열린 항목

- `R-08-08` `suspended`의 정확한 의미(입금 허용 여부)는 **운영 정책**이다. 현행 `Full`은 전면 차단이므로 기본값은 전면 차단으로 두고, 부분 차단이 필요하면 그때 유형을 늘린다.
- 잔액이 남은 계좌를 `closed`로 만들 때의 처리 — [`05`](05-cage-points.md) `R-05-32`와 같은 질문이며 **자금 잔액 쪽이 더 무겁다.** 출금 강제 후에만 해지를 허용할지 결정한다.
