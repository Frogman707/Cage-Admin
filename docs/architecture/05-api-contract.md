# 05. API 계약

---

## 1. 설계 방침

**CRUD REST가 아니라 명령(command) API다.** 원장 도메인은 리소스 생성/수정 의미론이 맞지 않는다. "계좌를 수정한다"가 아니라 "입금한다"가 도메인 언어다.

각 명령은 현행 코드의 실제 함수에서 도출했다. 폐기된 `docs/cage-spec/`의 F-01~F-20 목록이 아니라 **실제 호출 지점**이 근거다.

| 원칙 | 내용 |
|---|---|
| 명령 = 엔드포인트 | 하나의 자금 사건 = 하나의 POST |
| 멱등성 필수 | 모든 상태 변경 요청에 `Idempotency-Key` |
| 응답 = 거래 식별자 + 갱신 잔액 | 클라이언트가 재조회할 필요 없음 |
| 읽기는 별도 | 조회는 REST, 실시간은 WebSocket |

---

## 2. 멱등성 규약

IETF `httpapi` 워킹그룹의 `Idempotency-Key` 헤더 초안(draft-07)을 따른다.

### 2-1. 헤더

```http
POST /v1/accounts/SE7419/deposit HTTP/1.1
Idempotency-Key: "0f8fad5b-d9cb-469f-a165-70867728950e"
Content-Type: application/json
```

초안 명세:
> "Idempotency-Key is an Item Structured Header. Its value MUST be a String."
> "The idempotency key MUST be unique and MUST NOT be reused with another request with a different request payload."
> "It is RECOMMENDED that a UUID or a similar random identifier be used as an idempotency key."

### 2-2. 서버 동작

| 상황 | 동작 | 상태 코드 |
|---|---|---|
| 최초 요청 | 정상 처리 후 응답 저장 | 200 / 201 |
| 같은 키 + 같은 페이로드, 원 요청 **완료** | 저장된 응답 재생 | 원 응답 그대로 |
| 같은 키 + 같은 페이로드, 원 요청 **처리 중** | 충돌 | **409** |
| 같은 키 + **다른** 페이로드 | 키 재사용 위반 | **422** |
| 헤더 누락 | 필수 헤더 없음 | **400** |

초안 근거:
> "If the request is retried, while the original request is still being processed, the resource SHOULD reply with an HTTP 409 status code."
> "If there is an attempt to reuse an idempotency key with a different request payload, the resource SHOULD reply with a HTTP 422 status code."
> "If the Idempotency-Key request header is missing for a documented idempotent operation requiring this header, the resource SHOULD reply with an HTTP 400 status code."

### 2-3. 저장 구조

```sql
CREATE TABLE ledger.idempotency_keys (
  key                 TEXT PRIMARY KEY,
  request_fingerprint BYTEA NOT NULL,        -- SHA-256(method || path || canonical_body)
  state               ledger.idempotency_state NOT NULL,  -- in_progress | completed
  response_status     INT,
  response_body       JSONB,
  transaction_id      BIGINT REFERENCES ledger.transactions,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at          TIMESTAMPTZ NOT NULL
);
```

**보존 기간: 24시간.** 초안이 만료 정책을 문서화하도록 요구한다.
> "The resource SHOULD define such expiration policy and publish it in the documentation."

만료된 키는 새 요청으로 취급된다. 테이블 증가는 `ledger.purge_expired_idempotency()`를 일 1회 돌려 정리한다.

### 2-5. 구현 위치 — 이 규약은 DB가 강제한다

멱등성을 애플리케이션 계층에만 두면 재시도가 유니크 제약 충돌(23505)로 터지고, 규약이 약속한 "저장된 응답 재생"이 성립하지 않는다.

[`ddl/008_post_transaction.sql`](ddl/008_post_transaction.sql)의 두 함수가 위 표를 그대로 구현하며, `009`~`011`의 모든 연산 함수가 첫 줄에서 호출한다.

```sql
v_idem := ledger.begin_idempotent(p_key, ledger.request_fingerprint('deposit', v_args));
IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;   -- 저장된 응답 재생
...
PERFORM ledger.complete_idempotent(p_key, 201, v_body, v_tx.transaction_id);
```

