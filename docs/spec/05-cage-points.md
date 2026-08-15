# 05 — 케이지 포인트 (Cage Points)

> **마일스톤**: M2 · **선행**: [`01`](01-ledger-foundation.md) · [`02`](02-identity-access.md) · [`03`](03-api-idempotency.md)
> **입력**: [`01-current-system.md`](../architecture/01-current-system.md) §3-1 · `index.html:8958-8990` · [`00-decisions.md`](00-decisions.md) B2
> **닫는 수용 기준**: `AC-68-1` ~ `AC-68-4` · `AC-71-*`(이식 목록)
> **상태**: 목표 설계 **신규** — 지금까지 설계도 DDL도 없었다 ([`00` §6](../architecture/00-system-map.md) 커버리지 매트릭스 ❌)

---

## 1. 범위

케이지 손님 계좌에 붙는 **포인트 잔액**과 그 발행·사용 이력. 파트너/플레이어 측 `player_points`(`point_earn`·`point_convert`)와 **주체도 저장소도 다른 별개 시스템**이며, [`00-decisions`](00-decisions.md) §8에서 **분리 유지**로 확정됐다.

**7개 네비 뷰 중 하나가 통째로 이 시스템이다** (`index.html:595`, `data-view="points"`).

---

## 2. 현행 근거

```js
// index.html:8976  grantPoints()
const balAfter = (DB.pointsByAccount[pointsTargetAcc]||0) + amt;
DB.pointsByAccount[pointsTargetAcc] = balAfter;
DB.pointsHistory.unshift({dt, account, reason, change:amt, balance:balAfter});
```

| 항목 | 현행 |
|---|---|
| 저장 | `DB.pointsByAccount{accountId:number}` · `DB.pointsHistory[]` — **`localStorage` 전용** |
| 대상 | 케이지 계좌(`SE7419`류). `memberLedger`를 거치지 않는다 |
| 화면 | 잔액 카드 · 사용/지급 입력 · 이력 표 (`index.html:1163-1188`) |
| 사유 | `pUseReason` 자유 텍스트, 없으면 `'—'` |
| 재인증 | **없다.** PIN 확인 없이 포인트를 발행할 수 있다 |
| 검사 | 사용 시 잔액 부족만 검사(`toastInsufficientPoints`). 발행에는 상한이 없다 |
| 계좌 해지 시 | 연쇄 삭제 |

**세 가지가 결함이다**: ① 감사 대상 조작(포인트 발행)에 재인증이 없다 ② 잔액이 단말에만 있다 ③ 발행 상한·승인이 없다.

---

## 3. 목표 데이터 모델

포인트를 **부채**로 본다 — 손님에게 지급 의무가 있으므로 하우스 반대편에 계정을 둔다. 자유 부동 잔액이 아니라 **복식부기 안에** 넣는 것이 이 스펙의 핵심이다.

| ID | 요구사항 |
|---|---|
| `R-05-01` | `ledger.account_kind`에 **`cage_point`** 추가 — 케이지 손님 주체가 소유하는 포인트 잔액 계정 |
| `R-05-02` | `ledger.account_kind`에 **`point_liability`** 추가 — 지점 하우스 측 상대 계정 |
| `R-05-03` | `tx_kind`에 `point_grant` · `point_use` 추가. **파트너 측 `point_earn`·`point_convert`와 이름이 겹치지 않는다** |
| `R-05-04` | `entry_category`에 `point_grant` · `point_use` 추가 |
| `R-05-05` | [`04-posting-rules.md`](../architecture/04-posting-rules.md)에 케이지 포인트 절이 신설되고 분개 4행이 확정된다 |
| `R-05-06` | 포인트 계정의 통화는 **계좌 통화를 따른다.** 통화 중립 단위로 두지 않는다 — 통화별 계정 원칙([`01`](01-ledger-foundation.md) §3)의 예외를 만들지 않는다 |
| `R-05-07` | 포인트 계정이 `op_open_ledger_account` 화이트리스트에 포함된다 ([`10`](10-partner-console.md) `AC-08-1`과 같은 함수) |

### 3-1. 분개 규칙

| 연산 | 한쪽 | 반대쪽 |
|---|---|---|
| `point_grant` (발행) | `point_liability[branch]` − A | `cage_point[acct]` + A |
| `point_use` (사용) | `cage_point[acct]` − A | `point_liability[branch]` + A |

> 부호 규약은 [`04`](../architecture/04-posting-rules.md)의 기존 표기를 따른다. 위 표는 방향을 보이기 위한 것이고, 실제 행은 `posting_rules`에 들어가 R7이 검증한다.

---

## 4. 연산

