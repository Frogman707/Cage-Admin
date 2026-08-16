# 10 — 수용 기준 등록부

> **분류**: 실행 계약 (Execution contract)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **입력**: [design-review.md](design-review.md) ~ [design-review-9.md](design-review-9.md) 아홉 회차 · 86건
> **출력처**: 마일스톤별 스펙 (3단계) · 골든 테스트 (`AC-*` ID를 테스트 이름에 그대로 쓴다)

---

## 0. 이 문서가 하는 일

검토 등록부는 **무엇이 틀렸는가**를 쓴다. 이 문서는 **무엇이 참이 되어야 끝난 것인가**를 쓴다.

아홉 회차가 반복해서 잡아낸 병이 하나 있다 — **선언과 실행 경로의 분리.** 타입을 만들고
분개 규칙을 쓰고 권한 문자열까지 정의한 뒤 함수를 만들지 않는다. `DR-50`·`DR-70`·`DR-73`·
`DR-83`이 같은 뿌리의 네 번째 재발이었다. 그 병은 "고쳤다"는 선언으로 낫지 않는다.

그래서 이 문서의 규칙은 하나다.

> **수용 기준은 실행 가능한 검사여야 한다.** SQL 한 문장이거나 골든 테스트 한 개다.
> "명시한다" · "정의한다" · "고려한다"로 끝나는 항목은 수용 기준이 아니다.
> 문서 항목이라면 **그 문서를 읽는 사람이 무엇을 할 수 있게 되는가**로 쓴다.

### 표기

| 표기 | 뜻 |
|---|---|
| `AC-NN-n` | `DR-NN`에서 나온 n번째 수용 기준. 테스트 이름에 그대로 쓴다 |
| **[결정]** | 사업·정책 결정이 선행한다. 결정 없이 기준을 쓰면 지어낸 것이 된다 |
| **[현행]** | 목표 설계가 아니라 **지금 도는 시스템**을 고치는 항목 |
| **[보류]** | 아바타 개선 확정 대기 (A1·A2·A8 플레이어 부분) |

---

## 1. 잔여 집계

아홉 회차 합계 **86건**. 2026-08-15에 **14건 해소** — 차단 12건(`DR-01`·`02`·`03`·`04`·`05`·
`24`·`25`·`26`·`27`·`39`·`50`·`66`) + `ddl` 적용 검증 중 부수 해소 2건(`DR-36` PUBLIC·`audit`
REVOKE, `DR-82` 검증 상태 모순).

**잔여 72건.** 그중 셋(`DR-38`·`DR-84`·`DR-85`)은 목표 설계 쪽만 끝나고 잔여분이 남았다.

| 마일스톤 | 항목 |
|---|---|
| **M0** 기반 확정 | `DR-12` `DR-20` `DR-21` `DR-59` `DR-65` |
| **M1** Ledger + Identity | `DR-06` `DR-09` `DR-14` `DR-15` `DR-19` `DR-22`+`DR-52` `DR-28` `DR-30` `DR-31` `DR-32` `DR-35` `DR-37` `DR-41` `DR-42` `DR-43` `DR-44` `DR-45` `DR-46` `DR-51`+`DR-55` `DR-53` `DR-54` `DR-56` `DR-57` `DR-58` `DR-60` |
| **M2** Cage API | `DR-08` `DR-10` `DR-11` `DR-13` `DR-16` `DR-17` `DR-18` `DR-33` `DR-48` `DR-49` `DR-61` `DR-69` `DR-70`+`DR-83` `DR-80` |
| **M4** 정산 · 파트너 | `DR-07`+`DR-73`+`DR-38`(잔여) `DR-34` `DR-40` `DR-47` `DR-62` `DR-67`+`DR-86` `DR-68` `DR-74` |
| **M5** 이관 · 경화 | `DR-29` `DR-63` `DR-71` `DR-77` |
| **[보류]** A1 · A2 | `DR-75` `DR-78` `DR-79` `DR-81` |
| **문서 · 규약** | `DR-23` `DR-64` `DR-72` `DR-76` |
| **[현행]** 지금 도는 코드 | `DR-84`(잔여) `DR-85`(잔여) |

`+`로 묶은 것은 **같은 결함을 두 방향에서 본 것**이라 수용 기준을 합쳐 썼다.

---

## 2. 결정 선행 — 이것부터 답한다

수용 기준을 쓸 수 없는 항목이 있다. **답을 모르는데 기준을 쓰면 지어낸 것이고, 지어낸 기준은
검증을 통과시켜 놓고 틀린다.** 아래 여섯 개는 사람이 답해야 한다.

| # | 질문 | 막고 있는 것 | 근거 |
|---|---|---|---|
| **U1** | 현재 Firestore 데이터가 실거래인가 데모인가 | M0 종료 · 이관 4~6주 존폐 | `DR-20` `DR-65` |
| **U2** | 다통화를 실제로 쓰는가 | 계정 부트스트랩 · 환전 설계 · 통화 시드 | `DR-06` `DR-41` |
| **U3** | 롤링 요율 커미션 계산 규칙 — 요율 × **무엇** | 파트너 쉐어 op · M4 전체 | `DR-62` `DR-76` |
| **U5** | 규제 관할 | 분할 출금 임계 · 보존 기간 | `DR-15` |
| **B1** | 이벤트 커미션을 계속 운영하는가 | 이벤트 엔티티 설계 전체 | `DR-67` `DR-86` |
| **B2** | 케이지 포인트를 흡수/분리/폐기 중 무엇으로 하는가 | 포인트 op · 잔액 이관 규칙 | `DR-68` `DR-71` |

**U1이 먼저다.** 나머지 전부보다 영향이 크고 확인 비용이 가장 작다 — [`07` §1](07-migration.md)의
판별 절차는 하루면 끝난다. `DR-65`가 그 절차를 반으로 줄이는 단서를 이미 제공한다.

> **U1 판별 시 주의**: [`07` §1](07-migration.md)의 **갱신된 6명 시드 목록**(`Eric` · `Jena` ·
> `Woni` · `Liv` · `Minami` · `May`)을 쓴다. 초판 7명 목록을 쓰면 `Eric`이 "시드에 없는 직원"으로
> 잡혀 **데모 데이터를 실거래로 오판한다.**

---

## 3. M0 — 기반 확정

### DR-12 · 골든 테스트 0건 · CI에 DB 없음 (높음)

**이 항목이 M0의 첫 커밋이다.** 아홉 회차가 잡은 결함 중 상당수는 골든 테스트 한 벌이면
사람이 문서를 읽기 전에 드러났다 — `DR-01`(마감 불가) · `DR-02`(동결 불가) · `DR-04`(23505) ·
`DR-06`·`DR-08`(`no_data_found`) · `DR-11`(누계 오염) · `DR-39`(승인 미발동).

2026-08-15에 PostgreSQL 18.6 컨테이너로 [적용·동작 검증](ddl/README.md)을 1회 수행했다.
**그것은 사람이 손으로 돌린 것이고 CI가 아니다.** 이 항목은 그 검증을 자동화하는 것이다.

**수용 기준**

- `AC-12-1` CI 파이프라인에 PostgreSQL 18 서비스 컨테이너가 있고, `ddl/0*.sql`을 순차 적용하는
  잡이 **모든 PR에서** 돈다. 적용 실패는 머지를 막는다.
- `AC-12-2` **분개 계약 테스트** — [`04-posting-rules.md`](04-posting-rules.md)의 각 절마다
  테스트가 하나씩 있다. `op_*`를 호출하고 `ledger.entries`의 `(account_kind, sign, category)`
  집합을 그 절의 표와 **정확히** 비교한다. 절 하나에 테스트가 없으면 잡이 실패한다.
- `AC-12-3` **불변식 테스트** — I1~I8 각각에 대해 "위반 시도 → 예외" 테스트가 최소 1건.
  예외 없이 통과하면 실패로 처리한다.
- `AC-12-4` **전 경로 시나리오** — ① 개설→바이인→롤링→중간정산→종료→마감 ② 개설→취소
  ③ 실사 차액→해소→마감 ④ 커미션 정산→역분개. 각 시나리오 종료 시
  `ledger.v_integrity_status`의 **모든 행이 `violations = 0`.**
- `AC-12-5` **드리프트 검사** — 매 실행 끝에 `ledger.v_check_view_security`와
  `ledger.v_check_public_execute`가 각각 0행.
- `AC-12-6` **CI 잡이 조용히 건너뛰지 않는다.** 경로 필터·조건부 실행으로 스킵되면 그 사실이
  머지 차단 신호가 된다. ([`07` §7](07-migration.md)이 기록한 Track A 인시던트 — 경로 필터
  누락으로 `firestore.rules` 변경이 배포되지 않았다.)

**검증**

```sql
-- AC-12-2 보조: 문서·표·함수 셋이 같은 표를 표현하는지 기계 대조
SELECT kind, category, account_kind, sign FROM ledger.posting_rules ORDER BY 1,2,3,4;
-- 이 결과와 04 의 표를 테스트가 대조한다. 사람이 눈으로 보지 않는다.
```

> `04`의 첫 줄이 **"이 표가 구현 계약이다"** 라고 선언한다. `AC-12-2`가 없으면 그 문장은
> 검증되지 않는 주장이다.

---

### DR-20 · U1 · U2 미확정 상태로 M0 종료 불가 (중간)

**수용 기준**

- `AC-20-1` [`08-adr.md`](08-adr.md) 미확정 5항목(U1~U5) 각각에 **결정 · 결정일 · 결정자**가
  기록돼 있다. "검토 중"은 결정이 아니다.
- `AC-20-2` U1·U2가 결정되기 전에는 M0 종료 판정을 내리지 않는다. 나머지 셋은 각 항목이
  막는 마일스톤 착수 전까지로 늦출 수 있다 — **그 유예도 명시적으로 기록한다.**

---

### DR-21 · M11 계좌 마스터 수집 실행 계획 부재 (중간)

[`07` §2-3](07-migration.md)이 문제를 정확히 쓰고 "수집 방법은 이 문서 범위 밖"으로 끝난다.
**담당자 · 기한 · 도구가 비어 있고, 이것이 원장 이관의 선행 조건이다.** 코드 문제가 아니라
사람 문제라 리드타임이 길다 — 단말이 몇 대인지부터 모른다.

**수용 기준**

- `AC-21-1` 케이지 어드민에 로그인해 쓴 **단말(브라우저 프로필) 전수 목록**이 있고, 각 항목에
  담당자와 접근 가능 여부가 붙어 있다.
- `AC-21-2` 내보내기 도구가 존재한다 — `DB.accounts`를 단말 식별자·수집 시각과 함께 JSON으로
  덤프하는 브라우저 콘솔 스니펫. 배포가 필요 없어야 한다.
- `AC-21-3` 수집 결과를 병합한 결과물과 **충돌 목록**이 함께 있다. 자동 병합하지 않는다 —
  같은 계좌 코드에 다른 값이 있으면 사람이 판정한다.
- `AC-21-4` 병합 결과의 계좌 집합이 Firestore `ledger`에 등장하는 `accountId` 고유값 집합을
  **덮는다.** 덮지 못하는 `accountId`는 목록으로 남기고 `DR-83`(해지로 원장이 삭제된 계좌)과
  대조한다.

---

### DR-59 · `SET CONSTRAINTS ALL IMMEDIATE` 경고 부재 (낮음)

[references.md](references.md):19가 `SET CONSTRAINTS`를 인용하면서 사용처를 `ddl/README`로
가리키는데 거기에 그 명령이 없다. **인용이 떠 있는 것 자체는 사소하다. 문제는 그 자리에 있어야
할 경고가 없다는 것이다.** I1(분개 균형)·I2(잔액 하한)가 전부 `DEFERRABLE INITIALLY DEFERRED`
제약 트리거이므로, 세션이 이 명령을 실행하면 **설계 전체가 한 문장으로 무력화된다** — 다중 분개
거래가 첫 분개에서 실패한다.

**수용 기준**

- `AC-59-1` [`ddl/README.md`](ddl/README.md)에 이 명령 금지가 명문화돼 있고, **왜** 금지인지
  (지연 제약 트리거 I1·I2가 삽입 순서 의존이 된다) 함께 적혀 있다.
- `AC-59-2` [references.md](references.md)의 `SET CONSTRAINTS` 행이 그 문단을 가리킨다.
- `AC-59-3` 골든 테스트에 `SET CONSTRAINTS ALL IMMEDIATE` 후 다중 분개 거래가 실패하는 것을
  **의도된 동작으로** 확인하는 테스트가 있다. 이 명령이 위험하다는 사실이 테스트로 남는다.