`begin_idempotent()`는 `INSERT ... ON CONFLICT (key) DO UPDATE`로 키를 선점한다. `DO NOTHING`이면 동시 요청의 미커밋 행이 보이지 않아 뒤이은 조회가 빈손이 되지만, `DO UPDATE`는 그 행을 잠그고 상대 트랜잭션이 끝날 때까지 대기한다. **같은 키의 동시 요청이 직렬화된다.**

`request_fingerprint`는 `SHA-256(연산명 ‖ 정규화 args)`다. `jsonb`는 키 정렬·중복 제거가 끝난 정규형이라 `::text` 직렬화가 결정적이다.

오류는 `HINT`에 유형을 실어 보낸다 — API 계층이 `idempotency-key-required` · `idempotency-key-reused` · `request-in-progress`를 그대로 7절의 `type`으로 매핑한다.

### 2-4. 클라이언트 규칙 — 중요

**멱등키는 호출 시점이 아니라 의도 시점에 생성한다.**

현행 코드의 문제:
```js
// index.html:4396 — 호출할 때마다 새 ID
const id = 'ldg_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);
```
버튼을 두 번 누르면 서로 다른 ID로 원장 2건이 생긴다.

신규 규칙: **사용자가 "입금" 버튼을 누른 순간** 키를 만들고, 성공 응답을 받을 때까지 같은 키로 재시도한다.

자연키를 쓸 수 있는 연산은 자연키를 우선한다. [04-posting-rules.md](04-posting-rules.md)의 각 절 말미 참조.

```
game_end:{game_no}                         게임당 1회뿐
mid_settle:{game_no}:{seq}                 순번이 자연 구분
bet:{round_id}:{member_code}:{bet_type}    라운드·회원·베팅종류로 유일
```

---

## 3. 자금 명령 API

전부 `POST`. 전부 `Idempotency-Key` 필수.

### 3-1. 계좌

| 엔드포인트 | 현행 함수 | 분개 |
|---|---|---|
| `POST /v1/accounts/{code}/deposit` | `_doProcessIo` IN `index.html:6493` | [04 §1](04-posting-rules.md) |
| `POST /v1/accounts/{code}/withdraw` | `_doProcessIo` OUT `:6483` | [04 §2](04-posting-rules.md) |
| `POST /v1/transfers` | `_doTransfer` `:6547` | [04 §3](04-posting-rules.md) |
| `POST /v1/branch-transfers` | `_doProcessBranchTransfer` `:4796` | [04 §4](04-posting-rules.md) |
| `POST /v1/wallet-transfers` | **신규** | [04 §12](04-posting-rules.md) |

```json
POST /v1/accounts/SE7419/deposit
{
  "branch": "HANN",
  "amount_minor": 50000000,
  "currency": "PHP",
  "memo": "Cash Deposit",
  "auth": { "method": "pin", "credential": "..." },
  "device_id": "cage-term-03"
}
```

```json
201 Created
{
  "transaction": {
    "external_id": "01931f4e-...",
    "kind": "deposit",
    "business_date": "2026-08-10",
    "recorded_at": "2026-08-10T14:22:31.482+08:00"
  },
  "balances": [
    { "account_code": "SE7419", "kind": "member_deposit",
      "display_balance_minor": 550000000, "currency": "PHP" }
  ],
  "entries": [
    { "account_code": "MAIN-HANN", "kind": "house_cash",
      "amount_minor":  50000000, "category": "deposit_cash" },
    { "account_code": "SE7419",   "kind": "member_deposit",
      "amount_minor": -50000000, "category": "deposit_cash" }
  ]
}
```

**응답에 분개를 그대로 포함한다.** 클라이언트가 무슨 일이 일어났는지 정확히 알 수 있고, 감사 화면이 별도 조회 없이 표시된다.

### 3-2. 게임

| 엔드포인트 | 현행 함수 | 비고 |
|---|---|---|
| `POST /v1/games` | `_doStartGame` `:6783` | 게임 생성 + `chips_outstanding` 계정 생성 + 바이인 분개 |
| `POST /v1/games/{game_no}/buyin` | `_doAddBuyin` `:6747` | 추가 바이인 |
| `POST /v1/games/{game_no}/rolling` | `confirmRollingInput` `:6914` | **자금 이동 없음** |
| `POST /v1/games/{game_no}/mid-settle` | `_doConfirmMidSettle` `:7219` | cc 5항목 + nn 4항목 |
| `POST /v1/games/{game_no}/end` | `_doConfirmGameEnd` `:7437` | 종료 불변식 검사 |
| `POST /v1/games/{game_no}/cancel` | `cancelGame` `:6824` | **역분개** (삭제 아님) |

