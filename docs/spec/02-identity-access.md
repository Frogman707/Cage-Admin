# 02 — 신원 · 접근 통제 (Identity & Access)

> **마일스톤**: M1 · **선행**: [`01`](01-ledger-foundation.md) · **후행**: [`03`](03-api-idempotency.md) · [`08`](08-account-lifecycle.md) · [`10`](10-partner-console.md)
> **입력**: [`06-security.md`](../architecture/06-security.md) · [`ddl/002`](../architecture/ddl/) · [`ddl/012`](../architecture/ddl/) · [`00-decisions.md`](00-decisions.md) U5 · DR-34
> **닫는 수용 기준**: `AC-14-*` `AC-15-*` `AC-16-*` `AC-30-*` `AC-31-*` `AC-32-*` `AC-33-*` `AC-34-1`·`AC-34-2`·`AC-34-4` `AC-35-*` `AC-47-*`

---

## 1. 범위

직원 신원 · 세션 · 스텝업 재인증 · 4-eyes 승인 · RLS 경계.

현행 근거: PIN + TOTP를 Cloud Function이 검증한다 (`functions/index.js:130` `staffLogin`, `:365` TOTP 검증 유닛). 파트너 콘솔은 `admin`/`0000` 클라이언트 비교이고 Cloud Function을 호출하지 않는다 ([`00` §5](../architecture/00-system-map.md) 3앱 비교표) — **목표 설계에서 파트너도 서버 인증으로 올린다.**

---

## 2. 승인 · 교대 연산의 멱등키 (`DR-30`)

**문제**: 자금 연산은 전부 첫 인자가 `p_idempotency_key`인데 `op_request_approval` · `op_cast_vote` · `op_shift_event` 셋만 빠졌다. 승인 요청이 중복 생성되면 각각 2표를 모아 **같은 요청을 두 번 실행할 수 있는 승인권**이 된다. `consume_approval()`은 승인 하나를 1회용으로 소비하지만 **승인이 둘이면 소비도 두 번 가능하다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-02-01` | 세 함수가 `p_idempotency_key TEXT`를 첫 인자로 받고 `begin_idempotent()`를 탄다 | `AC-30-1` |
| `R-02-02` | `op_cast_vote`의 자연 멱등키가 `vote:{approval_id}:{staff_id}` | `AC-30-2` |
| `R-02-03` | 같은 승인 요청 재전송이 **캐시 재생**이지 새 승인 생성이 아니다 | `AC-30-3` |
| `R-02-04` | `op_cast_vote` 중복 호출이 raw `23505`가 아니라 매핑된 오류를 낸다 | `AC-30-4` |
| `R-02-05` | [`05` §7](../architecture/05-api-contract.md) 오류 표에 그 코드가 있다 | `AC-30-5` |

**검증**

```sql
SELECT subject_kind, subject_ref, count(*) FROM identity.approvals
 WHERE status = 'pending' GROUP BY 1,2 HAVING count(*) > 1;
-- 기대: 0행 (승인권 복제 탐지)
```

---

## 3. 분할 출금(structuring) 방어 — 구조만 (U5 유예)

**문제**: `require_approval_if_over_threshold()`가 **건별 금액**만 본다. 임계가 1,000,000이면 999,999씩 나눠 4-eyes를 영구 회피할 수 있다 — 같은 계좌 · 같은 직원 · 같은 5분 안이어도 통과한다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-02-10` | `ledger.branch_config`에 `approval_window INTERVAL` · `approval_cumulative_minor BIGINT`가 있다. **끄려면 명시적 센티널이 필요하고 NULL로 조용히 꺼지지 않는다** (`DR-39`의 교훈) | `AC-15-1` |
| `R-02-11` | 판정 = `건별 임계 OR (윈도 안 같은 계좌 출금 합 + 이번 건) >= 누적 임계` | `AC-15-2` |
| `R-02-12` | **누적 검사 전에 해당 계정 잔액 행을 `FOR UPDATE`로 잠근다.** 지금 `op_withdraw`는 `post_transaction` 호출 **전**에 임계를 검사하므로 잠그지 않으면 check-then-act가 된다 | `AC-15-3` |
| `R-02-13` | 임계 직하 금액 두 건 동시 호출 시 하나만 통과 | `AC-15-4` |
| `R-02-14` | 임계값·윈도가 **"U5 유예 · 잠정값"** 으로 표기돼 있고, 관할 확정 시 `AC-15-5`를 닫는 절차가 [`00-decisions`](00-decisions.md) §6에 적혀 있다 | `AC-15-5`(이월) |