---

### DR-65 · 데모/실거래 판별 단서가 이미 있는데 쓰이지 않는다 (낮음)

[`01`:457](01-current-system.md) — 데모 시드(`seedDemoData`)만 `balanceTotals` 갱신 함수를
거치지 않고 `batch.set()`으로 직접 쓴다. 즉 **`memberLedger` 항목 중 `balanceTotals`에
반영되지 않은 것은 데모 시드다.**

**수용 기준**

- `AC-65-1` [`07` §3-1](07-migration.md) 1단계(조사)에 이 판별이 항목으로 있다.
- `AC-65-2` 판별 쿼리를 실행한 결과가 기록돼 있다 — `memberLedger` 전체 대비 `balanceTotals`
  미반영 비율.
- `AC-65-3` **한계가 함께 기록돼 있다.** 이 단서는 파트너·플레이어 측(`memberLedger`)에만
  적용되고 케이지 측(`ledger`)에는 없다. 듀얼라이트 이전 데이터도 `balanceTotals`에 없으므로
  **시드와 구(舊)데이터가 같은 쪽에 떨어진다.** 이 한계를 적지 않으면 부분 답을 전체 답으로
  오독한다.

---

## 4. M1 — Ledger + Identity

### DR-06 + DR-41 · 다통화가 반쪽이다 (높음 · 높음) **[결정 U2]**

`ledger.currencies`에 PHP·USD·KRW 3종이 시드돼 있는데 하우스 계정 부트스트랩은 **PHP만**
만든다. `op_deposit(p_currency := 'USD')`는 `house_account_id`에서 `no_data_found`로 터진다.
그리고 **탐지되지 않는다** — R1은 통화별로 나눠 합산하므로 USD 쪽이 통째로 비뚤어져도 PHP가
맞으면 초록불이다.

**U2 = "안 쓴다"인 경우**

- `AC-06-1` `ledger.currencies`가 PHP 1행이다.
- `AC-06-2` `op_*`의 `p_currency` 기본값이 제거되고 상수로 고정됐거나 인자 자체가 사라졌다.
- `AC-06-3` `entries.currency` 컬럼은 남는다 — 확장 여지. 컬럼 주석에 그 사실이 적혀 있다.

**U2 = "쓴다"인 경우**

- `AC-06-4` 하우스 계정 부트스트랩이 `currencies × account_kind`로 돌아, 임의 통화 × 임의
  하우스 종류 조합에 계정이 존재한다.
- `AC-06-5` 계정 개설이 **상대 하우스 계정 존재를 강제한다.** 없으면 개설이 거부된다.
- `AC-06-6` `tx_kind`에 `fx_exchange`가 있고 [`04`](04-posting-rules.md)에 환전 분개가 있다.
  통화별 합이 각각 0이어야 하므로 `fx_position` 계정을 경유하는 **2분개 쌍**이다.
- `AC-06-7` 환율 스냅샷 테이블(`ledger.fx_rates`)이 있고 환전 거래가 사용 환율을 참조한다.
- `AC-06-8` R1이 통화별 초록불에 속지 않는다 — **거래되는 통화 집합에 상대 계정이 없는 조합**을
  잡는 검사가 `v_integrity_status`에 있다.

**검증 (어느 쪽이든)**

```sql
-- 통화 × 하우스 계정 종류의 곱집합 대비 실제 계정 — 빈칸이 있으면 그 통화는 쓸 수 없다
SELECT c.code, k.kind
  FROM ledger.currencies c
 CROSS JOIN (SELECT unnest(ARRAY['house_cash','house_gaming','suspense']::ledger.account_kind[]) kind) k
 WHERE NOT EXISTS (SELECT 1 FROM ledger.accounts a WHERE a.currency=c.code AND a.kind=k.kind);
-- 기대: 0행
```

---

### DR-09 · `409 request-in-progress`가 도달 불가 + 무한 대기 (높음)

`begin_idempotent()`의 `ON CONFLICT DO UPDATE`는 행을 잠그고 **상대 트랜잭션이 끝날 때까지
대기한다.** 상대가 커밋하면 저장된 응답이 재생되고, 롤백하면 INSERT가 성공한다. `in_progress`가
**커밋된 채 남는 경로가 없으므로** 409는 발생하지 않는다. 실제 동작은 커넥션을 붙잡는 것이고,
원 요청이 느리면 재시도가 쌓여 **커넥션 풀이 마른다.**

**수용 기준**

- `AC-09-1` `begin_idempotent()` 진입부에 `SET LOCAL lock_timeout`이 있고
  `lock_not_available`(`55P03`)을 잡아 `request-in-progress`로 매핑한다.
- `AC-09-2` 동시 요청 테스트: 같은 멱등키로 두 커넥션이 동시에 호출하면 두 번째가
  **타임아웃 시간 안에** `request-in-progress`를 받는다. 무한 대기하지 않는다.
- `AC-09-3` [`02-target-architecture.md`](02-target-architecture.md)에 **운영 파라미터 절**이
  있고 `statement_timeout` · `lock_timeout` · 커넥션 풀 크기가 값과 함께 적혀 있다.
  (자금 API에 `statement_timeout`은 이 문제와 무관하게 필수다.)
- `AC-09-4` [`05` §2-2](05-api-contract.md)의 409 행에 "잠금 타임아웃 기준"임이 명시돼 있다.

---

### DR-14 · `op_deposit`에 재인증 요구가 없다 (중간)

> **선행 완료.** `DR-03`이 해소되어 이제 앱이 인증 방식을 참칭할 수 없다.

2026-08-15 기준 모든 `op_*`가 `p_step_up_id`를 요구하므로 `AC-14-1`은 이미 참이다.

- `AC-14-1` ✅ `op_deposit`이 스텝업 토큰 없이는 실행되지 않는다.
  (검증 완료 — NULL 토큰 → `step-up-required`)
- `AC-14-2` `op_deposit`이 요구하는 최소 방식이 `pin` 이상임이 함수에 명시돼 있다.
  4-eyes 임계는 적용하지 않는다 — 입금은 손님에게 유리한 방향이다.
- `AC-14-3` [`06` §3-4](06-security.md) 조작별 재인증 표에 입금 행이 있다.

---

### DR-15 · 분할 출금(structuring) 방어 없음 (중간) **[결정 U5]**

`require_approval_if_over_threshold()`는 **건별 금액**만 본다. 임계가 1,000,000이면 999,999씩
나눠 4-eyes를 영구 회피할 수 있다 — 같은 계좌 · 같은 직원 · 같은 5분 안이어도 통과한다.
카지노 자금 시스템의 **표준 위협 모델**(AML/CTR)인데 [`06`](06-security.md) 전체에 개념이 없다.

**수용 기준**

- `AC-15-1` `ledger.branch_config`에 `approval_window INTERVAL`과
  `approval_cumulative_minor BIGINT`가 있다. **`DR-39`의 교훈을 반복하지 않는다** — 누적 검사를
  끄려면 명시적 센티널을 넣어야 하고, NULL로 조용히 꺼지지 않는다.
- `AC-15-2` 판정이 `건별 임계 OR (윈도 안 같은 계좌 출금 합 + 이번 건) >= 누적 임계`다.
- `AC-15-3` **누적 검사 전에 해당 계정 잔액 행을 `FOR UPDATE`로 잠근다.** 지금
  `op_withdraw`는 `post_transaction` **호출 전에** 임계를 검사하므로, 잠그지 않으면 두 요청이
  동시에 통과한다 — check-then-act다.
- `AC-15-4` 동시성 테스트: 임계 직하 금액 두 건을 동시에 호출하면 하나만 통과한다.
- `AC-15-5` 임계값과 윈도가 **U5(규제 관할) 결정에서 왔다는 근거**와 함께 기록돼 있다.

---

### DR-19 · 파생 멱등키가 규약 밖에 있다 (중간)

`op_record_balancing`의 `키||':adj'`와 `op_cancel_game`의 `키||':'||tx_id`가
`transactions.idempotency_key`에는 들어가지만 `ledger.idempotency_keys`에는 행이 생기지 않는다.
**"모든 자금 거래는 `idempotency_keys`에 행을 갖는다"가 참이 아니다** — 운영 조회
(`key → transaction_id`)가 이 거래들을 찾지 못한다.

**수용 기준**

- `AC-19-1` 파생 키 규칙이 [`05` §2](05-api-contract.md)에 명시돼 있다 — 접두사 규약과
  부모-자식 관계.
- `AC-19-2` `post_transaction`이 `p_parent_key TEXT`를 받아 부모-자식 관계를
  `idempotency_keys`에 기록한다.
- `AC-19-3` 운영 조회 하나로 **"이 요청이 만든 거래 전부"** 를 찾을 수 있다.

**검증**

```sql
SELECT t.idempotency_key FROM ledger.transactions t
 WHERE NOT EXISTS (SELECT 1 FROM ledger.idempotency_keys k WHERE k.key = t.idempotency_key);
-- 기대: 0행
```

---

### DR-22 + DR-52 · 분개 0개 거래가 스키마 그물 밖이다 (낮음 · 중간)

`assert_transaction_balanced`는 `AFTER INSERT ON ledger.entries`다 — **분개가 한 행도 없으면
트리거가 발화하지 않는다.** 안의 `v_legs < 2` 검사는 분개가 1개일 때만 도는 반쪽 그물이다.
커밋 시점 그물인 `transactions_sealed`는 `hash IS NULL`만 보는데, `entries_canon`이
`COALESCE(string_agg(...), '')`이므로 **분개 0개도 정상 봉인된다.**

만들어지면 어디에도 안 잡힌다 — R1은 기여가 0이라 초록색, `v_transaction_detail`은
`JOIN ledger.entries` INNER라 감사 뷰에서 안 보인다. **체인에는 있고 감사에는 없는 행**이 남는다.

**수용 기준**

- `AC-22-1` `assert_transaction_sealed()`가 커밋 시점에 분개 수 `>= 2`를 검사한다.
  새 트리거를 만들지 않는다 — 이미 도는 지연 트리거에 쿼리 하나를 더한다.
- `AC-22-2` 분개 0개 거래 삽입 시도가 커밋에서 실패한다 (골든 테스트 I1).
- `AC-22-3` 분개 1개 거래도 같은 지점에서 실패한다.
- `AC-22-4` [`03` §7](03-ledger-model.md)의 I1 강제 수단 목록에 "분개 수 ≥ 2"가 있다.

---

### DR-28 · R2가 INNER JOIN — 잔액 행 없는 계정을 놓친다 (높음)

`v_check_balance_projection`이 `JOIN ledger.account_balances`를 INNER로 건다. **잔액 행이 없는
계정은 결과에서 통째로 빠진다.** 그런데 "분개는 있는데 잔액 행이 없다"는 정확히 프로젝션이
깨진 대표 사례다 — **R2가 자기가 잡아야 할 것을 못 잡는다.**

**수용 기준**

- `AC-28-1` R2가 `LEFT JOIN` + `COALESCE(b.balance_minor, 0)`을 쓴다.
- `AC-28-2` 잔액 행을 지운 계정이 R2에서 `variance_minor <> 0`으로 드러난다 (골든 테스트).
- `AC-28-3` **대사 계층 전체를 "무엇을 못 보는가"로 한 번 훑은 기록이 있다.** R1은 통화별로,
  R2는 조인으로, `DR-41`은 통화 부트스트랩으로 각각 사각을 만들었다 — 같은 유형이 셋이다.

---

### DR-30 · 승인 · 교대 연산 3종에 멱등키 없음 (높음)

자금 연산은 전부 첫 인자가 `p_idempotency_key`인데 `op_request_approval` · `op_cast_vote` ·
`op_shift_event` 셋만 빠졌다.

**승인 요청 중복이 특히 나쁘다.** 같은 출금 건에 승인 두 개가 생기면 각각 2표를 모아
**같은 요청을 두 번 실행할 수 있는 승인권**이 된다. `consume_approval()`은 승인 하나를 1회용으로
소비하지만, **승인이 둘이면 소비도 두 번 가능하다.**

**수용 기준**

- `AC-30-1` 세 함수 모두 `p_idempotency_key TEXT`를 첫 인자로 받고 `begin_idempotent()`를 탄다.
- `AC-30-2` `op_cast_vote`의 자연 멱등키가 `vote:{approval_id}:{staff_id}`다.
- `AC-30-3` 같은 승인 요청을 두 번 보내면 두 번째가 **캐시 재생**이지 새 승인 생성이 아니다.
- `AC-30-4` `op_cast_vote` 중복 호출이 raw `23505`가 아니라 매핑된 오류를 낸다.
- `AC-30-5` [`05` §7](05-api-contract.md) 오류 표에 그 코드가 있다.