```json
POST /v1/games/260810001/mid-settle
{
  "cc": { "deposit": 0, "cashout": 30000000, "marker": 0,
          "dealer_tips": 500000, "house_tips": 0 },
  "nn": { "deposit": 100000000, "cashout": 0, "marker": 0, "working": 50000000 },
  "auth": { "method": "pin", "credential": "..." },
  "device_id": "cage-term-03"
}
```

모든 금액은 최소 단위 정수다. 소수점 문자열을 받지 않는다.

### 3-3. 케이지 운영

| 엔드포인트 | 현행 함수 |
|---|---|
| `POST /v1/main-cage/entries` | `writeMainCageEntry` `:4742` |
| `POST /v1/balancing/counts` | 실사 카운트 입력 |
| `POST /v1/balancing/adjustments` | **신규** — 차액을 명시적 거래로 |
| `POST /v1/periods/{business_date}/freeze` | 일일·교대 컷오프 |
| `POST /v1/periods/{business_date}/settle` | 월정산 |

### 3-4. 계좌·직원 관리

| 엔드포인트 | 비고 |
|---|---|
| `POST /v1/accounts` | 계좌 개설 + KYC |
| `PATCH /v1/accounts/{code}` | KYC 수정 (자금 무관) |
| `POST /v1/staff/shift` | 교대 IN/OUT |
| `POST /v1/auth/login` | 세션 발급 |
| `POST /v1/auth/step-up` | PIN·TOTP·출금비밀번호 재인증 |

### 3-5. 4-eyes 승인

승인이 필요한 연산은 **먼저 승인을 만들고, 표를 채운 뒤, 그 승인 ID로 원 요청을 다시 보낸다.**

| 엔드포인트 | 함수 | 비고 |
|---|---|---|
| `POST /v1/approvals` | `identity.op_request_approval` | `payload`는 실행할 요청의 args와 **정확히 같아야** 한다 |
| `POST /v1/approvals/{id}/vote` | `identity.op_cast_vote` | 요청자는 투표할 수 없다. 재인증 필수 |

```json
POST /v1/approvals
{
  "branch": "HANN",
  "subject_kind": "withdrawal",
  "subject_ref": "SE7419",
  "payload": { "branch": "HANN", "account_code": "SE7419",
               "amount_minor": 500000000, "currency": "PHP" }
}
```

**`payload`가 실행 시점의 args와 다르면 실행이 거부된다.** `identity.consume_approval()`이 `jsonb` 동등성으로 대조한다 — 작은 금액을 승인받아 큰 금액을 집행하는 경로가 없다. 승인은 **1회용**이다: 소비되면 `status`가 `approved`로 전이되어 두 번째 사용이 실패한다.

---

## 4. 조회 API

읽기는 일반 REST다. 커서 페이지네이션을 쓴다.

```
GET /v1/accounts/{code}                          계좌 상세 + 표시 잔액
GET /v1/accounts/{code}/entries?cursor=&limit=   계좌 분개 이력
GET /v1/branches/{branch}/balances               지점 전 계정 잔액
GET /v1/branches/{branch}/rolling-total          지점 롤링 누계
GET /v1/branches/{branch}/shift-counters         9개 교대 카운터 (파생값)
GET /v1/games?branch=&status=&cursor=            게임 목록
GET /v1/games/{game_no}                          게임 상세 + 정산 이력 + 롤링
GET /v1/periods/{business_date}                  기간 상태 + 대사 결과
GET /v1/transactions/{external_id}               거래 상세 (분개 포함)
```

> **`shift-counters`는 저장값이 아니라 파생값이다.** 현행 9개 카운터와 같은 형태로 응답하므로 화면 코드가 거의 바뀌지 않는다. [03-ledger-model.md](03-ledger-model.md) 4-3절 매핑표 참조.

---

## 5. 실시간 API

```
WSS /v1/stream
```