---

## 4. 스텝업 재인증

| ID | 요구사항 | AC |
|---|---|---|
| `R-02-20` | `op_deposit`이 요구하는 최소 방식이 `pin` 이상임이 함수에 명시돼 있다. **4-eyes는 적용하지 않는다** — 입금은 손님에게 유리한 방향이다 | `AC-14-2` |
| `R-02-21` | [`06` §3-4](../architecture/06-security.md) 조작별 재인증 표에 입금 행이 있다 | `AC-14-3` |
| `R-02-22` | `op_open_account`가 `p_step_up_id BIGINT` · `p_device_id TEXT`를 받고, 스텝업 없이는 실행되지 않는다 | `AC-33-1`·`AC-33-2` |
| `R-02-23` | **계정 개설은 4-eyes 대상이 아니다**(결정 §10). 그 판단과 근거가 [`06`](../architecture/06-security.md)에 기록돼 있다 | `AC-33-3` |
| `R-02-24` | `ddl/012`의 GRANT 인자 목록이 시그니처 변경과 **함께** 바뀌었다. 시그니처만 바꾸고 GRANT를 두면 `009`~`013`이 적용 불가가 된다 | `AC-33-4` |
| `R-02-25` | **포인트 발행에 스텝업이 붙는다** — 현행은 재인증이 없다 ([`05`](05-cage-points.md)) | 결정 §8 |

`AC-14-1`(스텝업 토큰 없이 `op_deposit` 실행 불가)은 2026-08-15 검증 완료 상태를 유지한다.

---

## 5. RLS 경계 확장

**문제**: 파트너 운영자와 케이지 직원이 **같은 `ledger_app` 역할로** DB에 붙는데 `identity.staff` · `staff_branches` · `staff_roles` · `shift_events`에 RLS가 없다. 전 직원 명단 · 지점 배치 · 역할 구성 · 교대 기록이 노출된다. `ledger.party_visible()`이 파트너 계층 경계를 정교하게 만들어 놓았는데 `identity` 쪽에는 그 경계가 없다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-02-30` | 네 테이블에 RLS가 켜져 있다 | `AC-16-1` |
| `R-02-31` | 판정이 `identity.staff_visible()` **함수 하나에 모여** 있다 — 자기 자신은 항상 · 파트너 운영자는 같은 `partner_subtree` 소속만 · 케이지 직원은 `current_branches()`에 걸치는 직원만 | `AC-16-2` |
| `R-02-32` | [`06` §4-3](../architecture/06-security.md) RLS 대상 목록이 13개 → **17개**로 갱신됐다 | `AC-16-3` |
| `R-02-33` | `identity.approval_votes`에 RLS가 켜져 있고 판정이 `approvals`를 경유한다 (`cage.rolling_events`가 게임을 경유하는 것과 같은 패턴) | `AC-31-1` |
| `R-02-34` | `ledger.outbox`에 RLS가 켜져 있고 `ledger_relay` 전용 역할만 읽는다 ([`03`](03-api-idempotency.md) §5와 한 묶음) | `AC-10-3` |

---

## 6. 세션 · 자격 관리

| ID | 요구사항 | AC |
|---|---|---|
| `R-02-40` | `ledger_app`의 `identity.sessions` UPDATE가 `(revoked_at, revoked_reason)` **두 컬럼으로** 좁혀져 있다 | `AC-32-1` |
| `R-02-41` | 리프레시 토큰 회전이 "기존 행 revoke + 새 행 INSERT"로 표현된다 — `sessions`가 append-only가 되면 재사용 감지 이력도 함께 남는다 | `AC-32-2` |
| `R-02-42` | `ledger_app`으로 `UPDATE identity.sessions SET staff_id = ...`가 거부된다 | `AC-32-3` |
| `R-02-43` | `identity.purge_used_totp()`가 존재하고 보존 창(±1 스텝) 밖 행을 지운다. EXECUTE가 **전용 유지보수 역할에만** 있다 — `ledger_app`에는 없다 | `AC-35-1`·`AC-35-2` |
| `R-02-44` | [`ddl/README.md`](../architecture/ddl/README.md) 운영 배치 표에 `purge_used_totp` 주기가 등재돼 있다 | `AC-35-3` |
| `R-02-45` | `identity.staff.partner_party_id`가 가리키는 주체가 `party_type='partner'`임을 트리거가 강제한다 | `AC-47-1`·`AC-47-2` |

**검증**

```sql
SELECT a.attname FROM pg_attribute a
 WHERE a.attrelid = 'identity.sessions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
   AND has_column_privilege('ledger_app', a.attrelid, a.attnum, 'UPDATE');