**검증**

```sql
-- 같은 subject_ref 에 pending 승인이 둘 이상이면 승인권이 복제됐다
SELECT subject_kind, subject_ref, count(*) FROM identity.approvals
 WHERE status = 'pending' GROUP BY 1,2 HAVING count(*) > 1;
-- 기대: 0행
```

---

### DR-31 · `approval_votes`에 RLS 없음 (중간)

`identity.approvals`에만 지점 스코프 정책이 붙어 있다. `approval_votes`는 `ledger_app`에
SELECT가 부여되는데 RLS가 꺼져 있어 **전 지점의 승인 투표 내역이 조회된다.**

- `AC-31-1` `identity.approval_votes`에 RLS가 켜져 있고 지점 스코프 정책이 붙어 있다.
  판정은 `approvals`를 경유한다 — `cage.rolling_events`가 게임을 경유하는 것과 같은 패턴이다.
- `AC-31-2` 다른 지점 소속 세션에서 그 지점 투표가 0행으로 보인다 (골든 테스트).

---

### DR-32 · `identity.sessions`에 컬럼 무제한 UPDATE 권한 (중간)

컬럼 제한이 없어 **`staff_id`와 `refresh_hash`를 임의로 바꿀 수 있다.** 앱 버그 하나로 세션이
다른 직원에게 귀속되고, 그 ID가 그대로 `app.staff_id`와 감사 로그에 실린다.

- `AC-32-1` `ledger_app`의 `sessions` UPDATE가 `(revoked_at, revoked_reason)` 두 컬럼으로
  좁혀져 있다.
- `AC-32-2` 리프레시 토큰 회전이 "기존 행 revoke + 새 행 INSERT"로 표현된다 — `refresh_family`
  설계가 이미 그 형태를 전제한다. `sessions`가 append-only가 되면 재사용 감지 이력도 함께 남는다.
- `AC-32-3` `ledger_app`으로 `UPDATE identity.sessions SET staff_id = ...`가 거부된다.

**검증**

```sql
SELECT a.attname FROM pg_attribute a
 WHERE a.attrelid = 'identity.sessions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
   AND has_column_privilege('ledger_app', a.attrelid, a.attnum, 'UPDATE');
-- 기대: revoked_at · revoked_reason 둘뿐
```

---

### DR-35 · `totp_used` 정리 경로 없음 (낮음)

DELETE 권한을 가진 역할이 **아무도 없다.** 직원 × 30초 스텝으로 행이 무한 증가한다.
RFC 6238 재사용 차단은 허용 창(±1 스텝) 밖의 기록을 보관할 이유가 없다.

- `AC-35-1` `identity.purge_used_totp()`가 존재하고 보존 창 밖 행을 지운다.
- `AC-35-2` EXECUTE가 **전용 유지보수 역할에만** 있다. `ledger_app`에는 없다.
- `AC-35-3` [`ddl/README.md`](ddl/README.md) 운영 배치 표에 주기와 함께 등재돼 있다.

---

### DR-37 · R1에 지점 · 기간 분해가 없다 (중간)

`v_check_double_entry`가 통화별 총합 하나만 준다. **위반이 떠도 조사 시작점이 없다.**

- `AC-37-1` R1이 `(branch, business_date, currency)`로 분해된다.
- `AC-37-2` `v_integrity_status`의 R1 집계는 그 분해를 접어 유지한다 — 상위 뷰 형태는 안 바뀐다.
- `AC-37-3` 불균형 거래를 주입하면 R1이 **그 지점·그 영업일 행**을 낸다 (골든 테스트).

---

### DR-42 · 물리 칩 재고가 대사 대상이 아니다 (높음)

`cage.chip_inventory_events`는 append-only인데 R1~R7 어디에도 없다. **금고에서 칩을 꺼내고
게임에 싣지 않아도, 게임에 실었는데 금고 기록을 남기지 않아도 어떤 알람도 울리지 않는다.**
케이지에서 자금이 실제로 유실되는 경로가 기록은 되지만 검증되지 않는다.

> **R 번호 주의.** R8(체인 앵커)·R9(머클 앵커)는 2026-08-15에 `DR-26`이 이미 썼다.
> 이 항목은 **R10**을 쓴다. §11 대장 참조.

- `AC-42-1` `cage.v_check_chip_inventory`가 존재하고 `WITH (security_invoker = true)`가 붙어
  있다.
- `AC-42-2` 검사식이 **금고 순유출 = 미상환 칩 잔액**이다. 지점별로 낸다.
- `AC-42-3` `ledger.v_integrity_status`에 `R10_chip_inventory` 행이 있다.
- `AC-42-4` `chip_type(nn/cc) ↔ entry_category` 매핑이 [`04`](04-posting-rules.md)에 확정돼
  있고 뷰가 그 매핑을 쓴다. **매핑 확정이 선행한다.**
- `AC-42-5` `chip_inventory_events.reason`이 자금 분류 ENUM(`ledger.entry_category`) 재사용을
  그만두고 전용 ENUM을 쓴다 — 또는 재사용이 의도임을 컬럼 주석에 명시한다. 둘 중 하나를
  **명시적으로** 고른다.

---

### DR-43 · `games.chips_account_id`가 종류 · 소유자 · 통화와 결속되지 않는다 (중간)

FK만 걸려 있다. 그 계정이 `chips_outstanding`인지, `game_party_id` 소유인지, `games.currency`와
통화가 같은지 **아무것도 검사하지 않는다.** `UNIQUE`도 없어 두 게임이 한 계정을 가리킬 수 있다.
지금은 `op_open_game`이 항상 옳게 만들지만 **검사가 데이터가 아니라 코드에 있다.**

- `AC-43-1` 트리거 하나가 세 가지를 함께 검사한다 — `kind = 'chips_outstanding'`,
  `party_id = game_party_id`, `currency = games.currency`.
- `AC-43-2` `UNIQUE (chips_account_id)`가 있다.
- `AC-43-3` 결속을 깬 UPDATE 시도가 거부된다 (골든 테스트 3건 — 종류·소유자·통화 각각).

---

### DR-44 · `ledger.parties.status`를 어떤 연산도 검사하지 않는다 (중간) **[결정]**

`post_transaction`이 보는 것은 `accounts.status`뿐이다. **주체를 `closed`로 바꿔도 거래는
그대로 통과한다.**

- `AC-44-A` `post_transaction`의 계정 상태 검사에 주체 상태 검사가 나란히 추가된다. **또는**
- `AC-44-B` 주체 상태 변경이 계정 상태로 전파되는 트리거가 있다.
- `AC-44-1` **어느 쪽을 골랐는지가 ADR로 기록돼 있다.** 둘 다 안 하는 것은 답이 아니다.
- `AC-44-2` `suspended` 주체의 계정에 대한 자금 연산이 거부된다 (골든 테스트).

---

### DR-45 · 트리거의 `FOR SHARE`가 잠금 승격 함정 (중간)

`assert_game_ongoing()`이 게임 행을 `FOR SHARE`로 잡고, 같은 트랜잭션의 AFTER 트리거
`apply_rolling_projection()`이 그 행을 `UPDATE`한다. 전형적인 **잠금 승격**이며 두 트랜잭션이
동시에 하면 교착이다. 지금 교착이 나지 않는 이유는 `cage.lock_ongoing_game()`이 진입부에서
`FOR UPDATE`를 먼저 잡기 때문이다 — **규율로만 가려져 있다.**

- `AC-45-1` `assert_game_ongoing()`이 `FOR SHARE`를 쓰지 않는다 — `FOR UPDATE`로 통일하거나
  잠금 없이 읽는다.
- `AC-45-2` 규율(`lock_ongoing_game()` 선행 호출)이 함수 주석이 아니라 **구조로** 강제된다.
- `AC-45-3` 같은 게임에 두 트랜잭션이 동시에 롤링을 넣는 테스트가 교착 없이 직렬화된다.

---

### DR-46 · 분개는 불변인데 계정 정의는 가변 (중간)

`ledger.accounts`와 `ledger.parties`에 `deny_mutation` 트리거가 없다. `accounts.currency`나
`accounts.party_id`를 UPDATE하면 **이미 쌓인 모든 분개의 의미가 소급해서 바뀐다.**
원장 불변성이 분개 행에서만 성립하고 그 분개가 가리키는 좌표에서는 성립하지 않는다.

- `AC-46-1` **분개가 하나라도 달린 계정**에 대해 `currency` · `party_id` · `kind` 변경이
  거부된다.
- `AC-46-2` `status` 변경은 허용된다 — 정상 운영이다.
- `AC-46-3` `parties`의 `code` · `party_type` 변경에도 같은 규칙이 적용된다.

---

### DR-51 + DR-55 · `posting_rules` 와일드카드와 표 자신의 불변성 (높음 · 중간)

`opening_balance`의 기초 잔액 규칙이 `account_kind` 14종 × 부호 2 = **28행**을 넣고, 역분개
생성기의 `WHERE`가 `reversal`·`game_cancel`만 제외하므로 **그 28행이 세 kind로 전파된다.**
결과: `category='opening_balance'`를 쓰면 **어떤 계정 종류든 어떤 방향으로든 통과한다.**
`004`가 직접 예로 든 "합은 0이지만 돈이 창조되는" 조합이 정확히 그 세 kind에서 합법이다.

**등급을 올리는 것은 R7이 같은 표를 기준으로 쓴다는 점이다.** 트리거를 우회한 공격자가 고를
kind가 바로 그 셋이다 — **예방과 탐지 두 층이 같은 지점에서 같이 실패한다.** 그리고 표 자신에는
불변성 가드가 없어(`DR-55`) **자기 자신을 검증하지 않는 기준 데이터**다.

> `DR-38`을 (a)안(op 추가)으로 해소하면 차단으로 승격한다고 4차가 썼다. 2026-08-15에
> `op_load_opening_balance()`가 생겼으므로 **이미 승격 조건에 들어와 있다.**

- `AC-51-1` 역분개 생성기의 `WHERE`가 `opening_balance`도 제외한다.
- `AC-51-2` `opening_balance` 규칙이 **잔액이 있는 계정 종류로만** 좁혀져 있다 —
  `house_cash` · `member_deposit` · `marker_receivable` · `chips_outstanding` ·
  `player_wallet` · `opening_equity`.
- `AC-51-3` `ledger.posting_rules`에 불변성 트리거가 걸려 있다 (`DR-55`). `004` 안에서는
  트리거 생성을 시드 INSERT 뒤로 옮긴다.
- `AC-51-4` R7이 표의 **해시까지** 검증한다 — `ledger.schema_fingerprints`에 표 전체 해시를
  저장하고 대사가 매번 대조한다. 그래야 "기준이 바뀌지 않았다"가 대사에 들어간다.
- `AC-51-5` **역분개를 표로 검증하지 않는다.** 역분개의 정당성은 "원 거래 분개의 정확한 부호
  반전인가"이지 "(category, account_kind, sign) 조합이 표에 있는가"가 아니다. 트리거에 예외를
  두고 **R11 — 역분개 거래의 분개가 원 거래와 정확히 반대인가**를 추가한다. 그러면
  `reversal`·`game_cancel` 행 자체가 표에서 사라진다.

**검증**

```sql
SELECT kind, count(*) AS rules FROM ledger.posting_rules GROUP BY kind ORDER BY rules DESC;
-- reversal · game_cancel · opening_balance 가 28행 이상이면 와일드카드가 살아 있다
```

---

### DR-53 · `reverses_tx_id`와 `kind`가 묶여 있지 않다 (중간)

`kind='deposit'` 거래가 `reverses_tx_id`를 채우면 부분 UNIQUE 인덱스의 슬롯을 선점한다.
이후 그 거래에 대한 **진짜 역분개는 영구히 불가능하다.** 되돌릴 수 없는 봉쇄다.

- `AC-53-1` `CHECK (reverses_tx_id IS NULL OR kind IN ('reversal', 'game_cancel'))`가 있다.
- `AC-53-2` `kind='deposit'` + `reverses_tx_id` 조합 삽입이 거부된다.

---

### DR-54 · 멱등성 키에 주체 스코프가 없다 (중간)

