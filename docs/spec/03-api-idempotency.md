# 03 — API 계약 · 멱등성 (API & Idempotency)

> **마일스톤**: M1 · M2 · **선행**: [`01`](01-ledger-foundation.md) · [`02`](02-identity-access.md) · **후행**: `04` ~ `11` 전부
> **입력**: [`05-api-contract.md`](../architecture/05-api-contract.md) · [`02-target-architecture.md`](../architecture/02-target-architecture.md) · [`ddl/008`](../architecture/ddl/)
> **닫는 수용 기준**: `AC-09-*` `AC-10-*` `AC-18-*` `AC-19-*` `AC-54-*` `AC-80-*`

---

## 1. 범위

멱등성 계약 · 오류 매핑 · 아웃박스와 실시간 채널 · 서버 발급 식별자 · 운영 파라미터. **모든 자금 연산이 이 계층을 통과한다.**

---

## 2. 멱등성 — 대기가 아니라 거절 (`DR-09`)

**문제**: `begin_idempotent()`의 `ON CONFLICT DO UPDATE`가 행을 잠그고 **상대 트랜잭션이 끝날 때까지 대기한다.** `in_progress`가 커밋된 채 남는 경로가 없으므로 **`409 request-in-progress`는 발생하지 않는다.** 실제 동작은 커넥션을 붙잡는 것이고, 원 요청이 느리면 재시도가 쌓여 **커넥션 풀이 마른다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-03-01` | `begin_idempotent()` 진입부에 `SET LOCAL lock_timeout`이 있고 `lock_not_available`(`55P03`)을 잡아 `request-in-progress`로 매핑한다 | `AC-09-1` |
| `R-03-02` | 같은 멱등키로 두 커넥션이 동시에 호출하면 두 번째가 **타임아웃 시간 안에** `request-in-progress`를 받는다. 무한 대기하지 않는다 | `AC-09-2` |
| `R-03-03` | [`02-target-architecture.md`](../architecture/02-target-architecture.md)에 **운영 파라미터 절**이 있고 `statement_timeout` · `lock_timeout` · 커넥션 풀 크기가 값과 함께 적혀 있다 | `AC-09-3` |
| `R-03-04` | [`05` §2-2](../architecture/05-api-contract.md)의 409 행에 "잠금 타임아웃 기준"임이 명시돼 있다 | `AC-09-4` |

> 자금 API에 `statement_timeout`은 이 문제와 무관하게 필수다.

---

## 3. 멱등키 스코프 (`DR-54`)

**문제**: `key TEXT PRIMARY KEY` — 전역 단일 네임스페이스다. `request_fingerprint`가 `SHA-256(method || path || canonical body)`이라 **행위자를 포함하지 않는다.** 같은 조작을 같은 인자로 요청한 **다른 지점 스태프가 앞사람의 응답**(거래 `external_id`, 잔액)을 받는다. 지점 RLS는 여기서 도움이 안 된다 — `idempotency_keys`는 RLS 대상이 아니고 응답은 이미 JSONB로 굳어 있다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-03-10` | `ledger.request_fingerprint()`가 **행위자를 지문에 포함**한다 | `AC-54-1` |
| `R-03-11` | 같은 키·같은 인자를 다른 행위자가 호출하면 캐시 재생이 아니라 **거부**된다 | `AC-54-2` |
| `R-03-12` | [`05` §2](../architecture/05-api-contract.md)에 멱등키 스코프가 명시돼 있다 — IETF 초안은 "유일해야 한다"만 쓰고 **무엇에 대해 유일한지는 규정하지 않는다.** 스코프는 구현 책임이다 | `AC-54-3` |

---

## 4. 파생 멱등키 (`DR-19`)