인증된 세션 토큰으로 연결하고 채널을 구독한다. 채널 목록은 [02-target-architecture.md](02-target-architecture.md) 4-2절.

```json
→ { "type": "subscribe", "channels": ["ledger:branch:HANN", "games:HANN"] }
← { "type": "subscribed", "channels": ["ledger:branch:HANN", "games:HANN"], "cursor": 184920 }

← { "type": "event", "channel": "ledger:branch:HANN", "seq": 184921,
    "event_type": "transaction.posted",
    "payload": { "external_id": "...", "kind": "deposit", "entries": [] } }
```

### 재연결 규약

Outbox 전달은 at-least-once이므로 **같은 이벤트가 두 번 올 수 있다.**

1. 클라이언트는 마지막으로 처리한 `seq`를 보관한다
2. 재연결 시 `{ "type": "subscribe", "since": 184921 }`로 이어받는다
3. 이미 처리한 `seq`는 무시한다 (멱등 처리)
4. 서버 보관 범위를 넘어선 `since`는 `resync_required`로 응답 → 클라이언트가 REST로 전체 재조회

---

## 6. 인가

모든 요청이 두 단계를 통과한다.

```
1. 인증   세션 토큰 검증 → 주체(직원/회원) 확정
2. 인가   역할(RBAC) + 지점 스코프 + 조작별 재인증 요구 확인
```

### 6-1. 지점 스코프

현행은 클라이언트가 `currentBranch()`를 정하고 전 데이터를 받아 필터링한다. **신규는 서버가 강제한다.**

```
직원의 허용 지점 목록에 없는 branch로 요청 → 403
채널 구독도 동일 → 다른 지점 데이터가 애초에 전송되지 않는다
```

### 6-2. 조작별 재인증

현행 UX를 유지한다.

| 조작 | 현행 | 신규 `auth.method` |
|---|---|---|
| 롤링 입력 · 중간정산 · 게임종료 · 지점이체 | `requestPinAuth()` | `pin` 또는 `totp` |
| 출금 · 이체 · 계좌 바이인 | `requestWithdrawAuth()` | `withdraw_pw` |
| 임계 금액 초과 · 차액 조정 · 월정산 | 없음 | **`approval` (4-eyes)** |

`auth`는 요청 본문에 포함되며 서버가 검증한다. 검증 결과는 `transactions.auth_method`에 기록되어 **어떤 인증으로 승인된 거래인지 감사할 수 있다.**

이 표는 문서가 아니라 코드다. 각 `op_*` 함수가 `p_auth_method`를 직접 검사하고, 통과하지 못하면 `step-up-required`로 거부한다.

### 6-3. 인가는 DB 함수 안에 있다

```sql
PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'ledger.withdraw');
```

모든 연산 함수가 두 번째 줄에서 이것을 호출한다. 직원 상태(`active` · 잠금 해제) · **지점 소속**(`identity.staff_branches`) · 역할 권한(`identity.role_permissions`)을 한 번에 본다. 애플리케이션이 인가를 건너뛸 방법이 없다 — 인가 없이 원장에 쓰는 경로 자체가 존재하지 않기 때문이다.

### 6-4. 임계 금액

`ledger.branch_config.approval_threshold_minor` (지점별, `NULL`이면 임계 없음). 출금·지점이체가 이 값 이상이면 `p_approval_id` 없이는 `approval-required`로 거부된다. 차액 조정과 월정산은 **금액과 무관하게 항상** 승인이 필요하다.

---

## 7. 오류 응답

RFC 9457 Problem Details 형식을 쓴다.

```json
422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.cage.example/problems/insufficient-balance",
  "title": "Insufficient balance",
  "status": 422,
  "detail": "member_deposit[SE7419] would violate its credit-account lower bound",
  "account_code": "SE7419",
  "available_minor": 30000000,
  "requested_minor": 50000000
}
```

### 표준 오류 목록