`key TEXT PRIMARY KEY` — 전역 단일 네임스페이스다. `request_fingerprint`가
`SHA-256(method || path || canonical body)`이므로 **행위자를 포함하지 않는다.** 같은 조작을
같은 인자로 요청한 **다른 지점 스태프가 앞사람의 응답** — 거래 `external_id`, 잔액 — 을 받는다.
지점 RLS는 여기서 도움이 안 된다: `idempotency_keys`는 RLS 대상이 아니고, 응답은 이미 JSONB로
굳어 있어 정책이 필터할 행 구조가 아니다.

- `AC-54-1` `ledger.request_fingerprint()`가 행위자를 지문에 포함한다.
- `AC-54-2` 같은 키·같은 인자를 다른 행위자가 호출하면 캐시 재생이 아니라 거부된다.
- `AC-54-3` [`05` §2](05-api-contract.md)에 멱등키 스코프가 명시돼 있다 — IETF 초안은
  "유일해야 한다"고만 쓰고 **무엇에 대해 유일한지는 규정하지 않는다.** 스코프는 구현 책임이다.

---

### DR-56 · `TRUNCATE`가 어디에서도 막히지 않는다 (낮음)

`entries_immutable`은 `FOR EACH ROW` 트리거다 — **행 트리거는 `TRUNCATE`에 발화하지 않는다.**
`REVOKE TRUNCATE`도 없다. append-only 원장의 실질적 우회 경로는 `DELETE`가 아니라 이쪽이고,
`session_replication_role` 우회보다 쉽다 — 세션 설정을 바꿀 필요조차 없다.

- `AC-56-1` `ledger.entries` · `ledger.transactions` · `cage.rolling_events` ·
  `cage.main_cage_events` · `cage.chip_inventory_events`에
  `BEFORE TRUNCATE ... FOR EACH STATEMENT` 트리거가 있다.
- `AC-56-2` 각 테이블에 `TRUNCATE` 시도가 거부된다 (골든 테스트).
- `AC-56-3` 소유자는 트리거를 지울 수 있으므로 완전한 방어가 아니라는 사실이 주석에 있다.
  **사고성 `TRUNCATE`는 막고 고의는 흔적을 남긴다** — 그것이 이 방어의 정확한 범위다.

---

### DR-57 · `device_id` · `idempotency_key`에 컬럼 제약이 없다 (낮음)

둘 다 `TEXT NOT NULL`뿐이라 `''`가 유효한 값이다. `post_transaction`이 정상 경로에서 막지만
**이 파일의 다른 모든 불변식은 스키마에 있는데 이 둘만 함수에 있다.** 빈 멱등키가 한 번 들어가면
UNIQUE이므로 **이후 모든 빈 키 요청이 실패**한다 — 사소한 자기 DoS다.

- `AC-57-1` `CHECK (length(device_id) BETWEEN 1 AND 255)`.
- `AC-57-2` `CHECK (length(idempotency_key) BETWEEN 1 AND 255)`.
- `AC-57-3` 빈 문자열 삽입이 스키마 레벨에서 거부된다 — 함수를 우회해도 막힌다.

---

### DR-58 · 기간 행에 개설자 · 시각 순서 검사가 없다 (낮음) **[결정]**

- `AC-58-1` `periods_status_timestamps` CHECK에 `frozen_at >= opened_at`,
  `settled_at >= frozen_at`이 추가돼 있다.
- `AC-58-2` `opened_by`의 부재가 **의도임이 명시**돼 있다 — `ensure_period_row()`가 첫 거래
  시 자동 생성하므로 "사람이 없다"가 맞는 답일 수 있다. 그렇다면 컬럼 대신 주석으로 적는다.
  **지금은 비대칭이 의도인지 누락인지 읽어서 알 수 없다.**

---

### DR-60 · 지점 추가 절차가 5곳에 흩어져 있다 (중간)

지점 하나를 추가하려면 `001`(ENUM) · `001`(`branch_config`) · `004`(`chain_heads`) ·
`003`(하우스 계정) · `identity`(스태프 배정) 다섯 곳을 손대야 한다. **`chain_heads`를 빠뜨리면
그 지점의 첫 거래에서 터진다** — 스키마 적용 시점이 아니라 운영 중이다.

- `AC-60-1` 지점 추가 절차가 **한 곳에** 문서화돼 있다.
- `AC-60-2` 다섯 항목 중 누락을 잡는 검사가 있다.
- `AC-60-3` 가능하면 함수 하나로 묶는다 — `ledger.provision_branch(p_branch, ...)`.
  ENUM 추가만 별도로 남는다.

**검증**

```sql
-- 지점 프로비저닝 누락 탐지: ENUM 값마다 네 가지가 다 있는가
SELECT b AS branch,
       EXISTS (SELECT 1 FROM ledger.branch_config    WHERE branch = b) AS has_config,
       EXISTS (SELECT 1 FROM ledger.chain_heads      WHERE branch = b) AS has_chain_head,
       EXISTS (SELECT 1 FROM ledger.parties          WHERE home_branch = b
                 AND party_type = 'house')                             AS has_house_party,
       EXISTS (SELECT 1 FROM identity.staff_branches WHERE branch = b) AS has_staff
  FROM unnest(enum_range(NULL::ledger.branch_code)) AS b;
-- 기대: 전 열 true
```

---

## 5. M2 — Cage API

### DR-08 · 파트너 · 회원지갑 · 포인트 계정 개설 경로 없음 (높음)

`op_open_account`는 `party_type='member'` + `kind='member_deposit'`로 **고정**이다. 만들 수
없는 것: `player_wallet` · `player_points` · `partner_share_payable` · `party_type='partner'`
주체. `op_wallet_transfer`가 `account_id_of(..., 'player_wallet', ...)`를 호출하므로
**그 계정을 만든 적이 없어 항상 `no_data_found`다** — [`04` §12](04-posting-rules.md)가 정의한
신규 기능 전체가 동작하지 않는다.

- `AC-08-1` `ledger.op_open_ledger_account(p_party_code, p_kind, p_currency, ...)`가 존재하고
  허용 종류가 **화이트리스트**다 — `player_wallet` · `player_points` · `partner_share_payable`.
- `AC-08-2` 금지 종류가 거부된다 — `house_*` · `chips_outstanding` · `opening_equity`는
  부트스트랩 · 게임개설 · 마이그레이션 전용이다.
- `AC-08-3` `ledger.op_register_partner(...)`가 파트너 주체 + `partner_profiles` +
  `partner_share_payable`을 **한 트랜잭션에서** 만든다.
- `AC-08-4` `op_register_partner`가 `depth = parent.depth + 1`을 강제한다 (`DR-40`과 한 묶음).
- `AC-08-5` `op_wallet_transfer`가 실제로 성공하는 골든 테스트가 있다 — 계정 개설부터 이체까지.

---

### DR-10 · `outbox`에 지점 경계가 없다 (높음)

`ledger.outbox.payload`에는 계좌 코드 · 계정 종류 · 금액 · 범주가 전부 들어 있는데
`ledger_app`이 SELECT를 갖고 RLS가 없다. [`06` §4-3](06-security.md)의 RLS 대상 13개 테이블에
`outbox`가 없다. [`02` §4-2](02-target-architecture.md)가 주장하는 "서버가 인가를 강제한다"는
**Realtime Gateway의 애플리케이션 로직에만 존재한다.**

- `AC-10-1` `ledger_relay` 역할이 존재하고 `outbox`만 본다.
- `AC-10-2` `ledger_app`의 `outbox` 접근이 회수됐다.
- `AC-10-3` `outbox`에 RLS가 켜져 있다 — relay 자격증명 침해에는 무력하지만, `ledger_app`에
  실수로 GRANT가 다시 붙는 **회귀를 기본거부로 잡는다.**
- `AC-10-4` [`02` §5-2](02-target-architecture.md) 역할 표에 `ledger_relay`와 `identity_app`이
  있다. (`identity_app`은 `DR-03` 해소로 이미 존재하는데 문서에 없다.)

**검증**

```sql
SELECT has_table_privilege('ledger_app','ledger.outbox','SELECT') AS app_reads_outbox;
-- 기대: f
```

---

### DR-11 · 롤링 정정이 지점 누계를 오염시킨다 (높음)

`op_record_rolling`은 항상 `source='manual'` + `counts_toward_branch_total=TRUE`를 넣고
트리거가 그 조합을 1:1로 강제한다. 그런데 [`04` §6](04-posting-rules.md)은 "정정은 음수"라고
정의하는데 **정정 대상이 바이인 시드(`source='buyin'`, `counts=FALSE`)일 수 있다.**

```
원본:  buyin   +2,000,000  counts=FALSE  → 지점 누계 미산입
정정:  manual  −2,000,000  counts=TRUE   → 지점 누계에서 차감
지점 관측 롤링 누계 = 넣은 적 없는 금액만큼 줄어든다
```

- `AC-11-1` 정정이 **대상 이벤트를 지목**한다 — `op_record_rolling`이 정정 대상
  `rolling_event_id`를 받거나, 정정 전용 연산이 분리돼 있다.
- `AC-11-2` 정정의 `counts_toward_branch_total`이 **대상 이벤트의 값을 따른다.**
  `manual` ↔ `TRUE` 강제 트리거가 정정 경로에는 적용되지 않는다.
- `AC-11-3` 바이인 시드 정정 후 `cage.v_branch_rolling_total`이 변하지 않는다 (골든 테스트).
- `AC-11-4` [`04` §6](04-posting-rules.md)에 롤링 정정 입력 규칙이 있다.

---

### DR-13 · 게임 취소가 손님 잔액 부족으로 실패, 회복 경로 없음 (중간)

`op_cancel_game`이 중간정산 입금을 역분개하면 `member_deposit` 차변이 되는데, 손님이 이미
출금했으면 지연 제약 트리거가 **커밋을 거부한다.** 설계상 옳다 — 없는 돈은 회수할 수 없다.
문제는 **그 상태에서 할 수 있는 일이 문서에 없다는 것**이다. 게임은 `ongoing`으로 남는다.

- `AC-13-1` [`04` §9](04-posting-rules.md)에 "취소가 실패하는 조건"이 명시돼 있다.
- `AC-13-2` `ledger.op_issue_marker(member, amount)`가 존재한다 —
  `marker_receivable[branch] +A` / `member_deposit[acct] −A`. `tx_kind`에 `marker_issue`,
  `entry_category`에 `marker_issue`. 4-eyes 대상.
- `AC-13-3` **부분 취소를 만들지 않는다.** 미회수분을 마커로 전환한 뒤 취소를 재시도하는
  2단계 절차다. 미회수분이 손님에 대한 채권으로 남고 흔적이 전부 남는다.
- `AC-13-4` API가 이 실패를 `insufficient-balance`가 아니라 `cancel-would-overdraw`로 구분한다.
  화면이 위 절차를 안내할 수 있어야 한다.
- `AC-13-5` 골든 테스트: 개설 → 중간정산 → 손님 출금 → 취소 실패 → 마커 발행 → 취소 성공.

---

### DR-16 · 파트너 운영자가 전 직원 목록을 조회할 수 있다 (중간)

파트너 운영자와 케이지 직원이 **같은 `ledger_app` 역할로** DB에 붙는다. `identity.staff` ·
`staff_branches` · `staff_roles` · `shift_events`에 RLS가 없다. 노출되는 것: 전 직원 명단 ·
지점 배치 · 역할 구성 · 잠금 상태 · 교대 기록. 인증 비밀값은 컬럼 GRANT로 막혀 있다.

**`ledger.party_visible()`이 파트너 계층 경계를 정교하게 만들어 놓았는데 `identity` 쪽에는 그
경계가 없다.**

- `AC-16-1` 네 테이블에 RLS가 켜져 있다.
- `AC-16-2` 판정이 `identity.staff_visible()` **함수 하나에 모여** 있다 — `party_visible()`과
  같은 방식이다. 규칙: 자기 자신은 항상 · 파트너 운영자는 같은 `partner_subtree` 소속만 ·
  케이지 직원은 `current_branches()`에 걸치는 직원만.
- `AC-16-3` [`06` §4-3](06-security.md)의 RLS 대상 목록이 13개에서 17개로 갱신됐다.
- `AC-16-4` 파트너 세션에서 케이지 직원 조회가 0행 (골든 테스트).

---

### DR-17 · 윈로스 원천이 둘 (중간) **[결정]**

`cage.games.win_loss_minor` 스냅샷과 `cage.v_game_win_loss` 뷰가 같은 값을 두 곳에서 만든다.
[`04` §8-3](04-posting-rules.md)이 "정정 거래가 들어오면 재계산한다"고 쓰는데
**재계산하는 주체가 없다.**