**문제**: `op_record_balancing`의 `키||':adj'`와 `op_cancel_game`의 `키||':'||tx_id`가 `transactions.idempotency_key`에는 들어가지만 `ledger.idempotency_keys`에는 행이 생기지 않는다. **"모든 자금 거래는 `idempotency_keys`에 행을 갖는다"가 참이 아니다** — 운영 조회(`key → transaction_id`)가 이 거래들을 찾지 못한다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-03-20` | 파생 키 규칙이 [`05` §2](../architecture/05-api-contract.md)에 명시돼 있다 — 접두사 규약과 부모-자식 관계 | `AC-19-1` |
| `R-03-21` | `post_transaction`이 `p_parent_key TEXT`를 받아 부모-자식 관계를 `idempotency_keys`에 기록한다 | `AC-19-2` |
| `R-03-22` | 운영 조회 하나로 **"이 요청이 만든 거래 전부"** 를 찾을 수 있다 | `AC-19-3` |

**접두사 대장** — 새 파생 키를 만드는 사람은 이 표를 먼저 갱신한다.

| 접두사 | 발생처 | 스펙 |
|---|---|---|
| `vote:{approval_id}:{staff_id}` | `op_cast_vote` | [`02`](02-identity-access.md) |
| `{parent}:adj` | `op_record_balancing` | [`04`](04-cage-game-rolling.md) |
| `{parent}:{tx_id}` | `op_cancel_game` | [`04`](04-cage-game-rolling.md) |
| `point:{account_code}:{seq}` | 케이지 포인트 발행·사용 | [`05`](05-cage-points.md) |
| `event_comm:{settlement_id}` | 이벤트 커미션 지급 | [`06`](06-event-commission.md) |
| `share_accrue:{partner_code}:{period_code}` | `op_share_accrue` | [`10`](10-partner-console.md) |
| `deposit_req:{request_id}` · `payment_req:{request_id}` | 파트너 요청 승인 | [`10`](10-partner-console.md) |
| `bet:{round_id}:{member_code}:{bet_type}` · `payout:{...}` | 플레이어 도메인 (보류) | [`13`](13-player-domain-deferred.md) |

**검증**

```sql
SELECT t.idempotency_key FROM ledger.transactions t
 WHERE NOT EXISTS (SELECT 1 FROM ledger.idempotency_keys k WHERE k.key = t.idempotency_key);
-- 기대: 0행
```

---

## 5. 아웃박스 경계 (`DR-10`)

**문제**: `ledger.outbox.payload`에 계좌 코드 · 계정 종류 · 금액 · 범주가 전부 들어 있는데 `ledger_app`이 SELECT를 갖고 RLS가 없다. [`02` §4-2](../architecture/02-target-architecture.md)가 주장하는 "서버가 인가를 강제한다"가 **Realtime Gateway의 애플리케이션 로직에만 존재한다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-03-30` | `ledger_relay` 역할이 존재하고 `outbox`만 본다 | `AC-10-1` |
| `R-03-31` | `ledger_app`의 `outbox` 접근이 회수됐다 | `AC-10-2` |
| `R-03-32` | `outbox`에 RLS가 켜져 있다 — relay 자격증명 침해에는 무력하지만 **회귀를 기본거부로 잡는다** | `AC-10-3` |
| `R-03-33` | [`02` §5-2](../architecture/02-target-architecture.md) 역할 표에 `ledger_relay`와 `identity_app`이 있다 | `AC-10-4` |

```sql
SELECT has_table_privilege('ledger_app','ledger.outbox','SELECT') AS app_reads_outbox;
-- 기대: f
```

**아웃박스는 알림([`09`](09-notifications.md))과 이벤트 커미션 지급([`06`](06-event-commission.md))의 공용 인프라다.** 소비자가 늘어나므로 `topic` 컬럼으로 구분하고, 소비자별 커서를 둔다.

---

## 6. 실시간 채널 (`DR-80`)