| ID | 요구사항 |
|---|---|
| `R-05-10` | `ledger.op_point_grant(p_idempotency_key, p_account_code, p_amount_minor, p_reason, p_step_up_id, p_device_id)` |
| `R-05-11` | `ledger.op_point_use(p_idempotency_key, p_account_code, p_amount_minor, p_reason, p_step_up_id, p_device_id)` |
| `R-05-12` | **둘 다 스텝업 재인증을 요구한다** — 현행에 없는 통제다 ([`02`](02-identity-access.md) `R-02-25`) |
| `R-05-13` | 멱등키 규약이 `point:{account_code}:{seq}`이고 [`03`](03-api-idempotency.md) §4 접두사 대장에 등재돼 있다 |
| `R-05-14` | 사용 시 잔액 부족은 **지연 제약 트리거(I2 잔액 하한)** 가 잡는다. 애플리케이션 사전 검사에 의존하지 않는다 |
| `R-05-15` | `p_reason`에 `CHECK (length BETWEEN 1 AND 200)`. 현행의 `'—'` 기본값을 이식하지 않는다 — **사유 없는 포인트 발행을 허용하지 않는다** |
| `R-05-16` | 발행 임계 초과 시 4-eyes를 태울지가 `branch_config`로 설정 가능하다. 기본값은 **꺼짐**이며 그 사실이 주석에 있다 |

---

## 5. 조회 · 화면 계약

| ID | 요구사항 |
|---|---|
| `R-05-20` | `GET /v1/accounts/{code}/points` — 잔액 |
| `R-05-21` | `GET /v1/accounts/{code}/points/history` — 이력(페이지네이션). 현행 화면의 5열(일시·계좌·증감·잔여·비고)을 그대로 채울 수 있어야 한다 |
| `R-05-22` | 이력의 잔여 열이 **저장값이 아니라 원장 파생**이다. 현행은 `balance`를 이력 행에 박아 넣는다 — [`00-decisions`](00-decisions.md) §10 `DR-17`과 같은 원칙 |
| `R-05-23` | 지점 RLS가 적용된다 — 현행 `accountVisibleInBranch(h.account)` 필터와 같은 경계 |

---

## 6. 계좌 생명주기와의 관계

| ID | 요구사항 |
|---|---|
| `R-05-30` | **계좌 해지가 포인트 잔액을 삭제하지 않는다.** 현행은 연쇄 삭제한다 — [`08`](08-account-lifecycle.md)의 "해지는 상태 전이이며 분개를 삭제하지 않는다"가 포인트에도 적용된다 |
| `R-05-31` | `closed` 계좌에 대한 포인트 발행·사용이 거부된다 |
| `R-05-32` | 잔액이 남은 계좌를 `closed`로 만들 때의 처리(소멸/정산)가 결정되고 기록돼 있다 |

---

## 7. 수용 기준 매핑

| AC | 이 스펙에서 |
|---|---|
| `AC-68-1` | **(b) 분리 채택** — [`00-decisions`](00-decisions.md) §8에 결정·결정일·결정자 기록 완료 |
| `AC-68-2` | (a)를 고르지 않았으므로 **범위 밖** (회원=손님 매핑 규칙 불필요) |
| `AC-68-3` | 현행 잔액 이관 규칙 → U1=데모로 **이식 목록 항목**으로 성격 변경 (결정 §2) |
| `AC-68-4` | [`01-current-system.md`](../architecture/01-current-system.md) §3-1 존재 · 커버리지 매트릭스가 두 포인트 시스템을 구분 — **이 스펙 완료 시 매트릭스의 목표설계/DDL 열을 ✅로 갱신한다** |

---

## 8. 골든 테스트

| 테스트 | 기대 |
|---|---|
| 포인트 발행 후 R1 | 통화별 합 0 유지 |
| 잔액 초과 사용 | 커밋 거부(I2) |
| 스텝업 없이 발행 | 거부 |
| 같은 멱등키 2회 발행 | 캐시 재생, 잔액 1회분만 증가 |
| 사유 빈 문자열 | 거부 |
| `closed` 계좌에 발행 | 거부 |
| 계좌를 `closed`로 전이 | 포인트 분개가 남고 이력 조회가 계속 된다 |
| 다른 지점 세션에서 포인트 이력 조회 | 0행 |

---

## 9. 열린 항목

- `R-05-32` 잔액이 남은 계좌의 해지 처리 — 소멸시킬지, `point_liability`로 되돌릴지. **운영 정책 질문이며 오픈 전 답해야 한다.**
- 포인트 ↔ 자금 전환(포인트를 현금·칩으로 바꾸는 것)은 현행에 없다. **없다는 사실을 `tx_kind` 주석에 적는다** — 요구가 생기면 그때 분개를 추가한다.