**권고: (A) 스냅샷을 없앤다.** 이 설계의 다른 파생값 9개(교대 카운터)와 같은 원칙이고,
**"파생값을 저장하지 않는다"는 이 설계의 주장을 스스로 어기지 않는 유일한 선택지다.**

- `AC-17-A` `cage.games.win_loss_minor` 컬럼이 삭제되고 뷰만 남는다. **또는**
- `AC-17-B` 스냅샷 ≠ 뷰를 잡는 대사 항목이 `v_integrity_status`에 있다. **또는**
- `AC-17-C` `entries` INSERT 시 스냅샷을 갱신하는 트리거가 있다 (쓰기 경로가 무거워진다).
- `AC-17-1` **셋 중 무엇을 골랐는지 ADR로 기록돼 있다.**
- `AC-17-2` 종료 후 역분개 시나리오에서 두 값이 갈리지 않는다 (골든 테스트).

---

### DR-18 · 게임 개설 중복이 매핑되지 않은 23505로 터진다 (중간)

멱등키가 다르면 같은 `game_no` 개설을 막지 못한다. 현행은 클라이언트가 `'YYMMDD'`+3자리로
만들므로 두 단말이 동시에 만들면 두 번째가 23505로 실패하고, 오류 표에 없어 API가 500을 뱉는다.

- `AC-18-1` **게임 번호를 서버가 발급한다.** `(branch, business_date)` 카운터 테이블 +
  `FOR UPDATE`. 전역 시퀀스는 일자 리셋과 맞지 않는다. **또는**
- `AC-18-2` 클라이언트 제안을 유지한다면 `op_open_game`이 `unique_violation`을 잡아
  `game-no-taken`(409)으로 매핑한다.
- `AC-18-3` [`05` §7](05-api-contract.md) 오류 표에 그 코드가 있다.
- `AC-18-4` 동시 개설 테스트에서 500이 나오지 않는다.

---

### DR-33 · `op_open_account`에 재인증 인자 자체가 없다 (중간)

다른 모든 `op_*`가 스텝업 토큰을 받는데 **이것만 없다.** 계정 개설은 이후 모든 자금 이동의
출발점이고, 유령 계정 생성은 자금 유출의 표준 수법이다. `DR-14`(`op_deposit`)보다 나쁘다 —
저쪽은 인자는 받고 검사만 안 했는데, 이건 **`transactions.auth_method`에 무엇을 기록할지조차
정의되지 않는다.**

- `AC-33-1` `op_open_account`가 `p_step_up_id BIGINT` · `p_device_id TEXT`를 받는다.
- `AC-33-2` 스텝업 없이는 실행되지 않는다.
- `AC-33-3` 4-eyes 대상 여부가 **결정되고 기록**돼 있다. `account.open` 권한이
  `cage_manager`와 `partner_admin` 양쪽에 있으므로 최소한 재인증은 요구한다.
- `AC-33-4` `012`의 GRANT 인자 목록이 함께 바뀌었다. **`DR-03` 때와 같은 함정** — 시그니처만
  바꾸고 GRANT를 두면 `009`~`013`이 적용 불가가 된다.

---

### DR-48 · 지점 누계 인덱스에 지점이 없다 (낮음)

`rolling_events_branch_total_idx`가 `(business_date)`만 잡는다. `cage.rolling_events`에
`branch` 컬럼이 없어 `v_branch_rolling_total`은 `cage.games`를 조인해야 하고, **이 인덱스는
그 질의를 돕지 못한다.**

- `AC-48-1` `rolling_events`에 `branch`를 비정규화하고 인덱스에 넣는다 (다른 테이블들이 이미
  그렇게 한다) — 또는 인덱스 이름이 실제로 하는 일을 반영한다.
- `AC-48-2` 비정규화를 택하면 `games.branch`와의 일관성을 트리거가 강제한다.

---

### DR-49 · 주석이 R4 위치를 `010`이라고 쓴다 (낮음)

- `AC-49-1` `ddl/005`의 해당 주석이 `013`을 가리킨다.
- `AC-49-2` `ddl/` 전 파일의 R번호 ↔ 파일 참조가 실제와 일치한다. 검사가 자동화돼 있으면 더 좋다.

---

### DR-61 · `v_shift_counters`의 칩 유입 카운터 2개가 중복 계상한다 (높음)

`nn_chip_in_shift`가 `reason`으로 거르지 않아 그 지점·영업일의 **모든 NN칩 재고 이벤트 합계**가
된다 — `settle_cashout`도 `settle_marker_redeem`도 포함한다. 즉
`nn_chip_in_shift ⊇ nn_cashout_shift ∪ nn_marker_shift`로 **세 카운터가 서로소가 아니다.**
현행 `nnChipInShift`는 `nn.deposit` 하나에서만 증가한다 — **다른 양을 계산하면서 같은 이름을
붙였다.**

**정합성을 자동 검증하려고 만든 뷰가 자기 안에서 중복 계상한다.** 이관 전후 숫자 대조에서
**항상 불일치가 뜨고, 진짜 이관 오류와 구분할 방법이 없다.**

- `AC-61-1` `nn_chip_in_shift` · `cc_chip_in_shift`가 `reason = 'settle_deposit'`으로 거른다.
- `AC-61-2` **9개 카운터 전부**에 대해 현행 증가 지점과 1:1 대조가 수행됐고 결과가 기록돼 있다.
  [`01` §9](01-current-system.md)의 표가 그 대조표다. 이번에 확인된 것은 둘뿐이다.
- `AC-61-3` **카운터 간 항등식이 정의돼 있다.** `nn_chip_in_shift`가 나머지 NN 카운터들과 어떤
  관계여야 하는지가 지금 어디에도 없다 — 정의되지 않으면 `DR-42`의 R10을 만들어도 **무엇과
  대조할지 모른다.**
- `AC-61-4` [`07` §3-1](07-migration.md) 3단계(감사)에 9개 필드 전수 대조가 항목으로 있고,
  **이관 오류와 뷰 정의 오류를 구분하는 방법**이 함께 적혀 있다.

---

### DR-69 · 컨시어지 도메인 전체 미설계 (중간)

호텔 · 차량 · 항공 예약 — 자금 무관, `localStorage` 전용. 7개 네비 뷰 중 하나가 통째로 이
도메인인데 **[`00`](00-system-map.md) 커버리지 매트릭스에 행 자체가 없다** — "어디가 설계
안 됐는지" 보여주는 문서가 이 도메인은 **누락 여부조차 기록하지 않았다.**

- `AC-69-1` [`00`](00-system-map.md) 커버리지 매트릭스에 컨시어지 행이 있다. **설계가 없다는
  사실 자체가 먼저 기록돼야 한다.**
- `AC-69-2` 스키마가 `cage` 밖에 있다 — 자금 원장과 무관하므로 `concierge`가 자연스럽다.
- `AC-69-3` 테이블 3종(`hotel_bookings` · `car_reservations` · `flight_assists`) + CRUD
  엔드포인트.
- `AC-69-4` 예약 ID를 **서버가 생성한다.** 현행은 `Math.random()` 4자리다.

---

### DR-70 + DR-83 · 계좌 상태 전이 경로가 없다 · 현행 해지는 원장을 지운다 (중간 · 높음)

> **한 항목으로 묶는다.** `ledger.account_status`의 세 값 중 **`'suspended'`와 `'closed'`
> 둘 다** 도달 불가다. `DR-70`을 "차단 조작 경로 추가"로만 처리하면 `'closed'`가 그대로 남는다.
> `'account_status'` 감사 이벤트 종류까지 선언돼 있는데 **한 번도 발생할 수 없다.**

현행 `_doWithdrawAccount()`는 계좌 해지 시 **Firestore `ledger`에서 해당 계좌 원장을 전량
삭제한다.** 두 가지가 동시에 일어난다 — ① append-only 원장의 물리 삭제 ② **상대 계정
(`MAIN-{branch}`)의 미러 행은 남아** 해지 한 번마다 지점 하우스 잔액이 그 계좌의 순입출금액만큼
틀어진다. 잔액이 원장 전량 합산으로 파생되므로 오차는 즉시 화면에 반영되고,
**되돌릴 근거 데이터는 이미 삭제됐다.**

**목표 설계**

- `AC-70-1` `ledger.op_set_account_status()`가 존재하고 `'suspended'` · `'closed'` 양쪽을
  다룬다.
- `AC-70-2` 4-eyes 대상 여부가 결정되고 기록돼 있다.
- `AC-70-3` 상태 전이가 `audit` 이벤트 `'account_status'`를 발생시킨다. **선언된 이벤트가
  실제로 발생하는지 확인하는 테스트가 있다.**
- `AC-70-4` 차단·해제 **이력 테이블**이 있다. 현행 `unblock`은 `splice`로 삭제해 해제 이력이
  소멸한다 — 그 동작을 이식하지 않는다. `DB.blocks`가 계좌 해지 연쇄 삭제에서 제외돼
  **죽은 계좌의 차단 이력은 남고 산 계좌의 해제 이력은 사라지는** 비대칭도 함께 푼다.
- `AC-70-5` `PATCH /v1/accounts/{code}/status`가 [`05` §3](05-api-contract.md)에 있고, 기존
  `PATCH`의 "자금 무관" 범위와 **분리**돼 있다.
- `AC-70-6` [`04`](04-posting-rules.md) 또는 [`08-adr.md`](08-adr.md)에 **"계좌 해지는 상태
  전이이며 분개를 삭제하지 않는다"** 가 명문화돼 있다.
- `AC-70-7` `closed` 계좌에 대한 자금 연산이 거부된다 (골든 테스트).

**이관**

- `AC-70-8` [`07`](07-migration.md)에 **해지 계좌 이관 판정**이 있다. 현행에 이미 삭제된
  원장은 복원 불가이므로, 개시 잔액을 `MAIN-{branch}` 합산으로 산출한다면 **그 값은 이미
  오염돼 있다.** 실사 대조가 필요하다는 사실이 적혀 있어야 한다.
- `AC-70-9` `DR-21`의 계좌 마스터 병합 결과와 대조해 **"애초에 없던 계좌"와 "해지된 계좌"를
  구별할 수 없는 범위**가 목록으로 남아 있다.

**검증**

```sql
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='ledger' AND p.proname LIKE 'op\_%account\_status%';
-- 0 이면 재발
```

---

### DR-80 · 실시간 채널 8종이 전부 케이지 어드민 것이다 (중간)

[`02` §4-1](02-target-architecture.md)이 "현행 `onSnapshot` 8채널을 WebSocket 8채널로 그대로
매핑한다"고 쓰는데, 여덟 개 모두 `index.html`의 `subscribe*Cloud`다. `partner-admin/app.js`의
5곳과 `avatar/app.js`의 1곳에는 **대응 채널이 0개**다. 플레이어 쪽은 A1 보류로 설명되지만
**파트너 콘솔 쪽은 아니다** — A8은 "A1과 무관. 착수 가능"이다.

- `AC-80-1` [`02` §4-2](02-target-architecture.md) 표에 파트너 채널 행이 있다 — 승인 대기열 ·
  회원 목록 · 정산 상태가 후보.
- `AC-80-2` "8채널"이라는 수치가 **케이지 범위로 한정 표기**돼 있다.
  [`README`](README.md) 한 장 요약의 같은 행도 함께.
- `AC-80-3` A8 착수 조건에 실시간 채널 설계가 포함돼 있다 — **엔드포인트만 만들고 채널을
  빼면 A8이 반쪽으로 끝난다.**

---

## 6. M4 — 정산 · 파트너 도메인

> **파트너 도메인은 개별 결함이 아니라 도메인 하나가 통째로 준비되지 않았다.**
> `DR-34`(투표 권한 없음) · `DR-38`/`DR-73`(쉐어 op 없음) · `DR-40`(순환 방지 없음) ·
> `DR-47`(주체 종류 미검증) — 인증 · 권한 · 자금 · 계층 네 축이 모두 미완성이다.
> **넷을 따로 고치면 네 번 손댄다. 한 묶음으로 설계한다.**

### DR-07 + DR-73 + DR-38(잔여) · 포인트 · 쉐어 연산 함수가 전무 (높음)

타입 · 계정 · 분개 규칙 · RBAC 권한 문자열까지 있고 **op 함수만 비어 있다.** ADR-013 구조상
`ledger_app`은 op EXECUTE만 가능하므로 **이 4종 분개는 어떤 권한으로도 만들 수 없다.**