**문제**: [`02` §4-1](../architecture/02-target-architecture.md)의 "현행 8채널을 WebSocket 8채널로 매핑"에서 여덟 개가 **전부 케이지 어드민의 `subscribe*Cloud`** 다. `partner-admin/app.js` 5곳과 `avatar/app.js` 1곳에는 대응 채널이 0개다. 플레이어 쪽은 A1 보류로 설명되지만 **파트너 콘솔 쪽은 아니다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-03-40` | [`02` §4-2](../architecture/02-target-architecture.md) 표에 **파트너 채널 행**이 있다 — 승인 대기열 · 회원 목록 · 정산 상태 | `AC-80-1` |
| `R-03-41` | "8채널"이라는 수치가 **케이지 범위로 한정 표기**돼 있다. [`README`](../architecture/README.md) 한 장 요약의 같은 행도 함께 | `AC-80-2` |
| `R-03-42` | A8 착수 조건에 실시간 채널 설계가 포함돼 있다 — **엔드포인트만 만들고 채널을 빼면 A8이 반쪽으로 끝난다** | `AC-80-3` |

---

## 7. 서버 발급 식별자

`Math.random()` · 클라이언트 카운터로 만들던 식별자를 **서버가 발급한다.** 현행 근거: 게임번호는 `'YYMMDD'` + `DB.nextGameSeq` 3자리(`index.html:6921`), 컨시어지 예약 ID는 난수 4자리.

| ID | 요구사항 | AC |
|---|---|---|
| `R-03-50` | 게임번호를 서버가 발급한다 — `(branch, business_date)` 카운터 테이블 + `FOR UPDATE`. **전역 시퀀스는 일자 리셋과 맞지 않는다.** 표기 규약 `YYMMDD`+3자리는 유지 | `AC-18-1` |
| `R-03-51` | 동시 개설 테스트에서 500이 나오지 않는다 | `AC-18-4` |
| `R-03-52` | [`05` §7](../architecture/05-api-contract.md) 오류 표에 관련 코드가 있다 | `AC-18-3` |
| `R-03-53` | 컨시어지 예약 ID를 서버가 생성한다 ([`07`](07-concierge.md)) | `AC-69-4` |

`AC-18-2`(클라이언트 제안 + 409 매핑)는 `AC-18-1` 채택으로 **범위 밖**이다.

---

## 8. 오류 표 유지 규약

[`05` §7](../architecture/05-api-contract.md) 오류 표는 **API가 낼 수 있는 모든 코드의 유일한 목록**이다.

| ID | 요구사항 |
|---|---|
| `R-03-60` | 새 오류 코드를 만드는 커밋이 `05` §7 표를 같은 커밋에서 갱신한다 |
| `R-03-61` | raw PostgreSQL SQLSTATE가 API 밖으로 나가지 않는다. 매핑되지 않은 예외는 조용한 500이 아니라 **CI 실패**가 된다 |
| `R-03-62` | `cancel-would-overdraw`가 `insufficient-balance`와 구분돼 있다 ([`04`](04-cage-game-rolling.md)) |
| `R-03-63` | 현행↔신규 대응표에 `withdrawAcrossBranches` 행이 있다 — 지금은 표에 없어 **이 기능이 어디로 갔는지 API 문서만 봐서는 알 수 없다** | `AC-64-3` |

---

## 9. 골든 테스트

| 테스트 | 기대 |
|---|---|
| `AC-09-2` 같은 멱등키 동시 2요청 | 두 번째가 타임아웃 안에 `request-in-progress` |
| `AC-54-2` 같은 키·다른 행위자 | 캐시 재생 아님, 거부 |
| `AC-19-3` 파생 키를 만든 요청 조회 | 부모+자식 거래 전부 반환 |
| `AC-10-2` `ledger_app`으로 `outbox` SELECT | 거부 |
| `AC-18-4` 두 단말이 동시에 게임 개설 | 둘 다 성공(서버 발급), 500 없음 |
| `R-03-61` 미매핑 예외 유발 | CI 실패 |

---

## 10. 열린 항목

- 운영 파라미터 실제 값(`statement_timeout` · `lock_timeout` · 풀 크기)은 부하 시험 후 확정한다. **값이 비어 있는 채로 `AC-09-3`을 닫지 않는다.**
- 아웃박스 소비자가 셋(실시간 채널 · 알림 · 이벤트 커미션)이 되므로 **소비자별 재시도 정책**을 [`09`](09-notifications.md)에서 확정한다.