| `type` | 상태 | 발생 조건 |
|---|---|---|
| `insufficient-balance` | 422 | 잔액 하한 위반 (지연 제약 트리거) |
| `unbalanced-transaction` | 500 | 분개 합 ≠ 0 — **버그다. 알람 대상** |
| `period-frozen` | 409 | 동결된 기간에 기록 시도 |
| `chips-outstanding` | 422 | 칩 미회수 상태에서 게임 종료 |
| `idempotency-key-required` | 400 | 헤더 누락 |
| `idempotency-key-reused` | 422 | 같은 키 다른 페이로드 |
| `request-in-progress` | 409 | 원 요청 처리 중 재시도 |
| `step-up-required` | 401 | 재인증 필요 |
| `approval-required` | 202 | 4-eyes 승인 대기 (거래 미생성) |
| `branch-forbidden` | 403 | 허용되지 않은 지점 |
| `ledger-integrity-halt` | 503 | **대사 위반으로 거래 차단 중** |

> `unbalanced-transaction`이 클라이언트에 도달하는 일은 없어야 한다. 지연 제약 트리거가 커밋을 막으므로 이 오류는 **서버 버그의 신호**다. 발생 시 즉시 알람.

---

## 8. 버전 관리

- 경로에 버전 (`/v1/`)
- 필드 추가는 하위 호환. 필드 삭제·의미 변경은 새 버전
- 금액 필드는 **항상 `_minor` 접미사**를 붙여 단위 혼동을 차단한다

---

## 9. 현행 코드 → API → DB 함수

| 현행 write 함수 | 신규 엔드포인트 | DB 함수 |
|---|---|---|
| `writeLedgerEntry` | **없음** | `ledger.post_transaction` (내부 전용) |
| `applyAccountTransaction` | **없음** | (동상) |
| `_doProcessIo` IN | `POST /v1/accounts/{code}/deposit` | `ledger.op_deposit` |
| `_doProcessIo` OUT | `POST /v1/accounts/{code}/withdraw` | `ledger.op_withdraw` |
| `_doTransfer` | `POST /v1/transfers` | `ledger.op_transfer` |
| `writeBranchTransferEntry` | `POST /v1/branch-transfers` | `ledger.op_branch_transfer` |
| — (신규) | `POST /v1/wallet-transfers` | `ledger.op_wallet_transfer` |
| `_doStartGame` | `POST /v1/games` | `cage.op_open_game` |
| `_doAddBuyin` | `POST /v1/games/{no}/buyin` | `cage.op_add_buyin` |
| `confirmRollingInput` | `POST /v1/games/{no}/rolling` | `cage.op_record_rolling` |
| `_doConfirmMidSettle` | `POST /v1/games/{no}/mid-settle` | `cage.op_settle_game(kind='mid')` |
| `_doConfirmGameEnd` | `POST /v1/games/{no}/end` | `cage.op_settle_game(kind='final')` |
| `cancelGame` · `deleteGameDoc` | `POST /v1/games/{no}/cancel` | `cage.op_cancel_game` |
| `writeMainCageEntry` | `POST /v1/main-cage/entries` | `cage.op_main_cage_entry` |
| `writeCageConfig` (실사) | `POST /v1/balancing/counts` | `cage.op_record_balancing` |
| `writeCageConfig` (컷오프) | `POST /v1/periods/{date}/freeze` | `ledger.op_freeze_period` |
| `writeCageConfig` (월정산) | `POST /v1/periods/{date}/settle` | `ledger.op_settle_period` |
| `shiftLog` 기록 | `POST /v1/staff/shift` | `identity.op_shift_event` |
| 계좌 개설 | `POST /v1/accounts` | `ledger.op_open_account` |
| `writeShiftEvent` / `applyShift` | **폐기.** 카운터는 파생값 | `cage.v_shift_counters` |
| `deleteMainCageEntry` | **폐기.** 정정은 상쇄 이벤트 | — |

**`writeLedgerEntry`에 해당하는 범용 엔드포인트를 만들지 않는다.** 임의 분개를 외부에서 주입할 수 있으면 분개 정의표가 무의미해진다.

이것은 규율이 아니라 권한 설정이다. `ledger_app` 역할은 `ledger.post_transaction()`에 EXECUTE 권한이 **없고**, `ledger.entries`에 INSERT 권한도 **없다**. 위 표의 `op_*` 함수만 호출할 수 있다 ([`ddl/012_roles_and_grants.sql`](ddl/012_roles_and_grants.sql)).

---

**이전:** [04. 분개 정의표](04-posting-rules.md) · **다음:** [06. 보안 아키텍처](06-security.md)