**이번 항목의 특이점**: 결함 추적 장치([`00`](00-system-map.md) §8) 자체가 A4를 ✅ 완료로 닫아
**공백이 추적 밖에 있었다.**

- `AC-07-1` `op_point_earn` · `op_point_convert` · `op_share_accrue` · `op_share_settle`이
  존재한다.
- `AC-07-2` `002`에 쉐어 권한 2행, `012`에 GRANT 4행이 추가됐다.
- `AC-07-3` [`00` §8](00-system-map.md) A4가 재개되거나 신규 항목으로 등록됐고, 상태가
  **"산출물 파일이 존재하는가"가 아니라 "그 기능을 실행할 수 있는가"** 로 판정됐다.
- `AC-07-4` **나머지 `✅` 항목(A3 · A5 · A6 · A7 · A9)도 같은 기준으로 재검증**됐고 결과가
  기록돼 있다.
- `AC-07-5` A8 착수 조건에 op 계층이 명시돼 있다 — **엔드포인트를 만들고 나서 호출할 함수가
  없는 상황을 막는다.**
- `AC-07-6` `op_share_settle`은 U3와 **무관하게** 만들 수 있다 — 입력이 금액이지 요율이 아니다.
  U3 미확정을 이유로 미루지 않는다.
- `AC-07-7` `op_share_accrue`의 멱등키가 `share_accrue:{partner_code}:{period_code}`다 —
  기간별 1회라 재계산해도 중복 적립이 없다.
- `AC-07-8` 잔여 `bet` · `payout`은 A2에 묶여 있음이 `ddl/001`의 `tx_kind` 블록에 기록돼 있다.
  **그 블록이 비는 것이 이 항목의 최종 완료 조건이다.**

**검증 — 실행 경로 전수 검사 (이 병의 재발 탐지기)**

```sql
-- 선언된 tx_kind 중 분개 규칙이 없는 것
SELECT k AS orphan_kind
  FROM unnest(enum_range(NULL::ledger.tx_kind)) AS k
 WHERE NOT EXISTS (SELECT 1 FROM ledger.posting_rules r WHERE r.kind = k);
-- op 함수 매핑은 ddl/001 의 tx_kind 선언부 "op 함수 없음" 블록이 관리한다. 비어야 완료다.
```

---

### DR-34 · `partner_admin`에 `approval.vote` 없음 — 파트너 4-eyes 불가 (중간) **[결정]**

`approval.request`는 있고 `approval.vote`가 없다. 그 권한을 가진 역할은 `cage_manager`
하나뿐이라 **파트너 운영자가 올린 승인 요청은 케이지 매니저만 승인할 수 있다.**
`partner.share_settle`(실제 자금 이동)까지 케이지 측 승인에 매달린다.

- `AC-34-1` 이것이 **의도된 통제인지 결정**되고 기록됐다.
- `AC-34-2` 의도라면 [`06`](06-security.md)에 명시돼 있다.
- `AC-34-3` 의도가 아니라면 역할이 분화됐다 — `partner_admin`(요청) / `partner_approver`(승인).
- `AC-34-4` **파트너 운영자의 `staff_branches` 행 유무가 확인됐다.** `op_cast_vote`가
  `assert_actor_authorized(actor, branch, 'approval.vote')`를 호출하므로, 지점 행이 없으면
  **권한을 줘도 지점 검사에서 막힌다.** 권한만 추가하고 끝내면 여전히 안 된다.
- `AC-34-5` 파트너 조직 내 4-eyes가 실제로 성립하는 골든 테스트가 있다.

---

### DR-40 · 파트너 계층에 순환 방지가 없다 (높음)

`partner_no_self_parent`는 직접 자기참조만 막는다 — `A → B → A`는 통과한다. `depth`는 부모와
대조되지 않아 장식이다. **순환이 있는 트리에서 쉐어를 상향 정산하면 무한 루프이거나 이중
지급이다.** `partner_subtree()`의 재귀 종료가 `UNION`의 중복 제거에 우연히 기대고 있고,
그 함수는 **RLS 정책이 매 조회마다 호출한다.**

> 주석이 "더 깊은 순환은 애플리케이션이 막는다"고 쓴다. **이 문서 세트의 논지가
> "무결성을 데이터베이스가 강제한다"인데, 그 논지를 포기한 자리가 하필 돈이 나가는 트리다.**
> 그리고 이것은 DB가 못 하는 일이 아니다.

- `AC-40-1` `ledger.assert_partner_no_cycle()` 트리거가 있다.
- `AC-40-2` `A → B → A` 삽입이 거부된다.
- `AC-40-3` 깊이 8 초과가 거부된다.
- `AC-40-4` **`depth`가 장식이 아니라 사실이다** — 트리거가 `NEW.depth = parent_depth + 1`을
  강제한다.
- `AC-40-5` **이 트리거가 `op_share_accrue`를 만드는 커밋에 함께 들어간다.** 순환이 지금
  발생하지 않는 유일한 이유는 쉐어 정산 함수가 없기 때문이다.

---

### DR-47 · `identity.staff.partner_party_id`에 주체 종류 검사가 없다 (중간)

FK만 걸려 있다. 같은 파일의 `partner_profiles`는 `assert_partner_party()`로
`party_type='partner'`를 강제하는데 staff 쪽은 하지 않는다 — **한 파일 안에서 같은 종류의
검사가 한쪽에만 있다.** `partner_operator`가 `member` 주체에 묶이면 파트너 계층 스코프 판정이
어긋나고, **그 스코프는 RLS 정책이 읽는 값이다.**

- `AC-47-1` `staff.partner_party_id`가 가리키는 주체가 `party_type='partner'`임을 트리거가
  강제한다.
- `AC-47-2` `member` 주체를 가리키는 삽입이 거부된다.

---

### DR-62 · 파트너 쉐어 계산 규칙 자체가 없다 (높음) **[결정 U3]**

`01`이 두 곳에서 같은 말을 한다 — `shareLedger`는 "데모 시드에서만 쓰이고 실제 적립 코드가
없다", `rate`는 "커미션 계산 코드를 저장소에서 찾지 못했다". **저장 구조는 있고 계산 코드는
없다.** 그런데 목표 설계는 타입 4개와 분개 규칙 4행을 만들었다 —
[README](README.md) 전제 1("현행 구현이 도메인 스펙이다")을 **위반한 유일한 도메인**이다.

> **6·9차가 이 판정을 부분 정정했다.** 롤링 커미션(`DR-66`)과 이벤트 커미션(`DR-67`)에는
> 실제 지급 흐름이 있었고 셋 다 산정 기준이 **관측 롤링 × 요율**이다. 그러나
> **파트너 쉐어(`share_accrue`)에는 여전히 현행 구현이 없다.** 이 항목의 범위는 쉐어로 좁혀졌다.

- `AC-62-1` U3 결정 문서에 **"파트너 쉐어에는 현행 구현이 없다"** 가 결정의 **입력**으로
  기록돼 있다. 이것은 결과가 아니라 전제다.
- `AC-62-2` 요율 규칙 확정 전까지 `share_accrue` · `share_settle` · `partner_share_payable`과
  관련 분개 4행이 DDL에 **없거나**, 있다면 "규칙 미확정 · 실행 경로 없음"이 `001`의 `tx_kind`
  블록에 기록돼 있다. **`commission_expense`는 `DR-66` 해소로 실사용 계정이 됐으므로 이 목록에서
  뺀다.**
- `AC-62-3` `member_profiles.rolling_rate`는 **유지한다.** 현행에 값이 실제로 저장돼 있으므로
  (`"1.45%"`) 이관 대상이다. 컬럼 주석에 "현행 저장값 보존. 계산 규칙 미확정".
- `AC-62-4` U3 결정 시 **관측 롤링 × 요율**이라는 현행 증거 3건(`DR-76`)이 인용된다.

---

### DR-67 + DR-86 · 이벤트 커미션 (높음 · 중간) **[결정 B1]**

계산식이 있는 **자동 지급**이다 — `Math.round(rolling*rate/100)` 후 계좌 입금. 활성 기간
관리 · 활성화 로그 · 지급 이력까지 있는데 `01`·`04`·`05`·DDL 전부 부재다.

현행 구현에 네 가지가 겹친다 — ① `await` 없이 트리거 ② 실패가 무기록(`if(!txn) return`) —
**미지급이 어디에도 남지 않아 사후 보전이 불가능하다** ③ 요율의 권위가 **DOM**
(`document.getElementById('eventRate').value`) ④ 기간 판정이 클라이언트 시계 문자열 비교라
**시계를 바꾸면 종료된 이벤트를 되살릴 수 있다.**

**B1 = "계속 운영한다"인 경우**

- `AC-67-1` 이벤트 엔티티가 있다 — 활성 구간 · 요율(bp) · 활성화 감사.
- `AC-67-2` 기간 판정이 **서버 시각** 기준이다. 문자열 비교가 아니다.
- `AC-67-3` 요율의 권위가 **저장된 값**이다. DOM도 화면 입력값도 아니다.
- `AC-67-4` [`04`](04-posting-rules.md)에 분개 규칙과 정산 트리거 시 자동 지급 규약이 있다.
- `AC-67-5` **연쇄 규약이 (b) 아웃박스 비동기 + 실패 기록이다.** 정산은 확정하고 보너스는
  재시도 가능하게 한다. 아웃박스 인프라는 이미 있다. (a) 같은 트랜잭션은 보너스 실패가 정산을
  되돌리므로 부적절하고, (c) 수동 연산은 현행 UX를 바꾼다.
- `AC-67-6` **지급 실패가 기록된다.**
- `AC-67-7` 골든 테스트: 보너스 지급이 실패해도 롤링 커미션 정산은 확정되고, 실패가 재시도
  큐에 남는다.

**B1 = "폐기한다"인 경우**

- `AC-67-8` 폐기 결정과 **현행 지급 이력(`DB.eventHistory`)의 이관/폐기 판정**이 함께
  기록돼 있다 (`DR-71`).

---

### DR-68 · 케이지 포인트는 파트너 포인트와 별개다 (높음) **[결정 B2]**

`grantPoints()`/`usePoints()`의 대상은 **케이지 계좌**이고 `memberLedger`를 거치지 않는다 —
[`04` §13-2](04-posting-rules.md)가 근거로 삼은 파트너/플레이어 측 `point_earn`·`point_convert`와
**주체도 저장소도 다른 별개 시스템**이다. `01`에 케이지 포인트 절이 없고, `00` 커버리지
매트릭스의 "포인트 · 파트너 쉐어" 행은 `partner-admin/`만 가리킨다. **7개 네비 뷰 중 하나가
통째로 이 시스템이다.**

- `AC-68-1` (a) `04` §13-2 회계 주체로 흡수 / (b) 별도 계정 종류로 분리 / (c) 폐기 중
  **하나가 결정되고 기록**돼 있다.
- `AC-68-2` (a)를 고르면 **회원 = 손님 매핑 규칙이 함께 정의**돼 있다. 현재 매핑이 없다 —
  `DR-75`와 같은 결정이다.
- `AC-68-3` 어느 쪽이든 **현행 잔액(`DB.pointsByAccount`) 이관 규칙**이 있다 (`DR-71`).
- `AC-68-4` [`01`](01-current-system.md)에 케이지 포인트 절이 있고 [`00`](00-system-map.md)
  커버리지 매트릭스가 두 포인트 시스템을 구분한다.

---

### DR-74 · 요청 승인 워크플로가 "엔드포인트 0개"로 축소 기술 (중간)

현행 `approveDeposit`/`processPayment`는 **상태 전이와 기장이 분리**돼 있다 — 상태는 Firestore
트랜잭션 안, 기장은 밖. 실패 창: 상태 커밋 후 기장 실패 시 **요청은 '승인'인데 잔액 변동이 없고**
재시도는 `ALREADY_PROCESSED`로 거부된다. 수동 복구 외엔 경로가 없다. 이 창은 `P-01`~`P-14`에도
등록돼 있지 않다.

목표 설계 쪽은 `depositRequests`·`paymentRequests`에 대응하는 **요청 테이블이 없고**, A8은
"엔드포인트 0개"라는 목록 결손으로만 기술한다. **요청→승인은 엔드포인트 나열보다 큰 설계
단위다.**

- `AC-74-1` 요청 엔티티가 목표 스키마에 있다.
- `AC-74-2` **승인이 단일 op다** — 상태 전이 + 분개가 한 트랜잭션이다. 현행 2단계 구조를
  이식하지 않는다.