-- 기대: revoked_at · revoked_reason 둘뿐
```

---

## 7. 파트너 승인 정책 (DR-34 — 도입하지 않음)

**결정**: 파트너 조직 내 4-eyes를 만들지 않는다 ([`00-decisions`](00-decisions.md) §9).

| ID | 요구사항 | AC |
|---|---|---|
| `R-02-50` | `partner_admin`에 `approval.vote`가 **없다**는 사실과 그것이 의도된 통제라는 판단이 [`06`](../architecture/06-security.md)에 기록돼 있다 | `AC-34-1`·`AC-34-2` |
| `R-02-51` | **파트너 운영자의 `staff_branches` 행 유무가 확인되고 기록돼 있다.** 승인은 못 해도 `assert_actor_authorized(actor, branch, ...)`를 타는 연산이 있으므로 지점 행이 없으면 그 연산 전체가 막힌다 | `AC-34-4` |
| `R-02-52` | `partner.share_settle`이 케이지 매니저 승인에 의존한다는 **운영 절차**가 [`10`](10-partner-console.md)에 적혀 있다 | 결정 §9 |

`AC-34-3`(역할 분화) · `AC-34-5`(파트너 4-eyes 골든 테스트)는 이 결정으로 **범위 밖**이다.

---

## 8. 골든 테스트

| 테스트 | 기대 |
|---|---|
| `AC-15-4` 임계 직하 2건 동시 출금 | 하나만 통과 |
| `AC-16-4` 파트너 세션에서 케이지 직원 조회 | 0행 |
| `AC-31-2` 다른 지점 세션에서 그 지점 승인 투표 조회 | 0행 |
| `AC-30-3` 같은 승인 요청 2회 | 두 번째는 캐시 재생, 승인 1건 |
| `AC-30-4` `op_cast_vote` 중복 | 매핑된 오류 (raw 23505 아님) |
| `AC-32-3` `ledger_app`으로 `sessions.staff_id` UPDATE | 거부 |
| `AC-33-2` 스텝업 없이 `op_open_account` | 거부 |
| `AC-47-2` `member` 주체를 가리키는 `staff.partner_party_id` INSERT | 거부 |
| `R-02-25` 스텝업 없이 포인트 발행 | 거부 |

---

## 9. 열린 항목

- **파트너 콘솔 인증 승격**: 현행 `admin`/`0000` 클라이언트 비교를 서버 인증으로 올리는 작업 범위는 [`10`](10-partner-console.md)에서 다룬다. 이 스펙은 DB 측 계약만 정의한다.
- U5 확정 시 `R-02-14`의 잠정값을 실제값으로 교체하고 `AC-15-5`를 닫는다.