- `AC-74-3` 멱등키가 자연키다 — `deposit_req:{request_id}`.
- `AC-74-4` 금액 임계 시 4-eyes가 연동된다 — `require_approval_if_over_threshold` 재사용.
- `AC-74-5` 골든 테스트: 기장 실패 시 상태 전이도 롤백된다.
- `AC-74-6` 이 실패 창이 `P-*` 결함 목록에 등록돼 있다 — **현행 시스템의 알려진 결함으로도
  기록돼야 한다.**

---

## 7. M5 — 이관 · 경화

### DR-29 · 스크럽이 `pw`를 미제거 — 평문 파트너 비밀번호 잔존 (높음)

`archive.scrub_secrets()`의 제거 목록 8종에 **`pw`가 없다.** `had_*` 플래그에도 없어
**남아 있다는 사실조차 기록되지 않는다.** `007`의 경고가 정확히 이 상황을 예상했다 —
"아카이브에 평문 원본이 남으면 그 전환이 무의미해진다."

- `AC-29-1` 제거 목록에 `'pw'`가 있고 `had_partner_pw` 플래그가 있다.
- `AC-29-2` **필드 목록의 도출 방법이 재검토됐다.** 현행 컬렉션 33종의 필드를 전수 조사해
  비밀값 후보를 빠짐없이 열거해야 하고, **하나라도 빠지면 조용히 남는다.**
- `AC-29-3` `archive.migration_audit`에 **"스크럽 대상 필드 목록을 어떻게 도출했는가"** 가
  기록돼 있다. 블랙리스트 방식의 한계를 문서가 인정한다.
- `AC-29-4` 스크럽 후 아카이브 전수에서 알려진 비밀 필드명이 0건임을 확인하는 쿼리가 있다.

---

### DR-63 · 이관 거래의 고정 필드값이 정의되지 않았다 (중간)

`transactions`가 `auth_method NOT NULL` · `device_id NOT NULL` · `tx_actor_required`를 강제하는데
**이관되는 과거 거래는 이 셋을 채울 수 없다.** `deviceId`는 Track A 듀얼라이트 배포 시점부터만
존재하고(M9), 행위자도 `staff` 문자열뿐이라 매핑되지 않는 경우가 생긴다. **답은 있는데 그 결정이
`07` 어디에도 없다.**

**더 나쁜 것**: 이관된 거래에 **원본 Firestore 문서 ID를 넣을 컬럼이 없다.** M5가 "앱 재시도로
중복 원장 생성됐을 수 있음"이라고 쓰는데, 중복은 이관 후에도 남고 그때 "이 두 행이 같은 원본에서
왔는가"를 판별할 근거가 사라진다 — **memo 문자열 파싱으로 감사하게 된다.**

- `AC-63-1` [`07`](07-migration.md)에 이관 거래의 고정 필드값 표가 있다.

  | 필드 | 값 | 근거 |
  |---|---|---|
  | `auth_method` | `'system'` | `tx_actor_required` 면제 조건 |
  | `actor_staff_id` | `NULL` (매핑 가능하면 실제 ID) | 위와 동일 |
  | `device_id` | `'migration:<batch-id>'` | `NOT NULL` + 빈 문자열 금지 |
  | `idempotency_key` | `'legacy:<원본 문서 ID>'` | 재실행 시 중복 삽입 차단 |
  | `kind` | `'opening_balance'` | `DR-38`·`DR-51`과 함께 |

- `AC-63-2` **원본 추적이 `idempotency_key`로 된다.** UNIQUE이므로 이관 스크립트 재실행
  안전성까지 같이 얻는다 — **컬럼을 늘리지 않는 답이 이미 스키마 안에 있다.**
- `AC-63-3` 이관 후 `'legacy:'` 접두 키로 원본 문서를 역추적하는 쿼리가 검증돼 있다.
- `AC-63-4` `op_load_opening_balance()`의 `p_balances` 형식과 이 표가 서로 어긋나지 않는다.
  (그 함수의 페이로드 규약은 [`07` §3-1](07-migration.md)에 2026-08-15에 추가됐다.)

---

### DR-71 · `localStorage` 전용 업무 데이터 이관 계획이 M11 하나뿐 (중간)

M11은 `accounts`만 다룬다. 같은 처지가 더 있다 — `settled`(롤링 정산 이력, **자금 이력**) ·
`pointsByAccount`/`pointsHistory`(**잔액**) · `correctionLog`(감사 이력) ·
`eventHistory`/`eventActivationLog`/`eventStart`·`End`·`Rate`(자금 이력) ·
`hotels`/`cars`/`aero` · `blocks` · `notifications`.

M11의 네 가지 문제(개시 대상 부재 · 단말 간 불일치 · 정본 판별 불가 · 용량 한도)가 **전부 그대로
적용된다.**

- `AC-71-1` [`07`](07-migration.md)에 `localStorage` 데이터 항목별 표가 있고, 각 행에
  **이관 / 폐기 판정 한 줄**이 있다. 판정 없이 비어 있는 행이 없다.
- `AC-71-2` "폐기"로 판정한 항목에 **근거**가 있다 (`notifications`의 휘발성 등).
- `AC-71-3` "이관"으로 판정한 항목이 `DR-21`의 단말 수집 절차에 포함돼 있다 — 계좌만 뽑고
  나머지를 놓치면 두 번 방문해야 한다.
- `AC-71-4` 자금 이력 3종(`settled` · `pointsHistory` · `eventHistory`)의 이관 대상 여부가
  `DR-66`·`DR-67`·`DR-68`의 결정과 **일관**된다.

---

### DR-77 · 파트너 · 회원 측 필드 매핑 규칙 부재 (낮음)

- `AC-77-1` `partners.shareRate` → `share_rate_bp` 변환 규칙이 명시돼 있다.
  **시드 값 `0.5`는 0.5%이므로 `50`bp다. 순진한 `×10000`은 100배 오류이며 자금 계산 직결이다.**
- `AC-77-2` `members` 한글 상태값(`'정상'`/`'정지'`/`'블랙리스트'`)과 유형 4종의 ENUM 매핑이
  있다. (`DR-75` 해소가 선행한다.)
- `AC-77-3` `memberLedger.category` 10종 → `tx_kind` 대응표가 있다.
  `correction`·`avatar_tip`·`dealer_tip`이 A2 보류임은 명시돼 있으므로 그대로 둔다.
- `AC-77-4` **변환 규칙마다 왕복 테스트가 있다** — 원값 → 변환 → 역변환이 원값과 같다.
  `DR-81`의 배당 배수 규약과 같은 계열의 함정이다.

---

## 8. 보류 — A1 · A2 (아바타 개선 확정 후)

> 2026-08-15 사용자 지시: **"avatar는 다른 곳에서 개선하고 있어서 바뀔 여지가 있다.
> 감안해서 확인하고 후순위로 밀림."**
>
> 아래 넷은 8차가 **"개선으로 바뀌는 축"과 "안 바뀌는 축"을 갈라** 후자만 등록한 것이다.
> 라운드 루프 · 페이즈 타이밍 · `rounds`/`avatarRequests` 문서 구조 · 화면 구성은 바뀌므로
> 지적하지 않았다. **아래는 아바타 개선이 어떻게 끝나든 바뀌지 않는다.**

### DR-75 · 온라인 회원 주체 모델의 소속 항목 미지정 (중간) **[결정]**

목표 스키마의 "회원"은 **케이지 손님**이다 — `member_profiles`는 여권·현장사진·`rolling_rate`
같은 케이지 `accounts` 대응 필드뿐이다. 반면 `player_wallet`은 존재한다 — **온라인 회원의 돈
계정은 정의됐는데 그 소유 주체가 어느 party인지 규칙이 없다.**

**소속이 모호하다** — 회원 로그인·베팅은 플레이어 도메인(A1 보류)이지만, 정지·블랙리스트·
정회원 전환·소속이동·SMS 인증은 **파트너 콘솔 운영 기능**(A8 "착수 가능")이다.

- `AC-75-1` [`00` §8](00-system-map.md)에 소속 결정이 기록돼 있다.
  **권고: 주체·상태·인증은 A8** (파트너·아바타 무관), **게임 참여 이력은 A1.**
- `AC-75-2` `member_profiles`와 온라인 회원 프로필의 분리/통합이 **ADR로** 결정돼 있다.
- `AC-75-3` 케이지 손님과 온라인 회원의 **매칭 규칙**이 정의돼 있다 —
  [`04` §12](04-posting-rules.md) `wallet_transfer`가 둘의 연결을 전제한다.
- `AC-75-4` `members`의 나머지 실체가 목표에 매핑돼 있다 — `memberType` 4종 · `status` 3종 ·
  `smsVerified` · `parentAgent` · `betMax`/`betMin` · `pw`/`withdrawPw`(평문 → identity 이전).
- `AC-75-5` [`02`](02-target-architecture.md)가 Identity 스코프에 선언한 "회원 인증"에
  대응하는 테이블이 `002`에 있다.

---

### DR-78 · 페이아웃 멱등키가 베팅 키와 같다 — 지급이 422로 막힌다 (높음)

[`04`](04-posting-rules.md) §13이 베팅 표와 페이아웃 표를 나란히 놓고 **멱등키를 한 줄만** 준다 —
`bet:{round_id}:{member_code}:{bet_type}`. 멱등키 공간이 전역이라 둘이 충돌한다. 페이아웃이 이
키를 쓰면 `begin_idempotent()`가 베팅 행을 찾고 지문이 달라 422로 거절한다 — **어떤 회원도
지급받지 못한다.** 키를 비우면 008이 필수라며 거절한다. **두 경로 모두 지급이 불가능하다.**

무승부 푸시가 이 문제를 매 라운드로 끌어올린다 — 타이일 때 `mult = 1`이므로 **원금과 같은 금액의
페이아웃 분개**가 발생하고, 금액까지 같아 사람 눈으로도 중복으로 보인다.

> **이 절은 보류 대상이 아니다.** [`04`](04-posting-rules.md)의 보류 선언은 *"13절의 나머지
> (라운드 취소 · 결과 정정 · 팁 · 가입 보너스)"* 로 범위를 명시한다. 베팅·페이아웃 두 표는
> 확정분이며 A2 착수 시 그대로 구현 입력이 된다. **A2 착수 시점에는 차단 등급이다.**

- `AC-78-1` 페이아웃 멱등키가 `payout:{round_id}:{member_code}:{bet_type}`로 분리돼 있다.
- `AC-78-2` 라운드 취소·정정 키도 **같은 접두사 규칙으로 미리 예약**돼 있다.
- `AC-78-3` 무승부 푸시(`mult = 1`) 시나리오에서 베팅과 페이아웃이 둘 다 성공한다
  (골든 테스트).
- `AC-78-4` [`04`](04-posting-rules.md) §13의 각 하위 연산이 **자기 멱등키를 갖는다** —
  §13-2가 이미 그렇게 하고 있다. §13만 하나였다.

---

### DR-79 · 거래 행위자 모델에 플레이어가 없다 (높음)

`transactions`의 행위자는 **직원뿐**이고 `auth_method`에 회원 인증을 표현할 값이 없다.
스피드 자가 베팅은 회원 본인이 행위자인데 `auth_method='system'` + 행위자 NULL이 되어
**누가 걸었는지 사라진다.** 아바타 대리 베팅은 지시자(회원)와 집행자(직원)가 분리된 구조인데
**행위자 칸이 하나뿐이라 둘 중 하나만 남는다** — "직원이 회원 돈으로 건 베팅"의 책임 추적이
성립하지 않는다. **케이지 측 4-eyes가 지키려는 것과 정확히 같은 종류의 위험인데 장치가 없다.**

> **이 공백은 보류 밖에 있다.** `002`와 `004`는 §8에서 ✅ 완료다. A1이 정하는 것은 `game`
> 스키마이지 `transactions`의 행위자 컬럼이 아니다. **아바타 개선이 어떻게 끝나든 이 두 컬럼은
> 바뀌지 않는다.**

- `AC-79-1` `auth_method`에 회원 인증 값이 있다.
- `AC-79-2` 행위자가 일반화됐다 — `actor_party_id`로 바꾸거나 `on_behalf_of_party_id`를 더한
  **2행 모델**. 대리 베팅에서 지시자와 집행자가 **둘 다** 남는다.
- `AC-79-3` `tx_actor_required` CHECK가 재작성됐다.
- `AC-79-4` 감사 조회 뷰가 `identity.staff`만 LEFT JOIN하던 것을 함께 고쳤다.
- `AC-79-5` `DR-75`와 **함께** 해소됐다 — 저쪽은 주체가 없다는 것이고 이쪽은 주체가 생겨도
  거래가 그를 가리킬 수 없다는 것이다.

---

### DR-81 · 배당률 · 커미션의 권위 소재가 설계 어디에도 없다 (중간)

[`04`](04-posting-rules.md) §13 페이아웃 표는 금액을 `P`로만 쓰고 **`P`가 어디서 오는지 정의한
곳이 없다.** 현행의 유일한 출처는 클라이언트 상수(`game-engine.js`)이고, `ddl/005`에서
`배당`·`payout`·`odds`·`commission` 검색 결과 **0건**이다.

**규약 함정.** 이 값들은 *배당*이 아니라 **원금 포함 반환 배수**다. 화면 표기는 `1:1`·`0.95:1`·
`8:1`·`11:1`인데 상수는 `2.0`·`1.95`·`9.0`·`12.0`이다. **혼동하면 지급액이 정확히 2배 또는
절반이 된다.** `DR-77`의 `shareRate` %→bp 함정과 같은 계열이다.

**커미션이 숨어 있다.** 뱅커 `1.95`는 5% 커미션을 배수 안에 접어 넣은 값이다. 별도 분개도 수입
계정도 없다 — `commission_expense`는 롤링·쉐어용 **차변** 계정이라 이 자리에 쓸 수 없다.

- `AC-81-1` **규약 표기를 지금 못박는다.** [`04`](04-posting-rules.md) §13에 "이 값은 원금
  포함 반환 배수이며 배당비가 아니다"가 한 줄로 있다. **표 내용은 A1과 함께 움직여도 이 한 줄은
  지금 쓸 수 있다.**
- `AC-81-2` `game` 스키마에 배당표가 있다 — 게임 종류 × 베팅 종류 → 배수 + 커미션율.
- `AC-81-3` `op_payout`이 **클라이언트가 보낸 금액이 아니라 이 표에서 계산**한다.
- `AC-81-4` 뱅커 커미션이 배수에 접혀 있을지 별도 분개로 뺄지 **결정되고 기록**돼 있다.
  따로 보고 싶으면 지금 정해야 한다.
- `AC-81-5` 배수↔배당비 왕복 테스트가 있다 (`AC-77-4`와 같은 형태).

---

## 9. 문서 · 규약

### DR-23 · `entry_category.reversal`이 죽은 값 (낮음)

ADR-016이 역분개를 "원 `category` 유지"로 바꾸면서 사용처가 사라졌다.

- `AC-23-1` ENUM에서 제거됐거나, [`04` §16](04-posting-rules.md)에 **"미사용 — ADR-016 이후"**
  가 명시돼 있다.
- `AC-23-2` **M1 착수 전이면 제거하는 편이 싸다.** 운영 데이터가 생긴 뒤에는 타입 재생성이
  필요하다. 이 판단이 기록돼 있다.

---

### DR-64 · 지점 분산 출금 폐기 근거가 폐기 대상과 어긋난다 (중간)

[`04`](04-posting-rules.md)가 "손님 잔액은 이미 통합되어 있으므로 이 경로가 불필요하다"고
쓰는데, `withdrawAcrossBranches()`가 하던 일은 **하우스 현금이 한 지점에서 부족할 때 다른
지점에서 끌어오는 것**이다. 손님 잔액과 무관하다 — **근거가 다른 질문에 답한다.**

신규 모델에서 같은 상황은 `branch_transfer` → `withdraw` 2단계가 되고, **한 조작이 두 거래로
나뉘며 둘 사이는 원자적이지 않다.** 더 명시적이고 감사 추적도 낫다 — **그래서 좋은 변화일 수
있다.** 문제는 `04`가 그것을 "불필요하다"고 쓴다는 점이다. **없어지는 게 아니라 운영자에게
보이는 절차가 바뀐다.**

- `AC-64-1` [`04`](04-posting-rules.md)의 근거가 실제 폐기 대상(하우스 현금 이월)에 맞게
  고쳐졌다.
- `AC-64-2` **"사용자에게 보이는 변화가 있다"** 가 명시돼 있다 — [`08-adr.md`](08-adr.md)가
  월정산 리셋에 쓴 것과 같은 표기다. 이 문서 세트에 이미 관례가 있다.
- `AC-64-3` [`05`](05-api-contract.md)의 현행↔신규 대응표에 `withdrawAcrossBranches` 행이 있다.
  지금은 표에 없어 **이 기능이 어디로 갔는지 API 문서만 봐서는 알 수 없다.**
- `AC-64-4` Track A가 이 로직에 붙인 테스트(`functions/test/spillPlan.test.js`)의 처리가
  결정돼 있다 — 죽은 코드가 아니라 지금 유지보수되는 기능이다.

---

### DR-72 · 설계 문서의 `index.html` 라인 참조가 HEAD와 어긋난다 (낮음)

워킹트리가 clean인데 참조가 어긋난다. 어긋난 폭이 **정산 블록 크기**다 —
**`01` 작성 시 정산 블록을 건너뛰고 라인을 센 흔적**이며 `DR-66`과 같은 뿌리다.

- `AC-72-1` `01` §7-1의 `_doConfirmMidSettle` 참조가 실제 위치를 가리킨다.
- `AC-72-2` `04` §7-4의 `g.checkpoints` 참조가 실제 위치를 가리킨다.
- `AC-72-3` `05`:122-173 구간의 참조가 전수 재검증됐다.
- `AC-72-4` **라인 참조 검증이 자동화돼 있다.** 문서의 `index.html:NNNN` 참조를 뽑아 그 줄에
  기대 심볼이 있는지 확인하는 스크립트. 없으면 같은 어긋남이 조용히 다시 쌓인다.

---

### DR-76 · U3 증거 스테일 (낮음)

[`08` U3](08-adr.md)와 README 미확정 #3의 "커미션 계산 코드를 저장소에서 찾지 못했다"에 이제
**반증 3건**이 있다 — 케이지 수동 지급(`_doSettleGame`) · 이벤트 커미션(`rolling × rate / 100`
자동 계산·자동 지급) · 파트너 표시 계산(`rolling * 0.015`, 표시 전용).

- `AC-76-1` U3와 README #3의 문구가 갱신됐다.
- `AC-76-2` **셋 다 산정 기준이 "관측 롤링 × 요율"이라는 사실이 U3의 결정 입력으로 인용**돼
  있다. U3의 첫 결정 질문이 "관측 롤링? 바이인 대비? 윈로스 대비?"인데, **현행 증거가 이미
  답의 방향을 가리킨다.**

---

## 10. 현행 시스템 — 지금 도는 코드

> 목표 설계와 무관하게 **지금 오지급을 내고 있다.** 이관을 기다릴 이유가 없다.

### DR-84(잔여) · `Share 40%` 프리셋이 롤링 커미션 40%를 프리필한다 **[현행]**

목표 설계 쪽은 2026-08-15에 해소됐다 — `cage.games.commission_rate_bp` 스냅샷이 유일한 권위이고
`bet_type`은 표시용으로 격하됐다. **현행 코드는 그대로다.**

요율 파싱 정규식이 **첫 퍼센트**를 잡는다:

| 프리셋 | 첫 매치 | 프리필 커미션 |
|---|---|---|
| `Rolling 1.5%` | `1.5` | 롤링 × 1.5% ✅ |
| `Rolling 1% + Share 10%` | `1` | 롤링 × 1% ✅ *(롤링이 앞이라 우연히 맞는다)* |
| **`Share 40%`** | **`40`** | **롤링 × 40%** ❌ |

셰어 딜의 배분율이 롤링 커미션 요율로 읽힌다. 운영자가 매번 덮어쓰는 것이 유일한 방어이며,
코드 주석이 덮어쓰기를 **정상 워크플로로 전제한다.** 즉 이 프리셋은 "고치면 되는 버그"가 아니라
**설계가 사람의 개입을 요구하는 지점**이다.

- `AC-84-1` `Share 40%` 프리셋에서 커미션 프리필이 **0이거나 비어 있다.** 40%를 넣지 않는다.
- `AC-84-2` 정규식이 "첫 퍼센트"가 아니라 **롤링 요율을 지목**한다 — `Rolling\s+([\d.]+)%`.
  매치가 없으면 프리필하지 않는다.
- `AC-84-3` 프리필 값과 실제 입력값이 다를 때 화면에 표시된다 — 지금은 조용히 덮어쓴다.
- `AC-84-4` **과거 `Share 40%` 게임의 실지급액을 역산해 오지급 여부를 확인**했다.
  `DB.settled.commission`과 `rolling`으로 역산 가능하며, `DB.settled`는 `localStorage`
  전용이므로 `DR-21`의 단말 수집과 같은 작업이다.

---

### DR-85(잔여) · 진행 중 게임의 재정산 가드 없음 **[현행]**

목표 설계 쪽은 해소됐다 — `assert_commission_base_available()`이
`sum(rolling_base_minor) <= games.rolling_total_minor`를 강제하므로 **같은 롤링에 두 번**
지급할 수 없다. **현행 코드는 그대로다.**

`_doSettleGame`은 진행 중 게임도 정산 대상으로 명시 지원하는데 `g.settled` 플래그가 없고
드롭다운에서도 제외되지 않는다. `DB.settled`는 push-only이고 같은 `gameId` 중복 검사가 없다 —
**진행 중 게임은 몇 번이든 다시 정산할 수 있고, 매번 계좌에 입금된다.**

- `AC-85-1` 진행 중 게임 재정산 시 **이미 정산된 롤링 구간**을 차감하고 남은 분만 프리필한다.
- `AC-85-2` 남은 분이 0이면 정산 버튼이 막힌다.
- `AC-85-3` **과거 중복 정산 이력을 조사**했다 — `DB.settled`에서 같은 `gameId`가 둘 이상인
  건. 결과가 기록돼 있다.

---

## 11. 대사 검사 R 번호 대장

R 번호 충돌을 막기 위해 여기서 관리한다. **새 검사를 추가하는 사람은 이 표를 먼저 갱신한다.**

| R | 이름 | 상태 | 관련 |
|---|---|---|---|
| R1 | `v_check_double_entry` | ✅ · 지점·기간 분해 필요 | `DR-37` |
| R2 | `v_check_balance_projection` | ✅ · LEFT JOIN 필요 | `DR-28` |
| R3 | `v_check_hash_chain` | ✅ | |
| R4 | `v_check_rolling_projection` | ✅ | `DR-49`(주석 위치 오기) |
| R5 | `v_check_suspense` | ✅ | |
| R6 | `v_check_entry_branch` | ✅ | |
| R7 | `v_check_posting_rules` | ✅ · 표 해시 검증 추가 필요 | `DR-51` |
| R8 | `v_check_chain_anchor` | ✅ 2026-08-15 신설 | `DR-26` |
| R9 | `v_check_merkle_anchor` | ✅ 2026-08-15 신설 | `DR-26` |
| **R10** | `v_check_chip_inventory` | ❌ 미착수 | `DR-42` |
| **R11** | 역분개 미러 대조 | ❌ 미착수 | `AC-51-5` |
| — | `v_check_view_security` | ✅ **`v_integrity_status`에 넣지 않는다** — 배포 시점 검사이지 런타임 데이터 무결성이 아니다 | `DR-24` |
| — | `v_check_public_execute` | ✅ 2026-08-15 신설. 같은 이유로 제외 | 적용 검증 |
| — | `v_check_branch_provisioning` | ✅ 2026-08-16 신설. **`v_integrity_status`에 넣지 않는다** — 원장 정합성이 아니라 설치 완결성이다. R10·R11이 스펙 `01` §6에 예약돼 있어 R 번호를 쓰지 않는다 | `DR-60` · `AC-60-2` |

> `DR-42`가 처음 쓸 때는 "R9"를 제안했으나 `DR-26`이 R8·R9를 먼저 썼다. **R10이 맞다.**
> 3차 등록부의 R9 표기는 이 대장이 우선한다.

---

## 12. 관련 문서

| 문서 | 관계 |
|---|---|
| [00-system-map.md](00-system-map.md) §8 | 개선 항목 A1~A11 · 잔여 작업. 이 문서가 그 §8의 실행 세부다 |
| [ddl/README.md](ddl/README.md) | 적용 · 검증 절차. `AC-12-*`가 자동화할 대상 |
| [design-review.md](design-review.md) ~ [-9](design-review-9.md) | 원 등록부. **각 `DR-*`의 근거와 코드 위치는 그쪽에 있다** |
| [08-adr.md](08-adr.md) | U1~U5 미확정 사항. §2의 결정 선행 표가 이쪽을 가리킨다 |
